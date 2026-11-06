**Plan review, round 8 (claude): HYG-006**

All findings from my round 5 are closed, and the plan's numbers match the reports. There are no HIGH or MEDIUM findings. Four LOW findings remain; Done-when 8 says every finding is fixed, LOW included.

## HIGH
None.

## MEDIUM
None.

## LOW

1. **Test 1 can pass on the wrong row if a stale `rls_` database exists** (`HYG-006.plan.md:197-210, 220-221`).
   - `sweepStaleDatabases` gets a test-only `pattern`, but the plan doesn't say `createHarness` does. So in the lock tests, `createHarness` still sweeps `^rls_[0-9a-f]{12}$`, using the test's key.
   - If a crashed earlier run left an `rls_` database, the sweep's shared drop waits first behind the exclusive holder in test 1, with the same `harness:` identity.
   - Test 1, unlike tests 3, 8 and 13, doesn't name the mode it expects. It would then pass on the sweep's row even if the create took no lock. Test 13 still catches an unlocked create, so nothing goes unguarded, but test 1's own mutation claim is weaker.
   - **Fix:** either make test 1 match `mode = 'ExclusiveLock'`, or let `createHarness` accept the sweep pattern and have the lock tests pass the test-only prefix.

2. **Test 8's failed-migration case doesn't say when the exclusive holder takes the lock** (`HYG-006.plan.md:251-253`).
   - If the holder takes it before `createHarness`, the create blocks (an `ExclusiveLock` wait) and the drop is never reached. The test then fails at the 10 s bound.
   - **Fix:** say the holder takes the test's key from inside the injected runner, after the create and before the runner throws. Test 8's sweep case is fine, because the sweep runs before the create.

3. **Test 9 doesn't say how "another session then takes the lock exclusively" is checked** (`HYG-006.plan.md:262-266`).
   - With a blocking `pg_advisory_lock`, the mutation shows up as a hang until the test timeout, not as a clear assertion.
   - **Fix:** use `pg_try_advisory_lock` and assert it returns `true`.

4. **Two wording problems.**
   - `:3` still says "plan review round 7".
   - `:162` says an exclusive lock on drops makes `close()` "about 5× slower". That holds against the shared variant (1 278–1 335 ms against 232–285 ms). Against the current harness (97–200 ms) it is about 6–13×. Name the baseline.

## Checks

- **(1) Earlier findings.**
  - My round 5:
    - M1 (identity and interference from other files) is closed by the per-test key, the `application_name` identity and the structural check on `ddlLockKey`.
    - M2 (structural matching) is closed: matching is case-insensitive, file types are listed, there are wrapper markers, and both exemptions are named. I confirmed that `tests/platform/image-migrate.sh:12,18` is the only lowercase DDL in the repository.
    - M3 (tests 3 and 4) is closed by the `afterAcquire` barrier and the migration barrier.
    - L1: the `probe.log:81–82` citation is now right. For the 376 ms spike, "one or more" is accurate: at that sample one migration was in `DataFileImmediateSync` and one in `WALSync`.
    - L2: the `create_beside_ddl` metric is named and marked as sampled, and test 6 is exempted from the mutation claim.
    - L3 ("in the measured runs" wording) and L4 (cleanup after an unlock failure) are closed.
    - L5: the broken-connection case now terminates during `pg_sleep(30)`, and harness clients get an `'error'` listener.
  - GPT round 6 (both MEDIUMs: test 8's unreachable release, and tests 3 and 4 beside other files) is closed by the per-test key, the test-only prefix and the barriers.
  - Rounds 1–4 and 7 are closed, as both reviewers confirmed.
- **(2) Numbers, recomputed from each `report.txt`:**
  - Runs with a new connection ≥ 250 ms: controls 6/12 (`altbefore` 1, 3, 4 and `shbefore` 4, 5, 6), CREATE-only lock 2/6, shared variant 2/6.
  - Worst new connection: 2 669.9, 761.9 and 424.9 ms. Every run had 18 forced checkpoints, except `locked1` at 48.
  - Median window against its own controls: 21.3 s (control) against 23.7 s (shared), +11.3 %.
  - Relation-map waits: 0–25 for the controls against 0–2 for the shared variant.
  - The `close()` p50 ranges and the `createHarness` p50 of about 2 s match the plan.
- **(3) Lock design.** Every part checks out:
  - Exclusive create, shared drop and one helper are correct.
  - The key is above 2³¹, so it cannot collide with the `hashtext` int4 keys or `MIGRATION_LOCK_KEY`.
  - All participants lock on the same admin database: `migrations.test.ts:13` uses the same URL default.
  - All six `migrations.test.ts` participants (`:31, 39, 59, 67, 73, 87`) go through the wrappers.
  - The lock order cannot deadlock. A drop's forced checkpoint is waited on under the shared lock, which is the intended behaviour.
  - The error precedence is correct, and so are the unlock-failure cleanup through the stale sweep and the handling of a second `end()` call.
  - The wait policy is explicit: unbounded inside the helper, bounded by the hook.
  - Diagnostics use a separate observer connection, and the plan states that a hook timeout does not end a query.
- **(4) Tests and gates.**
  - Apart from LOW 1–3, each test guards a specific step and observes that step's own identified row on its own key.
  - The cost gate (median against median of the same session, and checkpoints ≤ the control's) is sound. Latency is correctly reported rather than gated, given the control's spread of 20.6–37.5 s.
- **(5) Strength of claims.** The original timeout is called "most likely", not proven. The residual mechanism is "consistent with" the evidence. The run-count comparison of 2/6 against 3/6 is explicitly not called a separation.

VERDICT: APPROVE
