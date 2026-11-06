// Support sessions (T-025, PR-53, TEN-6, TEN-14, TEN-17). Console commands name the caller by
// its vendor session token (clinic_vendor pool); reads run on a clinic_operator pool inside
// one transaction that first binds the session with a ticket the console issued for that
// transaction (vendor_console_support_ticket, support_session_bind) — the operator RLS
// policies admit rows only for that backend and transaction, in the session's tenant and
// declared tables, while it is active.
import type pg from "pg";
import type { ConsoleCall, Result } from "../tenants/tenants";
import { call as orgCall } from "../../org/access/access";
import { type RefusalSubject, withAuthorityRecheck } from "../authority";

async function call<T>(db: pg.Pool, sql: string, args: unknown[], subject: RefusalSubject = { object: null }): Promise<Result<T>> {
  // HYG-008b: the entry point re-reads its caller's authority after its last wait; a refusal
  // there rolls the statement back and is logged in its own transaction, attributed to `subject`
  // (withAuthorityRecheck). Calls that are not console entry points never raise it.
  const fn = /select (vendor_console_[a-z_]+)\(/.exec(sql)?.[1];
  const once = async () => {
    const r = (await db.query<{ r: { ok: boolean; code?: string; reason?: string } & T }>(sql, args)).rows[0].r;
    return r.ok ? ({ ok: true, data: r } as const) : ({ ok: false, code: r.code ?? "ERR_FORBIDDEN", reason: r.reason } as const);
  };
  if (!fn) return once();
  return withAuthorityRecheck(db, { token: String(args[0]), ip: String(args[1]) }, fn, subject, once);
}

export type OpenInput = { tenantId: string | null; purpose: string; scope: string[]; minutes: number };
export function openSession(db: pg.Pool, c: ConsoleCall, i: OpenInput) {
  return call<{ id: string; state: "active" | "pending_approval" }>(db, `select vendor_console_support_open($1, $2, $3, $4, $5, $6) as r`,
    [c.token, c.ip, i.tenantId, i.purpose, i.scope, i.minutes], { tenant: i.tenantId });
}
export function extendSession(db: pg.Pool, c: ConsoleCall, sessionId: string | null, reason: string, minutes: number) {
  return call<object>(db, `select vendor_console_support_extend($1, $2, $3, $4, $5) as r`, [c.token, c.ip, sessionId, reason, minutes], { supportSession: sessionId });
}
export function endSession(db: pg.Pool, c: ConsoleCall, sessionId: string | null) {
  return call<object>(db, `select vendor_console_support_end($1, $2, $3) as r`, [c.token, c.ip, sessionId], { supportSession: sessionId });
}
export type SessionRow = {
  id: string; tenant_id: string; operator: string; purpose: string; scope: string[];
  state: "pending_approval" | "active" | "expired" | "ended"; requested_at: string; ends_at: string | null; extended: boolean; end_reason: string | null;
};
export function listSessions(db: pg.Pool, c: ConsoleCall, tenantId: string | null) {
  return call<{ rows: SessionRow[] }>(db, `select vendor_console_support_list($1, $2, $3) as r`, [c.token, c.ip, tenantId], { tenant: tenantId });
}

export class SupportBindError extends Error {
  constructor(readonly reason: string) {
    super(`support session not usable: ${reason}`);
  }
}

// Runs fn in one transaction on a clinic_operator connection with the session bound (review
// rounds 2–3):
//   1. the operator connection opens a READ COMMITTED transaction (the bind refuses any other
//      level, so a revocation is seen at the next statement) and names its backend pid and txid;
//   2. the console pool issues a bind ticket for exactly that transaction in its own committed
//      transaction, which writes "bind issued" to the vendor log and the tenant chain;
//   3. the operator transaction binds with the ticket. A txid is never reused, so the ticket
//      cannot outlive this transaction: every read transaction leaves its own durable trace.
// fn sees only the session's tenant and declared tables; rows its queries touch are recorded in
// support_session_reads (a superset of the rows returned, lost if the transaction rolls back:
// DEC-038). Nothing is writable.
export async function withSupportSession<T>(
  consolePool: pg.Pool, operatorPool: pg.Pool, c: ConsoleCall, sessionId: string, fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await operatorPool.connect();
  let broken: Error | undefined;
  try {
    // Not READ ONLY: the bind consumes its ticket and writes its binding row, and touched rows are
    // recorded (SECURITY DEFINER); clinic_operator itself holds no write privilege on any table.
    await client.query("begin isolation level read committed");
    try {
      const tx = (await client.query<{ pid: number; txid: string }>(`select pg_backend_pid() as pid, txid_current()::text as txid`)).rows[0];
      // The ticket is a console entry point: its authority re-check refusal is logged on its own
      // and answered like any other refusal (HYG-008b; review: it bypassed the wrapper).
      const t = await call<{ ticket?: string }>(consolePool,
        `select vendor_console_support_ticket($1, $2, $3, $4, $5) as r`, [c.token, c.ip, sessionId, tx.pid, tx.txid], { supportSession: sessionId });
      if (!t.ok || !t.data.ticket) throw new SupportBindError((t.ok ? undefined : t.reason) ?? "forbidden");
      const r = (await client.query<{ r: { ok: boolean; reason?: string } }>(`select support_session_bind($1, $2, $3, $4) as r`,
        [c.token, c.ip, sessionId, t.data.ticket])).rows[0].r;
      if (!r.ok) {
        // The refusal's log row must survive: commit it (nothing else happened).
        await client.query("commit");
        throw new SupportBindError(r.reason ?? "forbidden");
      }
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (e) {
      // Always roll back (after a committed refusal this is a no-op warning); a client whose
      // rollback fails is destroyed, never returned to the pool still bound.
      await client.query("rollback").catch((rb: Error) => {
        broken = rb;
      });
      throw e;
    }
  } finally {
    client.release(broken);
  }
}

// The clinic Owner ends a session now (inside withTenantContext).
export async function endSessionAsOwner(db: pg.ClientBase, sessionId: string): Promise<void> {
  await orgCall(async () => db.query(`select support_session_end_by_owner($1)`, [sessionId]));
}

// Expiry sweep (clinic_executor connection).
export async function expireSessions(db: pg.ClientBase): Promise<number> {
  return (await db.query<{ n: number }>(`select support_session_expire() as n`)).rows[0].n;
}
