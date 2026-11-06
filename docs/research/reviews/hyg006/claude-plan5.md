I found no HIGH findings, three MEDIUM and five LOW. The plan needs another revision before approval.

## HIGH

None.

## MEDIUM

1. **The lock tests can pass because of other test files running at the same time.** `HYG-006.plan.md:178–181, 188–189, 226–236`
   - **The waiting session is not identified.** The plan only says a wait is "observed in `pg_locks` for that key". During `pnpm test`, other files' `createHarness()`/`close()` queue on the same key whenever this file holds it.
     - That makes tests 1, 2 and 13 pass even if the tested call never takes the lock.
     - Test 13 is the clearest case. If the create is changed to shared it is not blocked, but another file's exclusive create still shows `ExclusiveLock`/`granted = false`. The test passes under exactly the mutation it is meant to catch.
     - The waiter must be matched by its backend pid, or by a unique `application_name` per participant. `createHarness` creates its client internally, so the plan has to say how it exposes that identity.
   - **Test 8 (stale-sweep drop) races with other files.** The test creates a stale `rls_…` database whose per-database lock is free. Any other file's `createHarness` sweep may claim it first (`pg_try_advisory_lock`). This test's sweep then skips the database, and the wait it is looking for never appears, so the test hangs until it times out.
   - **Fix:** run these tests where no other file runs, or match on the participant's identity, or accept a sweep drop from any harness, matched by database name and query text. State which approach is used.

2. **The structural test's matching rules are not defined, and `tests/` has a real conflict.** `HYG-006.plan.md:221–225`; `tests/platform/image-migrate.sh:12,18`
   - `image-migrate.sh` contains lowercase `create database`/`drop database`.
     - It cannot use the wrappers.
     - It connects to the `postgres` admin database (`ci.yml` `ADMIN_URL`), not `TEST_DATABASE_URL`'s `clinic_dashboard`, so the lock would not cover it anyway.
     - It is safe in practice because CI runs it after `pnpm test`.
   - **The trap:** a case-insensitive scan fails on this file at once. A case-sensitive scan misses lowercase direct DDL in a `.ts` test, which defeats the guard.
   - The structural test's own file also contains these strings (its regex and fixtures).
   - **Fix:** specify case-insensitive matching, the file types scanned, and named exemptions. The exemptions are `image-migrate.sh` (it runs sequentially after `pnpm test` on a different admin database; write that down) and the structural test itself.

3. **Two tests are not defined well enough to catch their mutation.** `HYG-006.plan.md:181–183`
   - **Test 3 ("two drops proceed together"):** if drops were changed to exclusive, two quick drops would simply run one after the other and the test would still pass.
     - Only the static mode check in test 12 would catch it.
     - Better: hold the key **shared** in another session and assert a drop is not blocked (`ShareLock`, `granted = true`). That fails if the drop becomes exclusive.
   - **Test 4 ("not held while migrations run"):** nothing pauses `runMigrations`, so the exclusive acquisition only succeeds "during" migrations by timing. That is a sleep or race in disguise.
     - This conflicts with "no test relies on elapsed sleeps" (`:234–236`).
     - **Fix:** specify a pause point, such as an injected migration runner that waits on a barrier.

## LOW

1. **Wrong line citation, and "several" is loose.** `HYG-006.plan.md:81–83`
   - The 424.9 ms sample and its `RelationMapReplace` activity line are at `stress-shared1-1793830636/probe.log:81–82`, not `:86–87`. Lines 86–87 are a later 8.9 ms sample.
   - For the 376 ms spike (`stress-shared3…/probe.log:51–56`), the create was waiting on `LWLock WALWrite`. Only one or two migrations were in `DataFileImmediateSync`, so "several files' migrations" overstates it.

2. **"Correctness gate (deterministic)" includes a sampled check.** `HYG-006.plan.md:237–238`
   - "No activity sample with a CREATE beside another CREATE/DROP" is sampled every 500 ms, and `pg_stat_activity` reads are not atomic across backends. Absence in the samples is evidence, not proof.
   - `stress-report.py` has no metric for create-beside-DDL; it only counts samples with more than one DDL, and shared drops make that 6–8 per run. The new metric needs to be named.
   - Test 6 checks PostgreSQL's behaviour, not a guarded step, so the blanket mutation claim at `:235–236` does not apply to it.

3. **Some causal wording is still stronger than the evidence.** `HYG-006.plan.md:79, 89–91`
   - "The worst stall falls from 2.7 s to 0.4 s" compares the worst of 12 control runs with the worst of 6 changed runs.
   - "Reduced by serializing creates" is stated as fact in the root-cause paragraph.
   - Both conflict with the plan's own "six pairs do not establish these statistically". Suggested wording: "in the measured runs".

4. **What is left behind after an unlock failure is not stated.** `HYG-006.plan.md:107–113`
   - If the create succeeds but the unlock fails, the helper ends `server`. `createHarness`'s error path then cannot drop the new database.
   - In `close()`, the same case leaves `drop_roles` running on a closed connection, so the roles stay behind.
   - Both are cleaned up by a later sweep, because the per-database lock is released when the session ends. The plan should say so, and say that a second `server.end()` from the caller is tolerated.

5. **The broken-connection case in test 9 can crash the run.** `HYG-006.plan.md:202–203`
   - If the backend is terminated while the client is idle, `pg.Client` emits an `'error'` event, and the harness client has no listener. Vitest then reports an unhandled error rather than the expected thrown error.
   - **Fix:** terminate the backend while a callback query is still running, or attach an error listener.

## Checks passed

- **Earlier findings:** every finding from claude round 1 and GPT rounds 1–4 is closed or explicitly answered. Round-4 MEDIUM (exclusive vs shared create) is answered by test 13, subject to MEDIUM 1 above. Round-4 LOWs (the two SQL-owning wrappers, the lock-order wording at `:126–128`) are fixed.
- **Numbers**, recomputed from every `report.txt`:
  - Runs with a sample ≥ 250 ms: 6/12, 0/3, 2/6, 2/6.
  - Worst new connection: 2669.9, 51.4, 761.9, 424.9 ms.
  - Forced checkpoints per run: 18, 48, 18, 18.
  - Window ranges and `close()` p50 ranges match the table.
  - The shared variant against its own controls: 2/6 against 3/6 runs ≥ 250 ms; relation-map waits 0–2 against 0–25.
  - Median window 21.3 s against 23.7 s, +11.3 %.
  - The cost gate passes on existing data, with a margin of 3.7 points under its +15 % limit.
- **Lock design:** exclusive create with shared drop, the same-admin-database rule, the key choice, the per-statement scope, the error precedence, the acquisition-failure ownership, the wait policy, the diagnostics observer and the hook-timeout caveat are all sound. All six `migrations.test.ts` call sites are covered through the wrappers.

VERDICT: REQUEST_CHANGES
