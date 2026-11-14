// Biaya Operasional & Kas Kecil (PR-79, BILL-37, DATA-69; T-084, migration 0100, DEC-097). Server code over the expense definers. An
// expense is recorded by the owner, finance (any branch) or a manager (the active branch); the receipt bytes go to the database only as an
// argument and the idempotent command body names them by checksum (the privacy notice pattern). An unpaid expense creates exactly one
// supplier invoice of kind expense, paid through the supplier payment flow (pembelian); corrections are reversals. Posting is M8.
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { MAX_BYTES, sniffType } from "../compliance/compliance";
import { assertProductionGoLive } from "../vendor/profile/profile";

export class ExpenseError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new ExpenseError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export const EXPENSE_FUNDINGS = ["petty_cash", "cash", "bank", "unpaid"] as const;
export type ExpenseFunding = (typeof EXPENSE_FUNDINGS)[number];
export type ReceiptFile = { fileName: string; content: Buffer };
export type ExpenseInput = {
  categoryId: string; businessDate: string; amount: number; funding: ExpenseFunding; description: string;
  supplierId?: string | null; supplierInvoiceNumber?: string | null; receipt?: ReceiptFile | null;
};
export async function recordExpense(db: pg.ClientBase, key: string, branchId: string | null, e: ExpenseInput) {
  const p: Record<string, Json> = { category_id: e.categoryId, business_date: e.businessDate, amount: e.amount, funding: e.funding, description: e.description };
  if (e.supplierId) p.supplier_id = e.supplierId;
  if (e.supplierInvoiceNumber) p.supplier_invoice_number = e.supplierInvoiceNumber;
  let bytes: Buffer | null = null;
  if (e.receipt) {
    if (e.receipt.content.length === 0 || e.receipt.content.length > MAX_BYTES) throw new ExpenseError("ERR_INVALID_INPUT", "receipt");
    const type = sniffType(e.receipt.content);
    if (!type) throw new ExpenseError("ERR_INVALID_INPUT", "receipt");
    bytes = e.receipt.content;
    p.receipt_file_name = e.receipt.fileName.replace(/[/\\]/g, "_").trim().slice(0, 200) || "bukti";
    p.receipt_media_type = type;
    p.receipt_size = bytes.length;
    p.receipt_sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  const out = await command<string>(db, "expense_record", key, { branch_id: branchId, expense: p },
    `select expense_record($1, $2, $3::jsonb, $4) as r`, [key, branchId, JSON.stringify(p), bytes]);
  return { expenseId: out.result, replayed: out.replayed };
}
export async function reverseExpense(db: pg.ClientBase, key: string, expenseId: string, reason: string) {
  await command<null>(db, "expense_reverse", key, { expense_id: expenseId, reason }, `select expense_reverse($1, $2) as r`, [expenseId, reason]);
}
export async function saveExpenseCategory(db: pg.ClientBase, key: string, categoryId: string | null, c: { name: string; active?: boolean }) {
  const p: Record<string, Json> = { name: c.name };
  if (c.active !== undefined) p.active = c.active;
  const out = await command<string>(db, "expense_category_save", key, { id: categoryId, category: p }, `select expense_category_save($1, $2::jsonb) as r`,
    [categoryId, JSON.stringify(p)]);
  return { categoryId: out.result, replayed: out.replayed };
}

export type ExpenseRow = {
  id: string; business_date: string; branch: { id: string; name: string }; category: { id: string; name: string }; description: string;
  funding: ExpenseFunding; amount: number; state: "recorded" | "reversed"; has_receipt: boolean; receipt_file_name: string | null; receipt_media_type: string | null;
  supplier: { id: string; name: string } | null;
  payable: { invoice_id: string; number: string; state: "open" | "paid" | "reversed"; due_date: string; paid: number; credited: number } | null;
  recorded_at: string; recorded_as: string;
};
export type ExpenseList = {
  role: string; branch_id: string | null; can_record: boolean; can_reverse: boolean; can_categories: boolean;
  categories: { id: string; name: string; active: boolean }[]; branches: { id: string; name: string }[]; rows: ExpenseRow[];
};
export const listExpenses = (db: pg.ClientBase, o: { branchId?: string | null; from: string; to: string; categoryId?: string | null; funding?: ExpenseFunding | null }) =>
  call(async () => (await db.query(`select expenses_list($1, $2::date, $3::date, $4, $5) as r`,
    [o.branchId ?? null, o.from, o.to, o.categoryId ?? null, o.funding ?? null])).rows[0].r as ExpenseList);
export const expenseReceipt = (db: pg.ClientBase, expenseId: string) =>
  call(async () => (await db.query<{ file_name: string; media_type: string; content: Buffer }>(`select * from expense_receipt($1)`, [expenseId])).rows[0]);
export type BranchTotal = { branch_id: string; category_id: string; amount: number };
export const expenseBranchTotals = (db: pg.ClientBase, from: string, to: string) =>
  call(async () => (await db.query(`select expense_branch_totals($1::date, $2::date) as r`, [from, to])).rows[0].r as BranchTotal[]);
