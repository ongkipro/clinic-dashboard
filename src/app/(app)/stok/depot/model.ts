// Gudang & Depot, pure (HYG-NAV-2): labels, the per-depot summary and the quantity check of a depot-to-depot move (the database
// re-checks availability under a row lock, DATA-63). Quantities are decimal strings for the writers (Qty), numbers in the readers.
export const KIND_LABEL: Record<string, string> = { gudang: "Gudang", ruang: "Ruang Tindakan", apotek: "Apotek" };
export type Holding = { item_id: string; name: string; unit: string; batch_id: string; batch_no: string; expiry: string; quantity: number; unfit: string | null };
export const fitHoldings = (hs: readonly Holding[]) => hs.filter((h) => !h.unfit && h.quantity > 0);
export function summary(hs: readonly Holding[]) {
  const items = new Set(hs.filter((h) => h.quantity > 0).map((h) => h.item_id)).size;
  const unfit = hs.filter((h) => h.unfit && h.quantity > 0).length;
  return { items, batches: hs.filter((h) => h.quantity > 0).length, unfit };
}
const QTY = /^\d{1,9}(\.\d{1,3})?$/;
export type MoveCheck = { ok: true } | { ok: false; error: string };
export function checkMove(i: { from: string; to: string; batch: string; quantity: string }, available: number | null): MoveCheck {
  if (!i.from || !i.to || !i.batch) return { ok: false, error: "Pilih depot asal, depot tujuan, dan batch." };
  if (i.from === i.to) return { ok: false, error: "Depot asal dan tujuan harus berbeda." };
  if (!QTY.test(i.quantity) || Number(i.quantity) <= 0) return { ok: false, error: "Isi jumlah lebih dari 0 (maksimal 3 desimal)." };
  if (available !== null && Number(i.quantity) > available) return { ok: false, error: "Jumlah melebihi stok batch di depot asal." };
  return { ok: true };
}
