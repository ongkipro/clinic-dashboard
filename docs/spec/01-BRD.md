# Business Requirements Document (BRD) — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Product owner (Paduka Ongki) |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Downstream | 02-PRD.md |

## 1. Business Context

- Market: SWA (28 Dec 2025) estimates 4,227 beauty clinics in 2023, 4,461 in 2024, 4,734 in 2025 (Evidence, press; not independently verified). Chains above 40 outlets run their own stacks (ERHA on SAP, ZAP on Booker/Mindbody). Mid-size clinics (1–5 branches) use vendor SaaS (Assist/Aesta, ICONIX, Klinik Pintar, ClinicHub, Kasera) or spreadsheets.
- Gap (Proposal from research): no observed product combines decided package/balance money rules, an integrated ledger, own-WABA inbox with branch routing, and SATUSEHAT for this segment.
- Source research: `docs/research/` (market review, big-brand requirements, needs/architecture, compliance).

## 2. Business Requirements

| ID | Requirement | Owner | Measure | Status |
|---|---|---|---|---|
| BR-1 | Sell one multi-tenant platform to Indonesian beauty and aesthetic clinics with 1–5 branches through tenders, one brand per tenant; every new client is onboarded, never rebuilt; first client Numa Klinik (P-11, P-20) | Product owner (Paduka Ongki) | Numa Klinik live; then 5 live tenants | Decision |
| BR-2 | Let clinics meet RME and SATUSEHAT obligations through the product | Product owner (Paduka Ongki) | SATUSEHAT vendor verification; pilot delivery ≥ 99% | Decision |
| BR-3 | Give owners truthful money views: cash, completed service, prepaid obligations, receivables, margin after materials and commission, and books per SAK | Product owner (Paduka Ongki) | Accountant accepts posting map; zero drift | Decision |
| BR-4 | Charge each live tenant a monthly server fee (default Rp1,000,000, editable per tenant) from go-live, collected through the vendor's AutoLaris account; tender value is a contract reference; WhatsApp message costs billed by Meta directly to the clinic (P-14) | Product owner (Paduka Ongki) | Invoices paid by the 10th | Decision |
| BR-5 | Turn WhatsApp demand into attributed, booked, paid visits | Product owner (Paduka Ongki) | Lead SLA and conversion KPIs | Decision |
| BR-6 | Operate within Indonesian law on health records, personal data, electronic systems and tax, with qualified reviews | Product owner (Paduka Ongki) | Reviews recorded before Phase 2 | Decision |

## 3. Commercial Constraints

- Vendor prerequisites: legal entity with NIB, PSE registration, SNOMED CT licence, SATUSEHAT vendor registration, Meta Tech Provider status (DECISION-REGISTER S-03, W-02).
- Hosting: Vultr Singapore + Coolify + Cloudflare (H-01, H-02b); legal opinion on Singapore storage of RME before go-live (H-02d).
- Clinics pay Meta per message (marketing Rp586,33; utility/authentication Rp356,65 per message, Jan 2026 list; service messages free up to 1,000 per number per month from 1 Oct 2026) — Evidence, Meta docs; recheck quarterly.

## 4. Stakeholders and Approvals

| Role | Responsibility |
|---|---|
| Product owner (Paduka Ongki) | All business and product decisions |
| Clinical lead (pilot clinic) | Clinical authority matrix, consent, pharmacy rules |
| Accountant | Posting map, SAK choice |
| Tax adviser | VAT classification, PKP, withholding exports |
| Health-law / privacy counsel | Residency, PSE, PDP |
| Engineering | Architecture, delivery |

## 5. Business Risks

| Risk | Mitigation |
|---|---|
| Regulatory registration delays block launch | Start Phase 0 in parallel with build |
| Clinic expects features of big-chain apps (patient app, loyalty) | Explicit non-goals; Phase 4 roadmap |
| Tax classification disputes | Per-item category with recorded basis; clinic decides with adviser |
| Data residency challenge (Singapore hosting) | Residency-portable design, legal-opinion gate, migration runbook (ARCH-9, ARCH-10) |
