// T-047 Done-when: the board and the close blocker of scenario PR-7 pass for an unpaid bill (the cashier
// is M4: the payment column is set here by the database owner standing in for it, DEC-057). Plus the plan
// review: check-in (arrived with its change stamp, one open visit, today only, two hours early at most,
// scheduled only), close blockers and the reservations released, roles (central CS, clinicians, finance
// refused), lifecycle, idempotent replay, the go-live gate, the guard, events ids only, tenancy.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { setHours, setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { cancelAppointment } from "../../src/modules/scheduling/appointments/appointments";
import { BLOCKER_COPY, checkIn, closeBlocker, closeVisit, today, trackStates, unpaid } from "../../src/modules/visits/visits";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Kunjungan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`vis${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Kunjungan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const wib = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);

async function patient(t: T, name = "Pasien Kunjungan"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}

let A: T;
let B: T;
let OWN: P; let FH: P; let MGR: P; let FO: P; let FO2: P; let CS: P; let DOC: P; let FIN: P; let BFO: P;
let consult: { itemId: string; versionId: string };

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); MGR = await person(A, "manager", A.b1);
  FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); CS = await person(A, "central_cs");
  DOC = await person(A, "doctor", A.b1); FIN = await person(A, "finance"); BFO = await person(B, "fo_cashier", B.b1);
  await as(OWN, (db) => setHours(db, A.b1, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "24:00" }))));
  await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul 1", kind: "consultation" }));
  const v = await as(OWN, (db) => publish(db, { kind: "service", code: "KONSUL" }, {
    name: "Konsultasi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 150_000, category: "consultation",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "I", contraindications: "K", consent_template: "T", delegation: "Dokter",
    aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  await as(OWN, (db) => setServices(db, A.b1, [v.itemId]));
  consult = { itemId: v.itemId, versionId: v.versionId };
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

// An appointment at a given instant with a fresh performer and one staff reservation, inserted directly
// (booking refuses the past; a fixture). The current 15-minute slot is always today in branch time.
const slotNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
async function appt(t: T, start: Date, pt?: string, branch = t.b1): Promise<{ id: string; patient: string }> {
  const patientId = pt ?? (await patient(t));
  const d = await person(t, "doctor", branch);
  const e = new Date(start.getTime() + 30 * 60_000);
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  try {
    const id = (await h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
      [t.tenantId, branch, patientId, consult.versionId, d.staffId, start, e],
    )).rows[0].id as string;
    await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, 'staff', $4, $5, $6)`,
      [t.tenantId, branch, id, d.staffId, start, e]);
    return { id, patient: patientId };
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
  }
}
// Stands in for the later state writers (cashier, pharmacy, room): the database owner sets a column.
const setStep = (visit: string, col: string, value: string) => h.admin.query(`update visits set ${col} = $2 where id = $1`, [visit, value]);
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const activeRes = async (id: string) => Number((await h.admin.query(`select count(*) from resource_reservations where appointment_id = $1 and active`, [id])).rows[0].count);

describe("scenario PR-7: the board and the close blocker for an unpaid bill", () => {
  it("check-in opens one visit; an unpaid bill lists it under Belum dibayar and blocks the close until settled", async () => {
    const a = await appt(A, slotNow());
    const board0 = await as(FO, (db) => today(db, A.b1));
    expect(board0.arrivals.map((x) => x.id)).toContain(a.id);
    const { visitId } = await as(FO, (db) => checkIn(db, key(), a.id));
    const ap = (await h.admin.query(`select state, state_changed_by from appointments where id = $1`, [a.id])).rows[0];
    expect(ap).toMatchObject({ state: "arrived", state_changed_by: FO.staffId });
    expect(await activeRes(a.id)).toBe(1); // the slot is in use, not released at arrival
    let v = (await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === visitId)!;
    expect(v).toMatchObject({ patientId: a.patient, closedAt: null, payment: "not_started" });
    expect(trackStates(v).states).toMatchObject({ Daftar: "selesai", Bayar: "belum", Selesai: "belum" });
    expect((await as(FO, (db) => today(db, A.b1))).arrivals.map((x) => x.id)).not.toContain(a.id);

    await setStep(visitId, "payment", "in_progress"); // a bill exists and is unpaid
    for (const p of [FO, MGR]) {
      v = (await as(p, (db) => today(db, A.b1))).visits.find((x) => x.id === visitId)!;
      expect(closeBlocker(v), p.role).toBe("unpaid_bill");
      expect(unpaid(v), p.role).toBe(true); // listed under "Belum dibayar"
      expect(trackStates(v).blocker).toBe(BLOCKER_COPY.unpaid_bill);
    }
    expect(await reason(as(FO, (db) => closeVisit(db, key(), visitId)))).toBe("ERR_VERSION_CONFLICT:unpaid_bill");

    await setStep(visitId, "payment", "done"); // settled
    expect(await as(FO, (db) => closeVisit(db, key(), visitId))).toMatchObject({ replayed: false });
    v = (await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === visitId)!;
    expect(v.closedAt).not.toBeNull();
    expect(unpaid(v)).toBe(false); // settled and closed: off the outstanding list
    expect(trackStates(v).states.Selesai).toBe("selesai");
    expect(await activeRes(a.id)).toBe(0);
    expect(await reason(as(FO, (db) => closeVisit(db, key(), visitId)))).toBe("ERR_VERSION_CONFLICT:already_closed");
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at`, [visitId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["VisitCheckedIn", "VisitClosed"]);
    for (const e of ev) expect(Object.keys(e.payload).sort()).toEqual(["appointment_id", "branch_id", "patient_id", "visit_id"]);
    const au = (await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [visitId])).rows.map((r) => r.reason_code);
    expect(au).toEqual(["visit_checked_in", "visit_closed"]);
  });

  it("pending dispensing or treatment (in progress or blocked) blocks the close and names the blocker; not needed does not", async () => {
    for (const [col, value, code] of [["dispensing", "in_progress", "pending_dispensing"], ["treatment", "blocked", "pending_treatment"], ["payment", "blocked", "unpaid_bill"]] as const) {
      const a = await appt(A, slotNow());
      const { visitId } = await as(FO, (db) => checkIn(db, key(), a.id));
      await setStep(visitId, col, value);
      expect(await reason(as(FO, (db) => closeVisit(db, key(), visitId))), col).toBe(`ERR_VERSION_CONFLICT:${code}`);
      const v = (await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === visitId)!;
      expect(trackStates(v).blocker, col).toBe(BLOCKER_COPY[code]);
      await setStep(visitId, col, "not_needed");
      expect(await reason(as(MGR, (db) => closeVisit(db, key(), visitId))), col).toBe("ok");
    }
  });

  it("with several blockers the board names the one the database refuses first (unpaid before dispensing)", async () => {
    const a = await appt(A, slotNow());
    const { visitId } = await as(FO, (db) => checkIn(db, key(), a.id));
    await setStep(visitId, "dispensing", "in_progress");
    await setStep(visitId, "payment", "in_progress");
    const v = (await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === visitId)!;
    expect(await reason(as(FO, (db) => closeVisit(db, key(), visitId)))).toBe("ERR_VERSION_CONFLICT:unpaid_bill");
    expect(closeBlocker(v)).toBe("unpaid_bill");
  });

  it("a blocked step without a closing blocker still carries a text, and the visit's own blocker wins", async () => {
    const a = await appt(A, slotNow());
    const { visitId } = await as(FO, (db) => checkIn(db, key(), a.id));
    await setStep(visitId, "intake", "blocked");
    let v = (await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === visitId)!;
    expect(trackStates(v)).toMatchObject({ blocker: "Menunggu penyelesaian kendala" });
    await h.admin.query(`update visits set blocker = 'Menunggu wali pasien' where id = $1`, [visitId]);
    v = (await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === visitId)!;
    expect(trackStates(v).blocker).toBe("Menunggu wali pasien");
  });
});

describe("check-in rules", () => {
  it("today only, from two hours before the start, scheduled only, one open visit per patient", async () => {
    const tomorrow = await appt(A, new Date(slotNow().getTime() + 26 * 3_600_000));
    expect(await reason(as(FO, (db) => checkIn(db, key(), tomorrow.id)))).toBe("ERR_INVALID_INPUT:not_today");
    const later = new Date(slotNow().getTime() + 3 * 3_600_000);
    const early = await appt(A, later);
    // Three hours ahead is tomorrow late in the evening: then "not today" is the answer.
    expect(await reason(as(FO, (db) => checkIn(db, key(), early.id)))).toBe(wib(later) === wib(new Date()) ? "ERR_INVALID_INPUT:too_early" : "ERR_INVALID_INPUT:not_today");
    const cancelled = await appt(A, slotNow());
    await as(FO, (db) => cancelAppointment(db, key(), cancelled.id, "Pasien membatalkan"));
    expect(await reason(as(FO, (db) => checkIn(db, key(), cancelled.id)))).toBe("ERR_VERSION_CONFLICT:not_scheduled");
    const first = await appt(A, slotNow());
    const second = await appt(A, slotNow(), first.patient);
    await as(FO, (db) => checkIn(db, key(), first.id));
    expect(await reason(as(FO, (db) => checkIn(db, key(), second.id)))).toBe("ERR_VERSION_CONFLICT:already_open");
    expect((await h.admin.query(`select state from appointments where id = $1`, [second.id])).rows[0].state).toBe("booked");
  });

  it("roles: owner, admin pusat, manager and FO; central CS, clinicians and finance refused; another branch not found", async () => {
    for (const p of [CS, DOC, FIN]) {
      const a = await appt(A, slotNow());
      expect(await reason(as(p, (db) => checkIn(db, key(), a.id))), p.role).toBe("ERR_FORBIDDEN:role may not check patients in or close visits");
      expect(await code(as(p, (db) => today(db, A.b1))), p.role).toBe("ERR_FORBIDDEN");
    }
    const a = await appt(A, slotNow());
    expect(await code(as(FO2, (db) => checkIn(db, key(), a.id)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO2, (db) => today(db, A.b1)))).toBe("ERR_NOT_FOUND");
    const { visitId } = await as(OWN, (db) => checkIn(db, key(), a.id));
    expect(await code(as(FO2, (db) => closeVisit(db, key(), visitId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(CS, (db) => closeVisit(db, key(), visitId)))).toBe("ERR_FORBIDDEN");
  });

  it("a replay returns the same visit; a suspended tenant still serves visits, an exiting one does not", async () => {
    const a = await appt(A, slotNow());
    const k = key();
    const one = await as(FO, (db) => checkIn(db, k, a.id));
    const two = await as(FO, (db) => checkIn(db, k, a.id));
    expect(two).toEqual({ visitId: one.visitId, replayed: true });
    expect(Number((await h.admin.query(`select count(*) from visits where appointment_id = $1`, [a.id])).rows[0].count)).toBe(1);
    const s = await appt(A, slotNow());
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [A.tenantId]);
    try {
      expect(await reason(as(FO, (db) => checkIn(db, key(), s.id)))).toBe("ok");
      await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [A.tenantId]);
      expect(await code(as(FO, (db) => closeVisit(db, key(), one.visitId)))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
  });

  it("production with go-live blockers refuses check-in and close before anything changes (ARCH-10)", async () => {
    const a = await appt(A, slotNow());
    const b = await appt(A, slotNow());
    const { visitId } = await as(FO, (db) => checkIn(db, key(), b.id));
    process.env.DEPLOY_ENV = "production";
    try {
      await expect(as(FO, (db) => checkIn(db, key(), a.id))).rejects.toThrow(/go-live blocked/);
      await expect(as(FO, (db) => closeVisit(db, key(), visitId))).rejects.toThrow(/go-live blocked/);
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    expect((await h.admin.query(`select state from appointments where id = $1`, [a.id])).rows[0].state).toBe("booked");
    expect((await h.admin.query(`select closed_at from visits where id = $1`, [visitId])).rows[0].closed_at).toBeNull();
  });
});

describe("guard, grants and tenancy", () => {
  it("clinic_app cannot write visits; the guard keeps identity, finality, no delete, no close under a blocker", async () => {
    const a = await appt(A, slotNow());
    const { visitId } = await as(FO, (db) => checkIn(db, key(), a.id));
    expect(await code(as(FO, (db) => db.query(`update visits set payment = 'done' where id = $1`, [visitId])))).toBe("raw:42501");
    expect(await code(as(FO, (db) => db.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4)`, [A.tenantId, A.b1, a.patient, FO.staffId])))).toBe("raw:42501");
    const err = (q: Promise<unknown>) => q.then(() => "ok", (e) => e.message as string);
    expect(await err(h.admin.query(`delete from visits where id = $1`, [visitId]))).toMatch(/never deleted/);
    expect(await err(h.admin.query(`update visits set patient_id = $2 where id = $1`, [visitId, await patient(A)]))).toMatch(/keeps its branch/);
    await setStep(visitId, "payment", "in_progress");
    expect(await err(h.admin.query(`update visits set closed_at = now(), closed_by = $2 where id = $1`, [visitId, FO.staffId]))).toMatch(/blocker holds/);
    await setStep(visitId, "payment", "done");
    await as(FO, (db) => closeVisit(db, key(), visitId));
    expect(await err(setStep(visitId, "payment", "in_progress"))).toMatch(/closed visit is final/);
    const b = await appt(A, slotNow());
    expect(await err(h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, appointment_id, kind, checked_in_by) values ($1, $2, $3, $4, 'booked', $5)`,
      [A.tenantId, A.b1, b.patient, b.id, FO.staffId]))).toMatch(/arrived appointment/);
    expect(await err(h.admin.query(`truncate visits cascade`))).not.toBe("ok");
  });

  it("tenant B neither reads A's board nor checks in or closes A's visits", async () => {
    const a = await appt(A, slotNow());
    expect(await code(as(BFO, (db) => checkIn(db, key(), a.id)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => today(db, A.b1)))).toBe("ERR_NOT_FOUND");
    const { visitId } = await as(FO, (db) => checkIn(db, key(), a.id));
    expect(await code(as(BFO, (db) => closeVisit(db, key(), visitId)))).toBe("ERR_NOT_FOUND");
    expect((await as(BFO, (db) => db.query(`select id from visits where id = $1`, [visitId]))).rows).toEqual([]);
  });

  it("the board keeps open visits and today's closed ones; a visit closed on an earlier day leaves it", async () => {
    const a = await appt(A, slotNow());
    const { visitId } = await as(FO, (db) => checkIn(db, key(), a.id));
    await h.admin.query(`alter table visits disable trigger visits_guard`);
    try {
      await h.admin.query(`update visits set closed_at = now() - interval '2 days', closed_by = $2 where id = $1`, [visitId, FO.staffId]);
    } finally {
      await h.admin.query(`alter table visits enable always trigger visits_guard`);
    }
    expect((await as(FO, (db) => today(db, A.b1))).visits.map((v) => v.id)).not.toContain(visitId);
    // A payment blocked (not only in progress) also counts as unpaid on an open visit.
    const b = await appt(A, slotNow());
    const open = await as(FO, (db) => checkIn(db, key(), b.id));
    await setStep(open.visitId, "payment", "blocked");
    const v = (await as(FO, (db) => today(db, A.b1))).visits.find((x) => x.id === open.visitId)!;
    expect(unpaid(v)).toBe(true);
  });
});

