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
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { catalogVersions } from "../catalog/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
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
export const EXAM_STATES = ["draft"] as const;
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
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "examinations_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "examinations_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "examinations_author_fk", columns: [t.tenantId, t.authorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("examinations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("examinations_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("examinations_tenant_visit_key").on(t.tenantId, t.visitId),
    index("examinations_patient_idx").on(t.tenantId, t.patientId, t.createdAt),
    check("examinations_state_check", sql`${t.state} in (${inList(EXAM_STATES)})`),
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
