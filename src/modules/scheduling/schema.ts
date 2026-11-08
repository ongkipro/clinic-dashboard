// Staff schedules (PR-48, DATA-16, UX-33; T-043). Policy kind: branch-scoped. Shifts are branch-local
// dates and times (the branch timezone gives the instant); a break lies inside a work shift. Leave is
// recorded per branch and cancelled, never deleted. Written only by roster_set_week, leave_add and
// leave_cancel (migration 0060); the past (before today in branch time) is kept as it was.
import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgTable, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

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
