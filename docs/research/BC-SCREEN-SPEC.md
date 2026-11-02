# BC Screen Specification — Pendampingan Beauty Consultant

Status: prototype specification for Google Stitch and staff validation. Not a PRD or final UI.
Supersedes: Prompt 1 in [STITCH-PROMPTS.md](STITCH-PROMPTS.md) for BC screens.
Sources: confirmed decisions in [SESSION-HANDOFF-2026-10-30.md](SESSION-HANDOFF-2026-10-30.md) §§3–4 and §8; blueprint §0.4; review [stitch-output/01-pendampingan-bc-review.md](stitch-output/01-pendampingan-bc-review.md).

Labels used below:
- **[C]** confirmed by the user.
- **[P]** proposed in this spec; awaiting the user's or a clinic's confirmation.
- **[V]** needs clinical-lead or regulatory validation before production.

UI text is Indonesian; this document is English.

---

## 1. The BC role in one paragraph

The Beauty Consultant is a **non-medical patient companion** [C]. The BC accompanies the patient, records preliminary intake and before photos, does a simple skin observation, and, after the doctor has approved a staged care plan, discusses budget with the patient: the patient chooses all, part, or none of the plan, or defers items [C]. The BC never diagnoses, prescribes, sets or changes the plan, changes prices, gives discounts outside the rules, receives payment, or approves additional treatment [C]. The BC may **propose** additional treatment during a treatment session; clinical personnel approve it and the patient agrees [C]. BC earns commission as **guiding BC** and/or **closing BC** [C], and has quantity and/or revenue targets (definition open).

---

## 2. Screen inventory for the BC role

| ID | Screen (UI name) | Primary job | Pattern |
|---|---|---|---|
| BC-0 | Shell for the BC role | Navigation scoped to BC work | Sidebar + top bar |
| BC-1 | Antrean Pendampingan | See whom to accompany next and where each of my patients stands | Worklist / queue with tabs |
| BC-2 | Pendampingan — Intake | Record intake, special conditions, photos, skin observation; send to doctor | Workspace, step 1 |
| BC-3 | Pendampingan — Menunggu Dokter | Read-only wait state; add a late note | Workspace, locked state |
| BC-4 | Pendampingan — Diskusi Pilihan | Present the approved plan; record per-item choice, payment plan, attribution | Workspace, step 2 |
| BC-5 | Pendampingan — Konfirmasi & Kirim ke Kasir | Patient confirms the purchase summary; hand over to cashier; track | Workspace, step 3 |
| BC-6 | Usulan Treatment Tambahan | Propose an addition during treatment and track approvals | Side drawer |
| BC-7 | Tindak Lanjut | Follow up deferred items and patients who left without buying | Worklist |
| BC-8 | Komisi Saya | Own commission entries | Already in STITCH-PROMPTS Prompt 7 |

One patient visit moves through BC-2 → BC-3 → BC-4 → BC-5 in **one workspace page** with a step indicator, so the BC never re-enters data [P].

---

## 3. BC-0 — Shell (role: BC)

### 3.1 Sidebar (BC sees only these items) [P]

```
[Logo] Klinik Aurelia
       Cabang Kemang

HARI INI
  ● Pendampingan            (badge: 3 = patients waiting for BC)   ← highlighted on BC-1..BC-6
    Jadwal Hari Ini
PASIEN
    Cari Pasien
TINDAK LANJUT
    Tindak Lanjut           (badge: 5 = due today)                  ← highlighted on BC-7
SAYA
    Komisi Saya                                                     ← highlighted on BC-8
-----------------------------
    Bantuan
```

- Hidden for BC: Kasir, Farmasi & Stok, Treatment execution, Laporan, Pengaturan, other staff's commission [C role boundary; menu set P].
- Active item style: mist background #EBF5F8, teal text/icon #0B6E7D, 3 px teal left bar.
- Badge counts are live; red only if a patient has waited for BC longer than 15 minutes [P threshold].

### 3.2 Top bar

- Global search "Cari pasien, No. RM, atau No. HP" (BC can open patients in their branch).
- Branch switcher: shown only if the BC is assigned to more than one branch [C staff may serve multiple branches]; otherwise a static branch label.
- Notifications (bell with count). BC notification types [P]:
  - "Rencana dr. Maya untuk Rina Kusuma sudah disetujui" → opens BC-4.
  - "Rina Kusuma sudah membayar — siap treatment" → opens BC-5.
  - "Usulan treatment tambahan disetujui/ditolak" → opens BC-6.
  - "Dokter mengubah rencana setelah pasien memilih" → opens BC-4 with conflict banner.
- User: "Sari · Beauty Consultant".

### 3.3 Persistent patient header (BC-2..BC-6)

Left: patient name (navy #002B49), No. RM, age, gender, visit type chip (Pasien Baru / Pasien Lama / Kontrol / Pakai Sesi Paket), arrival source chip (Booking 10:00 / Walk-in).
Badges:
- Allergy, red: verified allergies, e.g. "Alergi: Lidokain". Patient-reported but unverified allergies show amber "Alergi dilaporkan: Parfum (belum diverifikasi)" [P].
- "Saldo Rp 350.000".
- "1 paket aktif" (click → package summary drawer).
- "Sisa tagihan Rp 0" or amber "Piutang Rp 450.000" [C receivable shown on next visit].
- "DP Booking Rp 200.000" when present [C].
Right: "BC Pembimbing: Sari" and visit status chip.

---

## 4. BC-1 — Antrean Pendampingan

### 4.1 Purpose
Show the BC which patients need them now and the state of every patient they accompany today.

### 4.2 Layout
Page title "Pendampingan" + date "Sabtu, 14 Nov 2026". Four summary figures (small, not cards): Menunggu BC 3 · Sedang didampingi 1 · Menunggu dokter 2 · Menunggu kasir 1.

Tabs (with counts):
1. **Menunggu BC (3)** — all unassigned patients in this branch needing a BC.
2. **Pasien Saya (4)** — patients I am accompanying today, any status.
3. **Selesai Hari Ini (6)**.

Filter chips: Jenis kunjungan (Baru, Lama, Kontrol, Pakai Sesi Paket), Sumber (Booking, Walk-in). Search within list.

Table columns (Menunggu BC):
| Column | Content |
|---|---|
| No. Antrean | A-012 |
| Pasien | name, RM, age; allergy icon if any |
| Jenis Kunjungan | chip |
| Sumber | Booking 10:00 / Walk-in |
| Datang | 10:05 |
| Menunggu | "12 mnt" (amber > 10, red > 15) [P] |
| Catatan FO | e.g. "Ingin tanya laser bekas jerawat" |
| BC sebelumnya | for returning patients: "Dewi (BC Pembimbing rencana aktif)" |
| Aksi | **Ambil & Mulai** |

Table columns (Pasien Saya): Pasien · Jenis · Status (Intake BC, Menunggu Dokter, Dengan Dokter, Rencana Siap — Diskusi, Menunggu Kasir, Siap Treatment, Di Ruang Treatment, Selesai, Konsultasi Saja) · Waktu di status · Aksi (Lanjutkan / Lihat).

### 4.3 User stories and actions
| # | Story | Action | Result |
|---|---|---|---|
| 1.1 | As a BC, I want to take the next waiting patient so that nobody waits unattended. | Click **Ambil & Mulai** | Patient moves to "Pasien Saya", status Intake BC, BC-2 opens. If this starts a new care plan, I become guiding BC [C]. |
| 1.2 | As a BC, I must not take a patient another BC just took. | Click Ambil on a row taken seconds ago | Message "Sudah diambil oleh Dewi pukul 10:17"; row disappears [P]. |
| 1.3 | Returning patient with an active care plan guided by another BC. | Row shows "BC Pembimbing: Dewi" | I can still accompany; guiding BC stays Dewi; I can become closing BC [C]. Only owner/manager can reassign guiding BC [C]. |
| 1.4 | Package-session or control visit. | Row shows chip "Pakai Sesi Paket"/"Kontrol" | BC accompaniment optional; FO may route directly to treatment/doctor [P]. If BC takes it, BC-2 opens in short "perubahan sejak kunjungan lalu" mode. |
| 1.5 | See where my patients are. | Open "Pasien Saya" | Status and time per patient; click opens the workspace at the right step. |
| 1.6 | Empty state | No patients waiting | "Belum ada pasien yang menunggu BC." with link "Lihat Jadwal Hari Ini". |

---

## 5. BC workspace (BC-2 to BC-5)

### 5.1 Page frame
- Breadcrumb "Pendampingan / Rina Kusuma".
- Patient header (§3.3).
- **Step indicator** (4 steps): 1 Intake & Foto → 2 Pemeriksaan Dokter → 3 Diskusi Pilihan → 4 Konfirmasi & Kasir. Completed steps show a check; the current step is teal; future steps grey.
- Autosave label top right: "Tersimpan otomatis 10:21" [P].
- Right column (always visible, collapsible): **Riwayat Singkat** (see 5.2).

### 5.2 Right column — Riwayat Singkat (read-only)
- Kunjungan terakhir: date, treatment performed, performer. Up to 3 visits, "Lihat semua".
- Produk dari klinik yang sedang dipakai.
- Paket aktif: name, "Bisa dipakai sekarang 1 sesi · Sisa 2 sesi · Berlaku s.d. 12 Mar 2027", payment status.
- Rencana perawatan aktif: name, current stage, guiding BC.
- Jadwal kontrol: next date and "Gratis s.d. 21 Nov 2026" [C free control rule].
- Foto sebelumnya: 2 thumbnails with date, "Bandingkan".
- Item yang pernah ditunda: list with date and reason.
- Not shown to BC: prior diagnoses and detailed clinical notes [P][V].

### 5.3 BC-2 — Step 1: Intake & Foto

Header note (info style): "Intake awal oleh BC — belum diverifikasi dokter. Bukan diagnosis."

**A. Keluhan & Harapan**
| Field | Type | Required | Notes |
|---|---|---|---|
| Keluhan utama * | multi-line text | yes [P] | placeholder "Ceritakan keluhan pasien dengan kata-kata pasien" |
| Area keluhan | multi-select chips: Dahi, Pipi kanan, Pipi kiri, Hidung, Dagu, Sekitar mata, Leher, Tubuh | no | |
| Jenis masalah | multi-select chips: Jerawat, Bekas jerawat, Flek/Melasma, Kusam, Pori besar, Kerutan/Garis halus, Kemerahan, Kulit kendur, Lainnya | no | |
| Sejak kapan | select: < 1 bulan, 1–3 bulan, 3–12 bulan, > 1 tahun | no | |
| Yang sudah dicoba | text | no | |
| Skincare/obat yang dipakai sekarang | text | no | |
| Harapan pasien | text | no | e.g. "Bekas jerawat memudar sebelum acara bulan depan" |
| Target waktu (jika ada) | date | no | |

**B. Kondisi Khusus (dilaporkan pasien) *** — label "perlu verifikasi dokter" [P][V]
Each item is a required Ya / Tidak / Tidak tahu toggle [P]:
- Sedang hamil atau merencanakan kehamilan
- Sedang menyusui
- Sedang minum obat rutin → if Ya: text "Obat apa?"
- Punya alergi (obat, bahan, makanan) → if Ya: text; appears in header as amber unverified allergy
- Riwayat keloid / luka sulit sembuh
- Riwayat treatment estetik 6 bulan terakhir → if Ya: text
- Penyakit yang sedang dirawat dokter → if Ya: text

**C. Foto Sebelum**
- Four slots: Depan *, Kiri 45°, Kanan 45°, Close-up area keluhan. Each: Ambil Kamera / Unggah / Dari HP (QR) [P]; after capture: thumbnail, time, retake, note.
- Consent, captured before taking photos [C separation of clinical use and marketing]:
  - "Pasien mengizinkan foto untuk keperluan klinis" (checkbox; required to take photos)
  - "Pasien mengizinkan foto dipakai untuk promosi" (checkbox; optional; default off)
- If the patient refuses clinical photos: select "Pasien menolak difoto" + reason; the Depan requirement is then satisfied by the refusal record [P].

**D. Observasi Kulit Sederhana**
| Field | Type |
|---|---|
| Tipe kulit | single chip: Normal, Kering, Berminyak, Kombinasi, Sensitif, Belum yakin |
| Sensitivitas | single chip: Rendah, Sedang, Tinggi, Belum yakin |
| Catatan BC | text |
No device measurements, grades, percentages, or clinical terms [C device integration deferred; C BC non-medical].

**E. Kunjungan Pasien Lama — mode "Perubahan"** [P]
For returning patients, sections A–B are prefilled from the last visit and collapsed with a summary; the BC answers "Ada perubahan sejak kunjungan lalu?" Ya/Tidak per section. Only changes are typed.

**Actions (footer)**
| Action | Enabled when | Result |
|---|---|---|
| Simpan Draf | always | saves; status stays Intake BC |
| **Kirim ke Dokter** (primary) | required fields filled: Keluhan utama, all Kondisi Khusus answered, Foto Depan or refusal recorded [P] | Status → Menunggu Dokter; doctor queue notified; BC-3 opens |
| Pasien Batal / Pulang | always (secondary, inside "Lainnya" menu) | Ask reason (Berubah pikiran, Terlalu lama menunggu, Lainnya). If doctor not yet seen: no consultation fee [P]; FO notified |

Validation: pressing Kirim ke Dokter with missing fields scrolls to the first missing field and shows the error next to it.

**Open:** whether BC measures vitals (blood pressure, weight). Not on this screen until decided.

### 5.4 BC-3 — Step 2: Pemeriksaan Dokter (wait state)

- Status banner: "Menunggu dr. Maya Pratiwi · antrean ke-2 · ±15 mnt" → later "Sedang diperiksa dr. Maya sejak 10:32".
- Intake is read-only once the doctor opens the examination. BC may add **"Catatan tambahan untuk dokter"** (appended with time, never overwrites) [P].
- Actions: "Tambah Catatan untuk Dokter", "Lihat Intake". No navigation away from the patient is needed; BC can return to BC-1 and take another patient.
- Notification when the plan is approved moves the step to 3.
- Edge: doctor declares a contraindication / no suitable treatment → banner "Dokter: treatment yang diinginkan tidak disarankan" and step 3 shows only allowed items or none; consultation fee is charged if nothing is bought [C].

### 5.5 BC-4 — Step 3: Diskusi Pilihan

Top: plan header "Rencana Perawatan — Disetujui dr. Maya Pratiwi · 14 Nov 2026 10:40" (green chip "Disetujui"). If the doctor marked items "Tidak disarankan", they appear struck through and cannot be selected.

**A. Rencana dari Dokter (read-only content, selectable)**
Grouped by stage:
- Tahap 1 · Minggu 1–4 · Fokus: meredakan jerawat aktif
  - Chemical Peeling (Salicylic 20%) · 2 sesi · Rp 1.000.000/sesi · Rp 2.000.000
  - Serum Acne 30 ml · 1 botol · Rp 285.000 · instruksi "malam hari"
- Tahap 2 · Minggu 5–8 · Fokus: memudarkan bekas jerawat
  - Laser Acne Scar · 2 sesi · Rp 1.600.000/sesi · Rp 3.200.000
- Kontrol: 21 Nov 2026 (gratis, termasuk pembelian) [C]

Per item a segmented control: **Pilih · Tunda · Tolak** [P]. Tunda/Tolak require a reason chip: Budget, Waktu, Ingin pikir dulu, Takut efek samping, Konsultasi keluarga, Lainnya (+text). Tunda also asks "Hubungi lagi pada" (date) → creates a follow-up task (BC-7).

**B. Opsi Paket** (shown when the catalog has a package containing the selected treatments) [P]
- Card: "Paket Acne Clear — 2× Chemical Peeling + 2× Laser Acne Scar"
  - Harga normal Rp 5.200.000 → Harga paket Rp 4.680.000
  - Nilai per sesi: Peeling Rp 900.000 · Laser Rp 1.440.000 (proporsional harga normal) [C]
  - Berlaku 12 bulan sejak pembelian [C default]
  - Bisa dicicil · tanpa bunga, tanpa jatuh tempo [C]
  - "Paket hanya untuk pasien ini, tidak dapat dibagi" [C]
- Toggle "Ambil sebagai paket". The clinical content stays exactly the doctor's plan; only the commercial form changes.

**C. Cara Bayar (rencana; pembayaran dilakukan di kasir)** [C BC does not take payment]
- Treatments in a package: "Lunas" or "Cicilan".
- Single treatments: "Lunas sebelum treatment" [C initial treatment paid before start].
- Products taken home today: paid in full [P — pending decision].
- Show "Gunakan saldo pasien (tersedia Rp 350.000)" as a suggestion for the cashier.

**D. Ringkasan Biaya (right side, sticky)**
| Line | Amount |
|---|---|
| Konsultasi Dokter | ~~Rp 150.000~~ Gratis — ada pembelian [C] |
| Paket Acne Clear | Rp 4.680.000 |
| Serum Acne | Rp 285.000 |
| **Total** | **Rp 4.965.000** |
| DP minimum hari ini | Rp 1.185.000 = sesi pertama Rp 900.000 + produk dibawa pulang Rp 285.000 [C first-session rule; P product rule] |
| Setelah DP: sesi bisa dipakai | 1 sesi Chemical Peeling |
| DP Booking yang sudah dibayar | − Rp 200.000 (jika ada) [C applied on arrival] |
| Saldo pasien tersedia | Rp 350.000 |
| Sisa tagihan paket setelah DP | Rp 3.780.000 |

If the patient deselects everything: summary shows "Konsultasi Dokter Rp 150.000 — ditagih (tidak ada pembelian)" [C].

**E. Catatan untuk Dokter** — text + button "Minta Dokter Ubah Rencana" (e.g. patient wants fewer sessions or a different order). Sends the plan back; status "Menunggu revisi dokter"; selections are kept as a draft and must be reviewed after the revision [P].

**F. Atribusi** [C]
- BC Pembimbing: Sari (read-only; changed only by owner/manager).
- BC Closing: dropdown, default the current BC.
- Sumber pasien (pasien baru only): Instagram, TikTok, Google, Referensi pasien (+ name), Walk-in, Lainnya. Feeds the new-patient contribution [C].

**Actions**
| Action | Enabled when | Result |
|---|---|---|
| **Lanjut ke Konfirmasi** (primary) | at least one item Pilih; every item has Pilih/Tunda/Tolak | BC-5 |
| Pasien Tidak Membeli | all items Tunda/Tolak | Visit becomes "Konsultasi Saja"; consultation fee sent to cashier [C]; deferred items → follow-up |
| Minta Dokter Ubah Rencana | always | see E |

### 5.6 BC-5 — Step 4: Konfirmasi & Kirim ke Kasir

**A. Ringkasan Pilihan Pasien** — the selected items, deferred items, declined items, payment plan, DP minimum, total. Read-only.

**B. Persetujuan Pembelian (oleh pasien)** [P]
- Text: "Saya menyetujui pembelian di atas dan cara pembayarannya."
- Patient signs on the tablet (signature pad) or ticks on the BC's device; timestamp.
- Separate status line: "Persetujuan Tindakan Medis: akan dilakukan oleh tenaga medis sebelum treatment" (grey chip "Belum") [C commercial acceptance ≠ clinical consent][V who obtains it].

**C. Action**
- **Kirim ke Kasir** (primary): creates the bill at the cashier queue with all lines; status "Menunggu Kasir". Button shows a pending state and cannot be pressed twice [P].
- After sending: a tracker replaces the button:
  `Dikirim ke kasir 10:52 → Dibayar 10:58 (DP Booking + Saldo + QRIS) → Persetujuan tindakan ditandatangani 11:02 → Di ruang treatment 2 sejak 11:05 → Selesai`
- Changing a selection after payment is not allowed on this screen; it goes through the cashier/refund process [P].

### 5.7 Workspace-wide states and edge cases
| Case | Behavior |
|---|---|
| Doctor changes the plan after the patient selected | Amber banner "Rencana diubah dr. Maya 10:55 — tinjau ulang pilihan pasien"; changed items highlighted; Kirim ke Kasir blocked until reviewed [P] |
| Doctor plan still draft | Step 3 locked: "Menunggu persetujuan dokter" [P] |
| Patient has a receivable | Header amber chip; info in summary "Piutang Rp 450.000 akan ditampilkan di kasir" [C shown on next visit] |
| Existing package with paid sessions | Riwayat Singkat shows usable sessions; using a session today is not a purchase and has no consultation fee unless a new unrelated complaint arises [C] |
| Free control visit | Header chip "Kontrol gratis s.d. 21 Nov 2026"; consultation line "Gratis — kontrol" [C] |
| Treatment substitution in a package | Not done by BC; button "Minta Tukar Treatment" sends a request to the doctor [C doctor approval] |
| Connection lost | Top banner "Koneksi terputus — perubahan disimpan di perangkat dan dikirim saat online"; Kirim actions disabled until online [P] |
| Another staff edits the same visit | "Data diubah oleh dr. Maya — muat ulang" before saving [P] |
| Guardian for minor patient | Open; not shown until decided |

---

## 6. BC-6 — Usulan Treatment Tambahan (drawer)

Entry: from "Pasien Saya" row (status Di Ruang Treatment) → "Usulkan Treatment Tambahan", or from the workspace tracker.

Fields:
- Treatment (search from catalog) *, jumlah/sesi, harga (from master, read-only).
- Alasan usulan * (text, e.g. "Pasien minta tambah area dagu").
- Diajukan ke: tenaga klinis di ruangan (prefilled performer, e.g. "Nurse Dewi") or dokter [C clinical authorization][V who may approve].

Tracker after submit [C]:
1. Menunggu persetujuan klinis → Disetujui (name, time) / Ditolak (reason).
2. Menunggu persetujuan pasien → Pasien setuju (signature/tick, time).
3. Tagihan tambahan dikirim ke kasir — FO notified [C]; payment from saldo or EDC/QRIS in room [C].
4. Status pembayaran: Belum dibayar / Lunas.

BC cannot mark anything approved or paid. Cancel allowed only before clinical approval.

---

## 7. BC-7 — Tindak Lanjut

Tabs: **Hari Ini (5)** · Terlambat (2) · Akan Datang (8) · Selesai.
Columns: Pasien · Item ditunda / alasan · Tanggal ditunda · Hubungi pada · Rencana perawatan & BC Pembimbing · Upaya terakhir · Aksi.
Actions per row:
- "Hubungi via WhatsApp" — opens WhatsApp with a prefilled text (manual, no automation) [C no WA automation in proposed MVP].
- "Catat Hasil": Tidak diangkat, Masih pikir-pikir (+next date), Booking dibuat (+date), Tidak tertarik (+reason). Booking dibuat → creates an appointment request for FO.
- When the patient later buys: closing BC = whoever closes; guiding BC unchanged [C].
Empty state: "Tidak ada tindak lanjut hari ini."

---

## 8. User stories (complete list)

Format: As BC, I want … so that … — acceptance.

1. Take the next waiting patient so no one waits unattended — row assigned to me atomically; duplicate taking prevented.
2. Record the complaint in the patient's words so the doctor understands without re-asking — complaint visible to the doctor on open.
3. Answer every special condition so risky treatments are not offered — cannot send to doctor with unanswered conditions.
4. Record a newly reported allergy so everyone sees it — amber unverified allergy in the header for all roles.
5. Capture standard-angle photos with recorded consent so before/after can be compared and photos are used lawfully — clinical and marketing permission stored separately.
6. Record a photo refusal so the visit can proceed — refusal with reason satisfies the photo requirement.
7. For a returning patient, type only what changed — previous intake prefilled and collapsed.
8. Send the intake to the doctor and accompany another patient meanwhile — status moves to Menunggu Dokter; I am notified when the plan is approved.
9. Add a late note for the doctor without changing the original intake — appended note with time.
10. See the approved plan with prices so I can discuss budget honestly — plan read-only; I cannot change content or price.
11. Mark each item Pilih/Tunda/Tolak with a reason so follow-up and reporting are meaningful.
12. Offer an existing package for the selected treatments so the patient can pay by installment — package content equals the plan; per-session value and minimum DP computed by the rules.
13. See whether the consultation is free or charged so I explain it correctly.
14. Ask the doctor to change the plan when the patient wants it — plan returns to the doctor; my selections are kept for review.
15. Record the patient as not buying so the consultation fee is billed and deferred items are followed up.
16. Get the patient's purchase confirmation so there is no dispute later — signature/tick with timestamp; clinical consent remains separate.
17. Send the bill to the cashier once, without duplicates — single submission; tracker shows progress.
18. Track my patient through payment and treatment without asking around.
19. Propose an additional treatment during treatment so the patient's request is handled correctly — clinical approval, patient agreement, cashier notification visible in order.
20. Follow up deferred items with a manual WhatsApp message and record the outcome.
21. Be recorded correctly as guiding and/or closing BC so my commission is fair.
22. Never see other staff's commission or detailed prior diagnoses — enforced by permissions.

---

## 9. Sample data (consistent across all prompts)

Clinic "Klinik Aurelia", branch "Cabang Kemang", date Sabtu 14 Nov 2026. BC "Sari" (current), other BC "Dewi". Doctor "dr. Maya Pratiwi". Nurse "Dewi Lestari".
Patient "Rina Kusuma", RM-00231, 29 th, Perempuan, Pasien Lama, Booking 10:00, datang 10:05, Alergi Lidokain (verified), Saldo Rp 350.000, DP Booking Rp 200.000, 1 paket aktif "Facial Acne" (2 sesi tersisa, 1 bisa dipakai, berlaku s.d. 12 Mar 2027), last visit 12 Sep 2026 Facial Acne by Dewi Lestari.
Plan and money as in §5.5 (normal Rp 5.200.000; package Rp 4.680.000; per session Rp 900.000 / Rp 1.440.000; serum Rp 285.000; total Rp 4.965.000; DP minimum Rp 1.185.000; after DP 1 peeling session usable; remaining package bill Rp 3.780.000).
Waiting list: A-012 Rina Kusuma (Lama, Booking, 12 mnt), A-013 Putri Anggraini (Baru, Walk-in, 6 mnt, "Ingin tanya flek"), A-014 Lestari Wibowo (Kontrol, Booking, 2 mnt).

---

## 10. Open items affecting BC screens
1. Products taken home: must they be paid in full even when the treatment is on installment? (P: yes.)
2. Does the BC measure vitals (blood pressure, weight)?
3. Required fields before sending to the doctor (P: complaint, all special conditions, front photo or refusal).
4. Package-session and control visits: BC accompaniment optional? (P: optional.)
5. Who obtains the clinical consent signature, and who may approve additional treatment when the doctor is absent [V].
6. Whether BC may see prior diagnoses [V].
7. BC target definition (quantity metric) — not shown until defined.
8. Rounding rule for per-session values that are not whole Rupiah.
9. Minor patients and guardians.

---

## 11. Google Stitch prompts — BC screens

Run in one Stitch project, in order. Start with Prompt 0 from [STITCH-PROMPTS.md](STITCH-PROMPTS.md) (shared style and numaskin colors), then the prompts below. Each prompt repeats the essentials so it also works alone.

### BC-1 — Antrean Pendampingan

```text
Desktop 1440px, Indonesian UI, same style as the first screen (white surfaces on #F4F9FA, navy #002B49 titles, teal #0B6E7D primary, Inter, min text 12px).

Role shell for a Beauty Consultant. Left sidebar sections: HARI INI: "Pendampingan" (ACTIVE, mist #EBF5F8 background, teal text, left teal bar, badge 3), "Jadwal Hari Ini"; PASIEN: "Cari Pasien"; TINDAK LANJUT: "Tindak Lanjut" (badge 5); SAYA: "Komisi Saya"; bottom "Bantuan". No cashier, pharmacy, report or settings menus. Top bar: search "Cari pasien, No. RM, atau No. HP", static label "Cabang Kemang", bell with 2, user "Sari · Beauty Consultant".

Page title "Pendampingan", subtitle "Sabtu, 14 Nov 2026". A slim row of four figures: Menunggu BC 3 · Sedang didampingi 1 · Menunggu dokter 2 · Menunggu kasir 1.
Tabs: "Menunggu BC (3)" active, "Pasien Saya (4)", "Selesai Hari Ini (6)". Filter chips: Jenis kunjungan (Baru, Lama, Kontrol, Pakai Sesi Paket), Sumber (Booking, Walk-in).

Table columns: No. Antrean, Pasien (name, RM, age, red allergy icon if any), Jenis Kunjungan chip, Sumber, Datang, Menunggu, Catatan FO, BC Pembimbing, Aksi.
Rows:
A-012 Rina Kusuma · RM-00231 · 29 th · allergy icon | Pasien Lama | Booking 10:00 | 10:05 | 12 mnt (amber) | – | Sari | button "Ambil & Mulai"
A-013 Putri Anggraini · RM-00412 · 24 th | Pasien Baru | Walk-in | 10:11 | 6 mnt | "Ingin tanya flek" | – | "Ambil & Mulai"
A-014 Lestari Wibowo · RM-00198 · 35 th | Kontrol (chip "Gratis") | Booking 10:15 | 10:15 | 2 mnt | – | Dewi | "Ambil & Mulai" plus small grey note "BC opsional"

Below the table, a small toast example: "A-011 sudah diambil oleh Dewi pukul 10:17".
```

### BC-2 — Intake & Foto (step 1)

```text
Same shell and style; sidebar "Pendampingan" active. Breadcrumb "Pendampingan / Rina Kusuma". Autosave label top-right "Tersimpan otomatis 10:21".

Patient header bar: "Rina Kusuma" (navy, bold) · RM-00231 · 29 th · Perempuan · chip "Pasien Lama" · chip "Booking 10:00"; badges: red "Alergi: Lidokain", amber "Alergi dilaporkan: Parfum (belum diverifikasi)", "Saldo Rp 350.000", "1 paket aktif", "DP Booking Rp 200.000"; right side "BC Pembimbing: Sari" and status chip "Intake BC".

Step indicator: 1 Intake & Foto (current, teal) → 2 Pemeriksaan Dokter → 3 Diskusi Pilihan → 4 Konfirmasi & Kasir.

Main column (left ~68%):
Info note: "Intake awal oleh BC — belum diverifikasi dokter. Bukan diagnosis."
Section "Keluhan & Harapan": textarea "Keluhan utama *" filled "Jerawat kecil di dahi dan pipi kanan muncul lagi 2 bulan terakhir, bekas hitam tidak hilang"; chips "Area keluhan": Dahi (selected), Pipi kanan (selected), Pipi kiri, Hidung, Dagu, Sekitar mata, Leher; chips "Jenis masalah": Jerawat (selected), Bekas jerawat (selected), Flek/Melasma, Kusam (selected), Pori besar, Kerutan, Kemerahan, Lainnya; select "Sejak kapan": 1–3 bulan; fields "Yang sudah dicoba", "Skincare/obat sekarang", "Harapan pasien" ("Bekas jerawat memudar sebelum acara 12 Des"), date "Target waktu".
Section "Kondisi Khusus (dilaporkan pasien) *" with label "perlu verifikasi dokter": rows each with segmented Ya / Tidak / Tidak tahu: Hamil atau merencanakan kehamilan (Tidak), Menyusui (Tidak), Minum obat rutin (Tidak), Punya alergi (Ya → text "Parfum, menyebabkan gatal"), Riwayat keloid (Tidak), Treatment estetik 6 bulan terakhir (Ya → "Facial Acne, Sep 2026"), Penyakit dalam perawatan dokter (Tidak).
Section "Foto Sebelum": two checkboxes first: "Pasien mengizinkan foto untuk keperluan klinis" (checked), "Pasien mengizinkan foto dipakai untuk promosi" (unchecked, optional). Four slots: Depan * (filled), Kiri 45° (filled), Kanan 45° (filled), Close-up area keluhan (empty dashed slot with buttons Kamera, Unggah, Dari HP). Small link "Pasien menolak difoto".
Section "Observasi Kulit": single-choice chips Tipe kulit (Kombinasi selected), Sensitivitas (Sedang selected), textarea "Catatan BC". No measurements, grades or percentages.

Right column (~32%) "Riwayat Singkat" (read-only): Kunjungan terakhir 12 Sep 2026 Facial Acne oleh Dewi Lestari; Paket aktif "Facial Acne — bisa dipakai 1 sesi · sisa 2 · berlaku s.d. 12 Mar 2027"; Kontrol berikutnya: tidak ada; two previous photo thumbnails with "Bandingkan"; "Item pernah ditunda: tidak ada".

Sticky footer: left "Wajib: Keluhan utama, Kondisi khusus, Foto depan" with green checks; right buttons "Lainnya ▾" (contains "Pasien batal / pulang"), "Simpan Draf", primary "Kirim ke Dokter".
```

### BC-3 — Menunggu Dokter (step 2)

```text
Same shell, header and step indicator; step 1 checked, step 2 current.
Status banner (teal tint): "Sedang diperiksa dr. Maya Pratiwi sejak 10:32".
Main area: intake shown read-only in a compact summary (complaint, areas, problems, special conditions with the two "Ya" answers highlighted, 3 photo thumbnails, skin observation), each section labelled "Dikirim 10:24".
Box "Catatan tambahan untuk dokter" with one appended note "10:29 · Sari: Pasien punya acara 12 Des, ingin hasil cepat" and a button "Tambah Catatan". Text: "Catatan ditambahkan, intake asli tidak berubah."
Right column: Riwayat Singkat as before.
Footer: secondary "Kembali ke Antrean" and disabled primary "Diskusi Pilihan" with helper "Aktif setelah rencana disetujui dokter".
Also show, as a second small frame below, the alternative banner state (red-amber): "Dokter: treatment laser tidak disarankan saat ini" .
```

### BC-4 — Diskusi Pilihan (step 3)

```text
Same shell, header; steps 1–2 checked, step 3 current.
Plan header: "Rencana Perawatan" with green chip "Disetujui · dr. Maya Pratiwi · 14 Nov 2026 10:40".

Left (~62%): plan grouped by stage, read-only content with a segmented control per item "Pilih | Tunda | Tolak":
Tahap 1 · Minggu 1–4 · Fokus: meredakan jerawat aktif
- Chemical Peeling (Salicylic 20%) · 2 sesi · Rp 1.000.000/sesi · Rp 2.000.000 — Pilih
- Serum Acne 30 ml · 1 botol · Rp 285.000 · "pakai malam hari" — Pilih
Tahap 2 · Minggu 5–8 · Fokus: memudarkan bekas jerawat
- Laser Acne Scar · 2 sesi · Rp 1.600.000/sesi · Rp 3.200.000 — Pilih
Kontrol 21 Nov 2026 — chip "Gratis, termasuk pembelian".
Show one extra item "Microneedling" struck through with label "Tidak disarankan dokter" and no control.
Below, an example of a Tunda state on a separate small row: reason chips Budget (selected), Waktu, Ingin pikir dulu, Takut efek samping, Konsultasi keluarga, Lainnya, plus date "Hubungi lagi pada".

Card "Opsi Paket": "Paket Acne Clear — 2× Chemical Peeling + 2× Laser Acne Scar", "Harga normal Rp 5.200.000" struck, "Harga paket Rp 4.680.000", "Nilai per sesi: Peeling Rp 900.000 · Laser Rp 1.440.000", "Berlaku 12 bulan sejak pembelian", "Bisa dicicil — tanpa bunga, tanpa jatuh tempo", "Hanya untuk pasien ini, tidak dapat dibagi"; toggle "Ambil sebagai paket" ON; note "Isi klinis tetap sesuai rencana dokter".
Section "Cara Bayar (dilakukan di kasir)": Paket: radio Lunas / Cicilan (Cicilan selected); Serum Acne: "Lunas — dibawa pulang hari ini"; checkbox "Sarankan pakai saldo pasien (Rp 350.000)".
Section "Catatan untuk Dokter": textarea + button "Minta Dokter Ubah Rencana".
Section "Atribusi": "BC Pembimbing: Sari" (locked icon), dropdown "BC Closing: Sari", select "Sumber pasien" (disabled, "hanya pasien baru").

Right (~38%) sticky "Ringkasan Biaya":
Konsultasi Dokter Rp 150.000 struck → "Gratis — ada pembelian"
Paket Acne Clear Rp 4.680.000
Serum Acne Rp 285.000
Total Rp 4.965.000 (large, navy)
DP minimum hari ini Rp 1.185.000 — small text "= sesi pertama Rp 900.000 + produk dibawa pulang Rp 285.000"
DP Booking sudah dibayar − Rp 200.000
Saldo pasien tersedia Rp 350.000
Setelah DP, bisa dipakai: 1 sesi Chemical Peeling
Sisa tagihan paket setelah DP: Rp 3.780.000

Footer: secondary "Pasien Tidak Membeli", primary "Lanjut ke Konfirmasi".
```

### BC-5 — Konfirmasi & Kirim ke Kasir (step 4)

```text
Same shell and header; steps 1–3 checked, step 4 current.
Left: "Ringkasan Pilihan Pasien" table with three groups: Dipilih (Paket Acne Clear — Cicilan; Serum Acne — Lunas), Ditunda (none), Ditolak (none); totals as before: Total Rp 4.965.000, DP minimum Rp 1.185.000, Konsultasi gratis.
Box "Persetujuan Pembelian (oleh pasien)": text "Saya menyetujui pembelian dan cara pembayaran di atas." Signature pad with a signed scribble, "Rina Kusuma · 14 Nov 2026 10:49", button "Ulangi tanda tangan".
Grey status line: "Persetujuan Tindakan Medis — dilakukan oleh tenaga medis sebelum treatment" chip "Belum".
Primary button "Kirim ke Kasir".

Below, show the after-sending state as a horizontal tracker: "Dikirim ke kasir 10:52" (done) → "Dibayar 10:58 · DP Booking Rp 200.000 + Saldo Rp 350.000 + QRIS Rp 635.000" (done) → "Persetujuan tindakan ditandatangani 11:02" (done) → "Di Ruang Treatment 2 sejak 11:05" (current) → "Selesai" (grey). Note: "Perubahan setelah pembayaran melalui kasir."
Right column: Riwayat Singkat.
```

### BC-6 — Usulan Treatment Tambahan (drawer)

```text
Same shell; background shows "Pendampingan" tab "Pasien Saya" with Rina Kusuma status "Di Ruang Treatment 2". A right-side drawer 480px titled "Usulan Treatment Tambahan — Rina Kusuma".
Fields: "Treatment *" search showing "Chemical Peeling area dagu (add-on)" Rp 350.000 (price read-only from master); "Jumlah" 1; "Alasan usulan *" "Pasien minta tambah area dagu"; "Ajukan ke" prefilled "Dewi Lestari (Perawat, Ruang 2)" with option "dr. Maya Pratiwi".
Vertical tracker after submit:
1. Persetujuan klinis — "Disetujui dr. Maya Pratiwi 11:12" (done, green)
2. Persetujuan pasien — "Pasien setuju 11:13" (done)
3. Tagihan tambahan dikirim ke kasir — "FO diberi tahu 11:13" (done)
4. Pembayaran — "Belum dibayar" (amber) with hint "Bisa dari saldo atau EDC/QRIS di ruangan oleh FO"
Footer: "Batalkan Usulan" disabled with hint "Hanya sebelum persetujuan klinis", button "Tutup". Note at top: "BC hanya mengusulkan. Persetujuan oleh tenaga klinis dan pasien."
```

### BC-7 — Tindak Lanjut

```text
Same shell; sidebar "Tindak Lanjut" active (badge 5). Title "Tindak Lanjut". Tabs: Hari Ini (5) active, Terlambat (2), Akan Datang (8), Selesai.
Table columns: Pasien, Item ditunda & alasan, Ditunda pada, Hubungi pada, Rencana & BC Pembimbing, Upaya terakhir, Aksi.
Rows:
Putri Anggraini | Laser Flek 3 sesi — Budget | 2 Nov 2026 | 14 Nov 2026 | Rencana Flek · Sari | Belum ada | buttons "WhatsApp", "Catat Hasil"
Ayu Saraswati | Chemical Peeling 2 sesi — Ingin pikir dulu | 31 Okt 2026 | 14 Nov 2026 | Rencana Acne · Dewi | 7 Nov: Masih pikir-pikir | "WhatsApp", "Catat Hasil"
Nadia Putri | Konsultasi saja — tidak membeli | 10 Nov 2026 | 14 Nov 2026 | – | Belum ada | ...
Show an open popover on the first row "Catat Hasil" with options: Tidak diangkat, Masih pikir-pikir (+tanggal), Booking dibuat (+tanggal), Tidak tertarik (+alasan); button "Simpan".
Small note under the title: "WhatsApp dibuka manual dari perangkat Anda."
```
