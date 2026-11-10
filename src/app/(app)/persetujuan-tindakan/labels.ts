// Persetujuan Tindakan labels (UX-39, 19:89, PR-11; T-054): shared by the pages, the actions and the forms.
export const CONSENT_STATE: Record<string, { tone: "neutral" | "warning" | "success" | "danger"; label: string }> = {
  none: { tone: "warning", label: "Belum ada persetujuan" },
  active: { tone: "success", label: "Disetujui" },
  outdated: { tone: "danger", label: "Perlu persetujuan ulang" },
};
export const HISTORY_STATE: Record<string, string> = { active: "Berlaku", superseded: "Digantikan", withdrawn: "Ditarik" };
export const SIGNER_LABEL: Record<string, string> = { patient: "Pasien", guardian: "Wali" };
export const RELATION_LABEL: Record<string, string> = { ayah: "Ayah", ibu: "Ibu", wali: "Wali", lainnya: "Lainnya" };
export const ROLE_LABEL: Record<string, string> = { doctor: "Dokter", nurse: "Perawat" };
export const UNIT_LABEL: Record<string, string> = { unit: "unit", ml: "ml", mg: "mg", cm2: "cm²" };
export function formatDose(micro: number): string {
  const int = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${int},${frac}` : String(int);
}
