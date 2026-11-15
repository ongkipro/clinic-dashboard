// T-093 Done-when: Scenario PR-30 (a free control dated two days away → a follow-up task for the guiding BC) and the PR-83 no-shows (with a
// DP, forfeited, and without a DP, no money moves) → a follow-up task for CS. Plus the plan (r1, r2): one task per rule × source × step for
// ever (closed tasks are never re-created), every date rule true and false (package stage DEC-105, package expiry SET-23 with the earlier step
// replaced, locked instalments, receivables with and without a schedule, unselected plan items SET-22, dormant SET-22), the writer (done,
// dismiss, snooze, assign) and its refusals, readers and masking per role, tenants, the guard, events with ids and codes only, the unbound
// scan. Source rows that the real flows make slowly are inserted by the admin connection with their guards paused (as other suites do).
// Synthetic data (MIG-2); no network (DEC-082).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { receiveDeposit } from "../../src/modules/cashier/deposits/deposits";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { scheduleControl } from "../../src/modules/cashier/consultation/consultation";
import { publish } from "../../src/modules/catalog/catalog";
import { followupGet, followupList, updateFollowup } from "../../src/modules/crm/followups/followups";
import { runFollowupScan } from "../../src/modules/crm/followups/scan";
import { saveItem } from "../../src/modules/inventory/stock";
import { setHours, setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText } from "../../src/modules/patients/consents/consents";
import { markNoShow } from "../../src/modules/scheduling/appointments/appointments";
import { setWeek } from "../../src/modules/scheduling/rosters/rosters";
import { changeSetting } from "../../src/modules/settings/settings";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { wibDay } from "../support/dates";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];
const day = wibDay;

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("FU1", "Kemang"), b2: await br("FU2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`fu${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf FU ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
// An admin write with a table's guard paused (fixture rows the real flows make slowly).
async function paused<R>(tables: string[], fn: () => Promise<R>) {
  for (const t of tables) await h.admin.query(`alter table ${t} disable trigger ${t}_guard`);
  try {
    return await fn();
  } finally {
    for (const t of tables) await h.admin.query(`alter table ${t} enable always trigger ${t}_guard`);
  }
}
async function patient(t: T, name: string, by: P) {
  return (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`, [t.tenantId, name, t.b1, by.staffId])).rows[0].id as string;
}
const fu = async (rule: string, source: string) => (await h.admin.query(`select * from followups where rule_code = $1 and source_id = $2 order by step`, [rule, source])).rows;
const scan = (today: string) => runFollowupScan(worker, today);

let A: T; let B: T;
let OWN: P; let FH: P; let CS: P; let BC: P; let BC2: P; let BCB2: P; let MGR: P; let MGR2: P; let FO: P; let DOC: P; let FIN: P; let MKT: P; let AU: P; let PH: P;
let BOWN: P; let BCS: P;
let ctlFacial: string; let serum: string; let dpSvc: { itemId: string; versionId: string };

async function service(code: string, f: Record<string, unknown>) {
  const v = await as(OWN, (db) => publish(db, { kind: "service", code }, {
    name: `Layanan ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "facial", prep_min: 0, treatment_min: 30,
    buffer_min: 0, indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }], ...f,
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  return { itemId: v.itemId, versionId: v.versionId };
}
// A booked appointment at Kemang (admin; staff and room reserved as markNoShow releases them).
async function appointment(pt: string, start: Date, versionId: string) {
  const e = new Date(start.getTime() + 30 * 60_000);
  const room = (await h.admin.query(`select id from rooms where tenant_id = $1 and branch_id = $2 limit 1`, [A.tenantId, A.b1])).rows[0].id as string;
  await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
  try {
    return await paused(["appointments"], async () => {
      const id = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state,
          channel, created_by, created_as) values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
        [A.tenantId, A.b1, pt, versionId, DOC.staffId, start, e])).rows[0].id as string;
      for (const [k, r] of [["staff", DOC.staffId], ["room", room]])
        await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $7)`,
          [A.tenantId, A.b1, id, k, r, start, e]);
      return id;
    });
  } finally {
    await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
  }
}
// A paid visit invoice for one item (the control's source line).
async function paidLine(pt: string, item: string, price: number) {
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pt, FO.staffId])).rows[0].id as string;
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pt, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
  await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: price, cashTendered: price }]));
  await h.admin.query(`update visits set closed_at = now(), closed_by = $2 where id = $1`, [v, FO.staffId]).catch(() => undefined);
  const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1 order by created_at limit 1`, [invoiceId])).rows[0].id as string;
  return { visit: v, invoiceId, line };
}
// A closed visit, its examination and a care plan with one item for `item` (created `daysAgo`).
async function planFor(pt: string, item: string, daysAgo: number) {
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4,
      now() - make_interval(days => $5)) returning id`, [A.tenantId, A.b1, pt, FO.staffId, daysAgo])).rows[0].id as string;
  const exam = await paused(["examinations"], async () => (await h.admin.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id)
      values ($1, $2, $3, $4, $5) returning id`, [A.tenantId, A.b1, v, pt, DOC.staffId])).rows[0].id as string);
  const plan = await paused(["care_plans"], async () => (await h.admin.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id,
      created_by, created_at) values ($1, $2, $3, 'Rencana rahasia', 'Kondisi rahasia', $4, $5, now() - make_interval(days => $6)) returning id`,
    [A.tenantId, A.b1, pt, exam, DOC.staffId, daysAgo])).rows[0].id as string);
  const pi = await paused(["plan_items"], async () => (await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty)
      select $1, $2, $3, $4, 1, cv.id, 1 from catalog_versions cv where cv.tenant_id = $1 and cv.item_id = $5 order by cv.created_at desc limit 1 returning id`,
    [A.tenantId, A.b1, plan, exam, item])).rows[0].id as string);
  await h.admin.query(`update visits set closed_at = now() - make_interval(days => $3), closed_by = $2 where id = $1`, [v, FO.staffId, daysAgo]);
  return { visit: v, exam, plan, planItem: pi };
}
// The patient's guiding BC through the invoice attribution (the second source of followup_guiding_bc).
async function attribute(invoiceId: string, bc: P) {
  // an attribution's content is frozen: end the active one (superseded) and add ours
  await paused(["commission_sale_attributions"], () => h.admin.query(`update commission_sale_attributions set state = 'superseded', ended_at = now()
      where invoice_id = $1 and state = 'active'`, [invoiceId]));
  await paused(["commission_sale_attributions"], () => h.admin.query(`insert into commission_sale_attributions (tenant_id, branch_id, invoice_id, guiding_bc_staff_id, state,
      source, attributed_by, attributed_as) values ($1, $2, $3, $4, 'active', 'command', $5, 'manager')`, [A.tenantId, A.b1, invoiceId, bc.staffId, MGR.staffId]));
}

beforeAll(async () => {
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Tindak Lanjut Sintetis");
  B = await tenant("PT Klinik Lain Tindak Lanjut");
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); CS = await person(A, "central_cs"); BC = await person(A, "bc", A.b1);
  BC2 = await person(A, "bc", A.b1); BCB2 = await person(A, "bc", A.b2); MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2);
  FO = await person(A, "fo_cashier", A.b1); DOC = await person(A, "doctor", A.b1); FIN = await person(A, "finance"); MKT = await person(A, "marketing");
  AU = await person(A, "auditor"); PH = await person(A, "pharmacist", A.b1);
  BOWN = await person(B, "owner"); BCS = await person(B, "central_cs");
  ctlFacial = (await service("FU-CTL", { control_count: 1, control_validity_days: 14 })).itemId;
  dpSvc = await service("FU-DP", { category: "consultation", resources: [{ kind: "room", code: "consultation" }], booking_dp_enabled: true, booking_dp_amount: 200_000 });
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "FU-SRM" }, { name: "Serum", tax_category: "non_object", tax_basis: "Barang", normal_price: 250_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  // Kemang: opening hours, a consultation room, the DP service, the doctor rostered (markNoShow releases the reservations)
  await as(OWN, (db) => setHours(db, A.b1, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "23:45" }))));
  await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul FU", kind: "consultation" }));
  await as(OWN, (db) => setServices(db, A.b1, [dpSvc.itemId, ctlFacial]));
  const mon = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  for (const week of [...new Set([0, 7].map((d) => mon(day(d))))]) {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${week}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); }).filter((d) => d >= day(0));
    if (days.length) await as(OWN, (db) => setWeek(db, A.b1, week, [DOC.staffId], days.map((d) => ({ staffId: DOC.staffId, date: d, starts: "00:00", ends: "23:45", kind: "work" as const }))));
  }
  await as(OWN, (db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: true, batas_ubah: 24 }, reason: "Uji DP tindak lanjut" }));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("T-093 Scenario PR-30 (control due)", () => {
  it("a free control two days away creates one task for the guiding BC; three days away none; a closed task is not re-created", async () => {
    const pt = await patient(A, "Pasien Kontrol Sintetis", FO);
    const src = await paidLine(pt, ctlFacial, 300_000);
    await attribute(src.invoiceId, BC);
    const ctl = await as(DOC, (db) => scheduleControl(db, key(), src.line, day(5)));
    expect(await scan(day(2))).toBe(0); // three days before the control: nothing yet
    expect(await fu("control_due", ctl.control_id)).toEqual([]);
    expect(await scan(day(3))).toBeGreaterThanOrEqual(1); // two days before
    const [f] = await fu("control_due", ctl.control_id);
    expect(f).toMatchObject({ role_queue: "bc", assignee_staff_id: BC.staffId, state: "open", step: "due", patient_id: pt, branch_id: A.b1 });
    expect(new Date(f.due_on).toISOString().slice(0, 10) <= day(3)).toBe(true);
    // the BC sees it, closes it; the next days' scans never re-create it
    const mine = await as(BC, (db) => followupList(db, "open", "mine"));
    expect(mine.followups.map((x) => x.id)).toContain(f.id);
    expect((await as(BC, (db) => updateFollowup(db, key(), f.id, { action: "done", outcome: "jadwal_dibuat" }))).state).toBe("done");
    await scan(day(4));
    await scan(day(5));
    expect((await fu("control_due", ctl.control_id)).map((x) => x.state)).toEqual(["done"]);
    // events carry ids and codes only
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_kind = 'followup' and aggregate_id = $1 order by occurred_at`, [f.id])).rows;
    expect(ev.map((e) => e.type)).toEqual(["FollowUpCreated", "FollowUpClosed"]);
    expect(ev[0].payload).toEqual({ followup_id: f.id, patient_id: pt, rule_code: "control_due", source_kind: "consultation_control", source_id: ctl.control_id,
      role_queue: "bc" });
    expect(JSON.stringify(ev)).not.toMatch(/Pasien Kontrol|Layanan FU-CTL|Facial/);
  });

  it("a guiding BC who is not a BC at the control's branch is not assigned: the task waits in the BC queue", async () => {
    const pt = await patient(A, "Pasien Kontrol BC Cabang Lain", FO);
    const src = await paidLine(pt, ctlFacial, 300_000);
    await attribute(src.invoiceId, BCB2);
    const ctl = await as(DOC, (db) => scheduleControl(db, key(), src.line, day(4)));
    await scan(day(2));
    expect((await fu("control_due", ctl.control_id))[0]).toMatchObject({ role_queue: "bc", assignee_staff_id: null });
  });

  it("no guiding BC: the task waits unassigned in the BC queue; a used control has none", async () => {
    const pt = await patient(A, "Pasien Kontrol Tanpa BC", FO);
    const src = await paidLine(pt, ctlFacial, 300_000);
    const ctl = await as(DOC, (db) => scheduleControl(db, key(), src.line, day(4)));
    await scan(day(2));
    expect((await fu("control_due", ctl.control_id))[0]).toMatchObject({ role_queue: "bc", assignee_staff_id: null });
    const pt2 = await patient(A, "Pasien Kontrol Terpakai", FO);
    const src2 = await paidLine(pt2, ctlFacial, 300_000);
    const ctl2 = await as(DOC, (db) => scheduleControl(db, key(), src2.line, day(4)));
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pt2, FO.staffId])).rows[0].id as string;
    await paused(["consultation_controls"], () => h.admin.query(`update consultation_controls set state = 'used', used_visit_id = $2, used_at = now() where id = $1`, [ctl2.control_id, v]));
    await scan(day(2));
    expect(await fu("control_due", ctl2.control_id)).toEqual([]);
  });
});

describe("T-093 PR-83 no-shows → a CS task", () => {
  it("with a DP (forfeited) and without a DP (no money moves): one CS task each, never twice", async () => {
    const past = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 900_000) * 900_000);
    const ptDp = await patient(A, "Pasien Tidak Datang DP", FO);
    const aDp = await appointment(ptDp, new Date(Date.now() + 48 * 3_600_000), dpSvc.versionId);
    const { deposit_id } = await as(FO, (db) => receiveDeposit(db, key(), aDp, { method: "edc" }));
    await paused(["appointments"], () => h.admin.query(`update appointments set starts_at = $2, ends_at = $3 where id = $1`, [aDp, past, new Date(past.getTime() + 1_800_000)]));
    await as(FO, (db) => markNoShow(db, key(), aDp));
    expect((await h.admin.query(`select state from booking_deposits where id = $1`, [deposit_id])).rows[0].state).toBe("forfeited");
    const ptNo = await patient(A, "Pasien Tidak Datang Tanpa DP", FO);
    const aNo = await appointment(ptNo, past, dpSvc.versionId);
    await as(FO, (db) => markNoShow(db, key(), aNo));
    expect(Number((await h.admin.query(`select count(*) from booking_deposits where appointment_id = $1`, [aNo])).rows[0].count)).toBe(0);
    for (const [apt, pt] of [[aDp, ptDp], [aNo, ptNo]]) {
      const rows = await fu("no_show", apt);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ role_queue: "cs", assignee_staff_id: null, step: "no_show", patient_id: pt, state: "open", branch_id: A.b1 });
      const dd = (await h.admin.query(`select due_on::text d, original_due_on::text o from followups where id = $1`, [rows[0].id])).rows[0];
      expect(dd).toEqual({ d: day(0), o: day(0) });
    }
    const cs = await as(CS, (db) => followupList(db, "open", "all", "no_show"));
    expect(cs.followups.map((x) => x.source_id)).toEqual(expect.arrayContaining([aDp, aNo]));
    // not a BC's task
    expect((await as(BC, (db) => followupList(db, "all", "all", "no_show"))).followups).toEqual([]);
    expect(await scan(day(0))).toBeGreaterThanOrEqual(0);
    expect(await fu("no_show", aDp)).toHaveLength(1);
  });
});

describe("T-093 the other date rules", () => {
  it("package stage (DEC-105: 30 days after the last redemption) and package expiry (SET-23, the smallest step, the earlier one replaced)", async () => {
    const pt = await patient(A, "Pasien Paket Sintetis", FO);
    const src = await paidLine(pt, serum, 250_000);
    const pk = await paused(["packages"], async () => (await h.admin.query(`insert into packages (tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id,
        catalog_version_id, price, min_dp, validity_end, created_by, created_as) select $1, $2, $3, $4, $5, l.item_id, l.catalog_version_id, 900000, 100000,
        now() + interval '20 days', $6, 'fo_cashier' from invoice_lines l where l.id = $5 returning id`, [A.tenantId, A.b1, pt, src.invoiceId, src.line, FO.staffId])).rows[0].id as string);
    const ch = await planFor(pt, ctlFacial, 31);
    const exe = await paused(["treatment_executions"], async () => (await h.admin.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id,
        performer_staff_id, identity_confirmed, state, started_by, started_as, start_command_key, started_at, finished_at, finished_by, finished_as, finish_command_key, outcome)
        values ($1, $2, $3, $4, $5, true, 'finished', $5, 'doctor', $6, now() - interval '31 days', now() - interval '31 days', $5, 'doctor', $7, 'completed') returning id`,
      [A.tenantId, A.b1, ch.visit, ch.planItem, DOC.staffId, `k-${key()}`, `k-${key()}`])).rows[0].id as string);
    await paused(["package_sessions"], async () => {
      for (const [seq, state] of [[1, "redeemed"], [2, "available"]] as const)
        await h.admin.query(`insert into package_sessions (tenant_id, package_id, seq, service_item_id, allocated_value, tax_category, tax_basis, vat_base, vat_amount, state,
            redeemed_branch_id, redeemed_at, beneficiary_patient_id, reserved_execution_id) values ($1, $2, $3, $4, 450000, 'exempt_medical', 'Jasa medis', 450000, 0, $5, $6, $7, $8, $9)`,
          [A.tenantId, pk, seq, ctlFacial, state, state === "redeemed" ? A.b1 : null, state === "redeemed" ? new Date(Date.now() - 31 * 86_400_000) : null,
            state === "redeemed" ? pt : null, state === "redeemed" ? exe : null]);
    });
    await scan(day(0));
    const stage = await fu("package_stage", pk);
    expect(stage.map((x) => [x.step, x.role_queue, x.state])).toEqual([["stage_2", "bc", "open"]]);
    // expiry: 20 days left → the 30-day step; 10 days → the 14-day step replaces it; 5 days → the 7-day step
    expect((await fu("package_expiry", pk)).map((x) => [x.step, x.state])).toEqual([["d30", "open"]]);
    await scan(day(6));
    expect((await fu("package_expiry", pk)).map((x) => [x.step, x.state, x.outcome])).toEqual([["d14", "open", null], ["d30", "dismissed", "diganti"]]);
    await scan(day(13));
    expect((await fu("package_expiry", pk)).map((x) => [x.step, x.state])).toEqual([["d14", "dismissed"], ["d30", "dismissed"], ["d7", "open"]]);
    // past the package's end the scan adds no expiry step and leaves the open one
    expect(await scan(day(25))).toBeGreaterThanOrEqual(0);
    expect((await fu("package_expiry", pk)).filter((x) => x.state === "open").map((x) => x.step)).toEqual(["d7"]);
  });

  // A package (validity `days`) with sessions in the given states; a redeemed or reserved session carries its execution / visit and beneficiary.
  async function packageWith(name: string, days: number, states: ("redeemed" | "reserved" | "available")[]) {
    const pt = await patient(A, name, FO);
    const src = await paidLine(pt, serum, 250_000);
    const pk = await paused(["packages"], async () => (await h.admin.query(`insert into packages (tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id,
        catalog_version_id, price, min_dp, validity_end, created_by, created_as) select $1, $2, $3, $4, $5, l.item_id, l.catalog_version_id, 900000, 100000,
        now() + make_interval(days => $7), $6, 'fo_cashier' from invoice_lines l where l.id = $5 returning id`,
      [A.tenantId, A.b1, pt, src.invoiceId, src.line, FO.staffId, days])).rows[0].id as string);
    const ch = await planFor(pt, ctlFacial, 31);
    const exe = await paused(["treatment_executions"], async () => (await h.admin.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id,
        performer_staff_id, identity_confirmed, state, started_by, started_as, start_command_key, started_at, finished_at, finished_by, finished_as, finish_command_key, outcome)
        values ($1, $2, $3, $4, $5, true, 'finished', $5, 'doctor', $6, now() - interval '31 days', now() - interval '31 days', $5, 'doctor', $7, 'completed') returning id`,
      [A.tenantId, A.b1, ch.visit, ch.planItem, DOC.staffId, `k-${key()}`, `k-${key()}`])).rows[0].id as string);
    await paused(["package_sessions"], async () => {
      for (const [i, st] of states.entries())
        await h.admin.query(`insert into package_sessions (tenant_id, package_id, seq, service_item_id, allocated_value, tax_category, tax_basis, vat_base, vat_amount, state,
            redeemed_branch_id, redeemed_at, beneficiary_patient_id, reserved_execution_id, reserved_visit_id)
            values ($1, $2, $3, $4, 300000, 'exempt_medical', 'Jasa medis', 300000, 0, $5, $6, $7, $8, $9, $10)`,
          [A.tenantId, pk, i + 1, ctlFacial, st, st === "redeemed" ? A.b1 : null, st === "redeemed" ? new Date(Date.now() - 31 * 86_400_000) : null,
            st === "available" ? null : pt, st === "redeemed" ? exe : null, st === "reserved" ? ch.visit : null]);
    });
    return { pt, pk, invoiceLine: src.line };
  }

  it("package stage waits while a session is reserved; a locked instalment (an overdue package row not covered) → CS, a future row none", async () => {
    // redeemed 31 days ago, the next session reserved: no stage task (the patient is already booked for it)
    const r = await packageWith("Pasien Paket Dipesan", 200, ["redeemed", "reserved", "available"]);
    await scan(day(0));
    expect(await fu("package_stage", r.pk)).toEqual([]);
    // a package paid 250,000 with a schedule: row 1 (300,000 cumulative) overdue → one CS task; row 2 due later → none
    const q = await packageWith("Pasien Cicilan Paket", 200, ["available", "available"]);
    const rows = await paused(["instalment_schedules", "instalment_rows"], async () => {
      const sid = (await h.admin.query(`insert into instalment_schedules (tenant_id, branch_id, patient_id, package_id, version, base_paid, command_key, created_by, created_as)
          values ($1, $2, $3, $4, 1, 0, $5, $6, 'fo_cashier') returning id`, [A.tenantId, A.b1, q.pt, q.pk, `k-${key()}`, FO.staffId])).rows[0].id as string;
      const ids: string[] = [];
      for (const [seq, due] of [[1, day(-2)], [2, day(20)]] as const)
        ids.push((await h.admin.query(`insert into instalment_rows (tenant_id, branch_id, schedule_id, seq, due_on, amount) values ($1, $2, $3, $4, $5, 300000) returning id`,
          [A.tenantId, A.b1, sid, seq, due])).rows[0].id as string);
      return ids;
    });
    await scan(day(0));
    const [lk] = await fu("instalment_locked", rows[0]);
    expect(lk).toMatchObject({ role_queue: "cs", step: "overdue", patient_id: q.pt, assignee_staff_id: null, state: "open" });
    expect(await fu("instalment_locked", rows[1])).toEqual([]);
    // finance reads it; a BC does not
    expect((await as(FIN, (db) => followupList(db, "all", "all", "instalment_locked"))).followups.map((x) => x.source_id)).toContain(rows[0]);
    expect((await as(BC, (db) => followupList(db, "all", "all", "instalment_locked"))).followups).toEqual([]);
  });

  it("receivables: one 'open' step without a schedule; per overdue row with one; unselected plan items after 60 days; dormant after 90", async () => {
    const pt = await patient(A, "Pasien Piutang Sintetis", FO);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pt, FO.staffId])).rows[0].id as string;
    const rc = await paused(["receivables"], async () => (await h.admin.query(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by,
        created_as) values ($1, $2, $3, $4, 500000, $5, $6, 'fo_cashier') returning id`, [A.tenantId, A.b1, pt, v, `k-${key()}`, FO.staffId])).rows[0].id as string);
    await scan(day(0));
    expect((await fu("receivable", rc)).map((x) => [x.step, x.role_queue])).toEqual([["open", "cs"]]);
    // finance reads receivable tasks; a BC does not
    expect((await as(FIN, (db) => followupList(db, "all", "all", "receivable"))).followups.map((x) => x.source_id)).toContain(rc);
    expect((await as(BC, (db) => followupList(db, "all", "all", "receivable"))).followups).toEqual([]);
    const finAll = (await as(FIN, (db) => followupList(db, "all", "all"))).followups;
    expect(finAll.length).toBeGreaterThan(0);
    expect(finAll.every((x) => x.rule_code === "receivable" || x.rule_code === "instalment_locked")).toBe(true);
    // a scheduled receivable: rows due by today create a step each, a later row none
    const pt2 = await patient(A, "Pasien Piutang Cicil", FO);
    const v2 = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pt2, FO.staffId])).rows[0].id as string;
    const rc2 = await paused(["receivables"], async () => (await h.admin.query(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by,
        created_as) values ($1, $2, $3, $4, 600000, $5, $6, 'fo_cashier') returning id`, [A.tenantId, A.b1, pt2, v2, `k-${key()}`, FO.staffId])).rows[0].id as string);
    await paused(["instalment_schedules", "instalment_rows"], async () => {
      const s = (await h.admin.query(`insert into instalment_schedules (tenant_id, branch_id, patient_id, receivable_id, version, base_paid, command_key, created_by, created_as)
          values ($1, $2, $3, $4, 1, 0, $5, $6, 'fo_cashier') returning id`, [A.tenantId, A.b1, pt2, rc2, `k-${key()}`, FO.staffId])).rows[0].id as string;
      for (const [seq, due] of [[1, day(-3)], [2, day(30)]] as const)
        await h.admin.query(`insert into instalment_rows (tenant_id, branch_id, schedule_id, seq, due_on, amount) values ($1, $2, $3, $4, $5, 300000)`, [A.tenantId, A.b1, s, seq, due]);
    });
    await scan(day(0));
    expect((await fu("receivable", rc2)).map((x) => x.step)).toEqual(["row_1"]);
  });

  it("plan items not selected after SET-22 kunjungan_kedua (60 days) → the plan's BC; dormant after tidak_datang (90 days) → CS, keyed to the last visit", async () => {
    const pt = await patient(A, "Pasien Rencana Sintetis", FO);
    const { visit: v, plan } = await planFor(pt, ctlFacial, 100);
    await scan(day(0));
    const [p] = await fu("plan_unselected", plan);
    expect(p).toMatchObject({ role_queue: "bc", step: "unselected", state: "open" });
    // no clinical content in the projection (W-10)
    expect(JSON.stringify(await as(CS, (db) => followupGet(db, p.id)))).not.toMatch(/Rencana rahasia|Kondisi rahasia|FU-CTL/);
    // a plan under the 60-day window has none
    const young = await planFor(await patient(A, "Pasien Rencana Muda", FO), ctlFacial, 10);
    await scan(day(0));
    expect(await fu("plan_unselected", young.plan)).toEqual([]);
    // dormant: last visit 100 days ago, nothing open → one CS task keyed to that visit; marketing reads it masked without consent
    await scan(day(0));
    const [d] = await fu("dormant", pt);
    expect(d).toMatchObject({ role_queue: "cs", step: `visit_${v.replace(/-/g, "")}`, state: "open" });
    const m0 = (await as(MKT, (db) => followupList(db, "open", "all", "dormant"))).followups.find((x) => x.id === d.id)!;
    expect(m0).toMatchObject({ patient_name: null, consent_masked: true, promo_blocked: true });
    const textId = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi." }))).id;
    await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId, channel: "in_person" }));
    const m1 = (await as(MKT, (db) => followupList(db, "open", "all", "dormant"))).followups.find((x) => x.id === d.id)!;
    expect(m1).toMatchObject({ patient_name: "Pasien Rencana Sintetis", consent_masked: false, promo_blocked: false });
    // marketing reads nothing but dormant
    expect((await as(MKT, (db) => followupList(db, "all", "all"))).followups.every((x) => x.rule_code === "dormant")).toBe(true);
  });
});

describe("T-093 the writer, readers and guards", () => {
  async function aTask() {
    const pt = await patient(A, "Pasien Tugas Sintetis", FO);
    const past = new Date(Math.floor((Date.now() - 3 * 3_600_000) / 900_000) * 900_000);
    const apt = await appointment(pt, past, dpSvc.versionId);
    await as(FO, (db) => markNoShow(db, key(), apt));
    return (await fu("no_show", apt))[0];
  }

  it("done needs an outcome (a note for lainnya); dismiss a note; snooze only later; a closed task is final; replays answer the first result", async () => {
    const f = await aTask();
    expect(await why(as(CS, (db) => updateFollowup(db, key(), f.id, { action: "done", outcome: "lainnya" })))).toBe("ERR_INVALID_INPUT:outcome");
    expect(await why(as(CS, (db) => updateFollowup(db, key(), f.id, { action: "dismiss", note: "x" })))).toBe("ERR_INVALID_INPUT:note");
    expect(await why(as(CS, (db) => updateFollowup(db, key(), f.id, { action: "snooze", dueOn: day(0) })))).toBe("ERR_INVALID_INPUT:due_on");
    expect(await why(as(CS, (db) => updateFollowup(db, key(), f.id, { action: "snooze", dueOn: day(120) })))).toBe("ERR_INVALID_INPUT:due_on");
    expect((await as(CS, (db) => updateFollowup(db, key(), f.id, { action: "snooze", dueOn: day(3) }))).state).toBe("open");
    const r = (await h.admin.query(`select due_on::text d, original_due_on::text o, snooze_count from followups where id = $1`, [f.id])).rows[0];
    expect([r.d, r.snooze_count]).toEqual([day(3), 1]);
    expect(r.o < r.d).toBe(true);
    const k = key();
    expect((await as(CS, (db) => updateFollowup(db, k, f.id, { action: "done", outcome: "lainnya", note: "Pasien pindah kota" }))).state).toBe("done");
    expect(await as(CS, (db) => updateFollowup(db, k, f.id, { action: "done", outcome: "lainnya", note: "Pasien pindah kota" }))).toEqual({ state: "done", replayed: true });
    expect(await code(as(CS, (db) => updateFollowup(db, k, f.id, { action: "done", outcome: "lainnya", note: "Catatan lain" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect((await as(CS, (db) => followupGet(db, f.id))).followup.outcome_note).toBe("Pasien pindah kota");
    expect((await as(AU, (db) => followupGet(db, f.id))).followup).toMatchObject({ outcome: "lainnya", outcome_note: null });
    expect(await why(as(CS, (db) => updateFollowup(db, key(), f.id, { action: "snooze", dueOn: day(5) })))).toBe("ERR_VERSION_CONFLICT:followup_closed");
    const g = await aTask();
    expect((await as(MGR, (db) => updateFollowup(db, key(), g.id, { action: "dismiss", note: "Sudah ditangani cabang" }))).state).toBe("dismissed");
    expect((await h.admin.query(`select outcome, closed_by from followups where id = $1`, [g.id])).rows[0]).toEqual({ outcome: "dilewati", closed_by: MGR.staffId });
  });

  it("assign: a CS task to central CS or the branch's manager, a BC takes only its own BC task; roles, branches and tenants refused", async () => {
    const f = await aTask();
    expect(await code(as(CS, (db) => updateFollowup(db, key(), f.id, { action: "assign", staffId: BC.staffId })))).toBe("ERR_NOT_FOUND");
    expect((await as(CS, (db) => updateFollowup(db, key(), f.id, { action: "assign", staffId: MGR.staffId }))).state).toBe("open");
    expect(await code(as(CS, (db) => updateFollowup(db, key(), f.id, { action: "assign", staffId: MGR2.staffId })))).toBe("ERR_NOT_FOUND");
    expect((await as(CS, (db) => updateFollowup(db, key(), f.id, { action: "unassign" }))).state).toBe("open");
    for (const p of [OWN, FO, DOC, FIN, MKT, AU]) expect(await code(as(p, (db) => updateFollowup(db, key(), f.id, { action: "unassign" }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(BC, (db) => updateFollowup(db, key(), f.id, { action: "unassign" })))).toBe("ERR_NOT_FOUND"); // a CS task is not a BC's
    expect(await code(as(MGR2, (db) => updateFollowup(db, key(), f.id, { action: "unassign" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BCS, (db) => updateFollowup(db, key(), f.id, { action: "unassign" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BCS, (db) => followupGet(db, f.id)))).toBe("ERR_NOT_FOUND");
    expect((await as(BOWN, (db) => followupList(db, "all"))).followups.map((x) => x.id)).not.toContain(f.id);
    // a BC task: the BC takes it for itself, never for another
    const pt = await patient(A, "Pasien Tugas BC", FO);
    const src = await paidLine(pt, ctlFacial, 300_000);
    const ctl = await as(DOC, (db) => scheduleControl(db, key(), src.line, day(4)));
    await scan(day(2));
    const [b] = await fu("control_due", ctl.control_id);
    expect(await code(as(BC, (db) => updateFollowup(db, key(), b.id, { action: "assign", staffId: BC2.staffId })))).toBe("ERR_FORBIDDEN");
    expect((await as(BC, (db) => updateFollowup(db, key(), b.id, { action: "assign", staffId: BC.staffId }))).state).toBe("open");
    expect(await code(as(BC2, (db) => followupGet(db, b.id)))).toBe("ERR_NOT_FOUND"); // now BC's own
    expect(await code(as(BCB2, (db) => followupGet(db, b.id)))).toBe("ERR_NOT_FOUND");
    // the auditor reads masked; the outcome note only to the working roles
    const au = (await as(AU, (db) => followupGet(db, b.id))).followup;
    expect(au).toMatchObject({ patient_name: null, consent_masked: true, outcome_note: null });
    expect(au.patient_mrn).toMatch(/^\*\*\*.{3}$/);
    // every definer accepts exactly its key set
    expect(await code(as(CS, (db) => db.query(`select followup_update($1, '{"action":"unassign","x":1}'::jsonb)`, [f.id])))).toBe("raw:22023");
    expect(await code(as(CS, (db) => db.query(`select followup_list('bogus', null)`)))).toBe("raw:22023");
  });

  it("guards: never deleted or truncated; identity, source and original due frozen; due only forward; outcome_note not granted; the scan runs unbound only", async () => {
    const f = await aTask();
    expect(await raw(`delete from followups where id = $1`, [f.id])).toBe("raw:42501");
    expect(await raw(`truncate followups cascade`)).toBe("raw:42501");
    expect(await raw(`update followups set rule_code = 'dormant', source_kind = 'patient' where id = $1`, [f.id])).toBe("raw:42501");
    expect(await raw(`update followups set original_due_on = original_due_on - 1 where id = $1`, [f.id])).toBe("raw:42501");
    expect(await raw(`update followups set due_on = original_due_on - 1 where id = $1`, [f.id])).not.toBe("ok");
    expect(await raw(`insert into followups (tenant_id, branch_id, patient_id, rule_code, source_kind, source_id, step, role_queue, original_due_on, due_on, state, outcome,
        closed_at) select tenant_id, branch_id, patient_id, rule_code, source_kind, gen_random_uuid(), step, role_queue, original_due_on, due_on, 'done', 'dihubungi', now()
        from followups where id = $1`, [f.id])).not.toBe("ok");
    expect(await code(as(CS, (db) => db.query(`select outcome_note from followups`)))).toBe("raw:42501");
    expect(await code(as(CS, (db) => db.query(`select followup_scan(null)`)))).toBe("raw:42501");
    const trg = (await h.admin.query(`select tgname from pg_trigger where tgname = any($1) and tgenabled = 'A' order by 1`,
      [["followups_guard", "followups_no_truncate", "appointments_followup_no_show"]])).rows.map((r) => r.tgname);
    expect(trg).toEqual(["appointments_followup_no_show", "followups_guard", "followups_no_truncate"]);
  });
});
