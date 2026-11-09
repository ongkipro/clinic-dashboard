// Privacy workspace (PR-92, DATA-66; T-039, DEC-059). Policy kind: tenant-shared, read and written only by
// the privacy officers (Owner, or Admin Pusat holding the data-protection duty) through the definers of
// migration 0065. Processors are edited and ended, never deleted; breaches move open → assessed → notified
// | not_notifiable → closed with a stamp per step; notices are insert-only, their evidence file kept with
// its checksum (bytes never granted to an app role).
import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { staff, tenants } from "../org/schema";

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
