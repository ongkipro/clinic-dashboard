// Jadwal segments, pure (HYG-NAV-2; 19 §2.3): status filters of Daftar Reservasi, the Booking Online Masuk queue and the Daftar Tunggu
// grouping. No database, no Next.js: tests/ui/hyg-nav-2.test.ts runs these. Row writes stay on /jadwal (the day view's RowActions), so the
// lists link there ("Kelola") instead of duplicating the actions.
import type { AppointmentState, CalendarRow } from "../../../../modules/scheduling/appointments/appointments";
import type { WaitlistRow } from "../../../../modules/scheduling/waitlist/waitlist";

// 19 §2.3 "Status: dibuat, dikonfirmasi, datang, … tidak datang, batal, dijadwal ulang" over the stored states (0062). "Menunggu DP" (held)
// counts as dibuat. In-treatment and finished are visit states (Hari Ini), not appointment states.
export const STATUS_FILTERS = [
  { id: "semua", label: "Semua", states: null },
  { id: "dibuat", label: "Dibuat", states: ["held", "booked"] },
  { id: "dikonfirmasi", label: "Dikonfirmasi", states: ["confirmed"] },
  { id: "datang", label: "Datang", states: ["arrived"] },
  { id: "tidak-datang", label: "Tidak Datang", states: ["no_show"] },
  { id: "batal", label: "Batal", states: ["cancelled"] },
  { id: "dijadwal-ulang", label: "Dijadwal Ulang", states: ["rescheduled"] },
] as const satisfies readonly { id: string; label: string; states: readonly AppointmentState[] | null }[];
export type StatusId = (typeof STATUS_FILTERS)[number]["id"];
export const parseStatus = (v: unknown): StatusId => (STATUS_FILTERS.find((f) => f.id === v)?.id ?? "semua");

const byStart = (a: CalendarRow, b: CalendarRow) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : 1);

export function filterReservations(rows: readonly CalendarRow[], status: StatusId): CalendarRow[] {
  const f = STATUS_FILTERS.find((x) => x.id === status)!;
  return rows.filter((r) => f.states === null || (f.states as readonly string[]).includes(r.state)).sort(byStart);
}
export const countByStatus = (rows: readonly CalendarRow[]) =>
  Object.fromEntries(STATUS_FILTERS.map((f) => [f.id, filterReservations(rows, f.id).length])) as Record<StatusId, number>;

// Booking Online Masuk: online bookings not yet confirmed (held: waiting for the DP; booked: waiting for confirmation), soonest first.
export const ONLINE_WAITING: readonly AppointmentState[] = ["held", "booked"];
export const onlineQueue = (rows: readonly CalendarRow[]) => rows.filter((r) => r.channel === "online" && ONLINE_WAITING.includes(r.state)).sort(byStart);

// Daftar Tunggu: entries per service, offered first then waiting, oldest first within each (the order the desk calls them).
export type WaitGroup = { itemId: string; rows: WaitlistRow[] };
export function waitlistGroups(rows: readonly WaitlistRow[]): WaitGroup[] {
  const m = new Map<string, WaitlistRow[]>();
  for (const r of rows) m.set(r.item_id, [...(m.get(r.item_id) ?? []), r]);
  const rank = (r: WaitlistRow) => (r.state === "offered" ? 0 : 1);
  return [...m.entries()]
    .map(([itemId, xs]) => ({ itemId, rows: xs.sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.rows[0].created_at.localeCompare(b.rows[0].created_at) || a.itemId.localeCompare(b.itemId));
}

// One state at a time (10 State Copy Patterns): nothing at all → empty; something, but not for this filter → filtered-empty.
export type ListState = "empty" | "filtered-empty" | "rows";
export const listState = (total: number, shown: number): ListState => (total === 0 ? "empty" : shown === 0 ? "filtered-empty" : "rows");

// The day view on /jadwal that manages one appointment.
export const manageHref = (branchId: string, date: string) => `/jadwal?${new URLSearchParams({ cabang: branchId, tampilan: "hari", tanggal: date })}`;
