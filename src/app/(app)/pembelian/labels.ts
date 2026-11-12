// Pembelian copy (UX-52; T-067): segments, states, reasons in Bahasa Indonesia; money in rupiah.
import type { StatusTone } from "../../../components/ui/status-badge";
import type { InvoiceState, PoState } from "../../../modules/purchasing/payables/payables";
import type { ReturnReason } from "../../../modules/purchasing/suppliers/suppliers";

export const READERS = new Set(["owner", "admin_pusat", "finance", "purchasing", "auditor", "manager", "pharmacist"]);
type Seg = "pemasok" | "po" | "penerimaan" | "retur" | "transfer" | "utang";
// Segment visibility per role (UX-52; r1 decision 9): finance sees Utang only; the pharmacist PO, Penerimaan, Retur,
// Transfer (no money); manager and auditor everything they may read.
const SEGS: Record<Seg, { label: string; roles: string[] }> = {
  pemasok: { label: "Pemasok", roles: ["owner", "admin_pusat", "purchasing", "auditor", "manager", "pharmacist"] },
  po: { label: "PO", roles: ["owner", "admin_pusat", "purchasing", "auditor", "manager", "pharmacist"] },
  penerimaan: { label: "Penerimaan", roles: ["owner", "admin_pusat", "purchasing", "auditor", "manager", "pharmacist"] },
  retur: { label: "Retur", roles: ["owner", "admin_pusat", "purchasing", "auditor", "manager", "pharmacist"] },
  transfer: { label: "Transfer", roles: ["owner", "admin_pusat", "purchasing", "auditor", "manager", "pharmacist"] },
  utang: { label: "Utang", roles: ["owner", "admin_pusat", "finance", "purchasing", "auditor", "manager"] },
};
export const canSee = (role: string, s: Seg) => SEGS[s].roles.includes(role);
export const SEGMENTS = (role: string, active: Seg, q = "") =>
  (Object.keys(SEGS) as Seg[]).filter((s) => canSee(role, s)).map((s) => ({ label: SEGS[s].label, href: `/pembelian/${s}${q}`, active: s === active }));
export const HOME = (role: string) => (role === "finance" ? "/pembelian/utang" : "/pembelian/po");

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
export const rp = (n: number | null | undefined) => (n == null ? "—" : idr.format(Number(n)));
export const qty = (n: number | string) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(Number(n));
export const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+07:00` : iso));

export const PO_STATE: Record<PoState, { label: string; tone: StatusTone }> = {
  draft: { label: "Draf", tone: "neutral" }, sent: { label: "Terkirim", tone: "warning" }, partially_received: { label: "Diterima sebagian", tone: "warning" },
  received: { label: "Diterima", tone: "success" }, cancelled: { label: "Dibatalkan", tone: "locked" },
};
export const INVOICE_STATE: Record<InvoiceState, { label: string; tone: StatusTone }> = {
  open: { label: "Belum lunas", tone: "warning" }, paid: { label: "Lunas", tone: "success" }, reversed: { label: "Dibatalkan", tone: "locked" },
};
export const RETURN_REASON: Record<ReturnReason, string> = {
  expired: "Kedaluwarsa", near_expiry: "Hampir kedaluwarsa", damaged: "Rusak", recalled: "Ditarik produsen", wrong_item: "Salah kirim", quality: "Mutu tidak sesuai", other: "Lainnya",
};
export const TRANSFER_STATE: Record<string, { label: string; tone: StatusTone }> = {
  posted: { label: "Selesai", tone: "success" }, sent: { label: "Dalam pengiriman", tone: "warning" }, received: { label: "Diterima", tone: "success" },
  cancelled: { label: "Dibatalkan", tone: "locked" },
};
export const METHOD: Record<string, string> = { cash: "Tunai", bank_transfer: "Transfer bank" };
