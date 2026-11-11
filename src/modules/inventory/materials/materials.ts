// Material lifecycle: request → issue → consume / return / waste, no double deduction (PR-16, CLIN-008, DATA-25;
// T-062, DEC-072). Every call runs inside withTenantContext; the database decides authority (request: doctor, nurse,
// therapist, pharmacist; issue and return decision: pharmacist; consume, waste, return proposal: doctor, nurse,
// therapist; all at the active branch). Quantities are decimal strings in the item's use unit; command results hold
// ids only. Each command's key is also its header row's key.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { MATERIAL_CLASSES, MATERIAL_REQUEST_STATES, RETURN_CONDITIONS, RETURN_STATES } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);
// Domain refusals stored by runCommand: a replay of the same key gets the same refusal without running.
const STORED = new Set(["ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class MaterialError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const asError = (e: unknown): MaterialError | null => {
  if (e instanceof MaterialError) return e;
  const m = CODE.exec((e as { message?: string }).message ?? "");
  return m && KNOWN.has(m[1]) ? new MaterialError(m[1] as ErrorCode, m[2]) : null;
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

export type MaterialClass = (typeof MATERIAL_CLASSES)[number];
export type RequestState = (typeof MATERIAL_REQUEST_STATES)[number];
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];
export type ReturnState = (typeof RETURN_STATES)[number];
export type Qty = string;
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const qty = (q: Qty) => {
  if (!QTY.test(q)) throw new MaterialError("ERR_INVALID_INPUT", "quantity");
  return q;
};
// A line of a consume/return/waste: the item of the request, the quantity, optionally the batch (precise lines).
export type UseLine = { itemId: string; quantity: Qty; batchId?: string | null };
const toUseLines = (ls: UseLine[]) => ls.map((l) => ({ item_id: l.itemId, quantity: qty(l.quantity), batch_id: l.batchId ?? null }));

export async function setItemClass(db: pg.ClientBase, key: string, itemId: string, cls: MaterialClass) {
  const out = await command(db, "stock_item_class_set", key, { item_id: itemId, class: cls }, `select stock_item_class_set($1, $2) as r`, [itemId, cls]);
  return { replayed: out.replayed };
}

// A request moves no stock (PR-16: selection never changes stock).
export async function requestMaterials(db: pg.ClientBase, key: string, r: { visitId: string; roomDepotId: string; planItemId?: string | null; lines: { itemId: string; quantity: Qty }[] }) {
  const p = { visit_id: r.visitId, room_depot_id: r.roomDepotId, plan_item_id: r.planItemId ?? null, lines: r.lines.map((l) => ({ item_id: l.itemId, quantity: qty(l.quantity) })) };
  const out = await command<string>(db, "material_request_create", key, p, `select material_request_create($1, $2::jsonb) as r`, [key, JSON.stringify(p)]);
  return { requestId: out.result, replayed: out.replayed };
}
export async function cancelRequest(db: pg.ClientBase, key: string, requestId: string) {
  const out = await command(db, "material_request_cancel", key, { request_id: requestId }, `select material_request_cancel($1) as r`, [requestId]);
  return { replayed: out.replayed };
}
// One issue per request: FEFO in the source depot, into the request's room depot. lines: issued quantities (default:
// the requested).
export async function issueMaterials(db: pg.ClientBase, key: string, requestId: string, i: { fromDepotId: string; lines?: { itemId: string; quantity: Qty }[] }) {
  const p: Record<string, Json> = { from_depot_id: i.fromDepotId };
  if (i.lines) p.lines = i.lines.map((l) => ({ item_id: l.itemId, quantity: qty(l.quantity) }));
  const out = await command<string>(db, "material_issue", key, { request_id: requestId, issue: p }, `select material_issue($1, $2, $3::jsonb) as r`, [key, requestId, JSON.stringify(p)]);
  return { issueId: out.result, replayed: out.replayed };
}
// CLIN-008: one consumption per request; lines are deviations only (a line left out uses what is still issued).
export async function consumeMaterials(db: pg.ClientBase, key: string, requestId: string, lines?: UseLine[]) {
  const p: Record<string, Json> = lines ? { lines: toUseLines(lines) } : {};
  const out = await command<string>(db, "material_consume", key, { request_id: requestId, consumption: p }, `select material_consume($1, $2, $3::jsonb) as r`, [key, requestId, JSON.stringify(p)]);
  return { consumptionId: out.result, replayed: out.replayed };
}
export async function proposeReturn(db: pg.ClientBase, key: string, requestId: string, r: { condition: ReturnCondition; lines: UseLine[] }) {
  const p = { condition: r.condition, lines: toUseLines(r.lines) };
  const out = await command<string>(db, "material_return_propose", key, { request_id: requestId, return: p }, `select material_return_propose($1, $2, $3::jsonb) as r`, [key, requestId, JSON.stringify(p)]);
  return { returnId: out.result, replayed: out.replayed };
}
export async function decideReturn(db: pg.ClientBase, key: string, returnId: string, outcome: "usable" | "waste", toDepotId: string | null) {
  const out = await command(db, "material_return_decide", key, { return_id: returnId, outcome, to_depot_id: toDepotId },
    `select material_return_decide($1, $2, $3) as r`, [returnId, outcome, toDepotId]);
  return { replayed: out.replayed };
}
export async function wasteMaterials(db: pg.ClientBase, key: string, requestId: string, w: { reason: string; lines: UseLine[] }) {
  const p = { reason: w.reason, lines: toUseLines(w.lines) };
  const out = await command<string>(db, "material_waste", key, { request_id: requestId, waste: p }, `select material_waste($1, $2, $3::jsonb) as r`, [key, requestId, JSON.stringify(p)]);
  return { wasteId: out.result, replayed: out.replayed };
}

// ── Readers (jsonb: quantities arrive as numbers) ──────────────────────────────────────────────────────
export type BatchLedger = { batch_id: string; batch_no: string; expiry: string; issued: number; consumed: number; returned: number; wasted: number; pending: number; free: number };
export type MaterialRequest = {
  id: string; branch_id: string; visit_id: string; plan_item_id: string | null; room_depot_id: string; room_depot: string; state: RequestState;
  requested_at: string; requested_as: string; requested_by_name: string | null; closed_at: string | null; issued_at: string | null; consumed_at: string | null;
  lines: { id: string; item_id: string; name: string; unit: string; class: MaterialClass; requested: number; consumed_estimate: number | null; batches: BatchLedger[] }[];
  returns: { id: string; condition: ReturnCondition; state: ReturnState; to_depot_id: string | null; proposed_at: string; decided_at: string | null }[];
};
export type IssueQueue = {
  to_issue: MaterialRequest[];
  returns: { id: string; request_id: string; condition: ReturnCondition; proposed_at: string; lines: { item_id: string; batch_id: string; quantity: number }[] }[];
};
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const getRequest = (db: pg.ClientBase, requestId: string) => read<MaterialRequest>(db, `select material_request_get($1) as r`, [requestId]);
export const requestsForVisit = (db: pg.ClientBase, visitId: string) => read<MaterialRequest[]>(db, `select material_requests_for_visit($1) as r`, [visitId]);
export const issueQueue = (db: pg.ClientBase) => read<IssueQueue>(db, `select material_issue_queue() as r`, []);
