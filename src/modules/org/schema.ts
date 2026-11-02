import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantsRegistry } from "../vendor/schema";

// Tenant = one brand = one legal entity (PR-1, DATA-10). Its id is the registry id.
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey(),
    legalName: text("legal_name").notNull(),
    npwp: text("npwp"),
    isPkp: boolean("is_pkp").notNull().default(false),
    pkpEffectiveFrom: date("pkp_effective_from"),
    sakFramework: text("sak_framework", { enum: ["emkm", "ep"] }).notNull(),
    accentHex: text("accent_hex"),
    logoRef: text("logo_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.id], foreignColumns: [tenantsRegistry.id] }).onDelete("restrict"),
    check("tenants_sak_framework_check", sql`${t.sakFramework} in ('emkm','ep')`),
    check("tenants_accent_hex_check", sql`${t.accentHex} ~ '^#[0-9a-fA-F]{6}$'`),
    check("tenants_pkp_check", sql`not ${t.isPkp} or ${t.pkpEffectiveFrom} is not null`),
  ],
);

// Branch of a tenant (DATA-11). Later columns (hours, closures, SATUSEHAT ids) arrive with their tasks.
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    unique("branches_tenant_id_id_key").on(t.tenantId, t.id),
    unique("branches_tenant_id_code_key").on(t.tenantId, t.code),
    check(
      "branches_timezone_check",
      sql`${t.timezone} in ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura')`,
    ),
  ],
);
