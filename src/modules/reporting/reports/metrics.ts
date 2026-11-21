// Report metric values (PR-95, UX-38). A value the system cannot give is "unavailable" with a reason and is never shown as 0 or Rp0;
// a real zero stays 0. Money is integer rupiah (no float); ratios keep numerator and denominator; durations are whole seconds.
// slice 2 (real readers): forbidden = the acting role may not read this KPI (07 Dashboards); incomplete = the reader cannot vouch for a
// complete value (K4 undated cancellation, K5 pre-cutover residue, K7 uncosted movement); period_unsupported = the reader has no such period.
// slice 3: branch_unattributed = the figure exists only tenant-wide (K17: the net actually paid has no branch, 0126), so a branch view
// cannot give it.
export type Unavailable = "reader_pending" | "no_data" | "invalid" | "forbidden" | "incomplete" | "period_unsupported" | "branch_unattributed";
export type Metric =
  | { kind: "count"; value: number }
  | { kind: "money"; rupiah: number }
  | { kind: "ratio"; num: number; den: number } // den > 0
  | { kind: "duration"; seconds: number }
  | { kind: "score"; hundredths: number } // survey average × 100
  | { kind: "unavailable"; reason: Unavailable };

export const pending: Metric = { kind: "unavailable", reason: "reader_pending" };
export const noData: Metric = { kind: "unavailable", reason: "no_data" };
export const UNAVAILABLE_COPY: Record<Unavailable, string> = {
  reader_pending: "Belum tersedia",
  no_data: "Belum ada data",
  invalid: "Data tidak valid",
  forbidden: "Tidak tersedia untuk peran ini",
  incomplete: "Belum lengkap",
  period_unsupported: "Hanya per bulan penuh",
  branch_unattributed: "Belum dapat dihitung per cabang",
};

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
// Half away from zero, so −2.5 and 2.5 round alike (Math.round would not).
export const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
export const money = (rupiah: number): Metric => (Number.isSafeInteger(rupiah) ? { kind: "money", rupiah } : { kind: "unavailable", reason: "invalid" });
export const count = (value: number): Metric => (Number.isSafeInteger(value) && value >= 0 ? { kind: "count", value } : { kind: "unavailable", reason: "invalid" });
export const ratio = (num: number, den: number): Metric => (den > 0 ? { kind: "ratio", num, den } : noData);
// Median of whole seconds; an even count takes the mean of the two middle values, rounded half away from zero.
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : roundHalfAway((s[m - 1] + s[m]) / 2);
}
export const duration = (seconds: number | null): Metric => (seconds === null ? noData : { kind: "duration", seconds });

const nf = new Intl.NumberFormat("id-ID");
const pf = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sf = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rupiah = (n: number) => `${n < 0 ? "−" : ""}Rp${nf.format(Math.abs(n))}`;
export const percent = (num: number, den: number) => `${pf.format((num * 100) / den)}%`;
export function minutes(seconds: number): string {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return s === 0 ? `${nf.format(m)} menit` : `${nf.format(m)} menit ${s} detik`;
}
export function show(m: Metric): string {
  switch (m.kind) {
    case "count": return nf.format(m.value);
    case "money": return rupiah(m.rupiah);
    case "ratio": return percent(m.num, m.den);
    case "duration": return minutes(m.seconds);
    case "score": return sf.format(m.hundredths / 100);
    case "unavailable": return UNAVAILABLE_COPY[m.reason];
  }
}
