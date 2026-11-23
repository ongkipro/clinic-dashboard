// Pemusnahan, pure (HYG-NAV-2): which watched batches are disposal candidates and who must approve a disposal of a given value under
// SET-43 (CD-21). The writer is not built yet; the approver rule is shown so the desk knows what the recording step will require.
import type { Watch } from "../../../../modules/inventory/stock";

type WatchBatch = Watch["batches"][number];
// Unfit (expired, recalled, quarantined, temperature excursion) with stock left; near-expiry fit batches are "segera" (not yet disposable).
export const candidates = (w: Watch) => w.batches.filter((b) => b.unfit !== null && b.quantity > 0);
export const soon = (w: Watch) => w.batches.filter((b) => b.unfit === null && b.quantity > 0 && b.days_left <= w.near_expiry_days);

export type Thresholds = { musnah_kedua_kejadian: number; musnah_kedua_bulan: number; musnah_owner: number };
export type Approval = "satu" | "kedua" | "owner";
// Value of one disposal event and the branch's month-to-date disposals before it (integer rupiah).
export function approvalFor(value: number, monthBefore: number, t: Thresholds): Approval {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(monthBefore) || monthBefore < 0) throw new RangeError("rupiah");
  if (value >= t.musnah_owner) return "owner";
  if (value >= t.musnah_kedua_kejadian || monthBefore + value >= t.musnah_kedua_bulan) return "kedua";
  return "satu";
}
export const APPROVAL_LABEL: Record<Approval, string> = {
  satu: "Satu penyetuju (Manajer atau Owner), selain pengaju",
  kedua: "Dua penyetuju berbeda",
  owner: "Owner",
};
export const daysLabel = (b: WatchBatch) => (b.days_left < 0 ? `lewat ${-b.days_left} hari` : b.days_left === 0 ? "hari ini" : `${b.days_left} hari lagi`);
