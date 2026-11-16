// T-099 Done-when: Scenario PR-81 (02-PRD:750): a patient on the waitlist for a service; a matching slot is cancelled → staff are prompted to
// offer it. Plus the plan (r1, Sol 3e2e6f71 / 7819fc58): clinic cancel and reschedule also offer; a past slot (wall clock), another branch,
// another service, a no-show do not; the oldest waiting entry first (id tie-break); one offer per freed slot; the outcome validated per
// dimension; remove; one open entry; roles; readers; RLS; vendor/operator negatives; guards; tenants. No message to the patient; synthetic
// data (MIG-2). Fixture appointments are inserted booked by the admin (no reservations), then cancelled through the real writers.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { cancelAppointmentByClinic, receiveDeposit, refundDepositForClinic } from "../../src/modules/cashier/deposits/deposits";
import { publish } from "../../src/modules/catalog/catalog";
import { setHours, setServices } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { cancelAppointment, reschedule } from "../../src/modules/scheduling/appointments/appointments";
import { changeSetting } from "../../src/modules/settings/settings";
import { setWeek } from "../../src/modules/scheduling/rosters/rosters";
import { addToWaitlist, recordOfferOutcome, removeFromWaitlist, waitlistList } from "../../src/modules/scheduling/waitlist/waitlist";
import { bootstrapVendor, createVendorStaff } from "../../src/modules/vendor/staff/staff";
import { openSession } from "../../src/modules/vendor/support/support";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "admin_pusat", "marketing", "central_cs", "auditor"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("W1"), b2: await br("W2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`wl${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf WL ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
async function patient(t: T, name: string) {
  return (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-06-15', 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $3, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, name, t.b1])).rows[0].id as string;
}
// A booked appointment (fixture: inserted booked, no reservations — the cancel writers release none and the guard allows it).
async function booked(t: T, branch: string, pt: string, versionId: string, startsAt: Date, by: P) {
  return (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel,
      created_by, created_as) values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
    [t.tenantId, branch, pt, versionId, by.staffId, startsAt, new Date(startsAt.getTime() + 30 * 60_000)])).rows[0].id as string;
}
const entry = async (id: string) => (await h.admin.query(`select * from waitlist_entries where id = $1`, [id])).rows[0];
const offers = async (entryId: string) => (await h.admin.query(`select recipient_role, branch_id, subject_kind from notifications where type = 'waitlist_offer' and subject_id = $1 order by recipient_role`, [entryId])).rows;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

let A: T; let B: T;
let OWN: P; let AP: P; let MGR: P; let MGR2: P; let FO: P; let FO2: P; let CS: P; let BC: P; let DOC: P; let MK: P; let FH: P; let BOWN: P;
let facial: { itemId: string; versionId: string }; let peel: { itemId: string; versionId: string };

async function service(code: string, extra: Record<string, unknown> = {}) {
  const v = await as(OWN, (db) => publish(db, { kind: "service", code }, {
    name: `Layanan ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "facial",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat", delegation: "Dokter",
    aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }], ...extra,
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  return { itemId: v.itemId, versionId: v.versionId };
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Daftar Tunggu"); B = await tenant("PT Klinik Lain Tunggu");
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2);
  FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); CS = await person(A, "central_cs"); BC = await person(A, "bc", A.b1);
  DOC = await person(A, "doctor", A.b1, A.b2); MK = await person(A, "marketing"); FH = await person(A, "facility_head", A.b1); BOWN = await person(B, "owner");
  facial = await service("WL-FAC"); peel = await service("WL-PEEL");
  for (const b of [A.b1, A.b2]) await as(OWN, (db) => setServices(db, b, [facial.itemId, peel.itemId]));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("T-099 Scenario PR-81", () => {
  it("a patient waits for a service; a matching slot is cancelled → the entry is offered that slot and the branch's FO / CS / manager are prompted", async () => {
    const waiting = await patient(A, "Pasien Daftar Tunggu");
    const { entryId } = await as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: waiting, itemId: facial.itemId }));
    expect(await entry(entryId)).toMatchObject({ state: "waiting", offered_appointment_id: null });
    const other = await patient(A, "Pasien Batal");
    const apt = await booked(A, A.b1, other, facial.versionId, inDays(3), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), apt, "Pasien berhalangan"));
    expect((await h.admin.query(`select state from appointments where id = $1`, [apt])).rows[0].state).toBe("cancelled");
    expect(await entry(entryId)).toMatchObject({ state: "offered", offered_appointment_id: apt });
    expect(await offers(entryId)).toEqual(["central_cs", "fo_cashier", "manager"].map((r) => ({ recipient_role: r, branch_id: A.b1, subject_kind: "waitlist_entry" })));
    // visible to the branch's FO / CS / manager; not to another branch's FO
    const sees = async (p: P) => (await as(p, (db) => db.query(`select id from notifications where type = 'waitlist_offer' and subject_id = $1`, [entryId]))).rowCount;
    expect([await sees(FO), await sees(CS), await sees(MGR), await sees(FO2)]).toEqual([1, 1, 1, 0]);
    // the list shows the offered slot; no message to the patient
    const row = (await as(FO, (db) => waitlistList(db, A.b1))).find((r) => r.id === entryId);
    expect(row).toMatchObject({ state: "offered", offered_appointment_id: apt, patient_name: "Pasien Daftar Tunggu" });
    expect(Number((await h.admin.query(`select count(*) c from outbound_messages where tenant_id = $1`, [A.tenantId])).rows[0].c)).toBe(0);
    // the item filter: the peel list of the branch does not show the facial entry
    expect((await as(FO, (db) => waitlistList(db, A.b1, peel.itemId))).map((r) => r.id)).not.toContain(entryId);
    expect((await as(FO, (db) => waitlistList(db, A.b1, facial.itemId))).map((r) => r.id)).toContain(entryId);
    const ev = (await h.admin.query(`select payload from domain_events where type = 'WaitlistOffered' and aggregate_id = $1`, [entryId])).rows[0].payload;
    expect(Object.values(ev).every((x) => typeof x === "string")).toBe(true);
  });
});

describe("T-099 offers", () => {
  it("clinic cancel offers; a no-show, a past slot, another branch or another service do not; the oldest waiting entry first; one offer per slot", async () => {
    const add = async (name: string, branch = A.b1, item = facial.itemId) => (await as(CS, async (db) => addToWaitlist(db, key(), { branchId: branch, patientId: await patient(A, name), itemId: item }))).entryId;
    const x = await patient(A, "Pasien Slot");
    // two waiting entries, one cancellation → only the oldest is offered
    const first = await add("Pasien Pertama");
    const second = await add("Pasien Kedua");
    const a1 = await booked(A, A.b1, x, facial.versionId, inDays(4), DOC);
    await as(FO, (db) => cancelAppointmentByClinic(db, key(), a1, "Dokter berhalangan"));
    expect([(await entry(first)).state, (await entry(second)).state]).toEqual(["offered", "waiting"]);
    const listed = (await as(CS, (db) => waitlistList(db, A.b1, facial.itemId))).map((r) => r.id); // oldest first
    expect(listed.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(listed.indexOf(first)).toBeLessThan(listed.indexOf(second));
    // a no-show frees nothing for the waitlist; another branch's and another service's cancellations do not match
    const a2 = await booked(A, A.b1, x, facial.versionId, new Date(Date.now() - 3 * 3_600_000), DOC);
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    try {
      await h.admin.query(`update appointments set state = 'no_show', state_changed_at = now(), state_changed_by = $2 where id = $1`, [a2, FO.staffId]);
    } finally {
      await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    }
    const a3 = await booked(A, A.b2, x, facial.versionId, inDays(5), DOC);
    await as(FO2, (db) => cancelAppointment(db, key(), a3, "Ganti cabang"));
    const a4 = await booked(A, A.b1, x, peel.versionId, inDays(5), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), a4, "Ganti layanan"));
    expect((await entry(second)).state).toBe("waiting");
    // a past slot (already started) offers nothing
    const a5 = await booked(A, A.b1, x, facial.versionId, new Date(Date.now() - 60_000), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), a5, "Sudah lewat"));
    expect((await entry(second)).state).toBe("waiting");
    // two cancellations, one waiting entry → one offer (the second finds nobody waiting)
    const a6 = await booked(A, A.b1, x, facial.versionId, inDays(6), DOC);
    const a7 = await booked(A, A.b1, x, facial.versionId, inDays(6.5), DOC);
    await Promise.all([as(FO, (db) => cancelAppointment(db, key(), a6, "Batal satu")), as(MGR, (db) => cancelAppointment(db, key(), a7, "Batal dua"))]);
    expect((await entry(second)).state).toBe("offered");
    expect([a6, a7]).toContain((await entry(second)).offered_appointment_id);
    expect(Number((await h.admin.query(`select count(*) c from waitlist_entries where offered_appointment_id = any($1)`, [[a6, a7]])).rows[0].c)).toBe(1);
  });

  it("a reschedule frees the old slot: the oldest waiting entry is offered the old appointment", async () => {
    const w = (await as(CS, async (db) => addToWaitlist(db, key(), { branchId: A.b2, patientId: await patient(A, "Pasien Pindah Tunggu"), itemId: facial.itemId }))).entryId;
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(inDays(20));
    const mon = new Date(`${d}T12:00:00Z`); mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(mon); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); });
    await as(OWN, (db) => setHours(db, A.b2, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00", closes: "20:00" }))));
    await as(OWN, (db) => setWeek(db, A.b2, days[0], [DOC.staffId], days.map((x) => ({ staffId: DOC.staffId, date: x, starts: "09:00", ends: "20:00", kind: "work" as const }))));
    const apt = await booked(A, A.b2, await patient(A, "Pasien Pindah"), facial.versionId, new Date(`${d}T10:00:00+07:00`), DOC);
    const moved = await as(FO2, (db) => reschedule(db, key(), apt, new Date(`${d}T14:00:00+07:00`), null));
    expect((await h.admin.query(`select state from appointments where id = $1`, [apt])).rows[0].state).toBe("rescheduled");
    expect(await entry(w)).toMatchObject({ state: "offered", offered_appointment_id: apt });
    expect(moved.appointmentId).not.toBe(apt);
  });

  it("the wall clock: a cancellation that waits on staff_access past the slot's start offers nothing", async () => {
    const w = (await as(CS, async (db) => addToWaitlist(db, key(), { branchId: A.b2, patientId: await patient(A, "Pasien Jam"), itemId: peel.itemId }))).entryId;
    const apt = await booked(A, A.b2, await patient(A, "Pasien Mulai"), peel.versionId, new Date(Date.now() + 1_500), DOC);
    const holder = await owner.connect();
    try {
      await holder.query("begin");
      await holder.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [A.tenantId]);
      const p = as(FO2, (db) => cancelAppointment(db, key(), apt, "Terlambat batal"));
      await new Promise((r) => setTimeout(r, 2_500)); // the slot starts while the cancellation waits
      await holder.query("commit");
      await p;
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
    }
    expect((await h.admin.query(`select state from appointments where id = $1`, [apt])).rows[0].state).toBe("cancelled");
    expect((await entry(w)).state).toBe("waiting");
  });
});

describe("T-099 outcome, remove, one open entry", () => {
  it("booked is validated on each dimension; declined goes back to waiting and is offered again; remove; one open entry per patient-branch-service", async () => {
    const pt = await patient(A, "Pasien Hasil");
    const { entryId } = await as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: facial.itemId }));
    expect(await code(as(CS, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: facial.itemId })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await code(as(FO, (db) => recordOfferOutcome(db, key(), entryId, crypto.randomUUID(), null)))).toBe("ERR_VERSION_CONFLICT"); // not offered yet
    const other = await patient(A, "Pasien Lain");
    const slot = await booked(A, A.b1, other, facial.versionId, inDays(9), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), slot, "Kosongkan slot"));
    expect((await entry(entryId)).state).toBe("offered");
    // declined → waiting (keyed: the same key replays), offered again by the next cancellation
    const declineKey = key();
    expect(await as(FO, (db) => recordOfferOutcome(db, declineKey, entryId, slot, null))).toBe("waiting");
    expect(await entry(entryId)).toMatchObject({ state: "waiting", offered_appointment_id: null });
    const slot2 = await booked(A, A.b1, other, facial.versionId, inDays(10), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), slot2, "Kosongkan lagi"));
    expect(await entry(entryId)).toMatchObject({ state: "offered", offered_appointment_id: slot2 });
    // review r1 P1: a delayed decision about the first offer neither declines the newer one — a retry of the same key replays the
    // first answer, a new key naming the first slot is refused — and the entry stays offered with slot2
    expect(await as(FO, (db) => recordOfferOutcome(db, declineKey, entryId, slot, null))).toBe("waiting");
    expect(await code(as(FO, (db) => recordOfferOutcome(db, key(), entryId, slot, null)))).toBe("ERR_VERSION_CONFLICT");
    expect(await entry(entryId)).toMatchObject({ state: "offered", offered_appointment_id: slot2 });
    // booked: each dimension refused independently — another patient, another branch, another service, a dead appointment
    const wrongPatient = await booked(A, A.b1, other, facial.versionId, inDays(11), DOC);
    const wrongBranch = await booked(A, A.b2, pt, facial.versionId, inDays(11), DOC);
    const wrongItem = await booked(A, A.b1, pt, peel.versionId, inDays(11), DOC);
    const dead = await booked(A, A.b1, pt, facial.versionId, inDays(12), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), dead, "Batal sendiri"));
    for (const bad of [wrongPatient, wrongBranch, wrongItem, dead]) expect(await code(as(FO, (db) => recordOfferOutcome(db, key(), entryId, slot2, bad))), bad).toBe("ERR_INVALID_INPUT");
    const good = await booked(A, A.b1, pt, facial.versionId, inDays(13), DOC);
    expect(await as(FO, (db) => recordOfferOutcome(db, key(), entryId, slot2, good))).toBe("booked");
    expect(await entry(entryId)).toMatchObject({ state: "booked", booked_appointment_id: good, close_reason: "booked", offered_appointment_id: null });
    expect((await as(FO, (db) => waitlistList(db, A.b1))).map((r) => r.id)).not.toContain(entryId); // closed entries leave the list
    // a new entry may be added once the first is closed; remove
    const again = (await as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: facial.itemId }))).entryId;
    const removeKey = key();
    expect(await as(FO, (db) => removeFromWaitlist(db, removeKey, again))).toBe(false);
    expect(await entry(again)).toMatchObject({ state: "removed", close_reason: "removed" });
    expect(await as(FO, (db) => removeFromWaitlist(db, removeKey, again))).toBe(true); // a retry of the same key replays
    expect(await code(as(FO, (db) => removeFromWaitlist(db, key(), again)))).toBe("ERR_VERSION_CONFLICT");
  });
});

describe("T-099 review r1 (Sol 629155a6): merges, stale outcomes, keyed replays, refund-cancel, tie-break, interleavings, support", () => {
  it("a merge: the survivor's add finds the merged record's open entry; the outcome books the survivor's appointment (stored ids unchanged)", async () => {
    const RO = await person(A, "records_officer", A.b1);
    const dup = await patient(A, "Pasien Ganda Tunggu");
    const surv = await patient(A, "Pasien Utama Tunggu");
    const { entryId } = await as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: dup, itemId: peel.itemId }));
    await as(RO, (db) => mergePatients(db, key(), surv, dup, "Data ganda: pasien yang sama"));
    // one open entry per current patient: the survivor cannot add a second
    expect(await code(as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: surv, itemId: peel.itemId })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    const slot = await booked(A, A.b1, await patient(A, "Pasien Slot Gabung"), peel.versionId, inDays(16), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), slot, "Kosongkan slot gabung"));
    expect(await entry(entryId)).toMatchObject({ state: "offered", offered_appointment_id: slot });
    const survApt = await booked(A, A.b1, surv, peel.versionId, inDays(17), DOC);
    expect(await as(FO, (db) => recordOfferOutcome(db, key(), entryId, slot, survApt))).toBe("booked");
    expect(await entry(entryId)).toMatchObject({ state: "booked", booked_appointment_id: survApt, patient_id: dup }); // history kept
  });

  it("a delayed decline of offer A after offer B: a new key naming A is refused, B stays offered; booked against A also refused", async () => {
    const pt = await patient(A, "Pasien Tawaran Lama");
    const { entryId } = await as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: peel.itemId }));
    const other = await patient(A, "Pasien Pemilik Slot");
    const a = await booked(A, A.b1, other, peel.versionId, inDays(18), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), a, "Slot A"));
    expect(await as(FO, (db) => recordOfferOutcome(db, key(), entryId, a, null))).toBe("waiting");
    const b = await booked(A, A.b1, other, peel.versionId, inDays(19), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), b, "Slot B"));
    expect(await entry(entryId)).toMatchObject({ state: "offered", offered_appointment_id: b });
    const mine = await booked(A, A.b1, pt, peel.versionId, inDays(20), DOC);
    expect(await code(as(MGR, (db) => recordOfferOutcome(db, key(), entryId, a, null)))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(MGR, (db) => recordOfferOutcome(db, key(), entryId, a, mine)))).toBe("ERR_VERSION_CONFLICT");
    expect(await entry(entryId)).toMatchObject({ state: "offered", offered_appointment_id: b });
    expect(await as(MGR, (db) => recordOfferOutcome(db, key(), entryId, b, mine))).toBe("booked");
  });

  it("a replay of remove / outcome re-checks the current actor: the same staff and key, now acting at another branch, is refused", async () => {
    const MB = await person(A, "manager", A.b1, A.b2); // one manager, both branches; the active branch narrows the scope
    const atB2 = async <R>(fn: (db: pg.PoolClient) => Promise<R>) =>
      withTenantContext(app, await resolveContext(app, MB.acc, { tenantId: A.tenantId, actingRole: "manager", activeBranchId: A.b2 }), fn);
    const pt = await patient(A, "Pasien Ulang Kunci");
    const { entryId } = await as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: peel.itemId }));
    const k = key();
    expect(await as(MB, (db) => removeFromWaitlist(db, k, entryId))).toBe(false);
    expect(await as(MB, (db) => removeFromWaitlist(db, k, entryId))).toBe(true); // same actor, same scope: the stored answer
    expect(await code(atB2((db) => removeFromWaitlist(db, k, entryId)))).toBe("ERR_NOT_FOUND"); // same key, B2 active: refused first
    // the outcome likewise
    const pt2 = await patient(A, "Pasien Ulang Hasil");
    const e2 = (await as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt2, itemId: peel.itemId }))).entryId;
    const slot = await booked(A, A.b1, await patient(A, "Pasien Slot Ulang"), peel.versionId, inDays(24), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), slot, "Slot ulang"));
    const ko = key();
    expect(await as(MB, (db) => recordOfferOutcome(db, ko, e2, slot, null))).toBe("waiting");
    expect(await code(atB2((db) => recordOfferOutcome(db, ko, e2, slot, null)))).toBe("ERR_NOT_FOUND");
  });

  it("refund-cancel (deposit_refund_clinic) offers the slot", async () => {
    const svc = await service("WL-DP", { booking_dp_enabled: true, booking_dp_amount: 100_000 });
    await as(OWN, (db) => setServices(db, A.b1, [facial.itemId, peel.itemId, svc.itemId]));
    await as(OWN, (db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: true, batas_ubah: 24 }, reason: "Uji DP daftar tunggu" }));
    const w = (await as(CS, async (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: await patient(A, "Pasien Tunggu DP"), itemId: svc.itemId }))).entryId;
    const apt = await booked(A, A.b1, await patient(A, "Pasien DP"), svc.versionId, inDays(21), DOC);
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
    await as(FO, (db) => refundDepositForClinic(db, key(), deposit_id, { method: "cash", reason: "Dokter berhalangan" }));
    expect((await h.admin.query(`select state from appointments where id = $1`, [apt])).rows[0].state).toBe("cancelled");
    expect(await entry(w)).toMatchObject({ state: "offered", offered_appointment_id: apt });
  });

  it("equal created_at: the id breaks the tie (the smaller id is offered first)", async () => {
    const tie = await service("WL-TIE");
    await as(OWN, (db) => setServices(db, A.b2, [facial.itemId, peel.itemId, tie.itemId]));
    const ids: string[] = [];
    for (const nm of ["Pasien Seri Satu", "Pasien Seri Dua"]) ids.push((await as(CS, async (db) => addToWaitlist(db, key(), { branchId: A.b2, patientId: await patient(A, nm), itemId: tie.itemId }))).entryId);
    // the same creation instant for both (fixture: created_at is frozen by the guard, so set with the guard off)
    await h.admin.query(`alter table waitlist_entries disable trigger waitlist_entries_guard`);
    try {
      await h.admin.query(`update waitlist_entries set created_at = '2026-01-01T00:00:00Z' where id = any($1)`, [ids]);
    } finally {
      await h.admin.query(`alter table waitlist_entries enable always trigger waitlist_entries_guard`);
    }
    const [first, second] = [...ids].sort();
    const apt = await booked(A, A.b2, await patient(A, "Pasien Slot Seri"), tie.versionId, inDays(22), DOC);
    await as(FO2, (db) => cancelAppointment(db, key(), apt, "Slot seri"));
    expect([(await entry(first)).state, (await entry(second)).state]).toEqual(["offered", "waiting"]);
  });

  it("deterministic interleavings: a remove (or decline) that holds staff_access first makes the cancellation offer the next entry", async () => {
    const lane = await service("WL-LANE");
    await as(OWN, (db) => setServices(db, A.b2, [facial.itemId, peel.itemId, lane.itemId]));
    const add = async (nm: string) => (await as(CS, async (db) => addToWaitlist(db, key(), { branchId: A.b2, patientId: await patient(A, nm), itemId: lane.itemId }))).entryId;
    const e1 = await add("Pasien Lajur Satu");
    const e2 = await add("Pasien Lajur Dua");
    const apt = await booked(A, A.b2, await patient(A, "Pasien Slot Lajur"), lane.versionId, inDays(23), DOC);
    // T1: remove e1 inside an open transaction (holds staff_access); T2: the cancellation waits on it; then T1 commits
    const ctx = await resolveContext(app, FO2.acc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.b2 });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let removed!: () => void;
    const removedP = new Promise<void>((r) => { removed = r; });
    const t1 = withTenantContext(app, ctx, async (db) => { await removeFromWaitlist(db, key(), e1); removed(); await gate; });
    await removedP;
    const t2 = as(MGR2, (db) => cancelAppointment(db, key(), apt, "Batal saat hapus"));
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i++) {
      blocked = Number((await h.admin.query(`select count(*) c from pg_stat_activity where wait_event_type = 'Lock' and query like '%appointment_cancel%'`)).rows[0].c) > 0;
      if (!blocked) await new Promise((r) => setTimeout(r, 50));
    }
    expect(blocked).toBe(true);
    release();
    await t1;
    await t2;
    expect([(await entry(e1)).state, (await entry(e2)).state]).toEqual(["removed", "offered"]);
    expect((await entry(e2)).offered_appointment_id).toBe(apt);
    // the reverse order: the cancellation first, then a remove of the offered entry closes it and frees nothing else
    await as(FO2, (db) => removeFromWaitlist(db, key(), e2));
    expect(await entry(e2)).toMatchObject({ state: "removed", offered_appointment_id: null });
  });

  it("vendor: a personal-scope support session on waitlist_entries is pending the Owner's approval, never active at open", async () => {
    const vendor = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 1 }, VENDOR_GROUP_ROLE);
    try {
      const acc = async () => (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, true) returning id`, [`wlv${++n}@vendor-sintetis.test`])).rows[0].id as string;
      const PO = await acc(); const SUP = await acc();
      const c = await owner.connect();
      try {
        await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
        await createVendorStaff(c, { accountId: PO, ip: "203.0.113.10", mfaAt: new Date() }, SUP, "Dukungan Tunggu", ["support"]);
      } finally {
        c.release();
      }
      const tok = `tok${++n}${crypto.randomUUID().replace(/-/g, "")}`;
      await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`, [SUP, tok]);
      const r = await openSession(vendor, { token: tok, ip: "203.0.113.10" }, { tenantId: A.tenantId, purpose: "Memeriksa daftar tunggu atas permintaan klinik", scope: ["public.waitlist_entries"], minutes: 60 });
      expect(r.ok && r.data.state).toBe("pending_approval");
    } finally {
      await vendor.end();
    }
  });
});

describe("T-099 lifecycle", () => {
  it("a suspended tenant adds nothing to the waitlist (new_booking capability)", async () => {
    const S = await tenant("PT Klinik Ditangguhkan");
    const sOwn = await person(S, "owner");
    const pt = await patient(S, "Pasien Ditangguhkan");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [S.tenantId]);
    expect(await code(as(sOwn, (db) => addToWaitlist(db, key(), { branchId: S.b1, patientId: pt, itemId: facial.itemId })))).toBe("ERR_TENANT_SUSPENDED");
  });
});

describe("T-099 roles, readers, RLS, vendor, guards, tenants", () => {
  it("roles and branch rights; inputs; readers; the operator without a session reads nothing; guards; tenants stay apart", async () => {
    const pt = await patient(A, "Pasien Peran WL");
    for (const p of [DOC, BC, MK]) expect(await code(as(p, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: facial.itemId }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR2, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: facial.itemId })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: "not-a-uuid" })))).toBe("ERR_INVALID_INPUT");
    // a service the branch does not offer
    const off = await service("WL-OFF");
    await as(OWN, (db) => setServices(db, A.b2, [facial.itemId, peel.itemId, off.itemId])); // offered at B2 only
    expect(await code(as(FO, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: off.itemId })))).toBe("ERR_NOT_FOUND");
    const k = key();
    const { entryId } = await as(AP, (db) => addToWaitlist(db, k, { branchId: A.b1, patientId: pt, itemId: facial.itemId }));
    expect(await as(AP, (db) => addToWaitlist(db, k, { branchId: A.b1, patientId: pt, itemId: facial.itemId }))).toMatchObject({ entryId, replayed: true });
    // the definer's own replay re-checks the branch (as T-098's review): a manager of another branch with the same key → not found
    const sqlCode = (x: Promise<unknown>) => x.then(() => "ok", (e) => String(e.message).split(":")[0]);
    expect(await sqlCode(as(MGR2, (db) => db.query(`select waitlist_add($1, $2::jsonb)`, [k, JSON.stringify({ branch_id: A.b1, patient_id: pt, item_id: facial.itemId })])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR2, (db) => removeFromWaitlist(db, key(), entryId)))).toBe("ERR_NOT_FOUND");
    // readers
    expect((await as(MGR, (db) => waitlistList(db, A.b1))).map((r) => r.id)).toContain(entryId);
    expect(await code(as(MGR2, (db) => waitlistList(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOC, (db) => waitlistList(db, A.b1)))).toBe("ERR_FORBIDDEN");
    expect((await as(MGR2, (db) => db.query(`select id from waitlist_entries where id = $1`, [entryId]))).rowCount).toBe(0);
    expect((await as(DOC, (db) => db.query(`select id from waitlist_entries where id = $1`, [entryId]))).rowCount).toBe(0);
    // vendor / operator (AGENTS.md:42): personal class, one operator policy, nothing without an approved support session
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.waitlist_entries'`)).rows[0].support_class).toBe("personal");
    expect((await h.admin.query(`select count(*)::int n from pg_policies where tablename = 'waitlist_entries' and 'clinic_operator' = any(roles)`)).rows[0].n).toBe(1);
    const op = await owner.connect();
    try {
      await op.query("begin");
      await op.query("set local role clinic_operator");
      await op.query(`select set_config('app.tenant_id', $1, true)`, [A.tenantId]);
      expect(Number((await op.query(`select count(*) c from waitlist_entries`)).rows[0].c)).toBe(0);
    } finally {
      await op.query("rollback");
      op.release();
    }
    // guards
    expect(await raw(`update waitlist_entries set item_id = $2 where id = $1`, [entryId, peel.itemId])).toBe("raw:42501");
    // identity frozen even along an allowed transition (waiting → removed)
    expect(await raw(`update waitlist_entries set item_id = $2, state = 'removed', closed_at = now(), close_reason = 'removed' where id = $1`, [entryId, peel.itemId])).toBe("raw:42501");
    expect(await raw(`update waitlist_entries set state = 'booked' where id = $1`, [entryId])).toBe("raw:42501");
    expect(await raw(`delete from waitlist_entries where id = $1`, [entryId])).toBe("raw:42501");
    expect(await raw(`truncate waitlist_entries cascade`)).toBe("raw:42501");
    // tenants: B's owner sees none; B's owner cannot add for A's branch or patient
    expect((await as(BOWN, (db) => db.query(`select id from waitlist_entries where id = $1`, [entryId]))).rowCount).toBe(0);
    expect(await code(as(BOWN, (db) => waitlistList(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => addToWaitlist(db, key(), { branchId: A.b1, patientId: pt, itemId: facial.itemId })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => removeFromWaitlist(db, key(), entryId)))).toBe("ERR_NOT_FOUND");
    // the outcome on an offered entry: another tenant and another branch's manager are refused; the entry stays offered
    const slot = await booked(A, A.b1, await patient(A, "Pasien Slot Peran"), facial.versionId, inDays(14), DOC);
    await as(FO, (db) => cancelAppointment(db, key(), slot, "Kosongkan slot peran"));
    expect((await entry(entryId)).state).toBe("offered");
    const mine = await booked(A, A.b1, pt, facial.versionId, inDays(15), DOC);
    expect(await code(as(BOWN, (db) => recordOfferOutcome(db, key(), entryId, slot, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR2, (db) => recordOfferOutcome(db, key(), entryId, slot, mine)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOC, (db) => recordOfferOutcome(db, key(), entryId, slot, mine)))).toBe("ERR_FORBIDDEN");
    expect((await entry(entryId)).state).toBe("offered");
  });
});
