// The ledger posting consumer (PR-26, TD-50, T-105): applies one domain event through its posting rule (drizzle/0123 ledger_post_event),
// inside the tenant-bound transaction consume() opens, so the journal and the receipt commit together. Every rule is keyed by its source
// fact: a replayed or duplicate event posts nothing. The rules are the DRAFT posting map (docs/spec/11, version ledger_map_version()):
// entries are a preview until an activation decision exists (open gate G-ACT; none in T-105).
// A NULL result means nothing to post now — a replay, a fact that legitimately posts nothing, or a treatment whose line is not final yet
// (not issued, or its manual discount pending) — never a lost dependency: a domain reversal consumed before its original posts that original
// from its fact first (drizzle/0123 ledger_rule_reversal), and a waiting treatment is posted when its line becomes final by the InvoiceIssued /
// ApprovalDecided wake-up (ledger_wake_visit) — durable, independent of retry counts.
import type pg from "pg";
import type { DomainEvent } from "../../events/events";
import type { Consumer } from "../../../workers/outbox";

export const LEDGER_CONSUMER = "ledger.posting";

export async function postEvent(db: pg.ClientBase, event: Pick<DomainEvent, "id">): Promise<string | null> {
  const r = await db.query<{ id: string | null }>(`select ledger_post_event($1) as id`, [event.id]);
  return r.rows[0]?.id ?? null;
}

export const ledgerPostingConsumer: Consumer = { name: LEDGER_CONSUMER, handle: async (db, event) => void (await postEvent(db, event)) };
