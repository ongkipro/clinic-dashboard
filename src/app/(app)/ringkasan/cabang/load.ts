// Ringkasan Cabang (UX-21, PR-33b; T-110): the page-data core. It reads ONE branch through readBranchSummary (existing granted readers with
// their own authority) and resolves the view state with the slice-1 model (resolveView). No `server-only`: data.ts gates the role first; this
// core is what the isolation case runs as another tenant's manager.
// Roles (nav row "/ringkasan/cabang" = M O AP, Panel 2 decision 2): manager → UX-21 for the active branch; owner and admin_pusat are routed
// elsewhere (owner → T-109's UX-37 Cabang, admin_pusat → the built branch settings /pengaturan/cabang, where it sees and changes every branch)
// — returned here as an explicit `route` decision, NOT executed: the owner target does not exist on main yet (T-109), so the page applies
// them at mount. Any other role → permission.
import type pg from "pg";
import type { Role } from "../../../../auth/policy";
import { NAV } from "../../../../components/shell/nav";
import { CommandError } from "../../../../lib/command";
import { type Filter, parseFilter, resolveView, type ViewState } from "./model";
import { readBranchSummary } from "./reader";

export const PATH = "/ringkasan/cabang";
// Panel 2 decision 2 routing intents (targets not on main yet; applied at mount, never here)
export const ROUTE_FOR: Partial<Record<Role, string>> = { owner: "/ringkasan/owner/cabang", admin_pusat: "/pengaturan/cabang" };
export function navRoles(): readonly Role[] {
  return NAV.flatMap((g) => g.pages).find((p) => p.href === PATH)?.roles ?? [];
}

export type Query = { tampilan?: string };
export type Branch = { id: string; name: string };
export type CabangPage =
  | { kind: "route"; to: string; role: Role } // owner / admin_pusat: the page redirects (Panel 2 decision 2)
  | { kind: "not-found" } // the active branch is not the caller's tenant's (TEN-1)
  | { kind: "ok"; state: ViewState; filter: Filter };

// role + active branch come from the server-resolved context, never from the query (a manager reads its active branch only)
export async function cabangIn(db: pg.ClientBase, role: Role, activeBranchId: string | null, q: Query): Promise<CabangPage> {
  const route = ROUTE_FOR[role];
  if (route) return { kind: "route", to: route, role };
  const filter = parseFilter(q.tampilan);
  await db.query("savepoint ringkasan_cabang_page");
  try {
    const branches = (await db.query<Branch>(`select id, name from branches order by created_at, id`)).rows;
    const viewer = { role, activeBranchId, branches };
    // no active branch, or a role that is not the manager → the model answers (no-branch / permission) without a read
    if (role !== "manager" || !activeBranchId) {
      await db.query("release savepoint ringkasan_cabang_page");
      return { kind: "ok", filter, state: resolveView({ viewer, filter, read: { ok: false } }) };
    }
    const raw = await readBranchSummary(db, activeBranchId);
    await db.query("release savepoint ringkasan_cabang_page");
    return { kind: "ok", filter, state: resolveView({ viewer, filter, read: { ok: true, raw } }) };
  } catch (e) {
    await db.query("rollback to savepoint ringkasan_cabang_page");
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" };
    // a reader fault: the error state (never an empty or zero summary), logged by name only
    console.error("ringkasan/cabang: reader failed", { error: e instanceof Error ? e.name : "unknown" });
    return { kind: "ok", filter, state: { kind: "error" } };
  }
}
