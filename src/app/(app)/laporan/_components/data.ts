// Laporan (UX-38; T-116): the server wrapper of the report loader. The role is checked HERE against the report page's nav roles, before
// the tenant transaction opens; everything else (the readers, not-found, the per-KPI role scope) is load.ts. No page is mounted yet:
// /laporan/<id>/page.tsx calls loadReportPage(id, searchParams) once its DEL-2 case is approved.
import "server-only";
import type { Role } from "../../../../auth/policy";
import { withTenantContext } from "../../../../db/rls/context";
import type { ReportId } from "../../../../modules/reporting/reports/dictionary";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type Page, type Query, readersOf, reportIn } from "./load";

export async function loadReportPage(report: ReportId, q: Query, now?: Date): Promise<{ kind: "redirect"; to: string } | { kind: "forbidden" } | Page> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !readersOf(report).includes(rc.active.context.actingRole as Role)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, (db) => reportIn(db, report, c.actingRole as Role, q, now));
}
