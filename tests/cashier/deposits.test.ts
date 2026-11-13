// T-077 Done-when: the booking DP lifecycle — scenario PR-22 (a DP of Rp200,000; the patient reschedules 10 h before: forfeited
// and recorded), the money part of PR-83 (a no-show with a DP: forfeited), money scenarios 6a–6e and 17 with gross fixtures
// (moved to balance with VAT reversed, spent later on a taxable line so VAT is counted once; the clinic-caused cash refund).
// Plus the plan reviews: the cutoff boundary (at the cutoff → balance, one second after → forfeited), held → booked on receipt and an
// expired hold refused, SET-10 off or the item's DP off refused, one DP per appointment, idempotent replay and conflict, methods,
// the apply room rule and VAT move, a void refused after apply, roles, branches and tenants, auditor masking, the guard.
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { getReceipt, issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { applyDeposit, cancelAppointmentByClinic, receiveDeposit, refundDepositForClinic } from "../../src/modules/cashier/deposits/deposits";
import { publish } from "../../src/modules/catalog/catalog";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { setHours, setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { cancelAppointment, markNoShow, reschedule } from "../../src/modules/scheduling/appointments/appointments";
import { setWeek } from "../../src/modules/scheduling/rosters/rosters";
import { changeSetting } from "../../src/modules/settings/settings";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { checkIn } from "../../src/modules/visits/visits";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const NPWP = "012345678901234";

async function tenant(name = "PT DP Sintetis"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("DP1"), b2: await br("DP2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`dp${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf DP ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const localDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + days * 86_400_000));
const monday = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const today = () => localDay(0);
const tomorrowWib = () => localDay(1);

async function patient(t: T, name = "Pasien DP"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}

let A: T; let B: T;
let OWN: P; let FH: P; let MGR: P; let FO: P; let FO2: P; let FIN: P; let AU: P; let CS: P; let DOC: P; let BFO: P; let AP: P; let DOC2: P;
let svc: { itemId: string; versionId: string }; // DP Rp200,000 on a Rp500,000 exempt consultation
let nodp: { itemId: string; versionId: string };

async function service(t: { own: P; fh: P }, code: string, f: Record<string, unknown>) {
  const v = await as(t.own, (db) => publish(db, { kind: "service", code }, {
    name: `Layanan ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category: "consultation",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", contraindications: "Kontra", consent_template: "Templat", delegation: "Dokter",
    aftercare_text: "Perawatan setelah tindakan", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }], ...f,
  } as never, "Layanan baru"));
  if (v.approvalId) await as(t.fh, (db) => decideApproval(db, v.approvalId!, true));
  return { itemId: v.itemId, versionId: v.versionId };
}
async function setupBranch(t: T, own: P, doctors: string[], services: string[], branch = t.b1) {
  await as(own, (db) => setHours(db, branch, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "23:45" }))));
  await as(own, (db) => upsertRoom(db, branch, { name: `Konsul ${branch.slice(0, 4)}`, kind: "consultation" }));
  await as(own, (db) => setServices(db, branch, services));
  for (const week of [...new Set([0, 1, 2, 7, 8].map((d) => monday(localDay(d))))]) {
    // Only today and later can be rostered (roster_set_week refuses a past shift).
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${week}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); })
      .filter((d) => d >= localDay(0));
    if (!days.length) continue;
    await as(own, (db) => setWeek(db, branch, week, doctors, days.flatMap((d) => doctors.map((s) => ({ staffId: s, date: d, starts: "00:00", ends: "23:45", kind: "work" as const })))));
  }
}
const dpOn = (own: P, on = true, hours = 24) => as(own, (db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: on, batas_ubah: hours }, reason: "Uji DP" }));

// A booked appointment starting at `start` (the admin connection; resources reserved so reschedule and release work).
async function appointment(t: T, pt: string, start: Date, doc: P, versionId = svc.versionId, state = "booked", branch = t.b1) {
  const e = new Date(start.getTime() + 30 * 60_000);
  const room = (await h.admin.query(`select id from rooms where tenant_id = $1 and branch_id = $2 limit 1`, [t.tenantId, branch])).rows[0].id as string;
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
  try {
    const id = (await h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, hold_until, channel, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8 = 'held' then now() + interval '10 minutes' end, 'phone', $5, 'fo_cashier') returning id`,
      [t.tenantId, branch, pt, versionId, doc.staffId, start, e, state])).rows[0].id as string;
    for (const [k, r] of [["staff", doc.staffId], ["room", room]])
      await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [t.tenantId, branch, id, k, r, start, e]);
    return id;
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
  }
}
const quarter = (ms: number) => new Date(Math.ceil((Date.now() + ms) / 900_000) * 900_000);
const H = 3_600_000;
// An arrival slot: within check-in's two hours and today in WIB (n-th 30-minute slot from the next quarter; a test needing it
// runs late in the WIB day only if the clock allows, so the slot is clamped to before midnight).
const soon = (i: number) => new Date(Math.min(quarter(i * 30 * 60_000).getTime(), at0() - 30 * 60_000));
const at0 = () => new Date(`${localDay(1)}T00:00:00+07:00`).getTime();
const dep = async (id: string) => (await h.admin.query(`select * from booking_deposits where id = $1`, [id])).rows[0];
const balance = async (pt: string) => Number((await h.admin.query(`select coalesce((select balance from balance_accounts where patient_id = $1), 0) b`, [pt])).rows[0].b);
const events = async (id: string) => (await h.admin.query(`select type, payload from domain_events where aggregate_kind = 'booking_deposit' and aggregate_id = $1 order by occurred_at, id`, [id])).rows;
// Check-in through the real writer (the appointment arrives; a booked visit opens).
const arrive = async (apt: string, by: P) => (await as(by, (db) => checkIn(db, key(), apt))).visitId;
async function bill(fo: P, visitId: string, items: { itemId: string; quantity: number; discount?: number }[]) {
  const patientId = (await h.admin.query(`select patient_id from visits where id = $1`, [visitId])).rows[0].patient_id as string;
  const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { visitId, patientId }));
  await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, items));
  return invoiceId;
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant("PT DP Lain");
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1);
  FO2 = await person(A, "fo_cashier", A.b2); FIN = await person(A, "finance"); AU = await person(A, "auditor"); CS = await person(A, "central_cs");
  AP = await person(A, "admin_pusat"); DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b2);
  BFO = await person(B, "fo_cashier", B.b1);
  svc = await service({ own: OWN, fh: FH }, "DP-KONS", { booking_dp_enabled: true, booking_dp_amount: 200_000 });
  nodp = await service({ own: OWN, fh: FH }, "NODP", {});
  await setupBranch(A, OWN, [DOC.staffId], [svc.itemId, nodp.itemId]);
  await setupBranch(A, OWN, [DOC2.staffId], [svc.itemId, nodp.itemId], A.b2); // a doctor's shifts may not overlap across branches
  await dpOn(OWN);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("Terima DP", () => {
  it("records a KW receipt, a payment with no invoice allocated to the deposit, and the event; replay returns it", async () => {
    const pt = await patient(A);
    const apt = await appointment(A, pt, quarter(48 * H), DOC);
    const k = key();
    const r = await as(FO, (db) => receiveDeposit(db, k, apt, { method: "cash", cashTendered: 250_000 }));
    expect([r.amount, r.change, r.replayed]).toEqual([200_000, 50_000, false]);
    expect(r.number).toMatch(/^KW-/);
    const d = await dep(r.deposit_id);
    expect([d.state, Number(d.amount), d.method, Number(d.vat_amount), d.cutoff_hours, d.appointment_id]).toEqual(["held", 200_000, "cash", 0, 24, apt]);
    const pay = (await h.admin.query(`select p.invoice_id, p.method, p.amount::int, a.booking_deposit_id, a.amount::int aa from payments p join payment_allocations a on a.payment_id = p.id where p.receipt_id = $1`, [r.receipt_id])).rows;
    expect(pay).toEqual([{ invoice_id: null, method: "cash", amount: 200_000, booking_deposit_id: r.deposit_id, aa: 200_000 }]);
    expect((await events(r.deposit_id)).map((e) => e.type)).toEqual(["BookingDepositReceived"]);
    const again = await as(FO, (db) => receiveDeposit(db, k, apt, { method: "cash", cashTendered: 250_000 }));
    expect([again.deposit_id, again.replayed]).toEqual([r.deposit_id, true]);
    // One DP per appointment; another key is refused.
    expect(await why(as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" })))).toBe("ERR_VERSION_CONFLICT:deposit_exists");
    // The struk reads DP booking and the patient's MRN; the auditor gets it masked.
    const rc = await as(FO, (db) => getReceipt(db, r.receipt_id));
    expect(rc.invoice_id).toBeNull();
    expect(rc.body).toMatch(/DP booking pasien RM-/);
    const ra = await as(AU, (db) => getReceipt(db, r.receipt_id));
    expect(ra.body).not.toMatch(/RM-\d/);
  });

  it("refused when SET-10 is off, the item has no DP, the method is off or not a deposit tender, or the appointment is not scheduled", async () => {
    const pt = await patient(A);
    const noDp = await appointment(A, pt, quarter(50 * H), DOC, nodp.versionId);
    expect(await why(as(FO, (db) => receiveDeposit(db, key(), noDp, { method: "cash", cashTendered: 200_000 })))).toBe("ERR_NOT_AVAILABLE:deposit_off");
    const apt = await appointment(A, pt, quarter(52 * H), DOC);
    await dpOn(OWN, false);
    try {
      expect(await why(as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 200_000 })))).toBe("ERR_NOT_AVAILABLE:deposit_off");
    } finally {
      await dpOn(OWN);
    }
    for (const bad of [{ method: "qris" }, { method: "balance" }, { method: "cash" }, { method: "edc", cashTendered: 1 }])
      expect(await code(as(FO, (db) => receiveDeposit(db, key(), apt, bad as never))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    expect(await why(as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 199_999 })))).toBe("ERR_INVALID_INPUT:cash_tendered");
    await as(OWN, (db) => changeSetting(db, { key: "SET-14", branchId: null, value: { metode: ["tunai", "transfer"], provider: "mock", link_jam: 24 }, reason: "Tanpa EDC" }));
    try {
      expect(await why(as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" })))).toBe("ERR_NOT_AVAILABLE:method_disabled");
    } finally {
      await as(OWN, (db) => changeSetting(db, { key: "SET-14", branchId: null, restore: true, reason: "Kembali" }));
    }
    await as(FO, (db) => cancelAppointment(db, key(), apt, "Pasien batal"));
    expect(await why(as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" })))).toBe("ERR_VERSION_CONFLICT:not_scheduled");
  });

  it("a held appointment is confirmed to booked by the DP; an expired hold is refused", async () => {
    const pt = await patient(A);
    const held = await appointment(A, pt, quarter(54 * H), DOC, svc.versionId, "held");
    await as(FO, (db) => receiveDeposit(db, key(), held, { method: "transfer", details: { bank: "BCA", reference: "TRF-1" } }));
    expect((await h.admin.query(`select state, hold_until from appointments where id = $1`, [held])).rows[0]).toEqual({ state: "booked", hold_until: null });
    const expired = await appointment(A, pt, quarter(56 * H), DOC, svc.versionId, "held");
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`update appointments set hold_until = now() - interval '1 minute' where id = $1`, [expired]);
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    expect(await why(as(FO, (db) => receiveDeposit(db, key(), expired, { method: "edc" })))).toBe("ERR_VERSION_CONFLICT:hold_expired");
  });

  it("roles, branches and tenants: doctor, auditor, central CS refused; another branch's FO and another tenant do not find it", async () => {
    const pt = await patient(A);
    const apt = await appointment(A, pt, quarter(58 * H), DOC);
    for (const p of [DOC, AU, CS, AP]) expect(await code(as(p, (db) => receiveDeposit(db, key(), apt, { method: "edc" }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO2, (db) => receiveDeposit(db, key(), apt, { method: "edc" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => receiveDeposit(db, key(), apt, { method: "edc" })))).toBe("ERR_NOT_FOUND");
    for (const p of [MGR, FIN, OWN]) {
      const a2 = await appointment(A, pt, quarter((60 + 2 * [MGR, FIN, OWN].indexOf(p)) * H), DOC);
      expect(await code(as(p, (db) => receiveDeposit(db, key(), a2, { method: "edc" }))), p.role).toBe("ok");
    }
    // RLS: another tenant reads none; a B2 FO does not read B1's deposits.
    const seen = async (p: P) => (await as(p, (db) => db.query(`select count(*)::int c from booking_deposits`))).rows[0].c as number;
    expect(await seen(BFO)).toBe(0);
    expect(await seen(FO2)).toBe(0);
    expect(await seen(FO)).toBeGreaterThan(0);
  });
});

describe("scenario PR-22 and PR-83, money scenario 6a–6d: patient and clinic changes", () => {
  it("PR-22: a DP of Rp200,000; the patient reschedules 10 h before → forfeited and recorded", async () => {
    const pt = await patient(A, "Pasien PR22");
    const apt = await appointment(A, pt, quarter(10 * H), DOC);
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 200_000 }));
    const moved = await as(FO, (db) => reschedule(db, key(), apt, quarter(72 * H), DOC.staffId));
    const d = await dep(deposit_id);
    expect([d.state, d.decision_code, d.decided_by]).toEqual(["forfeited", "patient_reschedule_after_cutoff", FO.staffId]);
    expect(await balance(pt)).toBe(0);
    expect((await events(deposit_id)).map((e) => e.type)).toEqual(["BookingDepositReceived", "BookingDepositForfeited"]);
    // The new appointment carries no DP.
    expect((await h.admin.query(`select count(*)::int c from booking_deposits where appointment_id = $1`, [moved.appointmentId])).rows[0].c).toBe(0);
  });

  it("6a: a patient change at least 24 h before (reschedule and cancel) moves the DP to balance (dp_transfer)", async () => {
    const pt = await patient(A, "Pasien 6a");
    for (const [i, act] of ["reschedule", "cancel"].entries()) {
      const apt = await appointment(A, pt, quarter((30 + i * 3) * H), DOC);
      const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
      if (act === "reschedule") await as(FO, (db) => reschedule(db, key(), apt, quarter(80 * H), DOC.staffId));
      else await as(FO, (db) => cancelAppointment(db, key(), apt, "Pasien ganti rencana"));
      const d = await dep(deposit_id);
      expect([d.state, d.decision_code], act).toEqual(["moved_to_balance", `patient_${act}_before_cutoff`]);
      expect((await events(deposit_id)).map((e) => e.type)).toEqual(["BookingDepositReceived", "BookingDepositMovedToBalance"]);
      const e = (await h.admin.query(`select kind, amount::int, source_kind, source_id from balance_entries where source_id = $1`, [deposit_id])).rows;
      expect(e).toEqual([{ kind: "dp_transfer", amount: 200_000, source_kind: "booking_deposit", source_id: deposit_id }]);
    }
    expect(await balance(pt)).toBe(400_000);
  });

  it("the cutoff boundary: exactly at starts_at − cutoff → balance; one second later → forfeited (6b)", async () => {
    const pt = await patient(A, "Pasien Batas");
    const ids: string[] = [];
    for (const off of [0, 1]) {
      const apt = await appointment(A, pt, quarter((90 + off * 2) * H), DOC);
      const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
      // Move the start so the cancel lands exactly at (off = 0) or one second after (off = 1) the cutoff.
      await h.admin.query(`alter table appointments disable trigger appointments_guard`);
      await h.admin.query(`update appointments set starts_at = clock_timestamp() + interval '24 hours' + interval '2 seconds' - make_interval(secs => $2), ends_at = starts_at + interval '30 minutes' where id = $1`, [apt, off * 4]);
      await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
      await as(FO, (db) => cancelAppointment(db, key(), apt, "Pasien batal"));
      ids.push(deposit_id);
    }
    expect([(await dep(ids[0])).state, (await dep(ids[1])).state]).toEqual(["moved_to_balance", "forfeited"]);
    expect((await dep(ids[1])).decision_code).toBe("patient_cancel_after_cutoff");
  });

  it("the cutoff is the snapshot at receipt: received with a 2 h cutoff, a cancel 10 h before moves the DP to balance after SET-10 returns to 24 h", async () => {
    const pt = await patient(A, "Pasien Snapshot");
    const apt = await appointment(A, pt, quarter(10 * H + 30 * 60_000), DOC);
    await dpOn(OWN, true, 2);
    let id: string;
    try {
      id = (await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }))).deposit_id;
    } finally {
      await dpOn(OWN);
    }
    expect((await dep(id)).cutoff_hours).toBe(2);
    await as(FO, (db) => cancelAppointment(db, key(), apt, "Pasien batal"));
    expect([(await dep(id)).state, await balance(pt)]).toEqual(["moved_to_balance", 200_000]);
  });

  it("PR-83 / 6c: a no-show with a DP is forfeited; the cutoff hours are the snapshot at receipt", async () => {
    const pt = await patient(A, "Pasien Tidak Datang");
    const apt = await appointment(A, pt, quarter(12 * H), DOC);
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
    // SET-10 changes after receipt do not change this deposit's cutoff.
    await dpOn(OWN, true, 2);
    try {
      expect((await dep(deposit_id)).cutoff_hours).toBe(24);
    } finally {
      await dpOn(OWN);
    }
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`update appointments set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes' where id = $1`, [apt]);
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    await as(FO, (db) => markNoShow(db, key(), apt));
    const d = await dep(deposit_id);
    expect([d.state, d.decision_code]).toEqual(["forfeited", "no_show"]);
    expect((await events(deposit_id)).map((e) => e.type)).toEqual(["BookingDepositReceived", "BookingDepositForfeited"]);
  });

  it("6d: a clinic cancellation moves the DP to balance at any time; central CS and admin pusat may do it", async () => {
    for (const p of [MGR, CS, AP]) {
      const pt = await patient(A, `Pasien Klinik ${p.role}`);
      const apt = await appointment(A, pt, quarter(2 * H + [MGR, CS, AP].indexOf(p) * H), DOC);
      const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
      await as(p, (db) => cancelAppointmentByClinic(db, key(), apt, "Dokter berhalangan"));
      const d = await dep(deposit_id);
      expect([d.state, d.decision_code, d.decided_as], p.role).toEqual(["moved_to_balance", "clinic_cancel", p.role]);
      expect(await balance(pt)).toBe(200_000);
      expect((await h.admin.query(`select state from appointments where id = $1`, [apt])).rows[0].state).toBe("cancelled");
    }
    // A decided deposit is not decided again: a second cancel finds the appointment cancelled.
    const done = (await h.admin.query(`select appointment_id from booking_deposits where decision_code = 'clinic_cancel' limit 1`)).rows[0].appointment_id as string;
    expect(await code(as(FO, (db) => cancelAppointmentByClinic(db, key(), done, "Lagi")))).toBe("ERR_VERSION_CONFLICT");
  });
});

describe("6e: applied on arrival", () => {
  it("the visit invoice receives the DP on the booked item's line automatically; the remainder is paid as usual", async () => {
    const pt = await patient(A, "Pasien Datang");
    const apt = await appointment(A, pt, soon(0), DOC);
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 200_000 }));
    const v = await arrive(apt, FO);
    const inv = await bill(FO, v, [{ itemId: svc.itemId, quantity: 1 }]);
    const d = await dep(deposit_id);
    const line = (await h.admin.query(`select id, line_total::int from invoice_lines where invoice_id = $1`, [inv])).rows[0];
    expect([d.state, d.applied_line_id, d.decision_code]).toEqual(["applied", line.id, "applied_on_arrival"]);
    expect((await events(deposit_id)).map((e) => e.type)).toEqual(["BookingDepositReceived", "BookingDepositApplied"]);
    // A void after apply and before any payment is refused: the line is paid by the DP.
    expect(await why(as(MGR, (db) => requestVoid(db, key(), inv, "Salah input")))).toBe("ERR_VERSION_CONFLICT:invoice_paid");
    // Paying more than the remainder is refused (the deposit counts as paid).
    expect(await code(as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount: 300_001, cashTendered: 300_001 }])))).toBe("ERR_INVALID_INPUT");
    const r = await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount: 300_000, cashTendered: 300_000 }]));
    expect(r.outstanding).toBe(0);
    expect(await balance(pt)).toBe(0);
    // The explicit apply replays.
    expect(await as(FO, (db) => applyDeposit(db, key(), inv))).toEqual({ deposit_id, invoice_line_id: line.id, replayed: true });
  });

  it("a line whose room is below the DP (discounted below it) is not applied at issue; the explicit apply refuses; another line item is never used", async () => {
    const pt = await patient(A, "Pasien Diskon");
    const apt = await appointment(A, pt, soon(1), DOC);
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
    const v = await arrive(apt, FO);
    const inv = await bill(FO, v, [{ itemId: svc.itemId, quantity: 1, discount: 350_000 }, { itemId: nodp.itemId, quantity: 1 }]);
    expect((await dep(deposit_id)).state).toBe("held");
    expect(await why(as(FO, (db) => applyDeposit(db, key(), inv)))).toBe("ERR_VERSION_CONFLICT:no_line_for_deposit");
  });

  it("the explicit apply: roles and branches", async () => {
    const pt = await patient(A, "Pasien Pakai DP");
    const apt = await appointment(A, pt, soon(2), DOC);
    await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
    const v = await arrive(apt, FO);
    // Issued as a counter-free visit invoice while the deposit is applied later: hold the deposit by issuing before the receipt is impossible,
    // so issue with only the other item first, then a second ordinary invoice is refused; apply is checked on roles here.
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { visitId: v, patientId: pt }));
    for (const p of [DOC, AU, CS]) expect(await code(as(p, (db) => applyDeposit(db, key(), invoiceId))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO2, (db) => applyDeposit(db, key(), invoiceId)))).toBe("ERR_NOT_FOUND");
    expect(await why(as(FO, (db) => applyDeposit(db, key(), invoiceId)))).toBe("ERR_VERSION_CONFLICT:deposit_not_applicable");
  });
});

describe("scenario 17: a clinic-caused cancellation refunded in cash", () => {
  it("cancels the appointment and records the refund on the deposit; no balance; FO, manager, owner only", async () => {
    const pt = await patient(A, "Pasien Refund");
    const apt = await appointment(A, pt, quarter(5 * H), DOC);
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 200_000 }));
    for (const p of [DOC, FIN, AU, CS]) expect(await code(as(p, (db) => refundDepositForClinic(db, key(), deposit_id, { method: "cash", reason: "Dokter sakit" }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO2, (db) => refundDepositForClinic(db, key(), deposit_id, { method: "cash", reason: "Dokter sakit" })))).toBe("ERR_NOT_FOUND");
    const k = key();
    expect(await as(FO, (db) => refundDepositForClinic(db, k, deposit_id, { method: "cash", reason: "Dokter sakit" }))).toEqual({ deposit_id, state: "refunded", replayed: false });
    const d = await dep(deposit_id);
    expect([d.state, d.refund_method, d.decision_code]).toEqual(["refunded", "cash", "clinic_refund"]);
    expect((await h.admin.query(`select state from appointments where id = $1`, [apt])).rows[0].state).toBe("cancelled");
    expect(await balance(pt)).toBe(0);
    expect((await events(deposit_id)).map((e) => e.type)).toEqual(["BookingDepositReceived", "BookingDepositRefunded"]);
    expect((await as(FO, (db) => refundDepositForClinic(db, k, deposit_id, { method: "cash", reason: "Dokter sakit" }))).replayed).toBe(true);
    // A transfer refund names its reference; details on cash are refused.
    const apt2 = await appointment(A, pt, quarter(6 * H), DOC);
    const d2 = await as(FO, (db) => receiveDeposit(db, key(), apt2, { method: "edc" }));
    expect(await code(as(FO, (db) => refundDepositForClinic(db, key(), d2.deposit_id, { method: "cash", reason: "Klinik tutup", details: { bank: "BCA" } })))).toBe("ERR_INVALID_INPUT");
    await as(MGR, (db) => refundDepositForClinic(db, key(), d2.deposit_id, { method: "transfer", reason: "Klinik tutup", details: { bank: "BCA", reference: "RF-1" } }));
    expect((await dep(d2.deposit_id)).refund_details).toEqual({ bank: "BCA", reference: "RF-1" });
  });
});

describe("the PKP gross variants (6 and 17): VAT reversed on a move or refund, counted once when the balance pays later", () => {
  let C: T; let COWN: P; let CFO: P; let CFH: P; let CFIN: P; let CDOC: P;
  let tx: { itemId: string; versionId: string };
  beforeAll(async () => {
    C = await tenant("PT DP PKP");
    COWN = await person(C, "owner"); CFO = await person(C, "fo_cashier", C.b1); CFH = await person(C, "facility_head", C.b1); CFIN = await person(C, "finance");
    CDOC = await person(C, "doctor", C.b1);
    tx = await service({ own: COWN, fh: CFH }, "DP-PKP", { tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 1_665_000, booking_dp_enabled: true, booking_dp_amount: 222_000 });
    await setupBranch(C, COWN, [CDOC.staffId], [tx.itemId]);
    await dpOn(COWN);
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak dp\n%%EOF\n`);
    const { fileId } = await as(CFIN, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const it = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(COWN, (db) => decideEvidence(db, it, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(COWN, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrowWib(), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 1 where id = $1`, [C.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
  }, 300_000);

  it("6 PKP: a DP of 222,000 = base 200,000 + VAT 22,000; moved to balance gross with the VAT reversed; the balance later pays the taxable line: VAT once", async () => {
    const pt = await patient(C, "Pasien PKP");
    const apt = await appointment(C, pt, quarter(40 * H), CDOC, tx.versionId);
    const { deposit_id } = await as(CFO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
    let d = await dep(deposit_id);
    expect([Number(d.vat_base), Number(d.vat_amount), Number(d.vat_recognised_amount), d.is_pkp_at_receipt]).toEqual([200_000, 22_000, 22_000, true]);
    expect((await h.admin.query(`select vat_portion::int from payment_allocations where booking_deposit_id = $1`, [deposit_id])).rows[0].vat_portion).toBe(22_000);
    await as(CFO, (db) => cancelAppointment(db, key(), apt, "Pasien ganti jadwal"));
    d = await dep(deposit_id);
    expect([d.state, Number(d.vat_recognised_amount)]).toEqual(["moved_to_balance", 0]);
    expect(await balance(pt)).toBe(222_000);
    // The balance pays a walk-in taxable line later: that payment recognises its VAT; across the facts VAT is 22,000 once.
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [C.tenantId, C.b1, pt, CFO.staffId])).rows[0].id;
    const inv = await bill(CFO, v, [{ itemId: tx.itemId, quantity: 1, discount: 1_443_000 }]);
    await as(CFO, (db) => receivePayment(db, key(), inv, [{ method: "balance", amount: 222_000 }]));
    const line = (await h.admin.query(`select vat_amount::int, vat_recognised_amount::int from invoice_lines where invoice_id = $1`, [inv])).rows[0];
    expect(line).toEqual({ vat_amount: 22_000, vat_recognised_amount: 22_000 });
    const depVat = Number((await dep(deposit_id)).vat_recognised_amount);
    expect(depVat + line.vat_recognised_amount).toBe(22_000);
  });

  it("6e PKP: applied on arrival, the deposit's 22,000 VAT moves to the line; the remainder's payment recognises only the rest (165,000 once)", async () => {
    const pt = await patient(C, "Pasien PKP Datang");
    const apt = await appointment(C, pt, soon(0), CDOC, tx.versionId);
    const { deposit_id } = await as(CFO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
    const v = await arrive(apt, CFO);
    const inv = await bill(CFO, v, [{ itemId: tx.itemId, quantity: 1 }]);
    let line = (await h.admin.query(`select line_total::int, vat_amount::int, vat_recognised_amount::int from invoice_lines where invoice_id = $1`, [inv])).rows[0];
    expect(line).toEqual({ line_total: 1_665_000, vat_amount: 165_000, vat_recognised_amount: 22_000 });
    expect(Number((await dep(deposit_id)).vat_recognised_amount)).toBe(0);
    await as(CFO, (db) => receivePayment(db, key(), inv, [{ method: "edc", amount: 1_443_000 }]));
    line = (await h.admin.query(`select line_total::int, vat_amount::int, vat_recognised_amount::int from invoice_lines where invoice_id = $1`, [inv])).rows[0];
    expect(line.vat_recognised_amount).toBe(165_000);
  });

  it("17 PKP: refunded gross, VAT reversed, net 0", async () => {
    const pt = await patient(C, "Pasien PKP Refund");
    const apt = await appointment(C, pt, quarter(3 * H), CDOC, tx.versionId);
    const { deposit_id } = await as(CFO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 222_000 }));
    await as(CFO, (db) => refundDepositForClinic(db, key(), deposit_id, { method: "cash", reason: "Klinik tutup" }));
    const d = await dep(deposit_id);
    expect([d.state, Number(d.amount), Number(d.vat_recognised_amount)]).toEqual(["refunded", 222_000, 0]);
    expect(await balance(pt)).toBe(0);
  });
});

describe("the guard", () => {
  it("a deposit is decided once and never deleted; the allocation and payment guards refuse a stray deposit payment", async () => {
    const pt = await patient(A, "Pasien Guard");
    const apt = await appointment(A, pt, quarter(70 * H), DOC);
    const { deposit_id, receipt_id } = await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "edc" }));
    const raw = (x: Promise<unknown>) => x.then(() => "ok", (e) => e.message as string);
    expect(await raw(h.admin.query(`delete from booking_deposits where id = $1`, [deposit_id]))).toBe("booking deposits are never deleted");
    expect(await raw(h.admin.query(`update booking_deposits set amount = 1 where id = $1`, [deposit_id]))).toBe("a deposit is decided once");
    await as(FO, (db) => cancelAppointmentByClinic(db, key(), apt, "Klinik tutup"));
    expect(await raw(h.admin.query(`update booking_deposits set state = 'forfeited', decision_code = 'x_y_z' where id = $1`, [deposit_id]))).toBe("a deposit is decided once");
    const pay = (await h.admin.query(`select * from payments where receipt_id = $1`, [receipt_id])).rows[0];
    expect(await raw(h.admin.query(
      `insert into payment_allocations (tenant_id, branch_id, payment_id, booking_deposit_id, amount, vat_portion, method, environment, is_simulated)
       values ($1, $2, $3, $4, 200000, 0, 'edc', 'production', false)`, [A.tenantId, A.b1, pay.id, deposit_id]))).toBe("a deposit allocation names its deposit");
  });
});
