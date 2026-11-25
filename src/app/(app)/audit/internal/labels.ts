// Labels & exact unavailable copy for /audit/internal (UX-53, PR-63, PR-72).
export const AUDIT_INTERNAL_TITLE = "Audit Internal";

// Exact unavailable states per contract (no numbers, no Rp, no empty-list copy).
export const APPROVALS_UNAVAILABLE =
  "Belum tersedia — daftar persetujuan untuk auditor belum ada pembacanya";
export const SUSPICIOUS_COMPOSITE_UNAVAILABLE =
  "Belum tersedia — aturan aktivitas mencurigakan belum ditetapkan";
export const EXPORT_UNAVAILABLE = "Ekspor belum tersedia";
export const STOCK_COUNT_WINDOW_NOTE = "Hitung stok 60 hari terakhir";
export const NAME_UNAVAILABLE = "Belum tersedia";

const nf = new Intl.NumberFormat("id-ID");

export function rp(amount: number): string {
  return `${amount < 0 ? "−" : ""}Rp${nf.format(Math.abs(amount))}`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export const DISCOUNT_STATE_LABELS: Record<string, string> = {
  within_limit: "Dalam batas",
  pending: "Menunggu persetujuan",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

export const REFUND_STATE_LABELS: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  paid: "Dibayar",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
  failed: "Gagal",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin_pusat: "Admin Pusat",
  manager: "Manajer Cabang",
  fo_cashier: "Kasir / FO",
  finance: "Keuangan",
  auditor: "Auditor Internal",
  doctor: "Dokter",
  nurse: "Perawat",
  therapist: "Terapis",
  pharmacist: "Apoteker",
};

export const roleLabel = (r: string | null | undefined) => (r ? (ROLE_LABELS[r] ?? r) : NAME_UNAVAILABLE);
