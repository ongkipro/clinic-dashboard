// Permintaan Klinis labels (UX-27, 19:93, PR-45; T-056): shared by the pages, the actions and the forms.
export const KIND_LABEL: Record<string, string> = { addition: "Tindakan Tambahan", plan_change: "Ubah Rencana", substitution: "Tukar Treatment" };
export const STATE: Record<string, { tone: "neutral" | "warning" | "success" | "danger"; label: string }> = {
  pending: { tone: "warning", label: "Menunggu" },
  approved: { tone: "success", label: "Disetujui" },
  declined: { tone: "danger", label: "Ditolak" },
  cancelled: { tone: "neutral", label: "Dibatalkan" },
};
export const ROLE_LABEL: Record<string, string> = {
  bc: "Beauty Consultant", doctor: "Dokter", nurse: "Perawat", therapist: "Terapis", facility_head: "Penanggung Jawab Klinik",
};
export const UNIT_LABEL: Record<string, string> = { unit: "unit", ml: "ml", mg: "mg", cm2: "cm²" };
export const PROPOSERS = new Set(["bc", "doctor", "nurse", "therapist"]);
export const READERS = new Set(["bc", "doctor", "nurse", "therapist", "facility_head", "records_officer"]);
// Integer rupiah, signed (display only).
export function rupiah(n: number): string {
  const s = new Intl.NumberFormat("id-ID").format(Math.abs(n));
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}Rp${s}`;
}
export function formatDose(micro: number): string {
  const int = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${int},${frac}` : String(int);
}
