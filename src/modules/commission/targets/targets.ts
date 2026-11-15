// Target BC & scorecard staf (PR-47, D-07, K19, K15, SET-25; T-088, migration 0103, DEC-100). Server code over the target definers. The
// owner sets a BC's target per period (bulanan `YYYY-MM` or triwulan `YYYY-Qn`, Asia/Jakarta; a new value supersedes the active one). The
// closing value is computed from the settlement facts of the sales the BC closed (net of VAT, less refunds and moves in the period), not
// from commission rows, so a BC has an attainment with no commission rule. Readers: the eight own-target roles read their own (Target
// Saya); the owner and a manager (its branch) list the staff with their scorecard. The pages are a recorded follow-up (no UI here).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class TargetError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new TargetError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export type Scorecard = { completed_services: number; executed_minutes: number; rostered_minutes: number; utilization_bps: number | null;
  commission_gross: number; commission_adjustments: number; commission_net: number };
export type TargetRow = { staff_id: string; staff: string; is_bc: boolean;
  target: { id: string; closing_value_target: number; plans_target: number | null; set_at: string } | null;
  closing_value_actual: number; branch_closing_value: number | null; plans_actual: number; attainment_bps: number | null; scorecard: Scorecard };
export type MyTarget = TargetRow & { period: string; period_kind: "bulanan" | "triwulan"; period_start: string; period_end: string };
export type TargetList = { role: string; period: string; period_kind: "bulanan" | "triwulan"; branch_id: string | null; can_set: boolean; rows: TargetRow[] };

// Set a BC's target (owner). period: `YYYY-MM` or `YYYY-Qn`.
export async function setStaffTarget(db: pg.ClientBase, key: string, staffId: string, period: string, t: { closingValueTarget: number; plansTarget?: number | null }) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { closing_value_target: t.closingValueTarget };
  if (t.plansTarget !== undefined) p.plans_target = t.plansTarget;
  const out = await call(() => runCommand<string>(db, { command: "staff_target_set", key, body: { staff_id: staffId, period, target: p } },
    async (c) => ((await c.query(`select staff_target_set($1, $2, $3, $4::jsonb) as r`, [key, staffId, period, JSON.stringify(p)])).rows[0]?.r ?? null) as string));
  if (!out.ok) throw out.error;
  return { targetId: out.result, replayed: out.replayed };
}
// Target Saya: the acting staff member's own target, attainment and scorecard (the period defaults to SET-25's current one).
export const myTarget = (db: pg.ClientBase, period?: string | null) =>
  call(async () => (await db.query(`select target_mine($1) as r`, [period ?? null])).rows[0].r as MyTarget);
// Target & Scorecard Staf: the owner (tenant-wide or a branch) and a manager (its branch).
export const listTargets = (db: pg.ClientBase, o: { period?: string | null; branchId?: string | null } = {}) =>
  call(async () => (await db.query(`select target_list($1, $2) as r`, [o.period ?? null, o.branchId ?? null])).rows[0].r as TargetList);
