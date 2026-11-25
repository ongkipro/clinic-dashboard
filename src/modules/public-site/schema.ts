// Public site schema (PR-64, PR-65, UX-50, UX-51; T-123, T-129).
// Closes Findings #1, #2, #6, #7 of t123/WAVE1-PLAN-REVISED-20261124.md:
// - public_sites, public_site_versions, public_web_fields: TEN-19 'never' (no vendor support read).
// - vendor_legal_templates: platform-level plain-text legal templates with allowlisted placeholders.
// - Slug immutability driven strictly by first_published_at IS NOT NULL (never published_version IS NULL).
// - Optional permissions (tariff_list_allowed, doctor_titles_allowed, default false) bound to the exact
//   approved counsel_approval_id on evidence_approvals; serve-time checks verify the approval is still
//   current, non-revoked, and non-expired against clock_timestamp() (Asia/Jakarta date).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { catalogItems } from "../catalog/schema";
import { evidenceApprovals } from "../compliance/schema";
import { staff, tenants } from "../org/schema";

export const SITE_STATES = ["draft", "published", "unpublished"] as const;
export const LEGAL_TEMPLATE_KINDS = [
  "kebijakan-privasi",
  "syarat-ketentuan",
  "kebijakan-pembatalan",
] as const;

export const publicSites = pgTable(
  "public_sites",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    slug: text("slug").notNull(),
    state: text("state", { enum: SITE_STATES }).notNull().default("draft"),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    publishedVersion: integer("published_version"),
    brandName: text("brand_name").notNull(),
    accentHex: text("accent_hex"),
    heroPhoto: text("hero_photo"),
    oneLine: text("one_line"),
    showTreatments: boolean("show_treatments").notNull().default(true),
    showBranches: boolean("show_branches").notNull().default(true),
    showDoctors: boolean("show_doctors").notNull().default(false),
    // Optional counsel-scoped permissions (default false, Finding #2): bound to counsel_approval_id.
    tariffListAllowed: boolean("tariff_list_allowed").notNull().default(false),
    doctorTitlesAllowed: boolean("doctor_titles_allowed").notNull().default(false),
    counselApprovalId: uuid("counsel_approval_id"),
    // Consented marketing pixel config (PR-39, T-127; stored here, gated on home & branch only).
    metaPixelId: text("meta_pixel_id"),
    gaMeasurementId: text("ga_measurement_id"),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.updatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.counselApprovalId],
      foreignColumns: [evidenceApprovals.tenantId, evidenceApprovals.id],
    }).onDelete("restrict"),
    unique("public_sites_tenant_id_key").on(t.tenantId),
    unique("public_sites_tenant_id_id_key").on(t.tenantId, t.id),
    unique("public_sites_slug_key").on(t.slug),
    check("public_sites_slug_check", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'`),
    check("public_sites_state_check", sql`${t.state} in ('draft','published','unpublished')`),
    check(
      "public_sites_published_state_check",
      sql`(${t.state} = 'published') = (${t.publishedVersion} is not null)
        and (${t.publishedVersion} is null or ${t.firstPublishedAt} is not null)
        and (${t.publishedVersion} is null or ${t.counselApprovalId} is not null)`,
    ),
    check(
      "public_sites_brand_check",
      sql`length(btrim(${t.brandName})) between 2 and 120`,
    ),
    check("public_sites_accent_check", sql`${t.accentHex} is null or ${t.accentHex} ~ '^#[0-9a-fA-F]{6}$'`),
    check(
      "public_sites_hero_photo_check",
      sql`${t.heroPhoto} is null or ${t.heroPhoto} ~ '^/media/public/[a-z0-9-]+/[a-f0-9]{64}\\.(jpg|jpeg|png|webp)$'`,
    ),
    check("public_sites_one_line_check", sql`${t.oneLine} is null or length(btrim(${t.oneLine})) <= 160`),
    check(
      "public_sites_counsel_permissions_check",
      sql`(not ${t.tariffListAllowed} and not ${t.doctorTitlesAllowed}) or ${t.counselApprovalId} is not null`,
    ),
    check("public_sites_meta_pixel_check", sql`${t.metaPixelId} is null or ${t.metaPixelId} ~ '^[0-9]{8,20}$'`),
    check("public_sites_ga_check", sql`${t.gaMeasurementId} is null or ${t.gaMeasurementId} ~ '^G-[A-Z0-9]{6,16}$'`),
  ],
).enableRLS();

export const publicSiteVersions = pgTable(
  "public_site_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    siteId: uuid("site_id").notNull(),
    version: integer("version").notNull(),
    slug: text("slug").notNull(),
    counselApprovalId: uuid("counsel_approval_id").notNull(),
    tariffListAllowed: boolean("tariff_list_allowed").notNull().default(false),
    doctorTitlesAllowed: boolean("doctor_titles_allowed").notNull().default(false),
    // Canonical PublicSiteDto snapshot (zero UUIDs/tenantId; verified by SQL against locked sources).
    snapshot: jsonb("snapshot").notNull(),
    snapshotSha256: text("snapshot_sha256").notNull(),
    publishedBy: uuid("published_by").notNull(),
    publishedAs: text("published_as").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [publicSites.tenantId, publicSites.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.publishedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.counselApprovalId],
      foreignColumns: [evidenceApprovals.tenantId, evidenceApprovals.id],
    }).onDelete("restrict"),
    unique("public_site_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("public_site_versions_tenant_version_key").on(t.tenantId, t.version),
    check("public_site_versions_version_check", sql`${t.version} >= 1`),
    check("public_site_versions_sha_check", sql`${t.snapshotSha256} ~ '^[0-9a-f]{64}$'`),
    check("public_site_versions_snapshot_check", sql`jsonb_typeof(${t.snapshot}) = 'object'`),
  ],
).enableRLS();

// Per-service public web fields (UX-50, PR-64, PR-65). Strictly separate from clinical master;
// publishing requires clinical_reviewed_version = current active catalog_versions.version AND
// clinical_reviewed_artifact_sha matching the canonical artifact digest.
export const publicWebFields = pgTable(
  "public_web_fields",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    publicSlug: text("public_slug").notNull(),
    published: boolean("published").notNull().default(false),
    publishPrice: boolean("publish_price").notNull().default(false),
    purpose: text("purpose").notNull(),
    performedBy: text("performed_by").notNull(),
    downtime: text("downtime"),
    sessions: integer("sessions"),
    intervalDays: integer("interval_days"),
    priceNote: text("price_note"),
    heroPhoto: text("hero_photo"),
    heroAlt: text("hero_alt"),
    caption: text("caption"),
    clinicalReviewedVersion: integer("clinical_reviewed_version"),
    clinicalReviewedArtifactSha: text("clinical_reviewed_artifact_sha"),
    clinicalReviewedBy: uuid("clinical_reviewed_by"),
    clinicalReviewedAt: timestamp("clinical_reviewed_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.updatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.clinicalReviewedBy],
      foreignColumns: [staff.tenantId, staff.id],
    }).onDelete("restrict"),
    unique("public_web_fields_tenant_id_id_key").on(t.tenantId, t.id),
    unique("public_web_fields_tenant_item_key").on(t.tenantId, t.itemId),
    unique("public_web_fields_tenant_slug_key").on(t.tenantId, t.publicSlug),
    check("public_web_fields_slug_check", sql`${t.publicSlug} ~ '^[a-z0-9][a-z0-9-]{0,127}$'`),
    check("public_web_fields_purpose_check", sql`length(btrim(${t.purpose})) between 3 and 2000`),
    check("public_web_fields_performed_by_check", sql`length(btrim(${t.performedBy})) between 2 and 120`),
    check("public_web_fields_downtime_check", sql`${t.downtime} is null or length(btrim(${t.downtime})) <= 200`),
    check("public_web_fields_sessions_check", sql`${t.sessions} is null or ${t.sessions} between 1 and 50`),
    check("public_web_fields_interval_check", sql`${t.intervalDays} is null or ${t.intervalDays} between 1 and 365`),
    check("public_web_fields_price_note_check", sql`${t.priceNote} is null or length(btrim(${t.priceNote})) <= 200`),
    check(
      "public_web_fields_hero_photo_check",
      sql`${t.heroPhoto} is null or ${t.heroPhoto} ~ '^/media/public/[a-z0-9-]+/[a-f0-9]{64}\\.(jpg|jpeg|png|webp)$'`,
    ),
    check("public_web_fields_hero_alt_check", sql`${t.heroAlt} is null or length(btrim(${t.heroAlt})) <= 160`),
    check("public_web_fields_caption_check", sql`${t.caption} is null or length(btrim(${t.caption})) <= 240`),
    check(
      "public_web_fields_review_sha_check",
      sql`${t.clinicalReviewedArtifactSha} is null or ${t.clinicalReviewedArtifactSha} ~ '^[0-9a-f]{64}$'`,
    ),
    index("public_web_fields_tenant_published_idx").on(t.tenantId, t.published),
  ],
).enableRLS();

// Platform-owned plain-text legal page templates (T-123 default read, T-129 vendor management).
// Plain text + allowlisted placeholders ONLY (no HTML/Markdown/script).
export const vendorLegalTemplates = pgTable(
  "vendor_legal_templates",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    kind: text("kind", { enum: LEGAL_TEMPLATE_KINDS }).notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    bodySha256: text("body_sha256").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("vendor_legal_templates_kind_version_key").on(t.kind, t.version),
    uniqueIndex("vendor_legal_templates_one_active").on(t.kind).where(sql`${t.isActive}`),
    check(
      "vendor_legal_templates_kind_check",
      sql`${t.kind} in ('kebijakan-privasi','syarat-ketentuan','kebijakan-pembatalan')`,
    ),
    check("vendor_legal_templates_version_check", sql`${t.version} >= 1`),
    check("vendor_legal_templates_body_check", sql`length(btrim(${t.body})) between 20 and 50000 and ${t.body} !~ '[<>]'`),
    check("vendor_legal_templates_sha_check", sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`),
  ],
).enableRLS();
