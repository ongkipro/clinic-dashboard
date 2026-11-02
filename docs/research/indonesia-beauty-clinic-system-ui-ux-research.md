# Indonesia Beauty Clinic Management System, Admin Dashboard and Public Front End — Complete Research (incl. UI/UX)

- Date: 2026-10-29
- Scope: Indonesian beauty/aesthetic clinic software (admin dashboard, management system, patient app) and the public websites of 20 clinic brands. Independent of any internal project.
- Companion documents: `../beauty-clinic-research.md` (market of 20 brands), `beauty-clinic-admin-system-research.md` (first reverse-engineering pass: endpoint inventories, guards).
- Method: black-magic (REA 6.7.0, CLI-first) passive browser scenarios with screenshots + accessibility trees at 1440×900 and 390×844, static reading of public JavaScript bundles, vendor product screenshots published on vendor sites, vendor documentation and pricing pages.
- Evidence on disk: `shots/` (72 PNG + accessibility trees), `rea/shot-*.evidence.json` (REA Evidence), `vendor-img/` (vendor-published product screenshots), contact sheets `sheet-public-desktop.jpg`, `sheet-public-mobile.jpg`, `sheet-flows.jpg`, `sheet-vendors-desktop.jpg`, `vendor-img/contact-*.jpg`.

**Evidence labels:** OBS = observed (REA capture, screenshot, bundle string); DOC = vendor or brand page text; INF = analyst inference; UNK = unknown. Static bundle strings show what client code references, not what the server enables.

**Boundary:** passive only. No login, sign-up, form submission or API call. Only resources served to every anonymous visitor were read. Public client keys were counted, never printed.

---

## Contents

1. Executive summary
2. Market map: software vendors in Indonesia (features, pricing, UI evidence)
3. Reverse-engineered admin system anatomy (what the real dashboards contain)
4. Complete requirement breakdown by stakeholder
5. Complete menu and page inventory — admin dashboard
6. Dashboard specifications per role (widgets, KPIs, alerts)
7. Key screen specifications (layout, fields, states, actions)
8. Patient app / member portal — pages and flows
9. Public front end — observed patterns of 20 brands
10. Public front end — complete page inventory and page contracts
11. UI/UX analysis: observed patterns, anti-patterns, recommended design system
12. Cross-cutting: compliance, integrations, hardware, security, privacy
13. Items not mentioned yet (gap checklist)
14. Unknowns, method log and sources

---

## 1. Executive summary

1. **Two very different software worlds.** Clinic *chains* (ZAP, ERHA, Natasha, NMW, SOZO) build their own customer layer (booking, app, e-store) and keep the back office private. *Independent clinics* buy a vertical SaaS: ICONIX (650+ clinics, Rp475k–775k/month), Aesta by Assist.id (6,000+ facilities across products), Klinik Pintar (free–Rp600k/month), Aoikumo (2,500+ clinics regionally), ClinicHub (one-time white-label purchase), OmniCare/LokaDok (SOZO is a listed client), Bee Clinic, Kasera, Aestech, TeraMedik, Sans Aesthetic (Rp150k/month), plus salon POS products (majoo, Moka, Olsera, Pawoon, Zenwel, DIRO) and booking-only tools (Termilo).
2. **Table stakes in Indonesia** (≥6 vendors): booking + WhatsApp reminders, doctor/beautician schedule, RME with before/after photos, packages with remaining sessions, deposit/DP, split payment, commission per treatment and role, stock with expiry, membership/points, owner reports, SATUSEHAT integration, multi-branch add-on.
3. **What the most complete systems add** (observed in reverse-engineered clients): maker-checker approvals (void, stock repair, restock/return), struck-through ("coret") records instead of deletes, suspicious-transaction reports, EMR edit lock, per-shift book closing, queue TV display with voice call, OTP signatures, payroll + attendance, WA scenario automation, owner daily digest, AI drafting of SOAP/prescriptions, slot holds with expiry, AI/human WhatsApp handoff, staff self-service apps.
4. **UI reality:** most admin products are dense, desktop-first, table-heavy, modal-driven, with a left icon sidebar and a top shortcut bar (Aoikumo, Aesta, ICONIX). The newer entrants (ClinicHub, Kasera, Bee Clinic) use a cleaner SaaS look: dark sidebar, KPI cards with period comparison, "AI summary on demand", mobile-first web. Patient-facing booking is still mostly WhatsApp links or a thin form (Hepta CRS for Natasha/Naavagreen).
5. **Public websites of the 20 brands** converge on: hero carousel + floating WhatsApp button + "Booking/Konsultasi" CTA + treatments + promo + branches + products + articles. Only ERHA, NMW and ZAP expose real search/booking UIs; ERHA and NMW use a mobile bottom navigation bar. Weak points: carousel-heavy heroes, no prices, no structured data, splash/loader screens (Airin), broken or placeholder content (Esther "This is the title"; DermiesMAX Digital Lounge shows a 404 on direct entry; erha.co.id returned 503 during one capture).
6. **Biggest opportunities**: a modern, role-based, mobile-friendly admin with strong controls; transparent public pricing with "who performs it"; a unified WhatsApp inbox tied to booking; consent-aware tracking; SEO/structured data, which no examined brand implements visibly.

---

## 2. Market map: software vendors in Indonesia

### 2.1 Vendor matrix

| Vendor | Segment | Pricing (DOC) | Platform | Distinctive features | UI evidence |
|---|---|---|---|---|---|
| **ICONIX** (iconix.id, since 2007, 650+ clinics) | Beauty + dental clinic | Business Rp475k/mo (Rp4.75jt/yr); Premium Rp575k/mo (+SATUSEHAT, WA marketing); Enterprise Rp775k/mo (+full accounting). Add-ons: multi-branch Rp100k/branch/mo, Accurate integration Rp50k/branch/mo, HRM Rp350k/mo, branded Android app Rp5.5jt one-time. 7-day trial | Web (Windows/Mac/Android/iOS browsers) | 5-level membership auto-upgrade; 3-level commission (Standar/Senior/Spesialis) per procedure; room & bed management; before/after photos doctor-only, max 10/visit; WA PDF invoice; daily owner email; video consultation; payroll with PPh 21 & BPJS; selfie+location attendance | Marketing illustrations + accounting screen (OBS `vendor-img/iconix-*`) |
| **Aesta by Assist.id** | Beauty clinic (Assist core serves 6,000+ facilities) | Lite / Aesta / Pro, "hubungi kami" | Web SPA (React + Material UI) | Lite: registration+queue, cashier, drugs & BHP, opname, reports. Aesta: +EMR, buffer/max stock, treatment and face records. Pro: +procedure packages, multiprice items. Core: BPJS, SATUSEHAT, accreditation, payroll, WA broadcast, queue display, OpenAI SOAP/Rx | Real UI: "Tambah Paket Prosedur" modal + settings menu (OBS `aesta-Interface-Tambah-Prosedur`); endpoint map in companion doc |
| **Klinik Pintar** | All clinic types incl. beauty | Mandiri free; Siap Rp300k/mo (Rp285k annual); Tumbuh Jaringan Rp600k; Tumbuh Ranap Rp600k | Web | Before/after photos, body anatomy charting, deposit payment, inter-branch integration, SATUSEHAT, PCare BPJS, Mobile JKN; queue on TV with voice call; online reservation | Hero shows body anatomy panel + photo card + deposit card (OBS) |
| **Aoikumo** (Malaysia, ID localized, 2,500+ clinics) | Aesthetic, salon, spa | Not public; no contract | Web + kumoBiz/kumoSan apps (iOS/Android) | Google review management with internal negative-feedback filter; package sharing; cross-branch redemption; batch/expiry + WAC costing; kumoSan staff app (clock-in, live commission); daily morning email; SATUSEHAT; ISO 27001 | Rich real UI screenshots (OBS §11.1) |
| **ClinicHub** (PT Digitalisasi Cara Sahabat) | Beauty clinic + solo doctor | One-time purchase, quote-based | Mobile-first web, white-label | WABA inbox, lead scoring, AI replies/drafts, broadcast, flash sale, referral, SEO articles, tiers Bronze→Platinum, AI Center ("Generate" on demand), audit log, 2FA, patient app | Live dashboard demo (OBS `clinichub-d.png`) |
| **OmniCare / LokaDok** | Multi-specialty incl. aesthetic (SOZO listed) | Not public | Cloud web | Calendar scheduling, SMS/WA confirm-by-reply, internal staff chat with image sharing, doctor search marketplace (LokaDok), BPJS, multi-branch (Telkomedika 30 branches) | Doctor search UI + chat UI (OBS) |
| **Bee Clinic** | Beauty clinic | 14-day trial; tiers on site | Web | Package & membership with remaining-session tracking on invoice, automatic therapist commission (fixed/%/per-therapist override), skincare inventory, booking board, QRIS invoice | Marketing page (OBS) |
| **Kasera** | Salon/spa/clinic booking + POS | 14-day trial, seat-based billing (bundle OBS) | Next.js web | Slot hold, deposit per treatment, installments, no-show/restore, commission rules with test, payouts, tips, attendance, AI/human WA booking take-over, AI price-list extraction, stylist self-service | Marketing + bundle routes (companion doc) |
| **Aestech** | Beauty clinic | Not public | Web | Booking + WA/email reminders, beauty records, inventory | Placeholder hero image (OBS) |
| **TeraMedik** | Hospitals and clinics | Not public | Web | General SIMRS/clinic | Marketing (OBS) |
| **Sans Aesthetic** (Sans Digital) | Beauty clinic | Rp150k/mo incl. .com domain, min 6 months | Web | Registration, roster, appointment states Scheduled→Checked In→In Treatment→Completed/Cancelled, EMR, POS | Product page returned 404 during capture (OBS) |
| **majoo Prime Beauty** | Salon/spa POS | Prime "Rp0/outlet/month" headline; Prime+ quote; 45,000 merchants | Android/iOS/Windows + majoo Teams | Single/multi reservation calendar, service bundling, commission per service, payroll, attendance with location, GoFood/GrabFood integrations | Marketing (OBS) |
| **Moka, Olsera, Pawoon** | General POS with salon pages | Olsera Rp1.288–2.688jt/yr; Pawoon Pro Rp299k | Android/iPad | Retail POS, stock; weak on rooms/durations/commission per role (DOC via DIRO comparison) | — |
| **Zenwel, DIRO** | Wellness booking | Subscription, quote | Web | Storefront per merchant, QRIS/VA, waiting list, resources, packages, vouchers | Marketing (OBS) |
| **Termilo** | Booking only | Free page | Web widget | Slot lock 10 min until deposit paid, auto-assign staff, webhooks/API, no RME/POS/WA by design | Marketing (OBS) |
| Global (reference) | Zenoti, Fresha, Mindbody, Mangomint, Vagaro | USD pricing, weak QRIS/VA | — | AI receptionist, AI scribe, kiosk, gift cards | — |

### 2.2 What vendors say clinics complain about (DOC, deduplicated)

Remaining package sessions hard to track or "forgotten" by patients · commission computed in Excel with errors · stock runs out or expires unnoticed · double-booked doctors/rooms · booking by phone/WA back-and-forth · no-shows (vendor claims 10–20% without deposit, 5–7% with deposit — unverified) · no proof of results (before/after) · patients not coming back, manual chasing · many apps, double entry · owner cannot see omzet/receivables/commission without staff rekap · multi-branch monitoring · regulatory pressure (RME mandatory, SATUSEHAT) · slow support at peak hours · vendor lock-in.

---

## 3. Reverse-engineered admin system anatomy

Detailed endpoint inventories are in the companion document. The menu structures below are reconstructed from the vendor clients and screenshots.

### 3.1 Aesta / Assist.id (OBS: router paths + labels in public bundle `9dd7fbfeb83321bc`)

Top-level areas: `Registration` (incl. queue display landscape/portrait), `Rawat Jalan` (outpatient queue), `EMR`, `Apotek`, `Cashier`, `Office` (finance, reports, HR), `CRM` (ikhtisar, message center, WA notifications), `Telekonsultasi`, `Accreditation`, `PKS` (cooperation agreements), `Settings`, onboarding `Wizard`.

Settings sub-menu seen in the UI screenshot: Setup Komisi Prosedur · Setup Poin Prosedur · Setup Komisi Paket Prosedur · Kamar Inap · Printing Template · Billing · Surat Menyurat · Data Entry (plus Paket Prosedur list with name, validity days, contents @price, price).

Approval management toggles: Approve Void · Approve Repair Obat · Approve Repair BHP · Approve Repair Depot · Approve Restock Return.

Configuration labels: Warning Stok Obat, Warning Kadaluarsa, Lokasi Depot Obat dan BHP, Format Kode BHP, Margin Harga Jual BHP, Jumlah Bulan DP Expired, Discount dan Voucher, Tanda Tangan Menggunakan OTP, Aktifkan panggilan antrian pasien, Display Antrian, Setup Pendaftaran Appointment, Template Notifikasi Appointment.

89 named reports (full list in companion doc), grouped: omzet (daily/weekly/monthly/yearly, per shift), cash closing (Tutup Buku, per shift), margins (drugs, BHP), usage cost of BHP, stock (persediaan, mutasi, opname, adjustment, asset, global), commission and points, fee seller product, doctor activity (tindakan, obat, total pasien, berhalangan hadir), top treatment, top-spending and top-visiting patients, new vs returning visits, waiting time (registration, pharmacy), struck-through actions, EMR recap, satisfaction survey.

### 3.2 Kasera (OBS: public Next.js chunks)

Merchant areas: Appointments · Clients (notes with hide, packages, loyalty) · Services (components/materials, variations, categories) · Products & inventory · Staff (working hours, date hours, time-off, services they can do, invites, team access) · Locations & spaces (rooms/beds, occupancies) · Business hours & closures · Commission rules (+test, reorder, override) · Commission payouts · Payouts & bank account · Payment methods & fees · Taxes · Promotions (codes, stats) · Campaigns (preview) · Loyalty (catalog, rules, settings) · WhatsApp booking (accounts, conversations: take-over / hand-back / close) · WhatsApp credits · Leads waiting · Refunds pending · Offline refusals · Attendance (entries, overtime exclusions) · Billing (seats, tier) · Onboarding checklist (incl. AI price-list extraction). POS: bookings checkout, quick sale, promotions preview, payment fees, loyalty catalog. Staff app: my schedule, my services, my stats, payouts, tips, receipts.

### 3.3 ClinicHub (OBS: live demo on marketing page + bundle)

Sidebar: Dashboard · Pasien · Reservasi · Rekam Medis · Keuangan · Kasir & Invoice · Laporan · CRM · WhatsApp · Loyalty (+ Master Data, Live Chat, Audit Log in bundle). Dashboard: period toggle (Bulan ini / Hari ini), compare to previous period, AI summary button "Generate", KPI cards Collection (Rp248jt, +35%), Omzet (Rp292jt, Rp44jt belum lunas), Pasien Baru (47; 312 kembali), Reservasi (128); charts Revenue & Collection, Patient Acquisition (new vs returning), Top Treatment by count. Other labels: Provider Scorecard, Rating Trend, Repeat rate, Referral rate, At Risk, Average ticket, Collection Rate, Closing rate, Doctor occupancy, Cash Cow / Question Mark matrix, Inactive patients and transaction value, Stok menipis, Tukar Treatment, Simpan Resep (BHP recipe).

### 3.4 Aoikumo (OBS: vendor product screenshots, Indonesian locale)

Sidebar: Dashboard · Janji Temu · Pelanggan · Penjualan · Daftar (roster) · Layanan · Inventaris · Karyawan · Voucher · PIN · Laporan · Toko Web · Konfigurasi. Top bar: quick-action icon set (cash, chat, alerts, cart, notifications) + avatar. Customer profile tabs: Linimasa · Catatan Kasus · Tindak Lanjut · Dokumen · Visual · Sertifikat Medis · Resep · Laboratory · Vaccinations. Left patient card: photo, name, member ID, membership tier, phone/WA, nationality, branch, assigned staff. POS: line items with allocation per payment, discount per line, voucher code, rounding, split tender (card type, bank, trace no., approval code), "Backdate invoice?", sales notes. Low-stock modal. Package card: Dibeli/Ditukar/Sisa with expiry. Staff "My Profile": daily/monthly/total sales, category breakdown donut, contribution bar per branch, monthly commission, hands-on total. Google review management: Konfigurasi / Ulasan Google / Tinjauan Internal tabs, reply column. Mobile app: day/week/month calendar with colour-coded appointments by room, staff break slots, sales and commission summary. Case notes: rich-text editor + face diagrams with markers + photo collage with annotations.

### 3.5 Klinik Pintar, OmniCare, ICONIX (OBS screenshots)

Klinik Pintar: body anatomy panel with point notes ("Leher, Perut, Paha"), latest condition photo card with upload date, deposit usage card ("Total, Deposit, Pakai semua"). OmniCare: patient-facing doctor search with filters (specialty, city, doctor name, gender, time), slot grid per day, map; internal chat between pharmacy and doctor with image sharing. ICONIX: accounting module (balance sheet, P&L, journal, ledger, cash flow, AR/AP).

---

## 4. Complete requirement breakdown by stakeholder

Priority: **M** must (launch), **S** should (≤6 months), **C** could (later).

### 4.1 Patients and the public

| Stakeholder | Needs | P |
|---|---|---|
| Anonymous visitor | Find treatment by concern; honest price range; downtime; who performs it; doctor credentials; nearest branch; reviews; book or chat in ≤3 taps | M |
| New patient | Short registration (name, WA, DOB; NIK optional), OTP, first-visit guide, consent explained, deposit/cancellation terms before paying | M |
| Returning patient/member | Upcoming bookings; reschedule/cancel by policy; packages by remaining sessions with expiry; deposit balance; points/tier/vouchers; receipts; routine; reorder skincare | M |
| Patient after treatment | Aftercare instructions, check-in, complication channel separate from promo, after-hours guidance | M |
| Online-only buyer | Skincare catalog, cart, courier shipping and tracking, marketplace links (Shopee/Tokopedia/Blibli are common, OBS) | S |
| Teleconsult patient | Paid online consultation, e-prescription payment | S |
| Family/guardian | Shared package/deposit, guardian consent for minors | S |
| Corporate/group | Group booking, company invoice | C |
| Foreign/tourist | English UI, passport ID | C |
| Referrer/KOL | Referral code, tracking, reward | S |

### 4.2 Clinic roles

| Role | Daily jobs | System needs | P |
|---|---|---|---|
| Owner | Revenue, growth, risk | Omzet vs collection vs receivables, liabilities (deposit/package), margin after BHP & commission, retention, branch comparison, daily digest (WA/email), approvals on big items | M |
| Medical director / PJ | Clinical governance | Protocol and consent templates, credential expiry (STR/SIP), incidents, complications, chart audit, delegation rules | M |
| Clinic manager | Run the floor | Roster, room/device utilization, approval queue, staff performance, complaints, stock alerts | M |
| Receptionist | Register, check-in, queue | Walk-in registration with duplicate check, queue number + TV call, calendar by doctor/room, no-show handling | M |
| Cashier | Settle | Multi-scenario POS (single, package, redeem, deposit, DP/installment), split tender, voucher/points, receipts print/WA, void with approval, shift close | M |
| Beauty consultant (BC) | Intake + sell | Intake form, photos, package simulator, targets & commission | M |
| CS / admin WhatsApp | Conversations | Shared WA inbox, lead status, assignment, quick replies, booking link from chat | M |
| Doctor | Assess, decide, document | Patient workspace, face/body map, dosing, consent, care plan, e-Rx, letters, signature (PIN/OTP) — on tablet | M |
| Nurse | Prep, assist | Orders, vitals, numbing timer, tray checklist, sterilization log | M |
| Beautician/therapist | Non-medical treatments | Own schedule, protocol steps, BHP use, own commission | M |
| Pharmacist/apoteker | Dispense | Rx queue, label (etiket), expiry/BUD, FEFO, opname | M |
| Warehouse/purchasing | Stock | PO, receipt with batch/expiry, transfer between depots/branches, return to supplier | M |
| Finance/accountant | Books | Journals, AR/AP, deposit liability, tax (PPN/Coretax), reconciliation, period lock, export to Accurate/Jurnal | S |
| HR/payroll | People | Attendance (selfie+location), leave, overtime, payroll incl. commission, PPh 21, BPJS | S |
| Marketing | Demand | Promos, vouchers, campaigns, segments, birthday, reactivation, reviews, referral, landing pages, ad attribution | M |
| IT/admin | Platform | Users, roles, 2FA, audit log, integrations health, backups, numbering formats, templates | M |
| DPO/compliance | UU PDP | Consent ledger, data-subject requests, breach register, processors | S |
| Internal auditor | Control | Suspicious activity, voids, refunds, overrides, stock variance | S |

---

## 5. Complete menu and page inventory — admin dashboard

Reference sitemap reconstructed from all observed products. Each page lists the job it serves. **Bold** = consensus (≥3 products); *(adv)* = advanced, seen in leaders only; *(new)* = recommended though not observed in Indonesian products.

### 5.1 Global shell

- Top bar: branch switcher · global search (patient, invoice, phone, member code) · quick actions (new booking, new walk-in, quick sale, new patient) · notifications · chat/inbox badge · user menu (profile, my commission, switch role, logout, lock screen).
- Left navigation grouped by job; collapsible to icons; role-filtered.
- Command palette (Ctrl/⌘+K) *(new)*.

### 5.2 Menu tree

```
Dashboard
  ├─ Ringkasan (role-based home)
  ├─ Live board / Papan klinik (today's flow)          (adv)
  └─ AI summary (on demand)                            (adv)

Front Office
  ├─ **Pendaftaran pasien** (new / walk-in, duplicate check)
  ├─ **Antrian** (queue numbers, call, skip, transfer)
  ├─ Display antrian (TV screen config, voice call)     (adv)
  ├─ **Check-in / check-out**
  └─ Kiosk self check-in (QR)                           (new)

Jadwal & Reservasi
  ├─ **Kalender** (day/week/month; by doctor / therapist / room / device)
  ├─ **Reservasi baru** (service → staff → room → time; deposit)
  ├─ **Daftar reservasi** (status: pending, confirmed, arrived, in treatment, done, no-show, cancelled)
  ├─ Booking online masuk (pre-appointments inbox)      (adv)
  ├─ Waitlist                                            (adv)
  ├─ Booking grup / korporat                             (adv)
  ├─ **Roster / jadwal praktik** (working hours, breaks, time off, doctor absence)
  ├─ Jam operasional & hari libur                        (adv)
  └─ Ruangan, bed & alat (capacity, maintenance)        

Pasien (CRM)
  ├─ **Daftar pasien** (search, filters, tags, VIP, segments)
  ├─ **Profil pasien** (tabs: Ringkasan/Linimasa, Kunjungan, Rekam medis, Foto & dokumen, Paket & saldo, Deposit, Poin & tier, Voucher, Transaksi, Resep, Konsen, Catatan internal, Komunikasi, Ulasan)
  ├─ Gabung data ganda (merge duplicates)               (new)
  ├─ Keluarga / penerima manfaat                        (adv)
  └─ Import pasien (Excel)

Klinis (RME)
  ├─ **Antrian dokter / workspace pasien**
  ├─ **Anamnesis & pemeriksaan** (SOAP, vitals, skin assessment)
  ├─ **Peta wajah/tubuh** (markers, dose per point)
  ├─ **Foto before/after** (angles, compare, annotate, collage)
  ├─ **Tindakan & BHP** (procedure, dose, materials)
  ├─ **Resep elektronik**
  ├─ **Informed consent** (template, signature PIN/OTP/pad)
  ├─ Rencana perawatan (care plan, next visit)
  ├─ Surat (rujukan, keterangan, resume medis)
  ├─ Template catatan per treatment
  ├─ AI scribe / draft SOAP (human sign-off)            (adv)
  ├─ Riwayat coret / amandemen                          (adv)
  └─ Telekonsultasi                                      (adv)

Ruang Tindakan
  ├─ Daftar tindakan hari ini per bed/ruang
  ├─ Timer & checklist (prep, numbing, treatment)
  ├─ Konfirmasi BHP terpakai
  └─ Logbook (sterilisasi, limbah B3, kalibrasi alat)   (adv)

Kasir & POS
  ├─ **Transaksi** (visit checkout, package sale, package redeem, product sale, deposit top-up, DP/termin)
  ├─ **Penjualan cepat** (OTC without visit)
  ├─ **Pembayaran** (cash, QRIS, transfer, VA, debit/credit card, e-wallet, deposit, points, voucher, split)
  ├─ **Struk / invoice** (print 58/80 mm, A4, WA PDF)
  ├─ Piutang & cicilan
  ├─ Refund & void (with approval)
  ├─ **Tutup kas shift** (expected vs counted)
  └─ Link pembayaran (pay-by-link via WA)                (adv)

Paket, Membership & Loyalty
  ├─ **Template paket** (contents, validity, price, shareable)
  ├─ **Paket milik pasien** (remaining, expiry, transfer/swap treatment)
  ├─ **Membership tier** (rules, auto-upgrade/downgrade)
  ├─ **Poin** (earn/redeem rules, expiry)
  ├─ **Voucher & promo** (codes, quota, period, stats)
  ├─ Gift card / voucher hadiah                          (new)
  └─ Referral                                            (adv)

Apotek & Inventaris
  ├─ **Antrian resep** (verify, dispense, label/etiket)
  ├─ **Master produk/obat/BHP** (units, conversion, BPOM no., storage temp)
  ├─ **Kartu stok** (movements per item)
  ├─ **Batch & kedaluwarsa** (FEFO, near-expiry, BUD for opened vials)
  ├─ **Stok opname** (blind count option, variance approval)
  ├─ Gudang/depot & mutasi antar depot/cabang            (adv)
  ├─ **Supplier**
  ├─ **Purchase order & penerimaan barang**
  ├─ Retur ke supplier                                   (adv)
  ├─ Resep BHP per treatment (recipe)                    (adv)
  └─ Peringatan stok minimum / maksimum

Staf & SDM
  ├─ **Data karyawan** (role, branch, credentials STR/SIP/SIPP, expiry alerts)
  ├─ **Aturan komisi** (by role: seller/executor/assistant; fixed/%; tiers; test)
  ├─ **Rekap komisi** & payout
  ├─ Absensi (selfie + location), cuti, lembur          (adv)
  ├─ Payroll (PPh 21, BPJS)                              (adv)
  ├─ Target & KPI per staf                               (adv)
  └─ Aplikasi staf (my schedule, my commission)         (adv)

Marketing & CRM
  ├─ **Inbox WhatsApp** (shared, assignment, labels, quick replies)  (adv)
  ├─ Lead & pipeline (new→contacted→booked→visited→lost)            (adv)
  ├─ **Broadcast / kampanye** (segment, template, schedule, frequency cap)
  ├─ **Otomasi** (reminder H-1/H-3, aftercare H+1, follow-up H+7/H+14, birthday, package expiry, dormant >90 days, refill)
  ├─ Ulasan Google & survei kepuasan                     (adv)
  ├─ Konten website (banner, promo, artikel, testimoni) — CMS
  └─ Atribusi sumber (UTM, ads, referral, walk-in)

Keuangan
  ├─ **Laporan omzet & pembayaran**
  ├─ Jurnal & buku besar                                 (adv)
  ├─ **Piutang/hutang**
  ├─ Liabilitas deposit & paket                           (new)
  ├─ Rekonsiliasi payment gateway & bank                  (adv)
  ├─ Pajak (PPN, e-Faktur/Coretax export)                (adv)
  ├─ Biaya operasional (pengeluaran kantor)               
  ├─ Tutup buku bulanan / period lock                     (adv)
  └─ Ekspor akuntansi (Accurate, Jurnal.id)              (adv)

Laporan & Analitik
  ├─ Penjualan (omzet harian/mingguan/bulanan/tahunan, per cabang, per kategori)
  ├─ Treatment (top, margin, BHP cost per treatment)
  ├─ Pasien (baru vs kembali, retensi, churn, top spender, LTV)
  ├─ Staf (scorecard, utilisasi, komisi)
  ├─ Operasional (waktu tunggu, no-show, okupansi ruang/alat)
  ├─ Stok (persediaan, mutasi, kedaluwarsa, selisih opname)
  ├─ Marketing (kampanye, promo, sumber pasien, konversi lead)
  ├─ Audit (void, refund, diskon manual, coret, transaksi mencurigakan)
  └─ Jadwal kirim laporan (email/WA)                    (adv)

Pengaturan
  ├─ Profil klinik & cabang (licence, NIB, PJ, logo)
  ├─ **Pengguna & hak akses** (roles, permission matrix, 2FA, sessions)
  ├─ **Master layanan/treatment** (category, duration, prep time, room/device needed, staff allowed, price per branch, tax class, BHP recipe, consent template)
  ├─ Metode pembayaran & biaya
  ├─ Pajak
  ├─ Template (struk, invoice, consent, surat, WA messages)
  ├─ Penomoran (RM, invoice, PO)
  ├─ Integrasi (SATUSEHAT, payment gateway, WA BSP, email, Google Business, accounting, courier)
  ├─ Kebijakan (cancellation, deposit, no-show, refund, package expiry)
  ├─ Manajemen approval (who approves what, thresholds)
  ├─ Privasi & persetujuan (consent purposes, retention)
  ├─ Backup & ekspor data
  ├─ Log aktivitas / audit log
  └─ Langganan & tagihan (SaaS)
```

### 5.3 Count summary

Approximately **14 top-level menus, ~110 pages/sub-pages** for a complete multi-branch product. A launch ("MVP") set used by the cheapest vendors is about **25 pages**: dashboard, calendar, reservation list, registration, queue, patient list/profile, RME + photos, cashier, receipts, packages, membership/points, products/stock, opname, staff, commission, reports (sales, stock, commission), settings (users, services, payment, templates).

---

## 6. Dashboard specifications per role

| Role | Home widgets (top → bottom) | Alerts | Primary actions |
|---|---|---|---|
| **Owner** | Period selector + compare; KPI cards: Omzet, Collection, Piutang, Pasien baru vs kembali, Reservasi & no-show %, Average ticket; Revenue vs collection chart; Branch league table; Top treatments (count and margin); Package/deposit liability; Commission this period; Stock value & near-expiry | Large refunds/voids, cash variance, stock-outs on top items, credential expiry, low rating reviews | Approve, export, send digest |
| **Manager** | Today: bookings by hour, arrivals, waiting > X min, rooms/devices in use, staff on duty; approvals queue; complaints; no-shows; stock alerts | Overbooked slots, late doctor, device due for calibration | Reassign, approve, message staff |
| **Receptionist** | Queue board (waiting, called, in treatment, at cashier), today's calendar, unconfirmed bookings, online bookings to handle | No-show risk (repeat no-show), unpaid DP, birthday today | Register, check-in, call, reschedule |
| **Cashier** | Open bills, pending payments/pay-links, shift totals by tender | Unpaid add-ons, failed gateway payments | Settle, print/WA receipt, close shift |
| **Doctor** | My queue today with status; patient summary cards (allergy, last treatment, package remaining); unsigned records; follow-ups due; triage cases | Contraindication flags, unsigned consent | Open workspace, sign |
| **Therapist/beautician** | My schedule, beds assigned, protocol of next client, my commission this month | Next client arrived | Start/finish treatment, confirm BHP |
| **Pharmacist** | Rx queue, near-expiry, opened vials BUD countdown, PO to receive | Expired/recalled batch | Verify, dispense, print label |
| **Marketing/CS** | Inbox unread, leads by stage, campaign performance, reviews to answer, dormant patients | SLA breach on chats | Reply, book from chat, launch campaign |
| **Finance** | Cash vs bank, gateway settlement pending, AR aging, liabilities, tax summary | Unreconciled items | Reconcile, lock period, export |

Observed KPI vocabulary in Indonesian products (OBS): Omzet, Collection, Belum lunas/Piutang, Pasien Baru/Kembali, Reservasi, Repeat rate, Referral rate, At Risk, Average ticket, Collection rate, Closing rate, Okupansi dokter, Top Treatment, Penjualan harian/bulanan/keseluruhan, Komisi, Hands-on total.

---

## 7. Key screen specifications

### 7.1 Calendar (Kalender Reservasi)
- Views: day (resource columns: doctors/therapists/rooms/devices), week, month, list. Toggle resource type.
- Card shows: time, patient name (+ VIP/new badge), service, staff, room, status colour, deposit paid icon, package icon.
- Interactions: drag to move (with conflict check), resize to change duration, click empty slot to create, right-click/long-press for status (arrived, no-show, cancel), break blocks, blocked time.
- Rules: duration = prep + treatment + buffer; resources reserved together; holiday closure greys out; staff capability filter.
- States: loading skeleton, empty day, conflict error with alternative slots.
- Mobile: agenda list + day view (Aoikumo app pattern, OBS).

### 7.2 New reservation (drawer, not full page)
Patient search/create → service(s) → staff (any or specific; fee for choosing staff seen in Kasera) → date/time from available slots → room/device auto → notes → deposit requirement and pay-link → confirmation via WA. Show policy text (reschedule cutoff, deposit refund rules).

### 7.3 Patient profile (360°)
- Left card (Aoikumo/Klinik Pintar pattern): photo, name, gender/age, member code, tier, phone/WA, allergies banner, tags, branch, assigned consultant, quick actions (book, sell, chat, add note).
- Tabs: Ringkasan/Linimasa · Kunjungan · Rekam medis · Foto & dokumen · Paket (Dibeli/Ditukar/Sisa + expiry) · Deposit · Poin & tier · Voucher · Transaksi · Resep · Konsen · Catatan internal · Komunikasi (WA history) · Ulasan.
- Privacy: clinical tabs visible only to clinical roles; cashier sees financial tabs only.

### 7.4 Doctor workspace (RME)
- Header: patient identity, allergies/contraindications, active packages, last visit summary.
- Left: visit timeline. Centre: SOAP/assessment form with templates per treatment; skin assessment (Fitzpatrick, concerns). Right: face/body map with markers and dose per point; photos with angle labels and compare slider.
- Bottom bar: procedures + materials (BHP) auto-priced → send to cashier; prescriptions; consent status; sign (PIN/OTP).
- Rules: record locked after signing; corrections as amendment/strike-through with reason; autosave drafts.

### 7.5 Photo compare
Side-by-side or slider, same angle filter, date labels, annotation tools (circle, arrow, text), collage export with patient consent watermark; capture guide (angles, lighting checklist).

### 7.6 Cashier / POS
- Left: items (treatments, products, packages, top-ups) with search and category chips. Centre: cart lines with staff attribution (seller/executor), qty, discount per line (approval above threshold), package redemption toggle. Right: totals (subtotal, discount, voucher, points, tax, rounding), tender split (cash with change, QRIS dynamic, card with bank/trace/approval code, transfer, deposit, DP/installment), remarks.
- After pay: receipt print/WA, next appointment suggestion, upsell skincare.
- Controls: void needs supervisor; backdate needs approval; offline queue if internet drops (decide policy).

### 7.7 Shift close (Tutup kas)
Expected per tender from transactions vs counted inputs, variance with reason, list of open bills, manager approval above threshold, printable summary.

### 7.8 Package management
Template editor (Aesta "Tambah Paket Prosedur" pattern: name, validity days, price, lines of procedure × qty × value). Owned package card: purchased/used/remaining per service, expiry, share with family, swap treatment ("Tukar Treatment" in ClinicHub), refund request with approval.

### 7.9 Stock
Item list with stock per depot, min/max, near-expiry badge; item detail with stock card; opname sheet (blind count option); PO list → receive with batch and expiry; transfer between depots; low-stock modal (Aoikumo pattern).

### 7.10 Commission
Rules table (role, service/category, fixed/%, tier, period, priority) + "test rule" simulator (Kasera pattern); staff statement per period with line detail; payout status.

### 7.11 WhatsApp inbox
Three-pane: conversation list (filters: unassigned, mine, label, SLA), conversation (templates, quick replies, attach price list, send booking link, AI draft with approve), side panel (patient match/create, upcoming bookings, packages, lead stage). Take-over/hand-back between bot and human (Kasera pattern).

### 7.12 Reports
Filter bar (period, branch, staff, category) → KPI header → chart → table with export (Excel/PDF) → schedule delivery. Every report has a definition tooltip (how the number is computed).

### 7.13 Settings: users & roles
Permission matrix (module × action: view/create/edit/delete/approve/export) per role; per-branch scoping; 2FA; active sessions; audit log of permission changes (Aesta notifies users when access changes, OBS `informUserHakAksesChanged`).

### 7.14 Queue TV display
Landscape/portrait layouts, current number per counter/room, next numbers, voice announcement, promo slideshow in idle area (Aesta, Klinik Pintar pattern).

---

## 8. Patient app / member portal — pages and flows

Observed in NMW portal, ClinicHub patient app, DermiesMAX Digital Lounge, ICONIX branded app, ERHA BUDDY (OBS/DOC).

| Page | Content |
|---|---|
| Login | WA OTP (preferred) or email+password; "login with another number"; remove other sessions |
| Beranda | Next appointment, active packages, points/tier, promo banner, quick actions |
| Booking | Branch → service/concern → doctor (optional) → slot → deposit → confirm; reschedule/cancel |
| Riwayat | Visits, treatments, invoices/receipts |
| Paket & deposit | Remaining sessions per service, expiry, deposit balance and history |
| Poin, tier & voucher | Balance, history, redeem catalog, digital member card |
| Rekam/kemajuan | Approved photos, skin progress (if offered), care plan, routine morning/night |
| Resep & produk | Prescriptions, reorder, pay prescription, courier tracking |
| Konsultasi online | Book and pay teleconsult, chat/video |
| Promo & artikel | Personal offers, education |
| Notifikasi | Reminders, aftercare, promo (opt-in) |
| Profil & keamanan | Personal data, addresses, consents, sessions, data request |
| Referral | Code, invited friends, rewards |
| Bantuan | FAQ, chat CS |

Flows to design: booking with deposit and slot hold; self check-in by QR at arrival; post-treatment check-in (Better/Same/Worse) routing to clinic staff; package expiry reminders; reorder with courier.

---

## 9. Public front end — observed patterns of 20 brands

Screenshots: `sheet-public-desktop.jpg`, `sheet-public-mobile.jpg`, `sheet-flows.jpg` (REA Evidence IDs in §14).

### 9.1 Brand-by-brand (OBS)

| Brand | Hero & visual style | Primary CTA | Navigation (header) | Mobile pattern | Notable |
|---|---|---|---|---|---|
| ZAP | Event banner (concert/festival), green brand, playful | Online Booking (green button in nav) | Treatments · Solusi Kami · Promo · E-Store · Lokasi · Artikel · Tentang ZAP | Hamburger + cart + language | Online booking = 2 selects (location, outlet) then redirect; marketplace links (Blibli/Shopee/Tokopedia) |
| ZAP Premiere | Luxury serif, celebrity face, "PRIMELIFT PROGRAM" | WhatsZAP | About · Treatments · Our Experts · Before After · Location · Technology · Privilege · FAQ | Hamburger | Before/After page in nav |
| ERHA Ultimate | Dark editorial, celebrity quote, "27 years" | Booking (orange pill in bottom bar) | Search bar "Pencarian Pintar" (AI) + "Heal Me / Uplift Me" concern entry | **Bottom nav: Klinik Eksklusif · Treatment · Booking · Cari Klinik · Cari Dokter** | Doctor finder with specialties and "Buat Jadwal"; sub-brands (ERHA Central, Riserva, ReviveDerm, Erhair) |
| DermiesMAX | Youth, red/white, store facade photo | Konsultasi (to Digital Lounge) | About · Products & Treatments · Our Doctors · Articles · Clinic Locations · FAQ | Hamburger | Digital Lounge deep link shows 404 without the right entry params (OBS) |
| Natasha | Pink/rose, model face, member discount (25%/15%) | Booking Perawatan (Hepta form) | Perawatan Kami · Klinik Kami · Produk · Testimoni · Berita · Login/Register | Hamburger + floating WA | Membership promo in hero |
| SOZO | Clean white/navy, clinical photo | Konsultasi Sekarang / Reservasi (WA with source tag) | Perawatan · Promo · Produk · Testimoni · Lokasi · Blog | Hamburger | Strong SEO footer: "klinik kecantikan {kota}" + treatment keywords |
| NMW | Dark warm, serif, "Klinik Kecantikan & Dermatologi di Indonesia" | Reservasi Konsultasi (orange) | Home · Layanan · Produk · Promo · Artikel · Dokter · Cabang · Login | **Bottom nav: Home · Layanan · Produk · Promo · Dokter** | Social proof "100K+ pelanggan", treatment ticker, "Journey Package" (Acne/Melasma) |
| Ella | Gold/white, model, "Raih Kulit Terbaikmu" | Booking Online (sticky bottom banner) | Beranda · Ella Channel · Perawatan · Produk · Promo · Klinik · Before After | Horizontal scroll tabs + sticky booking bar | Public price book ("Buku Menu", "Platinum") |
| Larissa | Green natural, product visual, "BOTOX TANPA JARUM" | WA | Home · Perawatan · Produk · Gerai · Artikel · Kontak · Tentang · Karir · Login/Register | Hamburger | Branch map (OpenStreetMap); e-commerce cart |
| Naavagreen | Pink/green youthful | Buat Jadwal (Hepta form) | Beranda · Produk · Perawatan · Lokasi · Berita · Tentang Kami | Account + hamburger | "Skin Solution Zone" by concern |
| Miracle | Green 30th anniversary, interior photo | Make Appointment / Consultation | Miracle Stories · Services · Special Offers · Aesthetic Insight · Contact | **Sticky bottom: Special Offers · Consultation** | Online store, marketplace (Traveloka, Shopee, Tokopedia), Academy |
| MS GLOW Clinic | Pink top bar with phone, treatment photo | Reservasi sekarang (WA) | Beranda · Tentang · Layanan · Cabang · Berita · Kontak | Hamburger + floating WA | Branch maps list |
| Gloskin | Deep red cinematic video ("Noda Hitam / Garis Halus") | Konsultasikan (WA per treatment) | Treatment · Promo · Skincare · Dokter · Tentang Kami · Insight | Icons (search, cart, menu) | Footer with refund & shipping policies, branch list |
| Airin | — | — | — | **Full-screen loader only at capture** (OBS) | Instagram feed as content |
| DNI | Purple serif, diverse group photo, "Kulit sehat, Glowing dari dokter ahli" | Booking Konsultasi Gratis (WA) | Tentang Kami · Layanan · Liposuction · Cabang · Membership · Promo · Kontak · ID/EN | Hamburger, ID/EN | Trust row: since 2007, 15 branches, 150+ treatments, BPOM; "Lihat Harga" per category |
| Esther | Pastel template, product bottle | Cart/login | Home · About · Services · Branches · Contact Us · Product | Hamburger | Template placeholder text "This is the title" visible (OBS) |
| Hepta CRS form (Natasha/Naavagreen) | Plain form on brand background | Reservasi Sekarang | — | Single-column form | Fields: Nama, WA, Kode Member, Email, Klinik, Tanggal, Jam, Catatan; date disabled until branch chosen |

### 9.2 Cross-brand findings

- **Navigation consensus** (from header/footer link frequency, OBS): Perawatan/Treatment · Produk · Promo · Lokasi/Cabang/Klinik · Dokter · Artikel/Blog/Berita · Tentang · Kontak · FAQ · Testimoni/Before-After · Login · Karir · Kebijakan Privasi · Syarat & Ketentuan · marketplace links.
- **CTA consensus:** one primary action ("Booking", "Reservasi", "Konsultasi", "Buat Jadwal") + a floating WhatsApp/chat bubble, visible on most captured homepages (not counted per page).
- **Concern-first discovery** exists only at ERHA (Heal Me/Uplift Me + search), Naavagreen (Skin Solution Zone), NMW (Journey Package), ZAP (Solusi Kami chips).
- **Price transparency:** ZAP (from 499k bundles, facial 699–799k), Natasha (regional price list), Ella (price book), DNI ("Lihat Harga"), DermiesMAX (275k–1.2jt FAQ). Most others hide prices.
- **Mobile:** bottom navigation (ERHA, NMW) and sticky booking bars (Ella, Miracle) are the most usable patterns; carousels dominate first viewport everywhere.
- **Quality issues:** loaders hiding content (Airin), template leftovers (Esther), broken deep links (DermiesMAX Lounge 404), 503 on main domain (erha.co.id once), session replay on booking forms (Natasha/Hepta: Clarity; Natasha: Hotjar + Contentsquare).

---

## 10. Public front end — complete page inventory and page contracts

### 10.1 Sitemap

```
/                               Beranda
/perawatan                      All treatments (filter by concern, area, category, price, downtime)
/perawatan/{kategori}           Category (Wajah, Tubuh, Rambut, Injeksi, Laser, Slimming…)
/perawatan/{slug}               Treatment detail
/masalah-kulit/{slug}           Concern landing (jerawat, flek/melasma, bekas jerawat, penuaan, pori, kusam, rambut rontok…)
/paket                          Packages / programs ("journey")
/harga                          Price list (ranges, tax-inclusive, version date)
/promo, /promo/{slug}           Promotions with T&C and quota
/dokter, /dokter/{slug}         Doctor directory and profile
/klinik, /klinik/{kota}, /klinik/{slug}   Branch directory, city pages, branch pages
/produk, /produk/{slug}         Skincare catalog (OTC only), cart, checkout or marketplace links
/before-after                   Consent-scoped results gallery (if legally approved)
/testimoni                      Verified reviews
/artikel, /artikel/{slug}       Education (medical-review stamp)
/skin-quiz                      Concern quiz → recommendation → booking
/booking                        Booking flow
/member (app)                   Login and patient portal
/membership                     Tiers and benefits
/faq                            General FAQ
/tentang, /penghargaan          About, awards, certifications (licence, ISO, BPOM)
/karir                          Careers
/kontak                         Contact, WA per branch
/kebijakan-privasi, /syarat-ketentuan, /kebijakan-pembatalan-refund, /pengiriman
/404, /500                      Helpful error pages
```

### 10.2 Page contracts (minimum content)

| Page | Must contain | Primary CTA | Structured data |
|---|---|---|---|
| Beranda | Value proposition, concern entry (chips/search), featured treatments with "mulai dari" price, promo, doctors, branches near me, social proof (verified), first-visit guide, FAQ | Booking / Konsultasi | `MedicalBusiness`/`MedicalClinic` (organization), `WebSite` + `SearchAction` |
| Treatment detail | What it treats, who performs it (doctor/nurse/therapist), duration (incl. numbing), downtime, sessions & interval, contraindications summary, price range + what changes price, FAQ, related treatments, branches offering it, doctor list, medical-review stamp | Booking this treatment | `Service`/`MedicalProcedure`, `Offer`/`PriceSpecification`, `FAQPage`, `BreadcrumbList` |
| Concern landing | Explanation, causes, treatment options compared (table), home care, when to see a doctor | Konsultasi | `MedicalWebPage`, `FAQPage` |
| Doctor profile | Name, titles, SIP, branch(es) and schedule, focus areas, education, languages | Book with this doctor | `Physician` |
| Branch page | NAP consistent with Google Business Profile, map, hours (incl. holidays), facilities, doctors on duty, services available, WA of that branch | Book at this branch | `MedicalClinic` with `openingHoursSpecification`, `geo` |
| Promo | Price, period, quota, T&C, eligible branches | Claim → booking | `Offer` |
| Product | BPOM number, ingredients, usage, size, price, stock | Add to cart / marketplace | `Product` |
| Article | Author + medical reviewer + date, references | Related treatment booking | `Article` with `reviewedBy` |
| Booking | Branch → service/concern → doctor (optional) → slot → identity + OTP → deposit (if required) → confirmation with calendar add | Konfirmasi | — |

### 10.3 Booking flow requirements (from best observed patterns)

1. Start from anywhere (treatment, doctor, branch, promo) with context prefilled.
2. Show only valid slots (staff capability + room/device + duration).
3. Hold the slot while paying (Kasera/Termilo hold 10 min), release on expiry.
4. WA OTP; returning patient auto-recognized; member code optional.
5. Show policy (deposit, reschedule cutoff, cancellation) before payment.
6. Confirmation via WA + calendar file; manage link to reschedule/cancel.
7. Capture attribution (UTM, ad click IDs) with consent; never send health data to ad pixels.
8. Fallback: "Chat WhatsApp" with prefilled message including a source tag (SOZO pattern).

---

## 11. UI/UX analysis

### 11.1 Admin UI patterns observed

| Pattern | Seen in | Assessment |
|---|---|---|
| Left icon sidebar + top quick-action icon bar | Aoikumo, Aesta | Fast for experts, poor discoverability; icons without labels |
| Patient left card + horizontal tabs | Aoikumo, ICONIX (DOC) | Good 360° context; too many tabs scroll horizontally on tablets |
| Data tables with "Show 10 entries" + search (DataTables) | Aoikumo, Aesta | Dated; lacks saved filters, column chooser, bulk actions |
| Modal forms for create/edit (MUI) | Aesta | Fine for short forms; poor for long clinical forms |
| KPI cards with period compare + AI summary on demand | ClinicHub | Modern, owner-friendly; cost-aware AI ("hemat token") |
| Multi-chart dashboard (day/month/year bars per outlet) | Aoikumo | Information-rich but noisy; same chart repeated 6× |
| POS with per-line payment allocation and split tender details | Aoikumo | Powerful; visually dense, small type |
| Low-stock modal on login | Aoikumo | Effective alerting; interrupts flow — better as notification/badge |
| Face diagram markers + rich-text case notes + photo collage | Aoikumo, Klinik Pintar | Core differentiator for aesthetics |
| Staff profile with own sales and commission | Aoikumo | Motivating; transparency reduces disputes |
| Mobile calendar with colour by room + breaks | Aoikumo app | Good for therapists |
| Internal chat with image share | OmniCare | Useful for doctor–pharmacy coordination; needs privacy controls |
| White-label (logo, colours) | ClinicHub, ICONIX app | Important for clinics' brand |

**Common UX problems (INF from screenshots):** small text and low contrast (light blue on white), icon-only navigation, inconsistent capitalization, English/Indonesian mixing, dense tables without hierarchy, destructive actions (red trash) next to normal actions without confirmation design, no visible empty/loading states in marketing captures.

### 11.2 Public site UI/UX observations

Strengths: strong photography, clear brand colour, floating WhatsApp, bottom navigation on mobile (ERHA, NMW), concern-first search (ERHA), trust rows (DNI).
Weaknesses: hero carousels pushing CTA below fold on mobile, lack of prices, generic "Teknologi Terbaik" claims, no treatment comparison, long WhatsApp-only funnels, inconsistent branch data, accessibility (text on images, low contrast pink/white), heavy pages (Airin loader, video heroes).

### 11.3 Recommended design system for an Indonesian clinic product

- **Information architecture:** navigation by job (Front Office, Jadwal, Pasien, Klinis, Kasir, Paket, Stok, Staf, Marketing, Keuangan, Laporan, Pengaturan); role-based home; global search; command palette.
- **Layout:** 3-zone workspace (nav · main · context panel). Drawers for create/edit; full pages for clinical records. Sticky action bar for primary action.
- **Density:** compact tables for back office (40 px rows), comfortable mode for tablets (48 px, touch targets ≥44 px).
- **Tables:** saved views, column chooser, filter chips, bulk actions, inline status, export; never "Show 10 entries" default.
- **Forms:** sectioned, autosave drafts for clinical, validation inline in Indonesian, currency input with thousand separators, `tabular-nums` for money.
- **Status language:** consistent colour + text label (never colour only): Menunggu, Dikonfirmasi, Datang, Sedang tindakan, Selesai, Tidak datang, Batal.
- **States:** every screen defines loading (skeleton), empty (reason + one action), error (code + recovery), success (toast with reference), permission denied.
- **Typography & colour:** neutral base, one brand accent per clinic (white-label tokens), semantic colours for status, WCAG 2.2 AA contrast.
- **Language:** Indonesian first with consistent terms (pasien, reservasi, tindakan, paket, sisa sesi, deposit, struk, komisi, stok, opname, kedaluwarsa); optional English.
- **Devices:** desktop for cashier/back office; tablet for doctor/consent/photo; phone for owner, therapist, staff app; TV for queue.
- **Performance:** fast first paint on low-end Android; offline-tolerant for front desk (decide queued payments policy).
- **Trust & safety UX:** confirmation with reason for void/refund/delete; approval requests visible with who/when; audit trail viewable per record.

---

## 12. Cross-cutting requirements

### 12.1 Regulatory (Indonesia)

| Topic | Requirement | Source |
|---|---|---|
| Electronic medical records | Mandatory for health facilities; interoperable with SATUSEHAT; transition deadline 31 Dec 2023, administrative sanctions per SE HK.02.01/MENKES/1030/2023 | Permenkes 24/2022; Kemenkes |
| Health data protection | Health data is specific personal data; consent, purpose limitation, data-subject rights, breach notification | UU 27/2022 (PDP) |
| Health service advertising | Rules on claims, testimonials, discounts for health services | Permenkes 1787/2010 (verify current applicability with counsel) |
| Professional licences | STR/SIP for doctors/nurses; delegation rules | UU 17/2023; PP 28/2024 |
| Electronic system operator | Register as PSE (vendors advertise "PSE Komdigi") | Komdigi |
| Tax | PPN on taxable services/products; Coretax e-Faktur | DJP |
| Cosmetics | BPOM notification for products sold | BPOM |

### 12.2 Integrations checklist

SATUSEHAT · payment gateways (Midtrans, Xendit, DOKU; QRIS, VA, cards, e-wallets) · WhatsApp Business API (BSP) · SMS/email · Google Business Profile & reviews · ad platforms (Meta CAPI, Google Ads, TikTok Events API) · accounting (Accurate, Jurnal.id) · courier (rates, tracking) · marketplace (Shopee, Tokopedia, Blibli, TikTok Shop) · lab (e.g. Prodia) · HR/payroll partner · calendar (Google) · BPJS only if the facility also serves general care.

### 12.3 Hardware

Thermal receipt printer 58/80 mm · label printer (etiket) · barcode scanner · tablet for consent/photos (with stand and consistent lighting) · TV for queue display + speaker · card EDC/QRIS stand · camera/lighting kit for standardized photos · optional kiosk.

### 12.4 Security and privacy guards (summary; details in companion doc)

Role-scoped code splitting (no full admin API map in public bundles) · server-side tenant scoping (no client-built queries) · per-user step-up approvals (not shared passwords) · backdating only via approval · staging separated from production · bot protection + OTP + slot hold on public booking · 2FA, idle lock, session management · no session replay on forms with health data · ad pixels never receive health data · consent banner with Consent Mode v2 · audit log for clinical and financial actions · encrypted backups with restore drills · data residency documented.

---

## 13. Items not mentioned yet (gap checklist)

Front office: queue TV display with voice call · kiosk/QR self check-in · walk-in duplicate detection · waitlist · group/corporate booking · holiday calendar.
Clinical: standardized photo protocol · photo compare and collage · AI scribe with sign-off · teleconsultation · letters (rujukan, keterangan) · amendment/strike-through history · complication/triage channel.
Commercial: deposit and slot hold · DP/installments · pay-by-link via WA · tip (salon style; probably off for medical) · gift cards · referral · marketplace sync · courier shipping · flash sale.
People: staff self-service app · attendance with selfie/location · payroll with PPh 21/BPJS · targets and leaderboards · credential expiry alerts.
Control: approval matrix (void, discount, refund, stock repair, restock/return, backdate) · suspicious-activity report · per-shift and monthly close · audit log viewer.
Growth: shared WA inbox and lead pipeline · segmentation and automation (birthday, dormant >90 days, package expiry, refill) · Google review loop · satisfaction survey · attribution · SEO pages and structured data · consent-aware tracking.
Platform: white-label theming · multi-branch pricing and stock transfer · data import/migration · export anytime (no lock-in) · onboarding checklist and in-app coachmarks · status page and support channel · SaaS billing (if building a product).
Compliance: UU PDP data-subject requests and breach workflow · PSE registration · retention policy · processor agreements.

---

## 14. Unknowns, method log and sources

### 14.1 Unknowns
- Server-side behaviour, authorization and enabled modules of every vendor (never tested).
- Real authenticated screens of ICONIX, Klinik Pintar, Bee Clinic, Kasera, Aestech, Sans (only marketing pages and bundles seen).
- Back-office systems of the chain brands (private).
- Correct domains for Athena and Bening's.
- Current legal interpretation of advertising and testimonial rules (counsel).

### 14.2 Next steps (optional)
1. With approval, create trial accounts (ICONIX 7-day, Bee Clinic/Kasera 14-day, Klinik Pintar Mandiri free) and record operator-driven HAR + screenshots of every menu for a screen-by-screen benchmark.
2. Turn §5–§7 into wireframes for the 25-page launch set.
3. Turn §10 into a public site specification with SEO and tracking plans.

### 14.3 REA Evidence IDs (screenshots, desktop captures; mobile IDs in `rea/`)

Vendors: aesta `ev_1f35cefc6d0a8`, aestech `ev_6504a4c260f42`, aoikumo-id `ev_dde89cd7a3348`, beeclinic `ev_6969355b7f31e`, clinichub `ev_b77991ba24853`, iconix-fitur `ev_592e23d6e30f8`, iconix-harga `ev_42f9e383b797e`, kasera `ev_4b8c9cff35f32`, klinikpintar `ev_cae2b5f8bd9e4`, majoo-beauty `ev_62519073b8d31`, omnicare `ev_d035107d29c34`, sans `ev_d9c4ba79e8da3` (404), teramedik `ev_bf3cfc5d5d81d`, termilo `ev_10c842fd232ce`, zenwel `ev_9061125f29f97`.
Brands: airin `ev_d7f93d9ee6975`, dermies `ev_29b16f16e7766`, dni `ev_36ee856bece77`, ella `ev_d3f7673c6b247`, erha-doctor `ev_e06692cda775a`, erha-ultimate `ev_5eab710495991`, esther `ev_fb2badbd49f65`, gloskin `ev_5d3488ba5ba17`, hepta-form `ev_3923e55849d27`, larissa `ev_7f253e55652aa`, digital-lounge `ev_ed456ddcc2f05`, miracle `ev_212a7604c735d`, msglow `ev_5c48df16e187d`, naavagreen `ev_a03ec275bc060`, natasha `ev_40eb98f401a8f`, nmw `ev_29dcc831b9573`, nmw-products `ev_65db8b63129d0`, zap-premiere `ev_fb8e390b94bac`, sozo `ev_f71fe9a247703`, zap `ev_7cd4ec2ec9b5a`, zap-booking `ev_fac5385d79ee1`.

Capture settings: Chromium 156 launch mode, `id-ID`, `Asia/Jakarta`, wait 5–6 s, capture URL + screenshot + accessibility; network bodies and header values disabled. A single capture is a point-in-time sample.

### 14.4 Sources

Vendors: https://www.iconix.id/fcantik.html · https://www.iconix.id/hcantik.html · https://assist.id/produk/aplikasi-klinik-kecantikan-aesta · https://klinikpintar.id/aplikasiklinik/faskes/klinik-kecantikan · https://www.aoikumo.com/id/ · https://clinichub.id/software-klinik-kecantikan · https://www.omnicare.co.id/ · https://beeclinic.id/klinik-kecantikan · https://www.kasera.id/untuk/klinik-kecantikan · https://aestech.co.id/solusi/klinik-kecantikan · https://teramedik.com/id · https://sansdigital.id/produk/sans-aesthetic/ · https://termilo.id/software-booking/klinik-kecantikan · https://majoo.id/bisnis/aplikasi-kasir-dan-point-of-sale-salon-kecantikan · https://zenwel.com/ · https://diro.app/blog/aplikasi-booking-salon-spa-klinik-indonesia-2026 · https://www.kasera.id/perbandingan/aplikasi-kasir-salon-terbaik
Regulation: https://peraturan.bpk.go.id/Details/245544/permenkes-no-24-tahun-2022 · https://www.kemkes.go.id/id/fasyankes-wajib-terapkan-rekam-medis-elektronik · https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022 · https://jdih.kemkes.go.id/storage/documents/pdfs/2010permenkes1787.pdf
Brand sites: URLs in §9 and the companion documents.
