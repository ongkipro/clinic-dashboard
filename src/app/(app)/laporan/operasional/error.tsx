"use client";
// Error state of Laporan Operasional (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ReportError } from "../_components/report-error";

export default function OperasionalError({ retry }: { error: unknown; retry: () => void }) {
  return <ReportError title="Laporan Operasional" retry={retry} />;
}
