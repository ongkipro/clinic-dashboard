// Ringkasan Owner (UX-20 / UX-37), T-109: the report periods, pure arithmetic on calendar-date strings (YYYY-MM-DD) — no maths on instants, so the
// reader's branch-local dates are never shifted. "Today" is the clinic's WIB date, as the other finance pages use. The comparison period is the
// tenant's OWN previous period over the SAME number of elapsed days (D-11; no external benchmark): a week-to-date is never set against a full week.
export type Win = { from: string; to: string };
export const addDays = (d: string, n: number): string => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export const monday = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
export const wibToday = (now: Date = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const previousMonthStart = (d: string) => monthStart(addDays(monthStart(d), -1));

export type PeriodKind = "minggu" | "bulan";
export type Periods = { kind: PeriodKind; cur: Win; prev: Win; label: string; previousLabel: string; basis: string; weeks: Win[] };
export const WEEKS = 8; // the K1 / K2 trend: this calendar week and the seven before it (bounded: 2 reader calls per week)
export const BASIS = "Tanggal bayar dan tanggal layanan, hari setempat cabang";

export const parseKind = (v: unknown): PeriodKind => (v === "bulan" ? "bulan" : "minggu");

export function periods(kind: PeriodKind, today: string): Periods {
  const weeks: Win[] = Array.from({ length: WEEKS }, (_, i) => {
    const from = addDays(monday(today), -7 * (WEEKS - 1 - i));
    return { from, to: i === WEEKS - 1 ? today : addDays(from, 6) };
  });
  if (kind === "minggu") {
    const from = monday(today);
    const prevFrom = addDays(from, -7);
    return { kind, cur: { from, to: today }, prev: { from: prevFrom, to: addDays(prevFrom, daysBetween(from, today)) }, weeks,
      label: "Minggu ini", previousLabel: "minggu lalu pada hari yang sama", basis: BASIS };
  }
  const from = monthStart(today);
  const prevFrom = previousMonthStart(today);
  const lastDayOfPrev = addDays(from, -1);
  const same = addDays(prevFrom, daysBetween(from, today)); // 31 March vs February: capped at the previous month's last day
  return { kind, cur: { from, to: today }, prev: { from: prevFrom, to: same > lastDayOfPrev ? lastDayOfPrev : same }, weeks,
    label: "Bulan ini", previousLabel: "bulan lalu pada tanggal yang sama", basis: BASIS };
}

const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
export const dayLabel = (d: string) => fmt.format(new Date(`${d}T12:00:00Z`));
export const weekLabel = (w: Win) => (w.from === w.to ? dayLabel(w.from) : `${dayLabel(w.from)}–${dayLabel(w.to)}`);
