// Branch master child tables (PR-2, DATA-11, DATA-46; T-036). Weekly hours, closures, rooms, devices
// and the services a branch offers. Written only by the branch_* / room_* / device_* functions
// (migration 0058). Rooms and devices are deactivated, never deleted, and keep their branch; their
// (tenant, branch, id) key lets later tables require a resource of the same branch (TD-30).
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, pgTable, smallint, text, time, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { catalogItems, DEVICE_TYPES, ROOM_KINDS } from "../../catalog/schema";
import { branches, staff, tenants } from "../schema";

// Weekly opening intervals; weekday follows EXTRACT(DOW): 0 = Minggu … 6 = Sabtu.
export const branchHours = pgTable(
  "branch_hours",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    weekday: smallint("weekday").notNull(),
    opens: time("opens").notNull(),
    closes: time("closes").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("branch_hours_tenant_id_id_key").on(t.tenantId, t.id),
    unique("branch_hours_slot_key").on(t.tenantId, t.branchId, t.weekday, t.opens),
    check("branch_hours_weekday_check", sql`${t.weekday} between 0 and 6`),
    check("branch_hours_range_check", sql`${t.opens} < ${t.closes}`),
  ],
);

// A closure on a local date, all day (no times) or for a time range.
export const branchClosures = pgTable(
  "branch_closures",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    closedOn: date("closed_on").notNull(),
    fromTime: time("from_time"),
    untilTime: time("until_time"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("branch_closures_tenant_id_id_key").on(t.tenantId, t.id),
    check("branch_closures_range_check", sql`(${t.fromTime} is null) = (${t.untilTime} is null) and (${t.fromTime} is null or ${t.fromTime} < ${t.untilTime})`),
    check("branch_closures_reason_check", sql`length(btrim(${t.reason})) between 3 and 500`),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ROOM_KINDS }).notNull(),
    satusehatLocationId: text("satusehat_location_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("rooms_tenant_id_id_key").on(t.tenantId, t.id),
    unique("rooms_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    uniqueIndex("rooms_name_key").on(t.tenantId, t.branchId, sql`lower(btrim(${t.name}))`),
    check("rooms_kind_check", sql`${t.kind} in ('consultation','treatment','pharmacy')`),
    check("rooms_name_check", sql`length(btrim(${t.name})) between 2 and 80`),
    check("rooms_satusehat_check", sql`coalesce(length(${t.satusehatLocationId}), 0) <= 100`),
  ],
);

export const branchDevices = pgTable(
  "branch_devices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    deviceType: text("device_type", { enum: DEVICE_TYPES }).notNull(),
    label: text("label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("branch_devices_tenant_id_id_key").on(t.tenantId, t.id),
    unique("branch_devices_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    uniqueIndex("branch_devices_label_key").on(t.tenantId, t.branchId, sql`lower(btrim(${t.label}))`),
    check("branch_devices_type_check", sql`${t.deviceType} in ('laser','laser_ablative','laser_non_ablative','ipl','rf','hifu','microneedling_device','centrifuge','facial_machine')`),
    check("branch_devices_label_check", sql`length(btrim(${t.label})) between 2 and 80`),
  ],
);

// Layanan Tersedia: an explicit list; empty = nothing offered at the branch (plan r1 open point 4).
export const branchServices = pgTable(
  "branch_services",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    itemId: uuid("item_id").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    unique("branch_services_tenant_id_id_key").on(t.tenantId, t.id),
    unique("branch_services_item_key").on(t.tenantId, t.branchId, t.itemId),
  ],
);
