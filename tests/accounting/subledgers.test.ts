// T-104 Done-when: Scenario PR-25 (package liability roll-forward) and the money-fixture roll-forward spot checks (8, 13, 19, 3b, 14, 11)
// on real writers; plus plan r5 §7 / addendum a1 r2: scenario 3a (paid-not-delivered −400,000 then 0), cash by method once, the January
// reopen after February facts, a dearer substitution redeemed, an undelivered cash refund, scenario 16 (S1) and a fully paid PKP session,
// the VAT seams' signed deltas (S5 delayed reversal, S4 + S5 at close, S6 full and short DP application), the cutover (legacy residues,
// labels), D-A1 VAT facts (roles, PKP, corrections, period total, idempotency), D-B2 FIFO origin branches, commission per recipient,
// exports (no patient data, no journal, audited, auditor refused) and readers per role. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { exportRows, recordVatInputCredit, recordVatPayment, rollforward, toCsv, type Rollforward } from "../../src/modules/accounting/subledgers/subledgers";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { collectReceivable, convertToReceivable, payRefund, requestRefund, writeOffAsOwner } from "../../src/modules/cashier/receivables/receivables";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { recordExpense, reverseExpense, saveExpenseCategory } from "../../src/modules/expenses/expenses";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { runPackageExpiryScan } from "../../src/modules/packages/expiry";
import { cancelPackage, decideSubstitution, interruptedToBalance, requestSubstitution, reserveSession, setPackageContents, topUpBalance } from "../../src/modules/packages/packages";
import { SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import { createCharge, enableMockPort, receiveMockWebhook, simulate } from "../../src/modules/payments/payments";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { closeVisit } from "../../src/modules/visits/visits";
import { changeSetting } from "../../src/modules/settings/settings";
import { recordPayment, reversePayable } from "../../src/modules/purchasing/payables/payables";
import { saveSupplier } from "../../src/modules/purchasing/suppliers/suppliers";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const STEP: StepUp = { verified: true };
const NPWP = "012345678901234";
const EDC = { card_type: "debit", bank: "BCA", trace: "123456", approval_code: "A1B2C3" };

async function tenant(name = "PT Buku Sintetis"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("BK1"), b2: await br("BK2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`sl${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Buku ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? ""}:${e.message}`));
const wib = (ms = 0) => new Date(Date.now() + ms).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const today = () => wib();
const tomorrowWib = () => wib(86_400_000);
const monthStart = () => `${today().slice(0, 8)}01`;
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function patient(t: T, branch: string, name = "Pasien Buku Rahasia"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
async function credential(t: T, p: P, branch: string, fh: P, own: P) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, own.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, fh.staffId]);
  }
}
// Move facts of a fixture back in time (the writers stamp clock_timestamp()): the guards are bypassed only for this fixture surgery.
async function shift(table: string, cols: string[], where: string, args: unknown[], interval: string) {
  const triggers = (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [table])).rows.map((r) => r.tgname as string);
  for (const t of triggers) await h.admin.query(`alter table ${table} disable trigger ${t}`);
  try {
    await h.admin.query(`update ${table} set ${cols.map((c) => `${c} = ${c} - interval '${interval}'`).join(", ")} where ${where}`, args);
  } finally {
    for (const t of triggers) await h.admin.query(`alter table ${table} enable always trigger ${t}`);
  }
}

// ── tenant A (non-PKP) fixture ──
let A: T; let B: T;
let OWN: P; let FIN: P; let AU: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FO: P; let FOB2: P; let MGR: P; let BFIN: P;
let facial: string; let facialV: string; let filler: string; let fillerV: string; let pricey: string;

async function packageItem(t: { own: P }, c: string, price: number, rows: { serviceItemId: string; count: number }[], tax?: string) {
  const v = await as(t.own, (db) => publish(db, { kind: "package", code: c }, {
    name: `Paket ${c}`, tax_category: tax ?? "exempt_medical", tax_basis: tax ? "Jasa" : "Jasa medis", normal_price: price, installments_allowed: true,
  } as never, "Paket baru"));
  await as(t.own, (db) => setPackageContents(db, key(), v.versionId, rows));
  return v.itemId;
}
async function sell(fo: P, pid: string, item: string, pay?: number) {
  const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
  await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
  if (pay) await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: pay, cashTendered: pay }]));
  const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
  return { invoiceId, pkg };
}
async function visitWith(t: T, pid: string, branch: string, versions: string[], doc: P, fo: P) {
  const d = branch === doc.branch ? doc : { ...doc, branch };
  await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by, payment = case when payment in ('in_progress','blocked') then 'done' else payment end,
                         dispensing = case when dispensing in ('in_progress','blocked') then 'done' else dispensing end,
                         treatment = case when treatment in ('in_progress','blocked') then 'done' else treatment end
                       where tenant_id = $1 and branch_id = $2 and patient_id = $3 and closed_at is null`, [t.tenantId, branch, pid]);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, pid, fo.staffId])).rows[0].id as string;
  const { examId } = await as(d, (db) => openExam(db, key(), v));
  const { planId } = await as(d, (db) => createPlan(db, key(), examId, "Program Buku", "Kondisi rahasia"));
  const items: string[] = [];
  for (const ver of versions) items.push((await as(d, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }))).itemId);
  await as(d, (db) => signRecord(db, key(), examId, STEP));
  const ct = await as(d, (db) => consentText(db, v, planId));
  await as(d, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
  return { v, items, planId };
}
async function redeem(t: T, pkg: string, pid: string, branch: string, version: string, doc: P, fo: P, service?: string) {
  const { v, items } = await visitWith(t, pid, branch, [version], doc, fo);
  await as(fo, (db) => reserveSession(db, key(), pkg, v, service));
  const d = branch === doc.branch ? doc : { ...doc, branch };
  const e = await as(d, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: doc.staffId, identityConfirmed: true }));
  await as(d, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
  return e.executionId;
}
// A held booking deposit with its KW receipt, payment and allocation, built directly (deposit_receive needs an appointment calendar the
// sub-ledger tests do not exercise); the guards are bypassed only for this fixture surgery. vat = the VAT separated at receipt.
async function heldDeposit(t: T, branch: string, pid: string, versionId: string, staff: P, amount: number, vat: number, category: string) {
  const tables = ["appointments", "receipts", "booking_deposits", "payments", "payment_allocations"];
  const off: [string, string][] = [];
  for (const tb of tables) for (const r of (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
  for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} disable trigger ${tg}`);
  try {
    const apt = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
      values ($1, $2, $3, $4, $5, now() + interval '2 days', now() + interval '2 days 30 minutes', 'booked', 'phone', $5, 'fo_cashier') returning id`, [t.tenantId, branch, pid, versionId, staff.staffId])).rows[0].id;
    const k = key().replace(/-/g, "");
    const rc = (await h.admin.query(`insert into receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, is_simulated, command_key, issued_by, issued_as, issued_at)
      values ($1, $2, null, 'KW-DP-' || $3, $4, 'DP booking sintetis', '80mm', false, $5, $6, 'fo_cashier', now()) returning id`, [t.tenantId, branch, k.slice(0, 10), amount, `dp-${k}`, staff.staffId])).rows[0].id;
    const d = (await h.admin.query(`insert into booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category,
        is_pkp_at_receipt, vat_base, vat_amount, vat_recognised_amount, cutoff_hours, command_key, received_by, received_as, received_at)
      values ($1, $2, $3, $4, $5, $6, 'cash', $7::bigint, $8, $9::bigint > 0, $7::bigint - $9::bigint, $9::bigint, $9::bigint, 24, $10, $11, 'fo_cashier', now()) returning id`,
      [t.tenantId, branch, apt, pid, versionId, rc, amount, category, vat, `dp-${k}`, staff.staffId])).rows[0].id as string;
    const pay = (await h.admin.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, environment, is_simulated, received_by, received_as, received_at)
      values ($1, $2, $3, 1, null, $4, 'cash', $5, $5, 0, 'production', false, $6, 'fo_cashier', now()) returning id`, [t.tenantId, branch, rc, pid, amount, staff.staffId])).rows[0].id;
    await h.admin.query(`insert into payment_allocations (tenant_id, branch_id, payment_id, booking_deposit_id, amount, vat_portion, method, environment, is_simulated)
      values ($1, $2, $3, $4, $5, $6, 'cash', 'production', false)`, [t.tenantId, branch, pay, d, amount, vat]);
    return d;
  } finally {
    for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} enable always trigger ${tg}`);
  }
}
// deposit_apply_do itself (the writer of both apply paths) on an issued invoice of a visit, as the migration owner.
const applyDo = async (invoiceId: string, depositId: string, staff: P) =>
  (await h.admin.query(`select deposit_apply_do(i, d, $3, 'fo_cashier') l from invoices i, booking_deposits d where i.id = $1 and d.id = $2`, [invoiceId, depositId, staff.staffId])).rows[0].l as string | null;

const roll = (p: P, from = monthStart(), to = today(), branchId?: string | null) => as(p, (db) => rollforward(db, { from, to, branchId }));
const L = (r: Rollforward, l: keyof Rollforward["ledgers"]) => r.ledgers[l];
// The movement sum of one ledger and object, through the (not granted) movements function, as the migration owner.
const objSum = async (t: T, ledger: string, objectId: string) =>
  Number((await h.admin.query(`select coalesce(sum(amount), 0) s from subledger_movements($1) where ledger = $2 and object_id = $3`, [t.tenantId, ledger, objectId])).rows[0].s);
const termSum = async (t: T, ledger: string, term: string, sourceId?: string) =>
  Number((await h.admin.query(`select coalesce(sum(amount), 0) s from subledger_movements($1) where ledger = $2 and term = $3 and ($4::uuid is null or source_id = $4)`,
    [t.tenantId, ledger, term, sourceId ?? null])).rows[0].s);
const ledgerSum = async (t: T, ledger: string, pred = "true", args: unknown[] = []) =>
  Number((await h.admin.query(`select coalesce(sum(amount), 0) s from subledger_movements($1) m where ledger = $2 and ${pred}`, [t.tenantId, ledger, ...args])).rows[0].s);

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant("PT Buku Lain");
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor"); FH = await person(A, "facility_head", A.b1);
  DOC = await person(A, "doctor", A.b1, A.b2); NUR = await person(A, "nurse", A.b1); BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1);
  FOB2 = await person(A, "fo_cashier", A.b2); MGR = await person(A, "manager", A.b1); BFIN = await person(B, "finance");
  await credential(A, DOC, A.b1, FH, OWN);
  await credential(A, DOC, A.b2, FH, OWN);
  const svc = async (c: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  };
  ({ itemId: facial, versionId: facialV } = await svc("BK-FAC", "Facial Buku", 600_000));
  ({ itemId: filler, versionId: fillerV } = await svc("BK-FIL", "Filler Buku", 400_000));
  pricey = (await svc("BK-PRE", "Laser Premium Buku", 800_000)).itemId;
  await as(MGR, (db) => enableMockPort(db));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("Scenario PR-25 and money scenarios 8, 11, 12a, 13 (package liability roll-forward)", () => {
  it("PR-25: sales, redemptions at two branches, an expiry and a cancellation in one month: opening + paid − counted − moved − refunded = closing", async () => {
    const before = await roll(FIN);
    const pkgItem = await packageItem({ own: OWN }, "PR25", 3_000_000, [{ serviceItemId: facial, count: 5 }]);
    const p1 = await patient(A, A.b1);
    const s1 = await sell(FO, p1, pkgItem, 3_000_000);
    await redeem(A, s1.pkg, p1, A.b1, facialV, DOC, FO);
    // scenario 11: sold at branch 1, redeemed at branch 2 → inter-branch ± with zero total
    await redeem(A, s1.pkg, p1, A.b2, facialV, DOC, FOB2);
    // scenario 8: the rest expires to balance
    await h.admin.query(`alter table packages disable trigger packages_guard`);
    await h.admin.query(`update packages set validity_end = now() - interval '1 day' where id = $1`, [s1.pkg]);
    await h.admin.query(`alter table packages enable always trigger packages_guard`);
    await runPackageExpiryScan(worker);
    // scenario 13: a top-up pays a second package's instalment, one session redeemed, then cancelled ("refund" of the purchase to balance)
    const p2 = await patient(A, A.b1);
    await as(FO, (db) => topUpBalance(db, key(), p2, null, { method: "cash", amount: 600_000, cashTendered: 600_000 }));
    const s2 = await sell(FO, p2, pkgItem);
    await as(FO, (db) => receivePayment(db, key(), s2.invoiceId, [{ method: "balance", amount: 600_000 }]));
    await redeem(A, s2.pkg, p2, A.b1, facialV, DOC, FO);
    await as(MGR, (db) => cancelPackage(db, key(), s2.pkg, "Pasien pindah kota"));
    const after = await roll(FIN);
    const pk = L(after, "package_liability");
    const t = pk.terms;
    // the identity of the scenario: opening + paid − counted − moved (expiry, cancel) − refunded = closing
    expect(pk.opening + Object.values(t).reduce((x, y) => x + y, 0)).toBe(pk.closing);
    expect(pk.closing - L(before, "package_liability").closing).toBe(0); // both packages closed: nothing left
    expect(await objSum(A, "package_liability", s1.pkg)).toBe(0);
    expect(await objSum(A, "package_liability", s2.pkg)).toBe(0);
    // scenario 8 spot values: −1,800,000 moved to balance for package 1 (3,000,000 − 2 × 600,000); balance +1,800,000
    expect(await termSum(A, "package_liability", "close", s1.pkg)).toBe(-1_800_000);
    expect(await objSum(A, "package_liability", s1.pkg)).toBe(0);
    // scenario 13: balance −600,000 used; package +600,000 − 600,000 = 0 for that instalment
    expect(await termSum(A, "patient_balance", "use")).toBeLessThanOrEqual(-600_000);
    // scenario 11: inter-branch nets to zero tenant-wide; branch 1 +600,000 and branch 2 −600,000
    expect(L(after, "inter_branch").closing).toBe(0);
    expect(L(after, "inter_branch").by_branch[A.b1]).toBe(600_000);
    expect(L(after, "inter_branch").by_branch[A.b2]).toBe(-600_000);
    // checks: the closed packages carry nothing; the balance and DP stocks match
    expect([after.checks.package_liability.mismatches, after.checks.package_liability.checked! >= 2]).toEqual([0, true]);
    expect(after.checks.patient_balance.expected).toBe(L(after, "patient_balance").closing);
  });

  it("12a dearer substitution paid then redeemed: package liability −(600,000 + 200,000), difference line counted once; 12b cheaper: −150,000 to balance", async () => {
    const pkgItem = await packageItem({ own: OWN }, "S12", 3_000_000, [{ serviceItemId: facial, count: 5 }]);
    const pid = await patient(A, A.b1);
    const { pkg } = await sell(FO, pid, pkgItem, 3_000_000);
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    const peel = (await h.admin.query(`select item_id from catalog_versions where name = 'Filler Buku' limit 1`)).rows[0].item_id as string;
    const { substitutionId: u1 } = await as(FO, (db) => requestSubstitution(db, key(), ss[0], peel, "Kulit lebih sensitif"));
    await as(DOC, (db) => decideSubstitution(db, key(), u1, true, null));
    expect(await termSum(A, "package_liability", "substitution", u1)).toBe(-200_000);
    const { substitutionId: u2 } = await as(FO, (db) => requestSubstitution(db, key(), ss[1], pricey, "Hasil lebih baik"));
    await as(FH, (db) => decideSubstitution(db, key(), u2, true, null));
    const premiumV = (await h.admin.query(`select id from catalog_versions where item_id = $1 and state = 'active'`, [pricey])).rows[0].id;
    const { v, items } = await visitWith(A, pid, A.b1, [premiumV], DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), pkg, v, pricey));
    const { invoiceId: di } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), di, [{ itemId: pricey, quantity: 1, substitutionId: u2 }]));
    await as(FO, (db) => receivePayment(db, key(), di, [{ method: "cash", amount: 200_000, cashTendered: 200_000 }]));
    const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const sess = ss[1];
    expect(await termSum(A, "package_liability", "redemption", sess)).toBe(-800_000);
    // the difference line is package money: nothing of it in paid-not-delivered
    const dline = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [di])).rows[0].id;
    expect(await objSum(A, "paid_not_delivered", dline)).toBe(0);
    await as(MGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    expect(await objSum(A, "package_liability", pkg)).toBe(0);
  });
});

describe("paid-not-delivered, receivables, cash by method (money scenarios 3a, 3b, 14)", () => {
  async function visitReady(name: string) {
    const pid = await patient(A, A.b1, name);
    const { v, items, planId } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 600_000, cashTendered: 600_000 }]));
    return { pid, v, planId, item: items[0], invoiceId };
  }
  async function addition(s: Awaited<ReturnType<typeof visitReady>>) {
    const { requestId } = await as(NUR, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: fillerV, stage: 1, qty: 1, reason: "Lipatan dalam" }));
    const d = await as(DOC, (db) => decideRequest(db, key(), requestId, true, null));
    const itemId = (d as { item_id: string }).item_id;
    const ct = await as(DOC, (db) => consentText(db, s.v, s.planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId: s.v, planId: s.planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(FO, (db) => releaseAddition(db, key(), itemId, FO.staffId));
    const e = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: itemId, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1, planItemId: itemId }]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    return { execution: e.executionId, invoiceId, line };
  }

  it("3a: delivered before payment the line is −400,000, after the EDC payment 0; gateway clearing +400,000 (EDC), cash +600,000 once", async () => {
    const s = await visitReady("Pasien 3a");
    const a = await addition(s);
    expect(await objSum(A, "paid_not_delivered", a.line)).toBe(-400_000);
    await as(FO, (db) => receivePayment(db, key(), a.invoiceId, [{ method: "edc", amount: 400_000, details: EDC }]));
    expect(await objSum(A, "paid_not_delivered", a.line)).toBe(0);
    const pay = (await h.admin.query(`select id from payments where invoice_id = $1`, [a.invoiceId])).rows[0].id;
    expect(await ledgerSum(A, "gateway_clearing", "source_id = $3", [pay])).toBe(400_000);
    const cashPay = (await h.admin.query(`select id from payments where invoice_id = $1`, [s.invoiceId])).rows[0].id;
    expect(await ledgerSum(A, "cash_bank", "source_id = $3", [cashPay])).toBe(600_000);
  });

  it("3b and 14: converted → receivable +400,000, the line 0; collected −400,000 (net 0); a second written off −400,000", async () => {
    const s = await visitReady("Pasien 3b");
    const a = await addition(s);
    const rc = await as(FO, (db) => convertToReceivable(db, key(), s.v));
    expect(await objSum(A, "paid_not_delivered", a.line)).toBe(0);
    expect(await objSum(A, "receivables", rc.receivable_id)).toBe(400_000);
    await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "cash", amount: 400_000, cashTendered: 400_000 }));
    expect(await objSum(A, "receivables", rc.receivable_id)).toBe(0);
    const s2 = await visitReady("Pasien 14");
    await addition(s2);
    const rc2 = await as(FO, (db) => convertToReceivable(db, key(), s2.v));
    await as(OWN, (db) => writeOffAsOwner(db, key(), rc2.receivable_id, "Pasien pindah kota, tidak dapat dihubungi"));
    expect(await termSum(A, "receivables", "written_off")).toBeLessThanOrEqual(-400_000);
    expect(await objSum(A, "receivables", rc2.receivable_id)).toBe(0);
    const r = await roll(FIN);
    expect(r.checks.receivables.expected).toBe(L(r, "receivables").closing);
    expect(r.checks.receivables.stored_now).toBe(L(r, "receivables").closing);
  });

  it("simulated port money never reaches a ledger (BILL-29): no settlement on the line, no clearing, no cash", async () => {
    const pid = await patient(A, A.b1, "Pasien Simulasi");
    const { v } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    const c = await as(FO, (db) => createCharge(db, key(), invoiceId, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local");
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    expect((await h.admin.query(`select count(*)::int c from payment_allocations where invoice_line_id = $1 and is_simulated`, [line])).rows[0].c).toBe(1);
    expect(await objSum(A, "paid_not_delivered", line)).toBe(0);
    const pays = (await h.admin.query(`select id from payments where invoice_id = $1`, [invoiceId])).rows.map((r) => r.id);
    expect(await ledgerSum(A, "gateway_clearing", "source_id = any($3::uuid[])", [pays])).toBe(0);
  });

  it("an undelivered line refunded in cash debits paid-not-delivered once (−600,000 + 600,000 = 0); cash −600,000 once", async () => {
    const pid = await patient(A, A.b1, "Pasien Refund Tunai");
    const { v } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 600_000, cashTendered: 600_000 }]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    const r = await as(FO, (db) => requestRefund(db, key(), line, { amount: 600_000, reason: "Pasien batal tindakan", destination: "cash" }));
    await as(OWN, (db) => decideApproval(db, r.approval_id!, true));
    await as(FO, (db) => payRefund(db, key(), r.refund_id, "cash"));
    expect(await objSum(A, "paid_not_delivered", line)).toBe(0);
    expect(await ledgerSum(A, "cash_bank", "source_id = $3", [r.refund_id])).toBe(-600_000);
    // the balance: from_refund +600,000 then cash_refund −600,000 (balance-ledger only)
    const acct = (await h.admin.query(`select id from balance_accounts where patient_id = $1`, [pid])).rows[0].id;
    expect(await ledgerSum(A, "patient_balance", "object_id = $3", [acct])).toBe(0);
  });

  it("an expense and a supplier-side reversal: January's outflow stays in January, the reversal is February's inflow", async () => {
    const cat = (await as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "Listrik Buku" }))).categoryId;
    const { expenseId } = await as(FIN, (db) => recordExpense(db, key(), A.b1, { categoryId: cat, businessDate: today(), amount: 125_000, funding: "bank", description: "Tagihan listrik" }));
    await as(FIN, (db) => reverseExpense(db, key(), expenseId, "Salah catat"));
    await h.admin.query(`alter table expenses disable trigger expenses_guard`);
    await h.admin.query(`update expenses set business_date = business_date - 40 where id = $1`, [expenseId]);
    await h.admin.query(`alter table expenses enable always trigger expenses_guard`);
    expect(await ledgerSum(A, "cash_bank", "source_id = $3 and term = 'expense'", [expenseId])).toBe(-125_000);
    expect(await ledgerSum(A, "cash_bank", "source_id = $3 and term = 'expense_reversed'", [expenseId])).toBe(125_000);
    const days = (await h.admin.query(`select term, day::text d from subledger_movements($1) where source_id = $2 order by day`, [A.tenantId, expenseId])).rows;
    expect(days[0].term).toBe("expense");
    expect(days[0].d < days[1].d).toBe(true);
  });
});

describe("D-B2: patient balance by origin branch (FIFO)", () => {
  it("credits at A then B; a 400,000 spend at B takes A's 300,000 first then 100,000 of B; Σ origins = the stored balance; reopened before the spend unchanged", async () => {
    const pid = await patient(A, A.b1, "Pasien FIFO");
    await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 300_000, cashTendered: 300_000 }));
    await as(FOB2, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 500_000, cashTendered: 500_000 }));
    const acct = (await h.admin.query(`select id from balance_accounts where patient_id = $1`, [pid])).rows[0].id as string;
    const origin = async () => Object.fromEntries((await h.admin.query(
      `select branch_id, sum(amount)::int s from subledger_movements($1) where ledger = 'patient_balance' and object_id = $2 group by branch_id`, [A.tenantId, acct])).rows
      .map((r) => [r.branch_id, r.s]));
    expect(await origin()).toEqual({ [A.b1]: 300_000, [A.b2]: 500_000 });
    // spend 400,000 at branch 2 through the Kasir (a balance tender on a counter-free visit invoice)
    const { v } = await visitWith(A, pid, A.b2, [facialV], DOC, FOB2);
    const { invoiceId } = await as(FOB2, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FOB2, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1 }]));
    await as(FOB2, (db) => receivePayment(db, key(), invoiceId, [{ method: "balance", amount: 400_000 }]));
    const by = await origin();
    expect(by).toEqual({ [A.b1]: 0, [A.b2]: 400_000 }); // FIFO: A's credit consumed first (LIFO would leave A 300,000)
    const stored = Number((await h.admin.query(`select balance from balance_accounts where id = $1`, [acct])).rows[0].balance);
    expect(by[A.b1] + by[A.b2]).toBe(stored);
    const debits = (await h.admin.query(`select branch_id, amount::int a from subledger_movements($1) where ledger = 'patient_balance' and object_id = $2 and amount < 0 order by amount`, [A.tenantId, acct])).rows;
    expect(debits).toEqual([{ branch_id: A.b1, a: -300_000 }, { branch_id: A.b2, a: -100_000 }]);
    // the tenant check: stored stock = ledger closing
    const r = await roll(FIN);
    expect(r.checks.patient_balance.expected).toBe(L(r, "patient_balance").closing);
  });
});

describe("VAT (PKP tenant): seams S1, S4, S5, S6 signed; scenario 16, 19; cutover; D-A1 facts", () => {
  let C: T; let COWN: P; let CFO: P; let CFIN: P; let CDOC: P; let CFH: P; let CMGR: P; let CAU: P;
  let svcV: string; let svcItem: string; let pkgItem: string; let pkg2Item: string; let cheapItem: string;
  async function becomePkp() {
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(COWN, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrowWib(), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 40, changed_at = now() - interval '45 days' where tenant_id = $1`, [C.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 40 where id = $1`, [C.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
  }
  beforeAll(async () => {
    C = await tenant("PT Buku PKP");
    COWN = await person(C, "owner"); CFIN = await person(C, "finance"); CFO = await person(C, "fo_cashier", C.b1); CFH = await person(C, "facility_head", C.b1);
    CDOC = await person(C, "doctor", C.b1); CMGR = await person(C, "manager", C.b1); CAU = await person(C, "auditor");
    await credential(C, CDOC, C.b1, CFH, COWN);
    const s = await as(COWN, (db) => publish(db, { kind: "service", code: "BKP-SVC" }, {
      name: "Layanan Kena Pajak Buku", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (s.approvalId) await as(CFH, (db) => db.query(`select approval_decide($1, true, null)`, [s.approvalId]));
    svcV = s.versionId; svcItem = s.itemId;
    const cheap = await as(COWN, (db) => publish(db, { kind: "service", code: "BKP-CHP" }, {
      name: "Layanan Murah Pajak", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 333_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (cheap.approvalId) await as(CFH, (db) => db.query(`select approval_decide($1, true, null)`, [cheap.approvalId]));
    cheapItem = cheap.itemId;
    pkgItem = await packageItem({ own: COWN }, "BKP-PKG", 3_330_000, [{ serviceItemId: svcItem, count: 5 }], "taxable_service");
    pkg2Item = await packageItem({ own: COWN }, "BKP-PK2", 1_332_000, [{ serviceItemId: svcItem, count: 2 }], "taxable_service");
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak buku\n%%EOF\n`);
    const { fileId } = await as(CFIN, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const it2 = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(COWN, (db) => decideEvidence(db, it2, fileId, "approved"));
  }, 300_000);
  // C was created after the migration: no cutover row; every seam is recorded
  // the comparator's mismatches for one package (other tests in this tenant create deliberate fixture-surgery mismatches; e.g. the S4 test
  // raises a line's recognition with no dated fact, which the comparator rightly reports)
  const mismatchOf = async (pkg: string) => ((await roll(CFIN)).checks.package_liability.mismatched ?? []).filter((x) => x.id === pkg);
  const vatOf = async (objectId: string) => objSum(C, "vat", objectId);

  it("16: sold before PKP (no VAT), redeemed after PKP: S1 +66,000 at delivery; package liability −666,000 for that session", async () => {
    const pid = await patient(C, C.b1);
    const { pkg } = await sell(CFO, pid, pkgItem, 3_330_000);
    await becomePkp();
    const ex = await redeem(C, pkg, pid, C.b1, svcV, CDOC, CFO);
    void ex;
    const s1 = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg])).rows[0].id;
    expect(await vatOf(s1)).toBe(66_000);
    expect((await h.admin.query(`select delta::int d, cause from vat_events where object_id = $1`, [s1])).rows).toEqual([{ d: 66_000, cause: "session_delivery" }]);
    expect(await termSum(C, "package_liability", "redemption", s1)).toBe(-666_000);
  });

  it("19: a PKP package paid 3,330,000 (VAT 330,000 once), expired: liability 3,000,000 → 0, VAT +330,000 − 330,000 (S4); a fully paid PKP redemption −600,000", async () => {
    const pid = await patient(C, C.b1);
    const { pkg } = await sell(CFO, pid, pkgItem, 3_330_000);
    expect(await termSum(C, "package_liability", "settlement") > 0).toBe(true);
    expect(await objSum(C, "package_liability", pkg)).toBe(3_000_000);
    expect(await vatOf(pkg)).toBe(330_000);
    const ex = await redeem(C, pkg, pid, C.b1, svcV, CDOC, CFO);
    void ex;
    const s1 = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg])).rows[0].id;
    expect(await termSum(C, "package_liability", "redemption", s1)).toBe(-666_000);
    expect(Number((await h.admin.query(`select coalesce(sum(m.amount), 0) s from subledger_movements($1) m join vat_events e on e.id = m.source_id
      where m.ledger = 'package_liability' and m.term = 'vat_session_attribution' and e.source_id = $2`, [C.tenantId, s1])).rows[0].s)).toBe(66_000); // net −600,000
    await h.admin.query(`alter table packages disable trigger packages_guard`);
    await h.admin.query(`update packages set validity_end = now() - interval '1 day' where id = $1`, [pkg]);
    await h.admin.query(`alter table packages enable always trigger packages_guard`);
    await runPackageExpiryScan(worker);
    expect(await objSum(C, "package_liability", pkg)).toBe(0);
    // VAT 330,000 once: the redeemed session holds its 66,000 (attributed at delivery, S1b); the package object's 264,000 of the four
    // unredeemed sessions is reversed at close (S4, signed −); the package object ends at 0
    expect(await vatOf(pkg)).toBe(0);
    expect(await vatOf(s1)).toBe(66_000);
    const ev = (await h.admin.query(`select cause, sum(delta)::int d from vat_events where object_id = $1 group by cause order by cause`, [pkg])).rows;
    expect(ev).toEqual([{ cause: "package_close_package", d: -264_000 }, { cause: "session_attribution", d: -66_000 }]);
  });

  it("S5: partial payment → cheaper substitution (no reversal yet) → later payment records the delayed −33,000; VAT position = recognised − reversed", async () => {
    const pid = await patient(C, C.b1);
    const { invoiceId, pkg } = await sell(CFO, pid, pkg2Item, 666_000);
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    const { substitutionId } = await as(CFO, (db) => requestSubstitution(db, key(), ss[1], cheapItem, "Kulit sensitif"));
    await as(CDOC, (db) => decideSubstitution(db, key(), substitutionId, true, null)).catch(async () => as(CFH, (db) => decideSubstitution(db, key(), substitutionId, true, null)));
    expect((await h.admin.query(`select count(*)::int c from vat_events where object_id = $1 and cause = 'package_sync_reversal'`, [pkg])).rows[0].c).toBe(0);
    await as(CFO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 666_000, cashTendered: 666_000 }]));
    const ev = (await h.admin.query(`select delta::int d from vat_events where object_id = $1 and cause = 'package_sync_reversal'`, [pkg])).rows;
    expect(ev).toEqual([{ d: -33_000 }]);
    const row = (await h.admin.query(`select l.vat_recognised_amount::int r, p.vat_reversed_amount::int v from packages p join invoice_lines l on l.id = p.invoice_line_id where p.id = $1`, [pkg])).rows[0];
    expect(await vatOf(pkg)).toBe(row.r - row.v);
    // close after the sync reversal: S4 records only its own post-sync delta (no double count)
    await as(CMGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    const row2 = (await h.admin.query(`select l.vat_recognised_amount::int r, p.vat_reversed_amount::int v from packages p join invoice_lines l on l.id = p.invoice_line_id where p.id = $1`, [pkg])).rows[0];
    expect(await vatOf(pkg)).toBe(row2.r - row2.v);
    expect(await objSum(C, "package_liability", pkg)).toBe(0);
  });

  it("S6: a DP applied with full VAT room moves −22,000 / +22,000 (VAT unchanged); with no room (exempt line) the deposit's −22,000 is a dated reversal", async () => {
    const pid = await patient(C, C.b1, "Pasien DP PKP");
    const exempt = await as(COWN, (db) => publish(db, { kind: "service", code: "BKP-EXM" }, {
      name: "Layanan Bebas Pajak Buku", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (exempt.approvalId) await as(CFH, (db) => db.query(`select approval_decide($1, true, null)`, [exempt.approvalId]));
    for (const [ver, item, expectLine] of [[svcV, svcItem, 22_000], [exempt.versionId, exempt.itemId, 0]] as const) {
      const dep = await heldDeposit(C, C.b1, pid, ver, CFO, 222_000, 22_000, "taxable_service");
      const { v } = await visitWith(C, pid, C.b1, [ver], CDOC, CFO);
      const { invoiceId } = await as(CFO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
      await as(CFO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
      const vatBefore = await ledgerSum(C, "vat");
      const line = await applyDo(invoiceId, dep, CFO);
      expect(line).not.toBeNull();
      const ev = (await h.admin.query(`select object_kind k, delta::int d from vat_events where source_id = $1 order by object_kind`, [dep])).rows;
      expect(ev).toEqual(expectLine ? [{ k: "deposit", d: -22_000 }, { k: "line", d: 22_000 }] : [{ k: "deposit", d: -22_000 }]);
      // the VAT closing moves by v − V: 0 for a full transfer, −22,000 for the shortfall
      expect(await ledgerSum(C, "vat") - vatBefore).toBe(expectLine - 22_000);
      expect(await objSum(C, "vat", dep)).toBe(0); // received +22,000, applied −22,000
      expect(await objSum(C, "vat", line!)).toBe(expectLine);
      // DP liability: received net 200,000, applied −200,000; paid-not-delivered receives the gross DP and, as its VAT component, the VAT
      // that moved to the line (S6 line leg, opposite sign): net 222,000 − v
      expect(await objSum(C, "booking_dp", dep)).toBe(0);
      expect(await termSum(C, "paid_not_delivered", "dp_applied", dep)).toBe(222_000);
      expect(await objSum(C, "paid_not_delivered", line!)).toBe(222_000 - expectLine);
    }
  });

  it("D-A1: finance records PPN masukan and setoran; corrections need a reason; the period total never below 0; replay; roles; non-PKP refused", async () => {
    const period = today().slice(0, 7);
    const f = { taxPeriod: period, amount: 50_000, date: today(), reference: "FM-0001" };
    const k = key();
    const a = await as(CFIN, (db) => recordVatInputCredit(db, k, f));
    expect((await as(CFIN, (db) => recordVatInputCredit(db, k, f))).replayed).toBe(true);
    expect(await why(as(CFIN, (db) => db.query(`select vat_input_credit_record($1, $2::jsonb)`, [k, JSON.stringify({ tax_period: period, amount: 50_001, effective_on: today(), evidence_ref: "FM-0001" })])))).toMatch(/ERR_IDEMPOTENCY_CONFLICT/);
    expect(await why(as(CFIN, (db) => recordVatInputCredit(db, key(), { ...f, amount: -10_000 })))).toBe("ERR_INVALID_INPUT:reason");
    expect(await why(as(CFIN, (db) => recordVatInputCredit(db, key(), { ...f, amount: -60_000, reason: "Koreksi faktur salah input" })))).toBe("ERR_INVALID_INPUT:below_zero");
    await as(CFIN, (db) => recordVatInputCredit(db, key(), { ...f, amount: -20_000, reason: "Koreksi faktur salah input" }));
    await as(CFIN, (db) => recordVatPayment(db, key(), { taxPeriod: period, amount: 100_000, date: today(), reference: "NTPN0123456789" }));
    for (const p of [COWN, CAU, CMGR, CFO]) expect(await why(as(p, (db) => recordVatPayment(db, key(), { taxPeriod: period, amount: 1, date: today(), reference: "X" }))), p.role).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(FIN, (db) => recordVatPayment(db, key(), { taxPeriod: period, amount: 1, date: today(), reference: "X" })))).toBe("ERR_NOT_AVAILABLE:not_pkp");
    expect(await why(as(CFIN, (db) => recordVatPayment(db, key(), { taxPeriod: "2999-01", amount: 1, date: today(), reference: "X" })))).toBe("ERR_INVALID_INPUT:period");
    const r = await roll(CFIN);
    expect(L(r, "vat").terms.input_credited).toBe(-30_000);
    expect(L(r, "vat").terms.paid).toBe(-100_000);
    expect(r.vat.periods.find((x) => x.period === period)).toMatchObject({ pkp: true, input_recorded: true, paid_recorded: true });
    // append-only, even for the table owner
    expect(await h.admin.query(`update vat_input_credits set amount = 1 where id = $1`, [a.id]).then(() => "ok", (e) => e.message as string)).toMatch(/append-only/);
    expect(await h.admin.query(`delete from vat_payments`).then(() => "ok", (e) => e.message as string)).toMatch(/append-only/);
    expect((await h.admin.query(`select count(*)::int c from audit_events where reason_code in ('vat_input_credited','vat_paid') and tenant_id = $1`, [C.tenantId])).rows[0].c).toBe(3);
  });

  it("an ordinary taxable line paid in full: paid-not-delivered +600,000 net (VAT 66,000 separated), the counted treatment −600,000 (0 after)", async () => {
    const pid = await patient(C, C.b1, "Pasien Baris Pajak");
    // the tenant became PKP in the scenario-16 test above (tests in a file run in order)
    expect((await h.admin.query(`select is_pkp from tenants where id = $1`, [C.tenantId])).rows[0].is_pkp).toBe(true);
    const { v, items } = await visitWith(C, pid, C.b1, [svcV], CDOC, CFO);
    const { invoiceId } = await as(CFO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(CFO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: svcItem, quantity: 1 }]));
    await as(CFO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 666_000, cashTendered: 666_000 }]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    expect(await objSum(C, "paid_not_delivered", line)).toBe(600_000);
    expect(await objSum(C, "vat", line)).toBe(66_000);
    const e = await as(CDOC, (db) => startTreatment(db, key(), v, { planItemId: items[0], performerId: CDOC.staffId, identityConfirmed: true }));
    await as(CDOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    expect(await objSum(C, "paid_not_delivered", line)).toBe(0);
  });

  it("S4 at a close whose own sync reverses: a cheaper substitution lowers the open session VAT, the line's recognition is raised without a sync (fixture), the close's sync records S5 and S4 counts only over the post-sync value", async () => {
    const pid = await patient(C, C.b1);
    const { pkg } = await sell(CFO, pid, pkg2Item, 666_000); // recognised 66,000; open 132,000
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    const { substitutionId } = await as(CFO, (db) => requestSubstitution(db, key(), ss[1], cheapItem, "Kulit sensitif"));
    await as(CDOC, (db) => decideSubstitution(db, key(), substitutionId, true, null)).catch(async () => as(CFH, (db) => decideSubstitution(db, key(), substitutionId, true, null)));
    // open is now 99,000; fixture surgery standing in for a payment whose sync has not run: the line recognises its whole 132,000
    const line = (await h.admin.query(`select invoice_line_id from packages where id = $1`, [pkg])).rows[0].invoice_line_id as string;
    await h.admin.query(`alter table invoice_lines disable trigger invoice_lines_guard`);
    await h.admin.query(`update invoice_lines set vat_recognised_amount = vat_amount where id = $1`, [line]);
    await h.admin.query(`alter table invoice_lines enable always trigger invoice_lines_guard`);
    const before = Number((await h.admin.query(`select vat_reversed_amount from packages where id = $1`, [pkg])).rows[0].vat_reversed_amount);
    await as(CMGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    const after = Number((await h.admin.query(`select vat_reversed_amount from packages where id = $1`, [pkg])).rows[0].vat_reversed_amount);
    const ev = (await h.admin.query(`select cause, delta::int d from vat_events where object_id = $1 and cause in ('package_sync_reversal','package_close_package') order by cause`, [pkg])).rows;
    expect(ev).toEqual([{ cause: "package_close_package", d: -99_000 }, { cause: "package_sync_reversal", d: -33_000 }]);
    expect(ev.reduce((x, r) => x + r.d, 0)).toBe(-(after - before));
    // the fixture raised the line's recognition with no dated fact: the package comparator reports this package (expected 0, ledger 66,000)
    expect(await mismatchOf(pkg)).toEqual([{ id: pkg, ledger: 66_000, expected: 0 }]);
  });

  // ── Sol impl r1 repairs (r2): P1-1 S1 only for non-PKP-at-issue packages; P1-2 S1b/S5b attribution and tax-category-changing
  // substitutions; positive-VAT S2; S3 after the cutover; the package object reconstruction; the receipts invariant ──
  async function svc(code: string, name: string, price: number, tax: "taxable_service" | "exempt_medical") {
    const v = await as(COWN, (db) => publish(db, { kind: "service", code }, {
      name, tax_category: tax, tax_basis: tax === "taxable_service" ? "Jasa" : "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (v.approvalId) await as(CFH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  }
  const substitute = async (session: string, item: string) => {
    const { substitutionId } = await as(CFO, (db) => requestSubstitution(db, key(), session, item, "Penggantian layanan uji"));
    await as(CDOC, (db) => decideSubstitution(db, key(), substitutionId, true, null)).catch(async () => as(CFH, (db) => decideSubstitution(db, key(), substitutionId, true, null)));
    return substitutionId;
  };
  const evOf = async (objectId: string) => (await h.admin.query(`select cause, object_kind k, delta::int d from vat_events where object_id = $1 or source_id = $1 order by cause, object_kind`, [objectId])).rows;

  it("P1-1: a PKP-at-issue exempt package, an equal-price exempt → taxable substitution, redeemed while PKP: no S1 event, VAT closing 0, package liability 0 after close", async () => {
    const exm = await svc("BKP-EXM2", "Layanan Bebas Sama Harga", 666_000, "exempt_medical");
    const tax2 = await svc("BKP-TXS", "Layanan Pajak Sama Harga", 666_000, "taxable_service");
    const item = await packageItem({ own: COWN }, "BKP-EXP", 1_332_000, [{ serviceItemId: exm.itemId, count: 2 }]);
    const pid = await patient(C, C.b1);
    const { pkg } = await sell(CFO, pid, item, 1_332_000);
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    await substitute(ss[0], tax2.itemId);
    await redeem(C, pkg, pid, C.b1, tax2.versionId, CDOC, CFO, tax2.itemId);
    expect((await h.admin.query(`select count(*)::int c from vat_events where object_id = $1 and cause = 'session_delivery'`, [ss[0]])).rows[0].c).toBe(0);
    expect(await vatOf(ss[0])).toBe(0);
    expect(await vatOf(pkg)).toBe(0);
    await as(CMGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    expect(await objSum(C, "package_liability", pkg)).toBe(0);
  });

  it("P1-2: taxable → exempt cheaper substitution (fully paid, VAT 66,000 reversed by S5) and exempt-target redemption; exempt → taxable cheaper: liability exact, 0 after close", async () => {
    const exm = await svc("BKP-EXC", "Layanan Bebas Murah", 333_000, "exempt_medical");
    // taxable package of 2 × 666,000, fully paid (VAT 132,000), session 1 → exempt 333,000
    const pid = await patient(C, C.b1);
    const { pkg } = await sell(CFO, pid, pkg2Item, 1_332_000);
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    const u = await substitute(ss[0], exm.itemId);
    // moved 333,000 gross; the session's 66,000 VAT reversed (S5): the liability falls by 267,000 → 1,200,000 − 267,000 = 933,000
    expect(await termSum(C, "package_liability", "substitution", u)).toBe(-333_000);
    expect(await objSum(C, "package_liability", pkg)).toBe(933_000);
    expect((await evOf(pkg)).filter((r) => r.cause === "package_sync_reversal").reduce((x, r) => x + r.d, 0)).toBe(-66_000);
    // redeem the substituted (exempt) session: −333,000, no VAT attributed; the taxable one: −666,000 + 66,000 attributed
    await redeem(C, pkg, pid, C.b1, exm.versionId, CDOC, CFO, exm.itemId);
    expect(await objSum(C, "package_liability", pkg)).toBe(600_000);
    expect(await mismatchOf(pkg)).toEqual([]);
    await as(CMGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    expect(await objSum(C, "package_liability", pkg)).toBe(0);
    // an exempt package (not PKP-taxable) with a cheaper taxable substitute: no VAT anywhere, liability = gross
    const cheapTax = await svc("BKP-TXC", "Layanan Pajak Murah", 333_000, "taxable_service");
    const exPkgItem = await packageItem({ own: COWN }, "BKP-EX2", 1_332_000, [{ serviceItemId: (await svc("BKP-EX6", "Layanan Bebas Penuh", 666_000, "exempt_medical")).itemId, count: 2 }]);
    const pid2 = await patient(C, C.b1);
    const { pkg: p2 } = await sell(CFO, pid2, exPkgItem, 1_332_000);
    const s2 = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [p2])).rows.map((x) => x.id as string);
    await substitute(s2[0], cheapTax.itemId);
    expect(await objSum(C, "package_liability", p2)).toBe(1_332_000 - 333_000);
    await redeem(C, p2, pid2, C.b1, cheapTax.versionId, CDOC, CFO, cheapTax.itemId);
    expect(await objSum(C, "package_liability", p2)).toBe(666_000);
    expect(await vatOf(p2)).toBe(0);
  });

  it("S1b / S5b: a partly paid PKP package, a redemption (attribution at delivery), a later payment raising the redeemed session's recognition (S5b): each pair nets 0, the liability stays exact", async () => {
    const pid = await patient(C, C.b1);
    const { invoiceId, pkg } = await sell(CFO, pid, pkg2Item, 699_300); // recognition 69,930 → one session 66,000 + 3,930 on the next
    await redeem(C, pkg, pid, C.b1, svcV, CDOC, CFO);
    const s1 = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg])).rows[0].id as string;
    const pairs = async () => (await h.admin.query(`select object_kind k, sum(delta)::int d from vat_events where cause = 'session_attribution' and source_id = $1 group by 1 order by 1`, [s1])).rows;
    expect(await pairs()).toEqual([{ k: "package", d: -66_000 }, { k: "session", d: 66_000 }]);
    expect(await termSum(C, "package_liability", "redemption", s1)).toBe(-666_000);
    await as(CFO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 632_700, cashTendered: 632_700 }]));
    const rec = Number((await h.admin.query(`select vat_recognised_amount from package_sessions where id = $1`, [s1])).rows[0].vat_recognised_amount);
    const p = await pairs();
    expect(p.reduce((x, r) => x + r.d, 0)).toBe(0);
    expect(p.find((r) => r.k === "session")!.d).toBe(rec);
    // the liability: paid net (1,332,000 − 132,000) − delivered (666,000 − 66,000) = 600,000, exact by the package reconstruction
    expect(await objSum(C, "package_liability", pkg)).toBe(600_000);
    expect(await mismatchOf(pkg)).toEqual([]);
    // a mutation of the session's mutable fields after delivery changes nothing in the liability (it never reads them)
    await h.admin.query(`alter table package_sessions disable trigger package_sessions_guard`);
    await h.admin.query(`update package_sessions set tax_category = 'exempt_medical' where id = $1`, [s1]);
    await h.admin.query(`alter table package_sessions enable always trigger package_sessions_guard`);
    expect(await objSum(C, "package_liability", pkg)).toBe(600_000);
  });

  it("S2 positive VAT: a taxable addition delivered unpaid, converted: S2 +VAT dated at conversion, the line's paid-not-delivered 0; S3: a paid taxable interrupted treatment after the cutover: −VAT, the line 0", async () => {
    // an approved addition released before payment (scenario 3 path), taxable at a PKP tenant: delivered unpaid, billed, converted
    const pid = await patient(C, C.b1);
    const { v, items, planId } = await visitWith(C, pid, C.b1, [svcV], CDOC, CFO);
    const CBC = await person(C, "bc", C.b1);
    const CNUR = await person(C, "nurse", C.b1);
    await as(CBC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId: first } = await as(CFO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(CFO, (db) => issueKasirInvoice(db, key(), first, [{ itemId: svcItem, quantity: 1 }]));
    await as(CFO, (db) => receivePayment(db, key(), first, [{ method: "cash", amount: 666_000, cashTendered: 666_000 }]));
    const { requestId } = await as(CNUR, (db) => createRequest(db, key(), v, { kind: "addition", planId, catalogVersionId: svcV, stage: 1, qty: 1, reason: "Area tambahan" }));
    const dec = await as(CDOC, (db) => decideRequest(db, key(), requestId, true, null));
    const addItem = (dec as { item_id: string }).item_id;
    const ct = await as(CDOC, (db) => consentText(db, v, planId));
    await as(CDOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(CFO, (db) => releaseAddition(db, key(), addItem, CFO.staffId));
    const e = await as(CDOC, (db) => startTreatment(db, key(), v, { planItemId: addItem, performerId: CDOC.staffId, identityConfirmed: true }));
    await as(CDOC, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const { invoiceId } = await as(CFO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(CFO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: svcItem, quantity: 1, planItemId: addItem }]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    expect(await objSum(C, "paid_not_delivered", line)).toBe(-600_000); // delivered before payment: contractual net
    const rc = await as(CFO, (db) => convertToReceivable(db, key(), v));
    expect((await h.admin.query(`select delta::int d from vat_events where cause = 'receivable_convert' and object_id = $1`, [line])).rows).toEqual([{ d: 66_000 }]);
    expect(await objSum(C, "paid_not_delivered", line)).toBe(0);
    expect(await objSum(C, "receivables", rc.receivable_id)).toBe(666_000);
    // S3: a paid taxable single treatment medically stopped, moved to balance
    const pid2 = await patient(C, C.b1);
    const w = await visitWith(C, pid2, C.b1, [svcV], CDOC, CFO);
    const { invoiceId: i2 } = await as(CFO, (db) => openKasirInvoice(db, key(), { patientId: pid2, visitId: w.v }));
    await as(CFO, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: svcItem, quantity: 1 }]));
    await as(CFO, (db) => receivePayment(db, key(), i2, [{ method: "cash", amount: 666_000, cashTendered: 666_000 }]));
    const e2 = await as(CDOC, (db) => startTreatment(db, key(), w.v, { planItemId: w.items[0], performerId: CDOC.staffId, identityConfirmed: true }));
    await as(CDOC, (db) => finishTreatment(db, key(), e2.executionId, { outcome: "medical_stop", reason: "Alasan berhenti uji" }));
    await as(CFO, (db) => interruptedToBalance(db, key(), e2.executionId));
    const l2 = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [i2])).rows[0].id as string;
    expect((await h.admin.query(`select delta::int d from vat_events where cause = 'interrupted' and object_id = $1`, [l2])).rows).toEqual([{ d: -66_000 }]);
    expect(await objSum(C, "paid_not_delivered", l2)).toBe(0);
    expect(await vatOf(l2)).toBe(0);
  });

  it("a difference line refunded before redemption and another before close: each refund debits the package liability once; the package object reconstruction matches", async () => {
    const pricier = await svc("BKP-PRC", "Layanan Pajak Mahal", 888_000, "taxable_service");
    const pid = await patient(C, C.b1);
    const { pkg } = await sell(CFO, pid, pkg2Item, 1_332_000);
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    const lines: string[] = [];
    for (const sess of ss) {
      const u = await substitute(sess, pricier.itemId);
      const { invoiceId } = await as(CFO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
      await as(CFO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pricier.itemId, quantity: 1, substitutionId: u }]));
      await as(CFO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 222_000, cashTendered: 222_000 }]));
      lines.push((await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string);
    }
    // refund the first difference line (before its session is redeemed), then redeem that session: no difference money left in it
    const r1 = await as(CFO, (db) => requestRefund(db, key(), lines[0], { amount: 222_000, reason: "Batal selisih" }));
    expect(await termSum(C, "package_liability", "refund", r1.refund_id)).toBe(-222_000);
    await redeem(C, pkg, pid, C.b1, pricier.versionId, CDOC, CFO, pricier.itemId);
    const redeemed = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg])).rows[0].id as string;
    expect(redeemed).toBe(ss[0]);
    expect(await termSum(C, "package_liability", "redemption", ss[0])).toBe(-666_000);
    // refund the second difference line, then close: nothing left
    await as(CFO, (db) => requestRefund(db, key(), lines[1], { amount: 222_000, reason: "Batal selisih kedua" }));
    expect(await mismatchOf(pkg)).toEqual([]);
    await as(CMGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    expect(await objSum(C, "package_liability", pkg)).toBe(0);
    for (const l of lines) expect(await vatOf(l)).toBe(0);
  });

  it("P1-4 comparators: corrupting a stored fact behind the ledger (fixture surgery) is reported — package (open, reconstruction from stored state), receipts invariant, commission per recipient", async () => {
    const pid = await patient(C, C.b1);
    const { pkg } = await sell(CFO, pid, pkg2Item, 1_332_000);
    await redeem(C, pkg, pid, C.b1, svcV, CDOC, CFO);
    const clean = await roll(CFIN);
    expect([await mismatchOf(pkg), clean.checks.receipts.mismatches, clean.checks.receipts.ledger_mismatch]).toEqual([[], 0, false]);
    // the package's own moved_to_balance is outside the ledger's facts; the reconstruction reads the stored allocations, substitutions,
    // sessions and VAT positions: a redeemed session whose allocated value is changed behind the writers makes the two disagree
    const s1 = (await h.admin.query(`select id from package_sessions where package_id = $1 and state = 'redeemed'`, [pkg])).rows[0].id as string;
    const surgery = async (sql: string, args: unknown[], table: string) => {
      const tg = (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [table])).rows.map((r) => r.tgname as string);
      for (const t of tg) await h.admin.query(`alter table ${table} disable trigger ${t}`);
      try { await h.admin.query(sql, args); } finally { for (const t of tg) await h.admin.query(`alter table ${table} enable always trigger ${t}`); }
    };
    // a payment row raised above its allocations' sum stays consistent (unallocated grows); an allocation raised above its payment does not
    const pay = (await h.admin.query(`select a.id, a.payment_id from payment_allocations a join packages p on p.invoice_line_id = a.invoice_line_id where p.id = $1 limit 1`, [pkg])).rows[0];
    await surgery(`update payments set amount = amount - 5000, cash_tendered = cash_tendered - 5000 where id = $1`, [pay.payment_id], "payments");
    const r1 = await roll(CFIN);
    expect(r1.checks.receipts.mismatches).toBeGreaterThan(0);
    await surgery(`update payments set amount = amount + 5000, cash_tendered = cash_tendered + 5000 where id = $1`, [pay.payment_id], "payments");
    expect((await roll(CFIN)).checks.receipts.mismatches).toBe(0);
    // the package object: the session's VAT attribution rows removed (as if S1b had not run) — the ledger and the reconstruction disagree
    await surgery(`delete from vat_events where cause = 'session_attribution' and source_id = $1`, [s1], "vat_events");
    expect(await mismatchOf(pkg)).toHaveLength(1);
    expect((await roll(CFIN)).checks.package_liability.mismatches).toBeGreaterThanOrEqual(1);
    await as(CMGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
  });

  it("concurrency: two corrections racing on one period (each fits alone, not both) — exactly one wins under the tenant VAT lock; one key sent twice at once records once", async () => {
    const period = today().slice(0, 7);
    const base = { taxPeriod: period, date: today(), reference: "NTPN-KONKUREN-01" };
    const fin2 = await person(C, "finance");
    const total = async () => Number((await h.admin.query(`select coalesce(sum(amount), 0) s from vat_payments where tenant_id = $1 and tax_period = $2`, [C.tenantId, period])).rows[0].s);
    await as(CFIN, (db) => recordVatPayment(db, key(), { ...base, amount: 100_000 }));
    const t0 = await total();
    const cut = -Math.floor(t0 * 0.6);
    const res = await Promise.all([CFIN, fin2].map((p) => why(as(p, (db) => recordVatPayment(db, key(), { ...base, amount: cut, reason: "Koreksi setoran ganda (uji konkurensi)" })))));
    expect(res.sort()).toEqual(["ERR_INVALID_INPUT:below_zero", "ok"]);
    expect(await total()).toBe(t0 + cut);
    const k = key();
    const twice = await Promise.all([0, 1].map(() => as(CFIN, (db) => recordVatPayment(db, k, { ...base, amount: 7_000 })).then((r) => r.id, (e) => `err:${e.code ?? e.message}`)));
    expect(twice[0]).toBe(twice[1]);
    expect((await h.admin.query(`select count(*)::int c from vat_payments where tenant_id = $1 and command_key = $2`, [C.tenantId, k])).rows[0].c).toBe(1);
  });
});

describe("cutover (D-C1)", () => {
  it("an existing tenant's residue is only what no dated fact explains; reports before the cutover claim no VAT closing; straddling: opening incomplete", async () => {
    // legacy facts: a PKP package paid (dated vat_portion), then its seam reversals erased from vat_events (as if before 0121)
    const t = await tenant("PT Cutover Sintetis");
    const own = await person(t, "owner"); const fin = await person(t, "finance"); const fo = await person(t, "fo_cashier", t.b1);
    const fh = await person(t, "facility_head", t.b1); const mgr = await person(t, "manager", t.b1);
    const s = await as(own, (db) => publish(db, { kind: "service", code: "CO-SVC" }, {
      name: "Layanan Cutover", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (s.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [s.approvalId]));
    const item = await packageItem({ own }, "CO-PKG", 1_332_000, [{ serviceItemId: s.itemId, count: 2 }], "taxable_service");
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak cutover\n%%EOF\n`);
    const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(own, (db) => decideEvidence(db, ev, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(own, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrowWib(), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 40, changed_at = now() - interval '45 days' where tenant_id = $1`, [t.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 40 where id = $1`, [t.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    const pid = await patient(t, t.b1);
    const { pkg } = await sell(fo, pid, item, 1_332_000); // VAT 132,000 at payment (dated)
    await as(mgr, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota")); // S4 −132,000 recorded
    // legacy applied deposits: one full transfer (v = V = 22,000) and one shortfall (exempt line: v = 0 < V)
    const doc = await person(t, "doctor", t.b1);
    await credential(t, doc, t.b1, fh, own);
    const exm = await as(own, (db) => publish(db, { kind: "service", code: "CO-EXM" }, {
      name: "Layanan Bebas Cutover", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (exm.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [exm.approvalId]));
    const legacy: { dep: string; line: string; v: number }[] = [];
    for (const [ver, it, v] of [[s.versionId, s.itemId, 22_000], [exm.versionId, exm.itemId, 0]] as const) {
      const dep = await heldDeposit(t, t.b1, pid, ver, fo, 222_000, 22_000, "taxable_service");
      const { v: visit } = await visitWith(t, pid, t.b1, [ver], doc, fo);
      const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: visit }));
      await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: it, quantity: 1 }]));
      legacy.push({ dep, line: (await applyDo(invoiceId, dep, fo))!, v });
    }
    // pretend it all happened before 0121: drop the seam events, then open the cutover now
    await h.admin.query(`alter table vat_events disable trigger vat_events_append_only`);
    await h.admin.query(`delete from vat_events where tenant_id = $1`, [t.tenantId]);
    await h.admin.query(`alter table vat_events enable always trigger vat_events_append_only`);
    await shift("payment_allocations", ["created_at"], "tenant_id = $1", [t.tenantId], "20 days");
    await shift("booking_deposits", ["received_at", "decided_at"], "tenant_id = $1", [t.tenantId], "20 days");
    expect((await h.admin.query(`select vat_cutover_open($1, now())`, [t.tenantId])).rows[0].vat_cutover_open).toBe(4);
    const open = (await h.admin.query(`select object_kind, object_id, amount::int a from vat_cutover_openings where tenant_id = $1`, [t.tenantId])).rows;
    const res = Object.fromEntries(open.map((r) => [`${r.object_kind}:${r.object_id}`, r.a]));
    expect(res[`package:${pkg}`]).toBe(-132_000); // only the unrecorded close reversal; the payment VAT stays dated
    // legacy DP application: −V on each deposit, +v on the line (none for the shortfall); no attribution invented
    for (const x of legacy) {
      expect(res[`deposit:${x.dep}`]).toBe(-22_000);
      expect(res[`line:${x.line}`]).toBe(x.v || undefined);
      expect(await objSum(t, "vat", x.dep) + await objSum(t, "vat", x.line)).toBe(x.v); // received +22,000, residue −22,000 (+ v)
    }
    expect(await objSum(t, "vat", pkg)).toBe(0);
    // a report ending before the cutover claims no closing; a straddling one has an incomplete opening
    const before = await roll(fin, wib(-30 * 86_400_000), wib(-1 * 86_400_000));
    expect([before.vat.closing_complete, before.vat.opening_complete]).toEqual([false, false]);
    const straddle = await roll(fin, wib(-30 * 86_400_000), today());
    expect([straddle.vat.closing_complete, straddle.vat.opening_complete]).toEqual([true, false]);
    expect(L(straddle, "vat").terms.cutover_residue).toBe(-132_000 - 22_000 - 22_000 + 22_000);
    // a tenant with a cutover but no residue at all: every ledger is exact before the cutover too (the label is gated by the residue)
    const t2 = await tenant("PT Cutover Bersih");
    const fin2 = await person(t2, "finance");
    await h.admin.query(`select vat_cutover_open($1, now())`, [t2.tenantId]);
    const clean = await roll(fin2, wib(-30 * 86_400_000), wib(-1 * 86_400_000));
    expect(Object.values(clean.ledgers).every((l) => l.closing_complete && l.opening_complete)).toBe(true);
    expect([clean.vat.closing_complete, clean.vat.opening_complete]).toEqual([true, true]);
    // a new tenant (no cutover row) is complete from its start
    const nu = await roll(BFIN);
    expect([nu.vat.cutover_at, nu.vat.closing_complete]).toEqual([null, true]);
  });
});

describe("r2 coverage: consultation re-charge across periods, supplier payment reversed, pre-cutover partially paid interrupted addition", () => {
  it("a consultation waived by a purchase in month 1 and re-charged by its refund in month 2: performance dated at recharged_at (month 2), not at the waiver", async () => {
    const t = await tenant("PT Konsultasi Sintetis");
    const own = await person(t, "owner"); const fh = await person(t, "facility_head", t.b1); const fo = await person(t, "fo_cashier", t.b1);
    const doc = await person(t, "doctor", t.b1);
    await credential(t, doc, t.b1, fh, own);
    const k = await as(own, (db) => publish(db, { kind: "service", code: "KS-KON" }, {
      name: "Konsultasi Buku", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 99_000, category: "consultation", prep_min: 0, treatment_min: 15,
      buffer_min: 0, indications: "Indikasi", consent_template: "Templat konsultasi.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (k.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [k.approvalId]));
    const prod = await as(own, (db) => publish(db, { kind: "service", code: "KS-SVC" }, {
      name: "Layanan Pembeli Buku", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 333_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (prod.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [prod.approvalId]));
    await as(own, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
    const pid = await patient(t, t.b1);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t.tenantId, t.b1, pid, fo.staffId])).rows[0].id as string;
    const { examId } = await as(doc, (db) => openExam(db, key(), v));
    await as(doc, (db) => signRecord(db, key(), examId, STEP));
    const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: prod.itemId, quantity: 1 }]));
    await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 333_000, cashTendered: 333_000 }]));
    await as(fo, (db) => closeVisit(db, key(), v));
    const fee = (await h.admin.query(`select id, state from consultation_fees where visit_id = $1`, [v])).rows[0];
    expect(fee.state).toBe("waived");
    // the waiver moved to month 1 (35 days back); the refund (month 2: today) re-charges the fee from the balance
    await shift("consultation_fees", ["decided_at"], "id = $1", [fee.id], "35 days");
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    await as(fo, (db) => requestRefund(db, key(), line, { amount: 333_000, reason: "Pasien batal layanan" }));
    const f2 = (await h.admin.query(`select state, recharged_at, fee_line_id from consultation_fees where id = $1`, [fee.id])).rows[0];
    expect(f2.state).toBe("recharged");
    const rows = (await h.admin.query(`select day::text d, amount::int a from subledger_movements($1) where ledger = 'paid_not_delivered' and term = 'performance' and source_id = $2`, [t.tenantId, fee.id])).rows;
    expect(rows).toEqual([{ d: today(), a: -150_000 }]); // dated at the re-charge (today), the waiver month has no performance
    expect(await objSum(t, "paid_not_delivered", f2.fee_line_id)).toBe(0); // charged from the balance and performed: net 0
  });

  it("a supplier payment recorded then reversed: the outflow on its paid_on day, the reversal inflow at reversed_at; cash nets 0", async () => {
    const t = await tenant("PT Pemasok Sintetis");
    const fin = await person(t, "finance"); const pur = await person(t, "purchasing");
    const sup = (await as(pur, (db) => saveSupplier(db, key(), null, { name: "CV Pemasok Buku", paymentTermsDays: 14 }))).supplierId;
    const { paymentId } = await as(fin, (db) => recordPayment(db, key(), t.b1, { supplierId: sup, amount: 450_000, method: "bank_transfer", paidOn: wib(-2 * 86_400_000) }));
    await as(fin, (db) => reversePayable(db, key(), "payment", paymentId, "Salah pemasok"));
    const rows = (await h.admin.query(`select term, day::text d, amount::int a from subledger_movements($1) where ledger = 'cash_bank' and source_id = $2 order by at`, [t.tenantId, paymentId])).rows;
    expect(rows).toEqual([{ term: "supplier_payment", d: wib(-2 * 86_400_000), a: -450_000 }, { term: "supplier_payment_reversed", d: today(), a: 450_000 }]);
  });

  it("pre-cutover partially paid interrupted taxable addition: the reversal reconstructed from dated facts (writer formula) — VAT −16,500, paid-not-delivered exact, no residue, closing complete", async () => {
    const t = await tenant("PT Interupsi Sintetis");
    const own = await person(t, "owner"); const fin = await person(t, "finance"); const fo = await person(t, "fo_cashier", t.b1); const fh = await person(t, "facility_head", t.b1);
    const doc = await person(t, "doctor", t.b1); const nur = await person(t, "nurse", t.b1); const bc = await person(t, "bc", t.b1);
    await credential(t, doc, t.b1, fh, own);
    const s = await as(own, (db) => publish(db, { kind: "service", code: "IN-SVC" }, {
      name: "Layanan Pajak Interupsi", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (s.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [s.approvalId]));
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak interupsi\n%%EOF\n`);
    const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(own, (db) => decideEvidence(db, ev, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(own, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrowWib(), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 40, changed_at = now() - interval '45 days' where tenant_id = $1`, [t.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 40 where id = $1`, [t.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    const pid = await patient(t, t.b1);
    const { v, items, planId } = await visitWith(t, pid, t.b1, [s.versionId], doc, fo);
    await as(bc, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: items[0] }] }));
    const { invoiceId: first } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(fo, (db) => issueKasirInvoice(db, key(), first, [{ itemId: s.itemId, quantity: 1 }]));
    await as(fo, (db) => receivePayment(db, key(), first, [{ method: "cash", amount: 666_000, cashTendered: 666_000 }]));
    const { requestId } = await as(nur, (db) => createRequest(db, key(), v, { kind: "addition", planId, catalogVersionId: s.versionId, stage: 1, qty: 1, reason: "Area tambahan" }));
    const dec = await as(doc, (db) => decideRequest(db, key(), requestId, true, null));
    const addItem = (dec as { item_id: string }).item_id;
    const ct = await as(doc, (db) => consentText(db, v, planId));
    await as(doc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
    await as(fo, (db) => releaseAddition(db, key(), addItem, fo.staffId));
    const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: s.itemId, quantity: 1, planItemId: addItem }]));
    await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 333_000, cashTendered: 333_000 }])); // half paid: VAT 33,000
    const e = await as(doc, (db) => startTreatment(db, key(), v, { planItemId: addItem, performerId: doc.staffId, identityConfirmed: true }));
    await as(doc, (db) => finishTreatment(db, key(), e.executionId, { outcome: "medical_stop", reason: "Alasan berhenti uji" }));
    await as(fo, (db) => interruptedToBalance(db, key(), e.executionId));
    const line = (await h.admin.query(`select id, vat_recognised_amount::int r, vat_reversed_amount::int x from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0];
    expect([line.r, line.x]).toEqual([33_000, 16_500]); // the writer reverses 33,000 × 333,000 / 666,000
    // make it pre-cutover: drop its S3 event, move the facts back, open the cutover now
    await h.admin.query(`alter table vat_events disable trigger vat_events_append_only`);
    await h.admin.query(`delete from vat_events where tenant_id = $1`, [t.tenantId]);
    await h.admin.query(`alter table vat_events enable always trigger vat_events_append_only`);
    await shift("payment_allocations", ["created_at"], "tenant_id = $1", [t.tenantId], "10 days");
    await shift("balance_entries", ["created_at"], "tenant_id = $1", [t.tenantId], "9 days");
    await h.admin.query(`select vat_cutover_open($1, now())`, [t.tenantId]);
    expect((await h.admin.query(`select count(*)::int c from vat_cutover_openings where tenant_id = $1 and object_id = $2`, [t.tenantId, line.id])).rows[0].c).toBe(0);
    expect(await objSum(t, "vat", line.id)).toBe(16_500); // recognised 33,000 − reconstructed reversal 16,500
    // paid 333,000 − moved 333,000 = 0 gross; the VAT component (−33,000 + 16,500) → paid-not-delivered −16,500 ... the writer leaves
    // 16,500 recognised on money that moved to balance (a writer finding, reported); the reader shows exactly what the facts say
    expect(await objSum(t, "paid_not_delivered", line.id)).toBe(-16_500);
    const r = await roll(fin, wib(-30 * 86_400_000), today());
    expect([r.ledgers.paid_not_delivered.closing_complete, r.ledgers.vat.closing_complete]).toEqual([true, true]);
  });
});

describe("Sol impl r2 repairs (r3): reconstruction frozen at the cutover, residue dates per branch, comparator status, carry-in contract", () => {
  async function pkpTenant(name: string, tz2?: string) {
    const t = await tenant(name);
    if (tz2) await h.admin.query(`update branches set timezone = $2 where id = $1`, [t.b2, tz2]);
    const own = await person(t, "owner"); const fin = await person(t, "finance"); const fo = await person(t, "fo_cashier", t.b1); const fh = await person(t, "facility_head", t.b1);
    const doc = await person(t, "doctor", t.b1);
    await credential(t, doc, t.b1, fh, own);
    const s = await as(own, (db) => publish(db, { kind: "service", code: `R3-${name.slice(3, 9).toUpperCase().replace(/\W/g, "")}` }, {
      name: `Layanan Pajak ${name}`, tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (s.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [s.approvalId]));
    const pdf = Buffer.from(`%PDF-1.7\nsaran ${name}\n%%EOF\n`);
    const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(own, (db) => decideEvidence(db, ev, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(own, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrowWib(), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 40, changed_at = now() - interval '45 days' where tenant_id = $1`, [t.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 40 where id = $1`, [t.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    return { t, own, fin, fo, doc, s };
  }

  it("#1: a reconstructed pre-cutover interruption stays put after a later interruption on the same line (S3) — VAT 0 and paid-not-delivered exact; the earlier report unchanged", async () => {
    const { t, fin, fo, doc, s } = await pkpTenant("PT Rekonstruksi Tetap");
    const pid = await patient(t, t.b1);
    const { v, items } = await visitWith(t, pid, t.b1, [s.versionId, s.versionId], doc, fo);
    const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: s.itemId, quantity: 2 }]));
    await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_332_000, cashTendered: 1_332_000 }]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    const stop = async (item: string) => {
      const e = await as(doc, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: doc.staffId, identityConfirmed: true }));
      await as(doc, (db) => finishTreatment(db, key(), e.executionId, { outcome: "medical_stop", reason: "Alasan berhenti uji" }));
      await as(fo, (db) => interruptedToBalance(db, key(), e.executionId));
    };
    await stop(items[0]); // −66,000 (writer), S3 recorded
    // make it pre-cutover (drop its S3, move the facts back), open the cutover now: reconstructed −66,000, no residue
    await h.admin.query(`alter table vat_events disable trigger vat_events_append_only`);
    await h.admin.query(`delete from vat_events where tenant_id = $1`, [t.tenantId]);
    await h.admin.query(`alter table vat_events enable always trigger vat_events_append_only`);
    await shift("payment_allocations", ["created_at"], "tenant_id = $1", [t.tenantId], "10 days");
    await shift("balance_entries", ["created_at"], "tenant_id = $1", [t.tenantId], "9 days");
    await h.admin.query(`select vat_cutover_open($1, now() - interval '1 day')`, [t.tenantId]);
    expect((await h.admin.query(`select count(*)::int c from vat_cutover_openings where tenant_id = $1`, [t.tenantId])).rows[0].c).toBe(0);
    expect(await objSum(t, "vat", line)).toBe(66_000);
    const earlier = await roll(fin, wib(-12 * 86_400_000), wib(-5 * 86_400_000));
    // the second unit interrupted after the cutover (S3 −66,000): the first reconstruction must not disappear
    await stop(items[1]);
    expect((await h.admin.query(`select delta::int d from vat_events where cause = 'interrupted' and object_id = $1`, [line])).rows).toEqual([{ d: -66_000 }]);
    expect(await objSum(t, "vat", line)).toBe(0);
    expect(await objSum(t, "paid_not_delivered", line)).toBe(0);
    const again = await roll(fin, wib(-12 * 86_400_000), wib(-5 * 86_400_000));
    expect([again.ledgers.vat.closing, again.ledgers.paid_not_delivered.closing]).toEqual([earlier.ledgers.vat.closing, earlier.ledgers.paid_not_delivered.closing]);
  });

  it("#2: a residue on a Jayapura branch's object completes the closing only from that branch's local cutover date, not the tenant default's", async () => {
    const { t, fin } = await pkpTenant("PT Zona Waktu", "Asia/Jayapura");
    // the cutover at 16:30 UTC: 23:30 in Jakarta (b1, the earliest branch) and 01:30 next day in Jayapura (b2)
    const cutUtc = new Date(`${wib(-10 * 86_400_000)}T16:30:00Z`);
    const jakDay = cutUtc.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const jayDay = cutUtc.toLocaleDateString("en-CA", { timeZone: "Asia/Jayapura" });
    expect(jayDay > jakDay).toBe(true);
    await h.admin.query(`insert into vat_cutovers (tenant_id, cutover_at) values ($1, $2)`, [t.tenantId, cutUtc]);
    // a residue on a line object of branch 2 (paid-not-delivered's VAT component)
    await h.admin.query(`insert into vat_cutover_openings (tenant_id, branch_id, object_kind, object_id, amount, cutover_at) values ($1, $2, 'line', gen_random_uuid(), 11000, $3)`,
      [t.tenantId, t.b2, cutUtc]);
    const r = await roll(fin, wib(-20 * 86_400_000), jakDay); // ends on the Jakarta cutover day: the Jayapura residue (next day) is not inside
    expect([r.ledgers.paid_not_delivered.closing_complete, r.ledgers.vat.closing_complete]).toEqual([false, false]);
    const r2 = await roll(fin, wib(-20 * 86_400_000), jayDay);
    expect([r2.ledgers.paid_not_delivered.closing_complete, r2.ledgers.vat.closing_complete]).toEqual([true, true]);
    const r3 = await roll(fin, jayDay, today()); // the opening on the Jayapura cutover day excludes that day's residue
    expect(r3.ledgers.paid_not_delivered.opening_complete).toBe(false);
  });

  it("#3: the package comparator reports when it did not run (branch view, historical day) or skipped residue packages — never as a match", async () => {
    const r = await roll(FIN, wib(-40 * 86_400_000), wib(-35 * 86_400_000));
    expect(r.checks.package_liability).toMatchObject({ ran: false, reason: "historical" });
    const b = await roll(FIN, monthStart(), today(), A.b1);
    expect(b.checks.package_liability).toMatchObject({ ran: false, reason: "branch_view" });
    expect((await roll(FIN)).checks.package_liability.ran).toBe(true);
  });

  it("#4: carry-in per the writer's contract — an approved-but-unpaid predecessor's carry-out is a valid carry-in (no mismatch); a corrupted carry-in is reported", async () => {
    const t = await tenant("PT Komisi Bawa");
    const fin = await person(t, "finance");
    const own = await person(t, "owner");
    const staff = (await person(t, "bc", t.b1)).staffId;
    // batches built directly (fixture surgery) with real approval rows (FK); states as the writers would leave them
    const batch = async (monthsAgo: number, state: string, line: { gross: number; adj: number; cfIn: number; net: number; cfOut: number }) => {
      const ta = (await h.admin.query(`select tgname from pg_trigger where tgrelid = 'approvals'::regclass and not tgisinternal and tgenabled <> 'D'`)).rows.map((x) => x.tgname as string);
      for (const g of ta) await h.admin.query(`alter table approvals disable trigger ${g}`);
      let ap: string;
      try {
        ap = (await h.admin.query(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, amount_rupiah, state, requested_by, requested_as, decided_by, decided_as, decided_at)
          values ($1, 'commission_batch', 'payout_batch', gen_random_uuid(), 'Uji carry-forward', 1, 'approved', $2, 'finance', $3, 'owner', now()) returning id`, [t.tenantId, fin.staffId, own.staffId])).rows[0].id as string;
      } finally { for (const g of ta) await h.admin.query(`alter table approvals enable always trigger ${g}`); }
      const start = new Date(Date.UTC(2026, 9, 1)); start.setUTCMonth(start.getUTCMonth() - monthsAgo);
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      const tg = (await h.admin.query(`select tgname from pg_trigger where tgrelid = 'payout_batches'::regclass and not tgisinternal and tgenabled <> 'D'`)).rows.map((x) => x.tgname as string);
      for (const g of tg) await h.admin.query(`alter table payout_batches disable trigger ${g}`);
      let b: string;
      try {
        b = (await h.admin.query(`insert into payout_batches (tenant_id, period_key, period_start, period_end, closing_day, state, approval_id, submitted_by, submitted_at, paid_by, paid_at, paid_method, created_by, command_key)
          values ($1, to_char($2::timestamptz, 'YYYY-MM'), $2::timestamptz, $3::timestamptz, '25', $4::text, $5::uuid, $6::uuid, $3::timestamptz, case when $4::text = 'paid' then $6::uuid end,
                  case when $4::text = 'paid' then $3::timestamptz end, case when $4::text = 'paid' then 'transfer' end, $6::uuid, $7) returning id`,
          [t.tenantId, start, end, state, ap, fin.staffId, `cb-${key()}`])).rows[0].id as string;
      } finally { for (const g of tg) await h.admin.query(`alter table payout_batches enable always trigger ${g}`); }
      const tl = (await h.admin.query(`select tgname from pg_trigger where tgrelid = 'payout_batch_lines'::regclass and not tgisinternal and tgenabled <> 'D'`)).rows.map((x) => x.tgname as string);
      for (const g of tl) await h.admin.query(`alter table payout_batch_lines disable trigger ${g}`);
      try {
        await h.admin.query(`insert into payout_batch_lines (tenant_id, batch_id, staff_id, gross, adjustments, carry_forward_in, net_payable, carry_forward_out) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.tenantId, b, staff, line.gross, line.adj, line.cfIn, line.net, line.cfOut]);
      } finally { for (const g of tl) await h.admin.query(`alter table payout_batch_lines enable always trigger ${g}`); }
      return b;
    };
    // A (approved, unpaid) carries 100,000 out; B (paid) takes it in: the writer's rule, valid
    await batch(3, "approved", { gross: 0, adj: -100_000, cfIn: 0, net: 0, cfOut: 100_000 });
    await batch(2, "paid", { gross: 150_000, adj: 0, cfIn: 100_000, net: 50_000, cfOut: 0 });
    expect((await roll(fin, wib(-360 * 86_400_000), today())).checks.commission_payable.carry_forward_mismatches).toBe(0);
    // C (paid) claims 70,000 its predecessor B never carried out: reported; C carries 120,000 out
    const c = await batch(1, "paid", { gross: 0, adj: -50_000, cfIn: 70_000, net: 0, cfOut: 120_000 });
    expect((await roll(fin, wib(-360 * 86_400_000), today())).checks.commission_payable.carry_forward_mismatches).toBe(1);
    // the member exits: C's remainder becomes a staff receivable (B-21), so D's carry-in is 0 by the writer's rule — valid, not a mismatch
    const cl = (await h.admin.query(`select id from payout_batch_lines where batch_id = $1`, [c])).rows[0].id;
    const tr = (await h.admin.query(`select tgname from pg_trigger where tgrelid = 'staff_commission_receivables'::regclass and not tgisinternal and tgenabled <> 'D'`)).rows.map((x) => x.tgname as string);
    for (const g of tr) await h.admin.query(`alter table staff_commission_receivables disable trigger ${g}`);
    try {
      await h.admin.query(`insert into staff_commission_receivables (tenant_id, staff_id, source_batch_line_id, amount, created_at) values ($1, $2, $3, 120000, '2026-10-01')`, [t.tenantId, staff, cl]);
    } finally { for (const g of tr) await h.admin.query(`alter table staff_commission_receivables enable always trigger ${g}`); }
    await batch(0, "paid", { gross: 0, adj: 0, cfIn: 0, net: 0, cfOut: 0 });
    expect((await roll(fin, wib(-360 * 86_400_000), today())).checks.commission_payable.carry_forward_mismatches).toBe(1);
  });
});

describe("exports, readers and roles", () => {
  it("commission per recipient, payments, a ledger: no patient name, no journal kind, audited; the auditor reads but may not export; other roles refused", async () => {
    const from = monthStart();
    const to = today();
    const audited = async () => (await h.admin.query(`select count(*)::int c from audit_events where tenant_id = $1 and action = 'export' and object_kind = 'subledger'`, [A.tenantId])).rows[0].c as number;
    const a0 = await audited();
    const pay = await as(FIN, (db) => exportRows(db, { kind: "payments", from, to }));
    expect(pay[0]).toEqual(["tanggal", "cabang", "metode", "jumlah", "nomor_struk", "id_pembayaran", "id_invoice", "lingkungan", ""]);
    const csv = toCsv(pay) + toCsv(await as(OWN, (db) => exportRows(db, { kind: "patient_balance", from, to })))
      + toCsv(await as(FIN, (db) => exportRows(db, { kind: "invoice_lines", from, to })));
    expect(csv).not.toMatch(/Pasien|Rahasia|Kondisi|Facial|Filler|RM-\d/);
    const com = await as(FIN, (db) => exportRows(db, { kind: "commissions", from, to }));
    expect(com[0].slice(0, 4)).toEqual(["tanggal", "id_penerima", "nama_penerima", "jenis"]);
    expect(await why(as(FIN, (db) => exportRows(db, { kind: "journal" as never, from, to })))).toBe("ERR_INVALID_INPUT:kind");
    expect(await why(as(AU, (db) => exportRows(db, { kind: "payments", from, to })))).toMatch(/^ERR_FORBIDDEN/);
    expect(await audited() - a0).toBe(4); // one per export made; the refused ones (journal kind, auditor) none
    const au = await roll(AU);
    expect([au.can_export, au.can_record_vat]).toEqual([false, false]);
    for (const p of [FO, MGR, DOC, BC, NUR]) expect(await why(roll(p)), p.role).toMatch(/^ERR_FORBIDDEN/);
    // another tenant's finance sees its own (empty) ledgers, never A's
    const b = await roll(BFIN);
    expect(L(b, "cash_bank").closing).toBe(0);
    expect(await why(roll(FIN, from, to, B.b1))).toBe("ERR_NOT_FOUND:branch not found");
    expect(await why(roll(FIN, "2026-02-01", "2026-01-01"))).toBe("ERR_INVALID_INPUT:period");
  });

  it("a period reopened after later facts keeps its closing; tenant-wide identity opening + terms = closing for every ledger", async () => {
    const pid = await patient(A, A.b1, "Pasien Lalu");
    await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 100_000, cashTendered: 100_000 }));
    const acct = (await h.admin.query(`select id from balance_accounts where patient_id = $1`, [pid])).rows[0].id;
    await shift("balance_entries", ["created_at"], "account_id = $1", [acct], "60 days");
    const then = wib(-60 * 86_400_000);
    const r1 = await roll(FIN, then, then);
    // a later spend of that balance (today) must not change the closing of the earlier day
    const { v } = await visitWith(A, pid, A.b1, [facialV], DOC, FO);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "balance", amount: 100_000 }]));
    const r2 = await roll(FIN, then, then);
    expect(L(r2, "patient_balance").closing).toBe(L(r1, "patient_balance").closing);
    const all = await roll(FIN, wib(-300 * 86_400_000), today());
    for (const [l, r] of Object.entries(all.ledgers)) expect(r.opening + Object.values(r.terms).reduce((x, y) => x + y, 0), l).toBe(r.closing);
  });
});
