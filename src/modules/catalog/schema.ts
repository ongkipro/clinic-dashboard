// Catalog (PR-41, DATA-15, CLIN-011, T-033). Policy kind: tenant-shared. One catalog per tenant
// of services, products, packages and materials. An item (catalog_items) never changes kind or
// code and is never deleted; its content lives in catalog_versions, written once and never
// edited (CLIN-011: receipts and entitlements keep the version they used). A version is active
// at once when its clinical fields equal the active version's, otherwise it waits for clinical
// review (approval type catalog_clinical_review, DEC-046) while the previous version stays
// active (scenario PR-41). Writes go only through the catalog_* functions (migration 0054).
// DATA-62 service-master columns are T-034; branch prices are T-035.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { staff, tenants } from "../org/schema";

export const CATALOG_KINDS = ["service", "product", "package", "material"] as const;
// BILL-6 tax categories.
export const TAX_CATEGORIES = ["exempt_medical", "taxable_service", "taxable_goods", "non_object"] as const;
// BILL-15 commission contributions an item may earn.
export const COMMISSION_SCOPES = ["guiding_bc", "closing_bc", "new_patient", "performer"] as const;
export const CATALOG_VERSION_STATES = ["active", "superseded", "pending_review", "rejected", "cancelled"] as const;
// PR-41: these publish only after clinical-lead review.
export const CLINICAL_FIELDS = ["indications", "contraindications", "consent_template", "delegation"] as const;

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind", { enum: CATALOG_KINDS }).notNull(),
    code: text("code").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("catalog_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("catalog_items_tenant_code_key").on(t.tenantId, t.code),
    check("catalog_items_kind_check", sql`${t.kind} in ('service','product','package','material')`),
    check("catalog_items_code_check", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'`),
  ],
);

export const catalogVersions = pgTable(
  "catalog_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull(),
    state: text("state", { enum: CATALOG_VERSION_STATES }).notNull(),
    // Commercial fields (DATA-15).
    name: text("name").notNull(),
    taxCategory: text("tax_category", { enum: TAX_CATEGORIES }).notNull(),
    taxBasis: text("tax_basis").notNull(), // the reason the category applies (BILL-6 "with basis")
    normalPrice: bigint("normal_price", { mode: "number" }).notNull(), // integer rupiah
    controlCount: integer("control_count").notNull().default(0),
    controlValidityDays: integer("control_validity_days"),
    bookingDpEnabled: boolean("booking_dp_enabled").notNull().default(false),
    bookingDpAmount: bigint("booking_dp_amount", { mode: "number" }),
    minDpPct: integer("min_dp_pct"),
    installmentsAllowed: boolean("installments_allowed").notNull().default(false),
    validityDays: integer("validity_days"),
    materialFormula: jsonb("material_formula").notNull().default(sql`'[]'::jsonb`),
    commissionScope: text("commission_scope").array().notNull().default(sql`'{}'::text[]`),
    // Clinical fields (PR-41): published only after clinical review.
    indications: text("indications"),
    contraindications: text("contraindications"),
    consentTemplate: text("consent_template"),
    delegation: text("delegation"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvalId: uuid("approval_id"), // pending_review and its outcomes: the review approval
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // Set once, by the first sale, package or booking that uses this version (later tasks).
    referencedAt: timestamp("referenced_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    unique("catalog_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("catalog_versions_item_version_key").on(t.tenantId, t.itemId, t.version),
    uniqueIndex("catalog_versions_one_active").on(t.tenantId, t.itemId).where(sql`${t.state} = 'active'`),
    uniqueIndex("catalog_versions_one_pending").on(t.tenantId, t.itemId).where(sql`${t.state} = 'pending_review'`),
    uniqueIndex("catalog_versions_one_per_approval").on(t.tenantId, t.approvalId).where(sql`${t.approvalId} is not null`),
    index("catalog_versions_item_idx").on(t.tenantId, t.itemId, t.version),
    check("catalog_versions_state_check", sql`${t.state} in ('active','superseded','pending_review','rejected','cancelled')`),
    check("catalog_versions_version_check", sql`${t.version} >= 1`),
    check("catalog_versions_name_check", sql`length(btrim(${t.name})) between 2 and 120`),
    check("catalog_versions_tax_check", sql`${t.taxCategory} in ('exempt_medical','taxable_service','taxable_goods','non_object') and length(btrim(${t.taxBasis})) between 3 and 300`),
    check("catalog_versions_price_check", sql`${t.normalPrice} >= 0 and ${t.normalPrice} <= 1000000000000`),
    check("catalog_versions_control_check", sql`${t.controlCount} between 0 and 20 and (${t.controlValidityDays} is null or ${t.controlValidityDays} between 1 and 365) and (${t.controlCount} = 0) = (${t.controlValidityDays} is null)`),
    check("catalog_versions_dp_check", sql`(${t.bookingDpEnabled} = (${t.bookingDpAmount} is not null)) and (${t.bookingDpAmount} is null or ${t.bookingDpAmount} between 1 and ${t.normalPrice})`),
    check("catalog_versions_min_dp_check", sql`${t.minDpPct} is null or ${t.minDpPct} between 0 and 100`),
    check("catalog_versions_validity_check", sql`${t.validityDays} is null or ${t.validityDays} between 30 and 1095`),
    check("catalog_versions_formula_check", sql`jsonb_typeof(${t.materialFormula}) = 'array'`),
    check("catalog_versions_commission_check", sql`${t.commissionScope} <@ array['guiding_bc','closing_bc','new_patient','performer']::text[]`),
    check("catalog_versions_clinical_check", sql`coalesce(length(${t.indications}), 0) <= 4000 and coalesce(length(${t.contraindications}), 0) <= 4000 and coalesce(length(${t.consentTemplate}), 0) <= 20000 and coalesce(length(${t.delegation}), 0) <= 2000`),
    check("catalog_versions_reason_check", sql`length(btrim(${t.reason})) between 3 and 500`),
    check("catalog_versions_review_check", sql`(${t.state} in ('pending_review','rejected','cancelled')) <= (${t.approvalId} is not null)`),
  ],
);
