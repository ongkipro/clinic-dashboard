// Purchase orders, goods receipts and supplier payables (PR-90, PR-17, BILL-34, DATA-64; T-067, DEC-077). Every call
// runs inside withTenantContext; the database decides authority (POs: purchasing, admin pusat, owner, manager;
// receipts: pharmacist, purchasing; invoices and credit notes: purchasing, finance; payments, allocations, credit
// applications, write-offs and payment / credit reversals: finance). Commands go through runCommand with the caller's
// key (production needs the go-live gate first); database errors are mapped outside it. Money is integer rupiah.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { INVOICE_STATES, LEDGER_STATES, PAYMENT_METHODS, PO_STATES } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class PayablesError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new PayablesError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}
// Quantities are validated by the definers (po_save bounds and scale; goods_receipt_record pattern and bounds before
// any PO line counts, review 2665ab81 P3), so the module passes them through.
const rupiah = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new PayablesError("ERR_INVALID_INPUT", "amount");
  return n;
};

export type PoState = (typeof PO_STATES)[number];
export type InvoiceState = (typeof INVOICE_STATES)[number];
export type LedgerState = (typeof LEDGER_STATES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ── Purchase orders ────────────────────────────────────────────────────────────────────────────────────
export type PoInput = { supplierId: string; branchId?: string | null; expectedDate?: string | null; note?: string | null;
  lines: { itemId: string; quantity: string; unitPrice: number }[] };
export async function savePurchaseOrder(db: pg.ClientBase, key: string, poId: string | null, i: PoInput) {
  const p: Record<string, Json> = { supplier_id: i.supplierId,
    lines: i.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, unit_price: rupiah(l.unitPrice) })) };
  if (i.branchId) p.branch_id = i.branchId;
  if (i.expectedDate) p.expected_date = i.expectedDate;
  if (i.note) p.note = i.note;
  const out = await command<string>(db, "po_save", key, { po_id: poId, po: p }, `select po_save($1, $2, $3::jsonb) as r`, [key, poId, JSON.stringify(p)]);
  return { poId: out.result, replayed: out.replayed };
}
export async function sendPurchaseOrder(db: pg.ClientBase, key: string, poId: string) {
  const out = await command(db, "po_transition", key, { po_id: poId, action: "send" }, `select po_transition($1, 'send', null) as r`, [poId]);
  return { replayed: out.replayed };
}
export async function cancelPurchaseOrder(db: pg.ClientBase, key: string, poId: string, reason: string) {
  const out = await command(db, "po_transition", key, { po_id: poId, action: "cancel", reason }, `select po_transition($1, 'cancel', $2) as r`, [poId, reason]);
  return { replayed: out.replayed };
}

// ── Goods receipts ─────────────────────────────────────────────────────────────────────────────────────
export type ReceiptLine = { itemId: string; batchNo: string; expiry: string; quantity: string; unitCost?: number | null };
export async function receiveGoods(db: pg.ClientBase, key: string, branchId: string | null,
  r: { supplierId: string; poId?: string | null; depotId?: string | null; deliveryNote?: string | null; lines: ReceiptLine[] }) {
  const p: Record<string, Json> = { supplier_id: r.supplierId, lines: r.lines.map((l) => {
    const x: Record<string, Json> = { item_id: l.itemId, batch_no: l.batchNo, expiry: l.expiry, quantity: l.quantity };
    if (l.unitCost != null) x.unit_cost = rupiah(l.unitCost);
    return x;
  }) };
  if (r.poId) p.po_id = r.poId;
  if (r.depotId) p.depot_id = r.depotId;
  if (r.deliveryNote) p.delivery_note = r.deliveryNote;
  const out = await command<string>(db, "goods_receipt_record", key, { branch_id: branchId, receipt: p }, `select goods_receipt_record($1, $2, $3::jsonb) as r`,
    [key, branchId, JSON.stringify(p)]);
  return { receiptId: out.result, replayed: out.replayed };
}

// ── Invoices, payments, credit notes ───────────────────────────────────────────────────────────────────
export async function recordInvoice(db: pg.ClientBase, key: string, branchId: string | null,
  i: { supplierId: string; number: string; invoiceDate: string; dueDate?: string | null; lines: { receiptId: string; amount?: number | null }[] }) {
  const p: Record<string, Json> = { supplier_id: i.supplierId, number: i.number, invoice_date: i.invoiceDate,
    lines: i.lines.map((l): Json => (l.amount != null ? { receipt_id: l.receiptId, amount: rupiah(l.amount) } : { receipt_id: l.receiptId })) };
  if (i.dueDate) p.due_date = i.dueDate;
  const out = await command<string>(db, "supplier_invoice_record", key, { branch_id: branchId, invoice: p }, `select supplier_invoice_record($1, $2, $3::jsonb) as r`,
    [key, branchId, JSON.stringify(p)]);
  return { invoiceId: out.result, replayed: out.replayed };
}
export type Allocation = { invoiceId: string; amount?: number | null };
const allocations = (xs: Allocation[]): Json[] => xs.map((a): Json => (a.amount != null ? { invoice_id: a.invoiceId, amount: rupiah(a.amount) } : { invoice_id: a.invoiceId }));
export async function recordPayment(db: pg.ClientBase, key: string, branchId: string | null,
  pm: { supplierId: string; amount: number; method: PaymentMethod; paidOn: string; reference?: string | null; allocations?: Allocation[] }) {
  const p: Record<string, Json> = { supplier_id: pm.supplierId, amount: rupiah(pm.amount), method: pm.method, paid_on: pm.paidOn };
  if (pm.reference) p.reference = pm.reference;
  if (pm.allocations) p.allocations = allocations(pm.allocations);
  const out = await command<string>(db, "supplier_payment_record", key, { branch_id: branchId, payment: p }, `select supplier_payment_record($1, $2, $3::jsonb) as r`,
    [key, branchId, JSON.stringify(p)]);
  return { paymentId: out.result, replayed: out.replayed };
}
export async function allocatePayment(db: pg.ClientBase, key: string, paymentId: string, targets: Allocation[] | null) {
  const t = targets ? allocations(targets) : null;
  const out = await command<number>(db, "supplier_payment_allocate", key, { payment_id: paymentId, allocations: t }, `select supplier_payment_allocate($1, $2, $3::jsonb) as r`,
    [key, paymentId, t ? JSON.stringify(t) : null]);
  return { allocated: Number(out.result), replayed: out.replayed };
}
export async function recordCreditNote(db: pg.ClientBase, key: string, branchId: string | null,
  c: { supplierId: string; number: string; amount: number; taxAmount?: number; issuedOn: string; returnId?: string | null; invoiceId?: string | null }) {
  const p: Record<string, Json> = { supplier_id: c.supplierId, number: c.number, amount: rupiah(c.amount), issued_on: c.issuedOn };
  if (c.taxAmount != null) p.tax_amount = rupiah(c.taxAmount);
  if (c.returnId) p.return_id = c.returnId;
  if (c.invoiceId) p.invoice_id = c.invoiceId;
  const out = await command<string>(db, "supplier_credit_note_record", key, { branch_id: branchId, credit_note: p }, `select supplier_credit_note_record($1, $2, $3::jsonb) as r`,
    [key, branchId, JSON.stringify(p)]);
  return { creditNoteId: out.result, replayed: out.replayed };
}
export async function applyCredit(db: pg.ClientBase, key: string, creditNoteId: string, invoiceId: string, amount: number | null = null) {
  const out = await command<number>(db, "supplier_credit_apply", key, { credit_note_id: creditNoteId, invoice_id: invoiceId, amount },
    `select supplier_credit_apply($1, $2, $3, $4) as r`, [key, creditNoteId, invoiceId, amount == null ? null : rupiah(amount)]);
  return { applied: Number(out.result), replayed: out.replayed };
}
export async function writeOffExpectation(db: pg.ClientBase, key: string, returnId: string, reason: string) {
  const out = await command(db, "supplier_credit_expectation_write_off", key, { return_id: returnId, reason }, `select supplier_credit_expectation_write_off($1, $2) as r`, [returnId, reason]);
  return { replayed: out.replayed };
}
export async function reversePayable(db: pg.ClientBase, key: string, kind: "invoice" | "payment" | "credit_note", id: string, reason: string) {
  const out = await command(db, "supplier_payable_reverse", key, { kind, id, reason }, `select supplier_payable_reverse($1, $2, $3) as r`, [kind, id, reason]);
  return { replayed: out.replayed };
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────
export type PurchasingContext = {
  role: string; active_branch_id: string | null; branches: { id: string; name: string }[]; money: boolean; can_supplier: boolean; can_po: boolean;
  can_receive: boolean; can_return: boolean; can_transfer: boolean; can_invoice: boolean; can_pay: boolean;
  suppliers: { id: string; name: string; active: boolean; payment_terms_days: number }[]; items: { id: string; name: string; code: string; unit: string }[];
};
export type PoRow = { id: string; number: string; branch_id: string; supplier_id: string; supplier_name: string; state: PoState; expected_date: string | null; note: string | null;
  created_at: string; sent_at: string | null; cancel_reason: string | null; total: number | null };
export type ReceiptRow = { id: string; branch_id: string; supplier_id: string; supplier_name: string; po_id: string | null; po_number: string | null; depot_id: string;
  delivery_note: string | null; received_at: string; received_as: string;
  lines: { receipt_id: string; batch_id: string; batch_no: string; expiry: string; item: string; unit: string; quantity: number; unit_cost: number | null; grni: number | null; invoiced: boolean }[] };
export type PoDetail = PoRow & {
  lines: { id: string; item_id: string; name: string; unit: string; ordered: number; received: number; active: boolean; unit_price: number | null }[];
  receipts: ReceiptRow[];
};
export type Balance = { supplier_id: string; supplier_name: string; invoiced_total: number; allocated_payments: number; unallocated_payments: number; applied_credits: number;
  available_credits: number; open_payable: number; net_balance: number };
export type PayableOverview = {
  branch_id: string; today: string;
  invoices: { id: string; supplier_id: string; supplier_name: string; number: string; kind: string; invoice_date: string; due_date: string; total: number; paid: number;
    credited: number; outstanding: number; state: InvoiceState; overdue: boolean; variance: number | null }[];
  uninvoiced: { receipt_id: string; supplier_id: string; supplier_name: string; item: string; unit: string; batch_no: string; quantity: number; unit_cost: number; grni: number;
    received_at: string; delivery_note: string | null }[];
  payments: { id: string; supplier_id: string; supplier_name: string; amount: number; unallocated: number; method: PaymentMethod; paid_on: string; reference: string | null;
    state: LedgerState }[];
  credit_notes: { id: string; supplier_id: string; supplier_name: string; number: string; amount: number; available: number; source: string; issued_on: string; state: LedgerState }[];
  expected_credits: { return_id: string; supplier_id: string; supplier_name: string; amount: number; uncosted: boolean; created_at: string }[];
  balances: Balance[];
};
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const purchasingContext = (db: pg.ClientBase) => read<PurchasingContext>(db, `select purchasing_context() as r`, []);
export const listPurchaseOrders = (db: pg.ClientBase, branchId: string | null, state: PoState | null = null) =>
  read<PoRow[]>(db, `select po_list($1, $2) as r`, [branchId, state]);
export const getPurchaseOrder = (db: pg.ClientBase, poId: string) => read<PoDetail>(db, `select po_get($1) as r`, [poId]);
export const listReceipts = (db: pg.ClientBase, branchId: string | null, limit = 50) => read<ReceiptRow[]>(db, `select goods_receipt_list($1, $2) as r`, [branchId, limit]);
export const payableOverview = (db: pg.ClientBase, branchId: string | null) => read<PayableOverview>(db, `select payable_overview($1) as r`, [branchId]);
