// Clinical module schemas (DATA-18, DATA-19). Policy kind: clinical — read through the policies of the
// clinical migrations and written only by their definers.
//
// T-051 (PR-9, CLIN-001–003; migration 0069): the BC's intake for one visit. `intakes` is one per visit,
// authored by one BC, draft until "Kirim ke Dokter" and final afterwards. `intake_facts` holds only facts
// that are new or changed against the patient's history (CLIN-001); unchanged prior facts the BC reviewed are
// listed in `intakes.reviewed_prior`. `skin_observations` is "Observasi Kulit": chips from a fixed vocabulary
// and text, never a grade, score or skin type (PR-9). Provenance of every fact is BC-captured, unverified:
// never a diagnosis (CLIN-003).
import { sql } from "drizzle-orm";
import { bigint, check, customType, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { catalogVersions } from "../catalog/schema";
import { branches, staff, tenants } from "../org/schema";
import { GUARDIAN_RELATIONS, patients } from "../patients/schema";
import { visits } from "../visits/schema";

export const INTAKE_STATES = ["draft", "sent"] as const;
export const FACT_KINDS = ["allergy", "medication", "pregnancy", "condition", "skincare", "prior_treatment", "note"] as const;
export const FACT_PROVENANCE = ["patient_reported", "bc_captured_unverified"] as const;
export const SKIN_CHIPS = [
  "kering", "berminyak", "kombinasi", "kemerahan", "jerawat_aktif", "bekas_jerawat", "flek", "pori_besar", "garis_halus", "sensitif", "iritasi", "lainnya",
] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

export const intakes = pgTable(
  "intakes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    state: text("state", { enum: INTAKE_STATES }).notNull().default("draft"),
    complaint: text("complaint"),
    reviewedPrior: uuid("reviewed_prior").array().notNull().default(sql`'{}'::uuid[]`),
    authorId: uuid("author_id").notNull(),
    authorRole: text("author_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "intakes_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "intakes_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "intakes_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "intakes_author_fk", columns: [t.tenantId, t.authorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("intakes_tenant_id_id_key").on(t.tenantId, t.id),
    unique("intakes_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("intakes_tenant_visit_key").on(t.tenantId, t.visitId),
    index("intakes_patient_idx").on(t.tenantId, t.patientId, t.sentAt),
    check("intakes_state_check", sql`${t.state} in (${inList(INTAKE_STATES)}) and (${t.state} = 'sent') = (${t.sentAt} is not null)
      and (${t.state} = 'draft' or ${t.complaint} is not null)`),
    check("intakes_text_check", sql`${t.complaint} is null or length(btrim(${t.complaint})) between 3 and 1000`),
    check("intakes_author_role_check", sql`${t.authorRole} = 'bc'`),
  ],
);

export const intakeFacts = pgTable(
  "intake_facts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    intakeId: uuid("intake_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    kind: text("kind", { enum: FACT_KINDS }).notNull(),
    value: text("value").notNull(),
    provenance: text("provenance", { enum: FACT_PROVENANCE }).notNull().default("bc_captured_unverified"),
    priorFactId: uuid("prior_fact_id"),
    authorId: uuid("author_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "intake_facts_intake_fk", columns: [t.tenantId, t.branchId, t.intakeId], foreignColumns: [intakes.tenantId, intakes.branchId, intakes.id] }).onDelete("restrict"),
    foreignKey({ name: "intake_facts_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "intake_facts_author_fk", columns: [t.tenantId, t.authorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "intake_facts_prior_fk", columns: [t.tenantId, t.priorFactId], foreignColumns: [t.tenantId, t.id] }).onDelete("restrict"),
    unique("intake_facts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("intake_facts_one_per_kind_key").on(t.tenantId, t.intakeId, t.kind),
    index("intake_facts_patient_idx").on(t.tenantId, t.patientId, t.kind),
    check("intake_facts_kind_check", sql`${t.kind} in (${inList(FACT_KINDS)}) and ${t.provenance} in (${inList(FACT_PROVENANCE)})`),
    check("intake_facts_value_check", sql`length(btrim(${t.value})) between 1 and 500`),
  ],
);

export const skinObservations = pgTable(
  "skin_observations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    intakeId: uuid("intake_id").notNull(),
    chips: text("chips").array().notNull().default(sql`'{}'::text[]`),
    note: text("note"),
    authorId: uuid("author_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "skin_observations_intake_fk", columns: [t.tenantId, t.branchId, t.intakeId], foreignColumns: [intakes.tenantId, intakes.branchId, intakes.id] }).onDelete("restrict"),
    foreignKey({ name: "skin_observations_author_fk", columns: [t.tenantId, t.authorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("skin_observations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("skin_observations_one_per_intake_key").on(t.tenantId, t.intakeId),
    // Chips from the fixed vocabulary only; no grade, score or skin-type column exists (PR-9).
    check("skin_observations_chips_check", sql`${t.chips} <@ array[${inList(SKIN_CHIPS)}]::text[] and cardinality(${t.chips}) <= 12`),
    check("skin_observations_note_check", sql`${t.note} is null or length(btrim(${t.note})) between 1 and 1000`),
  ],
);

// T-052 (PR-10, CLIN-004, CLIN-012; migration 0070): the doctor's examination of a visit (one per visit, draft
// until signed in T-053), the doctor's verification of BC facts (CLIN-004: the BC fact never changes; the
// verification is its own row with time and version), face-map marks (integer permille coordinates, integer
// micro-unit doses; no float), and care plans with staged items (CLIN-012: several active plans in parallel;
// prices are never stored — read live from the branch price; money freezes at invoicing).
export const EXAM_STATES = ["draft", "signed"] as const;
export const VERIFY_DECISIONS = ["confirmed", "corrected"] as const;
export const MAP_TEMPLATES = ["face_front", "face_left", "face_right", "body"] as const;
export const MAP_LAYERS = ["keluhan", "pemeriksaan", "tindakan"] as const;
export const DOSE_UNITS = ["unit", "ml", "mg", "cm2"] as const;
export const PLAN_STATES = ["active", "completed", "stopped"] as const;

export const examinations = pgTable(
  "examinations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    state: text("state", { enum: EXAM_STATES }).notNull().default("draft"),
    subjective: text("subjective"),
    objective: text("objective"),
    assessment: text("assessment"),
    planNote: text("plan_note"),
    templateKey: text("template_key"),
    templateValues: jsonb("template_values").notNull().default(sql`'{}'::jsonb`),
    vitals: jsonb("vitals").notNull().default(sql`'{}'::jsonb`),
    icd10Codes: text("icd10_codes").array().notNull().default(sql`'{}'::text[]`),
    authorId: uuid("author_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    // T-053 (PR-13, PR-3): signing. Set together, once; the signer is the author acting as Dokter.
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedBy: uuid("signed_by"),
    signedAs: text("signed_as"),
    contentHash: text("content_hash"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "examinations_signed_by_fk", columns: [t.tenantId, t.signedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "examinations_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "examinations_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "examinations_author_fk", columns: [t.tenantId, t.authorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("examinations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("examinations_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("examinations_tenant_visit_key").on(t.tenantId, t.visitId),
    index("examinations_patient_idx").on(t.tenantId, t.patientId, t.createdAt),
    check("examinations_state_check", sql`${t.state} in (${inList(EXAM_STATES)})
      and num_nonnulls(${t.signedAt}, ${t.signedBy}, ${t.signedAs}, ${t.contentHash}) = (case when ${t.state} = 'signed' then 4 else 0 end)
      and (${t.signedBy} is null or ${t.signedBy} = ${t.authorId}) and (${t.signedAs} is null or ${t.signedAs} = 'doctor')
      and (${t.contentHash} is null or ${t.contentHash} ~ '^[0-9a-f]{64}$')`),
    check("examinations_text_check", sql`(${t.subjective} is null or length(${t.subjective}) <= 4000) and (${t.objective} is null or length(${t.objective}) <= 4000)
      and (${t.assessment} is null or length(${t.assessment}) <= 4000) and (${t.planNote} is null or length(${t.planNote}) <= 4000)
      and (${t.templateKey} is null or ${t.templateKey} ~ '^[a-z][a-z_]{1,40}$') and jsonb_typeof(${t.templateValues}) = 'object' and jsonb_typeof(${t.vitals}) = 'object'`),
    check("examinations_icd10_check", sql`cardinality(${t.icd10Codes}) <= 10 and array_to_string(${t.icd10Codes}, ',') ~ '^([A-Z][0-9]{2}(\\.[0-9A-Z]{1,4})?(,|$))*$'`),
  ],
);

export const intakeVerifications = pgTable(
  "intake_verifications",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    factId: uuid("fact_id").notNull(),
    decision: text("decision", { enum: VERIFY_DECISIONS }).notNull(),
    correctedValue: text("corrected_value"),
    provenance: text("provenance").notNull().default("clinician_verified"),
    version: integer("version").notNull().default(1),
    verifiedBy: uuid("verified_by").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "intake_verifications_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    // A prior fact may come from a visit at another branch: by (tenant, fact) only.
    foreignKey({ name: "intake_verifications_fact_fk", columns: [t.tenantId, t.factId], foreignColumns: [intakeFacts.tenantId, intakeFacts.id] }).onDelete("restrict"),
    foreignKey({ name: "intake_verifications_by_fk", columns: [t.tenantId, t.verifiedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("intake_verifications_tenant_id_id_key").on(t.tenantId, t.id),
    unique("intake_verifications_once_key").on(t.tenantId, t.examinationId, t.factId),
    index("intake_verifications_fact_idx").on(t.tenantId, t.factId),
    check("intake_verifications_decision_check", sql`${t.decision} in (${inList(VERIFY_DECISIONS)}) and ${t.provenance} = 'clinician_verified' and ${t.version} >= 1
      and ((${t.decision} = 'corrected') = (${t.correctedValue} is not null)) and (${t.correctedValue} is null or length(btrim(${t.correctedValue})) between 1 and 500)`),
  ],
);

export const faceMapMarks = pgTable(
  "face_map_marks",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    template: text("template", { enum: MAP_TEMPLATES }).notNull(),
    layer: text("layer", { enum: MAP_LAYERS }).notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    label: text("label").notNull(),
    catalogVersionId: uuid("catalog_version_id"),
    doseMicro: bigint("dose_micro", { mode: "number" }),
    doseUnit: text("dose_unit", { enum: DOSE_UNITS }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "face_map_marks_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "face_map_marks_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    unique("face_map_marks_tenant_id_id_key").on(t.tenantId, t.id),
    index("face_map_marks_exam_idx").on(t.tenantId, t.examinationId),
    check("face_map_marks_point_check", sql`${t.template} in (${inList(MAP_TEMPLATES)}) and ${t.layer} in (${inList(MAP_LAYERS)})
      and ${t.x} between 0 and 1000 and ${t.y} between 0 and 1000 and length(btrim(${t.label})) between 1 and 120`),
    check("face_map_marks_dose_check", sql`((${t.layer} = 'tindakan') = (${t.doseMicro} is not null and ${t.doseUnit} is not null))
      and (${t.doseMicro} is null or ${t.doseMicro} between 1 and 1000000000) and (${t.doseUnit} is null or ${t.doseUnit} in (${inList(DOSE_UNITS)}))
      and (${t.layer} = 'tindakan' or ${t.catalogVersionId} is null)`),
  ],
);

export const carePlans = pgTable(
  "care_plans",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(), // the branch of the creating examination (the RLS scope)
    patientId: uuid("patient_id").notNull(),
    title: text("title").notNull(),
    condition: text("condition").notNull(),
    state: text("state", { enum: PLAN_STATES }).notNull().default("active"),
    createdExamId: uuid("created_exam_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    closedExamId: uuid("closed_exam_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "care_plans_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "care_plans_created_exam_fk", columns: [t.tenantId, t.branchId, t.createdExamId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "care_plans_closed_exam_fk", columns: [t.tenantId, t.closedExamId], foreignColumns: [examinations.tenantId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "care_plans_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("care_plans_tenant_id_id_key").on(t.tenantId, t.id),
    unique("care_plans_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    index("care_plans_patient_idx").on(t.tenantId, t.patientId, t.state),
    check("care_plans_text_check", sql`length(btrim(${t.title})) between 3 and 160 and length(btrim(${t.condition})) between 3 and 200`),
    check("care_plans_state_check", sql`${t.state} in (${inList(PLAN_STATES)}) and ((${t.state} = 'active') = (${t.closedAt} is null)) and ((${t.closedAt} is null) = (${t.closedExamId} is null))`),
  ],
);

export const planItems = pgTable(
  "plan_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(), // the plan's branch (the RLS scope)
    planId: uuid("plan_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    stage: integer("stage").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    qty: integer("qty").notNull(),
    doseMicro: bigint("dose_micro", { mode: "number" }),
    doseUnit: text("dose_unit", { enum: DOSE_UNITS }),
    note: text("note"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "plan_items_plan_fk", columns: [t.tenantId, t.branchId, t.planId], foreignColumns: [carePlans.tenantId, carePlans.branchId, carePlans.id] }).onDelete("restrict"),
    foreignKey({ name: "plan_items_exam_fk", columns: [t.tenantId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "plan_items_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    unique("plan_items_tenant_id_id_key").on(t.tenantId, t.id),
    index("plan_items_plan_idx").on(t.tenantId, t.planId),
    check("plan_items_check", sql`${t.stage} between 1 and 20 and ${t.qty} between 1 and 1000
      and ((${t.doseMicro} is null) = (${t.doseUnit} is null)) and (${t.doseMicro} is null or ${t.doseMicro} between 1 and 1000000000)
      and (${t.doseUnit} is null or ${t.doseUnit} in (${inList(DOSE_UNITS)})) and (${t.note} is null or length(btrim(${t.note})) between 1 and 500)`),
  ],
);

// T-053 (PR-13, CLIN-014, CLIN-023, PR-49; migration 0071): a signed examination never changes; its content
// lives in versions. Version 1 is the signed snapshot; a correction is version n+1 with the net delta, written
// at once within 48 h of signing by the author, later only after a records officer or facility head approves
// (`record_corrections` + approval `record_late_correction`). A patient copy request is logged, content-free.
export const RECORD_VERSION_KINDS = ["original", "correction"] as const;
export const CORRECTION_STATES = ["pending", "approved", "rejected", "cancelled"] as const;

export const recordVersions = pgTable(
  "record_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind", { enum: RECORD_VERSION_KINDS }).notNull(),
    content: jsonb("content").notNull(),
    contentHash: text("content_hash").notNull(),
    delta: jsonb("delta"),
    reason: text("reason"),
    approvalId: uuid("approval_id"),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "record_versions_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "record_versions_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "record_versions_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    unique("record_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("record_versions_version_key").on(t.tenantId, t.examinationId, t.version),
    unique("record_versions_approval_key").on(t.tenantId, t.approvalId),
    check("record_versions_kind_check", sql`${t.kind} in (${inList(RECORD_VERSION_KINDS)}) and ${t.createdAs} = 'doctor'
      and jsonb_typeof(${t.content}) = 'object' and ${t.contentHash} ~ '^[0-9a-f]{64}$'
      and ((${t.kind} = 'original') = (${t.version} = 1 and ${t.delta} is null and ${t.reason} is null and ${t.approvalId} is null))
      and ((${t.kind} = 'correction') = (${t.version} > 1 and ${t.delta} is not null and jsonb_typeof(${t.delta}) = 'object' and ${t.delta} <> '{}'::jsonb
           and length(btrim(coalesce(${t.reason}, ''))) between 3 and 500))`),
  ],
);

export const recordCorrections = pgTable(
  "record_corrections",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    delta: jsonb("delta").notNull(),
    reason: text("reason").notNull(),
    state: text("state", { enum: CORRECTION_STATES }).notNull().default("pending"),
    approvalId: uuid("approval_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    requestedAs: text("requested_as").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    versionId: uuid("version_id"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "record_corrections_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "record_corrections_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "record_corrections_by_fk", columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "record_corrections_version_fk", columns: [t.tenantId, t.versionId], foreignColumns: [recordVersions.tenantId, recordVersions.id] }).onDelete("restrict"),
    unique("record_corrections_tenant_id_id_key").on(t.tenantId, t.id),
    unique("record_corrections_approval_key").on(t.tenantId, t.approvalId),
    uniqueIndex("record_corrections_one_pending").on(t.tenantId, t.examinationId).where(sql`state = 'pending'`),
    check("record_corrections_check", sql`${t.state} in (${inList(CORRECTION_STATES)}) and ${t.requestedAs} = 'doctor'
      and jsonb_typeof(${t.delta}) = 'object' and ${t.delta} <> '{}'::jsonb and length(btrim(${t.reason})) between 3 and 500
      and ((${t.state} = 'pending') = (${t.decidedAt} is null)) and ((${t.state} = 'approved') = (${t.versionId} is not null))`),
  ],
);

export const recordCopyRequests = pgTable(
  "record_copy_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    recordCount: integer("record_count").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    requestedAs: text("requested_as").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "record_copy_requests_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "record_copy_requests_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "record_copy_requests_by_fk", columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("record_copy_requests_tenant_id_id_key").on(t.tenantId, t.id),
    index("record_copy_requests_patient_idx").on(t.tenantId, t.patientId, t.requestedAt),
    check("record_copy_requests_check", sql`${t.recordCount} >= 0 and ${t.requestedAs} in ('fo_cashier','records_officer','facility_head')
      and length(btrim(${t.reason})) between 3 and 300`),
  ],
);

// T-055 (PR-32, CLIN-015, CLIN-021, CLIN-026; migration 0072): private clinical media. Metadata in
// `clinical_media` (photos with a SET-29 angle and dimensions from the bytes; documents); the bytes are
// content-addressed by sha256 in `clinical_media_blobs` (object key tenants/<tenant>/clinical-media/<sha256>,
// TEN-4) behind the MediaStore interface, so the S3 adapter replaces it by configuration (ARCH-9) without a
// schema change. Access only through short-lived tokens (`media_tokens`: the sha256 of a random token, ≤ 10
// minutes, bound to the staff and acting role). Never deleted: a mistaken upload is hidden with a reason.
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const MEDIA_KINDS = ["photo", "document"] as const;
export const MEDIA_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const PHOTO_ANGLES = ["depan", "serong_45", "samping", "atas", "bawah", "dekat"] as const;
export const TOKEN_PURPOSES = ["view", "download"] as const;
export const MEDIA_MAX_BYTES = 5_242_880;

export const clinicalMedia = pgTable(
  "clinical_media",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    examinationId: uuid("examination_id"),
    kind: text("kind", { enum: MEDIA_KINDS }).notNull(),
    angle: text("angle", { enum: PHOTO_ANGLES }),
    contentType: text("content_type", { enum: MEDIA_TYPES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    uploadedAs: text("uploaded_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by"),
    removedAs: text("removed_as"),
    removedReason: text("removed_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_media_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_media_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_media_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_media_by_fk", columns: [t.tenantId, t.uploadedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_media_removed_by_fk", columns: [t.tenantId, t.removedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("clinical_media_tenant_id_id_key").on(t.tenantId, t.id),
    unique("clinical_media_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    index("clinical_media_patient_idx").on(t.tenantId, t.patientId, t.takenAt),
    index("clinical_media_visit_idx").on(t.tenantId, t.visitId),
    check("clinical_media_kind_check", sql`${t.kind} in (${inList(MEDIA_KINDS)}) and ${t.contentType} in (${inList(MEDIA_TYPES)})
      and (${t.kind} <> 'photo' or ${t.contentType} in ('image/jpeg','image/png'))
      and ((${t.kind} = 'photo') = (${t.angle} is not null and ${t.width} is not null and ${t.height} is not null))
      and (${t.angle} is null or ${t.angle} in (${inList(PHOTO_ANGLES)}))
      and ((${t.width} is null and ${t.height} is null) or (${t.width} between 1 and 20000 and ${t.height} between 1 and 20000))`),
    check("clinical_media_file_check", sql`${t.sizeBytes} between 1 and ${sql.raw(String(MEDIA_MAX_BYTES))} and ${t.sha256} ~ '^[0-9a-f]{64}$'
      and ${t.objectKey} = 'tenants/' || ${t.tenantId}::text || '/clinical-media/' || ${t.sha256}
      and length(btrim(${t.fileName})) between 1 and 200 and ${t.fileName} !~ '[/\\\\]'`),
    check("clinical_media_uploader_check", sql`${t.uploadedAs} in ('bc','doctor','nurse') and (${t.uploadedAs} <> 'bc' or ${t.kind} = 'photo')`),
    check("clinical_media_removed_check", sql`num_nonnulls(${t.removedAt}, ${t.removedBy}, ${t.removedAs}, ${t.removedReason}) in (0, 4)
      and (${t.removedReason} is null or length(btrim(${t.removedReason})) between 3 and 500)`),
  ],
);

export const clinicalMediaBlobs = pgTable(
  "clinical_media_blobs",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    sha256: text("sha256").notNull(),
    contentType: text("content_type", { enum: MEDIA_TYPES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytea("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    unique("clinical_media_blobs_tenant_id_id_key").on(t.tenantId, t.id),
    unique("clinical_media_blobs_sha_key").on(t.tenantId, t.sha256),
    check("clinical_media_blobs_check", sql`${t.contentType} in (${inList(MEDIA_TYPES)}) and ${t.sha256} = encode(sha256(${t.content}), 'hex')
      and ${t.sizeBytes} = octet_length(${t.content}) and ${t.sizeBytes} between 1 and ${sql.raw(String(MEDIA_MAX_BYTES))}`),
  ],
);

export const mediaTokens = pgTable(
  "media_tokens",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    actingRole: text("acting_role").notNull(),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose", { enum: TOKEN_PURPOSES }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedCount: integer("used_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "media_tokens_media_fk", columns: [t.tenantId, t.branchId, t.mediaId], foreignColumns: [clinicalMedia.tenantId, clinicalMedia.branchId, clinicalMedia.id] }).onDelete("restrict"),
    foreignKey({ name: "media_tokens_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("media_tokens_tenant_id_id_key").on(t.tenantId, t.id),
    unique("media_tokens_hash_key").on(t.tokenHash),
    check("media_tokens_check", sql`${t.purpose} in (${inList(TOKEN_PURPOSES)}) and ${t.tokenHash} ~ '^[0-9a-f]{64}$'
      and ${t.expiresAt} > ${t.issuedAt} and ${t.expiresAt} <= ${t.issuedAt} + interval '10 minutes'
      and ${t.usedCount} >= 0 and ((${t.usedCount} = 0) = (${t.lastUsedAt} is null))`),
  ],
);

// T-054 (PR-11, CLIN-005, CLIN-022; migration 0073): procedure consent (UX-39) and the treatment start gate. A
// consent is a versioned, signed snapshot of a plan's active items (one active per plan; a new one supersedes,
// a withdrawal ends it); its text is generated by the database and its hash checked at capture. The patient's
// or guardian's signature is a PNG in the row, hidden from every app grant. Contraindication reviews are the
// examining doctor's decision per plan item. The gate (`treatment_start_check`) reads all of it.
export const CONSENT_STATES = ["active", "superseded", "withdrawn"] as const;
export const CONSENT_SIGNERS = ["patient", "guardian"] as const;
export const REVIEW_DECISIONS = ["cleared", "blocked"] as const;

export const procedureConsents = pgTable(
  "procedure_consents",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    planId: uuid("plan_id").notNull(),
    version: integer("version").notNull(),
    state: text("state", { enum: CONSENT_STATES }).notNull().default("active"),
    signer: text("signer", { enum: CONSENT_SIGNERS }).notNull(),
    guardianName: text("guardian_name"),
    guardianRelation: text("guardian_relation", { enum: GUARDIAN_RELATIONS }),
    capturedBy: uuid("captured_by").notNull(),
    capturedAs: text("captured_as").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    consentText: text("consent_text").notNull(),
    contentHash: text("content_hash").notNull(),
    signaturePng: bytea("signature_png").notNull(),
    signatureSha256: text("signature_sha256").notNull(),
    signatureSize: integer("signature_size").notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededById: uuid("superseded_by_id"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: uuid("withdrawn_by"),
    withdrawnAs: text("withdrawn_as"),
    withdrawReason: text("withdraw_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consents_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consents_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consents_plan_fk", columns: [t.tenantId, t.planId], foreignColumns: [carePlans.tenantId, carePlans.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consents_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consents_by_fk", columns: [t.tenantId, t.capturedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consents_withdrawn_by_fk", columns: [t.tenantId, t.withdrawnBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("procedure_consents_tenant_id_id_key").on(t.tenantId, t.id),
    unique("procedure_consents_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("procedure_consents_version_key").on(t.tenantId, t.planId, t.version),
    uniqueIndex("procedure_consents_one_active").on(t.tenantId, t.planId).where(sql`state = 'active'`),
    index("procedure_consents_visit_idx").on(t.tenantId, t.visitId),
    check("procedure_consents_state_check", sql`${t.state} in (${inList(CONSENT_STATES)}) and ${t.version} >= 1 and ${t.capturedAs} in ('doctor','nurse')
      and (num_nonnulls(${t.supersededAt}, ${t.supersededById}) = 2) = (${t.state} = 'superseded') and num_nonnulls(${t.supersededAt}, ${t.supersededById}) in (0, 2)
      and (num_nonnulls(${t.withdrawnAt}, ${t.withdrawnBy}, ${t.withdrawnAs}, ${t.withdrawReason}) = 4) = (${t.state} = 'withdrawn')
      and num_nonnulls(${t.withdrawnAt}, ${t.withdrawnBy}, ${t.withdrawnAs}, ${t.withdrawReason}) in (0, 4)
      and (${t.withdrawReason} is null or length(btrim(${t.withdrawReason})) between 3 and 500) and (${t.withdrawnAs} is null or ${t.withdrawnAs} in ('doctor','nurse'))`),
    check("procedure_consents_signer_check", sql`${t.signer} in (${inList(CONSENT_SIGNERS)})
      and ((${t.signer} = 'guardian') = (${t.guardianName} is not null and ${t.guardianRelation} is not null))
      and (${t.signer} = 'guardian' or (${t.guardianName} is null and ${t.guardianRelation} is null))
      and (${t.guardianName} is null or length(btrim(${t.guardianName})) between 2 and 120)
      and (${t.guardianRelation} is null or ${t.guardianRelation} in (${inList(GUARDIAN_RELATIONS)}))`),
    check("procedure_consents_text_check", sql`length(${t.consentText}) between 1 and 60000 and ${t.contentHash} = encode(sha256(convert_to(${t.consentText}, 'UTF8')), 'hex')`),
    check("procedure_consents_signature_check", sql`${t.signatureSize} between 68 and 204800 and ${t.signatureSize} = octet_length(${t.signaturePng})
      and ${t.signatureSha256} = encode(sha256(${t.signaturePng}), 'hex')
      and substring(${t.signaturePng} from 1 for 8) = '\\x89504e470d0a1a0a'::bytea and substring(${t.signaturePng} from 13 for 4) = '\\x49484452'::bytea`),
  ],
);

export const procedureConsentItems = pgTable(
  "procedure_consent_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    consentId: uuid("consent_id").notNull(),
    planItemId: uuid("plan_item_id").notNull(),
    stage: integer("stage").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    qty: integer("qty").notNull(),
    doseMicro: bigint("dose_micro", { mode: "number" }),
    doseUnit: text("dose_unit", { enum: DOSE_UNITS }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consent_items_consent_fk", columns: [t.tenantId, t.branchId, t.consentId], foreignColumns: [procedureConsents.tenantId, procedureConsents.branchId, procedureConsents.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consent_items_item_fk", columns: [t.tenantId, t.planItemId], foreignColumns: [planItems.tenantId, planItems.id] }).onDelete("restrict"),
    foreignKey({ name: "procedure_consent_items_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    unique("procedure_consent_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("procedure_consent_items_once_key").on(t.tenantId, t.consentId, t.planItemId),
    check("procedure_consent_items_check", sql`${t.stage} between 1 and 20 and ${t.qty} between 1 and 1000
      and ((${t.doseMicro} is null) = (${t.doseUnit} is null)) and (${t.doseMicro} is null or ${t.doseMicro} between 1 and 1000000000)
      and (${t.doseUnit} is null or ${t.doseUnit} in (${inList(DOSE_UNITS)}))`),
  ],
);

export const contraindicationReviews = pgTable(
  "contraindication_reviews",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    planItemId: uuid("plan_item_id").notNull(),
    decision: text("decision", { enum: REVIEW_DECISIONS }).notNull(),
    reason: text("reason"),
    version: integer("version").notNull().default(1),
    reviewedBy: uuid("reviewed_by").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "contraindication_reviews_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "contraindication_reviews_item_fk", columns: [t.tenantId, t.planItemId], foreignColumns: [planItems.tenantId, planItems.id] }).onDelete("restrict"),
    foreignKey({ name: "contraindication_reviews_by_fk", columns: [t.tenantId, t.reviewedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("contraindication_reviews_tenant_id_id_key").on(t.tenantId, t.id),
    unique("contraindication_reviews_once_key").on(t.tenantId, t.examinationId, t.planItemId),
    check("contraindication_reviews_check", sql`${t.decision} in (${inList(REVIEW_DECISIONS)}) and ${t.version} >= 1
      and (${t.reason} is null or length(btrim(${t.reason})) between 3 and 500) and (${t.decision} <> 'blocked' or ${t.reason} is not null)`),
  ],
);
