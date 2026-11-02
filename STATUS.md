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
| T-007 identity chain | PASS; R4 review APPROVE (claude-code and codex, two rounds) | `724aafc` |
| T-008 audit log | PASS; R3 review APPROVE (claude-code, two rounds) | `a2ab885` |
| T-012 design tokens and base components | PASS; review APPROVE (claude-code, three rounds) | `427056f` |
| T-029 role-aware readers and role administration | PASS; R4 review APPROVE (claude-code and codex, three rounds) | this commit |

Built so far: see `DECISIONS.md` DEC-005 (toolchain), DEC-006 (database core), DEC-007 (RLS foundation), DEC-008 (isolation gate), DEC-009 (keys, hosts, backups), DEC-010 (staff authentication), DEC-011 (migrations), DEC-012 (identity chain), DEC-013 (audit), DEC-014 (design system) and DEC-015 (role readers); `ARCHITECTURE.md` is updated when runtime behaviour exists.

## Active work

Wave plan (owner 2026-11-02): waves 1–9 of M0 run back to back, each task reviewed and fixed before the next, local commits only, no push. Wave 1: T-008 ✓, T-012 ✓, T-029 ✓ (wave gate pending).

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

- T-008 follow-ups: Log Audit page still lacks the UX-31 actor, object and vendor-session filters (the API has them) and Ekspor (T-031/UX-32); role lists duplicated in SQL; `audit_verify` is O(n) per page load (cache the last verified seq when logs grow); the per-tenant advisory lock serialises audited actions of one tenant until commit. Deploy task must schedule the audit copy (`dailyCopy` as the migration owner) to a create-only Object Lock bucket and prove compliance-mode retention (Vultr's S3 matrix does not list Object Lock); alerting on `AuditChainBrokenError` (OBS); pgaudit for break-glass statements (SEC-5) belongs to the database deploy; the `/audit` page reads tenant and role from the query string until T-030's context switcher; vendor session attribution arrives with T-025.
- Local leftover: `/data/tmp/cd-ui` (45 MB copy of a standalone build, no secrets) from the T-008 browser check could not be removed by the agent (safety net blocks `rm -r` outside the repository); safe to delete by hand.

- DESIGN.md corrections (owner/design): add the derived `--danger-pressed` #FBE2DF (destructive hover, 4.65:1) to the colour table; label on grouped is 18.82:1 (table says 18.9) and label-2 on tint-soft is 5.05:1 (label-2 row says 5.18; tint-soft row already says 5.05). `cn@0.5.1` provenance verified (SLSA build from github.com/shadcn-ui/cn release workflow).
- T-012 follow-ups: the auth and audit screens still use their own CSS modules with literal DESIGN.md values; move them onto the tokens when T-013 builds the shell. Remaining core components (TabBar/Sidebar, LargeTitleHeader, InsetGroupedList, SegmentedControl, SearchField) arrive with T-013/T-014. Drawer detents (medium/large) are set per sheet via vaul `snapPoints` when a sheet needs them.

- Owner decision (from T-029 review): IAM-11 says assigning Owner/Admin Pusat/Finance/Facility head/Records officer/Auditor "needs owner approval (requester ≠ approver)". Implemented: requests from Admin Pusat wait for an Owner; an assignment made by an Owner applies directly (otherwise a one-owner clinic could never assign them). Confirm or require a second approver.
- T-029 follow-ups: row visibility is tested per role × existing table; column projections (auditor/purchasing masking) arrive with their tables; staff names for FO/CS/BC/auditor screens will need a name-only projection (definer view) in the tasks that show them; PR-63's other scenario ("Admin Pusat cannot approve a cash refund") belongs to the approvals task (T-011) and the money tasks; Marketing patient view via consent, auditor/purchasing masked projections and purpose-bound clinical reads arrive with their tables; role revocation (`change = revoke`) has no function yet (T-031); review minors: approval does not re-check the requester still holds Admin Pusat, a no-op approval (role granted meanwhile) reports approved, and the subject-membership check at approval is not row-locked (T-031); the data-protection duty for Admin Pusat's audit access arrives with duties (T-031).

## Blockers

None for M0. Later gates: Q-12 (Numa job validation; PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83), G2 (H-02d, Q-08, Q-10, Q-11, Q-15, Q-17, R-01), G3 (Q-05, Q-06). See `docs/spec/02-PRD.md` §13 and `PLAN.md`.

## Verification evidence

- 2026-11-02 T-029: 49 reader tests generated from the 07 matrix (each of 16 roles sees others' rows exactly in the tables its capabilities give it; every member sees its own identity rows; Admin Pusat has no audit access without the duty; readers.sql = migration 0013); PR-63 (Admin Pusat's Owner grant is pending and inactive until an Owner approves; every Level 2 role and Facility head/Records officer pending from Admin Pusat, Level 3 direct; an Owner's assignment applies directly; context actions and requests visible only to staff readers, requester and subject; one pending request per staff/role (unique index, concurrent requests tested); ended or future memberships refused; approval refused once the subject has left; owner cannot approve own request; only an Owner decides; decided requests are final; nobody changes their own role set; other roles cannot assign; no direct writes; another tenant's staff cannot be targeted; every step audited); mutations (open staff readers, direct Owner grant, self-approval, own role set, Level 2 direct by Admin Pusat, open org_actions, approval after the subject left, future membership, dropped pending index) fail tests.
- 2026-11-02 T-012: 108 token tests (every UI-1 pair at its floor, stated DESIGN.md ratios, tokens.css = tokens.ts = DESIGN.md, light only, no bundled fonts; every ratio DESIGN.md states, no hex literals in components, balanced CSS braces, destructive hover ≥ 4.5, DESIGN.md table values per token, hover tint never lighter, no blur or looping animation in components; UI-2 compares exact ratios (#0172A0 at 4.4985 rejected), rejects failing and near-miss hexes with a passing suggestion, refuses malformed input); `/dev/galeri` refused in production (unit + HTTP). Browser (`next dev`) at 390/820/1180/1440 and 200%: no overflow, targets ≥ 44 px, primary 50 px, capsule buttons, system font at 17 px, badges with icon and word, no hydration errors; sheet opens by keyboard, closes with Escape and returns focus; accent validation message with ratios and suggestion; hover darkens the tint; overlay without blur; sheet open animation 0.3 s on the DESIGN.md curve and close measured at 300 ms; reduced motion = 0.2 s cross-fade, no slide.
- 2026-11-02 T-008: 23 audit tests (PR-51 break-glass with reason and time in the owner's log; ≥ 15-char reason only for break-glass; attribution from context incl. account and membership; no actor arguments; forged role/branch refused; no direct writes and append-only even for the owner; an audited action fails with its transaction; per-tenant chain under concurrency; tampering and deletion detected at the row; verify only for the bound tenant and log readers; reader scope per role; auditor masked; filters; cross-tenant empty; no free-text columns but the reason; copy by seq with late commits, rows recomputable from the copy, a DBA who deletes and re-chains caught by the anchor check, a broken tenant or a failed store write does not stop the others; Level 3 must bind a branch so the facility head sees it; canonical form covers every column); mutations (hash check, update trigger, role check, branch scope) fail tests; isolation case for `/audit` with positive control; browser (standalone build) at 390/820/1180/1440 and 200%: sign-in → owner TOTP enrolment gate → log with break-glass reason and time → filter → filtered-empty → permission message for a non-reader role, an unheld role and a foreign tenant.
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

Wave 1 gate (CI simulation), then wave 2: T-009 (idempotency, R3), T-013 (app shell, R2), T-018 (vendor profile, R3).
