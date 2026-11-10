// Pendampingan labels (UX-7, PR-9; T-051): shared by the server pages, the actions and the client form. A plain
// module (a "use client" module's non-component exports reach a Server Component only as references).
export const FACT_LABEL: Record<string, string> = {
  allergy: "Alergi", medication: "Obat yang sedang dipakai", pregnancy: "Kehamilan / menyusui", condition: "Kondisi kesehatan",
  skincare: "Perawatan kulit di rumah", prior_treatment: "Perawatan sebelumnya", note: "Catatan lain",
};
export const FACT_ORDER = ["allergy", "medication", "pregnancy", "condition", "skincare", "prior_treatment", "note"] as const;
export const CHIP_LABEL: Record<string, string> = {
  kering: "Kering", berminyak: "Berminyak", kombinasi: "Kombinasi", kemerahan: "Kemerahan", jerawat_aktif: "Jerawat aktif", bekas_jerawat: "Bekas jerawat",
  flek: "Flek", pori_besar: "Pori besar", garis_halus: "Garis halus", sensitif: "Sensitif", iritasi: "Iritasi", lainnya: "Lainnya",
};
export const CHIP_ORDER = Object.keys(CHIP_LABEL);
// The four UX-7 steps from the visit's own step columns (T-051 builds step 1; the rest show their state).
export const STEP_STATE: Record<string, string> = {
  not_started: "Belum dimulai", in_progress: "Sedang berjalan", done: "Selesai", not_needed: "Tidak perlu", blocked: "Terhambat",
};
export const INTAKE_STATE: Record<string, { tone: "neutral" | "warning" | "success"; label: string }> = {
  none: { tone: "neutral", label: "Belum dimulai" },
  draft: { tone: "warning", label: "Draf" },
  sent: { tone: "success", label: "Terkirim ke dokter" },
};
export const REFUSAL: Record<string, string> = {
  score_field: "Observasi Kulit hanya berupa pilihan dan catatan. Nilai, skor atau tipe kulit tidak boleh diisi.",
  diagnosis_forbidden: "Diagnosis hanya diisi dokter.",
  sign_forbidden: "Tanda tangan rekam medis hanya oleh dokter.",
};
