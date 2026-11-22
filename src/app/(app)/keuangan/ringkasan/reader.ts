// Ringkasan Keuangan reader wiring (UX-22 ▸ Ringkasan, PR-33f; T-114 slice 2). FinanceSummaryData from EXISTING granted readers only,
// with the authority they already have (owner / finance / auditor; no role expansion, no migration):
//   subledger_rollforward (0121) → the roll-forwards (opening / terms / closing, each only when complete), gateway clearing, write-offs
//   dashboard_kpi (0126)         → K1 per method − cash refunds, K2, K3 (+ its refund part), K4 aging (complete or unavailable),
//                                  K5 expiry slice, K6, K17 owed
//   commission_batches_list (0102) → batches per state — tenant-wide only (it has no branch filter)
//   payable_overview (0084)       → supplier payables due ≤ 7 days and overdue
//   cash_shift_list (0101)        → open shifts and escalated counts
// Rules:
// - rupiah keep their sign (a refund, a write-off, a negative owed) and are never summed across units;
// - K4 is shown only when dashboard_kpi vouches it complete; otherwise every bucket is unavailable with the undated-cancellation count;
// - K17 per branch: the reader attributes accruals and adjustments to their branch but the net actually PAID has no branch (payout lines
//   are per staff, branch NULL), so a branch-filtered owed figure would leave payments out. No allocation is guessed: with a branch
//   selected, K17 owed and the batch list are unavailable with the reason; consolidated shows both;
// - a figure a reader refuses for the role is unavailable ("Tidak tersedia untuk peran ini"); a branch outside scope propagates;
// - links go only to built pages (Panel 2): Mutasi, Rekon and Laporan are not built → no href;
// - slice 3: "settlement gateway tertunda" is unavailable. No settlement fact exists on main (G-SETTLE: ledger_rule_gateway_settlement is
//   never invoked; payment_charges.settled_at is the charge being paid), so the gateway_clearing closing is every gateway receipt to date,
//   not what awaits settlement. The clearing ledger itself stays as the roll-forward / Kewajiban show it.
import type pg from "pg";
import { CommandError } from "../../../../lib/command";
import { kpi, type K4Extra } from "../../../../modules/reporting/dashboards/dashboards";
import { rollforward, type Rollforward } from "../../../../modules/accounting/subledgers/subledgers";
import { listBatches } from "../../../../modules/commission/commission";
import { payableOverview } from "../../../../modules/purchasing/payables/payables";
import { listShifts } from "../../../../modules/cashier/shifts/shifts";
import type { Amount, BatchState, FinanceSummaryData, Method, Roll, RollLedger } from "./model";

export const FORBIDDEN = "Tidak tersedia untuk peran ini";
export const REASON = {
  k4Incomplete: (n: number) => `${n} pembatalan tanpa tanggal — umur piutang belum dapat dihitung`,
  k17Branch: "Komisi yang sudah dibayar tidak tercatat per cabang; lihat Semua Cabang",
  batchesBranch: "Batch komisi berlaku untuk semua cabang",
  openingIncomplete: "Riwayat sebelum cutover belum lengkap",
  settlementUnrecorded: "Settlement dari penyedia pembayaran belum dicatat",
} as const;
// built destinations only (Panel 2 slice-1 decision)
export const HREF = {
  kewajiban: "/keuangan/kewajiban", piutang: "/piutang", komisi: "/komisi", utang: "/pembelian/utang", shifts: "/kasir/tutup", ledger: "/keuangan/buku-besar",
} as const;

const value = (rp: number): Amount => ({ state: "value", rp });
const off = (reason: string): Amount => ({ state: "unavailable", reason });
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : 0);
const ROLLS: RollLedger[] = ["paid_not_delivered", "package_liability", "patient_balance", "booking_dp", "receivables", "commission_payable"];
const METHODS = new Set<Method>(["cash", "petty_cash", "bank", "qris", "edc", "va", "payment_link", "transfer"]);

async function part<T>(db: pg.ClientBase, fn: () => Promise<T>): Promise<T | "forbidden"> {
  await db.query("savepoint ringkasan_keuangan");
  try {
    const r = await fn();
    await db.query("release savepoint ringkasan_keuangan");
    return r;
  } catch (e) {
    await db.query("rollback to savepoint ringkasan_keuangan");
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return "forbidden";
    throw e;
  }
}

// One sub-ledger roll-forward → the view's Roll (pure): opening / closing only when the reader says complete.
export function rollFrom(ledger: RollLedger, rf: Rollforward): Roll {
  const r = rf.ledgers[ledger];
  return {
    ledger,
    opening: r.opening_complete ? value(n(r.opening)) : off(REASON.openingIncomplete),
    movements: Object.entries(r.terms).map(([term, rp]) => ({ term, rp: n(rp) })),
    closing: r.closing_complete ? value(n(r.closing)) : off(REASON.openingIncomplete),
    href: `${HREF.kewajiban}#h-${ledger}`,
  };
}

// K1 per method (pure) from dashboard_kpi k1 by_dim: method dims are receipts; cash_refund / dp_refund are the (negative) cash-outs,
// shown as a positive refund that k1Total subtracts — so Σ methods − refunds equals the reader's signed total.
export function k1From(r: { by_dim: Record<string, unknown> } | "forbidden"): FinanceSummaryData["k1"] {
  if (r === "forbidden") return { methods: [{ method: "cash", amount: off(FORBIDDEN) }], refundsCash: off(FORBIDDEN) };
  return {
    methods: Object.entries(r.by_dim).filter(([d]) => METHODS.has(d as Method)).sort(([a], [b]) => a.localeCompare(b))
      .map(([d, amt]) => ({ method: d as Method, amount: value(n(amt)) })),
    refundsCash: value(-(n(r.by_dim.cash_refund) + n(r.by_dim.dp_refund))),
  };
}

// K4 aging (pure): complete → the four buckets (a real 0 stays Rp0); incomplete / refused → every bucket unavailable.
export function k4From(r: { by_dim: Record<string, unknown>; extra: unknown } | "forbidden"): FinanceSummaryData["k4"]["aging"] {
  if (r === "forbidden") return { d0_30: off(FORBIDDEN), d31_60: off(FORBIDDEN), d61_90: off(FORBIDDEN), d90: off(FORBIDDEN) };
  const x = r.extra as K4Extra | null;
  if (!x || x.complete !== true) {
    const why = off(REASON.k4Incomplete(n(x?.undated_cancellations)));
    return { d0_30: why, d31_60: why, d61_90: why, d90: why };
  }
  const b = (k: string) => value(n(r.by_dim[k]));
  return { d0_30: b("0-30"), d31_60: b("31-60"), d61_90: b("61-90"), d90: b(">90") };
}

export type FinanceWindow = { from: string; to: string; branchId?: string | null };

export async function readFinanceSummary(db: pg.ClientBase, w: FinanceWindow): Promise<FinanceSummaryData> {
  const branchId = w.branchId ?? null;
  const k = (id: "k1" | "k2" | "k3" | "k4" | "k5" | "k6" | "k17") => part(db, () => kpi(db, { kpi: id, from: w.from, to: w.to, branchId }));
  const rf = await part(db, () => rollforward(db, { from: w.from, to: w.to, branchId }));
  const [k1, k2, k3, k4, k5, k6, k17] = [await k("k1"), await k("k2"), await k("k3"), await k("k4"), await k("k5"), await k("k6"), await k("k17")];
  const batches = branchId ? null : await part(db, () => listBatches(db));
  const payables = await part(db, () => payablesFor(db, branchId));
  const shifts = await part(db, () => listShifts(db, { branchId }));

  const money = (r: { total: number | null } | "forbidden"): Amount => (r === "forbidden" ? off(FORBIDDEN) : value(r.total === null ? 0 : n(r.total)));
  const rec = rf === "forbidden" ? null : rf.ledgers.receivables;
  return {
    // K1 per method from dashboard_kpi k1 (the K1 definition itself): method dims are receipts; cash_refund / dp_refund are the negative
    // cash-outs. Σ methods − refunds = the reader's total, signed. No href: Mutasi is not built.
    k1: k1From(k1),
    gatewayPending: { amount: rf === "forbidden" ? off(FORBIDDEN) : off(REASON.settlementUnrecorded), count: null },
    k2: { amount: money(k2) },
    k3: { amount: money(k3) },
    k4: { aging: k4From(k4), href: HREF.piutang },
    k5: { packageExpiry30: k5 === "forbidden" ? off(FORBIDDEN) : value(n(k5.by_dim.packages_expiring_30)), href: HREF.kewajiban },
    k6: { amount: money(k6), href: `${HREF.kewajiban}#h-patient_balance` },
    rolls: rf === "forbidden" ? [] : ROLLS.map((l) => rollFrom(l, rf)),
    // signed as the books carry them: a refund (sale value refunded, excl. VAT, from K3) and a write-off reduce, so they are negative
    refundsWriteOffs: {
      refunds: k3 === "forbidden" ? off(FORBIDDEN) : value(n(k3.by_dim.refund)),
      writeOffs: rec ? value(n(rec.terms.written_off)) : off(FORBIDDEN),
      href: HREF.piutang,
    },
    commission: {
      // decided on the scope the READER applied (k17.branch_id), not the request: dashboard_actor binds a manager to its active branch
      owed: k17 === "forbidden" ? off(FORBIDDEN) : branchId || k17.branch_id ? off(REASON.k17Branch) : value(k17.total === null ? 0 : n(k17.total)),
      batches: batches && batches !== "forbidden" ? batchStates(batches.batches) : [],
      batchesUnavailable: branchId ? REASON.batchesBranch : batches === "forbidden" ? FORBIDDEN : undefined,
      href: HREF.komisi,
    },
    payables: payables === "forbidden" ? { due7: off(FORBIDDEN), overdue: off(FORBIDDEN), href: HREF.utang } : sumPayables(payables.map(payableAmounts)),
    cues: {
      openShifts: shifts === "forbidden" ? null : shifts.rows.filter((s) => s.state !== "closed").length,
      shiftVariance: shifts === "forbidden" ? null : shifts.rows.filter((s) => s.state === "pending_approval").length,
      reconDiffs: null, // T-108 Rekon not built
      shiftHref: HREF.shifts,
    },
  };
}

function sumPayables(xs: FinanceSummaryData["payables"][]): FinanceSummaryData["payables"] {
  const add = (k: "due7" | "overdue") => xs.reduce<Amount>((t, x) => (t.state === "value" && x[k].state === "value" ? value(t.rp + x[k].rp) : t.state === "value" ? x[k] : t), value(0));
  return { due7: add("due7"), overdue: add("overdue"), href: HREF.utang };
}

function batchStates(bs: { state: BatchState; net_payable: number }[]): FinanceSummaryData["commission"]["batches"] {
  const order: BatchState[] = ["draft", "pending_approval", "approved", "paid"];
  return order.map((s) => {
    const xs = bs.filter((b) => b.state === s);
    return { state: s, count: xs.length, amount: value(xs.reduce((t, b) => t + n(b.net_payable), 0)) };
  }).filter((b) => b.count > 0);
}

// payable_overview reads one branch (a tenant-wide role must name it; a manager gets its active branch). Consolidated = the exact sum over
// the tenant's branches (a sum of per-branch figures, not an allocation); tried as-is first so a manager's own branch still reads.
type PayOv = Awaited<ReturnType<typeof payableOverview>>;
async function payablesFor(db: pg.ClientBase, branchId: string | null): Promise<PayOv[]> {
  if (branchId) return [await payableOverview(db, branchId)];
  await db.query("savepoint ringkasan_utang");
  try {
    const one = await payableOverview(db, null);
    await db.query("release savepoint ringkasan_utang");
    return [one];
  } catch (e) {
    await db.query("rollback to savepoint ringkasan_utang");
    if (!(e instanceof CommandError && e.code === "ERR_NOT_FOUND")) throw e;
  }
  const ids = (await db.query<{ id: string }>(`select id from branches order by code`)).rows.map((r) => r.id);
  const out: PayOv[] = [];
  for (const id of ids) out.push(await payableOverview(db, id));
  return out;
}

function payableAmounts(p: { today: string; invoices: { outstanding: number; due_date: string; overdue: boolean; state: string }[] }): FinanceSummaryData["payables"] {
  const in7 = new Date(Date.parse(`${p.today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const open = p.invoices.filter((i) => i.state === "open");
  return {
    due7: value(open.filter((i) => !i.overdue && i.due_date.slice(0, 10) <= in7).reduce((t, i) => t + n(i.outstanding), 0)),
    overdue: value(open.filter((i) => i.overdue).reduce((t, i) => t + n(i.outstanding), 0)),
    href: HREF.utang,
  };
}
