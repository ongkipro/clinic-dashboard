// Labels & formatting helpers for /keuangan/mutasi (UX-22 ▸ Mutasi, PR-33f).
export const MUTASI_TITLE = "Mutasi Pembayaran";

// Exact unavailable copy required when gateway settlement facts do not exist (never Rp0, never "Rp").
export const SETTLEMENT_UNAVAILABLE =
  "Belum tersedia — data settlement dari penyedia pembayaran belum dicatat";

export const EMPTY_MUTASI = "Belum ada mutasi pada periode ini.";

const nf = new Intl.NumberFormat("id-ID");

export function rp(amount: number): string {
  return `${amount < 0 ? "−" : ""}Rp${nf.format(Math.abs(amount))}`;
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer Bank",
  qris: "QRIS",
  edc: "EDC",
  card: "Kartu",
  va: "Virtual Account",
  ewallet: "Dompet Digital",
  cash_refund: "Refund Tunai",
  dp_refund: "Refund DP Booking",
};

export function methodLabel(dim: string): string {
  return METHOD_LABELS[dim] ?? dim;
}

export const SOURCE_LABELS: Record<string, string> = {
  payment: "Pembayaran",
  refund: "Refund Tunai",
  booking_deposit: "Refund DP Booking",
};

export function sourceLabel(kind: string): string {
  return SOURCE_LABELS[kind] ?? kind;
}
