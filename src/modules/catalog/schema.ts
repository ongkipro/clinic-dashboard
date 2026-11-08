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
import { branches, staff, tenants } from "../org/schema";

export const CATALOG_KINDS = ["service", "product", "package", "material"] as const;
// BILL-6 tax categories.
export const TAX_CATEGORIES = ["exempt_medical", "taxable_service", "taxable_goods", "non_object"] as const;
// BILL-15 commission contributions an item may earn.
export const COMMISSION_SCOPES = ["guiding_bc", "closing_bc", "new_patient", "performer"] as const;
export const CATALOG_VERSION_STATES = ["active", "superseded", "pending_review", "rejected", "cancelled"] as const;
// PR-41: these publish only after clinical-lead review.
export const CLINICAL_FIELDS = ["indications", "contraindications", "consent_template", "delegation"] as const;
// T-034 (PR-88, DEC-047): service categories (the delegation floor is keyed by them), resource codes
// (room kinds per DATA-46; device types shared with T-036 and T-044), eligibility modes ranked
// performs > supervised > assists (assists = assisting only, never the primary performer).
export const SERVICE_CATEGORIES = ["filler", "toxin", "threads", "laser_ablative", "injection", "infusion", "laser_non_ablative", "peeling_chemical", "microneedling", "facial", "body_treatment", "consultation"] as const;
export const ROOM_KINDS = ["consultation", "treatment", "pharmacy"] as const;
export const DEVICE_TYPES = ["laser", "laser_ablative", "laser_non_ablative", "ipl", "rf", "hifu", "microneedling_device", "centrifuge", "facial_machine"] as const;
export const ELIGIBLE_PROFESSIONS = ["doctor", "nurse", "therapist"] as const;
export const DELEGATION_MODES = ["performs", "supervised", "assists"] as const;

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
    // Service master (T-034, DATA-62): operational fields, and aftercare text (clinical, DEC-047).
    category: text("category", { enum: SERVICE_CATEGORIES }),
    prepMin: integer("prep_min"),
    treatmentMin: integer("treatment_min"),
    bufferMin: integer("buffer_min"),
    onlineBookable: boolean("online_bookable").notNull().default(false),
    aftercareText: text("aftercare_text"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvalId: uuid("approval_id"), // the clinical review approval (catalog_clinical_review)
    materialsApprovalId: uuid("materials_approval_id"), // the materials review approval (T-034, DEC-047 (2))
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
    foreignKey({ columns: [t.tenantId, t.materialsApprovalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    uniqueIndex("catalog_versions_one_per_materials_approval").on(t.tenantId, t.materialsApprovalId).where(sql`${t.materialsApprovalId} is not null`),
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
    check("catalog_versions_review_check", sql`(${t.state} in ('pending_review','rejected','cancelled')) <= (${t.approvalId} is not null or ${t.materialsApprovalId} is not null)`),
    check("catalog_versions_service_check", sql`(${t.category} is null or ${t.category} in ('filler','toxin','threads','laser_ablative','injection','infusion','laser_non_ablative','peeling_chemical','microneedling','facial','body_treatment','consultation'))
      and (${t.prepMin} is null or ${t.prepMin} between 0 and 120) and (${t.treatmentMin} is null or ${t.treatmentMin} between 5 and 480) and (${t.bufferMin} is null or ${t.bufferMin} between 0 and 120)
      and coalesce(length(${t.aftercareText}), 0) <= 4000`),
  ],
);

// Service master child rows (T-034, DATA-62): written once with their version by catalog_publish
// (migration 0055), never changed (the version is the snapshot a booking stores).
export const serviceResources = pgTable(
  "service_resources",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    versionId: uuid("version_id").notNull(),
    kind: text("kind", { enum: ["room", "device"] }).notNull(),
    code: text("code").notNull(),
    required: boolean("required").notNull().default(true),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.versionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    unique("service_resources_tenant_id_id_key").on(t.tenantId, t.id),
    unique("service_resources_version_code_key").on(t.tenantId, t.versionId, t.kind, t.code),
    check("service_resources_code_check", sql`${t.kind} = 'room' and ${t.code} in ('consultation','treatment','pharmacy')
      or ${t.kind} = 'device' and ${t.code} in ('laser','laser_ablative','laser_non_ablative','ipl','rf','hifu','microneedling_device','centrifuge','facial_machine')`),
  ],
);

export const serviceStaffEligibility = pgTable(
  "service_staff_eligibility",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    versionId: uuid("version_id").notNull(),
    role: text("role", { enum: ELIGIBLE_PROFESSIONS }),
    staffId: uuid("staff_id"),
    mode: text("mode", { enum: DELEGATION_MODES }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.versionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("service_staff_eligibility_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("service_staff_eligibility_role_key").on(t.tenantId, t.versionId, t.role).where(sql`${t.role} is not null`),
    uniqueIndex("service_staff_eligibility_staff_key").on(t.tenantId, t.versionId, t.staffId).where(sql`${t.staffId} is not null`),
    check("service_staff_eligibility_target_check", sql`(${t.role} is null) <> (${t.staffId} is null) and (${t.role} is null or ${t.role} in ('doctor','nurse','therapist'))`),
    check("service_staff_eligibility_mode_check", sql`${t.mode} in ('performs','supervised','assists')`),
  ],
);

// The fixed legal delegation floor (class F; DEC-047 (3), CD-16, pending the clinical lead Q-07):
// a platform table seeded by the migration, mirrored in src/modules/catalog/service/floor.ts.
export const delegationFloor = pgTable(
  "delegation_floor",
  {
    category: text("category", { enum: SERVICE_CATEGORIES }).notNull(),
    profession: text("profession", { enum: ELIGIBLE_PROFESSIONS }).notNull(),
    maxMode: text("max_mode", { enum: ["performs", "supervised", "assists", "none"] }).notNull(),
  },
  (t) => [
    unique("delegation_floor_key").on(t.category, t.profession),
    check("delegation_floor_mode_check", sql`${t.maxMode} in ('performs','supervised','assists','none')`),
  ],
);

// Branch price overrides (PR-42, B-08, SET-5; T-035). Owner only, effective-dated, keyed by catalog
// item (not version), so an override holds across new catalog versions until the Owner changes or
// ends it; invoices snapshot the version and the effective price (DATA-6). price null = back to the
// normal price from effective_from. Rows never change except active -> cancelled before they take
// effect; written only by branch_price_set / branch_price_cancel (migration 0056).
export const branchPrices = pgTable(
  "branch_prices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    price: bigint("price", { mode: "number" }), // integer rupiah, or null = normal price
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    state: text("state", { enum: ["active", "cancelled"] }).notNull().default("active"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.cancelledBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("branch_prices_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("branch_prices_one_active_per_time").on(t.tenantId, t.branchId, t.itemId, t.effectiveFrom).where(sql`${t.state} = 'active'`),
    check("branch_prices_price_check", sql`${t.price} is null or ${t.price} between 1 and 1000000000000`),
    check("branch_prices_state_check", sql`${t.state} in ('active','cancelled')`),
    check("branch_prices_cancel_check", sql`(${t.state} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null)`),
    check("branch_prices_owner_check", sql`${t.createdAs} = 'owner'`),
    check("branch_prices_reason_check", sql`length(btrim(${t.reason})) between 3 and 500`),
  ],
);
