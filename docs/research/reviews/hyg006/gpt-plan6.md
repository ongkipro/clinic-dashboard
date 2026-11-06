## HIGH

None.

## MEDIUM

1. **Test 8’s stale-sweep synchronization cannot reach its release condition.**  
   `/data/tmp/hyg006/HYG-006.plan.md:194–197,220–221`

   The test holds the stale database’s lifetime lock until its sweep is waiting on the DDL lock. But the sweep first calls `pg_try_advisory_lock` for that database (`tests/rls/harness.ts:44–48`).

   - If a separate test session holds the lifetime lock, the sweep skips the database; it never reaches the DDL wait that would trigger release.
   - If the sweep’s own session holds it, reentrant acquisition succeeds, but releasing that session’s lifetime lock does not make this the intended separate-holder protocol.

   **Requested change:** explicitly use the identified sweep connection itself to hold the lifetime lock before creating the stale database, and retain that lock through the sweep’s claim/drop; document the matching unlocks for the reentrant acquisition. Alternatively, add a barrier after the sweep claims the database. Either approach must prevent other sweeps from claiming it without depending on an unreachable wait.

2. **Tests 3 and 4 still lack sufficient synchronization to be deterministic beside other files.**  
   `/data/tmp/hyg006/HYG-006.plan.md:186–200,210–214`

   Participant identity fixes false attribution of *waiting* rows, but does not isolate these positive acquisition checks:

   - **Test 3:** another file can queue an exclusive create behind the shared holder before the tested drop requests its shared lock. PostgreSQL then queues the drop behind that exclusive waiter—the fairness behavior correctly described at lines 320–321. A correct shared drop can therefore wait.
   - **Test 4:** the migration barrier pauses only the tested harness. Other files can still own or queue for the DDL key, so “takes the key exclusively without waiting” does not distinguish a lock held across the tested migrations from unrelated contention.
   - **Test 3 also needs an observation barrier:** once the drop wrapper completes and unlocks, its granted `ShareLock` row is gone. Merely polling while the real DROP executes can miss that row.

   **Requested change:** specify isolation or a controlled admission protocol for these checks. For test 3, pause the identified wrapper after acquisition and before unlock, observe its granted shared row, then explicitly release the barrier. For test 4, establish that the paused harness owns no DDL lock and use a controlled acquisition check that cannot be blocked by unrelated participants. Record the exclusive-drop and lock-held-through-migrations mutations against these protocols.

## LOW

None.

## Checks otherwise satisfied

- **Earlier findings:** rounds 1–4 are closed or explicitly answered. Round 5’s structural-scan, evidence wording, cleanup consequences, broken-connection handling, and create-participant identity findings are addressed. Its stale-sweep and deterministic-test findings remain incomplete as detailed above.
- **Recomputed stress table:** the individual `report.txt` files agree with the plan:

  | Population | Runs ≥250 ms | Worst connection | Checkpoints/run | Window range | Close-p50 range |
  |---|---:|---:|---:|---:|---:|
  | Controls, 12 | 6/12 | 2669.9 ms | 18 | 20.6–37.5 s | 97–200 ms |
  | Exclusive both, 3 | 0/3 | 51.4 ms | 48 | 32.6–33.3 s | 1278–1335 ms |
  | Exclusive create only, 6 | 2/6 | 761.9 ms | 18 | 24.2–42.8 s | 246–410 ms |
  | Exclusive create/shared drop, 6 | 2/6 | 424.9 ms | 18 | 22.7–27.5 s | 232–285 ms |

  The direct shared controls have median window **21.3 s**, versus **23.7 s**, an increase of **11.27%**. Their affected-run counts are **3/6 versus 2/6**; relation-map wait counts range **0–25 versus 0–2**.
- **Lock design:** exclusive CREATE/shared DROP, common administration database, separated key, per-statement scope, advisory-lock ordering, error precedence, live-session unlock-failure cleanup, and acquisition-failure ownership are sound. The wrappers and structural guard cover all six `tests/db/migrations.test.ts` participants.
- **Wait policy and diagnostics:** the unbounded-wait choice is explicitly answered; hook timeout is correctly distinguished from cancellation. The independent observer and pre-release diagnostic barrier address earlier concerns.
- **Performance/evidence:** the median-versus-median cost gate and descriptive latency reporting appropriately acknowledge control variance. The original-timeout attribution and residual migration-I/O mechanism are now qualified rather than presented as proven.

VERDICT: REQUEST_CHANGES
