# Build Log — clinic-dashboard

Record only durable implementation changes, validation evidence, and gotchas that the next maintainer needs. Temporary task narration belongs in neither this file nor global memory.

## 2026-11-02 — Development contract initialized

- Added repository-local project context files.
- Bootstrap source state: native generator: create-next-app@latest.
- Selected stack: `Next.js (App Router, TypeScript)`; database: `postgres`; authentication:
  `better-auth`; deployment target: `coolify`.
- Capability selections are not operational claims. Their implementation and
  verification remain future requirement-linked work.

## 2026-11-02 — Specification pack promoted (kit v0.7)

- Development authorized (P-27). `docs/spec/` comes from the kit v0.7 after six multi-model review rounds; the reports are in `docs/research/reviews/`.
- Research and review evidence consolidated into `docs/research/` (240 MB of captures included). The old planning folder was moved to `/data/backups/clinic-dashboard-kit/kit-v0.7-planning-snapshot`.
- `AGENTS-DRAFT.md` was merged into `AGENTS.md`. `DESIGN.md` moved to the root, and the brief to `design/brief.md`.
- Added `pnpm docs:check` (a pinned copy of the traceability checker in `scripts/`) and `pnpm typecheck`.
- Gotcha: the checker's ID regex rejects lowercase suffixes. For that reason, tasks cite PR-33 as the primary requirement for PR-33a–g.
- Gotcha: `docs/research/bundles/` holds about 89 MB of captured third-party JS. ESLint ran out of memory scanning it (exit 134), so `docs/research/**` is excluded in `eslint.config.mjs` and `tsconfig.json`.

## 2026-11-02 — Round 7 confirmation review applied

- GPT-6 Astra: READY-WITH-FIXES, no P1. Fixes cover the posting triggers and tax-point guard, TD ownership, early-scenario splits, persistence owners and host enforcement in `src/proxy.ts`. Summary: `docs/research/reviews/round7-SUMMARY.md`.
- Gotcha: Next.js 16 renamed `middleware.ts` to `proxy.ts` (see `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`).
- Evidence: `pnpm docs:check` PASS (131 tasks, 0 findings); `project-check --full` VERIFIED.

## 2026-11-02 — Pre-development closure confirmed

- Independent closure review exposed F1–F9; fixes were applied to the specification and task generator, not application code. A second review closed eight findings; the final schema-permission confirmation closed F4. Combined verdict: APPROVE, all F1–F9 CLOSED as specification defects.
- Reports and actual route/provenance limitations: `docs/research/reviews/round7-closure-SUMMARY.md` and its linked reports.
- Executed: docs traceability PASS (131 tasks, 0 findings); isolated generator reproduction identical; static checks PASS for dependency order, UI contracts, migration risks and canonical schema permissions; project-check full VERIFIED (types/lint/build); dotuiux validation PASSED with direction-selection/composition warnings deferred to UI work; delivery-ledger VERIFIED READY.
- No feature development, provider call, provisioning or deployment. T-001 remains next and unstarted.

## 2026-11-02 → 2026-11-04 — M0 foundation built (T-001–T-026 except T-027–T-028, T-032; HYG-001–003)

Per-task evidence lives in `STATUS.md` (Verification evidence), plans in `docs/tasks/`, decisions in `DECISIONS.md` (DEC-005–DEC-037), ledger runs in `.delivery/`. Pushed waves are green in GitHub Actions (latest wave 7a: run 41668902765).

- Built: repository/CI/Docker, database core with RLS and scope map, isolation gates, platform basics (keys, hosts, backup drill), staff auth with TOTP and lockout, identity chain, audit chain, idempotency, events outbox, approvals and inbox, notifications, settings registry, compliance register, design tokens and templates, clinic shell and context switching, staff and access, vendor staff with maker-checker, vendor console host, tenant lifecycle, tenant provisioning with first-owner invitation, Profil & Keamanan, vendor bootstrap command and Tim Vendor, onboarding grant, support sessions with Owner approval and read audit.
- Review practice: every R3/R4 task independently reviewed until APPROVE (codex; claude for R4, through 9Router when the claude CLI hit its weekly limit); key controls mutation-tested; UI tasks with browser evidence at 390/820/1180/1440 and 200% text.

### Gotchas worth keeping

- PL/pgSQL: an `IF … CASE … END THEN` needs the CASE in parentheses.
- `now()` is the transaction start: validity checks that may run after a lock wait use `clock_timestamp()`, and judge after the lock (`FOR SHARE` predicates are not re-evaluated for elapsed time) — T-024.
- A `RAISE` rolls back an `UPDATE` done just before it in the same statement: close records in the transaction that causes the closure (trigger), not in the refusal path — T-023.
- Per-tenant lock order (T-024): session check → `staff_access` advisory lock → tenant row → grant row → audit lock. Every path that logs a refusal for a tenant takes `staff_access` first.
- Two branches created in the same millisecond have UUIDv7 ids in random order; never rely on "first branch by id" in a test — T-030 flaky test fixed in `a755508`.
- `vendor_log` with a tenant writes the tenant audit chain: its `reason_code` must fit `^[a-z][a-z_]{1,40}$`, or the whole call rolls back and the refusal leaves no trace — T-024.
- Next 16 keeps the previous route mounted (hidden) for back/forward: Playwright locators need `main:visible`.
- Better Auth rate limits `/change-password` and sign-in to 3 per 10 s per address; UI specs use a distinct `x-real-ip` per person.
- A killed mutation run can leave a mutant in place: compare the mutated file with a known-good copy after every run.
- ESLint must ignore `.pi/**` (local agent scratch, git-excluded).
- Never run PostgreSQL as PID 1 in a container: it reaps every orphan in the namespace and crash-recovers the whole cluster when one exits with a status other than 0/1. A timed-out Docker healthcheck leaves exactly such an orphan (`sh -c pg_isready`: on timeout the probe's `sh` disappears, its `pg_isready` is adopted and exits 2; reproduced on Docker 29.9.2), as do pgBackRest's async workers. Use `init: true` / `--init` or tini in the image (HYG-005); prove a crash with the log lines, not `pg_postmaster_start_time()` (crash recovery keeps the postmaster). To freeze a PID-1 process for a test, signal it from the host (`docker kill -s SIGSTOP`); a signal sent from inside the namespace to its init is dropped.
- A hook timeout fails a file whose tests all passed: integration `afterAll` hooks drop a database and roles, which can exceed vitest's 10 s default when the full suite loads the host. `vitest.config.mts` sets `hookTimeout: 120_000` (HYG-004); test bodies keep their own limits.
- RLS revocation needs READ COMMITTED: a REPEATABLE READ/SERIALIZABLE reader judges the session, staff and login rows from its snapshot, so a predicate that reads them misses an end or a sign-out. Check `transaction_isolation` at bind — T-025.
- Anything an RLS policy writes (read records) and anything logged inside the reader's transaction disappears on its ROLLBACK. For a durable trace, commit it from another connection first and bind it to the reader's `(pg_backend_pid(), txid_current())`; txids (with epoch) are never reused. Verify a caller-supplied pair against `pg_locks` (`transactionid`, granted, that pid) — T-025.
- An RLS policy runs before non-leakproof user filters, LIMIT, joins and aggregates: a per-row side effect in a policy sees a superset of the returned rows — T-025.
- Never write the tenant audit chain from a long-lived read transaction: `vendor_log` with a tenant takes the per-tenant audit lock until commit — T-025.
- An audit listing must not filter on the current state of the audited object: a real read whose row was deleted later disappears. List everything and flag it (`row_found`) — T-026.
- Paginate the whole answer, not one array of it: any part a third party can grow (refused attempts) is an amplification vector — T-026.
- `audit_events.reason` is reserved for break-glass (CHECK); other decisions carry a reason code only — T-026.
- bg_run commands start immediately: never read a file in a bg command that a parallel tool call is still writing (empty prompt) — T-026.

### Repository state changes

- 2026-11-04: repository made **public** for free CI (DEC-037); gitleaks over all commits found no project secret.

## 2026-11-04 — T-026 commit lost to a power outage, recovered

- **What happened:** the power cut hit exactly while the T-026 commit was being written. The commit's git object was left empty and the repository was briefly corrupted; the ledger run had already finished PASS (`RUN-20261104T061556Z-361f478c`), so only the commit was lost.
- **Repair (owner):** repository repaired to a clean `git fsck`; `main` reset to the last valid commit `aa27347`; the 14 T-026 files put back in the staging area; full snapshot kept at `/data/backups/recovery-20261104T1400/clinic-dashboard-full.tgz` (not restored). After the repair `git fsck --full` still reported the empty tree `4b825dc6…` missing (only `refs/pi-rewind/store`, written by `pi-rewind-hook`, referenced it); the owner rewrote that object in all four repositories and deleted the corrupted ref.
- **Recovery:** the staged content, unchanged, became `56d6084` (T-026), then `2eb1d25` (status note). Its code equals the round-4-approved review material; the gates were re-run on the final surface in `RUN-20261104T071947Z-08502d65`: typecheck, lint (0 problems), docs:check, support-scope (13 tests), support, rls, vendor and the full suite PASS (executed through the ledger, exit 0); mutation gate 28/28 killed with the files equal to HEAD afterwards; each heavy suite started only with the one-minute load at most 4 and no browser or test suite of any project running.
- **Lessons:**
  - After a crash, verify every recorded hash with `git cat-file -t` before trusting it; one status update had recorded a hash that never existed.
  - `git cat-file -t 4b825dc6…` answers `tree` even when the object is missing (git knows the empty tree built in); only `git fsck --full` shows it is absent from disk.
  - Do not write into `.git` to repair objects inside a task: stop and report; the owner repairs or restores.
  - Heavy suites (full suite, mutation gate) wait until the one-minute load is at most 4 and no browser or test suite of any project runs (`/data/tmp/t026-waitgate.sh`).
