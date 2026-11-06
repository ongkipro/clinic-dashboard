## HIGH

None.

## MEDIUM

1. **The performance gate is too sensitive to control variance, and its duration aggregation is ambiguous.**  
   `/data/tmp/hyg006/HYG-006.plan.md:151–157`

   The directly paired shared-lock measurements give **3/6 control runs versus 2/6 changed runs** with a connection ≥250 ms—not a robust separation. The first three controls have **zero** qualifying samples, while two corresponding changed runs have one each. A future six-pair session can therefore fail “fewer runs” simply because the control happens to be clean.

   Duration also needs an explicit aggregation:
   - `shbefore*` median window: **21.3 s**.
   - `shared*` median window: **23.7 s**, approximately **+11.3%**.
   - The longest shared run, **27.5 s**, exceeds control median +15% (**24.495 s**).

   Thus the existing evidence passes a **median-versus-median** gate but fails an **every-window-versus-control-median** gate.

   **Requested change:** define the aggregation, paired population, and a predetermined treatment of clean/inconclusive controls. Keep deterministic synchronization assertions as the correctness gate; treat sampled latency improvements as empirical performance evidence with explicitly limited confidence. This leaves Claude round-1 H2/M4 only partially closed.

2. **Unlock-failure behavior is promised but not tested, and error precedence remains unspecified.**  
   `/data/tmp/hyg006/HYG-006.plan.md:90–94,110–114,136–150`

   Ending the owning connection after an unlock failure is the right direction. However, none of the listed deterministic tests injects an **unlock failure**. “A failing create releases the lock” and “ending a session releases the lock” do not test whether the helper actually ends the session when unlocking fails.

   The plan also does not say whether an unlock or `server.end()` error can replace the original operation error, a point explicitly raised in Claude round-1 M3. The experimental helper currently suppresses unlock errors without ending the session (`/data/tmp/hyg006/stress/harness-sharedlock.ts:30–40`), so the stress runs do not validate the proposed hardening.

   **Requested change:** specify and test:
   - operation throws, unlock fails: owning session is ended and the original error remains primary;
   - operation succeeds, unlock fails: cleanup occurs and the helper’s success/error policy is explicit;
   - acquisition fails: callback and unlock are not executed, with caller-owned connection cleanup verified.

   Verify backend disappearance or acquisition by another session—not merely that `end()` was called.

3. **Residual spikes are attributed too conclusively to migration fsync; the evidence still contains the original relation-map mechanism.**  
   `/data/tmp/hyg006/HYG-006.plan.md:75–84,160–161`

   For the **424.9 ms** sample:
   - `/data/tmp/hyg006/stress-shared1-1793830636/probe.log:87` records the connection starting at `1793830644.501`.
   - The activity snapshot at `1793830644.757` (`:86`) shows the single create waiting on **`IO RelationMapReplace`**, alongside migration `DataFileImmediateSync` waits.

   This is consistent with migration I/O prolonging a single create’s relation-map critical section. It does **not** isolate “general fsync load” from relation-map blocking. Serialization removes overlapping creates, not the ability of one create to block backend startup.

   **Requested change:** describe the residual as correlated migration I/O **and single-create relation-map contention**, without claiming their individual contributions are established. Likewise, “a second, smaller contributor” is not established as a general ranking by these measurements. Round-1 evidence-precision findings are substantially addressed, but this attribution remains too strong.

## LOW

1. **The main table overcounts affected control runs.**  
   `/data/tmp/hyg006/HYG-006.plan.md:63–68`

   Recomputing from the individual `report.txt` files:

   | Population | Runs with connection ≥250 ms | Worst connection | Checkpoints/run | Window range | Range of run-level close p50 |
   |---|---:|---:|---:|---:|---:|
   | `altbefore*` + `shbefore*` | **6/12**, not 7/12 | 2669.9 ms | 18 | 20.6–37.5 s | 97–200 ms |
   | `locked*` | 0/3 | 51.4 ms | 48 | 32.6–33.3 s | 1278–1335 ms |
   | `altcreatelock*` | 2/6 | 761.9 ms | 18 | 24.2–42.8 s | **246–410 ms** |
   | `shared*` | 2/6 | 424.9 ms | 18 | 22.7–27.5 s | 232–285 ms |

   The six affected controls are `altbefore1`, `altbefore3`, `altbefore4`, `shbefore4`, `shbefore5`, and `shbefore6`. The other table values agree, allowing rounding. Also change “6 runs each” in the header: the rows contain 12, 3, 6, and 6 runs.

2. **The bounded-wait suggestion from round 1 is not explicitly answered.**  
   `/data/tmp/hyg006/HYG-006.plan.md:167–172`

   Claude’s round-1 LOW finding asked to consider bounded lock waits with holder diagnostics. The plan acknowledges that a Vitest timeout does not terminate a session, but does not accept or explicitly reject that suggestion. A hook timeout while awaiting an unresolved query does not itself enter the proposed error cleanup.

   **Requested change:** explicitly document the chosen wait policy and its rationale, including what terminates a still-pending lock query. Do not imply ordinary throw cleanup also handles a hook timeout automatically.

## Lock-design assessment and round-1 closure

The **shared-DROP/exclusive-CREATE design is sound for the stated same-admin-database invariant**. PostgreSQL’s lock wait queue prevents newly arriving, non-reentrant shared requests from continually bypassing a queued exclusive request. Independent drops therefore do not inherently starve a waiting create. Avoid nested/reentrant helper use or shared-to-exclusive upgrades.

No advisory-lock cycle is apparent with the specified ordering: per-database lifetime/sweep lock first, DDL lock second; sweep acquisitions remain nonblocking; migrations execute after releasing the DDL lock and acquire their migration lock on the throwaway database. “Never waits on another lock” should mean **another harness advisory lock**—the DDL statement itself necessarily acquires PostgreSQL locks.

Most other round-1 findings are closed: administration-database scope, key separation, migration-test participation, checkpoint amplification, unequal-workload/template qualifications, teardown count, and separate lock-wait timing. Remaining gaps are identified above. Deterministic tests should use observable wait states/barriers rather than elapsed sleeps, and should exercise the migration-test DDL participants as well as harness paths.

VERDICT: REQUEST_CHANGES
