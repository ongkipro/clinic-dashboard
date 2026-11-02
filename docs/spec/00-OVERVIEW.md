# 00 — Ringkasan Satu Halaman: Clinic Dashboard

Untuk Paduka Ongki dan siapa pun yang baru membuka kit ini. Bahasa sederhana; detail ada di file bernomor. Versi kit: v0.7 (2026-11-02). Status: disetujui untuk development (P-27, 2026-11-02); repo `~/Projects/clinic-dashboard`, M0 belum dimulai.

## Apa ini

Satu sistem (satu kode, satu server) untuk banyak klinik kecantikan. Klinik baru cukup didaftarkan dan disiapkan, tidak dibangun ulang. Klien pertama: **Numa Klinik**. Ini sistem **klinik**, bukan toko online: yang "dijual" adalah tindakan pada pasien; produk dijual di kasir dan diserahkan apoteker.

## Tiga tingkat

1. **Super admin (tim kita, vendor)** — membuat klinik baru, memandu sampai go-live, menagih biaya server bulanan (mulai Rp1.000.000, lewat AutoLaris kita), membantu lewat sesi dukungan. Tidak pernah melihat data pasien kecuali di sesi yang terlihat dan bisa dihentikan owner klinik; untuk data klinis sesi itu harus disetujui owner klinik dulu.
2. **Admin Klinik Pusat (satu brand)** — owner, Admin Pusat, keuangan, CS pusat, penanggung jawab klinik, perekam medis, marketing, pembelian, auditor. Mengatur semua cabang brand itu.
3. **Klinik Cabang** — manager, FO/kasir, BC, dokter, perawat, terapis, apoteker. Kerja harian satu cabang.

Pasien milik satu brand dan dipakai bersama semua cabangnya. Brand A dan brand B tidak pernah saling melihat.

## Satu kunjungan dalam 10 langkah

| # | Langkah | Siapa | Bisa tertahan karena |
|---|---|---|---|
| 1 | Booking (WA, situs, telepon) atau datang langsung (nomor antrean) | CS, FO, pasien | Slot penuh |
| 2 | Check-in, kunjungan dibuka | FO | Identitas belum lengkap |
| 3 | Pendampingan: keluhan, foto, observasi kulit (bukan diagnosis) | BC | — |
| 4 | Pemeriksaan, rencana perawatan, tanda tangan | Dokter | Data BC belum diverifikasi dokter |
| 5 | Pasien memilih tindakan/paket, menyetujui | BC, pasien | Pasien tidak membeli → biaya konsultasi |
| 6 | Bayar | Kasir | Belum bayar → tindakan tidak bisa mulai |
| 7 | Tindakan di ruang | Perawat/terapis/dokter | Belum ada persetujuan tindakan, STR/SIP habis |
| 8 | Obat/produk disiapkan dan diserahkan | Apoteker | Resep belum ditandatangani, batch kedaluwarsa |
| 9 | Kunjungan ditutup | FO | Masih ada tagihan atau obat belum diserahkan |
| 10 | Aftercare dan tindak lanjut (kontrol, paket berikutnya) | Sistem, CS, BC | Pasien tidak setuju promo → hanya pesan perawatan |

Situasi lain (tidak datang, ganti jadwal, tindakan berhenti, kontrol, konsultasi saja, sesi paket, beli produk tanpa kunjungan, keluhan) ada di `17` bagian *Role Hand-off Map*.

## Uang dalam 5 aturan

1. Uang yang dibayar di muka adalah **utang layanan**, bukan untung; jadi pendapatan baru saat tindakan dilakukan atau produk diserahkan.
2. Sesi paket **terbuka sesuai nilai yang sudah dibayar**; cicilan boleh tanpa jadwal.
3. Paket kedaluwarsa atau batal: nilai yang sudah dibayar dan belum dipakai **pindah ke saldo pasien**, tidak hangus.
4. Komisi dihitung dari **uang yang benar-benar masuk** dan dialokasikan, disetujui bulanan.
5. Pembayaran simulasi (gateway dummy) **tidak pernah** dihitung sebagai uang, membuka tindakan, atau menutup kunjungan.

## Navigasi dan pengaturan

Release 1 memakai **navigasi dan halaman lengkap** sesuai riset (sekitar 133 halaman: ±110 aplikasi klinik, 12 konsol vendor, 11 situs publik) — daftar lengkap dan isi tiap halaman di `19-NAVIGATION-PAGE-CATALOGUE.md`. Semua angka aturan (masa paket, DP, jam pengingat, batas diskon, dan lain-lain) memakai **nilai dari riset** dan bisa diubah klinik di menu **Pengaturan** (49 pengaturan, masing-masing dengan batas aman, riwayat, dan tombol *Kembalikan ke default*). Aturan hukum dan keamanan uang tidak bisa diubah.

## Release 1 adalah / bukan

**Adalah:** produk lengkap sesuai riset (P-21): operasional klinik untuk 1–5 cabang (jadwal, rekam medis, kasir, paket/saldo, stok dan gudang, apotek, pembelian dan utang pemasok, komisi, WhatsApp dan otomasi, SATUSEHAT, akuntansi lengkap, laporan), konsol vendor, situs publik dasar per klinik, register kepatuhan, pembayaran QRIS/VA lewat "port" dengan gateway dummy dulu. Total 131 task (`TASKS.md`).

**Bukan:** toko online, aplikasi pasien, loyalti/poin, payroll, telekonsultasi, pengiriman kampanye promosi sebelum konsultan hukum mengizinkan (fitur dibangun, saklar mati), testimoni/diskon di situs (dilarang Permenkes 1787/2010). Konten situs lanjutan (artikel, quiz) menyusul di Phase 4.

## Yang Numa Klinik perlu siapkan sebelum go-live

Daftar cabang dan jam buka; katalog tindakan, produk, paket dan harga; daftar staf dengan STR/SIP; status pajak (PKP atau tidak); nomor WhatsApp per cabang atau brand; kredensial SATUSEHAT per cabang; data pasien, paket aktif dan saldo untuk impor; perjanjian pengolahan data yang ditandatangani.

## Keputusan yang masih menunggu Paduka

| ID | Pertanyaan (sederhana) | Dibutuhkan sebelum |
|---|---|---|
| Q-12 | Validasi cara kerja di Numa Klinik (ikut satu hari, wawancara per peran); hanya bisa mengubah 7 requirement | Persetujuan PRD untuk 7 requirement itu |
| Q-16 | PPh 23 atas biaya server, siapa tanggung biaya channel AutoLaris, Numa ditagih sejak go-live atau gratis masa pilot | Tagihan pertama |
| Q-19 | Detail SATUSEHAT dicek ke panduan resmi (identitas tanpa NIK, anak, WNA, koreksi) | Integrasi SATUSEHAT (M7) |
| Q-14 | Partner payment gateway untuk pasien | Pembayaran online di klinik live |
| Q-13 | Status AutoLaris mana yang berarti "lunas" untuk akun kita | Tagihan pertama |
| Q-03 | Badan usaha vendor (PT) | Mulai registrasi PSE/Meta/SATUSEHAT |
| Q-04 / H-02d | Lokasi server data klinis + pendapat hukum | Pasien sungguhan pertama |
| Q-05, Q-06 | Penasihat pajak dan akuntan (bukti diunggah di menu Kepatuhan) | PPN aktif dan ekspor jurnal |
| Q-07 | Siapa boleh menyetujui tindakan tambahan, batas peran BC | Modul klinis (M2) |
| Q-08, Q-10, Q-11, R-01 | Konsultan hukum dan tim medis: rekam medis/foto, persetujuan pasien anak, retensi, risiko data klinis | Pasien sungguhan pertama (G2) |
| Q-15, Q-17 | Konsultan hukum: aturan iklan kesehatan dan paket verifikasi regulasi (bukti di menu Kepatuhan) | Situs publik terbit, pasien sungguhan (G2) |

Siapa mengerjakan apa: lihat `README.md` › *Who is who*. Urutan membangun: `PLAN.md`. Aturan untuk agent coding: `AGENTS.md` di root repo.
