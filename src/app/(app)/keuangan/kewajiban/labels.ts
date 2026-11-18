// Labels of Piutang & Kewajiban Layanan (UX-22 ▸ Kewajiban; T-104). Clinic glossary; no store words.
import type { Ledger } from "../../../../modules/accounting/subledgers/subledgers";

export const LEDGER: Record<Ledger, string> = {
  paid_not_delivered: "Kewajiban layanan (dibayar belum diberikan)",
  package_liability: "Kewajiban paket",
  patient_balance: "Saldo pasien",
  booking_dp: "DP booking",
  receivables: "Piutang pasien",
  commission_payable: "Komisi terutang",
  vat: "PPN terutang",
  cash_bank: "Kas & Bank",
  gateway_clearing: "Kliring gateway",
  inter_branch: "Kliring antarcabang",
};
export const TERM: Record<string, string> = {
  settlement: "Pembayaran masuk", dp_applied: "DP diterapkan", receivable_convert: "Dialihkan ke piutang", performance: "Layanan diberikan",
  refund: "Refund", interrupted: "Tindakan terhenti ke saldo", redemption: "Sesi ditebus", substitution: "Selisih substitusi ke saldo", close: "Paket ditutup ke saldo",
  received: "Diterima", applied: "Diterapkan", moved: "Pindah ke saldo", forfeited: "Hangus", refunded: "Dikembalikan",
  created: "Piutang dibuat", collected: "Dilunasi", written_off: "Dihapusbukukan",
  accrued: "Komisi timbul", adjusted: "Penyesuaian", paid: "Dibayar",
  receipt: "Penerimaan", refund_dp: "Pengembalian DP", commission_paid: "Komisi dibayar", expense: "Biaya", expense_reversed: "Biaya dibatalkan",
  supplier_payment: "Bayar pemasok", supplier_payment_reversed: "Bayar pemasok dibatalkan",
  payment_vat: "PPN atas pembayaran", dp_vat: "PPN atas DP", dp_reversal: "Pembalikan PPN DP", refund_reversal: "Pembalikan PPN refund",
  session_delivery: "PPN saat sesi diberikan", package_sync_reversal: "Pembalikan PPN paket", package_close_line: "Pembalikan PPN selisih (paket ditutup)",
  package_close_package: "Pembalikan PPN paket ditutup", deposit_apply: "PPN DP diterapkan", cutover_residue: "Selisih sebelum cutover",
  session_attribution: "PPN paket ke sesi yang diberikan", refund_reversal_delivered: "Pembalikan PPN refund (sudah diberikan)",
  input_credited: "PPN masukan dikreditkan", line_delivery: "PPN saat layanan diberikan (sebelum bayar)", line_void: "Pembalikan PPN invoice dibatalkan",
  top_up: "Isi saldo", use: "Dipakai", from_expiry: "Dari paket kedaluwarsa", from_cancel: "Dari paket dibatalkan", from_interrupted_treatment: "Dari tindakan terhenti",
  from_substitution: "Dari substitusi", from_refund: "Dari refund", dp_transfer: "Dari DP", cash_refund: "Refund tunai", opening_balance: "Saldo awal",
};
export const DIM: Record<string, string> = { cash: "Tunai", petty_cash: "Kas kecil", bank: "Bank", qris: "QRIS", edc: "EDC", va: "Virtual account", payment_link: "Tautan bayar" };
export const CHECK: Record<string, string> = { stored_stock: "dicocokkan dengan saldo tercatat", object: "dicocokkan per objek", identity: "tanpa saldo pembanding" };
// the liabilities' VAT component terms ("vat_" + the VAT term)
export const termLabel = (t: string) => TERM[t] ?? (t.startsWith("vat_") ? `PPN: ${TERM[t.slice(4)] ?? t.slice(4)}` : t);
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const instant = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
