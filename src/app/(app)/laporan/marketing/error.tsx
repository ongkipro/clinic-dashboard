"use client";
// Error state of Laporan Marketing (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ReportError } from "../_components/report-error";

export default function MarketingError({ retry }: { error: unknown; retry: () => void }) {
  return <ReportError title="Laporan Marketing" retry={retry} />;
}
