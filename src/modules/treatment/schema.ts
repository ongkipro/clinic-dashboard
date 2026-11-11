// Treatment execution (PR-14, DATA-24, TD-5; T-064, migration 0081). Policy kind: branch-scoped, support class
// clinical. One execution per (visit, plan item): who actually performed it (and assisted / supervised), in which
// treatment room, with which material request; the staged timer (preparation → anesthesia → procedure → recovery)
// stores times only; the outcome and whether it counts (completed or a patient stop) close it once. Every transition
// is an insert-only event row with its own command key. Written only by the 0081 definers.
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { planItems } from "../clinical/schema";
import { materialRequests } from "../inventory/schema";
import { rooms } from "../org/branches/schema";
import { branches, staff, tenants } from "../org/schema";
import { visits } from "../visits/schema";

export const EXECUTION_STATES = ["started", "paused", "finished"] as const;
export const EXECUTION_STAGES = ["preparation", "anesthesia", "procedure", "recovery"] as const;
export const EXECUTION_OUTCOMES = ["completed", "medical_stop", "clinic_stop", "patient_stop"] as const;
export const EXECUTION_EVENTS = ["start", "stage", "pause", "resume", "finish"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const ROOM_ROLES = sql.raw("'doctor','nurse','therapist'");
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;

export const treatmentExecutions = pgTable(
  "treatment_executions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    planItemId: uuid("plan_item_id").notNull(),
    roomId: uuid("room_id"),
    materialRequestId: uuid("material_request_id"),
    performerStaffId: uuid("performer_staff_id").notNull(),
    assistingStaffId: uuid("assisting_staff_id"),
    supervisorStaffId: uuid("supervisor_staff_id"),
    identityConfirmed: boolean("identity_confirmed").notNull(),
    state: text("state", { enum: EXECUTION_STATES }).notNull().default("started"),
    stage: text("stage", { enum: EXECUTION_STAGES }).notNull().default("preparation"),
    stageStartedAt: timestamp("stage_started_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    startedBy: uuid("started_by").notNull(),
    startedAs: text("started_as").notNull(),
    startCommandKey: text("start_command_key").notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    finishedBy: uuid("finished_by"),
    finishedAs: text("finished_as"),
    finishCommandKey: text("finish_command_key"),
    outcome: text("outcome", { enum: EXECUTION_OUTCOMES }),
    counted: boolean("counted").generatedAlwaysAs(sql`outcome in ('completed','patient_stop')`),
    stopReason: text("stop_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_plan_item_fk", columns: [t.tenantId, t.planItemId], foreignColumns: [planItems.tenantId, planItems.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_room_fk", columns: [t.tenantId, t.branchId, t.roomId], foreignColumns: [rooms.tenantId, rooms.branchId, rooms.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_request_fk", columns: [t.tenantId, t.branchId, t.materialRequestId], foreignColumns: [materialRequests.tenantId, materialRequests.branchId, materialRequests.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_performer_fk", columns: [t.tenantId, t.performerStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_assistant_fk", columns: [t.tenantId, t.assistingStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_supervisor_fk", columns: [t.tenantId, t.supervisorStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_started_by_fk", columns: [t.tenantId, t.startedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_executions_finished_by_fk", columns: [t.tenantId, t.finishedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("treatment_executions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("treatment_executions_scope_key").on(t.tenantId, t.branchId, t.visitId, t.id),
    // P1-2: one execution per (visit, plan item), finished or not.
    unique("treatment_executions_item_key").on(t.tenantId, t.visitId, t.planItemId),
    unique("treatment_executions_request_key").on(t.tenantId, t.materialRequestId),
    unique("treatment_executions_start_key").on(t.tenantId, t.startCommandKey),
    unique("treatment_executions_finish_key").on(t.tenantId, t.finishCommandKey),
    index("treatment_executions_branch_idx").on(t.tenantId, t.branchId, t.state, t.startedAt),
    check("treatment_executions_check", sql`${t.state} in (${inList(EXECUTION_STATES)}) and ${t.stage} in (${inList(EXECUTION_STAGES)})
      and ${t.startedAs} in (${ROOM_ROLES}) and ${t.identityConfirmed} and ${KEY(t.startCommandKey)}
      and (${t.assistingStaffId} is null or ${t.assistingStaffId} <> ${t.performerStaffId})
      and (${t.supervisorStaffId} is null or ${t.supervisorStaffId} <> ${t.performerStaffId})
      and ((${t.state} = 'paused') = (${t.pausedAt} is not null))
      and ((${t.state} = 'finished') = (${t.finishedAt} is not null)) and num_nonnulls(${t.finishedAt}, ${t.finishedBy}, ${t.finishedAs}, ${t.finishCommandKey}, ${t.outcome}) in (0, 5)
      and (${t.finishedAs} is null or ${t.finishedAs} in (${ROOM_ROLES})) and (${t.finishCommandKey} is null or ${KEY(t.finishCommandKey)})
      and (${t.outcome} is null or ${t.outcome} in (${inList(EXECUTION_OUTCOMES)}))
      and ((${t.outcome} in ('medical_stop','clinic_stop','patient_stop')) = (${t.stopReason} is not null))
      and (${t.stopReason} is null or length(btrim(${t.stopReason})) between 3 and 500)`),
  ],
);

export const treatmentExecutionEvents = pgTable(
  "treatment_execution_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    executionId: uuid("execution_id").notNull(),
    kind: text("kind", { enum: EXECUTION_EVENTS }).notNull(),
    stage: text("stage", { enum: EXECUTION_STAGES }),
    outcome: text("outcome", { enum: EXECUTION_OUTCOMES }),
    commandKey: text("command_key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    by: uuid("by").notNull(),
    as: text("as").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_execution_events_execution_fk", columns: [t.tenantId, t.branchId, t.visitId, t.executionId],
      foreignColumns: [treatmentExecutions.tenantId, treatmentExecutions.branchId, treatmentExecutions.visitId, treatmentExecutions.id] }).onDelete("restrict"),
    foreignKey({ name: "treatment_execution_events_by_fk", columns: [t.tenantId, t.by], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("treatment_execution_events_tenant_id_id_key").on(t.tenantId, t.id),
    unique("treatment_execution_events_command_key").on(t.tenantId, t.commandKey),
    index("treatment_execution_events_execution_idx").on(t.tenantId, t.executionId, t.at),
    check("treatment_execution_events_check", sql`${t.kind} in (${inList(EXECUTION_EVENTS)}) and ${KEY(t.commandKey)} and ${t.as} in (${ROOM_ROLES})
      and ((${t.kind} = 'stage') = (${t.stage} is not null)) and ((${t.kind} = 'finish') = (${t.outcome} is not null))
      and (${t.stage} is null or ${t.stage} in (${inList(EXECUTION_STAGES)})) and (${t.outcome} is null or ${t.outcome} in (${inList(EXECUTION_OUTCOMES)}))`),
  ],
);
