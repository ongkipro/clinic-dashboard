"use client";
// Error state of Laporan Stok (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ReportError } from "../_components/report-error";

export default function StokError({ retry }: { error: unknown; retry: () => void }) {
  return <ReportError title="Laporan Stok" retry={retry} />;
}
