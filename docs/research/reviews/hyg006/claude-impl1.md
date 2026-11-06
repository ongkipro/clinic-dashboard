## HYG-006 implementation review, round 1

The working tree changed after the evidence was recorded. The current `tests/rls/harness.ts` and `tests/rls/harness-lock.test.ts` are not the versions that were mutation-tested, stress-tested or run in the full suites. The evidence copies `/data/tmp/hyg006/mut-backup/harness.ts` and `stress/harness-final.ts` still contain `holderReport` with `await report`, `lock_wait` taken from `afterAcquire`, 17 tests and a scan that checks one line at a time. The current files contain `startHolderReport` with `stop()`, `onLockWait`, `observerName` and `observerUrl`, test 11b (18 tests), and a scan of the whole file. These changes look like answers to GPT's impl-1 findings, but nothing has verified them yet.

### HIGH

None.

### MEDIUM

1. **The Results section describes code that no longer exists.** `docs/tasks/HYG-006.md:354–380`
   - The ledger's last checks (typecheck, lint, lock tests, stress, full suite) used digest `e929…`, taken before the current edits.
   - The section still says "17 tests" and "776 passed". The current file has 18 tests, so a full suite would count 777.
   - The plan and Results never mention the new test-only options (`onLockWait`, `observerName`, `observerUrl`) or test 11b. The approved plan said the harness "prints one stderr line" on a slow wait. The new code skips that line when the lock settles first. That changes the approved design and needs to be written down.
   - Typecheck, lint, the mutation script, the stress copy and the full suite ×3 need to be re-run on the current files.

2. **The mutation evidence for 4 of the 6 `migrations.test.ts` call sites is invalid.** `/data/tmp/hyg006/mutations.sh:83–98`
   - `sites.txt` is computed after the `for site` loop. That loop's last `mut` leaves `migrations.test.ts` mutated: the drop line is replaced by a statement 20 characters longer. So every position in `sites.txt` is 20 characters too far.
   - The logs show the damage. `migrations-site-1.log:18` and `-3.log` contain `await createTestDataawait admin.query(\`DROP DATABASE …\`)`. Sites 2 and 4 contain `dropTestDatabaawait …`.
   - The two create sites therefore got a direct **DROP** inside a broken identifier, not a direct CREATE. The test was caught only because a DROP text appeared.
   - The claim "each of the six call sites replaced by a direct statement" (`HYG-006.md:361`) is not supported for sites 1–4.
   - That loop also skips `judge`, so a run in which no test ran would not be marked INVALID.
   - Fix: `restore` before computing `sites.txt`, and judge each site.

3. **The mutation script no longer matches the current code.**
   - `lock-over-migrations` looks for `await createTestDatabase(server, dbName, ddl);`. The current line is `{ ...ddl, onLockWait: … }`.
   - `no-holder-report` looks for `const timer = setTimeout(() => { report = holderReport(…` and `observer-not-closed` looks for `await observer.end()…}\n};`. Neither exists any more.
   - These would now print SETUP FAILED. Any re-run needs updated patterns, plus mutations for the new code (`stop()` removed, `onLockWait` dropped).

4. **Test 11b depends on the environment and on timing.** `tests/rls/harness-lock.test.ts:348–376`
   - It needs `10.255.255.1` to blackhole the connection. On a host or container with no route there, the connect fails at once (EHOSTUNREACH/ENETUNREACH). The "holder report failed" line then prints before the unlock, and `expect(lines…).toEqual([])` fails.
   - It waits a fixed 300 ms sleep and asserts a wall-clock bound under 1 500 ms. The plan says "No test relies on elapsed sleeps".
   - It never checks that the timer actually fired, so under load it can pass without testing anything.
   - The name says "its observer is closed when the lock settles", but nothing asserts that.
   - Suggestion: inject a fake observer, for example a connect that never settles and records `end()`, and assert that `end()` was called and that the operation settled before the fake connect does.

5. **The test-3 timing claim is not in the evidence.** `HYG-006.md:363`
   - "Fails in about 0.1 s with `expected 'waiting' to be 'granted'`" has no log behind it. `mutations-1793833773/drop-exclusive.log:14–15` shows the old 60 s timeout. GPT impl-1 raised this too, and it is still unfixed.

### LOW

6. **`onLockWait` can leave the lock held.** `harness.ts:131–136`
   - It runs in the acquisition `finally`. If it throws after a successful acquisition, the lock is held and is never unlocked or ended. If the acquisition failed, its error replaces the acquisition error.
   - The internal callbacks cannot throw today, but the helper's error rules should not depend on that. Wrap the call in try/catch.

7. **The sweep can replace the real error.** `harness.ts:170–176`
   - When `dropTestDatabase`'s unlock fails, the helper ends `server`. The sweep's `finally` then calls `pg_advisory_unlock(hashtext…)` on the ended client, and that throws "Client was closed" over the original unlock error.
   - `createHarness` still cleans up, but the reported error is wrong.

8. **The comment stripper can hide real code.** `harness-lock.test.ts:90`
   - It does not know about strings. A `/*` inside a string, such as a glob like `"src/**/*.ts"`, opens a fake block comment that blanks code up to the next `*/`. A `//` inside a string not preceded by `:` blanks the rest of the line.
   - No file the scan covers is affected today: `image-migrate.sh` is exempt, and the scan skips its own file. It is a way to slip past the guard later. A self-check with a string-embedded `/*` would expose it.

9. **`observerUrl` is accepted by `createHarness` but ignored.** `harness.ts:186–198`
   - `HarnessOptions` takes it, but `ddl` passes only `observerName`. Either pass it through or `Omit` it.

10. **Minor doc and evidence items.**
    - `ARCHITECTURE.md:105` still says "718 tests".
    - I could not find the 580/592 ms spike context in the `stress-fnew*` probe logs. The explanation at `HYG-006.md:377` ("right after several drops waited on a forced checkpoint…") should cite the `probe.log` lines, as the plan section does for 425/376.

### Checked and correct

- **Lock modes:** the create takes the key exclusively and the drop takes it shared.
- **Key:** `BigInt("7202611030")` is above 2³¹ and differs from `MIGRATION_LOCK_KEY`. It is passed as text through `$1` and resolved to the bigint overload.
- **`pg_locks` key:** `objsubid = 1` and `(classid::bigint << 32) | objid::bigint` give classid 1 and objid 2907643734 for this key. That is correct, and both the observer and the test probe use it.
- **Error rules:** acquisition failure, fn-throws with unlock ok or failing (`cause` set only when there is none), and fn-succeeds with unlock failing all behave as planned. Ending the connection is best effort.
- **Observer:** it uses a separate connection, the timer is cleared, and `stop()` destroys a connecting socket. pg's `end()` while connecting destroys the stream.
- **`createHarness` error paths:** `server.end()` always runs on a throw, and the drop after a failed migration goes through the wrapper.
- **`application_name` identity:** set as planned. Test 11 now uses a unique observer name, which fixes GPT's isolation finding, and test 3 now polls in a single loop.
- **Other evidence:**
  - The stress gate figures and the full-suite counts and durations in the doc match their evidence, for the old code.
  - The 19 non-site mutations in `mutations-1793833773/` each ran tests and failed the intended test. `default-key-changed` was caught only by the structural test's text check.

VERDICT: REQUEST_CHANGES
