// Cabang data (UX-2, PR-2, T-036): one request in the active context. Owner and Admin Pusat see and
// change every branch; the manager sees the branches of their branch set and changes Jam, Libur and
// Ruang & Alat there (SET-2, 19:69). Other roles have no Cabang page (UX-2 visibility).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { commercialCatalog } from "../../../../modules/catalog/catalog";
import {
  type Branch, branchDevices, branchRooms, closures, type Closure, type Device, getBranch, type Interval, listBranches, offeredServices, type Room, weeklyHours,
} from "../../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { listStaff } from "../../../../modules/org/staff/staff";

export const FULL = ["owner", "admin_pusat"];
export const READERS = ["owner", "admin_pusat", "manager"];

type Base = { role: string; full: boolean; ctx: RenderedContext };
export type ListData = { kind: "redirect"; to: string } | { kind: "forbidden" } | ({ kind: "ok"; branches: Branch[] } & Base);
export type DetailData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | ({
      kind: "ok"; branch: Branch; hours: Interval[]; closures: Closure[]; rooms: Room[]; devices: Device[]; services: string[];
      catalog: { itemId: string; name: string; code: string }[]; staff: { id: string; name: string }[]; today: string;
    } & Base);

async function context() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  if (rc.kind === "blocked" || !READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" as const };
  const c = rc.active.context;
  return { kind: "ok" as const, c, allowed: rc.active.branches.map((b) => b.id), base: { role: c.actingRole, full: FULL.includes(c.actingRole), ctx: renderedContext(c) } };
}

export async function loadBranches(): Promise<ListData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  const all = await withTenantContext(await appPool(), x.c, listBranches);
  // The manager sees the branches of their own branch set (plan r1 P2-2).
  const branches = x.base.full ? all : all.filter((b) => x.allowed.includes(b.id));
  return { kind: "ok", branches, ...x.base };
}

// A branch outside the role's set is not found (plan r1 P2-2).
export async function loadBranch(id: string): Promise<DetailData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  if (!x.base.full && !x.allowed.includes(id)) return { kind: "not-found" };
  return withTenantContext(await appPool(), x.c, async (db) => {
    const branch = await getBranch(db, id);
    if (!branch) return { kind: "not-found" as const };
    const today = (await db.query(`select to_char(clock_timestamp() at time zone $1, 'YYYY-MM-DD') as d`, [branch.timezone])).rows[0].d as string;
    return {
      kind: "ok" as const, branch, today,
      hours: await weeklyHours(db, id), closures: await closures(db, id, today), rooms: await branchRooms(db, id), devices: await branchDevices(db, id),
      services: await offeredServices(db, id),
      catalog: x.base.full ? (await commercialCatalog(db)).filter((r) => r.kind === "service").map((r) => ({ itemId: r.itemId, name: r.name, code: r.code })) : [],
      staff: x.base.full ? (await listStaff(db)).filter((s) => s.active).map((s) => ({ id: s.staffId, name: s.name })) : [],
      ...x.base,
    };
  });
}

// /pengaturan/cabang/jam and /ruang: the active branch, else the first allowed one (plan r1 P2-2).
export async function defaultBranch(): Promise<{ kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; id: string | null }> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  return { kind: "ok", id: rc.active.context.activeBranchId ?? rc.active.branches[0]?.id ?? null };
}
