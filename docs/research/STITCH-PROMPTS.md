# Google Stitch Prompt Pack — Beauty Clinic SaaS (validation prototype)

Status: prototype brief for validating agreed workflows with clinic staff. Not a PRD, final UI, or design system. Screens show behavior already decided in [SESSION-HANDOFF-2026-10-30.md](SESSION-HANDOFF-2026-10-30.md) and blueprint §0.4.

Language rule: prompts are English; all on-screen UI text must be Indonesian. All names and numbers are fictional sample data.

## How to use

1. In Stitch, start one project. Paste **Prompt 0 (shared direction)** first, generate one screen, and keep it as the visual reference.
2. Generate prompts 1–8 one at a time in the same project. If a screen drifts in style, reply: "Match the visual style of the first screen exactly."
3. Fix wrong content with short follow-ups (for example: "Remove the chart; keep only the table"). Do not regenerate everything.
4. Link screens as a prototype in the journey order: 1 → 2 → 1 → 3 → 6 → 5 → 3; then 4, 7, 8 stand alone.
5. Show it to the BC, doctor, FO/cashier, pharmacy, treatment staff, and owner. Ask the validation questions under each screen. Record answers; do not change the business rules in the prompts without a decision.

Stitch output is only visual. A screen that looks right does not prove a rule is implemented.

---

## Prompt 0 — Shared direction (paste first, prepend to any prompt if style drifts)

```text
Design a desktop web app (1440px wide) for an Indonesian multi-branch beauty clinic management SaaS. All UI text in Indonesian. Audience: clinic staff working all day, so prioritize calm, legible, dense-but-readable operational screens.

Visual direction: clean modern clinic SaaS, similar in feel to a light medical admin dashboard. White content area on a very light grey app background, slightly rounded corners (8px), subtle 1px borders instead of heavy shadows, color palette taken from numaskin.id: deep marine navy #002B49 for headings, page titles and key figures; deep teal #0B6E7D for primary buttons, links and the active menu item (white text on it); cyan #269BA8 only for small accents, icons, focus rings and progress bars, never for body text; very light aqua-tinted backgrounds #F4F9FA (app background) and #EBF5F8 (selected row, active menu background); hairline borders #E2EDF0; text #0F172A primary, #475569 secondary, #94A3B8 only for placeholders. Small soft-tinted status pills with dark readable text: green Lunas/Selesai, amber Sebagian/Menunggu, coral-red (#E05368 tint) Belum dibayar/Habis, grey Dibatalkan. Muted gold #C5A869 only as a tiny decorative accent (e.g. member/paket badge outline), never for text. Font: Inter for all UI text, numbers in tabular figures, Indonesian Rupiah format "Rp 1.250.000". Generous row height in tables with sortable column headers, tabs under the page title, and a filter button plus primary action on the right of each list. Side drawers for details instead of navigating away. No gradients, no decorative blobs or illustrations, no emoji, no star ratings.

Shell: left sidebar grouped by work: Hari Ini (Antrean, Jadwal), Pasien, Klinis, Kasir, Paket, Treatment, Farmasi & Stok, Komisi, Laporan, Pengaturan. Top bar: clinic name "Klinik Aurelia", branch switcher "Cabang Kemang", global search "Cari pasien, No. RM, atau No. HP", notification bell with a count, signed-in user name and role.

Every patient-specific screen shows a persistent patient header: name, No. RM, age, gender, allergy badge in red when present, patient balance (Saldo), and active package count.
```

## Prompt 1 — BC workspace (intake and plan discussion)

> Superseded by the detailed BC specification and prompts in [BC-SCREEN-SPEC.md](BC-SCREEN-SPEC.md) §11. Kept for history.

```text
Using the shared style, design the "Pendampingan BC" screen for a Beauty Consultant (non-medical patient companion).

Patient header: "Rina Kusuma · RM-00231 · 29 th · Perempuan · Alergi: Lidokain · Saldo Rp 350.000 · 1 paket aktif".

Left main area, three sections:
1. "Intake Awal (belum diverifikasi dokter)": chief complaint, skin concerns as tags (Jerawat, Bekas jerawat, Kusam), current skincare, expectations, label clearly that this is preliminary and not a diagnosis.
2. "Foto Sebelum": 4 photo slots (Depan, Kiri 45°, Kanan 45°, Close-up) with 3 filled thumbnails and one empty slot.
3. "Analisis Kulit": simple fields (tipe kulit, sensitivitas, catatan).

Right panel "Rencana dari Dokter" (read-only, authored by "dr. Maya Pratiwi"): staged plan list: Tahap 1 Minggu 1–4: Chemical Peeling ×2, Serum Acne; Tahap 2 Minggu 5–8: Laser Acne Scar ×2. Each line shows price. Below, "Pilihan Pasien": checkboxes for each line, a running total, options "Bayar penuh" / "Paket cicilan" with the computed minimum DP shown ("DP minimum Rp 1.000.000 = nilai sesi pertama"), and buttons "Tunda" and "Tolak".

Footer actions: "Kirim ke Dokter" (secondary) and "Lanjut ke Persetujuan & Kasir" (primary, enabled only after patient selection). Show the guiding BC field "BC Pembimbing: Sari".
```

Validation questions: Is this the order the BC actually works in? Is anything missing for the budget discussion? Can the BC finish this during a real consultation?

## Prompt 2 — Doctor workspace (examination with history)

```text
Using the shared style, design the "Pemeriksaan Dokter" screen. Patient header: "Rina Kusuma · RM-00231 · 29 th · Perempuan · Alergi: Lidokain · Saldo Rp 350.000 · 1 paket aktif".

Layout: three columns.
Left column (narrow), "Riwayat Pasien" always visible: timeline of past visits (date, treatment performed, products, short note), active care plan with progress "Tahap 1: 1 dari 2 sesi selesai", unresolved complaints, and a "Bandingkan Foto" link. Clicking a past visit opens it in a side drawer without leaving the current exam.

Center column: "Intake BC" summary at top with a label "Dicatat oleh BC Sari — perlu verifikasi"; then the doctor's own examination: keluhan utama, temuan pemeriksaan, diagnosis, catatan. A clear note that historical findings are reference only, not copied as today's findings.

Right column: "Sketsa Wajah": front face outline with 4 colored markers and a legend (Jerawat, Bekas jerawat, Area laser). Below, "Rencana Perawatan Bertahap" editor: stages with weeks, treatments, sessions, plus "Produk / Skincare" lines with quantity and instructions, and "Jadwal Kontrol" date.

Footer: "Simpan Draf" and primary "Setujui Rencana" with the doctor's name and timestamp.
```

Validation questions: Can the doctor see everything needed without switching screens? Is the face sketch useful in this form? Is the staged plan structure how doctors plan?

## Prompt 3 — Cashier (payment, balance, outstanding)

```text
Using the shared style, design the "Kasir" screen.

Left: list "Menunggu Pembayaran" with 4 patients (each row expandable into its sub-bills, e.g. "DP Booking", "Paket — cicilan", "Treatment tambahan", each with its own status pill), each showing name, source (Rencana baru / Treatment tambahan / Produk), amount, and wait time. One item highlighted amber: "Treatment tambahan — belum dibayar, treatment selesai 10 menit lalu".

Right: bill for the selected patient (same patient header). Lines: Konsultasi Dokter Rp 150.000 shown struck through with label "Gratis — ada pembelian"; Chemical Peeling (Paket 4 sesi, cicilan) Rp 4.000.000; Serum Acne Rp 285.000. Subtotal, discount, total.

Payment section: split payment rows: "DP Booking" Rp 200.000 (diterapkan otomatis), "Saldo Pasien" (available Rp 350.000, used Rp 350.000), "QRIS" Rp 735.000 with field "No. Referensi", plus options Tunai, EDC/Debit, Transfer. Show "Dibayar sekarang Rp 1.285.000", "Sisa tagihan paket Rp 3.000.000", and a note "Sesi yang bisa dipakai setelah pembayaran ini: 1 dari 4".

Also show a small "Kunjungan belum bisa ditutup — masih ada tagihan" state banner.

Primary action "Proses Pembayaran", secondary "Kirim Tagihan via WhatsApp" and "Cetak Struk".
```

Validation questions: Is split payment (balance + QRIS) how cashiers work? Are free-consultation and remaining-installment amounts clear to staff and patient?

## Prompt 4 — Patient package detail

```text
Using the shared style, design the "Paket Pasien" detail screen.

Package card header: "Paket Acne Clear — Mixed", purchased 12 Jan 2027 at "Cabang Kemang", valid until 12 Jan 2028 ("Berlaku 12 bulan"), status "Aktif", payment "Cicilan".

Summary row of four figures: Total harga Rp 4.000.000; Sudah dibayar Rp 2.000.000; Nilai sesi terpakai Rp 1.600.000; Sisa nilai dibayar Rp 400.000.

Session table: columns Treatment, Nilai per sesi, Total sesi, Terpakai, Bisa dipakai sekarang, Belum dibayar. Rows: Laser Acne Scar (Rp 1.600.000, 2, 1, 0, 1) and Facial Acne (Rp 400.000, 2, 0, 1, 1). Explain under the table: "Sesi dapat dipakai jika sisa pembayaran mencukupi nilai penuh sesi; urutan bebas sesuai tahapan dokter."

History list: payments (date, amount, method) and session usage (date, branch, performer, status). One usage shows "Dihentikan — alasan medis, sesi tidak terhitung".

Actions: "Tambah Pembayaran", "Pakai Sesi", "Tukar Treatment (perlu persetujuan dokter)", "Batalkan Paket". Show a note: "Paket tidak dapat dibagi ke pasien lain."
```

Validation questions: Do FO and owner understand "Bisa dipakai sekarang" instantly? Would a patient understand it if shown?

## Prompt 5 — Treatment room (tablet)

```text
Using the shared style, design a tablet landscape screen (1180×820) "Ruang Treatment 2" for a nurse/therapist. Large touch targets, minimal typing.

Top: patient name, allergy badge "Alergi: Lidokain", treatment "Chemical Peeling — Sesi 2 dari 4", performer "Nurse Dewi", status chips "Persetujuan: Ditandatangani" and "Pembayaran: Lunas" in green.

Section "Sebelum Mulai" checklist (large checkboxes): Identitas & treatment sesuai, Persetujuan tindakan ada, Bahan diterima sesuai, Kondisi kulit siap. Below, "Bahan dari Farmasi" list with quantities and a "Laporkan selisih" link.

Large timer card "Mulai Timer" / running "12:41" with "Jeda". Note: "Timer habis tidak otomatis menyelesaikan treatment."

Quick action buttons: "Tambah Bahan", "Usulan Treatment Tambahan", "Hentikan Treatment" (opens reason choice: Alasan medis / Pasien memilih berhenti / Kendala klinik).

Bottom section "Selesai": choice "Sesuai rencana" or "Ada perubahan"; consumption pre-filled from the standard formula with only exceptions editable; "Retur bahan tidak terpakai"; "Foto Sesudah" slots. Primary "Konfirmasi Selesai".
```

Validation questions: Can staff complete this without slowing the procedure? Which checklist items are unnecessary or missing?

## Prompt 6 — Pharmacy preparation and stock

```text
Using the shared style, design the "Farmasi" screen with two tabs: "Persiapan" (active) and "Stok".

Persiapan tab: queue of preparation requests generated automatically from patient-approved treatments and products. Columns: Waktu, Pasien, Sumber (Treatment / Produk / Tambahan), Item & jumlah, Status Pembayaran (Lunas / Belum lunas — boleh disiapkan, belum boleh diserahkan), Status (Menunggu, Disiapkan, Diserahkan ke ruang, Retur). One row tagged "Tambahan" showing only the incremental items. A detail drawer for one request lists items with batch and expiry, and buttons "Siapkan" and "Serahkan".

Top alert strip: "5 item di bawah stok minimum" linking to the Stok tab.

Show a compact preview of the Stok tab content as a secondary panel: table with Item, Satuan, Stok cabang, Dipesan/Reservasi, Minimum, Target, Saran pesan; rows like "Kapas (pack)", "Asam Salisilat 30% (ml)", "Serum Acne (botol)". Button "Buat Draf Pembelian".
```

Validation questions: Does auto-generated preparation match reality? Is the minimum-stock reminder sufficient for routine items like cotton?

## Prompt 7 — Staff commission

```text
Using the shared style, design the "Komisi Saya" screen for staff member "Sari (BC)", period "Januari 2027".

Summary: Komisi berhak Rp 2.450.000; Penyesuaian refund −Rp 150.000; Total periode ini Rp 2.300.000; Status "Menunggu persetujuan owner".

Table of entries: Tanggal, Pasien, Item, Jenis kontribusi (BC Pembimbing / BC Closing / Pasien Baru / Pelaksana), Dasar (pembayaran diterima), Aturan (e.g. "5%" or "Rp 200.000 tetap"), Komisi, Status (Berhak / Menunggu pelunasan / Menunggu sesi terpakai / Penyesuaian). Include one row where the same transaction gives Sari both "BC Pembimbing" and "BC Closing", one row "Menunggu pelunasan" for an installment, and one negative adjustment row "Refund — dipotong bulan ini".

Note at bottom: "Komisi dihitung dari pembayaran yang benar-benar diterima. Staf hanya melihat komisi sendiri."

Add a second small view for the owner: "Persetujuan Komisi" list of staff with totals and buttons "Setujui" and "Tandai Dibayar".
```

Validation questions: Is each entry understandable to staff, so there are fewer disputes? Is anything missing for the owner's approval?

## Prompt 8 — Owner dashboard

```text
Using the shared style, design the "Ringkasan Owner" dashboard with a branch filter "Semua Cabang / Kemang / BSD" and period "Bulan ini".

Top row, four KPI figures with change vs last month: Pembayaran diterima; Piutang pasien; Saldo pasien (titipan); Nilai paket belum terpakai (kewajiban). Label the last two clearly as liabilities, not profit.

Section "Perlu Tindakan" list: tagihan tambahan belum dibayar (2), paket akan berakhir 30 hari (6), stok di bawah minimum (5), komisi menunggu persetujuan (8).

Section "Per Cabang" table: Cabang, Pembayaran diterima, Treatment selesai, Paket terjual, Piutang. Rows Kemang and BSD plus total.

One line chart "Pembayaran diterima per minggu" for the last 8 weeks. No other charts.
```

Validation questions: Does the owner make decisions from these figures? Is the difference between cash received and package liability clear?

## Prompt 9 (optional) — Daily schedule and queue

```text
Using the shared style, design the "Jadwal Hari Ini" screen for front office. Day view calendar with one column per practitioner (dokter and terapis, with avatar, role, and today's patient count), time rows 09:00–17:00, a red current-time line, hatched "Istirahat" and "Tidak praktik" blocks. Appointment blocks show patient name, time, treatment chip, and status pill (Terjadwal, Datang, Dengan BC, Dengan Dokter, Di Ruang Treatment, Selesai, Tidak Datang). One block shows a small icon "DP Booking Rp 200.000". One amber strip across a block: "Menunggu pembayaran treatment tambahan — Rina Kusuma". Top: date navigation, "Hari ini" button, toggle Hari/Minggu, practitioner filter, and primary "Booking Baru". Right edge: collapsible "Antrean Walk-in" list with 3 waiting patients and wait times.
```

Validation questions: Can FO see at a glance who is where and who still owes payment? Is the walk-in queue handled the way the clinic works?

Visual references supplied by the user: [visual-refs/NOTES.md](visual-refs/NOTES.md). In Stitch you may also attach one or two of those images when generating Prompt 0 as a style reference, stating "use only as a style reference, not dental content".

---

## After the review

Record each answer as one of: confirmed, missing item, wrong rule, or unnecessary. Bring the notes back to the discovery session before any PRD. Only explicit decisions update the checkpoint.
