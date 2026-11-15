// The complaint flag from an inbound WhatsApp message (PR-43 inbox flag; T-091, migration 0106, DEC-103). A Klinis flag becomes a task for the
// branch's clinicians on duty (DEC-066 fan-out); a Layanan flag for the branch manager. The staff type their own short summary: the message body
// is never copied into the task, an event, an audit row or a notification (W-10). The flagger then sees the task's status only (complaint_json).
import { createHash } from "node:crypto";
import type pg from "pg";
import { runCommand, type Json } from "../../../lib/command";
import type { ServiceCategory, Triage } from "../../clinical/complaints/complaints";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { call } from "./inbox";

export type MessageFlag =
  | { kind: "klinis"; summary: string; triage?: Triage }
  | { kind: "layanan"; summary: string; category: ServiceCategory };

// Replays by key (the same message, kind, triage/category and summary digest); a second flag of the message while its task is unresolved is
// ERR_VERSION_CONFLICT (already_flagged).
export async function flagMessage(db: pg.ClientBase, key: string, messageId: string, f: MessageFlag) {
  await assertProductionGoLive(db);
  const summary = f.summary.trim();
  const p: Record<string, Json> = { kind: f.kind, summary };
  if (f.kind === "klinis" && f.triage) p.triage = f.triage;
  if (f.kind === "layanan") p.category = f.category;
  const body: Record<string, Json> = { message_id: messageId, kind: f.kind, triage: f.kind === "klinis" ? f.triage ?? null : null,
    category: f.kind === "layanan" ? f.category : null, digest: createHash("sha256").update(summary).digest("hex") };
  const out = await call(() => runCommand<string>(db, { command: "complaint_flag_from_message", key, body },
    async (c) => (await c.query(`select complaint_flag_from_message($1, $2::jsonb) as r`, [messageId, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { taskId: out.result, replayed: out.replayed };
}
