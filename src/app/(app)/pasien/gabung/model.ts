// Gabung Data Ganda, pure (19 §2.4, PR-85; HYG-NAV-2): validation of a merge or undo request before it reaches patient_merge /
// patient_unmerge (T-042), with the database's own bounds (reason 10–500 characters, two different patients). Tested in
// tests/ui/hyg-nav-2.test.ts; the database stays the authority.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export type MergeInput = { survivor: string; merged: string; reason: string };
export type Check = { ok: true } | { ok: false; error: string };

export function checkMerge(i: MergeInput): Check {
  if (!UUID.test(i.survivor) || !UUID.test(i.merged)) return { ok: false, error: "Pilih dua pasien dari hasil pencarian." };
  if (i.survivor.toLowerCase() === i.merged.toLowerCase()) return { ok: false, error: "Pasien yang dipertahankan dan yang digabung harus berbeda." };
  return checkReason(i.reason);
}
// The pair shown and the side kept → the merge request (the duplicate is the other side). A survivor outside the pair is refused.
export function pairToMerge(pairA: string, pairB: string, survivor: string, reason: string): MergeInput | null {
  if (survivor !== pairA && survivor !== pairB) return null;
  return { survivor, merged: survivor === pairA ? pairB : pairA, reason };
}
export function checkReason(reason: string): Check {
  const n = reason.trim().length;
  if (n < REASON_MIN || n > REASON_MAX) return { ok: false, error: `Tulis alasan ${REASON_MIN}–${REASON_MAX} huruf.` };
  return { ok: true };
}
// The merge history line the page shows for one merge, from the survivor's point of view.
export type MergeLine = { id: string; survivorId: string; mergedId: string; mergedAt: Date; undoneAt: Date | null };
export const active = (m: MergeLine) => m.undoneAt === null;
