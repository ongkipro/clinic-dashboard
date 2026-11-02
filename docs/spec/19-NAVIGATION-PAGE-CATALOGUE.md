# Navigation and Page Catalogue — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Owner | Design owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Source | `indonesia-beauty-clinic-system-ui-ux-research.md` §4.2 (stakeholders), §5.1–§5.2 (global shell and ~110-page menu tree), §6 (dashboards), §7 (key screens), §8 (patient portal, Phase 4), §10 (public site); `beauty-clinic-admin-system-research.md` §2–§3 (vendor admin anatomy); `BIG-BRAND-DASHBOARD-CRM-REQUIREMENTS.md` |
| Relationship | `17-UX-FLOWS-SCREEN-CONTRACTS.md` owns screen contracts (UX-*); this file owns the role tab bars and landing pages (§2.18), the **complete navigation tree, page inventory, page content and the Pengaturan (Settings) registry**. Every page here maps to a UX-* screen or to a tab/segment inside one. |

## 1. Principles

- NAV-1 — One menu tree per product level (vendor console, clinic app, public site). Each role sees the subset its permissions allow (07); pages a role cannot use are absent, never disabled.
- NAV-2 — Compact width (phone): bottom tab bar ≤ 5 items: the role's 4 most-used destinations + **Menu**. Menu opens the full role-filtered tree with search, pinned and recent pages; **Saya** (profile) is the first section inside Menu. Regular width (tablet): collapsible sidebar (icons only when a clinical workspace needs the width). Desktop: full sidebar, two levels, collapsible groups, current page highlighted, command palette (Ctrl/⌘+K) for pages, patients and actions.
- NAV-3 — Global shell on every clinic page: branch switcher (when > 1 branch), global search (PR-76), quick actions (Pasien Datang, Buat Janji, Jual Cepat, Pasien Baru — by role), notifications, inbox badge, user menu (Saya).
- NAV-4 — Every list page has: search, filters with saved views, sort, column chooser (regular width), bulk actions where the research shows them, export (role-gated), empty/filtered-empty/error/loading states (10 State Copy Patterns).
- NAV-5 — Every detail page has: header (identity + status), tabs or sections, timeline/history, related records, primary action, audit trail link (role-gated).
- NAV-6 — Rules a clinic may adjust live in **Pengaturan** (§2.17, §5) with a default; nothing else is configurable (B-24). Every editable control maps to one SET-* row.
- NAV-7 — Dense pages adapt by width: inbox list → thread → context (phone) / two panes (tablet) / three panes (desktop); patient profile sections as a list on phone, tabs on tablet/desktop; examination workspace single column on phone (view only), focus mode on tablet (sidebar hidden, history as sheet), three panes ≥ 1180 px; report tables become cards on phone with the KPI header first.
- NAV-8 — Roles use the names of the 07 matrix (FO/cashier is one role); a queue TV is a **paired display device** (scoped token, no patient data) not a user role. Future pages extend this tree without renumbering; new pages get the next UX-* ID.

## 2. Clinic app — complete menu tree (Level 2 and Level 3)

Legend: **Page** = route-level screen; ▸ = tab or segment inside a page. "UX" = owning screen contract in 17. Release: R1 = Release 1 (all rows, P-24); Phase 4 items are listed only in §4.

### 2.1 Dashboard

| Page | Content (sections, top → bottom) | Roles | UX | Release |
|---|---|---|---|---|
| Ringkasan Owner | Perlu Ditangani; Uang Masuk (K1) with delta and time basis; Layanan Selesai (K2); Piutang aging (K4); Kewajiban Prabayar (K5) with expiry slice; K1 vs K2 trend; Cabang league; mix perawatan; funnel lead (K13); komisi bulan ini (K17); risiko stok (K18) | Owner | UX-20 | R1 |
| Ringkasan Admin Pusat | Kelengkapan setup per cabang; konfigurasi tertunda; menunggu Owner; status cabang | Admin Pusat | UX-57 | R1 |
| Ringkasan Cabang | Hari ini per jam; datang/menunggu > X menit; ruang & alat terpakai; staf bertugas; antrean persetujuan; keluhan; tidak datang; stok menipis; celah besok (K15) | Manager | UX-21 | R1 |
| Ringkasan CS | Belum ditugaskan; lewat 15 menit (K14); K13 per sumber; janji belum dikonfirmasi | Central CS | UX-36 | R1 |
| Ringkasan BC (Pasienku) | Perlu dihubungi; menunggu dokter; belum memilih; paket hampir habis; target (K19); komisi saya (K17) | BC | UX-35 | R1 |
| Ringkasan Keuangan | K1 per metode; settlement gateway tertunda; K4; K5 detail; refund & write-off; batch komisi; roll-forward | Finance | UX-22 | R1 |
| Ringkasan Klinis (UX-60) | Keluhan klinis terbuka; koreksi menunggu; STR/SIP hampir habis (verifikasi kredensial); SATUSEHAT ditolak; insiden terbuka | Facility head | UX-60 | R1 |
| Papan Klinik (live) | Board per kunjungan dengan Jalur Kunjungan (VisitTrack) | FO/cashier, manager | UX-6 | R1 |
| Ringkasan Marketing | Lead per tahap, sumber (K13), respons (K14), performa kode promo, pasien lama tidak datang, survei | Marketing | UX-60 | R1 |
| Ringkasan Apotek | Siapkan/serahkan menunggu, hampir kedaluwarsa, vial terbuka (batas pakai), PO diterima hari ini, recall/karantina | Pharmacist | UX-60 | R1 |
| Ringkasan Pembelian | Stok di bawah minimum per cabang, PO terbuka, utang pemasok jatuh tempo | Purchasing | UX-60 | R1 |
| Ringkasan Audit | Aktivitas mencurigakan baru, diskon manual, void, selisih kas & stok | Internal auditor | UX-60 | R1 |
| Ruang Saya (perawat/terapis) | Jadwal ruang hari ini, pasien berikutnya datang, komisi saya bulan ini | Nurse, therapist | UX-60 | R1 |

Alerts and primary actions per home (research §6): **Owner** — alerts: refund/void besar, selisih kas, stok habis item teratas, STR/SIP habis, skor survei rendah; actions: Setujui, Ekspor, Kirim Ringkasan. Average ticket, % tidak datang dan pasien baru vs kembali shown with K1. **Manager** — alerts: slot berlebih, dokter terlambat, alat jatuh tempo kalibrasi, pasien menunggu > SET-38 menit; actions: Pindahkan, Setujui, Kirim Pesan ke Staf. **Doctor (Antrean)** — rekam belum ditandatangani, kontrol jatuh tempo, kontraindikasi, persetujuan belum ditandatangani. **Finance** — settlement gateway tertunda, item belum rekonsiliasi, ringkasan pajak; actions: Rekonsiliasi, Kunci Periode, Ekspor. **Cashier** — tagihan terbuka, link bayar tertunda, tambahan belum dibayar, pembayaran gateway gagal.

### 2.2 Front Office

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Hari Ini | Belum dibayar (first); daftar kunjungan dengan VisitTrack dan pemblokir; ▸ Semua · Menunggu · Belum Bayar · Selesai; aksi Pasien Datang, Panggil, Tagih, Tutup | FO, manager | UX-6 | R1 |
| Pendaftaran Pasien | Cari dulu (nama, HP, No. RM, NIK); form pasien baru (identitas Permenkes, wali, persetujuan); cek duplikat | FO, CS | UX-4 | R1 |
| Antrean | Nomor antrean hari ini per loket/ruang; panggil, lewati, pindah; layar TV (opsional) | FO | UX-6 ▸ Antrean | R1 |
| Check-in / Check-out | Konfirmasi identitas, alergi, persetujuan, DP; tutup kunjungan dengan pemblokir | FO | UX-6 detail | R1 |
| Layar Antrean (TV) | Nomor sekarang dan berikutnya per ruang/loket; **tanpa nama pasien (fixed)**; orientasi landscape/portrait; panggilan suara nomor + ruang (opsional, SET-40); tanpa slideshow promo | Paired display device | UX-6 ▸ TV | R1 |

### 2.3 Jadwal & Reservasi

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Kalender | ▸ Hari · Minggu · Bulan · Daftar; kolom per dokter / terapis / ruang / alat; kartu: jam, pasien (baru), layanan, staf, ruang, status, DP, paket; seret untuk pindah dan tarik untuk ubah durasi dengan cek bentrok dan slot alternatif; blok istirahat dan waktu diblokir; tekan lama: Datang, Tidak Datang, Batal; libur abu-abu; ponsel: agenda + hari | FO/cashier, CS, manager, clinical (own) | UX-5 | R1 |
| Reservasi Baru (sheet) | Pasien → layanan → staf (bebas/tertentu) → slot valid (durasi = persiapan + tindakan + jeda dari Master Layanan) → ruang/alat otomatis → catatan → DP & link bayar (tahan slot SET-17) → konfirmasi WA; teks kebijakan; bila bentrok, tampilkan 3 slot alternatif | FO/cashier, CS | UX-5 sheet | R1 |
| Daftar Reservasi | Status: dibuat, dikonfirmasi, datang, dalam tindakan, selesai, tidak datang, batal, dijadwal ulang; balasan "Ubah Jadwal" | FO, CS | UX-5 ▸ Daftar | R1 |
| Booking Online Masuk | Booking dari situs publik menunggu konfirmasi | FO, CS | UX-5 ▸ Online | R1 |
| Daftar Tunggu | Pasien menunggu slot per layanan & cabang | FO, CS | UX-5 ▸ Tunggu | R1 |
| Jadwal Praktik | Shift, istirahat, cuti, absen dokter per cabang | Manager, Admin Pusat | UX-33 | R1 |
| Jam Operasional & Libur | Jam per cabang, hari libur, tutup khusus | Admin Pusat | UX-2 ▸ Jam | R1 |
| Ruang, Bed & Alat | Kapasitas, kemampuan layanan, jadwal perawatan alat | Admin Pusat, manager | UX-2 ▸ Ruang | R1 |

### 2.4 Pasien (CRM)

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Daftar Pasien | Cari; filter (cabang, tag, terakhir datang, paket aktif, saldo, piutang, sumber); segmen tersimpan; kolom per peran (klinis melihat alergi & kunjungan terakhir; keuangan melihat saldo & piutang; marketing hanya kontak yang setuju promosi) | Every role with patient identity in 07 (owner, Admin Pusat, manager, facility head, records officer, FO/cashier, CS, BC, doctor, nurse, therapist, pharmacist, finance, marketing ◐) | UX-29 ▸ list | R1 |
| Profil Pasien (360°) | Kartu kiri: foto, nama, umur, No. RM, HP, alergi (banner), tag, cabang, BC; aksi cepat (Buat Janji, Jual, Chat, Catatan). ▸ Ringkasan/Linimasa · Kunjungan · Rekam Medis* · Foto & Dokumen* · Paket & Saldo (berbagi keluarga bila diaktifkan) · DP · Transaksi · Kode Promo dipakai · Resep* · Persetujuan · Catatan Internal · Komunikasi (WA) · Keluhan · Survei | Role projection (* clinical roles only) | UX-29 | R1 |
| Gabung Data Ganda | Pilih dua pasien, bandingkan, gabung dengan alasan; dapat dibatalkan | Records officer | UX-29 action | R1 |
| Keluarga / Wali | Hubungan wali–anak; satu HP untuk beberapa pasien tanpa saling melihat | FO | UX-29 ▸ Keluarga | R1 |
| Impor Pasien | Unggah CSV → uji coba → laporan baris → setujui (owner) | Owner (onboarding) | UX-1 / UX-41 step | R1 |

### 2.5 Klinis (RME)

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Antrean Dokter | Pasien saya hari ini dengan status; ringkasan alergi, terakhir, paket | Doctor | UX-8 ▸ Antrean | R1 |
| Pendampingan (BC) | Intake & Foto → Dokter → Diskusi Pilihan → Konfirmasi; riwayat singkat | BC | UX-7 | R1 |
| Lembar Pemeriksaan | Header pasien + alergi + kontraindikasi + paket aktif; linimasa kiri; tanda vital; SOAP/asesmen dengan templat per perawatan (Fitzpatrick, keluhan kulit, skala terstruktur); Peta Wajah & Tubuh (keluhan · pemeriksaan · tindakan) dengan **dosis per titik**; foto dengan sudut dan bandingkan; rencana bertahap dengan harga dan bahan (otomatis berharga, Kirim ke Kasir); resep; status persetujuan; simpan draf otomatis; Tanda Tangani (PIN/OTP) mengunci; koreksi = versi baru dengan alasan | Doctor | UX-8 | R1 |
| Foto & Bandingkan | Sisi-ke-sisi / slider, filter sudut, label tanggal, anotasi, panduan pengambilan foto (sudut, cahaya); kolase hanya untuk internal, ekspor butuh persetujuan foto pasien per tujuan | Clinical | UX-8 ▸ Foto | R1 |
| Persetujuan Tindakan | Dari rencana dan dosis; tanda tangan pasien/wali; persetujuan ulang bila dosis naik | Doctor (+ capturing role, Q-07), patient | UX-39 | R1 |
| Rencana Perawatan | Tahap, item, status pilih, jadwal kunjungan berikutnya; **proyeksi BC/FO: item, tahap dan harga saja** (tanpa asesmen, diagnosis, dosis, alasan klinis — 07 "Plan options & prices") | Doctor; BC, FO/cashier, nurse, therapist (projection) | UX-8 ▸ Rencana | R1 |
| Resep | Resep elektronik dari rencana, KFA, tanda tangan | Doctor | UX-8 ▸ Resep | R1 |
| Surat | Surat keterangan, rujukan, resume medis dari templat; ditandatangani | Doctor | UX-8 / UX-29 | R1 |
| Permintaan Klinis | Tindakan tambahan, ubah rencana, tukar treatment: Setujui / Tolak | Doctor, delegated clinician | UX-27 | R1 |
| Keluhan | ▸ Klinis (dokter, perawat, apoteker, PJ) · Layanan (manager); target respons SET-31; eskalasi bila lewat | Clinical, manager (Layanan only) | UX-28 | R1 |
| Koreksi Rekam Medis | Daftar koreksi menunggu persetujuan; riwayat versi | Records officer, facility head | UX-26 filter | R1 |
| Insiden Keselamatan Pasien | KTD/KNC/KTC/KPC/sentinel: petugas, klasifikasi, respons segera, investigasi, keputusan pelaporan, bukti kirim, tindakan korektif | Facility head | UX-28 ▸ Insiden | R1 |

### 2.6 Ruang Tindakan

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Ruang (daftar hari ini) | Per ruang/bed; pasien, tindakan, jam, VisitTrack | Nurse, therapist, doctor | UX-9 | R1 |
| Ceklis Tindakan | Sebelum mulai (identitas, persetujuan, bahan, pelaksana); timer bertahap: persiapan → anestesi topikal (mis. 30 menit) → tindakan → pemulihan; bahan tambahan; usul tindakan tambahan; Selesai Tindakan (4 hasil) | Same | UX-9 | R1 |
| Konfirmasi Bahan (BHP) | Bahan sesuai formula; hanya penyimpangan yang dikonfirmasi; sisa vial | Same | UX-9 sheet | R1 |
| Logbook Alat, Sterilisasi & Limbah | Sterilisasi (siklus, alat, petugas), kalibrasi & perawatan alat (jatuh tempo), limbah medis B3 (tanggal, kategori, jumlah, pengangkut berizin, bukti serah) | Nurse, manager | UX-9 ▸ Logbook | R1 |

### 2.7 Kasir

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Kasir | Item (tindakan, produk, paket, isi saldo) dengan cari & kategori; baris dengan atribusi staf (penjual/pelaksana), qty, diskon per baris (batas & persetujuan), tukar sesi paket; total (subtotal, diskon, kode promo, PPN, pembulatan); tender (tunai + kembalian, QRIS, VA, e-wallet via port, EDC + jenis kartu/bank/trace/approval, transfer, saldo, DP, link bayar); catatan; setelah bayar: struk, saran janji berikutnya; tanggal mundur hanya dengan persetujuan; **online-only** — saat internet putus kasir memakai SOP kertas DR-3, tidak ada antrean offline | FO/cashier; manager, owner, finance, auditor (read per 07) | UX-12 | R1 |
| Jual Cepat | Penjualan produk tanpa kunjungan; penyerahan apoteker untuk produk terdaftar | FO/cashier | UX-12 mode | R1 |
| Tagihan Terbuka | Belum dibayar, sebagian, link bayar tertunda, gagal | FO/cashier | UX-12 ▸ Terbuka | R1 |
| Struk & Invoice | Cetak 58/80 mm, A4, kirim link WA (tanpa nama tindakan) | FO/cashier | UX-12 after-pay | R1 |
| Paket & Saldo | Paket dimiliki (dibeli/terpakai/sisa per layanan, kedaluwarsa), cicilan & jadwal kesepakatan (PR-96), sesi siap pakai/terkunci, penerima manfaat keluarga (bila templat mengizinkan, PR-93), tukar tindakan (persetujuan dokter), ajukan refund; saldo dan riwayat | FO/cashier | UX-13 | R1 |
| Piutang & Refund | Piutang (aging per SET-41), jadwal cicilan, tagih via WA, refund ke saldo/tunai (persetujuan), write-off | FO/cashier, owner, finance | UX-14 | R1 |
| Void & Koreksi | Permintaan void invoice dengan alasan → Persetujuan | FO/cashier | UX-12 action | R1 |
| Tutup Kasir | Ekspektasi per tender vs hitung, selisih + alasan, tagihan terbuka, penjualan per shift, cetak ringkasan | FO/cashier, manager | UX-15 | R1 |
| Simulasi Pembayaran | Hanya tenant demo (SIMULASI) | FO/cashier in demo tenants | UX-56 | R1 |

### 2.8 Paket & Promo

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Master Layanan | Daftar per kategori; detail ▸ Umum · Durasi & Sumber Daya (persiapan, tindakan, jeda, ruang/alat) · Staf & Delegasi · Harga Cabang · Pajak · Resep BHP · Persetujuan Tindakan · Aftercare · Situs · Booking Online; versi dan review klinis | Admin Pusat (no price override), owner, facility head (clinical review), pharmacist (materials) | UX-25 | R1 |
| Templat Paket | Nama, masa berlaku (hari), harga, baris tindakan × qty × nilai, min DP, cicilan, berbagi keluarga (on/off), aturan tukar | Admin Pusat, owner | UX-25 ▸ Paket | R1 |
| Simulasi Paket (BC) | Pilih item dari rencana dokter, lihat harga, DP, sesi siap pakai; kirim penawaran ke kasir | BC | UX-7 ▸ Diskusi Pilihan | R1 |
| Kode Promo & Voucher | Kode, kuota, periode, item & cabang, pemakaian per pasien, statistik; hanya untuk kasir dan pesan langsung yang disetujui (tanpa iklan diskon di situs) | Marketing, Admin Pusat | UX-50 ▸ Promo | R1 |

### 2.9 Apotek & Inventaris

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Siapkan | Daftar siap dari pilihan pasien; batch FEFO | Pharmacist | UX-10 | R1 |
| Serahkan | 7 cek apoteker, konseling, label (etiket biru), serah | Pharmacist | UX-10 | R1 |
| Master Item | Obat, produk, BHP: satuan beli/pakai, konversi, BPOM/KFA, suhu simpan, min/maks per depot | Pharmacist, purchasing, Admin Pusat | UX-11 ▸ Item | R1 |
| Kartu Stok | Mutasi per item per cabang | Pharmacist, purchasing, auditor | UX-11 ▸ Kartu | R1 |
| Batch & Kedaluwarsa | Hampir kedaluwarsa, vial terbuka (batas pakai), karantina, recall | Pharmacist | UX-11 ▸ Batch | R1 |
| Hitung Stok (Opname) | Hitung buta, selisih → persetujuan | Pharmacist, manager | UX-11 sheet | R1 |
| Gudang & Depot | Depot per cabang (gudang, ruang tindakan, apotek), stok per depot, transfer antar depot | Pharmacist, purchasing | UX-11 ▸ Depot | R1 |
| Pemasok | Master pemasok, kontak, syarat bayar | Purchasing | UX-52 ▸ Pemasok | R1 |
| Utang Pemasok | Faktur pemasok terhadap penerimaan, jatuh tempo, saldo, pembayaran, nota kredit | Purchasing, finance | UX-52 ▸ Utang | R1 |
| Purchase Order & Penerimaan | PO → terima sebagian/penuh dengan batch & kedaluwarsa | Purchasing, pharmacist | UX-52 ▸ PO | R1 |
| Transfer Antar Cabang | Permintaan, kirim, terima | Purchasing, pharmacist | UX-52 ▸ Transfer | R1 |
| Retur ke Pemasok | Alasan, batch, nota kredit | Purchasing | UX-52 ▸ Retur | R1 |
| Pemusnahan | Pemusnahan dengan saksi & persetujuan | Pharmacist, owner | UX-11 action | R1 |

### 2.10 Staf

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Data Staf | Peran, cabang, STR (registrasi) dan SIP per cabang dengan masa berlaku, kompetensi, status; ▸ Verifikasi Kredensial (PJ klinik) | Owner, Admin Pusat; facility head (verifikasi); manager (view own branch) | UX-3 | R1 |
| Undangan | Undang, peran (Level 2 butuh Owner), status | Owner, Admin Pusat | UX-3 ▸ Undangan | R1 |
| Jadwal Staf | Lihat 2.3 | Manager | UX-33 | R1 |
| Aturan Komisi | Peran, layanan/kategori, tetap/%, override individu, prioritas, periode berlaku, uji aturan (simulator) | Owner (edit), finance (prepare), manager (view) | UX-16 ▸ Aturan | R1 |
| Rekap Komisi & Batch | Per periode, detail baris, persetujuan, status bayar, ekspor | Owner, finance | UX-16 | R1 |
| Target & Scorecard Staf | Target bulanan BC dan scorecard per staf (utilisasi K15, layanan selesai, komisi) | Owner, manager; staff (own) | UX-35 ▸ Target | R1 |

### 2.11 Marketing & CRM

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Pesan (Inbox WA) | 3 panel: daftar (belum ditugaskan, milikku, label, SLA), percakapan (templat, balasan cepat, kirim link booking, kirim daftar harga resmi), panel samping (cocokkan pasien, janji, paket, tahap lead); penugasan otomatis (SET-42) | CS, FO/cashier, BC, manager; owner (read) | UX-17 | R1 |
| Lead & Pipeline | Baru → dihubungi → booking → datang → bayar / hilang (alasan) | CS, BC, marketing | UX-18 | R1 |
| Tindak Lanjut | Kontrol, paket berikutnya, paket hampir habis, sesi terkunci, piutang, rencana belum dipilih, tidak datang, lama tidak datang | CS, BC | UX-18 ▸ Tindak Lanjut | R1 |
| Otomasi, Pengingat & Aftercare | Skenario (PR-94): pengingat H-3/H-1/hari H, aftercare H+1, tindak lanjut H+7/H+14/H+21, kontrol, paket hampir habis, isi ulang produk, ulang tahun, reaktivasi; on/off, jarak hari, batas frekuensi; teks aftercare per item (review klinis); log pengiriman | Admin Pusat (changes); marketing (scenario drafts for Admin Pusat); facility head (aftercare text); manager (proposals); CS (log read) | UX-55 | R1 |
| Templat WhatsApp | Templat utilitas & perawatan (netral); status persetujuan Meta | Admin Pusat, marketing | UX-17 ▸ Templat | R1 |
| Kampanye & Segmen | Segmen, jadwal, batas frekuensi (hanya dengan persetujuan promosi; menunggu Q-15) | Marketing | UX-19 | R1 (sending switched off until Q-15) |
| Survei Kepuasan & Ulasan | Survei pasca kunjungan; skor rendah → tugas manager dulu; tautan ulasan Google hanya setelah skor baik; balasan ulasan dicatat | Manager, marketing | UX-18 ▸ Survei | R1 |
| Atribusi & Sumber Rujukan | Lead → pembayaran per sumber, cabang, petugas (K13); sumber rujukan (pasien, staf, partner) tanpa hadiah poin | Marketing, owner | UX-38 report | R1 |
| Situs Klinik | Status terbit, pratinjau, bagian aktif, ceklis kepatuhan, editor field web per perawatan/cabang/dokter (dari Master Layanan dan profil), halaman legal dari templat | Marketing, Admin Pusat, owner | UX-50 | R1 |

### 2.12 Keuangan

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Ringkasan Keuangan | Same route as 2.1 Ringkasan Keuangan | Finance, owner | UX-22 | R1 |
| Mutasi Pembayaran | Per metode, per cabang, settlement gateway | Finance | UX-22 ▸ Mutasi | R1 |
| Piutang & Kewajiban Layanan | Piutang aging; kewajiban prabayar (paid-not-delivered, paket, saldo, DP); utang pemasok (link ke UX-52) | Finance, owner | UX-22 ▸ Kewajiban | R1 |
| Rekonsiliasi | KPI operasional vs saldo sub-ledger per hari/cabang | Finance | UX-22 ▸ Rekon | R1 |
| Pajak | Kategori PPN per item, monitor omzet PKP, ekspor Coretax (PKP) | Finance | UX-22 ▸ Pajak | R1 |
| Biaya Operasional & Kas Kecil | Pengeluaran per cabang dengan bukti | Finance, manager | UX-22 ▸ Biaya | R1 |
| Jurnal & Buku Besar | Bagan akun, jurnal otomatis, jurnal manual, kunci periode, neraca, laba rugi | Finance | UX-22 ▸ Buku Besar | R1 (journal export after posting map sign-off) |
| Ekspor | Sub-ledger CSV, komisi per penerima, jurnal (setelah posting map ditandatangani) | Finance | UX-22 ▸ Ekspor | R1 |
| Tagihan Server | Tagihan vendor bulanan, bayar QRIS/VA (same route as Saya › Tagihan Server) | Owner, finance; Admin Pusat, auditor (read) | UX-49 | R1 |

### 2.13 Laporan

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Laporan Penjualan & Uang | Uang masuk, layanan selesai, penjualan per cabang/kategori/periode | Owner, finance, manager | UX-38 | R1 |
| Laporan Perawatan | Top perawatan, kontribusi setelah bahan & komisi (K7), biaya BHP per perawatan | Owner, manager | UX-38 | R1 |
| Laporan Pasien | Baru vs kembali (K10), kunjungan kedua (K11), retensi, churn, pasien teratas, lifetime value, sumber | Owner, marketing | UX-38 | R1 |
| Laporan Staf | Utilisasi (K15), komisi (K17), target BC (K19), aktivitas dokter (kunjungan, rekam belum ditandatangani), scorecard | Owner, manager | UX-38 | R1 |
| Laporan Operasional | Waktu tunggu, tidak datang (K12), okupansi ruang/alat, penjualan per shift, waktu tunggu apotek, rata-rata transaksi | Manager | UX-38 | R1 |
| Laporan Stok | Persediaan, mutasi, kedaluwarsa, selisih opname (K18) | Pharmacist, purchasing, auditor | UX-38 | R1 |
| Laporan Marketing | Konversi lead (K13), respons (K14), performa kode promo, kepuasan | Marketing, CS | UX-38 | R1 |
| Laporan Audit | Void, refund, diskon manual, koreksi, transaksi mencurigakan | Auditor, owner | UX-53 | R1 |
| Kirim Laporan Terjadwal | Ringkasan harian ke owner (WA/email, agregat) | Owner | UX-38 ▸ Jadwal | R1 |

Every report: filter bar (periode, cabang, staf, kategori) → KPI header → grafik → tabel → ekspor (role-gated) → definisi angka (tooltip dari Kamus KPI). **Kamus KPI** is its own page (Laporan › Kamus KPI, UX-59) listing K1–K19 and PR-95 metrics with formula, source and version; a definition change (e.g. SET-22) marks trend charts "definisi berubah".

### 2.14 Persetujuan & Audit

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Persetujuan | Kotak masuk per jenis; detail dengan pengaju, alasan, dampak | Owner, manager, facility head, records officer | UX-26 | R1 |
| Matriks Persetujuan | Siapa menyetujui apa dan ambang (read-only view of SET approval rows and fixed rules) | Owner, Admin Pusat | UX-26 ▸ Matriks | R1 |
| Log Audit | Aktor, peran aktif, objek, waktu, sesi vendor | Owner, facility head, records officer, auditor (masked) | UX-31 | R1 |
| Audit Internal | Aktivitas mencurigakan, diskon manual, void, refund, selisih stok | Auditor, owner | UX-53 | R1 |
| Privasi & Persetujuan | Tujuan persetujuan & teks (versi), ledger persetujuan, register pemroses, register kebocoran dengan bukti pemberitahuan (PR-92) | Owner, data-protection duty holder | UX-30 ▸ Privasi | R1 |
| Permintaan Data Pasien | Hak, tenggat, status | Owner / pemegang tugas pelindungan data | UX-30 | R1 |
| Ekspor Data Klinik | Pekerjaan ekspor penuh dengan manifest | Owner | UX-32 | R1 |
| Pengguna & Akses | Matriks hak akses per peran (read-only dari 07), sesi aktif per staf + cabut, penugasan tugas (pelindungan data, admin IT), log perubahan akses (PR-91) | Owner, Admin Pusat | UX-3 ▸ Akses | R1 |
| Kepatuhan & Pendapat Ahli | Register bukti per kewajiban (PR-97): pendapat hukum, saran pajak, posting map akuntan, matriks kewenangan klinis, SOP (downtime, insiden, limbah), DPIA, penunjukan DPO/PJ/apoteker penanggung jawab, perjanjian pengolahan data; tiap item: pemilik, status (belum/proses/disetujui/ditolak), tanggal, berkas + checksum, berlaku sampai, fitur yang dibuka | Owner; facility head (clinical items); finance (tax/accounting); read: Admin Pusat, auditor | UX-58 | R1 |
| Status Backup | Waktu backup terakhir dan uji restore terakhir (dari vendor), tombol minta ekspor; tanpa restore mandiri | Owner | UX-32 ▸ Backup | R1 |

### 2.15 Integrasi

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| SATUSEHAT | Per cabang: antre, terkirim, dikonfirmasi, ditolak (kode), identitas perlu ditinjau | Owner, manager, facility head, records officer | UX-23 | R1 |
| WhatsApp | Nomor per cabang/brand, status, kualitas, batas pesan | Admin Pusat | UX-17 ▸ Nomor | R1 |
| Pembayaran (port) | Provider (mock/penyedia), lingkungan, kanal aktif, biaya per metode | Owner | UX-12 ▸ Pengaturan Bayar | R1 |
| Email & Google Business | Alamat pengirim email struk/laporan; tautan profil Google Business per cabang (untuk ulasan) | Admin Pusat | UX-2 ▸ Integrasi | R1 |

### 2.16 Saya (every role)

Ganti Peran · Ganti Cabang · Ganti Klinik (when applicable) · Profil & Keamanan (password, TOTP, sesi aktif) · Komisi Saya and Target Saya (only roles with "Own commission & target" in 07) · Jadwal Saya · Notifikasi · Tampilan · Akses Vendor (owner; Admin Pusat read) · Tagihan Server (owner, finance) · Bantuan · Keluar.

### 2.17 Pengaturan (settings menu)

One page per group of §5; each group page shows only the SET rows the acting role may change or draft (07 "Tenant/branch settings"). Groups: Klinik & Cabang · Layanan & Harga · Uang & Kasir · Pajak · Jadwal & Booking · Antrean · Komunikasi & Otomasi · CRM · Komisi · Stok · Klinis · Dokumen · Pengguna & Akses · Privasi · Situs Klinik · Laporan. Each row shows current value, default and its source, bounds, effective date, history, Kembalikan ke default; drafts show "Menunggu persetujuan {peran}".

### 2.18 Landing page per role (16 roles)

| Role | Phone tabs (4 + Menu) | Lands on |
|---|---|---|
| Owner | Ringkasan · Cabang · Persetujuan · Keuangan | Ringkasan Owner |
| Admin Pusat | Ringkasan · Cabang · Layanan · Staf | Ringkasan Admin Pusat |
| Manager | Ringkasan · Hari Ini · Persetujuan · Stok | Ringkasan Cabang |
| Facility head | Ringkasan · Persetujuan · Keluhan · Audit | Ringkasan Klinis |
| Records officer | Koreksi · Pasien · Audit · SATUSEHAT | Koreksi Rekam Medis |
| FO/cashier | Hari Ini · Jadwal · Kasir · Pesan | Hari Ini |
| Central CS | Pesan · Lead · Jadwal · Tindak Lanjut | Ringkasan CS |
| BC | Pasienku · Tindak Lanjut · Pesan · Target | Pasienku |
| Doctor | Antrean · Pasien · Permintaan · Keluhan | Antrean Dokter |
| Nurse / Therapist | Ruang · Permintaan · Keluhan · Jadwal | Ruang Saya |
| Pharmacist | Siapkan · Serahkan · Stok · Keluhan | Ringkasan Apotek |
| Finance | Keuangan · Komisi · Laporan · Pajak | Ringkasan Keuangan |
| Marketing | Situs · Lead · Promo · Laporan | Ringkasan Marketing |
| Purchasing | Stok · Pembelian · Transfer · Utang | Ringkasan Pembelian |
| Internal auditor | Audit · Laporan · Log · Stok | Ringkasan Audit |
| Vendor roles | — (desktop console) | Tenant |

Branch roles never see branches outside their scope; tenant-wide roles start on "Semua Cabang".

## 3. Vendor console — complete menu tree (Level 1)

| Page | Content | Roles | UX | Release |
|---|---|---|---|---|
| Tenant | Daftar klinik: status siklus, biaya bulanan, cabang, go-live, status bayar, kesehatan | All vendor roles | UX-40 | R1 |
| Detail Tenant | ▸ Ringkasan · Cabang · Onboarding · Integrasi · Tagihan · Sesi Dukungan · Audit (vendor actions only); aksi: Ajukan Suspend / Aktifkan Kembali / Mulai Exit (pengaju: vendor finance atau support; penyetuju: platform owner, orang berbeda), alasan wajib, pemberitahuan owner | Vendor roles per IAM-10 | UX-40 | R1 |
| Onboarding | Ceklis per tenant & cabang | Onboarding | UX-41 | R1 |
| Integrasi | Status WABA, SATUSEHAT (kode), webhook pembayaran | Support | UX-42 | R1 |
| Tagihan Server | Versi biaya (ajukan → setujui, bulan berlaku), tagihan (terbit, jatuh tempo, prorata), percobaan bayar AutoLaris (status, Advice), nota kredit/pembebasan (ajukan → setujui) | Vendor finance (ajukan), platform owner (setujui) | UX-43 | R1 |
| Sesi Dukungan | Ajukan sesi (tenant, tujuan, jenis objek, durasi ≤ 2 jam); ruang lingkup data klinis/pribadi menunggu persetujuan owner; aktif & riwayat; perpanjang sekali; data yang dibaca tercatat | Support, onboarding | UX-44 | R1 |
| Kesehatan Platform | Uptime, worker, backlog, backup, error rate | Platform owner, support | UX-45 | R1 |
| Tim Vendor | Staf vendor, peran, TOTP | Platform owner | UX-46 | R1 |
| Audit Vendor | Semua aksi vendor | Platform owner, vendor auditor | UX-47 | R1 |
| Profil Vendor | Badan usaha, NIB, PSE, NPWP, lokasi data, pendapat hukum | Platform owner | UX-34 | R1 |
| Feature Flag Platform | Fitur khusus tender per tenant (ADR-7) | Platform owner | UX-40 ▸ Flag | R1 |
| Templat Global | Templat halaman legal situs, pesan sistem | Platform owner | UX-54 (vendor scope) | R1 |

## 4. Public site per tenant (patient)

Release 1 (generated, PR-64–PR-67, UX-51): Beranda · Perawatan (filter keluhan, kategori) · Detail Perawatan · Cabang (daftar + peta) · Detail Cabang · Dokter · Profil Dokter · Booking (UX-24) · Kebijakan Privasi · Syarat & Ketentuan · Kebijakan Pembatalan. No promo, testimonial or discount pages (Permenkes 1787/2010, JUR-ID-7).

Phase 4 (PR-40): Artikel (dengan reviewer medis) · Masalah Kulit (halaman keluhan) · Skin Quiz · Paket/Program · Produk (tampilan saja) · Before/After (hanya bila konsultan hukum mengizinkan).

Patient portal (Phase 4, research §8): Beranda · Booking & ubah jadwal · Riwayat · Paket & saldo · Perawatan setelah tindakan · Persetujuan & data saya · Bantuan. Not in Release 1 (IAM-2).

## 5. Pengaturan — settings registry (P-22, B-24)

Every row is a **setting**: researched default, type and bounds, scope, who may change it, effective date, audit. Class F rules (law, money integrity, isolation) are listed in PLAN CD-* and are **not** settings. Settings are grouped exactly as the Pengaturan menu shows them.

| ID | Pengaturan › Group | Setting | Default (research / decision) | Bounds | Scope | Changed by |
|---|---|---|---|---|---|---|
| SET-1 | Klinik & Cabang | Profil klinik (nama, logo, aksen) | Tenant data; accent validated UI-2 | UI-8 limits | Tenant | Owner, Admin Pusat |
| SET-2 | Klinik & Cabang | Jam buka, hari libur, tutup khusus | From onboarding | Valid time ranges | Branch | Admin Pusat, manager (own branch) |
| SET-3 | Klinik & Cabang | Zona waktu cabang | Branch city (WIB/WITA/WIT) | Indonesian zones | Branch | Admin Pusat |
| SET-4 | Layanan & Harga | Durasi default persiapan, tindakan, jeda (per-service values live in Master Layanan) | Persiapan 10, tindakan 30, jeda 10 min (accepted P-25; per-service values from Numa catalog at onboarding) | Persiapan 0–120; tindakan 5–480; jeda 0–120 min | Tenant | Admin Pusat |
| SET-5 | Layanan & Harga | Harga cabang (override) | Normal price | > 0 (free only via discount/waiver flows) | Branch | Owner only |
| SET-6 | Uang & Kasir | Biaya konsultasi & pembebasan | Amount from Numa (tenant input); waiver rule B-02 fixed | > 0 | Tenant | Owner |
| SET-7 | Uang & Kasir | Kontrol gratis per item | 1, sampai tanggal kontrol + 7 hari (CD-02) | 0–5; 0–30 hari | Tenant | Owner |
| SET-8 | Uang & Kasir | Masa berlaku paket default (templates may differ) | 365 hari (CD-03, B-03) | 30–1095 hari | Tenant | Owner |
| SET-9 | Uang & Kasir | DP minimum paket default, cicilan diizinkan default (templates may differ) | Kosong; diizinkan (CD-04, CD-05) | 0–100% | Tenant | Owner |
| SET-10 | Uang & Kasir | DP booking & batas ubah jadwal | Off; 24 jam (CD-06) | 0–72 jam | Per service | Owner |
| SET-11 | Uang & Kasir | Penyetuju refund tunai | Owner (+ manager opsional) (CD-08) | Owner / Owner+Manager | Tenant | Owner |
| SET-12 | Uang & Kasir | Batas diskon manual per peran | FO 0%; manager 10% or Rp500.000, **whichever is lower** (CD-37) | 0–100% and ≥ 0 rupiah; both evaluated, lower wins | Tenant | Owner |
| SET-13 | Uang & Kasir | Ambang selisih kas untuk **eskalasi ke owner** (every non-zero variance always needs manager approval, BILL-18 fixed) | Rp50.000 (accepted P-25) | 0–Rp1.000.000 | Branch | Owner |
| SET-14 | Uang & Kasir | Metode bayar aktif, provider port, biaya per metode (MDR) ditanggung klinik (patient-borne MDR is disabled until a recorded decision defines its fee line, tax and refunds), masa berlaku link bayar | Tunai, QRIS, EDC, transfer, saldo; provider `mock` (CD-39); MDR ditanggung klinik; link 24 jam (accepted P-25) | Provider list; link 1–72 jam | Tenant | Owner |
| SET-15 | Jadwal & Booking | Lepas slot bila terlambat; konsekuensi | Off (CD-09, D-05); Numa may choose 15 min (Numa brief keputusan.md A1); konsekuensi: tidak ada | Off, or 5–60 min; consequence = slot release only (booking-DP effects follow BILL-13; sessions are never deducted for lateness, BILL-24) | Branch | Manager |
| SET-16 | Jadwal & Booking | Booking online: horizon, batas H-, layanan yang bisa dibooking online, DP wajib pasien baru | 30 hari; 2 jam; layanan bertanda booking online di Master Layanan; DP pasien baru off (accepted P-25) | 1–90 hari; 0–48 jam | Branch | Admin Pusat |
| SET-17 | Jadwal & Booking | Tahan slot saat bayar DP | 10 menit (research §10.3: Kasera/Termilo) | 5–30 min | Tenant | Admin Pusat |
| SET-18 | Komunikasi & Otomasi | Jam kirim pengingat dan jendela diam | H-1 10:00 dan 2 jam sebelum (CD-36); tidak kirim 21:00–07:00 (accepted P-25) | Kirim 07:00–21:00 waktu cabang | Branch | Admin Pusat |
| SET-19 | Komunikasi & Otomasi | Skenario otomasi (PR-94): on/off, jarak hari, batas frekuensi per pasien | Aftercare saat tutup + H+1 (research §5.2; Numa brief keputusan.md P-pesan H+1/H+7/H+14/H+21); tindak lanjut H+7 kepuasan, H+14 rencana, H+21 belum ada jadwal; H-3 reminder; isi ulang H-5 sebelum perkiraan habis dengan persetujuan pemasaran (Numa brief keputusan.md P4); ulang tahun off; batas 2 pesan/hari/pasien (accepted P-25) | Offsets 0–60 hari; cap 1–5/hari | Tenant | Admin Pusat |
| SET-20 | Komunikasi & Otomasi | SLA respons lead | 15 menit jam buka (CD-24) | 5–120 min | Tenant | Owner |
| SET-21 | Komunikasi & Otomasi | Batas kirim harian | 80% batas Meta (CD-27) | 10–90% | Tenant | Owner |
| SET-22 | CRM | Jendela kunjungan kedua / pasien lama tidak datang | 60 / 90 hari (CD-23) | 14–365 hari; kunjungan kedua < lama tidak datang; change versions the KPI definition (K11) | Tenant | Owner |
| SET-23 | CRM | Pengingat paket hampir habis | 30/14/7 hari (PR-30) | Up to 3 values, each 1–90 hari, descending | Tenant | Admin Pusat |
| SET-24 | Komisi | Aturan & nilai komisi | Belum ada sampai owner isi (CD-07) | Per rule | Tenant | Owner |
| SET-25 | Komisi | Metrik target BC, periode target | Nilai closing/bulan + rencana terpilih penuh (CD-25); bulanan | Enumerated metrics; bulanan/triwulan | Tenant | Owner |
| SET-26 | Stok | Stok minimum/target per item per cabang | Kosong sampai diisi | ≥ 0 | Branch | Pharmacist, purchasing |
| SET-27 | Stok | Jadwal hitung stok; peringatan hampir kedaluwarsa | Harian vial terbuka/toksin, mingguan nilai tinggi, bulanan lainnya (CD-22); 30 hari (K18) | Harian–bulanan per class (no less frequent than CD-22 minimum for open vials/toxins); 7–180 hari | Branch | Manager, pharmacist |
| SET-28 | Klinis | Templat catatan per perawatan | Research §5.2 templates; reviewed by facility head | Versioned; cannot remove legally required RME fields | Tenant | Facility head |
| SET-29 | Klinis | Protokol foto (sudut) | Depan, 45°, samping (CD-18) | 1–6 angles from an enumerated list | Tenant | Facility head |
| SET-30 | Klinis | Matriks delegasi | Kliniknuma RG-16 default (CD-16) | **Only narrower than the fixed legal table** (class F floor by profession); never below credential/competence checks | Tenant | Facility head + owner (two different people) |
| SET-31 | Klinis | Target respons keluhan klinis (triase merah/kuning/hijau) / layanan | Merah 15 menit, kuning 2 jam, hijau 8 jam kerja (= 1 hari kerja, Numa brief keputusan.md A3); layanan 8 jam kerja (CD-40) | Merah 5–60 min; kuning 30 min–4 jam; hijau 4–24 jam kerja; layanan 1–24 jam kerja | Tenant | Facility head (klinis), owner (layanan) |
| SET-32 | Dokumen | Templat struk, persetujuan, surat, halaman legal; ukuran kertas struk per cabang | Vendor templates (UX-54); 80 mm | Versioned; required legal and clinical fields cannot be removed; 58/80 mm/A4 | Tenant / branch | Admin Pusat, facility head (clinical) |
| SET-33 | Dokumen | Format nomor RM, invoice, PO | Prefix cabang + tahun + urut (accepted P-25) | Prefix and separator only; sequence gap-free and never reused (fixed); change effective only before the first document or at period start; past numbers immutable | Tenant | Admin Pusat |
| SET-34 | Pengguna & Akses | Peran per staf, cabang | Invitation | 07 matrix; Level 2 roles need owner approval; nobody changes own roles | Tenant | Owner; Admin Pusat (Level 3 roles) |
| SET-35 | Pengguna & Akses | Batas waktu sesi perangkat non-FO (tablet ruang, desktop kantor); metode tanda tangan klinis | 15 menit; PIN (accepted P-25) | 5–60 menit; PIN/OTP | Tenant | Owner |
| SET-36 | Situs Klinik | Bagian situs aktif, harga tampil per perawatan | Semua bagian R1 aktif; harga tidak tampil | On/off | Tenant | Admin Pusat, marketing |
| SET-37 | Laporan | Ringkasan harian ke owner, penerima laporan terjadwal | Off; owner | On/off, 17:00–23:00 | Tenant | Owner |
| SET-38 | Jadwal & Booking | Peringatan pasien menunggu | 20 menit (accepted P-25) | 5–120 menit | Branch | Manager |
| SET-39 | Pajak | Status PKP dan tanggal efektif (fact entered by owner); kategori pajak per item (in Master Layanan); aturan pembulatan | Non-PKP until evidence; pembulatan ke rupiah | PKP needs tax-advice record (PR-24); PPN rate fixed | Tenant | Owner |
| SET-40 | Antrean | Prefiks nomor per loket/ruang, panggilan suara, orientasi TV | A-, B-; suara off; landscape | Prefix 1–3 letters | Branch | Manager |
| SET-41 | Uang & Kasir | Kelompok umur piutang, cicilan maks, tanggal mundur diizinkan | 0–30/31–60/61–90/>90 (K4); cicilan tanpa batas jumlah (B-03; optional per-template maximum 2–24); tanggal mundur maks 1 hari dengan persetujuan (accepted P-25) | Aging buckets fixed set; backdate 0–3 hari | Tenant | Owner |
| SET-42 | Komunikasi & Otomasi | Penugasan percakapan baru | Manual (accepted P-25) | Manual / bergilir per cabang | Tenant | Admin Pusat |
| SET-43 | Uang & Kasir | Matriks persetujuan: penyetuju void dan jendela waktunya, ambang selisih opname, ambang PO, persetujuan retur | Void: manager dalam hari yang sama, setelahnya owner; selisih opname > 2% (§4 PRD); PO > Rp10.000.000 owner; pemusnahan: persetujuan kedua mulai Rp1 juta/kejadian atau Rp5 juta/bulan, owner mulai Rp10 juta (Numa brief keputusan.md A4) | Requester ≠ approver always (fixed) | Tenant | Owner |
| SET-44 | Komisi | Hari tutup batch komisi bulanan (basis, accrual and the monthly cycle are fixed by BILL-15 and shown read-only) | Akhir bulan | Tanggal 1–28 sebagai hari tutup | Tenant | Owner |
| SET-45 | Privasi | Teks dan tujuan persetujuan (versi) | Vendor templates per purpose (PRIV-1 matrix) | Purposes from the fixed list; retention periods fixed by law | Tenant | Owner (data-protection duty) |
| SET-46 | Klinik & Cabang | Data izin klinik per cabang: nomor izin, NIB, Penanggung Jawab, ID organisasi SATUSEHAT | Onboarding input | Required before clinical go-live | Branch | Owner, Admin Pusat |
| SET-47 | Klinis | Masa berlaku persetujuan tindakan | 90 hari; di luar batas tindakan/area/jumlah wajib persetujuan ulang (Numa brief keputusan.md A3) | 30–365 hari | Tenant | Facility head |
| SET-48 | Klinis | Masa berlaku resep; jeda isi ulang; penyerahan sebagian | 30 hari (akut 7 hari); jeda 75% perkiraan hari pakai; sebagian maks 4 kali (Numa brief keputusan.md A4) | 3–90 hari; 50–95%; 1–4 kali | Tenant | Pharmacist proposes, facility head approves (both required before the version takes effect) |
| SET-49 | Uang & Kasir | Perpanjangan paket oleh manajer | Satu kali maks 90 hari (Numa brief keputusan.md A1) | 0–90 hari, max 1 | Tenant | Owner |

**Fixed rules (class F), not settings:** front-desk idle lock 120 s (IAM-7, CD-10); queue TV never shows patient names; gap-free document sequences; legal floor of the delegation table; branch price and consultation fee > 0; PPN rate; RME and financial retention periods; patient balance never expires (B-04); requester ≠ approver, except the whitelisted owner-initiated write-off (BILL-23, PR-37) with mandatory reason and audit.

Default provenance: each default is tagged research (section), decision (ID), tenant input (filled at onboarding) or **proposal** (awaiting owner approval; Kembalikan ke default restores an approved default only, a proposal shows "belum disetujui").

Proposals: every value previously marked proposal was accepted by the owner as a starting default on 2026-11-02 (P-25) and stays adjustable; Numa Klinik's brief answers replace them at onboarding where Numa says otherwise.

Rules for the registry:

- SET-* values are versioned with effective date; transactions snapshot the value they used (DATA-6).
- A change shows: old value, new value, effective date, who, reason; owner is notified of money and clinical settings changes.
- Bounds are enforced server-side; a value outside bounds is rejected with the bound named.
- "Kembalikan ke default" restores the researched default.
- Adding a new setting needs a decision (B-24) and a SET-* row here; settings never alter class F rules.

## 6. Page count (Release 1)

Clinic app: 16 menu groups + Pengaturan (16 setting pages); about 110 page rows in §2 (route pages and named segments; rows marked "same route" are counted once). Vendor console: 12. Public site: 11 (Phase 4 and patient portal listed separately). All §2 rows are Release 1 (P-21, P-24). A stable page-ID inventory (PG-*) is generated when TASKS are written; until then each row's UX-* is its identifier.

## 7. Traceability

Each page row names its UX-* contract; each UX-* names its PR-*. A page without a UX-* is a tab/segment of the named UX-*. Settings SET-* are owned by PR-38 (settings registry) and B-24. New in v0.6: Master Layanan (PR-88), depots (PR-89), supplier payables (PR-90), access administration (PR-91), privacy workspace (PR-92), family package sharing switch (PR-93), automation scenarios (PR-94), extra reports and KPI dictionary (PR-95), instalment schedules (PR-96).

Not decided, kept out of Release 1 until the owner decides: operational AI summary, inbox bot hand-off, corporate group booking, referral rewards.
