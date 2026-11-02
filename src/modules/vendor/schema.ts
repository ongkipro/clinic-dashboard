import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Platform registry of every tenant (DATA-10, TEN-9, TEN-12). Policy kind: platform.
// Vendor tables reference it by `tenant_id`; it never joins tenant rows directly (TEN-16).
export const tenantLifecycleStates = [
  "provisioning",
  "onboarding",
  "live",
  "suspended",
  "exit",
  "closed",
] as const;

export const tenantsRegistry = pgTable(
  "tenants_registry",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    lifecycleState: text("lifecycle_state", { enum: tenantLifecycleStates })
      .notNull()
      .default("provisioning"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "tenants_registry_lifecycle_state_check",
      sql`${t.lifecycleState} in ('provisioning','onboarding','live','suspended','exit','closed')`,
    ),
  ],
);
