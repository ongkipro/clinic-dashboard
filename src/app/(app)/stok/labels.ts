// Stok labels (UX-11; T-060). Copy in Bahasa Indonesia; clinic glossary (never store words).
import type { StatusTone } from "../../../components/ui/status-badge";

export const READERS = new Set(["owner", "admin_pusat", "finance", "purchasing", "auditor", "manager", "pharmacist"]);
// /stok lands on the role's first useful segment (plan P3-1).
export const HOME: Record<string, string> = {
  admin_pusat: "/stok/item", owner: "/stok/item", finance: "/stok/item", pharmacist: "/stok/kartu", purchasing: "/stok/kartu", auditor: "/stok/kartu",
  manager: "/stok/opname",
};
export const SEGMENTS = (active: string, q = "") => [
  { label: "Item", href: `/stok/item${q}`, active: active === "item" },
  { label: "Kartu", href: `/stok/kartu${q}`, active: active === "kartu" },
  { label: "Batch", href: `/stok/batch${q}`, active: active === "batch" },
  { label: "Hitung", href: `/stok/opname${q}`, active: active === "opname" },
];
export const KIND_LABEL: Record<string, string> = { material: "Bahan (BHP)", product: "Produk" };
export const STORAGE_LABEL: Record<string, string> = { ruang: "Suhu ruang", sejuk: "Sejuk (8–15 °C)", dingin: "Dingin (2–8 °C)" };
export const MOVE_LABEL: Record<string, string> = {
  receive: "Terima", adjust: "Penyesuaian", issue: "Keluar ke ruang", consume: "Dipakai", return: "Kembali", waste: "Terbuang",
  transfer_out: "Transfer keluar", transfer_in: "Transfer masuk", supplier_return: "Retur pemasok", dispense: "Diserahkan",
};
export const REASON_LABEL: Record<string, string> = { stok_awal: "Stok awal", penerimaan: "Penerimaan" };
export const UNFIT_LABEL: Record<string, string> = {
  expired: "Kedaluwarsa", recalled: "Ditarik", quarantined: "Karantina", temperature_excursion: "Suhu menyimpang", vial_lapsed: "Lewat batas pakai",
};
export const BATCH_STATE: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Aktif", tone: "success" }, quarantined: { label: "Karantina", tone: "warning" },
  temperature_excursion: { label: "Suhu menyimpang", tone: "warning" }, recalled: { label: "Ditarik", tone: "danger" },
};
export const COUNT_STATE: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Sedang dihitung", tone: "neutral" }, pending_approval: { label: "Menunggu persetujuan", tone: "warning" },
  applied: { label: "Diterapkan", tone: "success" }, rejected: { label: "Ditolak", tone: "danger" }, cancelled: { label: "Dibatalkan", tone: "locked" },
};
export const ROLE_LABEL: Record<string, string> = {
  pharmacist: "Apoteker", purchasing: "Pembelian", manager: "Manajer", owner: "Owner", admin_pusat: "Admin Pusat",
};
const num = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });
export const qty = (n: number | null | undefined, unit?: string) => (n === null || n === undefined ? "—" : `${num.format(n)}${unit ? ` ${unit}` : ""}`);
export const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
