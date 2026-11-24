// T-088 Done-when: Scenario PR-47 — "Given a BC target of Rp50,000,000 closing value / When the BC opens Target Saya / Then attainment shows
// actual closing value this month against the target" (asserted at the Target Saya reader; the page is a recorded follow-up, DEC-100). Plus
// the plan reviews: the closing value from settlement facts in the period (a payment in another month, a consultation fee, a counter sale and
// another BC's sale do not count; a refund in the period reduces; a write-off excludes; no commission rule is needed), plans fully selected,
// the periods (bulanan, triwulan, SET-25 default), supersede with history and replay, the roles (owner sets; the eight own-target roles read
// their own; owner and manager list; Admin Pusat refused), the scorecard (completed services, commission, rostered minutes), tenants.
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { collectReceivable, convertToReceivable, requestRefund, writeOffAsOwner } from "../../src/modules/cashier/receivables/receivables";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { createRule, decideRuleVersion } from "../../src/modules/commission/commission";
import { listTargets, myTarget, setStaffTarget } from "../../src/modules/commission/targets/targets";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { changeSetting } from "../../src/modules/settings/settings";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { stepUpForTests } from "../support/step-up";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const STEP: StepUp = stepUpForTests();
const TRF = { bank: "BCA", reference: "TRF-47" };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Target Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("TG1"), b2: await br("TG2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`tgt${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Target ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function credential(t: T, p: P, branch: string) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
}
async function patient(name: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             $6, 'fo_cashier') returning id`,
    [A.tenantId, A.b1, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name, FO.staffId])).rows[0].id as string;
}
// A visit with a plan of `qty` facials (1 by default; 10,000,000 each), signed and consented; the selection confirmed by FO naming `closing`
// for `selected` of the items (all by default); the bill issued for the selected quantity; unpaid.
async function sale(o: { closing?: P; name?: string; qty?: number; selected?: number } = {}) {
  const pid = await patient(o.name ?? "Pasien Target");
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Target", "Kondisi rahasia pasien"));
  const items: string[] = [];
  for (let i = 0; i < (o.qty ?? 1); i++) items.push((await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: facialV, qty: 1 }))).itemId);
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  const t = await as(DOC, (db) => consentText(db, v, planId));
  await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
  const chosen = items.slice(0, o.selected ?? items.length);
  await as(FO, (db) => confirmSelection(db, key(), v, { items: chosen.map((planItemId) => ({ planItemId })), closingBcId: (o.closing ?? BC).staffId }));
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: chosen.length }]));
  const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
  return { pid, v, planId, items, invoiceId, line, total: 10_000_000 * chosen.length };
}
type S = Awaited<ReturnType<typeof sale>>;
const pay = (s: S, amount = s.total) => as(FO, (db) => receivePayment(db, key(), s.invoiceId, [{ method: "transfer", amount, details: TRF }]));
// Move every settlement fact of an invoice into a past month (seeding only, guard paused): allocations' created_at.
async function backdateAllocations(invoiceId: string, monthsAgo: number) {
  await h.admin.query(`alter table payment_allocations disable trigger payment_allocations_insert_only`);
  try {
    await h.admin.query(`update payment_allocations set created_at = (date_trunc('month', now() at time zone 'Asia/Jakarta') - make_interval(months => $2) + interval '5 days') at time zone 'Asia/Jakarta'
      where invoice_line_id in (select id from invoice_lines where invoice_id = $1)`, [invoiceId, monthsAgo]);
  } finally {
    await h.admin.query(`alter table payment_allocations enable always trigger payment_allocations_insert_only`);
  }
}
// The Asia/Jakarta month `monthsAgo` before this one (YYYY-MM).
function month(monthsAgo = 0) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()).split("-").map(Number);
  const t = y * 12 + (m - 1) - monthsAgo;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

let A: T; let B: T;
let BC3: P; let OWN: P; let FH: P; let FIN: P; let DOC: P; let FO: P; let MGR: P; let MGR2: P; let BC: P; let BC2: P; let NUR: P; let PH: P; let AU: P; let AP: P; let BOWN: P; let BBC: P;
let facial: string; let facialV: string; let serum: string;

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); FIN = await person(A, "finance"); DOC = await person(A, "doctor", A.b1);
  FO = await person(A, "fo_cashier", A.b1); MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2); BC = await person(A, "bc", A.b1);
  BC2 = await person(A, "bc", A.b2, A.b1); BC3 = await person(A, "bc", A.b2); NUR = await person(A, "nurse", A.b1); PH = await person(A, "pharmacist", A.b1); AU = await person(A, "auditor");
  AP = await person(A, "admin_pusat"); BOWN = await person(B, "owner"); BBC = await person(B, "bc", B.b1);
  await credential(A, DOC, A.b1);
  const f = await as(OWN, (db) => publish(db, { kind: "service", code: "TG-FAC" }, {
    name: "Facial Target", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 10_000_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", consent_template: "Templat persetujuan Facial Target.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan baru"));
  if (f.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [f.approvalId]));
  facial = f.itemId; facialV = f.versionId;
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "TG-SRM" }, { name: "Serum Target", tax_category: "non_object", tax_basis: "Barang", normal_price: 1_000_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-47: a BC target of Rp50,000,000 and Target Saya", () => {
  it("attainment shows the actual closing value this month against the target; no commission rule is needed", async () => {
    const period = month(0);
    await as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, period, { closingValueTarget: 50_000_000, plansTarget: 4 }));
    // no commission rule exists in this tenant: the closing value comes from the settlement facts (D-07)
    expect((await h.admin.query(`select count(*)::int n from commission_rules where tenant_id = $1`, [A.tenantId])).rows[0].n).toBe(0);
    const s1 = await sale({ qty: 2 }); // 20,000,000
    await pay(s1);
    const s2 = await sale({ qty: 1 }); // 10,000,000, half paid
    await pay(s2, 5_000_000);
    const t = await as(BC, (db) => myTarget(db, period));
    expect([t.period, t.period_kind, t.target?.closing_value_target, t.closing_value_actual, t.attainment_bps]).toEqual([period, "bulanan", 50_000_000, 25_000_000, 5_000]);
    expect(t.plans_actual).toBe(2); // two plans fully selected this month (both visits selected every item)
    // the default period is SET-25's current one (bulanan)
    expect((await as(BC, (db) => myTarget(db))).period).toBe(period);
  });

  it("what does not count: a payment in another month, another BC's sale, a counter sale; a refund this month reduces; a write-off excludes", async () => {
    const before = (await as(BC, (db) => myTarget(db, month(0)))).closing_value_actual;
    const old = await sale({ name: "Pasien Bulan Lalu" });
    await pay(old);
    await backdateAllocations(old.invoiceId, 1);
    const other = await sale({ closing: BC2, name: "Pasien BC Lain" });
    await pay(other);
    const { invoiceId: counter } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), counter, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), counter, [{ method: "cash", amount: 1_000_000, cashTendered: 1_000_000 }]));
    expect((await as(BC, (db) => myTarget(db, month(0)))).closing_value_actual).toBe(before);
    expect((await as(BC, (db) => myTarget(db, month(1)))).closing_value_actual).toBe(10_000_000); // last month's
    // a refund this month reduces this month's attainment
    const r = await sale({ name: "Pasien Refund" });
    await pay(r);
    await as(FO, (db) => requestRefund(db, key(), r.line, { amount: 4_000_000, reason: "Sebagian dikembalikan" }));
    expect((await as(BC, (db) => myTarget(db, month(0)))).closing_value_actual).toBe(before + 6_000_000);
    // a written-off receivable's line is excluded (BILL-23), the collected part included before the write-off
    // (a receivable comes from a performed addition released unpaid: the initial bill is paid first, the start gate needs it)
    const w = await sale({ name: "Pasien Hapus Buku" });
    await pay(w);
    const { requestId } = await as(NUR, (db) => createRequest(db, key(), w.v, {
      kind: "addition", planId: w.planId, catalogVersionId: facialV, stage: 1, qty: 1, reason: "Area tambahan",
    }));
    const add = ((await as(DOC, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
    const ct = await as(DOC, (db) => consentText(db, w.v, w.planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId: w.v, planId: w.planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(FO, (db) => releaseAddition(db, key(), add, MGR.staffId));
    const { executionId } = await as(DOC, (db) => startTreatment(db, key(), w.v, { planItemId: add, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome: "completed" }));
    const { invoiceId: addInv } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: w.pid, visitId: w.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), addInv, [{ itemId: facial, quantity: 1, planItemId: add }]));
    const rc = await as(FO, (db) => convertToReceivable(db, key(), w.v));
    await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "transfer", amount: 3_000_000, details: TRF }));
    // the initial bill (10,000,000) and the collected 3,000,000 of the addition count
    expect((await as(BC, (db) => myTarget(db, month(0)))).closing_value_actual).toBe(before + 6_000_000 + 10_000_000 + 3_000_000);
    await as(OWN, (db) => writeOffAsOwner(db, key(), rc.receivable_id, "Pasien tidak dapat dihubungi"));
    expect((await as(BC, (db) => myTarget(db, month(0)))).closing_value_actual).toBe(before + 6_000_000 + 10_000_000); // the written-off line drops out
  });

  it("plans fully selected: a partly selected plan does not count; the completing selection's month", async () => {
    const before = (await as(BC, (db) => myTarget(db, month(0)))).plans_actual;
    await sale({ qty: 2, selected: 1, name: "Pasien Sebagian" });
    expect((await as(BC, (db) => myTarget(db, month(0)))).plans_actual).toBe(before);
    const full = await sale({ qty: 3, name: "Pasien Penuh" });
    expect((await as(BC, (db) => myTarget(db, month(0)))).plans_actual).toBe(before + 1);
    // the completing selection's month decides: moved into last month, the plan counts there, not now
    const sel = (await h.admin.query(`select id from selections where visit_id = $1`, [full.v])).rows[0].id as string;
    const guards = (await h.admin.query(`select tgname from pg_trigger where tgrelid = 'public.selections'::regclass and not tgisinternal and tgname like '%guard%'`)).rows.map((r) => r.tgname as string);
    for (const g of guards) await h.admin.query(`alter table selections disable trigger ${g}`);
    try {
      await h.admin.query(`update selections set confirmed_at = confirmed_at - interval '40 days' where id = $1`, [sel]);
    } finally {
      for (const g of guards) await h.admin.query(`alter table selections enable always trigger ${g}`);
    }
    expect((await as(BC, (db) => myTarget(db, month(0)))).plans_actual).toBe(before);
  });
});

describe("targets: periods, supersede, replay, roles, tenants", () => {
  it("a new value supersedes (history kept); a replay returns the same row; triwulan and SET-25 default", async () => {
    const period = month(0);
    const k = key();
    const t1 = await as(OWN, (db) => setStaffTarget(db, k, BC.staffId, period, { closingValueTarget: 60_000_000 }));
    expect((await as(OWN, (db) => setStaffTarget(db, k, BC.staffId, period, { closingValueTarget: 60_000_000 }))).targetId).toBe(t1.targetId);
    // the definer's own replay (below the command layer): the same key returns the same row and supersedes nothing
    expect((await as(OWN, (db) => db.query(`select staff_target_set($1, $2, $3, '{"closing_value_target": 60000000}'::jsonb) r`, [k, BC.staffId, period]))).rows[0].r).toBe(t1.targetId);
    const rows = (await h.admin.query(`select closing_value_target::bigint v, state from staff_targets where staff_id = $1 and period_key = $2 order by set_at`, [BC.staffId, period])).rows;
    expect(rows.map((r) => [Number(r.v), r.state])).toEqual([[50_000_000, "superseded"], [60_000_000, "active"]]);
    expect((await as(BC, (db) => myTarget(db, period))).target?.closing_value_target).toBe(60_000_000);
    // never deleted, never edited in place
    expect(await h.admin.query(`delete from staff_targets where id = $1`, [t1.targetId]).then(() => "ok", (e) => e.message as string)).toMatch(/never deleted/);
    expect(await h.admin.query(`update staff_targets set closing_value_target = 1 where id = $1`, [t1.targetId]).then(() => "ok", (e) => e.message as string)).toMatch(/keeps its value/);
    // triwulan: the quarter's window holds this month's sales
    const q = `${period.slice(0, 4)}-Q${Math.floor((Number(period.slice(5, 7)) - 1) / 3) + 1}`;
    await as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, q, { closingValueTarget: 150_000_000 }));
    const tq = await as(BC, (db) => myTarget(db, q));
    expect([tq.period_kind, tq.target?.closing_value_target]).toEqual(["triwulan", 150_000_000]);
    expect(tq.closing_value_actual).toBeGreaterThanOrEqual((await as(BC, (db) => myTarget(db, period))).closing_value_actual);
    await as(OWN, (db) => changeSetting(db, { key: "SET-25", branchId: null, value: { metrik: "closing_rencana", periode: "triwulan" }, reason: "Uji triwulan" }));
    try {
      expect((await as(BC, (db) => myTarget(db))).period).toBe(q);
    } finally {
      await as(OWN, (db) => changeSetting(db, { key: "SET-25", branchId: null, restore: true, reason: "Kembali" }));
    }
    expect(await why(as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, "2026-13", { closingValueTarget: 1 })))).toBe("ERR_INVALID_INPUT:period");
    expect(await why(as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, period, { closingValueTarget: -1 })))).toBe("ERR_INVALID_INPUT:target");
  });

  it("only the owner sets, for a BC; the eight own-target roles read their own; owner and manager list (manager its branch); Admin Pusat refused", async () => {
    const period = month(0);
    for (const p of [FIN, MGR, BC, AP]) expect(await code(as(p, (db) => setStaffTarget(db, key(), BC.staffId, period, { closingValueTarget: 1 }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await why(as(OWN, (db) => setStaffTarget(db, key(), NUR.staffId, period, { closingValueTarget: 1 })))).toBe("ERR_INVALID_INPUT:not_a_bc");
    // own-target roles read their own (a nurse has no target but a scorecard)
    const nt = await as(NUR, (db) => myTarget(db, period));
    expect([nt.staff_id, nt.target, nt.is_bc]).toEqual([NUR.staffId, null, false]);
    for (const p of [FIN, AU, AP, OWN]) expect(await code(as(p, (db) => myTarget(db, period))), p.role).toBe("ERR_FORBIDDEN");
    // lists
    const all = await as(OWN, (db) => listTargets(db, { period }));
    expect(all.rows.map((r) => r.staff_id)).toEqual(expect.arrayContaining([BC.staffId, BC2.staffId, BC3.staffId, NUR.staffId]));
    expect(all.can_set).toBe(true);
    const m = await as(MGR, (db) => listTargets(db, { period }));
    expect(m.rows.map((r) => r.staff_id)).toContain(BC.staffId);
    expect(m.rows.map((r) => r.staff_id)).not.toContain(BC3.staffId); // BC3 is at branch 2 only
    expect(await code(as(MGR, (db) => listTargets(db, { period, branchId: A.b2 })))).toBe("ERR_FORBIDDEN");
    for (const p of [FIN, AU, AP, BC]) expect(await code(as(p, (db) => listTargets(db, { period }))), p.role).toBe("ERR_FORBIDDEN");
    // the branch filter adds the branch's closing value
    const b1 = await as(OWN, (db) => listTargets(db, { period, branchId: A.b1 }));
    const row = b1.rows.find((r) => r.staff_id === BC.staffId)!;
    expect(row.branch_closing_value).toBe(row.closing_value_actual); // every sale of BC was at branch 1
    // table reads: a BC sees only its own row; a manager its branch's staff; Admin Pusat nothing
    expect((await as(BC3, (db) => db.query(`select distinct staff_id from staff_targets`))).rows.map((r) => r.staff_id)).toEqual([]);
    expect((await as(BC, (db) => db.query(`select distinct staff_id from staff_targets`))).rows.map((r) => r.staff_id)).toEqual([BC.staffId]);
    expect((await as(AP, (db) => db.query(`select count(*)::int n from staff_targets`))).rows[0].n).toBe(0);
    expect((await as(MGR2, (db) => db.query(`select count(*)::int n from staff_targets`))).rows[0].n).toBe(0); // no target at branch 2
  });

  it("the scorecard: completed services, commission and rostered minutes; another tenant sees nothing", async () => {
    // a rule makes commission appear in the scorecard (the target itself never needs one)
    const r = await as(FIN, (db) => createRule(db, key(), { contributionType: "closing_bc", name: "Closing", kind: "percent", basisPoints: 500 }));
    await as(OWN, (db) => decideRuleVersion(db, r.versionId, "activate"));
    const done0 = (await as(MGR, (db) => listTargets(db, { period: month(0) }))).rows.find((x) => x.staff_id === DOC.staffId)!.scorecard.completed_services;
    // an uncounted finish (a clinic stop) is not a completed service
    const stop = await sale({ name: "Pasien Berhenti Klinik" });
    await pay(stop);
    const ex0 = await as(DOC, (db) => startTreatment(db, key(), stop.v, { planItemId: stop.items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), ex0.executionId, { outcome: "clinic_stop", reason: "Alat rusak" }));
    expect((await as(MGR, (db) => listTargets(db, { period: month(0) }))).rows.find((x) => x.staff_id === DOC.staffId)!.scorecard.completed_services).toBe(done0);
    const gross0 = (await as(BC, (db) => myTarget(db, month(0)))).scorecard.commission_gross;
    const s = await sale({ name: "Pasien Kartu Skor" });
    await pay(s);
    const { executionId } = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: s.items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await h.admin.query(`alter table treatment_executions disable trigger treatment_executions_guard`);
    try {
      await h.admin.query(`update treatment_executions set started_at = now() - interval '45 minutes' where id = $1`, [executionId]);
    } finally {
      await h.admin.query(`alter table treatment_executions enable always trigger treatment_executions_guard`);
    }
    await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome: "completed" }));
    const bc = await as(BC, (db) => myTarget(db, month(0)));
    expect(bc.scorecard.commission_gross - gross0).toBe(500_000); // 5 % of this 10,000,000 sale
    const doc = await as(MGR, (db) => listTargets(db, { period: month(0) })).then((l) => l.rows.find((x) => x.staff_id === DOC.staffId)!);
    expect([doc.scorecard.completed_services - done0, doc.scorecard.executed_minutes >= 44, doc.scorecard.utilization_bps]).toEqual([1, true, null]); // no roster
    expect((await as(BOWN, (db) => listTargets(db, { period: month(0) }))).rows.map((x) => x.staff_id)).toEqual([BBC.staffId]);
    expect((await as(BBC, (db) => myTarget(db, month(0)))).closing_value_actual).toBe(0);
  });
});
