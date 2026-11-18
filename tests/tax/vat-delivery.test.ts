// HYG-023 (A-12, DEC-116; Panel 2 Q1–Q5 2026-11-18): VAT is due at the earlier of payment or delivery. A taxable line delivered before
// payment recognises the delivered share's VAT at delivery (vat_line_deliver, cause line_delivery); a later payment adds only the
// remainder; a receivable conversion records 0. Delivery points: an addition counted on an issued line (treatment_finish), an addition
// performed before its line is issued (invoice_issue, tax point = finished_at, event clamped to the cutover — Q3), a consultation fee
// charged (consultation_invoice_issue — Q2), a deferred discount decided on a delivered line (discount_sync — S8). An approved void reverses the
// voided lines' recognised VAT (invoice_void_sync, line_void — S7). Visit products handed before any invoice stay recognised at payment (Q4).
// Synthetic data on real writers (MIG-2); a PKP tenant with the tax-advice evidence approved (the vat_on_invoices gate).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { rollforward } from "../../src/modules/accounting/subledgers/subledgers";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { chargeConsultationFee } from "../../src/modules/cashier/consultation/consultation";
import { issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { convertToReceivable } from "../../src/modules/cashier/receivables/receivables";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createDepot, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { receiveStock, saveItem } from "../../src/modules/inventory/stock";
import { CHECKS, type Check, confirmSelection, handOver, prepareDispensing } from "../../src/modules/pharmacy/pharmacy";
import { changeSetting } from "../../src/modules/settings/settings";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor"];
const STEP: StepUp = { verified: true };
const NPWP = "012345678901234";

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const b1 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'VD1', 'VD1', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  return { tenantId, b1 };
}
async function person(t: T, role: Role): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`vd${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf PPN ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: t.b1 });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.message}`));
const wib = (ms = 0) => new Date(Date.now() + ms).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const today = () => wib();
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(640, 16); b.writeUInt32BE(240, 20);
  return b;
}
async function patient(t: T, name = "Pasien PPN Rahasia"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $4, '1990-01-01', 'female', 'nik', $2, $3, 'islam', 'Karyawan', 's1', 'kawin', $5,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name, t.b1])).rows[0].id as string;
}
// Move facts back in time (the writers stamp clock_timestamp()): the guards are bypassed only for this fixture surgery.
async function shift(table: string, set: string, where: string, args: unknown[]) {
  const tg = (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [table])).rows.map((r) => r.tgname as string);
  for (const g of tg) await h.admin.query(`alter table ${table} disable trigger ${g}`);
  try { await h.admin.query(`update ${table} set ${set} where ${where}`, args); } finally { for (const g of tg) await h.admin.query(`alter table ${table} enable always trigger ${g}`); }
}

// One PKP tenant (VAT gate open: tax advice approved; PKP for 40 days), taxable services, the consultation fee rule (SET-6).
let A: T; let B: T;
let OWN: P; let FIN: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FO: P; let MGR: P; let BFO: P; let PH: P;
let serum: { itemId: string; versionId: string };
let base: { itemId: string; versionId: string }; let taxable: { itemId: string; versionId: string }; let consult: string;

async function pkp(t: T, own: P, fin: P) {
  const pdf = Buffer.from(`%PDF-1.7\nsaran pajak ${t.tenantId}\n%%EOF\n`);
  const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
  const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
  await as(own, (db) => decideEvidence(db, ev, fileId, "approved"));
  await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
  await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
  await as(own, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: wib(86_400_000), npwp: NPWP, reason: "PKP" }));
  await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 40, changed_at = now() - interval '45 days' where tenant_id = $1`, [t.tenantId, today()]);
  await h.admin.query(`update tenants set pkp_effective_from = $2::date - 40 where id = $1`, [t.tenantId, today()]);
  await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
  await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
}
async function service(own: P, fh: P, code: string, name: string, price: number, tax: string, category = "facial") {
  const v = await as(own, (db) => publish(db, { kind: "service", code }, {
    name, tax_category: tax, tax_basis: tax === "exempt_medical" ? "Jasa medis" : "Jasa", normal_price: price, category, prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: category === "consultation" ? [{ role: "doctor", mode: "performs" }] : [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
  return v;
}

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT PPN Penyerahan");
  B = await tenant("PT PPN Lain");
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); FH = await person(A, "facility_head"); DOC = await person(A, "doctor");
  NUR = await person(A, "nurse"); BC = await person(A, "bc"); FO = await person(A, "fo_cashier"); MGR = await person(A, "manager"); BFO = await person(B, "fo_cashier");
  PH = await person(A, "pharmacist");
  for (const [kind, b] of [["str", null], ["sip", A.b1]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [A.tenantId, DOC.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
  await pkp(A, OWN, FIN);
  base = await service(OWN, FH, "VD-BASE", "Facial Dasar PPN", 500_000, "exempt_medical");
  taxable = await service(OWN, FH, "VD-TAX", "Perawatan Estetika Kena Pajak", 666_000, "taxable_service");
  consult = (await service(OWN, FH, "VD-KON", "Konsultasi Kena Pajak", 99_000, "taxable_service", "consultation")).itemId;
  await as(OWN, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 222_000, reason: "Biaya konsultasi" }));
  // a taxable product in the apotek depot (Q4: a visit product handed before any invoice)
  serum = await as(OWN, (db) => publish(db, { kind: "product", code: "VD-SRM" }, { name: "Serum Kena Pajak", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"));
  const si = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum.itemId, unit: "btl", storage: "ruang", highValue: false, active: true }))).itemId;
  const g1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
  const apt = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek PPN", kind: "apotek" }))).depotId;
  const day = (d: number) => wib(d * 86_400_000);
  const batch = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: si, batchNo: "VD-S1", expiry: day(200), quantity: "10", reason: "stok_awal" }))).batchId;
  await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: g1, toDepotId: apt, lines: [{ batchId: batch, quantity: "10" }] }));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await owner?.end();
  await h?.close();
});

// A visit with a paid exempt base treatment (the initial bill), then an approved, agreed, released taxable addition of qty units.
async function visitWithAddition(qty = 1, release = true) {
  const pid = await patient(A);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program PPN", "Kondisi rahasia"));
  const { itemId: baseItem } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: base.versionId, qty: 1 }));
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  const consent = async () => {
    const ct = await as(DOC, (db) => consentText(db, v, planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: ct.content_hash, signature: png() }));
  };
  await consent();
  await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: baseItem }] }));
  const { invoiceId: baseInv } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), baseInv, [{ itemId: base.itemId, quantity: 1 }]));
  await as(FO, (db) => receivePayment(db, key(), baseInv, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
  const { requestId } = await as(NUR, (db) => createRequest(db, key(), v, { kind: "addition", planId, catalogVersionId: taxable.versionId, stage: 1, qty, reason: "Area tambahan" }));
  const item = ((await as(DOC, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
  await consent();
  if (release) await as(FO, (db) => releaseAddition(db, key(), item, FO.staffId));
  return { pid, v, item };
}
const perform = async (v: string, item: string, outcome: "completed" | "medical_stop" = "completed") => {
  const e = await as(DOC, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: DOC.staffId, identityConfirmed: true }));
  await as(DOC, (db) => finishTreatment(db, key(), e.executionId, outcome === "completed" ? { outcome } : { outcome, reason: "Alasan berhenti uji" }));
  return e.executionId as string;
};
const bill = async (pid: string, v: string, item: string, qty = 1, discount?: number) => {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: taxable.itemId, quantity: qty, planItemId: item, ...(discount ? { discount } : {}) }]));
  return invoiceId as string;
};
const lineOf = async (inv: string) => (await h.admin.query(
  `select id, vat_amount::int vat, vat_recognised_amount::int rec, vat_recognised_at, line_total::int total from invoice_lines where invoice_id = $1`, [inv])).rows[0];
const events = async (line: string) => (await h.admin.query(
  `select cause, delta::int delta, effective_at, source_id from vat_events where object_id = $1 order by created_at, id`, [line])).rows;
const portions = async (line: string) => (await h.admin.query(`select vat_portion::int p from payment_allocations where invoice_line_id = $1 order by created_at`, [line])).rows.map((r) => r.p);
const finishedAt = async (e: string) => (await h.admin.query(`select finished_at from treatment_executions where id = $1`, [e])).rows[0].finished_at as Date;
const objSum = async (ledger: string, objectId: string) =>
  Number((await h.admin.query(`select coalesce(sum(amount), 0) s from subledger_movements($1) where ledger = $2 and object_id = $3`, [A.tenantId, ledger, objectId])).rows[0].s);
const pay = (inv: string, amount: number) => as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount, cashTendered: amount }]));

describe("HYG-023: a released addition delivered on an issued line (treatment_finish)", () => {
  it("billed, finished unpaid → the line's VAT 66,000 at finished_at (line_delivery); the payment adds 0; VAT ledger and paid-not-delivered exact", async () => {
    const s = await visitWithAddition();
    const inv = await bill(s.pid, s.v, s.item);
    expect((await lineOf(inv)).rec).toBe(0);
    const e = await perform(s.v, s.item);
    const l = await lineOf(inv);
    expect([l.vat, l.rec]).toEqual([66_000, 66_000]);
    expect(l.vat_recognised_at).toEqual(await finishedAt(e));
    expect(await events(l.id)).toEqual([{ cause: "line_delivery", delta: 66_000, effective_at: await finishedAt(e), source_id: e }]);
    await pay(inv, 666_000);
    expect(await portions(l.id)).toEqual([0]);
    expect((await lineOf(inv)).rec).toBe(66_000);
    expect(await objSum("vat", l.id)).toBe(66_000);
    expect(await objSum("paid_not_delivered", l.id)).toBe(0); // +666,000 paid − 600,000 performed − 66,000 VAT
  });

  it("partly paid, then delivered: the payment recognised 33,000, the delivery only the remaining 33,000; a later payment adds 0", async () => {
    const s = await visitWithAddition();
    const inv = await bill(s.pid, s.v, s.item);
    await pay(inv, 333_000);
    const l0 = await lineOf(inv);
    expect(l0.rec).toBe(33_000);
    const paidAt = l0.vat_recognised_at as Date;
    const e = await perform(s.v, s.item);
    expect((await events(l0.id)).map((x) => [x.cause, x.delta, x.source_id])).toEqual([["line_delivery", 33_000, e]]);
    const l1 = await lineOf(inv);
    expect([l1.rec, l1.vat_recognised_at]).toEqual([66_000, paidAt]); // the tax point stays the earlier payment
    await pay(inv, 333_000);
    expect(await portions(l0.id)).toEqual([33_000, 0]);
    expect(await objSum("vat", l0.id)).toBe(66_000);
  });

  it("delivered then converted to a receivable: the conversion records 0 (S2 unchanged); a stop (not counted) recognises nothing", async () => {
    const s = await visitWithAddition();
    const inv = await bill(s.pid, s.v, s.item);
    await perform(s.v, s.item);
    const l = await lineOf(inv);
    await as(FO, (db) => convertToReceivable(db, key(), s.v));
    expect((await events(l.id)).map((x) => x.cause)).toEqual(["line_delivery"]);
    expect(await objSum("vat", l.id)).toBe(66_000);
    // medical stop: not counted → no delivery
    const s2 = await visitWithAddition();
    const inv2 = await bill(s2.pid, s2.v, s2.item);
    await perform(s2.v, s2.item, "medical_stop");
    expect([(await lineOf(inv2)).rec, await events((await lineOf(inv2)).id)]).toEqual([0, []]);
  });

  it("qty 3 performed by one execution: the plan item's 3 units are delivered → the whole line (round half up as the payment writer)", async () => {
    const s = await visitWithAddition(3);
    const inv = await bill(s.pid, s.v, s.item, 3);
    const l0 = await lineOf(inv);
    expect(l0.vat).toBe(198_000);
    await perform(s.v, s.item);
    expect((await lineOf(inv)).rec).toBe(198_000);
  });
});

describe("HYG-023: an addition performed before its line exists (invoice_issue, Panel 2 Q3)", () => {
  it("finished after the cutover, billed later → recognised at issue, tax point and event at finished_at", async () => {
    const s = await visitWithAddition();
    const e = await perform(s.v, s.item);
    const inv = await bill(s.pid, s.v, s.item);
    const l = await lineOf(inv);
    const fin = await finishedAt(e);
    expect([l.rec, l.vat_recognised_at]).toEqual([66_000, fin]);
    expect(await events(l.id)).toEqual([{ cause: "line_delivery", delta: 66_000, effective_at: fin, source_id: e }]);
    await pay(inv, 666_000);
    expect(await portions(l.id)).toEqual([0]);
  });

  it("finished before the cutover, billed after it → the line keeps finished_at; the event is effective at the cutover (never dropped by the reader)", async () => {
    // tenant A was created after 0121 (no cutover row): one is set for this case only, a day after the delivery, before the billing
    const s = await visitWithAddition();
    const e = await perform(s.v, s.item);
    await shift("treatment_executions", "finished_at = finished_at - interval '3 days', started_at = started_at - interval '3 days'", "id = $1", [e]);
    const fin = await finishedAt(e);
    const cut = new Date(fin.getTime() + 86_400_000); // the cutover a day after the delivery, before the billing
    const had = (await h.admin.query(`select cutover_at from vat_cutovers where tenant_id = $1`, [A.tenantId])).rows[0]?.cutover_at as Date | undefined;
    await shift("vat_cutovers", "cutover_at = $2", "tenant_id = $1", [A.tenantId, cut]);
    if (!had) await h.admin.query(`insert into vat_cutovers (tenant_id, cutover_at) values ($1, $2)`, [A.tenantId, cut]);
    try {
      const inv = await bill(s.pid, s.v, s.item);
      const l = await lineOf(inv);
      expect([l.rec, l.vat_recognised_at]).toEqual([66_000, fin]);
      expect(await events(l.id)).toEqual([{ cause: "line_delivery", delta: 66_000, effective_at: cut, source_id: e }]);
      expect(await objSum("vat", l.id)).toBe(66_000); // the reader keeps it (effective_at >= cutover)
    } finally {
      if (had) await shift("vat_cutovers", "cutover_at = $2", "tenant_id = $1", [A.tenantId, had]);
      else { await h.admin.query(`alter table vat_cutovers disable trigger vat_cutovers_append_only`); await h.admin.query(`delete from vat_cutovers where tenant_id = $1`, [A.tenantId]); await h.admin.query(`alter table vat_cutovers enable always trigger vat_cutovers_append_only`); }
    }
  });

  it("S8: a pending manual discount defers recognition; on approval the performed addition recognises its final VAT at finished_at; on rejection the full VAT", async () => {
    const s = await visitWithAddition();
    const e = await perform(s.v, s.item);
    const inv = await bill(s.pid, s.v, s.item, 1, 111_000);
    const l = await lineOf(inv);
    expect([l.rec, await events(l.id)]).toEqual([0, []]);
    const ap = (await h.admin.query(`select discount_approval_id a from invoice_lines where id = $1`, [l.id])).rows[0].a as string;
    expect(ap).toBeTruthy();
    await as(OWN, (db) => decideApproval(db, ap, true)); // not refused as line_changed
    const l2 = await lineOf(inv);
    expect([l2.total, l2.vat, l2.rec, l2.vat_recognised_at]).toEqual([555_000, 55_000, 55_000, await finishedAt(e)]);
    expect((await events(l.id)).map((x) => [x.cause, x.delta, x.source_id])).toEqual([["line_delivery", 55_000, e]]);
    await pay(inv, 555_000);
    expect(await portions(l.id)).toEqual([0]);
    // rejected: the full price stays, its VAT recognised at the decision (tax point finished_at)
    const s2 = await visitWithAddition();
    const e2 = await perform(s2.v, s2.item);
    const inv2 = await bill(s2.pid, s2.v, s2.item, 1, 111_000);
    const ap2 = (await h.admin.query(`select discount_approval_id a from invoice_lines where invoice_id = $1`, [inv2])).rows[0].a as string;
    await as(OWN, (db) => decideApproval(db, ap2, false, "Diskon tidak disetujui"));
    const l3 = await lineOf(inv2);
    expect([l3.total, l3.vat, l3.rec, l3.vat_recognised_at]).toEqual([666_000, 66_000, 66_000, await finishedAt(e2)]);
    // decided before the delivery: nothing at the decision; the finish recognises
    const s3 = await visitWithAddition();
    const inv3 = await bill(s3.pid, s3.v, s3.item, 1, 111_000);
    const ap3 = (await h.admin.query(`select discount_approval_id a from invoice_lines where invoice_id = $1`, [inv3])).rows[0].a as string;
    await as(OWN, (db) => decideApproval(db, ap3, true));
    expect((await lineOf(inv3)).rec).toBe(0);
    await perform(s3.v, s3.item);
    expect((await lineOf(inv3)).rec).toBe(55_000);
  });
});

describe("HYG-023: vat_line_deliver's share rule (Panel 2 Q1) and an uncounted addition billed", () => {
  // Today's call sites always deliver a whole line (an addition's line quantity equals its plan item's; a consultation is 1); the share
  // rule is the approved contract for partial deliveries, so it is proven on the helper directly (as the migration owner).
  it("partial shares: 1/3 then 2/3 of 198,000 → 66,000 + 66,000; a repeated 1/3 adds 0 (monotone); 1/396,000 rounds half up to 1", async () => {
    const s = await visitWithAddition(3);
    const inv = await bill(s.pid, s.v, s.item, 3);
    const l = await lineOf(inv);
    const d = async (num: number, den: number) => Number((await h.admin.query(`select vat_line_deliver($1, $2, $3, $4, now(), null) d`, [A.tenantId, l.id, num, den])).rows[0].d);
    expect([await d(1, 3), await d(2, 3), await d(1, 3)]).toEqual([66_000, 66_000, 0]);
    expect((await lineOf(inv)).rec).toBe(132_000);
    expect((await events(l.id)).map((x) => x.delta)).toEqual([66_000, 66_000]);
    const s2 = await visitWithAddition(3);
    const l2 = await lineOf(await bill(s2.pid, s2.v, s2.item, 3));
    expect(Number((await h.admin.query(`select vat_line_deliver($1, $2, 1, 396000, now(), null) d`, [A.tenantId, l2.id])).rows[0].d)).toBe(1);
  });

  it("an addition medically stopped (not counted) and then billed recognises nothing at the issue", async () => {
    const s = await visitWithAddition();
    await perform(s.v, s.item, "medical_stop");
    const inv = await bill(s.pid, s.v, s.item);
    const l = await lineOf(inv);
    expect([l.rec, await events(l.id)]).toEqual([0, []]);
  });
});

describe("HYG-023 S7 (Panel 2): a void after delivery recognition reverses it; the re-billed line counts the VAT once", () => {
  it("delivered on an unpaid line, voided, billed again, paid: line_delivery +66,000, line_void −66,000, again +66,000 at issue; VAT 66,000 once; paid-not-delivered 0", async () => {
    const s = await visitWithAddition();
    const inv = await bill(s.pid, s.v, s.item);
    const e = await perform(s.v, s.item);
    const l = await lineOf(inv);
    expect(l.rec).toBe(66_000);
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), inv, "Salah tagih tambahan"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    const voidedAt = (await h.admin.query(`select voided_at from invoices where id = $1`, [inv])).rows[0].voided_at as Date;
    const lv = (await h.admin.query(`select vat_recognised_amount::int rec, vat_reversed_amount::int rev, vat_reversed_at from invoice_lines where id = $1`, [l.id])).rows[0];
    expect([lv.rec, lv.rev, lv.vat_reversed_at]).toEqual([66_000, 66_000, voidedAt]);
    expect((await events(l.id)).map((x) => [x.cause, x.delta, x.source_id])).toEqual([["line_delivery", 66_000, e], ["line_void", -66_000, approvalId]]);
    expect((await events(l.id))[1].effective_at).toEqual(voidedAt);
    expect(await objSum("vat", l.id)).toBe(0);
    expect(await objSum("paid_not_delivered", l.id)).toBe(0); // the voided line: no money, no liability, no stranded VAT
    // billed again (the void freed it): recognised at the issue (tax point finished_at), then paid: 0 more
    const inv2 = await bill(s.pid, s.v, s.item);
    const l2 = await lineOf(inv2);
    expect([l2.rec, (await events(l2.id)).map((x) => x.cause)]).toEqual([66_000, ["line_delivery"]]);
    await pay(inv2, 666_000);
    expect(await portions(l2.id)).toEqual([0]);
    expect((await objSum("vat", l.id)) + (await objSum("vat", l2.id))).toBe(66_000);
    expect(await objSum("paid_not_delivered", l2.id)).toBe(0);
    // T-104 roll-forward exact: this month's VAT terms carry the delivery twice and the void once; the closing moved by 66,000 net
    const term = (r: Awaited<ReturnType<typeof rollforward>>, k: string) => r.ledgers.vat.terms[k] ?? 0;
    const r = await as(FIN, (db) => rollforward(db, { from: `${today().slice(0, 8)}01`, to: today() }));
    expect(term(r, "line_void")).toBeLessThanOrEqual(-66_000);
    expect(Number((await h.admin.query(`select coalesce(sum(amount), 0) s from subledger_movements($1) where ledger = 'vat' and object_id = any($2)`, [A.tenantId, [l.id, l2.id]])).rows[0].s)).toBe(66_000);
    expect(r.ledgers.vat.closing).toBe(Number((await h.admin.query(`select coalesce(sum(amount), 0) s from subledger_movements($1) where ledger = 'vat' and day <= $2::date`, [A.tenantId, today()])).rows[0].s));
  });

  it("a void of an invoice with nothing recognised writes no line_void event; a rejected void reverses nothing", async () => {
    const s = await visitWithAddition(1, true);
    const inv = await bill(s.pid, s.v, s.item); // not performed: nothing recognised
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), inv, "Salah tagih tambahan"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    expect(await events((await lineOf(inv)).id)).toEqual([]);
    const s2 = await visitWithAddition();
    const inv2 = await bill(s2.pid, s2.v, s2.item);
    await perform(s2.v, s2.item);
    const { approvalId: a2 } = await as(FO, (db) => requestVoid(db, key(), inv2, "Salah tagih tambahan"));
    await as(MGR, (db) => decideApproval(db, a2, false, "Tagihan sudah benar"));
    const l = await lineOf(inv2);
    expect([l.rec, (await events(l.id)).map((x) => x.cause)]).toEqual([66_000, ["line_delivery"]]);
  });
});

describe("HYG-023: a consultation fee charged (consultation_invoice_issue, Panel 2 Q2)", () => {
  it("charged unpaid → the whole VAT 22,000 at the charge; paid → 0 more; the visit fee line's VAT ledger exact", async () => {
    const pid = await patient(A);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    const ch = await as(FO, (db) => chargeConsultationFee(db, key(), v, consult));
    const l = await lineOf(ch.invoice_id);
    expect([l.total, l.vat, l.rec]).toEqual([222_000, 22_000, 22_000]);
    const at = (await h.admin.query(`select issued_at from invoices where id = $1`, [ch.invoice_id])).rows[0].issued_at as Date;
    expect(await events(l.id)).toEqual([{ cause: "line_delivery", delta: 22_000, effective_at: at, source_id: v }]);
    await pay(ch.invoice_id, 222_000);
    expect(await portions(l.id)).toEqual([0]);
    expect(await objSum("vat", l.id)).toBe(22_000);
  });
});

describe("HYG-023: no-ops and the stated limit", () => {
  it("Q4 stated limit: a visit product handed before any invoice (no stored line key) is recognised at payment, never by line_delivery", async () => {
    const pid = await patient(A);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ catalogVersionId: serum.versionId, quantity: "1" }] }));
    const d = (await h.admin.query(`select id, invoice_line_id from dispensings where visit_id = $1`, [v])).rows[0];
    expect(d.invoice_line_id).toBeNull();
    await as(PH, (db) => prepareDispensing(db, key(), d.id));
    const all = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<Check, boolean>;
    await as(PH, (db) => handOver(db, key(), d.id, { checks: all })); // the visit has no invoice yet: payment not_started
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum.itemId, quantity: 1 }]));
    const l = await lineOf(invoiceId);
    expect([l.vat, l.rec, await events(l.id)]).toEqual([33_000, 0, []]);
    await pay(invoiceId, 333_000);
    expect(await portions(l.id)).toEqual([33_000]);
  });

  it("the roll-forward shows the delivery as its own VAT term (line_delivery); exempt lines carry no event", async () => {
    const r0 = await as(FIN, (db) => rollforward(db, { from: `${today().slice(0, 8)}01`, to: today() }));
    const s = await visitWithAddition();
    const inv = await bill(s.pid, s.v, s.item);
    await perform(s.v, s.item);
    const r1 = await as(FIN, (db) => rollforward(db, { from: `${today().slice(0, 8)}01`, to: today() }));
    expect(r1.ledgers.vat.closing - r0.ledgers.vat.closing).toBe(66_000);
    expect((r1.ledgers.vat.terms.line_delivery ?? 0) - (r0.ledgers.vat.terms.line_delivery ?? 0)).toBe(66_000);
    void inv;
    // the base (exempt) lines carry no VAT and no event
    expect((await h.admin.query(`select count(*)::int c from vat_events e join invoice_lines l on l.id = e.object_id where l.tax_category = 'exempt_medical'`)).rows[0].c).toBe(0);
  });

  it("the helper is not granted to the app; cross-tenant: tenant B's cashier cannot see tenant A's events", async () => {
    expect(await why(as(FO, (db) => db.query(`select vat_line_deliver($1, gen_random_uuid(), 1, 1, now(), null)`, [A.tenantId])))).toMatch(/permission denied/);
    const c = await as(BFO, (db) => db.query(`select count(*)::int c from vat_events`).then((r) => r.rows[0].c, () => -1));
    expect([0, -1]).toContain(c);
  });
});
