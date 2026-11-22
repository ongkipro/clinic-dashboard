"use client";
// Error state of Laporan Penjualan & Uang (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ReportError } from "../_components/report-error";

export default function PenjualanError({ retry }: { error: unknown; retry: () => void }) {
  return <ReportError title="Laporan Penjualan & Uang" retry={retry} />;
}
