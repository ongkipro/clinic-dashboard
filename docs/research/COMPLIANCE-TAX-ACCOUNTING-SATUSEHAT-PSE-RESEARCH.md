# Beauty Clinic SaaS — Tax, Accounting, SATUSEHAT and PSE Research

- Date: 2026-11-02 (Asia/Jakarta)
- Status: **research only.** Regulatory summaries, not legal, tax or accounting advice. Each item records the source and how strongly it was verified.
- Decisions: `DECISION-REGISTER.md` (authoritative).
- Context (CONFIRMED): one tenant = one brand = one PT; 1–5 branches; we are the software vendor; WABA via our own Meta Tech Provider status; accounting module if feasible.
- Companion: `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` (§6 accounting draft, §8 open questions).

Verification levels: **TEXT** = article text read in this pass · **OFFICIAL** = official government page/guide summary · **SECONDARY** = law firm, tax media, or vendor summary · **INF** = analysis.

---

## 1. Summary

| Topic | Finding | What it means for the product |
|---|---|---|
| VAT (PPN) | Medical health services are VAT-exempt (PP 49/2022 Pasal 11). DJP's position: beauty clinics are not listed, so their services are taxable. A Supreme Court PK decision (2008 tax period) sided with an aesthetic clinic as a medical facility. | Tax status must be **per item**, with a documented basis. The clinic decides; the system records and applies. |
| PKP status | Mandatory once gross turnover exceeds **Rp4.8 billion** in a book year; voluntary below. | Tenant setting: PKP yes/no + effective date; invoices change when it flips. |
| Income tax (PPh) | PP 20/2026 (promulgated 22 Apr 2026) limits final 0.5% UMKM tax to individuals, single-founder companies and cooperatives. **Ordinary PTs keep it only until their existing PP 55/2022 window ends** (3 tax years from registration). | Most target clinics (PT) will be on general corporate tax → proper books matter more. |
| Accounting framework | SAK EMKM for entities meeting UMKM criteria for 2 consecutive years; otherwise SAK EP (effective 1 Jan 2025). Prepaid packages/balance = contract liability under both (INF for EMKM, TEXT-level summary for PSAK 115). | Accounting module must support liabilities for packages, balance and DP. A 1–5-branch clinic is usually small/medium UMKM by revenue. |
| RME | Mandatory for every health facility since 31 Dec 2023 (Permenkes 24/2022 Pasal 45). Must interoperate with the Ministry platform (Pasal 21) = SATUSEHAT; PP 28/2024 Pasal 781 requires RME integration with the national health information system. | Our product is an **RME system**, not only admin software. SATUSEHAT integration is mandatory, not optional. |
| Vendor duties | A system vendor must (1) be registered as **PSE** with Komdigi (OSS for private entities), (2) register the RME system with the Ministry of Health via the SATUSEHAT portal as "Penyedia sistem RME (mitra)". | Company-level prerequisites before selling to the first clinic. |
| Data location | If a facility stores RME through a partner PSE, that PSE must have **storage in Indonesia** and a Ministry recommendation; the facility keeps unlimited access (Pasal 22). | Host clinical data in Indonesia; contract must guarantee clinic access and export. |
| Corrections | Data errors corrected by the clinician/admin **within 2×24 h of input**; administrative-data errors found later need approval of the medical-records officer and/or facility head (Pasal 30). | Edit window + approval flow; full history kept. |
| Retention | ≥ **25 years** from the patient's last visit (Pasal 39). | Retention policy at the patient level; no hard delete of clinical data. |
| Personal data | UU PDP 27/2022 in force; implementing regulation reported as PP 33/2026 (SECONDARY); supervisory agency reported not yet formed (SECONDARY). | Consent ledger, data-subject requests, breach procedure remain required. |

---

## 2. VAT per treatment and PKP status

### 2.1 Legal basis

| Source | Content | Level |
|---|---|---|
| UU 7/2021 (HPP) | Moved medical health services out of the "non-JKP" list in Pasal 4A(3) UU PPN; they are now JKP that may be exempted | OFFICIAL (DJP via DDTC report) |
| PP 49/2022 Pasal 10 huruf a jo. Pasal 11 | Medical health services exempt from VAT, including services of general practitioners, specialists, dentists; health experts; midwives; paramedics and nurses; **hospitals, maternity homes, health clinics**, laboratories, sanatoria; psychologists, psychiatrists; alternative medicine | OFFICIAL (summaries of the PP text) |
| DJP (Kring Pajak, 22 Aug 2023, reported by DDTC) | "klinik kecantikan merupakan salah satu jasa yang dikenai PPN … Dalam pasal tersebut [Pasal 11 PP 49/2022], klinik kecantikan tidak disebutkan sehingga dikenakan PPN." | SECONDARY quote of an official statement |
| PMK 131/2024 | From 2025: 12% × DPP nilai lain 11/12 → effective 11% for non-luxury taxable supplies | OFFICIAL (DJP) |
| Supreme Court PK (dispute over April 2008 period; Tax Court PUT.59938/PP/M.VA/16/2015 of 5 Mar 2015) | DJP corrected VAT on "penjualan satuan medis", "paket medis", "paket nonmedis". MA rejected DJP's PK: "klinik kecantikan estetika merupakan sarana pelayanan kesehatan yang menyediakan jasa pelayanan medik", so services fell under the old exemption | SECONDARY (DDTC case note). Decided under pre-HPP law. |

### 2.2 How to read it (INF)

1. **Two positions exist.** DJP treats beauty-clinic services as taxable. Case law (old law) accepted medical-facility status. Since HPP and PP 49/2022, the exemption is a list, and "beauty clinic" is not on it. DJP's argument in the dispute was about **purpose**: services for "keindahan" for healthy customers vs treatment of illness.
2. A clinic licensed as a health facility (klinik pratama/utama) that performs **medical treatment** (e.g. acne therapy, dermatitis, infections, scars with medical indication) has a basis to treat those services as exempt medical services. **Purely cosmetic** services (facials, whitening, slimming, cosmetic injections without medical indication) are at clear risk of being taxable.
3. **Products** (skincare, retail) follow goods VAT rules. Prescription medicines may have their own facility rules; this was not researched here.
4. This is a classification decision the **clinic and its tax adviser** make. The system's job is to make the decision explicit, consistent, auditable and changeable.

### 2.3 PKP status (OFFICIAL, pajak.go.id)

- Must register as PKP when gross turnover in a book year **exceeds Rp4,800,000,000**, by the end of the following month.
- Below the threshold: may choose PKP voluntarily; then must charge, pay and report VAT.
- Exempt medical turnover still counts toward gross turnover for the threshold (INF — confirm with adviser).
- A 5-branch clinic can cross Rp4.8 billion/year (≈ Rp80 million per branch per month) (INF).

### 2.4 Product requirements derived

| Requirement | Detail |
|---|---|
| Tax category on every sellable item | `exempt_medical`, `taxable_service`, `taxable_goods`, `non_object` (if any) — default chosen by the clinic, with a note field "basis" |
| Tax category snapshot on each invoice line | Changing the master later does not rewrite history |
| Tenant tax profile | NPWP, PKP yes/no, PKP effective date, invoice numbering; branch NITKU if used |
| Price entry | Price includes or excludes VAT (clinic choice); DPP and VAT computed per line with integer-rupiah rounding |
| Packages | Package price allocated to items (CONFIRMED session-value rule); each allocated part keeps its item's tax category (INF; adviser to confirm VAT timing on prepaid packages) |
| Reports | VAT output per period and branch; exempt vs taxable turnover; export for e-Faktur |
| e-Faktur | Coretax supports manual entry, XML upload, or host-to-host **via a PJAP** (no open public API for direct integration — DJP Coretaxpedia). First step: XML export; PJAP integration later |
| Turnover monitor | Running 12-month gross turnover vs Rp4.8 billion, warning for non-PKP tenants |

### 2.5 Income tax note (OFFICIAL, pajak.go.id, PP 20/2026)

- PP 20/2026 amends PP 55/2022; promulgated and effective **22 April 2026**.
- Final 0.5% now for individuals, single-founder companies (perseroan perorangan) and cooperatives with turnover ≤ Rp4.8 billion.
- **Ordinary PTs** may keep the final 0.5% only until their existing PP 55/2022 period ends (3 tax years from registration).
- Individuals earning from "pekerjaan bebas" including **doctors** are excluded from final PPh.
- Consequence (INF): a PT clinic past its window pays general corporate income tax on profit → it needs a real P&L. This strengthens the case for the accounting module.
- Withholding on doctors' and staff fees (PPh 21/23) is payroll-adjacent. Payroll is out of scope; commission records should still export amounts and recipients for the clinic's tax adviser (PROPOSED).

---

## 3. Accounting framework and module level

### 3.1 Which standard a 1–5-branch PT clinic uses

| Standard | Who | Level |
|---|---|---|
| **SAK EMKM** (SAK Indonesia untuk EMKM) | Entities without significant public accountability that meet UMKM criteria **for at least two consecutive years**, and separate owner and business assets | OFFICIAL (IAI) |
| **SAK EP** (Entitas Privat) | Private entities without significant public accountability; effective for periods beginning 1 Jan 2025; replaced SAK ETAP | OFFICIAL (IAI, IFRS Foundation jurisdiction page) |
| PSAK 115 (formerly 72) | Full SAK; renumbered 1 Jan 2024, substance unchanged | OFFICIAL (IAI) |

UMKM criteria (PP 7/2021 Pasal 35, OFFICIAL summary), by business capital **or** annual sales:

| Class | Capital (excl. land & building) | Annual sales |
|---|---|---|
| Micro | ≤ Rp1 billion | ≤ Rp2 billion |
| Small | > Rp1–5 billion | > Rp2–15 billion |
| Medium | > Rp5–10 billion | > Rp15–50 billion |

INF: most 1–5-branch clinics fall in small/medium and may use SAK EMKM. Clinics with bank loans or investors often use SAK EP. The choice belongs to the clinic's accountant; the product should support both outputs from the same ledger.

### 3.2 Does the standard change the product? (INF)

| Item | SAK EMKM | SAK EP | Product impact |
|---|---|---|---|
| Basis | Historical cost, accrual | Accrual; fuller topics | Same double-entry ledger |
| Revenue from services | Recognised when service is provided | Chapter 23: services recognised by stage of completion / when delivered | Session-by-session recognition works for both |
| Prepaid packages, balance, DP | Liability until service delivered (accrual principle) | Liability (customer prepayments) | Same contract-liability accounts |
| Statements | Statement of financial position, P&L, notes | Adds statement of changes in equity and cash flows | Report set differs; data the same |

Conclusion: the ledger design does not depend on the framework. Only report templates and some notes differ.

### 3.3 Level A or B — recommendation (INF)

| Criterion | Level A (sub-ledgers + export) | Level B (integrated GL) |
|---|---|---|
| Market parity | Below Assist/ICONIX Enterprise/ClinicHub | At parity |
| Need after PP 20/2026 | Accountant rebuilds books elsewhere | P&L and balance sheet from source events |
| Risk | Low | Posting rules must be validated once by an accountant |
| Effort | Lower | Higher (chart of accounts, posting engine, periods, reports) |

Recommendation: **Level B as target, delivered in two steps**: (1) sub-ledgers and liability roll-forwards first, because dashboards need them anyway; (2) chart of accounts, automatic posting, period lock and statements. Accountant review of the posting map (`CLINIC-SYSTEM-NEEDS…` §6.3) is the gate between steps.

### 3.4 Questions for the accountant (prepared)

1. SAK EMKM or SAK EP for the pilot clinic?
2. Revenue timing for package sessions: recognise at session completion (our design) — accepted?
3. Forfeited booking DP: other income or service revenue?
4. Patient balance never expires (CONFIRMED): keep as liability indefinitely — any disclosure needed?
5. Expired-package paid-unused value moved to balance (CONFIRMED): pure liability reclassification — accepted?
6. Commission: accrue as expense when entitled (our rule) — accepted?
7. Materials: expense on consumption; standard-cost estimate where actual is not counted — acceptable method and disclosure?
8. Branch reporting as profit centres within one PT — any requirement for branch NITKU in tax reporting?

### 3.5 Questions for the tax adviser (prepared)

1. Which treatment families are exempt medical services vs taxable for this clinic, and what evidence supports each (medical indication, performer, licence)?
2. VAT timing on prepaid packages, balance top-ups and booking DP.
3. Treatment of mixed packages containing exempt and taxable items.
4. Do exempt medical receipts count toward the Rp4.8 billion PKP threshold?
5. e-Faktur route: XML upload or PJAP.
6. Withholding obligations on doctor/BC commissions (data we must export).

---

## 4. SATUSEHAT

### 4.1 Obligations (TEXT unless noted)

| Rule | Text / summary |
|---|---|
| Permenkes 24/2022 Pasal 45 | "Seluruh Fasilitas Pelayanan Kesehatan harus menyelenggarakan Rekam Medis Elektronik … paling lambat pada tanggal 31 Desember 2023." |
| Pasal 21 | RME stored by a facility "harus terhubung/terinteroperabilitas dengan platform layanan interoperabilitas dan integrasi data kesehatan yang dikelola oleh Kementerian Kesehatan." |
| Pasal 10–11 | Systems must be interoperable using Ministry standards and must follow Ministry variables and metadata (definition, format, codification). |
| PP 28/2024 Pasal 781(1) | RME "wajib terintegrasi dengan Sistem Informasi Kesehatan Nasional" (OFFICIAL summary). |
| Pasal 42 | Sanctions on facilities: written warning and/or recommendation to revoke or revocation of accreditation status. |
| SE Menkes HK.02.01/MENKES/1030/2023 (13 Dec 2023) | Facilities without SATUSEHAT-integrated RME: written warning, then accreditation consequences, and possible request to revoke the business licence (OFFICIAL summary). |

INF: a beauty clinic licensed as a health facility (klinik) is a "Fasilitas Pelayanan Kesehatan". If the clinic uses our system as its RME, **we carry the integration obligation in practice**; the clinic carries the legal sanction risk.

### 4.2 What gets sent (OFFICIAL, SATUSEHAT outpatient guide)

- Core: `Patient` (identified via NIK or the official no-NIK flow), `Practitioner`, `Organization`, `Location`, `Encounter` (status, class, patient, period, location, linked diagnoses).
- As they occur: `Condition` (complaint/diagnosis; ICD-10 for diagnosis, SNOMED CT for clinical terms), `Observation` (vitals, exam results), `Procedure` (procedures actually performed), `MedicationRequest`/`Medication`/`MedicationDispense` (prescriptions and dispensing, KFA codes).
- Do not create data that did not happen (e.g. no fake observations).

Mapping to our records (INF):

| Our record | FHIR resource |
|---|---|
| Patient | Patient |
| Branch | Location (+ Organization for the PT/facility) |
| Doctor, nurse | Practitioner (via SATUSEHAT practitioner lookup) |
| Visit | Encounter |
| BC intake complaint, doctor diagnosis | Condition |
| Vitals, skin assessments | Observation |
| Treatment execution counted as performed | Procedure |
| Prescription, pharmacy issue | MedicationRequest, MedicationDispense |

BC intake is non-medical (CONFIRMED). It should not be sent as a clinician's finding; only the doctor's validated items go out (PROPOSED).

### 4.3 Registration steps

**Vendor (us), once — OFFICIAL, SATUSEHAT "Registrasi Sistem RME":**

1. Register and activate an account on SATUSEHAT Platform.
2. **PSE number** from Kominfo/Komdigi (private entities via **OSS**). Format `aaaaaa.bb/DJAI.PSE/MM/YYYY`.
3. **SNOMED CT affiliate licence** (SNOMED International MLDS) → application approval number.
4. Sandbox testing until at least `Encounter` and `Condition` succeed (HTTP 200/201); screenshots, screen recording, sandbox monitoring screenshots.
5. Documents (PDF ≤ 10 MB): power of attorney/assignment letter; system documentation (all features, user guide); signed statement on variables and metadata (materai); list of facilities using the system with their latest facility registration codes, or a signed "Surat Pernyataan Belum Bermitra".
6. Portal → Registrasi Institusi → category "Penyedia sistem RME (mitra)" → **security survey** → submit → Ministry verification.

Permenkes 24/2022 Pasal 12(2) registration content (TEXT): system name; system documentation; features; **data storage location**; variables and metadata; list of facilities using the system. Changes must be reported (Pasal 12(3)).

**Each clinic (per tenant/branch) — OFFICIAL:**

1. Facility registered in the Ministry facility registry (DFO/REGFASYANKES) with its facility code.
2. Update the facility data with the RME system used (select our verified vendor) and SATUSEHAT contact.
3. Production credentials (**Organization ID, Client ID, Client Secret**) appear in the SATUSEHAT portal under Production → Kode Akses API, typically within up to 3 working days.
4. The clinic gives credentials to the RME system securely. Client ID/Secret are valid for one Organization ID.

### 4.4 Product requirements derived

| Requirement | Detail |
|---|---|
| Per-branch facility profile | Facility code, SATUSEHAT Organization ID, credentials stored encrypted, environment (sandbox/production) |
| Master data mapping | Practitioner IHS IDs, Location IDs per room/branch, ICD-10 diagnosis picker, SNOMED CT terms, KFA codes for medicines |
| Patient identity | NIK capture + validation; official no-NIK path (e.g. foreigners with passport — seen in NMW portal identity types) |
| Outbox | Durable queue per resource with status, retries, error codes; resend after correction |
| Monitoring | Per-branch sending dashboard; stuck items list |
| Change reporting | Track system changes that require updating our vendor registration (features, storage location) |

---

## 5. PSE (electronic system operator)

### 5.1 Obligations

| Rule | Content | Level |
|---|---|---|
| Permenkes 24/2022 Pasal 9(3) | An RME system operator "harus terdaftar sebagai Penyelenggara Sistem Elektronik pada sektor kesehatan di kementerian yang bertanggung jawab pada bidang komunikasi dan informatika" | TEXT |
| Pasal 12(1) | Facility or PSE "wajib melakukan registrasi Sistem Elektronik yang digunakannya di Kementerian Kesehatan" | TEXT |
| Permenkominfo 5/2020 jo. 10/2021 | Private-scope PSE must register; registration via OSS; sanction for not registering is **access blocking** | OFFICIAL (JDIH Komdigi summary) |
| PP 71/2019 Pasal 21 | Private PSE may store data in or outside Indonesia, with supervision and access guaranteed | OFFICIAL summary |
| Permenkes 24/2022 Pasal 22 | For RME stored via a partner PSE: storage facility **in Indonesia**, Ministry recommendation, NDA/integrity pact against misuse, facility retains unlimited access | TEXT |

INF on data location: the sector rule for RME is stricter than the general PSE rule. Because our SaaS stores the clinic's RME, plan **Indonesian hosting for clinical data** and its backups (Pasal 20 also requires periodic backup in a different location). Non-clinical data could legally sit elsewhere, but splitting adds complexity; one Indonesian region is simpler.

### 5.2 Vendor prerequisites checklist (company level)

| # | Item | Needed for |
|---|---|---|
| 1 | Legal entity with NIB (OSS) and correct business classification | PSE registration, Meta verification |
| 2 | PSE registration (Komdigi via OSS) → PSE number | SATUSEHAT vendor registration |
| 3 | SNOMED CT affiliate licence | SATUSEHAT vendor registration |
| 4 | System documentation, user guide, variables/metadata statement | SATUSEHAT vendor registration |
| 5 | Security survey answers (and the controls behind them) | SATUSEHAT vendor registration |
| 6 | Indonesian hosting for clinical data + backup site | Permenkes 24/2022 Pasal 20, 22 |
| 7 | Data processing agreement / NDA template with clinics | Pasal 22(2–3), UU PDP |
| 8 | Website + privacy policy | Meta Tech Provider verification, PSE, UU PDP |
| 9 | Meta business verification + App Review | WABA Tech Provider |

Item 1 overlaps with open question Q10 (which entity registers).

---

## 6. RME rules that shape screens (TEXT, Permenkes 24/2022)

| Article | Rule | Screen/system effect |
|---|---|---|
| 13 | Minimum activities: registration, distribution, clinical entry, processing, claim data input, storage, quality assurance, transfer | Module coverage checklist |
| 14(2) | Identity data at least: medical record number, patient name, **NIK** | Required fields (with official no-NIK flow) |
| 14(4) | Social data at least: religion, occupation, education, marital status | Required fields at registration (often skipped by beauty SaaS) |
| 25 | The record document belongs to the facility | Tenant owns data; exit/export clause |
| 26 | Record **content** belongs to the patient and is given to the patient | Patient copy/export function |
| 29 | Confidentiality, integrity, availability | Role access, audit, backups |
| 30(1–2) | Facility head grants access rights to staff; part of SOP | Role and scope admin |
| 30(5–7) | Corrections within 2×24 h by clinician/admin; later administrative corrections need records officer and/or head approval | Edit window, approval flow, history |
| 31 | Electronic signature **may** be used | Optional certified e-signature integration |
| 32 | Confidentiality applies to everyone with access, even after death | Access logging |
| 33–35 | Disclosure with or without consent, written/electronic request, limited to need | Disclosure request log |
| 39 | Retention ≥ 25 years from last visit | Retention policy, no hard delete |

---

## 7. Personal data (status only)

- UU 27/2022 (PDP) is in force (OFFICIAL).
- Implementing regulation reported as **PP 33/2026** (SECONDARY: law-firm article). Not verified against JDIH in this pass.
- Supervisory agency reported **not yet formed** as of mid-2026 (SECONDARY).
- Product needs remain as earlier research: purpose-specific consent (health data is specific personal data), consent withdrawal, data-subject requests, breach notification procedure, processor agreements with clinics. Verify PP 33/2026 text before writing the PDP section of the PRD.

---

## 8. Updated open questions

| ID | Question | Owner | Status |
|---|---|---|---|
| T1 | VAT classification per treatment family; evidence per class | Clinic + tax adviser | Questions prepared §3.5 |
| T2 | Pilot clinic PKP status and turnover | Pilot clinic | — |
| A1 | SAK EMKM or SAK EP | Clinic accountant | Ledger supports both |
| A2 | Accounting Level B in two steps | — | **DECIDED 2026-11-02** (register A-01) |
| S1 | Vendor registrations (NIB, PSE, SNOMED CT, SATUSEHAT) | — | **DECIDED 2026-11-02** (register S-03); entity name still OPEN (S-04) |
| S2 | SATUSEHAT integration in first release | — | **DECIDED 2026-11-02** (register S-01) |
| S3 | Hosting | — | **DECIDED 2026-11-02:** Vultr + Coolify (Singapore) + Cloudflare, **conditional** on clinical data and backups in Indonesia (register H-01, H-02). Vultr has no Indonesian region; Cloudflare Regional Services has no Indonesian region. Indonesian provider for clinical data OPEN (H-02b) |
| P1 | Verify PP 33/2026 (PDP) text | Research | Next pass |

---

## 9. Sources

- PP 49/2022 — https://jdih.kemenkoinfra.go.id/cfind/source/files/pp/2022/pp-nomor-49-tahun-2022.pdf ; https://www.jdih.kemenkeu.go.id/api/download/1ea00c90-4108-41a4-a72f-3032e865cbc8/49TAHUN2022PP.pdf
- DJP on beauty clinic VAT (DDTC report, 22 Aug 2023) — https://news.ddtc.co.id/berita/nasional/1796606/jasa-klinik-kecantikan-kena-ppn-begini-penjelasan-kring-pajak.md
- Beauty clinic VAT dispute (DDTC case note) — https://news.ddtc.co.id/literasi/putusan/1807828/sengketa-yuridis-pengenaan-ppn-atas-jasa-kecantikan
- PMK 131/2024 — https://www.pajak.go.id/id/node/113453
- PKP threshold — https://www.pajak.go.id/id/pengusaha ; PMK 197/2013 status — https://jdih.kemenkeu.go.id/dok/197-pmk-03-2013
- PP 20/2026 (amending PP 55/2022) — https://www.pajak.go.id/id/peraturan/perubahan-atas-peraturan-pemerintah-nomor-55-tahun-2022-tentang-penyesuaian-pengaturan-0 ; press release — https://pajak.go.id/id/siaran-pers/pph-final-umkm-tetap-05-persen-djp-perkuat-ketepatan-sasaran
- Coretax e-Faktur schemes — https://www.pajak.go.id/coretaxpedia/skema-umum-pembuatan-efaktur
- SAK EMKM — https://web.iaiglobal.or.id/SAK-IAI/Tentang%20SAK%20EMKM ; scope page — https://www.iaiglobal.or.id/v03/files/file_sak/emkm/files/basic-html/page13.html
- SAK EP — https://web.iaiglobal.or.id/SAK-EP-Efektif/SAK%20Entitas%20Privat%20Efektif%20Per%201%20Januari%202025
- PSAK renumbering — https://web.iaiglobal.or.id/Berita-IAI/detail/penomoran_psak_dan_isak_dalam_sak_indonesia
- PP 7/2021 UMKM criteria — https://diskopukm.baliprov.go.id/wp-content/uploads/2023/09/PP-Nomor-7-Tahun-2021.pdf
- Permenkes 24/2022 (article text) — https://api-law.crpg.info/peraturan/permenkes/24/2022 ; official PDF — https://jdih.kemkes.go.id/common/dokumen/2022permenkes024.pdf
- SE Menkes HK.02.01/MENKES/1030/2023 — https://jdih.kemkes.go.id/common/dokumen/SE%20No.%20HK.02.01-MENKES-1030-2023%20ttg%20Penyelenggaraan%20Rekam%20Medis%20Elektronik%20di%20Fasyankes%20Serta%20Penerapan%20Sanksi%20Administratif-signed.pdf
- PP 28/2024 Pasal 781 — https://peraturan.info/pp/2024/28/bab-iv ; JDIH — https://jdih.kemkes.go.id/documents/peraturan-pemerintah-nomor-28-tahun-2024
- SATUSEHAT vendor registration — https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-vendor/
- SATUSEHAT facility registration — https://satusehat.kemkes.go.id/platform/docs/id/registration-guide/regis-institution/ ; production credentials — https://satusehat.kemkes.go.id/platform/docs/id/api-code/access-production/
- SATUSEHAT outpatient guide — https://satusehat.kemkes.go.id/platform/docs/id/interoperability/rme-rawat-jalan/ ; Encounter — https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/encounter/
- Permenkominfo 5/2020 — https://jdih.komdigi.go.id/produk_hukum/view/id/759/t/peraturan%2Bmenteri%2Bkomunikasi%2Bdan%2Binformatika%2Bnomor%2B5%2Btahun%2B2020 ; 10/2021 — https://jdih.komdigi.go.id/produk_hukum/view/id/774/t/peraturan%2Bmenteri%2Bkomunikasi%2Bdan%2Binformatika%2Bnomor%2B10%2Btahun%2B2021
- PP 71/2019 — https://peraturan.bpk.go.id/Download/112816/PP%20Nomor%2071%20Tahun%202019.pdf
- UU 27/2022 — https://peraturan.bpk.go.id/Details/229798/uu-no-27- ; PP 33/2026 report — https://mnllaw.co.id/pp-33-tahun-2026-mengurai-risiko-hukum-di-balik-kewajiban-pelindungan-data-pribadi/
