## HIGH

None.

## MEDIUM

1. **The unlock-failure injection cannot prove that the helper closes the connection.**  
   `/data/tmp/hyg006/HYG-006.plan.md:179–187`

   Terminating the owning backend inside the callback already removes the backend and releases its session locks, independently of the helper’s cleanup. Consequently, both proposed assertions—backend disappearance and subsequent exclusive acquisition—still pass if the helper’s `server.end()` on unlock failure is removed. This does not satisfy the mutation-check promise at lines 191–193 and leaves round-2 MEDIUM 2 partially open.

   **Requested change:** retain backend termination as a broken-connection test, but additionally inject an unlock-query rejection **while the owning PostgreSQL session remains alive and holds the lock**. Exercise both operation-success and operation-failure cases. Assert backend disappearance and acquisition by another session, and verify that removing the helper’s connection-ending step makes these tests fail. Also explicitly assert the promised original-error identity/cause behavior.

   The acquisition-failure case should verify that unlock was not attempted and that the caller closes its connection, not only that the callback did not run.

2. **Testing one migration-test path cannot protect all six DDL participants.**  
   `/data/tmp/hyg006/HYG-006.plan.md:188–193`; `tests/db/migrations.test.ts:31–87`

   The existing file has three creates and three drops: main setup/teardown, concurrent-runner setup/cleanup, and migration-lock-wait setup/cleanup. Exercising “one of its paths” through the helper will not fail if a wrapper is subsequently omitted from any other path. The stress workload invokes `createHarness()`, not these migration tests, so its activity sampling does not fill this coverage gap.

   **Requested change:** exercise all six call sites, or specify an enforceable structural check that all six delegate to the tested locking path and forbid direct database CREATE/DROP elsewhere in the file. Record omission mutations for each participant. This completes the earlier migration-participation finding and makes the “each test fails if its lock call … is removed” claim supportable.

## LOW

1. **Residual causal attribution and the word “robust” still exceed the measurement strength.**  
   `/data/tmp/hyg006/HYG-006.plan.md:71–72,87–92`

   The detailed residual paragraph appropriately says that migration I/O and the single create’s separate contributions are not established. The root-cause paragraph nevertheless says migration fsync “also contributes,” which turns that correlation into a causal conclusion.

   Similarly, the observed worst sample and relation-map wait counts are useful descriptive differences, but six pairs do not establish that those differences are statistically “robust,” especially given the acknowledged control variance.

   **Requested change:** say “observed differences” and describe migration fsync prolonging a single create as a mechanism **consistent with the samples**, rather than an independently established contribution. The original timeout remains a likely explanation, not a proven attribution.

2. **The reentrancy warning describes incorrect PostgreSQL behavior.**  
   `/data/tmp/hyg006/HYG-006.plan.md:225–227`

   Session advisory locks are reentrant. A nested same-session acquisition does not generally “wait on itself”; repeated acquisitions require matching unlocks. Shared-to-exclusive upgrades can introduce a different waiting/deadlock hazard involving other sessions.

   **Requested change:** state that nested calls and upgrades are **prohibited by the helper’s contract**, not prevented by PostgreSQL self-blocking. Keep the per-statement usage rule.

3. **Specify that slow-wait diagnostics run while acquisition is pending, using another connection.**  
   `/data/tmp/hyg006/HYG-006.plan.md:158–161`

   The diagnostic policy answers the earlier bounded-wait suggestion in principle, but its execution needs clarification. A diagnostic query queued on the same `pg.Client` behind the pending advisory-lock query cannot identify holders during the stall. Reporting only after acquisition also provides nothing for an indefinitely blocked waiter.

   **Requested change:** specify a timer and independent observer connection, best-effort diagnostic failure handling, and timer/observer cleanup on every settlement path. Add a barrier-controlled test proving the holder report appears before releasing the blocking lock.

## Checks otherwise satisfied

- Recomputing the table from the individual `report.txt` files agrees with its current values: **6/12, 0/3, 2/6, 2/6** affected runs; maxima **2669.9, 51.4, 761.9, 424.9 ms**; checkpoint counts **18, 48, 18, 18**; and the stated window and close-p50 ranges.
- Direct shared controls give median windows **21.3 s versus 23.7 s**, approximately **+11.3%**. Median-versus-median cost gating and descriptive, non-gating latency reporting address round-2 MEDIUM 1.
- Exclusive CREATE/shared DROP, the common-admin-database invariant, key separation, narrow lock scope, and advisory-lock ordering are sound.
- Other earlier findings are closed or explicitly answered: unequal-workload/template qualifications, checkpoint amplification, corrected teardown count, error precedence in the design, hook-timeout limitations, wait-policy choice, and separate lock-wait timing.

VERDICT: REQUEST_CHANGES
