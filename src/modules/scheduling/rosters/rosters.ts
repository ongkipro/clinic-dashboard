// Staff schedules (PR-48, UX-33; T-043, DEC-053). Every call runs inside withTenantContext. Writes go
// through roster_set_week / leave_add / leave_cancel (migration 0060); booking (T-044) reads through
// staff_available and roster_window. Dates are branch-local "YYYY-MM-DD", times "HH:MM" ("24:00" allowed).
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../../lib/command";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT"]);

export class RosterError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new RosterError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export const LEAVE_KINDS = ["leave", "sick", "absent"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];
export type ShiftRow = { staffId: string; date: string; starts: string; ends: string; kind: "work" | "break" };
export type Leave = { id: string; staffId: string; kind: LeaveKind; from: string; to: string; reason: string; cancelledAt: Date | null };

// Saves the week (a Monday) from today on for the listed staff only (the ones the editor shows); other
// staff at the branch keep their shifts. Returns the number of rows written.
export async function setWeek(db: pg.ClientBase, branchId: string, weekStart: string, staffIds: string[], rows: ShiftRow[]): Promise<number> {
  const body = rows.map((r) => ({ staff_id: r.staffId, date: r.date, starts: r.starts, ends: r.ends, kind: r.kind }));
  const r = await call(() => db.query(`select roster_set_week($1, $2::date, $3::uuid[], $4::jsonb) as n`, [branchId, weekStart, staffIds, JSON.stringify(body)]));
  return r.rows[0].n as number;
}

export async function addLeave(db: pg.ClientBase, i: { branchId: string; staffId: string; kind: LeaveKind; from: string; to: string; reason: string }): Promise<string> {
  const r = await call(() => db.query(`select leave_add($1, $2, $3, $4::date, $5::date, $6) as id`, [i.branchId, i.staffId, i.kind, i.from, i.to, i.reason]));
  return r.rows[0].id as string;
}

export async function cancelLeave(db: pg.ClientBase, id: string, reason: string): Promise<void> {
  await call(() => db.query(`select leave_cancel($1, $2)`, [id, reason]));
}

// The week as stored (RLS: booking roles at the branch, or the staff themselves).
export async function weekShifts(db: pg.ClientBase, branchId: string, weekStart: string): Promise<ShiftRow[]> {
  const r = await db.query(
    `select staff_id, to_char(shift_date, 'YYYY-MM-DD') as date, to_char(starts, 'HH24:MI') as starts,
            case when ends = time '23:59:59.999999' then '24:00' else to_char(ends, 'HH24:MI') end as ends, kind
       from staff_shifts where branch_id = $1 and shift_date between $2::date and $2::date + 6
      order by shift_date, staff_id, starts`,
    [branchId, weekStart],
  );
  return r.rows.map((x) => ({ staffId: x.staff_id, date: x.date, starts: x.starts, ends: x.ends, kind: x.kind }));
}

// Leave at a branch overlapping a date window (RLS: Owner, Admin Pusat, Manager at the branch, or self).
export async function branchLeave(db: pg.ClientBase, branchId: string, from: string, to: string): Promise<Leave[]> {
  const r = await db.query(
    `select id, staff_id, kind, to_char(from_date, 'YYYY-MM-DD') as f, to_char(to_date, 'YYYY-MM-DD') as t, reason, cancelled_at
       from staff_leave where branch_id = $1 and from_date <= $3::date and to_date >= $2::date order by from_date, staff_id`,
    [branchId, from, to],
  );
  return r.rows.map((x) => ({ id: x.id, staffId: x.staff_id, kind: x.kind, from: x.f, to: x.t, reason: x.reason, cancelledAt: x.cancelled_at }));
}

export async function isStaffAvailable(db: pg.ClientBase, i: { staffId: string; branchId: string; from: Date; until: Date }): Promise<boolean> {
  const r = await call(() => db.query(`select staff_available($1, $2, $3, $4) as ok`, [i.staffId, i.branchId, i.from, i.until]));
  return r.rows[0].ok === true;
}

export type RosterWindow = { shifts: ShiftRow[]; leave: { staffId: string; from: string; to: string }[] };
export async function rosterWindow(db: pg.ClientBase, branchId: string, from: string, to: string): Promise<RosterWindow> {
  const r = await call(() => db.query(`select roster_window($1, $2::date, $3::date) as w`, [branchId, from, to]));
  const w = r.rows[0].w as { shifts: Record<string, string>[]; leave: Record<string, string>[] };
  return {
    shifts: w.shifts.map((x) => ({ staffId: x.staff_id, date: x.date, starts: x.starts, ends: x.ends, kind: x.kind as "work" | "break" })),
    leave: w.leave.map((x) => ({ staffId: x.staff_id, from: x.from, to: x.to })),
  };
}
