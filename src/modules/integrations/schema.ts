// SATUSEHAT (PR-35, TD-30–TD-33, DATA-40, UX-23; T-102, migration 0116, DEC-113). Signed examinations are reported per visit through a durable
// outbox: the signing writer only inserts an item (outages never block care); the worker sends after the visit closes, from the pinned signed
// version, under per-branch credentials, with a facility-context invariant, patient identity states, a sync ledger of remote links with an
// append-only attempt history, a lease with fenced completion, and an uncertainty barrier per remote resource. Official guide references:
// docs/tasks/T-102.md (Q-19). Fixtures are guide-shaped and synthetic; external connectivity is unverified until the owner-gated sandbox step.
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { examinations, recordVersions } from "../clinical/schema";
import { catalogItems } from "../catalog/schema";
import { rooms } from "../org/branches/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { visits } from "../visits/schema";

const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const CIPHER = (c: unknown) => sql`${c} ~ '^v1\\.[1-9][0-9]{0,8}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`;
const DEK = (c: unknown) => sql`${c} ~ '^dek:v[1-9][0-9]{0,8}$'`;
const IHS = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9-]{3,64}$'`;
const CODE = (c: unknown) => sql`${c} ~ '^[a-z][a-z0-9_]{1,48}$'`; // reason codes incl. http_4xx / http_5xx (review r1 test)

export const SATUSEHAT_ENVIRONMENTS = ["sandbox", "production"] as const;
export const FHIR_TYPES = ["Encounter", "Condition", "Observation", "Procedure", "Medication", "MedicationRequest", "MedicationDispense"] as const;
export const OUTBOX_STATES = ["queued", "held", "leased", "done", "superseded"] as const;
export const OUTBOX_KINDS = ["revision", "resend"] as const;
export const LINK_STATUSES = ["queued", "held", "sending", "confirmed", "failed", "outcome_unknown", "exception", "withdrawal_pending"] as const;
export const ATTEMPT_VERBS = ["create", "update", "search", "read"] as const;
export const ATTEMPT_OUTCOMES = ["ok", "http_4xx", "http_5xx", "timeout", "lost", "stale", "not_found", "many", "incomplete", "mismatch"] as const;
export const IDENTITY_STATES = ["matched", "review", "resolved_manual", "unresolvable"] as const;
export const CODE_SYSTEM_KINDS = ["icd10", "icd9cm", "loinc", "kfa"] as const;

// Per-branch credentials (TD-30, TEN-7, H-04): the client secret sealed with the tenant DEK (`satusehat.secret`), never granted to any reader;
// one active row per (branch, environment); rotation adds a generation and revokes the old row.
export const satusehatCredentials = pgTable(
  "satusehat_credentials",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    environment: text("environment", { enum: SATUSEHAT_ENVIRONMENTS }).notNull(),
    organizationId: text("organization_id").notNull(),
    clientId: text("client_id").notNull(),
    secretEnc: text("secret_enc").notNull(),
    dekRef: text("dek_ref").notNull(),
    generation: integer("generation").notNull(),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique("satusehat_credentials_tenant_id_id_key").on(t.tenantId, t.id),
    unique("satusehat_credentials_command_key").on(t.tenantId, t.commandKey),
    unique("satusehat_credentials_generation_key").on(t.tenantId, t.branchId, t.environment, t.generation),
    uniqueIndex("satusehat_credentials_one_active").on(t.tenantId, t.branchId, t.environment).where(sql`${t.revokedAt} is null`),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("satusehat_credentials_check", sql`${t.environment} in (${inList(SATUSEHAT_ENVIRONMENTS)}) and ${IHS(t.organizationId)}
      and length(btrim(${t.clientId})) between 3 and 200 and ${CIPHER(t.secretEnc)} and ${DEK(t.dekRef)} and ${t.generation} >= 1
      and ${KEY(t.commandKey)} and ${t.createdAs} in ('owner','admin_pusat')`),
  ],
);

// The reporting context of a visit, captured once at signing (plan §1): the room as called at signing, the arrival and in-progress times.
export const satusehatVisitContext = pgTable(
  "satusehat_visit_context",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    examinationId: uuid("examination_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    doctorStaffId: uuid("doctor_staff_id").notNull(),
    roomId: uuid("room_id"),
    roomSetBy: uuid("room_set_by"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull(),
    inProgressAt: timestamp("in_progress_at", { withTimezone: true }).notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("satusehat_visit_context_tenant_id_id_key").on(t.tenantId, t.id),
    unique("satusehat_visit_context_key").on(t.tenantId, t.visitId),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_visit_context_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_visit_context_exam_fk", columns: [t.tenantId, t.branchId, t.examinationId], foreignColumns: [examinations.tenantId, examinations.branchId, examinations.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_visit_context_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_visit_context_doctor_fk", columns: [t.tenantId, t.doctorStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_visit_context_room_fk", columns: [t.tenantId, t.branchId, t.roomId], foreignColumns: [rooms.tenantId, rooms.branchId, rooms.id] }).onDelete("restrict"),
    // No CHECK here: the row is written by the signing trigger, which must never fail on SATUSEHAT-side data (plan §1).
    foreignKey({ name: "satusehat_visit_context_room_by_fk", columns: [t.tenantId, t.roomSetBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
  ],
);

// The outbox (S-07, TD-33): one delivery unit per visit revision (ids only); one live lease per visit; resend and hold resolution insert a
// new item (kind resend), never reopening a finished one.
export const satusehatOutbox = pgTable(
  "satusehat_outbox",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    revision: integer("revision").notNull(),
    examVersionId: uuid("exam_version_id").notNull(),
    kind: text("kind", { enum: OUTBOX_KINDS }).notNull().default("revision"),
    state: text("state", { enum: OUTBOX_STATES }).notNull().default("queued"),
    holdReason: text("hold_reason"),
    leaseGen: integer("lease_gen").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    nextAt: timestamp("next_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("satusehat_outbox_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("satusehat_outbox_one_lease").on(t.tenantId, t.visitId).where(sql`${t.state} = 'leased'`),
    uniqueIndex("satusehat_outbox_one_revision").on(t.tenantId, t.visitId, t.revision).where(sql`${t.kind} = 'revision'`),
    index("satusehat_outbox_due_idx").on(t.state, t.nextAt),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_outbox_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_outbox_version_fk", columns: [t.tenantId, t.examVersionId], foreignColumns: [recordVersions.tenantId, recordVersions.id] }).onDelete("restrict"),
    check("satusehat_outbox_check", sql`${t.state} in (${inList(OUTBOX_STATES)}) and ${t.kind} in (${inList(OUTBOX_KINDS)}) and ${t.revision} >= 1
      and ${t.leaseGen} >= 0 and ${t.attempts} >= 0 and ((${t.state} = 'held') = (${t.holdReason} is not null))
      and (${t.holdReason} is null or ${CODE(t.holdReason)}) and ((${t.state} = 'leased') = (${t.leaseUntil} is not null))
      and ((${t.state} in ('done','superseded')) = (${t.finishedAt} is not null))`),
  ],
);

// The sync ledger (TD-32): one stable link per remote resource; bound to the organization it was created under (plan §6).
export const satusehatLinks = pgTable(
  "satusehat_links",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    environment: text("environment", { enum: SATUSEHAT_ENVIRONMENTS }).notNull(),
    visitId: uuid("visit_id").notNull(),
    fhirType: text("fhir_type", { enum: FHIR_TYPES }).notNull(),
    localKey: text("local_key").notNull(),
    organizationId: text("organization_id").notNull(),
    remoteId: text("remote_id"),
    status: text("status", { enum: LINK_STATUSES }).notNull().default("queued"),
    statusReason: text("status_reason"),
    currentRevision: integer("current_revision").notNull(),
    confirmedRevision: integer("confirmed_revision"),
    checkAfter: timestamp("check_after", { withTimezone: true }),
    reconcileRounds: integer("reconcile_rounds").notNull().default(0),
    nextAt: timestamp("next_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    retries: integer("retries").notNull().default(0),
    // the references the last successful write carried (an Encounter's diagnosis Condition ids), to know when it must be updated again
    sentRefs: jsonb("sent_refs"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("satusehat_links_tenant_id_id_key").on(t.tenantId, t.id),
    unique("satusehat_links_resource_key").on(t.tenantId, t.environment, t.fhirType, t.visitId, t.localKey),
    index("satusehat_links_branch_idx").on(t.tenantId, t.branchId, t.status),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_links_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    check("satusehat_links_check", sql`${t.environment} in (${inList(SATUSEHAT_ENVIRONMENTS)}) and ${t.fhirType} in (${inList(FHIR_TYPES)})
      and ${t.status} in (${inList(LINK_STATUSES)}) and length(${t.localKey}) between 1 and 120 and ${IHS(t.organizationId)}
      and (${t.remoteId} is null or ${IHS(t.remoteId)}) and ${t.currentRevision} >= 1 and (${t.confirmedRevision} is null or ${t.confirmedRevision} between 1 and ${t.currentRevision})
      and (${t.statusReason} is null or ${CODE(t.statusReason)}) and ${t.reconcileRounds} >= 0 and ${t.retries} >= 0
      and (${t.status} <> 'confirmed' or (${t.remoteId} is not null and ${t.confirmedRevision} = ${t.currentRevision}))
      and ((${t.status} in ('held','exception','failed','withdrawal_pending')) = (${t.statusReason} is not null))
      and (${t.sentRefs} is null or jsonb_typeof(${t.sentRefs}) = 'array')`),
  ],
);

// What a link's revision was built from (plan §2 pinning): code, system, register / map rows and a content fingerprint; written once.
export const satusehatLinkRevisions = pgTable(
  "satusehat_link_revisions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    linkId: uuid("link_id").notNull(),
    revision: integer("revision").notNull(),
    examVersionId: uuid("exam_version_id").notNull(),
    materialized: jsonb("materialized").notNull(),
    fingerprint: text("fingerprint").notNull(),
    organizationId: text("organization_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("satusehat_link_revisions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("satusehat_link_revisions_key").on(t.tenantId, t.linkId, t.revision),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_link_revisions_link_fk", columns: [t.tenantId, t.linkId], foreignColumns: [satusehatLinks.tenantId, satusehatLinks.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_link_revisions_version_fk", columns: [t.tenantId, t.examVersionId], foreignColumns: [recordVersions.tenantId, recordVersions.id] }).onDelete("restrict"),
    check("satusehat_link_revisions_check", sql`${t.revision} >= 1 and jsonb_typeof(${t.materialized}) = 'object' and ${t.fingerprint} ~ '^[0-9a-f]{64}$'
      and ${IHS(t.organizationId)}`),
  ],
);

// Append-only attempts (TD-32 per version): every remote call and its outcome, never updated or deleted.
export const satusehatAttempts = pgTable(
  "satusehat_attempts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    linkId: uuid("link_id").notNull(),
    outboxId: uuid("outbox_id").notNull(),
    revision: integer("revision").notNull(),
    leaseGen: integer("lease_gen").notNull(),
    verb: text("verb", { enum: ATTEMPT_VERBS }).notNull(),
    // a write's body fingerprint (the projection a read-back is compared with, review r1 P1-3)
    bodyFingerprint: text("body_fingerprint"),
    outcome: text("outcome", { enum: ATTEMPT_OUTCOMES }),
    httpStatus: integer("http_status"),
    remoteId: text("remote_id"),
    remoteVersion: text("remote_version"),
    errorCode: text("error_code"),
    errorPath: text("error_path"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("satusehat_attempts_tenant_id_id_key").on(t.tenantId, t.id),
    index("satusehat_attempts_link_idx").on(t.tenantId, t.linkId, t.startedAt),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_attempts_link_fk", columns: [t.tenantId, t.linkId], foreignColumns: [satusehatLinks.tenantId, satusehatLinks.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_attempts_outbox_fk", columns: [t.tenantId, t.outboxId], foreignColumns: [satusehatOutbox.tenantId, satusehatOutbox.id] }).onDelete("restrict"),
    check("satusehat_attempts_check", sql`${t.verb} in (${inList(ATTEMPT_VERBS)}) and (${t.outcome} is null or ${t.outcome} in (${inList(ATTEMPT_OUTCOMES)}))
      and ((${t.outcome} is null) = (${t.finishedAt} is null)) and ${t.revision} >= 1 and ${t.leaseGen} >= 1
      and (${t.httpStatus} is null or ${t.httpStatus} between 100 and 599) and (${t.remoteId} is null or ${IHS(t.remoteId)})
      and (${t.remoteVersion} is null or length(${t.remoteVersion}) <= 64) and (${t.errorCode} is null or length(${t.errorCode}) <= 80)
      and (${t.errorPath} is null or length(${t.errorPath}) <= 200)
      and ((${t.verb} in ('create','update')) = (${t.bodyFingerprint} is not null)) and (${t.bodyFingerprint} is null or ${t.bodyFingerprint} ~ '^[0-9a-f]{64}$')`),
  ],
);

// The provider's error body (DATA-40): clinical class — only clinical roles read it; code and path are on the attempt.
export const satusehatErrors = pgTable(
  "satusehat_errors",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    body: jsonb("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("satusehat_errors_tenant_id_id_key").on(t.tenantId, t.id),
    unique("satusehat_errors_attempt_key").on(t.tenantId, t.attemptId),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_errors_attempt_fk", columns: [t.tenantId, t.attemptId], foreignColumns: [satusehatAttempts.tenantId, satusehatAttempts.id] }).onDelete("restrict"),
    check("satusehat_errors_check", sql`jsonb_typeof(${t.body}) = 'object' and length(${t.body}::text) <= 20000`),
  ],
);

// Patient identity (TD-31, CD-28): the current state per patient plus a kept history (one row per decision).
export const satusehatPatientIdentity = pgTable(
  "satusehat_patient_identity",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    state: text("state", { enum: IDENTITY_STATES }).notNull(),
    reason: text("reason"),
    ihsPatientId: text("ihs_patient_id"),
    evidence: text("evidence"),
    decidedBy: uuid("decided_by"),
    decidedAs: text("decided_as"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("satusehat_patient_identity_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("satusehat_patient_identity_current").on(t.tenantId, t.patientId).where(sql`${t.isCurrent}`),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_patient_identity_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_patient_identity_by_fk", columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("satusehat_patient_identity_check", sql`${t.state} in (${inList(IDENTITY_STATES)}) and (${t.reason} is null or ${CODE(t.reason)})
      and (${t.ihsPatientId} is null or ${IHS(t.ihsPatientId)}) and (${t.evidence} is null or length(btrim(${t.evidence})) between 3 and 300)
      and ((${t.state} in ('matched','resolved_manual')) = (${t.ihsPatientId} is not null))
      and ((${t.state} = 'review') = (${t.reason} is not null))
      and ((${t.state} in ('resolved_manual','unresolvable')) = (${t.decidedBy} is not null and ${t.evidence} is not null))
      and ((${t.decidedBy} is null) = (${t.decidedAs} is null))`),
  ],
);

// Practitioner IHS ids (DEC-113 (6)): recorded per staff by a one-off lookup (the NIK typed for that request, never stored) or by hand.
export const satusehatPractitionerLinks = pgTable(
  "satusehat_practitioner_links",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    ihsPractitionerId: text("ihs_practitioner_id").notNull(),
    source: text("source", { enum: ["lookup", "manual"] }).notNull(),
    commandKey: text("command_key").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    unique("satusehat_practitioner_links_tenant_id_id_key").on(t.tenantId, t.id),
    unique("satusehat_practitioner_links_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("satusehat_practitioner_links_current").on(t.tenantId, t.staffId).where(sql`${t.endedAt} is null`),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_practitioner_links_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_practitioner_links_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("satusehat_practitioner_links_check", sql`${IHS(t.ihsPractitionerId)} and ${t.source} in ('lookup','manual') and ${KEY(t.commandKey)}
      and ${t.recordedAs} in ('owner','facility_head')`),
  ],
);

// The terminology register (TD-32; platform rows, migration-seeded): a code (or '*' for a whole system such as ICD-10, whose codes come
// straight from the doctor), its system and release, provenance, and whether it is validated for production (false until the sandbox step).
export const satusehatCodeSystems = pgTable(
  "satusehat_code_systems",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    kind: text("kind", { enum: CODE_SYSTEM_KINDS }).notNull(),
    systemUri: text("system_uri").notNull(),
    code: text("code").notNull(),
    display: text("display").notNull(),
    localField: text("local_field"),
    releaseRef: text("release_ref").notNull(),
    provenanceUrl: text("provenance_url").notNull(),
    validated: boolean("validated").notNull().default(false),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [
    unique("satusehat_code_systems_key").on(t.kind, t.code, t.effectiveFrom),
    uniqueIndex("satusehat_code_systems_field_key").on(t.localField).where(sql`${t.localField} is not null and ${t.effectiveTo} is null`),
    check("satusehat_code_systems_check", sql`${t.kind} in (${inList(CODE_SYSTEM_KINDS)}) and ${t.systemUri} ~ '^https?://[a-z0-9./_-]+$'
      and length(${t.code}) between 1 and 40 and length(btrim(${t.display})) between 2 and 200 and length(${t.releaseRef}) between 3 and 120
      and ${t.provenanceUrl} ~ '^https://' and (${t.localField} is null or ${t.localField} ~ '^[a-z][a-z0-9_]{1,40}$')
      and (${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom})`),
  ],
);

// The tenant's clinical code map (ICD-9 CM per service; plan §2): owner or facility head; effective-dated; never deleted.
export const satusehatCodeMaps = pgTable(
  "satusehat_code_maps",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    kind: text("kind", { enum: ["icd9cm"] }).notNull(),
    code: text("code").notNull(),
    display: text("display").notNull(),
    validated: boolean("validated").notNull().default(false),
    commandKey: text("command_key").notNull(),
    mappedBy: uuid("mapped_by").notNull(),
    mappedAs: text("mapped_as").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
  },
  (t) => [
    unique("satusehat_code_maps_tenant_id_id_key").on(t.tenantId, t.id),
    unique("satusehat_code_maps_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("satusehat_code_maps_current").on(t.tenantId, t.itemId, t.kind).where(sql`${t.effectiveTo} is null`),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_code_maps_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "satusehat_code_maps_by_fk", columns: [t.tenantId, t.mappedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("satusehat_code_maps_check", sql`${t.kind} = 'icd9cm' and ${t.code} ~ '^[0-9]{2}(\\.[0-9]{1,2})?$' and length(btrim(${t.display})) between 2 and 200
      and ${KEY(t.commandKey)} and ${t.mappedAs} in ('owner','facility_head') and (${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom})`),
  ],
);
