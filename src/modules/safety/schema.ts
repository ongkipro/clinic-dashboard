// Safety module schemas (PR-82, DATA-54; T-068, migration 0085). Written only by the 0085 definers.
//
// - device_schedules (branch-scoped, config): the calibration / maintenance interval of a branch device and its next due
//   date; set by the manager; an entry of that kind moves the due date to entry date + interval.
// - logbook_entries (branch-scoped, operational): sterilization cycles, calibration and maintenance of devices, and the
//   B3 medical-waste handover register (a register link, not a logistics module). Insert-only; a correction is a new
//   entry naming the one it corrects.
// - logbook_due_alerts (system): one per schedule and due date the due scan alerted (dedupe); readable by no app role.
// - clinical_incidents (branch-scoped, clinical): the patient-safety incident register (KTD, KNC, KTC, KPC, sentinel)
//   reported → investigating → closed; reporting determination and submission evidence as the officer records them
//   (no legal rule is hard-coded: JUR-ID-8 is unverified). Never deleted.
// - clinical_incident_events (branch-scoped, clinical): insert-only history of an incident.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branchDevices, rooms } from "../org/branches/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { visits } from "../visits/schema";

export const SCHEDULE_KINDS = ["calibration", "maintenance"] as const;
export const LOGBOOK_KINDS = ["sterilization", "calibration", "maintenance", "b3_waste"] as const;
export const STERILIZATION_METHODS = ["autoclave", "chemical", "uv", "other"] as const;
export const DEVICE_RESULTS = ["ok", "adjusted", "out_of_service"] as const;
export const WASTE_CATEGORIES = ["infectious", "sharps", "pharmaceutical", "chemical", "other"] as const;
export const INCIDENT_CLASSES = ["ktd", "knc", "ktc", "kpc", "sentinel"] as const;
export const INCIDENT_STATES = ["reported", "investigating", "closed"] as const;
export const INCIDENT_EVENT_KINDS = ["reported", "taken", "investigated", "determined", "submitted", "closed"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const txt = (c: unknown, lo: number, hi: number) => sql`(${c} is null or length(btrim(${c})) between ${sql.raw(String(lo))} and ${sql.raw(String(hi))})`;

export const deviceSchedules = pgTable(
  "device_schedules",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    kind: text("kind", { enum: SCHEDULE_KINDS }).notNull(),
    intervalDays: integer("interval_days").notNull(),
    nextDueOn: date("next_due_on").notNull(),
    active: boolean("active").notNull().default(true),
    setBy: uuid("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "device_schedules_device_fk", columns: [t.tenantId, t.branchId, t.deviceId], foreignColumns: [branchDevices.tenantId, branchDevices.branchId, branchDevices.id] }).onDelete("restrict"),
    foreignKey({ name: "device_schedules_set_by_fk", columns: [t.tenantId, t.setBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("device_schedules_tenant_id_id_key").on(t.tenantId, t.id),
    unique("device_schedules_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("device_schedules_device_kind_key").on(t.tenantId, t.deviceId, t.kind),
    check("device_schedules_check", sql`${t.kind} in (${inList(SCHEDULE_KINDS)}) and ${t.intervalDays} between 1 and 1825`),
  ],
);

export const logbookEntries = pgTable(
  "logbook_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    kind: text("kind", { enum: LOGBOOK_KINDS }).notNull(),
    performedOn: date("performed_on").notNull(),
    deviceId: uuid("device_id"),
    roomId: uuid("room_id"),
    // sterilization
    cycleNo: text("cycle_no"),
    method: text("method", { enum: STERILIZATION_METHODS }),
    itemsText: text("items_text"),
    passed: boolean("passed"),
    // calibration / maintenance
    result: text("result", { enum: DEVICE_RESULTS }),
    performerName: text("performer_name"),
    certificateNo: text("certificate_no"),
    // b3 waste
    wasteCategory: text("waste_category", { enum: WASTE_CATEGORIES }),
    quantityGrams: bigint("quantity_grams", { mode: "number" }),
    handlerName: text("handler_name"),
    handoverRef: text("handover_ref"),
    note: text("note"),
    corrects: uuid("corrects"),
    commandKey: text("command_key").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "logbook_entries_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "logbook_entries_device_fk", columns: [t.tenantId, t.branchId, t.deviceId], foreignColumns: [branchDevices.tenantId, branchDevices.branchId, branchDevices.id] }).onDelete("restrict"),
    foreignKey({ name: "logbook_entries_room_fk", columns: [t.tenantId, t.branchId, t.roomId], foreignColumns: [rooms.tenantId, rooms.branchId, rooms.id] }).onDelete("restrict"),
    foreignKey({ name: "logbook_entries_recorded_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("logbook_entries_tenant_id_id_key").on(t.tenantId, t.id),
    unique("logbook_entries_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    foreignKey({ name: "logbook_entries_corrects_fk", columns: [t.tenantId, t.branchId, t.corrects], foreignColumns: [t.tenantId, t.branchId, t.id] }).onDelete("restrict"),
    unique("logbook_entries_command_key").on(t.tenantId, t.commandKey),
    index("logbook_entries_branch_idx").on(t.tenantId, t.branchId, t.kind, t.performedOn),
    check("logbook_entries_kind_check", sql`${t.kind} in (${inList(LOGBOOK_KINDS)}) and ${KEY(t.commandKey)}
      and (${t.kind} = 'sterilization') = (${t.method} is not null and ${t.passed} is not null and ${t.itemsText} is not null)
      and (${t.kind} in ('calibration','maintenance')) = (${t.result} is not null and ${t.performerName} is not null and ${t.deviceId} is not null)
      and (${t.kind} = 'b3_waste') = (${t.wasteCategory} is not null and ${t.quantityGrams} is not null and ${t.handlerName} is not null and ${t.handoverRef} is not null)
      and (${t.kind} = 'sterilization' or ${t.cycleNo} is null and ${t.roomId} is null)
      and (${t.kind} in ('calibration','maintenance') or ${t.certificateNo} is null)
      and (${t.kind} in ('sterilization','calibration','maintenance') or ${t.deviceId} is null)
      and (${t.method} is null or ${t.method} in (${inList(STERILIZATION_METHODS)}))
      and (${t.result} is null or ${t.result} in (${inList(DEVICE_RESULTS)}))
      and (${t.wasteCategory} is null or ${t.wasteCategory} in (${inList(WASTE_CATEGORIES)}))
      and (${t.quantityGrams} is null or ${t.quantityGrams} between 1 and 100000000)`),
    check("logbook_entries_text_check", sql`${txt(t.cycleNo, 1, 40)} and ${txt(t.itemsText, 2, 500)} and ${txt(t.performerName, 2, 120)}
      and ${txt(t.certificateNo, 1, 80)} and ${txt(t.handlerName, 2, 120)} and ${txt(t.handoverRef, 1, 80)} and ${txt(t.note, 3, 500)}`),
  ],
);

export const logbookDueAlerts = pgTable(
  "logbook_due_alerts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    dueOn: date("due_on").notNull(),
    alertedOn: date("alerted_on").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "logbook_due_alerts_schedule_fk", columns: [t.tenantId, t.scheduleId], foreignColumns: [deviceSchedules.tenantId, deviceSchedules.id] }).onDelete("restrict"),
    unique("logbook_due_alerts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("logbook_due_alerts_key").on(t.tenantId, t.scheduleId, t.dueOn),
  ],
);

export const clinicalIncidents = pgTable(
  "clinical_incidents",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    classification: text("classification", { enum: INCIDENT_CLASSES }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    patientId: uuid("patient_id"),
    visitId: uuid("visit_id"),
    summary: text("summary").notNull(),
    immediateResponse: text("immediate_response").notNull(),
    state: text("state", { enum: INCIDENT_STATES }).notNull().default("reported"),
    reportedBy: uuid("reported_by").notNull(),
    reportedAs: text("reported_as").notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    officerId: uuid("officer_id"),
    investigation: text("investigation"),
    rootCause: text("root_cause"),
    investigatedAt: timestamp("investigated_at", { withTimezone: true }),
    reportRequired: boolean("report_required"),
    reportRecipient: text("report_recipient"),
    reportDueOn: date("report_due_on"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submissionRef: text("submission_ref"),
    correctiveAction: text("corrective_action"),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incidents_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incidents_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incidents_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incidents_reported_by_fk", columns: [t.tenantId, t.reportedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incidents_officer_fk", columns: [t.tenantId, t.officerId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incidents_closed_by_fk", columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("clinical_incidents_tenant_id_id_key").on(t.tenantId, t.id),
    unique("clinical_incidents_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("clinical_incidents_command_key").on(t.tenantId, t.commandKey),
    index("clinical_incidents_branch_idx").on(t.tenantId, t.branchId, t.state, t.occurredAt),
    check("clinical_incidents_check", sql`${t.classification} in (${inList(INCIDENT_CLASSES)}) and ${t.state} in (${inList(INCIDENT_STATES)}) and ${KEY(t.commandKey)}
      and (${t.classification} <> 'kpc' or ${t.patientId} is null) and (${t.visitId} is null or ${t.patientId} is not null)
      and (${t.state} = 'reported') = (${t.officerId} is null)
      and (${t.investigatedAt} is null) = (${t.investigation} is null) and (${t.investigation} is null) = (${t.rootCause} is null)
      and (${t.reportRequired} is not false or ${t.reportRecipient} is null and ${t.reportDueOn} is null)
      and (${t.reportRequired} is not true or ${t.reportRecipient} is not null and ${t.reportDueOn} is not null)
      and (${t.submittedAt} is null) = (${t.submissionRef} is null) and (${t.submittedAt} is null or ${t.reportRequired} is true)
      and (${t.state} = 'closed') = (${t.closedAt} is not null) and (${t.closedAt} is null) = (${t.closedBy} is null)
      and (${t.state} <> 'closed' or ${t.investigatedAt} is not null and ${t.correctiveAction} is not null and ${t.reportRequired} is not null
           and (${t.reportRequired} is false or ${t.submittedAt} is not null))`),
    check("clinical_incidents_text_check", sql`length(btrim(${t.summary})) between 3 and 1000 and length(btrim(${t.immediateResponse})) between 3 and 1000
      and ${txt(t.investigation, 3, 2000)} and ${txt(t.rootCause, 3, 1000)} and ${txt(t.reportRecipient, 2, 200)}
      and ${txt(t.submissionRef, 1, 120)} and ${txt(t.correctiveAction, 3, 1000)}`),
  ],
);

export const clinicalIncidentEvents = pgTable(
  "clinical_incident_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    kind: text("kind", { enum: INCIDENT_EVENT_KINDS }).notNull(),
    actorId: uuid("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incident_events_incident_fk", columns: [t.tenantId, t.branchId, t.incidentId], foreignColumns: [clinicalIncidents.tenantId, clinicalIncidents.branchId, clinicalIncidents.id] }).onDelete("restrict"),
    foreignKey({ name: "clinical_incident_events_actor_fk", columns: [t.tenantId, t.actorId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("clinical_incident_events_tenant_id_id_key").on(t.tenantId, t.id),
    index("clinical_incident_events_incident_idx").on(t.tenantId, t.incidentId, t.createdAt),
    check("clinical_incident_events_check", sql`${t.kind} in (${inList(INCIDENT_EVENT_KINDS)})`),
  ],
);
