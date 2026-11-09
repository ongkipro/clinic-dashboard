// Booking engine (PR-6, DATA-16; T-044, DEC-054). Every call runs inside withTenantContext. Slots come
// from booking_slots (15-minute grid, the service master's prep + treatment + buffer, branch hours and
// closures, the roster, and free rooms and devices); booking_create reserves the performer, room and
// device together under the tenant lock (an exclusion constraint is the last guard). Writes go through
// runCommand with the caller's idempotency key; database errors are mapped outside it (the T-038 lesson:
// a raised error rolls the claim back), and conflicts are retryable.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class BookingError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new BookingError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export const BOOKING_CHANNELS = ["walk_in", "phone", "whatsapp", "staff", "online"] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];
export type Slot = { startsAt: Date; endsAt: Date; staffId: string; rooms: string[]; devices: string[] };
export type Booked = { appointmentId: string; state: "held" | "booked"; startsAt: Date; endsAt: Date; staffId: string; rooms: string[]; devices: string[]; holdUntil: Date | null };

// Every valid start of a branch-local date for a service version; optional named performer.
export async function slots(db: pg.ClientBase, i: { branchId: string; versionId: string; date: string; staffId?: string | null }): Promise<Slot[]> {
  const r = await call(() => db.query(`select booking_slots($1, $2, $3::date, $4) as s`, [i.branchId, i.versionId, i.date, i.staffId ?? null]));
  return (r.rows[0].s as Record<string, unknown>[]).map((x) => ({
    startsAt: new Date(x.starts_at as string), endsAt: new Date(x.ends_at as string), staffId: x.staff_id as string, rooms: x.rooms as string[], devices: x.devices as string[],
  }));
}

type Raw = { appointment_id: string; state: "held" | "booked"; starts_at: string; ends_at: string; staff_id: string; rooms: string[]; devices: string[]; hold_until: string | null };
export async function book(
  db: pg.ClientBase,
  key: string,
  i: { branchId: string; patientId: string; versionId: string; startsAt: Date; staffId?: string | null; channel: BookingChannel; source?: string | null; campaign?: string | null; note?: string | null; hold?: boolean },
): Promise<Booked & { replayed: boolean }> {
  await assertProductionGoLive(db);
  const body = {
    branch: i.branchId, patient: i.patientId, version: i.versionId, start: i.startsAt.toISOString(), staff: i.staffId ?? null, channel: i.channel,
    source: i.source ?? null, campaign: i.campaign ?? null, note: i.note ?? null, hold: i.hold === true,
  };
  const out = await call(() => runCommand<Raw>(db, { command: "booking.create", key, body }, async (c) =>
    (await c.query(`select booking_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r`,
      [i.branchId, i.patientId, i.versionId, i.startsAt, i.staffId ?? null, i.channel, i.source ?? null, i.campaign ?? null, i.note ?? null, i.hold === true])).rows[0].r as Raw));
  if (!out.ok) throw out.error;
  const r = out.result;
  return {
    appointmentId: r.appointment_id, state: r.state, startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), staffId: r.staff_id, rooms: r.rooms, devices: r.devices,
    holdUntil: r.hold_until ? new Date(r.hold_until) : null, replayed: out.replayed,
  };
}

// A live hold becomes a booking (the DP was paid; M4 calls this).
export async function confirm(db: pg.ClientBase, key: string, appointmentId: string): Promise<{ replayed: boolean }> {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<null>(db, { command: "booking.confirm", key, body: { appointment: appointmentId } }, async (c) => {
    await c.query(`select booking_confirm($1)`, [appointmentId]);
    return null;
  }));
  if (!out.ok) throw out.error;
  return { replayed: out.replayed };
}
