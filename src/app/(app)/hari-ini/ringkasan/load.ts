// Ringkasan Shift (UX-6 shift summary, PR-33c; T-111): the loader core. It reads ONE shift through the reader the cashier already uses (cash_shift_get: the per-tender
// expectation, K23 received / sales and the branch's open tagihan) plus two day counters (visits_today, appointments_window), and composes the props of the presentational view.
// It never recomputes a figure a reader owns, and every figure it cannot read is `unavailable` with a reason, never 0 (Rp0 is real). The database decides who reads what
// (kasir_reader, visits_today); data.ts puts the role gate in front, and this core — no `server-only` — is what the isolation case runs as another tenant's owner.
import type pg from "pg";
import { CommandError } from "../../../../lib/command";
import { getShift, listShifts, myShift, SHIFT_STATES } from "../../../../modules/cashier/shifts/shifts";
import { listBranches } from "../../../../modules/org/branches/branches";
import { calendar } from "../../../../modules/scheduling/appointments/appointments";
import { today as boardOf } from "../../../../modules/visits/visits";
import { localDate } from "../../jadwal/labels";
import { dayLabel, time, ZONE } from "../labels";
import { type Amount, BAD_VALUE, type Count, reconcileMoneyIn, type ShiftSummaryData, type ShiftSummaryProps, TENDER_ORDER, type TenderBlock, type TenderMethod, type TenderRow } from "./model";

// Owner, manager and FO/cashier: the roles both the shift reader (kasir_reader) and the Hari Ini board (visits_today) admit (PANEL2-DECISION: kasir_reader ∩ 07).
export const READERS = ["owner", "manager", "fo_cashier"] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PATH = "/hari-ini/ringkasan";
const SHIFT = "/kasir/tutup"; // UX-15: /kasir/tutup/<id> has the sections #tender (expectation per tender), #pembayaran and #ringkasan (K23)
export const BOARD_DOWN = "Papan Hari Ini belum bisa dibaca";
export const CALENDAR_DOWN = "Jadwal hari ini belum bisa dibaca";
export const TENDERS_DOWN = "Total per metode belum bisa dibaca";
export const UNKNOWN_METHOD = "Metode pembayaran belum dikenali";
export const REPEATED_METHOD = "Metode pembayaran muncul dua kali";
const OTHERS = 5;

export type Branch = { id: string; name: string };
export type Summary =
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | { kind: "ok"; props: ShiftSummaryProps; branches: Branch[]; branchId: string };

// One reader call under a SAVEPOINT: a reader that refuses or fails rolls back to its savepoint, so the surrounding transaction stays usable for the next reader. The caller
// decides what a refusal means; a failure that is not a refusal is logged by reader name only (never a payload). A dead connection is not swallowed: the rollback itself throws.
type Guarded<T> = { ok: true; value: T } | { ok: false; error: unknown };
let seq = 0;
async function guarded<T>(db: pg.ClientBase, what: string, fn: () => Promise<T>): Promise<Guarded<T>> {
  const sp = `rs${++seq}`;
  await db.query(`savepoint ${sp}`);
  try {
    const value = await fn();
    await db.query(`release savepoint ${sp}`);
    return { ok: true, value };
  } catch (error) {
    await db.query(`rollback to savepoint ${sp}`);
    const refused = error instanceof CommandError && ["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT"].includes(error.code);
    if (!refused) console.error("hari-ini/ringkasan: reader failed", { reader: what, error: error instanceof Error ? error.name : "unknown" });
    return { ok: false, error };
  }
}
const refusedWith = (g: { ok: false; error: unknown }, code: string) => g.error instanceof CommandError && g.error.code === code;

const nat = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const amountOf = (n: unknown): Amount => (nat(n) ? { state: "value", rp: n } : { state: "unavailable", reason: BAD_VALUE });
const val = (n: number): Count => ({ state: "value", n });
const gap = (reason: string): Count => ({ state: "unavailable", reason });

// The per-tender expectation (cash_shift_expected / the frozen count lines): one row per method, balance included (shown apart, never money in). A shape the view cannot type
// (an unknown or repeated method, a count that is not a number) makes the whole block unavailable; one unreadable amount makes only that cell unavailable.
export function tendersOf(expected: unknown, href: string): TenderBlock {
  if (!Array.isArray(expected)) return { state: "unavailable", reason: TENDERS_DOWN };
  const seen = new Set<string>();
  const rows: TenderRow[] = [];
  for (const e of expected as Record<string, unknown>[]) {
    const method = e?.method;
    if (typeof method !== "string" || !(TENDER_ORDER as string[]).includes(method)) return { state: "unavailable", reason: UNKNOWN_METHOD };
    if (seen.has(method)) return { state: "unavailable", reason: REPEATED_METHOD };
    seen.add(method);
    if (!nat(e.payments)) return { state: "unavailable", reason: BAD_VALUE };
    rows.push({ method: method as TenderMethod, payments: e.payments, received: amountOf(e.received), paidOut: amountOf(e.paid_out), href });
  }
  return { state: "value", rows };
}

// "08.00 WIB" for a shift opened on the shown day, "19 Nov, 08.00 WIB" for one still open from an earlier day.
function openedLabel(iso: string, tz: string, day: string): string {
  const at = new Date(iso);
  const clock = `${time(at, tz)} ${ZONE[tz] ?? ""}`.trim();
  return localDate(at, tz) === day ? clock : `${new Intl.DateTimeFormat("id-ID", { timeZone: tz, day: "numeric", month: "short" }).format(at)}, ${clock}`;
}

// The actor's shift (header) must be a shape the view can show; anything else is a reader fault (error state), not a figure.
function shiftOf(d: unknown) {
  const s = (d as { shift?: { id?: unknown; branch?: { id?: unknown }; cashier?: { name?: unknown }; state?: unknown; opened_at?: unknown } } | null)?.shift;
  if (!s || typeof s.id !== "string" || typeof s.branch?.id !== "string" || typeof s.cashier?.name !== "string" || !(SHIFT_STATES as readonly string[]).includes(s.state as string)
    || typeof s.opened_at !== "string" || Number.isNaN(Date.parse(s.opened_at))) throw new Error("hari-ini/ringkasan: cash_shift_get answered an unexpected shape");
  return s as { id: string; branch: { id: string }; cashier: { name: string }; state: ShiftSummaryData["shift"]["state"]; opened_at: string };
}

export async function summaryIn(db: pg.ClientBase, role: string, activeBranchId: string | null, q: { cabang?: string; shift?: string }, now: Date = new Date()): Promise<Summary> {
  if (q.shift && !UUID.test(q.shift)) return { kind: "not-found" }; // a malformed id never reaches a reader
  const wide = role === "owner";
  const all = await listBranches(db);
  // Owner picks a branch; a manager and an FO/cashier have their active branch only (kasir_reader refuses any other). A foreign id is simply not in the list (RLS), so it is
  // never asked of a reader.
  const branches = wide ? all : all.filter((b) => b.id === activeBranchId);
  if (branches.length === 0) return { kind: "no-branch" };
  const chosen = (wide ? branches.find((b) => b.id === q.cabang) : undefined) ?? branches.find((b) => b.id === activeBranchId) ?? branches[0];
  const scope = wide ? chosen.id : null;
  const chips = branches.map((b) => ({ id: b.id, name: b.name }));

  // Which shift: the one asked for, else the actor's own current shift, else (owner, manager) the latest open shift of the branch. An FO/cashier reads only their own.
  const listed = new Map<string | null, Awaited<ReturnType<typeof listShifts>>["rows"]>();
  const openAt = async (branchId: string | null) => {
    if (role === "fo_cashier") return [];
    if (!listed.has(branchId)) listed.set(branchId, (await listShifts(db, { branchId, state: "open" })).rows);
    return listed.get(branchId) ?? [];
  };
  const wanted = q.shift || (await myShift(db, scope))?.id || (await openAt(scope))[0]?.id || null;
  if (!wanted) {
    const state = { kind: "empty" as const, message: "Belum ada shift yang terbuka di cabang ini.", action: "Buka Kasir", actionHref: SHIFT };
    return { kind: "ok", branchId: chosen.id, branches: chips, props: { branch: chosen.name, day: dayLabel(localDate(now, chosen.timezone)), zone: ZONE[chosen.timezone] ?? "", state } };
  }

  const g = await guarded(db, "cash_shift_get", () => getShift(db, wanted));
  if (!g.ok) {
    if (refusedWith(g, "ERR_NOT_FOUND")) return { kind: "not-found" };
    if (refusedWith(g, "ERR_FORBIDDEN")) return { kind: "forbidden" };
    throw g.error;
  }
  const d = g.value;
  const s = shiftOf(d);
  const branch = branches.find((b) => b.id === s.branch.id);
  if (!branch) return { kind: "not-found" };
  const tz = branch.timezone;

  // The two day counters are independent readers: one that fails leaves its own figures unavailable and the rest of the page intact.
  const board = await guarded(db, "visits_today", () => boardOf(db, branch.id));
  const day = board.ok ? board.value.today : localDate(now, tz);
  const cal = await guarded(db, "appointments_window", () => calendar(db, branch.id, day, day));
  // the other open shifts of the DISPLAYED shift's branch (an asked-for shift may sit at another branch than the chosen one); a navigation aid, never a figure
  const others = await guarded(db, "cash_shift_list", () => openAt(wide ? branch.id : null));

  const base = `${SHIFT}/${s.id}`;
  const tenders = tendersOf(d.expected, `${base}#tender`);
  const to = (path: string, p: Record<string, string>) => `${path}?${new URLSearchParams(p)}`;
  const owed = (d.open_tagihan ?? {}) as { count?: unknown; total?: unknown };
  const owedOk = nat(owed.count) && nat(owed.total);
  const data: ShiftSummaryData = {
    shift: { label: "Shift kasir", cashier: s.cashier.name, state: s.state, openedAt: openedLabel(s.opened_at, tz, day), href: base },
    tenders,
    moneyIn: { ...reconcileMoneyIn(tenders, d.k23?.received), href: `${base}#tender` },
    sales: { ...amountOf(d.k23?.sales), href: `${base}#ringkasan` },
    arrivals: { count: board.ok ? val(board.value.visits.filter((v) => localDate(v.checkedInAt, tz) === board.value.today).length) : gap(BOARD_DOWN), href: to("/hari-ini", { cabang: branch.id, tampilan: "semua" }) },
    noShows: { count: cal.ok ? val(cal.value.appointments.filter((a) => a.state === "no_show").length) : gap(CALENDAR_DOWN), href: to("/jadwal", { cabang: branch.id, tampilan: "hari", tanggal: day }) },
    openVisits: { count: board.ok ? val(board.value.visits.filter((v) => v.closedAt === null).length) : gap(BOARD_DOWN), href: to("/hari-ini", { cabang: branch.id, tampilan: "menunggu" }) },
    unpaid: {
      count: owedOk ? val(owed.count as number) : gap(BAD_VALUE),
      total: owedOk ? { state: "value", rp: owed.total as number } : { state: "unavailable", reason: BAD_VALUE },
      href: wide ? to("/kasir/terbuka", { cabang: branch.id }) : "/kasir/terbuka",
    },
    others: (others.ok ? others.value : []).filter((r) => r.id !== s.id).slice(0, OTHERS).map((r) => ({ label: `${r.cashier.name} · dibuka ${openedLabel(r.opened_at, tz, day)}`, href: to(PATH, { shift: r.id }) })),
  };
  return { kind: "ok", branchId: branch.id, branches: chips, props: { branch: branch.name, day: dayLabel(day), zone: ZONE[tz] ?? "", state: { kind: "ready", data } } };
}

