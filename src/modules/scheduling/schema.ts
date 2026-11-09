// Staff schedules (PR-48, DATA-16, UX-33; T-043). Policy kind: branch-scoped. Shifts are branch-local
// dates and times (the branch timezone gives the instant); a break lies inside a work shift. Leave is
// recorded per branch and cancelled, never deleted. Written only by roster_set_week, leave_add and
// leave_cancel (migration 0060); the past (before today in branch time) is kept as it was.
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgTable, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { catalogVersions } from "../catalog/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";

export const SHIFT_KINDS = ["work", "break"] as const;
export const LEAVE_KINDS = ["leave", "sick", "absent"] as const;

export const staffShifts = pgTable(
  "staff_shifts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    shiftDate: date("shift_date").notNull(),
    starts: time("starts").notNull(),
    ends: time("ends").notNull(), // 24:00 stored as 23:59:59.999999 (as branch_hours, DEC-051)
    kind: text("kind", { enum: SHIFT_KINDS }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("staff_shifts_tenant_id_id_key").on(t.tenantId, t.id),
    index("staff_shifts_branch_date_idx").on(t.tenantId, t.branchId, t.shiftDate),
    index("staff_shifts_staff_date_idx").on(t.tenantId, t.staffId, t.shiftDate),
    check("staff_shifts_kind_check", sql`${t.kind} in ('work','break')`),
    check("staff_shifts_range_check", sql`${t.starts} < ${t.ends}`),
  ],
);

export const staffLeave = pgTable(
  "staff_leave",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    kind: text("kind", { enum: LEAVE_KINDS }).notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.cancelledBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("staff_leave_tenant_id_id_key").on(t.tenantId, t.id),
    index("staff_leave_branch_idx").on(t.tenantId, t.branchId, t.fromDate),
    check("staff_leave_kind_check", sql`${t.kind} in ('leave','sick','absent')`),
    check("staff_leave_range_check", sql`${t.fromDate} <= ${t.toDate} and ${t.toDate} - ${t.fromDate} <= 366`),
    check("staff_leave_reason_check", sql`length(btrim(${t.reason})) between 3 and 500`),
    check("staff_leave_cancel_check", sql`(${t.cancelledAt} is null and ${t.cancelledBy} is null and ${t.cancelReason} is null)
      or (${t.cancelledAt} is not null and ${t.cancelledBy} is not null and ${t.cancelReason} is not null and length(btrim(${t.cancelReason})) between 3 and 500)`),
  ],
);

// Appointments and resource reservations (PR-6, DATA-16; T-044, DEC-054). An appointment stores the
// catalog version used and the slot (prep + treatment + buffer); its reservations hold the performer,
// the room and the device taken, and an exclusion constraint (migration 0061, btree_gist) refuses
// overlapping active reservations of one resource. Staff are reserved across branches (one person, one
// place). In T-044 an appointment is held (DP pending, SET-17) or booked; later states are T-045's.
export const APPOINTMENT_STATES = ["held", "booked"] as const;
export const BOOKING_CHANNELS = ["walk_in", "phone", "whatsapp", "staff", "online"] as const;
export const RESERVATION_KINDS = ["staff", "room", "device"] as const;

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    performerStaffId: uuid("performer_staff_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    state: text("state", { enum: APPOINTMENT_STATES }).notNull(),
    holdUntil: timestamp("hold_until", { withTimezone: true }),
    channel: text("channel", { enum: BOOKING_CHANNELS }).notNull(),
    source: text("source"),
    campaign: text("campaign"),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_performer_fk", columns: [t.tenantId, t.performerStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("appointments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("appointments_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    index("appointments_branch_start_idx").on(t.tenantId, t.branchId, t.startsAt),
    index("appointments_patient_idx").on(t.tenantId, t.patientId, t.startsAt),
    check("appointments_range_check", sql`${t.startsAt} < ${t.endsAt}`),
    check("appointments_state_check", sql`${t.state} in ('held','booked') and ((${t.state} = 'held') = (${t.holdUntil} is not null))`),
    check("appointments_channel_check", sql`${t.channel} in ('walk_in','phone','whatsapp','staff','online')`),
    check("appointments_source_check", sql`(${t.source} is null or ${t.source} ~ '^[a-z0-9][a-z0-9_-]{0,39}$') and (${t.campaign} is null or ${t.campaign} ~ '^[a-z0-9][a-z0-9_-]{0,39}$')`),
    check("appointments_note_check", sql`${t.note} is null or length(${t.note}) <= 500`),
    check("appointments_created_as_check", sql`${t.createdAs} in ('owner','admin_pusat','manager','fo_cashier','central_cs')`),
  ],
);

export const resourceReservations = pgTable(
  "resource_reservations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    kind: text("kind", { enum: RESERVATION_KINDS }).notNull(),
    resourceId: uuid("resource_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "resource_reservations_appointment_fk", columns: [t.tenantId, t.branchId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.branchId, appointments.id] }).onDelete("restrict"),
    unique("resource_reservations_tenant_id_id_key").on(t.tenantId, t.id),
    // One row per resource of an appointment (a service may need several device types or room kinds; impl
    // review r1 P1). The guard allows only the performer as the staff row.
    unique("resource_reservations_appointment_resource_key").on(t.tenantId, t.appointmentId, t.kind, t.resourceId),
    check("resource_reservations_kind_check", sql`${t.kind} in ('staff','room','device')`),
    check("resource_reservations_range_check", sql`${t.startsAt} < ${t.endsAt}`),
  ],
);
