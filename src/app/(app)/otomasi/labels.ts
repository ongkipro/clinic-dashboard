// Otomasi, Pengingat & Aftercare (UX-55; T-097): copy and codes.
export const SCENARIOS: [string, string, string][] = [
  ["pengingat", "Pengingat janji", "H- (hari sebelum janji)"],
  ["aftercare", "Aftercare", "H+ (hari setelah kunjungan)"],
  ["kepuasan", "Tindak lanjut kepuasan", "H+"],
  ["rencana", "Tindak lanjut rencana", "H+"],
  ["belum_jadwal", "Belum ada jadwal", "H+"],
  ["isi_ulang", "Isi ulang produk", "H- (sebelum perkiraan habis)"],
];
export const SCENARIO_LABEL: Record<string, string> = Object.fromEntries([...SCENARIOS.map(([k, l]) => [k, l]), ["ulang_tahun", "Ucapan ulang tahun"]]);
export const STATE_FILTERS: [string, string][] = [["all", "Semua"], ["queued", "Antre"], ["sent", "Terkirim"], ["capped", "Batas tercapai"], ["skipped", "Dilewati"]];
export const DELIVERY: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  queued: { label: "Antre", tone: "neutral" }, sending: { label: "Mengirim", tone: "neutral" }, sent: { label: "Terkirim", tone: "success" },
  failed: { label: "Gagal", tone: "danger" }, skipped: { label: "Dilewati", tone: "warning" },
};
export const SKIP: Record<string, string> = {
  cap_horizon_exceeded: "Batas pesan per pasien tercapai selama 7 hari",
  no_consent: "Tanpa persetujuan pemasaran",
  patient_phone_required: "Nomor telepon pasien belum ada",
  number_not_sending: "Nomor WhatsApp klinik belum dapat mengirim",
  template_not_usable: "Templat belum disetujui",
  template_missing: "Templat belum ada",
};
export const CAPPED = "Batas pesan per pasien tercapai";
export const AFTERCARE_PENDING = "Teks aftercare belum direview klinis";
export const day = (d: string | null) => (d ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : "—");
