## HIGH

None.

## MEDIUM

1. **The deterministic tests do not establish that CREATE takes an exclusive—not shared—lock.**  
   `/data/tmp/hyg006/HYG-006.plan.md:177–180,218–224`

   An exclusive holder blocks both shared and exclusive requests. Consequently, the proposed blocked-create test still passes if CREATE mistakenly uses `pg_advisory_lock_shared`. The migration wrappers’ “test 1/2-style” checks have the same limitation. Concurrent shared drops also remain possible under that mutation, so that test does not expose it.

   This would break the central guarantee: creates could overlap both other creates and drops. Activity sampling might detect the overlap, but cannot deterministically guarantee detection.

   **Requested change:** add a shared-holder/exclusive-create check for the harness and the migration create wrapper. Hold the shared key in another session, observe the CREATE participant waiting in `pg_locks` with `mode = 'ExclusiveLock'` and `granted = false`, then release explicitly. Record a mutation changing CREATE to shared acquisition and demonstrate failure. This complements the existing lock-omission mutations.

## LOW

1. **The structural-check requirement is inconsistent with the callback-based helper interface as written.**  
   `/data/tmp/hyg006/HYG-006.plan.md:100–102,216–220`

   `withDatabaseDdlLock(server, mode, fn)` executes SQL supplied by callbacks at its call sites. Those SQL statements will therefore normally appear outside the helper’s declaration. A literal prohibition on CREATE/DROP “outside the helper” would reject the intended harness implementation.

   **Requested change:** specify that the check forbids database DDL outside callbacks guarded by the helper, or introduce SQL-owning create/drop wrappers in the harness as well. The check should also enforce the appropriate mode, rather than merely the presence of a helper call. The six migration call-site omission mutations are otherwise a satisfactory answer to round-3 MEDIUM 2.

2. **The lock-order wording still overstates what is prohibited.**  
   `/data/tmp/hyg006/HYG-006.plan.md:126–128`

   “While holding the DDL lock it never waits on another lock” is literally false: the CREATE/DROP statement itself can wait for PostgreSQL locks. Round 2 explicitly requested this distinction.

   **Requested change:** say “never performs a blocking acquisition of another harness advisory lock while holding the DDL lock.” The proposed advisory-lock ordering itself is sound.

## Review checks otherwise satisfied

- **Earlier findings:** the substantive evidence, cleanup, participation and diagnostics findings from both round-1 reviewers and GPT rounds 2–3 are now closed or explicitly answered, apart from the lock-order wording above. In particular, the live-session unlock-failure injection now tests the cleanup that backend termination could not; acquisition-error ownership and error precedence are explicit; and slow-wait diagnostics use an independent connection with a pre-release barrier.
- **Recomputed stress table:** the individual `report.txt` files agree with the plan:

  | Population | Runs ≥250 ms | Worst connection | Checkpoints/run | Window range | Close-p50 range |
  |---|---:|---:|---:|---:|---:|
  | `altbefore*` + `shbefore*` | 6/12 | 2669.9 ms | 18 | 20.6–37.5 s | 97–200 ms |
  | `locked*` | 0/3 | 51.4 ms | 48 | 32.6–33.3 s | 1278–1335 ms |
  | `altcreatelock*` | 2/6 | 761.9 ms | 18 | 24.2–42.8 s | 246–410 ms |
  | `shared*` | 2/6 | 424.9 ms | 18 | 22.7–27.5 s | 232–285 ms |

  Direct shared controls give median windows **21.3 s versus 23.7 s**, an increase of **11.3%**.
- **Design:** exclusive CREATE/shared DROP, the common-admin-database invariant, key separation, narrow statement scope and migration-test participation are appropriate. The unbounded wait policy explicitly acknowledges that hook timeout does not cancel a query.
- **Acceptance/evidence:** median-versus-median cost gating and descriptive, non-gating latency reporting appropriately address control variance. The plan no longer claims statistical separation or independently proven migration-fsync causation, and it qualifies attribution of the original timeout.

VERDICT: REQUEST_CHANGES
