// Depots, batch holdings and linked transfers (PR-89, PR-17, DATA-63; T-061, DEC-071). Every call runs inside
// withTenantContext; the database decides authority (depots: pharmacist at its branch, purchasing and admin pusat
// naming one; transfers: pharmacist at the source branch or purchasing; receive at the destination branch; readers as
// Stok). Quantities are decimal strings in the item's use unit; command results hold ids and codes only.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { DEPOT_KINDS, TRANSFER_KINDS, TRANSFER_STATES } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);
// Domain refusals stored by runCommand: a replay of the same key gets the same refusal without running.
const STORED = new Set(["ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class DepotError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const asError = (e: unknown): DepotError | null => {
  if (e instanceof DepotError) return e;
  const m = CODE.exec((e as { message?: string }).message ?? "");
  return m && KNOWN.has(m[1]) ? new DepotError(m[1] as ErrorCode, m[2]) : null;
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

export type DepotKind = (typeof DEPOT_KINDS)[number];
export type TransferKind = (typeof TRANSFER_KINDS)[number];
export type TransferState = (typeof TRANSFER_STATES)[number];
export type Qty = string;
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const qty = (q: Qty) => {
  if (!QTY.test(q)) throw new DepotError("ERR_INVALID_INPUT", "quantity");
  return q;
};
export type Line = { batchId: string; quantity: Qty };
const lines = (ls: Line[]) => ls.map((l) => ({ batch_id: l.batchId, quantity: qty(l.quantity) }));

export async function createDepot(db: pg.ClientBase, key: string, d: { branchId: string | null; name: string; kind: DepotKind; roomId?: string | null }) {
  const p = { branch_id: d.branchId, name: d.name, kind: d.kind, room_id: d.roomId ?? null };
  const out = await command<string>(db, "depot_save", key, { depot_id: null, depot: p }, `select depot_save(null, $1::jsonb) as r`, [JSON.stringify(p)]);
  return { depotId: out.result, replayed: out.replayed };
}
export async function updateDepot(db: pg.ClientBase, key: string, depotId: string, d: { name: string; roomId?: string | null; active: boolean }) {
  const p = { name: d.name, room_id: d.roomId ?? null, active: d.active };
  const out = await command<string>(db, "depot_save", key, { depot_id: depotId, depot: p }, `select depot_save($1, $2::jsonb) as r`, [depotId, JSON.stringify(p)]);
  return { replayed: out.replayed };
}

// PR-89: one record, two linked legs per line, posted at once. The command key is also the transfer's key.
export async function transferBetweenDepots(db: pg.ClientBase, key: string, t: { fromDepotId: string; toDepotId: string; lines: Line[] }) {
  const p = { from_depot_id: t.fromDepotId, to_depot_id: t.toDepotId, lines: lines(t.lines) };
  const out = await command<string>(db, "depot_transfer", key, p, `select depot_transfer($1, $2::jsonb) as r`, [key, JSON.stringify(p)]);
  return { transferId: out.result, replayed: out.replayed };
}
// PR-17: send (out legs), then receive at the destination (in legs on the batch of the same number) or cancel.
export async function sendToBranch(db: pg.ClientBase, key: string, t: { fromDepotId: string; toBranchId: string; lines: Line[] }) {
  const p = { from_depot_id: t.fromDepotId, to_branch_id: t.toBranchId, lines: lines(t.lines) };
  const out = await command<string>(db, "branch_transfer_send", key, p, `select branch_transfer_send($1, $2::jsonb) as r`, [key, JSON.stringify(p)]);
  return { transferId: out.result, replayed: out.replayed };
}
export async function receiveTransfer(db: pg.ClientBase, key: string, transferId: string, depotId: string | null) {
  const out = await command(db, "branch_transfer_receive", key, { transfer_id: transferId, depot_id: depotId },
    `select branch_transfer_receive($1, $2) as r`, [transferId, depotId]);
  return { replayed: out.replayed };
}
export async function cancelTransfer(db: pg.ClientBase, key: string, transferId: string) {
  const out = await command(db, "branch_transfer_cancel", key, { transfer_id: transferId }, `select branch_transfer_cancel($1) as r`, [transferId]);
  return { replayed: out.replayed };
}
export async function openVialIn(db: pg.ClientBase, key: string, batchId: string, depotId: string) {
  const out = await command<string>(db, "stock_vial_open_in", key, { batch_id: batchId, depot_id: depotId }, `select stock_vial_open_in($1, $2) as r`, [batchId, depotId]);
  return { vialId: out.result, replayed: out.replayed };
}
export async function startDepotCount(db: pg.ClientBase, key: string, blind: boolean, itemIds: string[], depotId: string) {
  const out = await command<string>(db, "stock_count_start_in", key, { blind, items: itemIds, depot_id: depotId },
    `select stock_count_start_in($1, $2::uuid[], $3) as r`, [blind, itemIds, depotId]);
  return { countId: out.result, replayed: out.replayed };
}

// ── Readers (jsonb: quantities arrive as numbers) ──────────────────────────────────────────────────────
export type DepotRow = { id: string; name: string; kind: DepotKind; room_id: string | null; is_default: boolean; active: boolean; batches: number; open_vials: number };
export type DepotDetail = Omit<DepotRow, "batches" | "open_vials"> & {
  branch_id: string;
  holdings: { item_id: string; name: string; unit: string; batch_id: string; batch_no: string; expiry: string; quantity: number; unfit: string | null;
    vial: { id: string; remaining: number; use_by: string; lapsed: boolean } | null }[];
};
export type TransferRow = {
  id: string; kind: TransferKind; state: TransferState; from_branch_id: string; to_branch_id: string; from_depot_id: string; to_depot_id: string | null;
  from_branch: string; to_branch: string; from_depot: string; to_depot: string | null; created_at: string; created_as: string; created_by_name: string | null;
  closed_at: string | null; closed_as: string | null;
  lines: { id: string; item_id: string; name: string; unit: string; source_batch_id: string; destination_batch_id: string | null; batch_no: string; expiry: string; quantity: number }[];
};
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const listDepots = (db: pg.ClientBase, branchId: string | null) => read<DepotRow[]>(db, `select depot_list($1) as r`, [branchId]);
export const getDepot = (db: pg.ClientBase, depotId: string) => read<DepotDetail>(db, `select depot_get($1) as r`, [depotId]);
export const listTransfers = (db: pg.ClientBase, branchId: string | null, state: TransferState | null = null) =>
  read<TransferRow[]>(db, `select transfer_list($1, $2) as r`, [branchId, state]);
export const getTransfer = (db: pg.ClientBase, transferId: string) => read<TransferRow>(db, `select transfer_get($1) as r`, [transferId]);
