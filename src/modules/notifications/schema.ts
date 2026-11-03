// In-app notifications (PR-54, DATA-42). A notification goes to a role at a branch (every
// staff member acting in that role there sees it) or to one staff member; one person's
// acknowledgement closes it for everyone and records who and when. Content is a type
// code and a subject reference only (no clinical content, no names: the screen loads the
// subject). Policy kinds: notification_types is a platform registry (rows from the
// migrations of the tasks that add alert types); notifications are tenant-shared.
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

export const notificationTypes = pgTable(
  "notification_types",
  {
    key: text("key").primaryKey(),
    label: text("label").notNull(), // Indonesian title shown in Notifikasi
    recipientRoles: text("recipient_roles").array().notNull(), // roles a notification of this type may address
    subjectKinds: text("subject_kinds").array().notNull(), // what a notification of this type may point at
    // Raised by a staff action (e.g. a clinical request); otherwise only by service contexts
    // (outbox consumers turning domain events into alerts).
    raisableByStaff: boolean("raisable_by_staff").notNull().default(false),
  },
  (t) => [
    check("notification_types_key_check", sql`${t.key} ~ '^[a-z][a-z_]{2,40}$'`),
    check("notification_types_roles_check", sql`cardinality(${t.recipientRoles}) >= 1 and cardinality(${t.subjectKinds}) >= 1`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    type: text("type")
      .notNull()
      .references(() => notificationTypes.key, { onDelete: "restrict" }),
    recipientRole: text("recipient_role"), // a role (at branch_id, or tenant-wide when null)
    recipientStaffId: uuid("recipient_staff_id"), // or one person
    branchId: uuid("branch_id"),
    subjectKind: text("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    sourceEventId: uuid("source_event_id"), // the domain event that raised it (dedupe)
    raisedBy: uuid("raised_by"), // the staff member whose action raised it; null = a service
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedBy: uuid("acknowledged_by"),
    acknowledgedAs: text("acknowledged_as"),
    // Snapshot of the acknowledger's display name: every recipient sees who acknowledged,
    // even roles that may not read the staff list (T-029 readers).
    acknowledgedName: text("acknowledged_name"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.recipientStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.acknowledgedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.raisedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("notifications_tenant_id_id_key").on(t.tenantId, t.id),
    // One notification per type, recipient and source event (an event redelivered to the
    // consumer never raises a second alert): partial unique index in migration 0024,
    // NULLS NOT DISTINCT over the recipient columns, only where a source event is set.
    index("notifications_open_idx").on(t.tenantId, t.recipientRole, t.branchId).where(sql`${t.acknowledgedAt} is null`),
    check("notifications_recipient_check", sql`(${t.recipientRole} is null) <> (${t.recipientStaffId} is null)`),
    check("notifications_subject_kind_check", sql`${t.subjectKind} ~ '^[a-z][a-z_]{1,40}$'`),
    check(
      "notifications_ack_check",
      sql`(${t.acknowledgedAt} is null) = (${t.acknowledgedBy} is null) and (${t.acknowledgedAt} is null) = (${t.acknowledgedAs} is null)
       and (${t.acknowledgedAt} is null) = (${t.acknowledgedName} is null)`,
    ),
  ],
);
