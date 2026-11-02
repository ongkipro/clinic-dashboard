// Domain events and consumer receipts (DATA-59, TD-50, TEN-5). Policy kind tenant-ledger.
// - domain_events: written by producers in the same transaction as the fact (emit()),
//   attributed from the bound context (staff, acting role), payload carries IDs and
//   codes only; append-only.
// - event_consumers: the registry of consumers and the event types each subscribes to.
// - event_receipts: one row per (consumer, event), created by a trigger when the event is
//   inserted (same transaction, so it becomes visible with the event). A worker claims
//   open receipts across tenants with events_claim() (security definer, ids only) as a
//   lease; the consumer binds the event's tenant and branch and marks the receipt done
//   in the same transaction as its effects, so each consumer applies an event once.
//   Claims scan only open receipts (partial index), never the event history.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().default(sql`app_tenant_id()`),
    branchId: uuid("branch_id"),
    type: text("type").notNull(),
    version: integer("version").notNull().default(1),
    aggregateKind: text("aggregate_kind").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: integer("aggregate_version").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull().default(sql`uuid_generate_v7()`),
    originCommandId: uuid("origin_command_id"),
    staffId: uuid("staff_id").default(sql`app_staff_id()`),
    actingRole: text("acting_role").default(sql`app_acting_role()`),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("domain_events_tenant_id_id_key").on(t.tenantId, t.id),
    check("domain_events_type_check", sql`${t.type} ~ '^[A-Z][A-Za-z]{2,60}$'`),
    check("domain_events_version_check", sql`${t.version} between 1 and 1000 and ${t.aggregateVersion} >= 1`),
    check("domain_events_aggregate_kind_check", sql`${t.aggregateKind} ~ '^[a-z][a-z_]{1,40}$'`),
    // TD-50 backstop (events_payload_ok, migration 0018): keys are lower-case codes;
    // scalars are UUIDs, lower-case codes or booleans; no numbers, nulls or free text.
    check(
      "domain_events_payload_check",
      sql`jsonb_typeof(${t.payload}) = 'object' and octet_length(${t.payload}::text) <= 4096 and public.events_payload_ok(${t.payload})`,
    ),
  ],
);

// Platform registry: consumers register with their tasks (migration); `*` = every type.
export const eventConsumers = pgTable(
  "event_consumers",
  {
    name: text("name").primaryKey(),
    eventTypes: text("event_types").array().notNull(),
    maxAttempts: integer("max_attempts").notNull().default(10),
  },
  (t) => [
    check("event_consumers_name_check", sql`${t.name} ~ '^[a-z][a-z0-9_.-]{2,60}$'`),
    check("event_consumers_types_check", sql`cardinality(${t.eventTypes}) >= 1`),
    check("event_consumers_max_attempts_check", sql`${t.maxAttempts} between 1 and 100`),
  ],
);

export const eventReceipts = pgTable(
  "event_receipts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    consumer: text("consumer")
      .notNull()
      .references(() => eventConsumers.name, { onDelete: "restrict" }),
    eventId: uuid("event_id").notNull(),
    claimedBy: text("claimed_by"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull().default(sql`'-infinity'`),
    attempts: integer("attempts").notNull().default(0),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [domainEvents.tenantId, domainEvents.id] }).onDelete("restrict"),
    unique("event_receipts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("event_receipts_consumer_event_key").on(t.consumer, t.eventId),
    index("event_receipts_open_idx").on(t.consumer, t.eventId).where(sql`${t.doneAt} is null`),
    check("event_receipts_consumer_check", sql`${t.consumer} ~ '^[a-z][a-z0-9_.-]{2,60}$'`),
    check("event_receipts_claimed_by_check", sql`${t.claimedBy} is null or ${t.claimedBy} ~ '^[A-Za-z0-9_.:-]{1,80}$'`),
    check("event_receipts_attempts_check", sql`${t.attempts} >= 0`),
  ],
);
