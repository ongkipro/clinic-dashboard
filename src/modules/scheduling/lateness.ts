// Lateness release (PR-8, SET-15, D-05; T-046). Off by default: a late patient keeps the slot unless the
// branch set SET-15 (5–60 minutes, the manager's setting). When set, an appointment still booked or
// confirmed whose start + SET-15 minutes has passed is released through the no-show writer of T-045
// (role, lifecycle, branch scope, the time rule, reservations released, an ids-only event). The release
// moves no money (booking-DP effects follow BILL-13 in M4) and never deducts a session (BILL-24).
// Every call runs inside withTenantContext; times come from the database clock. The calendar reader runs
// first, so its role and branch checks apply whether the rule is on or off (review r1 P1-1).
import type pg from "pg";
import { CommandError } from "../../lib/command";
import { settingValue } from "../settings/settings";
import { assertProductionGoLive } from "../vendor/profile/profile";
import { type Calendar, calendar, markNoShow } from "./appointments/appointments";

const WRITERS = ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs"];

// The branch's clock: yesterday and today in branch time (a late-evening appointment is still releasable
// after midnight, review r1 P2-1), and now. Unknown or foreign branches yield nothing here; the calendar
// call below answers not-found for them.
async function branchClock(db: pg.ClientBase, branchId: string) {
  const r = (await db.query(
    `select to_char((clock_timestamp() at time zone timezone)::date - 1, 'YYYY-MM-DD') as y,
            to_char(clock_timestamp() at time zone timezone, 'YYYY-MM-DD') as d, clock_timestamp() as now
       from branches where id = $1`,
    [branchId],
  )).rows[0];
  return r ? { from: r.y as string, to: r.d as string, now: r.now as Date } : { from: "2000-01-01", to: "2000-01-01", now: new Date(0) };
}

// The branch's calendar for yesterday and today, after the reader's role and scope checks.
async function window(db: pg.ClientBase, branchId: string): Promise<{ cal: Calendar; now: Date }> {
  const c = await branchClock(db, branchId);
  return { cal: await calendar(db, branchId, c.from, c.to), now: c.now };
}

// The branch's lateness minutes in force now, or null when the rule is off (after the scope check).
export async function lateness(db: pg.ClientBase, branchId: string): Promise<number | null> {
  const { now } = await window(db, branchId);
  const v = await settingValue<number | null>(db, "SET-15", branchId, now);
  return typeof v === "number" ? v : null;
}

// The appointments the rule would release now: none when the rule is off.
export async function lateReleasable(db: pg.ClientBase, branchId: string): Promise<string[]> {
  const { cal, now } = await window(db, branchId);
  const v = await settingValue<number | null>(db, "SET-15", branchId, now);
  if (typeof v !== "number") return [];
  const t = now.getTime();
  return cal.appointments.filter((a) => (a.state === "booked" || a.state === "confirmed") && a.noShowFrom.getTime() <= t).map((a) => a.id);
}

// Releases the late appointments of the branch; returns the released ids. Only the appointment writers
// may run it, and production needs the go-live gate, even when nothing is late. A repeated run replays
// the same idempotency key per appointment, so it never releases twice.
export async function releaseLate(db: pg.ClientBase, branchId: string): Promise<string[]> {
  await assertProductionGoLive(db);
  const role = (await db.query(`select public.app_acting_role() as r`)).rows[0].r as string | null;
  if (!role || !WRITERS.includes(role)) throw new CommandError("ERR_FORBIDDEN");
  const ids = await lateReleasable(db, branchId);
  for (const id of ids) await markNoShow(db, `lateness:${id}`, id);
  return ids;
}
