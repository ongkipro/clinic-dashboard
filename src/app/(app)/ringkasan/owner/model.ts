// Ringkasan Owner (UX-20) and Cabang league / detail (UX-37), PR-33a (T-109). Typed props and pure helpers for the
// presentational view (view.tsx). Values arrive already attributed by the T-107 readers (K1 branch where paid, K2
// executing branch, K3 selling branch, Appendix A); this module never recomputes attribution, never sums across units,
// and carries no clinical content: every field is an aggregate amount, a count, a branch / category label or a link.
// A value the reader could not produce is `unavailable` with a reason, never 0 (Rp0 is a real figure).
import type { ListState } from "../../../../components/templates/templates";

export type Amount = { state: "value"; rp: number } | { state: "unavailable"; reason: string };
// Ratio KPIs (K8, K9, K11, K12, K16): numerator over denominator; a zero denominator has no rate.
export type Ratio = { state: "value"; num: number; den: number } | { state: "unavailable"; reason: string };

// K9 Rencana dipilih (Appendix A): plan items selected ÷ recommended within 30 / 60 / 90 days, as a COUNT and as a VALUE. The league cell is the 30-day count (and is labelled so);
// the whole result — every window, count and value, with its zero denominators kept as they are — is what the card's expansion shows.
export type K9Window = 30 | 60 | 90;
export const K9_WINDOWS: readonly K9Window[] = [30, 60, 90];
export type K9Windows = Record<K9Window, { count: Ratio; value: Ratio }>;
export type K9Detail = { state: "value"; windows: K9Windows } | { state: "unavailable"; reason: string };

// K7 provenance (T-107 reader dims): estimated bulk consumption or uncosted stock. No reader fact says materials were expected but never
// recorded, so there is no such note (add one only with a reader dim for it).
export type K7Note = "estimasi" | "biaya_belum_lengkap";
export type Contribution = { amount: Amount; note?: K7Note };

export type AttentionKey = "persetujuan" | "belum_bayar" | "stok_klinis" | "lead_sla" | "satusehat" | "kepatuhan";
// A drill-down link is optional: with no built, authorized page that explains the value the view shows the value and no link (Sol decision 5).
export type Attention = { key: AttentionKey; count: number; href?: string } | { key: AttentionKey; state: "unavailable"; reason: string; href?: string };

export type Kpi = { amount: Amount; href?: string };
export type KpiWithPrevious = Kpi & { previous: Amount };

export type OwnerSummaryData = {
  attention: Attention[];
  k1: KpiWithPrevious;
  k2: KpiWithPrevious;
  k3: KpiWithPrevious;
  k4: Kpi & { aging: { d0_30: Amount; d31_60: Amount; d61_90: Amount; d90: Amount } };
  k5: Kpi & { packageExpiry30: Amount };
  k6: Kpi;
  k17: Kpi;
  k18: { belowMin: number; expiring30: number; countVariance: number; href?: string } | { state: "unavailable"; reason: string; href?: string };
  trend: { label: string; k1: Amount; k2: Amount }[]; // weeks, oldest first
  // Mix perawatan: rows by VERIFIED treatment category, or `unavailable` with the reason (the reader splits K2 / K7 by treatment / product /
  // consultation / session, which is not a category mix; no invented mapping). An empty `rows` is a real "no service completed", never a gap.
  mix: { state: "rows"; rows: { category: string; k2: Amount; k7: Contribution; href?: string }[] } | { state: "unavailable"; reason: string };
  funnel: { state: "value"; lead: number; booked: number; arrived: number; paid: number; sources: FunnelSources; href?: string } | { state: "unavailable"; reason: string; href?: string };
};

// K13 "by source" (Appendix A; PR-33a "channel funnel"): the funnel of ONE scope split by lead source. The scope is the one the payload was read for — the whole clinic, or one
// branch read through the reader's own branch selector — never a branch cut out of tenant-wide groups. `unavailable` when the groups are missing, not integers, or do not add up
// to the funnel above them (a breakdown of another population is worse than none).
export type FunnelSource = { source: string; label: string; lead: number; booked: number; arrived: number; paid: number };
export type FunnelSources = { state: "rows"; rows: FunnelSource[] } | { state: "unavailable"; reason: string };

export type LeagueKey = "k1" | "k2" | "k7" | "k8" | "k9" | "k10" | "k11" | "k12" | "k16" | "k17";
export type LeagueRow = {
  branchId: string;
  name: string;
  href: string; // UX-37 branch detail
  k1: Amount;
  k2: Amount;
  k7: Contribution;
  k8: Ratio;
  k9: Ratio; // the 30-day COUNT ratio: the league cell and the sort key
  k9Detail: K9Detail; // every window, count and value
  k10: { state: "value"; newPatients: number; returning: number } | { state: "unavailable"; reason: string };
  k11: Ratio;
  k12: Ratio;
  k16: Ratio;
  k17: Amount;
};

// Exactly one state per screen (10 State Copy Patterns): the template states plus `ready` carrying the data.
export type ScreenState<D> = Exclude<ListState, { kind: "rows" }> | { kind: "ready"; data: D };

export type Period = { label: string; basis: string; previousLabel: string }; // "Minggu ini", "Tanggal bayar, WIB", "minggu lalu"
export type Scope = { label: string; filtered: boolean }; // "Semua Cabang" or the branch name

export type OwnerSummaryProps = { title?: string; scope: Scope; period: Period; leagueHref: string; league?: LeagueRow[]; state: ScreenState<OwnerSummaryData>; as?: "main" | "section" };
export type LeagueProps = { scope: Scope; period: Period; sort: LeagueKey; sortHrefs: Record<LeagueKey, string>; state: ScreenState<LeagueRow[]>; as?: "main" | "section" };
export type BranchDetailProps = { branch: string; backHref: string; period: Period; state: ScreenState<OwnerSummaryData>; as?: "main" | "section" };

export const LEAGUE_KEYS: LeagueKey[] = ["k1", "k2", "k7", "k8", "k9", "k10", "k11", "k12", "k16", "k17"];
export const LEAGUE_LABEL: Record<LeagueKey, string> = {
  k1: "Uang masuk (K1)", k2: "Layanan selesai (K2)", k7: "Kontribusi (K7)", k8: "Konsultasi jadi pembelian (K8)", k9: "Rencana dipilih, jumlah 30 hari (K9)",
  k10: "Pasien baru / kembali (K10)", k11: "Kunjungan kedua (K11)", k12: "Tidak datang / batal < 24 jam (K12)", k16: "Lampiran produk (K16)", k17: "Komisi terutang (K17)",
};
// Lower is better only for K12; the league sorts best first.
export const LOWER_IS_BETTER: ReadonlySet<LeagueKey> = new Set(["k12"]);

export const ATTENTION_LABEL: Record<AttentionKey, string> = {
  persetujuan: "persetujuan menunggu", belum_bayar: "kunjungan belum bayar sebelum hari ini", stok_klinis: "stok klinis menipis",
  // kepatuhan counts only evidence already EXPIRED: the register has no "expiring soon" window and the spec defines none, so "hampir habis" is not counted
  lead_sla: "lead melewati batas respons", satusehat: "kiriman SATUSEHAT gagal", kepatuhan: "bukti kepatuhan sudah kedaluwarsa",
};
export const K7_NOTE: Record<K7Note, string> = { estimasi: "Estimasi", biaya_belum_lengkap: "Biaya belum lengkap" };
export const UNAVAILABLE = "Belum tersedia";
export const NO_DATA = "Belum ada data pada periode ini";
export const NO_RECOMMENDATION = "Belum ada rencana yang disarankan pada periode ini";
export const NO_RECOMMENDED_VALUE = "Belum ada nilai rencana yang disarankan pada periode ini";

const nf = new Intl.NumberFormat("id-ID");
const pf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const count = (n: number) => nf.format(n);
export const money = (a: Amount) => (a.state === "value" ? rp(a.rp) : UNAVAILABLE);
export const rate = (r: Ratio) => (r.state === "value" && r.den > 0 ? `${pf.format((r.num * 100) / r.den)}%` : UNAVAILABLE);
// A figure with its reason as TEXT (never only a tooltip): "Belum tersedia" plus why. A real zero denominator is not a failure but has no rate, and says so.
export type Shown = { text: string; reason: string | null };
export const amountShown = (a: Amount): Shown => (a.state === "value" ? { text: rp(a.rp), reason: null } : { text: UNAVAILABLE, reason: a.reason });
export const ratioShown = (r: Ratio, noData: string = NO_DATA): Shown =>
  r.state === "unavailable" ? { text: UNAVAILABLE, reason: r.reason } : r.den === 0 ? { text: UNAVAILABLE, reason: noData } : { text: `${pf.format((r.num * 100) / r.den)}%`, reason: null };
export const moneyWithReason = (a: Amount): string => (a.state === "value" ? rp(a.rp) : `${UNAVAILABLE} (${a.reason})`);

// "Perlu ditangani" is hidden when nothing needs attention (UX-20 §1) — but only a MEASURED zero is nothing: an item the owner's readers cannot
// answer is shown as unavailable with its reason, never dropped as an empty queue (Sol decision 2: missing data is not an empty queue).
export const openAttention = (items: Attention[]) => items.filter((a) => "state" in a || a.count > 0);

// Delta vs the tenant's own previous period only (D-11, no external benchmark). No percentage when the previous
// period is unavailable or zero: a ratio against 0 is meaningless.
export type Delta = { direction: "naik" | "turun" | "tetap"; text: string } | null;
export function delta(cur: Amount, prev: Amount, previousLabel: string): Delta {
  if (cur.state !== "value" || prev.state !== "value") return null;
  const d = cur.rp - prev.rp;
  const direction = d > 0 ? "naik" : d < 0 ? "turun" : "tetap";
  const word = direction === "naik" ? "Naik" : direction === "turun" ? "Turun" : "Tetap";
  if (direction === "tetap") return { direction, text: `${word} dibanding ${previousLabel}` };
  if (prev.rp === 0) return { direction, text: `${word} dari Rp0 ${previousLabel}` };
  return { direction, text: `${word} ${pf.format(Math.abs((d * 100) / prev.rp))}% dibanding ${previousLabel}` };
}

function leagueValue(r: LeagueRow, k: LeagueKey): number | null {
  const v = k === "k7" ? r.k7.amount : r[k];
  if (v.state !== "value") return null;
  if ("rp" in v) return v.rp;
  if ("den" in v) return v.den > 0 ? v.num / v.den : null;
  const total = v.newPatients + v.returning;
  return total > 0 ? v.returning / total : null; // K10 ranks by share of returning patients
}

// Best first; unavailable last; ties by branch name (stable, locale-aware).
export function sortLeague(rows: LeagueRow[], key: LeagueKey): LeagueRow[] {
  const sign = LOWER_IS_BETTER.has(key) ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = leagueValue(a, key);
    const y = leagueValue(b, key);
    if (x === null || y === null) return x === y ? a.name.localeCompare(b.name, "id") : x === null ? 1 : -1;
    return x === y ? a.name.localeCompare(b.name, "id") : sign * (x - y);
  });
}

// Trend scale (UX-20 §3): ONE vertical domain for both series that always contains Rp0 and every known value, so a negative week (K1 is net of cash refunds and refunded deposits)
// stays inside the plot and the baseline is Rp0 — never "the lowest value". Non-negative data keeps Rp0 on the bottom edge (as before), all-negative data puts it on the top edge,
// mixed data puts it in between; a flat zero series is a line on the bottom edge. A week with no reading is not in `known`: it is a gap in the line, never a point at zero.
export const TREND_H = 120;
export const TREND_PAD = 8;
export type TrendDomain = { lo: number; hi: number };
export function trendDomain(known: readonly number[]): TrendDomain {
  const lo = Math.min(0, ...known);
  let hi = Math.max(0, ...known);
  if (hi === lo) hi = lo + 1;
  return { lo, hi };
}
export const trendY = (v: number, d: TrendDomain, h = TREND_H, pad = TREND_PAD): number => pad + ((d.hi - v) * (h - 2 * pad)) / (d.hi - d.lo);

// Chart title states the finding (UX-20 §3, charts: "Summarize the main message"); only weeks where both are known count.
export function trendFinding(weeks: OwnerSummaryData["trend"]): string {
  const known = weeks.filter((w) => w.k1.state === "value" && w.k2.state === "value");
  if (known.length === 0) return "Uang masuk dan layanan selesai belum tersedia";
  const ahead = known.filter((w) => (w.k1 as { rp: number }).rp > (w.k2 as { rp: number }).rp).length;
  if (ahead === known.length) return `Uang masuk melebihi layanan selesai di semua ${known.length} minggu`;
  if (ahead === 0) return `Layanan selesai menyamai atau melebihi uang masuk di semua ${known.length} minggu`;
  return `Uang masuk melebihi layanan selesai di ${ahead} dari ${known.length} minggu`;
}
