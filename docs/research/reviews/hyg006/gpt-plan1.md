## HIGH

None.

## MEDIUM

1. **The exact cause of the original 5-second timeout is stated more conclusively than the evidence permits.**  
   `docs/tasks/HYG-006.md:22–26,74–78`

   The investigation convincingly demonstrates a **real backend-startup bottleneck associated with concurrent database creation**:
   - `stall-1793815587/probe.log:1207–1222` shows concurrent creates waiting on `RelationMapping` / `RelationMapReplace`, alongside fresh-connection latencies of **1,396.3 ms and 954.4 ms**.
   - PostgreSQL source establishes the shared/exclusive relation-map-lock mechanism.
   - The isolated reproduction removes Better Auth and the test’s pools from that reproduction.

   However, the original failure has no wait-event or connection-acquisition trace. Its **5.740-second log gap** is not itself a measurement of statement latency: these are error/checkpoint logs, not logs of every executed statement. The checkpoint immediately before the gap actually completed in **52 ms** (`/data/tmp/hyg005/suites-1793798907/container-window.log:2394–2398`). The failed healthcheck corroborates a connection-service problem, but does not identify its precise cause.

   Thus checkpoint/storage pressure or scheduling could still explain that original episode; pool waiting or Better Auth work could contribute to the test duration, although neither alone explains the independent healthcheck failure. The fast held-connection probes also contradict the broad phrase “the whole server stalled.”

   **Requested change:** distinguish the *demonstrated contention mechanism* from the *likely explanation of the original timeout*. Remove “arrived 6 s late” unless request-start timing exists. Likewise, the attribution of the serialized variant’s 312 ms sample specifically to migrations (`:69–70`) needs correlation evidence or qualified wording.

2. **A PostgreSQL advisory lock is database-scoped, not intrinsically cluster-wide.**  
   `docs/tasks/HYG-006.md:84–86,101–102`; `tests/rls/harness.ts:9,33–39`

   Using one fixed key on each harness’s `server` connection will serialize workers **provided they all connect to the same administration database**. Matching keys acquired through different database paths in `TEST_DATABASE_URL` do not conflict, despite operating on the same PostgreSQL cluster.

   The proposed fix is appropriate for the current same-URL suite, but its cluster-wide and concurrent-run claims need this invariant.

   **Requested change:** explicitly require/document one common administration database, or choose a canonical maintenance database for this coordination. State the corresponding CI assumption. For collision safety, choose an exactly representable bigint outside the signed-int32 range used by `hashtext`, and different from `MIGRATION_LOCK_KEY`; merely calling it a “distinct fixed bigint” does not explain that guarantee.

3. **“Done when” lacks deterministic checks of the synchronization and cleanup behavior.**  
   `docs/tasks/HYG-006.md:104–115`; `tests/rls/harness.ts:43–59,80,91–98,159–163`

   Three successful suites with once-per-second connection probes can pass even if a lock is missing from one path. The existing baseline itself passed all three suites. Add checks that demonstrate:
   - A separately held advisory lock actually blocks harness creation/drop, and releasing it permits progress.
   - Normal teardown, stale-database sweep, and migration-failure cleanup all use the lock.
   - The global lock is **not held while migrations run**.
   - A failing operation releases the lock; an unlock/connection failure closes the owning session rather than leaving it alive.
   - Ending the owning session without explicit unlock permits another session to acquire the lock.

   Also make the promised `tests/db/migrations.test.ts` residual report an explicit acceptance item, rather than only prose at `:95–96`: identify its unlocked operations in the post-change observations and report whether any overlap remains with harness DDL. A numeric meaning for “noticeably slower” would make the duration gate reproducible.

4. **The template comparison is not a controlled comparison of equivalent database lifecycles.**  
   `docs/tasks/HYG-006.md:54–70,97–99`; `/data/tmp/hyg006/variants.sh:38–40`; `/data/tmp/hyg006/variants2.sh:38–39`

   The parallel “current” variant creates, migrates **and drops** inside its loop. The parallel template variant only creates; drops occur after the probe window. The serialized template variant includes drops inside its loop. These differ in checkpoint workload, accumulated databases, and completed work. The scripts also stop admitting cycles after roughly 40 seconds but wait for in-flight cycles, so the measured window can exceed 40 seconds.

   Consequently, “template is only faster when … serialized” and attributing its worse connection latency solely to faster creation are stronger than this experiment supports. The current parallel/serialized numbers—98 versus 312 ms—also do not establish a latency improvement from serialization in that workload.

   **Requested change:** label these as exploratory, unequal-workload measurements and narrow the conclusions, or compare equivalent fixed-count lifecycles including teardown. **Rejecting templates for this minimal change remains reasonable**: they introduce lifecycle/setup complexity, change per-file migration coverage, and do not inherit database ACLs. Migration 0003 and `tests/rls/rls.test.ts:218–243` support the ACL concern, though explicitly restoring those ACLs is possible; it is additional work, not an inherent impossibility.

## LOW

1. **The template teardown database count is misquoted.**  
   `docs/tasks/HYG-006.md:64–67`

   `variants-1793816465/cycle-tpl.log` contains **218** creation records. `template.txt:2` records **229.133672551 seconds**, not 229 databases. The script drops matching databases once each. Change this to “218 created databases; teardown took approximately 229 seconds,” unless separate evidence establishes additional databases.

2. **Document the lock ordering that makes the stale sweep safe.**  
   `docs/tasks/HYG-006.md:88,120–124`; `tests/rls/harness.ts:39–59,66–77`

   No unavoidable deadlock is apparent in the proposed design: acquire the per-database lifetime/sweep lock first, then acquire the global lock only around the database statement; the sweep’s other per-database acquisitions remain nonblocking `pg_try_advisory_lock` calls.

   Preserve that order explicitly. Do not hold the global lock across the sweep as a whole, role cleanup, or migrations, and do not introduce a blocking per-database acquisition while holding it. Session termination releases session locks, including after worker death; a Vitest hook timeout alone does **not** necessarily terminate the connection. This distinction belongs in the risk description.

The proposed per-statement serialization is a sensible minimal mitigation, without changing product code, test timeouts, templates, or CI configuration. The blockers are chiefly evidence precision, coordination scope, and acceptance coverage—not the basic direction. The HYG-004 `close()` timing changes were treated as existing context, not as HYG-006 work.

VERDICT: REQUEST_CHANGES
