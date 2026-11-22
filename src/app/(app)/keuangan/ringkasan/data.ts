// Ringkasan Keuangan data (UX-22; T-114): the server wrapper of the loader. The role is checked HERE against the page's nav row (finance,
// owner) before the tenant transaction opens; everything else (the readers, not-found) is load.ts. The page body (body.tsx, mounted by
// page.tsx) calls loadFinancePage(searchParams); its DEL-2 case (tests/isolation/cases/ringkasan-keuangan.cases.ts) runs financeIn from load.ts.
import "server-only";
import type { Role } from "../../../../auth/policy";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type FinancePage, financeIn, type Query, readers } from "./load";

export async function loadFinancePage(q: Query, now?: Date): Promise<{ kind: "redirect"; to: string } | { kind: "forbidden" } | FinancePage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !readers().includes(rc.active.context.actingRole as Role)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, (db) => financeIn(db, q, now));
}
