// Katalog labels (UX-25). No server imports: used by server pages and the client form.
export const KIND_LABEL: Record<string, string> = { service: "Layanan", product: "Produk", package: "Paket", material: "Bahan (BHP)" };
export const TAX_LABEL: Record<string, string> = {
  exempt_medical: "Jasa medis (bebas PPN)",
  taxable_service: "Jasa kena pajak",
  taxable_goods: "Barang kena pajak",
  non_object: "Bukan objek pajak",
};
export const SCOPE_LABEL: Record<string, string> = { guiding_bc: "BC pendamping", closing_bc: "BC penutup", new_patient: "Pasien baru", performer: "Pelaksana" };
export const STATE_LABEL: Record<string, string> = {
  active: "Aktif",
  superseded: "Versi lama",
  pending_review: "Menunggu review",
  rejected: "Ditolak",
  cancelled: "Ditarik",
};
export const rupiah = (n: number) => `Rp${new Intl.NumberFormat("id-ID").format(n)}`;
