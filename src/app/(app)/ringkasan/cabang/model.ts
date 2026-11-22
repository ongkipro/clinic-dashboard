// Ringkasan Cabang view model (UX-21, PR-33b, 19:34; T-110 presentational slice). Pure: no database, no Next.js server API.
// The manager sees one branch: the active one (scopeFor); a `?cabang=` request is never honoured. The T-107 reader is not
// wired yet: it is expected to return BranchSummaryInput (jsonb, snake_case) for that branch, and projectSummary keeps only
// the allowlisted keys below, so a reader that returned more (patient names, phones, diagnosis, notes) renders none of it
// (PR-33, SEC-2). A value the reader cannot give stays "unavailable" and is never shown as 0 or Rp0.
import { type Role, ROLES } from "../../../../auth/policy";

export const ROUTE = "/ringkasan/cabang";
export const VIEWERS: readonly Role[] = ["manager"];

export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- metrics -------------------------------------------------------------------------------------------------------------
export type Unavailable = "reader_pending" | "no_roster" | "no_target" | "invalid";
export type Metric = { kind: "count"; value: number } | { kind: "money"; rupiah: number } | { kind: "unavailable"; reason: Unavailable };
const pending: Metric = { kind: "unavailable", reason: "reader_pending" };
const invalid: Metric = { kind: "unavailable", reason: "invalid" };

// jsonb numbers arrive as numbers; a bigint sum may arrive as a digit string. null / absent = the reader cannot give it yet.
function int(v: unknown): number | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  const n = typeof v === "string" && /^-?\d{1,16}$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : NaN;
}
export function count(v: unknown): Metric {
  const n = int(v);
  if (n === undefined || n === null) return pending;
  return Number.isNaN(n) || n < 0 ? invalid : { kind: "count", value: n };
}
// Integer rupiah only (no float, AGENTS.md); may be negative (K17 after adjustments).
export function money(v: unknown): Metric {
  const n = int(v);
  if (n === undefined || n === null) return pending;
  return Number.isNaN(n) ? invalid : { kind: "money", rupiah: n };
}
const qty = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null);

export const UNAVAILABLE_COPY: Record<Unavailable, string> = {
  reader_pending: "Belum tersedia",
  no_roster: "Tidak ada jadwal",
  no_target: "Target belum diatur",
  invalid: "Data tidak valid",
};
const nf = new Intl.NumberFormat("id-ID");
const qf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
export const rupiah = (n: number) => `${n < 0 ? "−" : ""}Rp${nf.format(Math.abs(n))}`;
export function show(m: Metric): string {
  if (m.kind === "count") return nf.format(m.value);
  if (m.kind === "money") return rupiah(m.rupiah);
  return UNAVAILABLE_COPY[m.reason];
}
export const quantity = (n: number) => qf.format(n);

// ---- scope (PR-33b: one branch, the manager's active branch) -------------------------------------------------------------
export type Branch = { id: string; name: string };
export type Viewer = { role: Role; activeBranchId: string | null; branches: readonly Branch[] };
export type Scope = { kind: "ok"; branch: Branch } | { kind: "permission" } | { kind: "no-branch" };
export function scopeFor(v: Viewer): Scope {
  if (!VIEWERS.includes(v.role)) return { kind: "permission" };
  const branch = v.activeBranchId ? v.branches.find((b) => b.id === v.activeBranchId) : undefined;
  return branch ? { kind: "ok", branch } : { kind: "no-branch" };
}

// ---- drill-down targets (existing routes a manager may open; the staff target link is omitted until /staf/target exists) --
const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
export function drill(today: string) {
  const tomorrow = addDay(today);
  return {
    today: "/hari-ini",
    unpaid: "/hari-ini?tampilan=belum-bayar",
    waiting: "/hari-ini?tampilan=menunggu",
    queue: "/antrean",
    receivables: "/piutang",
    noShows: `/jadwal?tampilan=hari&tanggal=${today}`,
    rooms: `/jadwal?tampilan=hari&tanggal=${today}`,
    approvals: "/persetujuan",
    complaints: "/keluhan",
    rosterToday: "/jadwal-staf",
    tomorrow: `/jadwal?tampilan=hari&tanggal=${tomorrow}`,
    leave: "/jadwal-staf",
    item: (id: string) => `/stok/item/${id}`,
    reorder: "/pembelian/po",
    expiring: "/stok/batch",
    variance: "/stok/opname",
    staff: undefined as string | undefined, // Panel 2 decision 3: no /staf/target link until DEC-100 builds the page
  };
}

// ---- summary --------------------------------------------------------------------------------------------------------------
export type Tile = { key: string; label: string; metric: Metric; href: string };
export type Rows<T> = { kind: "rows"; rows: T[] } | { kind: "unavailable"; reason: Unavailable };
export type HourRow = { hour: number; booked: number; arrived: number };
export type GapRow = { staffId: string; name: string; bookedMin: number; rosteredMin: number };
export type StockRow = { itemId: string; name: string; onHand: number; minQty: number; unit: string };
export type K19 = { kind: "target"; closing: number; target: number } | { kind: "unavailable"; reason: Unavailable } | null; // null: not a BC
export type StaffRow = { staffId: string; name: string; role: Role; completions: Metric; k17: Metric; k19: K19 };
export type BranchSummary = {
  branch: Branch;
  today: string;
  tomorrow: string;
  waitMinutes: number | null; // SET-38 (default 20); null = not given
  chase: Tile[]; // Perlu Ditangani: a zero is hidden, an unavailable value stays visible
  todayTiles: Tile[];
  hours: Rows<HourRow>;
  tomorrowTiles: Tile[];
  gaps: Rows<GapRow>;
  stockTiles: Tile[];
  below: Rows<StockRow>;
  staff: Rows<StaffRow>;
};

function rows<T>(v: unknown, row: (r: Record<string, unknown>) => T | null): Rows<T> {
  if (v === undefined || v === null) return { kind: "unavailable", reason: "reader_pending" };
  if (!Array.isArray(v)) return { kind: "unavailable", reason: "invalid" };
  const out: T[] = [];
  for (const r of v) {
    const t = r && typeof r === "object" ? row(r as Record<string, unknown>) : null;
    if (t === null) return { kind: "unavailable", reason: "invalid" }; // one bad row: the list is not trusted
    out.push(t);
  }
  return { kind: "rows", rows: out };
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nonNeg = (v: unknown) => { const m = count(v); return m.kind === "count" ? m.value : null; };

function k19(v: unknown, role: Role): K19 {
  if (role !== "bc") return null;
  if (v === undefined || v === null) return { kind: "unavailable", reason: "reader_pending" };
  const o = obj(v);
  const closing = money(o.closing_rupiah), target = money(o.target_rupiah);
  if (closing.kind !== "money" || target.kind !== "money") return { kind: "unavailable", reason: closing.kind === "unavailable" && closing.reason === "reader_pending" ? "reader_pending" : "invalid" };
  if (target.rupiah <= 0) return { kind: "unavailable", reason: "no_target" };
  return { kind: "target", closing: closing.rupiah, target: target.rupiah };
}

export type Projection = { kind: "ok"; summary: BranchSummary } | { kind: "mismatch" } | { kind: "invalid" };

// Allowlist projection of the reader payload. Keys not named here are dropped; the branch must be the scoped one.
export function projectSummary(raw: unknown, branch: Branch): Projection {
  const p = obj(raw);
  if (p.branch_id !== branch.id) return { kind: "mismatch" };
  const today = typeof p.today === "string" && DATE.test(p.today) && !Number.isNaN(Date.parse(p.today)) ? p.today : null;
  if (!today) return { kind: "invalid" };
  const d = drill(today);
  const c = obj(p.chase), t = obj(p.today_counts), tm = obj(p.tomorrow), s = obj(p.stock);
  const wait = nonNeg(p.wait_minutes);
  return {
    kind: "ok",
    summary: {
      branch,
      today,
      tomorrow: addDay(today),
      waitMinutes: wait,
      chase: [
        { key: "unpaid_bills", label: "Tagihan belum dibayar", metric: count(c.unpaid_bills), href: d.unpaid },
        { key: "unpaid_additions", label: "Tindakan Tambahan belum dibayar", metric: count(c.unpaid_additions), href: d.unpaid },
        { key: "receivables_due", label: "Piutang Pasien jatuh tempo", metric: count(c.receivables_due), href: d.receivables },
        { key: "no_shows", label: "Tidak datang, perlu dijadwalkan ulang", metric: count(c.no_shows_to_rebook), href: d.noShows },
        { key: "waiting_long", label: wait === null ? "Pasien menunggu terlalu lama" : `Menunggu lebih dari ${wait} menit`, metric: count(c.waiting_long), href: d.waiting },
        { key: "approvals", label: "Menunggu persetujuan", metric: count(c.approvals), href: d.approvals },
        { key: "complaints", label: "Keluhan terbuka", metric: count(c.complaints), href: d.complaints },
      ],
      todayTiles: [
        { key: "appointments", label: "Janji hari ini", metric: count(t.appointments), href: d.today },
        { key: "arrived", label: "Sudah datang", metric: count(t.arrived), href: d.queue },
        { key: "in_treatment", label: "Dalam tindakan", metric: count(t.in_treatment), href: d.today },
        { key: "waiting_payment", label: "Menunggu pembayaran", metric: count(t.waiting_payment), href: d.unpaid },
        { key: "no_shows", label: "Tidak datang", metric: count(t.no_shows), href: d.noShows },
        { key: "rooms_in_use", label: "Ruang Tindakan terpakai", metric: count(t.rooms_in_use), href: d.rooms },
        { key: "devices_in_use", label: "Alat terpakai", metric: count(t.devices_in_use), href: d.rooms },
        { key: "staff_on_duty", label: "Staf bertugas", metric: count(t.staff_on_duty), href: d.rosterToday },
      ],
      hours: rows(p.hours, (r) => {
        const hour = nonNeg(r.hour), booked = nonNeg(r.booked), arrived = nonNeg(r.arrived);
        return hour !== null && hour <= 23 && booked !== null && arrived !== null ? { hour, booked, arrived } : null;
      }),
      tomorrowTiles: [
        { key: "appointments", label: "Janji besok", metric: count(tm.appointments), href: d.tomorrow },
        { key: "leave_conflicts", label: "Bentrok dengan cuti", metric: count(tm.leave_conflicts), href: d.leave },
      ],
      gaps: rows(tm.gaps, (r) => {
        const name = text(r.name, 120), b = nonNeg(r.booked_minutes), ro = nonNeg(r.rostered_minutes);
        return typeof r.staff_id === "string" && UUID.test(r.staff_id) && name && b !== null && ro !== null
          ? { staffId: r.staff_id, name, bookedMin: b, rosteredMin: ro } : null;
      }),
      stockTiles: [
        { key: "expiring", label: "Batch kedaluwarsa ≤ 30 hari", metric: count(s.expiring_30d), href: d.expiring },
        { key: "variance", label: "Selisih hitung stok", metric: count(s.count_variance), href: d.variance },
        { key: "pending_po", label: "PO belum diterima", metric: count(s.pending_po), href: d.reorder },
      ],
      below: rows(s.below_min, (r) => {
        const name = text(r.name, 120), unit = text(r.unit, 20), onHand = qty(r.on_hand), minQty = qty(r.min_qty);
        return typeof r.item_id === "string" && UUID.test(r.item_id) && name && unit && onHand !== null && minQty !== null
          ? { itemId: r.item_id, name, onHand, minQty, unit } : null;
      }),
      staff: rows(p.staff, (r) => {
        const name = text(r.name, 120);
        if (typeof r.staff_id !== "string" || !UUID.test(r.staff_id) || !name || !isRole(r.role)) return null;
        return { staffId: r.staff_id, name, role: r.role, completions: count(r.completions), k17: money(r.k17_rupiah), k19: k19(r.k19, r.role) };
      }),
    },
  };
}

// K15 for one performer tomorrow: share of rostered minutes booked, and the open minutes.
export function utilization(g: GapRow): { kind: "ok"; percent: number; openMin: number } | { kind: "unavailable"; reason: Unavailable } {
  if (g.rosteredMin === 0) return { kind: "unavailable", reason: "no_roster" };
  return { kind: "ok", percent: Math.round((g.bookedMin * 100) / g.rosteredMin), openMin: Math.max(0, g.rosteredMin - g.bookedMin) };
}

// ---- page state ----------------------------------------------------------------------------------------------------------
export type Filter = "semua" | "perlu";
export const parseFilter = (v: unknown): Filter => (v === "perlu" ? "perlu" : "semua");
export const filterHref = (f: Filter) => (f === "semua" ? ROUTE : `${ROUTE}?tampilan=perlu`);

// Perlu Ditangani hides a zero (UX-20 contract, same component) but keeps an unavailable value visible.
export const visibleChase = (s: BranchSummary) => s.chase.filter((c) => c.metric.kind !== "count" || c.metric.value > 0);

function isEmpty(s: BranchSummary): boolean {
  const metrics = [...s.chase, ...s.todayTiles, ...s.tomorrowTiles, ...s.stockTiles].map((x) => x.metric);
  const lists = [s.hours, s.gaps, s.below, s.staff];
  return metrics.every((m) => m.kind === "count" && m.value === 0) && lists.every((l) => l.kind === "rows" && l.rows.length === 0);
}

export type ViewState =
  | { kind: "loading" }
  | { kind: "permission" }
  | { kind: "no-branch" }
  | { kind: "error" }
  | { kind: "empty"; summary: BranchSummary }
  | { kind: "filtered-empty"; summary: BranchSummary }
  | { kind: "ok"; summary: BranchSummary; filter: Filter };

export function resolveView(i: { viewer: Viewer; filter: Filter; read: { ok: true; raw: unknown } | { ok: false } }): ViewState {
  const scope = scopeFor(i.viewer);
  if (scope.kind !== "ok") return { kind: scope.kind };
  if (!i.read.ok) return { kind: "error" };
  const p = projectSummary(i.read.raw, scope.branch);
  if (p.kind === "mismatch") return { kind: "permission" }; // another branch's figures are never shown
  if (p.kind === "invalid") return { kind: "error" };
  if (isEmpty(p.summary)) return { kind: "empty", summary: p.summary };
  if (i.filter === "perlu" && visibleChase(p.summary).length === 0) return { kind: "filtered-empty", summary: p.summary };
  return { kind: "ok", summary: p.summary, filter: i.filter };
}
