# Technical Design — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Engineering owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Upstream | 02-PRD.md |

## 1. Design Summary

A single transactional application (modular monolith) with background workers, one PostgreSQL database per environment with row-level tenant isolation, an event outbox for external effects (WhatsApp, SATUSEHAT, payment links, exports), and a posting layer that derives ledger entries from operational events. The design keeps Kliniknuma's proven contracts (versioned catalog, provenance states, separate package/treatment/care-plan/condition records, outbox, idempotent commands) and replaces its money rules with the decided ones.

## 2. Goals, Non-Goals, and Constraints

- Goals: correctness of money/stock/commission; clinical record integrity; tenant isolation; residency-portable storage (H-02b); AI-agent-friendly codebase (one language, typed, testable).
- Non-goals: microservices; event sourcing of everything; offline-first app.
- Constraints: PR-36, NFR-1–NFR-8; Vultr Singapore + Coolify + Cloudflare for all environments including clinical data (H-02b), residency-portable (ARCH-9).

## 3. Current State

- Clinic Dashboard has no code; it is built from zero in a new repository (P-09).
- Kliniknuma (separate project) is a read-only reference for lessons (PLAN §2); its code, schema and tests are not reused.

## 4. Proposed Design and Responsibility Map

| ID | Component | Responsibility | Owns data | Owner |
|---|---|---|---|---|
| TD-1 | Org, access & catalog module | Tenant profile, branches, rooms, staff, roles, scopes, context switching, access administration, settings registry, approvals, catalog and Master Layanan, branch prices | tenants, branches, rooms, staff, staff_roles, duty_assignments, settings_*, approvals, catalog_*, branch_prices | Engineering owner |
| TD-2 | Patient & consent module | Patients, contact points, guardians, consents, merges | patients, contact_points, consents | Engineering owner |
| TD-3 | Scheduling & front office module | Schedules, resources, appointments, visits, queue | appointments, resource_reservations, visits | Engineering owner |
| TD-4 | Clinical module | Intake, examination, face map, care plans, conditions, consent records, photos, amendments, letters | medical_records + versions, care_plans, condition_assessments, procedure_consents, clinical_media | Engineering owner |
| TD-5 | Treatment execution module | Checklist, start/finish/interrupt, performer, materials actuals | treatment_executions | Engineering owner |
| TD-6 | Inventory & pharmacy module | Items, batches, vials, requests, issues, consumption, returns, waste, counts, transfers, POs, prescriptions, dispensing | stock_* tables, prescriptions | Engineering owner |
| TD-7 | Cashier & entitlement module | Invoices, payments, allocations, packages, balance, DP, receivables, refunds, shift close, promo codes, tax profile and VAT computation, expenses and petty cash | invoices, payments, package_*, balance_accounts, balance_entries, booking_deposits, receivables, cash_shifts, promo_*, tax_profiles, expenses | Engineering owner |
| TD-8 | Commission module | Rules, snapshots, contributions, entitlements, adjustments, payout batches, targets | commission_* | Engineering owner |
| TD-9 | Messaging & CRM module | WABA accounts, numbers, templates, conversations, messages, leads, follow-ups, campaigns | waba_*, conversations, leads, followups | Engineering owner |
| TD-10 | Accounting module | Chart of accounts, posting rules, journals, periods, statements, exports incl. Coretax XML | accounts, journal_entries, journal_lines, periods | Engineering owner |
| TD-11 | Integration module | SATUSEHAT mapping and outbox, payment gateway adapters (behind the TD-13 payment port) | integration_outbox, resource_links | Engineering owner |
| TD-12 | Reporting module | Read models for dashboards and KPI dictionary | read models only | Engineering owner |
| TD-13 | Platform core module group | Tenants and lifecycle, memberships and IAM, vendor console, server-fee billing (vendor AutoLaris adapter), audit, notifications, outbox, files, public-site engine, payment port | tenants_registry, vendor_*, onboarding_*, support_sessions, payment_port_configs | Engineering owner |
| TD-14 | Public site module | Generates tenant pages from branch master, catalog web fields, consenting doctor profiles and promos; publish versions; edge purge | public_site_settings, public_profiles, promos | Engineering owner |

Rule: each record has one owning module; other modules read through module interfaces or events. TD-1–TD-12 are the **clinic domain**; TD-13–TD-14 are the **platform core** and never import clinic-domain modules except through their published interfaces (exported queries) or events; this is the single dependency rule, repeated in `15` §3.

## 5. Key Flows

### Flow: visit from arrival to closure (PR-7, PR-9–PR-19)

1. Check-in opens a visit (TD-3) and links appointment and patient.
2. BC intake saved as unverified (TD-4); doctor verifies and signs plan version.
3. Selection recorded (TD-4 commercial selection) → invoice draft (TD-7) and preparation request (TD-6).
4. Payment (TD-7) emits `PaymentReceived`; consent validated (TD-4).
5. Issue materials (TD-6); start treatment (TD-5) requires paid + consent + credentials.
6. Finish with outcome; consumption/return recorded at moving average cost (TD-6); reserved session redeemed only if counted (TD-7); performance event moves contract liability to revenue (TD-10); commission contributions recorded (TD-8).
7. Dispensing (TD-6); closure guard checks unpaid bills and open executions (TD-3).
8. Follow-up tasks generated (TD-9). Ledger postings by TD-10 from events.

### Flow: additional treatment (PR-15)

Proposal by BC → clinician authorization → patient agreement → FO alert → optional start-before-payment confirmed by FO (recorded) → finish → second alert if unpaid → settlement or receivable fallback.

### Flow: package payment and unlock (PR-20)

Each payment allocation (including balance used) raises `paid_value`. A selected session is redeemable when `redeemed_value + reserved_value + selected_session_value ≤ paid_value` and it is within the doctor's current stage. It is reserved at booking/check-in and redeemed only on a counted outcome (B-15).

### Flow: WhatsApp inbound (PR-28, PR-29)

Webhook → idempotent message store → conversation (by tenant number + patient phone) → routing (number's branch or asked branch) → lead upsert with source parsed from prefill/referral → assignment and SLA timer.

### Flow: SATUSEHAT (PR-35)

Signed record version → mapping to FHIR resources (Encounter, Condition, Observation, Procedure, Medication*) → outbox per branch credentials → retry with backoff → resource link stored → amendments update same resource.

## 6. Interface and Contract Changes

Internal HTTP API per `09-API-SPECIFICATION.md`; integration contracts, event catalog and error catalog in `18-INTEGRATION-CONTRACTS.md`.

## 7. Data, Consistency, and Transactions

- One database transaction per command writes domain rows, audit row and outbox row (Kliniknuma DEC-011 pattern).
- Idempotency keys on every command that moves money, stock, sessions or commission.
- Money in integer rupiah; quantities as exact decimals with explicit unit; no cross-unit sums.
- Snapshots: price, tax category, commission rule version, session value at sale time.

## 8. Security and Privacy

See `12` and `13`. Tenant context set per transaction; RLS as second layer; clinical fields projected by role and assignment; no clinical data in logs, events or WhatsApp payloads.

## 9. Reliability, Performance, and Capacity

Pilot capacity: 5 branches × 60 visits/day; one app + one worker container; PostgreSQL 16 with WAL archiving. Scale path: more app containers behind the proxy, then read replica for reporting.

## 10. Alternatives and ADRs

| ID | Decision | Status | Owner | Note |
|---|---|---|---|---|
| ADR-1 | Modular monolith over microservices | Proposal | Engineering owner | Fewer moving parts for AI-agent development and a small team |
| ADR-2 | Shared database with tenant_id + RLS over database-per-tenant | Proposal | Engineering owner | 1–5 branch tenants; simpler ops; RLS as backstop |
| ADR-3 | Ledger derived from events (posting layer) over manual bookkeeping | Proposal | Engineering owner | Required by A-01 |
| ADR-4 | Next.js + TypeScript + PostgreSQL + Drizzle + Better Auth as stack, built from zero | Proposal | Engineering owner | See `15` §2; versions verified in M0 |
| ADR-5 | Revenue on performance with contract-liability settlement (A-11) | Proposal | Engineering owner | `11` posting map; accountant sign-off before journals |
| ADR-6 | Platform routing tables with security-definer lookups for pre-tenant requests | Proposal | Engineering owner | `06` TEN-9 |
| ADR-7 | One codebase, tenants by data: no per-client branches or code paths; tender-specific needs become general features behind **platform feature flags** in the tenants registry (set only by the platform owner with a product-owner decision; distinct from the closed B-09 clinic settings list) or are refused; dedicated instances run the same image (P-11) | Proposal | Engineering owner | Platform core (TD-13) can serve another vertical later; only the clinic domain is built now |

## 11. Delivery, Migration, and Rollback

See `15`. Expand-contract migrations; never rewrite signed clinical rows or posted journals.

## 12. Test and Evidence Plan

Unit tests per module rule; contract tests per adapter; integration tests against real PostgreSQL; replay/concurrency tests for money/stock; browser checks per screen; restore drill.

## 13. Risks and Open Decisions

PRD Q-04 (legal opinion on Singapore storage), Q-06 (posting map), Q-11 (regulatory claims).

## 14. Cross-Document Contract

Data `05`, tenancy `06`, IAM `07`, API `09`, money `11`, delivery `15`.
