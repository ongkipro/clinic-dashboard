"use client";
// Error state of Laporan Staf (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ReportError } from "../_components/report-error";

export default function StafError({ retry }: { error: unknown; retry: () => void }) {
  return <ReportError title="Laporan Staf" retry={retry} />;
}
