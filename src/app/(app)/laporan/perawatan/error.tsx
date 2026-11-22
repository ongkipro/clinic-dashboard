"use client";
// Error state of Laporan Perawatan (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ReportError } from "../_components/report-error";

export default function PerawatanError({ retry }: { error: unknown; retry: () => void }) {
  return <ReportError title="Laporan Perawatan" retry={retry} />;
}
