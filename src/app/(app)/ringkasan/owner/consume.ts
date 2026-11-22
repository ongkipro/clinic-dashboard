// Ringkasan Owner (UX-20 / UX-37), T-109: the consumer side of the T-107 read contract — `dashboard_kpi` answers (KpiResult) turned into the
// view's `Amount`s. Pure and structural on purpose: dashboards.ts is not on this base yet and T-107 r3 is still moving, so there is no import of
// it and no database here (a hand-copied type would drift; the tests pin the shapes with fixtures from t107/R3-CONTRACT-CHANGE.md). When the r3
// types land, `KpiPayload` becomes a `Pick<KpiResult, ...>` in one line. Nothing here is a reader and nothing here guesses: a part this screen
// does not know, a number that is not an integer, or missing evidence makes the figure `unavailable` with a reason — never a partial sum.
import type { Amount } from "./model";

export type Dims = Record<string, number>;
export type KpiPayload = {
  total: number | null; // the reader's own sum of the money parts; null = no rows
  by_dim: Dims;
  by_branch?: Record<string, Dims>; // a row without a branch sits under UNBRANCHED
  extra?: Record<string, unknown> | null;
};

export const UNBRANCHED = "-";
const unavailable = (reason: string): Amount => ({ state: "unavailable", reason });
const isRp = (n: unknown): n is number => Number.isSafeInteger(n); // integer rupiah, no float
// The reader's total. No rows = nothing owed / receivable: a real Rp0 (the reader answered), not a missing figure.
const fromTotal = (t: number | null): Amount => (t === null ? { state: "value", rp: 0 } : isRp(t) ? { state: "value", rp: t } : unavailable("Nilai tidak valid"));

// ── K17 Komisi terutang (owed) = accrued + adjusted + paid_net ─────────────────────────────────────────────────────────────────────────
// paid_net is the NET actually paid, signed NEGATIVE (the commission_payable roll-forward: carry-forward and staff receivables already sit
// inside the batch line). Each part is added exactly once, as supplied: never dropped, never abs'd, never subtracted again on top of a total
// that already contains it. Gross "paid" and the workflow states (pending_approval / approved) are not parts of owed — a payload that carries
// them is another contract, refused instead of summed (it would count a payment twice). `extra.current_workflow` is the batches' state NOW,
// not history, and is never read here. A positive paid_net would turn a payment into extra debt: refused.
export const K17_PARTS = ["accrued", "adjusted", "paid_net"] as const;
export function sumK17(d: Dims): number | null {
  if (Object.keys(d).some((k) => !(K17_PARTS as readonly string[]).includes(k) || !isRp(d[k]))) return null;
  if ((d.paid_net ?? 0) > 0) return null;
  return K17_PARTS.reduce((s, k) => s + (d[k] ?? 0), 0);
}

// Consolidated (tenant-wide) owed. The reader's `total` is authoritative when present; the parts are used only when it is absent.
export function k17Owed(p: KpiPayload): Amount {
  if (p.total !== null) return fromTotal(p.total);
  const s = sumK17(p.by_dim);
  return s === null ? unavailable("Rincian komisi belum dikenali") : { state: "value", rp: s };
}

// One branch's owed, from the CONSOLIDATED answer. A payout batch line belongs to a staff member, not to a branch, so the net paid sits under
// UNBRANCHED — and the reader drops every branch-less row from a branch-scoped call, so `dashboard_kpi('k17', …, branchId).total` is gross
// accrued + adjusted, i.e. NOT owed: it must never be shown as a branch's owed. While any payment sits outside every branch, a branch's owed
// cannot be proven, so it is unavailable — not computed by spreading the payment over branches (subtracting it from each) and not shown without it.
export function k17ForBranch(p: KpiPayload, branchId: string): Amount {
  if (!p.by_branch) return unavailable("Rincian komisi per cabang belum tersedia");
  const loose = p.by_branch[UNBRANCHED];
  if (loose && Object.values(loose).some((v) => v !== 0)) {
    return unavailable("Pembayaran komisi dicatat per batch, bukan per cabang, jadi komisi terutang per cabang belum dapat dipastikan");
  }
  const s = sumK17(p.by_branch[branchId] ?? {}); // no entry = no rows at that branch
  return s === null ? unavailable("Rincian komisi belum dikenali") : { state: "value", rp: s };
}

// ── K4 Piutang (receivables aging) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Complete only on evidence: the reader reports the closed-visit lines whose cancellation it could not date (`extra.undated_cancellations`) and
// then returns no total and no aging. A count above 0 — or a missing / non-integer count, which proves nothing — makes the balance and every
// aging bucket unavailable together: a balance that is partly right is worse than none. (Against the r2 reader, which has no such count, K4
// therefore reads "Belum tersedia" until r3 lands — by design.)
export type K4Card = { amount: Amount; aging: { d0_30: Amount; d31_60: Amount; d61_90: Amount; d90: Amount } };
const BUCKET = { d0_30: "0-30", d31_60: "31-60", d61_90: "61-90", d90: ">90" } as const;
const allUnavailable = (reason: string): K4Card => {
  const a = unavailable(reason);
  return { amount: a, aging: { d0_30: a, d31_60: a, d61_90: a, d90: a } };
};

export function k4Card(p: KpiPayload): K4Card {
  const u = p.extra?.undated_cancellations;
  if (typeof u !== "number" || !Number.isInteger(u) || u < 0) return allUnavailable("Kelengkapan piutang belum dapat dipastikan");
  if (u > 0 || p.extra?.complete === false) return allUnavailable("Piutang belum lengkap: ada pembatalan tagihan yang tanggalnya belum dapat ditentukan");
  const known: string[] = Object.values(BUCKET);
  if (Object.keys(p.by_dim).some((k) => !known.includes(k) || !isRp(p.by_dim[k]))) return allUnavailable("Rincian piutang belum dikenali");
  const at = (k: keyof typeof BUCKET): Amount => ({ state: "value", rp: p.by_dim[BUCKET[k]] ?? 0 }); // a bucket without rows is a real Rp0
  return { amount: fromTotal(p.total), aging: { d0_30: at("d0_30"), d31_60: at("d31_60"), d61_90: at("d61_90"), d90: at("d90") } };
}
