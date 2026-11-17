// Konsol Vendor › Tagihan Server labels (UX-43; T-103). Codes from the database mapped to Indonesian; an unknown code shows as itself.
import s from "../_lib/console.module.css";

export const INVOICE: Record<string, { label: string; tone: string }> = {
  issued: { label: "Belum lunas", tone: s.toneWarning }, paid: { label: "Lunas", tone: s.toneSuccess },
  waived: { label: "Dibebaskan", tone: s.toneNeutral }, credited: { label: "Dikreditkan", tone: s.toneNeutral },
};
export const ATTEMPT: Record<string, string> = {
  creating: "Sedang dibuat", pending: "Menunggu pembayaran", unknown: "Hasil belum pasti", paid: "Terbayar", expired: "Kedaluwarsa", failed: "Gagal dibuat",
};
export const ADVICE: Record<string, string> = {
  pending: "Belum dibayar", settled: "Lunas (aturan terkonfirmasi)", settled_unconfirmed: "Tampak lunas — aturan belum dikonfirmasi",
  expired: "Kedaluwarsa (aturan terkonfirmasi)", expired_unconfirmed: "Tampak kedaluwarsa — aturan belum dikonfirmasi", failed: "Gagal (aturan terkonfirmasi)",
  failed_unconfirmed: "Tampak gagal — aturan belum dikonfirmasi", amount_mismatch: "Nominal berbeda", envelope_error: "Jawaban bukan sukses",
  unrecognized: "Status tidak dikenal", transport_error: "Tidak ada jawaban",
};
export const REVIEW: Record<string, string> = {
  advice_unconfirmed: "Jawaban Advice perlu konfirmasi pemetaan (Q-13)", amount_mismatch: "Nominal Advice berbeda dari tagihan",
  attempt_unknown: "Hasil pembuatan pembayaran belum pasti", tax_status_unknown: "Tagihan tertahan: status pajak vendor belum dikonfirmasi",
};
export const CREDIT: Record<string, string> = { waiver: "Pembebasan", credit: "Kredit", overpayment: "Kelebihan bayar", exit_remainder: "Sisa periode keluar" };
export const REQUEST: Record<string, string> = { server_fee_change: "Perubahan biaya server", invoice_waiver: "Pembebasan / kredit tagihan" };
export const REQUEST_STATE: Record<string, { label: string; tone: string }> = {
  pending: { label: "Menunggu persetujuan", tone: s.toneWarning }, approved: { label: "Disetujui", tone: s.toneSuccess },
  rejected: { label: "Ditolak", tone: s.toneDanger }, cancelled: { label: "Dibatalkan", tone: s.toneNeutral },
};
export const REMINDER: Record<string, string> = { due: "jatuh tempo", plus7: "+7 hari", plus14: "+14 hari" };
export const rupiah = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });
const fmtT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
export const day = (v: string) => fmt.format(new Date(v));
export const when = (v: string) => fmtT.format(new Date(v));
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const period = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
