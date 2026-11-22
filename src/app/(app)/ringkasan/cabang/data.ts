// Ringkasan Cabang data (UX-21; T-110): the server wrapper of the loader. The role is checked HERE against the page's nav row (M O AP) before
// the tenant transaction opens; the role and the active branch come from the server-resolved context. No page is mounted yet:
// /ringkasan/cabang/page.tsx calls loadCabangPage(searchParams) once its DEL-2 case is in place, and applies `route` with redirect().
import "server-only";
import type { Role } from "../../../../auth/policy";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type CabangPage, cabangIn, navRoles, type Query } from "./load";

export async function loadCabangPage(q: Query): Promise<{ kind: "redirect"; to: string } | { kind: "forbidden" } | CabangPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !navRoles().includes(rc.active.context.actingRole as Role)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, (db) => cabangIn(db, c.actingRole as Role, c.activeBranchId ?? null, q));
}
