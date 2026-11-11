// Ruang Tindakan (PR-14, PR-11, UX-9; T-064, DEC-074). Every call runs inside withTenantContext; the database decides
// authority (doctor, nurse, therapist at the active branch; the start gate is treatment_start_check plus payment).
// Commands go through runCommand with the caller's key (production needs the go-live gate first); database errors are
// mapped outside it (a refusal rolls the attempt back whole). Results hold ids only; readers return names and the
// treatment names, no clinical text.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import type { MaterialRequest } from "../inventory/materials/materials";
import { assertProductionGoLive } from "../vendor/profile/profile";
import type { EXECUTION_OUTCOMES, EXECUTION_STAGES, EXECUTION_STATES } from "./schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_START_BLOCKED", "ERR_STOCK_UNFIT", "ERR_STOCK_INSUFFICIENT"]);

export class TreatmentError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new TreatmentError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type ExecutionState = (typeof EXECUTION_STATES)[number];
export type Stage = (typeof EXECUTION_STAGES)[number];
export type Outcome = (typeof EXECUTION_OUTCOMES)[number];
export const STAGES: readonly Stage[] = ["preparation", "anesthesia", "procedure", "recovery"];
/** The start blockers named by the database (ERR_START_BLOCKED reason, comma-separated). */
export const blockersOf = (e: unknown) => (e instanceof TreatmentError && e.code === "ERR_START_BLOCKED" ? (e.reason ?? "").split(",").filter(Boolean) : []);

export type StartInput = { planItemId: string; performerId: string; assistantId?: string | null; supervisorId?: string | null; roomId?: string | null;
  materialRequestId?: string | null; identityConfirmed: boolean };
export async function startTreatment(db: pg.ClientBase, key: string, visitId: string, s: StartInput) {
  const p = { plan_item_id: s.planItemId, performer_id: s.performerId, assistant_id: s.assistantId ?? null, supervisor_id: s.supervisorId ?? null,
    room_id: s.roomId ?? null, material_request_id: s.materialRequestId ?? null, identity_confirmed: s.identityConfirmed };
  const out = await command<string>(db, "treatment_start", key, { visit_id: visitId, start: p }, `select treatment_start($1, $2, $3::jsonb) as r`, [key, visitId, JSON.stringify(p)]);
  return { executionId: out.result, replayed: out.replayed };
}
export async function advanceStage(db: pg.ClientBase, key: string, executionId: string, stage: Stage) {
  const out = await command(db, "treatment_timer", key, { execution_id: executionId, action: "stage", stage }, `select treatment_timer($1, $2, 'stage', $3) as r`, [key, executionId, stage]);
  return { replayed: out.replayed };
}
export async function pauseTreatment(db: pg.ClientBase, key: string, executionId: string) {
  const out = await command(db, "treatment_timer", key, { execution_id: executionId, action: "pause" }, `select treatment_timer($1, $2, 'pause', null) as r`, [key, executionId]);
  return { replayed: out.replayed };
}
export async function resumeTreatment(db: pg.ClientBase, key: string, executionId: string) {
  const out = await command(db, "treatment_timer", key, { execution_id: executionId, action: "resume" }, `select treatment_timer($1, $2, 'resume', null) as r`, [key, executionId]);
  return { replayed: out.replayed };
}
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
export type MaterialLine = { itemId: string; quantity: string; batchId?: string | null };
// PR-14: the outcome; a stop needs its reason; materials are deviations per request (omitted: what is still issued).
export async function finishTreatment(db: pg.ClientBase, key: string, executionId: string, f: { outcome: Outcome; reason?: string | null; materials?: Record<string, MaterialLine[]> }) {
  const materials: Record<string, Json> = {};
  for (const [req, lines] of Object.entries(f.materials ?? {})) {
    materials[req] = lines.map((l) => {
      if (!QTY.test(l.quantity)) throw new TreatmentError("ERR_INVALID_INPUT", "quantity");
      return { item_id: l.itemId, quantity: l.quantity, batch_id: l.batchId ?? null };
    });
  }
  const p: Record<string, Json> = { outcome: f.outcome, reason: f.reason ?? null };
  if (f.materials) p.materials = materials;
  const out = await command(db, "treatment_finish", key, { execution_id: executionId, finish: p }, `select treatment_finish($1, $2, $3::jsonb) as r`, [key, executionId, JSON.stringify(p)]);
  return { replayed: out.replayed };
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────────────
export type Steps = Record<"intake" | "doctor" | "selection" | "consent" | "payment" | "preparation" | "treatment" | "dispensing", string>;
export type ExecutionBrief = { id: string; state: ExecutionState; stage: Stage; stage_started_at: string; paused_at: string | null; outcome: Outcome | null };
export type RoomVisit = { visit_id: string; checked_in_at: string; closed: boolean; patient_name: string; patient_mrn: string; blocker: string | null; steps: Steps;
  room: { id: string; name: string } | null; items: { plan_item_id: string; name: string; stage: number; execution: ExecutionBrief | null }[] };
export type RoomList = { now: string; today: string; branch_name: string; visits: RoomVisit[] };
export type Execution = ExecutionBrief & { visit_id: string; plan_item_id: string; room_id: string | null; material_request_id: string | null; performer_staff_id: string;
  assisting_staff_id: string | null; supervisor_staff_id: string | null; started_at: string; finished_at: string | null; counted: boolean | null; stop_reason: string | null };
export type TreatmentView = {
  now: string;
  visit: { id: string; closed: boolean; blocker: string | null; steps: Steps };
  patient: { id: string; name: string; mrn: string; birth_date: string };
  items: { plan_item_id: string; name: string; stage: number; qty: number; blockers: string[];
    performers: { staff_id: string; name: string; mode: "performs" | "supervised"; credential_ok: boolean }[]; execution: Execution | null }[];
  supervisors: { staff_id: string; name: string }[];
  assistants: { staff_id: string; name: string }[];
  rooms: { id: string; name: string }[];
  material_requests: MaterialRequest[];
  room_depots: { id: string; name: string; room_id: string | null }[];
  stock_items: { id: string; code: string; name: string; unit: string; class: "bulk" | "standard" | "precise" }[];
  open_vials: { batch_id: string; depot_id: string; remaining: number; use_by: string; lapsed: boolean }[];
};
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]): Promise<T> => (await call(() => db.query(sql, args))).rows[0].r as T;
export const roomList = (db: pg.ClientBase) => read<RoomList>(db, `select treatment_room_list() as r`, []);
export const getTreatment = (db: pg.ClientBase, visitId: string) => read<TreatmentView>(db, `select treatment_get($1) as r`, [visitId]);
