# Panduan Validasi Pekerjaan Klinik — Clinic Dashboard

- Tanggal: 2026-11-02. Untuk: Paduka Ongki dan tim yang akan berbicara dengan klinik.
- Tujuan: memastikan cara kerja klinik yang tertulis di kit (`~/Documents/work/prd/clinic-dashboard/`) benar-benar terjadi di klinik nyata, sebelum PRD disetujui dan development dimulai.
- Kenapa perlu: riset dan reverse engineering menunjukkan **apa yang dibangun vendor**, bukan **bagaimana staf klinik bekerja**. Di PRD Kliniknuma, setiap pekerjaan peran ditandai "Assumption; interview evidence not attached". Panduan ini menutup celah itu.
- Klinik pertama yang divalidasi: **Numa Klinik** (calon tenant pertama, PRD Q-02).

## 1. Cara validasi (urut dari yang paling murah)

| Cara | Waktu | Hasil |
|---|---|---|
| A. Isi halaman brief Numa Klinik (`~/Projects/numa-klinik-brief`, tautan per responden) oleh owner, dokter, FO | 30–60 menit per orang | Frekuensi masalah dan koreksi aturan bawaan |
| B. **Ikut satu hari di klinik** (shadowing): duduk di meja FO, ruang BC, ruang tindakan, apotek, kasir, dari buka sampai tutup kas | 1 hari | Urutan kerja nyata, waktu tunggu, kertas/Excel/WA yang dipakai |
| C. Wawancara 20–30 menit per peran (§3), sebaiknya setelah shadowing | 2–3 jam total | Jawaban atas asumsi spesifik |
| D. Coba demo/trial 2 vendor (Aesta, ClinicHub, atau Klinik Pintar) sebagai calon pembeli | 2 jam | Pembanding alur; bukan untuk menyalin |
| E. Review akuntan, konsultan pajak, penanggung jawab klinis (sudah ada di PRD §13) | Sesuai jadwal mereka | Aturan uang, pajak, klinis |

Aturan: jangan memotret pasien, jangan menyalin data pasien, jangan meminta kata sandi. Catat **apa yang dilakukan**, bukan siapa pasiennya.

## 2. Gambaran satu hari klinik (yang akan dicek)

| Waktu | Kejadian | Peran |
|---|---|---|
| Pagi | Buka kas, cek jadwal hari ini, cek stok bahan ruang tindakan | FO/kasir, manager, perawat |
| Sepanjang hari | Pasien datang (booking atau walk-in) → check-in → BC intake & foto → dokter periksa & rencana → pasien memilih → bayar → tindakan → serah obat/produk → tutup kunjungan | Semua |
| Sepanjang hari | Balas WhatsApp, buat janji, kirim pengingat | CS pusat, FO |
| Sore/malam | Tutup kas per shift, opname bahan vial terbuka, laporan harian | Kasir, apoteker, manager |
| Bulanan | Hitung & setujui komisi, tutup buku, opname stok, cek paket kedaluwarsa | Owner, finance, apoteker |

## 3. Pertanyaan per peran

Setiap pertanyaan menunjuk keputusan atau requirement di kit yang divalidasi. Jawaban "tidak begitu" → catat dan bawa ke DECISION-REGISTER.

### Owner / Admin Pusat
1. Angka apa yang Anda lihat setiap pagi? Dari mana sekarang? (PR-33a, K1–K5)
2. Siapa yang boleh memberi diskon, berapa batasnya? (GAP-4)
3. Bagaimana komisi dihitung dan kapan dibayar? Pernah ada sengketa? (PR-23, B-07)
4. Paket yang belum dipakai: dicatat di mana? Pernah dikira untung? (K5, B-03)
5. Siapa yang mengatur harga per cabang? (PR-42)
6. Laporan apa yang diminta akuntan Anda? (PR-25, A-01)

### Front office / kasir
1. Berapa persen pasien datang tanpa booking? Ada nomor antrean? (GAP-3)
2. Apa yang dicek saat check-in? KTP/NIK selalu ada? (PR-5)
3. Pembayaran apa saja yang diterima? Berapa persen QRIS/transfer/tunai/EDC? (PR-19, PG)
4. Bagaimana tindakan tambahan di ruang ditagih? Pernah pasien pulang belum bayar? (PR-15, B-01)
5. Tutup kas: kapan, berapa shift, bagaimana kalau selisih? (UX-15)
6. Struk dicetak, dikirim WA, atau keduanya? (GAP-6)

### Beauty consultant (BC)
1. Apa yang Anda tanyakan dan foto sebelum pasien ke dokter? (PR-9)
2. Bagaimana Anda menawarkan paket? Pakai simulasi harga? (UX-7)
3. Siapa yang dapat komisi kalau dua BC menangani satu pasien? (BC Pembimbing / Closing)
4. Target bulanan Anda diukur dari apa? (D-07, K19)
5. Follow-up pasien setelah kunjungan: lewat WA pribadi atau nomor klinik? (PR-28, PR-30)

### Dokter
1. Berapa menit per pasien? Apa yang paling memakan waktu saat mencatat? (PR-10)
2. Catatan BC dipakai atau Anda tanya ulang semua? (PR-9/PR-10 provenance)
3. Persetujuan tindakan: kertas atau digital? Siapa yang menjelaskan? (PR-11)
4. Tindakan tambahan di tengah tindakan: siapa yang menyetujui, bagaimana pasien setuju? (PR-45, B-01)
5. Surat apa yang sering Anda buat (keterangan, rujukan, resume)? (GAP-6)
6. Keluhan pasien setelah tindakan: masuk ke siapa? (PR-43)

### Perawat / terapis
1. Ceklis sebelum tindakan apa saja? (UX-9)
2. Bahan dicatat per tindakan atau dihitung di akhir hari? (PR-16)
3. Kalau tindakan berhenti di tengah (alasan medis, alat rusak, pasien minta), apa yang terjadi pada paket? (PR-14, B-06)
4. Logbook alat (sterilisasi, kalibrasi) diisi di mana? (GAP-14)

### Apoteker / gudang
1. Bagaimana daftar siapkan obat/bahan dibuat sekarang? (PR-18)
2. Vial terbuka: batas pakai dicatat bagaimana? (PR-17)
3. Pembelian ke supplier: siapa yang memesan, menerima, retur? (PR-17, GAP-7)
4. Opname: berapa sering, berapa selisih biasanya? (K18)

### CS / admin WhatsApp
1. Berapa nomor WA klinik? Per cabang atau satu pusat? (PR-27, W-01)
2. Berapa chat per hari, berapa yang jadi booking? (K13, K14)
3. Pengingat janji dikirim manual? Kapan? (GAP-1)
4. Siapa yang menjawab di luar jam kerja? (D-08)

### Manager cabang
1. Persetujuan apa yang paling sering Anda berikan? (PR-44)
2. Jadwal staf dibuat di mana, berapa sering berubah? (PR-48)
3. Masalah harian yang paling menyita waktu?

## 4. Cara mencatat hasil

| Kolom | Isi |
|---|---|
| Peran / klinik / tanggal | — |
| Pertanyaan (ID) | mis. FO-4 |
| Jawaban singkat | apa yang terjadi sekarang |
| Sesuai kit? | Ya / Sebagian / Tidak |
| Dampak | requirement atau keputusan yang perlu diubah |

Hasil disimpan sebagai `VALIDATION-RESULTS-<klinik>-<tanggal>.md` di folder ini, lalu keputusan yang berubah dicatat di `DECISION-REGISTER.md`.
