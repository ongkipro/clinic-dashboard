## MEDIUM

1. **Diagnostics can indefinitely delay DDL while holding the acquired lock.**  
   `tests/rls/harness.ts:59–77, 101–107`  
   Once the slow-wait timer fires, acquisition settlement unconditionally awaits `holderReport`. Its connection and query have no timeout, and the caller cannot close its observer. If acquisition succeeds while the observer is stalled, the helper holds the DDL lock without running the statement or reaching its unlock handling. Acquisition failure likewise cannot propagate until the observer finishes. This contradicts the approved requirement that diagnostics never affect the operation and that a still-open observer is closed on every settlement path. Give the observer bounded/cancellable lifecycle management and test settlement while observation is pending.

2. **The structural guard misses valid multiline database DDL.**  
   `tests/rls/harness-lock.test.ts:345–353`  
   Although the regex contains `\s+`, it is applied separately to each line. A template literal containing:
   ```ts
   await server.query(`CREATE
     DATABASE ${name}`);
   ```
   bypasses the guard entirely. This is weaker than the approved whitespace-tolerant scan and the documented “every database create and drop” guarantee. Match against the complete source outside the exemptions/wrapper region, preserving line information for reporting, and add a multiline regression case.

3. **The observer-cleanup test is not isolated from other files’ diagnostics.**  
   `tests/rls/harness-lock.test.ts:322–334`  
   Test 11 counts every backend named `harness:lock-observer`, including observers created by concurrently running harnesses. An unrelated observer appearing after the initial count can cause a false failure; an unrelated observer disappearing can conceal a leaked observer from this test. Identify and assert disappearance of this invocation’s observer specifically, rather than comparing global counts.

## LOW

4. **Test 3 leaves the losing polling branch running after success.**  
   `tests/rls/harness-lock.test.ts:131–134`  
   When the acquisition barrier wins `Promise.race`, the `until(... !granted)` branch continues querying the shared probe and scheduling timers for up to ten seconds. It therefore runs beside subsequent tests and can outlive teardown. Replace the race with one cancellable observation loop, or explicitly cancel and await its losing branch.

5. **The promised `lock_wait` timing is incomplete.**  
   `tests/rls/harness.ts:208, 278–287`  
   `createHarness` does not record or report its acquisition duration as a `lock_wait` step, despite the plan explicitly requiring it. In `close()`, `lock_wait` is appended only after the entire drop wrapper succeeds, so a drop or unlock failure omits even an already-measured wait from the slow-close report. Record acquisition timing independently and preserve it on failure paths.

6. **The claimed post-change mutation result is not in the cited evidence.**  
   `docs/tasks/HYG-006.md:357–358`  
   The document says the revised test 3 fails the exclusive-drop mutation in approximately 0.1 seconds with `expected 'waiting' to be 'granted'`. However, `/data/tmp/hyg006/mutations-1793833773/drop-exclusive.log:14–15` records the earlier 60-second timeout. The cited run does demonstrate that all 23 mutations were caught, but does not demonstrate this result for the revised test. Record the rerun or qualify/remove the unsupported timing claim.

The lock modes, fixed key, bigint-as-text parameters, and bigint `pg_locks` reconstruction (`classid << 32 | objid`, `objsubid = 1`) are otherwise consistent with the design. The stress harness copy matches the repository implementation on inspection except for its import path. The reported cost-gate figures and full-suite pass counts/durations agree with the supplied evidence.

VERDICT: REQUEST_CHANGES
