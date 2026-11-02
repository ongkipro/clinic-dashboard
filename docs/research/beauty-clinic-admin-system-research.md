# Beauty Clinic Admin Dashboard & Management System — Full Breakdown, Reverse-Engineering Audit, Gaps and Guards

- Date: 2026-10-29
- Companion to: `../beauty-clinic-research.md` (20-brand market landscape)
- Related repository (read-only reference, not modified): `~/Projects/kliniknuma` (PRD/PLAN/TASKS/DESIGN, STATUS 2026-10-29) and `../numa-klinik-mvp-gap-audit-2026-10-29.md`
- Method: black-magic (REA 6.7.0, CLI-first) passive browser scenarios + static analysis of public JavaScript bundles, plus vendor documentation and regulation sources
- Artifacts: `rea/*.evidence.json` (REA Evidence envelopes), `bundles/` (public JS downloaded unauthenticated), `aesta-endpoints.json`, `assist-endpoints.json`, `static-extract.json`

---

## 0. Scope, evidence rules and ethical boundary

### 0.1 What was examined

| Layer | Targets | Technique |
|---|---|---|
| Public front end of the 20 brands | Official sites, booking pages, patient portals | REA `capture-browser-scenario` (Chromium 156, launch mode, 390×844, `id-ID`, `Asia/Jakarta`), accessibility tree + network metadata only |
| Patient-facing booking/portal apps | Hepta CRS (Natasha, Naavagreen), ZAP booking, DermiesMAX Digital Lounge (Arya Noble/ERHA), NMW `my.` portal, Larissa member area | REA scenario capture + static read of the public bundle |
| Clinic-management SaaS admin shells (the "dashboard" that clinics actually run) | Aesta by Assist.id, Assist.id core app, Kasera, ClinicHub, Klinik Pintar RME, Hepta CRS login | Unauthenticated download of the JavaScript the login page ships to every visitor, then REA `analyze-javascript-application` and literal extraction (routes, endpoint paths, labels, feature flags) |
| Vendor feature claims | ICONIX, Bee Clinic, Kasera, Aesta, ClinicHub, Klinik Pintar, Aoikumo, Zenoti, ICONIX user manual | Documentation fetch |
| Regulation | Permenkes 24/2022, SE HK.02.01/MENKES/1030/2023, UU 27/2022 (PDP), Permenkes 1787/2010, UU 17/2023, PP 28/2024 | Official text or summaries already cited in the kliniknuma defaults research |

### 0.2 Evidence labels

- **OBS** = observed in an REA Evidence record or a downloaded public bundle (Evidence ID or file SHA-256 prefix cited).
- **DOC** = stated on a vendor or brand page.
- **INF** = inference by the analyst from OBS/DOC; never treat it as fact.
- **UNK** = unknown; listed in §11.

Static strings in a bundle prove that the client code *references* an endpoint, label or flag. They do **not** prove the server implements it, that it is enabled for a given clinic, or how authorization works server-side.

### 0.3 Boundary (defensive, authorized, passive only)

- No login, no account creation, no form submission, no API call to any discovered endpoint, no fuzzing or enumeration.
- Only resources that the site serves to every anonymous visitor were read. Network capture used `request_body: false`, `response_body: false`, `header_values: false`.
- Embedded public client keys were **counted, not printed** (e.g. a Firebase web key and reCAPTCHA site keys in one bundle; these are designed to be public).
- Purpose: competitor UX/architecture benchmarking and clean-room requirements for a clinic system. Nothing here is a vulnerability claim against a named vendor; where an anti-pattern is noted it is phrased as a lesson for our own build.

---

## 1. Executive summary

1. **The "beauty clinic dashboard" market splits into two very different stacks.**
   (a) *Chain brands* build their own customer-facing layer (booking, patient portal, e-commerce, digital lounge) and run operations on an internal or licensed back office that is never public. (b) *Independent clinics* buy a SaaS (Assist.id/Aesta, ICONIX, Klinik Pintar, ClinicHub, Bee Clinic, Kasera, Hepta CRS) that bundles front office + RME + POS + stock + commission + WA.
2. **The full operating surface is far larger than "booking + RME + kasir".** Reverse engineering the Aesta/Assist.id client exposes **558 (Aesta) and 775 (Assist core) distinct endpoint paths across 118 and 184 resource groups**, 89 named reports, approval toggles, payroll, accreditation, BPJS/SATUSEHAT bridging, queue display screens and OpenAI-backed SOAP/prescription/ICD-9 drafting. Kasera's merchant client exposes ~200 paths including slot holds, deposits, no-show/refund/restore, commission rules with a *test* endpoint, payouts, tips, attendance, WhatsApp conversation take-over/hand-back and AI price-list extraction (OBS).
3. **Consensus table stakes** (present in ≥5 of the examined products): online booking with WA reminders, practitioner roster, before/after photos, anatomy/face markers, packages with remaining sessions, deposits/DP, split tender, commission per treatment/role, stock with batch/expiry, low-stock alerts, member/points, owner reports.
4. **Differentiators seen only in the strongest products**: maker-checker approvals (void, stock repair, restock/return), "struck-through" (coret) audit instead of deletes, suspicious-transaction reports, EMR edit locks, shift-level book closing, slot hold with TTL during payment, AI/human WA handoff, provider scorecard and treatment portfolio (BCG "cash cow/question mark") analytics.
5. **Common weaknesses (lessons/guards for us)**: the whole admin API map shipped to anonymous visitors in one bundle; client-built `where` filters sent to the API; session-replay tools (Clarity/Hotjar/Contentsquare) loaded on booking forms that collect name + WhatsApp + complaint; production pages pulling media from a bucket named `*-staging`; booking forms without visible bot protection; data residency and UU PDP rights rarely addressed in product.
6. **For kliniknuma specifically** (repo read, not modified): clinical safety, money and stock rules already exceed every product examined. The remaining gaps are mostly *commercial operations and growth* (leads/WA inbox, campaigns and segments, referral, Google review loop, waitlist, gift cards), *people operations* (payroll, attendance, staff self-service), *control* (void/discount approvals, suspicious-activity reports, period close), *public growth surface* (SEO, schema, treatment/doctor/location pages, consent-aware tracking) and *UU PDP data-subject rights + breach procedure*, which return **zero** hits in the planning documents.

---

## 2. Stakeholder breakdown — who needs what

Legend: **M** = must for a pilot, **S** = should within 6 months, **C** = could/later. "Not yet mentioned" marks needs that did not appear in the conversation so far.

### 2.1 External stakeholders

| Stakeholder | Core needs | Priority | Not yet mentioned? |
|---|---|---|---|
| **Prospective patient (anonymous visitor)** | Find treatment by concern; see honest price ranges, downtime, who performs it (doctor vs therapist), credentials; book or chat in ≤3 taps; nearest branch with opening hours; trust signals (SIP, BPOM, real reviews) | M | Price transparency and "who performs it" disclosure |
| **New patient (first visit)** | Simple registration (name, WA, DOB; NIK optional), clear first-visit guide, consent explained in plain Indonesian, deposit rules before paying | M | First-visit guide, deposit/cancellation terms shown before payment |
| **Returning patient / member** | Remaining sessions per service, upcoming bookings, reschedule/cancel within policy, receipts, points/tier, routine (morning/night), reorder skincare, post-treatment check-in | M | Receipt history, self-reschedule cutoff visibility |
| **Patient with complication** | Fast clinical channel separate from marketing, red-flag guidance, after-hours instructions | M | After-hours escalation script |
| **Family / guardian / beneficiary** | Shared package or deposit, guardian consent for minors, privacy between family members | S | Minor (<18) guardian flow |
| **Corporate / group client** | Group booking, company invoice, MCU-style packages (seen in Aesta: `JanjiGroups`, "Appointment Corporate") | C | Yes |
| **Tourist / foreign patient** | English UI, passport instead of NIK, foreign currency card payment | C | Yes (Bali/Jakarta branches) |
| **Online buyer (skincare only)** | Product catalog, cart, courier shipping and tracking (NMW uses a courier integration `kiriminaja`), OTC vs prescription separation | S | Yes: shipping/courier |
| **Online consultation patient** | Paid teleconsult, e-prescription, pay-for-prescription (NMW `/consult-pay`, `/prescription-pay`; ERHA BUDDY) | S | Yes |
| **Referrer / KOL / affiliate** | Referral code, attribution, payout (ClinicHub "Referral rate", ERHA Digital Lounge `referral` route) | S | Yes |
| **Supplier / distributor** | PO, goods receipt with batch/expiry, returns, payables | M | Partly (TASK-039 exists) |
| **Payment provider (Midtrans/Xendit/DOKU)** | Webhooks, VA/QRIS, refunds, settlement reconciliation | M | Settlement reconciliation |
| **WhatsApp BSP / Meta** | Approved templates, opt-in, quality rating, conversation pricing | M | Template approval lifecycle |
| **Courier** | Shipping rates and tracking for skincare reorders | C | Yes |
| **Regulators** | Kemenkes/SATUSEHAT (RME interoperability), Dinkes (licence, reporting), BPOM (product notification), DJP/Coretax (e-Faktur), Komdigi (PSE registration), KPDP (UU PDP) | M | PSE registration and UU PDP authority |
| **Insurers / BPJS** | Usually out of scope for aesthetics; BPJS only if the facility is also a Klinik Pratama for general care | C | Decide explicitly |
| **Investors / franchisees** | Cross-branch KPI, royalty, standard SOP compliance | C | Yes (franchise model) |

### 2.2 Clinic-side roles

| Role | Daily job | System needs | Not yet mentioned? |
|---|---|---|---|
| **Owner** | Money, growth, risk | Cash vs earned revenue vs liabilities, margin per treatment after BHP and commission, retention/churn, branch comparison, daily WA digest (Assist `WaNotifs/sendDailyDashboardToWa`) | Daily digest to WA, branch league table |
| **Medical Director / PJ klinik** | Clinical governance | Protocol approval, credential expiry, incident (KTD/KNC) review, chart audit sampling, complication rate, delegation catalog | Chart audit sampling, complication KPI |
| **Clinic manager** | Run the floor | Roster, room/device utilization, approvals queue (refund, void, discount, stock repair), SLA board, staff performance | Void/discount approvals, utilization heatmap |
| **Receptionist / front office** | Check-in, queue, phone/WA | Walk-in registration, duplicate detection, queue number + call display, booking calendar by doctor/room/device, no-show handling, idle lock | Queue call display (Aesta "Screen Antrian", landscape/portrait) |
| **Cashier** | Settle | Multi-tender, deposit, DP, installments, packages, promo/voucher, receipts (print + WA), void with supervisor, shift close | Supervisor PIN for void, per-shift book closing |
| **Beauty consultant (BC) / sales** | Intake + package proposal | Change-only intake, photo capture, proposal simulator, own targets and commission | Sales targets/leaderboard |
| **CS / admin WA** | Conversations | Shared WA inbox, lead status, assignment, quick replies, AI draft with human approval, take-over/hand-back (Kasera) | Yes: whole lead/inbox domain |
| **Doctor** | Assess, decide, document | Unified patient workspace, face map dosing, consent, care plan, e-prescription, letters, OTP/PIN signature, mobile-friendly charting | AI scribe (opt-in, human-signed) |
| **Nurse** | Prep, assist, delegated tasks | Orders, vitals, numbing timer, tray checklist, sterilization/B3 logbooks | — |
| **Therapist / beautician** | Non-medical protocols | Bed timers, protocol steps, BHP confirmation, own schedule and commission | Staff self-service app (Kasera `/stylist/*`) |
| **Pharmacist** | Dispense | Rx verification, blue label, BUD, FEFO, opname, MESO | — |
| **Warehouse / purchasing** | Stock | PO, receipt, transfer between depots/branches, returns to supplier, adjustment with approval | Inter-branch transfer, depot model |
| **Finance / accountant** | Books | Journals, AR/AP, deposits liability, tax, bank/gateway reconciliation, period lock, export to accounting software | Period lock, accounting export |
| **HR / payroll** | People | Attendance (selfie+location), leave, overtime, payroll incl. commission, PPh 21, BPJS TK | Yes: whole HR domain |
| **Marketing** | Demand | Campaigns, segments, promo codes with stats, landing pages, UTM/ad attribution, review requests, birthday flows, dormant reactivation | Yes: segmentation/reactivation/reviews |
| **IT / system admin** | Keep it running | RBAC editor, 2FA, audit log, backups, integrations health, feature flags per branch | Integration health page |
| **Data protection officer (DPO) / compliance** | UU PDP | Records of processing, DPIA, consent ledger, data-subject requests, breach register (3×24h notification) | Yes |
| **Internal auditor** | Fraud & control | Suspicious transactions, struck-through items, overrides, stock variance, refund patterns | Yes |

---

## 3. Black-magic findings (reverse-engineering ledger)

### 3.1 Public front ends of the 20 brands (REA browser scenarios)

| Target | Evidence ID (prefix) | Stack signal (OBS) | Conversion path (OBS) | Tracking/analytics loaded on page (OBS) |
|---|---|---|---|---|
| ZAP booking (`booking.zap.co.id`) | `ev_939ba07fbca3` | Plain HTML + jsDelivr | City → outlet selector | Cloudflare Web Analytics |
| ZAP online booking (`zapclinic.com/en/online-booking`) | `ev_fbb278d0185e` | Laravel Livewire | Location + outlet → "Booking Sekarang"; Qiscus multichannel chat widget | GTM/GA4, Google Ads, Meta Pixel |
| ZAP Premiere | `ev_d5aa06f01da9` | — | WhatsApp link | GTM/GA4, Google Ads, YouTube |
| ERHA Ultimate | `ev_9bbc100abd85` | CloudFront assets; AI search widget from `sarana.ai` (`/api/search-prompts`) | Doctor finder (`/find-doctor/{id}`), clinic finder, WA, ERHA BUDDY app (Play/App Store), "Mulai dari Rp1.650.000" | GTM/GA4, Google Ads, Meta Pixel, Microsoft Clarity |
| erha.co.id | `ev_a280798f7ca4` | HTTP 503 at capture time | — | — |
| DermiesMAX | `ev_b92dac6470390` | Next.js + Strapi CMS (`cms.dermiesmax.co.id/api/dokters`, `/api/dermies/config`) | Doctor cards → "Konsultasi" → Arya Noble Digital Lounge (`connect-digital-lounge-dermies…/verify`) | GTM/GA4, Google Ads, OptiMonk popups |
| Natasha | `ev_a6c57d61a958` | WordPress + custom REST (`/wp-json/natasha/v1/slider`) | "Booking Perawatan" → Hepta CRS form; "CS Online 24 Jam" | GTM/GA4, Google Ads, Meta Pixel, Clarity, **Hotjar**, **Contentsquare** |
| Hepta CRS booking (Natasha) | `ev_8bd90e337121` | jQuery/Select2/Bootstrap 3; outlet list via `/data-outlets/{merchant}`, slots via `/data/cekslot?date&merchant&outlet` | Fields: name, WA, member code, email, branch, date, time, notes ("Keluhan anda") | GA4 ×2, **Microsoft Clarity on the form** |
| Hepta CRS booking (Naavagreen) | `ev_5999f78e4abe` | Same white-label template | Same fields | GA4, Meta Pixel, TikTok Pixel, **Clarity** |
| Naavagreen | `ev_40318b7e1fe0` | WordPress | Hepta booking link, "Chat Sekarang" | GTM/GA4, Meta, TikTok, Clarity |
| SOZO | `ev_fb39d03ad78b` | WordPress | WhatsApp deep links with source tag in text (`[src:ORG-Promo]`), promos (0% installment, first-visit discount, 50% skinbooster) | GTM/GA4 |
| NMW | `ev_5506c2e4191a` | Next.js; first-party event API (`api.nmwclinic.co.id/v2/public/events`) | Doctors → reservation; product store with ratings and strike prices | GTM/GA4 |
| NMW portal (`my.nmwclinic.co.id`) | bundle `0e965bd75387b290` | React SPA; `legacy/*` API | See §3.2 | — |
| Larissa | `ev_c059f2ed07576` | Custom PHP; branch map from `/api/clinics.geojson` (OpenStreetMap tiles) | Member login/register (email+password), cart, WA | GTM, Meta, TikTok |
| Ella | `ev_705f40da6069` | Next.js (`_next/data/.../promo.json`, `produk.json`, `buku-menu-platinum.json`) | Online booking CTA, price menu ("buku menu") | GTM/GA4, Google Ads, Meta, TikTok, Meta CAPI param builder; media served from a bucket named **`ella-staging`** |
| Miracle | `ev_e8cc83ea7c92` | Custom theme | WhatsApp, online store link | GA/GTM, Google Ads, Meta, Clarity, reCAPTCHA |
| MS GLOW Clinic | `ev_fbf6665cabf2` | Custom | WA, "Reservasi sekarang", doctor consult, Skin Analyzer app mention | GA/GTM, Google Ads |
| Esther | `ev_a50d72ce7216` | WordPress + Slider Revolution | Login modal, WA | — |
| Gloskin | `ev_ee0bb54dfecd` | WordPress | Per-treatment WA prefilled messages (Botox, filler, thread lift, hair transplant…), celebrity testimonials | none detected |
| Airin | `ev_97c4a1c6c3c1` | WordPress + Instagram feed embed | Instagram-driven content, "reservasi" in captions, nutrition clinic sub-brand | none detected |
| DNI | `ev_86c9741a90b7` | Next.js | "Booking Konsultasi Gratis" → WA; "harga transparan"; "Lihat Harga" per category | none detected |
| LBC | `ev_fc7280758c7b` | Linktree | ~27 per-branch WhatsApp links | Linktree consent/fingerprint SDKs |
| Athena, Bening's | failed (`ERR_NAME_NOT_RESOLVED` on tried domains) | UNK | UNK | UNK |

**Pattern (INF):** most reachable brands still convert through WhatsApp links or a thin form. Among the captured pages, only ZAP, DermiesMAX (Digital Lounge) and NMW show a real slot-aware booking flow with identity verification. Ad pixels are near universal; server-side conversion signals were visible only at Ella (Meta CAPI parameter builder).

### 3.2 Patient-facing apps (static bundle read)

| App | Bundle SHA-256 prefix | Observed patient routes / capabilities (OBS) |
|---|---|---|
| **DermiesMAX Digital Lounge** (Arya Noble) | `b472361ec097ed8e` | `/self-appointment` (consultation, doctor list/detail, schedule, form, treatment, verification, success), `/registration-*` (doctor, schedule, treatment), `/patient-data-verification`, `/login-with-another-phone-number`, `/ongoing-registration-info`; API `appointment`, `appointment/checkin`, `branch/city`, `category/interest`, `notification/whatsapp/send-otp`, `validate-otp`, `patient/v2`, `patient/v4`, `qiscus/message`, `referral`, `registration/status`; separate `self-payment-dermies` host; reCAPTCHA present |
| **NMW member portal** | `0e965bd75387b290` | Auth (login/register/OTP/verify phone/email, remove-session), appointments (create/cancel/detail/update-image), doctor availability, online consultation (`/consult-create`, `/consult-pay/:id`), prescriptions (`/prescription`, `/prescription-pay/:id`), shop (cart, checkout, products, categories), orders with courier tracking (`kiriminaja/order/tracking`), shipping price, points + history, vouchers (list, redeem, cancel), invoices, addresses, nearby branch, notifications, resumable chunked upload |
| **ClinicHub patient app** (white-label) | `3688a40176202c12` (REA `ev_4fb7d77e8181`) | `/book`, `/checkin`, `/deposit`, `/member`, `/paket`, `/poin`, `/promo`, `/quiz`, `/records`, `/skin`, `/riwayat`, `/insight`, `/assistant`, `/chat`, `/invoice`, `/keamanan`; web push (`/api/patient/push/subscribe`); staff 2FA (`/api/auth/2fa/verify`) |
| **Kasera public booking** | chunks `1qle0xy…` etc. | `api/book/{merchant}/availability`, `bookable-days`, **`hold`** and `hold/{id}` (slot hold), `send-otp`, `verify-otp`, `verification-path`, `owned-packages`, `loyalty-balance`, appointment `cancel`, `reschedule`, `resend-confirmation`, `pay-balance`, `switch-va-bank`, `expire-payment`, public payment status, tip links, `interest-captures` (lead capture when no slot) |
| **Hepta CRS** (Natasha, Naavagreen) | form HTML `908b555be27d9c7e`; script `422e1a245cb06f2f` (REA `ev_148e2324a30c`) | Single form; outlet lookup + slot check; member code free-text; CSRF token present; no visible CAPTCHA or OTP in the static form (INF: server-side controls UNK) |

### 3.3 Clinic-management SaaS — admin system anatomy

#### A. Aesta / Assist.id (largest surface; base `api-aesta.assist.id/api`)

Bundle `9dd7fbfeb83321bc` (Aesta, 32.7 MB main) and `a6c79db6ac4c4d12` (Assist core). UI router paths (OBS): `/registration`, `/registration/antrian/landscape|portrait`, `/rawatjalan`, `/emr`, `/apotek`, `/cashier`, `/office`, `/crm`, `/crm/ikhtisar`, `/crm/message-center`, `/crm/notifikasi-wa`, `/telekonsultasi`, `/accreditation`, `/pks`, `/setting(s)`, `/wizard`, `/recovery`, `/verify`.

Resource groups by domain (OBS, endpoint names abbreviated):

| Domain | Representative endpoints | What it tells us |
|---|---|---|
| Booking & queue | `Janjis/postAppointment`, `postAppointmentFromCounter`, `postManualAppointment`, `reschedule(V2)`, status transitions `pending/confirmed/waiting/engage/succeed/failed`, `getAvgDoctorWaitingTimePerMonth`, `getAvgPharmacyWaitingTimePerMonth`, `PreAppoints/getUnhandleQueue`, `ScreenAntreanConfigs/*`, `JanjiGroups` | Explicit appointment state machine; wait-time KPIs; online pre-appointment inbox; configurable queue display screens; group bookings |
| EMR | `KMrs/*`, `KMrs/{id}/VitalSigns`, `lockEMRForEditing`, `unlockEMR`, `getLockedStatus`, `KFaceMarkers/add`, `KBodyMarkers`, `KEyesMarkers`, `SiteMarkings`, `KTreatments/editFiles`, `Surats/getGeneralConsentUrl`, `Verifikasis/setSignatureV2`, `requestOTP` | Face/body/eye anatomy markers; **pessimistic edit lock on EMR**; general consent via link/upload; **OTP-based signature** ("Tanda Tangan Menggunakan OTP") |
| "Streak" (coret) audit | `*/streak/{id}` on face markers, prescriptions, referrals, nursing care, site markings, treatment results; report "Laporan Coret Tindakan" with `createdBy` / `streakedBy` filters | Clinical items are struck through, not deleted, and reportable by who recorded vs who struck |
| Fraud signals | `KTxes/getSuspiciousTransactions`, `KMrs/getSuspiciousStreakedPrescriptionsProceduresMR` | Built-in suspicious-activity reports for transactions and struck clinical items |
| Approvals | `KApprovals/authenticate` (password), `toggleApproval`, flags `isVoidApproval`, `isRepairObatApproval`, `isRepairBHPApproval`, `isRepairDepotApproval`, `isRestockReturnApproval`; "Manajemen Approval" | Supervisor credential required for void, stock repair, depot repair, restock/return |
| Cashier & finance | `KTxes/pay`, `payPOS`, `cancelPayment`, `addNewInvoice`, `Billings/multiTerminPay`, `previewDiscount`, `requestInvoiceWa/Sms`, `KTxAccounts/transfer`, `Ledgers/getList`, `getAccountBalance`, `getDebtCreditNew`, `DigitalPayments/*` (pay-link via WA), `MetodePembayarans/getPriceOfItem` (price per payment method), `KConfigs/*TaxFee`, `upsertBiayaAdmin` | Installment (termin) payments; per-payment-method pricing; admin fees; internal accounts and transfers; ledger per channel (patient, pharmacy, OTC, office) |
| Packages | `KPacketProcedures`, `KOwnedPacketProcedures/getAlmostExpiredPacket(V2)`, `KRequestRefundPacketProcedures/requestRefund|approveRefund`, `PacketProcedures/packet-usage-list|procedure-usage-list` | Package templates vs owned packages; near-expiry list; request/approve refund |
| Inventory | `KMedicineStocks/*`, `KAKHPStocks/*` (alkes/BHP), `KStockDepots/mutasi`, `KTxPharmacies/restock|return`, `KTxes/acceptPurchaseOrder`, `stockCorrection`, `perItemStockCorrection`, `repairStockOpname`, `auditMedStock`, `getAlmostExpired*`, `isBarcodeExists`, `MedicineStockPackages`, GPOS distributor mapping | Multi-depot (gudang, apotek, room) with transfers; barcode; PO acceptance from a distributor marketplace; audit and repair flows |
| Commission & payroll | `Payrolls/calculatePacketCommission`, `calculateProcedureCommissionV2`, `generatePayrollOnClick`, `pay`, `PayrollData`, `KProcedures/checkCommissionValidityAgainstMRData`, `KConfigs/recalculateAccountCommissionData`, `setKerjaaPayroll`, `Absences/staff`, `Externals/attendances`, `shift-organization`, `summary-attendance`, `Halangans` (doctor absence) | Commission validated against what the EMR actually recorded; payroll run; attendance via an HR partner; doctor unavailability |
| CRM & messaging | `BlastBroadcasts/send-promo|send-custom|template|patient-age-ranges`, `BroadcastHistories`, `WaReports/getReminderWaReport`, `WaNotifs/zesta-scenarios`, `sendDailyDashboardToWa`, `KSmses`, `PointRewards/*`, `Promoes/check`, `DigitalCards`, `QuickSurvey`, "Laporan Survei Kepuasan" | Segmented broadcast by age range; WA scenario automation; owner daily digest via WA; digital member cards; satisfaction survey |
| AI | `Externals/openAI/soap`, `openAI/prescription`, `openAI/generateICD9CM`, `KDiagnoses/askAI`, `FeedbackAIs`, `KConfigs/ai-vera-status` | LLM drafting of SOAP notes, prescriptions and procedure codes, with a feedback loop (INF: human sign-off model UNK) |
| Integrations | `SatuSehats/*` (organization, location, KYC URL, resend), `CapaianSatuSehat`, BPJS PCare/VClaim/Antrol, Prodia lab, `TelekonsultasiRmes` | National interoperability and lab referral |
| Configuration & RBAC | `KConfigAccounts/inviteMember|importStaffs|informUserHakAksesChanged|setNewFeatureFlag`, `KDictionaries/{id}/getRoleAction`, `FormatCodeMr`, `FormatCodeMedicineStock`, `KConfigTemplateBillings|Reports`, "Margin Harga Jual BHP", "Jumlah Bulan DP Expired", `isBackdate` | Custom role/action dictionary; per-tenant numbering formats; billing/report templates; BHP margin rule; deposit expiry months; **backdating as a config flag** |
| Reports (89 named) | Omset daily/weekly/monthly/yearly, Tutup Buku (also **per shift**), Margin Obat/BHP, Biaya Penggunaan BHP, Mutasi, Opname, Adjustment, Persediaan, Asset Obat/BHP, Komisi Poin, Fee Seller Product, Top Treatment, Pasien Spending/Visit Terbanyak, Kunjungan Baru vs Lama, Rata-rata Waktu Tunggu Apotek, Waktu Pendaftaran, Coret Tindakan, Rekap EMR, Survei Kepuasan, Tenaga Medis Berhalangan | The breadth owners expect from a mature product |

#### B. Kasera (salon/clinic SaaS; base `api.kasera.id`; Next.js + PostHog + Sentry)

Merchant API (OBS): appointments (`cancel`, `no-show`, `refund`, `reschedule-preview`, **`restore`**, change `space`/`staff`/`customer`, `quick-add/parse` = natural-language quick add, `stats`), `attendance/entries` + `overtime-exclusions`, `business-hours`, `closures` (holidays), `space-types/{id}/spaces` + `spaces/occupancies/{id}/release` (rooms/beds), `team/{id}/working-hours|date-hours|time-off`, `staff-services` (who can do what), `services/{id}/components|materials|variations` (recipe/BHP and variants), `inventory/{id}/adjust`, `clients/{id}/notes` with **hide** (not delete) for notes and attachments, `clients/{id}/packages|loyalty/adjust`, `clients/import`, `settings/duplicate-phone-check`, `commission-rules` (+ `reorder`, **`test`**), `commissions/mark-paid`, `commission-payout/release-now`, `payout-settings`, `payout-fee-settings`, `refunds/pending`, `payment-intents/{id}/mark-refunded`, `offline-refusals`, `leads-waiting` (+ dismiss), `campaigns/preview`, `promotions/{id}/codes|stats`, `loyalty/catalog|rules|settings|switch`, `taxes` (+ order), `team-access`, `team/join-tokens`, `locations/{id}/deletion-preview`, **`whatsapp-booking/conversations/{id}/take-over|hand-back|close|send`**, `whatsapp-credits/purchase`, `onboarding/price-list/extract` (AI extraction from a price list photo), `onboarding/checklist`, `billing/seats|tier`.
POS: `pos/bookings/{id}/checkout`, `pos/quick-sale`, `pos/promotions/preview`, `pos/payment-fees`, `pos/loyalty/catalog`, `points-reward/release`.
Staff self-service: `stylist/my-schedule` (+ time-off, toggle bookings), `my-services`, `my-stats`, `payouts/balance|cash-out`, `tips/balance`, `tip-link`, `transactions/{id}/send-receipt|whatsapp-link`, notification preferences.
UI labels (OBS): "Wajibkan deposit saat booking", "Slot direservasi selama", "Batas waktu penjadwalan ulang", "Booking rombongan", "Override Komisi", "Tanpa komisi", "Pembayaran komisi otomatis", "Deposit dikembalikan penuh / tidak dikembalikan", "Biaya pilih staf".

#### C. ClinicHub (white-label; `app.clinichub.id`)

Admin labels (OBS): Dashboard, Appointments, Finance, Master Data, Live Chat, **Audit Log**, Provider Scorecard, Rating Trend, Repeat rate, Referral rate, At Risk, Average visits, Collection Rate, Closing rate, Average ticket, Buying Power, Doctor occupancy, **Cash Cow / Question Mark** (treatment portfolio matrix), Source tag, Campaign Overview, Birthday Promo, Broadcast Report, Low stock, Tukar Treatment (treatment exchange), Simpan Resep (BHP recipe), Tandai Lunas, "Inactive patients and their transaction value", Generate Report (AI, on demand).

#### D. Klinik Pintar RME and Hepta CRS admin

Login shells only (`/client/login`, `/hc/me`; Hepta: Metronic theme + `/api/quick_search.php`). Little to learn statically; listed for completeness.

#### E. Documented (not reverse-engineered) features worth noting

- ICONIX: 5-level membership auto-upgrade, 3-level commission (Standar/Senior/Spesialis), room & bed availability, before/after photos visible to doctors only (max 10 per visit), branded patient app add-on, attendance with selfie + location, payroll with PPh 21 and BPJS, daily owner email, material-priced treatments (thread lift = threads + anaesthetic).
- Aoikumo (Malaysia): Google review management that filters negative feedback internally first, package sharing with live cross-branch redemption, 3-level unit conversion for drugs, webstore with freight calculation, staff app with clock-in and live commission, ISO 27001.
- Zenoti (global): AI receptionist for missed calls, AI scribe, guided photo capture, memberships, kiosk check-in, gift cards and referrals.
- Bee Clinic, Kasera: 14-day trials; pain points = manual commission errors, untracked remaining sessions, stock blind spots, slow P&L.

---

## 4. Complete module taxonomy (what a full system contains)

Status column compares against kliniknuma planning docs on disk: **✔** covered (REQ/TASK exists), **◐** partial, **✘** absent (0 hits in PRD/PLAN/TASKS/DESIGN/DECISIONS/ARCHITECTURE).

### 4.1 Public front end (marketing + conversion)

| # | Module | Must-have behaviour | Seen at | kliniknuma |
|---|---|---|---|---|
| P1 | Home with concern-based discovery | Concern → treatment → price range → book | ERHA, Ella, DNI | ✔ REQ-001 |
| P2 | Treatment detail pages (one URL per treatment) | Who performs (doctor/therapist), downtime, sessions, contraindications, price "mulai dari", FAQ, booking CTA | DermiesMAX, DNI, SOZO | ✘ (no treatment page route/spec) |
| P3 | Doctor directory + profile | Name, title, SIP, branch, schedule, interests, book with this doctor | ERHA `/find-doctor/{id}`, DermiesMAX | ◐ (homepage doctor grid only) |
| P4 | Branch/location pages | Address, map, hours, parking, phone/WA, services available at that branch | Larissa geojson, Natasha list | ✘ |
| P5 | Price list / "buku menu" | Transparent ranges, versioned, tax-inclusive | Ella, Natasha, DNI | ◐ |
| P6 | Promo pages with T&C and quota | Claim → booking with price lock | SOZO, Natasha, ZAP | ✔ REQ-002 |
| P7 | Skin quiz | Non-diagnostic, red-flag routing | ClinicHub `/quiz`, kliniknuma | ✔ REQ-004 |
| P8 | Articles / education | Medical review stamp, author, date | NMW, ClinicHub | ✘ |
| P9 | Testimonials / reviews | Verified-visit, consent-scoped | Gloskin, Ella | ✔ REQ-003 |
| P10 | Booking widget | Slot-aware, resource-aware, OTP, deposit, hold TTL | ZAP, Kasera, DermiesMAX | ✔ REQ-005 (hold TTL ◐) |
| P11 | Click-to-WhatsApp with source tag | Prefilled message containing `src` for attribution | SOZO `[src:ORG-Promo]`, Gloskin | ✘ |
| P12 | Live chat widget | Routed to the same inbox as WA | ZAP (Qiscus), Natasha | ✘ |
| P13 | E-commerce for OTC skincare | Cart, shipping, payment, BPOM number per product | NMW, Miracle, Larissa | ◐ (reorder only) |
| P14 | SEO foundation | Unique titles/meta, canonical, sitemap, robots, `MedicalClinic`/`Physician`/`Service`/`FAQPage`/`BreadcrumbList` JSON-LD, Google Business Profile links | none did this well | ✘ (0 hits) |
| P15 | Consent-aware tracking | Consent banner, GA4 + Google Ads Consent Mode v2, Meta Pixel + CAPI and TikTok Events API with `event_id` dedup, server-side Purchase/Lead | Ella (CAPI builder) | ✘ (0 hits) |
| P16 | Legal pages | Privacy policy (UU PDP), terms, cancellation/refund policy, medical disclaimer | NMW | ◐ |
| P17 | Accessibility and performance | WCAG 2.2 AA, LCP < 2.5 s on 4G | — | ✔ UI rules |

### 4.2 Patient portal / app

| # | Module | kliniknuma |
|---|---|---|
| A1 | WA OTP login, session management (remove other sessions) | ✔ REQ-006 |
| A2 | Appointments: book, reschedule, cancel, check-in (QR or link) | ✔ / ◐ self check-in |
| A3 | Packages per service, deposit balance, points, tier, vouchers | ✔ |
| A4 | Receipts and invoices list | ✔ UX-15 (TASK-038) |
| A5 | Care plan, condition progress, comparable photos, routine | ✔ |
| A6 | Remote check-in / complication report | ✔ REQ-018/029 |
| A7 | Reorder skincare + shipping/courier tracking | ◐ (no courier) |
| A8 | Online consultation (paid) + e-prescription payment | ✘ |
| A9 | Referral code and reward | ✘ |
| A10 | Review request after visit (Google) | ✘ |
| A11 | Web push / WA notification preferences | ◐ |
| A12 | Data-subject self-service: download my data, request correction, withdraw consent, delete marketing data | ◐ consent withdrawal only; access/portability/erasure ✘ |

### 4.3 Staff/admin system — full module list

| # | Domain | Modules | kliniknuma |
|---|---|---|---|
| S1 | Front office | Walk-in registration + duplicate check; queue numbers; **queue call display screen** (TV, landscape/portrait); check-in; live board; idle lock | ✔ board, TASK-037 registration; ✘ queue display/call |
| S2 | Scheduling | Practitioner roster (working hours, date overrides, time off), business hours, **closures/holidays**, rooms/beds/devices, staff-service capability matrix, group booking, **waitlist**, slot hold TTL, no-show/restore | ✔ roster TASK-037, resources REQ-005; ✘ waitlist, closures, group booking, restore |
| S3 | CRM & leads | **Shared WA inbox**, lead pipeline (new → contacted → booked → visited → lost), assignment, quick replies, AI draft with human send, take-over/hand-back, lead source tags, leads waiting for a slot | ✘ entire domain |
| S4 | Marketing automation | Segments (age, last visit, spend, treatment), campaigns with preview and frequency cap, promo codes with stats, birthday, **dormant reactivation (>90 days)**, review requests, referral, gift cards/vouchers | ◐ CRM schedule REQ-018; ✘ segments/campaigns/referral/gift/review |
| S5 | Clinical | Unified workspace, intake, face/body/eye map, consent, care plan, e-Rx, letters, signing (PIN/OTP), **EMR edit lock**, strike-through instead of delete, templates per treatment, AI scribe (opt-in) | ✔ (exceeds market); ◐ edit lock; ✘ AI scribe |
| S6 | Treatment room | Timers, checklists, BHP confirmation, device shot counter, sterilization logbook | ✔ |
| S7 | Pharmacy & inventory | Rx queue, blue label, BUD, FEFO, opname (blind), **multi-depot (warehouse/pharmacy/room) and inter-branch transfer**, PO/receipt, return to supplier, barcode, near-expiry, recall | ✔ most; TASK-039 purchasing; ✘ inter-depot/branch transfer, supplier return, barcode |
| S8 | Cashier & POS | Single visit, packages, deposits, DP/installments, split tender, per-method fees, promo/voucher/points, receipts print+WA, **void with supervisor approval**, **manual discount approval**, quick sale (OTC), tip, shift close | ✔ most; TASK-038 receipt + shift; ✘ void/discount approval, tip |
| S9 | Finance | Double-entry journals, deposit/package liability, AR/AP, gateway settlement reconciliation, bank reconciliation, **period lock / book closing**, tax (PPN, Coretax export), accounting export (Jurnal.id/Accurate/Xero CSV) | ✔ journals; ◐ e-Faktur; ✘ period lock, settlement/bank reconciliation, accounting export |
| S10 | Commission | Rules engine (seller/executor/assistant, % or fixed, tiers), **rule test/simulation**, overrides with reason, validation against EMR, payout run and mark-paid | ✔ engine; ✘ rule simulation, payout run |
| S11 | HR | Attendance (selfie+geofence), leave, overtime, payroll incl. commission, PPh 21, BPJS TK/Kes, credential expiry (STR/SIP), training/SKP | ✔ credentials; ✘ attendance/payroll |
| S12 | Staff self-service | My schedule, my clients today, my commission/tips, time-off requests, notification preferences | ✘ |
| S13 | Quality & safety | Incident register (KTD/KNC/KTC/KPC/sentinel), complaints SLA, satisfaction survey, chart audit sampling, device calibration, B3 waste | ✔ logbooks; ✘ survey, chart audit |
| S14 | Control & audit | Audit log viewer, **suspicious-activity reports** (voids, refunds, overrides, struck items, stock variance), maker-checker queue, break-glass log | ✔ maker-checker, break-glass; ✘ suspicious reports, audit viewer UI |
| S15 | Reporting & BI | Owner dashboard, branch comparison, provider scorecard, utilization (doctor/room/device), treatment portfolio matrix, cohort retention, LTV, acquisition by source, wait-time KPIs | ◐ owner dashboard; ✘ scorecard, utilization, portfolio, cohorts |
| S16 | Configuration | Catalog versioning, policy register, numbering formats, receipt/report templates, feature flags per facility, RBAC editor | ✔ strong |
| S17 | Integrations | SATUSEHAT, payments, WA BSP, email, courier, accounting, Google Business Profile, ad platforms CAPI | ◐ |
| S18 | Multi-branch | Org/facility tenancy, cross-branch patient record policy, cross-branch package redemption, stock transfer, branch pricing | ✔ tenancy DEC-013/015; ✘ transfer, branch pricing UI |
| S19 | Platform | 2FA, idle lock, backups/restore drill, observability, data residency, PSE registration | ✔ / OQ-8 open |
| S20 | Compliance (UU PDP) | Records of processing (ROPA), DPIA, DPO, consent ledger, data-subject request queue with SLA, breach register + 3×24h notification workflow, vendor processing agreements, retention schedule | ◐ consent + retention; ✘ DSR queue, breach workflow |

---

## 5. Gaps (celah)

### 5.1 Market gaps — what nobody in the examined set does well

1. **Price transparency + "who performs it" disclosure** on treatment pages. Only DNI and partly Ella/Natasha publish prices; nobody states doctor vs therapist per treatment publicly.
2. **Clinical-to-commercial integrity**: suspicious reports exist (Aesta), but none link dose actually executed → billed → stock deducted → commission as strictly as kliniknuma REQ-014/015.
3. **Comparable progress tracking** (baseline/progress with photo comparability). Vendors offer "skin score" trends (ClinicHub 72/100 +6). That is a marketing number, not a validated scale.
4. **Privacy by design on public forms**: session-replay scripts run on booking forms collecting identity and complaints.
5. **UU PDP data-subject rights** are absent from every product page reviewed.
6. **WhatsApp as a system of record**: most brands route conversions to dozens of personal WA numbers (LBC ~27 links). Lead loss and no attribution follow (INF).
7. **SEO and AI-search readiness**: no brand surveyed exposes structured data for clinics/physicians/services (P14). Low competition here.

### 5.2 kliniknuma gaps (from §4 status, ranked by impact on a pilot)

| Rank | Gap | Why it matters for a pilot | Suggested owner |
|---|---|---|---|
| G1 | **Lead & WA inbox domain** (S3) | WhatsApp is the dominant conversion path in the captured brands (INF from §3.1, not measured as a share); without it the booking/quiz funnel is measured but the WA funnel is invisible | New TASK; `admin-product-ux` first |
| G2 | **Void and manual-discount approvals + suspicious-activity report** (S8, S14) | Most common front-desk fraud vectors; every mature product has them | Extend TASK-038 |
| G3 | **Period lock / tutup buku per shift and per month** (S9) | Without a lock, closed months can change silently | Extend TASK-038 |
| G4 | **Queue numbers and call display** (S1) | Walk-in floor control; patients expect it | Small task; reuses board |
| G5 | **Closures/holidays, waitlist, appointment restore, group booking** (S2) | Real calendars need holidays; waitlist recovers cancellations | Extend TASK-037 |
| G6 | **Public growth surface** (P2–P4, P8, P11, P14, P15) | Treatment/doctor/location pages + schema + consent-aware CAPI are what make paid and organic traffic work | `seo-website-builder`, signal-engine skills |
| G7 | **UU PDP rights + breach procedure** (A12, S20) | Legal exposure; the clinic processes health data (specific personal data) | Privacy owner; extend OQ-6/OQ-7 |
| G8 | **Inter-depot/branch stock transfer and supplier return** (S7) | Needed as soon as a second depot (room stock) or branch exists | Extend TASK-039 |
| G9 | **Staff self-service + payroll/attendance** (S11, S12) | Commission transparency reduces disputes; payroll can be exported to an HR partner instead of built | Decide build vs integrate |
| G10 | **Reporting depth** (S15): provider scorecard, utilization, treatment portfolio, cohorts | Owner value | TASK-036 extension |
| G11 | **Commission rule simulation + payout run** (S10) | Owners test a rule before activating it (Kasera `commission-rules/test`) | Extend TASK-019 |
| G12 | **Accounting export + gateway/bank reconciliation** (S9) | The accountant otherwise re-keys everything | Later |
| G13 | **Online consultation and courier shipping** (A7, A8) | Revenue line for chains (NMW, ERHA); can wait | Later |

---

## 6. Guards (what to enforce), with the observed anti-pattern each guard prevents

### 6.1 Security and platform

| Guard | Rule for our build | Anti-pattern observed (OBS/INF) |
|---|---|---|
| G-SEC-1 Role-split bundles | Code-split admin modules by route and role; the login page must ship only the login code. Never put the full admin API map in an anonymous bundle | Aesta/Assist ship 558/775 endpoint paths plus every report and approval toggle to unauthenticated visitors (OBS) |
| G-SEC-2 No client-built queries | The server builds every query from typed parameters; tenant/facility scope comes from the session, never from the client | Client constructs `{"where":{"hospitalId":…}}` filter JSON for list endpoints (OBS); server-side scoping UNK |
| G-SEC-3 Supervisor credential ≠ shared password | Approvals use the approver's own account with step-up (PIN/OTP/passkey), are attributed, and are rate-limited | Approval by posting a password to `KApprovals/authenticate` (OBS); whether it is per-user or shared is UNK |
| G-SEC-4 Backdating is an approval, not a config | Back-dated clinical or financial entries require reason + second approver + audit; never a tenant-wide toggle | `isBackdate` configuration flag (OBS) |
| G-SEC-5 Staging never serves production | Separate buckets, keys and domains per environment; CSP restricts production to production origins | Production site loads testimonial videos and coupons from `ella-staging` bucket (OBS) |
| G-SEC-6 Bot and abuse control on public forms | Turnstile (or equivalent) + per-phone/IP rate limits + OTP before a slot is committed; slot holds expire | Hepta form shows no CAPTCHA/OTP in static markup (OBS; server controls UNK). Kasera uses hold + OTP + verification path (OBS) |
| G-SEC-7 Error budget for availability | Health checks, status page, 5xx alerting | `erha.co.id` returned 503 during capture (OBS, single sample) |
| G-SEC-8 Staff auth | 2FA for staff, idle lock on shared desks, session list with remote sign-out | ClinicHub 2FA, NMW `remove-session` (OBS); kliniknuma has idle lock ✔ |
| G-SEC-9 Secrets in the client | Only publishable keys in bundles; scan builds for secrets in CI | Only public-type keys found (Firebase web key, reCAPTCHA site keys) (OBS) |

### 6.2 Privacy (UU PDP; health data is specific personal data under Pasal 4)

| Guard | Rule |
|---|---|
| G-PDP-1 No session replay on PHI forms | Do not load Clarity/Hotjar/Contentsquare on booking, intake, quiz-result, member or staff pages; if used on marketing pages, mask all inputs and exclude those routes. Observed: Clarity on Hepta booking forms (name, WA, complaint), Hotjar + Contentsquare + Clarity on Natasha (OBS) |
| G-PDP-2 Pixels never receive health data | Ad events carry only event name, value, currency, hashed email/phone with consent; never the treatment concern, complaint text or diagnosis in URL, title or parameters |
| G-PDP-3 Consent before marketing trackers | Consent Mode v2 default-denied for ads/analytics storage; Meta/TikTok only after consent; server-side events honour the same consent |
| G-PDP-4 Purpose separation | Transactional/clinical WA vs marketing WA (kliniknuma REQ-018 ✔) |
| G-PDP-5 Data-subject requests | Queue with identity verification, statutory deadlines, export in a portable format, correction workflow, erasure limited by medical-record retention |
| G-PDP-6 Breach workflow | Register, severity triage, notify the data subject and the authority within 3×24 hours (UU PDP Pasal 46; verify current implementing rules), evidence retention |
| G-PDP-7 Residency and processors | Record where data and backups live (OQ-8: Singapore VPS needs a cross-border basis), DPAs with WA BSP, payment, email and analytics vendors |
| G-PDP-8 Photos | Clinical photos private, short-lived URLs, metadata stripped (kliniknuma ✔); marketing use only with separate consent and scope |

### 6.3 Clinical integrity

- G-CLI-1 Strike-through, never delete (Aesta pattern; kliniknuma append-only versions ✔). Add a "struck by vs recorded by" report.
- G-CLI-2 Edit lock or optimistic concurrency on the open chart (Aesta pessimistic lock; kliniknuma optimistic version conflict ✔). Show who holds the chart.
- G-CLI-3 AI drafts are drafts: AI-generated SOAP/Rx/ICD text is labelled, needs explicit clinician acceptance, never auto-signs, and never sends PHI to a vendor without a DPA and a lawful basis. Market precedent exists (Assist `openAI/soap`, `prescription`, `generateICD9CM`).
- G-CLI-4 No efficacy percentages from package usage or vendor "skin scores" (kliniknuma ✔). Avoid copying ClinicHub-style 0–100 skin scores unless the method is validated and versioned.
- G-CLI-5 Signature strength: PIN/OTP signatures bound to the record hash; consider PSrE certified e-signature for consent if counsel requires it.
- G-CLI-6 Delegation: therapist never on invasive/energy/prescription items (kliniknuma ✔).

### 6.4 Financial integrity and fraud

| Guard | Rule |
|---|---|
| G-FIN-1 Void/cancel after payment needs a second person and a reason code; reported daily |
| G-FIN-2 Manual discount above a threshold needs approval; discounts reported per cashier |
| G-FIN-3 Commission validated against executed EMR quantities (Aesta `checkCommissionValidityAgainstMRData`; kliniknuma execution snapshot ✔) |
| G-FIN-4 Suspicious-activity report: voids, refunds, overrides, struck items, after-hours transactions, stock variance per user |
| G-FIN-5 Period lock: closed shift/day/month is immutable; corrections post as adjustments in the open period |
| G-FIN-6 Deposit and package liabilities are liabilities until earned; expiry (breakage) follows written policy with reminders (kliniknuma ✔) |
| G-FIN-7 Per-payment-method pricing (Aesta `getPriceOfItem`) must be disclosed before payment; surcharges follow card-network and BI rules (verify) |
| G-FIN-8 Gateway webhook idempotency + daily settlement reconciliation |

### 6.5 Advertising and publication (Permenkes 1787/2010 and kliniknuma OQ-3)

- Medical-procedure discounts, before/after imagery in paid ads, and testimonials need the approved publication policy (kliniknuma readiness gate ✔). Many observed brands advertise "Diskon 50% Skinbooster", celebrity testimonials and cure-like claims (OBS). That is common practice, not proof of legality; follow counsel, not competitors.
- No "Buy Now/Shop Now" CTA in product descriptions or meta (house rule).

---

## 7. Public front end — detailed requirement set

1. **Information architecture**: `/`, `/perawatan` (by concern + by category), `/perawatan/{slug}`, `/dokter`, `/dokter/{slug}`, `/klinik` (branches), `/klinik/{slug}`, `/harga`, `/promo`, `/promo/{slug}`, `/artikel`, `/artikel/{slug}`, `/quiz`, `/booking`, `/member`, `/kebijakan-privasi`, `/syarat-ketentuan`, `/kebijakan-pembatalan`.
2. **Treatment page contract**: problem solved, who performs it (doctor/nurse/therapist), duration incl. numbing prep, downtime, typical sessions and interval, contraindications summary, price "mulai dari" + what changes the price, FAQ, nearest branches offering it, booking CTA, medical-review stamp with doctor name and date.
3. **Doctor page contract**: name and titles, SIP number and branch, schedule, focus areas, languages, booking with this doctor.
4. **Branch page contract**: NAP (name/address/phone) consistent with Google Business Profile, map, hours incl. holidays, facilities (parking, mushola), doctors on duty, services available.
5. **Conversion paths**: (a) slot-aware booking with WA OTP; (b) click-to-WhatsApp with a prefilled message containing a source tag, landing in the shared inbox; (c) quiz → booking; (d) promo claim → booking with price lock; (e) "notify me when a slot opens" lead capture (Kasera `interest-captures`).
6. **Structured data**: `MedicalClinic` (or `MedicalBusiness`) per branch with `openingHoursSpecification`, `Physician` per doctor, `Service`/`MedicalProcedure` per treatment with `offers.priceSpecification` ranges, `FAQPage`, `BreadcrumbList`, `Article` with `reviewedBy`. Validate with Rich Results Test (owner: `seo-website-builder`).
7. **Measurement**: GA4 + Google Ads with Consent Mode v2; Meta Pixel + CAPI and TikTok Pixel + Events API deduplicated by `event_id`; server-side `Lead` (verified booking or WA lead) and `Purchase` (paid invoice) events; `gclid/gbraid/wbraid/fbclid/ttclid` stored on the lead with consent (owners: `google-ads-signal-engine`, `meta-ads-signal-engine`, `tiktok-ads-signal-engine`).
8. **Performance and accessibility**: static rendering for content pages, island hydration for booking only, LCP < 2.5 s on mid-range Android over 4G, WCAG 2.2 AA, `id-ID` first with optional `en`.
9. **Trust**: SIP/STR shown, BPOM numbers on products, facility licence number, verified reviews, transparent cancellation/deposit terms before payment.
10. **AI search readiness**: crawlable answer-style FAQ per treatment, explicit `robots`/AI-crawler policy decision (owner: `ai-traffic-os`).

---

## 8. Things not mentioned yet (checklist for the next decision round)

- [ ] Lead/WA shared inbox, assignment and AI-draft policy
- [ ] Queue number + TV call display
- [ ] Holidays/closures calendar, waitlist, group booking, appointment restore
- [ ] Void and discount approvals, suspicious-activity report, period lock
- [ ] Tip handling (salon-style; probably off for medical)
- [ ] Gift cards / prepaid vouchers sold to third parties (liability + expiry rules)
- [ ] Referral programme and KOL/affiliate attribution + payout
- [ ] Google review request loop (with negative-feedback interception policy — check consumer-protection and platform rules before filtering)
- [ ] Satisfaction survey (NPS/CSAT) after visit
- [ ] Online consultation (teleconsult) and paid e-prescription
- [ ] Courier shipping for skincare reorders
- [ ] Staff self-service app (schedule, time-off, commission, tips)
- [ ] Attendance + payroll (build vs integrate with an HR SaaS)
- [ ] Inter-depot and inter-branch stock transfer; supplier returns; barcode scanning
- [ ] Accounting export and bank/gateway settlement reconciliation
- [ ] Provider scorecard, utilization heatmaps, treatment portfolio matrix, cohort retention, LTV
- [ ] Owner daily digest via WA/email
- [ ] Corporate/group invoicing
- [ ] Foreign patients (passport ID, English UI)
- [ ] UU PDP: ROPA, DPIA, DPO appointment, DSR queue, breach workflow, processor agreements, PSE registration at Komdigi
- [ ] Public growth surface: treatment/doctor/branch pages, structured data, consent-aware tracking, Google Business Profile sync
- [ ] Data migration/import from the clinic's current tool (clients, packages, deposits, stock) — every vendor sells onboarding migration
- [ ] Offline/degraded mode policy for the front desk when internet drops
- [ ] Hardware: thermal printer (58/80 mm), label printer, barcode scanner, tablet for consent, TV for queue display
- [ ] Training, SOP library and in-app onboarding checklist (Kasera/Aesta coachmarks)

---

## 9. Mapping to kliniknuma (proposal only; repository not modified)

Repository state on disk (2026-10-29): TASK-001–029 engines exist; TASK-031/032 live on PostgreSQL; TASK-033/035 landed but not accepted; TASK-034/036 queued; TASK-030 reopened; TASK-037–041 planned (registration/roster, receipts/shift close, purchasing, hosting, browser sweep). The worktree has uncommitted changes from other work, so any edit there needs a separate, explicit go-ahead.

| Candidate | Scope | Depends on | Skills to route |
|---|---|---|---|
| TASK-042 Lead & WhatsApp inbox | Lead entity + lifecycle, WA BSP webhook inbox, assignment, source tags, human take-over, link lead → patient → booking | TASK-020, OQ-1a | `admin-product-ux`, `admin-dashboard`, `application-security` |
| TASK-043 Front-desk controls | Void/discount approvals, suspicious-activity report, shift/day/month period lock | TASK-038 | `admin-product-ux`, `postgres-drizzle`, `testing-engineering` |
| TASK-044 Queue display & calendar completeness | Queue numbers, TV call display, closures/holidays, waitlist, appointment restore, group booking | TASK-037 | `admin-product-ux` |
| TASK-045 Public growth surface | Treatment/doctor/branch/article pages, JSON-LD, sitemap/robots, click-to-WA with source tag | TASK-033 | `seo-website-builder`, `design-taste`, `ui-validation` |
| TASK-046 Consent-aware signal engine | Consent banner, Consent Mode v2, CAPI/Events API with dedup, server-side Lead/Purchase | TASK-045, TASK-008 | `google-ads-signal-engine`, `meta-ads-signal-engine`, `tiktok-ads-signal-engine` |
| TASK-047 UU PDP rights & breach | DSR queue, export/correction, breach register and notification workflow, ROPA evidence upload | OQ-6/OQ-7 | `application-security`, counsel |
| TASK-048 Stock movement completeness | Depot model, inter-depot/branch transfer, supplier return, barcode | TASK-039 | `postgres-drizzle` |
| TASK-049 Analytics depth | Provider scorecard, utilization, portfolio matrix, cohorts, owner daily digest | TASK-036 | `admin-dashboard`, `observability-engineering` |
| Later | Staff self-service, payroll/attendance integration, teleconsult, courier, accounting export, gift cards, referral | — | decide build vs integrate |

These IDs are placeholders; the canonical numbering and acceptance text belong in `TASKS.md` via `prd-taskbreaker` once the owner approves scope.

---

## 10. Reverse-engineering method log (reproducible)

```bash
# Browser scenario (passive, no bodies, no header values)
npx -y rea-agents@6.7.0 capture-browser-scenario rea/<name>.json --format json > rea/<name>.evidence.json
# scenario JSON: browser.mode=launch (Playwright Chromium 1248), start_url.url=<target>,
#   environment {390x844, id-ID, Asia/Jakarta}, actions [wait_for_timeout 4000–6000 ms],
#   capture {at_end:[url, accessibility], events:[network], network:{request_body:false,response_body:false,header_values:false}}

# Static: download only what the login/landing HTML references, then
npx -y rea-agents@6.7.0 analyze-javascript-application "$PWD/bundles/<app>" --format json
# plus literal extraction (extract.py) for routes, endpoint paths, labels and flags
```

Limitations recorded by REA (verbatim themes): event order is receipt order, not causality; no initiator stacks in scenarios; static paths do not prove runtime execution; dynamic or obfuscated expressions may stay unresolved. The REA static worker ran out of heap on the 0.4–33 MB bundles (`resource_constraint`), so endpoint inventories for Aesta/Assist/Kasera/ClinicHub/NMW/Digital Lounge come from deterministic literal extraction over the same files (hashes in §3), not from the REA semantic graph.

Evidence index (REA): airin `ev_97c4a1c6c3c1`, dermies-konsul `ev_97d031cfce61`, dermiesmax `ev_b92dac647039`, dni `ev_86c9741a90b7`, ella `ev_705f40da6069`, erha-home `ev_a280798f7ca4`, erhaultimate `ev_9bbc100abd85`, esther `ev_a50d72ce7216`, gloskin `ev_ee0bb54dfecd`, hepta-js `ev_148e2324a30c`, hepta-naavagreen `ev_5999f78e4abe`, hepta-natasha `ev_8bd90e337121`, larissa `ev_c059f2ed0757`, larissa-login `ev_b24de54ceeef`, lbc `ev_fc7280758c7b`, miracle `ev_e8cc83ea7c92`, msglow `ev_fbf6665cabf2`, naavagreen `ev_40318b7e1fe0`, natasha `ev_a6c57d61a958`, nmw `ev_5506c2e4191a`, nmw-reservasi `ev_18f97b259f66`, sozo `ev_fb39d03ad78b`, zap-booking `ev_939ba07fbca3`, zap-online-booking `ev_fbb278d0185e`, zap-premiere `ev_d5aa06f01da9`, clinichub static `ev_4fb7d77e8181`. Failed: athena, benings (DNS).

---

## 11. Unknowns and next steps

**Unknowns**
- Server-side authorization, tenant scoping and rate limits of every vendor (never tested, by design).
- Which discovered vendor endpoints are live, enabled per clinic, or dead code.
- Internal back-office systems of the chain brands (ZAP, ERHA, Natasha, SOZO, MS GLOW) — not public; only their customer layer was observed.
- Correct domains for Athena and Bening's.
- Exact UU PDP implementing regulation status and timelines; Permenkes 1787/2010 applicability to each promo type (counsel).

**Next steps (pick one)**
1. Authenticated walkthrough of 2–3 SaaS products via their free trials/demos (Bee Clinic, Kasera, Klinik Pintar Mandiri tier) with a HAR captured by the operator, then REA `inspect-web-network-capture` → OpenAPI-style contract notes. Needs your approval to create trial accounts.
2. Turn §9 into formal requirements in kliniknuma (`prd-taskbreaker`), after the owner picks scope.
3. Run `admin-product-ux` on G1 (lead & WA inbox) to produce the screen contract before any code.
4. Build the public growth surface plan (§7) with `seo-website-builder` + signal-engine skills.

---

## 12. Sources

Regulation and context: Permenkes 24/2022 (https://peraturan.bpk.go.id/Details/245544/permenkes-no-24-tahun-2022); Kemenkes RME notice (https://www.kemkes.go.id/id/fasyankes-wajib-terapkan-rekam-medis-elektronik); SE HK.02.01/MENKES/1030/2023 sanctions summary (https://ehealth.co.id/blog/post/sanksi-bagi-faskes-yang-belum-terkoneksi-satusehat-31-juli-2024/); UU 27/2022 PDP (https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022); Permenkes 1787/2010 (https://jdih.kemkes.go.id/storage/documents/pdfs/2010permenkes1787.pdf).

Vendors: ICONIX features (https://www.iconix.id/fcantik.html) and pricing (https://www.iconix.id/hcantik.html); ICONIX manual (https://idoc.pub/documents/tutorial-kecantikan-lengkap-160901pdf-34m22jkrpen6); Bee Clinic (https://beeclinic.id/klinik-kecantikan); Kasera (https://www.kasera.id/untuk/klinik-kecantikan); Aesta (https://assist.id/produk/aplikasi-klinik-kecantikan-aesta); ClinicHub (https://clinichub.id/software-klinik-kecantikan); Klinik Pintar (https://klinikpintar.id/aplikasiklinik/faskes/klinik-kecantikan); Aoikumo (https://www.aoikumo.com/features/); Zenoti (https://www.zenoti.com/platform); ERHA BUDDY (https://play.google.com/store/apps/details?id=id.erha.userapp).

Observed targets: see §3 tables (URLs as captured) and Evidence IDs in §10.
