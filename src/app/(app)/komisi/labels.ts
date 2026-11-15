// Labels of Komisi (UX-16; T-087).
import type { StatusTone } from "../../../components/ui/status-badge";

export const TYPE: Record<string, string> = { closing_bc: "BC closing", guiding_bc: "BC pendamping", new_patient: "Pasien baru", performer: "Pelaksana" };
export const BATCH: Record<string, [string, StatusTone]> = {
  draft: ["Draf", "neutral"], pending_approval: ["Menunggu persetujuan", "warning"], approved: ["Disetujui", "locked"], paid: ["Dibayar", "success"],
};
export const VERSION: Record<string, [string, StatusTone]> = {
  draft: ["Draf", "warning"], active: ["Berlaku", "success"], superseded: ["Diganti", "neutral"], cancelled: ["Dibatalkan", "neutral"],
};
export const CAUSE: Record<string, string> = {
  refund: "Refund", interrupted: "Tindakan dihentikan", package_close: "Paket ditutup", substitution: "Substitusi lebih murah", write_off: "Hapus buku", attribution: "Koreksi atribusi",
};
export const RECEIVABLE: Record<string, [string, StatusTone]> = { open: ["Terbuka", "warning"], settled: ["Lunas", "success"], waived: ["Dihapuskan", "neutral"] };
export const ROLE: Record<string, string> = {
  bc: "BC", doctor: "Dokter", nurse: "Perawat", therapist: "Terapis", fo_cashier: "FO/Kasir", central_cs: "CS Pusat", pharmacist: "Apoteker", manager: "Manajer Cabang",
};
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const value = (v: { kind: string; basis_points: number | null; fixed_amount: number | null }) =>
  v.kind === "fixed" ? rp(Number(v.fixed_amount)) : `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(v.basis_points) / 100)}%`;
export const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso));
export const month = (key: string) =>
  new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
