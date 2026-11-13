// DP booking (PR-22, BILL-13, B-05; T-077, migration 0093, DEC-089). Server code over the deposit definers; every call runs
// inside withTenantContext and the database decides authority, the branch, the cutoff and the money moves. A deposit is taken
// at the Kasir (KW receipt, payment with no invoice), then decided once: applied on arrival (automatically at invoice issue, or
// explicitly), moved to balance or forfeited by the patient's change (appointment cancel, reschedule, no-show), moved to balance
// by a clinic cancellation, or refunded for a clinic cause (scenario 17).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class DepositError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_NOT_AVAILABLE",
  "ERR_GATE_CLOSED",
]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new DepositError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type DepositTender = { method: "cash" | "edc" | "transfer"; cashTendered?: number; details?: Record<string, string> };
export async function receiveDeposit(db: pg.ClientBase, key: string, appointmentId: string, t: DepositTender) {
  const p: Record<string, Json> = { method: t.method };
  if (t.cashTendered !== undefined) p.cash_tendered = t.cashTendered;
  if (t.details) p.details = t.details;
  const out = await command<{ deposit_id: string; receipt_id: string; number: string; amount: number; change: number }>(db, "deposit_receive", key,
    { appointment_id: appointmentId, deposit: p }, `select deposit_receive($1, $2, $3::jsonb) as r`, [key, appointmentId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}
export async function applyDeposit(db: pg.ClientBase, key: string, invoiceId: string) {
  const out = await command<{ deposit_id: string; invoice_line_id: string }>(db, "deposit_apply", key, { invoice_id: invoiceId },
    `select deposit_apply($1) as r`, [invoiceId]);
  return out.result;
}
export async function cancelAppointmentByClinic(db: pg.ClientBase, key: string, appointmentId: string, reason: string) {
  await command(db, "appointment_cancel_clinic", key, { appointment_id: appointmentId, reason }, `select appointment_cancel_clinic($1, $2) as r`, [appointmentId, reason]);
}
export type DepositRefund = { method: "cash" | "edc" | "transfer"; reason: string; details?: { bank?: string; reference?: string } };
export async function refundDepositForClinic(db: pg.ClientBase, key: string, depositId: string, r: DepositRefund) {
  const p: Record<string, Json> = { method: r.method, reason: r.reason };
  if (r.details) p.details = r.details;
  const out = await command<{ deposit_id: string; state: string }>(db, "deposit_refund_clinic", key, { deposit_id: depositId, refund: p },
    `select deposit_refund_clinic($1, $2, $3::jsonb) as r`, [key, depositId, JSON.stringify(p)]);
  return { deposit_id: out.result.deposit_id, state: out.result.state, replayed: out.replayed };
}
