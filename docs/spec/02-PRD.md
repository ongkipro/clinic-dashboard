# Product Requirements Document (PRD) — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Purpose | Define the problem, outcomes, scope, functional behavior, non-functional expectations and release contract of Clinic Dashboard |
| Required when | Always |
| Accountable owner | Product owner (Paduka Ongki) |
| Responsible author | AI planning agent (draft) |
| Reviewers | Clinical lead, accountant, tax adviser, privacy/health-law counsel, engineering |
| Status | Approved (P-27, 2026-11-02) |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Upstream | 01-BRD.md: BR-1–BR-6 |

**Codebase decision (P-09):** the product is built from zero in a new repository; Kliniknuma is a read-only reference for contracts and lessons, nothing is forked. **Baseline.** This PRD is built on the Kliniknuma (Numa Klinik) product in `~/Projects/kliniknuma` (`PRD.md` REQ-001–REQ-023, CLIN-001–CLIN-028, `PLAN.md` register RG-01–RG-39, `DECISIONS.md` DEC-001–DEC-018, `DESIGN.md` UX-1–UX-17) and refined by the discovery decisions in this pack's `DECISION-REGISTER.md` (canonical; the research copy is frozen history) and the research in `docs/research/`. `README.md` in this pack maps every Kliniknuma item to KEEP / MODIFY / SUPERSEDED / LATER / NEW. Claim labels: **Decision** (owner), **Observed** (repository or source), **Proposal** (recommendation), **Assumption**, **Unknown**.

## 1. Product Decision Summary

- Product/problem: Clinic Dashboard — a multi-tenant SaaS that runs a beauty clinic's daily operation from booking to clinical record, payment, stock, commission, CRM and books. Mid-size clinics run on spreadsheets, paper, personal WhatsApp numbers and point tools that do not connect clinical work, money and stock.
- Target users: clinic owner, branch manager, front office/cashier, central CS, beauty consultant (BC), doctor, nurse, therapist, pharmacist, finance staff; patients indirectly (booking page, WhatsApp).
- Desired outcome: one shared visit record per patient across roles; money, stock and commission derived from what actually happened; owners see cash, completed service and prepaid obligations separately; the clinic meets RME and SATUSEHAT duties.
- Release boundary: **Release 1 = the complete research-based product (P-21): every requirement in §7 is Must.** Deliberate exclusions are listed in §5 Non-goals with their reason; campaign broadcasts wait only for counsel (Q-15) and are built in Release 1 behind a disabled switch. Release 1 includes the basic public site and both accounting steps (journal export gated by evidence); only rich public content (PR-40) follows in Phase 4.
- Success signal: pilot clinic closes every visit through the system for 30 consecutive days with zero unexplained cash, stock or commission differences at month end.
- Recommendation/status: codebase from zero (P-09); development authorized by P-27 (G1, 2026-11-02).

## 2. Problem and Evidence

| Evidence ID | User/segment | Source/date | Observed problem | Frequency/severity | Confidence |
|---|---|---|---|---|---|
| E-1 | Mid-size and large clinics | REA captures 2026-11-02 (`rea-2026-11/`) | Most brands convert through WhatsApp links; LBC uses 41 branch numbers, L'VIORS 26, Bening's one central number for 74 branches | High, daily | High |
| E-2 | Clinic owners | Kliniknuma PRD users table (assumption, interviews not attached) | Prepaid package cash is mistaken for profit; commission and stock reconciled manually | Monthly | Medium |
| E-3 | Vendor SaaS | Assist/Aesta, ClinicHub, Kasera bundle analysis (Oct 2026) | Vendors ship ledgers, deposit liability, receivable views, suspicious-activity reports, approvals | — | High |
| E-4 | Clinic operations | Owner discovery 2026-10-30/31 (`SESSION-HANDOFF-2026-10-30.md`) | Patient re-asked at each station; pharmacy lists made by hand; additions in the room leave unpaid bills | Daily | High (owner statement) |
| E-5 | Regulation | Permenkes 24/2022 Pasal 21, 45; PP 28/2024 Pasal 781 | Every health facility must run RME integrated with SATUSEHAT since 31 Dec 2023 | Mandatory | High |
| E-6 | Tax | PP 20/2026 | PT clinics lose final 0.5% PPh after their window and need a real P&L | Yearly | High |

## 3. Users, Actors, and Context

Context: CTX-1–CTX-12, OVR-1–OVR-17, JUR-ID-1–JUR-ID-11, LOC-1. Tenant = brand = one PT (Decision P-02, P-03). Control levels (P-12): **Level 1 Super admin** (vendor team) → **Level 2 Admin Klinik Pusat** (owner and tenant-wide roles of one brand) → **Level 3 Klinik Cabang** (branch staff). If the head office also treats patients, it is also a branch. One platform serves every brand; a new client is onboarded, never built (P-11).

**Domain guard (P-13).** This is a beauty/aesthetic clinic product, not an online shop: what is sold is treatments performed on a patient, packages of sessions and consultation; products are sold at the cashier and handed over by the pharmacist. No cart, checkout, shipping or courier flow exists anywhere; UI words are Pasien, Kunjungan, Tindakan, Paket, Saldo, Kasir (not Pembeli, Pesanan, Keranjang, Checkout).

| Actor | Goal | Current behavior | Pain/risk | Access context | Tenant relationship |
|---|---|---|---|---|---|
| Owner | Money, growth, risk across branches | Bank statements + Excel | Prepaid cash read as profit | Desktop, phone | Level 2 (Admin Klinik Pusat), tenant admin, all branches |
| Admin Pusat | Configure branches, catalog, staff, settings drafts, public site for the owner | Owner does it alone or by chat | Owner bottleneck | Desktop | Level 2, all branches, no owner-only powers (P-15) |
| Marketing | Promos, public-site content, lead-source reports | Instagram + manual WA | No attribution | Desktop, phone | Level 2, consented contacts only, no clinical data |
| Purchasing / Gudang Pusat | Suppliers, POs, goods receipt, transfers across branches | Excel, chat with suppliers | Stock-outs, expired stock | Desktop | Level 2, stock only |
| Internal auditor | Review exceptions and controls (read-only) | Month-end spot checks | Fraud found late | Desktop | Level 2, read-only, no clinical content |
| Branch manager | Run the floor, approve exceptions | WhatsApp groups | Unpaid bills, stock-outs found late | Desktop/tablet | Member, scoped branches |
| Front office / cashier | Check-in, queue, payment, close visit | Paper queue, generic POS | Additions unpaid, package balance unknown | Desktop | Member, assigned branches |
| Central CS | Answer leads, book across branches | Personal WA numbers | Lost leads, no attribution | Desktop | Member, tenant-wide booking, no clinical access |
| Beauty consultant (non-medical) | Accompany patient, intake, offer within doctor's plan, follow up | Notes on paper/chat | Retyping, unfair attribution | Tablet/phone | Member, assigned visits |
| Doctor | Examine, plan, authorize, prescribe, sign | Paper sheets | History scattered | Tablet/desktop | Member, assigned patients + break-glass |
| Nurse / therapist | Prepare and perform within authority | Phone alarms | Unclear authority, manual material logs | Tablet | Member, assigned visit |
| Pharmacist | Prepare, dispense, keep stock | Manual lists, month-end count | Expired vials, shrinkage | Desktop/tablet | Member, branch |
| Finance staff | Books, tax export | Separate accounting tool | Rebuilding entries by hand | Desktop | Member, tenant |
| Patient | Book, pay, be reminded | WhatsApp chat | Forgotten sessions | Phone | Data subject, not a tenant member |
| Vendor team (super admin) | Create and run tenants, onboarding, server-fee billing, support | — | Cross-tenant risk; unrecorded access to clinic data | Desktop | Level 1 platform; clinic data only via owner-visible support sessions (PR-56–PR-60) |

## 4. Outcomes, Metrics, and Guardrails

| Outcome | Metric/formula | Baseline | Target/window | Instrumentation | Guardrail |
|---|---|---|---|---|---|
| Visits fully handled in system | Closed visits ÷ arrived visits | Unknown | ≥ 98% for 30 days in pilot | Visit lifecycle events | No visit closes with unpaid bill (PR-15) |
| Money reconciles | Unexplained difference between payments, drawer counts and ledger | Unknown | Rp0 per month | Shift close, reconciliation report | Corrections never delete history |
| Stock reconciles | Count variance on clinically significant items | Unknown | ≤ 2% per count | Stock counts | No stock change from recommendation |
| Leads answered | % leads first-answered within SLA (D-08: 15 min in opening hours) | Unknown | ≥ 90% | Lead timestamps | No marketing to non-consented contacts |
| Re-entry avoided | Fields retyped on repeat visits | Unknown | 0 unchanged fields | Intake revisions | Unverified intake never becomes a signed fact |
| SATUSEHAT delivery | Eligible encounters delivered ÷ eligible | 0 | ≥ 99% within 24 h | Outbox status | Local care never blocked by outages |

## 5. Scope

### In scope (Release 1)

- Tenant, branches, staff, roles, branch scopes; tenant onboarding.
- Patient registration, phone identity, consent ledger.
- Booking (staff and public link with source), schedules, resources, check-in, live visit board.
- BC accompaniment, doctor examination and plan, consent, treatment room checklist, interruption outcomes.
- Pharmacy preparation list, dispensing, stock per branch, batches/vials, purchasing, transfers, counts.
- Cashier: invoices, payments, split tender, packages, installments, patient balance, booking DP, receivables, refunds, consultation fee rules, shift close, receipts.
- Commission engine per decided model; BC targets.
- WhatsApp Business Platform: our Tech Provider onboarding, inbox, templates, consent, outbound budget.
- CRM: leads, follow-up queue, automation scenarios, template sending with consent; campaigns and segments built with sending switched off until Q-15 (P-24).
- Catalog with branch price overrides; approvals inbox; clinical requests and complaint escalation; notifications; patient profile, data requests, audit log, tenant export; vendor console.
- Accounting steps 1 and 2 (sub-ledgers, roll-forwards, chart of accounts, posting engine, periods, statements); journal export opens only with the accountant's posting-map evidence (PR-97); Coretax XML for PKP tenants (PR-98).
- SATUSEHAT integration; RME rules (corrections, retention, patient copy).
- Role dashboards and KPI dictionary.
- Multi-tenant platform operation: vendor console with vendor roles, tenant lifecycle, onboarding grant and checklist, support sessions, monthly server-fee billing via the vendor's AutoLaris account, platform health (PR-56–PR-62).
- Admin Pusat, Marketing, Purchasing and Internal auditor roles (PR-63).
- Basic patient public site per tenant generated from branch master, catalog and consenting doctors, on a slug path (PR-64–PR-67).
- Patient payment port with a mock gateway; real gateway after the partner decision (PR-68, Q-14).
- Research gaps: appointment reminders, aftercare, walk-in and queue number, manual-discount limits, credential-expiry alerts, document templates, supplier returns, global search (PR-69–PR-76).

### Non-goals

- Payroll and PPh 21 calculation (Decision A-09).
- Multi-brand tenants (Decision P-02).
- AI diagnosis, skin-analyzer or laser hardware integration, 3D face mapping (handoff §6).
- Native patient app; full patient portal; teleconsultation (deferred; LATER).
- Online shop: cart, checkout, shipping, courier or marketplace flows (P-13). A Phase 4 product page is display-only.
- Subscription plans and seat pricing (P-14: tenders + monthly server fee).
- Per-client code forks or custom builds (P-11).
- Loyalty points, memberships, gift cards (deferred; patient balance covers stored value).
- Operational AI summaries, corporate group booking and referral rewards (not decided; candidates after Release 1; referral **source tracking** is in Release 1 via lead sources).
- Package sharing between patients **unless** the owner enables it per package template (PR-93, P-24).
- Dark appearance in Release 1 (D-15).
- Campaign broadcasts **sending** before counsel clears Permenkes 1787/2010 for direct promotional messages (Q-15); segments and scheduling are built in Release 1 and stay switched off (D-13 amended by P-21).
- Session replay or ad pixels on health-intent pages (Decision D-12).
- Inpatient, BPJS claims.

### Constraints and dependencies

- Production, including clinical data, runs on Vultr Singapore + Coolify + Cloudflare (owner decision H-02b, risk accepted). The design is residency-portable (PR-36), and the first real patient record is gated by a legal opinion on Permenkes 24/2022 Pasal 22 (H-02d).
- Vendor identity is a placeholder (S-04) held in editable vendor-profile fields (PR-55).
- Vendor registrations before first production tenant: NIB, PSE, SNOMED CT, SATUSEHAT vendor (S-03); entity OPEN (S-04).
- External reviews before approval: accountant, tax adviser, clinical lead, legal (DECISION-REGISTER §9).

## 6. Journeys and Use Cases

| Journey | Primary actor | Trigger | Happy-path outcome | Alternate/failure path | Requirements |
|---|---|---|---|---|---|
| J1 Lead to booking | Central CS | WhatsApp message or ad click | Lead routed to branch, booked with source | No slot → waitlist note; no consent → service replies only | PR-27, PR-28, PR-29, PR-6 |
| J2 Arrival and intake | Front office, BC | Patient arrives | Registered/identified, visit opened, BC intake with photos | Duplicate phone → explicit decision; minor → guardian | PR-5, PR-7, PR-9 |
| J3 Examination and plan | Doctor | Intake ready | Verified intake, plan with stages, consent requirement known | Contraindication → no treatment, consultation fee rule | PR-10, PR-11, PR-12 |
| J4 Selection and payment | BC, cashier | Plan ready | Patient selects items, pays before first treatment | Partial payment / package DP / balance use | PR-19, PR-20 |
| J5 Treatment | Nurse/therapist/doctor | Payment and consent ready | Materials issued, treatment performed, materials reconciled | Addition in room; interruption (medical/clinic/patient) | PR-14, PR-15, PR-16 |
| J6 Dispensing and close | Pharmacist, cashier | Treatment done | Products handed over, visit closed, follow-up created | Unpaid → cannot close; receivable fallback | PR-18, PR-15, PR-30 |
| J7 Package lifecycle | Cashier, BC | Package bought | Sessions unlock with payments, redeemed per stage, expiry moves value to balance | Substitution, cancellation, refund exception | PR-20, PR-21, PR-22 |
| J8 Month end | Owner, finance | Month closes | Commissions approved, ledger closed, reports exported | Refund after payout → deduction next month | PR-23, PR-25, PR-26 |
| J9 Clinic onboarding | Owner, vendor | Tender/contract signed | Tenant created, onboarding checklist passed, go-live confirmed, server-fee billing starts | Meta number cap → verification step; checklist item blocked → go-live waits | PR-1, PR-2, PR-27, PR-35, PR-56–PR-59 |
| J10 Server-fee month | Vendor finance, owner | Month starts after go-live | Invoice issued, owner pays by QRIS/VA through AutoLaris, status reconciled | Unpaid → reminders; suspension only by platform owner | PR-61 |
| J11 Patient finds the clinic online | Patient | Search or social link | Public site shows treatment, branch and doctor, patient books with context prefilled | No published price → "harga saat konsultasi"; WhatsApp link with source | PR-64–PR-67, PR-6 |

## 7. Functional Requirements

Priority: Must = Release 1. Every Must has acceptance scenarios in §8. Kliniknuma lineage in the Source column.

| ID | Requirement | Source | Priority | Acceptance evidence | Dependencies | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR-1 | When the vendor creates a tenant, the system shall create one brand and one legal entity with at least one branch, and isolate all tenant data from every other tenant | Decision P-01–P-03; Kliniknuma DEC-013 | Must | §8 PR-1 | TEN-1 | Product owner (Paduka Ongki) | Proposed |
| PR-2 | The owner shall manage branches (address, structured opening hours, closures, timezone, rooms, devices, services offered, optional WhatsApp number, map link, publish window) from one branch master | ZAP/ERHA evidence; research needs §2.1 | Must | §8 PR-2 | PR-1 | Product owner (Paduka Ongki) | Proposed |
| PR-3 | Staff shall sign in with individual accounts; owner, Admin Pusat, manager, doctor, finance, facility head, records officer, internal auditor and central CS require a second factor (IAM-1); idle front-desk sessions lock | Kliniknuma DEC-010, DEC-012, DEC-015 | Must | §8 PR-3 | IAM-1 | Product owner (Paduka Ongki) | Proposed |
| PR-4 | The system shall record purpose-specific consents (care notice, procedure, internal clinical photo, marketing WhatsApp, publication) with history and withdrawal | Kliniknuma REQ-021; Decision PD-01 | Must | §8 PR-4 | PRIV-1 | Product owner (Paduka Ongki) | Proposed |
| PR-5 | Front office shall register a patient with minimum identity (name, phone, date of birth, NIK or an official no-NIK identity type with reason, religion, occupation, education, marital status), record a guardian for minors, and resolve duplicates by explicit decision; one phone may belong to several patients without exposing each other's data | Permenkes 24/2022 Pasal 14; Kliniknuma TASK-037, RG-36 | Must | §8 PR-5 | PR-4 | Product owner (Paduka Ongki) | Proposed |
| PR-6 | Staff and the public booking link shall book a service at a branch, reserving only the resources the service requires, recording channel and source, and applying optional booking DP | Kliniknuma REQ-005 (modified); Decision B-05 | Must | §8 PR-6 | PR-2, PR-88 (booking DP effects from PR-22 integrate in M4) | Product owner (Paduka Ongki) | Proposed |
| PR-7 | Front office shall check a patient in, open one visit, and see a live board with independent states (intake, doctor, selection, consent, payment, preparation, treatment, dispensing, closure) and an always-visible outstanding-payments list | Kliniknuma REQ-012; handoff §3 | Must | §8 PR-7 | PR-6 | Product owner (Paduka Ongki) | Proposed |
| PR-8 | The lateness rule (release slot after N minutes) shall be a tenant setting, default off | Decision D-05 | Must | §8 PR-8 | PR-6 | Product owner (Paduka Ongki) | Proposed |
| PR-9 | A BC shall record intake, photos and "Observasi Kulit" (chips and text only, no grades, scores or Fitzpatrick type) as unverified data, never a diagnosis, and see prior visits as history | Kliniknuma REQ-008; BC-SCREEN-SPEC.md | Must | §8 PR-9 | PR-7 | Clinical lead | Proposed |
| PR-10 | A doctor shall verify intake without retyping, examine, annotate the face map, and create or update a staged care plan, with prior visits, photos and plans visible on the same screen | Kliniknuma REQ-009; handoff usability needs | Must | §8 PR-10 | PR-9 | Clinical lead | Proposed |
| PR-11 | Treatment shall start only with valid practitioner credentials, competence, no unresolved contraindication, and consent matching the planned items and doses | Kliniknuma REQ-010 | Must | §8 PR-11 | PR-10 | Clinical lead | Proposed |
| PR-12 | The system shall apply BILL-4 (consultation fee charged when nothing is bought, waived with a qualifying purchase on that visit, no retroactive waiver, re-charged from a full refund of all qualifying purchases) and BILL-5 (free controls per item, default one, valid to control date + 7 days) | Decision B-02 | Must | §8 PR-12 | PR-19 | Finance owner | Proposed |
| PR-13 | Signed clinical records shall be immutable; corrections within 2×24 h by the author create a new version; later administrative corrections need records-officer or facility-head approval; records are retained at least 25 years from the last visit; patients can receive a copy of record content | Permenkes 24/2022 Pasal 26, 30, 39; Kliniknuma REQ-023 (window changed from RG-15) | Must | §8 PR-13 | PR-10 | Clinical lead | Proposed |
| PR-14 | Treatment staff shall work from a checklist that records start, actual performer, actual materials, and outcome: completed, medical stop, clinic-caused stop, or patient-chosen stop; medical or clinic stops do not use the session and allow free reschedule or move the payment to balance; a patient stop counts as used | Kliniknuma REQ-011 (modified); Decision B-06 | Must | §8 PR-14 | PR-11, PR-16 | Clinical lead | Proposed |
| PR-15 | An additional treatment shall start only after patient and authorized clinician agreement recorded in the system; FO/cashier may release it before payment (recorded with the staff accountable for collection; no amount limit, no manager approval); FO is alerted at approval and again when it finishes unpaid; a visit cannot close with an unpaid bill or pending dispensing; after the WhatsApp-bill fallback FO may convert the remainder to a patient receivable, which settles the visit bill | Decision B-01; Kliniknuma REQ-014 (modified) | Must | §8 PR-15 | PR-7, PR-19 | Product owner (Paduka Ongki) | Proposed |
| PR-16 | Material demand shall follow request → issue → consume / return / waste per item class; recommendation or selection never changes stock; nothing is deducted twice | Handoff §5; OPERATIONAL-SCENARIO-AUDIT A01–A02; Kliniknuma REQ-015 | Must | §8 PR-16 | PR-17 | Product owner (Paduka Ongki) | Proposed |
| PR-17 | Stock shall be held per branch with batches, expiry, opened-vial use-by, FEFO, minimum/target levels, purchasing and goods receipt, inter-branch transfers, and counts | Kliniknuma REQ-016, TASK-039; Decision B-08 | Must | §8 PR-17 | PR-2 | Product owner (Paduka Ongki) | Proposed |
| PR-18 | The pharmacist shall receive an automatic preparation list from approved selections and dispense prescriptions and products after the seven pharmacist checks (CD-19: patient and prescriber identity, prescription validity, dose/route/frequency, allergy and interaction check, clarification outcome, label, counselling) recorded with dispenser identity and exceptions; batch-to-patient traceability; stock in `quarantined`, `recalled` or `temperature_excursion` status is non-dispensable until released by the pharmacist with reason; recalls list affected dispensings; special drugs (narcotics, psychotropics) are excluded and cannot be enabled until their controls are approved; external-use label where required (verify Permenkes 34/2021 scope with Numa's pharmacist) | Handoff usability needs; Kliniknuma REQ-007, REQ-015 | Must | §8 PR-18 | PR-16 | Product owner (Paduka Ongki) | Proposed |
| PR-19 | The cashier shall issue invoices with frozen prices, accept split tender (cash, QRIS, EDC, transfer, payment link, patient balance), allocate partial payments proportionally after discount, print/send receipts, sell products at the counter without a visit (patient optional; pharmacist hand-over still required for regulated items), void an invoice only through approval (requester ≠ approver), and close shifts with any non-zero cash variance approved (BILL-18) | Kliniknuma REQ-013 (modified), TASK-038; Decision B-07 allocation | Must | §8 PR-19 | PR-24 (shared invoice/tax foundation built first) | Finance owner | Proposed |
| PR-20 | Packages shall unlock sessions only within cumulative paid value using the decided session-value rule, accept installments without a binding schedule or interest (an optional reminder-only schedule, PR-96, creates no debt or entitlement), enforce minimum DP and validity, reserve a session at booking/check-in and redeem it only when the outcome counts (B-15), and on expiry or cancellation move paid-unused value to patient balance and cancel the unpaid remainder | Decision B-03 | Must | §8 PR-20 | PR-19 | Finance owner | Proposed |
| PR-21 | Patient balance shall never expire, pay for any item, and be refunded in cash only as an approved, recorded exception | Decision B-04 | Must | §8 PR-21 | PR-19 | Finance owner | Proposed |
| PR-22 | Booking DP shall be applied on arrival, move to balance on patient change ≥ 24 h, be forfeited on no-show or patient change < 24 h, and on clinic cancellation move to balance or be refunded if the patient asks | Decision B-05 | Must | §8 PR-22 | PR-6 | Finance owner | Proposed |
| PR-23 | Commissions shall follow BILL-15 (role default + individual override, % or fixed, actual allocated payment basis, guiding/closing BC, new patient on first visit, performer only when counted, monthly approval, refund and moved-to-balance adjustments, carry-forward of excess deductions, rule snapshots, no commission on written-off items or top-ups); staff see only their own; per-recipient commission export for the tax adviser | Decision B-07; Kliniknuma REQ-017 superseded | Must | §8 PR-23 | PR-19, PR-14 | Finance owner | Proposed |
| PR-24 | Each sellable item shall carry a tax category with a recorded basis; invoices snapshot it; VAT applies only while the tenant is PKP and only after the tax adviser's written advice (Q-05) is recorded; consumer prices are VAT-inclusive; a 12-month turnover monitor warns non-PKP tenants near Rp4.8 billion | Decisions A-06, A-07, A-12; Kliniknuma RG-10–RG-12 | Must | §8 PR-24 | PR-41 (catalog tax category) | Finance owner | Proposed |
| PR-25 | Accounting step 1 shall keep sub-ledgers for cash/bank by method, contract liability (paid not yet delivered), receivables, patient balance, package liability, booking DP, commission payable and VAT, with roll-forward reports and sub-ledger/transaction CSV exports (journal export only after the posting map is signed, A-14) | Decisions A-01, A-08, D-09 | Must | §8 PR-25 | PR-19, PR-20, PR-23 | Finance owner | Proposed |
| PR-26 | Accounting (step 2, Release 1) shall provide a chart of accounts, automatic posting from events per an approved posting map, manual journals, period lock, trial balance, P&L, balance sheet and cash-flow summary (P&L per branch and consolidated; balance sheet per branch through inter-branch clearing), for SAK EMKM or SAK EP | Decisions A-01–A-05 | Must (journals exported only after the accountant signs the posting map, A-02/Q-06) | §8 PR-26 | PR-25 | Finance owner | Proposed |
| PR-27 | The vendor shall onboard each tenant's WhatsApp Business Account through Embedded Signup (incl. Coexistence), with numbers per branch or per brand and `Brand – Branch` display names, tracking registration, display-name status, quality and the portfolio messaging limit; a BSP fallback is used if our Tech Provider approval is pending (W-09) | Decisions W-01–W-08 | Must | §8 PR-27 | PR-1 | CRM owner | Proposed |
| PR-28 | Staff shall work one shared WhatsApp inbox per tenant with branch routing, assignment, service-window timer, quick replies and template sending | Big-brand evidence E-1; Decision W-01 | Must | §8 PR-28 | PR-27 | CRM owner | Proposed |
| PR-29 | Leads shall follow new → contacted → booked → arrived → converted / lost (reason), with source, campaign and first-response time | BIG-BRAND requirements §6 | Must | §8 PR-29 | PR-28 | CRM owner | Proposed |
| PR-30 | The system shall create follow-up tasks from decided rules (control due, next package stage, package expiry 30/14/7 days, locked installment sessions, receivables, unselected plan items, no-shows, dormant > 90 days) | Decisions B-02, B-03, D-06 | Must | §8 PR-30 | PR-20, PR-10 | CRM owner | Proposed |
| PR-31 | Outbound messages shall respect consent, a tenant-level daily budget under the shared messaging limit, and carry no diagnosis, treatment detail or photos | Decisions W-05, W-06 | Must | §8 PR-31 | PR-4, PR-27 | CRM owner | Proposed |
| PR-32 | Clinical photos and documents shall be private, served through short-lived authenticated access, and kept separate from publication rights | Kliniknuma REQ-021 | Must | §8 PR-32 | PR-4 | Clinical lead | Proposed |
| PR-33 | Role dashboards shall show the KPIs of Appendix A for their role (PR-33a–PR-33f) with branch and consolidated views, each value drilling down to the records behind it, without clinical content | BIG-BRAND requirements §4–5; Decision D-11 | Must | §8 PR-33 | PR-25 | Product owner (Paduka Ongki) | Proposed |
| PR-34 | A reconciliation report shall show differences between operational KPIs and ledger balances by day and branch | Research needs §7 | Must | §8 PR-34 | PR-26 | Finance owner | Proposed |
| PR-35 | Signed clinical events shall be sent to SATUSEHAT through a durable outbox per branch credentials, with retries, error list and monitoring; outages never block local care; non-medical BC intake is not sent as a clinician finding | Decisions S-01, S-06, S-07; Kliniknuma REQ-022 | Must | §8 PR-35 | PR-10, PR-2 | Clinical lead | Proposed |
| PR-36 | Production storage locations (database, object storage, backups, logs, error tracking) shall be read from deployed configuration and declared in the vendor profile; real-patient go-live (tenant activation, patient creation, public booking in production) is blocked until the residency-opinion flag (H-02d) is set or all locations are Indonesian; a migration runbook moves the whole environment (not a single tenant) to another region without code changes | Decision H-02b, H-02d; Permenkes 24/2022 Pasal 12, 20, 22 | Must | §8 PR-36 | PR-55 | Product owner (Paduka Ongki) | Proposed |
| PR-37 | Approvals (refund exception, write-off, attribution correction, commission batch, stock adjustment, disposal) shall use requester ≠ approver and be audited, except an owner-initiated write-off (B-14), which needs a mandatory reason and is audited | Kliniknuma DEC-004, RG-27; vendor evidence; B-14 | Must | §8 PR-37 | PR-3 | Product owner (Paduka Ongki) | Proposed |
| PR-38 | Tenant settings shall be a registry (`19` §5, SET-1–SET-49): each setting has a researched default, type and bounds, tenant or branch scope, the roles that may change it, an effective date and an audit record; transactions snapshot the value used; "Kembalikan ke default" restores the research default; class F rules (law, money integrity, isolation) are never settings; adding a setting needs a decision | Decisions B-09, B-22, B-24 (supersedes the closed list), P-22; Kliniknuma DEC-017 | Must | §8 PR-38 | PR-1 | Product owner (Paduka Ongki) | Proposed |
| PR-39 | Public pages shall load no session replay and no third-party ad or analytics pixel on any treatment, concern, doctor, booking, intake or complaint route (these URLs reveal health intent); only the home and branch pages may load a marketing pixel, after consent, with path and query redaction | Decision D-12; research §10.3 #7 | Must | §8 PR-39 | PR-6 | CRM owner | Proposed |
| PR-40 | Rich public content (educational articles with medical-review stamp, consented before/after only if counsel clears it under Permenkes 1787/2010 Pasal 5, concern landings, skin quiz, display-only product catalog) shall extend the basic public site (PR-64); **no patient testimonials on public pages** (Pasal 5 huruf n) | Kliniknuma REQ-001–REQ-004; P-17; JUR-ID-7 | Phase 4 (P-17, P-21) | Phase 4 acceptance | PR-64 | Product owner (Paduka Ongki) | Proposed |
| PR-41 | The owner and manager shall maintain one versioned catalog of services, products, packages and material formulas with per-item control rules, booking-DP flag, tax category, commission scope and normal price; clinical fields (indications, contraindications, consent template, delegation) publish only after clinical-lead review | Kliniknuma REQ-020 (modified); handoff "centralized master data" | Must | §8 PR-41 | PR-1 | Product owner (Paduka Ongki) | Proposed |
| PR-42 | The owner shall set branch price overrides on the shared catalog; invoices snapshot the branch-effective price; package session value uses the selling branch's effective normal prices at sale time | Decision B-08 | Must | §8 PR-42 | PR-41 | Finance owner | Proposed |
| PR-43 | Staff shall flag an inbound message or visit note either as **Klinis** (suspected complication or adverse event → clinical review task for the branch's clinician on duty, response target CD-33) or **Layanan** (waiting time, billing dispute, staff behaviour → task for the branch manager, response target CD-40), each with status; treatment-caused extra controls are free | Kliniknuma REQ-018, CLIN-016, CLIN-024, RG-19 | Must | §8 PR-43 | PR-28 | Clinical lead | Proposed |
| PR-44 | One approvals inbox shall list every approval type (refund exception, write-off, attribution and guiding-BC reassignment, commission batch, stock adjustment, disposal, late record correction, shift variance, invoice void, manual discount above limit) with requester ≠ approver (owner write-off exception, PR-37) | Review-3 F-4; PR-37 | Must | §8 PR-44 | PR-37 | Product owner (Paduka Ongki) | Proposed |
| PR-45 | Clinicians shall receive and decide clinical requests (additional treatment, plan change, substitution) from the room or BC on their phone or iPad, with reason on decline | Decision B-01, B-03; BC-SCREEN-SPEC BC-4/BC-6 | Must | §8 PR-45 | PR-10 (addition payment flow from PR-15 integrates in M4) | Clinical lead | Proposed |
| PR-46 | Inventory shall be valued at moving average cost per item per branch; consumption, waste and transfers post at that cost; margin reports label estimated consumption | Decision A-13 | Must | §8 PR-46 | PR-17 | Finance owner | Proposed |
| PR-47 | The owner shall set BC targets (closing value per month, plans fully selected) and staff see attainment in Saya | Decision D-07 | Must | §8 PR-47 | PR-23 | Product owner (Paduka Ongki) | Proposed |
| PR-48 | Managers shall maintain staff schedules (shifts, leave) per branch; booking offers only rostered performers | Kliniknuma TASK-037, UX-14 | Must | §8 PR-48 | PR-6 | Product owner (Paduka Ongki) | Proposed |
| PR-49 | A patient profile shall show identity, contacts, guardian, consents (with withdrawal), balance, packages and receivables, and produce a copy of record content for the patient | Permenkes 24/2022 Pasal 26; PR-4 | Must | §8 PR-49 | PR-5 | Clinical lead | Proposed |
| PR-50 | Data-subject requests shall be logged and tracked to closure with due dates | UU 27/2022; PRIV-2 | Must | §8 PR-50 | PR-49 | Product owner (Paduka Ongki) | Proposed |
| PR-51 | The owner and facility head shall review an audit log of clinical access, break-glass use, approvals and settings changes | SEC-5, IAM-6 | Must | §8 PR-51 | PR-3 | Product owner (Paduka Ongki) | Proposed |
| PR-52 | The owner shall export all tenant data (clinical as FHIR bundle + PDF per record, financial and CRM as CSV) with a checksum manifest, for exit and handover | PRIV-5, PRIV-8; Permenkes 24/2022 Pasal 22 | Must | §8 PR-52 | PR-1 | Product owner (Paduka Ongki) | Proposed |
| PR-53 | The vendor operator console shall provision tenants and open time-limited, reasoned, tenant-visible support sessions | TEN-6 | Must | §8 PR-53 | PR-1 | Product owner (Paduka Ongki) | Proposed |
| PR-54 | In-app notifications shall deliver role alerts (unpaid addition, clinical request, complaint task, approval waiting) with acknowledgement | Decision B-01 alerts | Must | §8 PR-54 | PR-3 (alert types from PR-15, PR-43, PR-44, PR-45 are added when those are built) | Product owner (Paduka Ongki) | Proposed |
| PR-55 | The vendor operator shall maintain a vendor profile (legal name, NIB, PSE number, NPWP, Meta business ID, website, privacy-policy URL, support contacts, declared storage locations, residency-opinion reference/date/outcome/set-by with file checksum) used by receipts, templates, legal pages and registrations; placeholder values are visibly marked and block production go-live until replaced; only the product owner may set the residency-opinion flag, audited | Decision S-04, H-02d | Must | §8 PR-55 | PR-53 | Product owner (Paduka Ongki) | Proposed |
| PR-56 | The vendor shall manage each tenant through lifecycle states provisioning → onboarding → live → suspended → exit → closed, with reason and owner notice on suspend and exit; suspension is manual and reversible by the platform owner with reason; while suspended, new bookings, public pages and marketing stop, while existing appointments, cashier, care messages (aftercare, reminders for existing bookings, complaint replies) and clinical read/export continue | P-11, P-16 | Must | §8 PR-56 | PR-1 | Product owner (Paduka Ongki) | Proposed |
| PR-57 | Vendor staff shall hold vendor roles (platform owner, onboarding, support, vendor finance, auditor) separate from clinic memberships, with TOTP and requester ≠ approver for clinical-data grants, suspension, exit, server-fee change and invoice waiver | P-16 | Must | §8 PR-57 | PR-53 | Product owner (Paduka Ongki) | Proposed |
| PR-58 | An onboarding grant shall let onboarding staff configure branches, catalog, staff invitations, imports and branding until go-live or 30 days (renewable once by the owner in Akses Vendor), never clinical rows, visible to the owner | P-16 | Must | §8 PR-58 | PR-56 | Product owner (Paduka Ongki) | Proposed |
| PR-59 | The processor agreement and NDA shall be signed before onboarding starts (TEN-12); go-live shall require every blocking onboarding-checklist item per tenant and branch (entity and tax status, branches, catalog, staff and credentials, money settings; payment port, WABA and SATUSEHAT when used) and the platform owner's confirmation; the go-live date starts server-fee billing | P-14, P-16 | Must | §8 PR-59 | PR-56, PR-36 | Product owner (Paduka Ongki) | Proposed |
| PR-60 | Platform-level vendor views shall show counts and status codes only; clinic data is reachable only in a support session (PR-53) that the owner sees in Saya › Akses Vendor, can end, and must approve first when the scope includes clinical data or specific personal data (TEN-14); every record read in a session is listed to the owner; infrastructure access (SEC-20) is reported the same way | P-16; PRIV-13 | Must | §8 PR-60 | PR-53 | Security owner | Proposed |
| PR-61 | The vendor shall bill each live tenant a monthly server fee (default Rp1,000,000, VAT-exclusive, set per tenant with reason and effective month, approved by the platform owner), invoiced per BILL-31 (prorated first month, then monthly in advance due on the 10th; waiver and credit notes as new documents), paid by QRIS/VA through the vendor's AutoLaris account using payment attempts per BILL-32, and marked paid only by the AutoLaris Advice status confirmed for the account (Q-13); reminders at due date, +7 and +14 days | P-14 | Must | §8 PR-61 | PR-59 | Product owner (Paduka Ongki) | Proposed |
| PR-62 | The vendor console shall show platform health per tenant and provider (uptime, worker heartbeat, outbox backlog, backup age, error rate) from existing telemetry, without clinic content (error codes and counts only; provider error bodies never shown outside a session) | P-16; OBS-2–OBS-4 | Must | §8 PR-62 | PR-56 | Engineering owner | Proposed |
| PR-63 | The tenant shall support Admin Pusat (tenant-wide configuration of branches, catalog, staff, settings drafts and public site; not branch price overrides, cash-refund or write-off approval, commission batch approval, tenant export or vendor-access approval), Marketing (promos, public-site content, lead-source reports; consented contacts only; no clinical data), Purchasing (suppliers, POs, receipts, transfers, supplier returns, stock reports across branches) and Internal auditor (read-only audit log, approvals, suspicious-activity, stock variance, refunds and write-offs) | P-15; research §4.2 | Must | §8 PR-63 | PR-3 | Product owner (Paduka Ongki) | Proposed |
| PR-64 | Each tenant shall have a basic public site generated from branch master, catalog and staff profiles (home, treatments, treatment detail, branches, branch detail, doctors, doctor profile, booking, privacy, terms, cancellation policy; no promo page until Q-15), published by owner, Admin Pusat or Marketing, served on the booking host at a slug path until domain routing is activated | P-17 | Must | §8 PR-64 | PR-2, PR-41 | Product owner (Paduka Ongki) | Proposed |
| PR-65 | Public pages shall follow Permenkes 1787/2010 (JUR-ID-7): accurate, evidence-based, informative, educational (Pasal 4); no superlatives or "satu-satunya", no comparison with other clinics, no promised or unrealistic results, no testimonials, no **advertised discounts or sales promotions**, no academic or professional titles used as promotion (Pasal 5 huruf b–e, m, n, o); treatment pages show what it is for, who performs it, duration, downtime, sessions and interval, and the branch-effective tariff only when published (otherwise "Harga dijelaskan saat konsultasi"); clinical text publishes only after clinical-lead review | P-17; JUR-ID-7 | Must | §8 PR-65 | PR-64 | Clinical lead | Proposed |
| PR-66 | Doctors shall appear on the public site only with recorded listing consent, as factual information (name, practice schedule, branch, SIP status as the clinic chooses), never as a model or endorser (Permenkes 1787/2010 Pasal 8); whether titles may be shown is confirmed by counsel (Q-15); withdrawal hides them on the next publish | P-17; JUR-ID-7 | Must | §8 PR-66 | PR-64 | Product owner (Paduka Ongki) | Proposed |
| PR-67 | Every public page shall offer booking with treatment, branch or doctor prefilled and a labelled WhatsApp link carrying a source tag; unpublished or suspended tenants return not-found or a closed notice with no tenant data | P-17; PR-39 | Must | §8 PR-67 | PR-64, PR-6 | CRM owner | Proposed |
| PR-68 | Patient payments by QRIS, virtual account or payment link shall go through one payment port (create charge, status, cancel, refund where supported, channel list, webhook verification) with normalized states; Release 1 ships a mock adapter that simulates paid, expired, failed, duplicate and late webhooks, marks its receipts SIMULASI and never counts as cash; a real provider is one adapter chosen per tenant (Q-14); cash, EDC and manual transfer need no gateway | H-10; H-09 | Must | §8 PR-68 | PR-19 | Finance owner | Proposed |
| PR-69 | The system shall send appointment reminders (default H-1 and same-day morning, branch setting) as neutral WhatsApp utility templates (clinic, branch, date and time; no service name, PRIV-15) with Konfirmasi and Ubah Jadwal replies that update the appointment, within the outbound budget | P-18; research §5.2 | Must | §8 PR-69 | PR-6, PR-31 | CRM owner | Proposed |
| PR-70 | Each catalog item may carry clinical-reviewed aftercare text delivered at visit close as a care message (not marketing): a neutral WhatsApp notice with a short-lived OTP-protected link, or printed at the clinic (PRIV-15); a reply reporting a problem is offered to staff as a complaint flag (PR-43) | P-18; research §4.1 | Must | §8 PR-70 | PR-41, PR-43 | Clinical lead | Proposed |
| PR-71 | Front office shall register walk-in patients without a booking from Hari Ini and issue a daily queue number per branch; a TV call display is optional | P-18; Kliniknuma gap audit #2–#3 | Must | §8 PR-71 | PR-5, PR-7 | Product owner (Paduka Ongki) | Proposed |
| PR-72 | Manual discounts shall have a limit per role (percent and rupiah, tenant setting); above the limit the discount waits in Persetujuan; every manual discount appears in the suspicious-activity report | P-18; SEC-9 | Must | §8 PR-72 | PR-19, PR-44 | Finance owner | Proposed |
| PR-73 | Clinical credentials (STR, SIP, SIPP, SIPA) shall raise alerts, only for credentials that carry an expiry date (lifetime STR has none), to the holder and the facility head 60, 30 and 7 days before expiry and appear in Perlu Ditangani | P-18; IAM-4 | Must | §8 PR-73 | PR-3, PR-54 | Clinical lead | Proposed |
| PR-74 | The tenant shall maintain versioned templates for receipts, procedure consent and medical letters (surat keterangan, rujukan, resume); letters are created from a template, signed by the doctor and stored as part of the medical record | P-18; TD-4 | Must | §8 PR-74 | PR-13 | Clinical lead | Proposed |
| PR-75 | Purchasing shall maintain suppliers and record supplier returns with reason, batch and credit note, reducing stock at moving average cost | P-18; research §5.2 | Must | §8 PR-75 | PR-17, PR-46 | Product owner (Paduka Ongki) | Proposed |
| PR-76 | Roles with patient-identity access (07) shall search patients by name, phone, medical-record number and invoice number from their role home; search runs in PostgreSQL under RLS (no external index); results show name, masked phone, MRN and status only for allowed branches; invoice results show totals, not line items, to non-clinical roles; queries are sent in the request body, excluded from logs, rate-limited per staff, and more than the hourly threshold alerts the facility head | P-18; research §5.1; R3B-14 | Must | §8 PR-76 | PR-5 | Product owner (Paduka Ongki) | Proposed |
| PR-77 | Promo and voucher codes with quota, period, eligible items and branches, and usage statistics, applied as discount lines **at the cashier and in direct consented messages only**; discounts are never advertised on public pages (Permenkes 1787/2010 Pasal 5 huruf m) | P-18; JUR-ID-7 | Must (internal codes; never advertised publicly) | §8 PR-77 | PR-72 | Product owner (Paduka Ongki) | Proposed |
| PR-78 | Post-visit satisfaction survey; a low score creates a manager task before any public review request | P-18 | Must | §8 PR-78 | PR-30 | CRM owner | Proposed |
| PR-79 | Operational expenses and petty cash per branch with category and receipt photo, feeding branch margin and accounting step 2 | P-18 | Must | §8 PR-79 | PR-19 (expense posting into the ledger integrates in M8 with PR-25/PR-26) | Finance owner | Proposed |
| PR-80 | Daily owner digest by WhatsApp or email (cash in, completed service, exceptions), aggregates only | P-18 | Must | §8 PR-80 | PR-33 | Product owner (Paduka Ongki) | Proposed |
| PR-81 | Waitlist for a service and branch when no slot is free, offered when a slot opens | P-18 | Must | §8 PR-81 | PR-6 | Product owner (Paduka Ongki) | Proposed |
| PR-82 | Device and room logbooks (sterilization, calibration, maintenance) and a patient-safety incident register (KTD, KNC, KTC, KPC, sentinel) with responsible officer, classification, immediate response, investigation, reporting determination (recipient and deadline only as verified), submission evidence and corrective-action closure; medical-waste register link (date, category, quantity, authorized handler, handover evidence) without a waste-logistics module (Permenkes 11/2017 Pasal 5; PP 28/2024; PP 22/2021 — verify) | P-18; JUR-ID-8 | Must | §8 PR-82 | PR-43 | Clinical lead | Proposed |
| PR-83 | Front office and CS shall manage appointments by state (booked, confirmed, arrived, no-show, cancelled, rescheduled) with actions Ubah Jadwal, Batalkan and Tandai Tidak Datang, view the calendar by doctor, room or device, and receive a task for every "Ubah Jadwal" reminder reply; booking-DP rules apply (PR-22) | Research §4.2, §5.2; review round 3 R3C-6 | Must | §8 PR-83 | PR-6, PR-22, PR-69 | Product owner (Paduka Ongki) | Proposed |
| PR-84 | Staff with several allowed branches or several memberships shall switch the active branch (Saya › Ganti Cabang) and brand (Saya › Ganti Klinik); the active brand and branch are shown under the title and recorded on every action | IAM-3, DATA-55; review round 3 R3C-8 | Must | §8 PR-84 | PR-3 | Security owner | Proposed |
| PR-85 | Records officers shall merge duplicate patients with an audited, reversible merge record; onboarding staff shall import patients, packages and balances through a validated CSV import with dry-run report (MIG-3) | Research §5.2; PR-58; review round 3 R3C-12 | Must | §8 PR-85 | PR-5, PR-58 | Product owner (Paduka Ongki) | Proposed |
| PR-86 | The clinic app shall present the complete research-based navigation tree of `19` §2 (dashboard, front office, schedule, patients, clinical, treatment room, cashier, packages, pharmacy and inventory, staff, marketing and CRM, finance, reports, approvals and audit, integrations, settings, Saya) with the global shell (branch switcher, global search, quick actions, notifications, inbox badge, user menu), role-filtered (pages a role cannot use are absent), with list and detail page conventions NAV-4 and NAV-5 | P-21; research §5.1–§5.2, §7 | Must | §8 PR-86 | PR-3, PR-63 | Design owner | Proposed |
| PR-87 | The vendor console shall present the complete tree of `19` §3, and the public site the page set of `19` §4 | P-21 | Must | §8 PR-87 | PR-56, PR-64 | Design owner | Proposed |
| PR-88 | The tenant shall maintain a service master (Master Layanan): category, duration (prep 0–120, treatment 5–480, buffer 0–120 min), required room/device, eligible staff and delegation, branch price, tax class, BHP recipe with units, consent template, aftercare text, online-bookable flag and web fields; clinical fields publish after facility-head review; materials by pharmacist | Research §5.2 Pengaturan master layanan; R4 F1/F02 | Must | §8 PR-88 | PR-41 | Product owner (Paduka Ongki) | Proposed |
| PR-89 | Stock shall be held per depot within a branch (e.g. gudang, ruang tindakan, apotek) with transfers between depots and between branches, and alerts for low stock, near expiry and opened-vial use-by | Research §5.2 Gudang/depot, §7.9 | Must | §8 PR-89 | PR-17 | Product owner (Paduka Ongki) | Proposed |
| PR-90 | Purchasing shall record supplier invoices against goods receipts, track supplier payables (due date, balance), record payments to suppliers and apply supplier credit notes | Research §5.2 Keuangan "hutang"; R4 F03 | Must | §8 PR-90 | PR-17, PR-75 | Finance owner | Proposed |
| PR-91 | The tenant shall see and manage access: a read-only permission matrix per role (07), active sessions per staff with revoke, duty assignments (data protection, IT admin), and a log of permission changes | Research §7.13; IAM-13, IAM-16 | Must | §8 PR-91 | PR-3 | Security owner | Proposed |
| PR-92 | The tenant shall keep a privacy workspace: consent purposes and texts (versioned), consent ledger across patients, processor register, breach register with notice evidence, and data-subject requests (PR-50) | PRIV-1, PRIV-9, PRIV-18; research §4.2 DPO | Must | §8 PR-92 | PR-4, PR-50 | Privacy owner | Proposed |
| PR-93 | Patient packages may be shared with named family beneficiaries only where the owner enables it per package template (default off, B-03 keeps no sharing until enabled); swaps are value-based with doctor approval | Research §7.8; B-03 | Must | §8 PR-93 | PR-20 | Finance owner | Proposed |
| PR-94 | CRM automation scenarios: reminders (H-3, H-1, same day), post-treatment follow-up (H+1, H+7, H+14), control due, package expiry, product refill, birthday greeting (care-neutral text, marketing consent), dormant reactivation; campaigns and segments are built in Release 1 with sending gated by the Q-15 counsel evidence (PR-97); each scenario has an on/off, offsets and a frequency cap per patient | Research §5.2 Otomasi; R4 F05 | Must | §8 PR-94 | PR-30, PR-69 | CRM owner | Proposed |
| PR-95 | Reports shall include, besides K1–K19: average ticket, churn, top patients by spend, lifetime value, sales per shift, doctor activity (visits, unsigned records), pharmacy waiting time, promo-code performance and satisfaction; defined as K20–K27 in Appendix A (versioned in the KPI dictionary); every report links its definition in the KPI dictionary page | Research §5.2 Laporan, §6; R4 F09 | Must | §8 PR-95 | PR-33 | Product owner (Paduka Ongki) | Proposed |
| PR-96 | Instalment schedules on receivables and packages may be recorded optionally (agreed dates and amounts) for reminders only; payments still unlock sessions by paid value (B-03) | Research §5.2 "cicilan/termin"; B-03 | Must | §8 PR-96 | PR-20 | Finance owner | Proposed |
| PR-97 | Experts do not get logins. Their output enters as evidence in a compliance register (vendor level: PSE, residency opinion H-02d, SATUSEHAT vendor registration, Meta, processor-agreement template; tenant level: tax advice, accountant posting-map sign-off, clinical authority matrix, SOPs for downtime, incidents and waste, DPIA, DPO/Penanggung Jawab/pharmacist appointments, signed processor agreement); each item has owner, status, date, file with checksum, validity and the features it unlocks; features gated by an item (VAT on invoices, journal export, public-site publish, campaign sending, clinical go-live, real-patient go-live) stay off until the item is approved | P-26; Numa brief §S; Q-05, Q-06, Q-07, Q-15, Q-17 | Must | §8 PR-97 | PR-55 (gates for PR-24, PR-26, PR-98 attach when those are built) | Product owner (Paduka Ongki) | Proposed |
| PR-98 | PKP tenants shall export output-tax invoices as Coretax XML per month from frozen invoice tax snapshots, with corrections and returns as their own documents; the export is available only after the tax-advice evidence is approved (PR-97) | Decision A-15, D-09; JUR-ID-11 | Must | §8 PR-98 | PR-24, PR-97 | Finance owner | Proposed |
### 7.1 Dashboard requirements (split of PR-33)

| ID | Requirement | Source | Priority | Acceptance evidence | Dependencies | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR-33a | Owner dashboard (Ringkasan): Perlu Ditangani, K1, K2, K3, K4, K5 with package-expiry slice, K6, K1 vs K2 trend, branch league (K1, K2, K7, K8, K9, K10, K11, K12, K16, K17), treatment mix (K2, K7), channel funnel (K13); deltas compare with the tenant's own previous period (D-11) | BIG-BRAND §5.1 | Must | §8 PR-33a | PR-33 | Product owner (Paduka Ongki) | Proposed |
| PR-33b | Branch manager dashboard: today counts, chase list, tomorrow gaps (K15), stock risk (K18), staff (K19, K17) | BIG-BRAND §5.2 | Must | §8 PR-33b | PR-33 | Product owner (Paduka Ongki) | Proposed |
| PR-33c | Front office: Hari Ini board plus shift summary by tender | BIG-BRAND §5.3 | Must | §8 PR-33c | PR-33 | Product owner (Paduka Ongki) | Proposed |
| PR-33d | BC: my patients, follow-ups due, own K19 and K17 | BIG-BRAND §5.4 | Must | §8 PR-33d | PR-33 | Product owner (Paduka Ongki) | Proposed |
| PR-33e | CS: inbox health (new, unassigned, overdue K14), K13 by source | BIG-BRAND §5.6 | Must | §8 PR-33e | PR-33 | CRM owner | Proposed |
| PR-33f | Finance: K1 by method, K3, K4 aging, K5 detail, K6, refunds/write-offs, commission batches, roll-forwards | BIG-BRAND §5.7 | Must | §8 PR-33f | PR-33 | Finance owner | Proposed |
| PR-33g | Admin Pusat home: setup completeness per branch (hours, rooms, catalog prices, staff and credentials), pending configuration and approvals routed to the owner, branch status list | P-15; review round 3 R3C-3 | Must | §8 PR-33g | PR-33, PR-63 | Product owner (Paduka Ongki) | Proposed |

## 8. Acceptance Scenarios

```gherkin
Scenario: PR-1 tenant isolation
  Given tenants A and B each with one patient
  When a staff member of tenant A requests tenant B's patient by ID
  Then the response is not-found and an audit event records the attempt

Scenario: PR-2 structured hours
  Given a branch with hours 09:00-20:00 WIB and a closure on a date
  When a booking slot is requested on the closure date
  Then no slot is offered and the public branch listing shows the closure

Scenario: PR-3 second factor
  Given a doctor account without an enrolled second factor
  When the doctor signs in with the correct password
  Then clinical pages stay locked until the second factor is enrolled

Scenario: PR-4 consent withdrawal
  Given a patient with marketing WhatsApp consent and a queued promo
  When the patient withdraws marketing consent
  Then the promo is not sent and care reminders continue

Scenario: PR-5 shared phone
  Given two patients registered with the same phone number
  When front office searches by that phone
  Then both are listed for an explicit choice and neither record shows the other's clinical data

Scenario: PR-6 resources and source
  Given a service needing a doctor and a room but no device
  When a slot is booked from a link with source=ig-ad and branch=B2
  Then only doctor and room are reserved and the booking stores source ig-ad and branch B2

Scenario: PR-7 outstanding list
  Given a visit with an unpaid addition
  When any front-office user opens the board
  Then the visit appears in the outstanding-payments list until settled

Scenario: PR-8 lateness default
  Given a new branch
  When a patient arrives 30 minutes late
  Then the slot is not auto-released unless the branch enabled the rule

Scenario: PR-9 no scores from BC
  Given a BC submitting skin observation
  When the submission contains a score or Fitzpatrick field
  Then it is rejected

Scenario: PR-9 BC cannot diagnose
  Given a BC on an assigned visit
  When the BC tries to record a diagnosis or sign the record
  Then the action is refused and intake stays marked unverified

Scenario: PR-10 history on one screen
  Given a returning patient with two earlier visits
  When the doctor opens today's examination
  Then earlier visits, photos and active plans are visible without leaving the screen

Scenario: PR-11 consent mismatch
  Given consent for 20 units of a product
  When the plan is raised to 25 units
  Then treatment cannot start until new consent is recorded

Scenario: PR-12 consultation fee after full refund
  Given a visit where consultation was waived because a product was bought
  When every qualifying purchase is fully refunded
  Then the consultation fee becomes chargeable and is deducted from the refund

Scenario: PR-13 correction window
  Given a record input by a doctor 50 hours ago with an administrative error
  When the doctor corrects it
  Then the correction needs approval of the records officer or facility head and the prior version stays readable

Scenario: PR-14 patient-chosen stop
  Given a package session in progress
  When the patient chooses to stop
  Then the session counts as used, the performer earns commission, and actual materials are recorded

Scenario: PR-15 alerts
  Given an addition authorized by the clinician and agreed by the patient
  When it is approved
  Then FO receives the first alert
  And when it finishes unpaid FO receives the second alert

Scenario: PR-15 cannot close unpaid
  Given an addition finished and unpaid
  When front office tries to close the visit
  Then closure is refused and the blocker is named

Scenario: PR-15 receivable
  Given an unpaid addition after the WhatsApp-bill fallback
  When FO converts it to a patient receivable
  Then the visit bill is settled, the visit can close, and the receivable shows at the next visit

Scenario: PR-16 no double deduction
  Given a pack of cotton issued to a room
  When a treatment using the standard per-treatment model completes
  Then stock is not deducted a second time

Scenario: PR-17 transfer
  Given 10 vials at branch A and 0 at branch B
  When 4 vials are transferred and received
  Then A shows 6 and B shows 4 with the same batch numbers

Scenario: PR-18 automatic list
  Given a patient selects two treatments and one product
  When the selection is confirmed
  Then the pharmacy list shows the materials from both treatment formulas and the product without manual entry

Scenario: PR-19 proportional allocation
  Given an invoice of Rp1,000,000 with two items of Rp600,000 and Rp400,000 after discount
  When Rp500,000 is paid
  Then Rp300,000 and Rp200,000 are allocated to the items

Scenario: PR-20 session unlock and expiry
  Given a package of Rp5,000,000 for 5 equal sessions with Rp3,000,000 paid and 2 sessions used
  When the package expires
  Then Rp1,000,000 moves to patient balance, Rp2,000,000 unpaid remainder is cancelled, and no receivable is created

Scenario: PR-21 balance never expires
  Given a patient balance of Rp400,000 last used two years ago
  When the patient buys a product
  Then the balance can be used in full

Scenario: PR-21 refund goes to balance by default
  Given a paid product line of Rp200,000 that was not handed over
  When the cashier refunds it without a cash-refund exception
  Then Rp200,000 is added to the patient balance and no cash leaves the drawer

Scenario: PR-22 booking DP under 24 hours
  Given a booking with DP Rp200,000
  When the patient reschedules 10 hours before the appointment
  Then the DP is forfeited and recorded as such

Scenario: PR-23 refund after payout
  Given a commission already paid for a sale
  When the sale is refunded
  Then a deduction is recorded against next month's commission and the paid record is unchanged

Scenario: PR-24 PKP switch
  Given a tenant that becomes PKP from a set date
  When an invoice is issued on that date for a taxable item
  Then VAT is computed and snapshotted; invoices before the date are unchanged

Scenario: PR-25 liability roll-forward
  Given package sales, redemptions, expiries and refunds in a month
  When finance opens the package liability report
  Then opening + paid allocations - counted sessions - moved to balance - refunded equals closing

Scenario: PR-26 period lock
  Given a closed and locked period
  When a correction for that period is posted
  Then it posts in the next open period with a reference to the original

Scenario: PR-27 number cap
  Given a tenant whose Meta business is unverified with two numbers
  When a third branch number is added
  Then onboarding asks the clinic to complete Meta business verification first

Scenario: PR-28 service window
  Given a conversation whose last patient message was 25 hours ago
  When staff try to send a free-form reply
  Then only approved templates can be sent

Scenario: PR-29 converted requires payment
  Given a booked lead that arrived but paid nothing
  When staff mark it converted
  Then the change is refused until a payment exists

Scenario: PR-30 control due
  Given a treatment with one free control scheduled for a date
  When the date is 2 days away
  Then a follow-up task appears for the guiding BC

Scenario: PR-31 budget
  Given a tenant whose daily outbound budget is reached
  When more reminders are due
  Then they are queued for the next window and the dashboard shows the backlog

Scenario: PR-32 private photo
  Given a clinical photo link older than its lifetime
  When it is opened
  Then access is refused

Scenario: PR-33 no clinical content
  Given an owner dashboard drill-down to visits
  When the owner opens a visit row
  Then money and identity are shown and diagnosis and photos are not

Scenario: PR-33a K2 at executing branch
  Given a package sold at branch A and a session counted at branch B
  When the owner views branch figures
  Then sales (K3) count at A and completed service value (K2) counts at B

Scenario: PR-33b stock risk
  Given an item below its minimum level at the manager's branch
  When the manager opens the dashboard
  Then the item appears under stock risk with a link to reorder

Scenario: PR-33c shift summary
  Given payments by cash and QRIS in a shift
  When the cashier opens the shift summary
  Then totals per tender are shown

Scenario: PR-33d own figures only
  Given two BCs with closings this month
  When one BC opens her dashboard
  Then only her own target and commission are shown

Scenario: PR-33e overdue leads
  Given a lead unanswered for 20 minutes during opening hours
  When CS opens the dashboard
  Then it is counted as overdue against the 15-minute target

Scenario: PR-33f roll-forward
  Given package and balance movements in a month
  When finance opens the roll-forwards
  Then each opening plus movements equals closing

Scenario: PR-34 reconciliation
  Given a payment recorded without its ledger posting
  When the reconciliation report runs
  Then the difference is listed with the payment reference

Scenario: PR-35 outage
  Given SATUSEHAT is unreachable
  When a doctor signs a record
  Then the record is saved, an outbox item retries, and the branch monitor shows it pending

Scenario: PR-36 residency
  Given the production configuration
  When the deployment check runs
  Then every database, file store and backup target is read from configuration
  And the storage locations shown in the vendor profile match the deployed locations
  And go-live with real patient data is blocked until the H-02d legal-opinion flag is set

Scenario: PR-36 activation refused without opinion
  Given the residency-opinion flag is unset
  And the backup target is outside Indonesia
  When the vendor operator activates a production tenant
  Then activation is refused with the reason shown

Scenario: PR-37 maker-checker
  Given a refund exception requested by a manager
  When the same manager tries to approve it
  Then approval is refused

Scenario: PR-37 owner write-off
  Given a receivable of Rp150,000 older than the collection policy
  When the owner writes it off alone with a reason
  Then the write-off is recorded with the owner as requester and approver, the reason is mandatory, and no commission is paid on it

Scenario: PR-38 bounded settings
  Given the settings screen
  When an owner looks for a setting outside the decided list
  Then it does not exist and fixed rules cannot be changed

Scenario: PR-41 clinical review before publish
  Given a manager edits a treatment's contraindications
  When the manager publishes
  Then the change waits for clinical-lead review and the previous version stays active

Scenario: PR-42 branch price
  Given a facial at Rp500,000 and an override of Rp450,000 at branch B
  When an invoice is issued at branch B
  Then the line shows Rp450,000 and keeps it after later price changes

Scenario: PR-43 complaint escalation
  Given a WhatsApp message "wajah bengkak setelah laser kemarin"
  When CS flags it as a clinical complaint
  Then a task appears for the doctor on duty and CS sees only its status

Scenario: PR-44 approvals inbox
  Given a stock adjustment requested by a pharmacist
  When the owner opens Persetujuan
  Then the request is listed with requester and reason and the pharmacist cannot approve it

Scenario: PR-45 clinician approves addition
  Given a nurse proposes an additional treatment in the room
  When the doctor approves on the iPad
  Then the patient agreement step opens and FO is alerted

Scenario: PR-46 moving average
  Given 10 units at Rp10,000 and 10 units received at Rp12,000
  When 5 units are consumed
  Then consumption is valued at Rp11,000 per unit

Scenario: PR-47 BC target
  Given a BC target of Rp50,000,000 closing value
  When the BC opens Target Saya
  Then attainment shows actual closing value this month against the target

Scenario: PR-48 roster
  Given a doctor on leave on a date
  When a slot with that doctor is requested on that date
  Then no slot is offered

Scenario: PR-49 record copy
  Given a patient with signed records
  When front office requests a copy for the patient
  Then a PDF of record content is produced and the request is logged

Scenario: PR-50 data request
  Given a correction request from a patient
  When it is logged
  Then it shows a due date and stays open until closed with an outcome

Scenario: PR-51 audit
  Given a doctor used break-glass access
  When the owner opens Log Audit
  Then the access appears with reason and time

Scenario: PR-52 export
  Given an owner requests a full export
  When the export finishes
  Then a manifest lists every file with checksums and the export expires after 24 hours

Scenario: PR-53 support session
  Given a vendor operator opens a support session for tenant A with a reason
  When the session ends after its time limit
  Then tenant A's owner sees the session in the audit log

Scenario: PR-54 notification
  Given an unpaid addition alert
  When FO acknowledges it
  Then the alert shows who acknowledged and when

Scenario: PR-3 acting role for multi-role staff
  Given an owner who also holds the Dokter role
  When she switches to Dokter in Saya › Ganti Peran and signs a record
  Then the tab bar shows the Dokter tabs
  And the signature and audit entry record acting role Dokter

Scenario: PR-24 VAT gated by tax advice
  Given a PKP tenant without recorded tax advice
  When finance enables VAT
  Then it is refused until the advice is recorded

Scenario: PR-55 placeholder vendor profile
  Given the vendor profile still holds "PT [Nama Badan Usaha]"
  When a receipt or privacy page is rendered
  Then the placeholder is shown marked as placeholder and production go-live is blocked until it is replaced

Scenario: PR-56 manual suspension keeps records
  Given a live tenant with an unpaid server fee
  When the platform owner suspends it with a reason
  Then new bookings are refused, the owner is notified, and staff can still read and export clinical records

Scenario: PR-57 maker-checker for vendor actions
  Given vendor finance proposes a new server fee for tenant A
  When the same person tries to approve it
  Then the approval is refused and audited

Scenario: PR-58 onboarding grant boundary
  Given an onboarding specialist with an active onboarding grant for tenant A
  When they open a patient's medical record
  Then access is denied and the attempt is audited

Scenario: PR-59 go-live gate
  Given tenant A with the processor agreement not yet signed
  When the platform owner confirms go-live
  Then go-live is refused naming the blocking checklist item and no server-fee invoice is created

Scenario: PR-60 owner sees vendor access
  Given a support session opened by the vendor for tenant A
  When the owner opens Saya › Akses Vendor
  Then the session shows operator, reason, scope and end time, and the owner can end it

Scenario: PR-61 prorated first month
  Given tenant A goes live on 21 November with a fee of Rp1,000,000 and November has 30 days
  When the first invoice is issued
  Then it is Rp333,333 and it becomes paid only after AutoLaris reports a verified settled status

Scenario: PR-61 expired attempt
  Given an invoice whose VA payment attempt expired according to AutoLaris Advice
  When the owner taps Bayar again
  Then a new attempt with a new reff_id is created and the expired attempt stays recorded

Scenario: PR-61 provider error
  Given an AutoLaris response with rc not equal to "00"
  When the attempt is created
  Then the attempt is failed, no transaction_id is stored, and the invoice stays issued

Scenario: PR-61 waiver needs two people
  Given vendor finance requests a waiver for a suspended month
  When the same person tries to approve it
  Then approval is refused; a different platform owner's approval creates a waiver document

Scenario: PR-56 suspended tenant keeps care messages
  Given a suspended tenant with a treatment finished yesterday
  When aftercare is due
  Then the aftercare message is still sent and no promotional message is sent

Scenario: PR-62 health without content
  Given an outbox backlog for tenant A
  When the vendor opens platform health
  Then counts and ages are shown and no patient name or message text appears

Scenario: PR-63 Admin Pusat boundary
  Given an Admin Pusat
  When they try to approve a cash refund
  Then the action is refused because it is owner-only

Scenario: PR-64 generated public site
  Given a published tenant with two branches and a published treatment
  When a visitor opens the tenant slug
  Then the home page lists both branches and the treatment from master data

Scenario: PR-65 unpublished price
  Given a treatment whose price is not published
  When its public page renders
  Then it shows "Harga dijelaskan saat konsultasi" and no amount

Scenario: PR-65 no advertised discount
  Given an active promo code for a treatment
  When the treatment's public page renders
  Then no discount, promo price or promo code is shown

Scenario: PR-66 doctor consent
  Given a doctor without listing consent
  When the public doctors page renders
  Then the doctor does not appear

Scenario: PR-67 booking with context
  Given a visitor on a treatment page for branch B1
  When they tap Buat Janji
  Then booking opens with that treatment and branch preselected

Scenario: PR-68 mock gateway duplicate webhook
  Given a QRIS charge created through the mock adapter in a demo tenant
  When the paid webhook arrives twice
  Then one simulated payment and one simulated allocation exist, the receipt is marked SIMULASI, and the line still counts as unpaid for treatment start and visit close

Scenario: PR-68 mock hidden in production
  Given a production tenant whose payment-port provider is still mock
  When the cashier opens the tender sheet
  Then QRIS, VA and payment link are not offered

Scenario: PR-69 reminder reply
  Given a booking tomorrow and a reminder sent
  When the patient replies Konfirmasi
  Then the appointment shows confirmed

Scenario: PR-70 aftercare
  Given a treatment with aftercare text
  When the visit closes
  Then a neutral care message with a protected aftercare link is sent even without marketing consent, and the WhatsApp text contains no treatment name

Scenario: PR-71 walk-in
  Given a patient without a booking
  When FO registers them from Hari Ini
  Then a visit opens with the next queue number of the day

Scenario: PR-72 discount above limit
  Given a cashier limit of 10%
  When the cashier enters a 15% manual discount
  Then the invoice waits for approval in Persetujuan

Scenario: PR-73 credential alert
  Given a doctor's SIP expiring in 30 days
  When the daily job runs
  Then the doctor and facility head receive an alert

Scenario: PR-74 signed letter
  Given a doctor creating a surat keterangan from a template
  When the doctor signs it
  Then it is stored as part of the medical record and cannot be edited, only corrected by a new version

Scenario: PR-75 supplier return
  Given a batch received from a supplier
  When purchasing records a return of 5 units with reason
  Then stock decreases by 5 at moving average cost and a credit note is expected

Scenario: PR-76 search projection
  Given a cashier searching by phone number
  When results appear
  Then they show name and visit status but no diagnosis

Scenario: PR-77 promo quota
  Given a promo code with quota 10 already used 10 times
  When the cashier applies it
  Then it is refused as exhausted

Scenario: PR-78 low score
  Given a patient scores 2 of 5
  When the survey is saved
  Then a manager task is created and no review request is sent

Scenario: PR-79 expense
  Given a petty-cash expense with a receipt photo
  When it is recorded for branch B1
  Then B1 margin includes it in that period

Scenario: PR-80 digest
  Given the owner opted in to the daily digest
  When the day closes
  Then the digest shows K1, K2 and exception counts without patient names

Scenario: PR-81 waitlist
  Given a patient on the waitlist for a service
  When a matching slot is cancelled
  Then staff are prompted to offer it

Scenario: PR-82 logbook
  Given a device due for calibration
  When the due date passes without an entry
  Then it appears in Perlu Ditangani for the branch manager

Scenario: PR-39 no pixel on treatment page
  Given a visitor who accepted marketing cookies
  When they open a treatment detail page
  Then no ad or analytics pixel host is contacted

Scenario: PR-33g Admin Pusat setup view
  Given a branch without opening hours
  When Admin Pusat opens Ringkasan
  Then the branch is listed as incomplete with "Jam buka belum diisi"

Scenario: PR-83 no-show
  Given a booking with DP and the patient does not arrive
  When FO marks Tidak Datang after the appointment time
  Then the DP is forfeited per PR-22 and a follow-up task is created for CS

Scenario: PR-83 no-show without DP
  Given a booking without DP and the patient does not arrive
  When FO marks Tidak Datang after the appointment time
  Then the appointment state is no-show, no money moves, and a follow-up task is created for CS

Scenario: PR-84 branch switch
  Given a doctor allowed at branches B1 and B2 with B1 active
  When the doctor switches to B2
  Then Antrean shows B2 patients and actions record branch B2

Scenario: PR-85 import dry-run
  Given a CSV of 500 patients with 3 invalid phone numbers
  When the dry-run runs
  Then the report lists the 3 rows and nothing is imported until confirmed

Scenario: PR-58 onboarding self-invite refused
  Given an onboarding specialist with an active onboarding grant for tenant A
  When they invite their own account as Owner
  Then the invitation is refused and audited

Scenario: PR-60 clinical scope without approval
  Given a support session request whose scope includes WhatsApp messages
  When the owner has not approved it
  Then the session does not activate and the request is audited

Scenario: PR-60 expired grant
  Given an onboarding grant created 31 days ago with the tenant not yet live
  When the onboarding specialist opens the catalog
  Then access is denied

Scenario: PR-63 Admin Pusat cannot grant Owner
  Given an Admin Pusat
  When they assign the Owner role to a staff member
  Then the change waits for the owner's approval and is not active

Scenario: PR-38 setting out of bounds
  Given the package validity setting with bounds 30–1095 days
  When the owner enters 1500 days
  Then the change is rejected naming the bound and the old value stays active

Scenario: PR-38 restore default
  Given the reminder time changed to 08:00
  When Admin Pusat taps Kembalikan ke default
  Then the reminder time returns to H-1 10:00 with a new audited version

Scenario: PR-86 role-filtered menu
  Given a pharmacist
  When the sidebar renders
  Then Apotek & Inventaris pages appear and Keuangan and Komisi rules do not

Scenario: PR-87 vendor console tree
  Given a platform owner
  When the vendor console opens
  Then Tenant, Onboarding, Integrasi, Tagihan Server, Sesi Dukungan, Kesehatan Platform, Tim Vendor, Audit Vendor, Profil Vendor, Feature Flag and Templat Global are listed

Scenario: PR-88 service needs a room
  Given a service whose master requires a laser device
  When FO books it at a branch without that device
  Then no slot is offered

Scenario: PR-89 depot transfer
  Given 10 vials in the branch gudang
  When 4 are transferred to Ruang Tindakan 1
  Then gudang shows 6 and the room depot shows 4 with one transfer record and two linked movements

Scenario: PR-89 concurrent depot transfers
  Given 5 vials in the gudang
  When two transfers of 4 vials are submitted at the same time
  Then one succeeds, the other is refused for insufficient stock, and replaying the successful key changes nothing

Scenario: PR-90 supplier payable
  Given a goods receipt of Rp5,000,000 with a supplier invoice due in 30 days
  When finance records a payment of Rp2,000,000
  Then the payable shows Rp3,000,000 outstanding

Scenario: PR-91 revoke session
  Given a staff member's active session on a lost tablet
  When the owner revokes it in Pengguna & Akses
  Then the tablet is signed out within 60 seconds

Scenario: PR-92 breach record
  Given a suspected breach recorded
  When the owner opens the breach register
  Then it shows awareness time, the 3×24 h deadline and notice evidence fields

Scenario: PR-93 beneficiaries cannot exceed paid value
  Given a shared package with one paid session left and two beneficiaries
  When both try to reserve that session at the same time
  Then exactly one reservation succeeds

Scenario: PR-90 no double allocation
  Given a supplier invoice of Rp3,000,000 outstanding
  When two payments of Rp2,000,000 are allocated concurrently
  Then one allocation succeeds in full and the other allocates only Rp1,000,000 or is refused, and the invoice is never over-paid

Scenario: PR-93 sharing disabled by default
  Given a package template without sharing enabled
  When the cashier tries to add a beneficiary
  Then the action is not offered

Scenario: PR-94 frequency cap
  Given a patient already received two automated messages today
  When a third scenario triggers
  Then it is queued for the next day

Scenario: PR-94 campaign sending gated
  Given a scheduled campaign to a segment of patients with marketing consent
  When the Q-15 counsel evidence in the compliance register is not approved
  Then sending is refused with "Pengiriman kampanye terkunci sampai bukti hukum disetujui" and the segment remains editable

Scenario: PR-95 report definition
  Given the owner opens Laporan Pasien
  When they open the definition of churn
  Then the KPI dictionary entry is shown

Scenario: PR-96 schedule does not unlock
  Given a package with an agreed instalment schedule
  When a scheduled date passes unpaid
  Then a reminder task is created and no session unlocks

Scenario: PR-97 gated feature
  Given the tax-advice item for the tenant is not approved
  When the owner tries to switch on VAT on invoices
  Then the switch is refused naming the missing evidence

Scenario: PR-97 evidence unlocks
  Given the accountant's posting-map sign-off is uploaded and marked approved by finance
  When finance opens journal export
  Then the export is available and the approval is audited

Scenario: PR-98 Coretax export gated
  Given a PKP tenant without approved tax-advice evidence
  When finance opens Coretax export
  Then the export is unavailable and names the missing evidence

Scenario: PR-39 no replay on booking
  Given the public booking page in a browser
  When the network requests are listed before consent
  Then no session-replay or ad-pixel host is contacted
```

### 8.1 Carried Kliniknuma clinical scenarios (CLIN-001–CLIN-028)

Kliniknuma's 28 clinical acceptance scenarios are kept as acceptance tests where the behavior is in scope, reworded where decided rules differ, and deferred where the feature is LATER.

| CLIN | Kliniknuma meaning (short) | Handling | Owning PR |
|---|---|---|---|
| CLIN-001 | Repeat visit: prior intake as history, only changes are new facts | Keep | PR-9 |
| CLIN-002 | Unverified allergy flag reaches doctor, nurse, pharmacist as caution | Keep | PR-9 |
| CLIN-003 | BC cannot diagnose or sign | Keep | PR-9 |
| CLIN-004 | Doctor confirms BC facts; BC authorship kept | Keep | PR-10 |
| CLIN-005 | Missing credential blocks start | Keep | PR-11 |
| CLIN-006 | Package purchase credits sessions, consumes none | Reword: sessions unlock by paid value | PR-20 |
| CLIN-007 | Reservation moves available → reserved | Keep (B-15) | PR-20 |
| CLIN-008 | Retried completion: one transition, one deduction | Keep | PR-16 |
| CLIN-009 | Allowed cancellation returns the session | Keep | PR-20 |
| CLIN-010 | Mixed package: only the matching treatment decreases | Reword: mixed package by allocated value within paid value | PR-20 |
| CLIN-011 | Catalog change keeps old receipts and entitlements | Keep | PR-41 |
| CLIN-012 | Two parallel care plans stay separate | Keep | PR-10 |
| CLIN-013 | No baseline → no improvement percentage | Defer (patient app LATER); keep rule for staff views | PR-10 |
| CLIN-014 | New assessment adds a timepoint; old record unchanged | Keep | PR-13 |
| CLIN-015 | Non-comparable photos warn, no score | Keep | PR-32 |
| CLIN-016 | Worse symptoms create a clinical task | Keep | PR-43 |
| CLIN-017 | Signed Rx not handed over: no stock or quota change | Keep | PR-18 |
| CLIN-018 | Handover retry: single dispensing | Keep | PR-18 |
| CLIN-019 | Expired/recalled/BUD-lapsed stock blocked | Keep | PR-17 |
| CLIN-020 | Planned 25, paid 20, executed 25 → +5 add-on, closure blocked | Keep (negative delta becomes balance per B-11) | PR-15 |
| CLIN-021 | Non-clinical roles cannot read diagnosis or photos | Keep | PR-32 |
| CLIN-022 | Added item or higher dose needs re-consent | Keep | PR-11 |
| CLIN-023 | Amendment: new version and net delta only | Keep | PR-13 |
| CLIN-024 | Pharmacist adverse-effect flag escalates clinically | Keep | PR-43 |
| CLIN-025 | Pending pharmacy blocks closure | Keep | PR-15 |
| CLIN-026 | Lost assignment removes access | Keep | PR-32 |
| CLIN-027 | Testimonial consent withdrawal hides public copies | Defer (public pages LATER) | PR-40 |
| CLIN-028 | No eligible session → booking refused without touching others | Keep | PR-20 |

## 9. Non-Functional Requirements

| ID | Quality attribute | Measurable requirement | Conditions/load | Evidence method | Owner | Constraint refs |
|---|---|---|---|---|---|---|
| NFR-1 | Availability | ≥ 99.5% during clinic hours 08:00–21:00 local | Pilot scale | Health probe + incident log | Engineering owner | SLO-1 |
| NFR-2 | Performance | Booking reservation p95 < 500 ms; treatment completion transaction p95 < 2 s; dashboard p95 < 2 s | 5 branches, 300 visits/day | Load probe | Engineering owner | OBS-1 |
| NFR-3 | Recovery | RPO ≤ 15 min; RTO ≤ 2 h; quarterly restore drill | Production | Restore drill report | Engineering owner | DR-1 |
| NFR-4 | Accessibility | WCAG 2.2 AA; 44 px targets; text to 200% | Staff and public UI | Browser checks at 390/820/1180/1440 | Design owner | UI-1, LOC-1 |
| NFR-5 | Integrity | Zero unexplained ledger, stock or commission drift; replayed commands produce no duplicates | All money/stock commands | Replay and concurrency tests | Engineering owner | DATA-3 |
| NFR-6 | Isolation | No cross-tenant read or write in any API, job, export or cache | All | Negative tests per endpoint | Security owner | TEN-1, SEC-1 |
| NFR-7 | Residency portability | All storage, backup and host locations are configuration; documented migration to an Indonesian provider completes in ≤ 1 day with a rehearsal | Production | Migration rehearsal | Engineering owner | PR-36, XFER-1 |
| NFR-8 | Localization | Indonesian UI, IDR integer rupiah, branch timezone labels | All UI | TEST-LOC-1 | Design owner | LOC-1 |

## 10. UX and Content Contract

- Navigation tree, page inventory and settings registry: `19-NAVIGATION-PAGE-CATALOGUE.md`.
- Surfaces and screens: `17-UX-FLOWS-SCREEN-CONTRACTS.md` (UX-1–UX-60), including the role hand-off map and the public sitemap.
- Visual system and tokens: `10-DESIGN-SYSTEM-WHITELABEL.md` (UI-1–UI-18), `DESIGN.md` (full Apple style, light only, D-14–D-16), rationale in `UX-CONCEPT-APPLE-STYLE.md`.
- Accessibility: NFR-4. Language: Bahasa Indonesia UI; clinical terms per `10` glossary.
- Destructive actions: corrections create versions; money reversals create adjustments; deletes of clinical, money and commission records do not exist.

## 11. Data, Analytics, and Privacy Needs

| Need | Purpose | Data class | Retention expectation | Event/report owner | Contract refs |
|---|---|---|---|---|---|
| Visit and clinical record | Care, legal record | Health data (specific) | ≥ 25 years from last visit | Clinical lead | DATA-2, PRIV-3 |
| Payments, invoices, journals | Books, tax | Financial | ≥ 10 years (Kliniknuma RG-32; verify) | Finance owner | DATA-3 |
| Lead and message metadata | CRM, attribution | Contact data | Tenant policy; delete on request for leads never treated | CRM owner | PRIV-4 |
| Product analytics | Usage of screens | Pseudonymous | 13 months | Product owner | OBS-2 |
| Audit log | Accountability | Operational | ≥ 25 years for clinical access events | Security owner | SEC-5 |

## 12. Rollout and Release Acceptance

| Phase | Population | Entry criteria | Success gate | Stop/rollback trigger | Owner |
|---|---|---|---|---|---|
| Phase 0 — Prerequisites | Vendor | Started at G0 (entity chosen, registrations filed); **completed** before G2: vendor profile filled (S-04 placeholder replaced), NIB, PSE, SNOMED CT, Meta Tech Provider or BSP (W-09), H-02d opinion or residency migration, each as approved evidence (PR-97); tax adviser (Q-05) and clinical lead (Q-07) evidence before G2; accountant (Q-06) before journal export (G3) | All registrations and reviews recorded | Any registration refused | Product owner (Paduka Ongki) |
| Phase 1 — Demo | Internal, synthetic data | Milestones M0–M8 built with fixtures | Owner walkthrough on synthetic data of J1–J8 and J10 passes (messaging and SATUSEHAT with recorded fixtures, journal export simulated); J9 and J11 are walked through in M9 | Any money/stock invariant fails | Product owner (Paduka Ongki) |
| Phase 2 — Pilot (Release 1) | Numa Klinik, its branches | Gate G2: every M0–M9 exit passed (M9 exit = its own checklist in PLAN); Phase 0 completed; G2 evidence approved in the compliance register; features stay switched off where their evidence is missing | 30 days, §4 targets | Unexplained money difference > Rp0 for 2 days | Product owner (Paduka Ongki) |
| Phase 3 — More clinics | Numa + 2–5 clinics | Pilot gate | Each new clinic passes the onboarding checklist | Ledger drift | Product owner (Paduka Ongki) |
| Phase 4 — Growth | More tenants | Phase 3 | Rich public content (PR-40), patient portal options | — | Product owner (Paduka Ongki) |

## 13. Risks and Open Questions

| ID | Question/risk | Impact | Owner | Resolution evidence | Due | Blocks gate |
|---|---|---|---|---|---|---|
| Q-01 | ~~Codebase from Kliniknuma or new?~~ **Closed: from zero (P-09).** | — | Product owner (Paduka Ongki) | DECISION-REGISTER P-09 | 2026-11-02 | — |
| Q-02 | ~~Does Numa Klinik become a tenant?~~ **Closed: Numa Klinik is the first client and first tenant (pilot, Phase 2), onboarded on the platform like any later client; Kliniknuma code is not reused (P-09, P-20).** | Pilot choice | Product owner (Paduka Ongki) | DECISION-REGISTER P-20 | 2026-11-02 | — |
| Q-03 | Vendor legal entity for NIB/PSE/Meta (S-04) | All registrations | Product owner (Paduka Ongki) | Entity named | before Phase 0 | G0 |
| Q-04 | Legal opinion on Singapore storage of RME (H-02d); if negative, run residency migration before go-live | PR-36 | Product owner (Paduka Ongki) with health-law counsel | Written opinion | before first real patient record | G2 |
| Q-05 | VAT classification per treatment family; confirm A-12 prepaid VAT timing | PR-24 | Finance owner with tax adviser | Written advice | before Phase 2 | G2 |
| Q-06 | SAK EMKM or EP for pilot; posting map approval incl. A-10 (other income), A-11 (revenue on performance), A-13 (moving average) | PR-26 | Finance owner with accountant | Signed posting map | before journal export (G3) | G3 |
| Q-07 | Clinical authority matrix (BC limits, delegation, who authorizes additions) | PR-11, PR-15 | Clinical lead | Signed matrix | before Phase 2 | G2 |
| Q-08 | PP 33/2026 (PDP implementing regulation) text | PRIV-* | Privacy counsel | Verified text | before Phase 2 | G2 |
| Q-09 | ~~SaaS commercial model?~~ **Closed: tenders + monthly server fee from Rp1,000,000 per tenant, billed from go-live via the vendor's AutoLaris (P-14, PR-61).** | — | Product owner (Paduka Ongki) | DECISION-REGISTER P-14 | 2026-11-02 | — |
| Q-10 | Pilot clinic: **Numa Klinik (P-20)**; its branch count at pilot start | Phase 2 | Product owner (Paduka Ongki) | Branch list in onboarding checklist | before Phase 2 | G2 |
| Q-11 | Verify regulatory claims listed in `reviews/review-2-architecture-security.md` (20 items) | Compliance | Privacy/health-law counsel | Verified list | before Phase 2 | G2 |
| Q-12 | Clinic job validation at Numa Klinik (first client) (shadowing and role interviews per `VALIDATION-GUIDE-CLINIC-JOBS.md`); role jobs in §3 are assumptions until done. Validation can change PR-7, PR-9, PR-14, PR-15, PR-18, PR-71 and PR-83; all other requirements (platform, money rules, RME law, security) are approvable without it so M0–M1 tasks can start | All workflow PRs | Product owner (Paduka Ongki) | Validation results file | before PRD approval | G1 |
| Q-13 | Has AutoLaris approved the non-physical profile (`courir_id: 1`) for the vendor account? Which AutoLaris Advice status and fields mean settled for the vendor account (sanitized Advice response as evidence)? Until then server-fee payments use `create_payment` and no invoice is marked paid automatically | PR-61 | Product owner (Paduka Ongki) | AutoLaris confirmation | before first invoice | — |
| Q-14 | Patient payment gateway partner (open; mock adapter until decided) | PR-68 | Product owner (Paduka Ongki) | Partnership decision | before online payments in a live tenant | — |
| Q-15 | Counsel reading of Permenkes 1787/2010 for tenant public sites: is a factual tariff list allowed; may doctor names show academic titles; are consented before/after photos or a promos page "publikasi" that Pasal 5 forbids (testimoni, diskon) | PR-40, PR-64–PR-67, PR-77 | Health-law counsel | Opinion | before first public site publish | G2 |
| Q-16 | Server-fee money details: does a PT tenant withhold PPh 23 on the server fee; who bears the AutoLaris channel fee; is Numa Klinik billed from go-live or given a pilot waiver | BILL-31–BILL-33 | Product owner (Paduka Ongki) with tax adviser | Decision + written advice | before first invoice | — |
| Q-17 | Regulatory verification pack: Permenkes 24/2022 RME duties (content, correction, access, retention, location); SATUSEHAT onboarding per facility (Organization, Location, Practitioner, Patient/IHS, terminology licences); PSE (PP 71/2019 and private-PSE rules); clinic licensing and accreditation (Permenkes 34/2022 and successors, STR/SIP regimes); patient safety (Permenkes 11/2017); clinic pharmacy (Permenkes 34/2021); medical waste B3 (PP 22/2021, record or link only); PPN per service family (PP 49/2022); breach and DPO (UU 27/2022); PP 33/2026 existence | Compliance | Health-law counsel, tax adviser, clinical lead | Source per item with article and date checked | research-based defaults are used now (P-22); verification runs in parallel and adjusts settings or rules before G2 | G2 |
| Q-18 | ~~Narrow Release 1 for one pilot clinic?~~ **Closed: no — Release 1 is the complete research-based product with full navigation and pages (P-21); Numa Klinik first (P-23).** | — | Product owner (Paduka Ongki) | DECISION-REGISTER P-21 | 2026-11-02 | — |
| Q-19 | SATUSEHAT details to confirm with the official guide: facility Organization/Location rules, practitioner participation, identity pathways (no NIK, newborns, foreigners, duplicates, corrections), conditional create or search by identifier, correction/withdrawal semantics, accepted terminology releases | PR-35 | Engineering owner with SATUSEHAT guide | Guide references per item | before M7 | — |
| R-01 | Proxied public booking host processes request content at Cloudflare edge (XFER-2); staff host DNS-only (H-02c) | Compliance | Privacy counsel | Opinion | before Phase 2 | G2 |
| R-02 | WABA policy forbids sensitive health content; template rejection | CRM | CRM owner | Template approvals | Phase 2 | — |

## 14. Cross-Document Contract

- Business: `01-BRD.md`. Design and flows: `03`, `04`. Data: `05`. Tenancy: `06`. Identity: `07`. API: `09`. UI: `10` + `DESIGN.md`. Money: `11`. Security: `12`. Privacy: `13`. Recovery: `14`. Delivery and stack: `15`. Observability: `16`. Screens: `17`. Integrations, events, errors: `18`. Navigation, pages, settings: `19`. Context and law: `CONTEXT-RECORD.md`. Decisions: `DECISION-REGISTER.md`. Build order and gates: `PLAN.md`. Execution queue: `TASKS.md`.
- Each implementation task (root `TASKS.md`) has exactly one primary `PR-*`; TD-*, DEL-*, MIG-*, TEN-*, SEC-* and other contract IDs appear as constraints. Foundation and DevOps work maps to the PR it enables (e.g. CI and RLS harness → PR-1).

## Appendix A — KPI Dictionary (K1–K27)

Source: `BIG-BRAND-DASHBOARD-CRM-REQUIREMENTS.md` §4, with decided values (D-06, D-07, D-08, B-17, A-11, A-13). Money in integer rupiah; periods in each branch's local day; consolidated = sum of branch days. Every KPI drills down to its records and never shows clinical content.

| ID | KPI | Definition | Branch attribution | Source records |
|---|---|---|---|---|
| K1 | Uang masuk | Payments received − cash refunds, by payment date; balance usage is not new cash | Branch where paid | Payments, refunds |
| K2 | Layanan selesai | Value of treatments counted + products handed over + consultation fees charged, by performance date, excl. VAT | Executing branch | Executions, handovers |
| K3 | Penjualan | Invoice lines and package contract value after discount, excl. VAT, by sale date; reduced by cancelled unpaid package remainders in the month of cancellation and by refunded sale value (cash or balance) in the month of the refund; voided invoices excluded | Selling branch | Invoice lines, packages |
| K4 | Piutang | Patient receivables + unpaid lines of closed visits, aged 0–30/31–60/61–90/>90; excludes unpaid package remainders and open bills of in-progress visits | Branch of invoice | Invoices, receivables |
| K5 | Kewajiban prabayar | Paid-not-delivered + package liability + patient balance + booking DP; expiry slice for packages only | Tenant (branch view = where liability arose) | Liability sub-ledgers |
| K6 | Paket kedaluwarsa ke saldo | Paid-unused value moved to balance at expiry | Selling branch | Package close events |
| K7 | Kontribusi | K2 − material cost − product cost (moving average) − performer commission (executing branch; selling/guiding BC commission stays at selling branch, B-17); marked "estimasi" where consumption is standard | Executing branch | K2, consumption, commission |
| K8 | Konsultasi jadi pembelian | Consultation visits with a qualifying purchase on that visit ÷ consultation visits | Visit branch | Visits, invoices |
| K9 | Rencana dipilih | Plan items selected ÷ recommended (count and value) within 30/60/90 days | Visit branch | Plans, selections |
| K10 | Pasien baru vs kembali | First visit in tenant vs repeat | Visit branch | Visits |
| K11 | Kunjungan kedua | New patients with a completed second visit within 60 days ÷ new patients | First-visit branch | Visits |
| K12 | Tidak datang / batal < 24 jam | No-shows + late cancels ÷ booked | Booking branch | Appointments |
| K13 | Konversi lead | Lead → booked → arrived → paid, by source, branch, assignee | Lead branch | Leads, appointments, payments |
| K14 | Respons lead | Median first response; % within 15 min in opening hours | Lead branch | Message timestamps |
| K15 | Utilisasi performer | Booked or executed minutes ÷ rostered minutes | Branch | Schedules, appointments |
| K16 | Lampiran produk | Treatment visits with a product sale ÷ treatment visits | Visit branch | Invoice lines |
| K17 | Komisi terutang | Entitlements − adjustments by staff, role, contribution, with approval state | Branch of contribution | Commission ledger |
| K18 | Risiko stok | Items below minimum; batches expiring within 30 days; count variance | Branch | Stock ledger |
| K19 | Target BC | Closing value per month vs target; plans fully selected | BC's branch | Targets, attribution |
| K20 | Rata-rata transaksi | K3 ÷ number of issued invoices with K3 > 0 in the period (a package sale counts once at sale; redemptions, top-ups and voided invoices excluded; refunds reduce K3 in the refund period) | Selling branch | Invoices |
| K21 | Churn | Patients with a visit in the previous 12 months and none in the last SET-22 dormant days ÷ patients active in the previous 12 months | Last-visit branch | Visits |
| K22 | Pasien teratas / LTV | Cumulative K3 per patient since first visit (net of refunds and cancelled unpaid package remainders as in K3; top-ups and redemptions excluded; family redemptions attributed to the package owner) | Selling branch | Invoices, refunds |
| K23 | Penjualan dan uang masuk per shift | K3 of invoices issued in the shift and K1 received in the shift, shown side by side | Shift branch | Invoices and payments with shift link |
| K24 | Waktu tunggu apotek | Median handed_at − queued_at per dispensing | Branch | Dispensings |
| K25 | Performa kode promo | Uses, discount value, K3 of lines with the code, per code version | Selling branch | Promo usages |
| K26 | Kepuasan | Average survey score and % ≤ 2 | Visit branch | Surveys |
| K27 | Aktivitas dokter | Per doctor and period: signed examinations, unsigned records older than 24 h, clinical requests decided, median minutes check-in → signature | Visit branch | Medical records, clinical requests, visits |

## 15. Validation and Approval Checklist

- [x] Problem, users, evidence, outcomes, scope and non-goals explicit.
- [ ] Every PR-* is unique and testable; Must items have scenarios (scenarios exist; compound requirements still to split at task level).
- [ ] Clinical, accounting, tax and legal reviews recorded (Q-05–Q-08).
- [x] Owner approval — P-27, 2026-11-02 (Q-12 may still change PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83).
