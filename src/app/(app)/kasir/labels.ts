// Kasir copy (UX-12; T-072): tenders, states, refusals in Bahasa Indonesia (clinic glossary: Tagihan, Struk, Bayar;
// never store words); money in integer rupiah.
import type { StatusTone } from "../../../components/ui/status-badge";
import type { TenderMethod } from "../../../modules/cashier/kasir/kasir";
import type { TaxCategory } from "../../../modules/tax/policy";

export const READERS = new Set(["owner", "manager", "fo_cashier", "finance", "auditor"]);
export const PAYERS = new Set(["owner", "manager", "fo_cashier", "finance"]);
export const VOIDERS = new Set(["fo_cashier", "manager", "finance"]);
// Jual Cepat is the front office's (19:112); owner, finance and manager reach it from the Kasir too.
export const COUNTER = new Set(["owner", "manager", "fo_cashier", "finance"]);

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
export const rp = (n: number | null | undefined) => (n == null ? "—" : idr.format(Number(n)).replace(/\s/g, ""));
export const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
export const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

export const TENDER: Record<TenderMethod, string> = { cash: "Tunai", qris: "QRIS", edc: "EDC", transfer: "Transfer", va: "VA", payment_link: "Link", balance: "Saldo" };
export const TENDER_BLOCKED: Record<string, { reason: string; unblock: string }> = {
  payment_port: { reason: "Belum tersedia — menunggu port pembayaran", unblock: "Owner dapat menghubungkan mitra pembayaran di Pengaturan" },
  balance: { reason: "Saldo pasien belum aktif", unblock: "Gunakan Tunai, EDC, atau Transfer" },
  method_disabled: { reason: "Metode ini dimatikan", unblock: "Owner dapat menyalakannya di Pengaturan › Uang & Kasir" },
};
export const TAX_BADGE: Record<TaxCategory, string> = { taxable_service: "PPN", taxable_goods: "PPN", exempt_medical: "Bebas PPN", non_object: "Bukan objek PPN" };
export const STATE: Record<"draft" | "issued" | "void", { label: string; tone: StatusTone }> = {
  draft: { label: "Draf", tone: "neutral" }, issued: { label: "Diterbitkan", tone: "warning" }, void: { label: "Dibatalkan", tone: "locked" },
};
export const payState = (total: number, outstanding: number, state: string): { label: string; tone: StatusTone } =>
  state === "void" ? STATE.void : outstanding === 0 ? { label: "Lunas", tone: "success" } : outstanding < total ? { label: "Sebagian", tone: "warning" } : { label: "Belum dibayar", tone: "warning" };
export const SEGMENTS = (active: "kasir" | "terbuka" | "jual-cepat", role: string, q = "") => [
  { label: "Siap Ditagih", href: `/kasir${q}`, active: active === "kasir" },
  { label: "Tagihan Terbuka", href: `/kasir/terbuka${q}`, active: active === "terbuka" },
  ...(COUNTER.has(role) ? [{ label: "Jual Cepat", href: `/kasir/jual-cepat${q}`, active: active === "jual-cepat" }] : []),
];
export const patientLabel = (p: { name: string | null; mrn: string } | null) => (p ? `${p.name ?? "Pasien"} · ${p.mrn}` : "Penjualan langsung");
export const FLAG: Record<string, string> = {
  paid_after_expiry: "dibayar setelah kedaluwarsa", paid_after_failed: "dibayar setelah gagal atau dibatalkan", paid_after_cash: "dibayar setelah lunas tunai",
  amount_mismatch: "jumlah tidak sama",
};

