// Templat Paket, pure (HYG-NAV-2): the per-template summary the page shows. Money is integer rupiah; a missing figure is "—", never Rp0.
export type ContentRow = { seq: number; service: string | null; count: number };
export const rupiah = (n: number) => `Rp${new Intl.NumberFormat("id-ID").format(n)}`;
export const sessions = (rows: readonly ContentRow[]) => rows.reduce((s, r) => s + r.count, 0);
export const validity = (days: number | null) => (days === null ? "Tanpa batas" : `${new Intl.NumberFormat("id-ID").format(days)} hari`);
// Minimum DP of a package price at minDpPct (CD-04): rounded up to whole rupiah so the paid floor is never below the percentage.
export function minDp(price: number, pct: number | null): number | null {
  if (pct === null) return null;
  if (!Number.isSafeInteger(price) || price < 0 || pct < 0 || pct > 100) return null;
  return Math.ceil((price * pct) / 100);
}
export const sharingLabel = (s: { enabled: boolean } | null) => (s === null ? "—" : s.enabled ? "Boleh berbagi keluarga" : "Tidak berbagi");
