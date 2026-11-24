// Privacy workspace (PR-92, DATA-66; T-039, DEC-059). Policy kind: tenant-shared, read and written only by
// the privacy officers (Owner, or Admin Pusat holding the data-protection duty) through the definers of
// migration 0065. Processors are edited and ended, never deleted; breaches move open → assessed → notified
// | not_notifiable → closed with a stamp per step; notices are insert-only, their evidence file kept with
// its checksum (bytes never granted to an app role).
import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { recordCopyRequests } from "../clinical/schema";
import { staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const PROCESSOR_ROLES = ["processor", "sub_processor"] as const;
export const processors = pgTable(
  "processors",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    service: text("service").notNull(),
    dataCategories: text("data_categories").notNull(),
    location: text("location").notNull(),
    role: text("role", { enum: PROCESSOR_ROLES }).notNull(),
    crossBorder: boolean("cross_border").notNull().default(false),
    transferBasis: text("transfer_basis"),
    agreementRef: text("agreement_ref"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "processors_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "processors_updated_by_fk", columns: [t.tenantId, t.updatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("processors_tenant_id_id_key").on(t.tenantId, t.id),
    check("processors_text_check", sql`length(btrim(${t.name})) between 2 and 120 and length(btrim(${t.service})) between 2 and 200
      and length(btrim(${t.dataCategories})) between 2 and 300 and length(btrim(${t.location})) between 2 and 120
      and (${t.agreementRef} is null or length(btrim(${t.agreementRef})) between 1 and 200)`),
    check("processors_role_check", sql`${t.role} in ('processor','sub_processor')`),
    check("processors_transfer_check", sql`(not ${t.crossBorder} and ${t.transferBasis} is null) or (${t.crossBorder} and length(btrim(coalesce(${t.transferBasis}, ''))) between 3 and 300)`),
  ],
);

export const BREACH_STATES = ["open", "assessed", "notified", "not_notifiable", "closed"] as const;
export const breaches = pgTable(
  "breaches",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    awareAt: timestamp("aware_at", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    description: text("description").notNull(),
    affectedCount: integer("affected_count"),
    dataCategories: text("data_categories").notNull(),
    state: text("state", { enum: BREACH_STATES }).notNull().default("open"),
    notNotifiableReason: text("not_notifiable_reason"),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    assessedBy: uuid("assessed_by"),
    concludedAt: timestamp("concluded_at", { withTimezone: true }),
    concludedBy: uuid("concluded_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "breaches_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "breaches_assessed_by_fk", columns: [t.tenantId, t.assessedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "breaches_concluded_by_fk", columns: [t.tenantId, t.concludedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "breaches_closed_by_fk", columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("breaches_tenant_id_id_key").on(t.tenantId, t.id),
    index("breaches_tenant_aware_idx").on(t.tenantId, t.awareAt),
    check("breaches_deadline_check", sql`${t.deadlineAt} = ${t.awareAt} + interval '72 hours' and ${t.awareAt} <= ${t.createdAt}`),
    check("breaches_text_check", sql`length(btrim(${t.description})) between 10 and 2000 and length(btrim(${t.dataCategories})) between 2 and 300
      and (${t.affectedCount} is null or ${t.affectedCount} >= 0)`),
    check("breaches_state_check", sql`${t.state} in ('open','assessed','notified','not_notifiable','closed')
      and ((${t.state} = 'open') = (${t.assessedAt} is null)) and ((${t.assessedAt} is null) = (${t.assessedBy} is null))
      and ((${t.state} in ('open','assessed')) = (${t.concludedAt} is null)) and ((${t.concludedAt} is null) = (${t.concludedBy} is null))
      and ((${t.state} = 'closed') = (${t.closedAt} is not null)) and ((${t.closedAt} is null) = (${t.closedBy} is null))
      and ((${t.state} in ('open','assessed','notified') and ${t.notNotifiableReason} is null)
           or (${t.state} = 'not_notifiable' and length(btrim(coalesce(${t.notNotifiableReason}, ''))) between 10 and 1000)
           or (${t.state} = 'closed' and (${t.notNotifiableReason} is null or length(btrim(${t.notNotifiableReason})) between 10 and 1000)))`),
  ],
);

export const NOTICE_RECIPIENTS = ["data_subjects", "authority", "other"] as const;
export const breachNotices = pgTable(
  "breach_notices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    breachId: uuid("breach_id").notNull(),
    recipientKind: text("recipient_kind", { enum: NOTICE_RECIPIENTS }).notNull(),
    recipient: text("recipient").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    channel: text("channel").notNull(),
    contentSummary: text("content_summary").notNull(),
    fileName: text("file_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    content: bytea("content").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "breach_notices_breach_fk", columns: [t.tenantId, t.breachId], foreignColumns: [breaches.tenantId, breaches.id] }).onDelete("restrict"),
    foreignKey({ name: "breach_notices_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("breach_notices_tenant_id_id_key").on(t.tenantId, t.id),
    index("breach_notices_breach_idx").on(t.tenantId, t.breachId),
    check("breach_notices_text_check", sql`${t.recipientKind} in ('data_subjects','authority','other') and length(btrim(${t.recipient})) between 2 and 200
      and length(btrim(${t.channel})) between 2 and 60 and length(btrim(${t.contentSummary})) between 10 and 2000
      and length(btrim(${t.fileName})) between 1 and 200 and ${t.fileName} !~ '[/\\\\]' and ${t.sentAt} <= ${t.createdAt}`),
    check("breach_notices_file_check", sql`${t.mediaType} in ('application/pdf','image/png','image/jpeg') and ${t.sha256} ~ '^[0-9a-f]{64}$'
      and ${t.sha256} = encode(sha256(${t.content}), 'hex') and ${t.sizeBytes} between 1 and 5242880 and ${t.sizeBytes} = octet_length(${t.content})`),
    check("breach_notices_created_as_check", sql`${t.createdAs} in ('owner','admin_pusat')`),
  ],
);

// ── Data-subject requests (PR-50, PRIV-2, UX-30 ▸ Permintaan; T-121, migration 0134) ─────────────
// Policy kind: tenant-shared, TEN-19 support_class = 'never', ZERO direct clinic_app/operator SELECT
// grants — accessed strictly through privacy_actor('data_request') SECURITY DEFINER readers/writers.
export const DSR_REQUESTERS = ["patient", "guardian", "representative"] as const;
export const DSR_RIGHTS = ["access", "correction", "consent_withdrawal", "restriction", "erasure"] as const;
export const DSR_CORRECTION_SCOPES = ["demographic", "clinical"] as const;
export const DSR_RESTRICTION_PURPOSES = ["marketing_wa", "publication"] as const;
export const DSR_CHANNELS = ["in_person", "paper", "whatsapp", "phone", "email"] as const;
export const DSR_IDENTITY_METHODS = ["ktp_in_person", "ktp_video", "guardian_document", "power_of_attorney"] as const;
export const DSR_STATES = ["received", "in_progress", "closed"] as const;
export const DSR_OUTCOMES = ["fulfilled", "partially_fulfilled", "refused", "withdrawn"] as const;
export const DSR_OUTCOME_BASES = [
  "fulfilled_delivered",
  "fulfilled_corrected",
  "fulfilled_consent_withdrawn",
  "fulfilled_restricted",
  "partial_medical_record_retention_pmk24_2022",
  "partial_demographic_edit_pending",
  "partial_subset_applied",
  "refused_medical_record_retention_pmk24_2022",
  "refused_statutory_tax_accounting_retention",
  "refused_demographic_edit_unavailable",
  "refused_unverifiable_or_unauthorized",
  "refused_no_matching_data",
  "withdrawn_by_requester",
] as const;
export const DSR_LINK_KINDS = ["record_copy", "record_version", "record_correction", "consent_withdrawal"] as const;

export const dataSubjectRequests = pgTable(
  "data_subject_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id"),
    requesterKind: text("requester_kind", { enum: DSR_REQUESTERS }).notNull(),
    right: text("right", { enum: DSR_RIGHTS }).notNull(),
    correctionScope: text("correction_scope", { enum: DSR_CORRECTION_SCOPES }),
    requestedPurposes: text("requested_purposes").array(),
    channel: text("channel", { enum: DSR_CHANNELS }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
    identityMethod: text("identity_method", { enum: DSR_IDENTITY_METHODS }),
    identityVerifiedBy: uuid("identity_verified_by"),
    assignedTo: uuid("assigned_to"),
    state: text("state", { enum: DSR_STATES }).notNull().default("received"),
    outcome: text("outcome", { enum: DSR_OUTCOMES }),
    outcomeBasisCode: text("outcome_basis_code", { enum: DSR_OUTCOME_BASES }),
    outcomeNote: text("outcome_note"),
    deliveryChannel: text("delivery_channel", { enum: DSR_CHANNELS }),
    deliveryConfirmedAt: timestamp("delivery_confirmed_at", { withTimezone: true }),
    deliveryActor: uuid("delivery_actor"),
    deliveryRef: text("delivery_ref"),
    withdrawalSource: text("withdrawal_source", { enum: DSR_CHANNELS }),
    withdrawalAttestation: text("withdrawal_attestation"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    commandKey: text("command_key").notNull(),
    inputSha256: text("input_sha256").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_verified_by_fk", columns: [t.tenantId, t.identityVerifiedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_assigned_to_fk", columns: [t.tenantId, t.assignedTo], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_delivery_actor_fk", columns: [t.tenantId, t.deliveryActor], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_closed_by_fk", columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("dsr_tenant_id_id_key").on(t.tenantId, t.id),
    unique("dsr_command_key").on(t.tenantId, t.commandKey),
    index("dsr_open_idx").on(t.tenantId, t.deadlineAt).where(sql`${t.state} <> 'closed'`),
    check("dsr_kind_check", sql`${t.requesterKind} in ('patient','guardian','representative')
      and ${t.right} in ('access','correction','consent_withdrawal','restriction','erasure')
      and ${t.channel} in ('in_person','paper','whatsapp','phone','email')
      and ((${t.right} = 'correction') = (${t.correctionScope} is not null))
      and (${t.correctionScope} is null or ${t.correctionScope} in ('demographic','clinical'))
      and ((${t.right} = 'restriction') = (${t.requestedPurposes} is not null))
      and (${t.requestedPurposes} is null or (cardinality(${t.requestedPurposes}) between 1 and 2 and ${t.requestedPurposes} <@ array['marketing_wa','publication']::text[]))`),
    check("dsr_deadline_check", sql`isfinite(${t.receivedAt}) and isfinite(${t.deadlineAt}) and ${t.deadlineAt} = ${t.receivedAt} + interval '72 hours' and ${t.receivedAt} <= ${t.createdAt}`),
    check("dsr_identity_check", sql`((${t.identityVerifiedAt} is null) = (${t.identityMethod} is null))
      and ((${t.identityVerifiedAt} is null) = (${t.identityVerifiedBy} is null))
      and (${t.identityVerifiedAt} is null or (isfinite(${t.identityVerifiedAt}) and ${t.identityVerifiedAt} >= ${t.receivedAt}))
      and (${t.identityMethod} is null
        or ${t.requesterKind} = 'patient' and ${t.identityMethod} in ('ktp_in_person','ktp_video')
        or ${t.requesterKind} = 'guardian' and ${t.identityMethod} = 'guardian_document'
        or ${t.requesterKind} = 'representative' and ${t.identityMethod} = 'power_of_attorney')`),
    check("dsr_state_check", sql`${t.state} in ('received','in_progress','closed')
      and ((${t.state} = 'received') = (${t.identityVerifiedAt} is null and ${t.closedAt} is null))
      and ((${t.state} = 'in_progress') = (${t.identityVerifiedAt} is not null and ${t.closedAt} is null))
      and ((${t.state} = 'closed') = (${t.closedAt} is not null))
      and ((${t.closedAt} is null) = (${t.closedBy} is null))
      and ((${t.closedAt} is null) = (${t.outcome} is null))
      and ((${t.closedAt} is null) = (${t.outcomeBasisCode} is null))`),
    check("dsr_outcome_check", sql`(${t.outcome} is null and ${t.outcomeBasisCode} is null and ${t.outcomeNote} is null
        and ${t.deliveryChannel} is null and ${t.deliveryConfirmedAt} is null and ${t.deliveryActor} is null and ${t.deliveryRef} is null
        and ${t.withdrawalSource} is null and ${t.withdrawalAttestation} is null)
      or (${t.outcome} = 'withdrawn'
        and ${t.outcomeBasisCode} = 'withdrawn_by_requester'
        and ${t.deliveryChannel} is null and ${t.deliveryConfirmedAt} is null and ${t.deliveryActor} is null and ${t.deliveryRef} is null
        and ${t.withdrawalSource} in ('in_person','paper','whatsapp','phone','email')
        and length(btrim(coalesce(${t.withdrawalAttestation}, ''))) between 5 and 200
        and (${t.outcomeNote} is null or length(btrim(${t.outcomeNote})) between 1 and 300)
        and isfinite(${t.closedAt}) and ${t.closedAt} >= ${t.receivedAt})
      or (${t.outcome} in ('fulfilled','partially_fulfilled','refused')
        and ${t.identityVerifiedAt} is not null
        and ${t.outcomeBasisCode} in (
          'fulfilled_delivered','fulfilled_corrected','fulfilled_consent_withdrawn','fulfilled_restricted',
          'partial_medical_record_retention_pmk24_2022','partial_demographic_edit_pending','partial_subset_applied',
          'refused_medical_record_retention_pmk24_2022','refused_statutory_tax_accounting_retention',
          'refused_demographic_edit_unavailable','refused_unverifiable_or_unauthorized','refused_no_matching_data'
        )
        and ${t.deliveryChannel} in ('in_person','paper','whatsapp','phone','email')
        and ${t.deliveryConfirmedAt} is not null and isfinite(${t.deliveryConfirmedAt})
        and ${t.deliveryActor} is not null
        and length(btrim(coalesce(${t.deliveryRef}, ''))) between 3 and 200
        and ${t.withdrawalSource} is null and ${t.withdrawalAttestation} is null
        and (${t.outcomeNote} is null or length(btrim(${t.outcomeNote})) between 1 and 300)
        and isfinite(${t.closedAt})
        and ${t.receivedAt} <= ${t.identityVerifiedAt}
        and ${t.identityVerifiedAt} <= ${t.deliveryConfirmedAt}
        and ${t.deliveryConfirmedAt} <= ${t.closedAt})`),
    check("dsr_meta_check", sql`length(${t.commandKey}) between 8 and 200 and ${t.inputSha256} ~ '^[0-9a-f]{64}$' and ${t.createdAs} in ('owner','admin_pusat')`),
  ],
).enableRLS();

export const dataSubjectRequestLinks = pgTable(
  "data_subject_request_links",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    requestId: uuid("request_id").notNull(),
    linkKind: text("link_kind", { enum: DSR_LINK_KINDS }).notNull(),
    linkId: uuid("link_id").notNull(),
    handoffRef: text("handoff_ref"),
    addressesRequest: boolean("addresses_request").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_links_request_fk", columns: [t.tenantId, t.requestId], foreignColumns: [dataSubjectRequests.tenantId, dataSubjectRequests.id] }).onDelete("restrict"),
    foreignKey({ name: "dsr_links_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("dsr_links_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("dsr_links_unique_item").on(t.tenantId, t.requestId, t.linkKind, t.linkId),
    index("dsr_links_request_idx").on(t.tenantId, t.requestId),
    check("dsr_links_kind_check", sql`${t.linkKind} in ('record_copy','record_version','record_correction','consent_withdrawal')
      and ((${t.linkKind} = 'record_copy') = (${t.handoffRef} is not null))
      and (${t.handoffRef} is null or length(btrim(${t.handoffRef})) between 3 and 200)
      and (${t.linkKind} not in ('record_version','record_correction') or ${t.addressesRequest} = true)`),
  ],
).enableRLS();

export const recordCopyHandoffs = pgTable(
  "record_copy_handoffs",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    copyRequestId: uuid("copy_request_id").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    handoffChannel: text("handoff_channel", { enum: DSR_CHANNELS }).notNull(),
    handedOffAt: timestamp("handed_off_at", { withTimezone: true }).notNull(),
    handoffRef: text("handoff_ref").notNull(),
    confirmedBy: uuid("confirmed_by").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "record_copy_handoffs_copy_fk", columns: [t.tenantId, t.copyRequestId], foreignColumns: [recordCopyRequests.tenantId, recordCopyRequests.id] }).onDelete("restrict"),
    foreignKey({ name: "record_copy_handoffs_by_fk", columns: [t.tenantId, t.confirmedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("record_copy_handoffs_tenant_id_id_key").on(t.tenantId, t.id),
    unique("record_copy_handoffs_copy_key").on(t.tenantId, t.copyRequestId),
    check("record_copy_handoffs_check", sql`${t.artifactSha256} ~ '^[0-9a-f]{64}$'
      and ${t.handoffChannel} in ('in_person','paper','whatsapp','phone','email')
      and isfinite(${t.handedOffAt}) and ${t.handedOffAt} <= ${t.confirmedAt}
      and length(btrim(${t.handoffRef})) between 3 and 200`),
  ],
).enableRLS();
