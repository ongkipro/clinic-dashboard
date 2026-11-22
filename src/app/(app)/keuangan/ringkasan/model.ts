// Ringkasan Keuangan (UX-22 ▸ Ringkasan, PR-33f; T-114). Typed props and pure helpers for the presentational view (view.tsx).
// Figures arrive from server readers (T-107 `dash_k1`…`dash_k6`, the existing `subledger_rollforward`, `commission_batches_list`,
// `payable_overview`); this module never recomputes them across units and carries no clinical content: amounts, counts,
// ledger and method labels, branch names and links. A figure the reader could not produce is `unavailable` with a reason,
// never 0 (Rp0 is real). Roll-forwards are re-checked here: opening + Σ movements must equal closing (Scenario PR-33f).
import type { ListState } from "../../../../components/templates/templates";
import { DIM, LEDGER, termLabel } from "../kewajiban/labels";

export type Amount = { state: "value"; rp: number } | { state: "unavailable"; reason: string };

export type Method = "cash" | "petty_cash" | "bank" | "qris" | "edc" | "va" | "payment_link" | "transfer";
// slice 2: an href is omitted (undefined) while its destination page is not built (Panel 2: Mutasi, Rekon, Laporan, Refund list)
export type MethodRow = { method: Method; amount: Amount; href?: string };

// Prepaid liability ledgers (K5) plus receivables and commission payable, as in Piutang & Kewajiban Layanan.
export type RollLedger = "package_liability" | "patient_balance" | "paid_not_delivered" | "booking_dp" | "receivables" | "commission_payable";
export type Roll = { ledger: RollLedger; opening: Amount; movements: { term: string; rp: number }[]; closing: Amount; href: string };

export type BatchState = "draft" | "pending_approval" | "approved" | "paid";

export type FinanceSummaryData = {
  k1: { methods: MethodRow[]; refundsCash: Amount; href?: string }; // K1 = Σ methods − cash refunds; balance usage excluded by the reader
  gatewayPending: { amount: Amount; count: number | null; href?: string }; // settlement gateway tertunda; count null = not readable
  k2: { amount: Amount; href?: string };
  k3: { amount: Amount; href?: string };
  k4: { aging: { d0_30: Amount; d31_60: Amount; d61_90: Amount; d90: Amount }; href: string };
  k5: { packageExpiry30: Amount; href: string };
  k6: { amount: Amount; href: string };
  rolls: Roll[];
  refundsWriteOffs: { refunds: Amount; writeOffs: Amount; href: string };
  // K17. batchesUnavailable: the batch list cannot be shown for this scope (batches are tenant-wide), with the reason — never "no batch"
  commission: { owed: Amount; batches: { state: BatchState; count: number; amount: Amount }[]; batchesUnavailable?: string; href: string };
  payables: { due7: Amount; overdue: Amount; href: string }; // supplier payables (UX-52 Utang)
  cues: { openShifts: number | null; shiftVariance: number | null; reconDiffs: number | null; shiftHref: string; reconHref?: string }; // null = not readable: hidden
};

export type ScreenState<D> = Exclude<ListState, { kind: "rows" }> | { kind: "ready"; data: D };
export type Scope = { branches: { id: string; name: string }[]; branch: string | null; from: string; to: string; action: string; period: string };
export type FinanceSummaryProps = { scope: Scope; ledgerHref: string; state: ScreenState<FinanceSummaryData>; as?: "main" | "section" };

export const UNAVAILABLE = "Belum tersedia";
export const BATCH: Record<BatchState, string> = { draft: "Draf", pending_approval: "Menunggu persetujuan", approved: "Disetujui", paid: "Dibayar" };
export const methodLabel = (m: Method) => DIM[m] ?? (m === "transfer" ? "Transfer" : m);
export const ledgerLabel = (l: RollLedger) => LEDGER[l];
export { termLabel };
// K5 = the four prepaid ledgers; displayed in this order.
export const PREPAID: RollLedger[] = ["paid_not_delivered", "package_liability", "patient_balance", "booking_dp"];

export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const money = (a: Amount) => (a.state === "value" ? rp(a.rp) : UNAVAILABLE);
export const count = (n: number) => new Intl.NumberFormat("id-ID").format(n);

// Σ of amounts; unavailable if any part is (no partial sum that silently understates). Rupiah only.
export function sum(parts: Amount[]): Amount {
  let t = 0;
  for (const a of parts) {
    if (a.state !== "value") return a;
    t += a.rp;
  }
  return { state: "value", rp: t };
}

// K1 = payments per method − cash refunds.
export function k1Total(d: FinanceSummaryData["k1"]): Amount {
  const s = sum(d.methods.map((m) => m.amount));
  if (s.state !== "value") return s;
  if (d.refundsCash.state !== "value") return d.refundsCash;
  return { state: "value", rp: s.rp - d.refundsCash.rp };
}

// K5 total = closing of the four prepaid ledgers.
export const k5Total = (rolls: Roll[]) => sum(PREPAID.map((l) => rolls.find((r) => r.ledger === l)?.closing ?? { state: "unavailable", reason: `${ledgerLabel(l)} belum tersedia` }));

// Scenario PR-33f: opening + movements = closing. A side that is unavailable cannot be checked (never shown as balanced).
export type RollCheck = { state: "balanced" } | { state: "mismatch"; diff: number } | { state: "unchecked"; reason: string };
export function rollCheck(r: Roll): RollCheck {
  if (r.opening.state !== "value") return { state: "unchecked", reason: r.opening.reason };
  if (r.closing.state !== "value") return { state: "unchecked", reason: r.closing.reason };
  const diff = r.closing.rp - (r.opening.rp + r.movements.reduce((s, m) => s + m.rp, 0));
  return diff === 0 ? { state: "balanced" } : { state: "mismatch", diff };
}

// Filter links keep the period and set or clear the branch (consolidated = no branch).
export function scopeHref(s: Scope, branch: string | null) {
  const p = new URLSearchParams({ dari: s.from, sampai: s.to });
  if (branch) p.set("cabang", branch);
  return `${s.action}?${p}`;
}
