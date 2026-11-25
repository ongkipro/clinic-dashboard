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
  customType,
  date,
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
import { catalogItems, catalogVersions } from "../catalog/schema";
import { evidenceApprovals } from "../compliance/schema";
import { branches, staff, tenants } from "../org/schema";
import { appointments } from "../scheduling/schema";

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

// Server-bound public booking intents & OTP challenges (PR-67, DATA-56, UX-24, OD-1 Option B; T-126).
// TEN-19 'never' (zero vendor support read), RLS enabled with zero direct clinic_app grants;
// phone_e164, patient_name, birth_date, and sex are cleared (NULL) on consumption, lockout, or expiry purge.
export const publicBookingIntents = pgTable(
  "public_booking_intents",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    intentHash: text("intent_hash").notNull(),
    branchId: uuid("branch_id").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    doctorStaffId: uuid("doctor_staff_id"),
    doctorConsentId: uuid("doctor_consent_id"),
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    sourceTag: text("source_tag").notNull(),
    phoneE164: text("phone_e164"),
    phoneHash: text("phone_hash").notNull(),
    patientName: text("patient_name"),
    birthDate: date("birth_date"),
    sex: text("sex", { enum: ["female", "male"] }),
    otpHash: text("otp_hash").notNull(),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }).notNull(),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    resendCount: integer("resend_count").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    ipHash: text("ip_hash").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    appointmentId: uuid("appointment_id"),
    commandKey: text("command_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "public_booking_intents_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "public_booking_intents_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "public_booking_intents_doctor_fk", columns: [t.tenantId, t.doctorStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "public_booking_intents_doctor_consent_fk", columns: [t.tenantId, t.doctorConsentId], foreignColumns: [doctorListingConsents.tenantId, doctorListingConsents.id] }).onDelete("restrict"),
    foreignKey({ name: "public_booking_intents_appt_fk", columns: [t.tenantId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.id] }).onDelete("restrict"),
    check("public_booking_intents_doctor_consent_chk", sql`(${t.doctorStaffId} is null and ${t.doctorConsentId} is null) or (${t.doctorStaffId} is not null and ${t.doctorConsentId} is not null)`),
    unique("public_booking_intents_tenant_id_id_key").on(t.tenantId, t.id),
    unique("public_booking_intents_hash_key").on(t.tenantId, t.intentHash),
    unique("public_booking_intents_cmd_key").on(t.tenantId, t.commandKey),
    check("public_booking_intents_intent_hash_chk", sql`${t.intentHash} ~ '^[0-9a-f]{64}$'`),
    check("public_booking_intents_otp_hash_chk", sql`${t.otpHash} ~ '^[0-9a-f]{64}$'`),
    check("public_booking_intents_phone_hash_chk", sql`${t.phoneHash} ~ '^[0-9a-f]{64}$'`),
    check("public_booking_intents_ip_hash_chk", sql`${t.ipHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "public_booking_intents_pii_chk",
      sql`(${t.consumedAt} is null and ${t.purgedAt} is null and ${t.phoneE164} is not null and ${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$' and ${t.patientName} is not null and length(btrim(${t.patientName})) between 2 and 120 and ${t.birthDate} is not null and ${t.birthDate} >= date '1900-01-01' and ${t.sex} is not null and ${t.sex} in ('female','male')) or ((${t.consumedAt} is not null or ${t.purgedAt} is not null) and ${t.phoneE164} is null and ${t.patientName} is null and ${t.birthDate} is null and ${t.sex} is null)`,
    ),
    check("public_booking_intents_source_chk", sql`${t.sourceTag} ~ '^situs(-[a-z0-9]{1,30})?$'`),
    check("public_booking_intents_attempts_chk", sql`${t.otpAttempts} between 0 and 5`),
    check("public_booking_intents_resend_chk", sql`${t.resendCount} between 0 and 5`),
    check("public_booking_intents_consumed_chk", sql`(${t.consumedAt} is null and ${t.appointmentId} is null and ${t.commandKey} is null) or (${t.consumedAt} is not null and ${t.appointmentId} is not null and ${t.commandKey} is not null)`),
    index("public_booking_intents_rate_phone_idx").on(t.tenantId, t.phoneHash, t.createdAt),
    index("public_booking_intents_rate_ip_idx").on(t.ipHash, t.createdAt),
  ],
).enableRLS();

// Doctor public listing consents with immediate purge on withdrawal (PR-66, UX-50, UX-51; T-125).
// TEN-19 'never', RLS enabled with zero direct clinic_app grants; monotone granted -> withdrawn history
// (never deleted); withdrawal atomically clears photo_ref and removes the doctor from live public reads.
export const DOCTOR_CONSENT_STATES = ["granted", "withdrawn"] as const;

export const doctorListingConsents = pgTable(
  "doctor_listing_consents",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    state: text("state", { enum: DOCTOR_CONSENT_STATES }).notNull().default("granted"),
    publicSlug: text("public_slug").notNull(),
    displayName: text("display_name").notNull(),
    title: text("title"),
    scheduleSummary: text("schedule_summary"),
    focusAreas: text("focus_areas").array().notNull().default(sql`'{}'::text[]`),
    showPhoto: boolean("show_photo").notNull().default(false),
    photoRef: text("photo_ref"),
    photoBytes: bytea("photo_bytes"),
    photoMediaType: text("photo_media_type"),
    showTitleAndSip: boolean("show_title_and_sip").notNull().default(false),
    acknowledgementRef: text("acknowledgement_ref"),
    consentSha256: text("consent_sha256").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    grantedBy: uuid("granted_by").notNull(),
    grantedAs: text("granted_as").notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: uuid("withdrawn_by"),
    withdrawnAs: text("withdrawn_as"),
    withdrawalReason: text("withdrawal_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "doctor_listing_consents_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "doctor_listing_consents_granted_by_fk", columns: [t.tenantId, t.grantedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "doctor_listing_consents_withdrawn_by_fk", columns: [t.tenantId, t.withdrawnBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("doctor_listing_consents_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("doctor_listing_consents_active_staff_uidx")
      .on(t.tenantId, t.staffId)
      .where(sql`${t.state} = 'granted'`),
    uniqueIndex("doctor_listing_consents_active_slug_uidx")
      .on(t.tenantId, t.publicSlug)
      .where(sql`${t.state} = 'granted'`),
    index("doctor_listing_consents_tenant_state_idx").on(t.tenantId, t.state),
    check("doctor_listing_consents_state_chk", sql`${t.state} in ('granted','withdrawn')`),
    check("doctor_listing_consents_slug_chk", sql`${t.publicSlug} ~ '^[a-z0-9][a-z0-9-]{1,59}$'`),
    check("doctor_listing_consents_name_chk", sql`length(btrim(${t.displayName})) between 2 and 120`),
    check("doctor_listing_consents_title_chk", sql`${t.title} is null or length(btrim(${t.title})) between 1 and 120`),
    check("doctor_listing_consents_schedule_chk", sql`${t.scheduleSummary} is null or length(btrim(${t.scheduleSummary})) between 2 and 240`),
    check("doctor_listing_consents_focus_chk", sql`cardinality(${t.focusAreas}) <= 12`),
    check(
      "doctor_listing_consents_photo_chk",
      sql`${t.photoRef} is null or ${t.photoRef} ~ '^/api/v1/public/doctor-photo/[a-z0-9-]+/[a-z0-9-]+\\?v=[0-9a-f]{24}$'`,
    ),
    check(
      "doctor_listing_consents_photo_bytes_chk",
      sql`(${t.photoBytes} is null and ${t.photoMediaType} is null and ${t.photoRef} is null)
       or (${t.photoBytes} is not null and octet_length(${t.photoBytes}) between 1 and 524288 and ${t.photoMediaType} in ('image/jpeg','image/png','image/webp') and ${t.photoRef} is not null)`,
    ),
    check(
      "doctor_listing_consents_photo_toggle_chk",
      sql`${t.showPhoto} or (${t.photoRef} is null and ${t.photoBytes} is null and ${t.photoMediaType} is null)`,
    ),
    check("doctor_listing_consents_ack_chk", sql`${t.acknowledgementRef} is null or length(btrim(${t.acknowledgementRef})) between 3 and 120`),
    check("doctor_listing_consents_sha_chk", sql`${t.consentSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "doctor_listing_consents_withdrawn_chk",
      sql`(${t.state} = 'granted' and ${t.withdrawnAt} is null and ${t.withdrawnBy} is null and ${t.withdrawnAs} is null)
       or (${t.state} = 'withdrawn' and ${t.withdrawnAt} is not null and ${t.withdrawnBy} is not null and ${t.withdrawnAs} is not null and ${t.photoRef} is null and ${t.photoBytes} is null and ${t.photoMediaType} is null)`,
    ),
  ],
).enableRLS();
