// Tutup Kasir (UX-15, PR-19, BILL-18; T-085, migration 0101, DEC-098). Server code over the shift definers; the database decides
// authority (owner, manager, FO/cashier, finance write; the auditor reads masked), the branch, the expectation and the variance
// routing (any non-zero cash variance waits for a manager or the owner; above SET-13 only the owner). Payments are stamped with the
// receiver's open shift by a trigger (a counter payment auto-opens one with an Rp0 float), so no payment writer changes here.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class ShiftError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new ShiftError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export const SHIFT_STATES = ["open", "pending_approval", "recount", "closed"] as const;
export type ShiftState = (typeof SHIFT_STATES)[number];

// Buka Kasir: a branch role at its active branch; owner/finance name one.
export async function openShift(db: pg.ClientBase, key: string, o: { branchId?: string | null; openingFloat: number }) {
  if (!Number.isSafeInteger(o.openingFloat) || o.openingFloat < 0) throw new ShiftError("ERR_INVALID_INPUT", "opening_float");
  const p = { opening_float: o.openingFloat };
  const out = await command<string>(db, "cash_shift_open", key, { branch_id: o.branchId ?? null, shift: p }, `select cash_shift_open($1, $2, $3::jsonb) as r`,
    [key, o.branchId ?? null, JSON.stringify(p)]);
  return { shiftId: out.result, replayed: out.replayed };
}
// Tutup Kasir / Hitung Ulang: the counted cash; the reason when it differs from the expectation.
export async function submitShiftCount(db: pg.ClientBase, key: string, shiftId: string, c: { countedCash: number; reason?: string | null }) {
  if (!Number.isSafeInteger(c.countedCash) || c.countedCash < 0) throw new ShiftError("ERR_INVALID_INPUT", "counted_cash");
  const p: Record<string, Json> = { counted_cash: c.countedCash };
  if (c.reason) p.reason = c.reason;
  const out = await command<string>(db, "cash_shift_submit", key, { shift_id: shiftId, count: p }, `select cash_shift_submit($1, $2, $3::jsonb) as r`,
    [key, shiftId, JSON.stringify(p)]);
  return { countId: out.result, replayed: out.replayed };
}

export type ShiftRow = {
  id: string; branch: { id: string; name: string }; cashier: { id: string; name: string }; state: ShiftState; auto_opened: boolean;
  opening_float: number; opened_at: string; closed_at: string | null; settled_at: string | null; escalated: boolean | null;
};
export type ShiftList = { role: string; branch_id: string | null; staff_id: string; can_open: boolean; branches: { id: string; name: string }[]; rows: ShiftRow[] };
export type TenderLine = { method: string; payments: number; received: number; paid_out: number; expected: number; counted?: number | null };
export type ShiftCount = {
  id: string; seq: number; counted_cash: number; expected_cash: number; variance: number; threshold: number; escalated: boolean; reason: string | null;
  counted_at: string; counted_as: string; counted_by: string;
  approval: { id: string; state: "pending" | "approved" | "rejected" | "cancelled"; decided_as: string | null; decided_by: string | null; decision_reason: string | null } | null;
};
export type ShiftDetail = {
  role: string; staff_id: string; can_count: boolean; manager_decides: boolean; threshold: number;
  shift: Omit<ShiftRow, "escalated">; expected: TenderLine[]; counts: ShiftCount[];
  payments: { id: string; method: string; amount: number; received_at: string; receipt_id: string; invoice_id: string | null; reference: string | null;
    patient: { id: string; name: string | null; mrn: string } | null }[];
  k23: { received: number; sales: number }; open_tagihan: { count: number; total: number };
};
export const listShifts = (db: pg.ClientBase, o: { branchId?: string | null; state?: ShiftState | null } = {}) =>
  call(async () => (await db.query(`select cash_shift_list($1, $2) as r`, [o.branchId ?? null, o.state ?? null])).rows[0].r as ShiftList);
export const getShift = (db: pg.ClientBase, shiftId: string) =>
  call(async () => (await db.query(`select cash_shift_get($1) as r`, [shiftId])).rows[0].r as ShiftDetail);
export const myShift = (db: pg.ClientBase, branchId: string | null = null) =>
  call(async () => (await db.query(`select cash_shift_mine($1) as r`, [branchId])).rows[0].r as { id: string; state: ShiftState; opened_at: string; opening_float: number; auto_opened: boolean } | null);
