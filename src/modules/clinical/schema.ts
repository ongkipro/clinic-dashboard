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
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
