// Promo codes (PR-77, BILL-36, DATA-68; T-081, migration 0097). Pre-approved discounts applied at the cashier (never shown on
// public pages, PR-65): they do not consume the manual SET-12 limits and are reported separately (BILL-28).
//
// - promo_codes (tenant-ledger, money_total): the stable identity; the code (upper case) unique per tenant; the quota shared
//   across versions; `used` counts reserved + consumed usages and is changed only by the one conditional UPDATE that takes a
//   use (`used < quota`) or by a release — that UPDATE is the atomic quota (two cashiers cannot exceed it).
// - promo_code_versions (tenant-ledger, money_total): the terms (period, eligible items and branches, the discount, an optional
//   per-patient limit); immutable once any usage references it — an edit inserts version + 1.
// - promo_usages (tenant-ledger, personal): one per invoice line (one promo per line); reserved at issue, consumed when the
//   line is settled (paid, or its remainder converted to a receivable), released on void, removal before payment, or a refund
//   of the full line value.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { invoiceLines, invoices } from "../cashier/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";

export const PROMO_DISCOUNT_KINDS = ["percent", "rupiah"] as const;
export const PROMO_USAGE_STATES = ["reserved", "consumed", "released"] as const;
export const PROMO_RELEASE_CODES = ["void", "removed", "refunded_full"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const MONEY = "1000000000000";
const MANAGERS = "('owner','admin_pusat','marketing')";

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    quota: integer("quota").notNull(),
    used: integer("used").notNull().default(0),
    active: boolean("active").notNull().default(true),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_codes_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("promo_codes_tenant_id_id_key").on(t.tenantId, t.id),
    unique("promo_codes_code_key").on(t.tenantId, t.code),
    unique("promo_codes_command_key").on(t.tenantId, t.commandKey),
    check("promo_codes_check", sql`${t.code} ~ '^[A-Z0-9-]{3,32}$' and ${t.quota} between 1 and 1000000 and ${t.used} between 0 and ${t.quota}
      and ${KEY(t.commandKey)} and ${t.createdAs} in ${sql.raw(MANAGERS)}`),
  ],
);

export const promoCodeVersions = pgTable(
  "promo_code_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    promoId: uuid("promo_id").notNull(),
    version: smallint("version").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }).notNull(),
    discountKind: text("discount_kind", { enum: PROMO_DISCOUNT_KINDS }).notNull(),
    discountValue: bigint("discount_value", { mode: "number" }).notNull(),
    maxDiscount: bigint("max_discount", { mode: "number" }),
    itemIds: uuid("item_ids").array().notNull(),
    branchIds: uuid("branch_ids").array().notNull().default(sql`'{}'::uuid[]`), // empty = every branch
    perPatientLimit: smallint("per_patient_limit"),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_code_versions_promo_fk", columns: [t.tenantId, t.promoId], foreignColumns: [promoCodes.tenantId, promoCodes.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_code_versions_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("promo_code_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("promo_code_versions_version_key").on(t.tenantId, t.promoId, t.version),
    unique("promo_code_versions_command_key").on(t.tenantId, t.commandKey),
    check("promo_code_versions_check", sql`${t.version} between 1 and 1000 and ${t.validFrom} <= ${t.validTo}
      and ${t.discountKind} in (${inList(PROMO_DISCOUNT_KINDS)})
      and (${t.discountKind} = 'percent' and ${t.discountValue} between 1 and 100 or ${t.discountKind} = 'rupiah' and ${t.discountValue} between 1 and ${sql.raw(MONEY)})
      and (${t.maxDiscount} is null or ${t.maxDiscount} between 1 and ${sql.raw(MONEY)})
      and cardinality(${t.itemIds}) between 1 and 200 and cardinality(${t.branchIds}) <= 50
      and (${t.perPatientLimit} is null or ${t.perPatientLimit} between 1 and 1000)
      and ${KEY(t.commandKey)} and ${t.createdAs} in ${sql.raw(MANAGERS)}`),
  ],
);

export const promoUsages = pgTable(
  "promo_usages",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    promoId: uuid("promo_id").notNull(),
    versionId: uuid("version_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    patientId: uuid("patient_id"), // canonical at issue; null for a counter sale without a patient
    discount: bigint("discount", { mode: "number" }).notNull(),
    state: text("state", { enum: PROMO_USAGE_STATES }).notNull().default("reserved"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseCode: text("release_code", { enum: PROMO_RELEASE_CODES }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_usages_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_usages_promo_fk", columns: [t.tenantId, t.promoId], foreignColumns: [promoCodes.tenantId, promoCodes.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_usages_version_fk", columns: [t.tenantId, t.versionId], foreignColumns: [promoCodeVersions.tenantId, promoCodeVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_usages_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_usages_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    foreignKey({ name: "promo_usages_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    unique("promo_usages_tenant_id_id_key").on(t.tenantId, t.id),
    unique("promo_usages_line_key").on(t.tenantId, t.invoiceLineId),
    index("promo_usages_promo_patient_idx").on(t.tenantId, t.promoId, t.patientId),
    index("promo_usages_invoice_idx").on(t.tenantId, t.invoiceId),
    check("promo_usages_check", sql`${t.discount} between 1 and ${sql.raw(MONEY)} and ${t.state} in (${inList(PROMO_USAGE_STATES)})
      and (${t.state} <> 'reserved' or ${t.consumedAt} is null and ${t.releasedAt} is null)
      and (${t.state} <> 'consumed' or ${t.consumedAt} is not null and ${t.releasedAt} is null)
      and ((${t.state} = 'released') = (${t.releasedAt} is not null)) and ((${t.state} = 'released') = (${t.releaseCode} is not null))
      and (${t.releaseCode} is null or ${t.releaseCode} in (${inList(PROMO_RELEASE_CODES)}))
      and (${t.releaseCode} is distinct from 'refunded_full' or ${t.consumedAt} is not null)`),
  ],
);
