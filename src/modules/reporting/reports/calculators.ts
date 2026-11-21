// Reference calculators for K20–K27 (PR-95, Appendix A). Pure functions over facts shaped like the rows the T-116 readers will return
// (one row per invoice / visit / shift / dispensing / promo usage / survey / examination / clinical request; no clinical text, no name).
// They are the executable definition: each SQL reader must equal these numbers on the same facts. Days are the branch's local date
// (YYYY-MM-DD, 02-PRD Appendix A: "periods in each branch's local day"); durations use instants (ISO with offset). Money is integer
// rupiah; a ratio keeps numerator and denominator; nothing unavailable becomes 0.
import { count, duration, median, money, type Metric, noData, ratio, roundHalfAway, sum } from "./metrics";

export type Period = { from: string; to: string }; // inclusive local days
export const inPeriod = (d: string, p: Period) => d >= p.from && d <= p.to;
const secs = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 1000);
function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
// Same calendar day n months earlier; a missing day clamps to the month's last day (31 Mar − 1 month = 28/29 Feb).
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
function group<T, K extends string>(xs: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}
const sorted = <K extends string, V>(m: Map<K, V>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

// ── sales facts (K3 basis shared by K20, K22, K23, K25) ──────────────────────────────────────────────────────────────────────────
// A sale line on an invoice: value = line total after discount, excl. VAT. Redemptions and top-ups are not sales (K20, K22).
export type SaleLine = { kind: "service" | "product" | "package" | "consultation" | "redemption" | "top_up"; value: number };
export type Invoice = { id: string; branch: string; patient: string; day: string; state: "issued" | "void"; shift: string | null; lines: SaleLine[] };
// A K3 reduction: a refunded sale value (cash or balance) in the refund's month, or a cancelled unpaid package remainder in the month
// of cancellation; attributed to the selling branch and the sale's patient.
export type SaleReduction = { invoice: string; branch: string; patient: string; day: string; amount: number; why: "refund" | "cancelled_unpaid_package" };
const SALE = new Set<SaleLine["kind"]>(["service", "product", "package", "consultation"]);
export const saleValue = (i: Invoice) => (i.state === "issued" ? sum(i.lines.filter((l) => SALE.has(l.kind)).map((l) => l.value)) : 0);
export function k3(invoices: readonly Invoice[], reductions: readonly SaleReduction[], p: Period, branch?: string): number {
  const b = (x: { branch: string }) => branch === undefined || x.branch === branch;
  return sum(invoices.filter((i) => b(i) && inPeriod(i.day, p)).map(saleValue)) - sum(reductions.filter((r) => b(r) && inPeriod(r.day, p)).map((r) => r.amount));
}

// K20 Rata-rata transaksi — K3 ÷ issued invoices with K3 > 0 in the period; rounded half away from zero to whole rupiah.
// Draft reading (marker on the entry): an invoice counts when its own sale value at issue is > 0; a later refund lowers the numerator in
// the refund period and never the count.
export function k20(invoices: readonly Invoice[], reductions: readonly SaleReduction[], p: Period, branch?: string) {
  const counted = invoices.filter((i) => (branch === undefined || i.branch === branch) && inPeriod(i.day, p) && saleValue(i) > 0);
  const k3v = k3(invoices, reductions, p, branch);
  return { k3: money(k3v), invoices: count(counted.length), average: counted.length === 0 ? noData : money(roundHalfAway(k3v / counted.length)) };
}

// ── K21 Churn ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Window: active = a visit in (asOf − 12 months, asOf]; churned = active and no visit in (asOf − dormantDays, asOf]. SET-22 dormant
// days (default 90, D-06; bounds 14–365) versions the definition. Attribution: the branch of the patient's last visit in the window.
export type VisitFact = { patient: string; branch: string; day: string };
export function k21(visits: readonly VisitFact[], asOf: string, dormantDays = 90) {
  if (!Number.isInteger(dormantDays) || dormantDays < 14 || dormantDays > 365) throw new RangeError("SET-22 dormant days must be 14–365");
  const yearStart = addMonths(asOf, -12), dormantStart = addDays(asOf, -dormantDays);
  const last = new Map<string, VisitFact>();
  for (const v of visits) {
    if (v.day <= yearStart || v.day > asOf) continue;
    const prev = last.get(v.patient);
    if (!prev || v.day > prev.day || (v.day === prev.day && v.branch > prev.branch)) last.set(v.patient, v);
  }
  const active = [...last.values()];
  const churned = active.filter((v) => v.day <= dormantStart);
  const byBranch = sorted(group(active, (v) => v.branch)).map(([branch, xs]) => ({
    branch, churn: ratio(xs.filter((v) => v.day <= dormantStart).length, xs.length),
  }));
  return { churn: ratio(churned.length, active.length), active: count(active.length), churned: count(churned.length), byBranch, dormantDays };
}

// ── K22 Pasien teratas / LTV ──────────────────────────────────────────────────────────────────────────────────────────────────
// Cumulative K3 per patient up to asOf (every sale of the patient — the first sale cannot precede the first visit except a counter
// sale, which K3 also counts); net of reductions; redemptions and top-ups are not sales; a package is attributed to its owner (the
// invoice patient), so a family member's redemption never moves value. Ties: patient id ascending.
export function k22(invoices: readonly Invoice[], reductions: readonly SaleReduction[], asOf: string, top = 10) {
  const total = new Map<string, number>();
  const byBranch = new Map<string, Map<string, number>>();
  const add = (patient: string, branch: string, v: number) => {
    total.set(patient, (total.get(patient) ?? 0) + v);
    const b = byBranch.get(patient) ?? new Map<string, number>();
    b.set(branch, (b.get(branch) ?? 0) + v);
    byBranch.set(patient, b);
  };
  for (const i of invoices) if (i.day <= asOf && saleValue(i) !== 0) add(i.patient, i.branch, saleValue(i));
  for (const r of reductions) if (r.day <= asOf) add(r.patient, r.branch, -r.amount);
  const rows = [...total.entries()]
    .sort(([pa, a], [pb, b]) => b - a || (pa < pb ? -1 : 1))
    .slice(0, top)
    .map(([patient, ltv]) => ({ patient, ltv: money(ltv), byBranch: sorted(byBranch.get(patient)!).map(([branch, v]) => ({ branch, value: money(v) })) }));
  return { rows };
}

// ── K23 Penjualan dan uang masuk per shift ─────────────────────────────────────────────────────────────────────────────────────
// K3 of invoices issued in the shift (sale value at issue) beside K1 received in the shift (payments, not balance use or simulated,
// − cash refunds paid in the shift). Draft (marker): reductions are not allocated to a shift; facts without a shift are one
// "tanpa shift" row so nothing disappears. A shift is a row when it OPENED in the period or carries an in-period fact (an overnight
// shift opened the day before, R3 161ff9b9 F1) — each shift once, so every in-period fact counts exactly once. `day` is the opening day.
export type ShiftFact = { id: string; branch: string; day: string };
export type PaymentFact = { branch: string; day: string; shift: string | null; amount: number; method: "cash" | "transfer" | "qris" | "edc" | "balance"; simulated: boolean };
export type CashRefundFact = { branch: string; day: string; shift: string | null; amount: number };
export function k23(shifts: readonly ShiftFact[], invoices: readonly Invoice[], payments: readonly PaymentFact[], refunds: readonly CashRefundFact[], p: Period) {
  const row = (shift: string | null, branch: string) => {
    const k3v = sum(invoices.filter((i) => i.shift === shift && i.branch === branch && inPeriod(i.day, p)).map(saleValue));
    const k1v = sum(payments.filter((x) => x.shift === shift && x.branch === branch && inPeriod(x.day, p) && x.method !== "balance" && !x.simulated).map((x) => x.amount))
      - sum(refunds.filter((x) => x.shift === shift && x.branch === branch && inPeriod(x.day, p)).map((x) => x.amount));
    return { shift, branch, k3: money(k3v), k1: money(k1v) };
  };
  const active = new Set([...invoices, ...payments, ...refunds].filter((x) => x.shift !== null && inPeriod(x.day, p)).map((x) => x.shift));
  const rows = [...new Map(shifts.filter((s) => inPeriod(s.day, p) || active.has(s.id)).map((s) => [s.id, s] as const)).values()]
    .sort((a, b) => (a.day + a.id < b.day + b.id ? -1 : 1)).map((s) => row(s.id, s.branch));
  const loose = new Set([...invoices, ...payments, ...refunds].filter((x) => x.shift === null && inPeriod(x.day, p)).map((x) => x.branch));
  return { rows: [...rows, ...[...loose].sort().map((b) => row(null, b))] };
}

// ── K24 Waktu tunggu apotek ───────────────────────────────────────────────────────────────────────────────────────────────────
// Median (handed_at − queued_at) over dispensings handed in the period (by the hand-over's local day); cancelled and not yet handed
// are excluded.
export type DispensingFact = { branch: string; state: "queued" | "prepared" | "handed" | "cancelled"; queuedAt: string; handedAt: string | null; handedDay: string | null };
export function k24(ds: readonly DispensingFact[], p: Period, branch?: string): Metric {
  const waits = ds.filter((d) => d.state === "handed" && d.handedAt && d.handedDay && inPeriod(d.handedDay, p) && (branch === undefined || d.branch === branch))
    .map((d) => secs(d.queuedAt, d.handedAt!));
  return duration(median(waits));
}

// ── K25 Performa kode promo ───────────────────────────────────────────────────────────────────────────────────────────────────
// Per code version: consumed uses (reserved and released excluded), discount value, and K3 of the lines with the code (line value
// after discount, excl. VAT) less the refunded value of those lines in the period. Selling branch; period by the consumption day.
export type PromoUsageFact = { promo: string; version: string; branch: string; state: "reserved" | "consumed" | "released"; day: string | null; discount: number; lineValue: number; refundedInPeriod: number };
export function k25(us: readonly PromoUsageFact[], p: Period) {
  const used = us.filter((u) => u.state === "consumed" && u.day !== null && inPeriod(u.day, p));
  return sorted(group(used, (u) => `${u.promo}|${u.version}`)).map(([, xs]) => ({
    promo: xs[0].promo, version: xs[0].version, uses: count(xs.length), discount: money(sum(xs.map((x) => x.discount))),
    k3: money(sum(xs.map((x) => x.lineValue - x.refundedInPeriod))),
  }));
}

// ── K26 Kepuasan ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Average score (1–5) as hundredths, rounded half away from zero; share of scores ≤ 2. Visit branch, survey day.
export type SurveyFact = { branch: string; day: string; score: number };
export function k26(ss: readonly SurveyFact[], p: Period, branch?: string) {
  const xs = ss.filter((s) => inPeriod(s.day, p) && (branch === undefined || s.branch === branch));
  if (xs.some((s) => !Number.isInteger(s.score) || s.score < 1 || s.score > 5)) throw new RangeError("survey score must be 1–5");
  const average: Metric = xs.length === 0 ? noData : { kind: "score", hundredths: roundHalfAway((sum(xs.map((s) => s.score)) * 100) / xs.length) };
  return { average, low: ratio(xs.filter((s) => s.score <= 2).length, xs.length), responses: count(xs.length) };
}

// ── K27 Aktivitas dokter ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Per doctor: examinations signed in the period; unsigned (draft) examinations older than 24 h at `asOf`; clinical requests decided
// (approved or declined) in the period; median minutes from the visit's check-in to the signature for the examinations signed in the
// period. Visit branch. Counts and times only — never record content.
export type ExamFact = { doctor: string; branch: string; state: "draft" | "signed"; createdAt: string; signedAt: string | null; signedDay: string | null; checkedInAt: string };
export type RequestFact = { doctor: string | null; branch: string; state: "pending" | "approved" | "declined" | "cancelled"; decidedDay: string | null };
export function k27(exams: readonly ExamFact[], requests: readonly RequestFact[], p: Period, asOf: string) {
  const doctors = new Set<string>([...exams.map((e) => e.doctor), ...requests.flatMap((r) => (r.doctor ? [r.doctor] : []))]);
  const limit = Date.parse(asOf) - 24 * 3600 * 1000;
  return [...doctors].sort().map((doctor) => {
    const signed = exams.filter((e) => e.doctor === doctor && e.state === "signed" && e.signedDay && inPeriod(e.signedDay, p));
    const unsigned = exams.filter((e) => e.doctor === doctor && e.state === "draft" && Date.parse(e.createdAt) < limit);
    const decided = requests.filter((r) => r.doctor === doctor && (r.state === "approved" || r.state === "declined") && r.decidedDay && inPeriod(r.decidedDay, p));
    const m = median(signed.map((e) => secs(e.checkedInAt, e.signedAt!)));
    return { doctor, signed: count(signed.length), unsignedOver24h: count(unsigned.length), requestsDecided: count(decided.length), checkInToSignature: duration(m) };
  });
}
