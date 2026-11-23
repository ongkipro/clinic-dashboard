// Jadwal segments data (19 §2.3 Daftar Reservasi · Booking Online Masuk · Daftar Tunggu; HYG-NAV-2). One request in the active context,
// the same branch rule as /jadwal (T-045): Owner, Admin Pusat and Central CS pick any branch, every other booking role its own. The
// database decides what each role reads (appointments_window, waitlist_list); a refusal on another tenant's branch is not-found.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { commercialCatalog } from "../../../../modules/catalog/catalog";
import { type Branch, listBranches } from "../../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type Calendar, calendar } from "../../../../modules/scheduling/appointments/appointments";
import { type WaitlistRow, waitlistList } from "../../../../modules/scheduling/waitlist/waitlist";

// appointments_window readers (0061); waitlist_list readers (0114) are the five writers.
export const CALENDAR_READERS = ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs", "bc", "doctor", "nurse", "therapist"];
export const WAITLIST_READERS = ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs"];
const WIDE = ["owner", "admin_pusat", "central_cs"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type Frame = { ctx: RenderedContext; role: string; branches: Branch[]; branch: Branch; today: string };
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" };

export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function frame<T>(readers: readonly string[], cabang: string | undefined, fn: (db: Db, f: Frame) => Promise<T>): Promise<NotOk | ({ kind: "ok" } & Frame & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !readers.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  const allowed = rc.active.branches.map((b) => b.id);
  return withTenantContext(await appPool(), c, async (db) => {
    const all = await listBranches(db);
    const branches = WIDE.includes(c.actingRole) ? all : all.filter((b) => allowed.includes(b.id));
    const branch = branches.find((b) => b.id === cabang) ?? branches.find((b) => b.id === c.activeBranchId) ?? branches[0];
    if (!branch) return { kind: "no-branch" as const };
    const today = (await db.query(`select to_char(clock_timestamp() at time zone $1, 'YYYY-MM-DD') as d`, [branch.timezone])).rows[0].d as string;
    const f: Frame = { ctx: renderedContext(c), role: c.actingRole, branches, branch, today };
    return { kind: "ok" as const, ...f, ...(await fn(db, f)) };
  });
}

// Appointments of a branch for [from, from + days) (appointments_window allows ≤ 62 days).
export async function loadAppointments(q: { cabang?: string; dari?: string; hari?: string }) {
  const days = q.hari === "30" ? 30 : 7;
  try {
    return await frame(CALENDAR_READERS, q.cabang, async (db, f) => {
      const from = q.dari && DATE.test(q.dari) ? q.dari : f.today;
      const to = addDays(from, days - 1);
      return { from, to, days, cal: (await calendar(db, f.branch.id, from, to)) as Calendar };
    });
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "forbidden" as const };
    throw e;
  }
}

export async function loadWaitlist(q: { cabang?: string }) {
  try {
    return await frame(WAITLIST_READERS, q.cabang, async (db, f) => ({
      rows: (await waitlistList(db, f.branch.id)) as WaitlistRow[],
      // service names from the commercial projection (no clinical content, every member, DEC-046 (2))
      services: Object.fromEntries((await commercialCatalog(db)).map((r) => [r.itemId, r.name])) as Record<string, string>,
    }));
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "forbidden" as const };
    throw e;
  }
}
