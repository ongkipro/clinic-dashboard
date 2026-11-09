// Visits (PR-7, DATA-17, UX-6; T-047, DEC-057). Policy kind: branch-scoped. One visit per check-in;
// independent state columns (the nine steps after Daftar), each set by its own later writer; a visit
// closes once, never reopens, never deleted. Written only by visit_check_in and visit_close (migration
// 0063) and the later state writers; clinic_app has SELECT only.
import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { rooms } from "../org/branches/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { appointments } from "../scheduling/schema";

export const STEP_STATES = ["not_started", "in_progress", "done", "not_needed", "blocked"] as const;
export const VISIT_KINDS = ["booked", "walk_in"] as const;
const STATES = sql.raw(STEP_STATES.map((s) => `'${s}'`).join(","));

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    appointmentId: uuid("appointment_id"),
    kind: text("kind", { enum: VISIT_KINDS }).notNull(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    checkedInBy: uuid("checked_in_by").notNull(),
    intake: text("intake", { enum: STEP_STATES }).notNull().default("not_started"),
    doctor: text("doctor", { enum: STEP_STATES }).notNull().default("not_started"),
    selection: text("selection", { enum: STEP_STATES }).notNull().default("not_started"),
    consent: text("consent", { enum: STEP_STATES }).notNull().default("not_started"),
    payment: text("payment", { enum: STEP_STATES }).notNull().default("not_started"),
    preparation: text("preparation", { enum: STEP_STATES }).notNull().default("not_started"),
    treatment: text("treatment", { enum: STEP_STATES }).notNull().default("not_started"),
    dispensing: text("dispensing", { enum: STEP_STATES }).notNull().default("not_started"),
    blocker: text("blocker"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "visits_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "visits_appointment_fk", columns: [t.tenantId, t.branchId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.branchId, appointments.id] }).onDelete("restrict"),
    foreignKey({ name: "visits_checked_in_by_fk", columns: [t.tenantId, t.checkedInBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "visits_closed_by_fk", columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("visits_tenant_id_id_key").on(t.tenantId, t.id),
    unique("visits_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("visits_tenant_appointment_key").on(t.tenantId, t.appointmentId),
    uniqueIndex("visits_one_open_per_patient").on(t.tenantId, t.branchId, t.patientId).where(sql`${t.closedAt} is null`),
    index("visits_branch_checked_in_idx").on(t.tenantId, t.branchId, t.checkedInAt),
    check("visits_kind_check", sql`${t.kind} in ('booked','walk_in') and ((${t.kind} = 'booked') = (${t.appointmentId} is not null))`),
    check("visits_closed_check", sql`(${t.closedAt} is null) = (${t.closedBy} is null)`),
    check("visits_blocker_check", sql`${t.blocker} is null or length(btrim(${t.blocker})) between 1 and 120`),
    check("visits_states_check", sql`${t.intake} in (${STATES}) and ${t.doctor} in (${STATES}) and ${t.selection} in (${STATES}) and ${t.consent} in (${STATES})
      and ${t.payment} in (${STATES}) and ${t.preparation} in (${STATES}) and ${t.treatment} in (${STATES}) and ${t.dispensing} in (${STATES})`),
  ],
);

// Queue numbers (PR-71, DATA-52; T-048). One ticket per visit, numbered per branch per branch-local day;
// written only by the queue definers (migration 0064); never deleted; nothing changes once done.
export const QUEUE_STATES = ["waiting", "called", "skipped", "done"] as const;
export const queueTickets = pgTable(
  "queue_tickets",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    queueDate: date("queue_date").notNull(),
    seq: integer("seq").notNull(),
    prefix: text("prefix").notNull(),
    visitId: uuid("visit_id").notNull(),
    state: text("state", { enum: QUEUE_STATES }).notNull().default("waiting"),
    calledAt: timestamp("called_at", { withTimezone: true }),
    calledBy: uuid("called_by"),
    roomId: uuid("room_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "queue_tickets_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "queue_tickets_room_fk", columns: [t.tenantId, t.branchId, t.roomId], foreignColumns: [rooms.tenantId, rooms.branchId, rooms.id] }).onDelete("restrict"),
    foreignKey({ name: "queue_tickets_called_by_fk", columns: [t.tenantId, t.calledBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("queue_tickets_tenant_id_id_key").on(t.tenantId, t.id),
    unique("queue_tickets_tenant_visit_key").on(t.tenantId, t.visitId),
    unique("queue_tickets_number_key").on(t.tenantId, t.branchId, t.queueDate, t.seq),
    check("queue_tickets_seq_check", sql`${t.seq} >= 1 and ${t.prefix} ~ '^[A-Z]{1,3}$'`),
    check("queue_tickets_state_check", sql`${t.state} in ('waiting','called','skipped','done')
      and ((${t.calledAt} is null) = (${t.calledBy} is null)) and ((${t.calledAt} is null) = (${t.roomId} is null))
      and (${t.state} <> 'called' or ${t.calledAt} is not null) and (${t.state} <> 'waiting' or ${t.calledAt} is null)`),
  ],
);

// Paired queue displays (NAV-8): a scoped token, only its sha256 stored; no patient data ever.
export const queueDisplays = pgTable(
  "queue_displays",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "queue_displays_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "queue_displays_revoked_by_fk", columns: [t.tenantId, t.revokedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("queue_displays_tenant_id_id_key").on(t.tenantId, t.id),
    unique("queue_displays_token_key").on(t.tokenHash),
    index("queue_displays_branch_idx").on(t.tenantId, t.branchId),
    check("queue_displays_label_check", sql`length(btrim(${t.label})) between 2 and 60`),
    check("queue_displays_token_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("queue_displays_revoked_check", sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`),
  ],
);
