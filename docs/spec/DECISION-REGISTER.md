# Beauty Clinic SaaS — Decision Register (Discovery Phase)

- Status: **authoritative list of decisions made during discovery.** When another research file conflicts with this register, this register wins. Research files remain evidence.
- Phase: discovery complete; kit v0.7 ready for promotion. **Development and repository creation authorized by P-27 (G1, 2026-11-02).** Deployment and provisioning still need their own approval.
- Canonical copy: this file (`docs/spec/DECISION-REGISTER.md`). The research-era copies have been retired.
- Last updated: 2026-11-02 (Asia/Jakarta)
- Owner of decisions: Paduka Ongki. Entries marked **ADOPTED-REC** were adopted from the assistant's recommendation on the owner's instruction "sisanya berdasarkan rekomendasimu" (2026-11-02). Each can be revised by the owner.

Status values: **DECIDED** (owner's explicit decision) · **ADOPTED-REC** (recommendation adopted by owner instruction) · **CONDITIONAL** (decided with a precondition that must be met) · **OPEN**.

---

## 1. Product and market

| ID | Decision | Status | Date | Source |
|---|---|---|---|---|
| P-01 | Multi-tenant SaaS sold to beauty clinics | DECIDED | 2026-10-31 | Handoff §8 |
| P-02 | One tenant = one brand; multiple branches per brand; no multi-brand tenant | DECIDED | 2026-11-02 | Chat |
| P-03 | One tenant = one legal entity (one PT); branches are profit centres | DECIDED | 2026-11-02 | Chat |
| P-04 | First target segment: mid-size clinics with 1–5 branches | DECIDED | 2026-11-02 | Chat |
| P-05 | Standalone project, separate from `~/Projects/kliniknuma`; nothing reused or derived | DECIDED | 2026-10-31 | Handoff §8 |
| P-06 | Big chains (ZAP, ERHA, Natasha, etc.) are reference evidence, not the first customer | DECIDED | 2026-11-02 | Follows P-04 |
| P-07 | Discovery instruction: research first, do not develop | DECIDED | 2026-11-02 | Chat |
| P-08 | Product working name **Clinic Dashboard**; its planning kit is built **on Kliniknuma (Numa Klinik) as baseline** and refined with all research and decisions; staged at `~/Documents/work/prd/clinic-dashboard/` (now `docs/spec/` in this repository) | DECIDED | 2026-11-02 | Chat |
| P-09 | **Codebase starts from zero** in a new repository. Kliniknuma is a read-only reference for product contracts and lessons; no code, schema or tests are forked or copied (consistent with P-05) | DECIDED | 2026-11-02 | Chat |
| P-10 | All remaining open discovery items are settled by the assistant's research recommendations (entries marked ADOPTED-REC dated 2026-11-02 below); each can be revised by the owner | DECIDED | 2026-11-02 | Chat |
| P-11 | One multi-tenant platform: a new client (brand) is onboarded as a tenant, never a new build; differences live in data and tenant settings; a per-tender need becomes a general feature behind a setting or is refused (MT-1–MT-7) | DECIDED | 2026-11-02 | Chat |
| P-12 | Three control levels: Super admin (vendor team) → Admin Klinik Pusat (owner, Admin Pusat and tenant-wide roles of one brand) → Klinik Cabang (branch staff) | DECIDED | 2026-11-02 | Chat |
| P-13 | Product domain is a beauty/aesthetic **clinic**, not an online shop: no cart, checkout, shipping or courier flow; products are sold at the cashier and handed over by the pharmacist (DG-1–DG-5) | DECIDED | 2026-11-02 | Chat |
| P-14 | Commercial model: tenders, no subscription plans; the vendor bills each tenant a monthly server fee (default Rp1,000,000, editable per tenant in the vendor console) starting at go-live, collected through the vendor's own AutoLaris account | DECIDED | 2026-11-02 | Chat |
| P-15 | New roles: Admin Pusat (tenant-wide configuration without owner-only powers), Marketing (Must), Purchasing/Gudang Pusat (Must per P-24), Auditor Internal read-only (Must per P-24); IT admin and data-protection duties assigned to Owner/Admin Pusat | ADOPTED-REC | 2026-11-02 | Research §4.2 |
| P-16 | Vendor console scope: vendor roles, tenant lifecycle, onboarding grant until go-live (max 30 days), support sessions notify the owner (owner approval before clinical scope), server-fee billing, platform health | ADOPTED-REC | 2026-11-02 | Chat |
| P-17 | Patient public site: basic site generated from branch master, catalog and consenting doctors in Release 1; rich content in Phase 4; domain set up last (slug path first) | DECIDED (domain) / ADOPTED-REC (Release 1) | 2026-11-02 | Chat |
| P-18 | Feature gaps from research added: Must — appointment reminders, aftercare, walk-in and queue number, manual-discount limits, credential-expiry alerts, document templates, supplier return, global search;  Must per P-24 — promo codes, satisfaction survey, operational expenses, owner digest, waitlist, device logbooks, incident register | ADOPTED-REC | 2026-11-02 | Research gap check |
| P-19 | Clinic job validation at Numa Klinik before PRD approval (`VALIDATION-GUIDE-CLINIC-JOBS.md`) | ADOPTED-REC | 2026-11-02 | Research limit |
| P-20 | **Numa Klinik is the first client and first tenant** (pilot). It is onboarded through the same vendor console and checklist as later clients; its Kliniknuma documents are a reference for its rules, no code is reused (P-09) | DECIDED | 2026-11-02 | Chat |
| P-21 | **Release 1 = the complete research-based product** (owner answer to Q-18, 2026-11-02): no narrowing for the pilot; full navigation, pages and page content per the research menu inventory; future updates extend it | DECIDED | 2026-11-02 | Chat |
| P-22 | **Defaults come from research; a Pengaturan (Settings) menu lets each clinic adjust them later** (owner answer to Q-17/Q-12 handling, 2026-11-02): every adjustable rule has a researched default, bounds and an audit trail; legal and money-integrity rules stay fixed | DECIDED | 2026-11-02 | Chat |
| P-23 | Numa Klinik confirmed as the first client (re-confirmed 2026-11-02) | DECIDED | 2026-11-02 | Chat |
| P-24 | Applying P-21: every former Should requirement becomes Must; exceptions only for law or a recorded decision (campaign sending waits for counsel Q-15; journal export waits for the accountant's posting map A-02); D-13 amended accordingly; family package sharing becomes a per-template switch (default off), amending B-03 | DECIDED (from P-21) | 2026-11-02 | Round 4 review |
| P-27 | **Development authorized (G1)** on owner instruction "jika sudah selesai dan tervalidasi, jalankan project check dan sempurnakan ke project doc utama": repository `~/Projects/clinic-dashboard` created from kit v0.7 via `project-init`; scope all milestones M0–M9 per `PLAN.md`; Q-12 may still change PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83; no commit, push, deployment or provisioning is authorized by this entry | DECIDED | 2026-11-02 | Paduka Ongki |
| P-25 | Default values previously marked "proposal" are accepted as starting defaults; Numa Klinik's brief answers replace them at onboarding where Numa differs; all stay adjustable in Pengaturan | DECIDED (owner: "saranmu bisa kau ambil dari data riset") | 2026-11-02 | Chat |
| P-26 | Expert input (legal, tax, accountant, clinical) enters as **data**: evidence items in a compliance register (Kepatuhan & Pendapat Ahli, PR-97, UX-58) that unlock gated features; experts get no system login | DECIDED (owner question "menu khusus atau data?") | 2026-11-02 | Chat |

## 2. Business rules (summary; full text in `SESSION-HANDOFF-2026-10-30.md` §§3–4 and blueprint §0.4)

| ID | Rule | Status |
|---|---|---|
| B-01 | Initial treatment paid before it starts; additional treatment needs patient + authorized clinician agreement; FO may let addition start before payment; visit cannot close unpaid | DECIDED |
| B-02 | Consultation fee, waiver, refund re-charge, free controls (default 1, valid to control date + 7 days) | DECIDED |
| B-03 | Packages, installments, minimum DP, session unlock by paid value, default validity 365 days (SET-8; wording aligned 2026-11-02, round 7), expiry → paid-unused to balance | DECIDED |
| B-04 | Patient balance never expires; cash refund only as approved exception | DECIDED |
| B-05 | Booking DP optional per treatment; 24 h rule | DECIDED |
| B-06 | Interrupted treatment: medical/clinic stop not counted; patient stop counted | DECIDED |
| B-07 | Commission model: role defaults + individual override, % or fixed, basis actual allocated payment, guiding/closing BC, new patient, performer; monthly approval; refund adjustments; no payroll | DECIDED |
| B-08 | Multi-branch: shared patients/history/balance/packages; stock per branch; shared master + branch price override; package sold at A redeemed at B → sale at A, execution/commission/materials at B | DECIDED |
| B-09 | Per-tenant settings limited to the confirmed list; fixed product rules not configurable | DECIDED |
| B-10 | Paid value moved to patient balance (package expiry/cancel, medical or clinic-stopped single treatment, cheaper substitution) is treated like a refund for commission: unpaid commission on that value is reduced, paid commission becomes a deduction next month; spending the balance later earns commission normally | ADOPTED-REC |
| B-11 | Refund of a product or treatment goes to patient balance by default; cash only as the approved exception (same approver as B-04); the waived consultation fee is re-charged from the refund per B-02 | ADOPTED-REC |
| B-12 | New-patient commission covers transactions of the patient's first visit only | ADOPTED-REC |
| B-13 | A commission deduction larger than next month's commission carries forward until recovered | ADOPTED-REC |
| B-14 | Write-off of a patient receivable: requested by FO/finance, approved by the owner; the owner may write off alone with a mandatory reason; no manager write-off | ADOPTED-REC |
| B-15 | Package session is reserved at check-in/booking and redeemed only when the treatment outcome counts (B-06); the counter never "uses" a session | ADOPTED-REC |
| B-16 | Superseded by B-24/P-22 except the front-desk idle lock (CD-10, fixed): disposal thresholds, stock-count cadence and outbound budget are now settings (SET-43, SET-27, SET-21) | ADOPTED-REC |
| B-17 | Cross-branch package: sales KPI and closing/guiding BC commission at the selling branch; revenue recognised and performer commission at the executing branch (A-04); guiding/closing BC commissions go to the entitled BCs regardless of branch | ADOPTED-REC |
| B-18 | Additional treatment record holds: clinician who authorized, patient agreement, FO who released it before payment, staff accountable for collecting; no amount limit, no manager approval; FO converts an unpaid remainder to a patient receivable after the WhatsApp-bill fallback, which settles the visit bill and allows closure | ADOPTED-REC |
| B-19 | Multi-role staff: one person = one staff identity with an owner-approved role set per tenant; commission keys on the staff identity, not on accounts | ADOPTED-REC |
| B-20 | Staff with several roles pick an active role (Saya › Ganti Peran); tab bar follows it; acting role is shown and recorded on every action; last choice remembered per device | ADOPTED-REC (round 2 review) — 2026-11-02 |
| B-21 | BC targets (PR-47) are Must so BC dashboard target attainment works; B-13 carry-forward amended: remaining deduction at staff exit becomes a staff receivable for owner decision (deduction from pay pending legal review) | ADOPTED-REC (round 2 review) — 2026-11-02 |
| B-22 | Bounded tenant settings (B-09) extended with manual-discount limits per role, reminder times and payment-port provider/environment/channels; provider changes by the owner or by vendor onboarding during the onboarding grant | ADOPTED-REC — 2026-11-02 — Round 3 review R3A-8 |
| B-23 | Tender-specific features use platform feature flags set by the platform owner (ADR-7), separate from the closed B-09/B-22 clinic settings list | ADOPTED-REC — 2026-11-02 — Round 3 review R3B-15 |
| B-24 | **Supersedes the closed list of B-09/B-22 and the fixed defaults of B-16 (except idle lock)**: tenant settings are a registry of named settings, each with researched default, type, bounds, scope (tenant or branch), who may change it, effective date and audit; categories per `19` §2.17 and §5; class F rules (law, money integrity, isolation) are not settings | DECIDED (P-22) — 2026-11-02 — Chat |

## 3. WhatsApp

| ID | Decision | Status | Date |
|---|---|---|---|
| W-01 | WhatsApp via WhatsApp Business Platform (WABA / Cloud API) | DECIDED | 2026-11-02 |
| W-02 | We register as a **Meta Tech Provider** ourselves; clinics onboard through Embedded Signup; each clinic owns its WABA and pays Meta by its own card | DECIDED | 2026-11-02 |
| W-03 | WhatsApp numbers per branch **or** per brand, chosen per clinic | DECIDED | 2026-11-02 |
| W-04 | Support **Coexistence** onboarding so clinics can keep existing WA Business app numbers | ADOPTED-REC | 2026-11-02 |
| W-05 | Templates carry no diagnosis, treatment detail or photos; clinical content behind an authenticated link; promos only with marketing consent | ADOPTED-REC | 2026-11-02 |
| W-06 | Outbound scheduler respects the **portfolio-level** messaging limit (starts at 250 unique users / 24 h, shared across all the clinic's numbers) | ADOPTED-REC | 2026-11-02 |
| W-07 | Clinics wanting more than 2 numbers must complete Meta business verification first (number cap 2 → 20) — part of clinic onboarding checklist | ADOPTED-REC | 2026-11-02 |
| W-08 | Display names follow `Brand – Branch` | ADOPTED-REC | 2026-11-02 |
| W-09 | Fallback if our Meta Tech Provider approval is not ready for the pilot: onboard the pilot clinic through a Meta-approved BSP, then migrate to our Tech Provider | ADOPTED-REC | 2026-11-02 |
| W-10 | Inbound WhatsApp messages and media are treated as possibly specific personal data: stored only in the production environment (H-02b), received on the DNS-only app host (not through the Cloudflare proxy), excluded from logs, readable only by inbox roles of the tenant; retention: clinical retention when linked to a patient, otherwise 24 months after last contact (pending counsel) | ADOPTED-REC (amended round 2) | 2026-11-02 |
| W-11 | Booking OTP is a vendor-level authentication template sent from the clinic's WABA when connected, otherwise from the vendor's own WABA; no patient account is created | ADOPTED-REC | 2026-11-02 |

## 4. Accounting and tax

| ID | Decision | Status | Date |
|---|---|---|---|
| A-01 | Accounting module **Level B (integrated general ledger)**, delivered in two steps: (1) sub-ledgers + liability roll-forwards; (2) chart of accounts, automatic posting, period lock, financial statements | DECIDED (A2) | 2026-11-02 |
| A-02 | Gate between step 1 and step 2: accountant review of the posting map | ADOPTED-REC | 2026-11-02 |
| A-03 | One ledger supports both SAK EMKM and SAK EP outputs; the clinic's accountant chooses | ADOPTED-REC | 2026-11-02 |
| A-04 | Revenue for package sessions recognised at session counted as used, at the executing branch; packages, patient balance and booking DP held as contract liabilities | ADOPTED-REC (pending accountant confirmation) | 2026-11-02 |
| A-05 | Patient balance stays a liability until used or refunded (no breakage income), consistent with B-04 | ADOPTED-REC | 2026-11-02 |
| A-06 | Tax category per sellable item (`exempt_medical`, `taxable_service`, `taxable_goods`, `non_object`) with a recorded basis; chosen by the clinic with its tax adviser; snapshot on each invoice line | ADOPTED-REC | 2026-11-02 |
| A-07 | Tenant tax profile: NPWP, PKP flag + effective date; running 12-month turnover monitor vs Rp4.8 billion for non-PKP tenants | ADOPTED-REC | 2026-11-02 |
| A-08 | e-Faktur: XML export for Coretax upload first; PJAP host-to-host later | ADOPTED-REC | 2026-11-02 |
| A-09 | No payroll; commission and fee data exportable for the clinic's tax adviser (PPh 21/23 handled outside) | DECIDED (payroll) + ADOPTED-REC (export) | 2026-10-31 / 2026-11-02 |
| A-10 | Forfeited booking DP classification: other income (pending accountant confirmation) | ADOPTED-REC | 2026-11-02 |
| A-11 | Revenue is recognised on **performance** (treatment counted, product handed over), never on payment; every payment, balance use or DP application first credits a contract liability ("paid, not yet delivered") per invoice line | ADOPTED-REC (pending accountant) | 2026-11-02 |
| A-12 | (Amended round 2) VAT for PKP tenants: due at the earlier of payment received for, or delivery of, a taxable item, including advance and package payments allocated to taxable items; unallocated balance top-ups carry VAT when used for a taxable item; mixed packages keep each item's tax category per session (pending tax adviser); when paid value moves to patient balance the VAT is reversed with a VAT credit document (or, if the tax adviser rules that out, the balance entry is flagged VAT-settled and spending it creates no second VAT); VAT computation enabled per PKP tenant only after written tax advice is recorded | ADOPTED-REC (pending tax adviser) | 2026-11-02 |
| A-13 | Inventory costing: moving average cost per item per branch; consumption, waste and transfers post at that cost | ADOPTED-REC (pending accountant) | 2026-11-02 |
| A-14 | Accounting step 1 exports sub-ledger and transaction CSV only; journal export starts in step 2 after the accountant signs the posting map | ADOPTED-REC | 2026-11-02 |
| A-15 | Coretax XML export is Must (P-24, PR-98), active only for PKP tenants with approved tax-advice evidence | ADOPTED-REC | 2026-11-02 |

## 5. SATUSEHAT, RME and PSE

| ID | Decision | Status | Date |
|---|---|---|---|
| S-01 | SATUSEHAT integration is in the **first release** | DECIDED (S2) | 2026-11-02 |
| S-02 | The product is treated as an **RME system** under Permenkes 24/2022 (not only admin software) | ADOPTED-REC | 2026-11-02 |
| S-03 | Vendor prerequisites to complete before the first clinic goes live: legal entity with NIB; **PSE registration (Komdigi via OSS)**; SNOMED CT affiliate licence; SATUSEHAT vendor registration ("Penyedia sistem RME (mitra)") incl. sandbox Encounter + Condition, documentation, variables/metadata statement, security survey | DECIDED (S1) | 2026-11-02 |
| S-04 | Vendor entity for NIB/PSE/Meta: **placeholder for now** (`PT [Nama Badan Usaha]`); stored as editable vendor-profile fields (legal name, NIB, PSE number, NPWP, Meta business ID, website, privacy-policy URL, support contacts) used by all documents, templates and registrations | DECIDED | 2026-11-02 |
| S-05 | RME rules in scope: NIK + official no-NIK path; required identity/social fields (Pasal 14); corrections within 2×24 h, later admin corrections with approval (Pasal 30); patient copy of record content (Pasal 26); retention ≥ 25 years, no hard delete (Pasal 39); access by role set by facility head (Pasal 30) | ADOPTED-REC | 2026-11-02 |
| S-06 | BC intake (non-medical) is not sent to SATUSEHAT as a clinician finding; only clinician-validated items are sent | ADOPTED-REC | 2026-11-02 |
| S-07 | Durable outbox per FHIR resource with retry, error list and per-branch monitoring | ADOPTED-REC | 2026-11-02 |

## 6. Hosting and infrastructure

| ID | Decision | Status | Date |
|---|---|---|---|
| H-01 | Owner's chosen stack: **Vultr** (compute), **Coolify** (deployment/orchestration), region **Singapore**, **Cloudflare** (DNS/CDN/WAF/tunnel) | DECIDED (S3) | 2026-11-02 |
| H-02 | **Data-residency condition.** Clinical RME data (records, clinical photos, consents, prescriptions) and their backups must be stored in Indonesia (Permenkes 24/2022 Pasal 22; Pasal 20 backup). Vultr has **no Indonesia region** (Vultr regions doc) and Cloudflare Regional Services has **no Indonesia region** (Cloudflare DLS docs). Therefore H-01 applies as follows until the owner decides otherwise: | CONDITIONAL | 2026-11-02 |
| H-02a | Vultr Singapore hosts production and staging as separate environments (separate servers, databases, buckets and credentials); demo tenants use synthetic data only | DECIDED (follows H-02b) | 2026-11-02 |
| H-02b | **Owner decision: production (including clinical data) runs on Vultr Singapore.** Recorded risk: Permenkes 24/2022 Pasal 22 requires partner-PSE storage of RME inside Indonesia and Pasal 12 requires declaring the storage location at SATUSEHAT registration. Mitigations adopted: (1) residency-portable design — all storage endpoints, backup targets and hosts are configuration, with a documented migration runbook to an Indonesian provider; (2) gate before the first real patient record: written legal opinion (H-02d) or switch to an Indonesian location; (3) storage location declared truthfully in SATUSEHAT/PSE registrations | DECIDED (risk accepted, gated) | 2026-11-02 |
| H-02c | **Corrected 2026-11-02:** Cloudflare proxy terminates TLS and processes request content at edge locations that cannot be pinned to Indonesia. Therefore: the **staff/clinical host is DNS-only** (no Cloudflare proxy) with origin firewall, rate limits and WAF on the Indonesian server; the **public booking host is proxied** (WAF, Turnstile, DDoS) with no body logging, no Logpush of bodies, cache bypass and `no-store`, recorded as XFER-2 pending counsel. No Cloudflare storage products for clinical data | ADOPTED-REC | 2026-11-02 |
| H-02d | Written legal opinion on Pasal 22 (Singapore storage of clinic RME) before the first real patient record; if negative, run the residency migration (H-02b mitigation 1) before go-live | OPEN — counsel (gate) | — |
| H-03 | Existing Vultr/Coolify instance `99ribu-prod` belongs to another project; do not reuse it for this product without an explicit owner decision | ADOPTED-REC | 2026-11-02 |
| H-04 | Secrets (WABA tokens, SATUSEHAT client secrets, payment keys) encrypted at rest per tenant; never in repository or memory files | ADOPTED-REC | 2026-11-02 |
| H-05 | Coolify control plane on its own Vultr Singapore instance, separate from app servers, behind IP allowlist + MFA; production and staging as separate Coolify projects/servers | ADOPTED-REC (amended for H-02b) | 2026-11-02 |
| H-06 | Key custody: KEK as a root-only sealed file on the production host with an offline escrow copy held by the owner (KMS when available); per-tenant data keys wrapped; yearly rotation drill. Because Coolify has root SSH reach, the Coolify instance is tier-0 (ARCH-6 controls); the KEK file is never in Coolify env and its access is audited | ADOPTED-REC (amended round 2) | 2026-11-02 |
| H-07 | Point-in-time recovery with pgBackRest to object storage in a second location separate from the production server (Vultr Object Storage in another region or another provider); object versioning; restore drills quarterly; target locations are configuration (residency-portable) | ADOPTED-REC (amended for H-02b) | 2026-11-02 |
| H-08 | No third-party error-tracking, APM or log SaaS; self-hosted error tracking on the production environment or structured logs only, with scrubbing | ADOPTED-REC | 2026-11-02 |
| H-09 | Payments: the clinic is merchant of record with its own gateway account; generic item descriptions (no treatment names) sent to gateways | ADOPTED-REC | 2026-11-02 |
| H-10 | Patient → clinic payments go through a gateway-neutral payment port; Release 1 ships a mock adapter; the real gateway partner is decided later (partner open, Q-14; mock adapter until then) | DECIDED | 2026-11-02 |

## 7. Dashboards and CRM (from `BIG-BRAND-DASHBOARD-CRM-REQUIREMENTS.md` §9)

| ID | Decision | Status |
|---|---|---|
| D-05 | Lateness rule: configurable minutes after appointment; default off | ADOPTED-REC |
| D-06 | Second-visit window 60 days; dormant threshold 90 days (configurable later only if a clinic needs it) | ADOPTED-REC |
| D-07 | BC target metric: closing value (actual payments attributed as closing BC) per month, plus count of plans fully selected as a secondary indicator | ADOPTED-REC |
| D-08 | Lead SLA: first response within 15 minutes during branch opening hours | ADOPTED-REC |
| D-09 | Accounting export: superseded by A-14 (step 1 sub-ledger CSV) and A-15 (Coretax XML, Must per P-24, PKP only); CSV journal only in step 2 after accountant sign-off | SUPERSEDED (A-14, A-15) — 2026-11-02 |
| D-10 | Cross-branch "CS pusat" role in first release: yes (booking and inbox across branches, no clinical access) | ADOPTED-REC |
| D-11 | Dashboards show tenant's own trend and target only; no external benchmark defaults | ADOPTED-REC |
| D-12 | No session replay or third-party pixels on booking, intake, complaint, or authenticated pages | ADOPTED-REC |
| D-13 | Campaigns and segments are built in Release 1; sending stays switched off until counsel evidence for Q-15 is approved (amended by P-24) | ADOPTED-REC |
| D-14 | UI direction: **full Apple style** (HIG-based, tab bars, sheets, system font, Dynamic Type sizes) replacing "Klinik Lapang" | DECIDED |
| D-15 | Appearance: **light only** (no dark mode in Release 1) | DECIDED |
| D-16 | Tenant may change the accent colour, validated for contrast; derived variants rejected below thresholds | DECIDED |
| D-17 | Terms: "BC Pembimbing" (guiding BC), "Ruang Tindakan" (treatment room), "Lihat yang perlu ditangani" (exceptions); BC records "Observasi kulit" without scores | ADOPTED-REC |
| D-18 | Apple-style fixes from round 2: bar glass 92% white (tint and label-2 ≥ 4.5:1 over black content); iOS Dynamic Type via `font: -apple-system-body`; tab labels ≤ 2 words, ≤ 13 characters; "Serahkan" replaces "Serah"; placeholders use label-2; `color-scheme: only light`; one prominent action per view (approval lists use plain buttons); DESIGN.md and `10` win over UX-CONCEPT | ADOPTED-REC (round 2 review) — 2026-11-02 |

## 8. Personal data

| ID | Decision | Status |
|---|---|---|
| PD-01 | Purpose-specific consent ledger (care notice, procedure consent, clinical photo use, marketing WA, publication) | ADOPTED-REC |
| PD-02 | Verify PP 33/2026 (UU PDP implementing regulation) text before PRD | OPEN — research |
| PD-03 | Add DPIA, DPO designation, breach-notification deadline, transfer mechanism per XFER and controller/processor role per data class to the privacy spec; article numbers verified by counsel | ADOPTED-REC |

## 9. External reviews required before PRD is final

Owner (2026-11-02): accountant, tax adviser and clinical reviews are deferred and refined later; they remain gates before the matching go-live steps.

| Review | Covers | Prepared questions |
|---|---|---|
| Accountant | A-04, A-05, A-10, SAK choice, posting map | `COMPLIANCE-TAX-ACCOUNTING-SATUSEHAT-PSE-RESEARCH.md` §3.4 |
| Tax adviser | VAT per treatment family, prepaid VAT timing, PKP threshold, withholding | same file §3.5 |
| Clinical lead | Delegation, consent, BC limits, pharmacy rules | `SESSION-HANDOFF-2026-10-30.md` §7 |
| Legal | H-02 data residency interpretation, PSE, PDP | same file §5, §7 |

## 10. Change log

| Date | Change |
|---|---|
| 2026-10-31 | Business rules B-01…B-09, P-01, P-05 |
| 2026-11-02 | P-02…P-04, P-06, P-07; W-01…W-03; A-01; S-01, S-03; H-01 |
| 2026-11-02 | Recommendations adopted on owner instruction: W-04…W-08, A-02…A-09, S-02, S-05…S-07, H-02a…H-04, D-05…D-12, PD-01 |
| 2026-11-02 | H-02 marked CONDITIONAL: Singapore hosting conflicts with Indonesian storage requirement for RME |
| 2026-11-02 | P-08 Clinic Dashboard kit created (development-spec-suite pack, 22 files) |
| 2026-11-02 | P-09 codebase from zero; P-10 remaining items adopted from research (B-10–B-19, A-10–A-15, W-09–W-11, H-02a/H-02c amended, H-05–H-09, D-13–D-17, PD-03) |
| 2026-11-02 | S-04 placeholder vendor profile; H-02b production on Vultr Singapore (risk accepted, gated by H-02d); H-02a, H-05, H-07 amended |
| 2026-11-02 | Round 2 review applied: A-12 amended; W-10, H-06 amended; D-09 superseded; B-20, B-21, D-18 added |
| 2026-11-02 | Kit v0.4: P-11–P-20, H-10, B-22, B-23 (vendor console, levels, clinic-not-shop, server fee, roles, public site, research gaps, validation, Numa first client, payment port) |
| 2026-11-02 | Kit v0.5: P-21 full research-based Release 1 (Q-18 closed), P-22 research defaults + Pengaturan, P-23 Numa first client confirmed, B-24 settings registry |
| 2026-11-02 | Kit v0.6: P-24 every Should becomes Must (campaign sending waits for Q-15, journal export for the posting map), D-13 and B-03 amended |
| 2026-11-02 | Kit v0.6: P-25 proposal defaults accepted; P-26 expert input as evidence register (PR-97); JUR-ID-9–11 verified |
| 2026-11-02 | Round 7 (Astra) applied: posting triggers and tax-point guard, B-03 validity wording, SET-44 monthly only |
| 2026-11-02 | P-27 development authorized; kit v0.7 promoted to `~/Projects/clinic-dashboard` |
| 2026-11-02 | Kit v0.7: round 5 and round 6 reviews applied; register rows aligned with P-24 (P-15, P-18, A-15, D-09, D-13), B-16 superseded by B-24, H-10 wording |
