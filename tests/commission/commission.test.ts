// T-087 Done-when (stages a–b): PR-23 commission rules and accrual — money scenario 10 (four contributions on one sale, 210,000; the
// refund reverses them), BILL-15 (one person holding two contributions earns each once), rule versions resolved at the sale instant,
// the performer only on a fully paid line and a counted execution, the % basis net of VAT and cumulative (no rounding drift), the
// attribution set by command and corrected through attribution_correction, PR-37 write-off excluded (BILL-23), and the guards.
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { collectReceivable, convertToReceivable, requestRefund, writeOffAsOwner } from "../../src/modules/cashier/receivables/receivables";
import { publish } from "../../src/modules/catalog/catalog";
import { createCharge, enableMockPort, receiveMockWebhook, simulate } from "../../src/modules/payments/payments";
import { SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { assignGuidingBc, attributeSale, createRule, decideRuleVersion, decideStaffReceivable, exportBatch, exportCsv, listBatches, listRules, markBatchPaid, myCommission, newRuleVersion, openBatch, simulateRule, submitBatch } from "../../src/modules/commission/commission";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { saveItem } from "../../src/modules/inventory/stock";
import { chargeConsultationFee } from "../../src/modules/cashier/consultation/consultation";
import { receiveDeposit } from "../../src/modules/cashier/deposits/deposits";
import { upsertRoom } from "../../src/modules/org/branches/branches";
import { checkIn } from "../../src/modules/visits/visits";
import { arrivalSlot } from "../support/dates";
import { changeSetting } from "../../src/modules/settings/settings";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { cancelPackage, decideSubstitution, interruptedToBalance, requestSubstitution, reserveSession, setPackageContents, topUpBalance } from "../../src/modules/packages/packages";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { closeVisit } from "../../src/modules/visits/visits";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { stepUpForTests } from "../support/step-up";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const STEP: StepUp = stepUpForTests();
const TRF = { bank: "BCA", reference: "TRF-10" };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Komisi Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("KM1"), b2: await br("KM2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`kom${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Komisi ${n}` });
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
// A patient registered by `registrar` (the new-patient contributor, B-12).
async function patient(t: T, branch: string, name: string, registrar: P): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             $6, 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name, registrar.staffId])).rows[0].id as string;
}
// A visit at A.b1 with a signed exam, a plan of one facial (2,000,000), the consent, the selection (closing/guiding BC) confirmed and the
// bill issued; unpaid.
async function visitReady(o: { pid?: string; closing?: P | null; guiding?: P | null; name?: string } = {}) {
  const pid = o.pid ?? await patient(A, A.b1, o.name ?? "Pasien Komisi", REG);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Komisi", "Kondisi rahasia pasien"));
  const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: facialV, qty: 1 }));
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  const t = await as(DOC, (db) => consentText(db, v, planId));
  await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
  const closing = o.closing === undefined ? C : o.closing;
  const guiding = o.guiding === undefined ? G : o.guiding;
  await as(FO, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: itemId }], closingBcId: closing?.staffId ?? null, guidingBcId: guiding?.staffId ?? null }));
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
  const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
  return { pid, v, planId, itemId, invoiceId, line };
}
type S = Awaited<ReturnType<typeof visitReady>>;
const pay = (s: S, amount = 2_000_000) => as(FO, (db) => receivePayment(db, key(), s.invoiceId, [{ method: "transfer", amount, details: TRF }]));
const treat = async (s: S, outcome: "completed" | "clinic_stop" = "completed") => {
  const { executionId } = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: s.itemId, performerId: DOC.staffId, identityConfirmed: true }));
  await as(DOC, (db) => finishTreatment(db, key(), executionId, outcome === "completed" ? { outcome } : { outcome, reason: "Alasan berhenti uji" }));
  return executionId;
};
// Net commission per (staff, type) on an invoice: entitlements plus adjustments.
async function earned(invoiceId: string) {
  const r = await h.admin.query(
    `select c.staff_id, c.contribution_type t,
            (select coalesce(sum(e.amount), 0) from commission_entitlements e where e.contribution_id = c.id)
          + (select coalesce(sum(a.amount), 0) from commission_adjustments a join commission_entitlements e on e.id = a.entitlement_id where e.contribution_id = c.id) net
       from commission_contributions c join invoice_lines l on l.id = c.invoice_line_id where l.invoice_id = $1 order by 2, 1`, [invoiceId]);
  return Object.fromEntries(r.rows.map((x) => [`${x.t}:${who(x.staff_id)}`, Number(x.net)]));
}
const who = (id: string) => ({ [G.staffId]: "G", [C.staffId]: "C", [REG.staffId]: "R", [DOC.staffId]: "P", [BC1.staffId]: "BC1" } as Record<string, string>)[id] ?? id;
const total = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);

let A: T; let B: T;
let OWN: P; let FH: P; let FIN: P; let DOC: P; let NUR: P; let AU: P; let AP: P; let PH: P; let FO: P; let MGR: P; let REG: P; let G: P; let C: P; let BC1: P; let BOWN: P;
let facial: string; let facialV: string; let consult: string; let dp: string; let dpV: string; let peel: string; let peelV: string; let pricey: string; let priceyV: string;
let DOCB: P; let FOB: P;

async function rule(type: "closing_bc" | "guiding_bc" | "new_patient" | "performer", v: { basisPoints?: number; fixedAmount?: number }, by = FIN) {
  const r = await as(by, (db) => createRule(db, key(), v.fixedAmount !== undefined
    ? { contributionType: type, name: `Aturan ${type}`, kind: "fixed", fixedAmount: v.fixedAmount }
    : { contributionType: type, name: `Aturan ${type}`, kind: "percent", basisPoints: v.basisPoints! }));
  await as(OWN, (db) => decideRuleVersion(db, r.versionId, "activate"));
  return r;
}

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); FIN = await person(A, "finance"); DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); AU = await person(A, "auditor"); AP = await person(A, "admin_pusat"); PH = await person(A, "pharmacist", A.b1);
  FO = await person(A, "fo_cashier", A.b1); MGR = await person(A, "manager", A.b1); REG = await person(A, "fo_cashier", A.b1);
  G = await person(A, "bc", A.b1); C = await person(A, "bc", A.b1); BC1 = await person(A, "bc", A.b1); BOWN = await person(B, "owner");
  await credential(A, DOC, A.b1);
  const f = await as(OWN, (db) => publish(db, { kind: "service", code: "KM-FAC" }, {
    name: "Facial Komisi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 2_000_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", consent_template: "Templat persetujuan Facial Komisi.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
  } as never, "Layanan baru"));
  if (f.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [f.approvalId]));
  facial = f.itemId; facialV = f.versionId;
  const svc = async (code: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  };
  const pe = await svc("KM-PEEL", "Peeling Komisi", 450_000); peel = pe.itemId; peelV = pe.versionId;
  const pr = await svc("KM-LSR", "Laser Premium Komisi", 800_000); pricey = pr.itemId; priceyV = pr.versionId;
  DOCB = await person(A, "doctor", A.b2); FOB = await person(A, "fo_cashier", A.b2);
  consult = (await svc("KM-KON", "Konsultasi Komisi", 150_000)).itemId;
  const dpv = await as(OWN, (db) => publish(db, { kind: "service", code: "KM-DP" }, {
    name: "Layanan DP Komisi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0,
    indications: "Indikasi", consent_template: "Templat persetujuan Layanan DP Komisi.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }], booking_dp_enabled: true, booking_dp_amount: 200_000,
  } as never, "Layanan baru"));
  if (dpv.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [dpv.approvalId]));
  dp = dpv.itemId; dpV = dpv.versionId;
  await as(OWN, (db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: true, batas_ubah: 24 }, reason: "Uji DP" }));
  await h.admin.query(`alter table catalog_versions disable trigger catalog_versions_guard`);
  try {
    await h.admin.query(`update catalog_versions set category = 'consultation' where item_id = $1`, [consult]);
  } finally {
    await h.admin.query(`alter table catalog_versions enable always trigger catalog_versions_guard`);
  }
  await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
  await credential(A, DOCB, A.b2);
  // The fixture rule set (money-scenarios.md): closing 5 %, guiding 2 %, new-patient registrar 1 %, performer Rp50,000.
  await rule("closing_bc", { basisPoints: 500 });
  await rule("guiding_bc", { basisPoints: 200 });
  await rule("new_patient", { basisPoints: 100 });
  await rule("performer", { fixedAmount: 50_000 });
  await as(MGR, (db) => enableMockPort(db));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("money scenario 10: one sale, four contributions", () => {
  it("G 40,000, C 100,000, R 20,000 (first visit), P 50,000 — total 210,000; the refund to balance reverses all of it", async () => {
    const s = await visitReady({ name: "Pasien Skenario 10" });
    expect(await earned(s.invoiceId)).toEqual({}); // issued, nothing settled: nothing accrued
    await pay(s);
    // the sales contributions accrue on payment; the performer waits for the counted execution
    expect(await earned(s.invoiceId)).toEqual({ "closing_bc:C": 100_000, "guiding_bc:G": 40_000, "new_patient:R": 20_000 });
    await treat(s);
    const e = await earned(s.invoiceId);
    expect(e).toEqual({ "closing_bc:C": 100_000, "guiding_bc:G": 40_000, "new_patient:R": 20_000, "performer:P": 50_000 });
    expect(total(e)).toBe(210_000);
    // one sale: the contributions point at one line; each stores the rule version in force at issue
    const rows = (await h.admin.query(`select distinct invoice_line_id, sale_at = (select issued_at from invoices where id = $2) at_issue from commission_contributions where invoice_line_id = $1`, [s.line, s.invoiceId])).rows;
    expect(rows).toEqual([{ invoice_line_id: s.line, at_issue: true }]);
    // the refund of the delivered treatment to balance (month 2): −210,000
    await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 2_000_000, reason: "Pasien tidak puas" }));
    expect(total(await earned(s.invoiceId))).toBe(0);
    const adj = (await h.admin.query(`select cause, sum(a.amount)::int s from commission_adjustments a join commission_entitlements e on e.id = a.entitlement_id
      join commission_contributions c on c.id = e.contribution_id where c.invoice_line_id = $1 group by 1`, [s.line])).rows;
    expect(adj).toEqual([{ cause: "refund", s: -210_000 }]);
  });

  it("BILL-15: G = C earns each once (140,000); a second visit is not a new patient; the performer after a later payment", async () => {
    const s = await visitReady({ closing: C, guiding: C, name: "Pasien BILL-15" });
    await pay(s, 1_000_000);
    expect(await earned(s.invoiceId)).toEqual({ "closing_bc:C": 50_000, "guiding_bc:C": 20_000, "new_patient:R": 10_000 });
    await pay(s, 1_000_000);
    await treat(s); // fully paid and counted: the performer accrues
    const e = await earned(s.invoiceId);
    expect(e).toEqual({ "closing_bc:C": 100_000, "guiding_bc:C": 40_000, "new_patient:R": 20_000, "performer:P": 50_000 });
    expect(e["closing_bc:C"] + e["guiding_bc:C"]).toBe(140_000);
    await as(FO, (db) => closeVisit(db, key(), s.v));
    const s2 = await visitReady({ pid: s.pid });
    await pay(s2);
    expect(Object.keys(await earned(s2.invoiceId)).sort()).toEqual(["closing_bc:C", "guiding_bc:G"]);
  });

  it("a clinic stop is not counted: no performer; the cumulative rounding has no drift over three payments", async () => {
    const s = await visitReady({ name: "Pasien Pembulatan" });
    for (const a of [333_333, 333_333, 1_333_334]) await pay(s, a);
    await treat(s, "clinic_stop");
    // 5 % of 2,000,000 exactly, whatever the steps (cumulative: round(cum × bps) − accrued before)
    expect(await earned(s.invoiceId)).toEqual({ "closing_bc:C": 100_000, "guiding_bc:G": 40_000, "new_patient:R": 20_000 });
    // the uncounted execution replayed through the accrual: still no performer (mutation performer-uncounted)
    const ex = (await h.admin.query(`select id from treatment_executions where visit_id = $1`, [s.v])).rows[0].id as string;
    await h.admin.query(`select commission_accrue_execution($1, $2)`, [A.tenantId, ex]);
    expect(Object.keys(await earned(s.invoiceId))).not.toContain("performer:P");
    const steps = (await h.admin.query(`select e.amount::int a from commission_entitlements e join commission_contributions c on c.id = e.contribution_id
      where c.invoice_line_id = $1 and c.contribution_type = 'closing_bc' order by e.accrued_at, e.id`, [s.line])).rows.map((r) => r.a);
    expect(steps).toEqual([16_667, 16_666, 66_667]);
    // a partial reduction (a move of 1,000,000 net basis → −50,000 on closing) is taken newest-first (LIFO): all of it from the last step
    await h.admin.query(`select commission_line_moved($1, $2, 1000000, 'refund', 'invoice_line', gen_random_uuid())`, [A.tenantId, s.line]);
    const taken = (await h.admin.query(`select e.amount::int a, coalesce((select sum(x.amount) from commission_adjustments x where x.entitlement_id = e.id), 0)::int t
      from commission_entitlements e join commission_contributions c on c.id = e.contribution_id where c.invoice_line_id = $1 and c.contribution_type = 'closing_bc'
      order by e.accrued_at, e.id`, [s.line])).rows.map((r) => r.t);
    expect(taken).toEqual([0, 0, -50_000]);
  });
});

// A package of 5 facial sessions (Rp3,000,000; 600,000 per session) sold at A.b1, closing C and guiding G attributed by command, paid in full.
async function soldPackage(name: string) {
  const code = `KMP-${++n}`;
  const v = await as(OWN, (db) => publish(db, { kind: "package", code }, { name: `Paket ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 3_000_000 } as never, "Paket"));
  await as(OWN, (db) => setPackageContents(db, key(), v.versionId, [{ serviceItemId: facial, count: 5 }]));
  const pid = await patient(A, A.b1, name, REG);
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: v.itemId, quantity: 1 }]));
  await as(FO, (db) => attributeSale(db, key(), invoiceId, { closingBcId: C.staffId, guidingBcId: G.staffId }));
  await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 3_000_000, cashTendered: 3_000_000 }]));
  const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
  const sessions = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
  return { pid, invoiceId, pkg, sessions };
}
// An open visit for a package patient at `branch` with one planned item of `version`, signed and consented.
async function packageVisit(pid: string, branch: string, version: string, doc: P, fo: P) {
  await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by, payment = case when payment in ('in_progress','blocked') then 'done' else payment end,
      dispensing = case when dispensing in ('in_progress','blocked') then 'done' else dispensing end, treatment = case when treatment in ('in_progress','blocked') then 'done' else treatment end
    where tenant_id = $1 and patient_id = $2 and closed_at is null`, [A.tenantId, pid]);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [A.tenantId, branch, pid, fo.staffId])).rows[0].id as string;
  const { examId } = await as(doc, (db) => openExam(db, key(), v));
  const { planId } = await as(doc, (db) => createPlan(db, key(), examId, "Program Paket", "Kondisi rahasia pasien"));
  const { itemId } = await as(doc, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: version, qty: 1 }));
  await as(doc, (db) => signRecord(db, key(), examId, STEP));
  const t = await as(doc, (db) => consentText(db, v, planId));
  await as(doc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
  return { v, itemId };
}
const perBranch = async (pkgInvoice: string) => (await h.admin.query(
  `select c.contribution_type t, b.code, sum(e.amount)::int + coalesce(sum((select sum(x.amount) from commission_adjustments x where x.entitlement_id = e.id)), 0)::int net
     from commission_entitlements e join commission_contributions c on c.id = e.contribution_id join branches b on b.id = e.branch_id
     join invoice_lines l on l.id = c.invoice_line_id where l.invoice_id = $1 group by 1, 2 order by 1, 2`, [pkgInvoice])).rows.map((r) => [r.t, r.code, r.net]);

describe("money scenario 11: a package sold at A, redeemed at B", () => {
  it("closing 150,000 and guiding 60,000 at A on the sale (paid in full); one counted session at B: performer 50,000 at B", async () => {
    const k = await soldPackage("Pasien Skenario 11");
    // a package sale has no visit: no new-patient contribution (B-12 is the first visit)
    expect(await perBranch(k.invoiceId)).toEqual([["closing_bc", "KM1", 150_000], ["guiding_bc", "KM1", 60_000]]);
    const { v, itemId } = await packageVisit(k.pid, A.b2, facialV, DOCB, FOB);
    await as(FOB, (db) => reserveSession(db, key(), k.pkg, v));
    const { executionId } = await as(DOCB, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: DOCB.staffId, identityConfirmed: true }));
    await as(DOCB, (db) => finishTreatment(db, key(), executionId, { outcome: "completed" }));
    expect(await perBranch(k.invoiceId)).toEqual([["closing_bc", "KM1", 150_000], ["guiding_bc", "KM1", 60_000], ["performer", "KM2", 50_000]]);
    // no second sales commission on the redemption: the BC rows are unchanged
  });
});

describe("money scenario 12: substitution (BILL-11, B-10)", () => {
  it("12b cheaper: closing BC −7,500 on the 150,000 moved to balance, performer 50,000; 12a dearer: closing BC 10,000 on the paid 200,000 difference, performer 50,000", async () => {
    const k = await soldPackage("Pasien Skenario 12");
    const closing = async () => (await perBranch(k.invoiceId)).filter(([t]) => t === "closing_bc").reduce((a, [, , x]) => a + (x as number), 0);
    expect(await closing()).toBe(150_000);
    // 12b: session 1 (600,000) → peel at 450,000; 150,000 to balance → closing −7,500
    const { substitutionId: u1 } = await as(FO, (db) => requestSubstitution(db, key(), k.sessions[0], peel, "Kulit lebih sensitif"));
    await as(DOC, (db) => decideSubstitution(db, key(), u1, true, null));
    expect(await closing()).toBe(142_500);
    const adj = (await h.admin.query(`select x.cause, sum(x.amount)::int a from commission_adjustments x join commission_entitlements e on e.id = x.entitlement_id
      join commission_contributions c on c.id = e.contribution_id join invoice_lines l on l.id = c.invoice_line_id where l.invoice_id = $1 and c.contribution_type = 'closing_bc' group by 1`, [k.invoiceId])).rows;
    expect(adj).toEqual([{ cause: "substitution", a: -7_500 }]);
    const s1 = await packageVisit(k.pid, A.b1, peelV, DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), k.pkg, s1.v, peel));
    const e1 = await as(DOC, (db) => startTreatment(db, key(), s1.v, { planItemId: s1.itemId, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e1.executionId, { outcome: "completed" }));
    expect((await perBranch(k.invoiceId)).find(([t]) => t === "performer")).toEqual(["performer", "KM1", 50_000]);
    // 12a: session 2 → the premium laser at 800,000; the 200,000 difference line is paid in cash → closing 10,000 on it, performer 50,000
    const { substitutionId: u2 } = await as(FO, (db) => requestSubstitution(db, key(), k.sessions[1], pricey, "Hasil lebih baik"));
    await as(FH, (db) => decideSubstitution(db, key(), u2, true, null));
    const s2 = await packageVisit(k.pid, A.b1, priceyV, DOC, FO);
    await as(FO, (db) => reserveSession(db, key(), k.pkg, s2.v, pricey));
    const { invoiceId: di } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: k.pid, visitId: s2.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), di, [{ itemId: pricey, quantity: 1, substitutionId: u2 }]));
    // the difference invoice's closing BC is set by command (no selection on a package visit; plan P1-1)
    await as(FO, (db) => attributeSale(db, key(), di, { closingBcId: C.staffId }));
    await as(FO, (db) => receivePayment(db, key(), di, [{ method: "cash", amount: 200_000, cashTendered: 200_000 }]));
    expect((await earned(di))["closing_bc:C"]).toBe(10_000);
    const e2 = await as(DOC, (db) => startTreatment(db, key(), s2.v, { planItemId: s2.itemId, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), e2.executionId, { outcome: "completed" }));
    const perf = (await h.admin.query(`select count(*)::int n, sum(e.amount)::int a from commission_contributions c join commission_entitlements e on e.contribution_id = c.id
      where c.source_id = $1`, [e2.executionId])).rows[0];
    expect(perf).toEqual({ n: 1, a: 50_000 }); // one performer per counted session, not one per line (the package's and the difference's)
    // the package closed: the unused paid value (3 sessions × 600,000 = 1,800,000) to balance → closing −90,000 (5 % of 1,800,000); the basis
    // kept is what was delivered: 3,000,000 − 150,000 (substitution) − 1,800,000 = 1,050,000 → 52,500
    await as(MGR, (db) => cancelPackage(db, key(), k.pkg, "Pasien pindah kota"));
    expect(await closing()).toBe(142_500 - 90_000);
  });
});

describe("PR-14 commission effect (money scenario 7: interrupted treatment, B-10)", () => {
  it("7a medical stop moved to balance: closing −75,000 of 75,000 on a 1,500,000 line, no performer; 7b clinic stop the same; 7c patient stop: performer 50,000, closing stays", async () => {
    const run = async (outcome: "medical_stop" | "clinic_stop" | "patient_stop", name: string) => {
      const s = await visitReady({ guiding: null, name });
      await pay(s);
      const { executionId } = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: s.itemId, performerId: DOC.staffId, identityConfirmed: true }));
      await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome, reason: "Alasan berhenti uji" }));
      if (outcome !== "patient_stop") await as(MGR, (db) => interruptedToBalance(db, key(), executionId));
      return earned(s.invoiceId);
    };
    // the fixture's line is 1,500,000 (closing 75,000); this suite's facial is 2,000,000 → closing 100,000; the rule is the same 5 %
    expect(await run("medical_stop", "Pasien 7a")).toEqual({ "closing_bc:C": 0, "new_patient:R": 0 });
    expect(await run("clinic_stop", "Pasien 7b")).toEqual({ "closing_bc:C": 0, "new_patient:R": 0 });
    expect(await run("patient_stop", "Pasien 7c")).toEqual({ "closing_bc:C": 100_000, "new_patient:R": 20_000, "performer:P": 50_000 });
  });
});

describe("money scenarios 13, 18, 15 and 8", () => {
  it("13: a top-up earns nothing; the balance spent on a sale earns normally (closing 5 % of the line)", async () => {
    const s = await visitReady({ guiding: null, name: "Pasien Saldo" });
    await as(FO, (db) => topUpBalance(db, key(), s.pid, null, { method: "cash", amount: 2_000_000, cashTendered: 2_000_000 }));
    expect(await earned(s.invoiceId)).toEqual({});
    expect((await h.admin.query(`select count(*)::int n from commission_entitlements where fact_kind = 'allocation' and fact_id in
      (select a.id from payment_allocations a join balance_top_ups t on t.id = a.top_up_id where t.patient_id = $1)`, [s.pid])).rows[0].n).toBe(0);
    await as(FO, (db) => receivePayment(db, key(), s.invoiceId, [{ method: "balance", amount: 2_000_000 }]));
    expect(await earned(s.invoiceId)).toEqual({ "closing_bc:C": 100_000, "new_patient:R": 20_000 });
  });

  it("18: a duplicate gateway webhook accrues once (one allocation, one entitlement per contribution)", async () => {
    const s = await visitReady({ guiding: null, name: "Pasien Webhook" });
    const c = await as(FO, (db) => createCharge(db, key(), s.invoiceId, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local");
    expect((await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local")).outcome).toBe("duplicate");
    // the mock port is simulated money (BILL-29): nothing at all; the real-money duplicate guard is the allocation's own uniqueness, so a
    // replayed accrual on the same fact is idempotent
    expect(await earned(s.invoiceId)).toEqual({});
    await pay(s);
    const fact = (await h.admin.query(`select a.id from payment_allocations a where a.invoice_line_id = $1 and not a.is_simulated`, [s.line])).rows[0].id as string;
    await h.admin.query(`select commission_accrue_line($1, $2, 'allocation', $3)`, [A.tenantId, s.line, fact]);
    expect(await earned(s.invoiceId)).toEqual({ "closing_bc:C": 100_000, "new_patient:R": 20_000 });
    expect((await h.admin.query(`select count(*)::int n from commission_entitlements e join commission_contributions c on c.id = e.contribution_id
      where c.invoice_line_id = $1 and c.contribution_type = 'closing_bc'`, [s.line])).rows[0].n).toBe(1);
  });

  it("15 / 4c: a product sold with a closing BC and refunded to balance: closing −16,650 on 333,000", async () => {
    const prod = await as(OWN, (db) => publish(db, { kind: "product", code: "KM-SRM15" }, { name: "Serum Skenario 15", tax_category: "non_object", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"));
    await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: prod.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    const s = await visitReady({ guiding: null, name: "Pasien Serum" });
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: prod.itemId, quantity: 1 }]));
    await as(FO, (db) => attributeSale(db, key(), invoiceId, { closingBcId: C.staffId }));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 333_000, cashTendered: 333_000 }]));
    expect((await earned(invoiceId))["closing_bc:C"]).toBe(16_650);
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    await as(FO, (db) => requestRefund(db, key(), line, { amount: 333_000, reason: "Pasien berubah pikiran" }));
    expect((await earned(invoiceId))["closing_bc:C"]).toBe(0);
  });

  it("8: a package closed with paid unused value: closing −50,000 and guiding −20,000 per 1,000,000 moved", async () => {
    const k = await soldPackage("Pasien Skenario 8");
    const sum = async (t: string) => (await perBranch(k.invoiceId)).filter(([x]) => x === t).reduce((a, [, , v]) => a + (v as number), 0);
    expect([await sum("closing_bc"), await sum("guiding_bc")]).toEqual([150_000, 60_000]);
    await as(MGR, (db) => cancelPackage(db, key(), k.pkg, "Pasien pindah kota"));
    // all 3,000,000 unused → closing −150,000, guiding −60,000 (the fixture's 1,000,000 → −50,000 / −20,000, same rates)
    expect([await sum("closing_bc"), await sum("guiding_bc")]).toEqual([0, 0]);
  });
});

describe("review r1: consultation, batch rejection, attribution after a move, deposits, guiding assignment, events", () => {
  // A consultation-only visit with its examination (opened, not signed) and the fee charged; returns the fee line.
  async function consultation(name: string) {
    const pid = await patient(A, A.b1, name, REG);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    const ch = await as(FO, (db) => chargeConsultationFee(db, key(), v, consult));
    return { pid, v, examId, invoiceId: ch.invoice_id as string, line: ch.invoice_line_id as string };
  }
  const performerOf = async (examId: string) => Number((await h.admin.query(`select coalesce(sum(e.amount), 0) + coalesce((select sum(x.amount) from commission_adjustments x
      join commission_entitlements e2 on e2.id = x.entitlement_id join commission_contributions c2 on c2.id = e2.contribution_id where c2.source_id = $1), 0) n
    from commission_entitlements e join commission_contributions c on c.id = e.contribution_id where c.source_kind = 'examination' and c.source_id = $1`, [examId])).rows[0].n);

  it("P1-1 consultation: general rules never match; an explicit consultation rule earns the examination's author once the fee is paid and the exam signed, in both orders", async () => {
    const c1 = await consultation("Pasien Konsul Satu");
    await as(FO, (db) => receivePayment(db, key(), c1.invoiceId, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
    await as(DOC, (db) => signRecord(db, key(), c1.examId, STEP));
    // the fixture's general rules (closing 5 %, performer 50,000) never apply to a consultation line (scenario 4: default none)
    expect(await earned(c1.invoiceId)).toEqual({});
    expect(await performerOf(c1.examId)).toBe(0);
    const r = await as(FIN, (db) => createRule(db, key(), { contributionType: "performer", name: "Konsultasi dokter", kind: "fixed", fixedAmount: 25_000, category: "consultation" }));
    await as(OWN, (db) => decideRuleVersion(db, r.versionId, "activate"));
    // pay then sign
    const c2 = await consultation("Pasien Konsul Dua");
    await as(FO, (db) => receivePayment(db, key(), c2.invoiceId, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
    expect(await performerOf(c2.examId)).toBe(0); // not signed yet
    await as(DOC, (db) => signRecord(db, key(), c2.examId, STEP));
    expect(await performerOf(c2.examId)).toBe(25_000);
    // sign then pay
    const c3 = await consultation("Pasien Konsul Tiga");
    await as(DOC, (db) => signRecord(db, key(), c3.examId, STEP));
    expect(await performerOf(c3.examId)).toBe(0); // not paid yet
    await as(FO, (db) => receivePayment(db, key(), c3.invoiceId, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
    expect(await performerOf(c3.examId)).toBe(25_000);
    // the sales types still never match a consultation line
    expect(Object.keys(await earned(c3.invoiceId)).filter((k) => !k.startsWith("performer"))).toEqual([]);
    // (the consultation rule stays in force for the rest of the file: only consultation lines match it)
  });

  it("P1-2 a rejected batch returns to draft with its items and lines deleted; the resubmit materializes afresh and includes a later before-payout adjustment", async () => {
    const s = await visitReady({ guiding: null, name: "Pasien Tolak Batch" });
    await pay(s);
    await backdate("commission_entitlements", "accrued_at", ofLine, [s.line], 6);
    const period = await periodKey(6);
    const { batchId } = await as(FIN, (db) => openBatch(db, key(), period));
    const ap1 = await as(FIN, (db) => submitBatch(db, batchId));
    expect((await lines(batchId)).C).toEqual([100_000, 0, 0, 100_000, 0]);
    // items and lines never change while sealed
    expect(await h.admin.query(`delete from payout_batch_lines where batch_id = $1`, [batchId]).then(() => "ok", (e) => e.message as string)).toMatch(/insert-only/);
    await as(OWN, (db) => decideApproval(db, ap1, false, "Periksa ulang"));
    expect((await h.admin.query(`select state from payout_batches where id = $1`, [batchId])).rows[0].state).toBe("draft");
    expect((await h.admin.query(`select (select count(*) from payout_batch_items where batch_id = $1)::int i, (select count(*) from payout_batch_lines where batch_id = $1)::int l`, [batchId])).rows[0])
      .toEqual({ i: 0, l: 0 });
    // a refund now (after the period's end, before payout) reduces the unpaid entitlement in this batch
    await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 1_000_000, reason: "Sebagian dikembalikan" }));
    expect((await h.admin.query(`select bool_and(not after_payout) b from commission_adjustments where ${adjOfLine}`, [s.line])).rows[0].b).toBe(true);
    const ap2 = await as(FIN, (db) => submitBatch(db, batchId));
    expect((await lines(batchId)).C).toEqual([100_000, -50_000, 0, 50_000, 0]);
    // settle it so later tests' earlier months are not blocked (earlier_batch_open)
    await as(OWN, (db) => decideApproval(db, ap2, true));
    await as(FIN, (db) => markBatchPaid(db, batchId, "transfer"));
  });

  it("P2-1 an attribution set after a partial refund earns only on what stayed; a cheaper substitution adjusts a guiding BC with no closing BC", async () => {
    const s = await visitReady({ closing: null, guiding: null, name: "Pasien Atribusi Refund" });
    await pay(s);
    await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 1_000_000, reason: "Sebagian dikembalikan" }));
    await as(FO, (db) => attributeSale(db, key(), s.invoiceId, { closingBcId: C.staffId }));
    expect((await earned(s.invoiceId))["closing_bc:C"]).toBe(50_000); // 5 % of the 1,000,000 that stayed
    const k = await soldPackage("Pasien Paket Pendamping");
    const { substitutionId } = await as(FO, (db) => requestSubstitution(db, key(), k.sessions[0], peel, "Kulit sensitif"));
    await as(DOC, (db) => decideSubstitution(db, key(), substitutionId, true, null));
    const g = (await perBranch(k.invoiceId)).filter(([t]) => t === "guiding_bc").reduce((a, [, , x]) => a + (x as number), 0);
    expect(g).toBe(60_000 - 3_000); // guiding 2 % of the 150,000 moved, from the package line's base
  });

  it("P2-2 6e: a booking deposit applied on arrival accrues on its net amount; 3a: an execution finished before the rest is paid accrues the performer once paid", async () => {
    const pid = await patient(A, A.b1, "Pasien DP Komisi", REG);
    const room = (await h.admin.query(`select id from rooms where tenant_id = $1 and branch_id = $2 limit 1`, [A.tenantId, A.b1])).rows[0]?.id as string | undefined
      ?? await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Ruang Komisi", kind: "treatment" }));
    const start = arrivalSlot(0, 1);
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
    let apt = "";
    try {
      apt = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $6::timestamptz + interval '30 minutes', 'booked', 'phone', $5, 'fo_cashier') returning id`, [A.tenantId, A.b1, pid, dpV, DOC.staffId, start])).rows[0].id;
      for (const [k, r] of [["staff", DOC.staffId], ["room", room]])
        await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $6::timestamptz + interval '30 minutes')`,
          [A.tenantId, A.b1, apt, k, r, start]);
    } finally {
      await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
      await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
    }
    await as(FO, (db) => receiveDeposit(db, key(), apt, { method: "cash", cashTendered: 200_000 }));
    const v = (await as(FO, (db) => checkIn(db, key(), apt))).visitId;
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program DP", "Kondisi rahasia pasien"));
    const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: dpV, qty: 1 }));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    const t = await as(DOC, (db) => consentText(db, v, planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
    await as(FO, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: itemId }], closingBcId: C.staffId }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: dp, quantity: 1 }]));
    expect((await h.admin.query(`select state from booking_deposits where appointment_id = $1`, [apt])).rows[0].state).toBe("applied");
    expect(await earned(invoiceId)).toEqual({ "closing_bc:C": 10_000, "new_patient:R": 2_000 }); // 5 % / 1 % of the 200,000 applied
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 300_000, cashTendered: 300_000 }]));
    expect(await earned(invoiceId)).toEqual({ "closing_bc:C": 25_000, "new_patient:R": 5_000 });
    const { executionId } = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome: "completed" }));
    expect((await earned(invoiceId))["performer:P"]).toBe(50_000);
  });

  it("P2-2 guiding_bc_assign on a care plan, its replacement through attribution_correction, the plan's completion closes it; the four events carry ids only", async () => {
    const s = await visitReady({ guiding: null, name: "Pasien Pendamping" });
    const a1 = await as(FO, (db) => assignGuidingBc(db, key(), s.planId, BC1.staffId));
    expect(a1.state).toBe("active");
    expect(await why(as(FO, (db) => assignGuidingBc(db, key(), s.planId, G.staffId)))).toBe("ERR_INVALID_INPUT:reason");
    const a2 = await as(FO, (db) => assignGuidingBc(db, key(), s.planId, C.staffId, "Ganti pendamping"));
    expect(a2.state).toBe("pending_approval");
    const appr = (await h.admin.query(`select approval_id from guiding_bc_assignments where id = $1`, [a2.assignmentId])).rows[0].approval_id as string;
    await as(OWN, (db) => decideApproval(db, appr, true));
    const rows = (await h.admin.query(`select staff_id, state, effective_to is not null ended from guiding_bc_assignments where care_plan_id = $1 order by assigned_at`, [s.planId])).rows;
    expect(rows.map((r) => [who(r.staff_id), r.state, r.ended])).toEqual([["BC1", "superseded", true], ["C", "active", false]]);
    // the plan completes (plan_close needs a draft examination and this visit's exam is signed: the guard is paused for this one update)
    await h.admin.query(`alter table care_plans disable trigger care_plans_guard`);
    try {
      await h.admin.query(`update care_plans set state = 'completed', closed_at = now(), closed_exam_id = created_exam_id where id = $1`, [s.planId]);
    } finally {
      await h.admin.query(`alter table care_plans enable always trigger care_plans_guard`);
    }
    expect((await h.admin.query(`select effective_to is not null ended from guiding_bc_assignments where care_plan_id = $1 and state = 'active'`, [s.planId])).rows[0].ended).toBe(true);
    // events: CommissionAccrued and CommissionAdjusted with ids and booleans only
    await pay(s);
    await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 2_000_000, reason: "Batal" }));
    const ev = (await h.admin.query(`select type, payload from domain_events where type in ('CommissionAccrued','CommissionAdjusted') and aggregate_id in
      (select e.id from commission_entitlements e join commission_contributions c on c.id = e.contribution_id where c.invoice_line_id = $1
       union select x.id from commission_adjustments x join commission_entitlements e on e.id = x.entitlement_id join commission_contributions c on c.id = e.contribution_id where c.invoice_line_id = $1)`, [s.line])).rows;
    expect(new Set(ev.map((e) => e.type))).toEqual(new Set(["CommissionAccrued", "CommissionAdjusted"]));
    for (const e of ev) for (const v of Object.values(e.payload)) expect(typeof v === "boolean" || /^[0-9a-f-]{36}$/.test(String(v))).toBe(true);
  });

  it("P3-1 an interrupted treatment's move is recorded with cause 'interrupted'; a refund with 'refund'", async () => {
    const s = await visitReady({ guiding: null, name: "Pasien Sebab" });
    await pay(s);
    const { executionId } = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: s.itemId, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome: "medical_stop", reason: "Alasan berhenti uji" }));
    await as(MGR, (db) => interruptedToBalance(db, key(), executionId));
    const causes = (await h.admin.query(`select distinct x.cause from commission_adjustments x join commission_entitlements e on e.id = x.entitlement_id
      join commission_contributions c on c.id = e.contribution_id where c.invoice_line_id = $1`, [s.line])).rows.map((r) => r.cause);
    expect(causes).toEqual(["interrupted"]);
  });
});

describe("BILL-29: simulated money never accrues commission", () => {
  it("a mock-port payment (simulated) on a visit invoice accrues nothing", async () => {
    const s = await visitReady({ name: "Pasien Simulasi" });
    const c = await as(FO, (db) => createCharge(db, key(), s.invoiceId, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    expect((await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local")).outcome).toBe("applied");
    expect((await h.admin.query(`select count(*)::int n from payment_allocations where is_simulated and invoice_line_id = $1`, [s.line])).rows[0].n).toBe(1);
    expect(await earned(s.invoiceId)).toEqual({});
  });
});

describe("rules", () => {
  it("a new version applies to sales issued after it; earlier sales keep the old version; the owner activates, finance prepares", async () => {
    const r = await as(FIN, (db) => createRule(db, key(), { contributionType: "closing_bc", name: "Closing khusus", kind: "percent", basisPoints: 700, staffId: BC1.staffId }));
    expect(await code(as(FIN, (db) => decideRuleVersion(db, r.versionId, "activate")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => createRule(db, key(), { contributionType: "closing_bc", name: "Manajer", kind: "percent", basisPoints: 1 })))).toBe("ERR_FORBIDDEN");
    await as(OWN, (db) => decideRuleVersion(db, r.versionId, "activate"));
    const s1 = await visitReady({ closing: BC1, guiding: null, name: "Pasien Versi 1" });
    const v2 = await as(FIN, (db) => newRuleVersion(db, key(), r.ruleId, { kind: "percent", basisPoints: 1_000 }));
    await as(OWN, (db) => decideRuleVersion(db, v2.versionId, "activate"));
    const s2 = await visitReady({ closing: BC1, guiding: null, name: "Pasien Versi 2" });
    await pay(s1);
    await pay(s2);
    // the individual override (7 %, then 10 %) replaces the 5 % role default; s1 was issued under version 1
    expect((await earned(s1.invoiceId))["closing_bc:BC1"]).toBe(140_000);
    expect((await earned(s2.invoiceId))["closing_bc:BC1"]).toBe(200_000);
    const states = (await h.admin.query(`select version, state from commission_rule_versions where rule_id = $1 order by version`, [r.ruleId])).rows;
    expect(states).toEqual([{ version: 1, state: "superseded" }, { version: 2, state: "active" }]);
    // a version keeps its value; nothing is deleted
    expect(await h.admin.query(`update commission_rule_versions set basis_points = 1 where id = $1`, [v2.versionId]).then(() => "ok", (e) => e.message as string)).toMatch(/keeps its value/);
    // the state machine: an active version never goes back to draft, a superseded one never becomes active again
    expect(await h.admin.query(`update commission_rule_versions set state = 'draft' where id = $1`, [v2.versionId]).then(() => "ok", (e) => e.message as string)).toMatch(/keeps its value/);
    const v1 = (await h.admin.query(`select id, ended_at from commission_rule_versions where rule_id = $1 and version = 1`, [r.ruleId])).rows[0];
    expect(await h.admin.query(`update commission_rule_versions set state = 'active' where id = $1`, [v1.id]).then(() => "ok", (e) => e.message as string)).toMatch(/keeps its value/);
    // version 1 ends exactly where version 2 starts (activation at the new version's effective_from, not "now")
    const v2row = (await h.admin.query(`select effective_from from commission_rule_versions where id = $1`, [v2.versionId])).rows[0];
    expect(new Date(v1.ended_at).getTime()).toBe(new Date(v2row.effective_from).getTime());
    expect(await h.admin.query(`delete from commission_rule_versions where id = $1`, [v2.versionId]).then(() => "ok", (e) => e.message as string)).toMatch(/never deleted/);
    expect(await h.admin.query(`delete from commission_rules where id = $1`, [r.ruleId]).then(() => "ok", (e) => e.message as string)).toMatch(/insert-only/);
    expect(await why(as(OWN, (db) => decideRuleVersion(db, v2.versionId, "activate")))).toBe("ERR_VERSION_CONFLICT:not_draft");
    expect(await code(as(BOWN, (db) => decideRuleVersion(db, v2.versionId, "cancel")))).toBe("ERR_NOT_FOUND");
  });

  it("a version from a future date: sales before it keep the old value; a staff member with no rule and the owner earn nothing; scope excludes", async () => {
    const r = await as(FIN, (db) => createRule(db, key(), { contributionType: "guiding_bc", name: "Pendamping khusus", kind: "percent", basisPoints: 300, staffId: BC1.staffId }));
    await as(OWN, (db) => decideRuleVersion(db, r.versionId, "activate"));
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const v2 = await as(FIN, (db) => newRuleVersion(db, key(), r.ruleId, { kind: "percent", basisPoints: 900, effectiveFrom: future }));
    await as(OWN, (db) => decideRuleVersion(db, v2.versionId, "activate"));
    const s = await visitReady({ closing: null, guiding: BC1, name: "Pasien Versi Depan" });
    await pay(s);
    // issued today: version 1 (3 %) still applies until the future start (mutation supersede-now would end it now → the role default 2 %)
    expect((await earned(s.invoiceId))["guiding_bc:BC1"]).toBe(60_000);
    // the owner holds no commission role → no contribution even where a rule-wide rule matches (BILL-15; mutation no-rule-accrues)
    const contrib = await h.admin.query(`select commission_contribution($1, $2, $3, 'closing_bc', 'invoice_line', $4, $4, now()) id`, [A.tenantId, A.b1, OWN.staffId, s.line]);
    expect(contrib.rows[0].id).toBeNull();
    // the item's commission scope (mutation scope-ignored): a product never earns the performer; a service version whose commission_scope
    // leaves the performer out gets none through commission_contribution, while the standard service line does
    const prod = await as(OWN, (db) => publish(db, { kind: "product", code: "KM-SRM" }, { name: "Serum Komisi", tax_category: "non_object", tax_basis: "Barang", normal_price: 100_000 } as never, "Produk"));
    expect((await h.admin.query(`select 'performer' = any(commission_item_scopes($1, $2)) p, 'closing_bc' = any(commission_item_scopes($1, $2)) c`, [A.tenantId, prod.versionId])).rows[0])
      .toEqual({ p: false, c: true });
    const perf = async (line: string) => (await h.admin.query(`select commission_contribution($1, $2, $3, 'performer', 'treatment_execution', gen_random_uuid(), $4, now()) id`,
      [A.tenantId, A.b1, DOC.staffId, line])).rows[0].id as string | null;
    expect(await perf(s.line)).not.toBeNull();
    await h.admin.query(`alter table catalog_versions disable trigger catalog_versions_guard`);
    try {
      await h.admin.query(`update catalog_versions set commission_scope = '{closing_bc,guiding_bc}' where id = $1`, [facialV]);
      expect(await perf(s.line)).toBeNull();
    } finally {
      await h.admin.query(`update catalog_versions set commission_scope = '{}' where id = $1`, [facialV]);
      await h.admin.query(`alter table catalog_versions enable always trigger catalog_versions_guard`);
    }
  });
});

describe("attribution", () => {
  it("a sale without a closing BC accrues nothing for it until set; replacing a set BC waits for attribution_correction and reconciles", async () => {
    const s = await visitReady({ closing: null, guiding: null, name: "Pasien Atribusi" });
    await pay(s);
    expect(Object.keys(await earned(s.invoiceId))).toEqual(["new_patient:R"]);
    const a1 = await as(FO, (db) => attributeSale(db, key(), s.invoiceId, { closingBcId: C.staffId }));
    expect(a1.state).toBe("active");
    expect((await earned(s.invoiceId))["closing_bc:C"]).toBe(100_000); // the settled basis accrues at once
    expect(await why(as(FO, (db) => attributeSale(db, key(), s.invoiceId, { closingBcId: FO.staffId, reason: "Bukan BC" })))).toBe("ERR_INVALID_INPUT:not_a_bc");
    expect(await why(as(FO, (db) => attributeSale(db, key(), s.invoiceId, { closingBcId: G.staffId })))).toBe("ERR_INVALID_INPUT:reason");
    const a2 = await as(FO, (db) => attributeSale(db, key(), s.invoiceId, { closingBcId: G.staffId, reason: "Salah input closing" }));
    expect(a2.state).toBe("pending_approval");
    expect((await earned(s.invoiceId))["closing_bc:C"]).toBe(100_000); // nothing moves until decided
    const appr = (await h.admin.query(`select approval_id from commission_sale_attributions where id = $1`, [a2.attributionId])).rows[0].approval_id as string;
    expect(await code(as(FO, (db) => decideApproval(db, appr, true)))).not.toBe("ok");
    await as(OWN, (db) => decideApproval(db, appr, true));
    const e = await earned(s.invoiceId);
    expect([e["closing_bc:C"], e["closing_bc:G"]]).toEqual([0, 100_000]);
    // a replayed accrual pays only the attributed BC (C is no longer attributed)
    await h.admin.query(`select commission_accrue_line($1, $2, 'allocation', gen_random_uuid())`, [A.tenantId, s.line]);
    expect((await earned(s.invoiceId))["closing_bc:C"]).toBe(0);
    // a rejected correction changes nothing
    const a3 = await as(FO, (db) => attributeSale(db, key(), s.invoiceId, { closingBcId: C.staffId, reason: "Kembalikan" }));
    const appr3 = (await h.admin.query(`select approval_id from commission_sale_attributions where id = $1`, [a3.attributionId])).rows[0].approval_id as string;
    await as(OWN, (db) => decideApproval(db, appr3, false, "Tidak sesuai"));
    expect((await h.admin.query(`select state from commission_sale_attributions where id = $1`, [a3.attributionId])).rows[0].state).toBe("rejected");
    expect((await earned(s.invoiceId))["closing_bc:G"]).toBe(100_000);
    // C attributed again (approved): C earns the full 100,000 again, G is reversed (mutation reattribute-no-net)
    const a4 = await as(FO, (db) => attributeSale(db, key(), s.invoiceId, { closingBcId: C.staffId, reason: "Ternyata memang C" }));
    const appr4 = (await h.admin.query(`select approval_id from commission_sale_attributions where id = $1`, [a4.attributionId])).rows[0].approval_id as string;
    await as(OWN, (db) => decideApproval(db, appr4, true));
    const e4 = await earned(s.invoiceId);
    expect([e4["closing_bc:C"], e4["closing_bc:G"]]).toEqual([100_000, 0]);
  });
});

describe("PR-37 and BILL-23: a written-off receivable earns no commission", () => {
  it("the collected part accrues; the write-off reverses every contribution of its lines and blocks them", async () => {
    const s = await visitReady({ guiding: null, name: "Pasien Hapus Buku" });
    await pay(s);
    await treat(s);
    // a performed addition (2,000,000) released unpaid, billed, converted to a receivable
    const { requestId } = await as(NUR, (db) => createRequest(db, key(), s.v, {
      kind: "addition", planId: s.planId, catalogVersionId: facialV, stage: 1, qty: 1, reason: "Area tambahan",
    }));
    const add = ((await as(DOC, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
    const t = await as(DOC, (db) => consentText(db, s.v, s.planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId: s.v, planId: s.planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
    await as(FO, (db) => releaseAddition(db, key(), add, MGR.staffId));
    const { executionId } = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: add, performerId: DOC.staffId, identityConfirmed: true }));
    await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome: "completed" }));
    // the addition's execution never takes the initial bill's paid line: no performer until its own line is paid (mutation addition-matches-initial)
    const addPerformer = async () => (await h.admin.query(`select count(*)::int n from commission_contributions where source_id = $1`, [executionId])).rows[0].n;
    expect(await addPerformer()).toBe(0);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1, planItemId: add }]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    const rc = await as(FO, (db) => convertToReceivable(db, key(), s.v));
    expect(rc.amount).toBe(2_000_000);
    expect(await earned(invoiceId)).toEqual({}); // nothing collected; the performer waits for a fully paid line (mutation performer-unpaid)
    await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "transfer", amount: 500_000, details: TRF }));
    // still not fully paid: no performer for the addition yet
    expect(await addPerformer()).toBe(0);
    // the collected share accrues the sales contributions (the patient's first visit: new patient too)
    expect(await earned(invoiceId)).toEqual({ "closing_bc:C": 25_000, "new_patient:R": 5_000 });
    await as(OWN, (db) => writeOffAsOwner(db, key(), rc.receivable_id, "Pasien tidak dapat dihubungi"));
    expect(total(await earned(invoiceId))).toBe(0);
    expect((await h.admin.query(`select bool_and(blocked) b from commission_contributions where invoice_line_id = $1`, [line])).rows[0].b).toBe(true);
    // the first invoice's commission is untouched
    expect(total(await earned(s.invoiceId))).toBe(170_000);
    // a guiding BC attributed after the write-off earns nothing on the written-off line (BILL-23; mutation writeoff-accrues)
    await as(FO, (db) => attributeSale(db, key(), invoiceId, { guidingBcId: BC1.staffId }));
    expect(await earned(invoiceId)).not.toHaveProperty("guiding_bc:BC1");
    expect(total(await earned(invoiceId))).toBe(0);
    // a line on a written-off receivable never accrues again, even for a contribution never made before (BILL-23): the line's accrual
    // replayed for a fresh fact finds the write-off and stops
    await h.admin.query(`select commission_accrue_line($1, $2, 'allocation', gen_random_uuid())`, [A.tenantId, line]);
    expect(total(await earned(invoiceId))).toBe(0);
  });
});

// ── stage (c): batches, carry-forward (B-13), staff receivable at exit (B-21) ──
// Backdate rows into a past month (the insert-only guard paused for the test only, the receivables.test pattern).
async function backdate(table: "commission_entitlements" | "commission_adjustments", col: "accrued_at" | "adjusted_at", where: string, args: unknown[], monthsAgo: number) {
  await h.admin.query(`alter table ${table} disable trigger ${table}_insert_only`);
  try {
    await h.admin.query(`update ${table} set ${col} = (date_trunc('month', now() at time zone 'Asia/Jakarta') - make_interval(months => ${monthsAgo}) + interval '10 days') at time zone 'Asia/Jakarta' where ${where}`, args);
  } finally {
    await h.admin.query(`alter table ${table} enable always trigger ${table}_insert_only`);
  }
}
const periodKey = async (monthsAgo: number) =>
  (await h.admin.query(`select to_char(date_trunc('month', now() at time zone 'Asia/Jakarta') - make_interval(months => $1), 'YYYY-MM') k`, [monthsAgo])).rows[0].k as string;
const ofLine = `id in (select e.id from commission_entitlements e join commission_contributions c on c.id = e.contribution_id where c.invoice_line_id = $1)`;
const adjOfLine = `id in (select a.id from commission_adjustments a join commission_entitlements e on e.id = a.entitlement_id join commission_contributions c on c.id = e.contribution_id where c.invoice_line_id = $1)`;
async function lines(batchId: string) {
  const r = await h.admin.query(`select staff_id, gross::int g, adjustments::int a, carry_forward_in::int ci, net_payable::int n, carry_forward_out::int co from payout_batch_lines where batch_id = $1`, [batchId]);
  return Object.fromEntries(r.rows.map((x) => [who(x.staff_id), [x.g, x.a, x.ci, x.n, x.co]]));
}
async function runBatch(monthsAgo: number, pay = true) {
  const period = await periodKey(monthsAgo);
  const { batchId } = await as(FIN, (db) => openBatch(db, key(), period));
  const approval = await as(FIN, (db) => submitBatch(db, batchId));
  expect(await code(as(FIN, (db) => decideApproval(db, approval, true)))).not.toBe("ok"); // only the owner approves
  await as(OWN, (db) => decideApproval(db, approval, true));
  if (pay) await as(FIN, (db) => markBatchPaid(db, batchId, "transfer"));
  return batchId;
}

describe("money scenario 10 over three months: payout, deduction after payout, carry-forward, staff exit", () => {
  it("month 1 pays 210,000; month 2's refund deducts −210,000 (paid lines unchanged) and carries forward; month 3 recovers; exit → staff receivable", async () => {
    const s = await visitReady({ name: "Pasien Batch 10" });
    await pay(s);
    await treat(s);
    await backdate("commission_entitlements", "accrued_at", ofLine, [s.line], 3);
    const b1 = await runBatch(3);
    expect(await lines(b1)).toEqual({ C: [100_000, 0, 0, 100_000, 0], G: [40_000, 0, 0, 40_000, 0], R: [20_000, 0, 0, 20_000, 0], P: [50_000, 0, 0, 50_000, 0] });
    expect((await h.admin.query(`select state, paid_method from payout_batches where id = $1`, [b1])).rows[0]).toEqual({ state: "paid", paid_method: "transfer" });
    const ex = await as(FIN, (db) => exportBatch(db, b1));
    expect(ex.map((r) => [who(r.staff_id), r.net_payable]).sort()).toEqual([["C", 100_000], ["G", 40_000], ["P", 50_000], ["R", 20_000]]);
    expect((await h.admin.query(`select type from domain_events where aggregate_id = $1 order by occurred_at, id`, [b1])).rows.map((r) => r.type)).toEqual(["PayoutBatchApproved", "CommissionPaid"]);
    // month 2: the refund after payout
    await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 2_000_000, reason: "Pasien tidak puas" }));
    expect((await h.admin.query(`select bool_and(after_payout) b from commission_adjustments where ${adjOfLine}`, [s.line])).rows[0].b).toBe(true);
    await backdate("commission_adjustments", "adjusted_at", adjOfLine, [s.line], 2);
    const b2 = await runBatch(2);
    expect(await lines(b2)).toEqual({ C: [0, -100_000, 0, 0, 100_000], G: [0, -40_000, 0, 0, 40_000], R: [0, -20_000, 0, 0, 20_000], P: [0, -50_000, 0, 0, 50_000] });
    expect(await lines(b1)).toEqual({ C: [100_000, 0, 0, 100_000, 0], G: [40_000, 0, 0, 40_000, 0], R: [20_000, 0, 0, 20_000, 0], P: [50_000, 0, 0, 50_000, 0] });
    // month 3: C closes a new sale paid 1,000,000 (50,000), R registers the new patient (10,000); the rest carries on
    const s3 = await visitReady({ guiding: null, name: "Pasien Batch 10b" });
    await pay(s3, 1_000_000);
    await backdate("commission_entitlements", "accrued_at", ofLine, [s3.line], 1);
    const b3 = await runBatch(1, false);
    // only finance marks a batch paid (mutation owner-pays)
    expect(await code(as(OWN, (db) => markBatchPaid(db, b3, "cash")))).toBe("ERR_FORBIDDEN");
    expect(await lines(b3)).toEqual({ C: [50_000, 0, 100_000, 0, 50_000], R: [10_000, 0, 20_000, 0, 10_000], G: [0, 0, 40_000, 0, 40_000], P: [0, 0, 50_000, 0, 50_000] });
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [REG.staffId]);
    expect((await h.admin.query(`select count(*)::int n from staff_commission_receivables where staff_id = $1`, [REG.staffId])).rows[0].n).toBe(0); // b3 not paid yet
    await as(FIN, (db) => markBatchPaid(db, b3, "cash"));
    expect((await h.admin.query(`select amount::int a from staff_commission_receivables where staff_id = $1`, [REG.staffId])).rows.map((r) => r.a)).toEqual([10_000]);
    // G leaves: the remainder becomes an open staff receivable for the owner (B-21), and stops carrying
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [G.staffId]);
    const rec = (await h.admin.query(`select id, amount::int a, state from staff_commission_receivables where staff_id = $1`, [G.staffId])).rows;
    expect(rec.map((r) => [r.a, r.state])).toEqual([[40_000, "open"]]);
    // the remainder left the batch flow: G no longer carries into a later batch (mutation receivable-keeps-carrying)
    expect(Number((await h.admin.query(`select commission_carry_in($1, $2, now() + interval '1 year') c`, [A.tenantId, G.staffId])).rows[0].c)).toBe(0);
    expect(Number((await h.admin.query(`select commission_carry_in($1, $2, now() + interval '1 year') c`, [A.tenantId, DOC.staffId])).rows[0].c)).toBe(50_000);
    expect(await code(as(FIN, (db) => decideStaffReceivable(db, rec[0].id, "waived", "Dihapuskan")))).toBe("ERR_FORBIDDEN");
    await as(OWN, (db) => decideStaffReceivable(db, rec[0].id, "waived", "Kebijakan pemilik"));
    expect(await why(as(OWN, (db) => decideStaffReceivable(db, rec[0].id, "settled", "Lagi")))).toBe("ERR_VERSION_CONFLICT:decided");
    // Rekap: the owner reads the decision reason; the auditor reads it masked (r1 P2-3)
    const reasonOf = async (p: P) => (await as(p, (db) => listBatches(db))).receivables.find((r) => r.id === rec[0].id)?.decision_reason;
    expect([await reasonOf(OWN), await reasonOf(AU)]).toEqual(["Kebijakan pemilik", null]);
    // guards: a batch line, item, entitlement or adjustment never changes; a paid batch never moves back
    expect(await h.admin.query(`update payout_batch_lines set gross = 1 where batch_id = $1`, [b1]).then(() => "ok", (e) => e.message as string)).toMatch(/insert-only/);
    expect(await h.admin.query(`update payout_batches set state = 'approved' where id = $1`, [b1]).then(() => "ok", (e) => e.message as string)).toMatch(/moves draft/);
    expect(await h.admin.query(`delete from commission_entitlements where ${ofLine}`, [s.line]).then(() => "ok", (e) => e.message as string)).toMatch(/insert-only/);
    // a batch whose month is not over is refused; a second batch for a month is the same batch
    expect(await why(as(FIN, (db) => openBatch(db, key(), "2026-13")))).toBe("ERR_INVALID_INPUT:period");
    const p0 = await periodKey(0); // the Asia/Jakarta month (HYG-018), not the UTC one
    const now = (await as(FIN, (db) => openBatch(db, key(), p0))).batchId;
    expect(await why(as(FIN, (db) => submitBatch(db, now)))).toBe("ERR_VERSION_CONFLICT:period_open");
    const p1 = await periodKey(1);
    expect((await as(MGR, (db) => openBatch(db, key(), p1))).batchId).toBe(b3);
  });
});

describe("readers (r1 P2-3): own rows only, the batch roles, Admin Pusat none, tenants", () => {
  it("Komisi Saya shows the acting staff member's rows only; Rekap for owner/finance/auditor; rules for the manager; the simulator; export", async () => {
    const s = await visitReady({ guiding: null, name: "Pasien Pembaca" }); // G has left (the batch test above)
    await pay(s);
    const month = (await h.admin.query(`select to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM') m`)).rows[0].m as string;
    const mine = await as(C, (db) => myCommission(db, month));
    expect(mine.rows.length).toBeGreaterThan(0);
    // exactly C's own rows of the month (entitlements + adjustments), nobody else's
    const ids = (await h.admin.query(`select id from commission_entitlements where staff_id = $1 and accrued_at >= date_trunc('month', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'
      union all select id from commission_adjustments where staff_id = $1 and adjusted_at >= date_trunc('month', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'`, [C.staffId])).rows.map((r) => r.id).sort();
    expect(mine.rows.map((r) => r.id).sort()).toEqual(ids);
    // no patient data in the rows: item, invoice number, branch only
    expect(Object.keys(mine.rows.find((r) => r.kind === "entitlement")!).sort()).toEqual(["amount", "at", "basis", "branch", "id", "invoice", "item", "kind", "rule", "type"]);
    expect(JSON.stringify(mine)).not.toContain("Pasien Pembaca");
    // direct table reads: the recipient sees only their own entitlements (RLS)
    const own = await as(C, (db) => db.query(`select distinct staff_id from commission_entitlements`));
    expect(own.rows.map((r) => r.staff_id)).toEqual([C.staffId]);
    expect((await as(FIN, (db) => db.query(`select count(distinct staff_id)::int n from commission_entitlements`))).rows[0].n).toBeGreaterThan(1);
    // Rekap: owner, finance, auditor; not the manager, a BC or Admin Pusat
    expect((await as(FIN, (db) => listBatches(db))).can_open).toBe(true);
    expect((await as(AU, (db) => listBatches(db))).can_open).toBe(false);
    for (const p of [MGR, C]) expect(await code(as(p, (db) => listBatches(db)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(AP, (db) => myCommission(db, month)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(AP, (db) => listRules(db)))).toBe("ERR_FORBIDDEN");
    // rules: the manager reads (no prepare); a BC does not
    const rl = await as(MGR, (db) => listRules(db));
    expect([rl.can_prepare, rl.can_activate, rl.rules.length > 0]).toEqual([false, false, true]);
    // finance (no direct catalog read) gets the items in force through the reader
    expect((await as(FIN, (db) => listRules(db))).items.map((i) => i.id)).toContain(facial);
    expect(await code(as(C, (db) => listRules(db)))).toBe("ERR_FORBIDDEN");
    // simulator: 2,000,000 exempt → closing 100,000, performer 50,000 (no rule version is changed)
    const sim = await as(FIN, (db) => simulateRule(db, { itemId: facial, price: 2_000_000, closingBcId: C.staffId, performerId: DOC.staffId }));
    expect([sim.basis, sim.contributions.map((x) => [x.type, x.amount])]).toEqual([2_000_000, [["closing_bc", 100_000], ["performer", 50_000]]]);
    // another tenant reads nothing of A
    expect((await as(BOWN, (db) => listBatches(db))).batches).toEqual([]);
    expect((await as(BOWN, (db) => db.query(`select count(*)::int n from commission_entitlements`))).rows[0].n).toBe(0);
    expect((await as(BOWN, (db) => listRules(db))).rules).toEqual([]);
    // export: a submitted batch only; CSV escapes a formula-leading name
    expect(exportCsv([{ staff_id: "x", staff_name: "=SUM(A1)", gross: 1, adjustments: 0, carry_forward_in: 0, net_payable: 1, carry_forward_out: 0 }]))
      .toBe("Penerima,Kotor,Penyesuaian,Bawaan Masuk,Dibayar,Bawaan Keluar\r\n'=SUM(A1),1,0,0,1,0\r\n");
  });
});
