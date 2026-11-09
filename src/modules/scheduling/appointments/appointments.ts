// Appointment states (PR-83, UX-5; T-045, DEC-055). Every call runs inside withTenantContext. Confirm,
// cancel, no-show and reschedule go through runCommand with the caller's idempotency key; database
// errors are mapped outside it (the T-038 lesson: a raised error rolls the claim back). No money moves
// here: booking-DP effects (PR-22) arrive with the cashier (M4).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class AppointmentError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new AppointmentError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export const APPOINTMENT_STATES = ["held", "booked", "confirmed", "arrived", "no_show", "cancelled", "rescheduled"] as const;
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];
export type CalendarRow = {
  id: string; state: AppointmentState; startsAt: Date; endsAt: Date; holdUntil: Date | null; noShowFrom: Date; channel: string;
  patientId: string; patientName: string; patientMrn: string; serviceName: string; versionId: string; performerId: string; performerName: string;
  rooms: { id: string; name: string }[]; devices: { id: string; name: string }[];
};
export type Calendar = { appointments: CalendarRow[]; performers: { id: string; name: string }[] };

// A branch's appointments for branch-local dates [from, to] (≤ 62 days) and its performers.
export async function calendar(db: pg.ClientBase, branchId: string, from: string, to: string): Promise<Calendar> {
  const r = await call(() => db.query(`select appointments_window($1, $2::date, $3::date) as w`, [branchId, from, to]));
  const w = r.rows[0].w as { appointments: Record<string, unknown>[]; performers: { id: string; name: string }[] };
  return {
    performers: w.performers,
    appointments: w.appointments.map((x) => ({
      id: x.id as string, state: x.state as AppointmentState, startsAt: new Date(x.starts_at as string), endsAt: new Date(x.ends_at as string),
      holdUntil: x.hold_until ? new Date(x.hold_until as string) : null, noShowFrom: new Date(x.no_show_from as string), channel: x.channel as string,
      patientId: x.patient_id as string, patientName: x.patient_name as string, patientMrn: x.patient_mrn as string, serviceName: x.service_name as string,
      versionId: x.version_id as string, performerId: x.performer_id as string, performerName: x.performer_name as string,
      rooms: x.rooms as { id: string; name: string }[], devices: x.devices as { id: string; name: string }[],
    })),
  };
}

async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, unknown>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command, key, body: body as never }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export const confirmAttendance = (db: pg.ClientBase, key: string, id: string) =>
  command<null>(db, "appointment.confirm", key, { id }, `select appointment_confirm($1) as r`, [id]);
export const cancelAppointment = (db: pg.ClientBase, key: string, id: string, reason: string) =>
  command<null>(db, "appointment.cancel", key, { id, reason }, `select appointment_cancel($1, $2) as r`, [id, reason]);
export const markNoShow = (db: pg.ClientBase, key: string, id: string) =>
  command<null>(db, "appointment.no_show", key, { id }, `select appointment_no_show($1) as r`, [id]);

export type Rescheduled = { appointmentId: string; startsAt: Date; endsAt: Date; staffId: string };
export async function reschedule(db: pg.ClientBase, key: string, id: string, startsAt: Date, staffId: string | null) {
  const out = await command<{ [key: string]: Json }>(db, "appointment.reschedule", key, { id, start: startsAt.toISOString(), staff: staffId },
    `select appointment_reschedule($1, $2, $3) as r`, [id, startsAt, staffId]);
  const r = out.result!;
  return { appointmentId: r.appointment_id as string, startsAt: new Date(r.starts_at as string), endsAt: new Date(r.ends_at as string), staffId: r.staff_id as string, replayed: out.replayed };
}
