// KPI dictionary K1–K27 (PR-95, UX-59; docs/spec/02-PRD.md Appendix A). One versioned entry per KPI. `spec` is the Appendix A row
// verbatim (English, the contract; tests/reporting/reports.test.ts compares it with 02-PRD.md); the UI shows the Bahasa Indonesia
// fields. Markers are not sign-offs: `draf` = an interpretation awaiting the owner / finance owner (T-107 OWNER-SIGNOFF / AMBIGUITY
// notes and this task's own); `estimasi` = the value may rest on estimated consumption. A definition that a setting versions (SET-22)
// names it, so trend charts can mark "definisi berubah" (19 §2.13).
export type KpiId = `K${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27}`;
export type ReportId = "penjualan" | "perawatan" | "pasien" | "staf" | "operasional" | "stok" | "marketing";
export type Marker = { kind: "draf" | "estimasi"; note: string };
export type KpiEntry = {
  id: KpiId;
  label: string;
  definition: string;
  attribution: string;
  sources: string;
  version: number;
  versionedBy?: "SET-22";
  markers: Marker[];
  spec: { kpi: string; definition: string; attribution: string; sources: string };
};

const e = (
  id: KpiId, label: string, definition: string, attribution: string, sources: string,
  spec: [string, string, string, string], extra: { markers?: Marker[]; versionedBy?: "SET-22" } = {},
): KpiEntry => ({ id, label, definition, attribution, sources, version: 1, markers: extra.markers ?? [], versionedBy: extra.versionedBy,
  spec: { kpi: spec[0], definition: spec[1], attribution: spec[2], sources: spec[3] } });

export const DICTIONARY: readonly KpiEntry[] = [
  e("K1", "Uang masuk", "Pembayaran diterima − refund tunai, menurut tanggal bayar; pemakaian Saldo Pasien bukan uang masuk baru.",
    "Cabang tempat pembayaran", "Pembayaran, refund",
    ["Uang masuk", "Payments received − cash refunds, by payment date; balance usage is not new cash", "Branch where paid", "Payments, refunds"]),
  e("K2", "Layanan selesai", "Nilai tindakan yang dihitung + produk yang diserahkan + biaya konsultasi yang ditagihkan, menurut tanggal pelaksanaan, tanpa PPN.",
    "Cabang pelaksana", "Pelaksanaan tindakan, penyerahan",
    ["Layanan selesai", "Value of treatments counted + products handed over + consultation fees charged, by performance date, excl. VAT", "Executing branch", "Executions, handovers"],
    { markers: [{ kind: "draf", note: "Nilai Sesi Paket = nilai sesi teralokasi; biaya konsultasi dihitung saat ditagihkan (menunggu persetujuan owner keuangan)." }] }),
  e("K3", "Penjualan", "Nilai baris tagihan dan kontrak paket setelah diskon, tanpa PPN, menurut tanggal jual; dikurangi sisa paket belum dibayar yang dibatalkan (bulan pembatalan) dan nilai jual yang direfund, tunai atau saldo (bulan refund); tagihan batal tidak dihitung.",
    "Cabang penjual", "Baris tagihan, paket",
    ["Penjualan", "Invoice lines and package contract value after discount, excl. VAT, by sale date; reduced by cancelled unpaid package remainders in the month of cancellation and by refunded sale value (cash or balance) in the month of the refund; voided invoices excluded", "Selling branch", "Invoice lines, packages"]),
  e("K4", "Piutang", "Piutang Pasien + baris belum dibayar dari kunjungan yang sudah ditutup, umur 0–30/31–60/61–90/>90 hari; tanpa sisa paket belum dibayar dan tagihan terbuka dari kunjungan yang masih berjalan.",
    "Cabang tagihan", "Tagihan, piutang",
    ["Piutang", "Patient receivables + unpaid lines of closed visits, aged 0–30/31–60/61–90/>90; excludes unpaid package remainders and open bills of in-progress visits", "Branch of invoice", "Invoices, receivables"],
    { markers: [{ kind: "draf", note: "Titik awal umur baris belum dibayar dari kunjungan tertutup: tanggal kunjungan ditutup (perlu keputusan)." }] }),
  e("K5", "Kewajiban prabayar", "Sudah dibayar belum diberikan + kewajiban paket + Saldo Pasien + DP Booking; irisan kedaluwarsa hanya untuk paket.",
    "Tenant (tampilan cabang = tempat kewajiban timbul)", "Sub-ledger kewajiban",
    ["Kewajiban prabayar", "Paid-not-delivered + package liability + patient balance + booking DP; expiry slice for packages only", "Tenant (branch view = where liability arose)", "Liability sub-ledgers"]),
  e("K6", "Paket kedaluwarsa ke saldo", "Nilai yang sudah dibayar tetapi belum terpakai yang dipindah ke Saldo Pasien saat paket kedaluwarsa.",
    "Cabang penjual", "Peristiwa penutupan paket",
    ["Paket kedaluwarsa ke saldo", "Paid-unused value moved to balance at expiry", "Selling branch", "Package close events"]),
  e("K7", "Kontribusi", "K2 − biaya bahan − biaya produk (rata-rata bergerak) − komisi pelaksana (cabang pelaksana; komisi BC penjual/pembimbing tetap di cabang penjual, B-17); ditandai \"estimasi\" bila pemakaian bahan standar.",
    "Cabang pelaksana", "K2, pemakaian bahan, komisi",
    ["Kontribusi", "K2 − material cost − product cost (moving average) − performer commission (executing branch; selling/guiding BC commission stays at selling branch, B-17); marked \"estimasi\" where consumption is standard", "Executing branch", "K2, consumption, commission"],
    { markers: [{ kind: "estimasi", note: "Tindakan dengan bahan curah (pemakaian diperkirakan) ditandai estimasi; biaya yang belum lengkap ditampilkan \"biaya belum lengkap\", bukan 0." }] }),
  e("K8", "Konsultasi jadi pembelian", "Kunjungan konsultasi dengan pembelian yang memenuhi syarat pada kunjungan itu ÷ kunjungan konsultasi.",
    "Cabang kunjungan", "Kunjungan, tagihan",
    ["Konsultasi jadi pembelian", "Consultation visits with a qualifying purchase on that visit ÷ consultation visits", "Visit branch", "Visits, invoices"]),
  e("K9", "Rencana dipilih", "Item Rencana Perawatan yang dipilih ÷ yang direkomendasikan (jumlah dan nilai) dalam 30/60/90 hari.",
    "Cabang kunjungan", "Rencana Perawatan, pilihan",
    ["Rencana dipilih", "Plan items selected ÷ recommended (count and value) within 30/60/90 days", "Visit branch", "Plans, selections"]),
  e("K10", "Pasien baru vs kembali", "Kunjungan pertama di klinik vs kunjungan ulang.", "Cabang kunjungan", "Kunjungan",
    ["Pasien baru vs kembali", "First visit in tenant vs repeat", "Visit branch", "Visits"]),
  e("K11", "Kunjungan kedua", "Pasien baru dengan kunjungan kedua yang selesai dalam 60 hari ÷ pasien baru.", "Cabang kunjungan pertama", "Kunjungan",
    ["Kunjungan kedua", "New patients with a completed second visit within 60 days ÷ new patients", "First-visit branch", "Visits"],
    { versionedBy: "SET-22" }),
  e("K12", "Tidak datang / batal < 24 jam", "Tidak datang + batal kurang dari 24 jam ÷ janji yang dibuat.", "Cabang janji", "Janji",
    ["Tidak datang / batal < 24 jam", "No-shows + late cancels ÷ booked", "Booking branch", "Appointments"],
    { markers: [{ kind: "draf", note: "\"Janji yang dibuat\" = semua janji pada periode, termasuk batal lebih awal (menunggu persetujuan owner)." }] }),
  e("K13", "Konversi lead", "Lead → janji → datang → bayar, per sumber, cabang, dan petugas.", "Cabang lead", "Lead, janji, pembayaran",
    ["Konversi lead", "Lead → booked → arrived → paid, by source, branch, assignee", "Lead branch", "Leads, appointments, payments"]),
  e("K14", "Respons lead", "Median respons pertama; % dalam 15 menit pada jam buka.", "Cabang lead", "Waktu pesan",
    ["Respons lead", "Median first response; % within 15 min in opening hours", "Lead branch", "Message timestamps"],
    { markers: [{ kind: "draf", note: "Apakah median hanya mencakup lead yang masuk pada jam buka (perlu keputusan)." }] }),
  e("K15", "Utilisasi performer", "Menit dipesan atau dilaksanakan ÷ menit terjadwal.", "Cabang", "Jadwal, janji",
    ["Utilisasi performer", "Booked or executed minutes ÷ rostered minutes", "Branch", "Schedules, appointments"],
    { markers: [{ kind: "draf", note: "Per hari jadwal, diambil yang lebih besar antara menit dipesan dan dilaksanakan (menunggu persetujuan owner)." }] }),
  e("K16", "Lampiran produk", "Kunjungan tindakan dengan penjualan produk ÷ kunjungan tindakan.", "Cabang kunjungan", "Baris tagihan",
    ["Lampiran produk", "Treatment visits with a product sale ÷ treatment visits", "Visit branch", "Invoice lines"]),
  e("K17", "Komisi terutang", "Hak komisi − penyesuaian, per staf, peran, dan kontribusi, dengan status persetujuan.", "Cabang kontribusi", "Buku komisi",
    ["Komisi terutang", "Entitlements − adjustments by staff, role, contribution, with approval state", "Branch of contribution", "Commission ledger"],
    { markers: [{ kind: "draf", note: "\"Terutang\" tidak mencakup batch yang sudah dibayar (menunggu persetujuan owner)." }] }),
  e("K18", "Risiko stok", "Item di bawah minimum; batch kedaluwarsa dalam 30 hari; selisih hitung stok.", "Cabang", "Buku stok",
    ["Risiko stok", "Items below minimum; batches expiring within 30 days; count variance", "Branch", "Stock ledger"]),
  e("K19", "Target BC", "Nilai closing per bulan vs target; rencana yang dipilih seluruhnya.", "Cabang BC", "Target, atribusi",
    ["Target BC", "Closing value per month vs target; plans fully selected", "BC's branch", "Targets, attribution"]),
  e("K20", "Rata-rata transaksi", "K3 ÷ jumlah tagihan terbit dengan K3 > 0 pada periode (penjualan paket dihitung sekali saat dijual; pemakaian sesi, top-up, dan tagihan batal tidak dihitung; refund mengurangi K3 pada periode refund).",
    "Cabang penjual", "Tagihan",
    ["Rata-rata transaksi", "K3 ÷ number of issued invoices with K3 > 0 in the period (a package sale counts once at sale; redemptions, top-ups and voided invoices excluded; refunds reduce K3 in the refund period)", "Selling branch", "Invoices"],
    { markers: [{ kind: "draf", note: "Tagihan dihitung bila nilai jualnya saat terbit > 0; refund kemudian hanya mengurangi pembilang (menunggu persetujuan owner)." }] }),
  e("K21", "Churn", "Pasien dengan kunjungan dalam 12 bulan terakhir dan tanpa kunjungan dalam batas \"pasien lama tidak datang\" (SET-22) ÷ pasien aktif dalam 12 bulan terakhir.",
    "Cabang kunjungan terakhir", "Kunjungan",
    ["Churn", "Patients with a visit in the previous 12 months and none in the last SET-22 dormant days ÷ patients active in the previous 12 months", "Last-visit branch", "Visits"],
    { versionedBy: "SET-22" }),
  e("K22", "Pasien teratas / LTV", "K3 kumulatif per pasien sejak kunjungan pertama (setelah refund dan sisa paket belum dibayar yang dibatalkan, seperti K3; top-up dan pemakaian sesi tidak dihitung; pemakaian paket oleh keluarga dihitung pada pemilik paket).",
    "Cabang penjual", "Tagihan, refund",
    ["Pasien teratas / LTV", "Cumulative K3 per patient since first visit (net of refunds and cancelled unpaid package remainders as in K3; top-ups and redemptions excluded; family redemptions attributed to the package owner)", "Selling branch", "Invoices, refunds"]),
  e("K23", "Penjualan dan uang masuk per shift", "K3 dari tagihan yang terbit dalam shift dan K1 yang diterima dalam shift, ditampilkan berdampingan.",
    "Cabang shift", "Tagihan dan pembayaran yang terhubung ke shift",
    ["Penjualan dan uang masuk per shift", "K3 of invoices issued in the shift and K1 received in the shift, shown side by side", "Shift branch", "Invoices and payments with shift link"],
    { markers: [{ kind: "draf", note: "Refund dan sisa paket yang dibatalkan tidak dialokasikan ke shift; tagihan tanpa shift ditampilkan terpisah (menunggu persetujuan owner)." }] }),
  e("K24", "Waktu tunggu apotek", "Median waktu diserahkan − waktu masuk antrean per penyerahan obat/produk.", "Cabang", "Penyerahan",
    ["Waktu tunggu apotek", "Median handed_at − queued_at per dispensing", "Branch", "Dispensings"]),
  e("K25", "Performa kode promo", "Jumlah pemakaian, nilai diskon, dan K3 baris yang memakai kode, per versi kode.", "Cabang penjual", "Pemakaian promo",
    ["Performa kode promo", "Uses, discount value, K3 of lines with the code, per code version", "Selling branch", "Promo usages"]),
  e("K26", "Kepuasan", "Rata-rata skor survei dan % skor ≤ 2.", "Cabang kunjungan", "Survei",
    ["Kepuasan", "Average survey score and % ≤ 2", "Visit branch", "Surveys"]),
  e("K27", "Aktivitas dokter", "Per dokter dan periode: pemeriksaan yang ditandatangani, rekam belum ditandatangani lebih dari 24 jam, permintaan klinis yang diputuskan, median menit check-in → tanda tangan.",
    "Cabang kunjungan", "Rekam medis, permintaan klinis, kunjungan",
    ["Aktivitas dokter", "Per doctor and period: signed examinations, unsigned records older than 24 h, clinical requests decided, median minutes check-in → signature", "Visit branch", "Medical records, clinical requests, visits"]),
];

export const BY_ID: ReadonlyMap<KpiId, KpiEntry> = new Map(DICTIONARY.map((k) => [k.id, k]));
export const anchor = (id: KpiId) => id.toLowerCase();
export const DICTIONARY_ROUTE = "/laporan/kamus-kpi";
export const definitionHref = (id: KpiId) => `${DICTIONARY_ROUTE}#${anchor(id)}`;

// UX-38 reports (19 §2.13) and the KPIs each one shows; roles as the nav rows (src/components/shell/nav.ts "laporan" group).
// Laporan Audit is UX-53 (counts of voids, refunds, manual discounts) and carries no K row; Kirim Laporan Terjadwal is T-117.
export const REPORTS: Record<ReportId, { title: string; href: string; kpis: KpiId[] }> = {
  penjualan: { title: "Laporan Penjualan & Uang", href: "/laporan/penjualan", kpis: ["K1", "K2", "K3"] },
  perawatan: { title: "Laporan Perawatan", href: "/laporan/perawatan", kpis: ["K7"] },
  pasien: { title: "Laporan Pasien", href: "/laporan/pasien", kpis: ["K10", "K11", "K21", "K22"] },
  staf: { title: "Laporan Staf", href: "/laporan/staf", kpis: ["K15", "K17", "K19", "K27"] },
  operasional: { title: "Laporan Operasional", href: "/laporan/operasional", kpis: ["K12", "K20", "K23", "K24"] },
  stok: { title: "Laporan Stok", href: "/laporan/stok", kpis: ["K18"] },
  marketing: { title: "Laporan Marketing", href: "/laporan/marketing", kpis: ["K13", "K14", "K25", "K26"] },
};
export const reportsOf = (id: KpiId) => (Object.keys(REPORTS) as ReportId[]).filter((r) => REPORTS[r].kpis.includes(id));
