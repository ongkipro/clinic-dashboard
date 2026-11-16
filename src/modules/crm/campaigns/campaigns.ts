// Kampanye & Segmen (PR-94, UX-19; T-100, migration 0115, DEC-112). Segments are saved filters over non-clinical rules (branch, last visit
// window, birthday month, age band, sex), always intersected with an active marketing_wa consent (PR-4); members are counted, never listed.
// A campaign is scheduled with a segment, an approved marketing template and a date; sending is gated by the Q-15 counsel evidence
// (campaign_sending, PR-97): while it is not approved, sending is refused and nothing is queued. When it is open the consented members are
// queued under the per-patient cap; delivery outcomes are read from the outbound queue. No message leaves through this module directly.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export const SEND_LOCKED = "Pengiriman kampanye terkunci sampai bukti hukum disetujui";

export class CampaignError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):?\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_GATE_CLOSED",
  "ERR_IDEMPOTENCY_CONFLICT"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CampaignError(m[1] as ErrorCode, m[2] || undefined);
    throw e;
  }
}

export type SegmentRules = { branch_id?: string; visit_within_days?: number; no_visit_within_days?: number; birthday_month?: number;
  age_min?: number; age_max?: number; sex?: "female" | "male" };

// Keyed (runCommand); before a replay is answered, campaign_actor_check re-checks the current actor's role and lifecycle capability in the
// same transaction (configuration for segment and schedule writes, marketing_message for sending).
async function keyed<T extends Json>(db: pg.ClientBase, command: string, key: string, capability: "configuration" | "marketing_message",
  body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  await call(() => db.query(`select campaign_actor_check($1)`, [capability]));
  const out = await call(() => runCommand<T>(db, { command, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result as T, replayed: out.replayed };
}

export async function saveSegment(db: pg.ClientBase, key: string, s: { id?: string; name: string; rules: SegmentRules }) {
  const p: Record<string, Json> = { name: s.name, rules: s.rules as Json };
  if (s.id) p.id = s.id;
  const out = await keyed<string>(db, "campaign_segment_save", key, "configuration", p, `select campaign_segment_save($1, $2::jsonb) r`, [key, JSON.stringify(p)]);
  return { segmentId: out.result, replayed: out.replayed };
}

export async function scheduleCampaign(db: pg.ClientBase, key: string, campaignId: string, s: { segmentId: string; templateId: string; scheduledFor: string }) {
  const p = { segment_id: s.segmentId, template_id: s.templateId, scheduled_for: s.scheduledFor };
  return (await keyed<string>(db, "campaign_schedule", key, "configuration", { campaign_id: campaignId, ...p },
    `select campaign_schedule($1, $2::jsonb) r`, [campaignId, JSON.stringify(p)])).result as "scheduled";
}

export async function unscheduleCampaign(db: pg.ClientBase, key: string, campaignId: string, to: "draft" | "cancelled") {
  return (await keyed<string>(db, "campaign_unschedule", key, "configuration", { campaign_id: campaignId, to },
    `select campaign_unschedule($1, $2) r`, [campaignId, to])).result as "draft" | "cancelled";
}

export type SendResult = { queued: number; skipped: Record<string, number> };
// ERR_GATE_CLOSED (the Q-15 evidence is not approved) → nothing queued; the caller shows SEND_LOCKED.
export async function sendCampaign(db: pg.ClientBase, key: string, campaignId: string) {
  const out = await keyed<{ queued: number; skipped: { [k: string]: Json } }>(db, "campaign_send", key, "marketing_message", { campaign_id: campaignId },
    `select campaign_send($1) r`, [campaignId]);
  return { ...(out.result as unknown as SendResult), replayed: out.replayed };
}

export const previewSegment = (db: pg.ClientBase, rules: SegmentRules) =>
  call(async () => (await db.query(`select campaign_segment_preview($1::jsonb) r`, [JSON.stringify(rules)])).rows[0].r as number);

export type Outcomes = { queued: number; sending: number; sent: number; skipped: number; failed: number };
export type Workspace = {
  role: string; can_manage: boolean; gate: { open: boolean; missing: string[] };
  segments: { id: string; name: string; rules: SegmentRules; members: number; updated_at: string }[];
  campaigns: { id: string; name: string; code: string; channel: string; active: boolean; segment_id: string | null; template_id: string | null;
    template_name: string | null; scheduled_for: string | null; send_state: "draft" | "scheduled" | "queued" | "cancelled"; queued_at: string | null;
    outcomes: Outcomes }[];
  templates: { id: string; name: string }[];
  branches: { id: string; name: string }[];
};
export const campaignWorkspace = (db: pg.ClientBase) => call(async () => (await db.query(`select campaign_workspace_list() r`)).rows[0].r as Workspace);
