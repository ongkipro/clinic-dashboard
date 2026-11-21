// Ringkasan Shift on Hari Ini (UX-6, PR-33c; T-111). Typed props and pure helpers for the presentational view (view.tsx).
// Figures arrive from server readers (the shift's own `cash_shift_get` expectation per tender + K23, and the T-107 day
// counts); this module never recomputes them and carries no clinical content: tender amounts, counts, the cashier's
// display name, and links. A figure the reader could not produce is `unavailable` with a reason, never 0 (Rp0 is real).
// "Saldo" (patient balance) is shown per tender but is never new money (K1: balance usage is not new cash).
import type { ListState } from "../../../../components/templates/templates";
import { TENDER } from "../../kasir/tutup/labels";

export type Amount = { state: "value"; rp: number } | { state: "unavailable"; reason: string };
export type Count = { state: "value"; n: number } | { state: "unavailable"; reason: string };

export type TenderMethod = "cash" | "qris" | "edc" | "transfer" | "va" | "payment_link" | "balance";
export type TenderRow = { method: TenderMethod; payments: number; received: Amount; paidOut: Amount; href: string };
// The per-tender expectation as one block: the shift reader answers every tender together, so when it cannot be read there is no row to show — never a row of Rp0.
export type TenderBlock = { state: "value"; rows: TenderRow[] } | { state: "unavailable"; reason: string };
export type ShiftState = "open" | "pending_approval" | "recount" | "closed";

export type ShiftSummaryData = {
  shift: { label: string; cashier: string; state: ShiftState; openedAt: string; href: string }; // href → UX-15 shift detail
  tenders: TenderBlock;
  moneyIn: Amount & { href: string }; // net of the real tenders, reconciled with the reader's K23 received (reconcileMoneyIn); the view shows it and never recomputes it
  sales: Amount & { href?: string }; // K23 sales side (K3 of invoices issued in the shift)
  arrivals: { count: Count; href: string }; // visits checked in today
  noShows: { count: Count; href: string };
  openVisits: { count: Count; href: string };
  unpaid: { count: Count; total: Amount; href: string }; // issued bills still owing at the branch (the shift reader's open_tagihan); tap → Kasir ▸ Tagihan Terbuka
  others: { label: string; href: string }[]; // the branch's other open shifts (owner/manager), each opening its own summary
};

export type ScreenState<D> = Exclude<ListState, { kind: "rows" }> | { kind: "ready"; data: D };
export type ShiftSummaryProps = { branch: string; day: string; zone: string; state: ScreenState<ShiftSummaryData>; as?: "main" | "section" };

// Display order: drawer cash first, then the other real tenders, balance last.
export const TENDER_ORDER: TenderMethod[] = ["cash", "qris", "edc", "transfer", "va", "payment_link", "balance"];
export const tenderLabel = (m: TenderMethod) => TENDER[m] ?? m;
export const SHIFT_STATE: Record<ShiftState, string> = { open: "Terbuka", pending_approval: "Menunggu persetujuan", recount: "Hitung ulang", closed: "Selesai" };
export const UNAVAILABLE = "Belum tersedia";
export const BAD_VALUE = "Nilai dari pembacaan tidak valid";
export const NOT_RECONCILED = "Total per metode tidak cocok dengan ringkasan kasir";

const nf = new Intl.NumberFormat("id-ID");
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const money = (a: Amount) => (a.state === "value" ? rp(a.rp) : UNAVAILABLE);
export const qty = (c: Count) => (c.state === "value" ? nf.format(c.n) : UNAVAILABLE);
export const count = (n: number) => nf.format(n);

export const sortTenders = (rows: TenderRow[]) => [...rows].sort((a, b) => TENDER_ORDER.indexOf(a.method) - TENDER_ORDER.indexOf(b.method));

// Net per tender = received − paid out (cash refunds leave the drawer).
export function net(t: TenderRow): Amount {
  if (t.received.state !== "value") return t.received;
  if (t.paidOut.state !== "value") return t.paidOut;
  return { state: "value", rp: t.received.rp - t.paidOut.rp };
}

// Uang masuk in the shift: net of every real tender, balance excluded. Unavailable if any real tender is unavailable:
// a partial sum would understate the drawer without saying so. No cross-unit sum: rupiah only.
export function moneyIn(rows: TenderRow[]): Amount {
  let total = 0;
  for (const t of rows) {
    if (t.method === "balance") continue;
    const n = net(t);
    if (n.state !== "value") return { state: "unavailable", reason: `${tenderLabel(t.method)}: ${n.reason}` };
    total += n.rp;
  }
  return { state: "value", rp: total };
}

// One shift source (PANEL2-DECISION): money in is summed from the tenders and must equal the same reader's K23 "received" (real non-balance payments less cash
// paid out). A disagreement is shown as unavailable with its reason — a figure that contradicts the cashier's own summary is never printed.
export function reconcileMoneyIn(t: TenderBlock, k23Received: unknown): Amount {
  if (t.state !== "value") return { state: "unavailable", reason: t.reason };
  const m = moneyIn(t.rows);
  if (m.state !== "value") return m;
  if (typeof k23Received !== "number" || !Number.isSafeInteger(k23Received)) return { state: "unavailable", reason: BAD_VALUE };
  return m.rp === k23Received ? m : { state: "unavailable", reason: NOT_RECONCILED };
}
