# PLAN — Clinic Dashboard: Implementation Plan and Default Policy Register

- Status: kit v0.7, Approved (2026-11-02). G1 passed: development authorized by P-27; M0 not started.
- Owner: Engineering owner; decisions by Product owner (Paduka Ongki).
- Requirements: `docs/spec/02-PRD.md` (PR-1–PR-98, PR-33a–g; all Must per P-21/P-24; PR-40 Phase 4). Design: `docs/spec/03`–`19`. Tasks: `TASKS.md` (T-001–T-131). This file holds the build order and the default policy register; it does not restate requirements.

## 1. Build Order

| Milestone | Content | Primary requirements | Exit check (fixture / command pattern, assertion) |
|---|---|---|---|
| M0 Foundation | New repo, CI, Docker, PostgreSQL + pgBackRest, scope map, RLS policy kinds incl. operator predicates, accounts/memberships/staff, auth with TOTP, tenant/branch/staff, settings registry with SET-* defaults, audit with attribution, approvals, notifications, outbox and domain events, platform hostnames, key custody, backups (pgBackRest), vendor profile, vendor console core (tenant lifecycle, vendor roles, onboarding grant and checklist, support sessions), access administration, compliance register with gate evaluator, branch/brand switching | PR-1, PR-3, PR-37, PR-38, PR-44, PR-51, PR-53, PR-54, PR-55, PR-56–PR-60, PR-63, PR-84, PR-91, PR-97 | `pnpm test:rls` and `pnpm test:isolation` pass (every route/job has a cross-tenant negative test); module-level parts of scenarios PR-1 (with fixture rows; full with patients in M1), PR-38, PR-53, PR-56 manual suspension, PR-57–PR-60, PR-63 (cannot grant Owner), PR-91, PR-97 pass; completions named in TASKS.md: PR-84 (M1 walk-in), PR-56 care messages (M6 aftercare) |
| M0.5 Design system (built inside M0 because M0 screens need the shell; its tasks sit in the M0 block of TASKS.md) | Apple-style tokens, shell (tab bar/sidebar/Menu), sheets, lists, VisitTrack, states, complete navigation tree per `19` (role-filtered), list/detail conventions, state copy patterns | PR-86, UI-1–UI-18 | `pnpm test:ui` browser checks at 390/820/1180/1440 and 200% text; scenario PR-86 passes |
| M1 Catalog, patients & scheduling | Master Layanan and catalog versions, branch prices, patients, consents (text versions), privacy workspace, staff schedules, booking, appointment states (core), check-in, Hari Ini, walk-in and queue numbers, patient search, duplicate merge | PR-2, PR-4–PR-8, PR-84 (full), PR-41, PR-42, PR-48, PR-49, PR-71, PR-76, PR-83 (core: states, no-show without DP effect), PR-85 (merge), PR-88, PR-92 (consents, processors, breach; DSR link in M9) | Module-level assertions of PR-2, PR-4–PR-8 (full scenarios complete in the tasks named in TASKS.md), PR-84, PR-71, PR-76, PR-83 (no-show, reschedule), PR-85 merge, PR-88, PR-92 pass on a real database |
| M2 Clinical | BC flow, doctor sheet, plans with BC projection, consent, corrections, photos, clinical requests, complaint tasks (flag from visit notes and staff; inbox flag in M6), document templates and signed letters, credential alerts | PR-9–PR-11, PR-13, PR-32, PR-43 (core), PR-45, PR-73, PR-74 | Scenarios PR-9–PR-11, PR-13 (sign, version, correction window), PR-43 visit-note flag, PR-45, PR-73, PR-74 and CLIN-001–005, 012, 014–016, 021–023, 026 pass |
| M3 Treatment & stock | Checklist, outcomes, materials lifecycle, depots and batch holdings, pharmacy list, dispensing with 7 checks, stock, moving average, purchasing, transfers, suppliers, supplier returns, supplier invoices and payables, logbooks, incident register | PR-14, PR-16–PR-18, PR-46, PR-75, PR-82, PR-89, PR-90 | Scenarios PR-14 (outcomes; session and commission effects in M4/M5), PR-16–PR-18, PR-75, PR-82, PR-89, PR-90 and CLIN-008, 017–019, 024–025 pass; stock fixture: no double deduction, depot balances never negative |
| M4 Money | Shared invoice and tax foundation (frozen price, tax category, PKP gate via PR-97), allocation, payments, payment port with mock, consultation fee, additions, packages, family sharing switch, instalment schedules, balance, DP (incl. PR-83 DP effects), receivables, refunds, void, shift close, discounts and promo codes, expenses | PR-24 (tax foundation first), PR-19, PR-12, PR-15, PR-20–PR-22, PR-68, PR-72, PR-77, PR-79, PR-93, PR-96 | Domain behaviour of money scenarios 1–9, 11–13, 15–19 (§3) passes against the fixture document (commission parts of 10–12, 14 in M5; journal lines and scenario 20 in M8); PR-68 mock never counts; PR-77 quota atomic under 2 concurrent cashiers |
| M5 Commission | Rules, contributions, adjustments, batches, targets, export | PR-23, PR-47 | Money scenarios 10 and 14 and the commission parts of 11 and 12, and commission scenarios (PR-23, PR-47) pass |
| M6 Messaging & CRM | Tech Provider onboarding (BSP fallback), inbox, media, templates, leads, follow-ups, budget, reminders, aftercare, automation scenarios, surveys, waitlist, campaigns and segments (sending switched off until Q-15), inbox complaint flag | PR-27–PR-31, PR-43 (inbox flag), PR-69, PR-70, PR-78, PR-81, PR-94 | Test number end to end with recorded fixtures; webhook replay fixtures (duplicate, late, out of order, bad signature); PR-94 per-patient cap under concurrency |
| M7 Integrations | SATUSEHAT outbox, mapping, identity states, sync ledger; vendor server-fee billing via AutoLaris (TD-42); real payment adapter only after Q-14 | PR-35, PR-61 | SATUSEHAT sandbox Encounter + Condition 200/201 with recorded fixtures; PR-61 scenarios (prorata, expired attempt, rc≠00, waiver) pass |
| M8 Accounting & dashboards | Sub-ledgers and roll-forwards (step 1), chart of accounts, posting engine, periods, statements (step 2; journal **export** gated by PR-97 posting-map evidence), Coretax XML for PKP tenants, reconciliation, read models, role dashboards, extra reports, KPI dictionary, owner digest, platform health | PR-25, PR-26, PR-34, PR-33, PR-33g, PR-62, PR-80, PR-95, PR-98 | Ledger reconciles to sub-ledgers on the §3 fixtures; KPI values equal fixture expectations for K1–K19 and PR-95 metrics |
| M9 Pilot readiness | Residency gate (ARCH-10), restore drill, data requests, tenant export, browser sweep, security review, basic public site, vendor console complete, Numa Klinik onboarding and opening-data import | PR-36, PR-39, PR-50, PR-52, PR-59, PR-64–PR-67, PR-85 (import), PR-87, NFR-1–NFR-8 | Checklist: restore drill passed in an isolated environment; residency gate blocks real-patient actions while evidence is missing; scenarios PR-36, PR-39, PR-50, PR-52, PR-59, PR-64–PR-67, PR-85 import and PR-87 pass; browser sweep 390/820/1180/1440 recorded; security review findings closed; synthetic Numa-shaped import dry-run reconciles; J9 and J11 walkthroughs pass. G2 consumes this result |

Dependency rule: when a requirement appears in two milestones, the first delivers its core contract and the second its integration; tasks name which part they deliver. PR-19 and PR-24 form one shared invoice/tax foundation built first in M4 (PR-24 primary), then PR-19 cashier flows. PR-40 (rich public content) is Phase 4 and outside this sequence.

Money fixtures: the expected ledger lines, VAT and commission figures for scenarios 1–20 are written as one document task before any M4 code task, so the accountant can review them in parallel.
### Gates (used by PRD §13 "Blocks gate")

| Gate | Meaning | Phase | Releases milestones | Blocking questions |
|---|---|---|---|---|
| G0 | Vendor prerequisites **started** (entity chosen, registrations filed) | Phase 0 start | M0 start | Q-03 |
| G1 | PRD approved; the drafted `TASKS.md` for **all** milestones is re-validated and development may start (owner authorization, recorded as P-27) | — | M0–M9 | Q-12 (only for the PRs it names: PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83) |
| G2 | Phase 2 entry (Numa Klinik pilot with real patients): all M0–M9 exits passed **and** Phase 0 prerequisites **completed** | Phase 2 | real-patient activation | Q-04, Q-05, Q-07, Q-08, Q-10, Q-11, Q-15, Q-17, R-01, each as approved evidence in the compliance register (PR-97); Q-05 and Q-07 are needed earlier as design inputs for M4 and M2 |
| G3 | Journal export and accounting statements used for filing | Phase 2 onward | export switch | Q-06 (accountant posting-map evidence) |

### Compound requirements

Several `T-*` tasks may share one primary `PR-*` (e.g. PR-19, PR-20, PR-23, PR-59, PR-61, PR-63) when each task names a distinct §8 scenario it makes pass; the traceability rule "one task → one primary requirement" still holds.

### Release 1 scope (decided P-21: complete research-based product)

The narrowing proposed by review R3-F (moving vendor console extras, AutoLaris automation, extra roles and dashboards to a later release) was declined by the owner on 2026-11-02 (P-21); the full record is in `reviews/round3-review-6-agent-readiness-fable.md`.

§1 is the plan. Navigation and pages follow `19`; settings follow `19` §5.

## 2. Codebase from zero (P-09)

Nothing is forked or copied from Kliniknuma. It is consulted only for lessons:

| Kliniknuma lesson | Applied as |
|---|---|
| Scope map test that fails on unclassified tables | TEN-3 from the first migration |
| Non-owner DB role without BYPASSRLS checked at startup | TEN-2 |
| Outbox claimed with `FOR UPDATE SKIP LOCKED` | TEN-5 (cross-tenant claim, per-row binding) |
| Idempotent commands with stored results | DATA-5 |
| Provenance states and separate clinical/commercial records | PR-9, PR-10, DATA-18–DATA-20 |
| Versioned catalog and sale-time snapshots | PR-41, DATA-6 |
| Facility-strict RLS and global unique keys | **Not repeated** (06 policy kinds, TEN-10) |

## 3. Money Scenario Suite (domain behaviour M4, commission M5, journals and scenario 20 M8)

From `docs/research/SESSION-HANDOFF-2026-10-30.md` §7 and `docs/research/OPERATIONAL-SCENARIO-AUDIT.md`:
1. New patient buys products only.
2. New patient prepays and completes treatment.
3. Additional treatment approved in the room, started unpaid, settled; and unsettled → receivable.
4. Consultation only; consultation then later-day purchase; full refund re-charge; partial refund keeps waiver.
5. Returning patient redeems package session; installment package with locked sessions.
6. Cancellation ≥ 24 h / < 24 h / no-show / clinic cancel with booking DP.
7. Interrupted treatment: medical, clinic, patient.
8. Package expiry Rp5,000,000 / 5 sessions / Rp3,000,000 paid / 2 used → Rp1,000,000 to balance, Rp2,000,000 cancelled.
9. Material return plus payment refund.
10. One sale attributed to guiding BC, closing BC, new-patient registrar and performer; refund after payout.
11. Cross-branch package: sold at A, redeemed at B (KPI and BC commission at A, revenue and performer at B).
12. Doctor-approved substitution, higher difference paid and lower difference to balance (commission adjusted).
13. Balance pays a package installment, then session redeemed: revenue counted once.
14. Receivable written off: no commission.
15. Product refund to balance (default) and cash refund exception.
16. PKP boundary: package paid before PKP date, redeemed after.
17. Booking DP clinic cancellation with refund on request.
18. Payment succeeded but app response lost; duplicate gateway webhook.
19. PKP taxable package Rp3,000,000 paid, expires, balance reused for a taxable item: VAT counted once.
20. Gateway payment net of fee: gateway clearing nets to zero at settlement; fee is expense.

Scenarios 1–20 each state expected ledger lines, VAT and commission figures in a fixture document written as the **first M4 task, before any M4 code task** (R3F-18), so the accountant can review them in parallel.

## 4. Default Policy Register (adapted from Kliniknuma RG-01–RG-39)

Class: S = tenant setting (PR-38 registry, `19` §5; the SET row holds the canonical default), D = versioned data, F = fixed rule.

| ID | Rule | Default | Class | Source |
|---|---|---|---|---|
| CD-01 | Consultation fee and waiver | Per decided rules; fee amount per tenant | S → SET-6 | B-02 |
| CD-02 | Free controls per item | 1, valid to control date + 7 days | S → SET-7 | B-02 |
| CD-03 | Package validity | 365 days from purchase | S → SET-8 | B-03 |
| CD-04 | Package minimum DP % | Empty (first-session value) | S → SET-9 | B-03 |
| CD-05 | Installments allowed | On (per package) | S → SET-9 | B-03 |
| CD-06 | Booking DP | Off per treatment; cutoff 24 h | S → SET-10 | B-05 |
| CD-07 | Commission amounts | None configured until owner sets | S/D | B-07 |
| CD-08 | Cash refund approver | Owner (tenant may add manager) | S → SET-11 | B-04, B-09 |
| CD-09 | Lateness release | Off | S → SET-15 | D-05 |
| CD-10 | Front-desk idle lock | 120 s | F | Kliniknuma DEC-015 |
| CD-11 | Session value | Equal split / proportional to normal prices | F | B-03 |
| CD-12 | Partial payment allocation | Proportional after discount, excl. tax; largest remainder | F | B-07, RG-04 |
| CD-13 | Tax computation | 12% × 11/12 when taxable and PKP; snapshot per line | D | RG-11, A-06 |
| CD-14 | Correction window | 2×24 h; later admin corrections need approval | F | Permenkes 24/2022 Pasal 30 |
| CD-15 | Retention | Clinical ≥ 25 years from last visit; financial ≥ 10 years | F | Pasal 39; RG-32 |
| CD-16 | Delegation matrix | Kliniknuma RG-16 default (doctor-only for filler, toxin, threads, ablative laser; therapist never invasive) pending clinical lead | D | RG-16, PRD Q-07 |
| CD-17 | Measurement templates | GAGS, mMASI, IGA, Fitzpatrick, hydration; no % efficacy — LATER (no Release 1 PR) | D | RG-17 |
| CD-18 | Photo protocol | Front, 45°, lateral; comparability flag | D | RG-18 |
| CD-19 | Pharmacist checks and labels | Kliniknuma RG-21, RG-24, RG-25 | F/D | RG-21–RG-25 |
| CD-20 | Open-vial use-by | Product-specific, catalog field; extension needs pharmacist + facility head (penanggung jawab) | D | RG-26 |
| CD-21 | Disposal approvals | Pharmacist + witness; second approval for vials, injectables, narcotics, non-expiry reasons or ≥ Rp1,000,000 per event or Rp5,000,000 per month; owner from Rp10,000,000 (SET-43; the trigger types are fixed) | S (thresholds) / F (types) | RG-27, Numa brief A4 |
| CD-22 | Stock counts | Daily for open vials/toxins, weekly high value, monthly rest | F | RG-28, B-16 |
| CD-23 | Second-visit window / dormant | 60 / 90 days | S → SET-22 | D-06 |
| CD-24 | Lead SLA | 15 min in opening hours | S → SET-20 | D-08 |
| CD-25 | BC target metric | Closing value per month + plans fully selected | S → SET-25 | D-07 |
| CD-26 | WhatsApp templates | No diagnosis/treatment detail/photos | F | W-05 |
| CD-27 | Outbound budget | 80% of portfolio messaging limit per 24 h | S → SET-21 (bounds 10–90%) | W-06 |
| CD-28 | Missing NIK | Care never blocked; SATUSEHAT item waits in identity review | F | RG-34 |
| CD-29 | Backup and recovery | RPO 15 min, RTO 2 h, quarterly drill (pgBackRest) | F | RG-37, H-07 |
| CD-30 | Moving average cost | Per item per branch | F | A-13 |
| CD-31 | Session lifecycle | Reserve at booking/check-in, redeem on counted outcome | F | B-15 |
| CD-32 | Refund destination | Balance by default; cash as approved exception | F | B-11 |
| CD-33 | Clinical complaint response (triage) | Red 15 min, yellow 2 h, green 1 working day | S → SET-31 | RG-19, Numa brief A3 |
| CD-34 | Server fee | Rp1,000,000 per tenant per month; first month prorated; due on the 10th; reminders at due, +7, +14 days | D | P-14, PR-61 |
| CD-35 | Onboarding grant length | Until go-live, max 30 days | F | P-16, PR-58 |
| CD-36 | Appointment reminders | H-1 at 10:00 and same day 2 h before, branch time zone | S → SET-18 | PR-69 |
| CD-37 | Manual discount limits | FO/cashier 0%; manager 10% or Rp500,000, whichever is lower; owner unlimited | S → SET-12 | PR-72 |
| CD-38 | Credential-expiry alerts | 60, 30 and 7 days before | F | PR-73 |
| CD-39 | Payment port provider | `mock` until the partner decision (Q-14) | S → SET-14 | PR-68 |
| CD-40 | Service complaint first response | 8 working hours | S → SET-31 | PR-43 |
