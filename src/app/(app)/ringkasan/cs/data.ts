// Ringkasan CS data (UX-36; T-113): the server wrapper of the loader. The role is checked HERE against the page's nav row (central CS only),
// before the tenant transaction opens; everything else (the readers, not-found) is load.ts. No page is mounted yet:
// /ringkasan/cs/page.tsx calls loadCsPage(searchParams) once its DEL-2 case is approved.
import "server-only";
import type { Role } from "../../../../auth/policy";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type CsPage, csIn, type Query, readers } from "./load";

export async function loadCsPage(q: Query, now?: Date): Promise<{ kind: "redirect"; to: string } | { kind: "forbidden" } | CsPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !readers().includes(rc.active.context.actingRole as Role)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, (db) => csIn(db, q, now));
}
