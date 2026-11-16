// CRM: leads and campaigns (PR-29, DATA-39, UX-18; T-092, migration 0107, DEC-104). A lead follows new → contacted → booked → arrived →
// converted, or lost with a reason, carrying its source, campaign, branch, assignee and first-response time (K13/K14 facts). Staff confirm each
// step; the definer checks the fact behind it (an appointment, a checked-in visit, a real payment — Scenario PR-29). The contact name is sealed
// (`lead.contact`); contact columns and the lost note are not granted. Campaign segments and sending are T-100.
// Follow-ups (PR-30; T-093, migration 0108, DEC-105): tasks created from decided rules by a daily unbound scan (control due, package stage
// and expiry, locked instalments, receivables, unselected plan items, dormant patients) and by the no-show trigger; one per rule × source ×
// step for ever (a closed task is never re-created); titles from rule codes only (no clinical content). An Ubah Jadwal reminder reply
// (T-095) creates a reschedule_request task for CS (PR-83).
// Automation scenarios (PR-94, UX-55; T-097, migration 0112, DEC-109): one occurrence per (scenario, source, offset), queued through the
// T-094 outbound queue under a per-patient daily cap (SET-19 batas_harian); marketing proposes SET-19 drafts that Admin Pusat or the owner
// decides.
// Aftercare (PR-70; T-096, migration 0111, DEC-108): one notice per closed visit with aftercare texts, sent as a neutral care message with a
// link token minted at claim time (only its hash is stored, 7-day TTL), opened after a WhatsApp OTP (hashed, 5 min, 5 attempts, RATE-1).
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invoices } from "../cashier/schema";
import { conversations, messages, outboundMessages, waTemplates } from "../messaging/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { appointments } from "../scheduling/schema";
import { visits } from "../visits/schema";

export const LEAD_STAGES = ["new", "contacted", "booked", "arrived", "converted", "lost"] as const;
export const LEAD_SOURCES = ["whatsapp", "walk_in", "phone", "instagram", "tiktok", "website", "referral", "ads", "other"] as const;
export const LEAD_LOST_REASONS = ["harga", "jadwal", "lokasi", "tidak_merespons", "memilih_klinik_lain", "tidak_cocok", "duplikat", "lainnya"] as const;
export const LEAD_EVENT_KINDS = ["created", "stage_changed", "reopened", "assigned", "routed", "patient_matched"] as const;
export const CAMPAIGN_CHANNELS = ["whatsapp", "instagram", "tiktok", "website", "referral", "ads", "event", "other"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const CIPHER = (c: unknown) => sql`${c} ~ '^v1\\.[1-9][0-9]{0,8}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`;
const DEK = (c: unknown) => sql`${c} ~ '^dek:v[1-9][0-9]{0,8}$'`;

// T-100 (PR-94, UX-19, DEC-112): a saved segment — a closed set of non-clinical rules (branch, last visit date window, birthday month, age
// band, sex); members are computed at read / send time and always intersected with an active marketing_wa consent (PR-4). No member list.
export const CAMPAIGN_SEND_STATES = ["draft", "scheduled", "queued", "cancelled"] as const;
export const campaignSegments = pgTable(
  "campaign_segments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    rules: jsonb("rules").notNull(),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("campaign_segments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("campaign_segments_command_key").on(t.tenantId, t.commandKey),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("campaign_segments_check", sql`${KEY(t.commandKey)} and length(btrim(${t.name})) between 2 and 120 and jsonb_typeof(${t.rules}) = 'object'
      and ${t.createdAs} in ('owner','admin_pusat','marketing')`),
  ],
);

// A campaign tag for leads (T-092); T-100 adds the campaign workspace (segment, template, schedule, send state) — expand-only columns.
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    channel: text("channel", { enum: CAMPAIGN_CHANNELS }).notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
    segmentId: uuid("segment_id"),
    templateId: uuid("template_id"),
    scheduledFor: date("scheduled_for"),
    sendState: text("send_state", { enum: CAMPAIGN_SEND_STATES }).notNull().default("draft"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    queuedBy: uuid("queued_by"),
  },
  (t) => [
    unique("campaigns_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({ name: "campaigns_segment_fk", columns: [t.tenantId, t.segmentId], foreignColumns: [campaignSegments.tenantId, campaignSegments.id] }).onDelete("restrict"),
    foreignKey({ name: "campaigns_template_fk", columns: [t.tenantId, t.templateId], foreignColumns: [waTemplates.tenantId, waTemplates.id] }).onDelete("restrict"),
    foreignKey({ name: "campaigns_queued_by_fk", columns: [t.tenantId, t.queuedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("campaigns_send_check", sql`${t.sendState} in (${inList(CAMPAIGN_SEND_STATES)})
      and (${t.sendState} in ('scheduled','queued')) <= (${t.segmentId} is not null and ${t.templateId} is not null and ${t.scheduledFor} is not null)
      and (${t.sendState} = 'queued') = (${t.queuedAt} is not null and ${t.queuedBy} is not null)`),
    unique("campaigns_code_key").on(t.tenantId, t.code),
    unique("campaigns_command_key").on(t.tenantId, t.commandKey),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("campaigns_check", sql`${KEY(t.commandKey)} and length(btrim(${t.name})) between 2 and 120 and ${t.code} ~ '^[a-z0-9][a-z0-9_-]{1,40}$'
      and ${t.channel} in (${inList(CAMPAIGN_CHANNELS)})`),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id"),
    source: text("source", { enum: LEAD_SOURCES }).notNull(),
    campaignId: uuid("campaign_id"),
    conversationId: uuid("conversation_id"),
    patientId: uuid("patient_id"),
    contactNameEnc: text("contact_name_enc"),
    contactNameDekRef: text("contact_name_dek_ref"),
    contactPhone: text("contact_phone"),
    assigneeStaffId: uuid("assignee_staff_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    stage: text("stage", { enum: LEAD_STAGES }).notNull().default("new"),
    lostReason: text("lost_reason", { enum: LEAD_LOST_REASONS }),
    lostNote: text("lost_note"),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    appointmentId: uuid("appointment_id"),
    visitId: uuid("visit_id"),
    convertedInvoiceId: uuid("converted_invoice_id"),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    unique("leads_tenant_id_id_key").on(t.tenantId, t.id),
    unique("leads_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("leads_open_conversation_key").on(t.tenantId, t.conversationId).where(sql`${t.conversationId} is not null and ${t.stage} not in ('converted','lost')`),
    uniqueIndex("leads_open_patient_key").on(t.tenantId, t.patientId).where(sql`${t.patientId} is not null and ${t.stage} not in ('converted','lost')`),
    index("leads_stage_idx").on(t.tenantId, t.branchId, t.stage),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.conversationId], foreignColumns: [conversations.tenantId, conversations.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.assigneeStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.visitId], foreignColumns: [visits.tenantId, visits.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.convertedInvoiceId], foreignColumns: [invoices.tenantId, invoices.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("leads_check", sql`${KEY(t.commandKey)} and ${t.stage} in (${inList(LEAD_STAGES)}) and ${t.source} in (${inList(LEAD_SOURCES)})
      and (${t.stage} not in ('contacted','booked','arrived','converted') or (${t.contactedAt} is not null and ${t.firstResponseAt} is not null))
      and (${t.stage} not in ('booked','arrived','converted') or (${t.patientId} is not null and ${t.branchId} is not null and ${t.appointmentId} is not null and ${t.bookedAt} is not null))
      and (${t.stage} not in ('arrived','converted') or (${t.visitId} is not null and ${t.arrivedAt} is not null))
      and ((${t.stage} = 'converted') = (${t.convertedInvoiceId} is not null and ${t.convertedAt} is not null))
      and ((${t.stage} = 'lost') = (${t.lostReason} is not null and ${t.lostAt} is not null))
      and (${t.lostReason} is null or ${t.lostReason} in (${inList(LEAD_LOST_REASONS)}))
      and (${t.lostReason} is distinct from 'lainnya' or ${t.lostNote} is not null)
      and (${t.lostNote} is null or length(btrim(${t.lostNote})) between 3 and 500)
      and ((${t.assigneeStaffId} is null) = (${t.assignedAt} is null))
      and ((${t.contactNameEnc} is null) = (${t.contactNameDekRef} is null))
      and (${t.contactNameEnc} is null or (${CIPHER(t.contactNameEnc)} and ${DEK(t.contactNameDekRef)}))
      and (${t.contactPhone} is null or ${t.contactPhone} ~ '^\\+[1-9][0-9]{7,14}$')
      and (${t.conversationId} is null or ${t.source} = 'whatsapp')`),
  ],
);

export const leadEvents = pgTable(
  "lead_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    kind: text("kind", { enum: LEAD_EVENT_KINDS }).notNull(),
    fromStage: text("from_stage", { enum: LEAD_STAGES }),
    toStage: text("to_stage", { enum: LEAD_STAGES }).notNull(),
    reason: text("reason", { enum: LEAD_LOST_REASONS }),
    appointmentId: uuid("appointment_id"),
    visitId: uuid("visit_id"),
    invoiceId: uuid("invoice_id"),
    actorId: uuid("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("lead_events_tenant_id_id_key").on(t.tenantId, t.id),
    index("lead_events_lead_idx").on(t.tenantId, t.leadId, t.createdAt),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.leadId], foreignColumns: [leads.tenantId, leads.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.visitId], foreignColumns: [visits.tenantId, visits.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("lead_events_check", sql`${t.kind} in (${inList(LEAD_EVENT_KINDS)}) and ${t.toStage} in (${inList(LEAD_STAGES)})
      and (${t.fromStage} is null or ${t.fromStage} in (${inList(LEAD_STAGES)})) and ((${t.kind} = 'created') = (${t.fromStage} is null))
      and ((${t.toStage} = 'lost' and ${t.kind} = 'stage_changed') = (${t.reason} is not null))`),
  ],
);

export const FOLLOWUP_RULES = ["control_due", "package_stage", "package_expiry", "instalment_locked", "receivable", "plan_unselected", "no_show", "dormant", "reschedule_request", "survey_low"] as const;
export const FOLLOWUP_SOURCES = ["consultation_control", "package", "instalment_row", "receivable", "care_plan", "appointment", "patient", "survey"] as const;
export const FOLLOWUP_STATES = ["open", "done", "dismissed"] as const;
export const FOLLOWUP_QUEUES = ["cs", "bc"] as const;
export const FOLLOWUP_DONE_OUTCOMES = ["dihubungi", "jadwal_dibuat", "sudah_bayar", "tidak_tertarik", "tidak_merespons", "lainnya"] as const;
export const FOLLOWUP_DISMISS_OUTCOMES = ["dilewati", "diganti"] as const;
// rule → (source kind, queue): the only legal pairs (plan r1 P1-2)
const RULE_SHAPE = sql.raw(
  "(('control_due','consultation_control','bc'), ('package_stage','package','bc'), ('package_expiry','package','bc'), " +
    "('instalment_locked','instalment_row','cs'), ('receivable','receivable','cs'), ('plan_unselected','care_plan','bc'), " +
    "('no_show','appointment','cs'), ('dormant','patient','cs'), ('reschedule_request','appointment','cs'), ('survey_low','survey','cs'))",
);

export const followups = pgTable(
  "followups",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    leadId: uuid("lead_id"),
    ruleCode: text("rule_code", { enum: FOLLOWUP_RULES }).notNull(),
    sourceKind: text("source_kind", { enum: FOLLOWUP_SOURCES }).notNull(),
    sourceId: uuid("source_id").notNull(),
    step: text("step").notNull(),
    roleQueue: text("role_queue", { enum: FOLLOWUP_QUEUES }).notNull(),
    assigneeStaffId: uuid("assignee_staff_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    originalDueOn: date("original_due_on").notNull(),
    dueOn: date("due_on").notNull(),
    snoozeCount: smallint("snooze_count").notNull().default(0),
    state: text("state", { enum: FOLLOWUP_STATES }).notNull().default("open"),
    outcome: text("outcome"),
    outcomeNote: text("outcome_note"),
    closedBy: uuid("closed_by"),
    closedAs: text("closed_as"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("followups_tenant_id_id_key").on(t.tenantId, t.id),
    // plan r1 P1-1: a full key — a done or dismissed task is never re-created for the same fact and step
    unique("followups_rule_source_step_key").on(t.tenantId, t.ruleCode, t.sourceId, t.step),
    index("followups_due_idx").on(t.tenantId, t.branchId, t.state, t.dueOn),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.leadId], foreignColumns: [leads.tenantId, leads.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.assigneeStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    // plan r2 P3-1: diganti is the scan's (no staff), dilewati a staff dismissal with a note
    check("followups_check", sql`${t.state} in (${inList(FOLLOWUP_STATES)})
      and (${t.ruleCode}, ${t.sourceKind}, ${t.roleQueue}) in ${RULE_SHAPE}
      and ${t.step} ~ '^[a-z0-9_]{1,40}$' and ${t.snoozeCount} between 0 and 50 and ${t.dueOn} >= ${t.originalDueOn}
      and ((${t.assigneeStaffId} is null) = (${t.assignedAt} is null))
      and ((${t.state} = 'open') = (${t.closedAt} is null)) and ((${t.state} = 'open') = (${t.outcome} is null))
      and ((${t.closedBy} is null) = (${t.closedAs} is null))
      and (${t.outcomeNote} is null or length(btrim(${t.outcomeNote})) between 3 and 500)
      and (${t.state} <> 'done' or ${t.outcome} in (${inList(FOLLOWUP_DONE_OUTCOMES)}) and ${t.closedBy} is not null
           and (${t.outcome} <> 'lainnya' or ${t.outcomeNote} is not null))
      and (${t.state} <> 'dismissed' or (${t.outcome} = 'diganti' and ${t.closedBy} is null)
           or (${t.outcome} = 'dilewati' and ${t.closedBy} is not null and ${t.outcomeNote} is not null))`),
  ],
);

// Appointment reminders (PR-69; T-095, migration 0110, DEC-107): one H-1 and one same-day reminder per appointment, queued through the T-094
// outbound queue by the unbound reminder scan; the patient's Konfirmasi confirms the appointment, Ubah Jadwal opens a CS follow-up. A reply is
// recorded once and is final. Ids and codes only (the reply text stays sealed in messages, W-10).
export const REMINDER_KINDS = ["h1", "same_day"] as const;
export const REMINDER_REPLIES = ["confirm", "reschedule"] as const;

export const appointmentReminders = pgTable(
  "appointment_reminders",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    kind: text("kind", { enum: REMINDER_KINDS }).notNull(),
    outboundId: uuid("outbound_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    reply: text("reply", { enum: REMINDER_REPLIES }),
    replyMessageId: uuid("reply_message_id"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    followupId: uuid("followup_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("appointment_reminders_tenant_id_id_key").on(t.tenantId, t.id),
    unique("appointment_reminders_appointment_kind_key").on(t.tenantId, t.appointmentId, t.kind),
    unique("appointment_reminders_outbound_key").on(t.tenantId, t.outboundId),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    // the reminder's branch is the appointment's (appointments_tenant_branch_id_key)
    foreignKey({ columns: [t.tenantId, t.branchId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.branchId, appointments.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.outboundId], foreignColumns: [outboundMessages.tenantId, outboundMessages.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.replyMessageId], foreignColumns: [messages.tenantId, messages.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.followupId], foreignColumns: [followups.tenantId, followups.id] }).onDelete("restrict"),
    check("appointment_reminders_check", sql`${t.kind} in (${inList(REMINDER_KINDS)})
      and (${t.reply} is null or ${t.reply} in (${inList(REMINDER_REPLIES)}))
      and ((${t.reply} is null) = (${t.replyMessageId} is null)) and ((${t.reply} is null) = (${t.repliedAt} is null))
      and ((${t.followupId} is not null) = (${t.reply} is not distinct from 'reschedule'))`),
  ],
);

export const AFTERCARE_OTP_OUTCOMES = ["sent", "rate_limited", "otp_locked", "link_expired", "number_not_sending"] as const;

export const aftercareNotices = pgTable(
  "aftercare_notices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    catalogVersionIds: uuid("catalog_version_ids").array().notNull(),
    outboundId: uuid("outbound_id"),
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    otpHash: text("otp_hash"),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpAttempts: smallint("otp_attempts").notNull().default(0),
    otpLockedUntil: timestamp("otp_locked_until", { withTimezone: true }),
    sessionHash: text("session_hash"),
    sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("aftercare_notices_tenant_id_id_key").on(t.tenantId, t.id),
    unique("aftercare_notices_visit_key").on(t.tenantId, t.visitId),
    unique("aftercare_notices_outbound_key").on(t.tenantId, t.outboundId),
    unique("aftercare_notices_token_key").on(t.tokenHash),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.outboundId], foreignColumns: [outboundMessages.tenantId, outboundMessages.id] }).onDelete("restrict"),
    check("aftercare_notices_check", sql`cardinality(${t.catalogVersionIds}) between 1 and 50
      and ((${t.tokenHash} is null) = (${t.expiresAt} is null)) and (${t.tokenHash} is null or ${t.tokenHash} ~ '^[0-9a-f]{64}$')
      and ((${t.otpHash} is null) = (${t.otpExpiresAt} is null)) and ${t.otpAttempts} between 0 and 5
      and ((${t.sessionHash} is null) = (${t.sessionExpiresAt} is null))`),
  ],
);

// The OTP send log (RATE-1: ≤ 3 sends per 10 min per phone, ≤ 10 per minute per IP — counted on outcome 'sent'); support class never.
export const aftercareOtpSends = pgTable(
  "aftercare_otp_sends",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    noticeId: uuid("notice_id").notNull(),
    phone: text("phone").notNull(),
    ipHash: text("ip_hash").notNull(),
    outcome: text("outcome", { enum: AFTERCARE_OTP_OUTCOMES }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("aftercare_otp_sends_tenant_id_id_key").on(t.tenantId, t.id),
    index("aftercare_otp_sends_rate_idx").on(t.tenantId, t.phone, t.sentAt),
    index("aftercare_otp_sends_ip_idx").on(t.ipHash, t.sentAt),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.noticeId], foreignColumns: [aftercareNotices.tenantId, aftercareNotices.id] }).onDelete("restrict"),
    check("aftercare_otp_sends_check", sql`${t.outcome} in (${inList(AFTERCARE_OTP_OUTCOMES)})
      and ${t.ipHash} ~ '^[0-9a-f]{64}$' and ${t.phone} ~ '^[1-9][0-9]{7,14}$'`),
  ],
);

export const AUTOMATION_SCENARIOS = ["pengingat", "aftercare", "kepuasan", "rencana", "belum_jadwal", "isi_ulang", "ulang_tahun"] as const;
export const AUTOMATION_SOURCES = ["appointment", "visit", "dispensing", "patient"] as const;
export const AUTOMATION_SKIPS = ["cap_horizon_exceeded", "no_consent", "patient_phone_required", "number_not_sending", "template_not_usable", "template_missing"] as const;
export const AUTOMATION_DRAFT_STATES = ["pending", "approved", "rejected", "cancelled"] as const;

export const automationOccurrences = pgTable(
  "automation_occurrences",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    scenario: text("scenario", { enum: AUTOMATION_SCENARIOS }).notNull(),
    sourceKind: text("source_kind", { enum: AUTOMATION_SOURCES }).notNull(),
    sourceId: uuid("source_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    offsetDays: integer("offset_days").notNull(),
    originalPlannedFor: date("original_planned_for").notNull(),
    plannedFor: date("planned_for"),
    capDeferredDays: smallint("cap_deferred_days").notNull().default(0),
    state: text("state", { enum: ["queued", "skipped"] }).notNull(),
    skipReason: text("skip_reason"),
    outboundId: uuid("outbound_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("automation_occurrences_tenant_id_id_key").on(t.tenantId, t.id),
    unique("automation_occurrences_key").on(t.tenantId, t.scenario, t.sourceId, t.offsetDays),
    index("automation_occurrences_log_idx").on(t.tenantId, t.createdAt),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.outboundId], foreignColumns: [outboundMessages.tenantId, outboundMessages.id] }).onDelete("restrict"),
    check("automation_occurrences_check", sql`${t.scenario} in (${inList(AUTOMATION_SCENARIOS)}) and ${t.sourceKind} in (${inList(AUTOMATION_SOURCES)})
      and ${t.state} in ('queued','skipped')
      and ((${t.state} = 'queued') = (${t.outboundId} is not null and ${t.plannedFor} is not null))
      and ((${t.state} = 'skipped') = (${t.skipReason} is not null))
      and (${t.skipReason} is null or ${t.skipReason} in (${inList(AUTOMATION_SKIPS)}))
      and ${t.capDeferredDays} between 0 and 7 and (${t.plannedFor} is null or ${t.plannedFor} = ${t.originalPlannedFor} + ${t.capDeferredDays})`),
  ],
);

export const automationScenarioDrafts = pgTable(
  "automation_scenario_drafts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    value: jsonb("value").notNull(),
    reason: text("reason").notNull(),
    state: text("state", { enum: AUTOMATION_DRAFT_STATES }).notNull().default("pending"),
    commandKey: text("command_key").notNull(),
    proposedBy: uuid("proposed_by").notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    decidedBy: uuid("decided_by"),
    decidedAs: text("decided_as"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    settingVersionId: uuid("setting_version_id"),
  },
  (t) => [
    unique("automation_scenario_drafts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("automation_scenario_drafts_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("automation_scenario_drafts_one_pending").on(t.tenantId).where(sql`${t.state} = 'pending'`),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.proposedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("automation_scenario_drafts_check", sql`${t.state} in (${inList(AUTOMATION_DRAFT_STATES)})
      and length(btrim(${t.reason})) between 3 and 500
      and ((${t.state} = 'pending') = (${t.decidedAt} is null)) and ((${t.decidedBy} is null) = (${t.decidedAs} is null))
      and (${t.state} <> 'approved' or ${t.decidedBy} is not null and ${t.settingVersionId} is not null)
      and (${t.state} <> 'rejected' or ${t.decidedBy} is not null and ${t.decisionReason} is not null and length(btrim(${t.decisionReason})) between 3 and 500)
      and (${t.state} <> 'cancelled' or ${t.decidedBy} = ${t.proposedBy})`),
  ],
);

// T-098 (PR-78, plan r1 §2; DEC-110): one satisfaction survey per closed visit. Score 1–5 only — no free text (no clinical content).
// review_eligible = score >= 4 (no send in T-098); a score <= 2 links the manager's survey_low follow-up.
export const SURVEY_RECORDERS = ["owner", "central_cs", "manager"] as const;
export const surveys = pgTable(
  "surveys",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    score: smallint("score").notNull(),
    reviewEligible: boolean("review_eligible").notNull(),
    followupId: uuid("followup_id"),
    commandKey: text("command_key").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as", { enum: SURVEY_RECORDERS }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("surveys_tenant_id_id_key").on(t.tenantId, t.id),
    unique("surveys_visit_key").on(t.tenantId, t.visitId),
    unique("surveys_command_key").on(t.tenantId, t.commandKey),
    index("surveys_branch_recorded_idx").on(t.tenantId, t.branchId, t.recordedAt),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.followupId], foreignColumns: [followups.tenantId, followups.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("surveys_check", sql`${t.score} between 1 and 5 and ${t.reviewEligible} = (${t.score} >= 4)
      and ((${t.followupId} is not null) = (${t.score} <= 2))
      and ${t.commandKey} ~ '^[A-Za-z0-9_.:-]{8,128}$' and ${t.recordedAs} in (${inList(SURVEY_RECORDERS)})`),
  ],
);
