// Saya › Tagihan Server labels (UX-49; T-103).
export const INVOICE: Record<string, { label: string; tone: "warning" | "success" | "neutral" | "danger" }> = {
  issued: { label: "Belum lunas", tone: "warning" }, paid: { label: "Lunas", tone: "success" }, waived: { label: "Dibebaskan", tone: "neutral" },
  credited: { label: "Dikreditkan", tone: "neutral" },
};
export const ATTEMPT: Record<string, string> = {
  creating: "Sedang dibuat", pending: "Menunggu pembayaran", unknown: "Menunggu kepastian dari AutoLaris", paid: "Terbayar", expired: "Kedaluwarsa",
  failed: "Gagal dibuat",
};
export const CREDIT: Record<string, string> = { waiver: "Pembebasan", credit: "Kredit", overpayment: "Kelebihan bayar", exit_remainder: "Sisa periode" };
export const CHANNEL: Record<string, string> = { QRIS: "QRIS", VABNI: "VA Bank BNI", VAMANDIRI: "VA Bank Mandiri", VABCA: "VA Bank BCA", VABRI: "VA Bank BRI", VAPERMATA: "VA Bank Permata" };
export const rupiah = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });
const fmtT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
export const day = (s: string) => fmt.format(new Date(s));
export const when = (s: string) => fmtT.format(new Date(s));
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const period = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
