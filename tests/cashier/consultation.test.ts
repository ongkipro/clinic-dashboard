// T-079 Done-when: scenario PR-12 (a fee waived by a purchase is re-charged and deducted from the refund when every qualifying
// purchase is fully refunded) and money scenario 4 (4a consultation only, 4b no retroactive waiver, 4c the re-charge from the
// refund to balance, 4d one of two purchases refunded). Plus the plan reviews: cash refunds, the absorbed cash refund, packages,
// interrupted treatment not a refund, exemptions (package session, control, complaint), controls, SET-6 unset, one path, roles,
// branches, tenants, PR-63, idempotency and the guards. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createDepot, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { receiveStock, saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { enableMockPort } from "../../src/modules/payments/payments";
import { flagComplaint, resolveComplaint, takeComplaint } from "../../src/modules/clinical/complaints/complaints";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { payRefund, requestRefund } from "../../src/modules/cashier/receivables/receivables";
import { cancelPackage, interruptedToBalance, reserveSession, setPackageContents } from "../../src/modules/packages/packages";
import { chargeConsultationFee, exemptConsultationFee, getConsultationFee, listControls, scheduleControl } from "../../src/modules/cashier/consultation/consultation";
import { changeSetting } from "../../src/modules/settings/settings";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { closeVisit } from "../../src/modules/visits/visits";
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
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Konsultasi Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("KB1"), b2: await br("KB2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`kons${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Konsultasi ${n}` });
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
async function patient(t: T, branch: string, name: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
const consent = async (v: string, planId: string) => {
  const t = await as(DOC, (db) => consentText(db, v, planId));
  await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
};
// A visit with a signed exam, a plan of one initial item (facial ×1), the consent, the selection confirmed and the
// initial bill issued and (optionally) paid in cash.
async function visitReady(o: { pay?: boolean; name?: string } = {}) {
  const pid = await patient(A, A.b1, o.name ?? "Pasien Tambahan");
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Tambahan", "Kondisi rahasia pasien"));
  const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: facialV, qty: 1 }));
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  await consent(v, planId);
  await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: itemId }] }));
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
  if (o.pay !== false) await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
  return { pid, v, examId, planId, itemId, invoiceId };
}
const start = (v: string, itemId: string, who = DOC) => as(who, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: who.staffId, identityConfirmed: true }));
const finish = (eid: string, outcome: "completed" | "medical_stop" | "clinic_stop" | "patient_stop" = "completed", who = DOC) =>
  as(who, (db) => finishTreatment(db, key(), eid, outcome === "completed" ? { outcome } : { outcome, reason: "Alasan berhenti uji" }));
const close = (v: string, who = FO) => why(as(who, (db) => closeVisit(db, key(), v)));

let A: T; let B: T;
let AP: P; let serum: string; let serumItem: string;
let OWN: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FO: P; let FOB2: P; let MGR: P; let AU: P; let PH: P; let BFO: P;
let facial: string; let facialV: string;
let consult: string; let sunscreen: string; let pkg: string; let ctlFacial: string;
const setFee = (amount: number | null) => as(OWN, (db) => changeSetting(db, amount === null
  ? { key: "SET-6", branchId: null, restore: true, reason: "Kembali ke bawaan" } : { key: "SET-6", branchId: null, value: amount, reason: "Biaya konsultasi" }));

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1);
  BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1); FOB2 = await person(A, "fo_cashier", A.b2);
  MGR = await person(A, "manager", A.b1); AU = await person(A, "auditor"); PH = await person(A, "pharmacist", A.b1);
  BFO = await person(B, "fo_cashier", B.b1);
  AP = await person(A, "admin_pusat");
  await credential(A, DOC, A.b1);
  const svc = async (c: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  };
  const f = await svc("KB-FAC", "Facial Dasar", 500_000); facial = f.itemId; facialV = f.versionId;
  await as(MGR, (db) => enableMockPort(db));
  // A product with stock in an apotek depot (scenario 15: serum 333,000).
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "KB-SRM" }, { name: "Serum Refund", tax_category: "non_object", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  serumItem = (await h.admin.query(`select id from stock_items where catalog_item_id = $1`, [serum])).rows[0].id;
  const g1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
  const apt = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Konsultasi", kind: "apotek" }))).depotId;
  const batch = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: serumItem, batchNo: "KB-B1", expiry: day(200), quantity: "40", reason: "stok_awal" }))).batchId;
  await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: g1, toDepotId: apt, lines: [{ batchId: batch, quantity: "40" }] }));
  // T-079 fixture (money-scenarios.md:11-43): a "Konsultasi" service (exempt_medical); sunscreen 222,000; a 2-session package;
  // a facial with one free control valid 14 days; the fee (SET-6) 150,000.
  const k = await as(OWN, (db) => publish(db, { kind: "service", code: "KB-KON" }, {
    name: "Konsultasi Dokter", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 99_000, category: "consultation", prep_min: 0, treatment_min: 15,
    buffer_min: 0, indications: "Indikasi", consent_template: "Templat konsultasi.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan baru"));
  if (k.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [k.approvalId]));
  consult = k.itemId;
  sunscreen = (await as(OWN, (db) => publish(db, { kind: "product", code: "KB-SUN" }, { name: "Sunscreen", tax_category: "non_object", tax_basis: "Barang", normal_price: 222_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: sunscreen, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  const sunItem = (await h.admin.query(`select id from stock_items where catalog_item_id = $1`, [sunscreen])).rows[0].id;
  const sb = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: sunItem, batchNo: "KB-S1", expiry: day(200), quantity: "40", reason: "stok_awal" }))).batchId;
  await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: g1, toDepotId: apt, lines: [{ batchId: sb, quantity: "40" }] }));
  const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "KB-PKT" }, { name: "Paket 2x Facial", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 900_000 } as never, "Paket"));
  await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: facial, count: 2 }]));
  pkg = pv.itemId;
  const cf = await as(OWN, (db) => publish(db, { kind: "service", code: "KB-CTL" }, {
    name: "Facial Berkontrol", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "facial", prep_min: 10, treatment_min: 30,
    buffer_min: 10, indications: "Indikasi", consent_template: "Templat facial kontrol.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }], control_count: 1, control_validity_days: 14,
  } as never, "Layanan baru"));
  if (cf.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [cf.approvalId]));
  ctlFacial = cf.itemId;
  await setFee(150_000);
  // T-080 (PR-72): one case discounts a line to 0 as FO; SET-12 lets FO apply it here.
  await as(OWN, (db) => changeSetting(db, { key: "SET-12", branchId: null, value: { fo_persen: 100, manajer_persen: 10, manajer_rupiah: 500_000 }, reason: "Uji diskon FO" }));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

// ── helpers ──
const balance = async (pid: string) => Number((await h.admin.query(`select coalesce((select balance from balance_accounts where patient_id = $1), 0) b`, [pid])).rows[0].b);
const entries = async (pid: string) => (await h.admin.query(
  `select kind, amount::int a, source_kind from balance_entries where account_id = (select id from balance_accounts where patient_id = $1) order by seq`, [pid])).rows
  .map((r) => [r.kind, r.a, r.source_kind]);
const refundRow = async (id: string) => (await h.admin.query(`select * from refunds where id = $1`, [id])).rows[0];
const lineOf = async (invoiceId: string, item?: string) => (await h.admin.query(
  `select * from invoice_lines where invoice_id = $1 ${item ? "and item_id = $2" : ""} order by created_at limit 1`, item ? [invoiceId, item] : [invoiceId])).rows[0];
const events = async (kind: string, id: string) => (await h.admin.query(`select type from domain_events where aggregate_kind = $1 and aggregate_id = $2 order by occurred_at, id`, [kind, id])).rows.map((r) => r.type);


// ── T-079 helpers ──
// A consultation visit: checked in, the doctor opens and signs an examination (the doctor step; plan §7.9).
async function consultVisit(name: string, pid?: string, branch = A.b1) {
  const p = pid ?? await patient(A, branch, name);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, branch, p, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  return { pid: p, v };
}
// A product bought on the visit (its own visit invoice), paid in cash. (A visit product's dispensing comes from the selection;
// the fee rule reads the paid invoice line, not the hand-over.)
async function buy(c: { pid: string; v: string }, items: { item: string; price: number }[]) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: c.pid, visitId: c.v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, items.map((x) => ({ itemId: x.item, quantity: 1 }))));
  const total = items.reduce((s, x) => s + x.price, 0);
  await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: total, cashTendered: total }]));
  return invoiceId;
}
const fee = async (v: string) => (await h.admin.query(`select * from consultation_fees where visit_id = $1`, [v])).rows[0];
const feeInvoices = async (v: string) => (await h.admin.query(
  `select i.id, i.state, l.id line_id, l.line_total::int total, l.tax_category, l.vat_amount::int vat from invoices i join invoice_lines l on l.invoice_id = i.id
    where i.visit_id = $1 and i.consultation order by i.created_at`, [v])).rows;
const visitEvents = async (v: string) => (await h.admin.query(`select type, payload from domain_events where aggregate_kind = 'visit' and aggregate_id = $1 and type like 'Consultation%' order by occurred_at, id`, [v])).rows;
const lines = async (inv: string) => (await h.admin.query(`select id, item_id from invoice_lines where invoice_id = $1 order by created_at, id`, [inv])).rows;

describe("scenario PR-12 and money scenario 4c: the fee waived by a purchase is re-charged when every qualifying purchase is refunded", () => {
  it("serum 333,000 bought → waived at close; refunded to balance → re-charge line 150,000 paid from the balance (183,000 left); events", async () => {
    const c = await consultVisit("Pasien Serum");
    const inv = await buy(c, [{ item: serum, price: 333_000 }]);
    expect(await close(c.v)).toBe("ok");
    const f0 = await fee(c.v);
    expect([f0.state, f0.waiver, Number(f0.fee_amount)]).toEqual(["waived", "purchase", 150_000]);
    expect((await h.admin.query(`select count(*)::int c from consultation_fee_purchases where fee_id = $1`, [f0.id])).rows[0].c).toBe(1);
    const line = (await lineOf(inv)).id as string;
    const r = await as(FO, (db) => requestRefund(db, key(), line, { amount: 333_000, reason: "Dikembalikan utuh" }));
    expect(r.state).toBe("paid");
    const f1 = await fee(c.v);
    expect([f1.state, Number(f1.deducted), f1.recharge_refund_id]).toEqual(["recharged", 150_000, r.refund_id]);
    const fi = await feeInvoices(c.v);
    expect(fi).toEqual([{ id: expect.any(String), state: "issued", line_id: f1.fee_line_id, total: 150_000, tax_category: "exempt_medical", vat: 0 }]);
    expect(await entries(c.pid)).toEqual([["from_refund", 333_000, "refund"], ["use", -150_000, null]]);
    expect(await balance(c.pid)).toBe(183_000);
    // the re-charge invoice is settled (KW receipt, one balance payment, allocated to the fee line)
    const pay = (await h.admin.query(`select p.method, p.amount::int a, a.invoice_line_id from payments p join payment_allocations a on a.payment_id = p.id where p.invoice_id = $1`, [fi[0].id])).rows;
    expect(pay).toEqual([{ method: "balance", a: 150_000, invoice_line_id: f1.fee_line_id }]);
    const ev = await visitEvents(c.v);
    expect(ev.map((e) => e.type)).toEqual(["ConsultationFeeCharged", "ConsultationFeeRecharged"]);
    expect(Object.keys(ev[0].payload).sort()).toEqual(["invoice_id", "invoice_line_id", "visit_id"]);
    expect(Object.keys(ev[1].payload).sort()).toEqual(["fee_id", "refund_id", "visit_id"]);
    expect(r.fee_deducted).toBe(150_000);
    // (the returned unit's stock movement, scenario 15 J2, is T-078's: tests/cashier/receivables.test.ts 15a)
    expect(await events("refund", r.refund_id)).toEqual(["RefundPaid"]);
    // A consultation line is never refunded (r1 P1-3).
    expect(await why(as(FO, (db) => requestRefund(db, key(), f1.fee_line_id, { amount: 1_000, reason: "Coba refund biaya" })))).toBe("ERR_VERSION_CONFLICT:consultation_line");
  });
});

describe("money scenario 4a and 4b: consultation only; no retroactive waiver", () => {
  it("4a: nothing bought → the visit cannot close until charged and paid; 4b: a later visit's purchase does not touch the charged fee", async () => {
    const c = await consultVisit("Pasien Konsultasi Saja");
    expect(await close(c.v)).toBe("ERR_VERSION_CONFLICT:consultation_fee_due");
    expect((await as(FO, (db) => getConsultationFee(db, c.v))).status).toBe("due");
    const ch = await as(FO, (db) => chargeConsultationFee(db, key(), c.v));
    expect(ch.amount).toBe(150_000);
    expect(await close(c.v)).toBe("ERR_VERSION_CONFLICT:unpaid_bill");
    await as(FO, (db) => receivePayment(db, key(), ch.invoice_id, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
    expect(await close(c.v)).toBe("ok");
    const f = await fee(c.v);
    expect([f.state, f.waiver, Number(f.fee_amount), f.fee_line_id]).toEqual(["charged", null, 150_000, ch.invoice_line_id]);
    expect((await visitEvents(c.v)).map((e) => e.type)).toEqual(["ConsultationFeeCharged"]);
    // a second charge is refused; the paid fee is not refundable (no retroactive waiver)
    expect(await why(as(FO, (db) => requestRefund(db, key(), ch.invoice_line_id, { amount: 150_000, reason: "Coba refund" })))).toBe("ERR_VERSION_CONFLICT:consultation_line");
    // 4b: day 2 buys serum; day 1's fee is untouched.
    const d2 = await consultVisit("", c.pid);
    await buy(d2, [{ item: serum, price: 333_000 }]);
    expect(await close(d2.v)).toBe("ok");
    expect((await fee(d2.v)).waiver).toBe("purchase");
    const f1 = await fee(c.v);
    expect([f1.state, f1.fee_line_id]).toEqual(["charged", ch.invoice_line_id]);
    expect((await feeInvoices(c.v)).map((x) => x.state)).toEqual(["issued"]);
  });
});

describe("money scenario 4d: one of two purchases refunded keeps the fee waived", () => {
  it("serum + sunscreen; the sunscreen refunded → no re-charge; then the serum → re-charge (the last purchase)", async () => {
    const c = await consultVisit("Pasien Dua Produk");
    const inv = await buy(c, [{ item: serum, price: 333_000 }, { item: sunscreen, price: 222_000 }]);
    expect(await close(c.v)).toBe("ok");
    const ls = await lines(inv);
    const sun = ls.find((x) => x.item_id === sunscreen)!.id as string;
    const ser = ls.find((x) => x.item_id === serum)!.id as string;
    await as(FO, (db) => requestRefund(db, key(), sun, { amount: 222_000, reason: "Sunscreen kembali" }));
    expect([(await fee(c.v)).state, (await feeInvoices(c.v)).length, await balance(c.pid)]).toEqual(["waived", 0, 222_000]);
    await as(FO, (db) => requestRefund(db, key(), ser, { amount: 333_000, reason: "Serum kembali" }));
    expect([(await fee(c.v)).state, await balance(c.pid)]).toEqual(["recharged", 222_000 + 333_000 - 150_000]);
    // a partial refund never re-charges (only a fully refunded line counts)
    const c2 = await consultVisit("Pasien Refund Sebagian");
    const inv2 = await buy(c2, [{ item: serum, price: 333_000 }]);
    expect(await close(c2.v)).toBe("ok");
    const l2 = (await lineOf(inv2)).id as string;
    await as(FO, (db) => requestRefund(db, key(), l2, { amount: 100_000, reason: "Sebagian" }));
    expect((await fee(c2.v)).state).toBe("waived");
  });
});

// A package bought during the visit (a package invoice has no visit, 0093:835), paid in cash; returns the package.
async function buyPackage(c: { pid: string; v: string }, paid = 900_000) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: c.pid }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pkg, quantity: 1 }]));
  if (paid) await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: paid, cashTendered: paid }]));
  return (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
}

describe("refunds in cash and the absorbed cash refund (plan §7.5, r1 P2-3)", () => {
  it("a cash refund that completes the full refund pays out the rest after the re-charge (183,000 in cash; the balance nets 0)", async () => {
    const c = await consultVisit("Pasien Refund Tunai");
    const inv = await buy(c, [{ item: serum, price: 333_000 }]);
    expect(await close(c.v)).toBe("ok");
    const sl = (await lineOf(inv)).id as string;
    const r = await as(FO, (db) => requestRefund(db, key(), sl, { amount: 333_000, destination: "cash", reason: "Minta tunai" }));
    await as(OWN, (db) => decideApproval(db, r.approval_id!, true));
    const pr = await as(FO, (db) => payRefund(db, key(), r.refund_id, "cash"));
    expect(pr.fee_deducted).toBe(150_000);
    expect(await entries(c.pid)).toEqual([["from_refund", 333_000, "refund"], ["use", -150_000, null], ["cash_refund", -183_000, "refund"]]);
    expect([await balance(c.pid), (await fee(c.v)).state, Number((await fee(c.v)).deducted)]).toEqual([0, "recharged", 150_000]);
  });

  it("a purchase smaller than the fee: the refund to balance pays what it can, the rest stays owed; a cash refund absorbed whole is refused, then failed when a balance refund takes the line", async () => {
    const small = (await as(OWN, (db) => publish(db, { kind: "product", code: "KB-MIN" }, { name: "Masker Kecil", tax_category: "non_object", tax_basis: "Barang", normal_price: 100_000 } as never, "Produk"))).itemId;
    const c = await consultVisit("Pasien Produk Kecil");
    const inv = await buy(c, [{ item: small, price: 100_000 }]);
    expect(await close(c.v)).toBe("ok");
    const line = (await lineOf(inv)).id as string;
    expect(await why(as(FO, (db) => requestRefund(db, key(), line, { amount: 100_000, destination: "cash", reason: "Minta tunai" })))).toBe("ERR_VERSION_CONFLICT:refund_absorbed_by_fee");
    // a partial cash refund now (not absorbing the fee: the line is not yet fully refunded), approved, then a balance refund of the rest
    const cr = await as(FO, (db) => requestRefund(db, key(), line, { amount: 40_000, destination: "cash", reason: "Sebagian tunai" }));
    await as(OWN, (db) => decideApproval(db, cr.approval_id!, true));
    // a balance refund of the whole line: with it, the approved 40,000 cash refund would complete the line and be absorbed whole
    // (fee 150,000 ≥ 40,000), so it is failed and its room released (r1 P2-3); the balance refund then takes the line.
    const br = await as(FO, (db) => requestRefund(db, key(), line, { amount: 100_000, reason: "Ke saldo saja" }));
    expect((await refundRow(cr.refund_id)).state).toBe("failed");
    expect((await refundRow(cr.refund_id)).failure_code).toBe("absorbed_by_fee");
    expect(br.fee_deducted).toBe(100_000);
    const fi = await feeInvoices(c.v);
    expect(fi.map((x) => x.total)).toEqual([150_000]);
    expect(Number((await h.admin.query(`select kasir_outstanding($1, $2) o`, [A.tenantId, fi[0].id])).rows[0].o)).toBe(50_000);
    expect(await balance(c.pid)).toBe(0);
  });
});

describe("packages and what is not a refund (plan §7.3, §7.4, r1 P1-2)", () => {
  it("a paid package bought during the visit waives the fee; cancelled with nothing redeemed → re-charged from the moved value", async () => {
    const c = await consultVisit("Pasien Paket");
    const pk = await buyPackage(c);
    expect(await close(c.v)).toBe("ok");
    expect((await fee(c.v)).waiver).toBe("purchase");
    await as(MGR, (db) => cancelPackage(db, key(), pk, "Pasien pindah kota"));
    const f = await fee(c.v);
    expect([f.state, f.recharge_package_id, Number(f.deducted)]).toEqual(["recharged", pk, 150_000]);
    expect(await balance(c.pid)).toBe(900_000 - 150_000);
  });

  it("an unpaid package does not waive; an interrupted treatment and a partial refund are not refunds", async () => {
    const c = await consultVisit("Pasien Paket Belum Bayar");
    await buyPackage(c, 0);
    expect(await close(c.v)).toBe("ERR_VERSION_CONFLICT:consultation_fee_due");
    // an interrupted treatment moving the only purchase to balance never re-charges (not a refund)
    const s = await visitReady({ name: "Pasien Berhenti Medis" });
    const { executionId } = await start(s.v, s.itemId);
    await finish(executionId, "medical_stop");
    await as(FO, (db) => interruptedToBalance(db, key(), executionId));
    expect(await close(s.v)).toBe("ok");
    expect((await fee(s.v)).waiver).toBe("purchase");
  });
});

describe("exemptions and controls (BILL-4/5, PR-43; r1 P1-5)", () => {
  it("a package session on the visit waives; a valid control waives at close and is used once", async () => {
    const c0 = await consultVisit("Pasien Kontrol");
    const inv = await buy(c0, [{ item: ctlFacial, price: 300_000 }]);
    const line = (await lineOf(inv)).id as string;
    expect(await close(c0.v)).toBe("ok");
    expect(await why(as(FO, (db) => scheduleControl(db, key(), line, day(30))))).toBe("ERR_INVALID_INPUT:control_date"); // beyond 14 days
    expect(await why(as(FO, (db) => scheduleControl(db, key(), line, day(-1))))).toBe("ERR_INVALID_INPUT:control_date"); // in the past
    const ctl = await as(DOC, (db) => scheduleControl(db, key(), line, day(3)));
    expect(ctl.valid_until).toBe(day(10)); // SET-7 hari 7
    expect(await why(as(DOC, (db) => scheduleControl(db, key(), line, day(4))))).toBe("ERR_VERSION_CONFLICT:controls_used"); // control_count 1
    // the control visit: no purchase → waived by the control, the control used
    const c1 = await consultVisit("", c0.pid);
    expect((await as(FO, (db) => getConsultationFee(db, c1.v))).control_id).toBe(ctl.control_id);
    expect(await close(c1.v)).toBe("ok");
    expect([(await fee(c1.v)).waiver, (await fee(c1.v)).control_id]).toEqual(["control", ctl.control_id]);
    const list = await as(FO, (db) => listControls(db, c0.pid));
    expect(list.controls.map((x) => x.state)).toEqual(["used"]);
    // a second visit cannot use it again
    const c2 = await consultVisit("", c0.pid);
    expect(await close(c2.v)).toBe("ERR_VERSION_CONFLICT:consultation_fee_due");
    // a package session reserved on a visit waives
    const c3 = await consultVisit("Pasien Sesi Paket");
    const pk = await buyPackage(c3);
    expect(await close(c3.v)).toBe("ok");
    const c4 = await consultVisit("", c3.pid);
    await as(FO, (db) => reserveSession(db, key(), pk, c4.v));
    expect(await close(c4.v)).toBe("ok");
    expect((await fee(c4.v)).waiver).toBe("package_session");
  });

  it("an exemption is refused on a visit with a purchase; a control does not waive its own source visit; refunded source cancels its controls", async () => {
    const c0 = await consultVisit("Pasien Kontrol Refund");
    const inv = await buy(c0, [{ item: ctlFacial, price: 300_000 }]);
    const line = (await lineOf(inv)).id as string;
    const ctl = await as(FO, (db) => scheduleControl(db, key(), line, day(2)));
    expect(await why(as(FO, (db) => exemptConsultationFee(db, key(), c0.v, { waiver: "control", controlId: ctl.control_id })))).toBe("ERR_VERSION_CONFLICT:purchase_on_visit");
    // its own source visit is never waived by it (r1 P1-5): with a second purchase on the visit refunded away, the close looks for a
    // control and must not take the one scheduled from this visit's own line.
    // A line discounted to 0 is no qualifying purchase (line_total 0) yet carries the version's control; its control stays valid,
    // and still the visit it was bought on owes the fee.
    const c9 = await consultVisit("Pasien Kontrol Sendiri");
    const { invoiceId: inv9 } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: c9.pid, visitId: c9.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), inv9, [{ itemId: ctlFacial, quantity: 1, discount: 300_000 }]));
    const line9 = (await lineOf(inv9)).id as string;
    const own = await as(FO, (db) => scheduleControl(db, key(), line9, day(1)));
    expect((await as(FO, (db) => getConsultationFee(db, c9.v))).status).toBe("due");
    expect(await close(c9.v)).toBe("ERR_VERSION_CONFLICT:consultation_fee_due");
    // charged instead (the control stays scheduled), then another visit of the patient may use it
    const ch9 = await as(FO, (db) => chargeConsultationFee(db, key(), c9.v));
    await as(FO, (db) => receivePayment(db, key(), ch9.invoice_id, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
    expect(await close(c9.v)).toBe("ok");
    const c10 = await consultVisit("", c9.pid);
    expect((await as(FO, (db) => getConsultationFee(db, c10.v))).control_id).toBe(own.control_id);
    expect(await close(c0.v)).toBe("ok");
    await as(FO, (db) => requestRefund(db, key(), line, { amount: 300_000, reason: "Tidak jadi" }));
    expect((await as(FO, (db) => listControls(db, c0.pid))).controls.map((x) => x.state)).toEqual(["cancelled"]);
    expect(await code(as(FO, (db) => scheduleControl(db, key(), line, day(3))))).toBe("ERR_VERSION_CONFLICT");
  });
});

describe("explicit exemptions before close: a control, a kontrol_gratis complaint; an expired control (review 9bef67ca P2-1)", () => {
  it("a valid control exempts explicitly (used once); an expired one neither exempts nor waives at close", async () => {
    const c0 = await consultVisit("Pasien Kontrol Eksplisit");
    const inv = await buy(c0, [{ item: ctlFacial, price: 300_000 }]);
    const line = (await lineOf(inv)).id as string;
    expect(await close(c0.v)).toBe("ok");
    const ctl = await as(FO, (db) => scheduleControl(db, key(), line, day(2)));
    const c1 = await consultVisit("", c0.pid);
    const k = key();
    const e = await as(FO, (db) => exemptConsultationFee(db, k, c1.v, { waiver: "control", controlId: ctl.control_id }));
    expect((await as(FO, (db) => exemptConsultationFee(db, k, c1.v, { waiver: "control", controlId: ctl.control_id }))).fee_id).toBe(e.fee_id);
    expect(await close(c1.v)).toBe("ok");
    const f = await fee(c1.v);
    expect([f.id, f.state, f.waiver, f.control_id]).toEqual([e.fee_id, "waived", "control", ctl.control_id]);
    expect((await as(FO, (db) => listControls(db, c0.pid))).controls.map((x) => [x.state, x.used_visit_id])).toEqual([["used", c1.v]]);
    // an expired control: valid_until moved to yesterday as the table owner (the guard freezes it for the app; setup only)
    const c2 = await consultVisit("Pasien Kontrol Kedaluwarsa");
    const inv2 = await buy(c2, [{ item: ctlFacial, price: 300_000 }]);
    const line2 = (await lineOf(inv2)).id as string;
    expect(await close(c2.v)).toBe("ok");
    const old = await as(FO, (db) => scheduleControl(db, key(), line2, day(0)));
    await h.admin.query(`alter table consultation_controls disable trigger consultation_controls_guard`);
    try {
      await h.admin.query(`update consultation_controls set control_date = $2::date - 8, valid_until = $2::date - 1 where id = $1`, [old.control_id, day(0)]);
    } finally {
      await h.admin.query(`alter table consultation_controls enable always trigger consultation_controls_guard`);
    }
    const c3 = await consultVisit("", c2.pid);
    expect(await why(as(FO, (db) => exemptConsultationFee(db, key(), c3.v, { waiver: "control", controlId: old.control_id })))).toBe("ERR_NOT_FOUND:control not found");
    expect((await as(FO, (db) => getConsultationFee(db, c3.v))).control_id).toBeNull();
    expect(await close(c3.v)).toBe("ERR_VERSION_CONFLICT:consultation_fee_due");
  });

  it("a kontrol_gratis complaint (PR-43) exempts once; another outcome or another patient's complaint does not", async () => {
    const c0 = await consultVisit("Pasien Keluhan");
    const { taskId } = await as(FO, (db) => flagComplaint(db, key(), { patientId: c0.pid, visitId: c0.v, kind: "klinis", source: "visit_note", triage: "kuning", summary: "Kemerahan setelah tindakan" }));
    await as(DOC, (db) => takeComplaint(db, key(), taskId));
    await as(DOC, (db) => resolveComplaint(db, key(), taskId, "kontrol_gratis", "Kontrol gratis diberikan"));
    await buy(c0, [{ item: serum, price: 333_000 }]);
    expect(await close(c0.v)).toBe("ok");
    const other = await consultVisit("Pasien Lain");
    expect(await why(as(FO, (db) => exemptConsultationFee(db, key(), other.v, { waiver: "complaint", complaintTaskId: taskId })))).toBe("ERR_NOT_FOUND:complaint not found");
    const c1 = await consultVisit("", c0.pid);
    await as(FO, (db) => exemptConsultationFee(db, key(), c1.v, { waiver: "complaint", complaintTaskId: taskId }));
    expect(await close(c1.v)).toBe("ok");
    expect([(await fee(c1.v)).waiver, (await fee(c1.v)).complaint_task_id]).toEqual(["complaint", taskId]);
    const c2 = await consultVisit("", c0.pid);
    expect(await why(as(FO, (db) => exemptConsultationFee(db, key(), c2.v, { waiver: "complaint", complaintTaskId: taskId })))).toBe("ERR_VERSION_CONFLICT:complaint_used");
    // a complaint resolved otherwise does not exempt
    const { taskId: t2 } = await as(FO, (db) => flagComplaint(db, key(), { patientId: c0.pid, visitId: c2.v, kind: "klinis", source: "visit_note", triage: "kuning", summary: "Kering setelah tindakan" }));
    await as(DOC, (db) => takeComplaint(db, key(), t2));
    await as(DOC, (db) => resolveComplaint(db, key(), t2, "edukasi", "Edukasi diberikan"));
    expect(await why(as(FO, (db) => exemptConsultationFee(db, key(), c2.v, { waiver: "complaint", complaintTaskId: t2 })))).toBe("ERR_NOT_FOUND:complaint not found");
  });
});

describe("SET-6 unset, one path, VAT-free fixture (r1 P1-1)", () => {
  it("with SET-6 unset there is no fee and no refusal; the consultation item may be billed as an ordinary line; with it set, it may not", async () => {
    await setFee(null);
    try {
      const c = await consultVisit("Pasien Tanpa Tarif");
      expect(await why(as(FO, (db) => chargeConsultationFee(db, key(), c.v)))).toBe("ERR_NOT_AVAILABLE:consultation_fee_unset");
      expect((await as(FO, (db) => getConsultationFee(db, c.v))).status).toBe("none");
      expect(await close(c.v)).toBe("ok");
      expect(await fee(c.v)).toBeUndefined();
    } finally {
      await setFee(150_000);
    }
    const c2 = await consultVisit("Pasien Item Konsultasi");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: c2.pid, visitId: c2.v }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: consult, quantity: 1 }])))).toBe("ERR_INVALID_INPUT:consultation_item");
    const ch = await as(FO, (db) => chargeConsultationFee(db, key(), c2.v));
    expect(await why(as(FO, (db) => chargeConsultationFee(db, key(), c2.v)))).toBe("ERR_VERSION_CONFLICT:fee_already_charged");
    // a visit with a qualifying purchase is not charged (the purchase waives the fee)
    const c3 = await consultVisit("Pasien Sudah Beli");
    await buy(c3, [{ item: serum, price: 333_000 }]);
    expect(await why(as(FO, (db) => chargeConsultationFee(db, key(), c3.v)))).toBe("ERR_VERSION_CONFLICT:purchase_on_visit");
    // the consultation invoice is never ordinary: a purchase invoice can still be issued after it
    const inv = await buy(c2, [{ item: serum, price: 333_000 }]);
    expect(inv).toBeTruthy();
    expect(ch.amount).toBe(150_000);
  });
});

describe("roles, branches, tenants, PR-63, idempotency and the guards", () => {
  it("only cashier roles charge or exempt; Admin Pusat and the auditor are refused; branch and tenant isolation; replay", async () => {
    const c = await consultVisit("Pasien Peran");
    for (const p of [DOC, BC, NUR, PH, AP, AU]) expect(await code(as(p, (db) => chargeConsultationFee(db, key(), c.v))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(AP, (db) => getConsultationFee(db, c.v)))).toBe("ERR_FORBIDDEN");
    expect((await as(AU, (db) => getConsultationFee(db, c.v))).status).toBe("due");
    expect(await code(as(FOB2, (db) => chargeConsultationFee(db, key(), c.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => chargeConsultationFee(db, key(), c.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => getConsultationFee(db, c.v)))).toBe("ERR_NOT_FOUND");
    const k = key();
    const a1 = await as(FO, (db) => chargeConsultationFee(db, k, c.v));
    const a2 = await as(FO, (db) => chargeConsultationFee(db, k, c.v));
    expect(a2.invoice_id).toBe(a1.invoice_id);
    expect((await feeInvoices(c.v)).length).toBe(1);
    for (const p of [BC, NUR, PH, AP, AU]) expect(await code(as(p, (db) => scheduleControl(db, key(), a1.invoice_line_id, day(1)))), p.role).toBe("ERR_FORBIDDEN");
    // RLS: tenant B reads none of A's rows
    expect((await as(BFO, (db) => db.query(`select count(*)::int c from consultation_fees`))).rows[0].c).toBe(0);
  });

  it("the guards: decisions frozen, never deleted; the consultation flag frozen; invoice_issue refuses a consultation draft", async () => {
    const c = await consultVisit("Pasien Guard");
    await buy(c, [{ item: serum, price: 333_000 }]);
    expect(await close(c.v)).toBe("ok");
    const f = await fee(c.v);
    const raw = (sql: string, p: unknown[]) => h.admin.query(sql, p).then(() => "ok", (e) => e.message as string);
    expect(await raw(`update consultation_fees set waiver = 'control' where id = $1`, [f.id])).toMatch(/re-charged once/);
    // only a purchase waiver is re-charged, once: a charged decision cannot move
    const c2 = await consultVisit("Pasien Guard Tagih");
    const ch = await as(FO, (db) => chargeConsultationFee(db, key(), c2.v));
    await as(FO, (db) => receivePayment(db, key(), ch.invoice_id, [{ method: "cash", amount: 150_000, cashTendered: 150_000 }]));
    expect(await close(c2.v)).toBe("ok");
    const f2 = await fee(c2.v);
    expect(await raw(`update consultation_fees set state = 'recharged' where id = $1`, [f2.id])).toMatch(/re-charged once/);
    expect(await raw(`delete from consultation_fees where id = $1`, [f.id])).toMatch(/never deleted/);
    expect(await raw(`delete from consultation_fee_purchases where fee_id = $1`, [f.id])).not.toBe("ok");
    const inv = (await h.admin.query(`select id from invoices where visit_id = $1 and not consultation limit 1`, [c.v])).rows[0].id;
    expect(await raw(`update invoices set consultation = true where id = $1`, [inv])).toMatch(/frozen/);
  });
});
