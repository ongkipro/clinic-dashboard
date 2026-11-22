// Ringkasan Cabang reader wiring (UX-21, PR-33b; T-110 slice 2). Builds the payload projectSummary reads for ONE branch from the existing
// granted readers only — no SQL of its own, no new definer:
//   appointments_window (0062, via calendar()) → today's counts and per-hour rows, tomorrow's appointments
//   dashboard_kpi k15 (T-107)    → tomorrow's per-performer booked ÷ rostered minutes (K15 gaps)
//   dashboard_kpi k18 (T-107)    → batches expiring (dated today), count variance this month (K18)
//   stock_item_list (0077)       → items below their branch minimum (Scenario PR-33b, with Buat PO)
//   po_list (0084)               → POs sent but not fully received
//   complaint_list (0074)        → open complaints the manager handles (layanan, by complaint_readable; a count only)
//   target_list (0103)           → staff of the branch: completions, K19 for BCs with a target (branch closing value)
// Every reader enforces the actor's own scope: a manager naming a branch other than its active one is refused by the reader
// (ERR_NOT_FOUND / ERR_FORBIDDEN) and the refusal propagates — no payload is ever built for another branch. A field no existing reader
// gives is left out, so the view shows "Belum tersedia", never 0 / Rp0 (see MISSING). A reader that refuses this role for one widget
// leaves that widget unavailable; the others still read (savepoint per reader).
import type pg from "pg";
import { CommandError } from "../../../../lib/command";
import { kpi } from "../../../../modules/reporting/dashboards/dashboards";
import { listTargets } from "../../../../modules/commission/targets/targets";
import { listItems } from "../../../../modules/inventory/stock";
import { listPurchaseOrders } from "../../../../modules/purchasing/payables/payables";
import { listComplaints } from "../../../../modules/clinical/complaints/complaints";
import { calendar } from "../../../../modules/scheduling/appointments/appointments";

// Fields with no existing reader for one branch today (the exact next scope; left absent → "Belum tersedia").
export const MISSING = [
  "chase.unpaid_bills", "chase.unpaid_additions", "chase.receivables_due", "chase.no_shows_to_rebook", "chase.waiting_long", "chase.approvals",
  "today_counts.in_treatment", "today_counts.waiting_payment", "today_counts.rooms_in_use", "today_counts.devices_in_use", "today_counts.staff_on_duty",
  "tomorrow.leave_conflicts", "wait_minutes", "staff[].k17_rupiah",
] as const;

type Raw = Record<string, unknown>;
const OPEN_PO = new Set(["sent", "partially_received"]);
const ON_BOOK = new Set(["booked", "confirmed", "arrived", "no_show"]); // held, cancelled and rescheduled are not on the day's book

// One reader under a savepoint: a refusal of this widget for the role leaves it out; a branch outside scope still throws.
async function part<T>(db: pg.ClientBase, fn: () => Promise<T>): Promise<T | undefined> {
  await db.query("savepoint ringkasan_cabang");
  try {
    const r = await fn();
    await db.query("release savepoint ringkasan_cabang");
    return r;
  } catch (e) {
    await db.query("rollback to savepoint ringkasan_cabang");
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return undefined;
    throw e;
  }
}

const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function readBranchSummary(db: pg.ClientBase, branchId: string): Promise<Raw> {
  // the branch's local day (branches is readable to every tenant member; an id of another tenant reads nothing → not found)
  const b = (await db.query<{ tz: string; today: string }>(
    `select timezone tz, to_char((clock_timestamp() at time zone timezone)::date, 'YYYY-MM-DD') today from branches where id = $1`, [branchId])).rows[0];
  if (!b) throw new CommandError("ERR_NOT_FOUND");
  const today = b.today, tomorrow = addDay(today, 1), monthFrom = `${today.slice(0, 7)}-01`;
  const hourOf = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: b.tz });

  const win = await part(db, () => calendar(db, branchId, today, tomorrow));
  const k15 = await part(db, () => kpi(db, { kpi: "k15", from: tomorrow, to: tomorrow, branchId, detail: true }));
  const k18 = await part(db, () => kpi(db, { kpi: "k18", from: monthFrom, to: today, branchId }));
  const items = await part(db, () => listItems(db, branchId));
  const pos = await part(db, () => listPurchaseOrders(db, branchId));
  const complaints = await part(db, () => listComplaints(db, branchId, null));
  const targets = await part(db, () => listTargets(db, { period: today.slice(0, 7), branchId }));

  const out: Raw = { branch_id: branchId, today };
  const chase: Raw = {};
  if (complaints) chase.complaints = complaints.tasks.filter((t) => t.state !== "resolved").length;
  out.chase = chase;

  const todayCounts: Raw = {};
  const tm: Raw = {};
  if (win) {
    const day = (t: Date) => t.toLocaleDateString("en-CA", { timeZone: b.tz });
    const todays = win.appointments.filter((a) => ON_BOOK.has(a.state) && day(a.startsAt) === today);
    todayCounts.appointments = todays.length;
    todayCounts.arrived = todays.filter((a) => a.state === "arrived").length;
    todayCounts.no_shows = todays.filter((a) => a.state === "no_show").length;
    const hours = new Map<number, { booked: number; arrived: number }>();
    for (const a of todays) {
      const h = Number(hourOf.format(a.startsAt));
      const x = hours.get(h) ?? { booked: 0, arrived: 0 };
      x.booked++; if (a.state === "arrived") x.arrived++;
      hours.set(h, x);
    }
    out.hours = [...hours.entries()].sort(([a], [c]) => a - c).map(([hour, x]) => ({ hour, ...x }));
    tm.appointments = win.appointments.filter((a) => (a.state === "booked" || a.state === "confirmed") && day(a.startsAt) === tomorrow).length;
  }
  out.today_counts = todayCounts;

  if (k15) {
    const per = new Map<string, { booked: number; rostered: number }>();
    for (const r of k15.rows ?? []) {
      if (!r.grp1) continue;
      const x = per.get(r.grp1) ?? { booked: 0, rostered: 0 };
      if (r.dim === "covered") x.booked += Number(r.amount); else if (r.dim === "rostered") x.rostered += Number(r.amount);
      per.set(r.grp1, x);
    }
    const ids = [...per.keys()];
    const names = new Map(ids.length ? (await db.query<{ id: string; name: string }>(`select id, display_name name from staff where id = any($1)`, [ids])).rows.map((r) => [r.id, r.name]) : []);
    // a performer whose name this role cannot read is never listed unnamed: the list is left out (unavailable) instead
    if (ids.every((id) => names.has(id))) {
      tm.gaps = ids.map((id) => ({ staff_id: id, name: names.get(id), booked_minutes: per.get(id)!.booked, rostered_minutes: per.get(id)!.rostered }))
        .sort((a, c) => String(a.name).localeCompare(String(c.name), "id") || a.staff_id.localeCompare(c.staff_id));
    }
  }
  out.tomorrow = tm;

  const stock: Raw = {};
  if (k18) {
    stock.expiring_30d = Number(k18.by_dim.expiring ?? 0);
    stock.count_variance = Number(k18.by_dim.variance ?? 0);
  }
  if (pos) stock.pending_po = pos.filter((p) => OPEN_PO.has(p.state)).length;
  if (items) {
    stock.below_min = items.filter((i) => i.active && i.low && i.min_qty !== null)
      .map((i) => ({ item_id: i.id, name: i.name, on_hand: Number(i.fit_quantity), min_qty: Number(i.min_qty), unit: i.unit }));
  }
  out.stock = stock;

  if (targets) {
    // staff assigned to this branch in an own-target role; K19 only for a BC with a target (the branch's closing value); K17 has no
    // per-branch owed reader (dashboard_kpi k17 drops paid_net when filtered by branch, so it would overstate owed) → left out
    const roles = new Map((await db.query<{ staff_id: string; role: string }>(
      `select distinct on (staff_id) staff_id, role from staff_branches where branch_id = $1 order by staff_id, role`, [branchId])).rows.map((r) => [r.staff_id, r.role]));
    // target_list(p_branch) already returns only the staff assigned to this branch; the role comes from their assignment here
    out.staff = targets.rows.map((r) => ({
      staff_id: r.staff_id, name: r.staff, role: r.is_bc ? "bc" : roles.get(r.staff_id),
      completions: r.scorecard.completed_services,
      k19: r.is_bc ? (r.target ? { closing_rupiah: r.branch_closing_value ?? r.closing_value_actual, target_rupiah: r.target.closing_value_target } : { closing_rupiah: 0, target_rupiah: 0 }) : null,
    }));
  }
  return out;
}
