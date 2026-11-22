// Ringkasan Owner (UX-20 / UX-37), T-109: composition — the `dashboard_kpi` answers (KpiPayload, consume.ts) turned into the view's props. Pure: no
// database, no clock, no import of the reader module; the loader (data.ts) only fetches and hands the answers over. Every rule is Sol's decision
// (t109/SOL-PREWIRE-DECISION.md): a part this screen cannot prove is `unavailable` with its reason — never a partial sum, never Rp0, never a guess —
// and a link is given only to a built destination that explains the value.
import { SOURCE } from "../../lead/labels";
import { type Dims, k17ForBranch, k17Owed, k4Card, type KpiPayload } from "./consume";
import { type Amount, type FunnelSources, type K9Detail, type K9Window, type K9Windows, LEAGUE_KEYS, type LeagueKey, type LeagueRow, type OwnerSummaryData, type Ratio } from "./model";
import { type PeriodKind, type Periods, type Win, weekLabel } from "./period";

const unavailable = (reason: string): Amount => ({ state: "unavailable", reason });
const isInt = (n: unknown): n is number => Number.isSafeInteger(n);
const value = (rp: number): Amount => ({ state: "value", rp });

// A money KPI's reader total: null total = the reader answered with no rows = a real Rp0 for a flow KPI (K1/K2/K3/K6/K7).
// (K4, K5 and K17 have their own completeness rules.) A non-integer proves nothing.
export const flow = (p: KpiPayload | null): Amount => (p === null ? unavailable("Pembacaan belum tersedia") : p.total === null ? value(0) : isInt(p.total) ? value(p.total) : unavailable("Nilai tidak valid"));
export const flowAt = (p: KpiPayload | null, branchId: string): Amount => {
  if (p === null) return unavailable("Pembacaan belum tersedia");
  const d = p.by_branch?.[branchId];
  if (!d) return value(0); // no row at this branch in the period
  const parts = Object.values(d);
  return parts.every(isInt) ? value(parts.reduce((s, x) => s + x, 0)) : unavailable("Nilai tidak valid");
};

// ── ratio KPIs by branch (numerator / denominator from the reader's dims) ────────────────────────────────────────────────────────────────
const ratio = (num: unknown, den: unknown): Ratio => (isInt(num) && isInt(den) && num >= 0 && den >= 0 ? { state: "value", num, den } : { state: "unavailable", reason: "Nilai tidak valid" });
const at = (p: KpiPayload | null, b: string, dim: string) => p?.by_branch?.[b]?.[dim] ?? 0;

// K8 consultation → purchase; K16 attachment of products; K12 failed ÷ booked; K11 second visit ÷ new — all `by_dim` counts at the visit / booking branch.
export const k8 = (p: KpiPayload | null, b: string): Ratio => (p ? ratio(at(p, b, "purchase"), at(p, b, "consultation")) : { state: "unavailable", reason: "Pembacaan belum tersedia" });
export const k16 = (p: KpiPayload | null, b: string): Ratio => (p ? ratio(at(p, b, "with_product"), at(p, b, "treatment_visit")) : { state: "unavailable", reason: "Pembacaan belum tersedia" });
export const k11 = (p: KpiPayload | null, b: string): Ratio => (p ? ratio(at(p, b, "second_visit"), at(p, b, "new")) : { state: "unavailable", reason: "Pembacaan belum tersedia" });
export const k12 = (p: KpiPayload | null, b: string): Ratio => (p ? ratio(at(p, b, "no_show") + at(p, b, "late_cancel"), at(p, b, "booked")) : { state: "unavailable", reason: "Pembacaan belum tersedia" });

// K9 Rencana dipilih (decision 4): selected ÷ recommended, count and value, with an explicit 30 / 60 / 90-day window. The league's single cell is
// the 30-day COUNT ratio, labelled as such by the view; the three windows are returned whole for the detail. A zero denominator has no rate.
export type K9 = { windows: K9Windows };
export function k9(p: KpiPayload | null, b: string): K9 | null {
  if (!p) return null;
  const w = (n: K9Window) => ({ count: ratio(at(p, b, `selected_${n}_count`), at(p, b, "recommended_count")), value: ratio(at(p, b, `selected_${n}_value`), at(p, b, "recommended_value")) });
  return { windows: { 30: w(30), 60: w(60), 90: w(90) } };
}
export const k9League = (p: KpiPayload | null, b: string): Ratio => k9(p, b)?.windows[30].count ?? { state: "unavailable", reason: "Pembacaan belum tersedia" };
// The whole K9 result for the card's expansion: every window, count and value, a zero denominator kept as a zero denominator (the view says "Belum tersedia", never 0 %).
export function k9Detail(p: KpiPayload | null, b: string): K9Detail {
  const x = k9(p, b);
  return x ? { state: "value", windows: x.windows } : { state: "unavailable", reason: "Pembacaan belum tersedia" };
}

// K10 (decision 4): first-in-tenant ("new") and repeat ("returning") visit counts, attributed to the visit branch — kept as two labelled counts.
export function k10(p: KpiPayload | null, b: string): LeagueRow["k10"] {
  if (!p) return { state: "unavailable", reason: "Pembacaan belum tersedia" };
  const n = at(p, b, "new"), r = at(p, b, "returning");
  return isInt(n) && isInt(r) ? { state: "value", newPatients: n, returning: r } : { state: "unavailable", reason: "Nilai tidak valid" };
}

// K7 Kontribusi per branch with its provenance (T-107): `estimasi` and `uncosted` are COUNTS (flags), never money. The reader's dims carry no
// "materials never recorded" flag, so that note is never produced here (the final reader has no source for it).
export function k7(p: KpiPayload | null, b: string): LeagueRow["k7"] {
  if (!p) return { amount: unavailable("Pembacaan belum tersedia") };
  const d = p.by_branch?.[b] ?? {};
  const money = Object.entries(d).filter(([k]) => k !== "estimasi" && k !== "uncosted").map(([, v]) => v);
  if (!money.every(isInt)) return { amount: unavailable("Nilai tidak valid") };
  const note = (d.uncosted ?? 0) > 0 ? ("biaya_belum_lengkap" as const) : (d.estimasi ?? 0) > 0 ? ("estimasi" as const) : undefined;
  return { amount: value(money.reduce((s, x) => s + x, 0)), ...(note ? { note } : {}) };
}

// Destinations that EXIST on main (checked against the tree), are readable by the owner, AND show the same population as the figure (Sol decision 5). Everything else
// has no link and is recorded in the System Map delta as the outstanding drill-down contract:
//   K6, K13 detail, the mix, the league's per-KPI rows — no built page holds K6 or the mix; K13's report (Laporan Marketing) is "MK CS", not the owner's;
//   K4  — /piutang lists patient receivables only; K4 also holds the unpaid lines of closed visits, which no built page lists (it would explain part of the figure);
//   K17 on a branch — /komisi lists the whole clinic's batches, not one branch's;
//   K18 — /stok/item is not in the owner's menu (nav "PH PU AP"); the page admits the owner, the navigation never offers it;
//   K13 — /lead is not in the owner's menu (nav "CS BC MK").
// Linked: K5 → /keuangan/kewajiban (owner in the nav; takes ?cabang=), K17 consolidated → /komisi (owner in the nav; clinic-wide batches),
//   K1 / K2 / K3 → /laporan/penjualan (T-116; nav "O F M"; holds exactly K1, K2, K3 from the same dashboard_kpi reader), for the card's own window
//   (?dari=&sampai=: the report's free range, so a week-to-date is not widened to the month) and, on a branch page, its ?cabang=.
// The selected period travels on EVERY link between the summary, the league, a branch and back (the destination otherwise defaults to the week): one builder per link, tested.
export const LEAGUE_PATH = "/ringkasan/owner/cabang";
export const leagueHref = (kind: PeriodKind): string => `${LEAGUE_PATH}?periode=${kind}`;
export const branchHref = (id: string, kind: PeriodKind): string => `${LEAGUE_PATH}/${id}?periode=${kind}`;
export const sortHrefs = (kind: PeriodKind): Record<LeagueKey, string> => Object.fromEntries(LEAGUE_KEYS.map((k) => [k, `${LEAGUE_PATH}?urut=${k}&periode=${kind}`])) as Record<LeagueKey, string>;
export const hrefsFor = (branchId: string | null, cur: Win): Hrefs => {
  const sales = `/laporan/penjualan?${new URLSearchParams({ dari: cur.from, sampai: cur.to, ...(branchId ? { cabang: branchId } : {}) })}`;
  return { ...(branchId ? { k5: `/keuangan/kewajiban?cabang=${branchId}` } : { k5: "/keuangan/kewajiban", k17: "/komisi" }), k1: sales, k2: sales, k3: sales };
};

// ── the league row ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type LeagueInputs = { k1: KpiPayload | null; k2: KpiPayload | null; k7: KpiPayload | null; k8: KpiPayload | null; k9: KpiPayload | null; k10: KpiPayload | null;
  k11: KpiPayload | null; k12: KpiPayload | null; k16: KpiPayload | null; k17: KpiPayload | null };
export function leagueRow(branch: { id: string; name: string }, i: LeagueInputs, href: string): LeagueRow {
  return { branchId: branch.id, name: branch.name, href, k1: flowAt(i.k1, branch.id), k2: flowAt(i.k2, branch.id), k7: k7(i.k7, branch.id), k8: k8(i.k8, branch.id), k9: k9League(i.k9, branch.id), k9Detail: k9Detail(i.k9, branch.id),
    k10: k10(i.k10, branch.id), k11: k11(i.k11, branch.id), k12: k12(i.k12, branch.id), k16: k16(i.k16, branch.id),
    k17: i.k17 ? k17ForBranch(i.k17, branch.id) : unavailable("Pembacaan belum tersedia") };
}

// The league section of the summary shows only K1 and K2 per branch (both already read for the cards): the other columns are not loaded there, so they say so
// instead of pretending to be a reading — the full league (every KPI) is the Cabang page.
export function summaryLeagueRow(branch: { id: string; name: string }, k1: KpiPayload | null, k2: KpiPayload | null, href: string): LeagueRow {
  const na = unavailable("Tidak dimuat di ringkasan; lihat halaman Cabang");
  const r: Ratio = { state: "unavailable", reason: "Tidak dimuat di ringkasan; lihat halaman Cabang" };
  return { branchId: branch.id, name: branch.name, href, k1: flowAt(k1, branch.id), k2: flowAt(k2, branch.id), k7: { amount: na }, k8: r, k9: r, k9Detail: { state: "unavailable", reason: r.reason },
    k10: { state: "unavailable", reason: na.state === "unavailable" ? na.reason : "" }, k11: r, k12: r, k16: r, k17: na };
}

// ── the owner summary (UX-20) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// K13 answers by source in `by_grp1`; `branch_id` is the scope the reader answered for (null = the whole clinic). Both come from the reader, not from this module.
export type K13Payload = KpiPayload & { branch_id?: string | null; by_grp1?: Record<string, Dims> };
export type SummaryInputs = {
  periods: Periods;
  k1: KpiPayload | null; k1Prev: KpiPayload | null; k2: KpiPayload | null; k2Prev: KpiPayload | null; k3: KpiPayload | null; k3Prev: KpiPayload | null;
  k4: KpiPayload | null; k5: KpiPayload | null; k6: KpiPayload | null; k17: KpiPayload | null; k18: KpiPayload | null; k13: K13Payload | null; // for a branch view: the K13 the reader answered FOR THAT BRANCH (its own `p_branch`)
  weeks: { k1: KpiPayload | null; k2: KpiPayload | null }[]; // the 8 trend weeks, oldest first; a failed week is null (a gap in the line, never 0)
  hrefs: Hrefs;
  attention: OwnerSummaryData["attention"];
  branchId: string | null; // one branch (UX-37 detail): the branch's own figures from the CONSOLIDATED answers
};
// Link targets: each is a BUILT page that explains the value, or undefined (the view then shows the value with no link).
export type Hrefs = Partial<Record<"k1" | "k2" | "k3" | "k4" | "k5" | "k6" | "k17" | "k18" | "k13" | "mix", string>>;

const scoped = (p: KpiPayload | null, branchId: string | null): Amount => (branchId ? flowAt(p, branchId) : flow(p));

// K5: the sum of the four prepaid ledgers, complete only when no movement sits inside an unmatched pre-cutover residue (`incomplete` count).
function k5(p: KpiPayload | null, branchId: string | null): { amount: Amount; expiry: Amount } {
  if (!p) return { amount: unavailable("Pembacaan belum tersedia"), expiry: unavailable("Pembacaan belum tersedia") };
  const d = branchId ? p.by_branch?.[branchId] ?? {} : p.by_dim;
  if ((d.incomplete ?? 0) > 0) return { amount: unavailable("Riwayat sebelum cutover PPN belum lengkap"), expiry: unavailable("Riwayat sebelum cutover PPN belum lengkap") };
  const LEDGERS = ["paid_not_delivered", "package_liability", "patient_balance", "booking_dp"];
  const parts = LEDGERS.map((k) => d[k] ?? 0);
  if (!parts.every(isInt)) return { amount: unavailable("Nilai tidak valid"), expiry: unavailable("Nilai tidak valid") };
  return { amount: value(parts.reduce((s, x) => s + x, 0)), expiry: value(d.packages_expiring_30 ?? 0) };
}

function k18(p: KpiPayload | null, branchId: string | null): OwnerSummaryData["k18"] {
  if (!p) return { state: "unavailable", reason: "Pembacaan belum tersedia" };
  const d = branchId ? p.by_branch?.[branchId] ?? {} : p.by_dim;
  return { belowMin: d.below_min ?? 0, expiring30: d.expiring ?? 0, countVariance: d.variance ?? 0 };
}

// A link exists only when a built page explains the value: no key at all otherwise (never an empty string standing in for "no link").
const withHref = <T extends object>(o: T, href: string | undefined): T & { href?: string } => (href ? { ...o, href } : o);

export function ownerSummary(i: SummaryInputs): OwnerSummaryData {
  const b = i.branchId;
  const h = i.hrefs;
  const c5 = k5(i.k5, b);
  const c4 = b ? k4Branch(i.k4, b) : k4Card(i.k4 ?? { total: null, by_dim: {} });
  const funnel = i.k13 ? funnelOf(i.k13, b, h.k13) : withHref({ state: "unavailable" as const, reason: "Pembacaan belum tersedia" }, h.k13);
  const trend = i.periods.weeks.map((w, n) => ({ label: weekLabel(w), k1: scoped(i.weeks[n]?.k1 ?? null, b), k2: scoped(i.weeks[n]?.k2 ?? null, b) }));
  return {
    attention: i.attention,
    k1: withHref({ amount: scoped(i.k1, b), previous: scoped(i.k1Prev, b) }, h.k1),
    k2: withHref({ amount: scoped(i.k2, b), previous: scoped(i.k2Prev, b) }, h.k2),
    k3: withHref({ amount: scoped(i.k3, b), previous: scoped(i.k3Prev, b) }, h.k3),
    k4: withHref(c4, h.k4),
    k5: withHref({ amount: c5.amount, packageExpiry30: c5.expiry }, h.k5),
    k6: withHref({ amount: scoped(i.k6, b) }, h.k6),
    k17: withHref({ amount: b ? (i.k17 ? k17ForBranch(i.k17, b) : unavailable("Pembacaan belum tersedia")) : i.k17 ? k17Owed(i.k17) : unavailable("Pembacaan belum tersedia") }, h.k17),
    k18: withHref(k18(i.k18, b), h.k18),
    trend,
    // Treatment mix needs verified treatment / category attribution; the reader splits K2 / K7 into treatment / product / consultation / session, which is
    // NOT a category mix. No invented mapping (Sol decision 3).
    mix: { state: "unavailable", reason: "Rincian per kategori perawatan belum tersedia: pembacaan hanya memisahkan perawatan, produk, konsultasi dan sesi paket" },
    funnel,
  };
}

// K4 for one branch, from the CONSOLIDATED answer: `by_branch[branch]` holds that branch's aging buckets (K4's dims are the buckets), and the branch's
// balance is their sum. Completeness is the whole answer's — an undated cancellation is evidence about the tenant, so one makes every branch incomplete.
function k4Branch(p: KpiPayload | null, branchId: string): ReturnType<typeof k4Card> {
  if (!p) return k4Card({ total: null, by_dim: {} });
  const buckets = p.by_branch?.[branchId] ?? {};
  const sum = Object.values(buckets).reduce((s, x) => s + (Number.isSafeInteger(x) ? x : Number.NaN), 0);
  return k4Card({ total: Object.keys(buckets).length === 0 ? null : sum, by_dim: buckets, extra: p.extra });
}

const FUNNEL_DIMS = ["lead", "booked", "arrived", "paid"] as const;
const bySourceUnavailable = (reason: string): FunnelSources => ({ state: "unavailable", reason });

// The funnel split by lead source (PR-33a "channel funnel"; Appendix A: K13 by source). Read from the same answer as the funnel above it, so the sources can be proved to add up to it:
// a group that is not an integer, a dimension this screen does not know, or sums that differ from the funnel make the whole breakdown unavailable — a breakdown of another
// population (a branch's funnel next to the clinic's sources) is worse than none. An empty `by_grp1` is a real "no leads".
export function sourcesOf(p: K13Payload, total: readonly number[]): FunnelSources {
  const g = p.by_grp1;
  if (!g || typeof g !== "object") return bySourceUnavailable("Rincian per sumber belum tersedia");
  const rows: { source: string; label: string; lead: number; booked: number; arrived: number; paid: number }[] = [];
  const sum = [0, 0, 0, 0];
  for (const [source, d] of Object.entries(g)) {
    if (!d || typeof d !== "object" || Object.keys(d).some((k) => !(FUNNEL_DIMS as readonly string[]).includes(k))) return bySourceUnavailable("Rincian per sumber belum dikenali");
    const v = FUNNEL_DIMS.map((k) => d[k] ?? 0);
    if (!v.every((n) => isInt(n) && n >= 0)) return bySourceUnavailable("Nilai tidak valid");
    v.forEach((n, i) => { sum[i] += n; });
    rows.push({ source, label: SOURCE[source] ?? source, lead: v[0], booked: v[1], arrived: v[2], paid: v[3] });
  }
  if (sum.some((n, i) => n !== total[i])) return bySourceUnavailable("Rincian per sumber tidak cocok dengan total funnel");
  rows.sort((a, b) => b.lead - a.lead || a.label.localeCompare(b.label, "id"));
  return { state: "rows", rows };
}

// One scope per answer. A branch view must be fed the answer the reader gave FOR THAT BRANCH (`p_branch`, validated against the branches the context lists); the clinic view the
// answer it gave for no branch. Anything else — notably the clinic's answer picked apart for one branch — is refused, never reused.
function funnelOf(p: K13Payload, branchId: string | null, href: string | undefined): OwnerSummaryData["funnel"] {
  if ((p.branch_id ?? null) !== branchId) return withHref({ state: "unavailable" as const, reason: "Funnel belum dibaca untuk cakupan ini" }, href);
  const v = FUNNEL_DIMS.map((k) => p.by_dim[k] ?? 0);
  if (!v.every((n) => isInt(n) && n >= 0)) return withHref({ state: "unavailable" as const, reason: "Nilai tidak valid" }, href);
  return withHref({ state: "value" as const, lead: v[0], booked: v[1], arrived: v[2], paid: v[3], sources: sourcesOf(p, v) }, href);
}
