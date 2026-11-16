// Staff schedules (PR-48, DATA-16, UX-33; T-043). Policy kind: branch-scoped. Shifts are branch-local
// dates and times (the branch timezone gives the instant); a break lies inside a work shift. Leave is
// recorded per branch and cancelled, never deleted. Written only by roster_set_week, leave_add and
// leave_cancel (migration 0060); the past (before today in branch time) is kept as it was.
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgTable, text, time, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { catalogItems, catalogVersions } from "../catalog/schema";
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
// T-045 (PR-83, DEC-055): the later states. Arrived is set by check-in (T-047).
export const APPOINTMENT_STATES = ["held", "booked", "confirmed", "arrived", "no_show", "cancelled", "rescheduled"] as const;
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
    stateReason: text("state_reason"),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }),
    stateChangedBy: uuid("state_changed_by"),
    rescheduledTo: uuid("rescheduled_to"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_state_changed_by_fk", columns: [t.tenantId, t.stateChangedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_rescheduled_to_fk", columns: [t.tenantId, t.branchId, t.rescheduledTo], foreignColumns: [t.tenantId, t.branchId, t.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_performer_fk", columns: [t.tenantId, t.performerStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "appointments_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("appointments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("appointments_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    index("appointments_branch_start_idx").on(t.tenantId, t.branchId, t.startsAt),
    index("appointments_patient_idx").on(t.tenantId, t.patientId, t.startsAt),
    check("appointments_range_check", sql`${t.startsAt} < ${t.endsAt}`),
    // T-095 (plan r1 P1-2): a patient's Konfirmasi reply confirms without a staff actor — state_changed_by may be null for confirmed only
    check("appointments_state_check", sql`${t.state} in ('held','booked','confirmed','arrived','no_show','cancelled','rescheduled')
      and ((${t.state} = 'held') = (${t.holdUntil} is not null))
      and ((${t.state} = 'cancelled') = (${t.stateReason} is not null and length(btrim(${t.stateReason})) between 3 and 500))
      and ((${t.state} = 'rescheduled') = (${t.rescheduledTo} is not null and ${t.rescheduledTo} <> ${t.id}))
      and ((${t.state} in ('confirmed','arrived','no_show','cancelled','rescheduled')) = (${t.stateChangedAt} is not null))
      and (${t.state} in ('confirmed','arrived','no_show','cancelled','rescheduled') or ${t.stateChangedBy} is null)
      and (${t.state} in ('held','booked','confirmed') or ${t.stateChangedBy} is not null)`),
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

// T-099 (PR-81; plan docs/tasks/T-099.md; DEC-111): the waitlist for a service (a catalog item, not a version) at a branch. No free text
// and no preferred window (plan r1). A cancelled or rescheduled future slot offers the oldest waiting entry (a trigger, ids only).
export const WAITLIST_STATES = ["waiting", "offered", "booked", "removed"] as const;
export const WAITLIST_RECORDERS = ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs"] as const;
export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    itemId: uuid("item_id").notNull(),
    state: text("state", { enum: WAITLIST_STATES }).notNull().default("waiting"),
    offeredAppointmentId: uuid("offered_appointment_id"),
    offeredAt: timestamp("offered_at", { withTimezone: true }),
    bookedAppointmentId: uuid("booked_appointment_id"),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as", { enum: WAITLIST_RECORDERS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    closedBy: uuid("closed_by"),
    closedAs: text("closed_as"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason"),
  },
  (t) => [
    unique("waitlist_entries_tenant_id_id_key").on(t.tenantId, t.id),
    unique("waitlist_entries_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("waitlist_entries_one_open").on(t.tenantId, t.patientId, t.branchId, t.itemId).where(sql`${t.state} in ('waiting','offered')`),
    uniqueIndex("waitlist_entries_one_offer_per_slot").on(t.tenantId, t.offeredAppointmentId).where(sql`${t.state} = 'offered'`),
    index("waitlist_entries_queue_idx").on(t.tenantId, t.branchId, t.itemId, t.state, t.createdAt),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId, t.offeredAppointmentId], foreignColumns: [appointments.tenantId, appointments.branchId, appointments.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId, t.bookedAppointmentId], foreignColumns: [appointments.tenantId, appointments.branchId, appointments.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("waitlist_entries_check", sql`${t.state} in ('waiting','offered','booked','removed')
      and ${t.commandKey} ~ '^[A-Za-z0-9_.:-]{8,128}$'
      and (${t.state} = 'offered') = (${t.offeredAppointmentId} is not null and ${t.offeredAt} is not null)
      and (${t.state} = 'booked') = (${t.bookedAppointmentId} is not null)
      and (${t.state} in ('waiting','offered')) = (${t.closedAt} is null)
      and ((${t.closedBy} is null) = (${t.closedAs} is null)) and ((${t.closedAt} is null) = (${t.closeReason} is null))
      and (${t.closeReason} is null or ${t.state} = ${t.closeReason})`),
  ],
);
