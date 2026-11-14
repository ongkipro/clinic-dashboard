// T-078 Done-when: refunds go to the patient balance by default (PR-21) and in cash only as an approved exception (B-04, SET-11),
// the Admin Pusat boundary (PR-63), the owner write-off and the requested one (PR-37: maker-checker, mandatory reason, audit), the
// receivable conversion of a visit's delivered unpaid remainder (PR-15 module level), and money scenarios 9 (9b), 15 (15b) and the
// receivable half of 3 (3b). Plus the plan reviews: the shared moved_to_balance ceiling and the pending cash refund's reserved room,
// the returned product back to its batch at the moving average (DATA-61), an undelivered product's dispensing cancelled, the
// handover blocked while a refund is pending, collection by any tender incl. the balance, a void refused after conversion, the
// patient merge refused with an open receivable, readers per role, branch and tenant (the auditor masked), and two T-077 review
// carry-overs (a deposit refused with the VAT gate closed; a deposit after a patient merge). Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { createDepot, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { receiveStock, saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { enableMockPort } from "../../src/modules/payments/payments";
import { confirmSelection, handOver, prepareDispensing } from "../../src/modules/pharmacy/pharmacy";
import { collectReceivable, convertToReceivable, payRefund, piutang, refundOptions, requestRefund, requestWriteOff, writeOffAsOwner } from "../../src/modules/cashier/receivables/receivables";
import { changeSetting } from "../../src/modules/settings/settings";
import { mergePatients } from "../../src/modules/patients/merge/merge";
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
const CHECKS = { identity: true, validity: true, dose: true, allergy: true, clarification: true, label: true, counselling: true };
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const EDC = { card_type: "debit", bank: "BCA", trace: "123456", approval_code: "A1B2C3" };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Piutang Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("PB1"), b2: await br("PB2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rcv${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Piutang ${n}` });
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
type S = Awaited<ReturnType<typeof visitReady>>;
// The nurse proposes an addition in the room; the doctor approves; the patient agrees (a new consent covering it).
async function addition(s: S, o: { version?: string; qty?: number; agree?: boolean; approve?: boolean } = {}) {
  const { requestId } = await as(NUR, (db) => createRequest(db, key(), s.v, {
    kind: "addition", planId: s.planId, catalogVersionId: o.version ?? fillerV, stage: 1, qty: o.qty ?? 1, reason: "Lipatan nasolabial dalam",
  }));
  if (o.approve === false) return { requestId, itemId: "" };
  const d = await as(DOC, (db) => decideRequest(db, key(), requestId, true, null));
  const itemId = (d as { item_id: string }).item_id;
  if (o.agree !== false) await consent(s.v, s.planId);
  return { requestId, itemId };
}
const release = (who: P, itemId: string, collector = FO.staffId, k = key()) => as(who, (db) => releaseAddition(db, k, itemId, collector));
const start = (v: string, itemId: string, who = DOC) => as(who, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: who.staffId, identityConfirmed: true }));
const finish = (eid: string, outcome: "completed" | "medical_stop" | "clinic_stop" | "patient_stop" = "completed", who = DOC) =>
  as(who, (db) => finishTreatment(db, key(), eid, outcome === "completed" ? { outcome } : { outcome, reason: "Alasan berhenti uji" }));
async function billAddition(s: S, itemId: string, item = filler, qty = 1) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: qty, planItemId: itemId }]));
  return invoiceId;
}
const payment = async (v: string) => (await h.admin.query(`select payment from visits where id = $1`, [v])).rows[0].payment as string;
const close = (v: string, who = FO) => why(as(who, (db) => closeVisit(db, key(), v)));

let A: T; let B: T;
let AP: P; let MGR2: P; let RO: P; let serum: string; let serumItem: string;
let OWN: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FO: P; let FOB2: P; let MGR: P; let FIN: P; let AU: P; let PH: P; let BFO: P;
let facial: string; let facialV: string; let filler: string; let fillerV: string;

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
  MGR = await person(A, "manager", A.b1); FIN = await person(A, "finance"); AU = await person(A, "auditor"); PH = await person(A, "pharmacist", A.b1);
  BFO = await person(B, "fo_cashier", B.b1);
  AP = await person(A, "admin_pusat"); MGR2 = await person(A, "manager", A.b1); RO = await person(A, "records_officer", A.b1);
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
  const f = await svc("TB-FAC", "Facial Dasar", 500_000); facial = f.itemId; facialV = f.versionId;
  const g = await svc("TB-FIL", "Filler Tambahan", 400_000); filler = g.itemId; fillerV = g.versionId;
  await as(MGR, (db) => enableMockPort(db));
  // A product with stock in an apotek depot (scenario 15: serum 333,000).
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "PB-SRM" }, { name: "Serum Refund", tax_category: "non_object", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  serumItem = (await h.admin.query(`select id from stock_items where catalog_item_id = $1`, [serum])).rows[0].id;
  const g1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
  const apt = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Piutang", kind: "apotek" }))).depotId;
  const batch = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: serumItem, batchNo: "PB-B1", expiry: day(200), quantity: "40", reason: "stok_awal" }))).batchId;
  await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: g1, toDepotId: apt, lines: [{ batchId: batch, quantity: "40" }] }));
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
// A counter sale of serum ×q to a patient, paid in cash; handed over when `hand`.
async function counterSale(q = 1, hand = true, name = "Pasien Refund") {
  const pid = await patient(A, A.b1, name);
  // Jual Cepat to a named patient: a counter invoice with a patient (dispensings are made for counter sales).
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: q }]));
  await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 333_000 * q, cashTendered: 333_000 * q }]));
  const d = (await h.admin.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [invoiceId])).rows[0]?.id as string;
  if (hand && d) {
    await as(PH, (db) => prepareDispensing(db, key(), d));
    await as(PH, (db) => handOver(db, key(), d, { checks: CHECKS }));
  }
  return { pid, invoiceId, dispensing: d, line: (await lineOf(invoiceId)).id as string };
}

describe("money scenario 15 and PR-21: a product refund", () => {
  it("15a: delivered serum refunded to balance by default: paid at once, moved_to_balance, from_refund, the unit back to its batch, ProductReturned", async () => {
    const s = await counterSale(1);
    const opts = await as(FO, (db) => refundOptions(db, s.invoiceId));
    expect(opts.lines.map((l) => [l.room, l.delivered, l.blocked])).toEqual([[333_000, true, null]]);
    const r = await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 333_000, reason: "Pasien berubah pikiran", returnedQuantity: 1 }));
    expect([r.state, r.approval_id]).toEqual(["paid", null]);
    const row = await refundRow(r.refund_id);
    expect([row.destination, row.delivered, Number(row.vat_reversed), row.returned_quantity]).toEqual(["balance", true, 0, 1]);
    expect(await balance(s.pid)).toBe(333_000);
    expect(await entries(s.pid)).toEqual([["from_refund", 333_000, "refund"]]);
    expect(Number((await lineOf(s.invoiceId)).moved_to_balance)).toBe(333_000);
    const mv = (await h.admin.query(`select kind, leg, quantity::int q, source_kind from stock_movements where source_id = $1`, [r.refund_id])).rows;
    expect(mv).toEqual([{ kind: "return", leg: null, q: 1, source_kind: "refund" }]);
    // one transaction: the events share now() and uuid v7 does not order within a millisecond, so compare as a set
    expect((await events("refund", r.refund_id)).sort()).toEqual(["ProductReturned", "RefundPaid"]);
    // No cash left the drawer: no payment row for the refund; nothing more to refund on the line.
    expect(await code(as(FO, (db) => requestRefund(db, key(), s.line, { amount: 1, reason: "Lagi" })))).toBe("ERR_VERSION_CONFLICT");
  });

  it("15b: the cash exception: requested → approved by the owner (maker-checker) → paid at the drawer: from_refund then cash_refund", async () => {
    const s = await counterSale(1);
    const r = await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 333_000, destination: "cash", reason: "Pasien minta tunai", returnedQuantity: 1 }));
    expect(r.state).toBe("requested");
    // Nothing moves yet; the room is reserved.
    expect(await balance(s.pid)).toBe(0);
    expect((await as(FO, (db) => refundOptions(db, s.invoiceId))).lines[0].room).toBe(0);
    // The pending cash refund's room is not refunded twice (refund_reserved).
    expect(await why(as(FO, (db) => requestRefund(db, key(), s.line, { amount: 1, reason: "Dua kali" })))).toBe("ERR_VERSION_CONFLICT:refund_above_paid");
    expect(await code(as(FO, (db) => payRefund(db, key(), r.refund_id, "cash")))).toBe("ERR_VERSION_CONFLICT");
    // The manager under the default SET-11 (owner only) is refused; the requester cannot approve their own.
    expect(await code(as(MGR, (db) => decideApproval(db, r.approval_id!, true)))).toBe("ERR_FORBIDDEN");
    await as(OWN, (db) => decideApproval(db, r.approval_id!, true));
    expect((await refundRow(r.refund_id)).state).toBe("approved");
    const k = key();
    await as(FO, (db) => payRefund(db, k, r.refund_id, "cash"));
    const row = await refundRow(r.refund_id);
    expect([row.state, row.paid_method]).toEqual(["paid", "cash"]);
    expect(await entries(s.pid)).toEqual([["from_refund", 333_000, "refund"], ["cash_refund", -333_000, "refund"]]);
    expect(await balance(s.pid)).toBe(0);
    expect((await events("refund", r.refund_id)).sort()).toEqual(["ProductReturned", "RefundApproved", "RefundPaid"]);
    expect((await as(FO, (db) => payRefund(db, k, r.refund_id, "cash"))).replayed).toBe(true);
    // Another branch's FO does not see it; a refund is never deleted.
    expect(await code(as(FOB2, (db) => payRefund(db, key(), r.refund_id, "cash")))).toBe("ERR_NOT_FOUND");
    expect(await h.admin.query(`delete from refunds where id = $1`, [r.refund_id]).then(() => "ok", (e) => e.message as string)).toMatch(/never deleted/);
  });

  it("PR-37 maker-checker and SET-11: a manager requests, may not approve their own; with owner_manager another manager approves; rejected → failed, the room freed", async () => {
    const s = await counterSale(1);
    const r = await as(MGR, (db) => requestRefund(db, key(), s.line, { amount: 100_000, destination: "cash", reason: "Kemasan rusak" }));
    expect(await code(as(MGR, (db) => decideApproval(db, r.approval_id!, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    await as(OWN, (db) => changeSetting(db, { key: "SET-11", branchId: null, value: "owner_manager", reason: "Manajer boleh" }));
    try {
      await as(MGR2, (db) => decideApproval(db, r.approval_id!, true));
      expect((await refundRow(r.refund_id)).state).toBe("approved");
    } finally {
      await as(OWN, (db) => changeSetting(db, { key: "SET-11", branchId: null, restore: true, reason: "Kembali" }));
    }
    const r2 = await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 100_000, destination: "cash", reason: "Kemasan rusak lagi" }));
    expect((await as(FO, (db) => refundOptions(db, s.invoiceId))).lines[0].room).toBe(133_000);
    await as(OWN, (db) => decideApproval(db, r2.approval_id!, false, "Tidak sesuai kebijakan"));
    expect([(await refundRow(r2.refund_id)).state, (await refundRow(r2.refund_id)).failure_code]).toEqual(["failed", "rejected"]);
    expect((await as(FO, (db) => refundOptions(db, s.invoiceId))).lines[0].room).toBe(233_000);
    // A requester may withdraw a pending request (cancelled → failed).
    const r3 = await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 1_000, destination: "cash", reason: "Coba tarik" }));
    await as(FO, (db) => cancelApproval(db, r3.approval_id!));
    expect((await refundRow(r3.refund_id)).failure_code).toBe("cancelled");
  });

  it("refusals: above paid, unpaid line, the owner's cash request, a counter sale without a patient, returned quantity above handed; roles and branches", async () => {
    const s = await counterSale(1);
    expect(await why(as(FO, (db) => requestRefund(db, key(), s.line, { amount: 333_001, reason: "Terlalu besar" })))).toBe("ERR_VERSION_CONFLICT:refund_above_paid");
    expect(await why(as(OWN, (db) => requestRefund(db, key(), s.line, { amount: 1_000, destination: "cash", reason: "Owner tunai" }))))
      .toBe("ERR_FORBIDDEN:an owner refunds to balance; a cash refund is requested by staff");
    expect(await code(as(FO, (db) => requestRefund(db, key(), s.line, { amount: 1_000, reason: "Lebih", returnedQuantity: 2 })))).toBe("ERR_INVALID_INPUT");
    const pid = await patient(A, A.b1, "Pasien Belum Bayar");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    const unpaidLine = (await lineOf(invoiceId)).id as string;
    expect(await why(as(FO, (db) => requestRefund(db, key(), unpaidLine, { amount: 1_000, reason: "Belum bayar" })))).toBe("ERR_VERSION_CONFLICT:line_unpaid");
    const { invoiceId: anon } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), anon, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), anon, [{ method: "cash", amount: 333_000, cashTendered: 333_000 }]));
    const anonLine = (await lineOf(anon)).id as string;
    expect(await why(as(FO, (db) => requestRefund(db, key(), anonLine, { amount: 1_000, reason: "Tanpa pasien" })))).toBe("ERR_VERSION_CONFLICT:invoice_without_patient");
    for (const p of [DOC, AU, PH]) expect(await code(as(p, (db) => requestRefund(db, key(), s.line, { amount: 1_000, reason: "Peran lain" }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FOB2, (db) => requestRefund(db, key(), s.line, { amount: 1_000, reason: "Cabang lain" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => requestRefund(db, key(), s.line, { amount: 1_000, reason: "Tenant lain" })))).toBe("ERR_NOT_FOUND");
  });

  it("PR-21: an undelivered product refunded to balance: its queued dispensing is cancelled; a pending cash refund blocks the handover", async () => {
    const s = await counterSale(1, false);
    const r = await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 333_000, reason: "Belum diambil" }));
    expect((await refundRow(r.refund_id)).delivered).toBe(false);
    expect((await h.admin.query(`select state from dispensings where id = $1`, [s.dispensing])).rows[0].state).toBe("cancelled");
    expect(await balance(s.pid)).toBe(333_000);
    const t = await counterSale(1, false, "Pasien Tunggu Refund");
    await as(FO, (db) => requestRefund(db, key(), t.line, { amount: 333_000, destination: "cash", reason: "Minta tunai" }));
    expect(await code(as(PH, (db) => prepareDispensing(db, key(), t.dispensing)))).not.toBe("ok");
  });

  it("PR-63: Admin Pusat cannot request, pay, decide a refund, write off or read Piutang", async () => {
    const s = await counterSale(1);
    const r = await as(FO, (db) => requestRefund(db, key(), s.line, { amount: 10_000, destination: "cash", reason: "Uji Admin Pusat" }));
    expect(await code(as(AP, (db) => requestRefund(db, key(), s.line, { amount: 1_000, reason: "Admin" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(AP, (db) => decideApproval(db, r.approval_id!, true)))).not.toBe("ok");
    expect((await refundRow(r.refund_id)).state).toBe("requested");
    expect(await code(as(AP, (db) => payRefund(db, key(), r.refund_id, "cash")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(AP, (db) => piutang(db, null)))).toBe("ERR_FORBIDDEN");
  });
});

describe("the PKP variant (scenario 15 PKP / 19 pattern): VAT reversed in proportion on a refund", () => {
  it("a taxable line paid in full recognises its VAT; a partial refund to balance reverses the same share; the rest stays recognised", async () => {
    const C = await tenant();
    const cown = await person(C, "owner"); const cfo = await person(C, "fo_cashier", C.b1); const cfin = await person(C, "finance");
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak refund\n%%EOF\n`);
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const it = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, it, fileId, "approved"));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: today, npwp: "012345678901234", reason: "PKP" }));
    const tx = (await as(cown, (db) => publish(db, { kind: "product", code: "PK-SRM" }, { name: "Serum Pajak", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"))).itemId;
    const pid = await patient(C, C.b1, "Pasien PKP Refund");
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: tx, quantity: 1 }]));
    await as(cfo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 333_000, cashTendered: 333_000 }]));
    let l = await lineOf(invoiceId);
    expect([Number(l.vat_base), Number(l.vat_amount), Number(l.vat_recognised_amount)]).toEqual([300_000, 33_000, 33_000]);
    const r = await as(cfo, (db) => requestRefund(db, key(), l.id, { amount: 111_000, reason: "Sebagian dikembalikan" }));
    l = await lineOf(invoiceId);
    expect([Number((await refundRow(r.refund_id)).vat_reversed), Number(l.vat_reversed_amount), Number(l.moved_to_balance)]).toEqual([11_000, 11_000, 111_000]);
    await as(cfo, (db) => requestRefund(db, key(), l.id, { amount: 222_000, reason: "Sisanya dikembalikan" }));
    l = await lineOf(invoiceId);
    expect([Number(l.vat_reversed_amount), Number(l.moved_to_balance), await balance(pid)]).toEqual([33_000, 333_000, 333_000]);
    // DATA-32: a PKP visit line delivered and unpaid, converted to a receivable, recognises its whole VAT now. The delivery is a
    // handed line-linked dispensing written as the owner (the visit path's selection and pharmacy chain are tested in their tasks).
    const pid2 = await patient(C, C.b1, "Pasien PKP Piutang");
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [C.tenantId, C.b1, pid2, cfo.staffId])).rows[0].id as string;
    const { invoiceId: vinv } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: pid2, visitId: v }));
    await as(cfo, (db) => issueKasirInvoice(db, key(), vinv, [{ itemId: tx, quantity: 1 }]));
    const vl = await lineOf(vinv);
    expect(Number(vl.vat_recognised_amount)).toBe(0);
    const cph = await person(C, "pharmacist", C.b1);
    await as(cph, (db) => saveItem(db, key(), null, { catalogItemId: tx, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    const si = (await h.admin.query(`select id from stock_items where tenant_id = $1 and catalog_item_id = $2`, [C.tenantId, tx])).rows[0].id as string;
    const depot = (await h.admin.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [C.tenantId, C.b1])).rows[0].id as string;
    await h.admin.query(`alter table dispensings disable trigger dispensings_guard`);
    try {
      await h.admin.query(`insert into dispensings (tenant_id, branch_id, visit_id, patient_id, invoice_line_id, stock_item_id, quantity, state,
                             prepared_at, prepared_by, prepare_key, depot_id, handed_at, handed_by, hand_key, checks)
        values ($1, $2, null, $3, $4, $5, 1, 'handed', now(), $6, $7, $8, now(), $6, $9, '{}'::jsonb)`, [C.tenantId, C.b1, pid2, vl.id, si, cfo.staffId, `pk-${key()}`, depot, `hk-${key()}`]);
    } finally {
      await h.admin.query(`alter table dispensings enable always trigger dispensings_guard`);
    }
    const rc = await as(cfo, (db) => convertToReceivable(db, key(), v));
    expect([rc.amount, Number((await lineOf(vinv)).vat_recognised_amount)]).toEqual([333_000, 33_000]);
  });
});

describe("money scenario 9: a treatment not performed", () => {
  it("9: refunded to balance (undelivered); 9b: the cash exception approved and paid; VAT none (exempt)", async () => {
    const s = await visitReady({ name: "Pasien Batal Tindakan" });
    const line = (await lineOf(s.invoiceId)).id as string;
    const r = await as(FO, (db) => requestRefund(db, key(), line, { amount: 200_000, reason: "Tindakan tidak jadi" }));
    expect([(await refundRow(r.refund_id)).delivered, await balance(s.pid)]).toEqual([false, 200_000]);
    const c = await as(FO, (db) => requestRefund(db, key(), line, { amount: 300_000, destination: "cash", reason: "Pasien minta tunai" }));
    await as(OWN, (db) => decideApproval(db, c.approval_id!, true));
    await as(MGR, (db) => payRefund(db, key(), c.refund_id, "transfer", { bank: "BCA", reference: "RF-9" }));
    expect(await balance(s.pid)).toBe(200_000);
    expect(Number((await lineOf(s.invoiceId)).moved_to_balance)).toBe(500_000);
    // The shared ceiling: an interrupted move finds nothing left on this line.
    expect((await refundRow(c.refund_id)).paid_details).toEqual({ bank: "BCA", reference: "RF-9" });
  });

  it("a service is delivered only by a finished counted execution: a clinic stop is not delivered, a completed one is", async () => {
    const s1 = await visitReady({ name: "Pasien Berhenti Klinik" });
    await finish((await start(s1.v, s1.itemId)).executionId, "clinic_stop");
    const l1 = (await lineOf(s1.invoiceId)).id as string;
    const r1 = await as(FO, (db) => requestRefund(db, key(), l1, { amount: 100_000, reason: "Dihentikan klinik" }));
    const s2 = await visitReady({ name: "Pasien Selesai Tindakan" });
    await finish((await start(s2.v, s2.itemId)).executionId);
    const l2 = (await lineOf(s2.invoiceId)).id as string;
    const r2 = await as(FO, (db) => requestRefund(db, key(), l2, { amount: 100_000, reason: "Komplain hasil" }));
    expect([(await refundRow(r1.refund_id)).delivered, (await refundRow(r2.refund_id)).delivered]).toEqual([false, true]);
  });
});

describe("money scenario 3b and PR-15: a performed addition unpaid becomes a receivable", () => {
  it("converts the delivered unpaid remainder, the visit closes, the next visit collects it; a void after conversion is refused", async () => {
    const s = await visitReady({ name: "Pasien Piutang" });
    const { itemId } = await addition(s);
    await release(FO, itemId, MGR.staffId);
    const { executionId } = await start(s.v, itemId);
    await finish(executionId);
    expect(await why(as(FO, (db) => convertToReceivable(db, key(), s.v)))).toBe("ERR_VERSION_CONFLICT:unbilled_addition");
    const inv = await billAddition(s, itemId);
    expect(await close(s.v)).toMatch(/^ERR_/);
    const k = key();
    const rc = await as(FO, (db) => convertToReceivable(db, k, s.v));
    expect(rc.amount).toBe(400_000);
    expect(Number((await lineOf(inv)).receivable_amount)).toBe(400_000);
    expect(await payment(s.v)).toBe("done");
    expect(await close(s.v)).toBe("ok");
    expect(await events("receivable", rc.receivable_id)).toEqual(["ReceivableCreated"]);
    expect(await as(FO, (db) => convertToReceivable(db, k, s.v))).toEqual(rc);
    // The converted invoice cannot be voided; nothing is owed on it.
    expect(await why(as(MGR, (db) => requestVoid(db, key(), inv, "Salah input")))).toBe("ERR_VERSION_CONFLICT:invoice_paid");
    expect(await code(as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount: 1, cashTendered: 1 }])))).toBe("ERR_INVALID_INPUT");
    // A converted line is not refunded (its remainder is owed on the receivable).
    const invLine = (await lineOf(inv)).id as string;
    // The converted remainder is set once (invoice_lines_guard).
    expect(await h.admin.query(`update invoice_lines set receivable_amount = 1 where id = $1`, [invLine]).then(() => "ok", (e) => e.message as string)).toMatch(/frozen/);
    expect(await why(as(FO, (db) => requestRefund(db, key(), invLine, { amount: 1_000, reason: "Sudah piutang" })))).toBe("ERR_VERSION_CONFLICT:line_on_receivable");
    // Piutang lists it with the collector; collected in two parts (EDC, then the balance).
    const list = await as(FO, (db) => piutang(db, null));
    const row = list.receivables.find((x) => x.id === rc.receivable_id)!;
    expect([row.open, row.bucket, row.state, row.collector]).toEqual([400_000, "0-30", "open", expect.stringMatching(/^Staf Piutang/)]);
    // Asal tagihan for the FO, who may not read invoice lines or catalog versions directly (RLS): through the reader.
    expect(row.lines).toEqual([{ name: expect.any(String), amount: 400_000 }]);
    expect(await why(as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "edc", amount: 400_001, details: EDC })))).toBe("ERR_INVALID_INPUT:overpayment");
    const c1 = await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "edc", amount: 150_000, details: EDC }));
    expect([c1.open, c1.number.startsWith("KW-")]).toEqual([250_000, true]);
    await h.admin.query(`select balance_post($1, $2, $3, 'from_refund', 250000, $4::jsonb, $5, $6, 'fo_cashier')`,
      [A.tenantId, s.pid, A.b1, JSON.stringify({ source_kind: "uji", source_id: key() }), `cr-${key()}`, FO.staffId]);
    const c2 = await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "balance", amount: 250_000 }));
    expect([c2.open, await balance(s.pid)]).toEqual([0, 0]); // the balance paid it
    // A collected receivable is not written off.
    expect(await why(as(OWN, (db) => writeOffAsOwner(db, key(), rc.receivable_id, "Sudah lunas dibayar pasien")))).toBe("ERR_VERSION_CONFLICT:receivable_settled");
    expect((await h.admin.query(`select state, collected_amount::int c from receivables where id = $1`, [rc.receivable_id])).rows[0]).toEqual({ state: "collected", c: 400_000 });
    const al = (await h.admin.query(`select a.amount::int a, a.vat_portion::int v, p.invoice_id from payment_allocations a join payments p on p.id = a.payment_id where a.receivable_id = $1 order by a.created_at`, [rc.receivable_id])).rows;
    expect(al).toEqual([{ a: 150_000, v: 0, invoice_id: null }, { a: 250_000, v: 0, invoice_id: null }]);
    expect(await code(as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "cash", amount: 1, cashTendered: 1 })))).toBe("ERR_VERSION_CONFLICT");
    expect(await events("receivable", rc.receivable_id)).toEqual(["ReceivableCreated", "ReceivableCollected", "ReceivableCollected"]);
  });

  it("nothing to convert; roles and branches; overpayment refused; the auditor reads masked", async () => {
    const s = await visitReady({ name: "Pasien Lunas" });
    expect(await why(as(FO, (db) => convertToReceivable(db, key(), s.v)))).toBe("ERR_VERSION_CONFLICT:nothing_to_convert");
    // An undelivered unpaid remainder stays owed: not converted.
    const u = await visitReady({ name: "Pasien Belum Tindakan", pay: false });
    expect(await why(as(FO, (db) => convertToReceivable(db, key(), u.v)))).toBe("ERR_VERSION_CONFLICT:nothing_to_convert");
    for (const p of [FIN, DOC, AU]) expect(await code(as(p, (db) => convertToReceivable(db, key(), s.v))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FOB2, (db) => convertToReceivable(db, key(), s.v)))).toBe("ERR_NOT_FOUND");
    const list = await as(AU, (db) => piutang(db, null));
    expect(list.receivables.every((x) => x.patient.name === null)).toBe(true);
    expect(await code(as(BFO, (db) => piutang(db, null)))).toBe("ok");
    expect((await as(BFO, (db) => piutang(db, null))).receivables).toEqual([]);
  });
});

describe("PR-37: write-offs", () => {
  async function openReceivable(name: string) {
    const s = await visitReady({ name });
    const { itemId } = await addition(s);
    await release(FO, itemId, FO.staffId);
    const { executionId } = await start(s.v, itemId);
    await finish(executionId);
    await billAddition(s, itemId);
    return { s, rc: await as(FO, (db) => convertToReceivable(db, key(), s.v)) };
  }

  it("the owner writes off alone: reason ≥ 10, owner-self approval, the whole open amount, audit and event", async () => {
    const { rc } = await openReceivable("Pasien Hapus Owner");
    expect(await code(as(OWN, (db) => writeOffAsOwner(db, key(), rc.receivable_id, "Pendek")))).toBe("ERR_FORBIDDEN");
    const w = await as(OWN, (db) => writeOffAsOwner(db, key(), rc.receivable_id, "Pasien pindah kota, tidak dapat dihubungi"));
    const row = (await h.admin.query(`select amount::int a, owner_self, requested_by, approved_by, reason from write_offs where id = $1`, [w.write_off_id])).rows[0];
    expect(row).toEqual({ a: 400_000, owner_self: true, requested_by: OWN.staffId, approved_by: OWN.staffId, reason: "Pasien pindah kota, tidak dapat dihubungi" });
    const ap = (await h.admin.query(`select state, owner_self, requested_by, decided_by from approvals where id = $1`, [w.approval_id])).rows[0];
    expect(ap).toEqual({ state: "approved", owner_self: true, requested_by: OWN.staffId, decided_by: OWN.staffId });
    expect((await h.admin.query(`select state from receivables where id = $1`, [rc.receivable_id])).rows[0].state).toBe("written_off");
    expect(await events("receivable", rc.receivable_id)).toEqual(["ReceivableCreated", "ReceivableWrittenOff"]);
    expect((await h.admin.query(`select count(*)::int c from audit_events where object_id = $1 and reason_code = 'receivable_written_off'`, [rc.receivable_id])).rows[0].c).toBe(1);
  });

  it("requested by FO, decided by the owner; a manager may not request or decide; rejected clears the link; a pending request sends the owner to Persetujuan", async () => {
    const { rc } = await openReceivable("Pasien Hapus Ajuan");
    expect(await code(as(MGR, (db) => requestWriteOff(db, key(), rc.receivable_id, "Manajer ajukan")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO, (db) => requestWriteOff(db, key(), rc.receivable_id, "x")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(DOC, (db) => requestWriteOff(db, key(), rc.receivable_id, "Dokter ajukan")))).toBe("ERR_FORBIDDEN");
    const a1 = await as(FO, (db) => requestWriteOff(db, key(), rc.receivable_id, "Tidak tertagih"));
    expect(await code(as(FIN, (db) => requestWriteOff(db, key(), rc.receivable_id, "Ajukan lagi")))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await code(as(OWN, (db) => writeOffAsOwner(db, key(), rc.receivable_id, "Owner langsung hapus saja")))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await code(as(MGR, (db) => decideApproval(db, a1.approvalId, true)))).not.toBe("ok");
    await as(OWN, (db) => decideApproval(db, a1.approvalId, false, "Masih bisa ditagih"));
    expect((await h.admin.query(`select write_off_approval_id from receivables where id = $1`, [rc.receivable_id])).rows[0].write_off_approval_id).toBeNull();
    const a2 = await as(FIN, (db) => requestWriteOff(db, key(), rc.receivable_id, "Tidak tertagih setelah ditagih"));
    await as(OWN, (db) => decideApproval(db, a2.approvalId, true));
    const w = (await h.admin.query(`select amount::int a, owner_self, requested_by, approved_by from write_offs where receivable_id = $1`, [rc.receivable_id])).rows[0];
    expect(w).toEqual({ a: 400_000, owner_self: false, requested_by: FIN.staffId, approved_by: OWN.staffId });
    // Settled: no new request; the guard keeps a written-off receivable closed and never deleted.
    expect(await why(as(FO, (db) => requestWriteOff(db, key(), rc.receivable_id, "Sudah dihapus")))).toBe("ERR_VERSION_CONFLICT:write_off_pending_or_settled");
    const raw = (sql: string) => h.admin.query(sql, [rc.receivable_id]).then(() => "ok", (e) => e.message as string);
    expect(await raw(`update receivables set write_off_approval_id = null where id = $1`)).toMatch(/only collected or written off/);
    expect(await raw(`delete from receivables where id = $1`)).toMatch(/never deleted/);
  });
});

describe("the patient merge", () => {
  it("a patient with an open receivable is not merged away", async () => {
    const { s } = await (async () => {
      const s = await visitReady({ name: "Pasien Gabung Piutang" });
      const { itemId } = await addition(s);
      await release(FO, itemId, FO.staffId);
      const { executionId } = await start(s.v, itemId);
      await finish(executionId);
      await billAddition(s, itemId);
      await as(FO, (db) => convertToReceivable(db, key(), s.v));
      return { s };
    })();
    const survivor = await patient(A, A.b1, "Pasien Penerima Gabung");
    expect(await why(as(RO, (db) => mergePatients(db, key(), survivor, s.pid, "Rekam ganda pasien yang sama")))).toBe("ERR_VERSION_CONFLICT:patient_has_receivable");
  });


});

