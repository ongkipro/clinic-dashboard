// Document templates (UX-54, SET-32, PR-74, DATA-53) and signed medical letters (PR-74, DATA-19; T-058,
// migration 0075; DEC-067). Templates: one row per template of a kind (struk, persetujuan, surat, halaman legal)
// with insert-only versions; a version is frozen once a letter used it ("Versi sudah dipakai — buat versi
// baru"). Policy kind: config (no patient data; the writer refuses MRN and NIK patterns). Letters: a doctor's
// surat keterangan, rujukan or resume medis for a visit, drafted from a letter template, signed by its author and
// stored as part of the medical record; a signed letter changes only by a new version (within 48 h by the author,
// later through the record_late_correction approval). Policy kind: clinical.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { examinations } from "../clinical/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { visits } from "../visits/schema";

const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

export const TEMPLATE_KINDS = ["receipt", "consent", "letter", "legal"] as const;
export const LETTER_TYPES = ["surat_keterangan", "rujukan", "resume"] as const;
export const TEMPLATE_STATES = ["active", "retired"] as const;
export const PAPER_SIZES = ["a4", "80mm", "58mm"] as const;
export const LETTER_STATES = ["draft", "signed"] as const;
export const LETTER_VERSION_KINDS = ["original", "correction"] as const;
export const LETTER_CORRECTION_STATES = ["pending", "approved", "rejected", "cancelled"] as const;
const WRITERS = ["owner", "admin_pusat", "facility_head"] as const;

export const documentTemplates = pgTable(
  "document_templates",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind", { enum: TEMPLATE_KINDS }).notNull(),
    letterType: text("letter_type", { enum: LETTER_TYPES }),
    name: text("name").notNull(),
    state: text("state", { enum: TEMPLATE_STATES }).notNull().default("active"),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredBy: uuid("retired_by"),
    retiredAs: text("retired_as"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "document_templates_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "document_templates_retired_by_fk", columns: [t.tenantId, t.retiredBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("document_templates_tenant_id_id_key").on(t.tenantId, t.id),
    unique("document_templates_tenant_kind_id_key").on(t.tenantId, t.kind, t.id),
    index("document_templates_kind_idx").on(t.tenantId, t.kind, t.state),
    check("document_templates_check", sql`${t.kind} in (${inList(TEMPLATE_KINDS)}) and ((${t.kind} = 'letter') = (${t.letterType} is not null))
      and (${t.letterType} is null or ${t.letterType} in (${inList(LETTER_TYPES)})) and length(btrim(${t.name})) between 3 and 120
      and ${t.createdAs} in (${inList(WRITERS)}) and ${t.state} in (${inList(TEMPLATE_STATES)})
      and ((${t.state} = 'retired') = (num_nonnulls(${t.retiredAt}, ${t.retiredBy}, ${t.retiredAs}) = 3)) and num_nonnulls(${t.retiredAt}, ${t.retiredBy}, ${t.retiredAs}) in (0, 3)`),
  ],
);

export const documentTemplateVersions = pgTable(
  "document_template_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    templateId: uuid("template_id").notNull(),
    kind: text("kind", { enum: TEMPLATE_KINDS }).notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    paper: text("paper", { enum: PAPER_SIZES }).notNull(),
    state: text("state", { enum: TEMPLATE_STATES }).notNull().default("active"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "document_template_versions_template_fk", columns: [t.tenantId, t.kind, t.templateId], foreignColumns: [documentTemplates.tenantId, documentTemplates.kind, documentTemplates.id] }).onDelete("restrict"),
    foreignKey({ name: "document_template_versions_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("document_template_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("document_template_versions_number_key").on(t.tenantId, t.templateId, t.version),
    uniqueIndex("document_template_versions_one_active").on(t.tenantId, t.templateId).where(sql`state = 'active'`),
    check("document_template_versions_check", sql`${t.version} >= 1 and length(${t.body}) between 10 and 20000 and ${t.paper} in (${inList(PAPER_SIZES)})
      and (${t.kind} = 'receipt' or ${t.paper} = 'a4') and ${t.state} in (${inList(TEMPLATE_STATES)}) and ${t.createdAs} in (${inList(WRITERS)})`),
  ],
);

export const medicalLetters = pgTable(
  "medical_letters",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    examinationId: uuid("examination_id"),
    templateVersionId: uuid("template_version_id").notNull(),
    letterType: text("letter_type", { enum: LETTER_TYPES }).notNull(),
    state: text("state", { enum: LETTER_STATES }).notNull().default("draft"),
    body: text("body").notNull(),
    authorId: uuid("author_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedBy: uuid("signed_by"),
    signedAs: text("signed_as"),
    contentHash: text("content_hash"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letters_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letters_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letters_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letters_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letters_template_fk", columns: [t.tenantId, t.templateVersionId], foreignColumns: [documentTemplateVersions.tenantId, documentTemplateVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letters_author_fk", columns: [t.tenantId, t.authorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letters_signed_by_fk", columns: [t.tenantId, t.signedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("medical_letters_tenant_id_id_key").on(t.tenantId, t.id),
    unique("medical_letters_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    index("medical_letters_visit_idx").on(t.tenantId, t.visitId),
    index("medical_letters_patient_idx").on(t.tenantId, t.patientId),
    index("medical_letters_author_idx").on(t.tenantId, t.branchId, t.authorId, t.createdAt),
    check("medical_letters_check", sql`${t.letterType} in (${inList(LETTER_TYPES)}) and ${t.state} in (${inList(LETTER_STATES)})
      and length(btrim(${t.body})) between 10 and 40000
      and ((${t.state} = 'signed') = (num_nonnulls(${t.signedAt}, ${t.signedBy}, ${t.signedAs}, ${t.contentHash}) = 4))
      and num_nonnulls(${t.signedAt}, ${t.signedBy}, ${t.signedAs}, ${t.contentHash}) in (0, 4)
      and (${t.signedBy} is null or (${t.signedBy} = ${t.authorId} and ${t.signedAs} = 'doctor'))
      and (${t.contentHash} is null or ${t.contentHash} ~ '^[0-9a-f]{64}$')`),
  ],
);

export const medicalLetterVersions = pgTable(
  "medical_letter_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    letterId: uuid("letter_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind", { enum: LETTER_VERSION_KINDS }).notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    reason: text("reason"),
    approvalId: uuid("approval_id"),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letter_versions_letter_fk", columns: [t.tenantId, t.branchId, t.letterId], foreignColumns: [medicalLetters.tenantId, medicalLetters.branchId, medicalLetters.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letter_versions_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letter_versions_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("medical_letter_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("medical_letter_versions_number_key").on(t.tenantId, t.letterId, t.version),
    check("medical_letter_versions_check", sql`${t.version} >= 1 and ${t.kind} in (${inList(LETTER_VERSION_KINDS)})
      and ((${t.kind} = 'original') = (${t.version} = 1)) and ((${t.kind} = 'correction') = (${t.reason} is not null))
      and (${t.approvalId} is null or ${t.kind} = 'correction') and (${t.reason} is null or length(btrim(${t.reason})) between 3 and 500)
      and length(btrim(${t.body})) between 10 and 40000 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.createdAs} = 'doctor'`),
  ],
);

export const medicalLetterCorrections = pgTable(
  "medical_letter_corrections",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    letterId: uuid("letter_id").notNull(),
    body: text("body").notNull(),
    reason: text("reason").notNull(),
    state: text("state", { enum: LETTER_CORRECTION_STATES }).notNull().default("pending"),
    approvalId: uuid("approval_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    requestedAs: text("requested_as").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    versionId: uuid("version_id"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letter_corrections_letter_fk", columns: [t.tenantId, t.branchId, t.letterId], foreignColumns: [medicalLetters.tenantId, medicalLetters.branchId, medicalLetters.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letter_corrections_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letter_corrections_by_fk", columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "medical_letter_corrections_version_fk", columns: [t.tenantId, t.versionId], foreignColumns: [medicalLetterVersions.tenantId, medicalLetterVersions.id] }).onDelete("restrict"),
    unique("medical_letter_corrections_tenant_id_id_key").on(t.tenantId, t.id),
    unique("medical_letter_corrections_approval_key").on(t.tenantId, t.approvalId),
    uniqueIndex("medical_letter_corrections_one_pending").on(t.tenantId, t.letterId).where(sql`state = 'pending'`),
    check("medical_letter_corrections_check", sql`${t.state} in (${inList(LETTER_CORRECTION_STATES)}) and ${t.requestedAs} = 'doctor'
      and length(btrim(${t.body})) between 10 and 40000 and length(btrim(${t.reason})) between 3 and 500
      and ((${t.state} = 'pending') = (${t.decidedAt} is null)) and ((${t.state} = 'approved') = (${t.versionId} is not null))`),
  ],
);
