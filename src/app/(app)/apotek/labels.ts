// Siapkan & Serahkan copy (UX-10; T-065): state, blocker, check and label words in Bahasa Indonesia.
import type { Blocker, Check, DispensingState } from "../../../modules/pharmacy/pharmacy";

export const READERS = new Set(["pharmacist"]);
export const SEGMENTS = (active: "siapkan" | "serahkan") => [
  { label: "Siapkan", href: "/apotek/siapkan", active: active === "siapkan" },
  { label: "Serahkan", href: "/apotek/serahkan", active: active === "serahkan" },
];
export const BLOCKER_LABEL: Record<Blocker, string> = {
  prescription_unsigned: "Resep belum ditandatangani",
  prescription_expired: "Resep sudah melewati masa berlaku",
  payment_unpaid: "Belum dibayar",
  special_item: "Obat khusus (narkotika/psikotropika) tidak dapat diserahkan",
  stock_unavailable: "Batch kedaluwarsa, ditahan, atau stok tidak cukup",
  no_recipe: "Tindakan ini tanpa resep bahan",
  recipe_unmapped: "Resep bahan belum dipetakan ke item stok",
  room_depot_missing: "Depot ruang belum diatur",
};
export const STATE_LABEL: Record<DispensingState, string> = { queued: "Menunggu disiapkan", prepared: "Siap diserahkan", handed: "Diserahkan", cancelled: "Dibatalkan" };
export const CHECK_LABEL: Record<Check, string> = {
  identity: "Identitas pasien dan penulis resep",
  validity: "Keabsahan resep",
  dose: "Dosis, rute, dan frekuensi",
  allergy: "Alergi dan interaksi",
  clarification: "Hasil klarifikasi",
  label: "Etiket",
  counselling: "Konseling",
};
export const DEPOT_KIND: Record<string, string> = { apotek: "Apotek", gudang: "Gudang", ruang: "Ruang" };
