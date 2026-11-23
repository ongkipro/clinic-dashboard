// Owner daily digest runs (PR-80, T-117, migration 0131). One run per tenant per local business day (the earliest-created branch's
// day, as tax_local_date). Written only by the worker functions digest_claim / digest_dispatch / digest_delivered / digest_complete on an unbound connection; read only through
// digest_facts by the claimed and bound job (TEN-5). No app table grant. Ids, the day, the SET-37 recipient roles and an outcome code only.
import { sql } from "drizzle-orm";
import { check, date, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "../org/schema";

export const DIGEST_RUN_STATES = ["queued", "leased", "dispatching", "done"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

export const digestRuns = pgTable(
  "digest_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    recipients: text("recipients").array().notNull(), // the SET-37 `penerima` roles when the run was created
    state: text("state", { enum: DIGEST_RUN_STATES }).notNull().default("queued"),
    leaseGen: integer("lease_gen").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }), // the last time digest_dispatch authorized a send
    dispatchedGens: integer("dispatched_gens").array().notNull().default(sql`'{}'::integer[]`), // every generation authorized to send (one dispatch each)
    deliveredAt: timestamp("delivered_at", { withTimezone: true }), // the port accepted the digest (digest_delivered): the receipt
    providerRef: text("provider_ref"), // the port's reference for that acceptance
    outcome: text("outcome"), // 'sent' (a receipt) | 'refused:<code>' (never dispatched) | 'unconfirmed:<code>' (dispatched, no receipt: may have been delivered)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("digest_runs_tenant_id_id_key").on(t.tenantId, t.id),
    unique("digest_runs_one_per_day").on(t.tenantId, t.businessDate),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    check("digest_runs_check", sql`${t.state} in (${inList(DIGEST_RUN_STATES)}) and ${t.leaseGen} >= 0 and ${t.attempts} >= 0
      and cardinality(${t.recipients}) between 1 and 4 and ${t.recipients} <@ array['owner','admin_pusat','finance','manager']::text[]
      and ((${t.state} in ('leased','dispatching')) = (${t.leaseUntil} is not null))
      and (${t.state} <> 'dispatching' or ${t.dispatchedAt} is not null) and ((${t.dispatchedAt} is null) = (cardinality(${t.dispatchedGens}) = 0))
      and ((${t.deliveredAt} is null) = (${t.providerRef} is null)) and (${t.deliveredAt} is null or ${t.dispatchedAt} is not null)
      and (${t.providerRef} is null or ${t.providerRef} ~ '^[A-Za-z0-9_.:-]{1,128}$')
      and ((${t.state} = 'done') = (${t.outcome} is not null)) and ((${t.state} = 'done') = (${t.finishedAt} is not null))
      and (${t.outcome} is null or ${t.outcome} ~ '^(sent|refused:[a-z][a-z0-9_]{1,48}|unconfirmed:[a-z][a-z0-9_]{1,48})$')
      and (coalesce(${t.outcome} = 'sent', false) = (${t.state} = 'done' and ${t.deliveredAt} is not null))
      and (${t.outcome} is null or ${t.outcome} = 'sent' or ${t.deliveredAt} is null)
      and (${t.outcome} is null or ${t.outcome} not like 'unconfirmed:%' or ${t.dispatchedAt} is not null)
      and (${t.outcome} is null or ${t.outcome} not like 'refused:%' or cardinality(${t.dispatchedGens}) = 0)`),
  ],
);
