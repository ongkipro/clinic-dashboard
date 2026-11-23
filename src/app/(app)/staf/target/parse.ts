// "Rp1.500.000" / "1.500.000" / "1500000" → 1500000 (integer rupiah); anything else → NaN (HYG-NAV-1).
export function parseRupiah(s: string): number {
  const t = s.replace(/^Rp\s*/i, "").replace(/[.\s]/g, "");
  return /^\d{1,13}$/.test(t) ? Number(t) : Number.NaN;
}
