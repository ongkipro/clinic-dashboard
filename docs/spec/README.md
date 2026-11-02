# Clinic Dashboard — Specification Pack (kit v0.7)

- **What:** one multi-tenant platform for Indonesian beauty and aesthetic clinics — staff operations, electronic medical record (RME) and SATUSEHAT, cashier, packages and patient balance, stock and pharmacy, commission, WhatsApp CRM, accounting, vendor console and a patient public site. A clinic system, not an online shop (P-13).
- **First client:** Numa Klinik (P-20, P-23). **Commercial model:** tenders plus a monthly server fee per clinic from go-live, billed through the vendor's AutoLaris account (P-14).
- **Status:** kit **v0.7**, Approved for development 2026-11-02 (P-27, gate G1); promoted to `~/Projects/clinic-dashboard`, where the repository copies are canonical and this folder is a non-authoritative snapshot. Deployment still needs its own approval. Five review rounds with Opus 5.5, GPT-6.1 Sol, GPT-6 Astra and Fable 5.1 have been applied (`docs/research/reviews/`).
- **Canonical** in this repository since 2026-11-02 (P-27, DEL-1); the planning folder is retired (archive `/data/backups/clinic-dashboard-kit/`). Research and reviews: `docs/research/`.
- **Validate:** `pnpm docs:check` from the repository root.

## Read in this order

1. `00-OVERVIEW.md` — one page in Indonesian: levels, one visit in 10 steps, money in 5 rules, Release 1, decisions waiting.
2. `02-PRD.md` — what the product must do (requirements, scenarios, KPI dictionary, open questions).
3. `03-TECHNICAL-DESIGN.md` and `04-SYSTEM-ARCHITECTURE.md` — architecture.
4. `05`–`07` — data, tenant isolation, roles.
5. `17` and `19` — screens, navigation, pages, settings.
6. Root `PLAN.md` and `TASKS.md` — build order and the execution queue.

## Platform at a glance

```text
Level 1  SUPER ADMIN (vendor team)        vendor console: tenants, onboarding, server fee (AutoLaris), support, health
   │      sees clinic data only in owner-visible support sessions
Level 2  ADMIN KLINIK PUSAT (one brand)   owner, Admin Pusat, finance, CS pusat, PJ klinik, perekam medis,
   │      marketing, purchasing, auditor  → all branches of that brand
Level 3  KLINIK CABANG                    manager, FO/kasir, BC, dokter, perawat, terapis, apoteker → own branch
   │
USERS & STAFF   account (login) → membership per brand → staff (roles, branches, licences)
PATIENTS        belong to one brand, shared by all its branches; no login in Release 1 (OTP booking)
DATABASE        one schema; vendor tables above tenants; every tenant row has tenant_id, branch rows add branch_id
```

## Kit contents

| File | Owns | IDs |
|---|---|---|
| `00-OVERVIEW.md` | Plain one-page explanation for the owner | — |
| `01-BRD.md` | Business requirements | BR-1–BR-6 |
| `02-PRD.md` | Product requirements (all Must, P-21/P-24; PR-40 Phase 4), NFRs, acceptance scenarios, CLIN carry-over, KPI dictionary, rollout, open questions | PR-1–PR-98 (+ PR-33a–g), NFR-1–NFR-8, K1–K27, Q-01–Q-19 |
| `03-TECHNICAL-DESIGN.md` | Modules (clinic domain, platform core), key flows, ADRs | TD-1–TD-14, ADR-1–ADR-7 |
| `04-SYSTEM-ARCHITECTURE.md` | Deployment, containers, trust boundaries, residency gate | ARCH-1–ARCH-13 |
| `05-DATA-MODEL.md` | Principles, platform hierarchy, relationship contract, entity dictionary, integrity, retention | DATA-1–DATA-72 |
| `06-TENANT-ISOLATION.md` | Tenant context, RLS policy kinds, routing, lifecycle, vendor grants and sessions, scope map | TEN-1–TEN-19 |
| `07-IAM-RBAC-ABAC.md` | Authentication, control levels, vendor roles, recovery, revocation, role matrix (16 roles) | IAM-1–IAM-16 |
| (`08` not used in this pack) | — | — |
| `09-API-SPECIFICATION.md` | API conventions and route groups | API-1–API-6 |
| `10-DESIGN-SYSTEM-WHITELABEL.md` | UI rules, components, state copy, glossary, tenant branding | UI-1–UI-18 |
| `11-BILLING-PAYMENTS.md` | Clinic money rules, vendor server fee, posting map, roll-forwards, exports | BILL-1–BILL-37 |
| `12-SECURITY-ARCHITECTURE.md` | Threats and controls | SEC-1–SEC-21 |
| `13-COMPLIANCE-PRIVACY.md` | Privacy obligations, lawful-basis matrix, vendor compliance checklist | PRIV-1–PRIV-18 |
| `14-SLA-DRP.md` | Service levels, recovery, downtime SOP | SLO-1–SLO-2, DR-1–DR-4 |
| `15-DEVOPS-CICD-MIGRATIONS.md` | Stack, **repository folder structure**, CI/CD, migrations, AI workflow | DEL-1–DEL-6, MIG-1–MIG-3 |
| `16-OBSERVABILITY-RATE-LIMITING.md` | Telemetry and rate limits | OBS-1–OBS-6, RATE-1–RATE-6 |
| `17-UX-FLOWS-SCREEN-CONTRACTS.md` | Screen inventory and contracts, role hand-off map, public sitemap, state matrix | UX-1–UX-60 |
| `18-INTEGRATION-CONTRACTS.md` | WhatsApp, SATUSEHAT, payment port, vendor AutoLaris, mock adapter, events, errors | TD-20–TD-51 |
| `19-NAVIGATION-PAGE-CATALOGUE.md` | Navigation tree, page inventory with content, landing page per role, Pengaturan settings registry | SET-1–SET-49 |
| Root `DESIGN.md`, `design/brief.md`, `UX-CONCEPT-APPLE-STYLE.md` | Tokens, brief, accepted Apple-style direction | — |
| `CONTEXT-RECORD.md` | Context facts, overlays, Indonesian jurisdiction records, transfers, locale | CTX, JUR-ID-1–JUR-ID-11, XFER-1–XFER-3 |
| `DECISION-REGISTER.md` | Owner and adopted decisions | P-, B-, A-, W-, S-, H-, D-, PD- |
| `PLAN.md` | Milestones M0–M9 with exits, gates G0–G3, money scenario suite, default policy register | CD-01–CD-40 |
| `TASKS.md` | Execution queue: 131 tasks, one primary PR each, ordered dependencies, runnable Done-when | T-001–T-131 |
| Root `AGENTS.md` | Rules for AI coding agents (merged from the kit's `AGENTS-DRAFT.md` at promotion) | — |

## Who is who

| Role in the kit | Person | Status |
|---|---|---|
| Product owner | Paduka Ongki | Assigned |
| Engineering, design, security, privacy and CRM owner | Paduka Ongki until delegated | Assigned by default |
| Clinical lead (authority matrix Q-07, clinical text review) | Numa Klinik's Penanggung Jawab Klinik | To confirm during validation (Q-12) |
| Accountant (posting map, Q-06) | Unassigned | Evidence uploaded in the compliance register (PR-97) |
| Tax adviser (Q-05, Q-16) | Unassigned | Evidence uploaded in the compliance register (PR-97) |
| Health-law and privacy counsel (Q-08, Q-11, Q-15, Q-17, H-02d) | Unassigned | Evidence uploaded in the compliance register (PR-97) |

## Sources and precedence

1. **This pack** (with `DECISION-REGISTER.md`) is authoritative in the repository; root `STATUS.md`, `TASKS.md`, `PLAN.md` and `DECISIONS.md` own status, queue, order and repository decisions.
2. **Research and reviews (evidence, not instructions):** `docs/research/` — market and system research, reverse-engineering evidence, regulatory research, `VALIDATION-GUIDE-CLINIC-JOBS.md`, `reviews/` (rounds 1–5), `proposals/`.
3. **Reference product (read-only, no code reused — P-09):** `~/Projects/kliniknuma/` (Numa Klinik) and the Numa brief `~/Projects/numa-klinik-brief/content/keputusan.md` (source of several defaults, P-25).

## Relationship to Kliniknuma

| Aspect | Kliniknuma (Numa Klinik) | Clinic Dashboard |
|---|---|---|
| Product type | Single-brand clinic platform (PRD non-goal: multi-brand SaaS) | Multi-tenant SaaS; tenant = one brand = one PT; 1–5 branches first |
| Code | Next.js + PostgreSQL + Drizzle + Better Auth; engines built, persistence in progress | **Built from zero** in a new repo (P-09); same stack family, versions re-verified |
| Clinical model | Unified Patient Workspace, 5 provenance states, care plans, condition progress, face map, consent, amendments | Kept (with the RME correction window aligned to Permenkes 24/2022) |
| Money model | Packages with `floor(paid_ratio × sessions)` unlock, 2–3 installment terms, family sharing, loyalty points, three refund tracks, BC commission at sale | **Superseded** by decided rules: unlock by paid session value, no schedule (reminders only), sharing only when enabled per package template (PR-93, default off), no loyalty in Release 1, expiry/cancel → patient balance, commission on actual allocated payment |
| WhatsApp | Provider adapter (Meta Cloud API direct or BSP) | Own Meta Tech Provider, Embedded Signup, numbers per branch or brand |
| Accounting | Balanced journals for owner dashboard | Level B general ledger in two steps |
| Hosting | Vultr Singapore + Coolify + Cloudflare, OQ-8 reopened for residency | Same stack; **owner decision H-02b**: production on Vultr Singapore, residency-portable, gated by legal opinion (register H-02) |

Codebase: from zero (P-09). **Numa Klinik is the first client and first tenant (P-20, P-23)**; its Kliniknuma documents are a reference only.

## Kliniknuma → Clinic Dashboard map

Legend: **KEEP** (adopted as is) · **MODIFY** (adopted with stated change) · **SUPERSEDED** (replaced by a decision) · **LATER** (kept for a later release) · **NOT APPLICABLE** (Numa-specific) · **KEEP + GATE** (kept, with a go-live gate) · **NEW** (not in Kliniknuma). Mapping means product behavior only; no code is reused (P-09).

| Kliniknuma item | Status | Clinic Dashboard item | Reason |
|---|---|---|---|
| REQ-001 public homepage | MODIFY | PR-64–PR-67 (basic public site, Release 1); PR-40 (rich content, Phase 4) | Generated per tenant; no testimonials or advertised promos (Permenkes 1787/2010) |
| REQ-002 monthly promo engine | MODIFY | PR-77 (promo codes at cashier and consented messages) | Discounts are never advertised on public pages (JUR-ID-7) |
| REQ-003 testimonials | SUPERSEDED | — | Permenkes 1787/2010 Pasal 5 huruf n forbids testimonials in health-service publications |
| REQ-004 skin quiz | LATER | PR-40 (Phase 4) | Phase 4 rich content |
| REQ-005 three-track booking, 4-resource reservation | MODIFY | PR-6 | Reserve only resources the service needs; booking DP 24 h rule replaces ≥3 h reschedule cutoff; lateness rule default off |
| REQ-006 member PWA | LATER | Phase 4 | Patient app deferred (handoff §6) |
| REQ-007 prescription reorder | MODIFY | PR-18 | In-clinic dispensing kept; patient self-reorder later |
| REQ-008 BC intake | KEEP + MODIFY | PR-9 | BC is non-medical; guiding/closing BC roles added |
| REQ-009 doctor RME, face map, care plans, conditions | KEEP | PR-10 | Plus same-screen history panel |
| REQ-010 clinical authority, consent | KEEP | PR-11 | — |
| REQ-011 nurse/therapist workspace | MODIFY | PR-14 | Low-burden checklist; interruption outcomes; nursing logbooks LATER |
| REQ-012 live clinic board | KEEP + MODIFY | PR-7, PR-15 | Outstanding section, receivable shown, pending dispensing blocks closure (CLIN-025) |
| REQ-013 cashier, packages, installments, family sharing, loyalty, refunds | SUPERSEDED (money rules) | PR-19–PR-22 | Decided package/balance/DP/refund rules |
| REQ-014 dose add-on reconciliation | MODIFY | PR-15 | Additional-treatment flow with FO confirmation |
| REQ-015 stock deduction (3-tier), pharmacist handover | KEEP + MODIFY | PR-16, PR-18 | Explicit request/issue/consume/return lifecycle |
| REQ-016 batch, vial, FEFO, logbooks | MODIFY | PR-17, PR-46 | Per-branch stock, transfers, moving average; accreditation logbooks LATER |
| REQ-017 commission | SUPERSEDED | PR-23 | Decided commission model |
| REQ-018 WhatsApp CRM jobs, triage | MODIFY | PR-27–PR-31, PR-43 | WABA own Tech Provider, inbox, leads, triggers; clinical complaint escalation |
| REQ-019 owner dashboard | MODIFY | PR-33, PR-34 | KPI dictionary, role dashboards, reconciliation |
| REQ-020 dynamic catalog | MODIFY | PR-41, PR-42, PR-24 | Per-item tax category with basis |
| REQ-021 consent, media, break-glass | KEEP | PR-4, PR-32 | — |
| REQ-022 RME integration modes | MODIFY | PR-35 | SATUSEHAT mandatory in release 1 |
| REQ-023 signed amendments | MODIFY | PR-13 | Correction window 2×24 h (Pasal 30) instead of RG-15's 24 h |
| CLIN-001–CLIN-028 | KEEP / REWORD / DEFER per row | 02-PRD §8.1 | Each CLIN mapped to an owning PR |
| RG-01 partial execution (consume 1) | SUPERSEDED | PR-14 | Decided: medical/clinic stop not counted, patient stop counted |
| RG-02 no-show grace 15 min | SUPERSEDED | PR-8, PR-22 | Lateness rule default off; booking DP 24 h rule |
| RG-03 package validity 12 months, breakage | MODIFY | PR-20 | 12 months kept; expiry → balance, no breakage |
| RG-05 installments 2–3 terms | SUPERSEDED | PR-20 | No schedule, pay any amount |
| RG-06 repeated refunds, write-off ≤ Rp500k | SUPERSEDED | PR-21, PR-37, PR-44 | Refund to balance by default; owner write-off (B-11, B-14) |
| RG-07/RG-08 loyalty | LATER | Phase 4 | Loyalty deferred |
| RG-10/RG-11/RG-12 tax | KEEP | PR-24 | Matches research |
| RG-15 correction window 24 h | SUPERSEDED | PR-13 | 2×24 h per Pasal 30(6) |
| RG-16–RG-18, RG-21, RG-24–RG-28 clinical/pharmacy/stock defaults | KEEP as defaults | PLAN §4 CD-16–CD-22 | Still need clinical/pharmacist validation |
| RG-19 triage SLA | MODIFY | PR-43 | Response target per complaint task |
| RG-20 patient projection | LATER | Phase 4 | Patient app deferred |
| RG-22, RG-23 refill cooldown, Rx validity | LATER | Phase 4 | Patient self-reorder deferred; in-clinic dispensing only |
| RG-04 money arithmetic | KEEP | CD-12 | — |
| RG-09 entitlement pick order | SUPERSEDED | PR-20 | Patient chooses within paid value and doctor's stage |
| RG-13 catalog approvals | MODIFY | PR-41 | Clinical-lead review of clinical fields |
| RG-14 consent validity | KEEP as default | PR-11 | Pending clinical lead |
| RG-29, RG-30 recovery, recall trace | LATER | Phase 4 (patient accounts); recall via PR-18 stock reports | Patient accounts deferred; recall via stock reports |
| RG-33, RG-34 consent purposes, missing NIK | KEEP | PR-4, CD-28 | — |
| RG-35 publication blocks | MODIFY | PR-65 (Release 1), PR-40 (Phase 4) | Basic public pages in Release 1; rich content Phase 4 |
| RG-37 backup | MODIFY | CD-29, DR-1 | pgBackRest to a separate location |
| RG-38 pilot feature flags | MODIFY | PRD §12 | Phases instead of flags |
| RG-31 commission engine | SUPERSEDED | PR-23 | Decided model |
| RG-32 retention | KEEP | PR-13, PRIV-3 | ≥25 years (Pasal 39 verified) |
| RG-36 family and merges | MODIFY | PR-5 | Phone is a contact, not identity; package sharing only when enabled per template (PR-93, default off) |
| RG-39 providers | MODIFY | PR-27 | Own Tech Provider |
| DEC-001 stack | MODIFY | 15 §2 | Same stack family, built from zero |
| DEC-002 versioned catalog | KEEP | 05 DATA-6 | — |
| DEC-003, DEC-007 provenance, workspace | KEEP | PR-9, PR-10, UI-7 | — |
| DEC-004 separate events | KEEP | 03 §5, 05 §4 | Same principle as handoff state separation |
| DEC-005 outbox | KEEP | ARCH-5 | — |
| DEC-006 Numa Skin palette | NOT APPLICABLE | DESIGN.md | Full Apple style + tenant accent (D-14, D-16) |
| DEC-010/DEC-012 auth | KEEP | PR-3 | — |
| DEC-013/DEC-015 tenancy | MODIFY | PR-1 | Organization becomes tenant |
| DEC-017 default register approach | KEEP | PLAN §4 | — |
| DEC-008 3-tier stock, follow-up visits | KEEP | PR-16, PR-17 | Material classes |
| DEC-009, DEC-011 event registry, idempotent persistence | MODIFY | 18 TD-50, DATA-5 | New event catalog |
| DEC-014, DEC-016 Numa brand / Numa Skin | NOT APPLICABLE | — | Multi-tenant product |
| DEC-018 hosting | KEEP + GATE | PR-36, ARCH-1, ARCH-9, ARCH-10 | Vultr Singapore + Coolify + Cloudflare (H-02b); legal-opinion gate before real patient data |
| Kliniknuma UX-1–UX-17 (screens) | MODIFY | 17 UX-1–UX-60 | Renumbered; Apple-style; triage → UX-28, catalog/approvals → UX-25/UX-26, roster → UX-33, purchasing → UX-11; public site, quiz, member app LATER |
| TASK-037 registration, roster | KEEP | PR-5, PR-6 | — |
| TASK-038 receipts, shift close | KEEP | PR-19 | — |
| TASK-039 purchasing | KEEP | PR-17 | — |
| Not in Kliniknuma | NEW | PR-12, PR-25, PR-26, PR-28, PR-29, PR-33a–g, PR-56–PR-63, PR-68–PR-98 (except those mapped above), PR-34, PR-36, PR-39, PR-47, PR-49–PR-55 (PR-44 descends from RG-06, PR-46 from REQ-016, PR-48 from TASK-037/UX-14) | Consultation fee, accounting, inbox, leads, dashboards, residency, tracking privacy, approvals inbox, costing, targets, roster, profile, data requests, audit, export, vendor console, notifications |
