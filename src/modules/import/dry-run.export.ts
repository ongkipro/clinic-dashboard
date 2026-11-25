// Opening-data dry-run reconciliation CSV report export (DEL-2 *.export.ts surface; PR-85, DATA-58; T-128).
// Emits ONLY branch-level counts, cutover date, manifest SHA-256, and BigInt-string rupiah totals (zero PII!).
import { toCsv } from "../accounting/subledgers/subledgers";
import type { ReconciliationSummary } from "./parser";

export function formatDryRunReconciliationCsv(summary: ReconciliationSummary): string {
  const headers: (string | null)[] = [
    "cutover_date",
    "branch_code",
    "packages_paid_remaining_idr",
    "balances_idr",
    "booking_dps_idr",
    "receivables_idr",
    "manifest_sha256",
  ];
  const rows: (string | null)[][] = Object.entries(summary.byBranch)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([branchCode, totals]) => [
      summary.cutoverDate,
      branchCode,
      totals.packagesPaidRemaining,
      totals.balances,
      totals.bookingDps,
      totals.receivables,
      summary.validatedManifestSha256,
    ]);
  rows.push([
    summary.cutoverDate,
    "TOTAL",
    summary.totalsIdr.packagesPaidRemaining,
    summary.totalsIdr.balances,
    summary.totalsIdr.bookingDps,
    summary.totalsIdr.receivables,
    summary.validatedManifestSha256,
  ]);
  return toCsv([headers, ...rows]);
}
