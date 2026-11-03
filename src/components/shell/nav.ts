// Clinic app navigation (PR-86, 19 §2, NAV-1–NAV-8). One tree; each acting role sees only
// the pages its 07 permissions allow (pages it cannot use are absent, never disabled).
// Pages reached only from a record (Lembar Pemeriksaan, Resep, Surat, Profil Pasien, ...)
// are not menu entries; their entry points are. Routes are filled in by the tasks that
// build each page; until then a menu link leads to the not-found page.
import type { Role } from "../../auth/policy";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin_pusat: "Admin Pusat",
  manager: "Manajer",
  facility_head: "Penanggung Jawab Klinik",
  records_officer: "Perekam Medis",
  fo_cashier: "FO/Kasir",
  central_cs: "CS Pusat",
  bc: "BC",
  doctor: "Dokter",
  nurse: "Perawat",
  therapist: "Terapis",
  pharmacist: "Apoteker",
  finance: "Keuangan",
  marketing: "Marketing",
  purchasing: "Pembelian",
  auditor: "Auditor Internal",
};

const ABBR: Record<string, Role> = {
  O: "owner", AP: "admin_pusat", M: "manager", FH: "facility_head", RO: "records_officer",
  FO: "fo_cashier", CS: "central_cs", BC: "bc", D: "doctor", N: "nurse", T: "therapist",
  PH: "pharmacist", F: "finance", MK: "marketing", PU: "purchasing", AU: "auditor",
};

export type NavPage = { id: string; label: string; href: string; roles: readonly Role[] };
export type NavGroup = { id: string; label: string; pages: readonly NavPage[] };

type Row = [id: string, label: string, href: string, roles: string];
const page = ([id, label, href, roles]: Row): NavPage => ({
  id,
  label,
  href,
  roles: roles.split(" ").map((r) => {
    const role = ABBR[r];
    if (!role) throw new Error(`unknown role ${r} on ${id}`);
    return role;
  }),
});
const group = (id: string, label: string, rows: Row[]): NavGroup => ({ id, label, pages: rows.map(page) });

// 19 §2.1–§2.15 and §2.17, in menu order. Role lists follow each row's Roles column.
export const NAV: readonly NavGroup[] = [
  group("dashboard", "Dashboard", [
    ["ringkasan-owner", "Ringkasan Owner", "/ringkasan/owner", "O"],
    ["ringkasan-ap", "Ringkasan Admin Pusat", "/ringkasan/admin-pusat", "AP"],
    ["ringkasan-cabang", "Ringkasan Cabang", "/ringkasan/cabang", "M O AP"],
    ["ringkasan-cs", "Ringkasan CS", "/ringkasan/cs", "CS"],
    ["pasienku", "Pasienku", "/pasienku", "BC"],
    ["ringkasan-klinis", "Ringkasan Klinis", "/ringkasan/peran", "FH"],
    ["papan-klinik", "Papan Klinik", "/hari-ini/papan", "FO M"],
    ["ringkasan-marketing", "Ringkasan Marketing", "/ringkasan/peran", "MK"],
    ["ringkasan-apotek", "Ringkasan Apotek", "/ringkasan/peran", "PH"],
    ["ringkasan-pembelian", "Ringkasan Pembelian", "/ringkasan/peran", "PU"],
    ["ringkasan-audit", "Ringkasan Audit", "/ringkasan/peran", "AU"],
    ["ruang-saya", "Ruang Saya", "/ringkasan/peran", "N T"],
  ]),
  group("front-office", "Front Office", [
    ["hari-ini", "Hari Ini", "/hari-ini", "FO M"],
    ["pendaftaran", "Pendaftaran Pasien", "/pasien/baru", "FO CS"],
    ["antrean", "Antrean", "/antrean", "FO"],
    ["check-in", "Check-in / Check-out", "/hari-ini/check-in", "FO"],
  ]),
  group("jadwal", "Jadwal & Reservasi", [
    ["kalender", "Kalender", "/jadwal", "FO CS M D N T"],
    ["daftar-reservasi", "Daftar Reservasi", "/jadwal/daftar", "FO CS"],
    ["booking-online", "Booking Online Masuk", "/jadwal/online", "FO CS"],
    ["daftar-tunggu", "Daftar Tunggu", "/jadwal/tunggu", "FO CS"],
    ["jadwal-praktik", "Jadwal Praktik", "/jadwal-staf", "M AP"],
    ["jam-operasional", "Jam Operasional & Libur", "/pengaturan/cabang/jam", "AP"],
    ["ruang-alat", "Ruang, Bed & Alat", "/pengaturan/cabang/ruang", "AP M"],
  ]),
  group("pasien", "Pasien", [
    ["daftar-pasien", "Daftar Pasien", "/pasien", "O AP M FH RO FO CS BC D N T PH F MK"],
    ["gabung-data", "Gabung Data Ganda", "/pasien/gabung", "RO"],
    ["keluarga", "Keluarga / Wali", "/pasien/keluarga", "FO"],
    ["impor-pasien", "Impor Pasien", "/pasien/impor", "O"],
  ]),
  group("klinis", "Klinis", [
    ["antrean-dokter", "Antrean Dokter", "/pemeriksaan", "D"],
    ["pendampingan", "Pendampingan", "/pendampingan", "BC"],
    ["persetujuan-tindakan", "Persetujuan Tindakan", "/persetujuan-tindakan", "D"],
    ["permintaan-klinis", "Permintaan Klinis", "/permintaan", "D N T"],
    ["keluhan", "Keluhan", "/keluhan", "D N T PH FH M"],
    ["koreksi-rm", "Koreksi Rekam Medis", "/persetujuan/koreksi", "RO FH"],
    ["insiden", "Insiden Keselamatan Pasien", "/keluhan/insiden", "FH"],
  ]),
  group("ruang", "Ruang Tindakan", [
    ["ruang", "Ruang", "/ruang", "N T D"],
    ["logbook", "Logbook Alat, Sterilisasi & Limbah", "/logbook", "N M"],
  ]),
  group("kasir", "Kasir", [
    ["kasir", "Kasir", "/kasir", "FO M O F AU"],
    ["jual-cepat", "Jual Cepat", "/kasir/jual-cepat", "FO"],
    ["tagihan-terbuka", "Tagihan Terbuka", "/kasir/terbuka", "FO"],
    ["paket-saldo", "Paket & Saldo", "/kasir/paket-saldo", "FO"],
    ["piutang", "Piutang & Refund", "/piutang", "FO O F"],
    ["tutup-kasir", "Tutup Kasir", "/kasir/tutup", "FO M"],
  ]),
  group("paket", "Paket & Promo", [
    ["master-layanan", "Master Layanan", "/layanan", "AP O FH PH"],
    ["templat-paket", "Templat Paket", "/layanan/paket", "AP O"],
    ["kode-promo", "Kode Promo & Voucher", "/situs/promo", "MK AP"],
  ]),
  group("apotek", "Apotek & Inventaris", [
    ["siapkan", "Siapkan", "/apotek/siapkan", "PH"],
    ["serahkan", "Serahkan", "/apotek/serahkan", "PH"],
    ["master-item", "Master Item", "/stok/item", "PH PU AP"],
    ["kartu-stok", "Kartu Stok", "/stok/kartu", "PH PU AU"],
    ["batch", "Batch & Kedaluwarsa", "/stok/batch", "PH"],
    ["opname", "Hitung Stok (Opname)", "/stok/opname", "PH M"],
    ["depot", "Gudang & Depot", "/stok/depot", "PH PU"],
    ["pemasok", "Pemasok", "/pembelian/pemasok", "PU"],
    ["utang-pemasok", "Utang Pemasok", "/pembelian/utang", "PU F"],
    ["po", "Purchase Order & Penerimaan", "/pembelian/po", "PU PH"],
    ["transfer", "Transfer Antar Cabang", "/pembelian/transfer", "PU PH"],
    ["retur", "Retur ke Pemasok", "/pembelian/retur", "PU"],
    ["pemusnahan", "Pemusnahan", "/stok/pemusnahan", "PH O"],
  ]),
  group("staf", "Staf", [
    ["data-staf", "Data Staf", "/staf", "O AP FH M"],
    ["undangan", "Undangan", "/staf?segmen=undangan", "O AP"],
    ["aturan-komisi", "Aturan Komisi", "/komisi/aturan", "O F M"],
    ["rekap-komisi", "Rekap Komisi & Batch", "/komisi", "O F"],
    ["target-staf", "Target & Scorecard Staf", "/staf/target", "O M"],
  ]),
  group("marketing", "Marketing & CRM", [
    ["pesan", "Pesan", "/pesan", "CS FO BC M O"],
    ["lead", "Lead & Pipeline", "/lead", "CS BC MK"],
    ["tindak-lanjut", "Tindak Lanjut", "/lead/tindak-lanjut", "CS BC"],
    ["otomasi", "Otomasi, Pengingat & Aftercare", "/otomasi", "AP MK FH M CS"],
    ["templat-wa", "Templat WhatsApp", "/templat", "AP MK"],
    ["kampanye", "Kampanye & Segmen", "/kampanye", "MK"],
    ["survei", "Survei Kepuasan & Ulasan", "/lead/survei", "M MK"],
    ["atribusi", "Atribusi & Sumber Rujukan", "/laporan/atribusi", "MK O"],
    ["situs", "Situs Klinik", "/situs", "MK AP O"],
  ]),
  group("keuangan", "Keuangan", [
    ["ringkasan-keuangan", "Ringkasan Keuangan", "/keuangan/ringkasan", "F O"],
    ["mutasi", "Mutasi Pembayaran", "/keuangan/mutasi", "F"],
    ["kewajiban", "Piutang & Kewajiban Layanan", "/keuangan/kewajiban", "F O"],
    ["rekonsiliasi", "Rekonsiliasi", "/keuangan/rekon", "F"],
    ["pajak", "Pajak", "/keuangan/pajak", "F"],
    ["biaya", "Biaya Operasional & Kas Kecil", "/keuangan/biaya", "F M"],
    ["buku-besar", "Jurnal & Buku Besar", "/keuangan/buku-besar", "F"],
    ["ekspor-keuangan", "Ekspor", "/keuangan/ekspor", "F"],
    ["tagihan-server", "Tagihan Server", "/saya/tagihan-server", "O F AP AU"],
  ]),
  group("laporan", "Laporan", [
    ["laporan-penjualan", "Laporan Penjualan & Uang", "/laporan/penjualan", "O F M"],
    ["laporan-perawatan", "Laporan Perawatan", "/laporan/perawatan", "O M"],
    ["laporan-pasien", "Laporan Pasien", "/laporan/pasien", "O MK"],
    ["laporan-staf", "Laporan Staf", "/laporan/staf", "O M"],
    ["laporan-operasional", "Laporan Operasional", "/laporan/operasional", "M"],
    ["laporan-stok", "Laporan Stok", "/laporan/stok", "PH PU AU"],
    ["laporan-marketing", "Laporan Marketing", "/laporan/marketing", "MK CS"],
    ["laporan-audit", "Laporan Audit", "/laporan/audit", "AU O"],
    ["laporan-terjadwal", "Kirim Laporan Terjadwal", "/laporan/terjadwal", "O"],
    ["kamus-kpi", "Kamus KPI", "/laporan/kamus-kpi", "O F M MK CS PH PU AU"],
  ]),
  group("persetujuan", "Persetujuan & Audit", [
    ["persetujuan", "Persetujuan", "/persetujuan", "O M FH RO"],
    ["matriks-persetujuan", "Matriks Persetujuan", "/persetujuan/matriks", "O AP"],
    ["log-audit", "Log Audit", "/audit", "O FH RO AU"],
    ["audit-internal", "Audit Internal", "/audit/internal", "AU O"],
    ["privasi", "Privasi & Persetujuan", "/privasi", "O"],
    ["permintaan-data", "Permintaan Data Pasien", "/privasi/permintaan", "O"],
    ["ekspor-data", "Ekspor Data Klinik", "/ekspor", "O"],
    ["pengguna-akses", "Pengguna & Akses", "/pengguna-akses", "O AP"],
    ["kepatuhan", "Kepatuhan & Pendapat Ahli", "/kepatuhan", "O FH F AP AU"],
    ["status-backup", "Status Backup", "/ekspor/backup", "O"],
  ]),
  group("integrasi", "Integrasi", [
    ["satusehat", "SATUSEHAT", "/satusehat", "O M FH RO"],
    ["whatsapp", "WhatsApp", "/pesan/nomor", "AP"],
    ["pembayaran", "Pembayaran", "/kasir/pengaturan-bayar", "O"],
    ["email-google", "Email & Google Business", "/pengaturan/cabang/integrasi", "AP"],
  ]),
  // §2.17: one page per §5 group, for the roles that change or draft a SET row in it
  // (§5 "Changed by"; Admin Pusat drafts money and clinical groups for Owner/PJ, 07).
  group("pengaturan", "Pengaturan", [
    ["set-klinik", "Klinik & Cabang", "/pengaturan/klinik", "O AP M"],
    ["set-layanan", "Layanan & Harga", "/pengaturan/layanan", "O AP"],
    ["set-uang", "Uang & Kasir", "/pengaturan/uang", "O AP"],
    ["set-pajak", "Pajak", "/pengaturan/pajak", "O AP"],
    ["set-jadwal", "Jadwal & Booking", "/pengaturan/jadwal", "M AP"],
    ["set-antrean", "Antrean", "/pengaturan/antrean", "M"],
    ["set-komunikasi", "Komunikasi & Otomasi", "/pengaturan/komunikasi", "O AP"],
    ["set-crm", "CRM", "/pengaturan/crm", "O AP"],
    ["set-komisi", "Komisi", "/pengaturan/komisi", "O AP"],
    ["set-stok", "Stok", "/pengaturan/stok", "PH PU M"],
    ["set-klinis", "Klinis", "/pengaturan/klinis", "FH O AP"],
    ["set-dokumen", "Dokumen", "/pengaturan/dokumen", "AP FH"],
    ["set-akses", "Pengguna & Akses", "/pengaturan/akses", "O AP"],
    ["set-privasi", "Privasi", "/pengaturan/privasi", "O"],
    ["set-situs", "Situs Klinik", "/pengaturan/situs", "AP MK"],
    ["set-laporan", "Laporan", "/pengaturan/laporan", "O"],
  ]),
];

// §2.16 Saya: every role; commission/target only for roles with "Own commission &
// target" in 07; vendor access for Owner (Admin Pusat read). Ganti Peran, Ganti Cabang
// and Ganti Klinik appear only when there is something to switch to (17 Navigation;
// sayaFor's options); Keluar is a control, not a page (shell.tsx).
const ALL = Object.keys(ABBR).join(" ");
const OWN = "M FO CS BC D N T PH";
export const SAYA: readonly NavPage[] = (
  [
    ["ganti-peran", "Ganti Peran", "/saya/peran", ALL],
    ["ganti-cabang", "Ganti Cabang", "/saya/cabang", ALL],
    ["ganti-klinik", "Ganti Klinik", "/saya/klinik", ALL],
    ["keamanan", "Profil & Keamanan", "/saya/keamanan", ALL],
    ["komisi-saya", "Komisi Saya", "/saya/komisi", OWN],
    ["target-saya", "Target Saya", "/saya/target", OWN],
    ["jadwal-saya", "Jadwal Saya", "/saya/jadwal", ALL],
    ["notifikasi", "Notifikasi", "/saya/notifikasi", ALL],
    ["tampilan", "Tampilan", "/saya/tampilan", ALL],
    ["akses-vendor", "Akses Vendor", "/saya/akses-vendor", "O AP"],
    // Tagihan Server is one route (19 §2.12 "same route as Saya › Tagihan Server"); it
    // is listed once, under Keuangan, with that row's roles.
    ["bantuan", "Bantuan", "/saya/bantuan", ALL],
  ] as Row[]
).map(page);

// §2.18 phone tabs (4 + Menu) and landing page per role; ids refer to NAV or SAYA.
const TABS: Record<Role, [label: string, id: string][]> = {
  owner: [["Ringkasan", "ringkasan-owner"], ["Cabang", "ringkasan-cabang"], ["Persetujuan", "persetujuan"], ["Keuangan", "ringkasan-keuangan"]],
  admin_pusat: [["Ringkasan", "ringkasan-ap"], ["Cabang", "ringkasan-cabang"], ["Layanan", "master-layanan"], ["Staf", "data-staf"]],
  manager: [["Ringkasan", "ringkasan-cabang"], ["Hari Ini", "hari-ini"], ["Persetujuan", "persetujuan"], ["Stok", "opname"]],
  facility_head: [["Ringkasan", "ringkasan-klinis"], ["Persetujuan", "persetujuan"], ["Keluhan", "keluhan"], ["Audit", "log-audit"]],
  records_officer: [["Koreksi", "koreksi-rm"], ["Pasien", "daftar-pasien"], ["Audit", "log-audit"], ["SATUSEHAT", "satusehat"]],
  fo_cashier: [["Hari Ini", "hari-ini"], ["Jadwal", "kalender"], ["Kasir", "kasir"], ["Pesan", "pesan"]],
  central_cs: [["Pesan", "pesan"], ["Lead", "lead"], ["Jadwal", "kalender"], ["Tindak Lanjut", "tindak-lanjut"]],
  bc: [["Pasienku", "pasienku"], ["Tindak Lanjut", "tindak-lanjut"], ["Pesan", "pesan"], ["Target", "target-saya"]],
  doctor: [["Antrean", "antrean-dokter"], ["Pasien", "daftar-pasien"], ["Permintaan", "permintaan-klinis"], ["Keluhan", "keluhan"]],
  nurse: [["Ruang", "ruang"], ["Permintaan", "permintaan-klinis"], ["Keluhan", "keluhan"], ["Jadwal", "kalender"]],
  therapist: [["Ruang", "ruang"], ["Permintaan", "permintaan-klinis"], ["Keluhan", "keluhan"], ["Jadwal", "kalender"]],
  pharmacist: [["Siapkan", "siapkan"], ["Serahkan", "serahkan"], ["Stok", "kartu-stok"], ["Keluhan", "keluhan"]],
  finance: [["Keuangan", "ringkasan-keuangan"], ["Komisi", "rekap-komisi"], ["Laporan", "laporan-penjualan"], ["Pajak", "pajak"]],
  marketing: [["Situs", "situs"], ["Lead", "lead"], ["Promo", "kode-promo"], ["Laporan", "laporan-marketing"]],
  purchasing: [["Stok", "kartu-stok"], ["Pembelian", "po"], ["Transfer", "transfer"], ["Utang", "utang-pemasok"]],
  auditor: [["Audit", "audit-internal"], ["Laporan", "laporan-audit"], ["Log", "log-audit"], ["Stok", "kartu-stok"]],
};

const LANDING: Record<Role, string> = {
  owner: "ringkasan-owner",
  admin_pusat: "ringkasan-ap",
  manager: "ringkasan-cabang",
  facility_head: "ringkasan-klinis",
  records_officer: "koreksi-rm",
  fo_cashier: "hari-ini",
  central_cs: "ringkasan-cs",
  bc: "pasienku",
  doctor: "antrean-dokter",
  nurse: "ruang-saya",
  therapist: "ruang-saya",
  pharmacist: "ringkasan-apotek",
  finance: "ringkasan-keuangan",
  marketing: "ringkasan-marketing",
  purchasing: "ringkasan-pembelian",
  auditor: "ringkasan-audit",
};

const BY_ID = new Map<string, NavPage>([...NAV.flatMap((g) => g.pages), ...SAYA].map((p) => [p.id, p]));

export type Tab = { id: string; label: string; href: string; group: string };

// The one current page for a path: the longest matching href among the role's pages
// (ties: first in menu order, so Keuangan › Tagihan Server wins over Saya's copy).
export function currentPageId(path: string, pages: readonly NavPage[]): string | undefined {
  let best: NavPage | undefined;
  for (const p of pages) {
    const href = p.href.split("?")[0];
    if ((path === href || path.startsWith(`${href}/`)) && (!best || href.length > best.href.split("?")[0].length)) best = p;
  }
  return best?.id;
}

// The role's menu: groups with at least one page the role may use, pages filtered.
export function menuFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({ ...g, pages: g.pages.filter((p) => p.roles.includes(role)) })).filter((g) => g.pages.length > 0);
}

export type SwitchOptions = { roles: boolean; branches: boolean; clinics: boolean };
const ALL_SWITCHES: SwitchOptions = { roles: true, branches: true, clinics: true };

export function sayaFor(role: Role, can: SwitchOptions = ALL_SWITCHES): NavPage[] {
  return SAYA.filter(
    (p) =>
      p.roles.includes(role) &&
      (p.id !== "ganti-peran" || can.roles) &&
      (p.id !== "ganti-cabang" || can.branches) &&
      (p.id !== "ganti-klinik" || can.clinics),
  );
}

const groupOf = (id: string) => NAV.find((g) => g.pages.some((p) => p.id === id))?.id ?? "saya";

export function tabsFor(role: Role): Tab[] {
  return TABS[role].map(([label, id]) => {
    const p = BY_ID.get(id)!;
    return { id, label, href: p.href, group: groupOf(id) };
  });
}

export function landingFor(role: Role): NavPage {
  return BY_ID.get(LANDING[role])!;
}

// NAV-3 quick actions by role (the sheets themselves arrive with their pages).
export type QuickAction = { id: string; label: string; href: string };
const QUICK: QuickAction[] = [
  { id: "pasien-datang", label: "Pasien Datang", href: "/hari-ini?aksi=datang" },
  { id: "buat-janji", label: "Buat Janji", href: "/jadwal?aksi=baru" },
  { id: "jual-cepat", label: "Jual Cepat", href: "/kasir/jual-cepat" },
  { id: "pasien-baru", label: "Pasien Baru", href: "/pasien/baru" },
];
const QUICK_ROLES: Record<string, readonly Role[]> = {
  "pasien-datang": ["fo_cashier", "manager"],
  "buat-janji": ["fo_cashier", "central_cs", "manager"],
  "jual-cepat": ["fo_cashier"],
  "pasien-baru": ["fo_cashier", "central_cs"],
};
export function quickActionsFor(role: Role): QuickAction[] {
  return QUICK.filter((a) => QUICK_ROLES[a.id].includes(role));
}

// Roles that answer WhatsApp conversations see the inbox badge (NAV-3, 19 §2.11 Pesan).
export function hasInbox(role: Role): boolean {
  return BY_ID.get("pesan")!.roles.includes(role);
}
