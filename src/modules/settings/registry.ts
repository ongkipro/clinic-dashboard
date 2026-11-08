// Settings registry (PR-38, 19 §5, B-24, P-22): every SET-1–SET-49 row with its group,
// scope, value spec and bounds, researched default and its source, who changes it directly
// and who may only draft it for an approver (07 "Tenant/branch settings"). This file is
// the single source: migration 0028 seeds `setting_defs` from it (tests/settings keep the
// two equal). Adding a setting needs a decision (B-24) and a SET row in 19 §5.
//
// Two kinds of rows:
// - value: the value lives here, versioned (setting_versions), edited in Pengaturan;
// - ref:   the setting is structured data owned by another module (hours, branch prices,
//          commission rules, templates, delegation, consent texts, ...); the registry
//          keeps its default, bounds and changers and Pengaturan links to the owning page.
// Class F rules (19 §5 "Fixed rules", PLAN CD-*) are never here.
import type { Role } from "../../auth/policy";
import type { Spec, Value } from "./spec";

export const GROUPS = [
  { slug: "klinik", label: "Klinik & Cabang" },
  { slug: "layanan", label: "Layanan & Harga" },
  { slug: "uang", label: "Uang & Kasir" },
  { slug: "pajak", label: "Pajak" },
  { slug: "jadwal", label: "Jadwal & Booking" },
  { slug: "antrean", label: "Antrean" },
  { slug: "komunikasi", label: "Komunikasi & Otomasi" },
  { slug: "crm", label: "CRM" },
  { slug: "komisi", label: "Komisi" },
  { slug: "stok", label: "Stok" },
  { slug: "klinis", label: "Klinis" },
  { slug: "dokumen", label: "Dokumen" },
  { slug: "akses", label: "Pengguna & Akses" },
  { slug: "privasi", label: "Privasi" },
  { slug: "situs", label: "Situs Klinik" },
  { slug: "laporan", label: "Laporan" },
] as const;
export type GroupSlug = (typeof GROUPS)[number]["slug"];

// Where a default comes from (19 §5 "Default provenance").
export type Source = { kind: "research" | "decision" | "tenant"; ref: string };

// A draft by `by` waits for `approver` (approvals engine, types setting_change_owner /
// setting_change_fh). The approver decides in Persetujuan; the decision applies the draft.
export type Draft = { by: Role; approver: "owner" | "facility_head" };

export type SettingDef = {
  key: string; // "SET-8"
  group: GroupSlug;
  label: string;
  scope: "tenant" | "branch";
  changers: Role[]; // change directly
  drafts: Draft[]; // may only propose
  note?: string; // a short rule shown under the row (fixed parts, where the per-item value lives)
} & (
  | { kind: "value"; spec: Spec; default: Value; source: Source }
  | { kind: "ref"; defaultText: string; boundsText: string; href: string; owner: string }
);

const I = (min: number, max: number, unit: string): Spec => ({ t: "int", min, max, unit });
const O = (of: Spec, off = "Nonaktif"): Spec => ({ t: "opt", of, off });
const obj = (f: [string, string, Spec][], lt?: [string, string][], le?: [string, string][]): Spec => ({ t: "obj", f: f.map(([k, l, s]) => ({ k, l, s })), ...(lt ? { lt } : {}), ...(le ? { le } : {}) });
const P25: Source = { kind: "decision", ref: "P-25" };
// Admin Pusat drafts money rows for the owner (07). Admin Pusat drafts of tenant-wide
// clinical rows wait for a decision on which facility head decides them (the facility head
// is branch-scoped); until then the facility head changes clinical rows directly (DEC-026).
const AP_TO_OWNER: Draft[] = [{ by: "admin_pusat", approver: "owner" }];

export const SETTINGS: SettingDef[] = [
  {
    key: "SET-1", group: "klinik", label: "Profil klinik (nama tampil, warna aksen)", scope: "tenant", changers: ["owner", "admin_pusat"], drafts: [],
    kind: "value",
    spec: obj([["nama", "Nama tampil", O({ t: "text", min: 2, max: 60, hint: "2–60 karakter" }, "Nama PT")], ["aksen", "Warna aksen", { t: "accent" }]]),
    default: { nama: null, aksen: "#0A6E86" }, source: { kind: "decision", ref: "D-16" },
    note: "Logo diunggah di Situs Klinik (UI-8). Aksen diterima bila kontras ≥ 4,5:1 (UI-2).",
  },
  { key: "SET-2", group: "klinik", label: "Jam buka, hari libur, tutup khusus", scope: "branch", changers: ["admin_pusat", "manager"], drafts: [], kind: "ref", defaultText: "Dari onboarding", boundsText: "Rentang jam yang valid", href: "/pengaturan/cabang/jam", owner: "Jam Operasional & Libur" },
  { key: "SET-3", group: "klinik", label: "Zona waktu cabang", scope: "branch", changers: ["admin_pusat"], drafts: [], kind: "ref", defaultText: "Kota cabang (WIB/WITA/WIT)", boundsText: "Zona Indonesia", href: "/pengaturan/cabang", owner: "Data Cabang" },
  { key: "SET-46", group: "klinik", label: "Data izin klinik per cabang (nomor izin, NIB, penanggung jawab, ID SATUSEHAT)", scope: "branch", changers: ["owner", "admin_pusat"], drafts: [], kind: "ref", defaultText: "Isian onboarding", boundsText: "Wajib sebelum layanan klinis berjalan", href: "/pengaturan/cabang", owner: "Data Cabang" },

  {
    key: "SET-4", group: "layanan", label: "Durasi default persiapan, tindakan, jeda", scope: "tenant", changers: ["admin_pusat"], drafts: [],
    kind: "value", spec: obj([["persiapan", "Persiapan", I(0, 120, "menit")], ["tindakan", "Tindakan", I(5, 480, "menit")], ["jeda", "Jeda", I(0, 120, "menit")]]),
    default: { persiapan: 10, tindakan: 30, jeda: 10 }, source: P25, note: "Durasi per layanan diatur di Master Layanan.",
  },
  { key: "SET-5", group: "layanan", label: "Harga cabang (override)", scope: "branch", changers: ["owner"], drafts: [], kind: "ref", defaultText: "Harga normal", boundsText: "> 0 (gratis hanya lewat diskon atau pembebasan)", href: "/katalog/harga-cabang", owner: "Katalog › Harga Cabang" },

  {
    key: "SET-6", group: "uang", label: "Biaya konsultasi", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: O({ t: "rupiah", min: 1 }, "Belum diisi"), default: null, source: { kind: "tenant", ref: "onboarding" },
    note: "Aturan pembebasan biaya konsultasi tetap (B-02).",
  },
  {
    key: "SET-7", group: "uang", label: "Kontrol gratis per item", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: obj([["jumlah", "Jumlah kontrol", I(0, 5, "kali")], ["hari", "Berlaku sampai tanggal kontrol +", I(0, 30, "hari")]]),
    default: { jumlah: 1, hari: 7 }, source: { kind: "decision", ref: "CD-02" },
  },
  {
    key: "SET-8", group: "uang", label: "Masa berlaku paket default", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: I(30, 1095, "hari"), default: 365, source: { kind: "decision", ref: "CD-03" }, note: "Templat paket boleh berbeda.",
  },
  {
    key: "SET-9", group: "uang", label: "DP minimum paket default, cicilan diizinkan default", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: obj([["dp_minimum", "DP minimum", O(I(0, 100, "%"), "Kosong")], ["cicilan", "Cicilan", { t: "bool", on: "Diizinkan", off: "Tidak diizinkan" }]]),
    default: { dp_minimum: null, cicilan: true }, source: { kind: "decision", ref: "CD-04, CD-05" }, note: "Templat paket boleh berbeda.",
  },
  {
    key: "SET-10", group: "uang", label: "DP booking & batas ubah jadwal", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: obj([["dp_booking", "DP booking", { t: "bool" }], ["batas_ubah", "Batas ubah jadwal", I(0, 72, "jam")]]),
    default: { dp_booking: false, batas_ubah: 24 }, source: { kind: "decision", ref: "CD-06" }, note: "Nilai per layanan diatur di Master Layanan.",
  },
  {
    key: "SET-11", group: "uang", label: "Penyetuju refund tunai", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: { t: "enum", of: [{ v: "owner", l: "Owner" }, { v: "owner_manager", l: "Owner + Manajer" }] }, default: "owner", source: { kind: "decision", ref: "CD-08" },
  },
  {
    key: "SET-12", group: "uang", label: "Batas diskon manual per peran", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value",
    spec: obj([["fo_persen", "FO/Kasir", I(0, 100, "%")], ["manajer_persen", "Manajer (persen)", I(0, 100, "%")], ["manajer_rupiah", "Manajer (rupiah)", { t: "rupiah", min: 0 }]]),
    default: { fo_persen: 0, manajer_persen: 10, manajer_rupiah: 500_000 }, source: { kind: "decision", ref: "CD-37" }, note: "Persen dan rupiah dihitung, yang lebih kecil berlaku. Owner tanpa batas.",
  },
  {
    key: "SET-13", group: "uang", label: "Ambang selisih kas untuk eskalasi ke owner", scope: "branch", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: { t: "rupiah", min: 0, max: 1_000_000 }, default: 50_000, source: P25, note: "Setiap selisih selalu perlu persetujuan manajer (BILL-18).",
  },
  {
    key: "SET-14", group: "uang", label: "Metode bayar aktif, provider, masa berlaku link bayar", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value",
    spec: obj([
      ["metode", "Metode bayar", { t: "list", min: 1, max: 5, unique: true, of: { t: "enum", of: [{ v: "tunai", l: "Tunai" }, { v: "qris", l: "QRIS" }, { v: "edc", l: "EDC" }, { v: "transfer", l: "Transfer" }, { v: "saldo", l: "Saldo" }] } }],
      ["provider", "Provider", { t: "enum", of: [{ v: "mock", l: "Mock (belum ada mitra)" }] }],
      ["link_jam", "Masa berlaku link bayar", I(1, 72, "jam")],
    ]),
    default: { metode: ["tunai", "qris", "edc", "transfer", "saldo"], provider: "mock", link_jam: 24 }, source: { kind: "decision", ref: "CD-39, P-25" },
    note: "Biaya per metode (MDR) ditanggung klinik.",
  },
  {
    key: "SET-41", group: "uang", label: "Cicilan maksimum, tanggal mundur", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: obj([["cicilan_maks", "Cicilan maksimum", O(I(2, 24, "kali"), "Tanpa batas")], ["mundur", "Tanggal mundur (dengan persetujuan)", I(0, 3, "hari")]]),
    default: { cicilan_maks: null, mundur: 1 }, source: { kind: "decision", ref: "B-03, P-25" }, note: "Kelompok umur piutang tetap: 0–30, 31–60, 61–90, > 90 hari.",
  },
  {
    key: "SET-43", group: "uang", label: "Matriks persetujuan: void, selisih opname, PO, pemusnahan", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value",
    spec: obj([
      ["void", "Penyetuju void", { t: "enum", of: [{ v: "manajer_hari_sama", l: "Manajer di hari yang sama, setelahnya owner" }, { v: "owner", l: "Selalu owner" }] }],
      ["selisih_opname", "Ambang selisih opname", I(0, 100, "%")],
      ["po_owner", "PO perlu owner mulai", { t: "rupiah", min: 0 }],
      ["musnah_kedua_kejadian", "Pemusnahan: persetujuan kedua mulai (per kejadian)", { t: "rupiah", min: 0 }],
      ["musnah_kedua_bulan", "Pemusnahan: persetujuan kedua mulai (per bulan)", { t: "rupiah", min: 0 }],
      ["musnah_owner", "Pemusnahan: owner mulai", { t: "rupiah", min: 0 }],
    ], undefined, [["musnah_kedua_kejadian", "musnah_owner"], ["musnah_kedua_kejadian", "musnah_kedua_bulan"]]),
    default: { void: "manajer_hari_sama", selisih_opname: 2, po_owner: 10_000_000, musnah_kedua_kejadian: 1_000_000, musnah_kedua_bulan: 5_000_000, musnah_owner: 10_000_000 },
    source: { kind: "decision", ref: "PRD §4, CD-21" }, note: "Pengaju tidak pernah menyetujui permintaannya sendiri.",
  },
  {
    key: "SET-49", group: "uang", label: "Perpanjangan paket oleh manajer", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: I(0, 90, "hari"), default: 90, source: { kind: "decision", ref: "19 §5 SET-49" }, note: "Paling banyak satu kali per paket; 0 = tidak diizinkan.",
  },

  { key: "SET-39", group: "pajak", label: "Status PKP dan tanggal efektif; kategori pajak per item; pembulatan", scope: "tenant", changers: ["owner"], drafts: [], kind: "ref", defaultText: "Non-PKP sampai ada bukti; pembulatan ke rupiah", boundsText: "PKP perlu catatan saran pajak (PR-24); tarif PPN tetap", href: "/kepatuhan", owner: "Register Kepatuhan" },

  { key: "SET-15", group: "jadwal", label: "Lepas slot bila terlambat", scope: "branch", changers: ["manager"], drafts: [], kind: "value", spec: O(I(5, 60, "menit")), default: null, source: { kind: "decision", ref: "CD-09, D-05" }, note: "Hanya melepas slot; sesi tidak pernah dipotong karena terlambat (BILL-24)." },
  {
    key: "SET-16", group: "jadwal", label: "Booking online: horizon, batas H-, DP pasien baru", scope: "branch", changers: ["admin_pusat"], drafts: [],
    kind: "value", spec: obj([["horizon", "Horizon", I(1, 90, "hari")], ["batas", "Batas sebelum jadwal", I(0, 48, "jam")], ["dp_pasien_baru", "DP wajib pasien baru", { t: "bool" }]]),
    default: { horizon: 30, batas: 2, dp_pasien_baru: false }, source: P25, note: "Layanan yang bisa dibooking online ditandai di Master Layanan.",
  },
  { key: "SET-17", group: "jadwal", label: "Tahan slot saat bayar DP", scope: "tenant", changers: ["admin_pusat"], drafts: [], kind: "value", spec: I(5, 30, "menit"), default: 10, source: { kind: "research", ref: "§10.3" } },
  { key: "SET-38", group: "jadwal", label: "Peringatan pasien menunggu", scope: "branch", changers: ["manager"], drafts: [], kind: "value", spec: I(5, 120, "menit"), default: 20, source: P25 },

  {
    key: "SET-40", group: "antrean", label: "Prefiks nomor, panggilan suara, orientasi TV", scope: "branch", changers: ["manager"], drafts: [],
    kind: "value",
    spec: obj([
      ["prefiks_loket", "Prefiks loket", { t: "text", min: 1, max: 3, pattern: "^[A-Z]{1,3}$", hint: "1–3 huruf kapital" }],
      ["prefiks_ruang", "Prefiks ruang", { t: "text", min: 1, max: 3, pattern: "^[A-Z]{1,3}$", hint: "1–3 huruf kapital" }],
      ["suara", "Panggilan suara", { t: "bool" }],
      ["orientasi", "Orientasi TV", { t: "enum", of: [{ v: "landscape", l: "Mendatar" }, { v: "portrait", l: "Tegak" }] }],
    ]),
    default: { prefiks_loket: "A", prefiks_ruang: "B", suara: false, orientasi: "landscape" }, source: P25, note: "Layar antrean tidak pernah menampilkan nama pasien.",
  },

  {
    key: "SET-18", group: "komunikasi", label: "Jam kirim pengingat janji", scope: "branch", changers: ["admin_pusat"], drafts: [],
    kind: "value", spec: obj([["h1", "H-1 pukul", { t: "time", min: "07:00", max: "21:00" }], ["sebelum", "Hari H, sebelum jadwal", I(1, 12, "jam")]]),
    default: { h1: "10:00", sebelum: 2 }, source: { kind: "decision", ref: "CD-36" }, note: "Tidak ada pesan pukul 21:00–07:00 waktu cabang.",
  },
  {
    key: "SET-19", group: "komunikasi", label: "Skenario otomasi pesan", scope: "tenant", changers: ["admin_pusat"], drafts: [],
    kind: "value",
    spec: obj([
      ["aftercare", "Aftercare (H+)", O(I(0, 60, "hari"))],
      ["kepuasan", "Tindak lanjut kepuasan (H+)", O(I(0, 60, "hari"))],
      ["rencana", "Tindak lanjut rencana (H+)", O(I(0, 60, "hari"))],
      ["belum_jadwal", "Belum ada jadwal (H+)", O(I(0, 60, "hari"))],
      ["pengingat", "Pengingat janji (H-)", O(I(0, 60, "hari"))],
      ["isi_ulang", "Isi ulang produk (H- perkiraan habis)", O(I(0, 60, "hari"))],
      ["ulang_tahun", "Ucapan ulang tahun", { t: "bool" }],
      ["batas_harian", "Batas pesan per pasien", I(1, 5, "pesan/hari")],
    ]),
    default: { aftercare: 1, kepuasan: 7, rencana: 14, belum_jadwal: 21, pengingat: 3, isi_ulang: 5, ulang_tahun: false, batas_harian: 2 },
    source: { kind: "decision", ref: "P-25" }, note: "Isi ulang hanya untuk pasien yang setuju menerima pesan pemasaran.",
  },
  { key: "SET-20", group: "komunikasi", label: "SLA respons lead", scope: "tenant", changers: ["owner"], drafts: [], kind: "value", spec: I(5, 120, "menit"), default: 15, source: { kind: "decision", ref: "CD-24" }, note: "Dihitung pada jam buka." },
  { key: "SET-21", group: "komunikasi", label: "Batas kirim harian WhatsApp", scope: "tenant", changers: ["owner"], drafts: [], kind: "value", spec: I(10, 90, "% batas Meta"), default: 80, source: { kind: "decision", ref: "CD-27" } },
  { key: "SET-42", group: "komunikasi", label: "Penugasan percakapan baru", scope: "tenant", changers: ["admin_pusat"], drafts: [], kind: "value", spec: { t: "enum", of: [{ v: "manual", l: "Manual" }, { v: "bergilir", l: "Bergilir per cabang" }] }, default: "manual", source: P25 },

  {
    key: "SET-22", group: "crm", label: "Jendela kunjungan kedua / pasien lama tidak datang", scope: "tenant", changers: ["owner"], drafts: [],
    kind: "value", spec: obj([["kunjungan_kedua", "Kunjungan kedua", I(14, 365, "hari")], ["tidak_datang", "Tidak datang", I(14, 365, "hari")]], [["kunjungan_kedua", "tidak_datang"]]),
    default: { kunjungan_kedua: 60, tidak_datang: 90 }, source: { kind: "decision", ref: "CD-23" }, note: "Mengubahnya membuat versi baru definisi KPI (K11).",
  },
  { key: "SET-23", group: "crm", label: "Pengingat paket hampir habis", scope: "tenant", changers: ["admin_pusat"], drafts: [], kind: "value", spec: { t: "list", min: 1, max: 3, desc: true, of: I(1, 90, "hari") }, default: [30, 14, 7], source: { kind: "research", ref: "PR-30" } },

  { key: "SET-24", group: "komisi", label: "Aturan & nilai komisi", scope: "tenant", changers: ["owner"], drafts: [], kind: "ref", defaultText: "Belum ada sampai owner mengisi", boundsText: "Per aturan", href: "/komisi/aturan", owner: "Komisi › Aturan" },
  {
    key: "SET-25", group: "komisi", label: "Metrik target BC, periode target", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value",
    spec: obj([["metrik", "Metrik", { t: "enum", of: [{ v: "closing_rencana", l: "Nilai closing/bulan + rencana terpilih penuh" }] }], ["periode", "Periode", { t: "enum", of: [{ v: "bulanan", l: "Bulanan" }, { v: "triwulan", l: "Triwulan" }] }]]),
    default: { metrik: "closing_rencana", periode: "bulanan" }, source: { kind: "decision", ref: "CD-25" },
  },
  {
    key: "SET-44", group: "komisi", label: "Hari tutup batch komisi bulanan", scope: "tenant", changers: ["owner"], drafts: AP_TO_OWNER,
    kind: "value", spec: { t: "oneof", of: [{ k: "month_end", l: "Akhir bulan" }, { k: "day", l: "Tanggal", s: I(1, 28, "") }] },
    default: { k: "month_end" }, source: { kind: "decision", ref: "BILL-15" }, note: "Basis, akrual dan siklus bulanan tetap (BILL-15).",
  },

  { key: "SET-26", group: "stok", label: "Stok minimum/target per item per cabang", scope: "branch", changers: ["pharmacist", "purchasing"], drafts: [], kind: "ref", defaultText: "Kosong sampai diisi", boundsText: "≥ 0", href: "/stok", owner: "Stok" },
  {
    key: "SET-27", group: "stok", label: "Jadwal hitung stok; peringatan hampir kedaluwarsa", scope: "branch", changers: ["manager", "pharmacist"], drafts: [],
    kind: "value",
    spec: obj([
      ["nilai_tinggi", "Hitung item nilai tinggi", { t: "enum", of: [{ v: "harian", l: "Harian" }, { v: "mingguan", l: "Mingguan" }, { v: "bulanan", l: "Bulanan" }] }],
      ["lainnya", "Hitung item lain", { t: "enum", of: [{ v: "harian", l: "Harian" }, { v: "mingguan", l: "Mingguan" }, { v: "bulanan", l: "Bulanan" }] }],
      ["kedaluwarsa", "Peringatan hampir kedaluwarsa", I(7, 180, "hari")],
    ]),
    default: { nilai_tinggi: "mingguan", lainnya: "bulanan", kedaluwarsa: 30 }, source: { kind: "decision", ref: "CD-22, K18" }, note: "Vial terbuka dan toksin selalu dihitung harian (CD-22).",
  },

  { key: "SET-28", group: "klinis", label: "Templat catatan per perawatan", scope: "tenant", changers: ["facility_head"], drafts: [], kind: "ref", defaultText: "Templat riset §5.2, ditinjau penanggung jawab klinik", boundsText: "Berversi; kolom RME wajib tidak bisa dihapus", href: "/templat-catatan", owner: "Templat Catatan" },
  {
    key: "SET-29", group: "klinis", label: "Protokol foto (sudut)", scope: "tenant", changers: ["facility_head"], drafts: [],
    kind: "value",
    spec: { t: "list", min: 1, max: 6, unique: true, of: { t: "enum", of: [{ v: "depan", l: "Depan" }, { v: "serong_45", l: "Serong 45°" }, { v: "samping", l: "Samping" }, { v: "atas", l: "Atas" }, { v: "bawah", l: "Bawah (dagu)" }, { v: "dekat", l: "Close-up area" }] } },
    default: ["depan", "serong_45", "samping"], source: { kind: "decision", ref: "CD-18" },
  },
  { key: "SET-30", group: "klinis", label: "Matriks delegasi", scope: "tenant", changers: ["facility_head", "owner"], drafts: [], note: "Penanggung jawab klinik dan owner, dua orang berbeda.", kind: "ref", defaultText: "Matriks bawaan RG-16 (CD-16)", boundsText: "Hanya lebih sempit dari tabel hukum; tidak pernah melewati cek kredensial", href: "/layanan", owner: "Master Layanan › Staf & Delegasi" },
  {
    key: "SET-31", group: "klinis", label: "Target respons keluhan klinis (triase)", scope: "tenant", changers: ["facility_head"], drafts: [],
    kind: "value", spec: obj([["merah", "Merah", I(5, 60, "menit")], ["kuning", "Kuning", I(30, 240, "menit")], ["hijau", "Hijau", I(4, 24, "jam kerja")]], [["merah", "kuning"]]),
    default: { merah: 15, kuning: 120, hijau: 8 }, source: { kind: "decision", ref: "CD-33" },
  },
  { key: "SET-31.layanan", group: "klinis", label: "Target respons keluhan layanan", scope: "tenant", changers: ["owner"], drafts: [], kind: "value", spec: I(1, 24, "jam kerja"), default: 8, source: { kind: "decision", ref: "CD-40" }, note: "Bagian layanan dari SET-31: 19 §5 memberi owner bagian ini (DEC-026)." },
  { key: "SET-47", group: "klinis", label: "Masa berlaku persetujuan tindakan", scope: "tenant", changers: ["facility_head"], drafts: [], kind: "value", spec: I(30, 365, "hari"), default: 90, source: { kind: "decision", ref: "19 §5 SET-47" }, note: "Di luar batas tindakan, area atau jumlah wajib persetujuan ulang." },
  {
    key: "SET-48", group: "klinis", label: "Masa berlaku resep; jeda isi ulang; penyerahan sebagian", scope: "tenant", changers: [], drafts: [{ by: "pharmacist", approver: "facility_head" }],
    // 19 §5: "Pharmacist proposes, facility head approves (both required)": the facility
    // head decides proposals and does not change the row alone.
    kind: "value",
    spec: obj([["masa", "Masa berlaku", I(3, 90, "hari")], ["masa_akut", "Masa berlaku resep akut", I(3, 90, "hari")], ["jeda", "Jeda isi ulang", I(50, 95, "% perkiraan hari pakai")], ["sebagian", "Penyerahan sebagian", I(1, 4, "kali")]]),
    default: { masa: 30, masa_akut: 7, jeda: 75, sebagian: 4 }, source: { kind: "decision", ref: "19 §5 SET-48" }, note: "Apoteker mengusulkan, penanggung jawab klinik menyetujui.",
  },

  { key: "SET-32", group: "dokumen", label: "Templat struk, persetujuan, surat, halaman legal; ukuran kertas struk", scope: "tenant", changers: ["admin_pusat", "facility_head"], drafts: [], kind: "ref", defaultText: "Templat vendor (UX-54); 80 mm", boundsText: "Berversi; kolom legal dan klinis wajib tidak bisa dihapus; 58/80 mm/A4", href: "/templat-dokumen", owner: "Templat Dokumen" },
  { key: "SET-33", group: "dokumen", label: "Format nomor RM, invoice, PO", scope: "tenant", changers: ["admin_pusat"], drafts: [], kind: "ref", defaultText: "Prefiks cabang + tahun + urut", boundsText: "Prefiks dan pemisah saja; urutan tanpa celah dan tidak dipakai ulang", href: "/templat-dokumen", owner: "Templat Dokumen" },

  { key: "SET-34", group: "akses", label: "Peran per staf, cabang", scope: "tenant", changers: ["owner", "admin_pusat"], drafts: [], kind: "ref", defaultText: "Undangan", boundsText: "Matriks 07; peran Level 2 perlu persetujuan owner; tidak ada yang mengubah perannya sendiri", href: "/staf", owner: "Staf & Undangan" },
  {
    key: "SET-35", group: "akses", label: "Batas waktu sesi perangkat non-FO; metode tanda tangan klinis", scope: "tenant", changers: ["owner"], drafts: [],
    kind: "value", spec: obj([["batas_sesi", "Batas waktu sesi", I(5, 60, "menit")], ["tanda_tangan", "Tanda tangan klinis", { t: "enum", of: [{ v: "pin", l: "PIN" }, { v: "otp", l: "OTP" }] }]]),
    default: { batas_sesi: 15, tanda_tangan: "pin" }, source: P25, note: "Kunci layar FO/Kasir tetap 120 detik (IAM-7).",
  },

  { key: "SET-45", group: "privasi", label: "Teks dan tujuan persetujuan (versi)", scope: "tenant", changers: ["owner"], drafts: [], kind: "ref", defaultText: "Templat vendor per tujuan (PRIV-1)", boundsText: "Tujuan dari daftar tetap; masa simpan tetap menurut hukum", href: "/privasi", owner: "Privasi & Persetujuan" },

  { key: "SET-36", group: "situs", label: "Bagian situs aktif, harga tampil per perawatan", scope: "tenant", changers: ["admin_pusat", "marketing"], drafts: [], kind: "ref", defaultText: "Semua bagian aktif; harga tidak tampil", boundsText: "Aktif/nonaktif", href: "/situs", owner: "Situs Klinik" },

  {
    key: "SET-37", group: "laporan", label: "Ringkasan harian ke owner, penerima laporan terjadwal", scope: "tenant", changers: ["owner"], drafts: [],
    kind: "value",
    spec: obj([
      ["ringkasan", "Ringkasan harian pukul", O({ t: "time", min: "17:00", max: "23:00" })],
      ["penerima", "Penerima laporan terjadwal", { t: "list", min: 1, max: 4, unique: true, of: { t: "enum", of: [{ v: "owner", l: "Owner" }, { v: "admin_pusat", l: "Admin Pusat" }, { v: "finance", l: "Keuangan" }, { v: "manager", l: "Manajer" }] } }],
    ]),
    default: { ringkasan: null, penerima: ["owner"] }, source: P25,
  },
];

// 07 "Tenant/branch settings": the owner is ● (full) — it changes every row the 19 §5
// "Changed by" column gives to other roles, except rows whose rule needs two different
// people (SET-48 proposals; SET-30 already names the owner with the facility head). The
// registry above lists 19 §5's own changers; the owner is added here so both sources stay
// readable.
const OWNER_EXCLUDED = new Set(["SET-48"]);
for (const s of SETTINGS) if (!OWNER_EXCLUDED.has(s.key) && !s.changers.includes("owner")) s.changers = [...s.changers, "owner"];

export const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const groupOf = (slug: string) => GROUPS.find((g) => g.slug === slug);
