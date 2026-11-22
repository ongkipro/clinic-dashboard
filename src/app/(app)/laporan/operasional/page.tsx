// Laporan Operasional (UX-38, PR-95; T-116): the route. The page body, the role gate and the states are shared (_components/report-page.tsx); this file names the report and its metadata.
import type { Metadata } from "next";
import { REPORTS } from "../../../../modules/reporting/reports/dictionary";
import { ReportPage, type SearchParams } from "../_components/report-page";

export const metadata: Metadata = { title: `${REPORTS.operasional.title} — Clinic Dashboard` };

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <ReportPage report="operasional" searchParams={searchParams} />;
}
