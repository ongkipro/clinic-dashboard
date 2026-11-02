// Domain events (DATA-59, TD-50): emit() inside the fact's transaction, so a rollback of
// the fact leaves no event; consume() applies one event once per consumer (TEN-5).
// Consumers are registered in event_consumers by their task's migration; the fan-out
// trigger opens one receipt per subscribed consumer when the event is inserted.
import type pg from "pg";
import type { Json } from "../../lib/command";
import { type TenantContext, withTenantContext } from "../../db/rls/context";

export type EventPayload = { [key: string]: Json };

export type NewEvent = {
  type: string; // TD-50 catalog name, e.g. "PaymentReceived"
  aggregateKind: string; // e.g. "invoice"
  aggregateId: string;
  aggregateVersion?: number;
  branchId?: string;
  correlationId?: string;
  originCommandId?: string;
  // A follow-up event written by a consumer keeps the cause's correlation and origin.
  causedBy?: Pick<DomainEvent, "correlationId" | "originCommandId">;
  payload?: EventPayload; // IDs and codes only (DB CHECK); keys are lower-case codes
};

// Runs on the producer's client inside withTenantContext: tenant, staff and acting role
// come from the bound context (RLS refuses anything else).
export async function emit(db: pg.ClientBase, e: NewEvent): Promise<string> {
  const id = (await db.query<{ id: string }>(`select uuid_generate_v7() as id`)).rows[0].id;
  await db.query(
    `insert into domain_events (id, branch_id, type, aggregate_kind, aggregate_id, aggregate_version,
                                correlation_id, origin_command_id, payload)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, uuid_generate_v7()), $8, $9::jsonb)`,
    [
      id,
      e.branchId ?? null,
      e.type,
      e.aggregateKind,
      e.aggregateId,
      e.aggregateVersion ?? 1,
      e.correlationId ?? e.causedBy?.correlationId ?? null,
      e.originCommandId ?? e.causedBy?.originCommandId ?? null,
      JSON.stringify(e.payload ?? {}),
    ],
  );
  return id;
}

export type DomainEvent = {
  id: string;
  tenantId: string;
  branchId: string | null;
  type: string;
  version: number;
  aggregateKind: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId: string;
  originCommandId: string | null;
  payload: EventPayload;
};

export type Claim = { eventId: string; tenantId: string; branchId: string | null };

export async function claim(
  pool: pg.Pool,
  opts: { consumer: string; worker: string; limit?: number; leaseSeconds?: number },
): Promise<Claim[]> {
  const { rows } = await pool.query<{ event_id: string; tenant_id: string; branch_id: string | null }>(
    `select * from events_claim($1, $2, $3, $4)`,
    [opts.consumer, opts.worker, opts.limit ?? 50, opts.leaseSeconds ?? 60],
  );
  return rows.map((r) => ({ eventId: r.event_id, tenantId: r.tenant_id, branchId: r.branch_id }));
}

export type Handler = (db: pg.PoolClient, event: DomainEvent) => Promise<void>;

// Binds the claimed row's tenant and branch (service context: no staff, no role; the
// event's branch, or every branch for a branch-less event) before any read or write,
// reads the event under RLS, runs the handler and marks the receipt done in the same
// transaction. A handler error rolls back its effects and the receipt stays open; the
// lease expires and another claim retries it, up to the consumer's max_attempts (then
// it stays open as a dead letter for an operator). Handlers must tolerate events of one
// aggregate arriving out of order after a retry (compare aggregate_version). External
// side effects are not rolled back: such consumers make them idempotent themselves.
export async function consume(pool: pg.Pool, consumer: string, c: Claim, handler: Handler): Promise<"done" | "skipped"> {
  const ctx: TenantContext = {
    tenantId: c.tenantId,
    allowedBranchIds: c.branchId ? [c.branchId] : "*",
    activeBranchId: c.branchId ?? undefined,
    roles: [],
  };
  return withTenantContext(pool, ctx, async (db) => {
    // A duplicate blocked behind another worker's transaction gives up instead of
    // pinning a connection; its lease expires and the event is claimed again.
    await db.query(`set local lock_timeout = '5s'`);
    const r = await db.query(
      `update event_receipts set done_at = now()
        where consumer = $1 and event_id = $2 and done_at is null
        returning id`,
      [consumer, c.eventId],
    );
    // Already done by another worker (its lease had expired and both ran): apply nothing.
    if (r.rowCount === 0) return "skipped";
    const { rows } = await db.query(
      `select id, tenant_id, branch_id, type, version, aggregate_kind, aggregate_id, aggregate_version,
              occurred_at, correlation_id, origin_command_id, payload
         from domain_events where id = $1`,
      [c.eventId],
    );
    const e = rows[0];
    if (!e) throw new Error("claimed event not visible in its tenant");
    await handler(db, {
      id: e.id,
      tenantId: e.tenant_id,
      branchId: e.branch_id,
      type: e.type,
      version: e.version,
      aggregateKind: e.aggregate_kind,
      aggregateId: e.aggregate_id,
      aggregateVersion: e.aggregate_version,
      occurredAt: new Date(e.occurred_at).toISOString(),
      correlationId: e.correlation_id,
      originCommandId: e.origin_command_id,
      payload: e.payload,
    });
    return "done";
  });
}
