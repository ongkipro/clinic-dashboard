# Indonesia Beauty Clinic Market — Re-Review, Brand Breakdown and Black-Magic (REA) Evidence

- Date: 2026-11-02 (Asia/Jakarta)
- Status: research artifact. Not a PRD, MVP scope, legal opinion, or implementation report.
- Purpose: re-review the 29–31 October research set, extend the brand list beyond the original 20, capture fresh read-only REA evidence for every reachable brand, and record which earlier claims hold, changed, or were never proven.
- Companion files (not replaced; this file supersedes their brand facts where they conflict):
  - `../beauty-clinic-research.md` (20-brand landscape, Draft v2)
  - `../indonesia-beauty-clinic-admin-dashboard-standard.md` (T2/Gemini dashboard standard, §7–§8)
  - `../indonesia-clinic-management-system-standard.md` (T2/Gemini system standard)
  - `beauty-clinic-admin-system-research.md` (first REA pass, SaaS anatomy)
  - `BEAUTY-CLINIC-SYSTEM-BLUEPRINT.md`, `SESSION-HANDOFF-2026-10-30.md`, `OPERATIONAL-SCENARIO-AUDIT.md`
- New evidence directory: `rea-2026-11/` (`*.json` scenario, `*.evidence.json` REA envelope, `summary.json`, `extract.txt`, `run.sh`, `targets*.txt`)

---

## 0. Method, evidence labels and boundary

### 0.1 Method

1. Re-read the existing research set and listed every factual claim used for brand breakdowns.
2. Expanded the brand universe with web search (official sites, dated press, SWA industry article of 28 Dec 2025).
3. Ran `rea-agents@6.8.0 capture-browser-scenario` on each reachable official site: Chromium 156 headless, 1440×900, `id-ID`, `Asia/Jakarta`, 8 s settle, capture = URL + accessibility tree + network metadata.
4. Counted branches from official directories where the directory rendered (DOM, accessibility tree, or a public JSON/GeoJSON the page itself loads).
5. Spot-checked the regulatory anchor most often cited downstream (Permenkes 24/2022).

### 0.2 Labels

| Label | Meaning |
|---|---|
| **OBS** | Observed in an REA Evidence record captured 2026-11-02 (Evidence ID prefix cited) or a public file the page itself loads |
| **CNT** | Counted from an official branch directory on 2026-11-02 |
| **DOC** | Stated on an official brand/vendor page |
| **PRESS** | Dated third-party article; figure is the brand's claim as reported |
| **INF** | Analyst inference; not a fact |
| **UNV** | Present in earlier research but not verified in this pass; do not reuse externally |

### 0.3 Boundary

Passive and read-only: public pages any anonymous visitor receives. No login, account, form submission, OTP request, API call to a discovered endpoint, enumeration, or bot-check bypass. Network capture had `request_body`, `response_body` and `header_values` all `false`. Sites that served a bot-verification interstitial were recorded as such and not retried with evasion. Phone numbers below are public CS/WhatsApp numbers printed on the brand's own page.

---

## 1. Executive findings

1. **The earlier "Top 20" holds as a core set, but it is not "all beauty clinics in Indonesia".** SWA (28 Dec 2025) estimates 4,227 beauty-specific clinics in 2023 → 4,461 in 2024 → 4,734 in 2025 (PRESS). The long tail is thousands of single-site or franchise outlets. This document covers **31 named brands/groups in 3 tiers** (plus one excluded false match): national chains, regional/mid chains, and franchise/emerging networks.
2. **Branch counts moved and several were wrong or stale.** Naavagreen now lists 80 (was 75). Larissa's own GeoJSON has 47 clinics (earlier "50+"). Natasha's directory still lists 104 while press cites 189 (May 2025). ERHA reached 113 clinics in 58 cities (Sep 2025, PRESS). Bening's is reported at 74 without franchise (Jul 2026, PRESS). SOZO now claims 80+. New large networks missing from the old set: **Oriskin (70+ claimed, 62 listed)**, **B Clinic (46, PRESS)**, **Madeena (30+, PRESS)**, **Kezia Facial Spot (29 listed)**, **L'VIORS (15 listed)**, **Clarice (20 listed)**, **Eudora (17, PRESS)**.
3. **Booking reality is still WhatsApp-first.** Among brands with a reachable official site, only 7 show a structured booking/identity layer (ERHA Ultimate and DermiesMAX via Digital Lounge, ZAP, Natasha and Naavagreen via Hepta CRS, NMW portal, Oriskin WA-number login). Everyone else converts through `wa.me` links, often per-branch (L'VIORS 26 numbers, LBC 41 links).
4. **Several earlier "facts" about internal systems are unsupported.** Natasha "member app with live queue", Larissa "native mobile app", Ella Channel "tele-triage", and AirinPay "Primary/Priority/VIP" tiers were never observed. Arya Noble running RISE with SAP is confirmed (SAP press). **Correction 2026-11-02:** ZAP on Booker (Mindbody) *is* confirmed — 119 of 133 outlets in the public booking page link to `go.booker.com` (see `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` §1.1). Treat the five archetypes in the dashboard standard as hypotheses, not evidence.
5. **Phone-first identity is the dominant pattern where identity exists.** Natasha uses phone login (WooCommerce plugin, earlier capture). Oriskin's app logs in by WhatsApp number only. DermiesMAX uses WhatsApp OTP. NMW is the outlier with email + password.
6. **Session replay and ad pixels on health-intent pages are common.** Microsoft Clarity, Hotjar or Contentsquare load on Natasha, Naavagreen, ERHA Ultimate and Miracle. Meta, TikTok and Google Ads pixels are near-universal. This is a privacy-design lesson for our build, not a legal finding about those brands.
7. **Public web hygiene is weak across the category**: 404 branch page (Larissa `/about/branch`), Ella's clinic directory renders 6 of a claimed 38, ERHA main domain 503, Athena's old shop domain no longer resolves, Werisa's domain is parked, and Esther, Airin, Ghanisa and SKIN+ block automated visitors.

---

## 2. Re-review of the existing research

### 2.1 What still holds

| Claim | Status | Evidence |
|---|---|---|
| ERHA Ultimate routes booking to a central Arya Noble gateway with `sourceValue` + `branchId` | **Holds** (OBS) | `ev_7265ab2aab4da347` — 7 links to `connect-digital-lounge.aryanoble.co.id/verify?sourceValue=Web%20EU&branchId=…` (IDs 847, 941, 942, 944, 962, 1075) |
| ERHA Ultimate embeds Sarana AI search | **Holds** (OBS) | same; `erha-production.sarana.ai/api/search-prompts`, `/api/widget-embed-config` |
| ERHA Buddy app | **Holds** (OBS) | App Store `id1507965731`, Play `id.erha.userapp` linked from page |
| Arya Noble on RISE with SAP | **Holds** (DOC) | SAP SEA News, Feb 2024: selected end Q3 2023; FI, CO, MM, WM, PP, SD, QM, PM |
| ZAP on Laravel Livewire + Qiscus omnichannel widget | **Holds** (OBS) | `ev_fdc41371752bb975`; Qiscus public-widget config call; WA `6281901500310` |
| Natasha and Naavagreen book via Hepta CRS white-label form | **Holds** (OBS) | `ev_c4454d7eb574125f` and `ev_d62b5c2d9bc43d00` link to `crs.hepta.co.id/booking-apps/{natasha|naavagreen}/form` |
| Natasha custom WP REST | **Holds** (OBS) | `/wp-json/natasha/v1/slider` |
| NMW first-party event API and `my.` portal | **Holds** (OBS) | `api.nmwclinic.co.id/v2/public/events`; portal `ev_977cf2b062990127` login with email + password |
| DermiesMAX on Next.js + Strapi | **Holds** (OBS) | `ev_d41a9c339550397b`; `cms.dermiesmax.co.id/api/{dermies/config,faqs,artikels,analytics}` |
| Ella media from a bucket named `ella-staging` | **Holds** (OBS) | `ev_dd4e13056fbc7ba6`; host `ella-staging.storage.googleapis.com` |
| Larissa branch map from public GeoJSON on OSM tiles | **Holds** (OBS) | `ev_2ff6d388cb0333c4`; `/api/clinics.geojson` = 47 features |
| DNI 15 branches (14 Bali + Bekasi) | **Holds** (CNT, OBS) | `ev_b56dd463717deea3` heading "15 Cabang, Selalu Dekat"; directory page |
| NMW 17 listed locations | **Holds** (CNT) | `/branches` "17 Lokasi"; homepage copy now says "18+ cabang" |
| Miracle 19 locations (16 MAC + 3 Ultimate) | **Holds** (CNT, OBS) | `ev_2b31a19cd5085667` — 19 clinic headings across 7 regions |
| Gloskin 7 branches | **Holds** (DOC) | `/about` "tujuh cabang … Jakarta, Bekasi, Surabaya, Bali, dan Banjarmasin" |

### 2.2 What changed

| Item | Old research | Now | Source |
|---|---|---|---|
| Natasha footprint | 104 listed / ~200 press | 104 still listed; 189 reported May 2025 | CNT + PRESS (krjogja) |
| ERHA | 109th branch, 58 cities (Mar 2024) | 113 clinics, 58 cities (Sep 2025) | PRESS (ayosemarang) |
| Naavagreen | 75 listed | **80 listed** | CNT `naavagreen.com/daftar-cabang/` |
| Larissa | 50+ (press) | **47** in official GeoJSON (incl. 3 "Larissa Nature"); 45 reported Dec 2024 | OBS + PRESS (inews) |
| Bening's | 45 vs 71–74 conflicting | 74 reported Jul 2026, "tanpa franchise"; operating entity **PT Bening's Glow Indonesia** (site `beningsglow.com`) | PRESS (olenka) + OBS `ev_d113fcc72b046dfd` |
| Ella | 20+ cities | 30th branch May 2025; 38 in 2026 (press); **official directory renders only 6** | PRESS + CNT |
| SOZO | 75+ claimed | **80+ claimed**; 12 city filters on `/lokasi/` | DOC |
| Athena | `athena-shop.id`, 50+ | `athena-shop.id` **no longer resolves** (DNS fail); clinic site now `new-goddessk.in` (Palembang HQ, links to `drhenclinic.com`) | OBS `ev_04034338dfcb63aa` |
| MS GLOW branches | 8/14/16 conflicting | Homepage lists **7 cities** (Malang, Surabaya, Bandung, Sidoarjo, Bekasi, Depok, Yogyakarta) | OBS `ev_beb2fd5e3f6382ee` |
| ZAP | "Booker/Mindbody" backbone | Own app: Play `com.zapclinic.app.refactor`, App Store `id6754018898`; **Correction:** outlet booking links go to `go.booker.com` (119/133 outlets) — Booker confirmed | DOC `/mobile-apps` + OBS `bundles/zap/booking.html` |
| LBC | ~27 branch WA links | **41 per-branch WA links** on Linktree | OBS `ev_87a9ab00a61ea1cc` |

### 2.3 Unverified claims to stop reusing (UNV)

These appear in `../indonesia-beauty-clinic-admin-dashboard-standard.md` §7 or `../beauty-clinic-research.md` §2 and were not supported by any observed page, document or press source in either pass:

- ~~ZAP uses Booker/Mindbody~~ (now confirmed, see correction above); ZAP Series cross-branch inter-branch clearing ledger (cross-branch redemption itself is plausible; the ledger design is INF).
- Natasha mobile member app with queue monitoring; Natasha/Naavagreen "regional ERP".
- Larissa native Android/iOS app with points and e-commerce pickup (site has member login + cart; app not observed).
- Ella Channel as pre-visit tele-triage (Ella has an `ella-channel` page in its build data; its function was not observed).
- AirinPay as a wallet with "Primary/Priority/VIP". Official Airin page lists **Primary, Advance, Priority, VIP** tiers; AirinPay mechanics not observed.
- Miracle franchise/JV governance; DNI doctor rotation and shared island pharmacy hub; SOZO partner lot traceability; Esther four-class tax split. All INF dressed as fact.
- Bali "WITA cluster" and dermatologist-at-every-branch claims beyond what each brand states.

Regulatory figures in the T2 standards (BUD day counts, five consent purposes, INM thresholds, Coretax codes 04/08, DPP 11/12) were **not re-verified in this pass**. Only Permenkes 24/2022 was spot-checked:

- Pasal 39(1): EMR stored **at least 25 years from the patient's last visit**; Pasal 39(2) allows keeping it longer when still used. (Verified against the article text.)
- Pasal 30(5)–(6): input errors corrected by the authorized health worker/administrator **no later than 2×24 hours from input**. A secondary summary says further approval applies beyond that for administrative data. The T2 phrasing "immutable after 48h, requires co-signed addendum" is **an interpretation, not the article text**. Confirm with the clinic's legal/clinical lead before encoding it.

---

## 3. Brand universe (31 brands/groups)

Tier A = national chains (≥40 outlets or national group). Tier B = regional/mid chains (7–40). Tier C = franchise/emerging or single-region networks. Counts are dated snapshots and count different units (clinic, outlet, sub-brand).

### 3.1 Master list

| # | Brand | Group / entity | Tier | Footprint (best evidence) | Evidence | Positioning |
|---|---|---|---|---|---|---|
| 1 | Natasha Skin Clinic | Natasha Group (dr. Fredi Setyawan) | A | 104 listed; 189 (May 2025 press) | CNT + PRESS | Mass medical, Aceh–Papua |
| 2 | Naavagreen (+ Naavagreen Plus) | Natasha Group; site footer **PT Pesona Natasha Gemilang** | A | 80 listed | CNT | Natural, low price |
| 3 | ERHA (Clinic / Ultimate / Central / Erhair / Revivederm) | PT Arya Noble | A | 113 clinics, 58 cities (Sep 2025); finder 19 pages, 61 city filters | PRESS + DOC | Dermatology-led national |
| 4 | DermiesMAX by ERHA | PT Arya Noble | A (sub-brand) | Not published as a total | — | Youth/acne entry tier |
| 5 | ZAP Clinic | ZAP Group (PT Zulu Alpha Papa) | A | 100+ outlets | DOC | Laser, hair removal, bundles |
| 6 | ZAP Premiere / MEN/O/LOGY / JUVA / ZAP Health | ZAP Group | A (sub-brands) | Not totalled | DOC | Premium / men / product / health |
| 7 | Bening's Clinic | PT Bening's Glow Indonesia; PT Benings Pratama Grup | A | 74 (Jul 2026 press, no franchise) | PRESS | Founder-led, laser-heavy |
| 8 | SOZO Skin Clinic | Not verified | A | 80+ claimed | DOC | Premium-promise chain, paylater 0% |
| 9 | Oriskin | **PT Gempita Damai Permai** | A | 70+ claimed; 62 listed (search snapshot); 35th–37th branches opened 2024 | DOC + PRESS | Affordable mall chain, app + AI skin check |
| 10 | Athena Beauty Clinic | Athena Group (dr. Richard Lee, dr. Reni) | A | 50+ claimed (old shop page; now unreachable) | UNV | Founder-led |
| 11 | Larissa Aesthetic Center | Larissa | B | 47 in official GeoJSON | OBS | Heritage, natural + "L" products |
| 12 | B Clinic Slimming & Aesthetic | B Group of Companies | B | 46 (Sep 2026 press) | PRESS | Body slimming + aesthetic |
| 13 | LBC (London Beauty Centre) | Anton Yuwono | B | 41 branch WA links | OBS | Facial + slimming, Java-heavy |
| 14 | Ella Skin Care / Ella Skin Clinic | Ella (Solo, 2008) | B | 38 (2026 press); 6 rendered on site | PRESS + CNT | Affordable, Central Java |
| 15 | Madeena Skin Clinic | Madeena (partnership model) | B/C | 30+ active (Jun 2025 press) | PRESS | Sharia/halal positioning, Linktree per branch |
| 16 | Kezia Facial Spot | Kezia Beauty | C | 29 spots listed + training center | CNT `ev_9540f4a8fa443d87` | Franchise facial spots, Sumatra–Papua |
| 17 | Clarice Beauty | Clarice (Mojokerto) | B | 20 listed, all East Java | CNT | Product-led, BPOM/halal |
| 18 | Miracle Aesthetic Clinic | Miracle | B | 19 (16 MAC + 3 Ultimate) | CNT | Facial architecture, premium tier |
| 19 | NMW Clinic | NMW | B | 17 listed; "18+" on home | CNT + DOC | Doctor-led, plastic surgery referral |
| 20 | Eudora Aesthetic Clinic | Eudora | B | 17 (12 Jakarta, 3 Batam, 2 Medan; Sep 2026 press); site shows 11 ID + Singapore | PRESS + OBS | Facial/slimming, partnership from Rp500M |
| 21 | DNI Clinic / DNI Skin Centre | DNI (Bali) | B | 15 (14 Bali + Bekasi); SWA says 12 | CNT | Affordable dermatology, liposuction |
| 22 | L'VIORS Beauty Clinic | L'VIORS (Surabaya HQ) | B | 15 headings, 26 WA numbers | CNT `ev_77d133555b4a8a95` | Mid-premium, 11 cities |
| 23 | Esther Aesthetic Clinic | Esther (Surabaya, 1994) | B | 13 claimed | UNV (site bot-gated) | HAMC herbal-medical |
| 24 | Airin Skin Clinic / Premier / Beauty Care | Airin Group | B | 12 unique (Oct pass) | UNV now (bot-gated) | Doctor-led, nutrition specialist |
| 25 | MS GLOW Aesthetic Clinic | PT Kosmetika Klinik Indonesia | B | 7 cities on home | OBS | Skincare-brand extension |
| 26 | Gloskin Aesthetic Clinic | dr. Nanang Masrani | B | 7 | DOC | Injectables, hair transplant |
| 27 | Ghanisa (Prime Aesthetic & Longevity) | Ghanisa | C | 8 clinics (SWA); "29+ partner outlets built" | PRESS + DOC | Partnership/halal, Kalimantan + Java |
| 28 | Werisa Clinic | Werisa (West Java) | C | 7–8 | PRESS; **domain `werisa.com` parked** | Regional |
| 29 | Dermaster Indonesia | Dermaster | C | 6 in Jakarta locator; 19 in 2023 press | CNT + PRESS | "No.1 aesthetic" claim, contouring |
| 30 | Kristie Aesthetic Clinic | Kristie (since 2014) | C | 3 named (Gading Serpong, Poris, Ciganjur) + Medan on directories | DOC | Affordable laser/facial |
| 31 | SKIN+ / Euromedica Group | Euromedica (2006) | C | Not counted; site bot-gated | UNV | Premium skin + slimming |
| — | Skinpedia | — | Excluded | `skinpediaandco.com` is a US (California) med-spa; the Indonesian Skinpedia (30-branch target, Rp300M partnership) needs a different official URL | OBS `ev_b27b544e7ce6842e` | — |

Not yet covered (candidates for the next pass): Youth & Beauty Clinic (2 sites, premium), Lviors-style Sumatra chains, Euromedica group brands, The Clinic Beautylosophy, regional Kalimantan/Sulawesi chains found via Heystetik directory (Profira, Kristie Medan, Karadenta), and hospital-owned aesthetic centres.

### 3.2 Segmentation (updated)

| Segment | Brands | Core promise |
|---|---|---|
| Dermatology-led premium | ERHA Ultimate, ZAP Premiere, Miracle Ultimate, NMW, Youth & Beauty | Specialist, devices, outcomes |
| Mass medical chains | Natasha, ZAP Clinic, ERHA Clinic, Bening's, SOZO, Oriskin | Coverage, bundles, mall presence |
| Natural / affordable regional | Naavagreen, Larissa, Ella, LBC, DNI, Clarice | Low price, natural ingredients |
| Body/slimming-led | B Clinic, LBC, Eudora, SKIN+/Euromedica | Slimming programs + aesthetic |
| Founder / product-led | MS GLOW, Bening's, Athena, Clarice | Brand audience → clinic |
| Procedural specialists | Gloskin, NMW (surgery), DNI LIPO, Miracle | Injectables, hair, surgery-adjacent |
| Partnership / franchise networks | Kezia, Madeena, Ghanisa, Eudora (partner) | Fast rollout via partner capital |
| Youth entry | DermiesMAX | Acne, affordable dermatology |

---

## 4. Black-magic (REA) evidence ledger — 2026-11-02

Each row: Evidence ID prefix (full ID in `rea-2026-11/summary.json`), request count, stack, conversion/identity channel, third-party tags. "Tags" means scripts or beacons that loaded during the 8 s capture, not necessarily all tags configured.

### 4.1 Tier A

| Brand / URL | Evidence | Req | Stack (OBS) | Conversion & identity (OBS) | Tags (OBS) |
|---|---|---|---|---|---|
| Natasha `natasha-skin.com` | `ev_c4454d7eb574125f` | 236 | WordPress + custom REST `/wp-json/natasha/v1/slider` | Hepta CRS booking form; "CS Online 24 Jam"; brand catalog | GTM/GA4, Google Ads, Meta, **Hotjar, Clarity, Contentsquare**, CF Analytics |
| Naavagreen `naavagreen.com` | `ev_d62b5c2d9bc43d00` | 201 | WordPress | Hepta CRS "Janji Konsultasi"; link to `naavagreenplus.com`; concern-based "Skin Solution Zone" (Acne, Bright & Glow, Slow Aging, Sensitif, Hair, Body) | GTM/GA4, Meta, TikTok, **Clarity**, CF |
| ERHA Ultimate `/find-clinic` | `ev_7265ab2aab4da347` | 291 | CloudFront assets (Botble CMS per Oct pass) | Per-branch "Buat Jadwal" → `connect-digital-lounge.aryanoble.co.id/verify?sourceValue=Web%20EU&branchId=` ; ERHA Buddy app; WA `6281121212121` | GTM/GA4, Google Ads, Meta, **Clarity**, Bing |
| ERHA `erha.co.id` | `ev_13659fecbd1c5744` | 3 | **HTTP 503** at capture (also seen Oct) | — | — |
| DermiesMAX | `ev_d41a9c339550397b` | 399 | Next.js + Strapi (`cms.dermiesmax.co.id/api/*`) | `/konsultasi-skin-expert` → Digital Lounge (WA OTP flow per Oct bundle read); `wa.link` | GTM/GA4, Google Ads, OptiMonk popups |
| ZAP `zapclinic.com` | `ev_fdc41371752bb975` | 260 | Laravel Livewire, S3 assets | `/online-booking` (city → outlet); Qiscus chat; marketplaces (Shopee, Tokopedia, Blibli); sub-brands MEN/O/LOGY, JUVA, Premiere | GTM/GA4, Google Ads, Meta, CF |
| ZAP Premiere | `ev_4d6fd86bd4208725` | 243 | Static + YouTube | Shared ZAP WA `6281901500310`; links `zaphealth.id`, `menologyclinic.com` | GTM/GA4, Google Ads, CF |
| Bening's `beningsglow.com` | `ev_d113fcc72b046dfd` | 330 | Custom (no framework tag detected) | Single WA `6285189000093` "Konsultasi GRATIS"; prices shown (Acne Combo Facial Rp555.000 → Rp388.500; Rp1.665.000 booster); 14 distinct city labels shown (Bogor, Cibubur, Gresik, Jember, Karawang, Malang, Samarinda, Sidoarjo, Solo, Tasikmalaya, Cirebon, Cilegon, Cimahi, Kudus); HQ Bandung | none detected |
| SOZO | `ev_e26f5ebbca19c2bf` | 64 | WordPress + `asset.` subdomain | WA `6285175225664` with prefilled promo text; "Bayar Pakai Paylater, Cicilan 0%"; 22 treatment families; Sp.D.V.E doctors named | GTM/GA4, CF |
| Oriskin `oriskin.co.id` | `ev_85a842a883ed487f` (home), `ev_b1d24f602d6b1a69` (about), `ev_6127821ca9a7f190` (app) | 288 / 260 / 180 | Next.js + Sentry; first-party API `/api/oriskin/catalog/{packages,products}`, `/api/oriskin/clinics`, `/api/oriskin/feedback/branches`, `/api/auth/token`; rewards service `be-voucher.oriskin.co.id/api/rewards/active` | "RESERVASI"; Membership, Paket, Produk; **"Skin Check AI" with face detection + liveness check**; `app.oriskin.co.id` login by **WhatsApp number only**; Play Store link; "Dipercaya 45000+ Pelanggan" | GTM/GA4, Meta, Sentry, CF |
| Athena `new-goddessk.in` | `ev_04034338dfcb63aa` | 263 | Bootstrap static | WA `6281279780002`; Shopee; Linktree; `drhenclinic.com`; Palembang HQ address | GTM/GA4, Google Ads, CF |

### 4.2 Tier B

| Brand / URL | Evidence | Req | Stack (OBS) | Conversion & identity (OBS) | Tags (OBS) |
|---|---|---|---|---|---|
| Larissa `larissa.co.id` | `ev_2ff6d388cb0333c4` | 519 | Custom PHP; Leaflet/OSM map from `/api/clinics.geojson` (fields: id, name, alias, slug, image, phone, phone_wa, address, location_id, googlemap) | Member login/register, cart; per-clinic WA in GeoJSON; `/about/branch` returns 404 (`ev_38c31f5b53a57ed7`) | GTM/GA4, Meta, TikTok |
| LBC (Linktree) | `ev_87a9ab00a61ea1cc` | 308 | Linktree | "Pilih WhatsApp Cabang": 41 branch links (Bogor … Banjarmasin) | Linktree SDKs |
| Ella `ellaskincare.co.id` | `ev_dd4e13056fbc7ba6` | 377 | Next.js static data (`_next/data/*/{klinik,promo,produk,buku-menu,buku-menu-platinum,ella-channel,before-after}.json`) | Price book ("buku menu", "platinum"); before-after page; directory data has 6 clinics | GTM/GA4, Google Ads, Meta, TikTok, Meta CAPI helper bucket, CF; media bucket `ella-staging` |
| Miracle | `ev_2b31a19cd5085667` | 291 | Custom + reCAPTCHA | Single WA `6282116700500`; `miraclebeautystore.com`, Tokopedia, Shopee; `miracle-academy.id` | GTM/GA4, Google Ads, Meta, **Clarity**, reCAPTCHA |
| NMW | `ev_b075dca96aba84e0` (site), `ev_977cf2b062990127` (portal) | 150 / 257 | Next.js; `api.nmwclinic.co.id/v2/public/events`; portal calls `legacy/profile/info/detail` and `api.ipify.org` | "Book an appointment"; portal login email + password; product store with strike prices and review counts; "Journey Package" (Acne, Melasma); "Plastic Surgery" category | GTM/GA4, CF |
| Eudora | `ev_962e317c617b67c6` | 363 | WordPress + Elementor | Location list (Batam ×3, Jakarta ×3, Tangsel ×2, Cibubur, Medan ×2, Singapore Chinatown); "Pilih CS WA"; offers IDR 299.000 / 580.000; affiliate signup | GTM/GA4, Google Ads, CF, `geolocation-db.com` |
| DNI | `ev_b56dd463717deea3` | 138 | Next.js | WA `6281138116933` for clinic and **DNI LIPO** (liposuction); "Harga Terjangkau & Transparan"; "Ditangani dokter spesialis, bukan sekadar terapis" | none detected |
| L'VIORS | `ev_77d133555b4a8a95` | 327 | Next.js + Google Maps; `/indonesia-province.json` (province GeoJSON for map) | Per-branch WA: 26 numbers, separate "appointment" and "konsultasi" prefills | CF |
| Clarice | `ev_652b77a12e597b8f` | 385 | WordPress + Elementor (`wp.` subdomain) | Marketplaces (Tokopedia, Shopee, TikTok); 20-branch "Temukan Kami" page | Google Ads |
| MS GLOW Clinic | `ev_beb2fd5e3f6382ee` | 132 | Custom PHP (`index.php`) | WA `6281138819199` "Chat Only"; 7 branch cities with Maps links; services: consultation, Skin Analyzer, treatment, product | GTM/GA4, Google Ads |
| Gloskin | `ev_1afd8c1c3b7adfb8` | 210 | WordPress | Single WA `6281211218383` with **per-treatment prefilled text** (Botox, Face Contour HA Juvéderm, Thread Lift, Hair Transplant, Eyebag Removal, Body Contour) | none detected |
| Kezia Facial Spot | `ev_9540f4a8fa443d87` | 258 | Custom + Google Maps embed | "Our Spot" lists 29 locations + Bandung training center; "Join Kemitraan"; 3 WA numbers | GA/GTM, Meta, TikTok |
| Madeena (Sukabumi Linktree) | `ev_63f151aa157c84ce` | 240 | Linktree | Per-branch Linktree → WA, IG, Maps; "Halal & Natural" | Linktree SDKs |
| Kristie | `ev_35be78664babe963` | 129 | Static + jQuery | WA `628112674355` + `wa.link`; "Since 2014" | GTM/GA4, Meta, CF |
| Dermaster | `ev_e92ab845c1460f40` | 396 | Next.js + REST `api.dermaster.co.id/api/v1/*` (doctors, expert-results, menus, pages, visitors); ImageKit | WA `6281198893620`; `cabang.dermaster.co.id` locator (6 Jakarta) | GTM/GA4, Google Ads; client calls `api.ipify.org` |

### 4.3 Captures blocked or failed (recorded, not bypassed)

| Brand | Evidence | Result |
|---|---|---|
| Esther `esther.id` | `ev_f1feac0d9f23954c` | Bot-verification interstitial ("Mohon tunggu saat kami memverifikasi permintaan Anda…") |
| Airin `/our-location/` | `ev_e172bce4916c19f1` | Same interstitial (the Oct capture of the home page succeeded) |
| Ghanisa `ghanisa.id` | `ev_d17ec613b73a5899` | Same interstitial |
| SKIN+ `skinplusclinic.com` | `ev_a78aa048cfeaaf8b` | Same interstitial |
| B Clinic `bclinicslimming.com` | no Evidence (REA `execution_failure`) | DNS resolves; HTTP did not complete within the capture or a 20 s curl |
| Werisa `werisa.com` | `ev_d40c4633870eb995` | Parked domain (for-sale banner) |
| `athena-shop.id`, `beningsclinic.com` | REA `execution_failure` | `ERR_NAME_NOT_RESOLVED`; replaced by `new-goddessk.in` and `beningsglow.com` |

---

## 5. Per-brand breakdown

Format: **What it is** · **Footprint** · **Patient channel** · **Commercial model** · **System signals** · **Implication for our build**. Facts carry labels; implications are INF.

### 5.1 Natasha Skin Clinic
- **What**: mass medical aesthetic chain; group also owns Naavagreen and a manufacturing arm (DOC per earlier research; factory link not re-verified).
- **Footprint**: 104 numbered branches across Aceh–Papua (CNT); 189 cited May 2025 (PRESS). The gap probably counts outlets differently (INF).
- **Patient channel**: Hepta CRS form (name, WA, member code, email, branch, date, time, complaint; Oct pass) plus 24-hour CS (OBS).
- **Commercial**: regional price list gate with 14 zones (Oct OBS); member pricing.
- **System signals**: WordPress + custom REST; Hotjar, Clarity and Contentsquare on brand pages.
- **Implication**: region-scoped price books on one catalog; never load session replay on booking or complaint fields.

### 5.2 Naavagreen
- **What**: Natasha Group low-price natural brand; footer entity PT Pesona Natasha Gemilang (OBS).
- **Footprint**: 80 (CNT); Solo/Tegal and Trenggalek/Tulungagung share WA numbers (CNT).
- **Channel**: same Hepta CRS template as Natasha; concern-led navigation.
- **Implication**: shared CS numbers across branches mean the inbox must route by branch, not by phone number.

### 5.3 ERHA group (ERHA Clinic, ERHA Ultimate, DermiesMAX, sub-brands)
- **What**: PT Arya Noble; dermatology-led national chain with tiered sub-brands.
- **Footprint**: 113 clinics in 58 cities (Sep 2025 PRESS); finder 19 pages, 61 city filters (DOC).
- **Channel**: every booking button leaves the CMS for Arya Noble's Digital Lounge with `sourceValue` (channel attribution) and `branchId` (ERP routing) (OBS). ERHA Buddy app (OBS). DermiesMAX consultation through the same lounge with WA OTP (Oct bundle).
- **Systems**: RISE with SAP covering finance, materials, warehouse, production, sales, quality (DOC, SAP). Sarana AI search widget. Main `erha.co.id` 503 in both passes.
- **Implication**: booking as a central service with source and branch parameters is the cleanest pattern observed; copy it.

### 5.4 ZAP Group
- **What**: laser/hair-removal chain with Premiere (dermatologist), MEN/O/LOGY (men), JUVA (product), ZAP Health.
- **Footprint**: 100+ outlets (DOC).
- **Channel**: web booking city → outlet (`/data/list-city-outlet`, Oct OBS); native app; call center 1500 310 (DOC); Qiscus omnichannel; arrival 15 min early, <5 min remaining forfeits to walk-ins, ≥3 h reschedule (Oct OBS).
- **Commercial**: bundles "Facial + Laser + Product 3 in 1 mulai 499rb"; ZAP FEST 2026; pregnancy facial; marketplaces.
- **Systems**: Livewire web; app package `com.zapclinic.app.refactor` (suggests an app rewrite, INF). **Correction:** per-outlet booking on Booker (Mindbody) confirmed from the outlet master embedded in the booking page.
- **Implication**: explicit, published booking SLA rules are a product feature, not just policy text.

### 5.5 Bening's Clinic
- **What**: founder-led (dr. Oky Pratama), laser-heavy; PT Bening's Glow Indonesia, Bandung HQ (OBS).
- **Footprint**: 74, no franchise (Jul 2026 PRESS).
- **Channel**: one central WA, free doctor consultation pitch; prices visible with strike-through discounts (OBS).
- **Implication**: centralized WA intake for 70+ branches needs branch assignment, SLA timers and lead status. That is the CRM gap in most vendor products.

### 5.6 SOZO Skin Clinic
- **What**: premium-promise chain; Sp.D.V.E doctors named (OBS).
- **Footprint**: 80+ claimed (DOC).
- **Channel**: WA deep links with prefilled promo/source text (OBS; Oct pass saw `[src:…]` tags).
- **Commercial**: paylater and 0% installments, 22 treatment families including injectables and slimming devices (OBS).
- **Implication**: source tags in WA prefill text are a cheap attribution method that our lead inbox should parse.

### 5.7 Oriskin (new)
- **What**: affordable mall-based chain; PT Gempita Damai Permai (OBS).
- **Footprint**: 70+ claimed, 62 listed (DOC snapshot); about page shows a clinic list driven by `/api/oriskin/clinics` (OBS).
- **Channel**: "RESERVASI" button; separate app domain with **WhatsApp-number login**; Play Store app (OBS).
- **Commercial**: membership, packages and product catalog served from first-party APIs; active rewards from a voucher microservice (OBS).
- **Systems**: Next.js + Sentry; "Skin Check AI" advertising face detection and liveness check (OBS). A May 2026 viral complaint by a former doctor about practices was reported (PRESS, Poskota); not assessed here.
- **Implication**: the most product-like stack among mid-price chains; AI skin check plus WA identity is the consumer bar we will be compared against.

### 5.8 Athena Beauty Clinic
- **What**: founder-led (dr. Richard Lee, dr. Reni), Palembang HQ (OBS).
- **Footprint**: 50+ claimed earlier; current total UNV.
- **Channel**: one WA, Shopee, Linktree (OBS). Old e-commerce domain is dead.
- **Implication**: founder brands churn domains; keep canonical facility data in the system, not on marketing sites.

### 5.9 Larissa Aesthetic Center
- **Footprint**: 47 (OBS GeoJSON), Central/East Java heavy plus Bali, Kupang, Serpong, Tembilahan; 3 "Larissa Nature" outlets.
- **Channel**: member login/register, cart, per-clinic WA (OBS).
- **Implication**: a public branch GeoJSON is a simple, cacheable directory format; ours should come from the facility master, not a hand-edited page (Larissa's `/about/branch` is a 404).

### 5.10 B Clinic Slimming & Aesthetic (new)
- **Footprint**: 46th branch (PRESS 2025–2026); award "Medical Aesthetics Centre Chain 2026" (PRESS).
- **Evidence gap**: site not reachable by REA or curl in this pass.
- **Implication**: body-slimming programs need longitudinal body metrics (weight, circumference, body composition) in the record.

### 5.11 LBC
- **Footprint**: 41 branch WA links (OBS), Java + Bali, Manado, Medan, Balikpapan, Banjarmasin, Lampung.
- **Implication**: one Linktree per brand with 41 WA numbers is the "zero-system" baseline. A shared inbox with branch routing replaces it.

### 5.12 Ella Skin Care
- **Footprint**: 38 (2026 PRESS); site data has 6 (CNT). Directory is stale or partially published (INF).
- **Channel/commercial**: price books (`buku-menu`, `buku-menu-platinum`), before-after gallery, Ella Channel page (function UNV).
- **Implication**: publish branch data from the facility master; tiered price books (regular vs platinum) are common.

### 5.13 Madeena Skin Clinic (new)
- **Footprint**: 30+ active (PRESS, Jun 2025); sharia/halal positioning; partnership model; no central official site found, per-branch Linktree (OBS).
- **Implication**: partnership networks need multi-tenant isolation with a brand-level view. Franchisee data must not leak across partners.

### 5.14 Kezia Facial Spot (new)
- **Footprint**: 29 spots + Bandung training center (CNT), Medan to Biak Numfor and Jayapura.
- **Model**: franchise ("Join Kemitraan").
- **Implication**: small-format facial spots need a light POS/booking tier, not a full clinical EMR. Confirm whether they are licensed clinics at all before designing for them.

### 5.15 Clarice Beauty (new)
- **Footprint**: 20 outlets, all East Java (CNT); HQ Mojokerto.
- **Model**: product-led (BPOM, halal, no mercury claims) with marketplaces.

### 5.16 Miracle Aesthetic Clinic
- **Footprint**: 19 (CNT) across Jakarta, East Java, Bali & Lombok, Central Java & DIY, Sulawesi, Kalimantan, Sumatra & Riau.
- **Channel**: one WA; beauty store and academy (OBS).
- **Implication**: an academy/training arm hints at protocol standardization across sites (INF).

### 5.17 NMW Clinic
- **Footprint**: 17 listed, "18+" claimed; Surabaya site inside RSIA PUSURA Aesthetic Surgery Center (CNT).
- **Channel**: doctor-led booking; member portal with appointments, teleconsult, prescription payment, shop, courier tracking, points and vouchers (Oct bundle read); email + password login (OBS).
- **Commercial**: "Journey Packages" for acne and melasma; skincare store with review counts.
- **Implication**: closest public analogue to a full patient portal; journey packages map to our staged care plan.

### 5.18 Eudora Aesthetic Clinic (new)
- **Footprint**: 17 (PRESS Sep 2026); site shows 11 Indonesian locations + Singapore (OBS).
- **Model**: partnership from Rp500M (PRESS, FLEI 2026); affiliate program (OBS).

### 5.19 DNI Clinic
- **Footprint**: 15 (CNT); SWA reports 12 and expansion to Sumatra and Kalimantan (PRESS conflict).
- **Channel**: WA for clinic and DNI LIPO; transparent prices; specialist emphasis (OBS).

### 5.20 L'VIORS Beauty Clinic (new)
- **Footprint**: 15 headings across 11 cities (Surabaya HQ) (CNT).
- **Channel**: 26 per-branch WA numbers, separate appointment and consultation intents (OBS).
- **Implication**: intent-tagged WA links (appointment vs consultation) are an easy routing signal.

### 5.21 Esther, Airin, Ghanisa, SKIN+/Euromedica
- Sites served bot-verification pages; no new evidence. Keep the October facts as dated (Esther 13 claimed; Airin 12 unique; Ghanisa 8 clinics/29+ partner outlets; Euromedica since 2006).
- Airin tiers per official page: **Primary, Advance, Priority, VIP**. Airin Skin Premier clients get Priority or VIP automatically (DOC).

### 5.22 MS GLOW Aesthetic Clinic
- **Footprint**: 7 cities on the homepage (OBS). The MS Glow Smart Clinic app offers reservation and waiting-time information (DOC, App Store).

### 5.23 Gloskin, Dermaster, Kristie
- Gloskin: 7 branches, per-treatment WA prefill, injectables/hair transplant/eyebag focus (OBS/DOC).
- Dermaster: Next.js + versioned REST API, 6 Jakarta sites in the locator (CNT), 19 in 2023 press. Probable contraction or locator scope difference (INF).
- Kristie: WA-only, since 2014, 3–4 sites (DOC).

---

## 6. Cross-brand synthesis

### 6.1 Patient-channel maturity ladder

| Level | Pattern | Brands (OBS) |
|---|---|---|
| L0 | Linktree / per-branch WA list | LBC, Madeena |
| L1 | Single WA (± prefilled per treatment/promo) | Bening's, SOZO, Gloskin, Miracle, MS GLOW, Kristie, Dermaster, DNI, Athena |
| L2 | Per-branch WA with intent tags or directory | L'VIORS, Larissa, Eudora, Kezia |
| L3 | Booking form with outlet + slot check | Natasha, Naavagreen (Hepta CRS) |
| L4 | Central booking service + OTP identity + app | ERHA/DermiesMAX (Digital Lounge, ERHA Buddy), ZAP (web + app + call center), Oriskin (WA-number login + app) |
| L5 | Full patient portal (booking, teleconsult, Rx pay, shop, points, vouchers) | NMW |

INF: most of the market sits at L1–L2. A system that turns WA leads into booked, attributed visits covers the largest gap.

### 6.2 Identity

- Phone/WhatsApp as primary identity: Natasha, Oriskin, DermiesMAX (OBS). Email + password: NMW (OBS).
- Implication: model `1 phone → N patients` (family sharing a phone) from day one; OTP proves the phone, not the patient.

### 6.3 Commercial patterns

| Pattern | Evidence |
|---|---|
| Bundles and entry prices on the homepage | ZAP 499rb bundle; Bening's Rp555k → Rp388.5k; Eudora IDR 299k/580k |
| Paylater and 0% installments | SOZO (OBS) |
| Journey/series packages | NMW Acne/Melasma Journey; Oriskin packages API; ZAP Series (DOC) |
| Membership tiers | Airin (4 tiers), Oriskin membership, Natasha member pricing |
| Product + clinic + marketplace | ZAP, Miracle, Clarice, Athena, NMW store |
| Regional or tiered price books | Natasha 14 regions; Ella regular vs platinum |
| Partnership/franchise | Kezia, Madeena, Ghanisa, Eudora; Bening's explicitly not franchised |

### 6.4 Technology and privacy observations (lessons, not accusations)

- Session replay (Hotjar, Clarity, Contentsquare) loads on Natasha, Naavagreen, ERHA Ultimate and Miracle pages. Our build should keep replay off booking, consultation and complaint inputs and require consent before marketing pixels.
- Production media served from a `*-staging` bucket (Ella). Separate environments by account, not by name.
- Client-side IP lookup services (`api.ipify.org` on Dermaster and the NMW portal; `geolocation-db.com` on Eudora). Collect only what has a stated purpose.
- Directory drift: Ella (6 vs 38), Dermaster (6 vs 19), MS GLOW (7 cities vs older 8/14/16), Larissa 404. Facility data should have one source of truth with publish timestamps.
- Domain churn: Athena, Bening's, Werisa. Canonical brand URLs must live in config, not hard-coded links in content.

### 6.5 Implications for the beauty clinic system (INF, to calibrate with Paduka Ongki)

1. **WA lead inbox with branch routing, intent tags, source parsing and SLA**. Biggest observed market gap (L0–L2 brands).
2. **Central booking service** with `source` and `branch` parameters, slot check and phone OTP (ERHA pattern), plus published booking rules (ZAP pattern).
3. **Facility master → public directory/GeoJSON** to avoid drift.
4. **Price books by region or tier** on one catalog (Natasha, Ella).
5. **Journey/staged packages** aligned to the doctor's care plan (NMW, matches the confirmed handoff rules).
6. **Privacy-by-default tracking**: no replay on health inputs; consent-gated pixels; server-side conversions only from paid or completed events.
7. **Multi-tenant partner mode** only if franchise/partnership customers are a target (Kezia, Madeena, Ghanisa, Eudora). This is a scope decision, not a default.

These do not change the confirmed decisions in `SESSION-HANDOFF-2026-10-30.md`. They inform scope calibration.

---

## 7. Gaps and next pass

| Gap | Why it matters | Method |
|---|---|---|
| Bot-gated sites (Esther, Airin, Ghanisa, SKIN+) | Missing current evidence | Manual headed browse by a human, or official contact; no bypass |
| B Clinic site unreachable | 46-branch chain without system evidence | Retry from another network; check app stores |
| Indonesian Skinpedia official URL | Wrong target captured | Find the official Indonesian domain first |
| Ella, Dermaster true counts | Directory drift | Google Maps listings + brand IG highlights |
| Booking flow depth (slot rules, deposit, OTP) for ZAP app, Oriskin app, ERHA lounge | Shapes our booking engine | Read public app bundles statically (no login), as done for DermiesMAX/NMW in October |
| Regulatory figures in T2 standards | Downstream specs depend on them | Verify each article against JDIH/BPK text before encoding |
| Market size | Sizing | SWA cites 4,734 beauty clinics (2025 est.); verify against Kemenkes facility registry data |
| Kalimantan, Sulawesi, Sumatra regional chains | Coverage outside Java | Heystetik directory + Maps sampling |

---

## 8. Sources (accessed 2026-11-02)

Official/brand pages (also captured in `rea-2026-11/`): natasha-skin.com/daftar-cabang · naavagreen.com/daftar-cabang · erhaultimate.co.id/find-clinic · dermiesmax.co.id · zapclinic.com (+ /about-us, /mobile-apps) · premiereclinic.id · beningsglow.com · sozoskinclinic.com (+ /lokasi/) · oriskin.co.id/id (+ /about-us, app.oriskin.co.id) · new-goddessk.in · larissa.co.id (+ /api/clinics.geojson) · linktr.ee/londonbeautycentreofficial · ellaskincare.co.id/klinik · miracle-clinic.com/clinics · nmwclinic.co.id/branches · my.nmwclinic.co.id · eudoraclinic.com/en/locations · skincentrebali.com/cabang.html · lviors.com/locations · claricebeauty.co.id/temukankami · msglowclinic.id · gloskin.id/about · keziafacialspot.com/our-spot · linktr.ee/MadeenaClinicSukabumi · kristie.id · dermaster.co.id · cabang.dermaster.co.id · airinbeautycare.co/sistem-booking-slot

Press and documents:
- Natasha 189 branches — https://www.krjogja.com/gaya-hidup/1246076974/natasha-luxe-solusi-kecantikan-mutakhir-dengan-konsep-exclusive-luxury
- ERHA 113 clinics, 58 cities — https://www.ayosemarang.com/bisnis/7715944923/erha-resmikan-klinik-kulit-rambut-terbesar-di-jawa-tengah-hadir-di-jantung-kota-semarang
- Arya Noble RISE with SAP — https://news.sap.com/sea/2024/02/transforming-indonesias-skincare-in-the-cloud-arya-noble-embarks-on-a-digital-journey-with-rise-with-sap/
- Bening's 74, no franchise — https://olenka.id/punya-74-cabang-tanpa-franchise-ini-strategi-dr-oky-pratama-bangun-bisnis-benings-clinic
- B Clinic 46 — https://wolipop.detik.com/makeup-and-skincare/d-7983951/buka-cabang-baru-ke-46-b-clinic-perkenalkan-program-1-hari-1-kebahagiaan/amp ; https://posbekasi.com/2026/09/28/titi-kamal-wakili-b-clinic-terima-penghargaan-medical-aesthetics-centre-chain-2026/
- Ella 30th branch — https://www.sukabumiupdate.com/inspirasi/159296/ella-skin-clinic-resmi-hadir-di-sukabumi-jadi-cabang-ke-30-nasional ; Ella 38 — https://fyb.detik.com/insight/11445/strategi-ekspansi-klinik-kecantikan-agar-bisnis-makin-berkembang
- Larissa 45 (Dec 2024) — https://sleman.inews.id/amp/534738/40-tahun-larissa-aesthetic-center-siap-buka-cabang-di-sumatera-dan-kalimantan/all
- Oriskin 35th branch — https://siaranjabodetabek.com/klinik-kecantikan-oriskin-buka-cabang-ke-35-di-mal-artha-gading-jakarta/ekonomi-dan-bisnis/17757/.html ; Oriskin controversy — https://www.poskota.co.id/2026/05/10/pemilik-oriskin-siapa-viral-curhatan-mantan-dokter-soal-dugaan-praktik-klinik-kecantikan
- Madeena 30+ — https://www.akurat.co/health/797928/ingin-punya-klinik-kecantikan-tanpa-repot-madeena-hadirkan-solusi-bisnis-estetik-syari-dan-profesional
- Eudora 17 — https://harianpers.com/2026/09/03/penunjukan-toni-rms-h-m-h-kuasa-hukum-korporasi-eudora-aesthetic-clinic/ ; partnership — https://kompassindo.com/2026/10/09/eudora-aesthetic-clinic-tawarkan-kemitraan-klinik-kecantikan-mulai-rp500-juta-di-flei-2026/
- Dermaster 19 (2023) — https://biz.kompas.com/read/2023/07/09/161100128/buka-cabang-di-palembang-klinik-dermaster-indonesia-hadirkan-layanan-bintang-5
- Industry size and regional players — https://swa.co.id/read/467779/dari-glowing-ke-growing-bisnis-klinik-kecantikan-masih-menggiurkan-meski-persaingan-kian-ketat.md
- Kezia — https://brebesraya.com/2025/08/29/kezia-facial-spot-tawarkan-peluang-bisnis-kecantikan-dengan-roi-cepat-dan-pasar-luas/
- MS Glow Smart Clinic app — https://apps.apple.com/id/app/ms-glow-smart-clinic/id1643523920
- Permenkes 24/2022 Pasal 39 — https://api-law.crpg.info/peraturan/permenkes/24/2022/pasal/39 ; full text — https://jdih.kemkes.go.id/common/dokumen/2022permenkes024.pdf
