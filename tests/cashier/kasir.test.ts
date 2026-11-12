// T-072 Done-when: scenario PR-19 (proportional allocation after discount), money scenario 1 (products paid in cash,
// handed over; the PKP variant recognises VAT at payment, never again at hand-over) and scenario PR-42 (the branch
// price on a Kasir invoice), plus the plan reviews: split tender, largest remainder, SET-14 methods, the payment port
// and balance not yet available, receipts per branch per month, the visit payment step, the counter sale through the
// pharmacist, the void through approval (requester ≠ approver, SET-43), roles, branches, tenants, the auditor's
// masked projection and the append-only guards. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { inboxDetail, listInbox } from "../../src/modules/approvals/inbox";
import { publish } from "../../src/modules/catalog/catalog";
import { setBranchPrice } from "../../src/modules/catalog/prices/prices";
import {
  getReceipt, issueKasirInvoice, kasirCounterItems, kasirInvoice, kasirQueue, kasirVisitLines, KasirError, openKasirInvoice, receivePayment, requestVoid,
} from "../../src/modules/cashier/kasir/kasir";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { createDepot, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { receiveStock, saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { addSpecialItem, confirmSelection, handOver, handoverList, prepareDispensing, prepList } from "../../src/modules/pharmacy/pharmacy";
import { changeSetting } from "../../src/modules/settings/settings";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Kasir Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $2, $3, 'Jl. Uji 1') returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("KS1", "Asia/Jakarta"), b2: await br("KS2", "Asia/Makassar") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ksr${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Kasir ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof KasirError ? `${e.code}:${e.reason}` : e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const NPWP = "012345678901234";
const CHECKS = { identity: true, validity: true, dose: true, allergy: true, clarification: true, label: true, counselling: true };
async function patient(t: T, branch: string, name = "Pasien Kasir"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
async function visit(t: T, branch: string, by: P, pid?: string): Promise<{ visitId: string; patientId: string }> {
  const patientId = pid ?? (await patient(t, branch));
  const visitId = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, patientId, by.staffId])).rows[0].id as string;
  return { visitId, patientId };
}
const allocs = async (invoiceId: string) =>
  (await h.admin.query(`select l.line_total::bigint t, coalesce(sum(a.amount), 0)::bigint paid, coalesce(sum(a.vat_portion), 0)::bigint vat, l.vat_amount::bigint lv,
                               l.vat_recognised_amount::bigint rec
                          from invoice_lines l left join payment_allocations a on a.invoice_line_id = l.id
                         where l.invoice_id = $1 group by l.id order by l.created_at, l.id`, [invoiceId])).rows
    .map((r) => ({ t: Number(r.t), paid: Number(r.paid), vat: Number(r.vat), lv: Number(r.lv), rec: Number(r.rec) }));
const step = async (visitId: string) => (await h.admin.query(`select payment from visits where id = $1`, [visitId])).rows[0].payment as string;

let A: T; let B: T;
let OWN: P; let FIN: P; let MGR: P; let MGR2: P; let FO: P; let FO2: P; let FOB2: P; let AP: P; let AU: P; let PH: P; let BC: P; let DOC: P; let BOWN: P; let BFO: P;
let serum: string; let sunscreen: string; let facial: string; let toner: string; let consult: string; let narcotic: string; let noStock: string;
let serumV: string;

async function product(t: { own: P; ph: P }, c: string, name: string, price: number, tax = "taxable_goods", stock = true) {
  const v = await as(t.own, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: tax, tax_basis: "Barang", normal_price: price } as never, "Produk"));
  if (stock) await as(t.ph, (db) => saveItem(db, key(), null, { catalogItemId: v.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  return { item: v.itemId, version: v.versionId };
}
async function approveTaxAdvice(t: T) {
  const fin = await person(t, "finance");
  const own = await person(t, "owner");
  const pdf = Buffer.from(`%PDF-1.7\nsaran pajak ${++n}\n%%EOF\n`);
  const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
  const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
  await as(own, (db) => decideEvidence(db, item, fileId, "approved"));
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AP = await person(A, "admin_pusat"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b1);
  FOB2 = await person(A, "fo_cashier", A.b2); PH = await person(A, "pharmacist", A.b1); BC = await person(A, "bc", A.b1); DOC = await person(A, "doctor", A.b1);
  BOWN = await person(B, "owner"); BFO = await person(B, "fo_cashier", B.b1);
  const ctx = { own: OWN, ph: PH };
  ({ item: serum, version: serumV } = await product(ctx, "KS-SRM", "Serum Kasir", 333_000));
  ({ item: sunscreen } = await product(ctx, "KS-SUN", "Tabir Surya Kasir", 222_000));
  ({ item: facial } = await product(ctx, "KS-FAC", "Krim Kasir", 600_000));
  ({ item: toner } = await product(ctx, "KS-TON", "Toner Kasir", 400_000));
  ({ item: consult } = await product(ctx, "KS-OBR", "Obat Resep Kasir", 150_000, "exempt_medical"));
  ({ item: narcotic } = await product(ctx, "KS-NAR", "Petidin Kasir", 100_000, "exempt_medical"));
  ({ item: noStock } = await product(ctx, "KS-NOS", "Produk Tanpa Stok", 50_000, "taxable_goods", false));
  await as(PH, (db) => addSpecialItem(db, key(), narcotic, "Narkotika: tidak dijual"));
  // Stock for the counter sale in the apotek depot.
  const serumItem = (await h.admin.query(`select id from stock_items where catalog_item_id = $1`, [serum])).rows[0].id;
  const g1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
  const apt = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Kasir", kind: "apotek" }))).depotId;
  const batch = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: serumItem, batchNo: "KS-B1", expiry: day(200), quantity: "50", reason: "stok_awal" }))).batchId;
  await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: g1, toDepotId: apt, lines: [{ batchId: batch, quantity: "50" }] }));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-19: proportional allocation after discount", () => {
  it("lines 600,000 and 400,000 after discount; 500,000 paid → 300,000 and 200,000; the rest completes them", async () => {
    const { visitId, patientId } = await visit(A, A.b1, FO);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId, visitId }));
    // facial 600,000 at full price; toner 2 × 400,000 less 400,000 discount = 400,000 after discount.
    const r = await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }, { itemId: toner, quantity: 2, discount: 400_000 }]));
    expect(r.total).toBe(1_000_000);
    expect(r.number).toMatch(/^INV-KS1-\d{6}-0001$/);
    expect(await step(visitId)).toBe("in_progress"); // treatment start and dispensing block on it (DEC-074, 0082)
    const p1 = await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
    expect([p1.paid, p1.change, p1.outstanding]).toEqual([500_000, 0, 500_000]);
    expect((await allocs(invoiceId)).map((x) => x.paid)).toEqual([300_000, 200_000]);
    expect(await step(visitId)).toBe("in_progress");
    const p2 = await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 500_000, details: { card_type: "debit", bank: "BCA", trace: "123456", approval_code: "A1B2C3" } }]));
    expect(p2.outstanding).toBe(0);
    expect((await allocs(invoiceId)).map((x) => x.paid)).toEqual([600_000, 400_000]);
    expect(await step(visitId)).toBe("done");
    // Receipts numbered per branch per month, in order.
    expect([p1.number, p2.number]).toEqual([expect.stringMatching(/-0001$/), expect.stringMatching(/-0002$/)]);
    expect(p1.number).toMatch(/^KW-KS1-\d{6}-0001$/);
    // Fully paid: nothing more is accepted.
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1, cashTendered: 1 }])))).toBe("ERR_INVALID_INPUT:overpayment");
  });

  it("split tender in one Terima, cash change, largest remainder, never above a line, overpayment refused", async () => {
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }, { itemId: sunscreen, quantity: 1 }, { itemId: consult, quantity: 1 }]));
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 705_001, cashTendered: 800_000 }])))).toBe("ERR_INVALID_INPUT:overpayment");
    // 1 rupiah over three lines: one line gets it (the largest remainder, the first on a tie of shares).
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "transfer", amount: 1, details: { bank: "BRI", reference: "TRF-1" } }]));
    expect((await allocs(invoiceId)).map((x) => x.paid)).toEqual([1, 0, 0]); // the largest remainder: 333,000 of 705,000
    const r = await as(FO, (db) => receivePayment(db, key(), invoiceId, [
      { method: "cash", amount: 300_000, cashTendered: 350_000 }, { method: "edc", amount: 404_999 }]));
    expect([r.paid, r.change, r.outstanding]).toEqual([704_999, 50_000, 0]);
    const a = await allocs(invoiceId);
    expect(a.map((x) => x.paid)).toEqual([333_000, 222_000, 150_000]);
    // Two payments on one receipt, in order; one receipt per Terima.
    const pay = (await h.admin.query(`select seq, method, amount::bigint a, cash_tendered::bigint c, change_given::bigint g from payments where receipt_id = $1 order by seq`, [r.receipt_id])).rows;
    expect(pay.map((x) => [x.seq, x.method, Number(x.a), x.c === null ? null : Number(x.c), x.g === null ? null : Number(x.g)]))
      .toEqual([[1, "cash", 300_000, 350_000, 50_000], [2, "edc", 404_999, null, null]]);
    // The allocations of each payment never exceed it, of each line never exceed its total.
    const per = (await h.admin.query(`select p.amount::bigint p, sum(a.amount)::bigint s from payments p join payment_allocations a on a.payment_id = p.id where p.invoice_id = $1 group by p.id`, [invoiceId])).rows;
    expect(per.every((x) => Number(x.p) === Number(x.s))).toBe(true);
  });

  it("QRIS, link and balance are not available yet; a method off in SET-14 is refused; input checks", async () => {
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sunscreen, quantity: 1 }]));
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "qris", amount: 1_000 }])))).toBe("ERR_NOT_AVAILABLE:payment_port");
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "payment_link", amount: 1_000 }])))).toBe("ERR_NOT_AVAILABLE:payment_port");
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "balance", amount: 1_000 }])))).toBe("ERR_NOT_AVAILABLE:balance");
    const inv = await as(FO, (db) => kasirInvoice(db, invoiceId));
    expect(inv.tenders.map((t) => [t.method, t.available, t.blocked])).toEqual([
      ["cash", true, null], ["qris", false, "payment_port"], ["edc", true, null], ["transfer", true, null], ["payment_link", false, "payment_port"], ["balance", false, "balance"]]);
    // SET-14 without EDC, then restored (the owner's settings writer, T-017).
    await as(OWN, (db) => changeSetting(db, { key: "SET-14", branchId: null, value: { metode: ["tunai", "transfer"], provider: "mock", link_jam: 24 }, reason: "Uji tanpa EDC" }));
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 1_000 }])))).toBe("ERR_NOT_AVAILABLE:method_disabled");
    expect((await as(FO, (db) => kasirInvoice(db, invoiceId))).tenders.find((t) => t.method === "edc")).toEqual({ method: "edc", available: false, blocked: "method_disabled" });
    await as(OWN, (db) => changeSetting(db, { key: "SET-14", branchId: null, restore: true, reason: "Kembali ke default" }));
    for (const bad of [
      [], [{ method: "cash", amount: 1_000 }], [{ method: "cash", amount: 1_000, cashTendered: 999 }], [{ method: "cash", amount: 0, cashTendered: 1 }],
      [{ method: "cash", amount: 1, cashTendered: 1 }, { method: "cash", amount: 1, cashTendered: 1 }], [{ method: "edc", amount: 1.5 }],
      [{ method: "cash", amount: 1, cashTendered: 1, details: { bank: "X" } }], [{ method: "edc", amount: 1, details: { pin: "1234" } }],
    ] as never[][])
      expect(await code(as(FO, (db) => receivePayment(db, key(), invoiceId, bad))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    // A draft cannot be paid.
    const { invoiceId: draft } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    expect(await why(as(FO, (db) => receivePayment(db, key(), draft, [{ method: "cash", amount: 1, cashTendered: 1 }])))).toBe("ERR_VERSION_CONFLICT:invoice draft");
    // A replay of a Terima returns the same receipt; the same key with another body is refused.
    const k = key();
    const r1 = await as(FO, (db) => receivePayment(db, k, invoiceId, [{ method: "cash", amount: 1_000, cashTendered: 1_000 }]));
    const r2 = await as(FO, (db) => receivePayment(db, k, invoiceId, [{ method: "cash", amount: 1_000, cashTendered: 1_000 }]));
    expect([r2.receipt_id, r2.replayed]).toEqual([r1.receipt_id, true]);
    expect(await code(as(FO, (db) => receivePayment(db, k, invoiceId, [{ method: "cash", amount: 2_000, cashTendered: 2_000 }])))).toBe("ERR_IDEMPOTENCY_CONFLICT");
  });
});

describe("kasir_allocate (the SQL allocation)", () => {
  it("matches the pure mirror: ties by line order, overpayment refused", async () => {
    const id = () => crypto.randomUUID();
    const [a, b, c] = [id(), id(), id()];
    const run = async (p: number, o: number[]) => (await h.admin.query(`select line_id, amount::bigint a from kasir_allocate($1, $2::uuid[], $3::bigint[])`,
      [p, [a, b, c].slice(0, o.length), o])).rows.map((r) => [r.line_id, Number(r.a)]);
    expect(await run(5, [3, 3, 4])).toEqual([[a, 2], [b, 1], [c, 2]]);
    expect(await run(2, [1, 1, 1])).toEqual([[a, 1], [b, 1]]);
    expect(await raw(`select * from kasir_allocate(11, $1::uuid[], '{3,3,4}'::bigint[])`, [[a, b, c]])).toBe("raw:22023");
  });
});

describe("money scenario 1 and scenario PR-42", () => {
  it("non-PKP: serum 333,000 + sunscreen 222,000 in cash 555,000; allocations equal the lines; no VAT; hand-over then allowed", async () => {
    const { visitId, patientId } = await visit(A, A.b1, FO);
    await as(BC, (db) => confirmSelection(db, key(), visitId, { items: [{ catalogVersionId: serumV, quantity: "1" }] }));
    const vl = await as(FO, (db) => kasirVisitLines(db, visitId));
    expect(vl.lines.map((l) => [l.item_id, l.quantity, l.price])).toEqual([[serum, 1, 333_000]]);
    const q = await as(FO, (db) => kasirQueue(db));
    expect(q.ready.map((x) => x.visit_id)).toContain(visitId);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId, visitId }));
    const r = await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }, { itemId: sunscreen, quantity: 1 }]));
    expect([r.total, r.is_pkp_at_issue]).toEqual([555_000, false]);
    // The selection's dispensing is blocked until paid.
    const d = (await h.admin.query(`select id from dispensings where visit_id = $1`, [visitId])).rows[0].id;
    expect((await as(PH, prepList)).products.find((x) => x.id === d)?.blocker).toBe("payment_unpaid");
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 555_000, cashTendered: 600_000 }]));
    expect(await allocs(invoiceId)).toEqual([{ t: 333_000, paid: 333_000, vat: 0, lv: 0, rec: 0 }, { t: 222_000, paid: 222_000, vat: 0, lv: 0, rec: 0 }]);
    expect(await step(visitId)).toBe("done");
    expect((await as(PH, prepList)).products.find((x) => x.id === d)?.blocker ?? null).toBeNull();
    // Events carry ids only: one PaymentReceived, one PaymentAllocated per line, InvoiceIssued once.
    const ev = (await h.admin.query(`select type, count(*)::int c from domain_events where aggregate_id in (
                 select id from payments where invoice_id = $1 union select id from payment_allocations where payment_id in (select id from payments where invoice_id = $1) union select $1::uuid)
               group by type order by type`, [invoiceId])).rows;
    expect(ev).toEqual([{ type: "InvoiceIssued", c: 1 }, { type: "PaymentAllocated", c: 2 }, { type: "PaymentReceived", c: 1 }]);
  });

  it("PKP variant: VAT 33,000 + 22,000 recognised at payment (half paid → half the VAT), never twice", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    const cph = await person(C, "pharmacist", C.b1);
    const cfo = await person(C, "fo_cashier", C.b1);
    const s = (await product({ own: cown, ph: cph }, "P1-SRM", "Serum PKP", 333_000)).item;
    const u = (await product({ own: cown, ph: cph }, "P1-SUN", "Tabir Surya PKP", 222_000)).item;
    await approveTaxAdvice(C);
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: day(1), npwp: NPWP, reason: "PKP" }));
    // In force from yesterday (the writer refuses a past date; the documented owner-connection stand-in).
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 1 where id = $1`, [C.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { counter: true }));
    const r = await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: s, quantity: 1 }, { itemId: u, quantity: 1 }]));
    expect(r.is_pkp_at_issue).toBe(true);
    await as(cfo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 277_500, cashTendered: 277_500 }]));
    expect(await allocs(invoiceId)).toEqual([{ t: 333_000, paid: 166_500, vat: 16_500, lv: 33_000, rec: 16_500 }, { t: 222_000, paid: 111_000, vat: 11_000, lv: 22_000, rec: 11_000 }]);
    await as(cfo, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 277_500 }]));
    expect(await allocs(invoiceId)).toEqual([{ t: 333_000, paid: 333_000, vat: 33_000, lv: 33_000, rec: 33_000 }, { t: 222_000, paid: 222_000, vat: 22_000, lv: 22_000, rec: 22_000 }]);
  });

  it("scenario PR-42: the branch override on a Kasir invoice, kept after a later price change", async () => {
    const { item } = await product({ own: OWN, ph: PH }, "KS-FC2", "Krim Cabang", 500_000);
    await as(OWN, (db) => setBranchPrice(db, { itemId: item, branchId: A.b2, price: 450_000, effectiveFrom: null, reason: "Harga cabang B" }));
    const { invoiceId } = await as(FOB2, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FOB2, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
    await as(OWN, (db) => setBranchPrice(db, { itemId: item, branchId: A.b2, price: 470_000, effectiveFrom: null, reason: "Naik" }));
    const inv = await as(FOB2, (db) => kasirInvoice(db, invoiceId));
    expect(inv.lines.map((l) => [l.unit_price, l.line_total])).toEqual([[450_000, 450_000]]);
    expect(inv.number).toMatch(/^INV-KS2-\d{6}-0001$/); // numbered per branch: branch 1 already has many
    const r = await as(FOB2, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 450_000, cashTendered: 450_000 }]));
    expect(r.number).toMatch(/^KW-KS2-\d{6}-0001$/);
  });
});

describe("counter sale (Jual Cepat) through the pharmacist", () => {
  it("anonymous sale: products only, special and stockless items refused; queued until paid, then handed over", async () => {
    expect((await as(FO, (db) => kasirCounterItems(db, null, "kasir"))).map((x) => x.item_id)).not.toContain(narcotic);
    const open = async () => (await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }))).invoiceId;
    const o1 = await open();
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), o1, [{ itemId: narcotic, quantity: 1 }])))).toBe("ERR_INVALID_INPUT:special_item");
    const o2 = await open();
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), o2, [{ itemId: noStock, quantity: 1 }])))).toBe("ERR_INVALID_INPUT:product_without_stock_item");
    expect((await h.admin.query(`select state from invoices where id = any($1)`, [[o1, o2]])).rows.map((x) => x.state)).toEqual(["draft", "draft"]); // all or nothing
    expect(await why(as(FO, (db) => openKasirInvoice(db, key(), { counter: true, visitId: crypto.randomUUID(), patientId: crypto.randomUUID() })))).toBe("ERR_INVALID_INPUT:counter_without_visit");
    const invoiceId = await open();
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 2 }]));
    const d = (await h.admin.query(`select d.id, d.visit_id, d.patient_id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [invoiceId])).rows;
    expect(d).toHaveLength(1);
    expect([d[0].visit_id, d[0].patient_id]).toEqual([null, null]);
    const row = (await as(PH, prepList)).products.find((x) => x.id === d[0].id)!;
    expect([row.source, row.patient.name, row.patient.mrn, row.blocker]).toEqual(["counter", "Penjualan langsung", null, "payment_unpaid"]);
    await as(PH, (db) => prepareDispensing(db, key(), d[0].id)).catch(() => undefined); // blocked: payment
    expect((await h.admin.query(`select state from dispensings where id = $1`, [d[0].id])).rows[0].state).toBe("queued");
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 666_000, cashTendered: 700_000 }]));
    await as(PH, (db) => prepareDispensing(db, key(), d[0].id));
    expect((await as(PH, handoverList)).prepared.map((x) => x.id)).toContain(d[0].id);
    await as(PH, (db) => handOver(db, key(), d[0].id, { checks: CHECKS }));
    expect((await h.admin.query(`select state from dispensings where id = $1`, [d[0].id])).rows[0].state).toBe("handed");
    expect((await h.admin.query(`select kind, quantity::int q from stock_movements where source_id = $1`, [d[0].id])).rows).toEqual([{ kind: "dispense", q: -2 }]);
    const ev = (await h.admin.query(`select payload from domain_events where aggregate_id = $1 and type = 'ProductHandedOver'`, [d[0].id])).rows;
    expect(ev.map((x) => Object.keys(x.payload).sort())).toEqual([["dispensing_id", "invoice_line_id"]]);
  });

  it("named sale shows the patient; services are refused at the counter", async () => {
    const pid = await patient(A, A.b1, "Pasien Jual Cepat");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sunscreen, quantity: 1 }]));
    const d = (await h.admin.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [invoiceId])).rows[0].id;
    expect((await as(PH, prepList)).products.find((x) => x.id === d)?.patient.name).toBe("Pasien Jual Cepat");
    const svc = (await as(OWN, (db) => publish(db, { kind: "service", code: "KS-SVC" }, {
      name: "Konsultasi Kasir", tax_category: "exempt_medical", tax_basis: "Jasa", normal_price: 100_000, category: "facial", prep_min: 0, treatment_min: 15, buffer_min: 0,
      indications: "Ind", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "-", eligibility: [{ role: "doctor", mode: "performs" }], material_formula: [],
    } as never, "Baru"))).itemId;
    const { invoiceId: i2 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: svc, quantity: 1 }])))).toBe("ERR_INVALID_INPUT:counter_products_only");
  });
});

describe("void through approval", () => {
  it("requester ≠ approver; a manager on the issue day; FO cannot approve; void cancels the counter dispensing and resets the visit", async () => {
    const { visitId, patientId } = await visit(A, A.b1, FO);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId, visitId }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sunscreen, quantity: 1 }]));
    expect(await step(visitId)).toBe("in_progress");
    expect(await why(as(FO, (db) => requestVoid(db, key(), invoiceId, "x")))).toBe("ERR_INVALID_INPUT:reason");
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), invoiceId, "Salah input item"));
    // While pending, no payment.
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_000, cashTendered: 1_000 }])))).toBe("ERR_VERSION_CONFLICT:void_pending");
    expect(await code(as(FO, (db) => decideApproval(db, approvalId, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await code(as(FO2, (db) => decideApproval(db, approvalId, true)))).toBe("ERR_NOT_FOUND"); // another FO cannot even read it
    expect((await as(MGR, (db) => listInbox(db, "manager"))).rows.map((r) => r.id)).toContain(approvalId);
    expect((await as(MGR, (db) => inboxDetail(db, { staffId: MGR.staffId, role: "manager" }, approvalId)))?.amountRupiah).toBe(222_000);
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    expect((await h.admin.query(`select state, void_approval_id, voided_at is not null v from invoices where id = $1`, [invoiceId])).rows[0]).toEqual({ state: "void", void_approval_id: approvalId, v: true });
    expect(await step(visitId)).toBe("not_started");
    expect((await h.admin.query(`select count(*)::int c from domain_events where aggregate_id = $1 and type = 'InvoiceVoided'`, [invoiceId])).rows[0].c).toBe(1);
    // A closed visit gets no tagihan.
    const closed = await visit(A, A.b1, FO);
    await h.admin.query(`update visits set closed_at = now(), closed_by = $2 where id = $1`, [closed.visitId, FO.staffId]);
    expect(await why(as(FO, (db) => openKasirInvoice(db, key(), { patientId: closed.patientId, visitId: closed.visitId })))).toBe("ERR_VERSION_CONFLICT:visit_closed");
    // A new invoice for the visit is allowed after the void.
    const { invoiceId: i2 } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId, visitId }));
    await as(FO, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: sunscreen, quantity: 1 }]));
    const { invoiceId: i2b } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId, visitId }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), i2b, [{ itemId: serum, quantity: 1 }])))).toBe("ERR_VERSION_CONFLICT:visit_already_invoiced");
    // Counter sale void cancels its queued dispensing.
    const { invoiceId: i3 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), i3, [{ itemId: serum, quantity: 1 }]));
    const { approvalId: a3 } = await as(FO, (db) => requestVoid(db, key(), i3, "Pasien batal"));
    await as(OWN, (db) => decideApproval(db, a3, true));
    expect((await h.admin.query(`select d.state, d.cancel_reason from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [i3])).rows)
      .toEqual([{ state: "cancelled", cancel_reason: "Invoice dibatalkan" }]);
  });

  it("a paid invoice is not voided (refund instead); SET-43: after the issue day, or set to owner, the manager may not decide", async () => {
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sunscreen, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_000, cashTendered: 1_000 }]));
    expect(await why(as(FO, (db) => requestVoid(db, key(), invoiceId, "Salah item")))).toBe("ERR_VERSION_CONFLICT:invoice_paid");
    // Issued yesterday (owner connection; the documented stand-in, no backdating input on the money writer).
    const { invoiceId: i2 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: sunscreen, quantity: 1 }]));
    await h.admin.query("begin");
    await h.admin.query("alter table invoices disable trigger invoices_guard");
    await h.admin.query(`update invoices set issued_at = issued_at - interval '1 day' where id = $1`, [i2]);
    await h.admin.query("alter table invoices enable always trigger invoices_guard");
    await h.admin.query("commit");
    const { approvalId } = await as(FO2, (db) => requestVoid(db, key(), i2, "Salah cabang"));
    expect((await as(MGR, (db) => listInbox(db, "manager"))).rows.map((r) => r.id)).not.toContain(approvalId);
    expect((await as(MGR, (db) => inboxDetail(db, { staffId: MGR.staffId, role: "manager" }, approvalId)))?.blocked).toBe("not-approver");
    expect(await code(as(MGR, (db) => decideApproval(db, approvalId, true)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => decideApproval(db, approvalId, false, "Tidak")))).toBe("ERR_FORBIDDEN");
    expect((await h.admin.query(`select state from approvals where id = $1`, [approvalId])).rows[0].state).toBe("pending"); // rolled back cleanly
    // The requester withdraws (a manager requester's withdrawal is never blocked by SET-43).
    await as(FO2, (db) => cancelApproval(db, approvalId));
    const { approvalId: a2 } = await as(MGR2, (db) => requestVoid(db, key(), i2, "Salah cabang"));
    await as(MGR2, (db) => cancelApproval(db, a2));
    const { approvalId: a3 } = await as(FO2, (db) => requestVoid(db, key(), i2, "Salah cabang"));
    await as(OWN, (db) => decideApproval(db, a3, true));
    expect((await h.admin.query(`select state from invoices where id = $1`, [i2])).rows[0].state).toBe("void");
    // SET-43 = owner: even on the issue day the manager may not decide.
    await as(OWN, (db) => changeSetting(db, { key: "SET-43", branchId: null, value: { void: "owner", selisih_opname: 2, po_owner: 10_000_000, musnah_kedua_kejadian: 1_000_000, musnah_kedua_bulan: 5_000_000, musnah_owner: 10_000_000 }, reason: "Void selalu owner" }));
    const { invoiceId: i4 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), i4, [{ itemId: sunscreen, quantity: 1 }]));
    const { approvalId: a4 } = await as(FO, (db) => requestVoid(db, key(), i4, "Salah item"));
    expect(await code(as(MGR, (db) => decideApproval(db, a4, true)))).toBe("ERR_FORBIDDEN");
    await as(OWN, (db) => changeSetting(db, { key: "SET-43", branchId: null, restore: true, reason: "Kembali ke default" }));
  });
});

describe("roles, branches, tenants, the auditor, guards", () => {
  it("writers: owner, manager, FO and finance; others refused; branch roles at their branch; other tenant not found", async () => {
    for (const p of [AP, AU, PH, BC, DOC]) expect(await code(as(p, (db) => openKasirInvoice(db, key(), { counter: true, branchId: A.b1 }))), p.role).toBe("ERR_FORBIDDEN");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sunscreen, quantity: 1 }]));
    for (const p of [AP, PH, BC]) expect(await code(as(p, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1, cashTendered: 1 }]))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FOB2, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1, cashTendered: 1 }])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1, cashTendered: 1 }])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => kasirInvoice(db, invoiceId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FOB2, (db) => kasirInvoice(db, invoiceId)))).toBe("ERR_NOT_FOUND");
    await as(FIN, (db) => receivePayment(db, key(), invoiceId, [{ method: "transfer", amount: 1_000, details: { bank: "BNI", reference: "R-9" } }]));
    for (const p of [OWN, FIN, MGR, FO, AU]) expect(await code(as(p, (db) => kasirInvoice(db, invoiceId))), p.role).toBe("ok");
    for (const p of [AP, PH, BC, DOC]) expect(await code(as(p, (db) => kasirInvoice(db, invoiceId))), p.role).toBe("ERR_FORBIDDEN");
    for (const p of [AP, AU, PH]) expect(await code(as(p, (db) => requestVoid(db, key(), invoiceId, "Coba void"))), p.role).toBe("ERR_FORBIDDEN");
    // Direct reads (RLS): the cashier roles at the branch; nobody reads the receipt body directly.
    expect((await as(FO, (db) => db.query(`select id from payments where invoice_id = $1`, [invoiceId]))).rows.length).toBe(1);
    expect((await as(FOB2, (db) => db.query(`select id from payments where invoice_id = $1`, [invoiceId]))).rows.length).toBe(0);
    expect((await as(BC, (db) => db.query(`select id from payments where invoice_id = $1`, [invoiceId]))).rows.length).toBe(0);
    expect(await code(as(OWN, (db) => db.query(`select body from receipts limit 1`)))).toBe("raw:42501");
  });

  it("the auditor reads masked: no patient name, MRN masked, no void reason, receipt body masked", async () => {
    const pid = await patient(A, A.b1, "Nama Rahasia Pasien");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sunscreen, quantity: 1 }]));
    const r = await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 222_000, cashTendered: 222_000 }]));
    const full = await as(FO, (db) => getReceipt(db, r.receipt_id));
    expect(full.body).toContain("Tabir Surya Kasir");
    expect(full.body).toMatch(/Total dibayar Rp222\.000/);
    const au = await as(AU, (db) => kasirInvoice(db, invoiceId));
    expect(au.patient?.name).toBeNull();
    expect(au.patient?.mrn).toMatch(/^\*\*\*\d{3}$/);
    const mrn = (await h.admin.query(`select mrn from patients where id = $1`, [pid])).rows[0].mrn;
    const { invoiceId: i2 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: sunscreen, quantity: 1 }]));
    await as(FO, (db) => requestVoid(db, key(), i2, "Alasan rahasia"));
    expect((await as(AU, (db) => kasirInvoice(db, i2))).void?.reason).toBeNull();
    expect((await as(FO, (db) => kasirInvoice(db, i2))).void?.reason).toBe("Alasan rahasia");
    // A receipt template naming the patient: the auditor sees it masked.
    const tpl = (await h.admin.query(`insert into document_templates (tenant_id, kind, name, created_by, created_as) values ($1, 'receipt', 'Struk Uji', $2, 'owner') returning id`, [A.tenantId, OWN.staffId])).rows[0].id;
    const tv = (await h.admin.query(`insert into document_template_versions (tenant_id, template_id, kind, version, body, paper, created_by, created_as)
                values ($1, $2, 'receipt', 1, '{{klinik.nama}} {{cabang.alamat}} {{klinik.npwp}} {{struk.nomor}} {{tanggal}} {{struk.baris}} {{struk.total}} {{pasien.nama}} {{pasien.no_rm}}', '58mm', $3, 'owner') returning id`,
      [A.tenantId, tpl, OWN.staffId])).rows[0].id;
    const { invoiceId: i3 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true, patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), i3, [{ itemId: sunscreen, quantity: 1 }]));
    const r3 = await as(FO, (db) => receivePayment(db, key(), i3, [{ method: "cash", amount: 222_000, cashTendered: 222_000 }]));
    expect((await h.admin.query(`select used_at is not null u from document_template_versions where id = $1`, [tv])).rows[0].u).toBe(true);
    const fo3 = await as(FO, (db) => getReceipt(db, r3.receipt_id));
    expect([fo3.paper, fo3.body.includes("Nama Rahasia Pasien"), fo3.body.includes(mrn)]).toEqual(["58mm", true, true]);
    const au3 = await as(AU, (db) => getReceipt(db, r3.receipt_id));
    expect([au3.body.includes("Nama Rahasia Pasien"), au3.body.includes(mrn)]).toEqual([false, false]);
    await h.admin.query(`update document_templates set state = 'retired', retired_at = now(), retired_by = $2, retired_as = 'owner' where id = $1`, [tpl, OWN.staffId]).catch(() => undefined);
  });

  it("receipts, payments and allocations are append-only; an allocation stays within its line; a payment is for its invoice's patient", async () => {
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: sunscreen, quantity: 1 }]));
    const r = await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_000, cashTendered: 1_000 }]));
    expect(await raw(`update receipts set total = 2 where id = $1`, [r.receipt_id])).toBe("raw:42501");
    expect(await raw(`delete from receipts where id = $1`, [r.receipt_id])).toBe("raw:42501");
    expect(await raw(`update payments set amount = 2 where receipt_id = $1`, [r.receipt_id])).toBe("raw:42501");
    expect(await raw(`delete from payment_allocations where payment_id in (select id from payments where receipt_id = $1)`, [r.receipt_id])).toBe("raw:42501");
    const p = (await h.admin.query(`select id, branch_id, tenant_id from payments where receipt_id = $1`, [r.receipt_id])).rows[0];
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id;
    // A bigger payment (on the owner connection) leaves room on the payment, so the line total is the only bound hit.
    const big = (await h.admin.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, received_by, received_as)
                values ($1, $2, $3, 2, $4, null, 'edc', 900000, 'production', $5, 'fo_cashier') returning id`, [p.tenant_id, p.branch_id, r.receipt_id, invoiceId, FO.staffId])).rows[0].id;
    // Above the line total (222,000; 1,000 already allocated).
    expect(await raw(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated)
                      values ($1, $2, $3, $4, 221001, 'edc', 'production', false)`, [p.tenant_id, p.branch_id, big, line])).toBe("raw:42501");
    expect(await raw(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated)
                      values ($1, $2, $3, $4, 221000, 'edc', 'production', false)`, [p.tenant_id, p.branch_id, big, line])).toBe("ok"); // exactly the rest
    // A copy that differs from its payment (method, environment or simulated flag).
    const { invoiceId: i2 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: sunscreen, quantity: 1 }]));
    const r2 = await as(FO, (db) => receivePayment(db, key(), i2, [{ method: "cash", amount: 1_000, cashTendered: 1_000 }]));
    const p2 = (await h.admin.query(`select id from payments where receipt_id = $1`, [r2.receipt_id])).rows[0].id;
    const l2 = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [i2])).rows[0].id;
    // An EDC payment with room (seq 3) and a line with room, so only the copy rule can refuse (mutation run 2: the first
    // version hit the payment's own bound instead).
    const roomy = (await h.admin.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, received_by, received_as)
                values ($1, $2, $3, 3, $4, null, 'edc', 100000, 'production', $5, 'fo_cashier') returning id`, [p.tenant_id, p.branch_id, r2.receipt_id, i2, FO.staffId])).rows[0].id;
    void p2;
    for (const [m, env, sim] of [["cash", "production", false], ["edc", "demo", false], ["edc", "production", true]] as const)
      expect(await raw(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated)
                        values ($1, $2, $3, $4, 1, $5, $6, $7)`, [p.tenant_id, p.branch_id, roomy, l2, m, env, sim]), `${m} ${env} ${sim}`).toBe("raw:42501");
    expect(await raw(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated)
                      values ($1, $2, $3, $4, 1, 'edc', 'production', false)`, [p.tenant_id, p.branch_id, roomy, l2])).toBe("ok"); // the matching copy passes
    // A simulated allocation (T-073's mock port; the guard off for the fixture) never counts as paid (BILL-29).
    await h.admin.query("begin");
    await h.admin.query("alter table payment_allocations disable trigger payment_allocations_guard");
    await h.admin.query("alter table payments disable trigger payments_guard");
    const sim = (await h.admin.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, is_simulated, received_by, received_as)
                values ($1, $2, $3, 2, $4, null, 'qris', 5000, 'demo', true, $5, 'fo_cashier') returning id`, [p.tenant_id, p.branch_id, r2.receipt_id, i2, FO.staffId])).rows[0].id;
    await h.admin.query("alter table payments enable always trigger payments_guard");
    await h.admin.query(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated)
                         values ($1, $2, $3, $4, 5000, 'qris', 'demo', true)`, [p.tenant_id, p.branch_id, sim, l2]);
    await h.admin.query("alter table payment_allocations enable always trigger payment_allocations_guard");
    await h.admin.query("commit");
    expect((await as(FO, (db) => kasirInvoice(db, i2))).outstanding).toBe(220_999); // 1,000 + 1 real; the 5,000 simulated not
    // A payment naming another patient.
    expect(await raw(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, received_by, received_as)
                      values ($1, $2, $3, 2, $4, $5, 'edc', 1, 'production', $6, 'fo_cashier')`,
      [p.tenant_id, p.branch_id, r.receipt_id, invoiceId, await patient(A, A.b1), FO.staffId])).toBe("raw:42501");
    // An issued invoice is frozen; void only with its approved approval.
    expect(await raw(`update invoices set state = 'void', voided_at = now() where id = $1`, [invoiceId])).toBe("raw:42501");
    expect(await raw(`update invoices set number = 'X' where id = $1`, [invoiceId])).toBe("raw:42501");
    // Guards and RLS present; the new triggers enabled always.
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('receipts_insert_only','payments_insert_only','payment_allocations_insert_only',
              'payments_guard','payment_allocations_guard','approvals_invoice_void_sync') order by tgname`)).rows;
    expect(t.map((x) => x.tgenabled)).toEqual(["A", "A", "A", "A", "A", "A"]);
    const rls = (await h.admin.query(`select relname, relrowsecurity from pg_class where relname in ('receipts','payments','payment_allocations') order by relname`)).rows;
    expect(rls.every((x) => x.relrowsecurity)).toBe(true);
  });
});
