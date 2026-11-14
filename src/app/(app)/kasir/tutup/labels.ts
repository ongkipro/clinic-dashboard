// Tutup Kasir copy (UX-15; T-085): states, tenders and the variance in Bahasa Indonesia; money in integer rupiah.
import type { StatusTone } from "../../../../components/ui/status-badge";

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
export const rp = (n: number | null | undefined) => (n == null ? "—" : idr.format(Number(n)).replace(/\s/g, ""));
export const signed = (n: number) => (n === 0 ? "Tidak ada selisih" : `Selisih ${n < 0 ? "−" : "+"}${rp(Math.abs(n))}`);
export const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
export const SHIFT_STATE: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Terbuka", tone: "neutral" }, pending_approval: { label: "Menunggu persetujuan", tone: "warning" },
  recount: { label: "Hitung ulang", tone: "danger" }, closed: { label: "Selesai", tone: "success" },
};
export const TENDER: Record<string, string> = { cash: "Tunai", qris: "QRIS", edc: "EDC", transfer: "Transfer", va: "VA", payment_link: "Link", balance: "Saldo" };
// Non-cash tenders are expected, not counted (owner decision 2).
export const TENDER_NOTE: Record<string, string> = {
  edc: "Cocokkan dengan slip EDC", transfer: "Cocokkan dengan mutasi bank", qris: "Dicocokkan Keuangan", va: "Dicocokkan Keuangan", payment_link: "Dicocokkan Keuangan",
  balance: "Bukan uang laci",
};
export const ROLE: Record<string, string> = { owner: "Owner", manager: "Manajer", fo_cashier: "Kasir", finance: "Keuangan" };
export const SEGMENTS = [["", "Semua"], ["open", "Terbuka"], ["pending_approval", "Menunggu"], ["recount", "Hitung Ulang"], ["closed", "Selesai"]] as const;
