// Moving average cost per item per branch (PR-46, A-13, BILL-26, BILL-35; T-063, DEC-073). Values are written by
// the database on every stock movement (trigger stock_movements_value); this module adds the costed receipt and the
// readers. Money in integer rupiah (number); quantities are decimal strings in the item's use unit.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { ReceiveInput } from "../stock";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);
// Domain refusals stored by runCommand: a replay of the same key gets the same refusal without running.
const STORED = new Set(["ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class CostError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const asError = (e: unknown): CostError | null => {
  if (e instanceof CostError) return e;
  const m = CODE.exec((e as { message?: string }).message ?? "");
  return m && KNOWN.has(m[1]) ? new CostError(m[1] as ErrorCode, m[2]) : null;
};
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    throw asError(e) ?? e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() =>
    runCommand<T>(db, { command: name, key, body }, async (c) => {
      try {
        return ((await c.query(sql, args)).rows[0]?.r ?? null) as T;
      } catch (e) {
        const de = asError(e);
        if (de && STORED.has(de.code)) throw de;
        throw e;
      }
    }),
  );
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

const QTY = /^\d{1,10}(\.\d{1,4})?$/;

// A receipt with its unit cost (integer rupiah per use unit); the rest as stock_receive.
export async function receiveCosted(db: pg.ClientBase, key: string, branchId: string | null, r: ReceiveInput & { unitCost: number }) {
  if (!QTY.test(r.quantity)) throw new CostError("ERR_INVALID_INPUT", "quantity");
  if (!Number.isSafeInteger(r.unitCost) || r.unitCost < 0 || r.unitCost > 1_000_000_000) throw new CostError("ERR_INVALID_INPUT", "unit cost");
  const p = { item_id: r.itemId, batch_no: r.batchNo, expiry: r.expiry, quantity: r.quantity, reason: r.reason, unit_cost: r.unitCost };
  const out = await command<string>(db, "stock_receive_costed", key, { branch_id: branchId, receipt: p }, `select stock_receive_costed($1, $2::jsonb) as r`, [branchId, JSON.stringify(p)]);
  return { batchId: out.result, replayed: out.replayed };
}

// ── Readers (jsonb: numbers) ──────────────────────────────────────────────────────────────────────────
export type CostRow = { item_id: string; code: string; name: string; unit: string; quantity: number; value: number; average: number | null;
  last_unit_cost: number | null; uncosted_quantity: number };
export type CostList = { branch_id: string; total_value: number; items: CostRow[] };
export type ValueRow = { movement_id: string; kind: string; leg: "out" | "in" | null; created_at: string; quantity: number; value: number;
  uncosted_quantity: number; unit_cost: number | null; quantity_after: number; value_after: number; uncosted_after: number };
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const listCosts = (db: pg.ClientBase, branchId: string | null) => read<CostList>(db, `select stock_cost_list($1) as r`, [branchId]);
export const listValues = (db: pg.ClientBase, itemId: string, branchId: string | null, limit = 100) =>
  read<ValueRow[]>(db, `select stock_movement_value_list($1, $2, $3) as r`, [itemId, branchId, limit]);
