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
- A 5 s test-body limit fails integration tests on a shared machine: at load 14–16 (other projects' suites in the other heavy slot) auth, security, events and isolation tests crossed 5 s although they take 1.5–4 s at load 12 and pass alone. `vitest.config.mts` sets `testTimeout: 30_000` (HYG-006, measured in `docs/tasks/HYG-006.md`); a hang is still caught. A timed-out case can leave its insert committed: case helpers that create shared fixtures must be idempotent (HYG-010).
- Never let test files run `CREATE DATABASE` beside other database creates or drops on one cluster: each create fsyncs the relation map under one cluster-wide lock that every new backend reads at start, and each drop forces an immediate checkpoint, so new connections stall for seconds on a slow disk. `tests/rls/harness.ts` `createTestDatabase` (exclusive advisory lock) and `dropTestDatabase` (shared) are the only way tests create or drop a database; a structural test enforces it (HYG-006).
- A test whose time limit is only about twice its normal duration fails when the shared local database is slow (slow checkpoints while other work loads the disk): `events.test.ts` "four workers draining 200 events" (normally 2–3 s) timed out at 5 s in one of three suites. Record such failures, never re-run until green to hide them; HYG-011 sets measured limits.
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

## 2026-11-04 → 2026-11-05 — Test infrastructure hardening and the foundation review

- **HYG-005** (`baae0c8`): PostgreSQL never runs as PID 1. It runs under Docker's init locally and in CI (`--init`), and the pgBackRest image runs tini.
  - Root cause, reproduced: a timed-out healthcheck left an orphaned `pg_isready`. The postmaster as PID 1 reaped it, saw exit status 2, and crash-recovered the whole cluster mid-suite.
  - The local development database was rebuilt to 48/48 migrations (owner option A).
- **HYG-004** (`67d256b`): integration hooks get 120 s (`vitest.config.mts`, `.mts` for Vite's native loader). The harness `close()` prints its per-step timing when slow.
- **HYG-006** (`3acf40e`; CI 42164189650 green; test bodies 30 s folded in, full suite ×3 all green):
  - Root cause of an intermittent 5 s test timeout: concurrent `CREATE DATABASE` / `DROP DATABASE` by test files. Each create fsyncs the relation map under one cluster-wide lock that every new backend reads at start, and each drop forces an immediate checkpoint, so new connections stalled for up to seconds on the local SSD.
  - Evidence: per-second stall watch, a reproduction, PostgreSQL 16.15 source, and alternating stress pairs. It is in `/data/tmp/hyg006/`.
  - Fix: `createTestDatabase` (exclusive advisory lock) and `dropTestDatabase` (shared) are the only DDL path, enforced by a structural test. 20 deterministic lock tests, 30 mutations.
- **HYG-007** (second factor, DEC-041 (1)):
  - A test hook that holds a counted code check must arm only around the calls under test: completing TOTP enrolment is itself a counted code check, so an always-armed `afterRead` hook held enrolment forever.
  - Better Auth 1.7.15 rate-limits `/two-factor/*` to 3 calls per 10 s per address, and its limiter resets the count only when 10 s pass since the last call on that rule; any steady pace under 10 s reaches the 4th-call refusal (429, not counted toward the account lockout). Browser checks of the lockout space attempts more than 10 s apart.
  - A mutation that calls `sessionRow()` from the auth `after` hook for every path recurses (the session read goes through the same hooks) until the JavaScript heap is exhausted; it showed as a vitest worker SIGABRT with no test run, not as a caught mutation. Scope such mutations to the paths they target.
- **HYG-008a** (clinic authority, migration 0048, DEC-043):
  - `now()` is the transaction start. A check of "active membership" with `now()` passes for a transaction that started before the end committed, or that waited on `staff_access` while the end committed. Judge the actor with `clock_timestamp()` after the serializing lock, in a separate statement of a `VOLATILE` function (a `STABLE` function reuses the calling statement's snapshot, taken before the wait).
  - Re-created functions are built from `pg_get_functiondef` of a database at the previous migration, with each edit an exact single-match replacement; `tests/db/authority-drift.test.ts` pins every changed line. `runMigrations` takes an optional folder for that.
  - Concurrency tests that open their own connections must close each one when its transaction ends: the full suite shares the server's 100 connections across every test file, and a file that holds dozens until `afterAll` makes unrelated files fail with "remaining connection slots are reserved".
  - A test that waits for one transaction to unblock another must commit each as soon as its call returns: awaiting both results before committing holds `staff_access` in the first and hangs the second.
- **HYG-008b** (vendor and operator authority, migration 0049, DEC-043):
  - An exception handler's exit needs the authority re-check too: a `RAISE` in a handler body propagates (only the protected section between a nested `BEGIN` and its `EXCEPTION` is caught), and the handler runs after the protected section's waits. A re-check placed inside the protected section could be swallowed by its handler; the generator and a structural test forbid that.
  - Freshness after a wait comes from the caller: each statement of a `VOLATILE` plpgsql function takes a new snapshot, so a `STABLE` function it calls reads current data. Making `vendor_session` `VOLATILE` was not load-bearing (its mutation survived) and was dropped.
  - A console helper that calls an entry point directly instead of through `withAuthorityRecheck` lets the re-check's 42501 escape raw and leaves no durable refusal (found in review: the support ticket inside `withSupportSession`). Every `vendor_console_*` call in `src/` goes through the wrapper.
  - Drift proofs of one migration must bound the migration copy to it (`tests/db/migrations-up-to.ts`); "apply all current migrations" silently changes the proof when the next one is added.
- **Foundation review** (owner instruction 2026-11-05): read-only, three lanes (database/RLS, auth/API, ops/tests/docs), each reviewed by GPT and claude.
  - Verified 5 HIGH, 9 MEDIUM and 9 LOW. One finding was rejected with its reason: idempotency for settings.
  - Plans: HYG-007 (auth, plan approved), HYG-008 (database, migration 0048, plan drafted), HYG-009 (stale-context writes and app fixes), HYG-010 (isolation gate and docs), HYG-011 (timing-bound test limits).
  - Reports: `/data/tmp/foundation-review/`.
- **Decisions** (DEC-041, owner 2026-11-05): decisions are revisable defaults, each change logged here, in STATUS and in the ARCHITECTURE system map.
  - (1) New backup codes need the password and a current authenticator code. `get-totp-uri` is refused. Step-up codes count toward the same per-account lockout as at sign-in.
  - (2) HYG-006 finishes with one recorded intermittent timing failure.

- **HYG-009** (stale-context writes, migration 0050):
  - A drift proof that compares changed lines as a multiset cannot see reordered authorization checks; compare the whole new definition with the old one with an exact block replaced (review P2).
  - Pass the rendered context from the page loader that read the form's data, never from the layout: a layout can outlive a switch.
  - `approval_request` keeps its own branch rule, so widening a caller's branch check does not widen drafts; test the refusal so it stays visible.

- **HYG-010** (isolation gate):
  - A negative case that only looks for the victim's secrets cannot see a cross-tenant write that succeeds silently; report every attempt's outcome and require a refusal.
  - A refusal on already-consumed victim state proves nothing; seed it fresh for each run and assert it is live before the attempt (`expectLive`). Mutations that drop the fresh seed survived until the liveness check existed.
  - A browser runner that catches its error must also set `process.exitCode`, or a failed flow exits 0.
  - A positive control must require every attempt to succeed as the owning tenant; "at least one" let an attempt the owner could not make either (a duty to a cashier) pass as a refusal (review P1).
  - A hole demonstration must undo every new guard on the path it exercises; one that stops at a new check proves nothing (rerun it).

- **HYG-011** (timing and hosts):
  - Measure before raising limits: with the 30 s global from HYG-006, no test came within 40 % of its limit across three full suites at load 11.6–14.2, so nothing changed.
  - A server started by a test must keep its output and stop waiting when it exits; otherwise a start failure is a silent timeout (CI 42174727148 attempt 1).
  - Acceptance runs must hold the host rule for real: a gate that passed "inside heavy-run" let suite 3 run at load 18 beside another suite and fail on a disk stall; held for real, the same code passed three times. A long-running orphan (a dead Docker build) can keep the rule from ever holding; find it rather than relax the rule.

- **T-027** (go-live gate, migration 0051):
  - A trigger that decides by reading another row's state must take the same locks, in the same order, as the writer of that state; otherwise a concurrent insert can miss the state change for good (review P1: a branch added while the tenant entered onboarding never got its checklist item).
  - Concurrency tests must wait for the intended backend to be blocked by the intended holder (`pg_blocking_pids`), not for any lock wait on the server.
  - "Absent" in an API body is a closed set (missing, null, ""); anything else must validate, or `false`/`0` silently mean "clear".
  - A drift proof by line positions (not anchors) is unambiguous when the same line (`END IF;`) occurs several times.

- **T-028** (Akses Vendor page):
  - A success notice must be backed by state, not by the URL: a fixed code in a query string is still a claim anyone can link to. Show it only when the subject's current state agrees.
  - Look up a request-supplied key in a `Map` (or with `Object.hasOwn`), never in a plain object: `__proto__` and `constructor` resolve.
  - A combined terminal state (`rejected`) cannot say who rejected; do not attribute it to one party.
  - A `"use server"` file may export only async functions; typecheck does not catch it, the build does.
  - A cross-tenant negative for a list must seed the victim row and require the victim to see it; an empty list proves nothing.

- **HYG-013** (dual-identity revoke, migration 0052):
  - Revoking an approval must cover every outstanding request that already carries it, not only the effective one; otherwise the other party's later decision resurrects it.
  - Take locks in the order the competing writer takes them: a row UPDATE locks the tuple first and its trigger takes the advisory lock second, so a function that needs both locks the row first.
  - A concurrency test must run the real competing write and assert it is blocked (`pg_blocking_pids`); holding the advisory lock alone cannot show a row-lock cycle.

- **HYG-014** (go-live re-checks the processor agreement, migration 0053):
  - A gate checked once at an earlier step is not a gate at a later step: evidence that can be revoked, replaced or expire must be re-read where the decision is taken.
  - Write the regression before the fix and run it against the unchanged code; keep that red run as evidence.
  - A mutation that survives can expose a missing case, not only a weak test: replacing `evidence_item_open` by the item state survived until an expired-but-approved case existed.

- **T-032** (M0 exit review):
  - A one-line doc fix after the final checks makes every required check stale, the suites included; re-run all of them, not only the cheap ones.
  - Never chain `finish`, commit and push in one command: `finish` refused PASS and the commit and push still ran (`ea9610f` reached `main` before the ledger closed). Run `finish` alone, read its result, then commit.
  - Ledger steps that read each other's events (`review-boundary`, then `finish`), and `finish` then commit, must run one after the other, never as parallel tool calls (repeated once in the STATUS docs run that followed; that run closed BLOCKED, `634e840`/`8ac8093`, local only).
  - An exit review must test each scenario's Given/When/Then, not its title: it found PR-59's go-live did not re-check the processor agreement (HYG-014).

- **T-033** (catalog versions, migration 0054):
  - A SECURITY DEFINER function with `search_path = pg_catalog, pg_temp` must schema-qualify every call, `public.uuid_generate_v7()` included.
  - Domain-event payloads carry ids and short identifiers only (`events_payload_ok`): no numbers.
  - "Omitted means keep" needs the right fallback for every state: with no active version the edit starts from the latest version, so the kept value must come from there too, while the review baseline stays the active one.
  - A cross-tenant negative must use a target the victim could act on: a pending version is refused by state alone and hides a missing tenant predicate (a mutation survived).
  - Browser specs: scope locators to `main` and to the list they mean (a filter chip and a row can share a name); open a detail by its href when a client navigation leaves the previous page mounted.
  - Pipe a heavy-run job through `set -o pipefail` or its failure reads as success.
  - A new tenant table needs its vendor support class and operator policy (TEN-19); run `tests/vendor` while building, not only at the full suite.
  - A reviewer quota (429) can stay exhausted for hours while other sessions share it: retrying does not help; use the owner's fallback reviewer (Argon) and record it.

- **T-034** (Master Layanan, migration 0055):
  - Row-level security cannot hide columns: a role allowed to read a row reads its clinical text too. Give a narrower role (the pharmacist) its view through a SECURITY DEFINER projection, and test the definer itself, not only the module's mapping (a mutation survived until the raw function was asserted).
  - Two approvals on one subject: move the subject first, then cancel the sibling, so the trigger's second firing finds nothing pending and exits; the sibling's cancellation needs a decider, an audit row and its event like any other.
  - A form that only offers allowed choices must also judge "what changed" on what it will post, not on its raw state (a narrower category silently dropped rows while the button still said Minta Review).
  - A `<select>` inside its `<label>` takes the options' text into its accessible name; label it with `for`.
  - `memberships_effective_check` needs `effective_to > effective_from`: end a membership in tests with `now()`, not a time before it.

- **T-035** (branch prices, migration 0056):
  - A form action that returns an error lets React reset the form: a controlled `<select>` shows its first option again in the DOM while the state still holds the chosen value, so the next submit posts something other than what was chosen. Remount the fields from the values the action returns (a `key` that changes on every completion).
  - Horizontal-overflow checks miss text squeezed to one letter per line at 200 %: also check that no text cell is narrower than a few characters of its own font, and look at the 390 px / 200 % screenshot.
  - Two lists compared in a test must be sorted in the same collation: `pg_policies` names sort in "C", ordinary text columns in the database default, and the first table name where they disagree (`branch_prices` vs `branches`) breaks the comparison. PostgreSQL rejects `ORDER BY 1 COLLATE ...` (a literal) and output aliases inside an ORDER BY expression; sort in the test instead.
  - Never validate input with a query that can fail inside the caller's transaction (`'2026-02-31'::date`): the error aborts the whole transaction. Validate in code first.
  - A read helper with a default "as of" time must default to the wall clock (`clock_timestamp()`), not the transaction start, or a value written "now" earlier in the same transaction is invisible to it.

- **T-037** (patients, encrypted identity, migration 0057):
  - A secret value must not survive a refused form: never echo it in the action state; carry the sealed value and a masked display instead, and verify the sealed pair when it comes back (it can be tampered with).
  - "Create on first use" for a key needs `INSERT … ON CONFLICT DO NOTHING` plus returning the stored row; the caller must use the returned key, never its own candidate. Test it deterministically with two candidates, not only with a race.
  - A rule enforced twice (a function check and a table check; a tenant filter in a search and in its projection) survives a one-layer mutation: mutate both layers.
  - A fail-closed environment flag (`DEPLOY_ENV` unset = production) blocks tests silently by design: set the non-production value explicitly in the test, and test the production branch on purpose.
  - The safety net blocks `rm -r` on scratch paths outside the working directory: give each scratch run its own folder instead of cleaning up.

- **T-036** (branch master, migration 0058):
  - A server component that imports a value (not a component) from a `"use client"` module receives a client reference, not the data: the label read "undefined". Keep shared constants in a plain module.
  - A mutation "caught" because the mutated SQL no longer parses proves nothing: check every mutation log for a real assertion failure, not a skipped file.
  - A negative test on another tenant's row must use a row that would answer "yes" for its own tenant (a branch with hours), or removing the tenant filter still returns "no".
  - Authorize the row's own scope before any other comparison, or the order of errors tells a caller what exists.
  - A fictional table in a self-test collides when a later task creates the real one (fourth time): name fixtures `fixture_*`.

- **T-038** (consent ledger, migration 0059):
  - Map database errors to a `CommandError` only outside `runCommand`: inside it, a `CommandError` is a stored refusal; a raw error rolls the claim back. Test the case where the caller catches the error and commits.
  - A lock that a broader lock already covers survives every mutation: delete it instead of keeping untestable code.
  - A cross-tenant test must give the attacker a valid object of their own (a text in force), or an earlier check answers first and the tenant filter under test is never reached.
  - Keep the failed run's per-mutation logs before a targeted re-run: the script clears its folder.

- **T-043** (staff schedules, migration 0060):
  - Inputs hidden with CSS still post: two layouts of one form must share one set of inputs (CSS grid with `display: contents`), never render the same names twice.
  - A "replace the set" writer behind a filtered editor must take the list of what the editor showed, or the save wipes everything the filter hid.
  - Next 16 keeps the previous page in the DOM, hidden (`<Activity>`, `display: none`): browser specs target `main:visible`.
  - `/` is a placeholder outside the app shell: browser specs start from a page inside it.
  - An isolation case's positive control runs the attempts as the victim too: order them so an earlier write does not undo what a later one needs.
  - Set the browser layout minimum to what the spec measures (pages × 4 widths × 2 sizes + extras), not a copy from another task.

### Gotchas worth keeping (added 2026-11-05)

- `now()` in PostgreSQL is the **transaction start**. A validity check (membership, session, grant) that must hold "now" uses `clock_timestamp()` after taking the lock that serializes the change; otherwise a transaction opened before a revocation keeps acting (HYG-008).
- PostgreSQL advisory locks are per database: participants coordinate only when they connect to the same database.
- `vitest -t` matches the full test name, including the describe prefix, so `^` anchors match nothing. A run where no test ran must count as invalid, never as "not caught" or "passed" (mutation scripts judge "Tests … passed|failed" first).
- A mutation that removes one of two redundant cleanup paths survives by design. Mutate both, or the mutation proves nothing.
- Review agents: give each one a narrow scope and a tool budget. Wide lanes timed out twice (claude) with no report.
- Better Auth 1.7.15 two-factor:
  - The plugin counts code failures per account only at sign-in (`isSignIn` = no valid session). Step-up from an open session is not counted (fixed in HYG-007).
  - `get-totp-uri` returns the live secret to anyone with a session and the password.
  - `generate-backup-codes` mints a working second factor with the password alone.

## 2026-11-05 ~20:30 WIB — Checkpoint (machine maintenance)

- HYG-006 is not yet committed. The re-run passed every check except the full suite, of which only suite 1 of 3 ran (779 passed) before the checkpoint stopped it. The ledger run stays open; resume with `/data/tmp/hyg006/commit-push.sh` (see STATUS "CHECKPOINT").
- Gotcha: the host gate (`/data/tmp/t026-waitgate.sh`) matched "playwright" in process arguments. It counted Chrome launched by an interactive browser tool (`playwright-mcp`, whose profile path contains "playwright") as a test suite, and stayed closed for hours. The gate now skips the whole `playwright-mcp` process tree; real suites (`playwright test`, `vitest`, `test-backend-isolated`) still count. Check process ancestry, not only a command-line word.
- A plan file edit once inserted a block between every character, because an empty search pattern was replaced (29 MB). It was recovered exactly from its repeated insert. Every scripted text replacement now asserts a non-empty pattern that occurs exactly once.
