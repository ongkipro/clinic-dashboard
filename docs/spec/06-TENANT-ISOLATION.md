# Tenant Isolation — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Security owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Reference | Kliniknuma DEC-013/DEC-015 and its facility-strict RLS (reference only; not reused — its model is single-tenant facility-strict with global unique keys) |

## Requirements

| ID | Requirement | Owner | Verification | Status |
|---|---|---|---|---|
| TEN-1 | The server resolves `tenant_id` from the authenticated membership; client tenant or branch IDs are selectors validated against membership | Security owner | Negative test per endpoint: tenant A gets not-found for tenant B | Proposal |
| TEN-2 | Every transaction sets `app.tenant_id`, `app.allowed_branch_ids`, `app.active_branch_id`, `app.staff_id`, `app.roles`; PostgreSQL RLS enforces them under a non-owner role without BYPASSRLS | Security owner | Raw-SQL RLS tests per policy kind | Proposal |
| TEN-3 | A scope map classifies every table into one policy kind (below); a test fails on any unclassified table | Engineering owner | Scope-map test | Proposal |
| TEN-4 | Tenant ID is part of every cache key, queue message, object path (`tenants/{tenant}/…`), rate-limit key, search index and export name; every authenticated clinic page (route group `(app)`, independent of URL prefix), every vendor page, `/api/v1/**` and every booking route are dynamic with no shared Next.js data or route cache; cache and host negative tests cover real routes such as `/saya` and `/persetujuan`; any shared cache key includes `tenant_id`; a lint check fails on `unstable_cache`/`fetch` caching without a tenant key | Engineering owner | Lint + tests | Proposal |
| TEN-5 | Workers claim across tenants with a claim function returning `(event_id, tenant_id, branch_id)`, then bind context per row before any read or write | Engineering owner | Worker test | Proposal |
| TEN-6 | Vendor operators use a `platform_operator` role and a break-glass grant (reason, TTL ≤ 2 h, tenant-visible audit); no BYPASSRLS | Security owner | Audit test | Proposal |
| TEN-7 | Per-tenant secrets (WABA tokens, SATUSEHAT secrets, gateway keys) are encrypted with tenant data keys wrapped by the KEK (ARCH-7); never returned to browsers | Security owner | Secret-handling test | Proposal |
| TEN-8 | Tenant exit: export per PR-52, then deletion except records the clinic must retain, which are handed over | Product owner (Paduka Ongki) | Exit drill | Proposal |
| TEN-9 | Platform routing tables, unique across tenants: `waba_routes(phone_number_id, waba_id → tenant_id, branch_id)`, `payment_routes(merchant_ref → tenant_id)`, `public_hosts(slug/host → tenant_id)`, `tenants_registry` | Engineering owner | Routing tests: unknown id dropped and audited; spoofed slug 404 | Proposal |
| TEN-10 | All business unique keys are composite with `tenant_id` (medical record number, NIK blind index, staff licence number per tenant, employee code, room and device codes, branch code) | Engineering owner | Constraint test | Proposal |
| TEN-11 | Identity: one login account may hold memberships in several tenants (`memberships`: account, tenant, staff_id, role set, allowed branches, effective dates); a person is one `staff` per tenant with a role set (B-19) | Security owner | Membership tests | Proposal |
| TEN-12 | Tenant lifecycle state (provisioning, onboarding, live, suspended, exit, closed) lives in the platform registry; provisioning → onboarding requires the signed processor agreement and NDA (PRIV-8) — no real personal data enters a tenant before it; suspended → live only by the platform owner with reason; suspended tenants keep clinical read/export, purpose reads (TEN-18), existing appointments, cashier, care messages, the SATUSEHAT outbox, record corrections, patient copies and data-subject requests, and lose new bookings, public pages (edge cache purged) and marketing messages (PR-56) | Engineering owner | Lifecycle tests | Proposal |
| TEN-13 | Onboarding grant: tenant-scoped vendor grant until go-live or 30 days, limited to configuration objects (branches, catalog, staff invitations, imports, branding, templates), never clinical policy kinds; invitations created under the grant are drafts until the owner confirms each invitee and role set in Akses Vendor; Owner, Admin Pusat, Finance, Facility head, Records officer and Internal auditor roles are never assignable under a vendor grant; an account linked to `vendor_staff` can never accept such an invitation; patient, contact and balance imports run as owner-started jobs — vendor staff see counts and row-error codes only, never row content; every change written to the clinic audit log (PR-58) | Security owner | Grant tests | Proposal |
| TEN-14 | Support session (= TEN-6 operator grant): scope declares purpose and object kinds; TTL ≤ 2 h with at most one extension and a new reason; owner approval is required before a scope includes clinical kinds **or** specific personal data (messages and media, `identity_enc`, consents, photos, letters) and again for a clinical-scope extension; notify-only scopes are limited to configuration, catalog, settings, integration status and money totals; every record read in a session is audited (object kind, id, time) and shown to the owner grouped by session; sessions end at TTL or on owner action (PR-60) | Security owner | Session tests | Proposal |
| TEN-15 | One codebase and one deployment serve all tenants; differences are tenant data and settings; an optional dedicated instance runs the same image with one tenant and is listed in the platform registry (P-11) | Engineering owner | Release check: no tenant-specific code paths | Proposal |
| TEN-16 | Vendor platform tables (vendor_staff, server_fee_versions, vendor_invoices, vendor_payments, lifecycle events, onboarding checklists) are policy kind `platform` and never joined to tenant rows except through security-definer functions returning IDs and counts (ARCH-8), except one read path that returns the calling tenant's own vendor invoices, attempts and credit notes (amount, period, state, pay instruction, receipt) to owner, finance, Admin Pusat and internal auditor | Security owner | Policy tests | Proposal |
| TEN-17 | RLS for support sessions: a session binds `app.tenant_id`, `app.operator_session_id` and `app.session_scope` (policy kinds); every policy kind has an operator predicate (active, unexpired session with the kind in scope); raw-SQL tests per kind for in-scope, out-of-scope and expired sessions | Security owner | RLS operator tests | Proposal |
| TEN-18 | Role-aware predicates: tenant-shared and branch-scoped reads require `role ∈ kind_readers(table)` generated from the 07 matrix; Marketing reads patients only through a security-barrier view filtered by active marketing consent; records officer and facility head read clinical rows with a declared purpose (correction, patient copy, data request, audit), audited; tenant export runs as an owner-started security-definer job that delivers a file, not an in-app clinical view; projection test per role × table | Security owner | Projection tests | Proposal |
| TEN-19 | Per-table scope map: the first migration ships `scope_map` with one row per physical table (policy kind, owning module, reader roles, writer service, branch semantics); the TEN-3 test fails on any table missing or classified twice; operator predicates (TEN-17) check approved **object kinds and projections**, not only policy kinds; money totals for notify-only sessions come from bounded views | Security owner | Scope-map and operator-projection tests | Proposal |

## Policy Kinds

| Kind | Rows | Read | Write |
|---|---|---|---|
| tenant-shared | patients, contact points, guardians, consents, catalog, prices, packages, balance, booking DP, commission rules, leads, conversations, suppliers | Members of the tenant whose acting role is in `kind_readers` (TEN-18) | Members of the tenant by role, from any allowed branch |
| clinical | medical records + versions, care plans, assessments, photos, prescriptions, complaint tasks | Clinicians with an active visit, assignment or task for the patient at an allowed branch; break-glass with reason | Authoring clinician at an allowed branch |
| branch-scoped | visits, appointments, schedules, stock, cash shifts, executions | Members with the branch in the acting role's branch scope and the role in `kind_readers` (IAM-9, TEN-18) | Same, with `active_branch_id` |
| tenant-ledger | invoices, payments, allocations, receivables, write-offs, refunds, journals, commission entitlements (carry `branch_id` dimension) | Finance/owner tenant-wide; branch roles by branch; commission rows only to the recipient staff and finance/owner | Posting service only |
| platform | routing tables, tenants registry, operator grants | Security-definer functions | Platform operator |

Owner and finance see tenant-wide money and identity but no clinical rows (07). Central CS: tenant-wide booking and inbox, no clinical rows.
