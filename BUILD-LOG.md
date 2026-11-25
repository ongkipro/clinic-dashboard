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

- **T-044** (booking engine, migration 0061):
  - In PL/pgSQL, a `CASE … WHEN … THEN` inside an `IF` condition ends the `IF` at the first `THEN`: use boolean `OR`/`AND` instead.
  - An apostrophe in a SQL comment can split Drizzle's statement parser: keep comments free of quotes.
  - A unique key "one per kind" contradicts "one of each required type": key on the resource, and test a service needing two of a kind.
  - A function created after 0003 is never PUBLIC-executable (`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE … FROM PUBLIC`): an explicit revoke is consistency, not protection.
  - Tests sharing one branch and week interfere through roster replacement: give a test that edits rosters its own branch.
  - `CREATE EXTENSION btree_gist` adds C functions to `public`: drift tests must ignore extension-owned functions (`pg_depend.deptype = 'e'`).

- **T-045** (appointment states, migration 0062):
  - Adding a state means revisiting every query that tests the old state set: one helper (`appointment_live`) avoids five drifting copies.
  - The browser harness must start the server with `DEPLOY_ENV=local`, or every write is refused by the production go-live gate (fail-closed by design) and the page shows an unknown failure.
  - Map every known refusal class in a server action (`GoLiveBlockedError`), or a deliberate refusal reads as "not sure it saved".
  - A success message rendered inside a form that unmounts with its row never shows: assert the row's new state instead.
  - Narrow week columns cannot hold row actions: give the week compact rows and keep the actions on the day view.
  - Level 2 roles (finance) take no branch: fixtures that assign one hit `staff_branches_level3_check`.

- **T-046** (lateness release, no migration):
  - An early "off, nothing to do" return must not skip the scope and role checks: run the guarded reader first, then decide.
  - A "today" window misses work that crosses midnight in branch time: use yesterday and today.
  - A gate that the inner writer also checks survives its mutation while there is work to do: test it where there is nothing to do.
  - heavy-run runs commands from another directory: call scripts with `bash <absolute path>`, never `./script`.

- **T-040** (patient profile, no migration):
  - A projection that short-circuits before the database reader skips the database's own refusal and audit: call the guarded reader first.
  - A writer that takes only a child id (`consent_withdraw(consent)`) needs the parent checked by the page that names it.
  - Isolation cases must not echo the input in the result body: the gate reads any victim id as a leak.
  - A select whose options shrink after a submit keeps a stale choice in client state: derive the effective choice from the options.

- **T-047** (visits, migration 0063):
  - Existing contract tests used `visits` as a throwaway probe table name: a new table with that name breaks them; probe with a name no migration owns yet.
  - Isolation cases share the fixture tenants: unique names (rooms, service codes) collide across cases; use names of your own and do not change shared branch settings.
  - A browser check that reads headings right after navigation can read the Suspense fallback (same h1): wait for a section of the loaded page.
  - A client mirror of a database rule (which blocker comes first) needs a test where two rules apply at once.

- **T-048** (queue, migration 0064):
  - A secret made for a one-time display (a pairing token) must never pass through `runCommand`'s body or result: idempotency records are stored; return only the id and attach the secret outside.
  - Settings read through `setting_value_at` use the session tenant: a function outside a tenant context needs its own read for the row's tenant.
  - Phone search: contacts are stored `+62…`; a typed local `08…` needs the leading 0 mapped to 62.
  - A mutation that removes an inner lock can be equivalent when an outer lock (`tenant_actor_lock`) already serializes the writers: drop it with the reason rather than writing a test that cannot fail.

- **T-039** (privacy, migration 0065):
  - `timestamptz + interval` is STABLE: a generated column cannot hold a deadline; store it and check `deadline = start + interval` (checks accept STABLE expressions).
  - A raw `pg.Pool` in a test needs an `error` listener: a backend terminated around the database drop surfaces as an unhandled error and fails the run with every test passing (CI 42615137831).
  - `runCommand` keeps only a fingerprint of the body: secrets in the body are not stored, but bytes do not belong there either (a Buffer is not a valid body); name a file by its checksum.
  - Playwright `getByLabel("Penerima")` also matches "Nama penerima": use `exact: true` for short labels.

- **T-041** (patient search, migration 0066):
  - A rate limit that must keep its count and alert cannot raise inside `withTenantContext` (the rollback erases both): return the refusal as a value and throw after the commit.
  - SQL-language functions cannot take `record` arguments: pass scalars (or use plpgsql).
  - A table no app role reads must not be granted to `clinic_operator` either (vendor-authority 2.8: the operator never sees more than the app); give it support class `never`.
  - A browser spec inside the repository is typechecked by `next build`: run typecheck after writing it.

- **T-042** (patient merge, migration 0067):
  - Merge by redirect, not by moving rows: guarded tables refuse a patient rewrite, partial unique indexes collide, and an unmerge cannot know which rows moved.
  - A drift test that reads a function's live definition breaks when a later migration patches it again: compare migration text to migration text.
  - An overlap check that may span several ids needs a test where the conflicting row is on the other id (the survivor's check passed with its own consent).

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

## 2026-11-09 — T-050 clinical credentials; the command guard and the folder name

- The device's command guard (cc-safety-net `secret.basename.credentials`) blocks every shell command that names a path segment `credentials`, and `rm -r` outside the session's directory. The TASKS path `src/modules/org/credentials/**` would have blocked mutations, staging and merge, so the owner chose the folder `src/modules/org/licences` (DEC-062). Lesson: never name a source folder `credentials`, `secrets` or similar on this device; the guard is not bypassed.
- Next.js: a non-component export of a `"use client"` module reaches a Server Component only as a client reference (labels rendered empty); a `"use server"` module may export only async functions. Shared constants go to a plain module.
- Forms that keep one idempotency key per mount fail the second attempt (`runCommand` spends a key on success and on refusal alike): bump `n` in every action answer and remount the hidden key with it.

## 2026-11-10 — T-051 BC Pendampingan

- A refusal that must stay audited is a committed value, not a raise: `runCommand` rolls back its savepoint and `withTenantContext` the transaction on a throw, taking the audit row with them (0066, 0069).
- A `Row` link covers its whole row (`after:inset-0`): an action inside the row is under the overlay and cannot be clicked; keep one link per row and put actions on the detail page.
- A page `main` grid needs `grid-cols-[minmax(0,1fr)]`, or one wide child stretches the column past 390 px at 200 %.
- A mutation that leaves invalid SQL fails the migration, not a test: its log has "Tests" with every case skipped — check for "skipped" too, not only for a "Tests" line.

## 2026-11-10 — T-052 Lembar Pemeriksaan

- Domain event payloads accept only ids, lower-case codes, booleans, objects and arrays (`events_payload_ok`): a number such as a version is refused by the CHECK; keep counts out of events.
- A policy that needs another table's branch through a definer helper widens the allow-list; store the scope column on the row instead (plans and items carry the creating examination's branch).
- A mutant that removes a writer check is equivalent when a table CHECK refuses the same input and the writer maps `check_violation` to invalid input; drop it with that reason rather than adding a test that cannot tell them apart.
- A nurse has no second factor (PR-3 `TOTP_ROLES`); a browser spec that enrols TOTP for every role waits forever on `/aktifkan-2fa`.

## 2026-11-10 — T-053 Signing and records

- Raw Better Auth API calls (`.api`) are allowed only in `src/auth/server.ts` (SEC-21 guard in `tests/vendor/host.test.ts`); a step-up check belongs in the auth factory, not in a module.
- `visits_guard` refuses every update of a closed visit; a writer that may run after close must filter `closed_at IS NULL` on its visit update.
- `runCommand` results land in `idempotency_records`: keep them to ids and counts and read content with a separate definer (the copy request).
- `ARRAY(SELECT ...)` is never NULL; `coalesce` over it never falls back — branch on the state instead.
- A drift test of re-created functions pins the exact line blocks (`*-drift.expected.json`); compute them once from the two migrated databases with a scratch test, then review each block.

## 2026-11-10 — T-055 Private clinical media

- Removing a branch role makes `tenant_actor_lock` refuse the bound context itself; tests of lost access must expect that refusal (fail closed), and test "access revoked" with a reader who keeps another branch.
- A `text[] || 'literal'` in PL/pgSQL is read as an array literal; cast the element (`'x'::text`).
- `media_tokens` stores only the sha256 of the token; an idempotent replay cannot show the token again, so the replay is a conflict and the caller asks for a new link.
- Column grants (`GRANT SELECT (cols)`) keep content addresses and removal reasons out of direct reads while the row stays readable.

## 2026-11-10 — T-054 Procedure consent and start gates

- A form whose page swaps it for a summary after success unmounts and loses its `useActionState` result; keep the form mounted and let it render the result and the summary (capture and withdraw on UX-39).
- Playwright `mouse` coordinates are viewport coordinates: scroll a canvas into view before drawing on it, and wait for hydration (the pad reports the stroke) before submitting.
- In PL/pgSQL a variable named like a table alias (`x record` and `FROM t x`) makes `x.col` resolve to the variable; name record variables apart from aliases.
- SQL-language functions are validated at creation: define helpers before the functions that call them.
- A mutation that survives because a condition can never be true marks dead code: remove the condition (and its mutant) instead of writing a test for it.

## 2026-11-10 — T-057 Keluhan Klinis and Layanan

- A definer reader that takes a branch argument must refuse a branch other than the actor's active one; ignoring it silently answered 200 for another tenant's branch id (caught by the isolation suite).
- `branch_closures` refuses dates in the past, so working-hour tests use future dates with their weekdays checked.
- Playwright `getByLabel` matches substrings: the shell search ("Cari halaman, pasien atau aksi") collides with a field labelled "Pasien"; use `exact: true`.
- A fixed label column (`12rem`) in a `dl` squeezes the values at 820 px with 200 % text; stack label above value.
- A writer's task lookup must compare with the active branch, not only the session's allowed branches: a multi-branch handler otherwise acts on another branch's row that the readers already hide (implementation review P2-1).
- In a Level 2 session `app_branch_allowed` is true for every id; a reader that takes a branch id must also check the branch belongs to the tenant (P2-2).

## 2026-11-11 — T-058 Document templates and signed letters

- A definer that reads its input before `tenant_actor_lock()` answers an ended actor with an input error instead of the access refusal; take the lock first (authority-clock suite, DEC-043).
- An isolation positive control replays every attempt as tenant B in order: a case that retires B's template must run the letter writes that need it first, and use a fresh template per run.
- A seed that turns on a TOTP role's factor to sign server-side must turn it off again, or the browser sign-in asks for a code instead of enrolling the authenticator.
- Playwright `getByRole("link", { name })` matches substrings ("Struk" in "Templat Struk ..."): scope the query to the segment group and compare the exact list.
- A long status badge ("Ditandatangani · v2") overflows a list row at 390 px with 200 % text; keep badge words short and move detail into the subtitle.

## 2026-11-11 — T-056 Permintaan Klinis

- A section that disappears when the record's state changes unmounts its forms and loses their result; keep it mounted for the roles that acted (the T-054 lesson again, on the decision of a request).
- After a link to a page with the same heading, wait for the new URL and a text of that page, not the heading: the next page streams in after the click and the old heading is still on screen.
- A runner's minimum flow count copied from another task must match the spec it runs; set it to the spec's own count so a skipped flow still fails.
- Plan items reference their plan by `(tenant, branch, plan)`: an item added for a visit at another branch carries the plan's branch, not the visit's.

## 2026-11-11 — HYG-015 Test database connections and error listeners

- A `pg.Pool` re-emits an idle client's backend error on the pool, and a `pg.Client` emits it on itself; with no `error` listener Node throws it and vitest fails the run as an unhandled error although every test passed (`57P01` at `DROP DATABASE … WITH (FORCE)` or a deliberate `pg_terminate_backend`). pg-pool removes its own idle listener while a client is checked out, so a client held for a whole file has none at all.
- Tests build every pool and client with `testPool`/`testClient` from `tests/rls/harness.ts`, never `new pg.Pool`/`new pg.Client`; `tests/rls/pg-listener.test.ts` fails the build otherwise. The listeners do not hide failures: pg rejects every active and queued query of a dead connection before it emits.
- A behaviour test that waits for a connection's `end` must also wake on a process-level error: without a listener pg throws before `end`, and the wait would hang to the test timeout instead of failing on its assertion.

## 2026-11-11 — T-060 Stok

- A quantity that may only change with its ledger row: let the ledger row's insert trigger set the quantity and have the quantity guard accept only the newest row's balance. Paired row triggers hold the invariant with no window, where a deferred two-way check needs a transaction-wide matching scheme.
- `numeric` accepts NaN and Infinity, and both pass `>= 0`: bound every numeric column with `between` and `scale(...) <= 4`; validate decimal strings in the TS layer too (`1e3` is a valid numeric literal).
- A plpgsql function that takes a `record` argument cannot be called with a `DECLARE a record := …` variable in every position; pass the fields as plain parameters.
- Unqualified `uuid_generate_v7()` inside a definer with `search_path = pg_catalog, pg_temp` does not resolve; write `public.uuid_generate_v7()`.
- `getByRole("link", { name })` on Persetujuan matches the type filter chip first; scope to the list (`getByRole("list", { name: "Permintaan menunggu" })`).

## 2026-11-11 — T-061 Depots and transfers

- Extending a ledger invariant to a second level (batch → per-depot holding): put the depot and its balance on the same movement row, let the insert trigger set both and let each level's guard accept only its newest movement. Σ holdings = batch quantity then holds by construction, and the T-060 tests stayed unchanged.
- To make an existing function aware of a new dimension without breaking callers or drift tests, keep its signature (`CREATE OR REPLACE`, defaulting to the old meaning) and add the new variant under a different name; an added defaulted parameter would create an ambiguous overload (42725).
- A unique key over a ledger's source must include every dimension a single source can legitimately repeat (here depot and leg: one transfer writes two movements on one batch); `NULLS NOT DISTINCT` keeps single-leg sources unique.
- An AFTER INSERT seed trigger on a parent table (branches → default gudang) breaks every fixture that deletes the parent with its guard disabled: the child row must go first.
- In plpgsql, `CASE WHEN rec.id IS NOT NULL AND f(rec) … THEN rec.col` on a composite-typed variable did not parse as expected; use `IF FOUND` and a scalar.
- A random fixture key drawn from a small space (6 digits) into a table that keeps growing across test cases and runs fails by the birthday bound long before it looks likely (3 000 rows: several collisions). Draw from a space orders of magnitude larger than the lifetime row count, or use a sequence. And keep the full output of every gated check: the ledger keeps only the tail, and this failure had to be reconstructed from the database server log.

## 2026-11-11 — T-062 Material lifecycle

- In PL/pgSQL a `record` variable named like a SQL alias inside an embedded query (`l` for a loop record and `public.material_request_lines l` in a subquery) makes the query refer to the not-yet-assigned record ("record "l" is not assigned yet"). Name loop records with a prefix (`v_l`) and never reuse them as aliases.
- A ledger helper that clamps a derived quantity only when it would exceed the new balance (T-061 `stock_move_depot` and open vials) is silently wrong when the derived quantity sits beside other stock in the same balance: every writer that takes from that sub-quantity must run it down explicitly.
- Two-tier FEFO returns the open vial row and the sealed row of the same batch; aggregate picks per batch before writing movements whose source key is unique per (source, batch, depot, leg).
- Free quantity per (line, batch) as issued − consumed − returned − wasted − pending, with pending returns reserving, keeps concurrent consume/return/waste from spending the same units; serialise on the request row.

## 2026-11-12 — T-063 Moving average cost

- A field of an unassigned PL/pgSQL `record` must not appear in an expression even inside a `CASE` branch that is not taken: the first call on a connection fails ("record "v_x" is not assigned yet"), later calls on the same connection may pass because the plan is cached. Tests on a shared pool hide it; use `IF … THEN v := rec.f` and test on a fresh connection. Found in T-062's `material_consume` by T-063's tests and fixed in 0080.
- A ledger kept beside an existing ledger (values beside quantities) stays in step when it is written by an AFTER INSERT trigger on the same rows and its guard accepts a change only to the afters of the newest row; storing the afters on each value row makes a replayed or partial update detectable.
- Adding an FK that references a table changes how `TRUNCATE` on that table fails (0A000 "cannot truncate a table referenced in a foreign key constraint" before any truncate trigger fires): tests asserting the trigger's 42501 must use `cascade` or accept both.

## 2026-11-12 — T-064 Ruang Tindakan

- A form that the page replaces on success (Sebelum mulai → the running view) unmounts its own status message: browser checks must wait for the new view (the timer), not for the form's status.
- Layout checks that flag "squeezed" text must skip visually hidden text (`sr-only` is 1 px wide by design) and look at line count, not width alone.
- A long Indonesian word ("ditandatangani") at 200 % text overflows a narrow card by under a pixel: give block copy `overflow-wrap:anywhere` on the container.
- Seeding a signed examination needs the signing doctor's second factor enrolled (record_sign refuses otherwise); seed it on the account rather than weakening the rule.

## 2026-11-12 — T-065 Siapkan & Serahkan

- A contract gap (a task's Done-when needing rows no task builds) is first checked against the owning spec's module and event contracts (TD-*, TD-50) before it is escalated: here TD-6 already owned prescriptions and dispensing, so the task built the data within its paths and left the other UX contracts' panels open.
- Two isolation case files seeding the same victim tenant collide on unique names (depot names per branch): give every case's fixtures names unique to the case.
- A form's default choice is part of correctness: the issue form defaulted to the apotek depot while treatment materials live in the gudang, so the database rightly refused ("stok tidak cukup"); the browser check found it, not the unit tests.
- A trailing status badge in a list row squeezes the title to one letter per line at 390 px and 200 % text; put the badge under the title.
- An explicit guard that repeats the state check right after it (`handed` before `<> 'prepared'`) is dead code a mutation proves: delete it rather than keep an equivalent mutant.

## 2026-11-12 — T-066 Suppliers and supplier returns

- A writer that needs the value a row trigger computes can read it in the next statement of the same function: AFTER INSERT FOR EACH ROW triggers have run when the INSERT returns. Write the dependent rows after the movement, never with mutual NOT NULL links between insert-only tables.
- The moving-average valuation leaves costed units first, so an "uncosted return" only happens when costed units have already left the item at the branch; a test that wants one must take them out first.
- The authority-clock harness assigns every role to a branch; tenant-wide roles (purchasing, auditor, finance) fail its staff_branches check, so lock-order cases use a Level 3 role that reaches the same lock (the lock comes before the role check).

## 2026-11-12 — T-067 Purchase orders, goods receipts and supplier payables

- No-overpayment under concurrency: keep the paid / credited / allocated counters on the parent rows, lock the parents in one order (credit note → payment → invoices by id) and read the outstanding from the locked row; take least(requested, outstanding). Prove it with real concurrent calls in a loop, not a sequential replay.
- A deferred constraint trigger fires with the NEW row of the insert, not the row as it is at commit: re-read the row there (an invoice total set after its lines would otherwise look wrong).
- Tenant-wide roles (purchasing, finance, owner) land on the first branch by name in branch-picking pages; browser checks must pick the seeded branch (`?cabang=`).
- Owner, finance, manager, auditor and the other TOTP roles are sent to the second-factor enrolment on their first page: browser specs enrol them first.

## 2026-11-12 — T-067 review round (Argon `2665ab81`)

- A PL/pgSQL `DECLARE` initialiser runs before the body, so an actor call that is given a subquery argument (`stock_actor(..., (SELECT branch_id FROM t WHERE id = p_id))`) reads the table before `tenant_actor_lock()`. Pass NULL to the actor, then read the row `FOR UPDATE` in the body (pattern: `branch_transfer_receive`).
- An unchecked `<input type="checkbox">` is not in `FormData` at all; changing its `value` on change does not help. For an edit form, read `f.get(name) === "on"`.

## 2026-11-12 — T-068 Logbooks and the incident register

- `audit_events.reason_code` allows lowercase letters and underscores only (`^[a-z][a-z_]{1,40}$`): a reason code built from a value with digits (`logbook_b3_waste`) fails the insert; map such values first.
- Built and recorded without a per-task review (owner, 2026-11-12); the review round runs once all tasks are final.

## 2026-11-12 — T-068 review round (Argon `e891e890`)

- A table `GRANT SELECT` with an RLS row predicate still hands every column to every reader of the row. When a reader may see a row but not all of it (a reporter and the investigation), grant the visible columns only and serve the rest through the definers.
- A rebase that merges with diff3 leaves a `|||||||` line, which `<<<<<<<`/`>>>>>>>` scans do not catch; check for it.

## 2026-11-12 — T-071 Invoice and tax foundation

- A newly published *service* waits for the clinical review (DEC-046) and is not active. Fixtures that only need a tax category use products, which publish active at once.
- Validate cheap inputs (quantity) before the lookups that can fail with not-found. Otherwise a bad quantity on an unknown item reports the wrong refusal.
- Half-up rounding in integers: (P × 100 + 55) ÷ 111. It needs a test value whose remainder is at least 56 (100,001) to tell it apart from truncation; the fixture's multiples of 111 cannot.

## 2026-11-13 — T-072 Kasir

- `events_payload_ok` (0018) refuses JSON null. A payload built from optional ids needs `jsonb_strip_nulls`.
- A foreign key that references a table makes `TRUNCATE` fail (0A000) before the no-truncate trigger runs. A test that asserts 42501 for a TRUNCATE must accept either code.
- After a server action, the page revalidates and can unmount the form that showed the success message. Keep the form mounted while its result panel is needed, or have the browser spec wait for the new view.
- A list row and the filter chip of the same type are both links. Select the row by its list name and content, not by link text.

## 2026-11-13 — T-073 Payment port

- `audit_append` and `tenant_data_keys_for` need a staff member. A webhook has none, so the audit is written as a service (`service_identity`), and the mock secret is derived from the KEK instead of being stored under a tenant key.
- An unbound worker connection that resolves the tenant itself must take that tenant's `staff_access` lock before locking any row, in the same order as the interactive writers.
- A server action that has to call a second transactional path (here the webhook handler) does it after its own transaction commits, never inside `withTenantContext`, which refuses nesting.
- When testing a guard, make sure the row you insert breaks only the rule under test: a copy-rule check must not run into the payment's own amount bound first (T-072 mutation run 2).
- Browser specs: a 2FA role logging in a second time lands on /verifikasi. Keep the first session open instead of signing in again.

## 2026-11-13 — T-074 Additional treatment payment

- In PL/pgSQL a table alias inside a query is shadowed by a record variable of the same name (`l` here): the query fails at run time with "record is not assigned yet". Use aliases that differ from the function's variables.
- An `AFTER UPDATE` trigger that recomputes another table's state is safe from deadlock only when every writer that updates the row already holds the same locks in the same order. Check the callers' lock order before choosing a trigger over re-creating a writer.
- When the guard of a table forbids updating a finished row, an `OLD.state = 'finished'` check in a later trigger is unreachable. Its mutant is equivalent; record the reason instead of writing a test that cannot exist.

## 2026-11-13 — T-075 Patient balance

- When a migration re-creates a function, copy it from its **latest** definition: grep every migration for the function, not only the one you expect. T-075 first copied `kasir_invoice_get` from 0088 and silently dropped T-074's line field from 0089; only the neighbouring suite caught it.
- An RLS policy that calls a predicate function needs `EXECUTE` on that function for the querying role, even though the function is not a definer. Without the grant the policy fails with "permission denied for function".
- `events_payload_ok` refuses numbers: an event names the entry and the kind; amounts are read from the entry.

## 2026-11-13 — T-076 Packages

- A CHECK written as "state X ⇔ column set" breaks when a later state keeps the column (a redeemed session keeps its visit). Write the implication only in the direction the rule needs.
- AFTER triggers on one table fire in name order. When one trigger must see the effect of another (the package finish before the additions alert), name it to sort first and test the order.
- A mutation the suite catches only because a new assertion fails on the unmutated code proves nothing. Rerun the suite green before reading mutation results.
- A browser spec that counts elements right after `goto` can read the page before it renders; wait for the heading first. And after a server action that unmounts its own form, wait for what the revalidated page shows, not the form's message (seen three times in T-076's runs).

## 2026-11-13 — HYG-016 One clock read per operation

- Two `clock_timestamp()` reads in one row usually return the same microsecond, so a rule that stores an exact interval passes most runs and fails some (a 600 s media token broke `media_tokens_check`; a vial's use-by was 24 h + 1 us). Read the clock once into `v_now`, after the locks, and derive every timestamp of the operation from it. A column default of `clock_timestamp()` is a second read too: name the column.
- An occasional race cannot be proved by a loop: the mutant survives whenever the reads happen to agree. Prove it from the catalog instead (`prosrc` reads the clock once), which is red on the old code every time.
- A test's time budget includes every lock it queues on. The harness serializes migrations cluster-wide (T-060), so a lock test that builds a full harness waits behind every other file's migration and times out in the full suite while passing alone. Measure the queue (sample `pg_locks` per second by `application_name`) before blaming the disk, and give a test that is not about the schema its own key and an empty migration.

## 2026-11-13 — T-077 Booking DP

- A role check that sits after an actor helper which already refuses the same roles can never fire. Mutation testing finds it: the mutant that removes it survives. Delete the duplicate; keep the test that proves the refusal.
- Test an "after X" refusal before anything else refuses for a different reason. A void after a DP was applied was first tested after the remainder was paid, where the payment alone already refused the void.
- Fixtures that go through the real writers find the real rules: a roster cannot reach a past day, a doctor's shifts cannot overlap across branches, a check-in must be today and within two hours of the start. Build the fixture inside those rules rather than writing rows past the guards.

## 2026-11-14 — T-078 Refunds, receivables and write-offs

- A server action that opens its result page must redirect on the server. When the write removes the row its form lives in (the last refundable line, the converted visit), the form unmounts on revalidation and a client-side `router.push` from its state never runs.
- A list row that is one stretched link (`after:inset-0`) covers any control placed inside it. A row that carries a form needs its own markup.
- A detail page that reads a table directly sees only what RLS lets the role read. The FO could not read invoice lines or catalog versions, so "Asal tagihan" was silently empty. Read through the SECURITY DEFINER reader that already decides access, and test the field as the branch role.
- A trailing badge in a list row squeezes the title to one letter per line at 390 px and 200 % text; put the status under the title.
- When the test file fails to compile, every mutant is "caught". Gate the mutation run on a green suite in the same script.
- A mutant "caught" by a flaky test is not caught. Two events written in one transaction share `now()` and uuid v7 does not order within a millisecond; the 15b event-order assertion failed at random and hid five untested rules until it compared the set. Read which test fails for each caught mutant.
- A check placed after another that always answers first for the same rows can never fire (a converted remainder is never paid, so `line_unpaid` answered before `line_on_receivable`). Order the specific refusal first and test it.

## 2026-11-14 — HYG-017 Test container durability

- A test suite that creates, migrates and drops a database per file pays for crash safety it never uses. On the local
  throwaway container, `fsync=off`, `synchronous_commit=off` and `full_page_writes=off` cut `tests/rls tests/db` from 249 s to 63 s
  and the container's writes from about 2 GB to 124 MB per run. Keep CI on the defaults so it still runs what production runs.
- Check a setting exists on the server's major version before planning around it: `autovacuum_vacuum_truncate` is PostgreSQL 18;
  on 16 the per-table `vacuum_truncate` is refused on a system catalog even for a superuser.

## 2026-11-14 — T-079 Consultation fee

- A new OUT parameter changes a function's row type: `CREATE OR REPLACE` refuses it. Drop and re-create, re-grant (here: revoke from PUBLIC), and re-create its callers in the same migration; the drift test then treats it as a re-created function, not a changed one.
- A check that decides "would this complete the refund" must count every refund that completes it together. The pending cash refund was tested alone and never looked absorbed; with the balance refund being requested added, it does.
- A mutant that edits the wrong line survives for the wrong reason. Read what each mutant actually removes before writing a test for it.
- Never read and write one file in one expression: `open(p, 'w').write(open(p).read() + x)` truncates the file before it is read. The BUILD-LOG lost 503 lines that way and the review caught it; read first, then write.
- Drop a mutant as equivalent only with the chain written down: a void closes a package only while unpaid, and an unpaid package is never a qualifying purchase, so the void exclusion cannot be reached through the writers.

## 2026-11-14 — T-080 Manual discounts

- In a guard, `NOT (a AND x = (subquery))` lets the row through when the subquery finds nothing: the comparison is NULL, NOT NULL is NULL, and an IF on NULL does not raise. Wrap the allowance in `coalesce(..., false)` and test the direct UPDATE that must be refused.
- A mutant that makes the migration fail to parse is "caught" by every test failing at setup. Read the failing test per mutant; replace such a mutant with a valid one.
- A new limit with a strict default (FO 0 %) changes every older suite that gave an FO discount. Grep the tests for `discount:` before the first run and set the limit in their setup.
- Start the ledger only after the worktree exists: a `cd` into a missing directory runs `delivery-ledger start` in the main checkout.
- Before closing, walk the approved plan's review sections line by line against the diff. Here four approved items (a report reader, a
  re-created guard, two invariants, a lock order) were missed at build and only the implementation review found them.

## 2026-11-14 — T-081 Promo codes

- PL/pgSQL inside a function: a `FOR rec IN SELECT … LOOP` over a `record` whose query aliases a table like an existing variable
  (`l`, `u`) fails with "record is not assigned yet" or "column reference is ambiguous". Use aliases no variable uses (`pl`, `pu`, `pcv`).
- No `CREATE TEMP TABLE` inside a definer to carry rows between loops; parallel arrays and `unnest(a, b, c)` do it without DDL.
- A mutant that replaces a statement ending in a comment (`…; -- note`) with `NULL;` can leave a broken line; anchor mutants on the
  statement without its comment and replace with `PERFORM 1;`. Two such mutants "caught" by a parse error were re-run and caught for real.
- Mutation review removed two redundant guards (an `active` re-check already done by resolution; a manual-discount refusal the snapshot
  already makes) and one equivalent mutant (a version UPDATE also fails the next-number check).- Close run 1 failed on two of my own errors, both fixed and re-run: the close script, adapted from T-080's by `sed`, kept
  `--required-by T-080`, so every scope expansion was refused; and the drift test used the regex `s` flag, which the ES2017 target
  rejects (TS1501), failing typecheck, the build and the build-driven `tests/platform/hosts.spec.ts`. After adapting a script, grep it
  for the old task id; run `pnpm typecheck` after writing any test.- The implementation review again found approved plan items missing (three tests from the plan's review section). Before closing,
  grep the plan's review sections for "test" and tick each against the test file.- Close run 3 (2026-11-14T11:03:56Z) recorded rls=FAIL (exit 1): `tests/db/promo-drift.test.ts` "the changed ones are exactly the
  declared set" — the `after` hash of `package_close_do` was `080c2208…`, the expected file still held `bce6e48e…` from before the
  review fix that removed its `invoice_void` guard. The expected file was regenerated (diff: that one hash only); rls re-run 690/690.
  Evidence `/data/tmp/clinic-dashboard/t081/failure-close3/`. Rule: after any change to a re-created function, regenerate the drift
  expected file before closing.

## 2026-11-14 — T-082 Family package sharing

- A row-lock wait does not show as an ungranted lock on the table in `pg_locks` (it waits on the holder's transaction id). To prove a
  writer blocks on a row held by another session, look for a session with `wait_event_type = 'Lock'` whose `pg_blocking_pids` contains
  the holder.
- A snapshot "at the sale instant" is only tested when the sale and the snapshot differ in time: the T-080 deferred package open
  (decision after issue) is that case; a mutant reading the switch "now" survived until it was tested.
- Mutation review removed one redundant condition (the beneficiary check re-reading the switch, already enforced by the insert guard)
  and dropped one equivalent mutant (an UPDATE of the switch also fails the next-version check).

## 2026-11-14 — T-083 Instalment schedules

- An isolation case that runs several writes on B's state must order them so each succeeds as B: here a replace (set) cancelled the
  seeded schedule as "replaced", so the following manual cancel conflicted in the positive control. Cancel first, then set.
- A guard test that changes a frozen column is caught by the identity check and never reaches the "set once" branch; test the
  set-once column itself (`reminded_on` cleared or moved after the scan set it).

## 2026-11-14 — T-084 Expenses and petty cash

- A deferred constraint trigger runs with the committing session's rights: `SELECT * INTO e FROM expenses` in a non-definer check needs
  SELECT on every column, and the app role has no grant on `receipt_content`, so every commit failed with "permission denied for table
  expenses". Integrity checks that read a table with column grants (or rows outside the session's RLS) are SECURITY DEFINER.
- `events_payload_ok` refuses JSON null values in a domain event payload; build payloads with `jsonb_strip_nulls` when a key is optional.
- An isolation case cannot nest `withTenantContext` (one role inside another): run each role's call on its own, then combine.

## 2026-11-15 — HYG-018 Time-of-day test fixtures

- A test date compared with a branch-local day must be built in the branch timezone: `new Date().toISOString().slice(0, 10)` is the UTC
  date, a day behind Jakarta from 00:00 to 07:00 WIB. Use `tests/support/dates.ts` `wibDay`.
- A time slot clamped to "before midnight" collapses several slots into one late in the day; count slots back from the last one instead
  (`arrivalSlot`). Night runs (and night CI) expose both.

## 2026-11-14 — T-085 Tutup Kasir

- Adding a column to a table breaks every function that builds its row positionally (`ROW(...)::public.<table>`): `refund_request`
  failed with "cannot cast type record to public.refunds". Before adding a column, grep `::public.<table>` and re-create those writers.
- A guard that compares an explicit column list lets a new column through unchanged; one that compares `to_jsonb(NEW) - [...]` would
  not. Check which form a guard uses before deciding whether it must be re-created.
- A counter sale of a product needs an active stock item (`product_without_stock_item`), and a refund needs a patient on the invoice
  (`invoice_without_patient`): fixtures must provide both.

## 2026-11-15 — T-087 commission engine

- A test fixture that confirms a selection as a BC makes that BC the closing and guiding BC by default (`selection_confirm`); confirm as
  the FO when the test names the BCs.
- A treatment start needs the initial bill paid (`treatment_payment_unpaid`): pay before treating in fixtures.
- An initial bill's line carries no `plan_item_id`; match an execution to its line as `refund_line_delivered` does (the plan item, or the
  plan item's service = the line's item).
- `sum(bigint)` is `numeric`: cast before passing it to a `bigint` parameter (`kasir_allocate`).
- A server-action form that leaves the page once it succeeds (a decided draft, a paid batch) never shows its own success message:
  redirect with a flag and let the page show it.
- A page that lists catalog items for a role without catalog read (finance, auditor) must get them from a definer reader, not a direct
  query (RLS returns nothing, silently).
- A page that compares a version window with "now" must take the database clock from the reader; `Date.now()` in render fails the purity
  lint.
- An addition's execution has no `plan_item_id` on the initial bill's line to fall back to: exclude additions (`addition_of_visit`) from the
  plan-item-less match, or the addition's performer takes the paid initial line.
- Every tenant table needs `UNIQUE(tenant_id, id)` even when nothing references it (05 §3.1, `tests/db/migrations.test.ts`): run the
  whole tests/db set during the build, not only the task's drift test (close run 1 failed on `payout_batch_items`).
- A package session's commission line is the package line; judging the performer on the line's item (a package, whose standard scope
  has no performer) silently drops every session's performer. Judge the performer on the executed service.
- A batch that keeps its materialized lines across a rejection reuses stale figures: delete the children when the batch returns to
  draft and let the guard allow a delete only in draft (review r1 P1-2).
- Every `sum()`/`coalesce(sum())` passed to a `bigint` parameter needs `::bigint`; three new call sites repeated the T-087 stage (b)
  error before the review fixes ran green.
- Blocking a contribution on an attribution change is a dead end when the BC is attributed again; reverse it, let accrual follow the
  active attribution and net the attribution reversals out of the cumulative step.

## 2026-11-15 — T-088 BC targets

- A target's closing value must be windowed fact by fact (allocations by created_at, deposits by decided_at, collections by the share
  collected before each bound, refunds by paid_at, moves by their entry's created_at): an invoice line's cumulative columns
  (moved_to_balance, commission_line_basis) cannot be cut into months.
- A seed name built from a short tenant-id prefix is not unique across tenants created in the same second (uuid v7 shares its time prefix):
  an isolation marker must use the whole id.
- A receivable needs a delivered unpaid remainder, and a treatment start needs the initial bill paid: build the fixture from a released
  addition, never from a partly paid initial bill.

## 2026-11-15 — T-089 WABA onboarding

- In PL/pgSQL a `CASE … END` inside an `IF` condition is read as the end of the block (`syntax error at end of input`): wrap it in parentheses.
- A refusal that must persist (the WABA's verification_required) cannot be raised: an exception rolls the state change back. Commit the state
  and return a coded reply instead.
- A command key replay must not re-generate a secret: a replayed add registers with the PIN already sealed in the row.
- A definer that takes a JSON payload and ignores unknown keys lets a plaintext secret reach SQL unnoticed: whitelist the key set
  (`p - 'a' - 'b' <> '{}'`). A mutation survived only after an order-dependent test that had masked it was made deterministic.

## 2026-11-15 — T-090 Pesan inbox

- `setting_value_at` reads the bound tenant (`app_tenant_id()`), so an unbound webhook path cannot read a setting through it: read the tenant's
  `setting_versions` directly with the same precedence.
- A send replay must not call the provider again: check the idempotency outcome before the port call, not only the queued state.
- Postgres regular expressions allow at most 255 repetitions (`{1,511}` fails at the first evaluation, not at CREATE): keep counts ≤ 255.
- Isolation case files that each seed a WABA for the same victim tenant collide on "one live WABA per tenant": a seed revokes another file's
  live WABA first and re-seeds when its own was revoked.
- A mutation that removes a definer's own check can be equivalent when a callee or a second predicate refuses the same case (the intake's
  unbound check behind `waba_route_resolve`; the tenant filter behind `inbox_readable`'s `stock_member_now`): drop it with its reason and
  mutate the layer that actually decides.

## 2026-11-15 — T-091 inbox complaint flag

- A requirement that names a source the existing definer refuses (0074's `message_source_not_ready`) needs a migration even when the task's
  allowed paths are module-only; record the expansion before editing and treat the task at the risk of what it touches (R3).
- Re-creating a reviewed function to share its body: extract an internal primitive, keep the original's checks and refusals in the original,
  and pin the before/after SHA-256 of every re-created function in the drift test.

## 2026-11-15 — T-092 leads pipeline

- A stage whose database refusal depends on an earlier fact (booking needs a matched patient) needs that earlier step on the screen too: the
  first browser run found a manual lead that could never leave Dihubungi because the match action existed only in SQL. Walk every refusal
  code to a UI path that resolves it.
- A browser spec that changes a fixture in an early flow (matching a lead to a patient renames its list title) must assert the new state in
  later flows, not the seed's.
- Escalation discipline: after "verification fails after one repair attempt" stop and ask before any further change, even a test-only one;
  the owner rejected a run made after an unauthorized second change (option B) and authorized the repair explicitly. A failing assertion
  should save the page text it read, so the cause is observed, not inferred.

## 2026-11-15 — T-093 follow-ups from rules

- A rule-generated task keyed only while open (a partial unique index) is re-created by the next daily scan after staff close it, because the
  source fact still holds; key it for ever (rule, source, step) and let the step carry what may legitimately recur.
- A scan on an unbound worker cannot use setting_value_at (it keys on app_tenant_id()); read setting_versions for the tenant directly.
- PL/pgSQL record names shadow table aliases: a loop record `r` and `FROM tenants_registry r` in the same function fail at run time only.

## 2026-11-15 — T-094 outbound consent and budget

- An unbound dispatcher cannot read tenant keys or the sealed token through the staff readers: return the ciphertext and the wrapped DEKs
  from the unbound claim, open them in TypeScript, record the result with a separate unbound complete.
- A mutation that produces invalid SQL fails the suite at load and looks "caught": the mutation runner now requires a failed assertion.
- A shared recorded fixture list is part of another task's contract when its tests count it; add task-only fixtures in the task's tests.
- In a claim loop with a budget, skip rows that cannot send (withdrawn template, number not sending) before counting the budget, or a
  row that never sends holds a recipient's slot (review r1 P3-1).

## 2026-11-16 — T-095 appointment reminders

- A tenant filter that looks untested may be held by a second layer: here the composite FK on `reply_message_id` refused a cross-tenant
  reply and the savepoint rolled it back, so the filter-only mutant survived. Prove each layer with an all-layers mutant, not by deleting
  the test.
- An isolation case that checks "nothing changed" needs fresh, unanswered victim state on every run; the positive control consumes it.
- Vitest 5 hides stdout of passing tests: to inspect a passing run, append to a scratch file, then remove the lines.
- Do not wrap a side effect of an acknowledged webhook in a savepoint that swallows its failure: the provider stops retrying on 2xx and the
  action is lost. Keep the message and its effects in one transaction and answer non-2xx so the redelivery retries the whole event
  (supervisor review 2026-11-16; regression test: a synthetic failing trigger, then the same message redelivered).

## 2026-11-16 — T-096 aftercare

- A token minted inside a function called from a claim needs the function VOLATILE (an UPDATE in a STABLE function fails at run time) and
  must read the claim time from the row, not from the caller's loop record (the claim updates the row without refreshing its record).
- Rate limits that log refusals must count only the successful sends, or a refused request extends its own cooldown for ever.
- A mutation script's DRY mode still applies each edit before restoring it: while a build, browser or close run is going, check anchors
  read-only (count each anchor in the file), never with DRY=1.
- A browser spec that injects a 200 % text style in its layout loop must reload the page afterwards, or later screenshots misrepresent the
  100 % layout.

## 2026-11-16 — T-097 automation scenarios

- A lock mutant can survive because another layer serializes the same writers (here the tenant-wide staff_access lock held by every
  caller). Probe each layer alone, then write the all-layers mutant against a test whose callers hold no lock themselves.
- A browser runner derived from a public-page task points the auth pool at the app login; a staff page signs in through Better Auth, which
  refuses that role. Take the auth URL from the seed (`authUrl`).
- An isolation action case must not paper over a consumed positive control: give each attempt its own fresh victim state.
- A page must own its main landmark when the shell leaves it to pages; a form rendered only while its object exists (a pending draft)
  unmounts on success and takes its notice with it — redirect with a whitelisted outcome code and show the notice at page level.
- Browser runs 1–3 failed (runner auth URL; no main landmark and a never-approved service missing; the unmounting success notice); each
  repair beyond the first was approved by the supervisor under the owner's delegation, and run 4 passed.

## 2026-11-16 — HYG-020 consultation event order

- Two events written in one transaction share occurred_at (`now()` is the transaction start) and their uuid v7 ids tie on the millisecond
  prefix, so `order by occurred_at, id` orders them by random bits; a test must not assert an order the event contract does not define —
  assert the multiplicity and types, and select each payload by its type. Latent since T-079; surfaced on CI after T-097 (168/400 reproduced).

## 2026-11-16 — T-098 satisfaction surveys

- Adding a follow-up rule touches three places: the schema's rule list and RULE_SHAPE (Drizzle re-creates followups_check), and
  followup_list's own p_rule filter (a hard-coded list) — the drift test pins both and the hash of the reviewed previous body.
- A score-only survey keeps clinical content out by construction; the low-score task carries ids only.
- Host gate: one task-agnostic script (/data/tmp/clinic-dashboard/gate/host-gate.sh, GATE_DIR + GATE_EXEC) with raw decimal load / io
  and suite-holder blocking (opaque holders block too), reused from HYG-020; 18 synthetic cases.
- A granted definer's idempotent replay is an authorization path of its own: re-check the stored row's scope against the current actor
  before answering a replay (review r1 P1). Validate id inputs as text before casting (P2).
- Typecheck an edited test before launching a heavy verification; a test that cannot compile turns every mutant into a load failure.

## 2026-11-16 — T-099 waitlist and the offer on cancellation

- A trigger that tests "still in the future" while a writer may have waited on a lock must read clock_timestamp(), not now(): now() is
  the transaction start (Sol r2 P2); the test holds staff_access past a slot's start and expects no offer.
- One trigger on appointments covers every cancel path (patient, clinic, deposit refund, reschedule) without re-creating any writer.
- Isolation positive controls: an add attempt as B itself needs a patient who is not already waiting (the route case seeds one).
- Review r1 (Sol 629155a6): rows that keep a frozen patient id must be compared canonically at use time (patient_canonical on both sides,
  patient_cluster for duplicates) — a merge redirects identities without moving rows. A decision about "the current offer" must name the
  offer it means, or a delayed retry decides a newer one. A keyed command whose replay is answered before the definer needs its own
  authority re-check first (waitlist_entry_authorized).

## 2026-11-17 — HYG-021 deposits reschedule targets

- A clock-derived fixture target must fit the fixture's own hours: quarter(72 h) and quarter(80 h) ended after the 23:45 closing in two
  30-minute windows a day. Reproduce at a fixed target (clock-independent) before fixing; assert the domain refusal reason.
- A mutant that changes a constant by less than the rounding step can be equivalent on aligned inputs (23:59 vs 23:45 at quarter hours).

## 2026-11-17 — HYG-022 Next.js security patch

- Next 16 stops `next build` on a known advisory (experimental.agentUpgrade 'security' is the default): a newly published advisory can
  turn a green pipeline red mid-run. Patch through the package manager with exact versions and keep the paired eslint-config-next in step;
  check the lockfile diff touches only that family.

## 2026-11-17 — T-100 campaigns and segments; launch preflight

- Domain-event payloads carry no numbers (TD-50 validator): counts go in the command's result, never in the event.
- A frequency cap that is enforced only at enqueue leaks on every path that moves a row's effective day (budget deferral, suspension
  deferral, overdue carryover): one dispatch-time check governs them all; count with the real today so a candidate never counts against
  its own destination day.
- Re-created shared functions are derived mechanically from their reviewed bodies with asserted unique insertion anchors, and the drift
  test removes exactly those blocks and compares the rest verbatim.
- A defence-in-depth check behind a TS pre-check needs its own test that calls the definer directly; otherwise the pre-check hides it.
- Launch preflight (Panel 2, 2026-11-17): create every runner path in one completed call, run gate/preflight.sh (bash -n, exists, dirs,
  restore trap) in its own completed call, then bg_run in a separate call; suites and mutations only through bg_run with an adequate
  timeout; never a short foreground wrapper. Recurring races (a file or the redirect target created in the same parallel batch as its
  launch) cost several runs before this was enforced.
- A task restarted on a new base: close the old ledger run BLOCKED, start the new run on the clean base BEFORE re-applying the carried
  work (so it is the run's own change set), re-apply with a 3-way patch that excludes the ledger's own files, and merge shared docs by
  keeping both histories; never drop the stash.

## 2026-11-17 — T-102 increment 1: SATUSEHAT foundation

- Panel 2 split T-102 into three increments (A), approved the increment-1 test and doc paths (B, recorded by expand-scope before editing) and
  manual practitioner IHS entry (C). Task and M7 acceptance stay open until increment 3.
- Read the official SATUSEHAT platform docs read-only for Q-19 (token, Patient / Practitioner by NIK, newborn nik-ibu, no-NIK search-only,
  Encounter / Condition fields, identifiers, searches, read by id, PUT / PATCH replace only, terminology document v12.0); every rule the
  guide does not state (withdrawal, conditional create) stays a manual or held path, never a guess.
- A guard trigger shared by several tables reads fields through `to_jsonb(NEW)`: plpgsql resolves `NEW.<field>` even in a branch for another
  table (dry run 1: "record new has no field outcome").
- Audit rows carry no free text outside break-glass (`audit_events_reason_check`): a staff reason is a closed code set in `reason_code`.
- A lease protects local state only; a write that may still commit remotely needs a per-resource barrier (no newer write while it is
  unresolved) and an update is confirmed by reading the content back, never by identifier presence (plan review r2).
- The worker runs each SQL step in its own short transaction with `app.deploy_env` bound; a remote call never sits inside a transaction.
- Mutation probe 1: 31/42; the 11 survivors were test gaps (the test reused the code's identifier helper; the worker hid the definer's barrier and
  fence; candidates were never ambiguous); repaired test-only and all 11 then caught.
- Gated close 1 failed on two things a full-suite probe would have shown before the freeze: an inventory test that names every trigger of the
  record tables, and the 05 §3.1 contract (every tenant table has `id` + UNIQUE(tenant_id, id); natural keys alone are not enough). Lesson: run
  the whole suite once before the first freeze of a migration task, not only the task's own files.
- Implementation review r1 found what the tests had not: a check constraint broken by the trigger's own supersede, a pass-wide clock that
  defeated the fence, and a read-back that compared only diagnoses. Lessons: a trigger on a clinical writer must be insert-only — any update it
  makes can fail on state the clinician cannot see; fence with the time at each boundary, never the pass start; confirm an uncertain write by
  the fingerprint of the exact body it sent. Synchronised tests must make the race real (a row due only for the second claimant), or the
  serialising lock survives its mutant.
- Never edit a test file while a mutation run is going: the run then mixes two test files and is not evidence.
- A read-back comparison is a projection of what the writer controls, not equality with what the server returns (a server may add a narrative
  or a display); and anything pinned must be read back from the pin, never from today's active row.

## 2026-11-17 — T-102 increment 2: the other SATUSEHAT resources

- One rule for every resource type on a correction: re-pin every input and advance without a send only when the fingerprint is equal; a
  "the source is immutable" shortcut is wrong because a map or a practitioner id can change between revisions (addendum review).
- Where the guide documents no search (Medication), an uncertain create is a person's decision — never a fallback search, never a retry.
- A link whose inputs are incomplete has no pin; the worker builds only queued or uncertain links that have one.
- Test helpers must match exact keys: a prefix match hid a renamed key from every assertion (mutation probe).
- Re-queue paths each need their own proof: two releases applied together hide either one missing.
- A fingerprint projection must list what the writer emits even inside arrays it owns: a provider may append extensions (review r1).
- A refused cross-tenant call is proven by the victim's unchanged state (maps, audit, queue), not only by the error code.

## 2026-11-17 — T-102 increment 3: the SATUSEHAT page

- Project per role in the database, one reader, sections by role; the page only renders what came back (07 :63 is the contract).
- A clinical-class body read that is audited per opening belongs on its own page: a list that embedded it would audit reads nobody made.
- Do not offer an action that cannot help: a visit held for a missing room or identity re-holds on Kirim Ulang; name the fix instead.
- A label built from a type name and a noun repeats itself for the type that is the noun (Kunjungan · kunjungan); special-case it.
- A one-off lookup that keeps a sealed identifier for minutes is still storage; describe it so, and do not build it without need (Panel 2).
- Derive an action's eligibility from the command's own predicate and prove it by running the command over every state the page shows (review r1).

## 2026-11-17 — T-103 increment 1: vendor server-fee billing domain

- An undecided money policy is a gate in code, not a default: NULL closes the action and names the owner decision (Panel 2).
- An issued document that can never change must not be issued while one of its inputs (VAT) is unknown; block issuance instead.
- `creating` does not prove the provider was not called: recover to `unknown`, never to `failed`, and let a late answer learn the id once.
- A settlement on an invoice that was meanwhile credited or waived is still money received: allocate up to the payable, credit the rest.
- Sequential tests cannot see a missing lock; force the interleaving (a blocker holds the row locks while writers queue) and check a ledger invariant.
- A lock mutant that survives alone is not proof of redundancy: name the covering layer, keep the guard, and kill the combined mutant.
- Keep the probe's survivors as evidence; the matrix that counts is the one rerun on the final freeze.
- A non-2xx answer to a create is not a provider rejection: only a 2xx with a validated non-success code is; anything else is unknown (review r1).
- Every worker that takes several tenants' locks takes them in one order (tenant id); prove it with a forced queue order, not a parallel launch.
- A fixed-width pad truncates in PostgreSQL; identifiers that grow need minimum-width formatting and a boundary test.

## 2026-11-17 — T-103 increment 2: the billing pages and the console entrypoints

- A privilege moved from a worker login to the app (the Bayar finish) needs its own capability: a one-time per-attempt token, hashed at rest,
  never on a replay, checked in constant time, on an unbound connection only — and the old signature dropped, pinned by the drift test.
- Pinned inventories exist to force a decision: each new console entrypoint is added by exact name, with the structural re-check rule kept.
- A role check can hide a missing rule: requester ≠ approver needs a test where one person holds both roles.
- A shared CSS module's class can be mobile-only (`.cards` hides at ≥ 700 px): look at the desktop screenshot, not only the metrics.
- Do not invent a provider URL policy the provider never published; render only https and say so.
- A global lock taken inside per-tenant locks deadlocks as soon as a second caller locks tenants in a different order (the worker loops over
  tenants; a console issue locks one). Force the interleaving in a test, prove it fails on the old code, then remove the global lock — here a
  sequence replaced a per-month advisory lock + max().
- Read the contract's UX rows against the build before calling a task done: three named items (a receipt, a reminders list, a primary action)
  were missing until the acceptance matrix checked them.

## 2026-11-18 — T-104 accounting step 1: sub-ledgers, roll-forwards, exports

- A derived ledger is only as good as the dates its facts carry: a cumulative column ("VAT recognised so far", first timestamp kept) cannot
  be split by month. Record the delta where the writer computes it (six INSERT-only seams), and give history before that a single honest
  residue at a stated cutover instead of a guessed date.
- Signs are a contract, not a detail: a reversal counter going up is the VAT position going down. State the sign rule once and assert the
  signed delta and the resulting closing in every seam test (a sign-flip mutant must fail).
- "Known" means stored. An application whose transferred amount was never written is not a known movement, however tempting the deposit's own
  figure is; leave both legs in the residues.
- Prove an INSERT-only re-creation mechanically: the new function body minus the added statements equals the old body line for line.
- A test fixture that flips a shared tenant setting (PKP) leaks into every later isolation case of that tenant; scope it to the call.
- A net-of-VAT liability computed from its own VAT *estimate* drifts as soon as a mutable field changes (a substituted session's tax
  category). Compute it as money minus the VAT movements of its objects — the same rows the VAT ledger sums — so the two cannot disagree.
- A mirror field (a redeemed session's VAT recognition) is not a fact until something records its changes: record the value at the moment it
  leaves the liability and every later change (S1b before the sync, S5b in the sync loop), net zero in the VAT ledger.
- An object-level comparator must read stored state the movement reader does not use; a check that recomputes the reader's own formula
  cannot fail. Prove each comparator with a fixture that corrupts one stored fact.
- A reconstruction of history must be a function of the history: any "only one such event" or "no deposit applied" test that counts rows
  without bounding them to before the cutover lets a later fact silently rewrite a closed month.
- "Complete from date X" must use the date each residue row is actually reported on (its branch's time zone), not one tenant-wide day.
- A comparator that did not run is not a pass; return a status, and let the UI say "not checked".
- A comparator of a writer's rule must restate that rule (state filters, exceptions) exactly; a stricter guess reports valid data as wrong.

## 2026-11-18 — HYG-023 A-12: VAT at delivery when delivery precedes payment

- A tax point that is "the earlier of two events" needs a writer at both events. Recording only the money event dates the VAT late
  whenever service comes first; share the payment writer's rounding and keep both monotone so the second event adds only the remainder.
- When a delivery is recognised at a later instant (the line is issued after the work), store the true tax point on the line but date the
  ledger event no earlier than the cutover the readers start from; otherwise a pre-cutover delivery billed later vanishes from both the
  event stream and the cutover residue.
- Before adding a recognition point, list every writer that later rewrites or refuses the same field: a pending manual discount rewrites
  `vat_amount` and refuses a line with recognised VAT; a void of an unpaid invoice keeps it. Skip or settle those first.
- A stated limit is a test too: the case that stays at payment (a visit product with no stored line key) is asserted, not just written.
- A mutant that survives is a finding, not noise: `share-ignored` survived because no call site delivers a partial share, so the approved
  share rule was untested — prove it on the helper. `not-pkp-at-issue` survived because it is equivalent (`vat_amount > 0` only on a
  PKP-at-issue invoice): record why and replace it with a mutant that can fail.
- A new recognition point needs its reversal path: a void of an unpaid invoice is allowed, so once VAT is recognised before payment the void
  must reverse it (`line_void`), or void-then-rebill counts the VAT twice and strands −VAT in the liability.
- Mutation anchors must stay unique as the file grows: two writers sharing a lateral subquery made two earlier anchors match twice; widen
  the anchor, never the mutation, and re-check every anchor with `DRY=1` before running only the delta mutants.

## 2026-11-19 — T-105 accounting step 2: general ledger (preview)

- A posting consumer runs in a service context with no role, so RLS hides the rows a plain function reads: the balance check saw an empty
  entry and refused every posting (23514). Read-your-own-writes checks and the posting rules run as SECURITY DEFINER, granted to nobody, behind
  one granted entry point that refuses another tenant's event.
- A deferred constraint trigger is the right place for "every entry balances": rows are inserted one by one, the check runs once at COMMIT.
  Pair it with a guard that lets lines be written only by the transaction that created their entry.
- Do not write configuration rows that tests or other modules own at migration time for every tenant (the posting-map version): record it at
  first use and never overwrite a recorded one.
- "Blocked export" is not "official books". When the books are not authorised, keep the authorisation state explicit (an activation table
  with no writer) and make every view say preview; evidence alone must promote nothing.
- A refusal that must be audited cannot raise: the raise rolls the audit row back. Return the refusal and let the caller map it.
- Shared lateral subqueries make mutation anchors match twice; scenario tests on the real writers find the joins a hand-built fixture hides
  (an anonymous counter sale cannot be refunded to balance; purchasing is tenant-wide; a rejection needs a reason).
- Reconcile scenario tests against the fixture journal by journal (S1-J1…S20-J2), not scenario by scenario: "scenario 12a covered" hid that a
  package session's difference line was never recognised. A fixture row marked PENDING still has signed amounts to assert; assert those and
  name the unsigned part as the acceptance gap.
- An outbox claim that skips leased or locked rows gives no ordering between events. A rule that reads another entry (a mirror) instead of an
  immutable fact is order-dependent: returning "nothing to post" when the original entry is missing acks the receipt and loses the reversal.
  Post the original from its fact first (same posting key), then mirror; date the mirror at the domain reversal, never at the worker's clock.
  Reproduce with the real worker by holding the original's receipt under another worker's live lease.
- A posting rule that reads a mutable fact (a line whose discount is still pending) freezes whatever it saw first. Wait while the fact is
  not final and wake on the event that finalizes it (subscribe the consumer to that event) instead of raising for a retry: a retry budget
  is finite, a pending approval is not. Then test early and late consumption for every decision outcome, and exhaust the retry budget in
  the test to prove the wait does not depend on it.
- Key a derived entry by the exact facts it values: an entry keyed per execution froze whichever line it saw first, so a void and a re-bill
  at another price diverged with the consumption order. Keyed per (execution, line), the void mirrors its own line's entry and the re-bill
  posts its own — assert every order, including the reversed one, and the GL against the sub-ledger.
- An identity the UI knows but the database drops (the selection row behind an invoice line) cannot be recovered later without guessing.
  Capture it at the writer that creates the line, validate it server-side under the same lock as the uniqueness rule, make it immutable,
  and leave every row without it explicitly open instead of backfilling by a heuristic.
- An unresolved accounting case that must not be guessed can still be made visible: count it from business facts with the reader roles
  and window of the page it lives on, state its semantics (event date, link state as of now), and never derive it from event receipts or
  show a cause the facts cannot prove.
- uuid v7 ids generated in the same millisecond do not keep insertion order: order test rows by a business column, not by id.
- A new link (selection → line) can re-open a tax limit that was justified by the missing link (HYG-023 Q4): when a key is added, re-check
  every rule that was "out of scope because no key" — here delivery VAT for products, closed by reusing the existing seam, not a new one.
- A join from one line to every counter-line multiplies the line's amount by the number of counters: attribute per entry, by weight, and
  assert the attributed parts sum to the original (a PKP payment has two liability counters).
- In PostgreSQL `sum()` of bigint returns numeric: integer division and remainder over it need a cast back to bigint, or the "integer"
  split silently becomes fractional.
- A flag that is forced true for a filter (`OR p_branch IS NOT NULL`) hides the very case the filter exists to show; report the fact.
- Moving a late fact to the next open period must move it in the readers too, or the locked month still changes.
- Size intermediate products by the column bounds, not by typical amounts: two bigint money values multiply past bigint; compute the
  product in numeric with integer div / mod and cast only the bounded results.
- A drift proof by "body minus marked blocks = old body" needs whole-line blocks: change a statement by adding a marked block next to it,
  not by editing inside a shared expression.

## 2026-11-19 — T-106 Coretax XML export for PKP tenants (gated)

- Build tax documents from the frozen invoice-line snapshot (`vat_base`, `vat_amount`, `tax_category`) and the refunds' `vat_reversed`, never
  from the catalog or today's settings; produce the XML in the database (`xmlelement` escapes text; strip control characters first) and log
  the SHA-256 of the exact UTF-8 bytes in the same transaction that serves them.
- A published template outranks a brief's paraphrase of it: DJP's retur `TransactionDocument` is a code (`01`–`10`), not a document
  number, and `SerialNo` is `xs:long`. Vendor the official samples and the XSD embedded in the converter workbook (`xl/xmlMaps.xml`) with
  their SHA-256 and check element order against them; Excel-inferred XSD numeric types (`xs:byte` for VAT) are not real limits.
- The clinic's VAT split (amount − ROUND(amount × 100/111)) and DJP's retail formula ROUND(12 % × ROUND(11/12 × DPP)) disagree by ±1 rupiah
  on about 10 % of amounts. Export the frozen value and count the differences; never silently recompute a frozen tax.
- A serial derived from a month's ordering must only use facts that never change after the month (issue time, ids), so a later void never
  renumbers a document already uploaded.
- Two feature gates on the same obligation cannot be told apart by any fixture: a mutant that swaps them is equivalent; record it as dropped.
- A same-day void may be decided by the manager (SET-43); a void of an earlier invoice is the owner's — test fixtures that backdate an
  invoice must use the owner.
- Isolation cases that make a shared tenant PKP or approve its evidence must undo it afterwards (later cases see tenant B as non-PKP).
- An "empty" document can still be a required artifact (DJP's TaxInvoiceBulk envelope with an empty list): do not let a zero-row guard turn a
  structural deliverable into a refusal. And state a numeric ceiling explicitly before a table check or a JSON number does it for you: a
  check violation is not a named refusal, and a sum above 2^53 is not an exact JavaScript number. When a reader withholds totals, check every
  place that renders them (cards AND the headline KPI): a placeholder 0 must never reach the screen as "Rp0".


## 2026-11-19 — T-107 dashboard read models and the UX-60 role homes

- A KPI reader that returns fact rows (branch, local day, part, amount, source record) and sums them in one place gives the total, the
  branch view and the drill-down from the same rows: the drill-down sum equals the total by construction, and a test can assert it.
- Prove a KPI with one fresh tenant per KPI on facts written by the real writers; a shared tenant lets an earlier test's facts leak into a
  later total (a K12 booking widened K15's covered minutes until the K15 test used its own days).
- When the writers stamp the wall clock, a dated option (K4's aging anchor, K12's 24 h window, K15's intervals) needs seeded dates that tell
  the options apart; keep those seeds in one block with the triggers off only for the insert, and test the rest through the writers.
- A UNION's untyped `NULL` takes the type of the other branch only in its first SELECT; cast it (`NULL::uuid`) in every later branch, or
  PostgreSQL types the column as text and the insert fails.
- An alias named like a record variable in PL/pgSQL (`a` for both the actor and a table) is ambiguous at run time, not at create time: the
  migration applies and the reader fails on first call. Give table aliases names the function never declares.
- A browser check at 200 % text on a 390 px phone finds what a 1440 px screenshot cannot: a status badge beside a name squeezed the name to
  one letter per line; put secondary badges under the link. Read the screenshots, not only the assertions (a lower-cased label lost
  "SATUSEHAT" to "satusehat").
- A mutant that survives because the fixture lacks the case it changes (a void, a count line counted exactly) is a missing fixture, not an
  equivalent mutant: add the case through the real writer and re-run the mutant.
- A test that builds "a slot one hour from now" fails after 23:00 local time whenever the code under test checks "today": round the slot
  and move it to now with fixture surgery, or pin the clock. A late-evening full suite is a test in itself — keep the failure, find the date
  arithmetic, and fix the fixture rather than re-running in the morning.

## 2026-11-20 — T-107 r3: historical KPIs from dated facts (review 3ba1bf52)

- A period-end KPI must subtract only facts dated up to that end. A helper that sums "everything so far" (here `kasir_line_paid`) makes
  a historical report change when later activity happens. A stored current-state column (`cancelled_amount`) is history only if a dated
  fact proves when it happened. Otherwise report the figure as incomplete, never a guess.
- Owed balances (commission) come from dated movements: accruals, adjustments, and the net actually paid at `paid_at`. Do not use the
  payout batch's current state, which is not history (a rejected batch loses its items), and do not let a carried-forward negative be
  subtracted twice.
- A utilisation denominator must be the population that can produce the numerator (eligible performers), including idle members.
- Compare SLA thresholds on exact seconds; round only for display.
- Branch-scoped permits and branch-independent registrations need different branch rules. Reuse the existing readable-predicate's rule
  rather than "any staff_branches row".
- r4 (re-review 3dcdb005): "eligible" must reuse the authoritative predicate (`booking_eligible`, with its named `assists` demotion)
  per version in effect, not a look-alike over all eligibility rows. Lossless comparison means the stored unit carries the source
  precision (microseconds for timestamptz); converting to a public unit happens once, at serialization. A count computed against a
  per-row historical threshold must not be labelled with today's threshold; return the mix.

## 2026-11-20 — T-118 vendor platform health (UX-45), rebased onto T-107

- A page-level CSP with a style nonce refuses inline `style` attributes, even on a loading skeleton. Use classes; the browser console is
  the only place it shows (24 violations in the first run).
- `overflow-wrap: anywhere` lets the browser shrink a table column below its longest word and split it mid-letter ("WhatsAp p"). Numbers
  get `whitespace-nowrap`; text columns use `overflow-wrap: break-word`.
- Integer `ORDER BY 1` with a `COLLATE` clause is a column position, not an expression; write the expression.
- Renumbering a parked migration after another lane lands: move aside the untracked snapshot that the new base now tracks, fast-forward,
  open the fresh ledger, then run `drizzle-kit generate --custom` against the real journal and copy the body in. Check that the journal
  is the base plus one entry, the snapshot body equals the base's last one, and prevId equals its id.
- r2 (review 1d2a370d): a monitoring reader must reuse the worker's own eligibility rule (here `outbound_claim`'s branch-local day), not a
  simpler look-alike, or eastern-timezone work hides until Jakarta midnight. Put the aggregate in a small internal function that takes
  `p_now`, so a test can pin the instant without a clock override. A current stock (dead letters) is not a flow: if no event time is
  recorded, report the flow as not measured rather than relabelling the stock or borrowing another timestamp.

## 2026-11-19 — T-102 increment 4: TD-31 practitioner NIK lookup (ephemeral, worker-run)

- Make erasure a constraint, not a convention: `CHECK ((state IN ('pending','leased')) = (nik_enc IS NOT NULL))` refuses a terminal row that
  keeps a NIK and an open row without one; the record step then cannot "forget" to clear it.
- Seal a secret bound to the row it belongs to (staff + lookup id inside the AEAD plaintext) and generate that id in the server before the
  INSERT, so a ciphertext moved to another row or tenant cannot be opened as the wrong person's NIK.
- Re-check authority at the moment the effect happens (the worker's record), not only at request time: a facility head who loses the role
  between request and record must not create a link.
- `domain_events` payloads may not carry JSON nulls: build them with `jsonb_strip_nulls`.
- A worker audit row has no staff: use a service identity (`satusehat.worker`) with a reason code only.
- Bound definers that depend on `satusehat_env()` need the deploy env bound in the module call (`bindDeployEnv`), or a test tenant reads as
  production and every sandbox credential check fails.
- r3 (review b62a4c56): a worker that writes on a user's behalf must join the same tenant serialization as that user's writers and the
  authority changes (here the `staff_access` advisory lock), taken before any row lock in the same order as the bound path, and judge
  authority after the wait. Re-read the clock after every await that precedes disclosing a secret; acquire tokens before opening the secret.
- r4 (review 44a609f4): a fence time captured before a lock wait is stale after it. Read the clock after the last lock; if a test clock is
  injected, advance it by the measured wait instead of trusting the caller's instant.

## 2026-11-23 — Integrated M8 reporting baseline

- Migrations `0127`–`0130` are on main: vendor health (`9de482f0`, CI 44692882076), SATUSEHAT practitioner lookup (`3f0e726e`, CI 44784435200), reconciliation (`00df0033`, CI 44852176223), and report readers (`4f685eda`, CI 44882577653). External SATUSEHAT acceptance remains open.
- Mounted Recon and the report suite, plus the Owner, Cabang, FO, BC, CS, Finance, and Admin Pusat summaries. `STATUS.md` records exact CI and outstanding acceptance gaps. The first report-mount CI failed on a shared synthetic branch fixture; `e5670c2d` separated the Perawatan fixture and CI 45008959231 passed. T-019 now reads the compliance register date as calendar text (`de832388`, CI 45031866145).
- Test-only reporting follow-ups: `83891200` (dashboard KPI fixtures, CI 45063804380) and `a3414213` (K19 report fixture, CI 45064979095). The K7 label cleanup `6c00bf4c` (CI 45066187931) did not change KPI logic.
- At `b7fdd645` (CI 45068171413), Ringkasan Cabang counts current and older open visits awaiting payment using the existing branch-scoped reader. A refused read remains unavailable. Evidence: ledger `RUN-20261122T203937Z-9a9cc8a7`, 36 PostgreSQL tests, route isolation, and UX-21 browser checks (14 flows / 40 layouts). No new grant or migration.
- Keep implementation evidence separate from M8 closure and activation: the digest is not integrated, the owner walkthrough is unrecorded, and the books remain preview-only. Preliminary J8 is not final acceptance. See the current panel checkpoint in `STATUS.md` and the as-built map in `ARCHITECTURE.md`.


## 2026-11-23 — HYG-NAV-2 navigation pages

- 10 orphan routes found by the T-130 audit (PR-86) over existing readers and commands. The write surfaces are merge / unmerge, package
  sharing, and depot create / move, all through existing commands. No migration; `nav.ts` already listed the routes.
- Rebaselined from `c7f29c4e` onto `1042ffa6` with 0 conflicts. One isolation fixture line moved the seeded draft payout-batch month
  2018 → 2021: the full gate showed that an earlier open draft blocks `komisi.cases.ts` submits on the shared victim tenant
  (`earlier_batch_open`).
- Evidence: run `RUN-20261123T081540Z-d9f838fe`. Typecheck, lint, full isolation (231 passed), UI 29/29, browser 18 flows / 112 layouts.
  Independent R3 re-review APPROVE (codex `cx/gpt-6.2-sol`, panel 3).

## 2026-11-23 — HYG-NAV-1 navigation pages

- 10 orphan routes (PR-86): Saya (target, jadwal, notifikasi, tampilan, bantuan), Staf target, Persetujuan (koreksi, matriks) and Lead
  (tindak lanjut, survei). The authorized shell mounts `ApplyTampilan`, so reduce transparency survives a reload. Two server actions
  re-check the rendered context before writing. No migration.
- HYG-NAV-2 is on main: `50dd8d94`, CI 45141633374 green. HYG-NAV-1 was fast-forwarded onto it. The 30 candidate files are identical to
  the reviewed freeze. Combined checks: full isolation with both case files (243 passed, 1 skipped) and UI 51/51. Independent R3
  re-review APPROVE (codex `cx/gpt-6.2-sol`, panel 3).
- Follow-up outside this scope: `src/app/(app)/pasienku/load.ts` held its `/saya/target` and `/lead/tindak-lanjut` links until these
  routes existed.

## 2026-11-23 — T-117 owner daily digest (PR-80, migration 0131)

- `digest_runs` holds one run per tenant per local business day. The claim runs unbound. The facts read is bound to the claimed tenant,
  with no staff and no roles. Dispatch re-checks the lease generation, lifecycle and the current SET-37 recipients after its locks.
  Receipts are durable, and a dispatched run is never recorded as refused (CHECK + trigger).
- K1 / K2 are extracted from `dashboard_kpi` into internal helpers, with output unchanged; the dashboards and reports suites run
  unmodified. The six exception counts carry the Ringkasan Owner meanings, uncapped.
- Review history (panel 3, codex `cx/gpt-6.2-sol`): r1 found the send unfenced by the lease and send-time authority missing; r2 found
  the clock read before the locks and process-local idempotency; r3 found the DB mock unsound, so r4 removed it and narrowed the
  contract to provider idempotency on `digestKey`; r4 and r5 found a receipt-vs-closure rollback, a refusal after first dispatch, and
  identifiers spliced across figures; r6 APPROVE (a rendered-text scan with figure-span exemption).
- Lesson: an at-most-once guarantee cannot be emulated inside a mock of the provider. Narrow the contract to what our side can enforce
  (one authorized dispatch per generation, no false outcome) and require the provider's idempotency key at activation.

## 2026-11-23 — T-117 hotfix: TEN-19 operator class for `digest_runs` (migration 0132)

- CI 45155189295 on `0e5bd462` failed one test: `tests/vendor/support.test.ts` "every tenant table has an operator class". 0131 added
  the tenant table `digest_runs` with a `scope_map` row but no `support_object_kinds` row.
- 0132 adds `('public.digest_runs', 'never')`, the same as `satusehat_outbox`: a vendor support session never reads a worker queue.
- Lesson: a migration that adds a tenant table must run the full `pnpm test`, as CI does, before the push. The targeted suites (digest,
  rls, migrations, isolation) did not include the TEN-19 coverage test.
- The local full suite then failed one more test: HYG-NAV-2's "no migration and no nav.ts change in this batch" read `git status`.
  It fails on any worktree with an uncommitted migration and passes on a clean CI checkout. Removed it, because batch scope is the
  delivery-ledger boundary's job.

## 2026-11-24 — HYG-026 TOTP step-up producer, T-119 M8 evidence, unified checkpoint

- **HYG-026** (`40cc4e99`, CI 45314572999). The auth factory issues the signing `StepUp`; it can no longer be fabricated as
  `{ verified: true }`. The proof is TOTP-only, bound to the session, valid ≤ 10 minutes, and verified under the tenant lock. No
  migration. Independent R3 review needed seven rounds: proof binding, the challenge fallback, provenance, then a run of TOCTOU orderings.
  The lesson: decide on state read after the last wait, under the lock the writers take. A missing proof or binding always fails closed.
- **T-119** (`dc3a9ee5`, CI 45323638379). M8 exit evidence: gated m8-flow 27 / 0 / 1 todo, and `pnpm test -- m8` 3791 / 0 failed.
  - Every settled KPI is exact on one fixture month, and 17 branch / term movements are exact.
  - The checker pins exactly two owner amendments.
  - Independent R3 review: f1–f3, plus the unified u1 on top of HYG-026.
  - **M8 has not exited.** The owner walkthrough and T-102 TD-31 are OPEN.
- **Lessons from this wave:**
  - A migration that adds a tenant table needs a `support_object_kinds` row (TEN-19), and the full suite must run before the push. The
    targeted suites missed it, so CI 45155189295 went red; hotfix 0132 fixed it.
  - A test that reads `git status` fails on any worktree with uncommitted work, so it was removed.
  - An exactly-once guarantee cannot be emulated in a provider mock. The digest contract was narrowed to provider idempotency on
    `digestKey`.

## 2026-11-24 — T-119 M8 exit closed on main (`73773b26`, CI 45391453121)

- Reconciled independent R3 review (`R3-REVIEW-e1-panel1.md` REQUEST_CHANGES) under owner-authorized Option 1: amended canonical `TASKS.md:1402` Done-when timing so manual walkthrough J1–J8, J10 is mandatory post-M9 synthetic staging acceptance under `DEC-034` (not signed off, not an M8 exit prerequisite), aligned `docs/evidence/m8/README.md` and `STATUS.md`, and kept `T-102 TD-31`/`TD-34` external sandbox acceptance explicitly open.
- Independent R3 approvals: `R3-REVIEW-e2-panel1.md` (Panel 1) and `R3-REVIEW-e2r2-pi-sol.md` (`pi` `9router-fantastico/cx/gpt-6.2-sol`, after updating stale `STATUS.md` Next verified action lines). Ledger `RUN-20261124T111142Z-4f88726e` PASS (failed e1 `RUN-20261124T095701Z-7700d9e7` and all 3 immutable freezes preserved). Exact-SHA CI `45391453121` green.

## 2026-11-24 — T-120 residency configuration and ARCH-10 real-patient gate (PR-36, migration 0133, R4)

- Added `drizzle/0133_real_patient_gate.sql` (`platform_environment`, `residency_attestations`, deploy-only `residency_attest`, dual-marker `residency_is_production`, wall-clock `Asia/Jakarta` `real_patient_gate` with `release_digest` + canonical `deployed_locations_digest` (`app.residency_config`) + `file_sha256 === residency_opinion_checksum` binding, lock-ordered `real_patient_gate_assert`, Owner / Admin Pusat `real_patient_gate_status`, HYG-024 `inconclusive` opinion fold-in, and drift-pinned call sites in `vendor_go_live_blockers`, `patient_register`, `booking_create`, `booking_confirm`, `deposit_receive`) plus `drizzle/meta/0133_snapshot.json`.
- Added `src/modules/platform/residency/{config,gate,index}.ts` (ARCH-9 zero hard-coded providers/regions/countries; `bindResidencyContext` binds `app.deploy_env`, `app.release_digest`, and `app.residency_config` in patient registration, booking, and deposit writers) and fixed two HYG-027 `ARCHITECTURE.md` nits (`verifyStepUp` lock order, `reporting/digest` migration range `0131–0132`).
- Gotcha: `0133` intentionally inserts no row into `platform_environment` (a missing row fails closed as production); throwaway test databases explicitly insert `'local'` in `tests/rls/harness.ts` (`platformEnv` option) once migration `0133` exists. Direct SQL tests outside `bindResidencyContext` (e.g. `tests/patients/registration.test.ts`) set `app.deploy_env = 'local'` when exercising synthetic registration without production attestation.
- Integrated at `088e5a92`, exact-SHA CI `45411724713` green on attempt 1 (two-family independent R4 APPROVE: `R4-REVIEW-r2-sol.md` + `R4-REVIEW-r2-opus.md`; ledger `RUN-20261124T122555Z-00f85d25` PASS).

## 2026-11-24 — T-121 data-subject requests (PR-50, UX-30 ▸ Permintaan, migration 0134, R3)

- Added `drizzle/0134_data_subject_requests.sql` + `drizzle/meta/0134_snapshot.json` (`data_subject_requests`, `data_subject_request_links`, `record_copy_handoffs`, Drizzle `.enableRLS()` so snapshot `isRLSEnabled = true`, zero direct grants to `clinic_app`/`clinic_vendor`/`clinic_operator`, TEN-19 `support_object_kinds = 'never'`, monotone/append-only immutable guards, 10 `privacy_actor('data_request')` SECURITY DEFINER readers/writers).
- Closed all 8 revised plan findings plus R3 r1 review (`R3-REVIEW-r1-sol.md`) P1s: confirmed `record_copy_handoffs` artifact SHA-256 + handoff separation (`dsr_confirm_copy_handoff`, excluding merely requested copies from `dsr_link_options` and refusing them in `dsr_link`), `FOR SHARE` row locking on `dsr_list`/`dsr_get`/`dsr_link_options` with two-session concurrency regression test, `correction_scope` (`demographic` cannot close `fulfilled` via clinical links; `clinical` requires correction version or approved+applied correction with `addresses_request=true`), D3 `erasure` never `fulfilled` even with zero history, D4 `restriction` live cluster consent verification (re-grant blocks closure), one-time pre-verify `dsr_bind_subject` + dynamic `patient_cluster` revalidation at close, finite 72h class-F timestamps, authority-first SQL `input_sha256` replay conflict detection.
- Mounted `/privasi/permintaan` and `/privasi/permintaan/[id]` with UX-30 segment link from `/privasi`, explicit operator handoff confirmation (`ConfirmCopyHandoffForm` + `confirmCopyHandoffAction`, backed by `dsr_link_options().unconfirmed_record_copies` and transactional DSR-boundary validation inside `dsr_confirm_copy_handoff(p_id, ...)`), DEL-2 isolation cases (`tests/isolation/cases/privasi-permintaan.cases.ts`), and Playwright UI validation (`tests/ui/privasi-permintaan.spec.ts` proving unconfirmed-copy refusal -> explicit handoff confirmation -> link -> fulfilled closure through the real UI).
- Integrated at `61640f57`, independent R3 APPROVE (`R3-REVIEW-r4-sol.md`, `gpt-6.2-sol`), ledger `RUN-20261124T141430Z-9376fde4` PASS.

## 2026-11-24 — T-122 tenant full export job with manifest, 24 h expiry, and HYG-026 step-up (PR-52, UX-32, migration 0135, R3)

- Added `drizzle/0135_tenant_export.sql` + `drizzle/meta/0135_snapshot.json` (`tenant_exports`, `tenant_export_files` with Drizzle `.enableRLS()`, zero direct table grants, TEN-19 `support_object_kinds = 'never'`, generation-fenced file storage with SHA-256 check, 5 owner-only definers behind `export_owner_actor()`, 5 unbound fenced worker definers behind `export_unbound()`, and staffless/roleless `REPEATABLE READ` `export_snapshot_read`).
- Closed all 9 findings of `t122/WAVE1-PLAN-REVISED-20261124.md`: real `HYG-026` `StepUp` verified via `verifyStepUp`, `POST`-only `/ekspor/[id]/unduh` (`405` on `GET`/`HEAD`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`), post-integrity audit commit + separate-tx denial audit (`export_audit_denial`), exact-generation file fencing + atomic stale-generation purge on finish, strict 1-to-1 `verifyManifest` bound to `(tenantId, exportId, generation)`, decoupled ready/failed purge in `export_expire`, pilot ceilings (`20 MiB` file / `256 MiB` total / `10_000` files → `limit_exceeded`), local-ID FHIR R4 + `renderPdf` PDFs + clinical media bytes + 13 formula-safe CSV families via `toCsv`, and honest `not_measured` `/ekspor/backup` page.
- Mounted `/ekspor`, `/ekspor/backup`, POST-only `/ekspor/[id]/unduh`, worker `src/workers/export.ts`, DEL-2 isolation cases (`tests/isolation/cases/ekspor.cases.ts`), and Playwright UI spec (`tests/ui/ekspor.spec.ts`).
- Integrated at `0770321c` (exact-SHA CI `45550687412` green), independent R3 APPROVE (`5422262d`, Claude Opus 5.5), ledger `RUN-20261124T163435Z-4e46a440` PASS. Worker and 24 h purge scheduling remain open before live PR-52.

## 2026-11-25 — T-123 public site generator & Situs Klinik admin (PR-64, PR-65, PR-2, UX-50, UX-51, migration 0136, R3)

- Added `drizzle/0136_public_site.sql` + `drizzle/meta/0136_snapshot.json` (`public_sites`, `public_site_versions`, `public_web_fields`, `vendor_legal_templates` with Drizzle `.enableRLS()`, `REVOKE ALL FROM PUBLIC`, TEN-19 `support_object_kinds = 'never'`, `public_site_reserved_slugs()` parity with `RESERVED_SEGMENTS`, slug immutability bound to `first_published_at IS NOT NULL`, 8 bound admin/review/publish definers behind `_site_actor`, and unbound `public_site_by_slug`).
- Closed all 8 findings of `t123/WAVE1-PLAN-REVISED-20261124.md` plus Panel 1 nested-snapshot preflight (`t123/PANEL1-PREFLIGHT-NESTED-SNAPSHOT-20261125.md`): authoritative SQL snapshot construction in `site_commit_publish` with strict top-level and nested key allowlists (`_site_format_id_int`, `_site_canonical_legal_pages`), live Q-15 counsel approval re-check at publish and serve time, live branch publish window and reason-free 30-day `branch_closures` overlay, `BOOKING_HOST` `Cache-Control: private, no-store` + security headers in `src/proxy.ts`, Permenkes 1787/2010 rules (`rules.ts`) blocking discounts/superlatives/hidden price leaks, zero doctors until T-125, and `/[slug]/booking` reserved for T-126.
- Mounted staff pages (`/situs`, `/situs/promo`), 10 Release-1 public pages under `/[slug]/**`, DEL-2 isolation cases (`tests/isolation/cases/{public-site,situs}.cases.ts`), SQL mutation probes (`t123/run-mutations.sh`), and Playwright UI spec (`tests/ui/situs.spec.ts`).
