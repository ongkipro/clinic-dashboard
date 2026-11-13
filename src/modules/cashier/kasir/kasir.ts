// Kasir (UX-12, PR-19, BILL-2, BILL-17, BILL-19; T-072, migration 0087, DEC-082). Server code over the Kasir
// definers; every call runs inside withTenantContext and the database decides authority (owner, manager, FO/cashier,
// finance write; the auditor reads masked), the branch, the SET-14 methods and the allocation. Writers go through
// runCommand (idempotency by key). Nothing here reaches a payment provider: QRIS, VA and payment link wait for the
// payment port (T-073), the patient balance for T-075 (ERR_NOT_AVAILABLE).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import type { TaxCategory } from "../../tax/policy";
import { assertProductionGoLive, deployEnv } from "../../vendor/profile/profile";

export class KasirError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_GATE_CLOSED",
  "ERR_NOT_AVAILABLE", "ERR_BALANCE_INSUFFICIENT",
]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new KasirError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

// ── Writers ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type OpenInput = { branchId?: string | null; patientId?: string | null; visitId?: string | null; counter?: boolean };
export async function openKasirInvoice(db: pg.ClientBase, key: string, o: OpenInput) {
  const p: Record<string, Json> = {};
  if (o.patientId) p.patient_id = o.patientId;
  if (o.visitId) p.visit_id = o.visitId;
  if (o.counter) p.counter = true;
  const out = await command<string>(db, "invoice_open", key, { branch_id: o.branchId ?? null, invoice: p }, `select invoice_open($1, $2, $3::jsonb) as r`,
    [key, o.branchId ?? null, JSON.stringify(p)]);
  return { invoiceId: out.result, replayed: out.replayed };
}

// planItemId: an addition line (T-074, PR-15); an invoice is all addition lines or all ordinary ones.
export type KasirLine = { itemId: string; quantity: number; discount?: number; planItemId?: string };
export type Issued = { invoice_id: string; number: string; issued_at: string; is_pkp_at_issue: boolean; total: number };
export async function issueKasirInvoice(db: pg.ClientBase, key: string, invoiceId: string, lines: KasirLine[]) {
  const p = { lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, ...(l.discount !== undefined ? { discount: l.discount } : {}),
    ...(l.planItemId ? { plan_item_id: l.planItemId } : {}) })) };
  const out = await command<Issued>(db, "invoice_issue", key, { invoice_id: invoiceId, issue: p }, `select invoice_issue($1, $2, $3::jsonb) as r`,
    [key, invoiceId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

export const TENDER_METHODS = ["cash", "edc", "transfer", "qris", "va", "payment_link", "balance"] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];
export type Tender = {
  method: TenderMethod;
  amount: number;
  cashTendered?: number;
  details?: { card_type?: string; bank?: string; trace?: string; approval_code?: string; reference?: string };
};
export type Received = { receipt_id: string; number: string; paid: number; change: number; outstanding: number };
export async function receivePayment(db: pg.ClientBase, key: string, invoiceId: string, tenders: Tender[]) {
  const p = {
    tenders: tenders.map((t) => ({
      method: t.method, amount: t.amount,
      ...(t.cashTendered !== undefined ? { cash_tendered: t.cashTendered } : {}),
      ...(t.details && Object.keys(t.details).length ? { details: t.details as Record<string, Json> } : {}),
    })),
  };
  const out = await command<Received>(db, "payment_receive", key, { invoice_id: invoiceId, receive: p }, `select payment_receive($1, $2, $3::jsonb) as r`,
    [key, invoiceId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

export async function requestVoid(db: pg.ClientBase, key: string, invoiceId: string, reason: string) {
  const out = await command<string>(db, "invoice_void_request", key, { invoice_id: invoiceId, reason }, `select invoice_void_request($1, $2) as r`, [invoiceId, reason]);
  return { approvalId: out.result, replayed: out.replayed };
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type PatientRef = { id: string; name: string | null; mrn: string } | null;
export type InvoiceRow = {
  id: string; number: string | null; state: "draft" | "issued" | "void"; counter: boolean; visit_id: string | null; issued_at: string | null;
  patient: PatientRef; total: number; outstanding: number; void_pending: boolean;
};
export type KasirQueue = {
  now: string; branch: { id: string; name: string }; role: string;
  ready: { visit_id: string; checked_in_at: string; patient: PatientRef; draft_id: string | null }[];
  open: InvoiceRow[]; recent: InvoiceRow[];
};
export const kasirQueue = (db: pg.ClientBase, branchId: string | null = null) =>
  call(async () => (await db.query(`select kasir_queue($1) as r`, [branchId])).rows[0].r as KasirQueue);

export type KasirLineRow = {
  id: string; item_id: string; name: string; quantity: number; unit_price: number; discount: number; line_total: number; tax_category: TaxCategory;
  vat_amount: number; vat_recognised: number; paid: number; plan_item_id: string | null; dispensing: { id: string; state: string } | null;
};
export type TenderOption = { method: TenderMethod; available: boolean; blocked: "payment_port" | "balance" | "method_disabled" | null };
export type PortCharge = {
  id: string; channel: "qris" | "va" | "payment_link"; amount: number; state: "pending" | "paid" | "expired" | "failed" | "cancelled"; order_ref: string; expires_at: string;
  is_simulated: boolean; review_flag: string | null; balance_pending: number; receipt_id: string | null;
};
export type KasirInvoice = InvoiceRow & {
  branch: { id: string; name: string }; is_pkp_at_issue: boolean | null; patient_balance: number | null; voided_at: string | null; role: string; can_pay: boolean;
  lines: KasirLineRow[];
  receipts: { id: string; number: string; total: number; issued_at: string; is_simulated: boolean; payments: { seq: number; method: TenderMethod; amount: number; change: number | null }[] }[];
  tenders: TenderOption[];
  port: { provider: string; simulated: boolean } | null;
  charges: PortCharge[];
  void: { approval_id: string; state: "pending" | "approved" | "rejected" | "cancelled"; requested_at: string; reason: string | null } | null;
};
// The tenders depend on the deployment (T-073: the mock port is never offered in production, BILL-29).
export const kasirInvoice = (db: pg.ClientBase, invoiceId: string) =>
  call(async () => {
    await db.query(`select set_config('app.deploy_env', $1, true)`, [deployEnv()]);
    return (await db.query(`select kasir_invoice_get($1) as r`, [invoiceId])).rows[0].r as KasirInvoice;
  });

export type VisitLines = {
  visit_id: string; branch_id: string; closed: boolean; patient: PatientRef;
  lines: { item_id: string; name: string; kind: "service" | "product"; quantity: number; price: number | null }[];
};
export const kasirVisitLines = (db: pg.ClientBase, visitId: string) =>
  call(async () => (await db.query(`select kasir_visit_lines($1) as r`, [visitId])).rows[0].r as VisitLines);

export type CounterItem = { item_id: string; code: string; name: string; tax_category: TaxCategory; price: number | null };
export const kasirCounterItems = (db: pg.ClientBase, branchId: string | null, query: string | null = null) =>
  call(async () => (await db.query(`select kasir_counter_items($1, $2) as r`, [branchId, query])).rows[0].r as CounterItem[]);

export type Receipt = {
  id: string; number: string; invoice_id: string; total: number; paper: "a4" | "80mm" | "58mm"; body: string; issued_at: string; is_simulated: boolean;
  payments: { seq: number; method: TenderMethod; amount: number; change: number | null }[];
};
export const getReceipt = (db: pg.ClientBase, receiptId: string) =>
  call(async () => (await db.query(`select receipt_get($1) as r`, [receiptId])).rows[0].r as Receipt);
