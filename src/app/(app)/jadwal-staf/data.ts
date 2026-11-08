// Jadwal Staf (UX-33, PR-48, T-043): one request in the active context. Owner and Admin Pusat see every
// branch; the manager the branches of their set (07 "Staff schedules"). The roster lists the branch's
// staff in the performer and front roles; the grid shows the branch's hours and closures for the week.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { type Branch, closures, type Closure, type Interval, listBranches, weeklyHours } from "../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { listStaff } from "../../../modules/org/staff/staff";
import { branchLeave, type Leave, type ShiftRow, weekShifts } from "../../../modules/scheduling/rosters/rosters";

export const WRITERS = ["owner", "admin_pusat", "manager"];
export const ROSTER_ROLES = ["doctor", "nurse", "therapist", "bc", "fo_cashier"] as const;
export type RosterRole = (typeof ROSTER_ROLES)[number];

export type JadwalData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | {
      kind: "ok"; ctx: RenderedContext; branches: Branch[]; branch: Branch; week: string; today: string; days: string[];
      staff: { id: string; name: string; roles: RosterRole[] }[]; shifts: ShiftRow[]; leave: Leave[]; hours: Interval[]; closures: Closure[];
    };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

export async function loadJadwal(q: { cabang?: string; minggu?: string }): Promise<JadwalData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !WRITERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  const full = c.actingRole !== "manager";
  const allowed = rc.active.branches.map((b) => b.id);
  return withTenantContext(await appPool(), c, async (db) => {
    const all = await listBranches(db);
    const branches = full ? all : all.filter((b) => allowed.includes(b.id));
    const branch = branches.find((b) => b.id === q.cabang) ?? branches.find((b) => b.id === c.activeBranchId) ?? branches[0];
    if (!branch) return { kind: "no-branch" as const };
    const today = (await db.query(`select to_char(clock_timestamp() at time zone $1, 'YYYY-MM-DD') as d`, [branch.timezone])).rows[0].d as string;
    const week = mondayOf(q.minggu && DATE.test(q.minggu) ? q.minggu : today);
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(week, i));
    const staff = (await listStaff(db))
      .filter((s) => s.active)
      .map((s) => ({ id: s.staffId, name: s.name, roles: s.roles.filter((r) => r.branchIds.includes(branch.id) && (ROSTER_ROLES as readonly string[]).includes(r.role)).map((r) => r.role as RosterRole) }))
      .filter((s) => s.roles.length > 0);
    return {
      kind: "ok" as const, ctx: renderedContext(c), branches, branch, week, today, days, staff,
      shifts: await weekShifts(db, branch.id, week), leave: await branchLeave(db, branch.id, week, days[6]),
      hours: await weeklyHours(db, branch.id), closures: await closures(db, branch.id, week, days[6]),
    };
  });
}
