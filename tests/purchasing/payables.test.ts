// T-067 Done-when: scenarios PR-90 — (a) a goods receipt of Rp5,000,000 with a supplier invoice due in 30 days;
// finance pays Rp2,000,000; the payable shows Rp3,000,000 outstanding; (b) an invoice of Rp3,000,000 outstanding; two
// payments of Rp2,000,000 allocated concurrently; one allocation succeeds in full and the other allocates only
// Rp1,000,000 or is refused; never over-paid. Plus the plan review: POs (draft edits deactivate lines, send, cancel,
// numbering), receipts against a PO (partial, full, beyond ordered refused, unit cost from the PO) and without one;
// GRNI per line and variance; invoice numbers per supplier; a receipt line invoiced once across live invoices (a
// reversed invoice frees it); payment vs credit application concurrency; credit notes from returns closing T-066's
// expectation; write-off; reversals; balance; roles, branches, tenants; money hidden from non-cost readers; events ids
// only; guards. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  allocatePayment, applyCredit, cancelPurchaseOrder, getPurchaseOrder, listPurchaseOrders, listReceipts, payableOverview, purchasingContext, receiveGoods,
  recordCreditNote, recordInvoice, recordPayment, reversePayable, savePurchaseOrder, sendPurchaseOrder, writeOffExpectation,
} from "../../src/modules/purchasing/payables/payables";
import { returnToSupplier, saveSupplier } from "../../src/modules/purchasing/suppliers/suppliers";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Utang Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("U1"), b2: await br("U2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`pay${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Utang ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const num = (x: unknown) => Number(x);
const inv = async (id: string) => {
  const r = (await h.admin.query(`select total::bigint t, paid_amount::bigint p, credited_amount::bigint c, state, due_date, invoice_date from supplier_invoices where id = $1`, [id])).rows[0];
  return { total: num(r.t), paid: num(r.p), credited: num(r.c), outstanding: num(r.t) - num(r.p) - num(r.c), state: r.state, due: r.due_date, date: r.invoice_date };
};

let A: T; let B: T;
let OWN: P; let ADM: P; let FIN: P; let PUR: P; let AUD: P; let MGR: P; let PH: P; let PHB2: P; let FO: P; let BFIN: P;
let item: string; let item2: string; let SUP: string; let SUP2: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); ADM = await person(A, "admin_pusat"); FIN = await person(A, "finance"); PUR = await person(A, "purchasing"); AUD = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); PH = await person(A, "pharmacist", A.b1); PHB2 = await person(A, "pharmacist", A.b2); FO = await person(A, "fo_cashier", A.b1);
  BFIN = await person(B, "finance");
  const stock = async (c: string, name: string, unit: string) => {
    const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    return (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit, storage: "ruang", highValue: false, active: true }))).itemId;
  };
  item = await stock("PY-SRM", "Serum Pembelian", "btl");
  item2 = await stock("PY-KSA", "Kasa Pembelian", "lembar");
  SUP = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "PT Farma Utang", paymentTermsDays: 30 }))).supplierId;
  SUP2 = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "CV Lain Utang", paymentTermsDays: 14 }))).supplierId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

// A received batch (no PO) at branch 1 for a supplier: returns the supplier_receipts id.
const received = async (supplier: string, q: string, unitCost: number, batchNo = `B-${++n}`) =>
  (await as(PUR, (db) => receiveGoods(db, key(), A.b1, { supplierId: supplier, lines: [{ itemId: item, batchNo, expiry: day(200), quantity: q, unitCost }] })).then(async (r) =>
    (await h.admin.query(`select id from supplier_receipts where source_kind = 'goods_receipt' and source_id = $1`, [r.receiptId])).rows[0].id as string));
const invoice = (lines: string[], number = `INV-${++n}`, supplier = SUP, extra: Partial<{ dueDate: string; invoiceDate: string }> = {}) =>
  as(PUR, (db) => recordInvoice(db, key(), A.b1, { supplierId: supplier, number, invoiceDate: extra.invoiceDate ?? day(0), dueDate: extra.dueDate, lines: lines.map((receiptId) => ({ receiptId })) }));

describe("scenario PR-90: supplier payable", () => {
  it("a goods receipt of Rp5,000,000 with an invoice due in 30 days; finance pays Rp2,000,000 → Rp3,000,000 outstanding", async () => {
    const r = await received(SUP, "100", 50_000); // 100 × 50,000 = GRNI 5,000,000
    const { invoiceId } = await invoice([r], "FAK-5JT", SUP, { invoiceDate: "2026-11-12" });
    expect(await inv(invoiceId)).toMatchObject({ total: 5_000_000, outstanding: 5_000_000, state: "open", date: "2026-11-12", due: "2026-12-12" }); // supplier terms 30 days
    await as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 2_000_000, method: "bank_transfer", paidOn: day(0), allocations: [{ invoiceId }] }));
    expect(await inv(invoiceId)).toMatchObject({ paid: 2_000_000, outstanding: 3_000_000, state: "open" });
    const ov = await as(FIN, (db) => payableOverview(db, A.b1));
    expect(ov.invoices.find((x) => x.id === invoiceId)).toMatchObject({ total: 5_000_000, paid: 2_000_000, outstanding: 3_000_000, overdue: false });
    const ev = (await h.admin.query(`select type, payload from domain_events where type in ('SupplierInvoiceRecorded','SupplierPaymentAllocated') and payload ->> 'invoice_id' = $1 order by occurred_at`, [invoiceId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["SupplierInvoiceRecorded", "SupplierPaymentAllocated"]);
    expect(Object.keys(ev[1].payload).sort()).toEqual(["invoice_id", "payment_id"]);
  });

  it("no double allocation: two payments of Rp2,000,000 allocated concurrently to Rp3,000,000 outstanding → 2,000,000 + 1,000,000, never over-paid", async () => {
    for (let round = 0; round < 3; round++) {
      const r = await received(SUP, "60", 50_000); // 3,000,000
      const { invoiceId } = await invoice([r]);
      const pay = () => as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 2_000_000, method: "cash", paidOn: day(0), allocations: [{ invoiceId }] }));
      const results = await Promise.allSettled([pay(), pay()]);
      const fulfilled = results.filter((x) => x.status === "fulfilled").length;
      const after = await inv(invoiceId);
      expect(after.paid).toBe(3_000_000);
      expect(after.state).toBe("paid");
      const allocs = (await h.admin.query(`select amount::bigint a from supplier_payment_allocations where invoice_id = $1 and not reversed order by a desc`, [invoiceId])).rows.map((x) => num(x.a));
      if (fulfilled === 2) expect(allocs).toEqual([2_000_000, 1_000_000]); // the second allocates only the rest
      else expect(allocs).toEqual([2_000_000]); // or it is refused (nothing outstanding) and nothing of it stays
      expect(allocs.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(3_000_000);
    }
  });

  it("payment and credit application at once never over-settle an invoice", async () => {
    const ret = await received(SUP, "10", 50_000);
    const rb = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [ret])).rows[0].batch_id as string;
    const { returnId } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: rb, quantity: "10", reason: "damaged", note: "Uji paralel" }));
    const { creditNoteId } = await as(PUR, (db) => recordCreditNote(db, key(), A.b1, { supplierId: SUP, number: `NK-${++n}`, amount: 500_000, issuedOn: day(0), returnId }));
    const r = await received(SUP, "16", 50_000); // 800,000
    const { invoiceId } = await invoice([r]);
    const results = await Promise.allSettled([
      as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 600_000, method: "cash", paidOn: day(0), allocations: [{ invoiceId }] })),
      as(FIN, (db) => applyCredit(db, key(), creditNoteId, invoiceId)),
    ]);
    const after = await inv(invoiceId);
    expect(after.paid + after.credited).toBeLessThanOrEqual(800_000);
    expect(after.outstanding).toBeGreaterThanOrEqual(0);
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
    const c = (await h.admin.query(`select available_amount::bigint a, amount::bigint t from supplier_credit_notes where id = $1`, [creditNoteId])).rows[0];
    expect(num(c.t) - num(c.a)).toBe(after.credited);
  });
});

describe("GRNI = quantity × unit cost (supervisor regression 2026-11-12)", () => {
  it("10 units received at Rp100,000 → GRNI Rp1,000,000 on the line, the invoice and the uninvoiced list (never marked up)", async () => {
    const r = await received(SUP, "10", 100_000);
    expect(num((await h.admin.query(`select payables_grni(r) g from supplier_receipts r where id = $1`, [r])).rows[0].g)).toBe(1_000_000);
    expect((await as(FIN, (db) => payableOverview(db, A.b1))).uninvoiced.find((u) => u.receipt_id === r)).toMatchObject({ grni: 1_000_000 });
    const { invoiceId } = await invoice([r]);
    expect((await h.admin.query(`select grni_amount::bigint g, amount::bigint a from supplier_invoice_lines where invoice_id = $1`, [invoiceId])).rows.map((x) => [num(x.g), num(x.a)]))
      .toEqual([[1_000_000, 1_000_000]]);
    expect(await inv(invoiceId)).toMatchObject({ total: 1_000_000, outstanding: 1_000_000 });
  });
});

describe("purchase orders and goods receipts (open points 1–2; r1 P1-3, P2-6)", () => {
  it("draft → edit (lines upserted, omitted deactivated) → send → partial and full receipts; beyond ordered refused; unit cost from the PO", async () => {
    const { poId } = await as(PUR, (db) => savePurchaseOrder(db, key(), null, { supplierId: SUP, branchId: A.b1, expectedDate: day(7),
      lines: [{ itemId: item, quantity: "10", unitPrice: 40_000 }, { itemId: item2, quantity: "5", unitPrice: 2_000 }] }));
    const number = (await h.admin.query(`select number from purchase_orders where id = $1`, [poId])).rows[0].number;
    expect(number).toMatch(/^PO-\d{6}-\d{4}$/);
    await as(PUR, (db) => savePurchaseOrder(db, key(), poId, { supplierId: SUP, branchId: A.b1, lines: [{ itemId: item, quantity: "12", unitPrice: 40_000 }] }));
    const lines = (await h.admin.query(`select item_id, ordered_qty::int q, active from purchase_order_lines where po_id = $1 order by item_id = $2 desc`, [poId, item])).rows;
    expect(lines).toEqual([{ item_id: item, q: 12, active: true }, { item_id: item2, q: 5, active: false }]);
    // a pharmacist cannot receive against a draft
    expect(await why(as(PH, (db) => receiveGoods(db, key(), null, { supplierId: SUP, poId, lines: [{ itemId: item, batchNo: "PO-1", expiry: day(100), quantity: "1" }] })))).toMatch(/^ERR_VERSION_CONFLICT/);
    await as(PUR, (db) => sendPurchaseOrder(db, key(), poId));
    expect(await code(as(PUR, (db) => savePurchaseOrder(db, key(), poId, { supplierId: SUP, branchId: A.b1, lines: [{ itemId: item, quantity: "1", unitPrice: 1 }] })))).toBe("ERR_VERSION_CONFLICT");
    // the pharmacist receives 5 with batch, expiry and quantity only: the unit cost is the PO's
    const g1 = await as(PH, (db) => receiveGoods(db, key(), null, { supplierId: SUP, poId, deliveryNote: "SJ-77", lines: [{ itemId: item, batchNo: "PO-A", expiry: day(100), quantity: "5" }] }));
    expect((await h.admin.query(`select state from purchase_orders where id = $1`, [poId])).rows[0].state).toBe("partially_received");
    expect((await h.admin.query(`select unit_cost::int c, quantity::int q from supplier_receipts where source_id = $1`, [g1.receiptId])).rows).toEqual([{ c: 40_000, q: 5 }]);
    expect(await why(as(PH, (db) => receiveGoods(db, key(), null, { supplierId: SUP, poId, lines: [{ itemId: item, batchNo: "PO-B", expiry: day(100), quantity: "8" }] })))).toBe("ERR_INVALID_INPUT:more_than_ordered");
    expect(await why(as(PH, (db) => receiveGoods(db, key(), null, { supplierId: SUP, poId, lines: [{ itemId: item2, batchNo: "PO-C", expiry: day(100), quantity: "1" }] })))).toBe("ERR_INVALID_INPUT:item_not_ordered");
    expect(await why(as(PH, (db) => receiveGoods(db, key(), null, { supplierId: SUP2, poId, lines: [{ itemId: item, batchNo: "PO-D", expiry: day(100), quantity: "1" }] })))).toMatch(/^ERR_VERSION_CONFLICT/);
    expect(await why(as(PH, (db) => receiveGoods(db, key(), null, { supplierId: SUP, poId, lines: [{ itemId: item, batchNo: "PO-E", expiry: "", quantity: "1" }] })))).toBe("ERR_INVALID_INPUT:expiry_missing");
    await as(PUR, (db) => receiveGoods(db, key(), A.b1, { supplierId: SUP, poId, lines: [{ itemId: item, batchNo: "PO-B", expiry: day(120), quantity: "4" }, { itemId: item, batchNo: "PO-F", expiry: day(150), quantity: "3", unitCost: 41_000 }] }));
    expect((await h.admin.query(`select state from purchase_orders where id = $1`, [poId])).rows[0].state).toBe("received");
    expect(await code(as(PUR, (db) => cancelPurchaseOrder(db, key(), poId, "Batal")))).toBe("ERR_VERSION_CONFLICT");
    const d = await as(PUR, (db) => getPurchaseOrder(db, poId));
    expect(d.receipts).toHaveLength(2);
    expect(d.lines.find((l) => l.item_id === item)).toMatchObject({ ordered: 12, received: 12, unit_price: 40_000 });
    // a pharmacist reads it without money
    const dp = await as(PH, (db) => getPurchaseOrder(db, poId));
    expect({ total: dp.total, price: dp.lines[0].unit_price, cost: dp.receipts[0].lines[0].unit_cost }).toEqual({ total: null, price: null, cost: null });
    // cancel: a sent PO with nothing received
    const { poId: p2 } = await as(MGR, (db) => savePurchaseOrder(db, key(), null, { supplierId: SUP2, lines: [{ itemId: item2, quantity: "3", unitPrice: 1_500 }] }));
    await as(MGR, (db) => sendPurchaseOrder(db, key(), p2));
    expect(await code(as(MGR, (db) => cancelPurchaseOrder(db, key(), p2, "x")))).toBe("ERR_INVALID_INPUT");
    await as(MGR, (db) => cancelPurchaseOrder(db, key(), p2, "Pemasok tidak sanggup"));
    expect((await as(PUR, (db) => listPurchaseOrders(db, A.b1, "cancelled"))).map((x) => x.id)).toContain(p2);
    expect(await code(as(ADM, (db) => savePurchaseOrder(db, key(), null, { supplierId: SUP, branchId: A.b2, lines: [{ itemId: item2, quantity: "1", unitPrice: 1 }] })))).toBe("ok"); // admin pusat names the branch
    for (const p of [PH, FIN, AUD, FO]) expect(await code(as(p, (db) => savePurchaseOrder(db, key(), null, { supplierId: SUP, branchId: A.b1, lines: [{ itemId: item, quantity: "1", unitPrice: 1 }] }))), p.role).toBe("ERR_FORBIDDEN");
    for (const p of [MGR, FIN, FO]) expect(await code(as(p, (db) => receiveGoods(db, key(), A.b1, { supplierId: SUP, lines: [{ itemId: item, batchNo: "X-1", expiry: day(100), quantity: "1", unitCost: 1 }] }))), p.role).toBe("ERR_FORBIDDEN");
  });
});

describe("invoices, payments, credit notes, reversals (open points 3–7; r1 P2-4, P2-5, P2-7, P3-8)", () => {
  it("invoice numbers per supplier; each receipt line invoiced once across live invoices; GRNI and variance; a reversed invoice frees its lines", async () => {
    const r1 = await received(SUP, "10", 10_000);
    const r2 = await received(SUP, "4", 2_500);
    const k = key();
    const first = await as(PUR, (db) => recordInvoice(db, k, A.b1, { supplierId: SUP, number: "INV-DUP", invoiceDate: day(0), dueDate: day(14), lines: [{ receiptId: r1 }, { receiptId: r2, amount: 10_500 }] }));
    expect((await as(PUR, (db) => recordInvoice(db, k, A.b1, { supplierId: SUP, number: "INV-DUP", invoiceDate: day(0), dueDate: day(14), lines: [{ receiptId: r1 }, { receiptId: r2, amount: 10_500 }] }))).invoiceId).toBe(first.invoiceId); // replay
    expect(await inv(first.invoiceId)).toMatchObject({ total: 110_500 });
    const lines = (await h.admin.query(`select grni_amount::int g, amount::int a from supplier_invoice_lines where invoice_id = $1 order by grni_amount desc`, [first.invoiceId])).rows;
    expect(lines).toEqual([{ g: 100_000, a: 100_000 }, { g: 10_000, a: 10_500 }]);
    expect((await as(FIN, (db) => payableOverview(db, A.b1))).invoices.find((x) => x.id === first.invoiceId)?.variance).toBe(500);
    const r3 = await received(SUP, "1", 1_000);
    expect(await why(invoice([r3], "inv-dup"))).toBe("ERR_VERSION_CONFLICT:duplicate_invoice_number"); // case-insensitive per supplier
    expect(await why(invoice([r3], " INV-DUP"))).toBe("ERR_INVALID_INPUT:invoice"); // a number starts with a letter or digit
    expect(await code(invoice([r3], "INV-DUP", SUP2))).toBe("ERR_NOT_FOUND"); // another supplier's number may repeat, but r3 is SUP's receipt
    expect(await why(invoice([r1]))).toBe("ERR_VERSION_CONFLICT:receipt_already_invoiced");
    await as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 1, method: "cash", paidOn: day(0), allocations: [{ invoiceId: first.invoiceId }] }));
    expect(await why(as(PUR, (db) => reversePayable(db, key(), "invoice", first.invoiceId, "Salah faktur")))).toBe("ERR_VERSION_CONFLICT:invoice_settled");
    const p1 = (await h.admin.query(`select payment_id from supplier_payment_allocations where invoice_id = $1`, [first.invoiceId])).rows[0].payment_id;
    await as(FIN, (db) => reversePayable(db, key(), "payment", p1, "Uji batal faktur"));
    await as(PUR, (db) => reversePayable(db, key(), "invoice", first.invoiceId, "Salah faktur"));
    expect(await inv(first.invoiceId)).toMatchObject({ state: "reversed", outstanding: 110_500 });
    expect(await code(invoice([r1, r2], "INV-DUP-2"))).toBe("ok"); // freed
    expect(await code(as(PUR, (db) => reversePayable(db, key(), "invoice", first.invoiceId, "Lagi")))).toBe("ERR_VERSION_CONFLICT");
    for (const p of [PH, MGR, AUD, FO]) expect(await code(as(p, (db) => recordInvoice(db, key(), A.b1, { supplierId: SUP, number: `X-${++n}`, invoiceDate: day(0), lines: [{ receiptId: r3 }] }))), p.role).toBe("ERR_FORBIDDEN");
  });

  it("payments: named invoices, oldest due first, the unallocated rest allocated later; a named settled invoice refused; reversal reopens", async () => {
    const t = await tenant();
    const own = await person(t, "owner"); const ph = await person(t, "pharmacist", t.b1); const pur = await person(t, "purchasing"); const fin = await person(t, "finance");
    const cat = (await as(own, (db) => publish(db, { kind: "material", code: "PY-T2" }, { name: "Bahan T2", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Bahan"))).itemId;
    const it = (await as(ph, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    const sup = (await as(pur, (db) => saveSupplier(db, key(), null, { name: "PT Tua Muda" }))).supplierId;
    const rec = async (q: string) => (await as(pur, (db) => receiveGoods(db, key(), t.b1, { supplierId: sup, lines: [{ itemId: it, batchNo: `T2-${++n}`, expiry: day(100), quantity: q, unitCost: 1_000 }] }))).receiptId;
    const rid = async (g: string) => (await h.admin.query(`select id from supplier_receipts where source_id = $1`, [g])).rows[0].id as string;
    const oldReceipt = await rid(await rec("300"));
    const old = (await as(pur, (db) => recordInvoice(db, key(), t.b1, { supplierId: sup, number: "OLD", invoiceDate: day(-20), dueDate: day(-5), lines: [{ receiptId: oldReceipt }] }))).invoiceId;
    const youngReceipt = await rid(await rec("500"));
    const young = (await as(pur, (db) => recordInvoice(db, key(), t.b1, { supplierId: sup, number: "YOUNG", invoiceDate: day(-1), dueDate: day(20), lines: [{ receiptId: youngReceipt }] }))).invoiceId;
    const { paymentId: p0 } = await as(fin, (db) => recordPayment(db, key(), t.b1, { supplierId: sup, amount: 1_000, method: "cash", paidOn: day(0) }));
    expect([(await inv(old)).paid, (await inv(young)).paid]).toEqual([1_000, 0]); // oldest due first
    await as(fin, (db) => reversePayable(db, key(), "payment", p0, "Uji urutan"));
    expect(await why(as(fin, (db) => reversePayable(db, key(), "payment", p0, "Lagi")))).toBe("ERR_VERSION_CONFLICT:payment reversed");
    expect(await why(as(fin, (db) => allocatePayment(db, key(), p0, null)))).toBe("ERR_VERSION_CONFLICT:nothing_unallocated"); // a reversed payment allocates nothing
    const { paymentId } = await as(fin, (db) => recordPayment(db, key(), t.b1, { supplierId: sup, amount: 1_000_000, method: "bank_transfer", paidOn: day(0), reference: "TRF-1" }));
    expect((await inv(old)).state).toBe("paid"); // oldest due first
    expect((await inv(young)).paid).toBe(500_000);
    const unalloc = num((await h.admin.query(`select amount - allocated_amount u from supplier_payments where id = $1`, [paymentId])).rows[0].u);
    expect(unalloc).toBe(200_000);
    const ov = await as(fin, (db) => payableOverview(db, t.b1));
    expect(ov.balances.find((b) => b.supplier_id === sup)).toMatchObject({ invoiced_total: 800_000, allocated_payments: 800_000, unallocated_payments: 200_000, open_payable: 0, net_balance: -200_000 });
    expect(ov.invoices.find((x) => x.id === old)?.overdue).toBe(false); // paid
    // a later invoice takes the rest
    const laterReceipt = await rid(await rec("250"));
    const later = (await as(pur, (db) => recordInvoice(db, key(), t.b1, { supplierId: sup, number: "LATER", invoiceDate: day(0), lines: [{ receiptId: laterReceipt }] }))).invoiceId;
    expect((await as(fin, (db) => allocatePayment(db, key(), paymentId, [{ invoiceId: later }]))).allocated).toBe(200_000);
    expect(await why(as(fin, (db) => allocatePayment(db, key(), paymentId, null)))).toBe("ERR_VERSION_CONFLICT:nothing_unallocated");
    // a payment naming a settled invoice is refused whole (nothing is recorded)
    expect(await why(as(fin, (db) => recordPayment(db, key(), t.b1, { supplierId: sup, amount: 1, method: "cash", paidOn: day(0), allocations: [{ invoiceId: old }] }))))
      .toBe("ERR_VERSION_CONFLICT:nothing_outstanding");
    // reversal: the allocations reversed, the invoices reopened
    await as(fin, (db) => reversePayable(db, key(), "payment", paymentId, "Transfer gagal"));
    expect(await inv(old)).toMatchObject({ state: "open", paid: 0 });
    expect(await inv(later)).toMatchObject({ state: "open", paid: 0 });
    expect((await h.admin.query(`select state, allocated_amount::int a from supplier_payments where id = $1`, [paymentId])).rows[0]).toEqual({ state: "reversed", a: 0 });
    expect(await code(as(pur, (db) => recordPayment(db, key(), t.b1, { supplierId: sup, amount: 1, method: "cash", paidOn: day(0) })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(fin, (db) => recordPayment(db, key(), t.b2, { supplierId: sup, amount: 1, method: "cash", paidOn: day(0), allocations: [{ invoiceId: young }] })))).toBe("ERR_NOT_FOUND"); // another branch's invoice
    expect(await code(as(fin, (db) => recordPayment(db, key(), t.b1, { supplierId: sup, amount: 0, method: "cash", paidOn: day(0) })))).toBe("ERR_INVALID_INPUT");
    for (const amount of [1.5, -1, Number.NaN]) expect(await code(as(fin, (db) => recordPayment(db, key(), t.b1, { supplierId: sup, amount, method: "cash", paidOn: day(0) }))), String(amount)).toBe("ERR_INVALID_INPUT"); // the module
    expect(await code(as(pur, (db) => receiveGoods(db, key(), t.b1, { supplierId: sup, lines: [{ itemId: it, batchNo: "Q-1", expiry: day(100), quantity: "1e1", unitCost: 1 }] })))).toBe("ERR_INVALID_INPUT");
    const ev = (await h.admin.query(`select type from domain_events where aggregate_id = $1 and type = 'SupplierPaymentReversed'`, [paymentId])).rows;
    expect(ev).toHaveLength(1);
  });

  it("credit notes: from a return (closes T-066's expectation) or an invoice; applied atomically; write-off; reversal", async () => {
    const r = await received(SUP, "20", 10_000);
    const b = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [r])).rows[0].batch_id;
    const { returnId } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "5", reason: "damaged", note: "Retur uji kredit" }));
    const { returnId: ret2 } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "1", reason: "quality", note: "Retur dihapusbukukan" }));
    const { creditNoteId } = await as(PUR, (db) => recordCreditNote(db, key(), A.b1, { supplierId: SUP, number: "NK-RET", amount: 50_000, taxAmount: 0, issuedOn: day(0), returnId }));
    expect((await h.admin.query(`select state, credit_note_id from supplier_credit_expectations where return_id = $1`, [returnId])).rows[0]).toEqual({ state: "received", credit_note_id: creditNoteId });
    expect(await why(as(PUR, (db) => recordCreditNote(db, key(), A.b1, { supplierId: SUP, number: "NK-RET-2", amount: 1, issuedOn: day(0), returnId })))).toBe("ERR_VERSION_CONFLICT:expectation received");
    expect(await why(as(PUR, (db) => recordCreditNote(db, key(), A.b1, { supplierId: SUP, number: "nk-ret", amount: 1, issuedOn: day(0), returnId: ret2 })))).toBe("ERR_VERSION_CONFLICT:duplicate_credit_note_number");
    expect(await code(as(FIN, (db) => writeOffExpectation(db, key(), ret2, "x")))).toBe("ERR_INVALID_INPUT");
    await as(FIN, (db) => writeOffExpectation(db, key(), ret2, "Pemasok menolak retur"));
    expect((await h.admin.query(`select state, closed_reason from supplier_credit_expectations where return_id = $1`, [ret2])).rows[0]).toEqual({ state: "written_off", closed_reason: "Pemasok menolak retur" });
    // apply 50,000 to a 30,000 invoice: 30,000 taken, 20,000 left on the note
    const r2 = await received(SUP, "3", 10_000);
    const { invoiceId } = await invoice([r2]);
    expect((await as(FIN, (db) => applyCredit(db, key(), creditNoteId, invoiceId))).applied).toBe(30_000);
    expect(await inv(invoiceId)).toMatchObject({ credited: 30_000, outstanding: 0, state: "paid" });
    expect(num((await h.admin.query(`select available_amount from supplier_credit_notes where id = $1`, [creditNoteId])).rows[0].available_amount)).toBe(20_000);
    expect(await why(as(FIN, (db) => applyCredit(db, key(), creditNoteId, invoiceId)))).toBe("ERR_VERSION_CONFLICT:nothing_to_apply");
    expect(await code(as(PUR, (db) => applyCredit(db, key(), creditNoteId, invoiceId)))).toBe("ERR_FORBIDDEN");
    // an invoice-sourced note (a price correction)
    const { creditNoteId: c2 } = await as(FIN, (db) => recordCreditNote(db, key(), A.b1, { supplierId: SUP, number: "NK-INV", amount: 1_000, issuedOn: day(0), invoiceId }));
    expect((await h.admin.query(`select source_kind, invoice_id from supplier_credit_notes where id = $1`, [c2])).rows[0]).toEqual({ source_kind: "invoice", invoice_id: invoiceId });
    // reversal of the applied note reopens the invoice
    await as(FIN, (db) => reversePayable(db, key(), "credit_note", creditNoteId, "Nota salah nomor"));
    expect(await inv(invoiceId)).toMatchObject({ credited: 0, outstanding: 30_000, state: "open" });
    expect((await h.admin.query(`select state, available_amount::int a from supplier_credit_notes where id = $1`, [creditNoteId])).rows[0]).toEqual({ state: "reversed", a: 0 });
    expect((await h.admin.query(`select type from domain_events where aggregate_id = $1 order by occurred_at`, [creditNoteId])).rows.map((e) => e.type)).toEqual(["SupplierCreditApplied", "SupplierCreditReversed"]);
    // Review 2665ab81 P3: a supplier whose only payable row at a branch is a credit note still has a balance row (the
    // note's invoice was reversed, so no live invoice or payment remains there).
    const { supplierId: lone } = await as(PUR, (db) => saveSupplier(db, key(), null, { name: `PT Kredit Saja ${n}` }));
    const r3 = await received(lone, "1", 4_000);
    const { invoiceId: i3 } = await invoice([r3], `INV-SAJA-${n}`, lone);
    await as(FIN, (db) => recordCreditNote(db, key(), A.b1, { supplierId: lone, number: "NK-SAJA", amount: 500, issuedOn: day(0), invoiceId: i3 }));
    await as(PUR, (db) => reversePayable(db, key(), "invoice", i3, "Faktur salah pemasok"));
    expect((await as(FIN, (db) => payableOverview(db, A.b1))).balances.find((b) => b.supplier_id === lone)).toMatchObject({ available_credits: 500 });
  });
});

describe("authority, readers, guards", () => {
  it("money readers only; branches; tenants; column grants hide PO prices", async () => {
    const r = await received(SUP, "2", 7_000);
    const { invoiceId } = await invoice([r]);
    for (const p of [PH, FO]) expect(await code(as(p, (db) => payableOverview(db, A.b1))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => payableOverview(db, A.b2)))).toBe("ERR_NOT_FOUND");
    expect((await as(AUD, (db) => payableOverview(db, A.b1))).invoices.some((x) => x.id === invoiceId)).toBe(true);
    expect((await as(FIN, (db) => payableOverview(db, A.b2))).invoices.some((x) => x.id === invoiceId)).toBe(false);
    expect(await code(as(BFIN, (db) => payableOverview(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect((await as(PH, (db) => db.query(`select id from supplier_invoices where id = $1`, [invoiceId]))).rows.length).toBe(0);
    expect((await as(FIN, (db) => db.query(`select id from supplier_invoices where id = $1`, [invoiceId]))).rows.length).toBe(1);
    expect((await as(BFIN, (db) => db.query(`select id from supplier_invoices where id = $1`, [invoiceId]))).rows.length).toBe(0);
    expect(await code(as(PH, (db) => db.query(`select unit_price from purchase_order_lines limit 1`)))).toBe("raw:42501");
    expect((await as(PH, (db) => db.query(`select ordered_qty from purchase_order_lines limit 1`))).rows.length).toBeGreaterThanOrEqual(0);
    expect(await code(as(BFIN, (db) => recordPayment(db, key(), B.b1, { supplierId: SUP, amount: 1, method: "cash", paidOn: day(0), allocations: [{ invoiceId }] })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(PHB2, (db) => listReceipts(db, A.b1)))).toBe("ERR_NOT_FOUND");
    const ctx = await as(PH, purchasingContext);
    expect({ money: ctx.money, pay: ctx.can_pay, receive: ctx.can_receive }).toEqual({ money: false, pay: false, receive: true });
    // Review 2665ab81 P1-1: the money writers take the actor lock first; an unknown or another tenant's id is not found
    // (never an input error); another branch's PO is not found for its manager (not "another branch").
    const ghost = crypto.randomUUID();
    expect(await code(as(FIN, (db) => allocatePayment(db, key(), ghost, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FIN, (db) => applyCredit(db, key(), ghost, invoiceId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FIN, (db) => writeOffExpectation(db, key(), ghost, "Alasan uji")))).toBe("ERR_NOT_FOUND");
    for (const kind of ["invoice", "payment", "credit_note"] as const) expect(await code(as(FIN, (db) => reversePayable(db, key(), kind, ghost, "Alasan uji"))), kind).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFIN, (db) => reversePayable(db, key(), "invoice", invoiceId, "Alasan uji")))).toBe("ERR_NOT_FOUND");
    const { poId: otherPo } = await as(PUR, (db) => savePurchaseOrder(db, key(), null, { supplierId: SUP, branchId: A.b2, lines: [{ itemId: item, quantity: "1", unitPrice: 1 }] }));
    expect(await code(as(MGR, (db) => sendPurchaseOrder(db, key(), otherPo)))).toBe("ERR_NOT_FOUND");
    // Review 2665ab81 P3: a non-positive or over-precise receipt quantity is an input error before any PO line counts.
    const { poId: pq } = await as(PUR, (db) => savePurchaseOrder(db, key(), null, { supplierId: SUP, branchId: A.b1, lines: [{ itemId: item, quantity: "5", unitPrice: 1 }] }));
    await as(PUR, (db) => sendPurchaseOrder(db, key(), pq));
    for (const q of ["0", "-1", "1.00001"]) {
      const raw = (await as(PH, (db) => db.query(`select goods_receipt_record($1, null, $2::jsonb)`,
        [`k-q-${crypto.randomUUID()}`, JSON.stringify({ supplier_id: SUP, po_id: pq, lines: [{ item_id: item, batch_no: "Q-1", expiry: day(100), quantity: q }] })]).then(() => "ok", (e) => e.code)));
      expect(raw, q).toBe("22023");
    }
    expect((await h.admin.query(`select received_qty::float r from purchase_order_lines where po_id = $1`, [pq])).rows[0].r).toBe(0);
  });

  it("guards: nothing deleted; amounts and counters follow their children; settlements only reversed; replica mode", async () => {
    const r = await received(SUP, "2", 9_000);
    const { invoiceId } = await invoice([r]);
    const { paymentId } = await as(FIN, (db) => recordPayment(db, key(), A.b1, { supplierId: SUP, amount: 5_000, method: "cash", paidOn: day(0), allocations: [{ invoiceId }] }));
    const raw = (sql: string, args: unknown[] = []) => code(h.admin.query(sql, args));
    expect(await raw(`update supplier_invoices set total = 1 where id = $1`, [invoiceId])).toBe("raw:42501");
    expect(await raw(`update supplier_invoices set paid_amount = 18000, state = 'paid' where id = $1`, [invoiceId])).toBe("raw:42501");
    expect(await raw(`delete from supplier_invoices where id = $1`, [invoiceId])).toBe("raw:42501");
    expect(await raw(`update supplier_payments set amount = 9 where id = $1`, [paymentId])).toBe("raw:42501");
    expect(await raw(`update supplier_payments set allocated_amount = 0 where id = $1`, [paymentId])).toBe("raw:42501");
    expect(await raw(`update supplier_payment_allocations set amount = 1 where payment_id = $1`, [paymentId])).toBe("raw:42501");
    expect(await raw(`delete from supplier_payment_allocations where payment_id = $1`, [paymentId])).toBe("raw:42501");
    expect(await raw(`update supplier_invoice_lines set amount = 1 where invoice_id = $1`, [invoiceId])).toBe("raw:42501");
    // a line follows its invoice's reversal but never changes its amount on the way (the header reversed alone on the owner connection)
    const r2 = await received(SUP, "1", 3_000);
    const { invoiceId: lone } = await invoice([r2]);
    expect(await raw(`update supplier_invoices set state = 'reversed', reversed_at = now(), reversed_by = $2, reverse_reason = 'uji' where id = $1`, [lone, FIN.staffId])).toBe("ok");
    expect(await raw(`update supplier_invoice_lines set amount = amount + 1, reversed = true where invoice_id = $1`, [lone])).toBe("raw:42501");
    expect(await raw(`update supplier_invoice_lines set reversed = true where invoice_id = $1`, [lone])).toBe("ok");
    expect(await raw(`update goods_receipts set delivery_note = 'X' where true`)).toBe("raw:42501");
    expect(await raw(`truncate supplier_payments`)).toMatch(/^raw:/);
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`delete from supplier_invoices where id = $1`, [invoiceId]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
  });
});
