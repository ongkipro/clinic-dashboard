// Patients (PR-5, DATA-13, DATA-8; T-037). Policy kind: tenant-shared. One patient belongs to one
// tenant (DATA-56) and one MRN serves all branches. The identity number (NIK, passport, KITAS) is
// stored only encrypted (identity_enc, AES-256-GCM under the tenant data key) with a blind index
// (identity_bidx, HMAC) for equality lookup; clinic_app cannot select either column. Patients are
// never deleted (PRIV-3, S-05). Writes go only through patient_register (migration 0058).
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, bigint, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

export const IDENTITY_TYPES = ["nik", "passport", "kitas", "newborn_via_guardian"] as const;
export const SEXES = ["female", "male"] as const;
// Permenkes 24/2022 Pasal 14(4) social data; closed lists with "lainnya".
export const RELIGIONS = ["islam", "kristen", "katolik", "hindu", "buddha", "konghucu", "lainnya"] as const;
export const EDUCATIONS = ["tidak_sekolah", "sd", "smp", "sma", "diploma", "s1", "s2", "s3", "lainnya"] as const;
export const MARITAL_STATUSES = ["belum_kawin", "kawin", "cerai_hidup", "cerai_mati"] as const;
export const GUARDIAN_RELATIONS = ["ayah", "ibu", "wali", "lainnya"] as const;

// Tenant data keys (DATA-8, ARCH-7): one wrapped DEK per tenant and version. Platform table: no
// grant to the app; wrapped values are useless without the KEK, which never touches the database.
export const tenantDataKeys = pgTable(
  "tenant_data_keys",
  {
    tenantId: uuid("tenant_id").notNull(),
    version: integer("version").notNull(),
    wrapped: text("wrapped").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.version] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    uniqueIndex("tenant_data_keys_one_current").on(t.tenantId).where(sql`${t.isCurrent}`),
    check("tenant_data_keys_version_check", sql`${t.version} >= 1`),
    check("tenant_data_keys_wrapped_check", sql`${t.wrapped} ~ '^k1\\.[1-9][0-9]{0,8}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`),
  ],
);

// The gap-free MRN counter per tenant (19:340, class F). Platform table: no grant.
export const patientMrnCounters = pgTable(
  "patient_mrn_counters",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    check("patient_mrn_counters_seq_check", sql`${t.lastSeq} >= 1`),
  ],
);

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    mrn: text("mrn").notNull(),
    fullName: text("full_name").notNull(),
    birthDate: date("birth_date").notNull(),
    sex: text("sex", { enum: SEXES }).notNull(),
    identityType: text("identity_type", { enum: IDENTITY_TYPES }).notNull(),
    identityEnc: text("identity_enc"),
    identityBidx: text("identity_bidx"),
    noIdentityReason: text("no_identity_reason"),
    religion: text("religion", { enum: RELIGIONS }).notNull(),
    occupation: text("occupation").notNull(),
    education: text("education", { enum: EDUCATIONS }).notNull(),
    maritalStatus: text("marital_status", { enum: MARITAL_STATUSES }).notNull(),
    address: text("address"),
    ihsPatientId: text("ihs_patient_id"), // SATUSEHAT, later milestone
    registeredBranchId: uuid("registered_branch_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.registeredBranchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("patients_tenant_id_id_key").on(t.tenantId, t.id),
    unique("patients_tenant_mrn_key").on(t.tenantId, t.mrn),
    uniqueIndex("patients_tenant_identity_key").on(t.tenantId, t.identityBidx).where(sql`${t.identityBidx} is not null`),
    check("patients_mrn_check", sql`${t.mrn} ~ '^RM-[0-9]{6,}$'`),
    check("patients_name_check", sql`length(btrim(${t.fullName})) between 2 and 120`),
    check("patients_birth_check", sql`${t.birthDate} >= date '1900-01-01'`),
    check("patients_sex_check", sql`${t.sex} in ('female','male')`),
    check("patients_identity_check", sql`(${t.identityType} = 'nik' and ${t.identityEnc} is not null and ${t.identityBidx} is not null and ${t.noIdentityReason} is null)
      or (${t.identityType} in ('passport','kitas') and ${t.identityEnc} is not null and ${t.identityBidx} is not null and length(btrim(coalesce(${t.noIdentityReason}, ''))) between 3 and 300)
      or (${t.identityType} = 'newborn_via_guardian' and ${t.identityEnc} is null and ${t.identityBidx} is null and length(btrim(coalesce(${t.noIdentityReason}, ''))) between 3 and 300)`),
    check("patients_identity_enc_check", sql`${t.identityEnc} is null or ${t.identityEnc} ~ '^v1\\.[1-9][0-9]{0,8}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`),
    check("patients_identity_bidx_check", sql`${t.identityBidx} is null or ${t.identityBidx} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("patients_social_check", sql`${t.religion} in ('islam','kristen','katolik','hindu','buddha','konghucu','lainnya')
      and ${t.education} in ('tidak_sekolah','sd','smp','sma','diploma','s1','s2','s3','lainnya')
      and ${t.maritalStatus} in ('belum_kawin','kawin','cerai_hidup','cerai_mati')
      and length(btrim(${t.occupation})) between 2 and 80`),
    check("patients_address_check", sql`${t.address} is null or length(${t.address}) <= 300`),
  ],
);

export const contactPoints = pgTable(
  "contact_points",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    kind: text("kind", { enum: ["phone"] }).notNull(),
    value: text("value").notNull(), // E.164, not unique across patients (PR-5)
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    unique("contact_points_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("contact_points_one_primary").on(t.tenantId, t.patientId, t.kind).where(sql`${t.isPrimary}`),
    check("contact_points_kind_check", sql`${t.kind} in ('phone')`),
    check("contact_points_phone_check", sql`${t.kind} <> 'phone' or ${t.value} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

export const guardians = pgTable(
  "guardians",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    guardianName: text("guardian_name").notNull(),
    relation: text("relation", { enum: GUARDIAN_RELATIONS }).notNull(),
    phone: text("phone"),
    guardianPatientId: uuid("guardian_patient_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.guardianPatientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    unique("guardians_tenant_id_id_key").on(t.tenantId, t.id),
    check("guardians_name_check", sql`length(btrim(${t.guardianName})) between 2 and 120`),
    check("guardians_relation_check", sql`${t.relation} in ('ayah','ibu','wali','lainnya')`),
    check("guardians_phone_check", sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("guardians_self_check", sql`${t.guardianPatientId} is null or ${t.guardianPatientId} <> ${t.patientId}`),
  ],
);

// Consents (PR-4, DATA-14, DATA-66; T-038, DEC-052). Purposes from the PRIV-1 matrix; `procedure` texts
// may be published but procedure consent itself is captured per plan item and dose by UX-39 (T-054).
export const CONSENT_PURPOSES = ["care_notice", "procedure", "clinical_photo", "marketing_wa", "publication"] as const;
export const CONSENT_CHANNELS = ["in_person", "paper", "whatsapp", "phone"] as const;

// Consent texts: insert-only versions per tenant and purpose (a change is a new version).
export const consentTexts = pgTable(
  "consent_texts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    purpose: text("purpose", { enum: CONSENT_PURPOSES }).notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("consent_texts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("consent_texts_tenant_id_id_purpose_key").on(t.tenantId, t.id, t.purpose),
    unique("consent_texts_version_key").on(t.tenantId, t.purpose, t.version),
    check("consent_texts_purpose_check", sql`${t.purpose} in ('care_notice','procedure','clinical_photo','marketing_wa','publication')`),
    check("consent_texts_version_check", sql`${t.version} >= 1`),
    check("consent_texts_body_check", sql`length(btrim(${t.body})) between 1 and 8000`),
    check("consent_texts_created_as_check", sql`${t.createdAs} in ('owner','admin_pusat')`),
    check("consent_texts_effective_check", sql`${t.effectiveFrom} >= ${t.createdAt}`),
  ],
);

// The consent ledger: one row per grant; withdrawal fields are set once. A new grant after a
// withdrawal is a new row, so the rows are the history.
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    purpose: text("purpose", { enum: CONSENT_PURPOSES }).notNull(),
    consentTextId: uuid("consent_text_id").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    grantedBy: uuid("granted_by").notNull(),
    grantedAs: text("granted_as").notNull(),
    grantChannel: text("grant_channel", { enum: CONSENT_CHANNELS }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: uuid("withdrawn_by"),
    withdrawnAs: text("withdrawn_as"),
    withdrawChannel: text("withdraw_channel", { enum: CONSENT_CHANNELS }),
    withdrawReason: text("withdraw_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    // Named explicitly: the generated name exceeds PostgreSQL's 63-character identifier limit.
    foreignKey({ name: "consents_text_purpose_fk", columns: [t.tenantId, t.consentTextId, t.purpose], foreignColumns: [consentTexts.tenantId, consentTexts.id, consentTexts.purpose] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.grantedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.withdrawnBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("consents_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("consents_one_active").on(t.tenantId, t.patientId, t.purpose).where(sql`${t.withdrawnAt} is null`),
    check("consents_purpose_check", sql`${t.purpose} in ('care_notice','clinical_photo','marketing_wa','publication')`),
    check("consents_channel_check", sql`${t.grantChannel} in ('in_person','paper','whatsapp','phone') and (${t.withdrawChannel} is null or ${t.withdrawChannel} in ('in_person','paper','whatsapp','phone'))`),
    check("consents_role_check", sql`${t.grantedAs} in ('fo_cashier','central_cs','bc','doctor','records_officer','manager') and (${t.withdrawnAs} is null or ${t.withdrawnAs} in ('fo_cashier','central_cs','bc','doctor','records_officer','manager'))`),
    check("consents_withdrawal_check", sql`(${t.withdrawnAt} is null and ${t.withdrawnBy} is null and ${t.withdrawnAs} is null and ${t.withdrawChannel} is null and ${t.withdrawReason} is null)
      or (${t.withdrawnAt} is not null and ${t.withdrawnBy} is not null and ${t.withdrawnAs} is not null and ${t.withdrawChannel} is not null
          and ${t.withdrawReason} is not null and length(btrim(${t.withdrawReason})) between 3 and 500 and ${t.withdrawnAt} >= ${t.grantedAt})`),
  ],
);
