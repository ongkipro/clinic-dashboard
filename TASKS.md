# Tasks — Clinic Dashboard

Updated: 2026-11-05

Kit v0.7, re-validated at G1 on 2026-11-02 (P-27; Q-12 may still change PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83). Root execution queue of `~/Projects/clinic-dashboard` (DEL-1). Every task traces to exactly one primary `PR-*` in `02-PRD.md`; other IDs are constraints. Task state lives in `STATUS.md` and `.delivery/`, not here.

## Rules for the AI

- One task per request; change only `Allowed Paths`; need more → stop and ask. Standing exceptions: tool-written `.delivery/**` records and the `STATUS.md` checkpoint line; a task with `drizzle/**` may add its module's re-export line to `src/db/schema/index.ts`.
- A Done-when that names part of a scenario ("half", "module level") is complete when that part passes; the named later task completes the full §8 scenario.
- Respect `AGENTS.md`: tenant isolation tests for every route/job/export, no secrets, no live provider calls, integer rupiah, idempotency, clinic glossary.
- R3/R4 tasks need an independent review before integration (`cross-cli` or the runtime's review lane).
- A task with UI paths is done only with browser evidence at 390/820/1180/1440 (`ui-validation`).
- `Done when` names the procedure; the result is recorded as evidence only after it runs.

## Summary

| Milestone | Tasks |
|---|---|
| M0 | T-001–T-032 (32) |
| M1 | T-033–T-049 (17) |
| M2 | T-050–T-059 (10) |
| M3 | T-060–T-069 (10) |
| M4 | T-070–T-086 (17) |
| M5 | T-087–T-088 (2) |
| M6 | T-089–T-101 (13) |
| M7 | T-102–T-103 (2) |
| M8 | T-104–T-119 (16) |
| M9 | T-120–T-131 (12) |

## Pending

### Hygiene queue (owner-authorised, runs before the remaining M0 tasks)

Owner instructions 2026-11-04/05 (foundation review: "jika ada bugs dan kekurangan kamu sempurnakan"; DEC-040, DEC-041). These are not `T-*` tasks and trace to no PR: each fixes verified defects in finished M0 work. Each has a plan in `docs/tasks/<ID>.md` and goes through the delivery ledger, independent review (GPT and claude for R3) and a local commit, like a task. Order is binding: one at a time, top to bottom, then T-027, T-028, T-032.

| Order | ID | Risk | Scope | Plan | State |
|---|---|---|---|---|---|
| 1 | HYG-006 | R3 | Test harness: database creates never beside other database DDL (advisory lock). Allowed: `tests/rls/harness.ts`, `tests/rls/harness-lock.test.ts`, `tests/db/migrations.test.ts`, docs | `docs/tasks/HYG-006.md` | Done: `3acf40e`; ledger PASS; CI 42164189650 green |
| 2 | HYG-007 | R3 | Second factor: `get-totp-uri` refused, backup codes need a current code, step-up codes counted per account (F1–F3, DEC-041 (1)). Allowed: `src/auth/server.ts`, `src/app/(auth)/security-panel.tsx`, `src/app/(auth)/client.ts`, `tests/auth/**`, docs | `docs/tasks/HYG-007.md` | Done: `34169c8`; ledger PASS; CI 42167939946 green |
| 3 | HYG-008 | R3 | Database authority: actor validity on the wall clock after `staff_access`; operator role re-check and column grants; sweep re-check; offboarding guard; `seq`; TRUNCATE guard. Migration `drizzle/0048_*`; allowed: `drizzle/**`, `src/db/rls/operator.sql`, `tests/rls/**`, docs | `docs/tasks/HYG-008.md` | Done (DEC-043 split): HYG-008a `480c49b` (CI 42174727148 attempt 1 failed on `hosts.spec.ts`, intermittent, owned by HYG-011; attempt 2 passed); HYG-008b `b8c9036` (ledger PASS, review APPROVE, CI 42233523542 green) |
| 4 | HYG-009 | R3 | Clinic write actions refuse a stale context (two tabs); `/staf/<id>` for Admin Pusat; Owner branch settings; context switch honours session revocation. Allowed: `src/app/(app)/**/actions.ts`, forms, `src/modules/org/**`, `drizzle/**` (settings branch rule), tests, docs | `docs/tasks/HYG-009.md` | Done: `74b3714`; pushed, CI 42369917032 green |
| 5 | HYG-010 | R2 | Isolation gate that can fail for cross-tenant writes; outbox negative; `/staf/[id]` not-found; browser runners exit non-zero; stale STATUS/ARCHITECTURE lines; DECISIONS supersedes marks. Allowed: `tests/isolation/**`, `tests/ui/**`, docs | `docs/tasks/HYG-010.md` | Done: `2549b53`; pushed, CI 42369917032 green |
| 6 | HYG-011 | R2 | Measured limits for timing-bound tests (the 5 s test timeout under load was raised to 30 s inside HYG-006, 2026-11-06; what remains: tests whose timing is the point); `hosts.spec.ts` keeps server output and takes a free port. Allowed: `tests/**`, docs | `docs/tasks/HYG-011.md` | Done: `5ec5b63`; pushed, CI 42369917032 green |
| 7 | — | — | Wave gate (CI order locally, image migration, restore drill), push, CI green | `STATUS.md` | Done: wave gate PASS on `5ec5b63`; pushed; CI 42369917032 green |

### Milestone M0

#### T-001: Repository bootstrap: Next.js App Router, TypeScript strict, pnpm, Docker Compose PostgreSQL 16, CI skeleton, `pnpm docs:check`
- **Primary requirement:** PR-1
- **Risk Level:** R2
- **Allowed Paths:** `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `tsconfig.json`, `compose.yaml`, `Dockerfile`, `.github/workflows/ci.yml`, `scripts/check-traceability.py`, `docs/spec/**`, `DECISIONS.md`, `README.md`, `AGENTS.md`, `STATUS.md`
- **Protected Paths:** None
- **Depends On:** None
- **Visual Contract:** Not applicable
- **Done when:** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm build && pnpm docs:check` all exit 0 in CI and locally; versions pinned per `15` §2 are recorded in DECISIONS.md; the promotion check confirms every `15` §3 repository document exists and is non-empty
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-002: Database core: Drizzle setup, migration runner, `tenants`, `tenants_registry`, `branches` with composite keys `(tenant_id,id)`
- **Primary requirement:** PR-1
- **Risk Level:** R3
- **Allowed Paths:** `src/db/**`, `drizzle/**`, `drizzle.config.ts`, `tests/db/**`, `src/db/schema/index.ts`, `package.json`, `pnpm-lock.yaml`, `src/modules/org/schema.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `drizzle/**`
- **Depends On:** T-001
- **Visual Contract:** Not applicable
- **Done when:** Fresh database migrates with `pnpm db:migrate`; a migration test asserts `UNIQUE(tenant_id,id)` on every tenant table and `ON DELETE RESTRICT` on business FKs (05 §3.1); `pnpm db:migrate` script and Drizzle dependencies added by this task
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-003: RLS harness: non-owner app role without BYPASSRLS, per-transaction tenant context (TEN-2), scope map table and TEN-3/TEN-19 test
- **Primary requirement:** PR-1
- **Risk Level:** R4
- **Allowed Paths:** `src/db/rls/**`, `src/db/scope-map.ts`, `tests/rls/**`, `drizzle/**`, `src/db/schema/index.ts`, `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-002
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test:rls` passes: startup refuses a BYPASSRLS role; a table missing from `scope_map` or classified twice fails the test; cross-tenant read of a fixture row returns not-found (full scenario PR-1 with patients and audit in the patient-registration task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-004: Isolation CI gates: cross-tenant negative test generator per route/job/export, tenant-literal lint rule, build digest record (DEL-2)
- **Primary requirement:** PR-1
- **Risk Level:** R3
- **Allowed Paths:** `tests/isolation/**`, `eslint.config.mjs`, `.github/workflows/ci.yml`, `scripts/record-digest.mjs`, `package.json`, `pnpm-lock.yaml`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-003
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test:isolation` fails when a route has no negative test (demonstrated with a deliberately untested fixture route, then removed); lint fails on a hard-coded tenant slug in `src/`
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-005: Platform basics: pgBackRest backups, key custody (envelope keys for NIK, tokens and PINs), app/booking/vendor host resolver (ARCH-3)
- **Primary requirement:** PR-1
- **Risk Level:** R4
- **Allowed Paths:** `ops/pgbackrest/**`, `compose.yaml`, `src/lib/keys/**`, `src/lib/hosts.ts`, `tests/platform/**`, `src/proxy.ts`, `tests/platform/hosts.spec.ts`
- **Protected Paths:** `src/lib/keys/**`
- **Depends On:** T-003
- **Visual Contract:** Not applicable
- **Done when:** A seeded database restores to a scratch instance with matching row counts; envelope encryption round-trip and key-rotation tests pass; the host resolver is wired into `src/proxy.ts` (Next.js 16 proxy convention) and HTTP negatives prove `/saya` and `/persetujuan` are refused on the booking and vendor hosts, public routes are refused on the app host, and vendor routes are refused on every non-vendor host
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-006: Staff authentication: Better Auth email+password, TOTP for roles in IAM-1, throttling, front-desk idle lock 120 s
- **Primary requirement:** PR-3
- **Risk Level:** R4
- **Allowed Paths:** `src/auth/**`, `src/app/(auth)/**`, `tests/auth/**`, `drizzle/**`, `src/db/schema/index.ts`
- **Protected Paths:** `src/auth/**`
- **Depends On:** T-003
- **Visual Contract:** Visual contract per `docs/spec/10` and `DESIGN.md` (sign-in, TOTP, idle-lock screens); tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-3 second factor passes; tests prove TOTP required for owner/Admin Pusat/manager/doctor/finance/facility head/records officer/auditor/central CS, lockout after 5 failures/15 min (RATE-2), FO idle lock at 120 s
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-007: Identity chain: accounts → memberships → staff (1:1), staff_roles, staff_branches with composite FKs, acting role and branch scope per IAM-9 (DATA-55)
- **Primary requirement:** PR-3
- **Risk Level:** R4
- **Allowed Paths:** `src/modules/org/**`, `drizzle/**`, `tests/org/**`, `src/db/schema/index.ts`, `src/modules/org/schema.ts`
- **Protected Paths:** `drizzle/**`
- **Depends On:** T-006
- **Visual Contract:** Not applicable
- **Done when:** Migration and tests prove `staff.membership_id NOT NULL UNIQUE`, staff cannot be assigned another tenant's branch, Level 2 roles see future branches (wildcard), acting role recorded on actions
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-008: Audit attribution and log: `audit_events` with DATA-60 fields set server-side, hash chain per tenant, daily write-once copy, Log Audit read API
- **Primary requirement:** PR-51
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/audit/**`, `drizzle/**`, `tests/audit/**`, `src/app/(app)/audit/**`, `tests/ui/audit.spec.ts`, `src/db/schema/index.ts`, `src/modules/audit/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-007
- **Visual Contract:** Visual contract per `docs/spec/17` UX-31; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-51 passes; a test tampering with an audit row breaks the chain check; audit rows carry account, membership, staff, acting role, tenant, branch, vendor session; no clinical values stored
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-009: Idempotency records with request fingerprint and replay contract (DATA-45) as a shared command wrapper
- **Primary requirement:** PR-1
- **Risk Level:** R3
- **Allowed Paths:** `src/lib/command.ts`, `src/modules/idempotency/**`, `drizzle/**`, `tests/idempotency/**`, `src/db/schema/index.ts`, `src/modules/idempotency/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-008
- **Visual Contract:** Not applicable
- **Done when:** Tests: same key + same body returns stored result; same key + different body → ERR rejected (TD-51); concurrent duplicates execute once
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-010: Domain events outbox, worker claim with SKIP LOCKED and per-row tenant binding, consumer receipts (DATA-59, TEN-5)
- **Primary requirement:** PR-1
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/events/**`, `src/workers/outbox.ts`, `drizzle/**`, `tests/events/**`, `src/db/schema/index.ts`, `src/modules/events/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-009
- **Visual Contract:** Not applicable
- **Done when:** Tests: event written in the same transaction as its fact (rollback leaves none); two workers never process one event; a consumer applies an event once (`event_receipts`)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-011: Approvals engine: requester ≠ approver, owner self-write-off whitelist, approval types registry
- **Primary requirement:** PR-37
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/approvals/**`, `drizzle/**`, `tests/approvals/**`, `src/db/schema/index.ts`, `src/modules/approvals/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-010
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-37 passes; requester approving own request is refused with TD-51 code; owner write-off without reason refused
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-012: Design tokens and base components from DESIGN.md (shadcn restyled, Drawer sheets), state copy patterns
- **Primary requirement:** PR-86
- **Risk Level:** R1
- **Allowed Paths:** `src/styles/**`, `src/components/ui/**`, `tests/ui/tokens.spec.ts`, `package.json`, `pnpm-lock.yaml`, `playwright.config.ts`, `components.json`
- **Protected Paths:** None
- **Depends On:** T-001
- **Visual Contract:** Visual contract per `docs/spec/10` and `DESIGN.md`; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Contrast test over all token pairs passes (UI-1); accent validation rejects a failing hex (UI-2); browser snapshot of the component gallery at 390/820/1180/1440
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-013: App shell: role-filtered sidebar and phone tab bar with Menu (search, pinned, recent), global search slot, quick actions, notifications, command palette
- **Primary requirement:** PR-86
- **Risk Level:** R2
- **Allowed Paths:** `src/components/shell/**`, `src/app/(app)/layout.tsx`, `tests/ui/shell.spec.ts`
- **Protected Paths:** None
- **Depends On:** T-012, T-007
- **Visual Contract:** Visual contract per `docs/spec/19` §1 NAV-1–NAV-8; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-86 passes for pharmacist and owner; `pnpm test:ui` checks 390/820/1180/1440 and 200% text
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-014: VisitTrack component, list/detail page templates (NAV-4, NAV-5), report table→card pattern
- **Primary requirement:** PR-86
- **Risk Level:** R1
- **Allowed Paths:** `src/components/visit-track/**`, `src/components/templates/**`, `tests/ui/templates.spec.ts`
- **Protected Paths:** None
- **Depends On:** T-013
- **Visual Contract:** Visual contract per `docs/spec/10` Component Contract; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Browser check of templates with loading, empty, filtered-empty, error, blocked states; VisitTrack renders all 10 segments with word labels
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-015: Persetujuan inbox API and screen (UX-26) with type filter and detail
- **Primary requirement:** PR-44
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/persetujuan/**`, `src/modules/approvals/inbox.ts`, `tests/approvals/inbox.test.ts`
- **Protected Paths:** None
- **Depends On:** T-011, T-013
- **Visual Contract:** Visual contract per `docs/spec/17` UX-26 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-44 passes with a fixture approval type (the stock-adjustment type attaches in the items task); browser check of UX-26 at 390/820/1180/1440 with empty, list and blocked (own request) states
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-016: In-app notifications with acknowledgement (generic engine; alert types added by later tasks)
- **Primary requirement:** PR-54
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/notifications/**`, `drizzle/**`, `tests/notifications/**`, `src/db/schema/index.ts`, `src/modules/notifications/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-010
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-54 passes with a test alert type; acknowledgement records who and when
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-017: Settings registry SET-1–SET-49: typed values, bounds, scope, versions, drafts and approvals, Kembalikan ke default, snapshot helper
- **Primary requirement:** PR-38
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/settings/**`, `drizzle/**`, `tests/settings/**`, `src/app/(app)/pengaturan/**`, `tests/ui/pengaturan.spec.ts`, `src/db/schema/index.ts`, `src/modules/settings/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-011
- **Visual Contract:** Visual contract per `docs/spec/19` §2.17 and §5; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenarios PR-38 (out of bounds, restore default) pass; every SET row in `19` §5 exists with its default, bound and changer; fixed rules are absent from the registry; browser check of the Pengaturan editor including Kembalikan ke default; SET-44 accepts month_end or day(1..28), defaults to month_end and never changes the monthly cadence
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-018: Vendor profile with placeholder marking and residency fields (DATA-47)
- **Primary requirement:** PR-55
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/vendor/profile/**`, `drizzle/**`, `tests/vendor/profile.test.ts`, `src/db/schema/index.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-008
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-55 passes; placeholder values render marked and block production go-live
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-019: Compliance register: evidence items, file versions with checksum, approvals bound to file/config version, feature-gate evaluator (DATA-71)
- **Primary requirement:** PR-97
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/compliance/**`, `drizzle/**`, `tests/compliance/**`, `src/app/(app)/kepatuhan/**`, `src/app/vendor/kepatuhan/**`, `tests/ui/kepatuhan.spec.ts`, `src/db/schema/index.ts`, `src/modules/compliance/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-018, T-011
- **Visual Contract:** Visual contract per `docs/spec/17` UX-58; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenarios PR-97 pass with a test gate; a new evidence file version reopens the gate; expiry closes it; vendor-level items invisible to tenants except status view
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-020: Vendor staff and roles with TOTP, IP allowlist, maker-checker for fee change, suspension, exit, waiver, clinical grant
- **Primary requirement:** PR-57
- **Risk Level:** R4
- **Allowed Paths:** `src/modules/vendor/staff/**`, `drizzle/**`, `tests/vendor/staff.test.ts`, `src/db/schema/index.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `src/modules/vendor/**`
- **Depends On:** T-006, T-011
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-57 passes; dual vendor/clinic identity refused without both approvals
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-021: Vendor console on its own hostname with separate __Host- cookies, strict CSP, no clinic session accepted (SEC-21)
- **Primary requirement:** PR-57
- **Risk Level:** R3
- **Allowed Paths:** `src/app/vendor/**`, `src/proxy.ts`, `tests/vendor/host.test.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-020
- **Visual Contract:** Visual contract per `docs/spec/17` UX-40–UX-49 shell (desktop-first); tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Tests: clinic session cookie rejected on vendor host and vice versa; CSP header present; tenant strings escaped in vendor tables
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-022: Tenant lifecycle states and suspension effects (TEN-12)
- **Primary requirement:** PR-56
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/vendor/lifecycle/**`, `drizzle/**`, `tests/vendor/lifecycle.test.ts`, `src/db/schema/index.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-020
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-56 manual suspension keeps records passes; suspended tenants keep care-message eligibility (the aftercare half of PR-56 completes in the aftercare task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-023: Tenant provisioning: create brand + PT + first branch from vendor console; processor agreement gate before onboarding
- **Primary requirement:** PR-1
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/vendor/tenants/**`, `src/app/vendor/tenant/**`, `tests/vendor/tenants.test.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-022, T-019
- **Visual Contract:** Visual contract per `docs/spec/17` UX-40; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Creating a tenant writes registry, tenant and branch rows; moving to onboarding is refused while the processor-agreement evidence is not approved
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-024: Onboarding grant: configuration-only scope, draft invitations, owner-confirmed, never Level 2 roles, imports owner-started (TEN-13)
- **Primary requirement:** PR-58
- **Risk Level:** R4
- **Allowed Paths:** `src/modules/vendor/onboarding/**`, `drizzle/**`, `tests/vendor/onboarding.test.ts`, `src/db/schema/index.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `src/modules/vendor/**`
- **Depends On:** T-023
- **Visual Contract:** Not applicable
- **Done when:** Scenarios PR-58 pass (no clinical read; self-invite as Owner refused); grant expires at go-live or day 30
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-025: Support sessions: scope by object kind, TTL ≤ 2 h, operator RLS predicates (TEN-14, TEN-17)
- **Primary requirement:** PR-53
- **Risk Level:** R4
- **Allowed Paths:** `src/modules/vendor/support/**`, `src/db/rls/operator.sql`, `drizzle/**`, `tests/vendor/support.test.ts`, `src/db/schema/index.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `src/db/rls/**`
- **Depends On:** T-024, T-003
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-53 passes; RLS tests for in-scope, out-of-scope and expired sessions pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-026: Support-session scope approval and read audit: owner approval for clinical/specific personal data, every read listed (TEN-14)
- **Primary requirement:** PR-60
- **Risk Level:** R4
- **Allowed Paths:** `src/modules/vendor/support/scope.ts`, `tests/vendor/support-scope.test.ts`
- **Protected Paths:** `src/modules/vendor/**`
- **Depends On:** T-025
- **Visual Contract:** Not applicable
- **Done when:** Scenarios PR-60 (owner sees access, clinical scope without approval, expired grant) pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-027: Onboarding checklist per tenant/branch and go-live confirmation
- **Primary requirement:** PR-59
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/vendor/checklist/**`, `src/app/vendor/onboarding/**`, `tests/vendor/checklist.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-025
- **Visual Contract:** Visual contract per `docs/spec/17` UX-41 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-59 passes: go-live refused naming a blocking item, refused with fewer than two vendor staff, and refused while the clinical go-live evidence (Q-07 authority matrix, PR-97) is unapproved; go-live date recorded for server-fee billing
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-028: Owner view Saya › Akses Vendor (UX-48): grants, sessions, reads, infrastructure access, dual identities; end session; approve clinical scope
- **Primary requirement:** PR-60
- **Risk Level:** R3
- **Allowed Paths:** `src/app/(app)/saya/akses-vendor/**`, `tests/ui/akses-vendor.spec.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-025, T-013, T-026
- **Visual Contract:** Visual contract per `docs/spec/17` UX-48 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Browser check: owner sees a seeded session with reads and can end it; approval request appears for a clinical-scope session
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-029: Admin Pusat, Marketing, Purchasing, Internal auditor roles with role-aware RLS readers (TEN-18) and owner-only guard
- **Primary requirement:** PR-63
- **Risk Level:** R4
- **Allowed Paths:** `src/modules/org/roles/**`, `src/db/rls/readers.sql`, `tests/rls/readers.test.ts`
- **Protected Paths:** `src/db/rls/**`
- **Depends On:** T-007, T-003
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-63 Admin Pusat cannot grant Owner passes; projection test per role × table generated from the 07 matrix passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-030: Ganti Cabang / Ganti Klinik / Ganti Peran with active context under the title
- **Primary requirement:** PR-84
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/org/context/**`, `src/app/(app)/saya/**`, `tests/org/context.test.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-029, T-013
- **Visual Contract:** Visual contract per `docs/spec/17` 17 Navigation and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Context switching records the active branch, brand and acting role on actions (full PR-84 with Antrean in the walk-in task; PR-3 acting role with signing in the signing task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-031: Staf & Undangan UX-3: staff, invitations and credential-status segments; Pengguna & Akses permission matrix, membership sessions, duties and change log
- **Primary requirement:** PR-91
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/org/access/**`, `src/app/(app)/pengguna-akses/**`, `tests/org/access.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/org/schema.ts`, `src/app/(app)/staf/**`, `src/modules/org/staff/**`, `tests/ui/staf.spec.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-030, T-007
- **Visual Contract:** Visual contract per `docs/spec/17` UX-3 and `docs/spec/19` Staf & Undangan (all segments); tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-91 passes; revoking ends only that membership's sessions; an already open session loses access within 60 s; browser checks of staff list/detail, invite creation/acceptance and credential-status segment using fixtures (credential verification actions completed in the credentials task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-032: M0 exit review: run all M0 scenarios, RLS, isolation and auth suites; independent R4 review recorded
- **Primary requirement:** PR-1
- **Risk Level:** R4
- **Allowed Paths:** `docs/evidence/m0/**`, `STATUS.md`, `.delivery/**`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-004, T-031, T-027, T-028, T-017, T-015, T-016, T-014, T-021, T-026, T-005
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test:rls && pnpm test:isolation && pnpm test -- m0` pass in CI; independent reviewer PASS recorded in `.delivery/`
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M1

#### T-033: Catalog versions with clinical-review publishing gate
- **Primary requirement:** PR-41
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/catalog/**`, `drizzle/**`, `tests/catalog/**`, `src/app/(app)/katalog/**`, `src/db/schema/index.ts`, `src/modules/catalog/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-032
- **Visual Contract:** Visual contract per `docs/spec/17` UX-25; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-41 passes; catalog versions are immutable once referenced (CLIN-011 old receipts and entitlements complete in the packages task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-034: Master Layanan: durations, resources, staff eligibility, BHP recipe, consent and aftercare links, online-bookable (DATA-62) + UX-25 screen
- **Primary requirement:** PR-88
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/catalog/service/**`, `src/app/(app)/layanan/**`, `drizzle/**`, `tests/catalog/service.test.ts`, `src/db/schema/index.ts`, `src/modules/catalog/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-033, T-014
- **Visual Contract:** Visual contract per `docs/spec/17` UX-25 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Master Layanan saved and versioned with resources and staff eligibility (scenario PR-88 slot effect in the booking task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-035: Branch price overrides (owner only), effective-dated
- **Primary requirement:** PR-42
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/catalog/prices/**`, `drizzle/**`, `tests/catalog/prices.test.ts`, `src/app/(app)/katalog/harga-cabang/**`, `src/db/schema/index.ts`, `src/modules/catalog/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-033
- **Visual Contract:** Visual contract per `docs/spec/17` UX-25 branch price tab; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Branch price override stored owner-only and effective-dated; Admin Pusat cannot override (invoice half of scenario PR-42 in the cashier task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-036: Branch master UX-2: hours, closures, rooms, devices, services, WhatsApp, map, publish window, licence fields (SET-46)
- **Primary requirement:** PR-2
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/org/branches/**`, `src/app/(app)/pengaturan/cabang/**`, `tests/org/branches.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/org/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-032, T-014
- **Visual Contract:** Visual contract per `docs/spec/17` UX-2 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Branch master saved and audited; browser check UX-2 (slot half of PR-2 in the booking task, public listing half in the public-site task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-037: Patient registration with identity types, guardian, duplicate decision, encrypted NIK + blind index (UX-4)
- **Primary requirement:** PR-5
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/patients/**`, `src/app/(app)/pasien/baru/**`, `drizzle/**`, `tests/patients/**`, `src/db/schema/index.ts`, `src/modules/patients/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-032, T-014
- **Visual Contract:** Visual contract per `docs/spec/17` UX-4 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-5 passes; NIK never stored in clear; one phone for two patients does not expose either; scenario PR-1 tenant isolation passes in full (patients of two tenants, audit event recorded)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-038: Consent ledger with immutable consent-text versions and withdrawal
- **Primary requirement:** PR-4
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/patients/consents/**`, `drizzle/**`, `tests/patients/consents.test.ts`, `src/db/schema/index.ts`, `src/modules/patients/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-037
- **Visual Contract:** Not applicable
- **Done when:** Consent-ledger half of scenario PR-4 passes (withdrawal recorded, text versions immutable); the full scenario completes in the outbound task
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-039: Privacy workspace: consent texts, consent ledger view, processors, breach register with 72 h deadline and notices (UX-30 ▸ Privasi)
- **Primary requirement:** PR-92
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/privacy/**`, `src/app/(app)/privasi/**`, `drizzle/**`, `tests/privacy/**`, `src/db/schema/index.ts`, `src/modules/privacy/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-038
- **Visual Contract:** Visual contract per `docs/spec/17` UX-30 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-92 passes; breach state transitions audited
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-040: Patient profile 360° with role projections and patient copy (UX-29)
- **Primary requirement:** PR-49
- **Risk Level:** R3
- **Allowed Paths:** `src/app/(app)/pasien/[id]/**`, `src/modules/patients/profile.ts`, `tests/patients/profile.test.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-038
- **Visual Contract:** Visual contract per `docs/spec/17` UX-29 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Role projections of scenario PR-49 pass (cashier sees no clinical tabs; projection test per role); the record-copy half passes in the signing task
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-041: Patient list UX-4 (filters and saved segments) and global patient search under RLS: masked phone, rate limit, no query logging, abuse alert
- **Primary requirement:** PR-76
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/patients/search/**`, `tests/patients/search.test.ts`, `src/app/(app)/pasien/page.tsx`, `src/app/(app)/pasien/_components/**`, `tests/ui/pasien-list.spec.ts`, `src/modules/patients/schema.ts`, `drizzle/**`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-040
- **Visual Contract:** Visual contract per `docs/spec/17` UX-4 and `docs/spec/19` §2 Daftar Pasien; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-76 passes; query string absent from logs; rate limit enforced; browser check of Daftar Pasien filters and persisted saved segments; cross-tenant negatives on list and saved segments
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-042: Duplicate patient merge (records officer), audited and reversible
- **Primary requirement:** PR-85
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/patients/merge/**`, `tests/patients/merge.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/patients/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-040
- **Visual Contract:** Not applicable
- **Done when:** Merge then unmerge restores both patients with all linked rows; audit shows actor and reason
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-043: Staff schedules (shifts, leave) per branch (UX-33)
- **Primary requirement:** PR-48
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/scheduling/rosters/**`, `src/app/(app)/jadwal-staf/**`, `tests/scheduling/rosters.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/scheduling/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-036
- **Visual Contract:** Visual contract per `docs/spec/17` UX-33 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Roster shifts and leave persist per branch; module-level availability excludes a doctor on leave (full scenario PR-48 roster in the booking task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-044: Booking engine: valid slots from service master, resources reserved together, channel and source, slot hold
- **Primary requirement:** PR-6
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/scheduling/booking/**`, `drizzle/**`, `tests/scheduling/booking.test.ts`, `src/db/schema/index.ts`, `src/modules/scheduling/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-034, T-043
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-6 passes; overlapping reservations refused by exclusion constraint; scenario PR-88 (no device → no slot) passes; bookings store the catalog version used; slot half of scenario PR-2 (branch hours and closures limit slots) passes; full scenario PR-48 roster passes: requesting a slot for a doctor on leave yields no slot
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-045: Jadwal UX-5: calendar views, appointment states, Ubah Jadwal, Batalkan, Tandai Tidak Datang (DP effects in M4)
- **Primary requirement:** PR-83
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/jadwal/**`, `src/modules/scheduling/appointments/**`, `tests/scheduling/appointments.test.ts`
- **Protected Paths:** None
- **Depends On:** T-044
- **Visual Contract:** Visual contract per `docs/spec/17` UX-5 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Appointment states and actions of scenario PR-83 no-show without DP pass (state no-show, no money moves); the CS follow-up half passes in the follow-ups task; browser check UX-5 phone agenda and desktop week
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-046: Lateness release setting (SET-15)
- **Primary requirement:** PR-8
- **Risk Level:** R1
- **Allowed Paths:** `src/modules/scheduling/lateness.ts`, `tests/scheduling/lateness.test.ts`
- **Protected Paths:** None
- **Depends On:** T-045
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-8 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-047: Check-in, visit with independent states, Hari Ini board with VisitTrack and Belum dibayar section (UX-6)
- **Primary requirement:** PR-7
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/visits/**`, `src/app/(app)/hari-ini/**`, `drizzle/**`, `tests/visits/**`, `src/db/schema/index.ts`, `src/modules/visits/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-045, T-040
- **Visual Contract:** Visual contract per `docs/spec/17` UX-6 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Board and close blocker of scenario PR-7 pass for an unpaid bill; the unpaid-addition half passes in the additions task
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-048: Walk-in registration and daily queue numbers; paired TV display without names
- **Primary requirement:** PR-71
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/visits/queue/**`, `src/app/(app)/antrean/**`, `tests/visits/queue.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/visits/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-047
- **Visual Contract:** Visual contract per `docs/spec/17` UX-6 ▸ Antrean and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-71 passes; TV payload contains no patient name; Scenario PR-84 branch switch passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-049: M1 exit: book → check-in → board on a real database; all M1 scenarios
- **Primary requirement:** PR-7
- **Risk Level:** R2
- **Allowed Paths:** `docs/evidence/m1/**`, `STATUS.md`
- **Protected Paths:** None
- **Depends On:** T-048, T-046, T-042, T-041, T-039, T-035
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test -- m1` and `pnpm test:ui -- m1` pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M2

#### T-050: Credential model (STR lifetime, SIP per branch) and expiry alerts 60/30/7
- **Primary requirement:** PR-73
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/org/credentials/**`, `tests/org/credentials.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/app/(app)/staf/**`, `tests/ui/staf-kredensial.spec.ts`, `src/modules/org/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-049
- **Visual Contract:** Visual contract per `docs/spec/17` UX-3 credential verification segment; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-73 passes; no alert for lifetime STR; browser check of STR/SIP credential verification in Staf & Undangan; expired/invalid credentials remain blocked
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-051: BC Pendampingan flow (UX-7): intake, photos, Observasi Kulit, Kirim ke Dokter; no scores
- **Primary requirement:** PR-9
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/clinical/intake/**`, `src/app/(app)/pendampingan/**`, `drizzle/**`, `tests/clinical/intake.test.ts`, `src/db/schema/index.ts`, `src/modules/clinical/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-049
- **Visual Contract:** Visual contract per `docs/spec/17` UX-7 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-9 and CLIN-001–003 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-052: Lembar Pemeriksaan (UX-8): verify intake, SOAP templates, face map with dose per point, staged plan, BC/FO projection
- **Primary requirement:** PR-10
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/clinical/exam/**`, `src/app/(app)/pemeriksaan/**`, `drizzle/**`, `tests/clinical/exam.test.ts`, `src/db/schema/index.ts`, `src/modules/clinical/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-051
- **Visual Contract:** Visual contract per `docs/spec/17` UX-8 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-10 and CLIN-004, CLIN-012 pass; BC projection shows items and prices only
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-053: Signing, immutability, 2×24 h correction, late corrections via approval, patient copy, retention
- **Primary requirement:** PR-13
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/clinical/records/**`, `drizzle/**`, `tests/clinical/records.test.ts`, `src/db/schema/index.ts`, `src/modules/clinical/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-052
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-13 and CLIN-014, CLIN-023 pass; patient record copy of scenario PR-49 passes; scenario PR-3 acting role for multi-role staff passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-054: Procedure consent (UX-39) and start gates: credentials, competence, contraindication, consent matches items and doses
- **Primary requirement:** PR-11
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/clinical/consent/**`, `src/app/(app)/persetujuan-tindakan/**`, `tests/clinical/consent.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/clinical/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-053, T-050
- **Visual Contract:** Visual contract per `docs/spec/17` UX-39 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-11 and CLIN-005, CLIN-022 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-055: Private clinical media with short-lived tokens; photo compare
- **Primary requirement:** PR-32
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/clinical/media/**`, `tests/clinical/media.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/clinical/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-052
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-32 and CLIN-015, CLIN-021, CLIN-026 pass; tokens expire ≤ 10 min
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-056: Permintaan Klinis (UX-27): additions, plan changes, substitutions decided by clinician
- **Primary requirement:** PR-45
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/clinical/requests/**`, `src/app/(app)/permintaan/**`, `tests/clinical/requests.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/clinical/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-054
- **Visual Contract:** Visual contract per `docs/spec/17` UX-27 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-45 passes (payment effects integrate in M4)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-057: Keluhan Klinis and Layanan tasks from visit notes and staff flags, SET-31 targets (UX-28)
- **Primary requirement:** PR-43
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/clinical/complaints/**`, `src/app/(app)/keluhan/**`, `tests/clinical/complaints.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/clinical/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-053
- **Visual Contract:** Visual contract per `docs/spec/17` UX-28 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-43 visit-note flag and CLIN-016 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-058: Document templates (UX-54) and signed medical letters
- **Primary requirement:** PR-74
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/documents/**`, `src/app/(app)/templat/**`, `tests/documents/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/documents/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-053
- **Visual Contract:** Visual contract per `docs/spec/17` UX-54 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-74 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-059: M2 exit: clinical scenarios and CLIN set
- **Primary requirement:** PR-13
- **Risk Level:** R3
- **Allowed Paths:** `docs/evidence/m2/**`, `STATUS.md`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-056, T-057, T-058, T-050, T-055
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test -- m2` passes including CLIN-001–005, 012, 014–016, 021–023, 026; independent R3 review recorded
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M3

#### T-060: Items, batches, opened vials, FEFO, min/target, counts (UX-11)
- **Primary requirement:** PR-17
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/inventory/**`, `src/app/(app)/stok/**`, `drizzle/**`, `tests/inventory/items.test.ts`, `src/db/schema/index.ts`, `src/modules/inventory/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-059
- **Visual Contract:** Visual contract per `docs/spec/17` UX-11 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Items, batches and FEFO of scenario PR-17 and CLIN-019 pass; stock-adjustment approval type attaches to the inbox (PR-44); the transfer half passes in the depots task
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-061: Depots, batch holdings, atomic linked transfers (DATA-63)
- **Primary requirement:** PR-89
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/inventory/depots/**`, `drizzle/**`, `tests/inventory/depots.test.ts`, `src/db/schema/index.ts`, `src/modules/inventory/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-060
- **Visual Contract:** Not applicable
- **Done when:** Scenarios PR-89 (transfer, concurrent transfers) pass; transfer half of scenario PR-17 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-062: Material lifecycle request → issue → consume/return/waste; no double deduction
- **Primary requirement:** PR-16
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/inventory/materials/**`, `tests/inventory/materials.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/inventory/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-061
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-16 and CLIN-008 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-063: Moving average cost per item per branch
- **Primary requirement:** PR-46
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/inventory/costing/**`, `tests/inventory/costing.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/inventory/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-062
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-46 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-064: Ruang Tindakan checklist, staged timer, four outcomes, session effects contract (UX-9)
- **Primary requirement:** PR-14
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/treatment/**`, `src/app/(app)/ruang/**`, `drizzle/**`, `tests/treatment/**`, `src/db/schema/index.ts`, `src/modules/treatment/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-062
- **Visual Contract:** Visual contract per `docs/spec/17` UX-9 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Four outcomes of scenario PR-14 pass; session effects pass in the packages task and the commission effect in the commission task
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-065: Siapkan & Serahkan: prep list, seven checks, quarantine/recall blocks, labels (UX-10)
- **Primary requirement:** PR-18
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/pharmacy/**`, `src/app/(app)/apotek/**`, `tests/pharmacy/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/pharmacy/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-064
- **Visual Contract:** Visual contract per `docs/spec/17` UX-10 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-18 and CLIN-017, CLIN-018, CLIN-024, CLIN-025 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-066: Suppliers and supplier returns
- **Primary requirement:** PR-75
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/purchasing/suppliers/**`, `tests/purchasing/returns.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/purchasing/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-063
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-75 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-067: Purchase orders, goods receipts (GRNI), supplier invoices, payments, allocations, credit applications (UX-52)
- **Primary requirement:** PR-90
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/purchasing/**`, `src/app/(app)/pembelian/**`, `drizzle/**`, `tests/purchasing/payables.test.ts`, `src/db/schema/index.ts`, `src/modules/purchasing/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-066
- **Visual Contract:** Visual contract per `docs/spec/17` UX-52 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenarios PR-90 (payable, no double allocation) pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-068: Logbooks (sterilization, calibration, B3 waste) and patient-safety incident register
- **Primary requirement:** PR-82
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/safety/**`, `src/app/(app)/logbook/**`, `tests/safety/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/safety/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-064
- **Visual Contract:** Visual contract per `docs/spec/17` UX-9 ▸ Logbook, UX-28 ▸ Insiden and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-82 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-069: M3 exit: stock fixtures reconcile, no double deduction, depots never negative
- **Primary requirement:** PR-16
- **Risk Level:** R3
- **Allowed Paths:** `docs/evidence/m3/**`, `STATUS.md`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-065, T-067, T-068
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test -- m3` passes; independent R3 review recorded
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M4

#### T-070: Money fixture document: expected ledger lines, VAT and commission for PLAN §3 scenarios 1–20 (document task, before M4 code)
- **Primary requirement:** PR-19
- **Risk Level:** R2
- **Allowed Paths:** `docs/spec/fixtures/money-scenarios.md`
- **Protected Paths:** None
- **Depends On:** T-069
- **Visual Contract:** Not applicable
- **Done when:** Fixture document exists with a table per scenario; finance owner sign-off recorded; accountant review requested in the compliance register
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-071: Invoice and tax foundation: frozen price, tax category snapshot, PKP gate via compliance register, PKP turnover monitor
- **Primary requirement:** PR-24
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/invoice/**`, `src/modules/tax/**`, `drizzle/**`, `tests/tax/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`, `src/modules/tax/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-070, T-019
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-24 passes; VAT switch refused without approved tax-advice evidence (PR-97); tax-policy unit checks for the PKP boundary and VAT tax point pass (full money scenarios 16, 19 in the packages task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-072: Kasir (UX-12): invoices, split tender, proportional allocation, receipts, counter sale, void via approval
- **Primary requirement:** PR-19
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/**`, `src/app/(app)/kasir/**`, `tests/cashier/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-071
- **Visual Contract:** Visual contract per `docs/spec/17` UX-12 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-19 and money scenario 1 pass; scenario PR-42 branch price on an invoice passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-073: Payment port and mock adapter (UX-56) with contract suite; mock hidden in production
- **Primary requirement:** PR-68
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/payments/**`, `src/app/(app)/simulasi/**`, `tests/payments/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/payments/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072
- **Visual Contract:** Visual contract per `docs/spec/17` UX-56; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-68 and money scenario 18 pass; TD-43 contract suite passes against the mock (scenario 20 is verified in the ledger task with a synthetic settlement)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-074: Additional treatment payment flow, release before payment, receivable fallback, close guard
- **Primary requirement:** PR-15
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/additions/**`, `tests/cashier/additions.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072, T-056
- **Visual Contract:** Not applicable
- **Done when:** Scenarios PR-15 alerts and PR-15 cannot close unpaid, CLIN-020, CLIN-025 and the domain part of money scenario 3 pass; PR-7 unpaid-addition blocker passes (receivable conversion in refunds; full PR-15 receivable after the WhatsApp-bill fallback in outbound)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-075: Patient balance ledger (never expires)
- **Primary requirement:** PR-21
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/balance/**`, `tests/balance/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/balance/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072
- **Visual Contract:** Not applicable
- **Done when:** Balance ledger tests pass: scenario PR-21 balance never expires; entries never negative (product refund parts of money scenario 15 in the refunds task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-076: Packages: unlock by paid value, reserve/redeem, expiry and cancellation to balance
- **Primary requirement:** PR-20
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/packages/**`, `drizzle/**`, `tests/packages/**`, `src/db/schema/index.ts`, `src/app/(app)/kasir/paket-saldo/**`, `tests/ui/paket-saldo.spec.ts`, `src/modules/packages/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072, T-075, T-074
- **Visual Contract:** Visual contract per `docs/spec/17` UX-13; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-20, PR-14 session effects, CLIN-006, 007, 009, 010, 011, 028 and the domain parts of money scenarios 2, 5, 7, 8, 11, 12 (substitution), 13, 16, 19 pass (commission parts in the commission task)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-077: Booking DP lifecycle incl. no-show and reschedule effects (PR-83 integration)
- **Primary requirement:** PR-22
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/deposits/**`, `tests/cashier/deposits.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-075, T-045
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-22 and the money part of PR-83 no-show with DP (DP forfeited) pass; money scenarios 6, 17 pass with gross-DP fixtures: DP moved to balance (VAT reversed, balance gross), spent later, and clinic-caused cash refund, all balanced with no duplicate VAT
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-078: Refunds (balance default, cash exception), receivables and write-offs (UX-14)
- **Primary requirement:** PR-21
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/receivables/**`, `src/app/(app)/piutang/**`, `tests/cashier/receivables.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-077
- **Visual Contract:** Visual contract per `docs/spec/17` UX-14 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** PR-21 refund goes to balance by default and PR-63 Admin Pusat boundary pass; PR-37 owner write-off passes at module level (owner self-approval, mandatory reason, audit; commission exclusion completed in commission); PR-15 receivable conversion passes at module level (full WhatsApp-bill fallback in outbound); money scenarios 9 and 15 and the receivable half of 3 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-079: Consultation fee and free controls
- **Primary requirement:** PR-12
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/consultation/**`, `tests/cashier/consultation.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072, T-078
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-12 and money scenario 4 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-080: Manual discount limits per role and approval
- **Primary requirement:** PR-72
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/discounts/**`, `tests/cashier/discounts.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-72 passes; approver capped by own limit
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-081: Promo codes with atomic quota (BILL-36)
- **Primary requirement:** PR-77
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/promo/**`, `drizzle/**`, `tests/promo/**`, `src/db/schema/index.ts`, `src/modules/promo/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-080
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-77 passes; two concurrent cashiers cannot exceed quota
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-082: Family package sharing switch, beneficiaries, locked reservations
- **Primary requirement:** PR-93
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/packages/sharing/**`, `tests/packages/sharing.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/packages/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-076
- **Visual Contract:** Not applicable
- **Done when:** Scenarios PR-93 (disabled by default, concurrent beneficiaries) pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-083: Reminder-only instalment schedules for packages and receivables
- **Primary requirement:** PR-96
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/packages/schedules/**`, `tests/packages/schedules.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/packages/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-078, T-076
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-96 passes; schedule never unlocks or creates debt
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-084: Expenses and petty cash (posting integrates in M8)
- **Primary requirement:** PR-79
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/expenses/**`, `src/app/(app)/keuangan/biaya/**`, `tests/expenses/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/expenses/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072, T-067
- **Visual Contract:** Visual contract per `docs/spec/17` UX-22 ▸ Biaya; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-79 passes; unpaid expense creates one payable document
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-085: Tutup Kasir (UX-15): any variance → manager approval, above SET-13 → owner
- **Primary requirement:** PR-19
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/cashier/shifts/**`, `src/app/(app)/kasir/tutup/**`, `tests/cashier/shifts.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/cashier/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-072
- **Visual Contract:** Visual contract per `docs/spec/17` UX-15 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Shift close tests: non-zero variance always waits for approval; above threshold escalates
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-086: M4 exit: domain money scenarios 1–9, 11–13, 15–19 (commission M5; journals and scenario 20 M8)
- **Primary requirement:** PR-19
- **Risk Level:** R3
- **Allowed Paths:** `docs/evidence/m4/**`, `STATUS.md`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-073, T-079, T-074, T-078, T-081, T-082, T-083, T-084, T-085
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test -- money` passes for the domain behaviour of money scenarios 1–9, 11–13, 15–19 (commission parts and scenario 14 in M5, journal lines and scenario 20 in M8); independent R3 review recorded
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M5

#### T-087: Commission engine: rules, snapshots, contributions, adjustments, carry-forward, batches, per-recipient export (UX-16)
- **Primary requirement:** PR-23
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/commission/**`, `src/app/(app)/komisi/**`, `drizzle/**`, `tests/commission/**`, `src/db/schema/index.ts`, `src/modules/commission/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-086
- **Visual Contract:** Visual contract per `docs/spec/17` UX-16 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-23, PR-14 commission effect and money scenarios 10 and 14 pass; commission parts of money scenarios 11 and 12 pass; full scenario PR-37 owner write-off passes, including exclusion from commission payment
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-088: BC targets and staff scorecard
- **Primary requirement:** PR-47
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/commission/targets/**`, `tests/commission/targets.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/commission/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-087
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-47 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M6

#### T-089: WABA onboarding state machine (Embedded Signup, BSP fallback), numbers, encrypted PIN, token vault
- **Primary requirement:** PR-27
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/messaging/waba/**`, `drizzle/**`, `tests/messaging/waba.test.ts`, `src/db/schema/index.ts`, `src/modules/messaging/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-032
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-27 passes with recorded fixtures; no live Meta call in tests
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-090: Pesan inbox (UX-17): routing, assignment, 24 h window, templates, raw webhook receipts
- **Primary requirement:** PR-28
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/messaging/inbox/**`, `src/app/(app)/pesan/**`, `tests/messaging/inbox.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/messaging/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-089
- **Visual Contract:** Visual contract per `docs/spec/17` UX-17 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-28 passes; webhook replay fixtures (duplicate, late, out of order, bad signature) pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-091: Complaint flag from inbox messages into Keluhan
- **Primary requirement:** PR-43
- **Risk Level:** R2
- **Allowed Paths:** `src/modules/messaging/inbox/flag.ts`, `tests/messaging/flag.test.ts`
- **Protected Paths:** None
- **Depends On:** T-090, T-057
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-43 inbox flag passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-092: Leads pipeline and source (UX-18)
- **Primary requirement:** PR-29
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/crm/leads/**`, `src/app/(app)/lead/**`, `tests/crm/leads.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/crm/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-090, T-072
- **Visual Contract:** Visual contract per `docs/spec/17` UX-18 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-29 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-093: Follow-up tasks from rules
- **Primary requirement:** PR-30
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/crm/followups/**`, `tests/crm/followups.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/crm/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-092, T-076, T-077
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-30 passes; follow-up tasks for no-shows (PR-83 without and with DP) are created for CS
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-094: Outbound consent, daily budget, no health content in templates
- **Primary requirement:** PR-31
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/messaging/outbound/**`, `tests/messaging/outbound.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `tests/messaging/receivable-fallback.test.ts`, `src/modules/messaging/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-090, T-038, T-078
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-31 passes; scenario PR-4 consent withdrawal passes in full (queued promo not sent, care reminders continue); full scenario PR-15 receivable passes: send the WhatsApp bill through the mock adapter, keep an unpaid visit blocked, then convert to receivable so the bill is settled and the visit can close; the receivable appears at the next visit
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-095: Neutral appointment reminders with Konfirmasi/Ubah Jadwal replies
- **Primary requirement:** PR-69
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/crm/reminders/**`, `tests/crm/reminders.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/crm/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-094, T-045
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-69 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-096: Aftercare via neutral notice and OTP-protected link
- **Primary requirement:** PR-70
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/crm/aftercare/**`, `src/app/(public)/aftercare/**`, `tests/crm/aftercare.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/crm/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-094, T-047, T-053
- **Visual Contract:** Visual contract per `docs/spec/17` UX-51 patient pages (aftercare link); tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-70 passes; WhatsApp text contains no treatment name; scenario PR-56 suspended tenant keeps care messages passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-097: Automation scenarios with occurrences per offset and per-patient cap (UX-55)
- **Primary requirement:** PR-94
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/crm/automation/**`, `src/app/(app)/otomasi/**`, `drizzle/**`, `tests/crm/automation.test.ts`, `src/db/schema/index.ts`, `src/modules/crm/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-095, T-096
- **Visual Contract:** Visual contract per `docs/spec/17` UX-55 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-94 passes; concurrent workers respect the cap
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-098: Satisfaction surveys and review-request rule
- **Primary requirement:** PR-78
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/crm/surveys/**`, `tests/crm/surveys.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/crm/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-097
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-78 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-099: Waitlist and offer on cancellation
- **Primary requirement:** PR-81
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/scheduling/waitlist/**`, `tests/scheduling/waitlist.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/scheduling/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-045
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-81 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-100: Campaigns and segments with sending switched off until Q-15 evidence (UX-19)
- **Primary requirement:** PR-94
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/crm/campaigns/**`, `src/app/(app)/kampanye/**`, `tests/crm/campaigns.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/crm/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-097, T-019
- **Visual Contract:** Visual contract per `docs/spec/17` UX-19 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-94 campaign sending gated passes; segments respect marketing consent
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-101: M6 exit: messaging end to end with recorded fixtures
- **Primary requirement:** PR-28
- **Risk Level:** R2
- **Allowed Paths:** `docs/evidence/m6/**`, `STATUS.md`
- **Protected Paths:** None
- **Depends On:** T-091, T-093, T-098, T-099, T-100, T-088
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test -- m6` passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M7

#### T-102: SATUSEHAT: per-branch credentials, facility-context invariant, identity states, sync ledger, outcome_unknown reconciliation, amendments (UX-23)
- **Primary requirement:** PR-35
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/integrations/satusehat/**`, `src/app/(app)/satusehat/**`, `drizzle/**`, `tests/integrations/satusehat/**`, `src/db/schema/index.ts`, `src/modules/integrations/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-059, T-065
- **Visual Contract:** Visual contract per `docs/spec/17` UX-23 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-35 passes with recorded sandbox fixtures; lost-response and amendment-during-send tests pass; Q-19 official-guide references recorded in the task evidence
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-103: Server-fee billing: fee versions, invoices, proration, AutoLaris attempts and Advice (mock HTTP), waivers, reminders (UX-43, UX-49)
- **Primary requirement:** PR-61
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/vendor/billing/**`, `src/app/vendor/tagihan/**`, `src/app/(app)/saya/tagihan-server/**`, `tests/vendor/billing/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/vendor/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-027
- **Visual Contract:** Visual contract per `docs/spec/17` UX-43, UX-49; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenarios PR-61 (prorata, expired attempt, rc≠00, waiver) pass; no live AutoLaris call in tests; the Advice→paid mapping is a fixture flagged pending Q-13
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M8

#### T-104: Sub-ledgers and roll-forwards (step 1), exports
- **Primary requirement:** PR-25
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/accounting/subledgers/**`, `tests/accounting/subledgers.test.ts`, `src/app/(app)/keuangan/kewajiban/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/accounting/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-086, T-087
- **Visual Contract:** Visual contract per `docs/spec/17` UX-22 ▸ Kewajiban; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-25 passes; roll-forwards reconcile on money fixtures
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-105: Chart of accounts, posting engine from events, periods, statements; journal export gated by posting-map evidence
- **Primary requirement:** PR-26
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/accounting/ledger/**`, `drizzle/**`, `tests/accounting/ledger.test.ts`, `src/app/(app)/keuangan/buku-besar/**`, `src/db/schema/index.ts`, `src/modules/accounting/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-104, T-084, T-067
- **Visual Contract:** Visual contract per `docs/spec/17` UX-22 ▸ Buku Besar; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-26 passes; every fixture posting matches the money fixture document; export refused without evidence; every money scenario 1–20 posts the journal lines of the fixture document; scenario 20 runs with a synthetic gateway settlement posted directly (clearing ends at zero, fee is expense); posting triggers post each economic fact once
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-106: Coretax XML export for PKP tenants, gated
- **Primary requirement:** PR-98
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/accounting/coretax/**`, `tests/accounting/coretax.test.ts`, `src/app/(app)/keuangan/pajak/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/accounting/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-105
- **Visual Contract:** Visual contract per `docs/spec/17` UX-22 ▸ Pajak; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-98 passes; XML validates against the published schema fixture
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-107: Dashboard read models, drill-down and per-role homes (UX-60: Klinis, Marketing, Apotek, Pembelian, Audit, Ruang Saya), K1–K19 computed from fixtures
- **Primary requirement:** PR-33
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/reporting/dashboards/**`, `tests/reporting/dashboards.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/app/(app)/ringkasan/peran/**`, `tests/ui/ringkasan-peran.spec.ts`, `src/modules/reporting/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-104, T-101
- **Visual Contract:** Visual contract per `docs/spec/17` UX-60 and `docs/spec/19` §2.1; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33 passes; K1–K19 equal fixture expectations; no clinical content in any dashboard payload; browser check of each UX-60 home
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-108: Reconciliation report KPI vs ledger
- **Primary requirement:** PR-34
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/accounting/recon/**`, `tests/accounting/recon.test.ts`, `src/app/(app)/keuangan/rekon/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/accounting/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-105, T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-22 ▸ Rekon; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-34 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-109: Ringkasan Owner and Cabang league (PR-33a)
- **Primary requirement:** PR-33
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/ringkasan/owner/**`, `tests/reporting/pr-33a.test.ts`
- **Protected Paths:** None
- **Depends On:** T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-20, UX-37 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33a passes; browser check UX-20, UX-37
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-110: Ringkasan Cabang (manager) (PR-33b)
- **Primary requirement:** PR-33
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/ringkasan/cabang/**`, `tests/reporting/pr-33b.test.ts`
- **Protected Paths:** None
- **Depends On:** T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-21 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33b passes; browser check UX-21
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-111: FO shift summary on Hari Ini (PR-33c)
- **Primary requirement:** PR-33
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/hari-ini/ringkasan/**`, `tests/reporting/pr-33c.test.ts`
- **Protected Paths:** None
- **Depends On:** T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-6 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33c passes; browser check UX-6
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-112: Pasienku (BC home) (PR-33d)
- **Primary requirement:** PR-33
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/pasienku/**`, `tests/reporting/pr-33d.test.ts`
- **Protected Paths:** None
- **Depends On:** T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-35 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33d passes; browser check UX-35
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-113: Ringkasan CS (PR-33e)
- **Primary requirement:** PR-33
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/ringkasan/cs/**`, `tests/reporting/pr-33e.test.ts`
- **Protected Paths:** None
- **Depends On:** T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-36 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33e passes; browser check UX-36
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-114: Ringkasan Keuangan (PR-33f)
- **Primary requirement:** PR-33
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(app)/keuangan/ringkasan/**`, `tests/reporting/pr-33f.test.ts`
- **Protected Paths:** None
- **Depends On:** T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-22 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33f passes; browser check UX-22
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-115: Admin Pusat home (UX-57, PR-33g)
- **Primary requirement:** PR-33
- **Risk Level:** R1
- **Allowed Paths:** `src/app/(app)/ringkasan/admin-pusat/**`, `tests/reporting/admin-pusat.test.ts`
- **Protected Paths:** None
- **Depends On:** T-109
- **Visual Contract:** Visual contract per `docs/spec/17` UX-57 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-33g passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-116: Reports and KPI dictionary K1–K27 (UX-38, UX-59)
- **Primary requirement:** PR-95
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/reporting/reports/**`, `src/app/(app)/laporan/**`, `tests/reporting/reports.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/reporting/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-107
- **Visual Contract:** Visual contract per `docs/spec/17` UX-38, UX-59 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-95 passes; each K20–K27 value equals its fixture
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-117: Owner daily digest
- **Primary requirement:** PR-80
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/reporting/digest/**`, `tests/reporting/digest.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/reporting/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-116
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-80 passes; digest contains no patient names
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-118: Vendor platform health (UX-45)
- **Primary requirement:** PR-62
- **Risk Level:** R3
- **Allowed Paths:** `src/app/vendor/kesehatan/**`, `tests/vendor/health.test.ts`, `drizzle/**`, `src/db/schema/index.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-103
- **Visual Contract:** Visual contract per `docs/spec/17` UX-45; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-62 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-119: M8 exit: ledger reconciles to sub-ledgers on fixtures; Phase 1 demo walkthrough J1–J8, J10
- **Primary requirement:** PR-26
- **Risk Level:** R3
- **Allowed Paths:** `docs/evidence/m8/**`, `STATUS.md`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-106, T-108, T-115, T-117, T-118, T-102, T-109, T-110, T-111, T-112, T-113, T-114
- **Visual Contract:** Not applicable
- **Done when:** `pnpm test -- m8` passes; owner walkthrough recorded
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

### Milestone M9

#### T-120: Residency configuration and real-patient gate (ARCH-10) bound to compliance evidence
- **Primary requirement:** PR-36
- **Risk Level:** R4
- **Allowed Paths:** `src/modules/platform/residency/**`, `tests/platform/residency.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/platform/schema.ts`
- **Protected Paths:** `src/modules/platform/**`
- **Depends On:** T-119
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-36 passes; patient creation and imports refused while evidence is missing
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-121: Data-subject requests (UX-30) linked to the privacy workspace
- **Primary requirement:** PR-50
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/privacy/requests/**`, `tests/privacy/requests.test.ts`, `src/app/(app)/privasi/permintaan/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/privacy/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-119
- **Visual Contract:** Visual contract per `docs/spec/17` UX-30; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-50 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-122: Tenant export job with manifest and 24 h expiry (UX-32)
- **Primary requirement:** PR-52
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/export/**`, `tests/export/**`, `src/app/(app)/ekspor/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/export/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-119
- **Visual Contract:** Visual contract per `docs/spec/17` UX-32; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-52 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-123: Public site generator and Situs Klinik admin (UX-50, UX-51)
- **Primary requirement:** PR-64
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/public-site/**`, `src/app/(public)/[slug]/**`, `src/app/(app)/situs/**`, `tests/public/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/public-site/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-119
- **Visual Contract:** Visual contract per `docs/spec/17` UX-50, UX-51 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-64 passes; listing half of scenario PR-2 passes; publish refused while the Q-15 counsel evidence (PR-97) is unapproved
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-124: Treatment page rules (Permenkes 1787/2010): no discount, no superlatives, reviewed text, price only when published
- **Primary requirement:** PR-65
- **Risk Level:** R2
- **Allowed Paths:** `src/modules/public-site/rules/**`, `tests/public/rules.test.ts`
- **Protected Paths:** None
- **Depends On:** T-123
- **Visual Contract:** Not applicable
- **Done when:** Scenarios PR-65 pass
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-125: Doctor listing with consent and immediate purge on withdrawal
- **Primary requirement:** PR-66
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/public-site/doctors/**`, `tests/public/doctors.test.ts`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/public-site/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-123
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-66 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-126: Booking with context from public pages, WhatsApp source tag, closed tenants reveal nothing (UX-24)
- **Primary requirement:** PR-67
- **Risk Level:** R3
- **Allowed Paths:** `src/app/(public)/[slug]/booking/**`, `tests/public/booking.spec.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-123, T-044
- **Visual Contract:** Visual contract per `docs/spec/17` UX-24 and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-67 passes
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-127: Public pixel policy: none on health-intent routes; consented pixels on home and branch only
- **Primary requirement:** PR-39
- **Risk Level:** R2
- **Allowed Paths:** `src/app/(public)/**`, `tests/public/pixels.spec.ts`
- **Protected Paths:** None
- **Depends On:** T-123
- **Visual Contract:** Visual contract per `docs/spec/17` UX-51 (consent banner only); tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenarios PR-39 pass with a network capture
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-128: Opening-data import: batches, dry-run, source-ID map, opening sub-ledgers, owner approval (DATA-58)
- **Primary requirement:** PR-85
- **Risk Level:** R3
- **Allowed Paths:** `src/modules/import/**`, `tests/import/**`, `drizzle/**`, `src/db/schema/index.ts`, `src/modules/import/schema.ts`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-120
- **Visual Contract:** Not applicable
- **Done when:** Scenario PR-85 import dry-run passes; synthetic Numa-shaped file reconciles; re-import creates no duplicates; each imported opening liability and receivable reconciles to its balanced OpeningImportApplied journal in `11`, with no new revenue, VAT or commission
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-129: Vendor console complete tree and public site page set (19 §3–§4)
- **Primary requirement:** PR-87
- **Risk Level:** R1
- **Allowed Paths:** `src/app/vendor/**`, `tests/vendor/tree.spec.ts`, `tests/public/tree.spec.ts`
- **Protected Paths:** None
- **Depends On:** T-118, T-123
- **Visual Contract:** Visual contract per `docs/spec/19` §3–§4; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** Scenario PR-87 passes; the public page set of `19` §4 is checked read-only by `tests/public/tree.spec.ts` (public pages are built in the public-site tasks)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-130: Navigation sweep: every `19` §2 page renders for its allowed roles and is absent for the others
- **Primary requirement:** PR-86
- **Risk Level:** R2
- **Allowed Paths:** `tests/ui/nav-sweep.spec.ts`
- **Protected Paths:** None
- **Depends On:** T-129, T-126, T-122, T-121
- **Visual Contract:** Visual contract per `docs/spec/19` §2; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7.
- **Done when:** `pnpm test:ui -- nav-sweep` passes for every role in the `07` matrix at 390 and 1440 (verification only: a missing page is a defect in its builder task, not built here)
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`

#### T-131: M9 exit checklist: restore drill, residency gate, browser sweep, security review, J9 and J11 walkthroughs
- **Primary requirement:** PR-59
- **Risk Level:** R4
- **Allowed Paths:** `docs/evidence/m9/**`, `STATUS.md`, `RELEASE.md`
- **Protected Paths:** `drizzle/**`, `src/db/rls/**`
- **Depends On:** T-127, T-121, T-122, T-124, T-125, T-126, T-128, T-129, T-130
- **Visual Contract:** Not applicable
- **Done when:** Every item of the PLAN M9 checklist has evidence; NFR-1–NFR-8 probes recorded; independent R4 review recorded
- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data
- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`
