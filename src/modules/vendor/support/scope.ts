// Support-session scope approval and read audit (T-026, PR-60, TEN-14). The clinic Owner
// approves or rejects a session whose scope holds specific personal data or clinical tables;
// the Owner (Admin Pusat read) sees every session with its access windows, refused binds and
// the records read. All calls run inside withTenantContext (clinic_app).
import type pg from "pg";
import { CommandError } from "../../../lib/command";
import { call } from "../../org/access/access";

export type ScopeDecision =
  | { ok: true; decision: "approved" | "rejected" }
  | { ok: false; code: "ERR_NOT_FOUND" | "ERR_INVALID_INPUT" | "ERR_FORBIDDEN"; reason: string };

// A refusal is audited by the database function and must be committed by the caller (the
// transaction is not rolled back): it is returned, not thrown. Not the Owner → ERR_FORBIDDEN thrown.
export async function decideScope(db: pg.ClientBase, sessionId: string, approve: boolean): Promise<ScopeDecision> {
  const r = await call(async () =>
    (await db.query<{ r: string }>(`select support_session_owner_decide($1, $2) as r`, [sessionId, approve])).rows[0].r);
  if (r === "approved" || r === "rejected") return { ok: true, decision: r };
  const reasonCode = r.replace(/^refused:/, "");
  return { ok: false, code: reasonCode === "not_found" ? "ERR_NOT_FOUND" : reasonCode === "invalid_input" ? "ERR_INVALID_INPUT" : "ERR_FORBIDDEN", reason: reasonCode };
}

export type OwnerSession = {
  id: string; operator: string; purpose: string; scope: { table: string; class: string }[];
  state: "pending_approval" | "active" | "expired" | "tenant_closed" | "ended"; needs_approval: boolean; minutes: number;
  requested_at: string; activated_at: string | null; ends_at: string | null; extended_at: string | null; extension_reason: string | null;
  ended_at: string | null; end_reason: string | null; access_windows: number; refused_reads: number; records_read: number;
};
export async function sessionsForOwner(db: pg.ClientBase): Promise<OwnerSession[]> {
  return call(async () => (await db.query<{ r: OwnerSession[] }>(`select support_sessions_for_owner() as r`)).rows[0].r);
}

// One stream of events, oldest first, a page at a time; totals per kind.
export type SessionEvent =
  | { kind: "window"; at: string; used_at?: string }
  | { kind: "refused"; at: string; reason: string }
  // row_found: the row exists now in this tenant; false = deleted since, or never this
  // tenant's (a forged record — shown as evidence); null = the table cannot be checked.
  | { kind: "read"; at: string; object_kind: string; id: string; row_found: boolean | null };
export type SessionLog = { totals: { windows: number; refused: number; reads: number }; events: SessionEvent[] };
export async function sessionLog(db: pg.ClientBase, sessionId: string, page: { offset: number; limit: number } = { offset: 0, limit: 100 }): Promise<SessionLog> {
  if (!Number.isInteger(page.offset) || page.offset < 0 || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 500) {
    throw new CommandError("ERR_INVALID_INPUT");
  }
  return call(async () => (await db.query<{ r: SessionLog }>(`select support_session_reads_for_owner($1, $2, $3) as r`, [sessionId, page.offset, page.limit])).rows[0].r);
}
