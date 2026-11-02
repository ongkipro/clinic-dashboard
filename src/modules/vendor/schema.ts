import { sql } from "drizzle-orm";
import { boolean, check, date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUser } from "../../auth/schema";

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

// Vendor profile (DATA-47, PR-55, S-04, H-02d). One row (id = 1), policy kind platform:
// only the platform operator connection writes it; the clinic app reads the public
// identity through the vendor_identity() security-definer function. A field listed in
// `placeholder_fields`, or still holding a "[...]" placeholder, is shown marked and
// blocks production go-live. Storage locations are declared per kind (PR-36); the
// residency opinion (H-02d) is set by the product owner only (profile module) and every
// change is recorded in vendor_profile_changes.
export const VENDOR_PROFILE_FIELDS = [
  "legal_name",
  "nib",
  "pse_number",
  "npwp",
  "meta_business_id",
  "website",
  "privacy_url",
  "support_email",
  "support_phone",
] as const;
export type VendorProfileField = (typeof VENDOR_PROFILE_FIELDS)[number];

export const STORAGE_KINDS = ["database", "object_storage", "backups", "logs", "error_tracking"] as const;

export const vendorProfile = pgTable(
  "vendor_profile",
  {
    id: integer("id").primaryKey().default(1),
    legalName: text("legal_name").notNull(),
    nib: text("nib").notNull(),
    pseNumber: text("pse_number").notNull(),
    npwp: text("npwp").notNull(),
    metaBusinessId: text("meta_business_id").notNull(),
    website: text("website").notNull(),
    privacyUrl: text("privacy_url").notNull(),
    supportEmail: text("support_email").notNull(),
    supportPhone: text("support_phone").notNull(),
    placeholderFields: text("placeholder_fields").array().notNull().default(sql`'{}'::text[]`),
    // [{ kind, provider, region, country }] with country an ISO 3166-1 alpha-2 code.
    storageLocations: jsonb("storage_locations").notNull().default(sql`'[]'::jsonb`),
    // Vendor tax profile (DATA-47); the evidence item arrives with the compliance register.
    isPkp: boolean("is_pkp").notNull().default(false),
    pkpEffectiveFrom: date("pkp_effective_from"),
    taxEvidenceRef: text("tax_evidence_ref"),
    residencyOpinionRef: text("residency_opinion_ref"),
    residencyOpinionDate: date("residency_opinion_date"),
    residencyOpinionOutcome: text("residency_opinion_outcome", { enum: ["positive", "negative"] }),
    residencyOpinionSetBy: uuid("residency_opinion_set_by").references(() => authUser.id, { onDelete: "restrict" }),
    residencyOpinionChecksum: text("residency_opinion_checksum"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("vendor_profile_singleton_check", sql`${t.id} = 1`),
    // No empty identity value can pass as "filled" (placeholder detection fails closed).
    check(
      "vendor_profile_not_blank_check",
      sql.raw(
        VENDOR_PROFILE_FIELDS.map((f) => `btrim("${f}") <> ''`).join(" and "),
      ),
    ),
    check("vendor_profile_tax_evidence_check", sql`${t.taxEvidenceRef} is null or btrim(${t.taxEvidenceRef}) <> ''`),
    check(
      "vendor_profile_placeholder_fields_check",
      sql`${t.placeholderFields} <@ array[${sql.raw(VENDOR_PROFILE_FIELDS.map((f) => `'${f}'`).join(","))}]::text[]`,
    ),
    check("vendor_profile_storage_locations_check", sql`jsonb_typeof(${t.storageLocations}) = 'array'`),
    check("vendor_profile_pkp_check", sql`not ${t.isPkp} or (${t.pkpEffectiveFrom} is not null and ${t.taxEvidenceRef} is not null)`),
    check(
      "vendor_profile_residency_check",
      sql`(${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionRef} is null)
       and (${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionDate} is null)
       and (${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionSetBy} is null)
       and (${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionChecksum} is null)
       and (${t.residencyOpinionOutcome} is null or ${t.residencyOpinionOutcome} in ('positive','negative'))
       and (${t.residencyOpinionChecksum} is null or ${t.residencyOpinionChecksum} ~ '^[0-9a-f]{64}$')`,
    ),
  ],
);

// Append-only history of profile changes (PR-55 "audited"): who, in which vendor role,
// which field, old and new value. Values are vendor business identity, never personal
// or clinical data.
export const vendorProfileChanges = pgTable(
  "vendor_profile_changes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorAccountId: uuid("actor_account_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "restrict" }),
    actorRole: text("actor_role").notNull(),
    field: text("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    reason: text("reason").notNull(),
  },
  (t) => [
    check("vendor_profile_changes_role_check", sql`${t.actorRole} ~ '^[a-z][a-z_]{1,40}$'`),
    check("vendor_profile_changes_field_check", sql`${t.field} ~ '^[a-z][a-z_]{1,40}$'`),
    check("vendor_profile_changes_reason_check", sql`length(btrim(${t.reason})) between 3 and 500`),
  ],
);
