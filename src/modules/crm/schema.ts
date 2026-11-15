// CRM: leads and campaigns (PR-29, DATA-39, UX-18; T-092, migration 0107, DEC-104). A lead follows new → contacted → booked → arrived →
// converted, or lost with a reason, carrying its source, campaign, branch, assignee and first-response time (K13/K14 facts). Staff confirm each
// step; the definer checks the fact behind it (an appointment, a checked-in visit, a real payment — Scenario PR-29). The contact name is sealed
// (`lead.contact`); contact columns and the lost note are not granted. Follow-ups (PR-30) are T-093; campaign segments and sending T-100.
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invoices } from "../cashier/schema";
import { conversations } from "../messaging/schema";
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

// A campaign tag for leads (minimal; segments, scheduling and sending are T-100).
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
  },
  (t) => [
    unique("campaigns_tenant_id_id_key").on(t.tenantId, t.id),
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
