// Laporan › Kamus KPI (UX-59, PR-95, 19 §2.13; T-116): the server gate of the dictionary page. The dictionary is STATIC (K1–K27 definitions from the module, no tenant data and no
// database read), so there is no tenant transaction here: only the role check, against the nav row of /laporan/kamus-kpi (every dashboard role; no new authority), before anything renders.
import "server-only";
import type { Role } from "../../../../auth/policy";
import { NAV } from "../../../../components/shell/nav";
import { requestContext } from "../../../../modules/org/context/store";
import { DICTIONARY_ROUTE, type ReportId } from "../../../../modules/reporting/reports/dictionary";
import { parseReport } from "./view";

export const KAMUS_ROLES: readonly Role[] = NAV.flatMap((g) => g.pages).find((p) => p.href === DICTIONARY_ROUTE)?.roles ?? [];

export async function loadKamus(q: { laporan?: string }): Promise<{ kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; report?: ReportId }> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !KAMUS_ROLES.includes(rc.active.context.actingRole as Role)) return { kind: "forbidden" };
  return { kind: "ok", report: parseReport(q.laporan) };
}
