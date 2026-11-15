// CRM follow-ups (PR-30; T-093, migration 0108, DEC-105). Tasks come from decided rules — the daily scan (scan.ts) and the no-show trigger
// — never from TypeScript. Staff close them (done with an outcome, dismissed with a note), snooze them (Tunda) or take them; the definers
// decide who reads what (BC its own queue, marketing dormant only and identity only with consent, the auditor masked). Titles come from rule
// codes only: no plan item, service or condition names (W-10).
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { FOLLOWUP_DONE_OUTCOMES, FOLLOWUP_QUEUES, FOLLOWUP_RULES, FOLLOWUP_SOURCES, FOLLOWUP_STATES } from "../schema";

export type FollowupRule = (typeof FOLLOWUP_RULES)[number];
export type FollowupSource = (typeof FOLLOWUP_SOURCES)[number];
export type FollowupState = (typeof FOLLOWUP_STATES)[number];
export type FollowupQueue = (typeof FOLLOWUP_QUEUES)[number];
export type DoneOutcome = (typeof FOLLOWUP_DONE_OUTCOMES)[number];

export class FollowupError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new FollowupError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

export type FollowupUpdate =
  | { action: "done"; outcome: DoneOutcome; note?: string }
  | { action: "dismiss"; note: string }
  | { action: "snooze"; dueOn: string }
  | { action: "assign"; staffId: string }
  | { action: "unassign" };
// Keyed (runCommand + command_key): a replay answers the first result; the fingerprint carries a digest of the note, never the note.
export async function updateFollowup(db: pg.ClientBase, key: string, followupId: string, u: FollowupUpdate) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { action: u.action };
  if (u.action === "done") {
    p.outcome = u.outcome;
    if (u.note?.trim()) p.note = u.note.trim();
  }
  if (u.action === "dismiss") p.note = u.note.trim();
  if (u.action === "snooze") p.due_on = u.dueOn;
  if (u.action === "assign") p.staff_id = u.staffId;
  const body: Record<string, Json> = { followup_id: followupId, ...p, note: typeof p.note === "string" ? digest(p.note) : null };
  const out = await call(() => runCommand<string>(db, { command: "followup_update", key, body },
    async (c) => (await c.query(`select followup_update($1, $2::jsonb) r`, [followupId, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { state: out.result as FollowupState, replayed: out.replayed };
}

export type FollowupRow = {
  id: string; branch_id: string; branch_name: string | null; rule_code: FollowupRule; source_kind: FollowupSource; source_id: string | null;
  step: string; role_queue: FollowupQueue; assignee_staff_id: string | null; assignee_name: string | null; patient_id: string | null;
  patient_name: string | null; patient_mrn: string | null; consent_masked: boolean; promo_blocked: boolean; original_due_on: string;
  due_on: string; snooze_count: number; due_today: boolean; overdue: boolean; state: FollowupState; outcome: string | null;
  outcome_note: string | null; closed_at: string | null; created_at: string;
};
export type FollowupFilter = "all" | "open" | "due_today" | "overdue" | "done" | "dismissed";
export type FollowupScope = "all" | "mine" | "unassigned";
export type FollowupList = { role: string; can_write: boolean; now: string; followups: FollowupRow[] };
export const followupList = (db: pg.ClientBase, filter: FollowupFilter = "open", scope: FollowupScope = "all", rule?: FollowupRule) =>
  call(async () => (await db.query(`select followup_list($1, $2, $3) r`, [filter, scope, rule ?? null])).rows[0].r as FollowupList);
export const followupGet = (db: pg.ClientBase, followupId: string) =>
  call(async () => (await db.query(`select followup_get($1) r`, [followupId])).rows[0].r as { role: string; can_write: boolean; followup: FollowupRow });
