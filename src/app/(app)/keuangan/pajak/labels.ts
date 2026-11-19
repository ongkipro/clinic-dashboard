// Labels of Pajak ▸ Coretax (UX-22 ▸ Pajak; T-106). Clinic glossary; no store words.
import type { DocKind, Refusal } from "../../../../modules/accounting/coretax/coretax";

export const DOC: Record<DocKind, { title: string; file: string; detail: string }> = {
  retail: { title: "Faktur digunggung (konsumen akhir)", file: "coretax-digunggung",
    detail: "Satu baris per item tagihan PKP yang terbit di masa ini; pembeli dicatat sebagai konsumen akhir tanpa identitas pasien. Format DJP RetailInvoiceBulk (Lampiran I.A.5, I.A.9, I.B)." },
  faktur: { title: "Faktur dengan identitas pembeli", file: "coretax-faktur",
    detail: "Untuk pembeli yang meminta faktur atas NPWP/NIK-nya. Klinik belum mencatat identitas pajak pembeli, jadi dokumen ini berisi kerangka TaxInvoiceBulk tanpa faktur (ListOfTaxInvoice kosong)." },
  retur: { title: "Retur pajak keluaran", file: "coretax-retur",
    detail: "Satu baris per refund yang dibayar di masa ini dan membalik PPN, merujuk nomor invoice asal. Format DJP OutputSpecialDocReturn." },
  pembatalan: { title: "Daftar pembatalan", file: "coretax-pembatalan",
    detail: "Item tagihan PKP yang dibatalkan di masa ini. Bila terbit di masa sebelumnya, batalkan manual di Coretax memakai nomor seri yang tercantum. Ini daftar internal klinik, bukan format impor DJP." },
};
export const REFUSED: Record<Refusal, string> = {
  bad_period: "Masa pajak tidak valid",
  future_period: "Masa pajak belum berjalan",
  npwp_missing: "NPWP klinik belum diisi",
  not_pkp: "Klinik bukan PKP pada masa ini",
  gate_closed: "Bukti saran pajak belum disetujui",
  discount_pending: "Masih ada diskon manual yang menunggu persetujuan",
  bounds_exceeded: "Dokumen melebihi batas yang didukung (1.000.000 baris atau DPP/PPN Rp1.000.000.000.000.000)",
  empty: "Tidak ada baris untuk dokumen ini pada masa ini",
};
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const masa = (p: string) => new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p}-01T00:00:00Z`));
export const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
