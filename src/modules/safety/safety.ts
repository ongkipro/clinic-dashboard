// Logbooks and the patient-safety incident register (PR-82, UX-9 ▸ Logbook, UX-28 ▸ Insiden; T-068). Every call runs
// inside withTenantContext; the database decides authority (logbook writers: doctor, nurse, therapist, manager at the
// active branch; schedules: manager; incidents reported by the clinical roles and the manager, handled by the facility
// head). Commands go through runCommand with the caller's key; database errors are mapped outside it. Results hold ids
// only.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { assertProductionGoLive } from "../vendor/profile/profile";
import type { DEVICE_RESULTS, INCIDENT_CLASSES, INCIDENT_EVENT_KINDS, INCIDENT_STATES, LOGBOOK_KINDS, SCHEDULE_KINDS, STERILIZATION_METHODS, WASTE_CATEGORIES } from "./schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);

export class SafetyError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new SafetyError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}
const read = async <T>(db: pg.ClientBase, sql: string, args: unknown[]) => call(async () => (await db.query(sql, args)).rows[0].r as T);

export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export type LogbookKind = (typeof LOGBOOK_KINDS)[number];
export type SterilizationMethod = (typeof STERILIZATION_METHODS)[number];
export type DeviceResult = (typeof DEVICE_RESULTS)[number];
export type WasteCategory = (typeof WASTE_CATEGORIES)[number];
export type IncidentClass = (typeof INCIDENT_CLASSES)[number];
export type IncidentState = (typeof INCIDENT_STATES)[number];
export type IncidentEventKind = (typeof INCIDENT_EVENT_KINDS)[number];

// Dates, whole numbers and times are validated by the definers (safety_date, the interval / grams patterns, the
// occurred_at cast): the database is the trust boundary, so the module passes the values through.

// ── Schedules (manager) ──────────────────────────────────────────────────────────────────────────────────────────
export type ScheduleInput = { deviceId: string; kind: ScheduleKind; intervalDays: number; nextDueOn: string; active?: boolean };
export async function setSchedule(db: pg.ClientBase, key: string, branchId: string, s: ScheduleInput) {
  const p: Record<string, Json> = { device_id: s.deviceId, kind: s.kind, interval_days: s.intervalDays, next_due_on: s.nextDueOn };
  if (s.active !== undefined) p.active = s.active;
  const out = await command<string>(db, "device_schedule_set", key, { branch_id: branchId, schedule: p }, `select device_schedule_set($1, $2::jsonb) as r`, [branchId, JSON.stringify(p)]);
  return { scheduleId: out.result, replayed: out.replayed };
}

// ── Entries ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type EntryInput =
  | { kind: "sterilization"; performedOn: string; method: SterilizationMethod; items: string; passed: boolean; cycleNo?: string; deviceId?: string; roomId?: string; note?: string; corrects?: string }
  | { kind: "calibration" | "maintenance"; performedOn: string; deviceId: string; result: DeviceResult; performerName: string; certificateNo?: string; note?: string; corrects?: string }
  | { kind: "b3_waste"; performedOn: string; wasteCategory: WasteCategory; quantityGrams: number; handlerName: string; handoverRef: string; note?: string; corrects?: string };
export async function recordEntry(db: pg.ClientBase, key: string, branchId: string, e: EntryInput) {
  const p: Record<string, Json> = { kind: e.kind, performed_on: e.performedOn };
  if (e.note) p.note = e.note;
  if (e.corrects) p.corrects = e.corrects;
  if (e.kind === "sterilization") {
    Object.assign(p, { method: e.method, items: e.items, passed: e.passed });
    if (e.cycleNo) p.cycle_no = e.cycleNo;
    if (e.deviceId) p.device_id = e.deviceId;
    if (e.roomId) p.room_id = e.roomId;
  } else if (e.kind === "b3_waste") {
    Object.assign(p, { waste_category: e.wasteCategory, quantity_grams: e.quantityGrams, handler_name: e.handlerName, handover_ref: e.handoverRef });
  } else {
    Object.assign(p, { device_id: e.deviceId, result: e.result, performer_name: e.performerName });
    if (e.certificateNo) p.certificate_no = e.certificateNo;
  }
  const out = await command<string>(db, "logbook_record", key, { branch_id: branchId, entry: p }, `select logbook_record($1, $2, $3::jsonb) as r`, [key, branchId, JSON.stringify(p)]);
  return { entryId: out.result, replayed: out.replayed };
}

export type Schedule = { id: string; kind: ScheduleKind; interval_days: number; next_due_on: string; active: boolean; overdue: boolean };
export type Device = { id: string; label: string; type: string; active: boolean; schedules: Schedule[] };
export type Entry = {
  id: string; kind: LogbookKind; performed_on: string; device_id?: string; device_label?: string; room_name?: string; cycle_no?: string; method?: SterilizationMethod;
  items?: string; passed?: boolean; result?: DeviceResult; performer_name?: string; certificate_no?: string; waste_category?: WasteCategory;
  quantity_grams?: number; handler_name?: string; handover_ref?: string; note?: string; corrects?: string; corrected: boolean;
  recorded_name: string; recorded_as: string; recorded_at: string;
};
export type LogbookOverview = { role: string; can_write: boolean; can_schedule: boolean; today: string; devices: Device[]; rooms: { id: string; name: string }[]; entries: Entry[] };
export const logbookOverview = (db: pg.ClientBase, branchId: string, kind: LogbookKind | null) =>
  read<LogbookOverview>(db, `select logbook_overview($1, $2) as r`, [branchId, kind]);

// ── Incidents ────────────────────────────────────────────────────────────────────────────────────────────────────
export type IncidentInput = { classification: IncidentClass; occurredAt: string; summary: string; immediateResponse: string; patientId?: string; visitId?: string };
export async function reportIncident(db: pg.ClientBase, key: string, branchId: string, i: IncidentInput) {
  const p: Record<string, Json> = { classification: i.classification, occurred_at: i.occurredAt, summary: i.summary, immediate_response: i.immediateResponse };
  if (i.patientId) p.patient_id = i.patientId;
  if (i.visitId) p.visit_id = i.visitId;
  const out = await command<string>(db, "incident_report", key, { branch_id: branchId, incident: p }, `select incident_report($1, $2, $3::jsonb) as r`, [key, branchId, JSON.stringify(p)]);
  return { incidentId: out.result, replayed: out.replayed };
}

export type IncidentStep =
  | { step: "take" }
  | { step: "investigate"; investigation: string; rootCause: string }
  | { step: "determine"; reportRequired: false }
  | { step: "determine"; reportRequired: true; recipient: string; dueOn: string }
  | { step: "submit"; reference: string }
  | { step: "close"; correctiveAction: string };
export async function handleIncident(db: pg.ClientBase, key: string, incidentId: string, s: IncidentStep) {
  const p: Record<string, Json> =
    s.step === "investigate" ? { investigation: s.investigation, root_cause: s.rootCause }
    : s.step === "determine" ? (s.reportRequired ? { report_required: true, recipient: s.recipient, due_on: s.dueOn } : { report_required: false })
    : s.step === "submit" ? { reference: s.reference }
    : s.step === "close" ? { corrective_action: s.correctiveAction }
    : {};
  const out = await command(db, "incident_handle", key, { incident_id: incidentId, step: s.step, body: p }, `select incident_handle($1, $2, $3::jsonb) as r`, [incidentId, s.step, JSON.stringify(p)]);
  return { replayed: out.replayed };
}

export type Incident = {
  id: string; branch_id: string; classification: IncidentClass; occurred_at: string; state: IncidentState; summary: string; immediate_response: string;
  reported_at: string; reported_as: string; reported_name: string; mine: boolean; has_patient: boolean; patient_id?: string; patient_name?: string; patient_mrn?: string;
  officer_name?: string; investigation?: string; root_cause?: string; investigated_at?: string; report_required?: boolean; report_recipient?: string;
  report_due_on?: string; submitted_at?: string; submission_ref?: string; corrective_action?: string; closed_at?: string;
};
export type IncidentList = { role: string; register: boolean; can_report: boolean; can_handle: boolean; incidents: Incident[] };
export type IncidentDetail = Incident & { can_handle: boolean; events: { kind: IncidentEventKind; actor_as: string; actor_name: string; at: string }[] };
export const incidentList = (db: pg.ClientBase, branchId: string) => read<IncidentList>(db, `select incident_list($1) as r`, [branchId]);
export const incidentGet = (db: pg.ClientBase, incidentId: string) => read<IncidentDetail>(db, `select incident_get($1) as r`, [incidentId]);
export type PatientOption = { patient_id: string; visit_id: string; name: string; mrn: string };
export const incidentPatientOptions = (db: pg.ClientBase, branchId: string) => read<PatientOption[]>(db, `select incident_patient_options($1) as r`, [branchId]);

/** The daily due scan (worker connection, no tenant context): alerts the manager of each branch per overdue schedule. */
export const runDueScan = async (db: pg.Pool | pg.ClientBase, today?: string) => (await db.query(`select logbook_due_scan($1) as r`, [today ?? null])).rows[0].r as number;
