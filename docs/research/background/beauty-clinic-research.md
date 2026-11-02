# Beauty Clinic Research — Indonesia Competitive Landscape & Clinic Management System Standard

- Date: 2026-10-29
- Scope: 20 beauty and aesthetic clinic brands operating in Indonesia + Indonesian Clinic Management System (SIMKlinik / Aesthetic RME) regulatory, vendor, and architectural standards
- Companion Deep-Dives:
  - [indonesia-clinic-management-system-standard.md](indonesia-clinic-management-system-standard.md) (SIMKlinik & Aesthetic RME Regulatory/Functional Standard)
  - [indonesia-beauty-clinic-admin-dashboard-standard.md](indonesia-beauty-clinic-admin-dashboard-standard.md) (Admin Dashboard, Role Workbenches & KPI Standard)
- Method: Official brand websites, branch directories, Indonesian health/privacy/tax regulations, SIMKlinik vendor documentation, and press coverage collected on the research date
- Status: Draft v2 (desk research + regulatory and system architecture synthesis)

## Evidence rules

- **Verified**: stated on an official brand page or a named press source, cited below.
- **Counted**: derived by counting entries on an official branch directory on the research date.
- **Claimed**: a figure stated by the brand or founder in marketing or press; not independently audited.
- **Inferred**: analyst judgment from the evidence, labelled as such.
- **Not verified**: no reliable source found; do not use in external material.

Branch counts change quickly and different sources count different things (clinics, outlets, sub-brands, "announced" branches). Treat every count as a dated snapshot.

---

## 1. Executive summary

1. **The market splits into four clear plays**: dermatology-led premium chains, mass medical chains, natural/affordable regional chains, and product-led or founder-led brands. Several groups run two tiers at once (ERHA → ERHA Ultimate + DermiesMAX; ZAP → ZAP Clinic + ZAP Premiere; Miracle → MAC + Miracle Ultimate).
2. **Scale leaders by footprint**: ERHA (about 109 clinics in 58 cities, 2024), Natasha (104 branches listed on its directory; press cites about 200), ZAP Group (100+ outlets), SOZO (75+ claimed), and Naavagreen (75 listed).
3. **Tier laddering is the dominant strategy among the leaders.** One brand serves the entry price and acquisition; a second brand captures dermatologist-led, high-ticket procedures.
4. **The affordable/natural segment is crowded and regional**: Larissa, Naavagreen, Ella, DNI, and LBC compete on price, natural ingredients, and loyalty, mostly outside premium Jakarta malls.
5. **Founder- and product-led brands** (Athena, Bening's, MS GLOW) use a personal or skincare-brand audience to drive clinic visits. Fast expansion is their strength; consistency of medical positioning and public branch data is their weak point.
6. **Specialist procedural clinics** (Gloskin, NMW, Esther, Miracle) differentiate through injectables, surgery-adjacent procedures, hair restoration, or long heritage rather than footprint.
7. **Public pricing is uneven.** ZAP, DermiesMAX, and Naavagreen publish entry prices. Natasha publishes price lists by region. Most others hide prices behind consultation or WhatsApp. Price transparency is a usable differentiator.
8. **Clinic Management Systems (SIMKlinik Kecantikan) are now regulated infrastructure, not back-office optional tools.** Permenkes 24/2022 (mandatory RME + SATUSEHAT FHIR bridge + 25-year retention), UU 17/2023 & PP 28/2024 (strict Doctor/Nurse delegation vs. non-nakes *terapis*), BPOM blue-label (*etiket biru*) compounding rules, UU PDP 27/2022 (specific health/photo data consent), and DJP Coretax PPN 11/12 rules separate compliant enterprise clinic systems from generic POS/clinic SaaS.

---

## 2. Brand profiles

### 2.1 Summary table

| # | Brand | Group / founder | Founded | Footprint (dated) | Evidence | Primary positioning |
|---|---|---|---|---|---|---|
| 1 | Natasha Skin Clinic | Natasha Group (dr. Fredi Setyawan / PT Dion Farma Abadi) | ~1995 (31 years in 2026, press) | 104 branches listed; press cites ~200 | Counted / Claimed | Mass medical aesthetic, national coverage incl. eastern Indonesia |
| 2 | ZAP Clinic | ZAP Group (PT Zulu Alpha Papa) | 2009 | 100+ outlets (group) | Claimed | Laser + hair removal, bundled affordable routine care |
| 3 | ZAP Premiere | ZAP Group (PT Zulu Alpha Papa) | Not verified | Jakarta premium locations | Verified (list) | Premium; dermatologist at every location |
| 4 | ERHA Clinic | PT Arya Noble (Genero Pharmaceuticals) | Not verified | 109th branch, 58 cities (Mar 2024) | Verified (press) | Dermatology-led national chain |
| 5 | ERHA Ultimate | PT Arya Noble (Genero Pharmaceuticals) | 2024 rebrand | Directory runs ~19 pages, 61 cities/regencies in filter | Counted (estimate) | "Intelligent DermaBeauty" upgraded ERHA format |
| 6 | Athena Beauty Clinic | dr. Richard Lee | 2013, Palembang | 50+ locations | Claimed | Founder-led, mass-to-mid aesthetic |
| 7 | MS GLOW Aesthetic Clinic | PT Kosmetika Klinik Indonesia | Clinic 2017; brand 2013 | 8, 14, or 16 branches across its own pages | Inconsistent | Skincare-brand extension into clinics |
| 8 | Larissa Aesthetic Center | Larissa | 1984 | 50+ branches | Claimed (press) | "Natural Ingredient with High Technology", affordable |
| 9 | Bening's Clinic | PT Benings Pratama Grup, dr. Oky Pratama | Not verified | 45 (group site); founder cites branch #71 of 74 announced (Nov 2024) | Conflicting | Founder/celebrity-led, laser-heavy, e-commerce skincare |
| 10 | Naavagreen | Natasha Group (dr. Fredi Setyawan / PT Dion Farma Abadi) | ~2011–2012 (11th anniversary in 2023 press) | 75 listed | Counted | Natural, low price ("mulai Rp50 ribu") |
| 11 | Ella Skin Care | Ella Skin Care | 2008, Solo | 20+ cities named in press (2024) | Verified (press list) | Affordable clinic + own products, Central Java core |
| 12 | London Beauty Centre (LBC) | Anton Yuwono | 1998 | 47 branches in 36 cities (2014); current count not verified | Dated | Hospitality-style service, broad regional coverage |
| 13 | Miracle Aesthetic Clinic | Miracle | Not verified | 19 listed (16 MAC + 3 Miracle Ultimate) | Counted | Surabaya-rooted aesthetic chain with premium tier |
| 14 | Esther Aesthetic Clinic | dr. Esther Srie Pertiwiningsih | 1994, Surabaya | 13 branches | Claimed | "HAMC": herbal + advanced + medical + cosmetic, top-to-toe |
| 15 | NMW Clinic | NMW | Not verified | 17 locations | Counted | Doctor-led aesthetic, Jabodetabek-heavy, 100K+ customers claimed |
| 16 | Dermies by ERHA (now DermiesMAX) | PT Arya Noble | ~2021 (youth research cited 2021) | Not verified | — | Youth/acne, affordable dermatology |
| 17 | SOZO Skin Clinic | Not verified | Not verified | 75+ locations | Claimed | Premium medical aesthetic, dermatologist-supervised, transparent uniform pricing |
| 18 | Airin Skin Clinic | Not verified | Not verified | 12 unique clinics | Counted | Doctor-led, Bandung-rooted |
| 19 | DNI Skin Centre | Not verified | Not verified | 15 branches (14 Bali + Bekasi) | Counted | "Ahlinya cantik terjangkau", Bali regional leader |
| 20 | Gloskin Aesthetic Clinic | dr. Nanang Masrani | 2012 | 7 branches | Claimed | Evidence-based injectables, hair restoration, surgery-adjacent procedures |

### 2.2 Notes per brand

**1. Natasha Skin Clinic.** Founded by dr. Fredi Setyawan under Natasha Group and vertically integrated with its own pharmaceutical/cosmetic manufacturing plant (**PT Dion Farma Abadi**, which also supplies sister brand Naavagreen). The official directory listed 104 numbered branches on the research date, spread from Aceh to Papua, with a heavy single-branch presence in tier-2 and tier-3 cities. A 2026 press article cites about 200 branches. That figure probably counts a different unit (inferred). Price lists vary by region and require choosing a branch first (`natasha-skin.com/pricelist/`). *Implication:* the widest geographic coverage in the set, backed by owned factory manufacturing and a region-tiered ERP price engine.

**2–3. ZAP Clinic / ZAP Premiere.** ZAP began in 2009 as a hair-removal brand and now calls itself the largest laser-based clinic group in Indonesia, with 100+ outlets. The group runs five brands: ZAP Clinic, ZAP Premiere, MEN/O/LOGY, JUVA, and ZAP Health. Operationally, ZAP uses an enterprise booking/scheduling backbone (**Booker / Mindbody** integrated with **ZAP Apps**) and a centralized cross-branch Digital Medical Record so patients can redeem **ZAP Series** (prepaid multi-treatment credit bundles) and **ZAP Membership** at any outlet nationwide. ZAP Clinic sells bundles ("Facial + Laser + Product 3 in 1 mulai 499rb"). Its facials are listed at 699k–799k, and it has expanded into pregnancy facials and a medically supervised weight-loss program. ZAP Premiere places a dermatologist at every location, with treatments starting at IDR 399,000. *Implication:* the clearest two-tier ladder, most transparent national pricing, and strongest cross-branch package clearing ledger in the set.

**4–5. ERHA Clinic / ERHA Ultimate.** ERHA Clinic belongs to PT Arya Noble (backed by manufacturing arm **Genero Pharmaceuticals** and running **RISE with SAP** cloud ERP). In March 2024, Tebet opened as ERHA's 109th branch, across 58 cities, and the Ultimate format launched as an "Intelligent DermaBeauty Clinic". The ERHA Ultimate finder lists 61 cities and regencies. Its **ERHA Buddy** mobile app integrates appointment booking, AI skin analysis, tele-dermatology, centralized RME, loyalty tiers, and e-prescription fulfillment via branch pickup, drive-thru, or home delivery. Secondary-source prices from early 2024 put instant acne treatment at Rp255k–1M and peels at Rp495k–845k. Rejuran from Rp8M is also listed (secondary source; re-verify). *Implication:* dermatology credibility at national scale with an enterprise SAP + super-app stack. Its main exposure is a premium price against fast-growing cheaper chains.

**6. Athena Beauty Clinic.** Founded in Palembang in 2013 by dr. Richard Lee, Athena claims 50+ locations, including Palembang, Jakarta, Bandung, Surabaya, Medan, Makassar, Padang, Semarang, Yogyakarta, and Denpasar. Booking is routed through centralized WhatsApp CS teams into branch calendars, paired with `athena-shop.id` e-commerce skincare distribution. *Implication:* founder visibility drives demand, and founder controversy is also its key reputational risk (inferred).

**7. MS GLOW Aesthetic Clinic.** MS GLOW is a skincare brand founded in 2013. Its clinic arm, PT Kosmetika Klinik Indonesia, dates from 2017. Its own pages disagree on the branch count: msglowclinic.id says 14 in one place and 8 in another, and ptkki.id says 16. The clinic has a "MS Glow Smart Clinic" app for reservations, doctor schedules, live queue tracking, and payments. *Implication:* a strong product audience and a capable patient app, but inconsistent public CMS branch data weakens trust.

**8. Larissa Aesthetic Center.** Larissa started in 1984 as a beauty salon and now positions itself as "Natural Ingredient with High Technology". Press reports 50+ branches and stresses affordable prices. It operates a native **Larissa Aesthetic Center Mobile App** (Android/iOS) connecting online treatment booking, member point rewards, and e-commerce checkout for its BPOM/Halal-certified "L" product line (home delivery or branch pickup). *Implication:* heritage plus natural positioning, modernized with an omnichannel mobile app.

**9. Bening's Clinic.** The group site states 45 branches across Java, Sumatra, Kalimantan, Sulawesi, Papua, and the islands. Founder dr. Oky Pratama announced branch #71 out of 74 in November 2024; in 2023 he targeted 100 branches and claimed a MURI record for the most lasers. Runs a mobile app / member ecosystem and centralized WhatsApp reservation hub. *Implication:* aggressive expansion, heavy laser capex, and celebrity marketing. The public branch figures conflict, so treat the count as unresolved.

**10. Naavagreen.** Part of the **Natasha Group** (supplied by **PT Dion Farma Abadi**). The official directory lists 75 branches. Its motto is "Skincare natural dan murah", with treatments from Rp50k (2023 press) and a sensitive-skin serum facial at Rp125k, gated behind a mandatory member ID for repeat product purchases. *Implication:* Natasha Group's high-volume, low-price flanker brand at the price floor of the market.

**11. Ella Skin Care.** Ella was founded in Solo on 9 May 2008. A 2024 press article lists more than 20 cities, from Pati to Lampung, and the brand claims to have handled 3,256,000 skin problems. Its message is "cantik dan sehat nggak harus mahal". Operates **Ella Channel**, a centralized online portal for new-patient registration, pre-visit online consultation, branch booking, and skincare reorders. *Implication:* density in Central Java with an affordable clinic-plus-product model and pre-visit tele-triage.

**12. London Beauty Centre (LBC).** Anton Yuwono founded LBC in 1998 (alongside *LBC Slimming Centre*). It had 47 branches in 36 cities in 2014, and a 2025 article describes hospitality-level service and a shift from offline reception to centralized online services and multi-city WhatsApp booking via Linktree. *Implication:* a mature regional facial-and-slimming chain whose current branch count is not verified.

**13. Miracle Aesthetic Clinic.** Miracle lists 19 locations: 16 MAC plus 3 Miracle Ultimate. Surabaya has 4 and Jakarta has 4, plus Bali, Lombok, Makassar, Manado, Balikpapan, Medan, and Batam. Combines corporate and franchise/JV branch governance under *"The Art and Science of Rejuvenation"*. *Implication:* an East Java heritage brand that has added its own premium tier.

**14. Esther Aesthetic Clinic.** Esther was founded in Surabaya in 1994 and rebranded to its current name in 2022. It claims 13 branches. Its "HAMC" concept stands for Herbal, Advanced, Medical, Cosmetic, with BPOM-registered homecare products. *Implication:* heritage plus top-to-toe care across four product/service modalities, a regional premium-mid player.

**15. NMW Clinic.** NMW lists 17 locations, mostly in Jabodetabek plus Yogyakarta, Surabaya, and Bali. The Surabaya branch sits inside an Aesthetic Surgery Center at RSIA PUSURA. It claims 100K+ customers and offers web booking with explicit doctor selection. *Implication:* a dense Jakarta model with a hospital-linked surgical referral escalation path.

**16. Dermies by ERHA → DermiesMAX.** This is PT Arya Noble / ERHA's youth brand, built for an "affordability" mission. Treatments cost Rp275k–1.2M per visit depending on the package, and mall branches stay open late. *Implication:* ERHA's transparent-price acquisition funnel for teens and young adults, backed by Arya Noble's corporate ERP.

**17. SOZO Skin Clinic.** SOZO claims 75+ locations, with "premium" positioning, dermatologists (Sp.DVE), and US-FDA/CE devices (Pico, HIFU, RF). It names authorized partnerships with Jalupro, ASCE Plus, Pluryal, and Sylfirm X, and promises the same transparent prices at every location. *Implication:* premium credentials and strict partner lot traceability combined with chain scale, a direct challenger to ERHA and ZAP Premiere.

**18. Airin Skin Clinic.** Airin has 12 unique clinics, centred on Bandung and Cimahi, with Jakarta Selatan, Bogor, Bintaro, Bekasi, Malang, Surabaya, and Tasikmalaya. Each listing shows doctor shift schedules, and its ecosystem features **Primary, Priority, and VIP** member tiers, **AirinPay** digital wallet/cashback, online booking (`airinskinpremier.com`), and an e-commerce/mitra portal (`airinbeautycare.co`). *Implication:* a West Java regional leader with a remarkably complete loyalty, digital wallet, and doctor-schedule transparency stack.

**19. DNI Skin Centre.** DNI lists 15 branches: 14 in Bali across almost every regency, and one in Bekasi. Its claims are "Perawatan dermatologi ahli" and "cantik terjangkau". *Implication:* a dominant regional density play in Bali (`WITA` cluster) sharing regional patient records and doctor rotations.

**20. Gloskin Aesthetic Clinic.** Gloskin was founded on 12 July 2012 by dr. Nanang Masrani, M.Biomed (AAM). It has 7 branches in Jakarta, Bekasi, Surabaya, Bali, and Banjarmasin. Services include fillers, botox, thread lift, hair transplant/PRP/exosome, blepharoplasty, facelift, and a medical weight-loss program led by a clinical nutrition specialist. *Implication:* a high-ticket procedural specialist rather than a volume chain.

---

## 3. Segmentation map

| Segment | Brands | Core promise | Typical ticket (where known) |
|---|---|---|---|
| A. Dermatology-led premium | ERHA Ultimate, ZAP Premiere, SOZO, Miracle Ultimate | Dermatologist, advanced devices, outcomes | Premiere from Rp399k; ERHA peels ~Rp500k–850k (secondary) |
| B. Mass medical chains | Natasha, ZAP Clinic, ERHA Clinic, Bening's, Athena | Coverage, routine care, bundles | ZAP bundles from Rp499k; facials Rp699k–799k |
| C. Natural / affordable regional | Larissa, Naavagreen, Ella, LBC, DNI | Low price, natural ingredients, loyalty | Naavagreen from Rp50k; facial Rp125k |
| D. Product- or founder-led | MS GLOW, Bening's, Athena | Brand audience converts to clinic visits | Not verified |
| E. Procedural specialists | Gloskin, NMW, Esther, Airin | Injectables, surgery-adjacent, hair, heritage | Not verified |
| F. Youth entry | DermiesMAX | Acne and young skin, affordable dermatology | Rp275k–1.2M per visit |

Some brands sit in more than one segment; Bening's and Athena are both mass chains and founder-led brands.

---

## 4. Cross-brand analysis

### 4.1 Strategic patterns

- **Tier laddering** (ERHA, ZAP, Miracle): one group owns both acquisition and high-ticket demand and moves patients up the ladder.
- **Clinic plus homecare products** (MS GLOW, Bening's, Ella, Esther, Naavagreen, Larissa): product revenue recurs between visits and locks patients into the regimen (inferred).
- **Geographic density over national coverage** (DNI in Bali, Airin in West Java, Ella in Central Java, Miracle in East Java): density lowers marketing cost per branch and builds word of mouth (inferred).
- **Tier-2 and tier-3 city expansion** (Natasha, Bening's, LBC, Naavagreen): competition is moving out of Jakarta malls into regional cities.
- **Adjacent categories**: men's care (MEN/O/LOGY), pregnancy facials, medical weight loss (ZAP, Gloskin), hair restoration (Gloskin, SOZO), and youth acne (DermiesMAX).

### 4.2 Trust signals in use

- Dermatologist (Sp.KK / Sp.DVE) on site: ZAP Premiere, SOZO, ERHA, DNI (claims dermatology care).
- Device and brand authorization: SOZO (Jalupro, Pluryal, Sylfirm X) and Bening's (MURI laser record).
- Heritage: Larissa (1984), Esther (1994), Natasha (~1995), LBC (1998).
- BPOM-registered products: Esther and SOZO.
- Awards: ZAP lists Top Brand, Superbrands, and Female Daily.

### 4.3 Weak spots seen across the set

- **Inconsistent public data**: MS GLOW and Bening's publish conflicting branch counts. Larissa's branch URL returned a 404 on the research date.
- **Hidden pricing**: most brands push price discovery to WhatsApp, which adds friction for buyers who want to compare prices (inferred).
- **Positioning blur**: many brands promise "teknologi terbaik + dokter profesional" with no measurable proof.

---

## 5. Opportunities (inferred)

1. **Transparent price plus outcome proof.** Publish prices, the expected number of sessions, and before/after protocols. Only ZAP, DermiesMAX, SOZO, and Naavagreen get close today.
2. **Regional density in underserved cities.** Copy the DNI-in-Bali model in a province where no chain is dense yet. This needs local demand validation.
3. **Specialist niches**: men, pregnancy-safe care, sensitive or acne-prone teens, hair loss, and medical weight loss. These are growing but still fragmented.
4. **Digital booking as the default.** Only MS GLOW mentions a full app (reservation, queue, payment), while ERHA (`ERHA Buddy`) and ZAP (`ZAP Apps`) run proprietary booking ecosystems. Booking with live queue and resource visibility is still uncommon outside top chains.
5. **Clear doctor credentials per branch.** Showing which branches have a dermatologist and when, as Airin and NMW partly do, reduces trust friction.

---

## 6. Indonesian Clinic Management System (SIMKlinik & Aesthetic RME) Standard

> Full architectural, regulatory, and operational specification: [indonesia-clinic-management-system-standard.md](indonesia-clinic-management-system-standard.md)

An Indonesian beauty clinic operates simultaneously as a licensed healthcare facility (*Fasyankes* — *Klinik Pratama* or *Klinik Utama*) and a high-frequency retail/package commerce business. Generic outpatient SIMKlinik software fails in aesthetic clinics because it lacks **4-resource scheduling**, **anatomical face charting**, **fractional BHP/open-vial BUD tracking**, **blue-label compounding pharmacy workflows**, **deferred package revenue accounting**, and **multi-role split commissions**.

### 6.1 Mandatory Indonesian Regulatory Baseline

| Domain | Regulation | Mandatory System Standard |
|---|---|---|
| **Electronic Medical Record (RME)** | Permenkes No. 24 Tahun 2022; KMK 1423/2022; SE Menkes 1030/2023 | 100% digital RME; Komdigi & Kemenkes **PSE registration**; standardized variables (16-digit NIK, ICD-10, ICD-9-CM, SNOMED-CT, LOINC, KFA); **2×24-hour edit lock** (Pasal 30: immutable after 48h, requiring co-signed clinical addendum); certified electronic signature (TTE); **minimum 25-year retention** from last visit (Pasal 39); domestic Indonesian server & off-site backup residency (Pasal 20, 22). |
| **National Interoperability** | SATUSEHAT Platform (HL7 FHIR R4) | Real-time or durable-outbox sync of `Organization`, `Location`, `Practitioner` (SISDMK/STR/SIP), `Patient` (MPI NIK + official No-NIK/passport flow), `Encounter`, `AllergyIntolerance`, `Observation`, `Condition` (ICD-10), `Procedure` (ICD-9-CM), `MedicationRequest`, and `MedicationDispense` (KFA). |
| **Clinical Delegation & Consent** | UU Kesehatan No. 17 Tahun 2023 (Pasal 290, 293); PP No. 28 Tahun 2024 (Pasal 745) | Delegation (*Mandat* / *Delegatif*) is legal **only between licensed *Tenaga Medis* (Doctors/Sp.DVE) and *Tenaga Kesehatan* (Nurses/Pharmacists)**. Non-nakes (*terapis/beautician*) must be blocked by the system from executing `invasive`, `injectable`, `energy_device` (lasers/HIFU), or `prescription` services. Invasive/high-risk acts require written *Informed Consent* signed by the patient and witnessed by a health worker, bound to a consented dose/area envelope. |
| **Pharmacy, *Etiket Biru* & Vials** | Permenkes 34/2021; Permenkes 73/2016; BPOM Rules; USP `<795>`/`<797>` | 7-point pharmacist (*Apoteker* SIPA) prescription verification; **Blue Label (*Etiket Biru*)** printing for patient-specific external compounds with auto-calculated **Beyond Use Date (BUD)** (14d unpreserved fridge / 35d preserved aqueous / 180d anhydrous, capped by component expiry); live **Open-Vial BUD timers** (24h reconstituted toxin at 2–8°C; 28d preserved MDV; single-session discard for HA fillers/threads); FEFO stock cards and witnessed *Berita Acara Pemusnahan*. |
| **Data Privacy & Medical Ads** | UU PDP No. 27 Tahun 2022; Permenkes 1787/2010 | Health records and clinical face/body photos are *Data Pribadi Spesifik* (Pasal 4(2)). Requires **5 separate consent purposes** (1. Mandatory RME healthcare notice, 2. Procedure execution consent, 3. Internal clinical photo opt-in, 4. WhatsApp marketing opt-in, 5. Public media/testimonial opt-in). Permenkes 1787/2010 bans public ads for *etiket biru* compounds, nakes as ad models, and unverified before/after claims. |
| **Taxation & Coretax** | PP 49/2022 Pasal 11; PMK 131/2024; PER-11/PJ/2025 | Separates PPN-exempt medical health services (`bebas_medis`, Coretax Kode 08) from taxable cosmetic/aesthetic services and retail skincare (`kena_jasa_estetika` / `kena_produk`, Kode 04, 12% statutory with **11/12 DPP Nilai Lain = 11% effective rate**, half-up whole-Rupiah rounding, Coretax XML export). |
| **Clinic Accreditation, MFK & INM** | Permenkes 34/2022; KMK 1983/2022; Permenkes 30/2022; Permen LHK 56/2015 | Enforces `PRATAMA` (GP-led) vs. `UTAMA` (Sp.DVE/Sp.BP-RE specialist-led) procedure catalog gates; auto-blocks expired `STR/SIP/SIPA`; reconciles **Hardware Laser Shot Counters vs. Billed RME Shots**; tracks *Alkes* calibration, autoclave cycles, and *Limbah B3* TPS manifests; automates the **4 Mandatory Clinic INMs** (Hand Hygiene $\ge 85\%$, APD $100\%$, Patient ID $100\%$, Patient Satisfaction $\ge 76.61\%$) + IKP incident ledger. |

### 6.2 Vendor & Platform Landscape in Indonesia

| Tier | Platforms / Examples | Positioning & Price Range | Strengths & Trade-offs |
|---|---|---|---|
| **1. Indonesian Aesthetic SIMKlinik SaaS** | **Aesta by Assist.id**, **ICONIX** (650+ clinics), **ClinicHub OS** (white-label app + WA AI), **Aplikasi Klinik Pintar** (Rp0–Rp600k/mo), **Medeva**, **Aestech** (Rp300k–Rp2.5M/mo) | Built for local *Klinik Pratama / Utama*; native SATUSEHAT & PSE compliance; IDR SaaS pricing. | Strong on SATUSEHAT bridging, basic face maps, POS, BHP deduction, and doctor/therapist commissions. Weak on deferred-revenue double-entry accounting, pro-rata installment session unlocking, strict open-vial BUD locks, and 4-resource laser scheduling. |
| **2. Regional / Global Med-Spa ERPs** | **Zenoti** (global enterprise benchmark), **Aoikumo** (Malaysia/SEA) | Multi-branch premium chains; USD/MYR enterprise contracts. | Best-in-class guided photo overlays, multi-branch package clearing, and complex split commissions. Lack native Indonesian SATUSEHAT FHIR, KFA, BPOM blue-label, and DJP Coretax 11/12 XML compliance without custom middleware. |
| **3. Proprietary In-House Chain Stacks** | **ERHA** (`ERHA Buddy` + Intelligent DermaBeauty), **ZAP** (`ZAP Apps` + Series ERP), **MS GLOW** (`MS Glow Smart Clinic`), **Natasha** (regional ERP) | Custom-built by market leaders (50–100+ branches). | Deeply integrated patient mobile apps (booking, live queue, tele-dermatology, skincare refill) and cross-branch package portability. |

### 6.3 The 8 Core Functional Modules of a Standard Beauty Clinic System

1. **Front-Office, KYC & 4-Resource Scheduling**: Walk-in and omnichannel booking; shared-phone family profile handling (`1 Phone -> N Patients`); practitioner shift roster (*jadwal dokter/terapis*); atomic reservation of **Doctor + Nurse/Beautician + Cabin/Bed + Shared Energy Device**; 15-minute no-show grace rule.
2. **Aesthetic RME (*RME Estetika*)**: Layered clinical notes; contraindication screening (pregnancy, isotretinoin, keloid); validated scales (**Fitzpatrick I–VI**, **GAGS** acne 0–44, **mMASI** melasma 0–24); **Interactive Anatomical Face & Body Map** (injection points, units/ml, cannula/needle, laser fluence/shots, batch link); **5-angle standardized photo protocol** with ghost overlay and auto comparability flag (`COMPARABLE` / `LIMITED` / `NOT_COMPARABLE`); 2×24h lock + addendum versioning.
3. **Clinical Delegation & Tray BOM Depletion**: Hard system block preventing *Terapis* from executing injectables/lasers; *Dapur Nampan* Bill of Materials (BOM) auto-deducting fractional ml/units/syringes per completed treatment with variance reason logging.
4. **Pharmacy (*Instalasi Farmasi*), Compounding & Inventory**: Full purchasing cycle (`Supplier -> PO -> GRN -> Batch/Lot -> Warehouse -> Cabin/Pharmacy`); e-prescription with 7-point pharmacist check; automated *Etiket Biru* & BUD printing; 75% days-supply refill cooldown; live open-vial BUD timers; daily blind counts for toxins/injectables.
5. **POS, Packages, Deposits & Tax Engine**: Treatment series packages, mixed bundles, and prepaid deposits; **pro-rata installment unlocking** (`unlocked_sessions = floor(paid_allocated / unit_net_value)`); multi-tender checkout (QRIS, EDC, VA, Deposit, Points); cashier shift close (*tutup kasir*); WhatsApp PDF receipt; Coretax XML export.
6. **5-Stream Split Commission Engine**: Automates (1) Doctor consultation fee, (2) Medical procedure fee (Doctor + Nurse split, net of discount or net of BHP cost), (3) Beautician facial/treatment fee, (4) Prescription & retail skincare fee (Doctor/Pharmacist/Beauty Advisor), and (5) Package closing fee (small upfront % at sale; main payout at **session redemption**), with immutable rule snapshots per event.
7. **Post-Care Clinical Triage, WhatsApp CRM & Ad Signals**: 3-tier post-procedure triage (`RED` $\le 15\text{m}$ for vascular occlusion/vision/anaphylaxis, `AMBER` $\le 2\text{h}$, `GREEN` $\le 1\text{d}$); automated WhatsApp Cloud API reminders (H-1 booking, H+1/H+3 downtime check, day-25 skincare refill, 4–6 month Botox retouch, H-30/14/7 package expiry); server-side offline conversion sync (Meta CAPI / Google / TikTok).
8. **Double-Entry Accounting & Multi-Branch Governance**: Books package and deposit sales into **Deferred Revenue Liability (*Pendapatan Diterima di Muka*)** and recognizes earned revenue + BHP COGS + staff commission per redeemed session (or legal expiry breakage); centralizes Medical Director clinical protocol approval while allowing regional branch pricing.

### 6.4 Admin Dashboard & Role-Based Operator Console Standard

> Full dashboard IA, KPI formulas, chart rules, and screen contracts: [indonesia-beauty-clinic-admin-dashboard-standard.md](indonesia-beauty-clinic-admin-dashboard-standard.md)

A compliant beauty clinic system separates **7 role-specific operator surfaces** rather than giving every staff member one generic revenue dashboard:

1. **Executive / Owner BI Console**: Separates **Omzet Kas Diterima (Cash Collected)** from **Pendapatan Terealisasi (Earned Revenue)** and **Saldo Utang Paket & Deposit (Unearned Liability)** at the top level; tracks Gross Margin after BHP & Commissions (target 55%–70%), Cabin & Laser Device Utilization % + RevPARH, Consult-to-Treatment Conversion %, Rebooking & 2nd-Visit Retention (solving the 37% first-rebook drop-off), and Homecare/Rx Attach Rate. **Strict UU PDP Boundary**: Owners, Managers, Finance, and Receptionists are blocked from viewing raw patient clinical photos or doctor diagnosis notes.
2. **Medical Director Governance & Maker-Checker Inbox**: Two-person integrity (`Maker != Checker`) queue for approving clinical catalog protocols, co-signing `> 2×24h` RME addenda (Permenkes 24/2022 Pasal 30), auditing `RED` ($\le 15\text{m}$) post-procedure complication triage, and signing off Doctor-to-Nurse delegation rules (`PP 28/2024 Pasal 745`).
3. **Front-Office 4-Resource Calendar & Live Queue Workbench**: Split-pane atomic 4-resource timeline (`Doctor + Nurse/Beautician + Cabin/Bed + Laser Machine`) paired with a live clinic status queue (`BOOKED_TODAY` $\rightarrow$ `ARRIVED_CHECKED_IN` $\rightarrow$ `IN_CONSULTATION` $\rightarrow$ `IN_CABIN_TREATMENT` $\rightarrow$ `AT_PHARMACY_OR_CASHIER` $\rightarrow$ `RELEASED_NO_SHOW`), shared-phone family profile picker, and `IDENTITY_PENDING` SATUSEHAT outbox handling.
4. **Doctor & Nurse Clinical RME Workbench**: Tablet-friendly (`>= 44px` hit targets) 3-zone clinical canvas featuring high-contrast contraindication badges, GAGS/mMASI calculators, side-by-side 5-angle Before/After viewer with ghost overlay and auto `COMPARABLE` grading, consented dose envelope check, Interactive Face/Body Map, and 48-hour edit-lock countdown.
5. **Pharmacy (*Instalasi Farmasi*), *Etiket Biru* & Open-Vial BUD Workbench**: 7-point prescription check queue, 75% days-supply refill cooldown alert, 1-click thermal *Etiket Biru* + BUD printer, live **Open-Vial BUD countdown table** (auto-locking lapsed 24h toxin vials), and **Daily Blind Stock Opname** (hiding system balance until physical count is submitted).
6. **Cashier POS, Entitlement & Shift-Close Workbench**: Pulls verified RME procedures and pharmacy items, enforces pro-rata installment session unlocking, displays Kode 08 (`bebas_medis`) vs. Kode 04 (`PPN 11% efektif DPP 11/12`) tax splits, previews the 5-stream commission snapshot, and enforces blind **Cashier Shift Close (*Tutup Kasir*)**.
7. **Indonesian Localization & Multi-Timezone Discipline**: Whole-Rupiah `tabular-nums` formatting (`Intl.NumberFormat('id-ID')`), explicit **`WIB` / `WITA` / `WIT`** timezone badges on all appointments, BUD timers, and SLA countdowns across multi-region branches, and immutable posted financial/clinical rows.

### 6.5 Black-Magic (`rea-agents`) Live Runtime Findings & System Blueprint Summary

> Raw REA browser & network scenario evidence: [`docs/research/background/rea-scenarios-2026-10/`](rea-scenarios-2026-10/) | Full synthesis: [indonesia-beauty-clinic-admin-dashboard-standard.md §8](indonesia-beauty-clinic-admin-dashboard-standard.md#L384-L505)

Live read-only reverse engineering (`rea capture-browser-scenario`) across top Indonesian clinic chains and SaaS platforms uncovered concrete production patterns for our platform:

- **ZAP Clinic (`ev_e7cdea8d...`, `ev_0aa8352f...`)**: Runs on **Laravel + Livewire + Vite + Vue 3**, uses `GET /data/list-city-outlet?limit=8&q=` for its 2-step city-to-outlet booking selector, embeds **Qiscus Omnichannel v4** (`goqcg-emgpj9ffinotwfa/126903`), and enforces strict booking SLAs (**arrive 15m early; $<5\text{m}$ remaining forfeits slot to walk-ins; $\ge 3\text{h}$ reschedule cutoff**).
- **ERHA Ultimate (`ev_4ea57685...`)**: Decouples its public **Botble CMS** site from PT Arya Noble's central booking gateway (`https://connect-digital-lounge.aryanoble.co.id/verify?sourceValue=Web%20EU&branchId=<id>`), embeds **Sarana AI** (`/api/widget-embed-config`, `/api/search-prompts`), and splits clinical journeys into `Heal Me` (medical dermatology) vs. `Uplift Me` (aesthetic contouring) across sub-brands (`erha-central`, `riserva`, `Erhair Clinic`, `revivederm`).
- **Natasha Skin Clinic (`ev_5a0fff10...`)**: Runs **WooCommerce 11.0.1** with **Phone-Number OTP authentication** (`login-with-phonenumber.js`) and a mandatory **14-Region Pricelist Gate** (*Ambon, Bali, Banten, Jabodetabek, Jawa Barat, Jawa Tengah, Jawa Timur, Jayapura, Kalimantan, Nusa Tenggara, Sorong, Sulawesi, Sumatra, Yogyakarta*).
- **ClinicHub OS (`ev_81b63ff5...`) & Klinik Pintar (`ev_212429b1...`)**: ClinicHub's live interactive demo explicitly separates **Collection / Uang Masuk (`Rp 248 jt`)** from **Omzet Invoiced (`Rp 292 jt`, `Rp 44 jt belum lunas` piutang gap)**, uses an **On-Demand Token-Saving AI Summary** (runs only on `Generate` click to flag `>90d` dormant patients and birthday promo ROI), and tracks a **0–100 Skin Score (`72/100 (+6)`)** on the RME card linked to invoice `#INV-2043`. Klinik Pintar's commercial tiers confirm that **Multi-Branch Clearing, Split Commissions, Tele-Consultation, and Branch Microsites** are the primary enterprise value drivers.
- **Anti-Fraud & Kemenkes Accreditation Moat**: Combining **Hardware Laser/HIFU Handpiece Shot-Counter Reconciliation** (blocking unbilled staff "ghost treatments"), **`PRATAMA` vs. `UTAMA` catalog gates**, **`STR/SIP/SIPA` expiry auto-blocks**, ***Limbah B3* TPS manifests**, and automated **4 Mandatory INM (`Permenkes 30/2022`) + IKP** dashboards gives our platform an enterprise governance moat that no local off-the-shelf SaaS currently matches.

---

## 7. Data gaps and next steps

| Gap | Why it matters | Suggested method |
|---|---|---|
| Current branch counts for LBC, Bening's, MS GLOW, Ella, Larissa, DermiesMAX | Sizing and competitive density | Scrape official directories and reconcile with Google Maps listings |
| Comparable price basket | True price positioning | Mystery-shop 5 standard treatments (basic facial, acne facial, chemical peel, laser rejuvenation, botox per unit) in one city |
| Ownership and funding of SOZO, NMW, Airin, DNI, Miracle | Competitive threat assessment | AHU company registry, press, LinkedIn |
| Review ratings and volume per branch | Service quality and demand proxy | Google Maps data sample per brand |
| Social reach (Instagram, TikTok) | Acquisition channel strength | Follower count and engagement snapshot |
| Market size | Sizing context | Arizton and DataBridge estimates (secondary, unopened): medical aesthetics ~US$244–257M (2023–2024), ~9.5–11.6% CAGR; buy or verify before citing |

Open question for the next iteration: what is this research for (opening a clinic, marketing a client, building a booking product, or investment screening)? The answer sets which gaps to close first.

---

## 8. Sources (accessed 2026-10-29)

- Natasha branch directory — https://natasha-skin.com/daftar-cabang/
- Natasha price list (regional) — https://natasha-skin.com/pricelist/
- Natasha 31 years, ~200 branches — https://kombi.id/read/2026/06/24/31-tahun-jadi-pionir-estetika-natasha-kenalkan-plasma-vsels-2/
- ZAP about — https://www.zapclinic.com/about-us
- ZAP home (bundles from 499k) — https://www.zapclinic.com/
- ZAP treatments (facial prices) — https://zapclinic.com/treatments?filter=Facial+Treatment&page=2
- ZAP Premiere FAQ (from IDR 399k, dermatologist per location) — https://premiereclinic.id/faq
- ERHA Ultimate launch, 109th branch, 58 cities — https://health.detik.com/berita-detikhealth/d-7254462/erha-ultimate-intelligent-dermabeauty-clinic-pertama-di-indonesia
- ERHA Ultimate clinic finder — https://erhaultimate.co.id/find-clinic
- ERHA Ultimate treatment prices (secondary) — https://blog.alfagift.id/jenis-dan-harga-treatment-wajah-di-berbagai-klinik-kecantikan/
- DermiesMAX FAQ (Rp275k–1.2M) — https://dermiesmax.co.id/pertanyaan-umum
- Athena about — https://athena-shop.id/about-us
- MS GLOW clinic — https://msglowclinic.id/
- PT Kosmetika Klinik Indonesia — https://ptkki.id/
- Larissa about — https://larissa.co.id/about ; https://www.larissa.co.id/
- Larissa 50+ branches — https://www.krjogja.com/kesehatan/1247426774/42-tahun-larissa-setia-hadirkan-perawatan-wajah-dan-kulit-lintas-generasi
- Larissa 40 years — https://jogja.antaranews.com/berita/693285/berusia-40-tahun-larissa-berkomitmen-jadi-klinik-estetika-natural-terbaik
- Bening's group — https://beningspratamagrup.id/portfolio.html
- Bening's branch #40 and 100 target — https://www.radarbanten.co.id/2023/03/22/benings-clinic-buka-cabang-ke-40-di-kota-serang/
- Bening's branch #71 — https://www.instagram.com/dr.okypratamaa/reel/DCRXk6yvFPr/
- Naavagreen branches — https://naavagreen.com/daftar-cabang/
- Naavagreen sensitive treatments — https://naavagreen.com/perawatan-sensitif/
- Naavagreen from Rp50k — https://iniborneo.com/2023/09/17/berjalan-6-tahun-naavagreen-konsisten-utamakan-pasien/
- Ella clinics — https://ellaskincare.co.id/klinik
- Ella history and cities — https://mettanews.id/ella-skin-care-bukti-cantik-dan-sehat-itu-nggak-harus-mahal/
- LBC 2025 — https://www.vartadiy.com/v-jogja/44015572354/dulu-sederhana-kini-layanan-lbc-serba-online
- LBC 47 branches / 36 cities (2014) — https://ekbis.harianjogja.com/r-527121/lbc-dukung-wisata-belanja-di-jogja
- LBC Linktree — https://linktr.ee/londonbeautycentreofficial
- Miracle clinics — https://www.miracle-clinic.com/clinics
- Esther about — https://esther.id/en/about/
- NMW branches — https://www.nmwclinic.co.id/branches
- SOZO about — https://sozoskinclinic.com/tentang-kami/
- Airin locations — https://airinskinclinic.com/our-location/
- DNI branches — https://skincentrebali.com/cabang.html
- Gloskin about — https://gloskin.id/about/
- Market size (secondary) — https://www.arizton.com/market-reports/indonesia-medical-aesthetics-market
- Permenkes No. 24 Tahun 2022 (Rekam Medis) — https://keslan.kemkes.go.id/unduhan/fileunduhan_1662611251_882318.pdf
- SATUSEHAT Platform MPI & FHIR R4 — https://satusehat.kemkes.go.id/platform/docs/id/master-data/master-patient-index/pasien-no-nik/
- UU No. 17 Tahun 2023 (Kesehatan Ps. 290, 293) & PP No. 28 Tahun 2024 (Ps. 745) — https://pasal.id/peraturan/uu/uu-no-17-tahun-2023 ; https://pasal.id/peraturan/pp/pp-no-28-tahun-2024/pasal-745
- Permenkes No. 34 Tahun 2021 & No. 73 Tahun 2016 (Kefarmasian Klinik/Apotek & Etiket Biru) — https://pasal.id/peraturan/permen/permenkes-no-34-tahun-2021
- BPOM Blue-Label Compounding Rules — https://www.pom.go.id/siaran-pers/penertiban-skincare-beretiket-biru-yang-tidak-sesuai-ketentuan
- UU No. 27 Tahun 2022 (Pelindungan Data Pribadi / UU PDP) — https://peraturan.bpk.go.id/Download/224884/UU%20Nomor%2027%20Tahun%202022.pdf
- DJP Beauty Clinic PPN & PMK 131/2024 (DPP Nilai Lain 11/12) — https://news.ddtc.co.id/berita/nasional/1796606/jasa-klinik-kecantikan-kena-ppn-begini-penjelasan-kring-pajak ; https://pajak.go.id/id/artikel/pmk-1312024-tarif-ppn-sebelas-dua-belas
- Indonesian Aesthetic SIMKlinik Vendors — Aesta by Assist.id (https://assist.id/), ICONIX (https://www.iconix.id/fcantik.html), ClinicHub OS (https://clinichub.id/software-klinik-kecantikan), Aplikasi Klinik Pintar (https://klinikpintar.id/aplikasiklinik/fitur/kecantikan/detail), Medeva (https://medeva.tech/), Aoikumo (https://www.aoikumo.com/), Zenoti (https://www.zenoti.com/)
