# Status — clinic-dashboard

Updated: 2026-11-02
Status: Active
State: INTEGRATING
Review-Risk: R3
Independent-Review: PASS
Primary-Worker: pi (9router-fantastico/cc/claude-opus-5-5)
Independent-Reviewer: claude-code 2.1.316 (claude-opus-5-5, separate context)
Independent-Review-Head: UNSET

## Delivery state machine

Allowed forward path:

`PLANNED -> READY -> IMPLEMENTING -> VERIFYING -> REVIEWING -> INTEGRATING -> PRODUCTION_READY -> AWAITING_DEPLOY_APPROVAL -> DEPLOYED -> SMOKE_TESTING -> VERIFIED`

Use `BLOCKED` only as an interruption state. Record the blocker and exact state to resume. Do not skip verification/review/integration states. `production-gate` proves the transition from `INTEGRATING` to `PRODUCTION_READY`; it never deploys.

`RELEASE.md` owns release-specific truth: release ID, base, declared risk, rollback reference/command, backup proof, and readiness status. `Review-Risk` is the highest semantic risk found during review. `production-gate` computes effective release risk as max(`RELEASE.md` Declared-Risk, deterministic `diff-risk`, `Review-Risk`). R3/R4 require `Independent-Review: PASS`, a reviewer distinct from `Primary-Worker`, and `Independent-Review-Head` bound to the reviewed release content. Only review-attestation files may change after that commit.

`OBSERVABILITY.md` owns post-deploy verification probes. After deployment, transition to `SMOKE_TESTING` and run `release-check`. Every configured observability probe must pass before transition to `VERIFIED`.

## Current state

M0 in progress. Owner instruction 2026-11-02: run tasks in order, independent review after each task, local commit per task; push only on explicit approval (not yet given, so no CI run exists).

| Task | Result | Commit |
|---|---|---|
| T-001 repository bootstrap | PASS locally; review APPROVE; CI proof pending push | `862307d` |
| T-002 database core | PASS; R3 review APPROVE after fixes | `60a4498`, `b08bc75` |
| T-003 RLS harness | PASS; R4 review APPROVE (claude-code and codex, four rounds) | `98067c6` |
| T-004 isolation CI gates | PASS; R3 review APPROVE after two rounds of fixes | `a4460bb` |
| T-005 platform basics | PASS; R4 review APPROVE (claude-code and codex, two rounds) | `9026b87` |
| T-006 staff authentication | PASS; R4 review APPROVE (claude-code and codex) | `42edaf2` |
| HYG-001 hygiene (owner option A) | PASS; R4 review APPROVE (claude-code and codex, two rounds) | `6600db0` |
| T-007 identity chain | PASS; R4 review APPROVE (claude-code and codex, two rounds) | this commit |

Built so far: see `DECISIONS.md` DEC-005 (toolchain), DEC-006 (database core), DEC-007 (RLS foundation), DEC-008 (isolation gate), DEC-009 (keys, hosts, backups), DEC-010 (staff authentication), DEC-011 (migrations) and DEC-012 (identity chain); `ARCHITECTURE.md` is updated when runtime behaviour exists.

## Active work

None between tasks. Next: T-008 (audit attribution and log, R3).

Carried forward (outside the owning task's Allowed Paths):
- Copy `public/` into the runtime image once it exists; upgrade Next.js to 16.4.4 after `minimumReleaseAge`.
- TEN-4 (tenant keys in caches; lint against tenant-less `"use cache"`, `cacheTag`/`cacheLife`, `unstable_cache`, cached `fetch`; dynamic `(app)`/vendor/API routes) has no owning task in `TASKS.md`; owner to assign before the first cached page.
- Isolation lint gaps to close later: env lookups such as `process.env.<TENANT>`, identity props `tenant.id`/`brand`/`host`, map lookups keyed by tenant, and a grep for tenant literals outside `src/` (scripts, seeds, config).
- When `src/proxy.ts` starts reading tenant data (e.g. slug → tenant), add it to the isolation gate (DEC-009).
- The clinic layout and API (T-013 shell, T-030 context) must call `checkSession` and `resolveContext` on every request so the TOTP, idle-lock and branch-scope gates apply to real pages; T-007 provides both (RoleSource is wired). No clinic page exists yet.
- Playwright is not a project dependency yet (T-011): `tests/ui/auth-screens.mjs` runs with `PLAYWRIGHT_CORE` pointing at an installed playwright-core.
- Better Auth needs the client IP from the trusted proxy (`x-real-ip` from Traefik) in production, or its per-IP limiter falls back to one shared bucket; set at deploy.
- T-022 invitations: require TOTP enrolment while accepting an invitation for a TOTP role (otherwise anyone with the password can enrol first). Background/polling requests must call `checkSession(..., { activity: false })` (T-007/T-013) or the idle lock never fires. RATE-2 lets anyone lock an FO account by email (spec consequence; RUNBOOK).
- T-006/T-021: Server Actions are resolved by action id regardless of path; every action must authorize itself, and the booking host should refuse `Next-Action` requests outside an allow-list.
- pgBackRest: schedule `stanza-create`, full/diff backups and monitoring in the deploy task; without a stanza `archive_command` keeps failing and `pg_wal` grows.
- KEK custody vs ARCH-7 wording: a root:0400 host file bind-mounted into a non-root container is unreadable and fails the owner check (fail-closed). The deploy task must pick one model (host file owned by the app uid at 0400 and ARCH-7 reworded, or a root helper passing the key) before first start.
- Field ciphertexts bind tenant, purpose and DEK version, not the row: add an optional row id to the AAD when the patient table first stores NIK (T-037) so values cannot be swapped between rows.
- Public site task: upper-case slugs 404 on the booking host (slugs are lower-case); decide whether to redirect.
- Production: create the KEK file (0400, owned by the app user) and its offline escrow (ARCH-7); configure the pgBackRest S3 repository in a second location (H-07); schedule full/diff backups and quarterly drills (DR-2).
- Release task: push the image to a registry and record the manifest digest (`packages: write` for GHCR); the CI record is a build attestation until then.

- Owner decision (from T-007 review): 05 §2.1 level table says facility head and records officer are Level 2, IAM-8 says branch set; implemented as Level 3 (DEC-012). Confirm with Q-12 and correct the table.
- T-007 follow-ups: `account_memberships` ignores tenant lifecycle (suspended/closed tenants still resolve; lifecycle task T-023); role lists exist in SQL (0007, 0009) and TS (`LEVEL2_ROLES`) — add a catalog test when roles change; the contract checker should require NOT NULL (or MATCH FULL) source columns on FKs wider than (tenant_id, id) before a nullable wide FK appears; role revocation needs an effective-dated design (T-031); the RoleSource pool can share the app pool once T-030 exists.

## Blockers

None for M0. Later gates: Q-12 (Numa job validation; PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83), G2 (H-02d, Q-08, Q-10, Q-11, Q-15, Q-17, R-01), G3 (Q-05, Q-06). See `docs/spec/02-PRD.md` §13 and `PLAN.md`.

## Verification evidence

- 2026-11-02 T-007: 19 identity tests on PostgreSQL 16.15 (membership_id NOT NULL UNIQUE; one membership per account per tenant; staff tenant = membership tenant; atomic creation; another tenant's branch refused by FK, also when written directly; branch scope cannot claim another staff/role; Level 2 stores no branches and sees a branch created later; Level 3 scope per acting role; client selectors validated with one message; ended memberships give nothing; acting role and staff recorded from the server-side context, forged role/staff/tenant/branch refused; cross-tenant reads empty; clinic_app cannot write identity tables; account_memberships returns only the requested account; TOTP gate driven by a real doctor membership); mutations of the insert policy and the Level 2 wildcard fail their tests.
- 2026-11-02 HYG-001 (owner option A): `.dockerignore` allow-list with recursive re-excludes (nested `.env`/`.pem`/`node_modules` probe: none in the context); release image runs migrations (`tests/platform/image-migrate.sh`: 6 migrations on an empty database, non-root, migration files read-only, no `.env*` anywhere); `assertAppRole` refuses any effective TEMPORARY, incl. via PUBLIC (tests + mutation); the migration runner refuses drift (an applied migration edited later, or an unapplied one older than the newest applied), the root cause of the local database still granting PUBLIC CONNECT/TEMPORARY after 0003 was edited during T-003 review (local synthetic database recreated); HTTP host test serves a copied standalone build so a concurrent build cannot break it; root layout `lang="id"`, real title, light only (noindex stays on the auth layout); CI runs the restore drill and the image check. Full CI step sequence simulated locally (incl. drill) PASS; browser re-check of the auth screens (32 layouts, full flow) PASS.
- 2026-11-02 T-006: 43 auth tests on PostgreSQL 16.15 as `clinic_auth` (PR-3 scenario; TOTP for each of the 9 IAM-1 roles and not for the other 7; RATE-2 lockout across IPs and its expiry; 120 s idle lock, server-side, password unlock; no plaintext secrets; role separation); concurrency (12 parallel wrong passwords → exactly 5 checked), progressive delay, trust-device refusal, locked/enrolment-gated endpoints; mutations (drop a TOTP role, disable lockout, change idle time, remove the advisory lock, allow trustDevice, drop the session-lock hook, zero the delay) each fail their tests. Browser (standalone build, Chromium 1248) at 390/820/1180/1440 and 200% text: no horizontal overflow, targets ≥ 44 px, all controls named, `lang=id`; flow wrong password → sign-in → enrol TOTP → sign-in asks for code → wrong code → verify → keyboard tab order → unlock wrong/right.
- 2026-11-02 T-005: restore drill PASSED (25 tenants before the full backup, 10 after, restored 35/105 branches/4 migrations via WAL replay; with replay disabled the drill fails 25 vs 35); envelope round-trip, tenant/purpose binding, tamper, KEK and DEK rotation, blind index and KEK-file custody tests; host resolver unit tests and HTTP negatives against `next start` (`/saya`, `/persetujuan` refused on booking and vendor hosts; public routes refused on the app host; vendor routes refused on every non-vendor host); disabling the proxy check fails 4 HTTP tests.
- 2026-11-02 T-004: `pnpm test:isolation` failed (exit 1) on a real untested page `src/app/(app)/probe-untested` and passed after removal; probe cases proved the harness fails an empty case (positive control) and a leaking case, and passes a filtered list case; lint rule tests (slug, brand in template/JSX, UUID, three branching forms, no false positives, not applied outside `src/`); full CI step sequence simulated locally with `CI=1`; actionlint clean.
- 2026-11-02 T-003: 56 tests on PostgreSQL 16.15 (40 RLS: startup refusal per unsafe role shape, scope map incl. views/matviews, no app access to platform tables or definer functions, cross-tenant not-found, fail-closed without context, concurrency, nesting, dead-connection handling); mutation of each control fails its test; typecheck, lint, build, docs:check, drizzle-kit check PASS (`.delivery/`).
- 2026-11-02 T-002: fresh database migrate, 16 tests on PostgreSQL 16.15 (contract checker with a negative fixture per rule; advisory-lock test fails 3/3 with the lock removed), `drizzle-kit check`, typecheck, lint, build, docs:check — all PASS (`.delivery/`).
- 2026-11-02 T-001 (Node 26.13.0, clean `node_modules` and `.next`): install --frozen-lockfile, typecheck (`next typegen && tsc`), lint, build, `pnpm audit --prod`, docs:check (24 files, 653 declarations, 131 tasks, 0 findings), docs:promotion, actionlint, Docker image (HTTP 200, uid 1000), compose PostgreSQL 16.15 — all PASS, recorded as executed checks in `.delivery/`. CI run: pending push.

- 2026-11-02 `project-check --full`: lint, build and delivery contract passed (bootstrap).
- 2026-11-02 `pnpm docs:check`: PASS, 24 spec files, 653 declarations, 131 tasks, 0 findings.
- 2026-11-02 round 7 review (GPT-6 Astra route) applied; `pnpm docs:check` PASS, `project-check --full` VERIFIED.
- 2026-11-02 closure review and follow-up confirmation: all F1–F9 CLOSED as specification defects; final APPROVE (`docs/research/reviews/round7-closure-final-astra.md`). Generator reproduced byte-for-byte; 131 tasks, no forward dependencies, UI contracts and migration/schema-permission invariants checked. T-001 remains unstarted.

## Next verified action

Start T-008 (audit attribution and log: DATA-60 fields server-side, hash chain per tenant, write-once copy, Log Audit read API). R3: independent review before integration.
