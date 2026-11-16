// CRM automation scenarios (PR-94, UX-55; T-097, migration 0112, DEC-109). The seven SET-19 scenarios (H-3 reminder, aftercare H+1,
// satisfaction H+7, plan H+14, no next booking H+21, product refill H-5, birthday) run in an unbound worker scan: one occurrence per
// (scenario, source, offset), queued through the T-094 outbound queue under a per-patient daily cap (SET-19 batas_harian; an excess goes
// to the first day with room within 7 days). Marketing proposes SET-19 drafts; Admin Pusat or the owner decides (a decision writes the
// setting as the approver). The delivery log shows ids, codes and — by role and consent — the patient's name; never a message body.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { AUTOMATION_SCENARIOS, AUTOMATION_SKIPS } from "../schema";

export type AutomationScenario = (typeof AUTOMATION_SCENARIOS)[number];
export type AutomationSkip = (typeof AUTOMATION_SKIPS)[number];

export class AutomationError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):?\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new AutomationError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

// The scan on an unbound worker connection (the platform worker runs it every few minutes, then the outbound dispatch).
export async function runAutomationScan(worker: pg.Pool | pg.ClientBase, now?: Date): Promise<{ considered: number }> {
  return (await worker.query<{ r: { considered: number } }>(`select automation_scan($1::timestamptz) r`, [now?.toISOString() ?? null])).rows[0].r;
}

export type LogRow = { id: string; scenario: AutomationScenario; branch_id: string; branch_name: string; original_planned_for: string;
  planned_for: string | null; cap_deferred_days: number; capped: boolean; state: "queued" | "sending" | "sent" | "failed" | "skipped";
  skip_reason: AutomationSkip | null; consent_masked: boolean; patient_name: string | null; patient_mrn: string | null; created_at: string };
export type LogFilter = "all" | "queued" | "sent" | "capped" | "skipped";
export const automationLog = (db: pg.ClientBase, scenario: AutomationScenario | null = null, state: LogFilter = "all") =>
  call(async () => (await db.query(`select automation_log_list($1, $2) r`, [scenario, state])).rows[0].r as { role: string; rows: LogRow[] });

export type Draft = { id: string; value: Record<string, unknown>; reason: string; proposed_at: string; proposed_by_me: boolean; proposer: string };
export const automationDraft = (db: pg.ClientBase) =>
  call(async () => (await db.query(`select automation_draft_get() r`)).rows[0].r as Draft | null);

// Marketing proposes a SET-19 value (keyed: a replay answers the first draft).
export async function proposeScenarioDraft(db: pg.ClientBase, key: string, value: Record<string, unknown>, reason: string) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<string>(db, { command: "automation.draft_propose", key, body: { value, reason } },
    async (c) => (await c.query(`select automation_draft_propose($1, $2::jsonb, $3) r`, [key, JSON.stringify(value), reason])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { draftId: out.result, replayed: out.replayed };
}
export const decideScenarioDraft = (db: pg.ClientBase, draftId: string, approve: boolean, reason?: string) =>
  call(async () => (await db.query(`select automation_draft_decide($1, $2, $3) r`, [draftId, approve, reason ?? null])).rows[0].r as "approved" | "rejected");
export const cancelScenarioDraft = (db: pg.ClientBase, draftId: string) =>
  call(async () => { await db.query(`select automation_draft_cancel($1)`, [draftId]); });
