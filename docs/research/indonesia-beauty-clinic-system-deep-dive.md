# Indonesia Beauty Clinic System — Deep Dive (Screen-Level Evidence, Workflows, Data, Rules)

- Date: 2026-10-29
- Builds on: `indonesia-beauty-clinic-system-ui-ux-research.md` (market, menus, public front end) and `beauty-clinic-admin-system-research.md` (first REA pass, guards).
- Purpose: go below the marketing layer to **real authenticated screens, field-level forms, workflow steps, business rules, report catalogs, permission models and regulatory field requirements** used by Indonesian beauty-clinic software.
- Method (passive, no login): official vendor tutorials and user manuals with real screenshots (ICONIX: 93 UI screenshots reviewed), vendor help-center indexes (Assist.id, Klinik Pintar), complete public JavaScript of SaaS clients (Kasera: 52 chunks, ClinicHub: 55 lazy chunks + main) read statically, primary regulation text (Permenkes 24/2022).
- Evidence on disk: `vendor-img/iconix-tut/` (191 images; contact sheets `vendor-img/iconix-sheet-00..07.jpg`), `bundles/kasera-full/` (`kasera-api.txt`, `kasera-labels.txt`), `bundles/clinichub-app/` (`ch-labels.txt`).
- Labels: **OBS** observed in screenshot/bundle; **DOC** stated in vendor docs; **REG** regulation; **INF** inference.

---

## 1. What "deeper" revealed (summary)

1. **Real workflow of an Indonesian beauty clinic (ICONIX, OBS):** Resepsionis (register → new visit → queue) → Perawatan (doctor exam: Data Pasien / Pemeriksaan & Resep / Tindakan Dokter or Pemakaian Paket) → Depo/Apotek (if prescription) → Kasir (regular or package payment) → kwitansi locked. Every transaction must pass Resepsionis except direct product sales.
2. **The money model is "tarif Umum vs tarif Member" + fees per role** (Dokter, Beautician, Sales) set per treatment in Rp or %, plus *Biaya Modal* (cost) per treatment, plus BHP ("kabin") recipe auto-deducted from stock (OBS).
3. **Packages are treatments of type PAKET** whose content ("Isi Paket") lists treatments × frequency, with an expiry in months; each visit is numbered ("Kunjungan Ke: 2"), next-visit date is mandatory for packages, cancellation converts the remainder into deposit (not cash) (OBS/DOC).
4. **Controls exist but are simple:** discount at cashier needs a "Password Diskon Penanggung Jawab" (OBS), "Laporan Transaksi Dihapus" exists, "Satu User hanya Untuk Satu Komputer" warning, user wizard ends with "Konfirmasi Password Admin", login history tab.
5. **Report catalogs are long radio-button lists** with a date-range per report and one "Tampilkan Data Untuk DiCetak" button; periods are limited to 1 month (3 months only at off-peak hours) — a performance constraint visible in the UI (OBS).
6. **Newer SaaS (ClinicHub, Kasera) add modern layers** absent in legacy tools: UU PDP erasure workflow and patient data export, WebAuthn/passkeys, Meta CAPI, GA4/GSC setup, WhatsApp flows, SLA alerts, auto-close conversations, re-engagement, AI agents with knowledge base and evaluation, proforma (quotation) → invoice, consumption drafts (BHP usage per reservation), void approvals, commission payout batches, expenses and profit-loss, public booking funnel analytics (OBS).
7. **Regulatory field minimums (REG, Permenkes 24/2022):** identity = No. RM + nama + NIK; social data = agama, pekerjaan, pendidikan, status perkawinan; corrections within 2×24 hours by the provider; retention ≥25 years after last visit; patient owns record content (identity, examination results, diagnosis, treatment & follow-up plan, provider name & signature); access rights set by facility head; electronic signature optional but recognized.

---

## 2. End-to-end operational workflow (as implemented in the market)

### 2.1 ICONIX beauty workflow (OBS, step-level)

```
[Resepsionis]
  Pendaftaran Pasien Baru ──► Kunjungan Baru (cari pasien ≥2 huruf, pilih dokter opsional)
        │                         └─► PROSES KE ANTRIAN
        ▼
  Daftar Antrian (4 tabs): Antrian Hari Ini | Jadwal Besok (NON-PAKET) |
                           Appointment Pasien (NON-PAKET) | Appointment Pasien (KHUSUS PAKET)
  Row actions: Masuk Perawatan | Detail Paket Diambil | Batal
        │
[Perawatan]
  Antrian Perawatan → row actions: Riwayat Pasien | Tambah Paket | Entry Treatment dan Resep | Batal (non-paket)
  Exam screen header: "A-2400027 - NAMA / Kunjungan Ke: 2 / No.Antrian (PAKET PERAWATAN): ..."  [Masukan Data]
  Tabs (regular): Data Pasien | Pemeriksaan & Resep Dokter | Tindakan Dokter
  Tabs (package): Data Pasien | Diagnosa & Resep Dokter | Pemakaian Paket | Tambah Tindakan
        │
        ├─ no prescription ─► [Kasir]
        └─ prescription ────► [Depo/Apotek: Resep Dokter] ─► [Kasir]
[Kasir Pembayaran]
  Tabs: Pembayaran Perawatan Reguler | Pembayaran Perawatan Paket
  Row actions: Bayar | Print Invoice | Kirim Invoice
  PROSES BAYAR → confirm → kwitansi (data becomes read-only)
Shortcut path: Perawatan > "Khusus Treatment Reguler Saja" (no photo, no prescription, no package) → Proses ke Kasir
```

Rules observed (OBS/DOC):
- Edits allowed on "Data Perawatan" only **before** payment; after kwitansi, transaction cannot be edited/deleted.
- "Masukan Data" persists the exam; the (+) button must be clicked per line ("Jangan lupa klik tombol (+)") — a UX trap repeated in many forms.
- Next-visit date mandatory for packages; default 2 weeks after visit 1 or 4.
- Package cancellation: tick packages → "Proses Retur Paket" → remaining value to deposit, never cash; retur calculation screen shows Pemilik, Nama Paket, Tarif Paket, items used, Nilai Item Terpakai.
- Member: annual validity; member price tier + points.

### 2.2 Klinik Pintar workflow (DOC)
Admisi: add practitioner practice → schedules → new patient → outpatient registration or reservation → change reservation to registration → initial assessment (Kajian Awal) → queue → documents. Doctor: fill Resume Medis (SOAP) → beauty additions (Anatomi Wajah, Anatomi Tubuh via Objective > +Isian Tambahan, Foto Before><After in Plan) → Simpan. Pharmacy: inventory in/out, opname, compounded prescription. Cashier: receipt without medical record, payment status, drug handover document. Owner: income, services, inventory, disease, commission reports.

### 2.3 Assist.id / Aesta workflow (DOC + OBS)
Online appointment (AntriCepat via QR in clinic or from home; AssistMe patient app) → registration & queue (status colours: yellow → waiting → engaged → succeed/failed) → EMR (diagnosis, procedures, procedure packages, prescriptions, files, BHP) → general consent (digital or manual upload) → cashier (deposit pack, voucher pack, discount pack, booking fee pack) → reports (CashBook: jurnal, buku besar, laba rugi) → SATUSEHAT monitoring (≥50% data sent target).

### 2.4 Kasera workflow (OBS, bundle)
Public booking page (availability → hold → OTP → deposit via Kasera Pay) → appointment (quick-add with natural language; restore; no-show; refund) → POS checkout (booking checkout or quick sale, promotions preview, payment fees, points release) → order (send receipt, WhatsApp link) → commission (rules, payout release) → staff self-service (my schedule, my earnings, my transactions, attendance clock-in/out).

### 2.5 ClinicHub workflow (OBS, bundle)
Lead (WA inbox, lead OTP verification, livechat channels/labels) → booking request → appointment → consent (template, unsigned alert) → medical record (records) → usage/consumption draft (BHP per reservation) → proforma (quotation) → invoice (void awaiting approval) → commission (adjust, payout batch) → follow-up, re-engagement, campaigns, referral, promo keeps → AI analyst / suggest remarks / agents.

---

## 3. Screen catalog with field-level detail (ICONIX, OBS)

### 3.1 Global shell
Dark left sidebar with user avatar and role ("ICONIX SUPPORT / administrator"), collapsible groups: DASHBOARD · Administrasi · Resepsionis · Perawatan (badge count) · Depo/Apotek · Kasir Pembayaran (badge) · Data Transaksi · Laporan Klinik. Top bar: notification icons with numeric badges (orders, appointments, chats). Page title with pin icon, breadcrumb, panel with expand/collapse buttons. Floating WhatsApp support button.

### 3.2 Dashboard
4 KPI tiles: PEMASUKAN (Tunai/K.Debit/K.Kredit) · PASIEN BARU (Khusus Perawatan) · KUNJUNGAN (pada hari ini) · date/time tile. "ICONIX Analytics" with bar chart **Berdasarkan Umur** (0–13, 14–21, 22–40, 41–60, 60+) and line chart **Berdasarkan Waktu** (visits by hour bands).

### 3.3 Pendaftaran Pasien Baru — "Input Data Pasien"
Fields (* = required): **Tgl Daftar*** · **Nama Pasien*** · **No. RM*** (auto, e.g. A-2400048) · No. Member · KTP/Paspor · checkbox "Saya menjamin bahwa pasien sudah membaca dan menandatangani consent pembukaan data dari SATUSEHAT" · No. Reseller · Downline Dari (select) · **Alamat Rumah*** · **Kota*** · Jenis Kelamin · Pekerjaan · Status Pernikahan · Agama · **Tempat/Tgl Lahir*** · Umur (auto) · Email · **No. Whatsapp*** · Photo Pasien (4x6) [Ambil Dari Komp | Ambil Dari Kamera Smartphone] (max 5 MB, jpg/png) · Hak & Kewajiban (PDF upload, 1 doc) · Sumber Info · Password (patient app) · *Data Kesehatan Lainnya*: Alergi Obat · Masalah Kulit · Catatan · [Tambahkan].
Notable: reseller/downline fields (clinics that sell skincare via resellers); SATUSEHAT consent checkbox at registration; patient app password set by staff (INF: weak practice).

### 3.4 Antri Pasien (Entry Data Antrian Pasien)
Tgl + time · No (auto queue no.) · Pasien [Scan Barcode | Cari Pasien] · Dokter (select) · [PROSES KE ANTRIAN] · shortcut [Pendaftaran Pasien Baru].

### 3.5 Appointment Pasien
Tabs: Calendar | Konfirmasi Appointment Dari Aplikasi Mobile. Left list of doctors to drag onto calendar days; month/week/day views; coloured event chips "09.30 AD01 - dr. Ana"; instructions to drag, click to delete, "Hapus Setelah Diletakkan" option.

### 3.6 Exam — Data Pasien tab
Kunjungan Berikutnya (date + time) · Riwayat Pasien [Klik Untuk Lihat Riwayat Pasien | Lihat Foto Sebelum Perawatan] · Ambil Foto Sebelum Perawatan [Upload Foto Dari PC/Laptop | Ambil Dari Kamera Smartphone] · Ambil Foto Setelah Perawatan [same] (max 5 MB, rename without spaces, jpg/jpeg/png) · Upload Dokumen seperti (inform consent, dll) (max 5 MB, max 5 docs, PDF) · Alergi Obat · Masalah Kulit · Catatan. Banner: "Information: Satu User hanya Untuk Satu Komputer".

### 3.7 Exam — Pemeriksaan & Resep Dokter tab
Dokter (select) · Anamnesis · Pemeriksaan · Diagnosis (free text) · Resep Dokter [Input Resep Dokter] + preview textarea + print button.
Gap vs regulation (INF): free-text diagnosis without ICD-10 coding (Klinik Pintar and Assist do code ICD-10).

### 3.8 Exam — Tindakan Dokter tab (regular)
Line grid: Tindakan (lookup) · Jumlah · Beautician (lookup) · Harga · Diskon · Nilai (Rp/%) · Jumlah (line total) · (+). Note: "pemberian diskon di sini berpengaruh dengan fee dokter, silahkan lihat Settingannya di setting Klinik" — discounts reduce doctor fees per clinic setting.

### 3.9 Exam — Pemakaian Paket / Tambah Tindakan (package)
Package code + name chip; checklist per included treatment (Tindakan ☐ · treatment name · Beautician); "Tambah Tindakan" grid for out-of-package items (Tindakan · Diskon % · Beautician · +). Package picker modal: KODE · NAMA PAKET · [Tambah Paket] · list "Paket Yang Di Ambil".

### 3.10 Data Perawatan (list)
Columns: ANTRIAN · TGL · PASIEN · DOKTER · RATE (stars = patient rating) · Proses [Detail Perawatan | Cek Bahan]. "Edit Pemakaian Kabin Pada Perawatan": KODE PRODUK · NAMA BAHAN · JUMLAH · Hapus; add: Pilih Obat Kabin + Jumlah Pemakaian Kabin + Tambahkan · SELESAI.

### 3.11 Kasir — Pembayaran Perawatan (list)
Tabs Reguler/Paket; columns NO.ANTRIAN · MASUK · NAMA PASIEN · DOKTER · AKSI [Bayar | Print Invoice | Kirim Invoice].

### 3.12 Kasir — Transaksi Pembayaran (form)
Header: Tgl Transaksi · No Kuitansi · Nama Pasien (+ points badge) · Nama Dokter · Administrasi (Rp) · checkbox "Kirim Pesan WA/SMS/EMAIL Sehabis Kunjungan".
Lines: TINDAKAN · HARGA (Rp) · DISKON (Rp) · NILAI (Rp) · SALES (select) · Obat Resep rows.
Totals: big orange total · Diskon (Rp/%) [Diskon] · SubTotal · Total · No.Voucher [▶] · Senilai Rp · Point Rewards (balance; Redeem min 10 PR / Simpan) · Uang Deposit (Redeem / Simpan) · up to 3 tenders: Tunai (+ Kas Kecil), K.Debit (+ bank), K.Kredit (+ bank) with amounts · Uang Kembalian · [PROSES BAYAR]. Discount modal: Jenis Diskon · Nominal Diskon · **Password Diskon Penanggung Jawab** · Tutup/Simpan.
Package payment variant: Jenis "PAKET (Kunjungan Ke: 1)" · Pendaftaran · Administrasi · lines PAKET / NAMA TREATMENT / BEAUTICIAN / BIAYA / SALES · installment allowed with clinic-set minimum.

### 3.13 Kwitansi (receipt)
Clinic name/address/phone · "*** KWITANSI PEMBAYARAN ***" · Tgl, No.Kwitansi, Waktu Cetak · Pelanggan (code, name, Kunjungan ke) · Kunjungan Berikutnya · Kasir · Dokter · Jenis Pelanggan (MEMBER/NON-MEMBER) · Pendaftaran · Administrasi · Tambahan · lines with price × qty, discount, total · package sub-lines · Jumlah · Total · Pembayaran tunai · Kembali/Sisa · "> Lunas" · Catatan: "Paket (AK382 - FILLER EROPA 2019) -> Terpakai: 1X & Sisa: 3X treatment" · "Terima kasih atas kunjungan Anda".

### 3.14 Pembayaran Obat/Produk
Tabs: Penjualan Langsung | Pesanan Online (badge). Columns TGL · KWITANSI · NAMA PASIEN · NETTO · Proses [Bayar | Hapus]. Form: items NAMA OBAT · HARGA JUAL · JUMLAH · DISKON · TOTAL · BATAL; Diskon; Jenis Pembayaran; Jumlah Bayar; Kembalian; PROSES BAYAR.

### 3.15 Deposit & Member payment
Tanggal · Kuitansi · Pasien · Untuk Pembayaran (Pendaftaran Member / Perpanjangan / Deposit) · Jenis Pembayaran (Tunai + Kas Kecil) · Total · [BAYAR].

### 3.16 Data Paket Perawatan Yang Masih Ada Sisa Perawatan
TANGGAL · PASIEN · DOKTER · PAKET PERAWATAN · PROSES (edit) → Perhitungan Nilai Retur Paket Perawatan.

### 3.17 Administrasi > Data Treatment (hub)
Tiles: Data Treatment · Setup Promo · Setup Point Reward · Setup Voucher · Setup Membership.
**Data Tarif Klinik** list: KODE · NAMA JASA/TINDAKAN · BAGIAN · JENIS (TINDAKAN/PAKET) · TARIF (RP) · Proses. Buttons: Entry Data · Import Data · Export Full Data. Row menus: for TINDAKAN [Edit Tindakan | Edit Bahan/Kabin | Foto Tindakan | Hapus Tindakan]; for PAKET [Edit Paket | Isi Paket | Foto Paket | Hapus Paket].
**Input Data Treatment**: Unit (e.g. Laser) · Kode (auto) · Nama · Jenis (TINDAKAN/JASA/PAKET) · Durasi (menit) · Tarif Umum Rp / Member Rp · Fee Dokter (Rp/%) · Fee Beautician (Rp/%) · Fee Sales (Rp/%) · Biaya Modal (Rp) · Paket Expired (bulan, packages) · [Tambahkan/Update Data].
**Foto Treatment** (for patient app): Kode · Nama · Judul · photo · description · Harga Diskon (Rp/%) · "Tampilkan di mobile apps?".
**Import template rules**: data from row 2, .xlsx, numbers without separators; columns: Nama Unit/Bagian* (Laser, Chemical Peeling, Thread, Konsultasi, Injection, Surgery, Serum Treatment, Facial, Spa, Slimming, Toning, Muscle Sculpting, Mix, Others) · Kode · Nama Item* · Biaya modal · Fee Dokter · Tarif Umum · Tarif Member · Fee Beautician · Fee Sales · Tipe (Jasa/Tindakan/PAKET)* · Lama Perawatan (menit)* · fee type string "Fee Dokter(rp/pr)#Fee Beautician(rp/pr)#Fee Sales(rp/pr)"; existing codes are updated. Option "Hapus Data Treatment yang sudah ada di database? YA/TIDAK".

### 3.18 Setup Promo / Point / Voucher
Promo list: KODE · NAMA PROMO · JANGKA WAKTU · JENIS · Proses [Diskon Treatment | Diskon Obat | Edit Promo | Hapus Promo]. Input: Kode · Nama · Jenis (Discount) · checkbox "Kirim SMS dan Email Pemberitahuan ke semua Klien via SMS Gateway / Email Marketing" · Periode Transaksi. Rule banner: "Tindakan Paket Tidak Termasuk Promo".
Point: "Transaksi Treatment Senilai Rp 100.000 => 1 Point = Rp 50.000"; "Pembelian Produk Senilai Rp 50.000 => 1 Point = Rp 25.000" (members only).
Voucher issue: Sejumlah (lembar) · Nomor Awal · Nominal Rp · Berlaku s/d; lists "Daftar Voucher Tersedia" / "Daftar Voucher Expired" / "Lihat Voucher Terpakai" (NO.VOUCHER(AWAL) · TGL TERBIT · BERLAKU S/D · NOMINAL · JUMLAH · CEK NOMOR VOUCHER).

### 3.19 User & Hak Akses
Tabs: Form User · Data User · Login History. 3-step wizard: **Data User** (Nama, Username ≤16 alnum, Password ≤16, Pilih Cabang, Bagian: Administrator/Management/Gudang/Marketing/Resepsionis/Klinik/Apotik/Kasir) → **Hak Akses User** (checkbox matrix: Master Data [Setting User, Data Dokter, Data Pasien, Data Supplier, Data Tarif, Stok Gudang, Stok Obat/Alkes] · Marketing [Menu Marketing] · Resepsionis [Antrian Pasien] · Perawatan [Perawatan Baru & Khusus Reguler, Data Perawatan Pasien, Konsultasi Online] · Apotek [Resep Dokter Klinik, Penjualan Obat Bebas] · Kasir [Pembayaran Klinik] · Data Transaksi [Trans.Klinik, Trans.Pembelian Obat, Trans.Obat Bebas, Trans.Obat Resep, Trans.Deposit] · Laporan [Laporan Klinik, Laporan Apotik, Laporan Gudang]) → **Konfirmasi Password Admin** → Finish.
Assessment (INF): menu-level permissions only; no action-level (approve/void/export) or data-level scoping.

### 3.20 Konsultasi Online (video)
Tabs Konsultasi Video | Data Konsultasi Online. Schedule: Waktu Konsultasi · Pasien · Dokter · [Proses Simpan]; list WAKTU · PASIEN · DOKTER · ROOM ID · start/delete. Video room (Jitsi-style) "Konsultasi Dokter — konsultasi via video call dibatasi hanya untuk 2 orang dan maksimal 30 menit", Start Recording, Leave. Answer log [Update Jawaban].

### 3.21 Report catalog (OBS)
**Laporan Perawatan** (radio list + date range; limit 1 month, ≤3 months only 05:00–09:59 and 19:00–23:59 WIB): Laporan Rekap Pemasukan Total · Transaksi Per Tanggal · Transaksi Per Periode · Rekap Penerimaan Uang Perkategori · Laporan Pemasukan Per Jenis Bayar · Laporan Perawatan Untuk Pembayaran Split · Laporan Perawatan Per Kategori Treatment · Transaksi Perawatan Reguler · Transaksi Perawatan Paket · Pasien Paket Expired · Transaksi Daftar Member & Deposit · Laporan Expired Member · Laporan Treatment · 10 Tindakan & Paket Terlaris · Laporan Treatment Tidak Laku · Laporan Pasien Berdasarkan Tanggal Daftar · Laporan Pasien Lama Tidak Aktif (3 bulan) · Laporan Pasien Belum Pernah Kunjungan/Visit · Laporan Sisa Deposit Pasien · Laporan Pasien Paling Sering Belanja (period + nominal > X) · Laporan Perawatan Sisa Tindakan Paket · Pemakaian Promo · **Laporan Transaksi Dihapus** · **Laporan Rekap Shift** (per user, "Ganti Shift / Operator").
Fee section: Rekap Fee Dokter · Pemakaian Treatment Per Dokter · Rekap Fee Beautician & Nurse · Rekap Fee Sales · **Laporan Laba/Rugi HPP**.
**Laporan Produk/Obat**: Pembelian Obat/Produk/Bahan (per supplier) · Penjualan Obat/Produk/Bahan · Data Obat/Produk Terjual Per Periode (resep & penjualan langsung) · Pemasukan Per Jenis Bayar · Keluar/Masuk Stok · Transaksi Stok Dihapus/Dibatalkan · Pemakaian Stok Kabin/Bahan per Obat · per Pasien · Obat/Produk Tidak Laku · Kadaluarsa · Sudah Minimal Stok · Stok Opname · Penerimaan Stok · Order Online. Fees: Rekap Fee Resep Dokter · Rekap Fee Penjualan Langsung · Daftar Pasien Reseller · Rekap Penjualan ke Reseller · Rekap Fee Reseller Top.
**Laporan Gudang**: Pembelian Obat · Mutasi Obat · Laporan Stok · Stok Opname · Obat Sudah Minimal Stok.
**Laporan Rekap Total** output: Tgl · Kwitansi · Nama Pasien · Transaksi · Total · Jenis · Keterangan (NEW/OLD) · No. WA - No. Member; [cetak laporan] [Export ke Excel].

### 3.22 Marketing (DOC)
Email marketing (templates; auto birthday; auto promo; schedule by branch, patient/non-patient, religion or age range, registration date), Setup Mobile App (4 banner slides, social links, store with shipping origin and bank accounts, courier flat or per-km tariff, menu visibility per patient/non-patient), WhatsApp manual blast via linked device QR (unofficial pairing), WhatsApp automatic, push notification.

---

## 4. Modern SaaS capability map (OBS, complete bundles)

### 4.1 Kasera (45 UI routes, 235 API paths)
UI routes: `/dashboard` · appointments (+quick-add) · billing · categories · clients · commission(s) · finance (+expenses, +profit-loss) · inventory · loyalty · my-appointments · my-earnings · my-profile · my-schedule · my-services · my-transactions · orders · packages · pos · products · reports · services · settings · spaces · team · onboarding · `/pos` (bookings checkout, quick sale, promotions preview, payment fees/methods, loyalty catalog, staff).
Notable API: `auth/login/otp/request|verify`, `auth/google/exchange`, `auth/impersonate/redeem` (support impersonation), `auth/me/scope`, `auth/me/crm-mode`, `auth/me/inventory-mode`, `attendance/clock-in|clock-out|me/today`, `affiliate/validate-code`, `me/google-calendar/connect`, `security/otp/send|verify` (step-up), `auth/account/deletion-preview`.
Report vocabulary (labels): Ringkasan · Tren Pendapatan · Pendapatan Hari Ini · Penjualan Harian · Laporan Penjualan Produk · Pelanggan baru vs lama dan sinyal loyalitas · Tingkat kembali · **Tingkat tidak hadir** · Pendapatan dari item promo · **Kunjungan halaman booking publik dan konversinya** (Kunjungan Halaman, Tingkat Konversi) · Total Pesanan · Pelanggan Unik · Laba Bersih · Arus Kas · Pengeluaran rutin · Komisi staf · Dasar Komisi · Komisi per opsi harga · Override Komisi · "Tutup kasir tanpa menghitung dan menebak" · Stok Rendah / Batas Stok Rendah / Sesuaikan Stok · Absensi / Shift Terjadwal / Lembur · Target Kunjungan · Pelanggan memiliki utang poin.
Roles seen: Pemilik · Admin Cabang (Branch Admin) · Kasir · staff/stylist; "Admin only" gates.

### 4.2 ClinicHub (250 API paths; admin + patient)
Admin API groups: 2FA (TOTP and email) · activity (audit) · AI (agents, analyst, config, knowledge base upload/URL, sandbox, suggest-remarks, test, usage, evaluations) · analytics · appointments · articles/authors (CMS) · auto-close · backup (+requests, tables) · booking-requests · broadcast-lists/broadcasts/campaigns · commissions (adjust, payout, payout-batch) · consent-template/consents · consumption-drafts/consumptions (BHP usage) · conversations/inbox (bulk) · CRM (list, rekap, summary) · dashboard (+insight) · demo access · doctors · **erasure (+config)** · exchanges (tukar treatment) · finance (banks, commissions, payment methods/options, suppliers) · followup (config, run) · GA4 setup · GSC setup · inventory adjust · invoices (+balance) · kontak (+export) · lead-otp-config · leads (+status) · livechat (channels, labels) · loyalty config · marketing rules · me/nakes (my patients, my procedures, unused usages) · **meta-capi** · notif-counts · offers · outlets · patients (+export, +import, +packages) · permissions/roles · product-units/products · **proformas** · promo (keeps, recap) · purchase-orders (pay, receive) · records · reengage-config · referrals · reminders · rooms · schedule (clinic-hours, closures, doctor, leaves) · segment-options · settings · **sla-alert** · sosial-config · staff (+nakes-link) · stock-card · summary · taxonomy · therapists · treatments · usages · wa-flows · wa-rates · wa-reminder-config · wa-templates (+sync) · wa-tier · WABA (embedded signup, provider, simulate).
Patient API: account, activation, appointments, articles (+read), assistant, check-in(s), **data-deletion-request**, **data-export**, deposit, **erasure-impact**, history, invoices, loyalty, membership, messages, notifications, offers, points, profile (+photo), promo keep, push, records, referral, register (+WA OTP), skin, verify-email, **WebAuthn passkeys**.
UI labels: Invoice voids awaiting approval · Consent belum ditandatangani · Komisi belum cair · Komisi Dokter / Perawat / Admin · Pasien per Dokter · Reservasi per dokter · Marketing Efficiency by Channel · Marketing Sources/Suggestions · Live Chat Analytics · Laporan Insight Manajemen · Laporan Finance · Laporan Harian · Promo Ulang Tahun Otomatis · Referral Berhadiah · Penawaran Eksklusif · Promo Keeps from the App · Backup terakhir · Izin khusus · Role Baru · Purchase Order · Master Finance · Hapus Data Dummy.

### 4.3 Assist.id help-center topics (DOC)
Antri Cepat (online appointment, cancel by patient/facility, reschedule, QR registration), AssistMe patient app (booking, services, service packages, fee disbursement), insurance claim monitoring, CashBook (buku besar, jurnal, laba rugi), GetResep, ICD-10, SATUSEHAT monitoring and ≥50% sending, Kerjaa.id HR (job level, position, status, numbering, mobile check-in), accreditation office module, add-on packs (Deposit, Voucher, Discount, Booking Fee, AI), Message Center (WA appointment reminders), English UI option, call patient when "Waiting", digital/manual general consent, PPN on drug price, psychosocial-spiritual assessment, SNOMED CT terminology sending, queue screen video.

---

## 5. Data model (consolidated entities and key fields)

| Entity | Key fields (from observed forms/APIs) |
|---|---|
| Clinic / Branch (Cabang/Outlet) | name, address, phone, logo, licence, PJ, bank accounts, daily report email, SATUSEHAT org/location IDs, opening hours, closures, invoice format, numbering formats |
| User / Staff | name, username, password, branch(es), bagian/role, permission set, 2FA, login history, credentials (STR/SIP/SIPP), specialty, fee tier, schedule, leaves, attendance |
| Patient | No. RM, NIK/KTP/Paspor, name, DOB/place, age, gender, religion, occupation, education, marital status, address, city/region codes, WA, email, photo, member no., tier, reseller/downline, source (Sumber Info), consents (SATUSEHAT, marketing, photo), allergies, skin problems, notes, tags, family links |
| Appointment / Queue | date/time, branch, doctor/therapist, room/device, service(s), source (walk-in, online, app), status (scheduled, confirmed, waiting, engaged/in treatment, done, failed/no-show, cancelled), queue no., deposit/booking fee, hold expiry |
| Visit / Encounter | visit no. ("Kunjungan Ke"), anamnesis, examination, vitals, consciousness, diagnosis (+ICD-10), procedures (+ICD-9-CM), prescriptions, next visit, discharge status, photos before/after, documents, face/body markers, signature, rating |
| Treatment / Service | unit/category, code, name, type (Tindakan/Jasa/Paket), duration (+prep, buffer), tarif umum, tarif member, branch price, fees (doctor/beautician/nurse/sales, Rp or %), cost (biaya modal), BHP recipe, consent template, photo/description for app, tax class, app discount |
| Package (template) | items × frequency, validity (months/days), price, shareable, app visibility |
| Owned package | patient, package, purchase date, expiry, used/remaining per item, installments, refund/retur → deposit |
| Product / Drug / BHP | code, name, type (Apotek/Kabin), class (bahan jadi/baku, obat keras, OTC), unit + conversions, BPOM no., batch, expiry, storage temp, min/max stock, margin, price, supplier |
| Stock movement | in (purchase/receipt), out (sale, usage, mutation), adjustment/opname, deletion audit, depot |
| Invoice / Kwitansi | no., date, cashier, patient, doctor, lines (item, qty, price, discount, sales), admin fee, voucher, points, deposit, tenders (cash/debit/credit/QRIS/transfer + bank), change, status (unpaid/paid/void-pending/void), notes |
| Deposit / Member / Points / Voucher | balances, history, expiry, rules |
| Commission | rule (role, item, basis, Rp/%), line accruals, adjustments, payouts |
| Marketing | templates, campaigns, segments, broadcasts, automations (birthday, promo, reminders, re-engagement, follow-up), referrals, offers, promo keeps |
| Conversation / Lead | channel, contact, status, assignee, labels, SLA, linked patient |
| Audit | user, action, entity, before/after, timestamp, IP/device |

---

## 6. Business rules catalogue (observed in the market)

| Area | Rule | Source |
|---|---|---|
| Pricing | Two price lists: Umum and Member; app-only discount price per treatment | ICONIX OBS |
| Pricing | Material-priced treatments (thread lift = threads + anaesthetic; tariff 0, price = materials) | ICONIX manual DOC |
| Pricing | Price per payment method (surcharge) | Assist OBS (`getPriceOfItem`) |
| Discount | Line discount Rp/%; overall discount; discounts reduce doctor fee per setting | ICONIX OBS |
| Discount | Cashier discount requires responsible person's password | ICONIX OBS |
| Promo | Promo items auto-discount at cashier within period; package treatments excluded from promo | ICONIX OBS |
| Points | Members only; earn per Rp threshold (treatment vs product separately); redeem minimum 10 points | ICONIX OBS |
| Voucher | Numbered batch, fixed Rp, expiry; usable by anyone; used/expired lists | ICONIX OBS |
| Member | 1-year validity, renewable; member price + points; auto tier upgrade (5 levels) | ICONIX DOC |
| Package | Expiry in months; visit numbering; next visit mandatory; installments with minimum; cancellation → deposit only; swap treatment | ICONIX OBS / ClinicHub OBS |
| Deposit | Prepaid balance; DP expiry months configurable | Assist OBS |
| Fees | Per treatment fee for doctor, beautician/nurse, sales; tiers Standar/Senior/Spesialis; fee on prescriptions and direct sales; reseller fee | ICONIX OBS/DOC |
| Stock | Kabin items auto-deduct per treatment recipe at completion; kabin vs apotek item types; minimum stock alert; expiry alert | ICONIX DOC |
| Editing | Clinical/transaction edits only before payment; after kwitansi immutable; deleted transactions reported | ICONIX OBS |
| Reports | Heavy reports restricted by period and time window | ICONIX OBS |
| Video consult | 2 participants, max 30 minutes, recording option | ICONIX OBS |
| Booking | Slot hold until deposit paid (10 min Termilo); reschedule cutoff; no-show tracking; restore | Kasera/Termilo OBS/DOC |
| Approvals | Void, stock repair, restock/return need approval | Assist/ClinicHub OBS |
| Privacy | Patient data export, deletion request with erasure impact check (blocked if unpaid invoice) | ClinicHub OBS |

---

## 7. Permission model (recommended, derived from all observed products)

Roles observed: Administrator, Management/Owner, Admin Cabang, Resepsionis, Kasir, Klinik (doctor/nurse/beautician), Apoteker, Gudang, Marketing, Finance, Sales/BC, staff self-service.

Recommended matrix dimensions (INF from gaps): **module × action × scope**.
- Actions: view, create, edit, delete/void, approve, export, print, see-cost/margin, see-clinical.
- Scope: own records, own branch, all branches.
- Special permissions: discount above threshold, backdate, reopen paid invoice, edit price at POS, view patient phone (masking), break-glass clinical access, impersonation (support only, logged).
- Evidence: ICONIX has menu-level checkboxes only; Kasera has `me/scope` and admin-only gates; ClinicHub has roles + permissions + "Izin khusus"; Assist has an approval matrix.

---

## 8. Regulatory field requirements (REG, Permenkes 24/2022)

| Requirement | Article | System implication |
|---|---|---|
| Every facility must run electronic medical records | Pasal 3 | RME is mandatory, not optional |
| Registration identity minimum: No. RM, nama pasien, NIK | Pasal 14(2) | Required fields; foreigners use passport (vendor practice) |
| Social data minimum: agama, pekerjaan, pendidikan, status perkawinan | Pasal 14(4) | Include in registration form (ICONIX lacks pendidikan, OBS) |
| Correction by provider/admin within 2×24 h of input; later only admin data with PMIK/facility-head approval | Pasal 16(4), 30(6)-(7) | Time-boxed edit window, then amendment workflow with approval |
| Content = administrative + clinical documentation | Pasal 27 | Separate modules, both in record |
| Patient owns content; minimum given: identity, examination results, diagnosis/treatment/follow-up plan, provider name & signature | Pasal 26 | Patient portal "resume"/print with these elements |
| Security principles: confidentiality, integrity, availability | Pasal 29 | Access control, audit, backups, uptime |
| Access rights granted by facility head as SOP | Pasal 30 | Role/permission admin + documented policy |
| Electronic signature allowed for verification/authentication | Pasal 31 | PIN/OTP/PSrE signature on records |
| Confidentiality even after death; disclosure only by consent or law | Pasal 32–37 | Disclosure request log, consent capture, de-identification for research |
| Storage on certified cloud/server; retain ≥25 years after last visit | Pasal 20, 39 | No automatic deletion of clinical records; retention metadata |

Also relevant: Permenkes 290/2008 (informed consent; cited in Permenkes 24/2022), UU 27/2022 PDP (health data = specific personal data; data-subject rights), SATUSEHAT interoperability (vendors target ≥50% then 100% visit data sent).

---

## 9. UX findings from real screens (ICONIX, OBS) and design implications

| Finding | Evidence | Implication |
|---|---|---|
| Hidden save per line ("Jangan lupa klik tombol (+)") | Exam, promo, package forms | Use inline rows that persist automatically; disable "Masukan Data" while unsaved rows exist |
| Dropdown "Proses ▾" per row hides all actions | All lists | Show primary row action as a button; secondary in menu |
| Long radio-list reports with one global "Tampilkan" | Reports | Searchable report gallery, favourites, per-report filters, async generation, scheduled delivery |
| Period limits with time windows | Reports | Pre-aggregated data/warehouse to avoid limits |
| Free-text diagnosis | Exam tab | Coded diagnosis (ICD-10) + free text |
| Single-session warning | Banner | Real session management instead of warnings |
| Discount password typed by cashier | Discount modal | Approver authenticates on own account/PIN or remote approval request |
| Patient app password set at registration | Registration | Patient self-activation via WA OTP/passkey (ClinicHub pattern) |
| Unofficial WA linked-device blasting | Marketing DOC | Official WhatsApp Business API; template approval; opt-in |
| Big orange total + 3 tender rows | Cashier | Keep: clear total; extend tenders (QRIS, transfer, e-wallet, deposit, points, voucher) with dynamic rows |
| Kwitansi shows package remaining ("Terpakai 1X & Sisa 3X") | Receipt | Keep: patients value remaining-session info on receipts |
| Bilingual drift and inconsistent capitalization | Throughout | Terminology glossary |

---

## 10. Complete page inventory update (additions from deep dive)

Add to the menu tree in the UI/UX research document:
- Front office: **Scan barcode/QR member card**; **Konfirmasi appointment dari aplikasi**; **Pasien reseller / downline** (if clinic sells via resellers).
- Clinical: **Konsultasi online (video room, data konsultasi, jawaban)**; **Cek Bahan (BHP per visit)**; **Rating visit by patient**.
- POS: **Pesanan online (app orders)**; **Pembayaran pendaftaran member/perpanjangan**; **Retur paket (to deposit)**; **Proforma/penawaran**; **Void approval queue**.
- Treatment master: **Import/Export Excel with template**; **Foto & deskripsi untuk aplikasi**; **Harga diskon khusus aplikasi**.
- Stock: **Permintaan stok ke gudang**; **Setup margin**; **Setup obat racikan**; **Cek pemesanan obat**.
- Marketing: **Email marketing**; **Setup mobile app (banner, sosial, store, kurir, ongkir)**; **WA flows**; **Re-engagement**; **Auto-close conversations**; **SLA alert**; **Promo keeps**; **Referral**; **Lead OTP verification**.
- Finance: **Expenses (pengeluaran rutin)**; **Laba rugi**; **Arus kas**; **CashBook jurnal/buku besar**; **Kas kecil**.
- HR: **Attendance (clock-in/out)**, **shift terjadwal**, **lembur**, **target kunjungan**; **staff "Saya" pages** (appointments, earnings, schedule, services, transactions).
- Platform: **Backup requests/history**; **Demo/sandbox data reset**; **Support impersonation (logged)**; **Google Calendar sync**; **GA4/GSC/Meta CAPI setup**; **Data erasure configuration**; **Login history**.
- Patient portal: **Data export**, **data deletion request**, **passkey login**, **check-in**, **skin progress**, **assistant (AI)**, **promo keep**, **referral**.

---

## 11. Open items and how to go deeper still

| Item | Method | Needs approval? |
|---|---|---|
| Authenticated screen walk-through of ICONIX (7-day trial), Bee Clinic/Kasera (14-day), Klinik Pintar Mandiri (free) | Operator-driven browser session with HAR + screenshots, REA `inspect-web-network-capture` | Yes (account creation) |
| Aesta/Assist authenticated UI | Request demo | Yes |
| YouTube walkthroughs (ICONIX "step by step pendaftaran pasien s/d kasir", Assist EMR input) | Frame extraction via video fetch | No |
| ICONIX manual PDF "TUTORIAL_REGISTRASI_APPOINTMENT_ONLINE" (QR registration, online appointment confirmation) | PDF fetch | No |
| Klinik Pintar per-page help articles (registration, schedule, commission, reports) | Fetch each page | No |

---

## 12. Sources

ICONIX: tutorial index https://www.iconix.id/blog/2019/10/10/daftar-isi-tutorial-klinik-kecantikan/ · Perawatan https://www.iconix.id/blog/2019/10/10/tutorial-menu-perawatan-versi-cloud/ · Kasir https://www.iconix.id/blog/2019/10/10/tutorial-menu-kasir-pembayaran-versi-cloud/ · Data Treatment https://www.iconix.id/blog/2019/10/10/tutorial-menu-data-treatment-versi-cloud/ · Resepsionis https://www.iconix.id/blog/2019/10/10/tutorial-menu-resepsionis-versi-cloud/ · Laporan https://www.iconix.id/blog/2019/10/10/tutorial-laporan-klinik-versi-cloud/ · Marketing https://www.iconix.id/blog/2020/02/03/menu-marketing/ · Password diskon https://www.iconix.id/blog/2020/05/13/password-diskon-di-menu-kasir-pembayaran/ · User & hak akses https://www.iconix.id/blog/2019/10/01/tutorial-menu-user-hak-akses-versi-cloud/ · Update log https://www.iconix.id/blog/2024/06/27/update-iconix-software-klinik-kecantikan-part-24_2-2/
Assist.id: https://tutorial.assist.id/ · https://tutorial.assist.id/cara-menambah-paket-prosedur-di-emr/
Klinik Pintar: https://bantuan.klinikpintar.id/books/panduan-aplikasi-klinik-pintar · https://bantuan.klinikpintar.id/books/panduan-aplikasi-klinik-pintar/page/mengisi-rekam-medis-kulit-kecantikan · https://klinikpintar.id/aplikasiklinik/fitur/kecantikan/detail
Bundles: https://app.kasera.id/ (52 public chunks) · https://app.clinichub.id/ (main + 55 lazy chunks)
Regulation: Permenkes 24/2022 https://jdih.kemkes.go.id/storage/documents/pdfs/2022permenkes024.pdf (Pasal 3, 14, 16, 20, 26, 27, 29–37, 39)
