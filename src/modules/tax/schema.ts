// Tax module schema (PR-24, A-07, SET-39; T-071, migration 0086). The tenant's current tax facts stay on `tenants`
// (npwp, is_pkp, pkp_effective_from); every change is one insert-only row here, written only by tax_profile_set
// (owner). A guard on `tenants` lets the tax fields change only together with a new change row.
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { staff, tenants } from "../org/schema";

export const taxProfileChanges = pgTable(
  "tax_profile_changes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    npwp: text("npwp"),
    isPkp: boolean("is_pkp").notNull(),
    pkpEffectiveFrom: date("pkp_effective_from"),
    reason: text("reason").notNull(),
    commandKey: text("command_key").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAs: text("changed_as").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "tax_profile_changes_changed_by_fk", columns: [t.tenantId, t.changedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("tax_profile_changes_tenant_id_id_key").on(t.tenantId, t.id),
    unique("tax_profile_changes_command_key").on(t.tenantId, t.commandKey),
    index("tax_profile_changes_tenant_idx").on(t.tenantId, t.changedAt),
    check("tax_profile_changes_check", sql`${t.isPkp} = (${t.pkpEffectiveFrom} is not null)
      and (not ${t.isPkp} or ${t.npwp} is not null)
      and (${t.npwp} is null or ${t.npwp} ~ '^[0-9]{15,16}$')
      and ${t.changedAs} = 'owner'
      and length(btrim(${t.reason})) between 3 and 500
      and ${t.commandKey} ~ '^[A-Za-z0-9_.:-]{8,128}$'`),
  ],
);
