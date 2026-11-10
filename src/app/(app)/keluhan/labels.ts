// Keluhan labels (UX-28, 19:93, PR-43; T-057): shared by the pages, the actions and the forms.
type Tone = "neutral" | "warning" | "success" | "danger";
export const KIND_LABEL: Record<string, string> = { klinis: "Klinis", layanan: "Layanan" };
export const TRIAGE: Record<string, { tone: Tone; label: string }> = {
  merah: { tone: "danger", label: "Merah" },
  kuning: { tone: "warning", label: "Kuning" },
  hijau: { tone: "success", label: "Hijau" },
};
export const TRIAGE_HINT: Record<string, string> = {
  merah: "Merah: dugaan komplikasi berat, ditangani dalam hitungan menit.",
  kuning: "Kuning: perlu ditangani hari ini.",
  hijau: "Hijau: keluhan ringan, ditangani dalam jam kerja.",
};
export const CATEGORY_LABEL: Record<string, string> = { waktu_tunggu: "Waktu tunggu", tagihan: "Tagihan", sikap_staf: "Sikap staf", lainnya: "Lainnya" };
export const STATE: Record<string, { tone: Tone; label: string }> = {
  open: { tone: "warning", label: "Baru" },
  in_progress: { tone: "neutral", label: "Ditangani" },
  resolved: { tone: "success", label: "Selesai" },
};
export const SOURCE_LABEL: Record<string, string> = { visit_note: "Catatan kunjungan", staff_flag: "Laporan staf", pharmacist: "Laporan apoteker", message: "Pesan pasien" };
export const OUTCOME_LABEL: Record<string, string> = {
  kontrol_gratis: "Kontrol gratis", edukasi: "Edukasi pasien", resep_tambahan: "Resep tambahan", rujuk: "Dirujuk",
  penjelasan: "Penjelasan kepada pasien", jadwal_ulang: "Jadwal ulang", eskalasi_tagihan: "Diteruskan ke keuangan", pembinaan_staf: "Pembinaan staf", lainnya: "Lainnya",
};
export const KLINIS_OUTCOMES = ["kontrol_gratis", "edukasi", "resep_tambahan", "rujuk", "jadwal_ulang", "lainnya"] as const;
export const LAYANAN_OUTCOMES = ["penjelasan", "jadwal_ulang", "eskalasi_tagihan", "pembinaan_staf", "kontrol_gratis", "lainnya"] as const;
export const EVENT_LABEL: Record<string, string> = {
  flagged: "Dilaporkan", taken: "Mulai ditangani", triaged: "Triase diubah", note: "Catatan", resolved: "Diselesaikan", reopened: "Dibuka kembali", escalated: "Melewati target, diteruskan",
};
export const ROLE_LABEL: Record<string, string> = {
  fo_cashier: "FO/Kasir", central_cs: "CS Pusat", bc: "Beauty Consultant", doctor: "Dokter", nurse: "Perawat", pharmacist: "Apoteker",
  facility_head: "Penanggung Jawab Klinik", manager: "Manajer Cabang",
};
// Who handles which kind (DEC-066); the database decides, the pages only choose segments and controls.
export const HANDLES: Record<string, readonly ("klinis" | "layanan")[]> = {
  doctor: ["klinis"], nurse: ["klinis"], pharmacist: ["klinis"], facility_head: ["klinis", "layanan"], manager: ["layanan"],
};
export const FLAGGERS = new Set(["fo_cashier", "central_cs", "bc", "doctor", "nurse", "pharmacist", "facility_head", "manager"]);
