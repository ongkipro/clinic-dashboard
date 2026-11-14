// Piutang & Refund (PR-21, PR-37, PR-15, B-04, B-14, B-18; T-078, migration 0094, DEC-090). Server code over the refund and
// receivable definers; every call runs inside withTenantContext and the database decides authority, the branch, the room on
// the line (the shared moved_to_balance ceiling), the SET-11 approver and the money moves. A refund goes to the patient balance
// by default; a cash refund is an approved exception (Persetujuan), then paid at the drawer. A visit's delivered unpaid remainder
// becomes a receivable so the visit can close; it is collected later (KW receipt) or written off by the owner.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class ReceivableError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_NOT_AVAILABLE",
  "ERR_APPROVER_IS_REQUESTER", "ERR_BALANCE_INSUFFICIENT",
]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new ReceivableError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

// ── Refunds ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RefundInput = { amount: number; destination?: "balance" | "cash"; reason: string; returnedQuantity?: number };
export async function requestRefund(db: pg.ClientBase, key: string, lineId: string, r: RefundInput) {
  const p: Record<string, Json> = { amount: r.amount, reason: r.reason };
  if (r.destination) p.destination = r.destination;
  if (r.returnedQuantity !== undefined) p.returned_quantity = r.returnedQuantity;
  const out = await command<{ refund_id: string; state: string; approval_id: string | null }>(db, "refund_request", key, { line_id: lineId, refund: p },
    `select refund_request($1, $2, $3::jsonb) as r`, [key, lineId, JSON.stringify(p)]);
  return out.result;
}
export async function payRefund(db: pg.ClientBase, key: string, refundId: string, method: "cash" | "transfer", details?: { bank?: string; reference?: string }) {
  const p: Record<string, Json> = { method };
  if (details) p.details = details;
  const out = await command<{ refund_id: string; state: string }>(db, "refund_pay", key, { refund_id: refundId, pay: p },
    `select refund_pay($1, $2, $3::jsonb) as r`, [key, refundId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

// ── Receivables ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function convertToReceivable(db: pg.ClientBase, key: string, visitId: string) {
  const out = await command<{ receivable_id: string; amount: number }>(db, "receivable_convert", key, { visit_id: visitId },
    `select receivable_convert($1, $2) as r`, [key, visitId]);
  return out.result;
}
export type Collection = { method: "cash" | "edc" | "transfer" | "balance"; amount: number; cashTendered?: number; details?: Record<string, string> };
export async function collectReceivable(db: pg.ClientBase, key: string, receivableId: string, c: Collection) {
  const p: Record<string, Json> = { method: c.method, amount: c.amount };
  if (c.cashTendered !== undefined) p.cash_tendered = c.cashTendered;
  if (c.details) p.details = c.details;
  const out = await command<{ receipt_id: string; number: string; open: number; change: number }>(db, "receivable_collect", key,
    { receivable_id: receivableId, collect: p }, `select receivable_collect($1, $2, $3::jsonb) as r`, [key, receivableId, JSON.stringify(p)]);
  return out.result;
}
export async function requestWriteOff(db: pg.ClientBase, key: string, receivableId: string, reason: string) {
  const out = await command<string>(db, "receivable_write_off_request", key, { receivable_id: receivableId, reason },
    `select receivable_write_off_request($1, $2) as r`, [receivableId, reason]);
  return { approvalId: out.result };
}
export async function writeOffAsOwner(db: pg.ClientBase, key: string, receivableId: string, reason: string) {
  const out = await command<{ write_off_id: string; approval_id: string }>(db, "receivable_write_off_owner", key, { receivable_id: receivableId, reason },
    `select receivable_write_off_owner($1, $2, $3) as r`, [key, receivableId, reason]);
  return out.result;
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Patient = { id: string; name: string | null; mrn: string };
export type ReceivableRow = {
  id: string; branch_id: string; patient: Patient; visit_id: string; amount: number; collected: number; written_off: number; open: number;
  state: "open" | "collected" | "written_off"; write_off_pending: boolean; created_at: string; age_days: number; bucket: "0-30" | "31-60" | "61-90" | ">90";
  collector: string | null; created_by: string | null; lines: { name: string; amount: number }[];
};
export type RefundRow = {
  id: string; kind: "line" | "deposit"; patient: Patient; invoice_id: string | null; amount: number; destination: "balance" | "cash";
  state: "requested" | "approved" | "paid" | "failed"; delivered: boolean; reason: string | null; approval_id: string | null; requested_at: string; paid_at: string | null;
};
export type Piutang = { role: string; receivables: ReceivableRow[]; refunds: RefundRow[]; convertible: { visit_id: string; patient: Patient; amount: number }[] };
export const piutang = (db: pg.ClientBase, branchId: string | null) =>
  call(async () => (await db.query(`select piutang_get($1) as r`, [branchId])).rows[0].r as Piutang);

export type RefundLine = { id: string; name: string; line_total: number; room: number; delivered: boolean; blocked: string | null };
export type RefundOptions = { invoice_id: string; number: string | null; state: string; patient: Patient | null; lines: RefundLine[] };
export const refundOptions = (db: pg.ClientBase, invoiceId: string) =>
  call(async () => (await db.query(`select refund_line_options($1) as r`, [invoiceId])).rows[0].r as RefundOptions);
export type RefundPick = { id: string; number: string; total: number; patient: Patient };
export const refundPicks = (db: pg.ClientBase) => call(async () => (await db.query(`select refund_invoice_picks() as r`)).rows[0].r as RefundPick[]);

