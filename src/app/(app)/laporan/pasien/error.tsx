"use client";
// Error state of Laporan Pasien (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ReportError } from "../_components/report-error";

export default function PasienError({ retry }: { error: unknown; retry: () => void }) {
  return <ReportError title="Laporan Pasien" retry={retry} />;
}
