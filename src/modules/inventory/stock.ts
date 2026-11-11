// Stok (PR-17, UX-11, CLIN-019; T-060, DEC-070). Every call runs inside withTenantContext; the database decides
// authority (writers: pharmacist and purchasing receive and set levels, pharmacist holds batches and opens vials,
// pharmacist and manager count; items by pharmacist, purchasing, admin pusat; readers tenant-wide for owner,
// admin pusat, finance, purchasing, auditor and branch-scoped for manager and pharmacist). Quantities are decimal
// strings in the item's use unit (DATA-4); command results hold ids and codes only.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { assertProductionGoLive } from "../vendor/profile/profile";
import type { BATCH_STATES, COUNT_STATES, MOVEMENT_KINDS, RECEIVE_REASONS, STOCK_STORAGE_KINDS } from "./schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);
// Domain refusals stored by runCommand (a retry with the same key gets the same answer, src/lib/command.ts).
const STORED = new Set(["ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class StockError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const asStockError = (e: unknown): StockError | null => {
  if (e instanceof StockError) return e;
  const m = CODE.exec((e as { message?: string }).message ?? "");
  return m && KNOWN.has(m[1]) ? new StockError(m[1] as ErrorCode, m[2]) : null;
};
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    throw asStockError(e) ?? e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() =>
    runCommand<T>(db, { command: name, key, body }, async (c) => {
      try {
        return ((await c.query(sql, args)).rows[0]?.r ?? null) as T;
      } catch (e) {
        const se = asStockError(e);
        if (se && STORED.has(se.code)) throw se; // stored refusal
        throw e;
      }
    }),
  );
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type Storage = (typeof STOCK_STORAGE_KINDS)[number];
export type BatchState = (typeof BATCH_STATES)[number];
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export type ReceiveReason = (typeof RECEIVE_REASONS)[number];
export type CountState = (typeof COUNT_STATES)[number];
// A quantity as a decimal string (≤ 4 decimals), e.g. "12.5".
export type Qty = string;
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const qty = (q: Qty) => {
  if (!QTY.test(q)) throw new StockError("ERR_INVALID_INPUT", "quantity");
  return q;
};

export type ItemInput = {
  catalogItemId?: string; unit: string; vialSize?: Qty | null; openedUseHours?: number | null; storage: Storage;
  registrationNo?: string | null; highValue: boolean; active: boolean;
};
export async function saveItem(db: pg.ClientBase, key: string, itemId: string | null, i: ItemInput) {
  const p: Record<string, Json> = { unit: i.unit, storage: i.storage, high_value: i.highValue, active: i.active,
    vial_size: i.vialSize ? qty(i.vialSize) : null, opened_use_hours: i.openedUseHours ?? null, registration_no: i.registrationNo ?? null };
  if (itemId === null) p.catalog_item_id = i.catalogItemId ?? null;
  const out = await command<string>(db, "stock_item_save", key, { item_id: itemId, item: p }, `select stock_item_save($1, $2::jsonb) as r`, [itemId, JSON.stringify(p)]);
  return { itemId: out.result, replayed: out.replayed };
}

export type ReceiveInput = { itemId: string; batchNo: string; expiry: string; quantity: Qty; reason: ReceiveReason };
export async function receiveStock(db: pg.ClientBase, key: string, branchId: string | null, r: ReceiveInput) {
  const p = { item_id: r.itemId, batch_no: r.batchNo, expiry: r.expiry, quantity: qty(r.quantity), reason: r.reason };
  const out = await command<string>(db, "stock_receive", key, { branch_id: branchId, receipt: p }, `select stock_receive($1, $2::jsonb) as r`, [branchId, JSON.stringify(p)]);
  return { batchId: out.result, replayed: out.replayed };
}

export async function holdBatch(db: pg.ClientBase, key: string, batchId: string, state: BatchState, reason: string | null) {
  const out = await command(db, "stock_batch_hold", key, { batch_id: batchId, state, reason }, `select stock_batch_hold($1, $2, $3) as r`, [batchId, state, reason]);
  return { replayed: out.replayed };
}

export async function openVial(db: pg.ClientBase, key: string, batchId: string) {
  const out = await command<string>(db, "stock_vial_open", key, { batch_id: batchId }, `select stock_vial_open($1) as r`, [batchId]);
  return { vialId: out.result, replayed: out.replayed };
}

export async function setLevel(db: pg.ClientBase, key: string, branchId: string | null, itemId: string, min: Qty, target: Qty) {
  const out = await command(db, "stock_level_set", key, { branch_id: branchId, item_id: itemId, min: qty(min), target: qty(target) },
    `select stock_level_set($1, $2, $3::numeric, $4::numeric) as r`, [branchId, itemId, min, target]);
  return { replayed: out.replayed };
}

export async function startCount(db: pg.ClientBase, key: string, blind: boolean, itemIds: string[]) {
  const out = await command<string>(db, "stock_count_start", key, { blind, items: itemIds }, `select stock_count_start($1, $2::uuid[]) as r`, [blind, itemIds]);
  return { countId: out.result, replayed: out.replayed };
}
export async function recordCount(db: pg.ClientBase, key: string, countId: string, lineId: string, counted: Qty) {
  const out = await command(db, "stock_count_record", key, { count_id: countId, line_id: lineId, counted: qty(counted) },
    `select stock_count_record($1, $2, $3::numeric) as r`, [countId, lineId, counted]);
  return { replayed: out.replayed };
}
export async function submitCount(db: pg.ClientBase, key: string, countId: string, reason: string) {
  const out = await command<"applied" | "pending_approval">(db, "stock_count_submit", key, { count_id: countId, reason },
    `select stock_count_submit($1, $2) as r`, [countId, reason]);
  return { state: out.result, replayed: out.replayed };
}
export async function cancelCount(db: pg.ClientBase, key: string, countId: string) {
  const out = await command(db, "stock_count_cancel", key, { count_id: countId }, `select stock_count_cancel($1) as r`, [countId]);
  return { replayed: out.replayed };
}

// ── Readers (jsonb: quantities arrive as numbers) ──────────────────────────────────────────────────────────────────────────────────────────
export type StockContext = {
  role: string; active_branch_id: string | null; branches: { id: string; name: string }[]; can_edit_items: boolean; can_receive: boolean;
  can_hold: boolean; can_open_vial: boolean; can_set_levels: boolean; can_count: boolean; near_expiry_days: number;
};
export type ItemRow = {
  id: string; code: string; name: string; kind: "material" | "product"; unit: string; vial_size: number | null; opened_use_hours: number | null;
  storage: Storage; high_value: boolean; active: boolean; quantity: number; fit_quantity: number; near_expiry: number; unfit: number;
  min_qty: number | null; target_qty: number | null; low: boolean;
};
export type BatchRow = {
  id: string; batch_no: string; expiry: string; quantity: number; state: BatchState; hold_reason: string | null; received_at: string;
  unfit: "expired" | "recalled" | "quarantined" | null; fit_quantity: number;
  vial: { id: string; remaining: number; opened_at: string; use_by: string; lapsed: boolean } | null;
};
export type ItemDetail = Omit<ItemRow, "quantity" | "fit_quantity" | "near_expiry" | "unfit" | "min_qty" | "target_qty" | "low"> & {
  catalog_item_id: string; registration_no: string | null; branch_id: string; next_batch_id: string | null;
  level: { min_qty: number; target_qty: number } | null; batches: BatchRow[];
};
export type CardRow = {
  id: string; kind: MovementKind; quantity: number; balance_after: number; created_at: string; created_as: string; batch_id: string; batch_no: string;
  expiry: string; created_by_name: string | null; reason: string | null; source_kind: string; source_id: string | null;
};
export type Watch = {
  near_expiry_days: number; today: string;
  batches: { id: string; item_id: string; name: string; unit: string; batch_no: string; expiry: string; quantity: number; state: BatchState;
    hold_reason: string | null; unfit: BatchRow["unfit"]; days_left: number }[];
  vials: { id: string; batch_id: string; item_id: string; name: string; unit: string; batch_no: string; remaining: number; opened_at: string; use_by: string; lapsed: boolean }[];
};
export type CountRow = {
  id: string; state: CountState; blind: boolean; started_at: string; started_as: string; started_by_name: string | null; lines: number; counted: number;
  exceeds: boolean | null; approval_id: string | null; submitted_at: string | null; closed_at: string | null;
};
export type CountDetail = {
  id: string; branch_id: string; state: CountState; blind: boolean; reason: string | null; threshold_pct: number | null; exceeds: boolean | null;
  approval_id: string | null; started_at: string; started_as: string; submitted_at: string | null; closed_at: string | null; can_count: boolean; can_cancel: boolean;
  lines: { id: string; item_id: string; name: string; unit: string; batch_id: string; batch_no: string; expiry: string; system_qty: number | null;
    counted_qty: number | null; difference: number | null }[];
};
export type ItemOption = { catalog_item_id: string; code: string; kind: "material" | "product"; name: string };

const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const stockContext = (db: pg.ClientBase) => read<StockContext>(db, `select stock_context() as r`, []);
export const listItems = (db: pg.ClientBase, branchId: string | null) => read<ItemRow[]>(db, `select stock_item_list($1) as r`, [branchId]);
export const getItem = (db: pg.ClientBase, itemId: string, branchId: string | null) => read<ItemDetail>(db, `select stock_item_get($1, $2) as r`, [itemId, branchId]);
export const stockCard = (db: pg.ClientBase, itemId: string, branchId: string | null, limit = 100) =>
  read<CardRow[]>(db, `select stock_card($1, $2, $3) as r`, [itemId, branchId, limit]);
export const batchWatch = (db: pg.ClientBase, branchId: string | null) => read<Watch>(db, `select stock_batch_watch($1) as r`, [branchId]);
export const listCounts = (db: pg.ClientBase, branchId: string | null) => read<CountRow[]>(db, `select stock_count_list($1) as r`, [branchId]);
export const getCount = (db: pg.ClientBase, countId: string) => read<CountDetail>(db, `select stock_count_get($1) as r`, [countId]);
export const itemOptions = (db: pg.ClientBase) => read<ItemOption[]>(db, `select stock_item_options() as r`, []);
