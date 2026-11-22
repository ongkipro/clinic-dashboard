// Laporan pages (UX-38, 19 §2.13, PR-95; T-116): the ONE page body shared by /laporan/{penjualan,perawatan,pasien,staf,operasional,stok,marketing}; each route's page.tsx only
// names its report. loadReportPage gates the role (the report's nav row) before the tenant transaction opens and reads the period through the integrated readers; a foreign
// ?cabang= is Next's not-found (TEN-1); a role outside the row gets the permission state; a KPI the role may not read is "Tidak tersedia untuk peran ini", never Rp0. A page owns one
// <main>: ReportView renders it, and the loading / permission shells are ListPage's own. No download link is offered by this task.
// `reportBody` is exported so the tests run exactly what the page runs (redirect / notFound throw Next's own control-flow errors, as they do in a request).
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { REPORTS, type ReportId } from "../../../../modules/reporting/reports/dictionary";
import { loadReportPage } from "./data";
import { ReportView } from "./report-view";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export async function reportBody(report: ReportId, searchParams: Promise<SearchParams>) {
  const title = REPORTS[report].title;
  const sp = await searchParams;
  const r = await loadReportPage(report, { periode: one(sp.periode), dari: one(sp.dari), sampai: one(sp.sampai), cabang: one(sp.cabang) });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "not-found") notFound(); // another tenant's branch id (TEN-1)
  if (r.kind === "forbidden") return <ListPage title={title} state={{ kind: "permission", object: title.toLowerCase() }} />;
  return <ReportView props={r.props} state={r.state} />;
}

async function Body({ report, searchParams }: { report: ReportId; searchParams: Promise<SearchParams> }) {
  return reportBody(report, searchParams);
}

export function ReportPage({ report, searchParams }: { report: ReportId; searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<ListPage title={REPORTS[report].title} state={{ kind: "loading" }} />}>
      <Body report={report} searchParams={searchParams} />
    </Suspense>
  );
}
