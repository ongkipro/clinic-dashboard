# HYG-006 plan review

I would not approve the plan yet. The PostgreSQL mechanism is real and the lock design is mostly sound. The problem is evidence: the measurements behind the chosen fix are weak, and the Done-when checks can't tell a working fix from no fix.

## HIGH

**H1. The measurements don't show that serializing helps the harness's real workload** (HYG-006.md:58–61, 67–71)
- In the variant that matches the harness (create, migrate, drop), running in parallel gave p99 **98 ms** with no sample ≥500 ms. Running one at a time gave p99 **312 ms**, which is worse.
- That single 312 ms sample (`variants2-1793817104/probe-cur-s.log:243`, at 1793817146.310) came while **no** `CREATE` or `DROP DATABASE` was running. The activity snapshot at 146.372 shows only migration DDL waiting on `DataFileImmediateSync`. So migration fsync load alone stalled a new connection. That is the "checkpoint/fsync I/O alone" explanation, and the lock doesn't touch it.
- The serialized run also produced far fewer databases: 42 in about 57 s against 96 in 40 s. Its last six cycles took about 20 s each, with `DROP DATABASE` waiting on `CheckpointDone` for more than 3 s.
- The only evidence that serializing helps comes from the empty create/drop reproduction and the template variants. The plan treats the bad result as noise ("because migrations run between its creates") and defers the real proof to Done when.

**H2. Done when #3 can't tell the fix from no fix** (HYG-006.md:108–110)
- The baseline already passes. Stall runs 1–3 all passed, and HYG-005 failed 1 run in 3.
- Both ≥500 ms samples (954 and 1 396 ms) came from run 3 alone. Runs 1 and 2 had none, so three clean runs after the change are likely even if nothing changed.
- The probe opens one new connection per second, so it can miss short stalls.
- Nothing checks that the lock is actually taken (your question 3).
- Add:
  - At least about 10 runs, or a targeted stress such as 6–8 parallel `createHarness()`/`close()` loops run before and after the change with the same probe.
  - A faster new-connection probe (for example 4 per second).
  - From the activity samples: no sample with more than one `rls_` `CREATE`/`DROP DATABASE` active, harnesses visibly waiting on the advisory lock, and the `RelationMapping` wait count compared before and after.
  - Lock wait time per harness, reported.

## MEDIUM

**M1. The root cause is stated more strongly than the evidence supports** (HYG-006.md:22–26, 74–78)
- The failing run logs only errors and checkpoints. A 6 s gap with no error lines does not show the "whole server stalled". The one solid signal is a single `pg_isready` "no response" at 20:42:40.
- No `DROP DATABASE` happened during the gap. No checkpoint started between 13:42:35.776 and 13:42:43.087, and every drop forces one. So for the actual failure, checkpoints are ruled out and concurrent creates are **assumed**: there's no create evidence for that run.
- Kernel writeback after the 13:42:35.443 checkpoint (2 277 files synced) is equally consistent. Dirty/Writeback wasn't captured in that run.
- Statement pid 31513 already existed at 13:42:35.582, so the delay happened before the statement in the client. Possible causes are a new connection from `authPool` (`max: 2`, after the pool's idle timeout), Better Auth password hashing, or `cancelInvite`. None of these were timed.
- The lab stall peaked at 1.4 s, not the 6 s that failed the test.
- Present this as "most likely, consistent with", not as the proven root cause.

**M2. The plan says "one create or drop at a time", but `tests/db/migrations.test.ts` stays outside the lock** (HYG-006.md:94–96; migrations.test.ts:31, 39, 59, 67, 73, 87)
- Its `t002_` create is in the very slow burst that was observed (`stall-1793815587/probe.log`, activity at 1793815787.659).
- Covering it is cheap: export the lock helper from `tests/rls/harness.ts` and use it there. Otherwise, Done when needs a measured residual and a pass/fail threshold for it.

**M3. Error-path cleanup needs to be specified** (harness.ts:36–92)
- After `server.connect()`, any throw — in the sweep (harness.ts:49), the create (harness.ts:75), or the drop after a failed migration (harness.ts:90) — skips `server.end()`. The leaked session keeps holding the per-database lock and possibly the new global lock until the worker process exits.
- A crashed process releases the lock (Risks section). A **live** worker holding a leaked client does not. Every other harness would then hang until the 120 s hook timeout.
- Wrap the whole body after `connect` in try/catch so `server.end()` always runs.
- Make unlock in `finally` best-effort (catch and ignore errors) so a broken connection doesn't hide the original error.
- Don't unlock if the lock call itself failed.

**M4. Serializing drops may cause more forced checkpoints, not fewer** (HYG-006.md:84–87, 111–112)
- When drops run in parallel, their checkpoint requests can be served by one checkpoint. Serialized, each drop forces its own.
- The template teardown measured about 1 s per serialized drop. Each extra checkpoint adds disk I/O, which affects running tests.
- Done when #3 and #4 only "report" the checkpoint count and say "noticeably slower". Set thresholds instead, for example duration within +10% and a checkpoint count no higher than 67.

## LOW

- **The lock is per database, not cluster-wide** (HYG-006.md:84). PostgreSQL advisory locks are scoped to the current database. Serialization works only because every participant connects to the same `adminUrl` database. Say so; it matters if `migrations.test.ts` joins in.
- **Lock key** (HYG-006.md:101–102). The per-database keys come from `hashtext()`, which is 32-bit. Require the new fixed key to be above 2³¹ and different from 7 202 611 020, rather than just "distinct".
- **Lock ordering.** Write down the rule: take the global lock only after the harness's own per-database lock, and never wait on another lock while holding it. The sweep uses only `pg_try_advisory_lock`, so there's no deadlock today; the rule keeps it that way.
- **Unbounded wait.** Consider a bounded lock wait that reports the holder's pid from `pg_locks`, instead of silently hitting the 120 s hook limit.
- **HYG-004 step timing.** Add a separate `lock_wait` step to `close()`'s timing so a slow close shows where the time went.
- **Numbers:**
  - "28 `createHarness()` calls" (HYG-006.md:49): grep finds 27 call sites plus the definition. That includes `tests/ui/shell.spec.ts` (probably Playwright) and `tests/auth/helpers.ts`, whose real per-run count depends on how many files call it.
  - "229 databases" (HYG-006.md:66): `cycle-tpl.log` has 218 entries, so 229 looks mixed up with the "229 s". The 229 s itself is correct.
  - "100 % of the slow samples" (HYG-006.md:38) is two samples; say n = 2.
- **Template rejection** (HYG-006.md:97–99). The reasons hold up: a database's privileges aren't copied from a template, so migration 0003's `REVOKE CONNECT, TEMPORARY … FROM PUBLIC` would be skipped, and each file would no longer migrate from zero. But "only faster when serialized" plays down that template plus serialization was the best variant measured: 66 ms p99 and 59 cycles against 42. Say plainly that it's rejected for coverage, not performance.

## Numbers I checked and found correct
- Failing run: 76 forced checkpoints; the longest took 3.093 s and synced 3 564 files; the gap is 35.776 → 41.516; the `pg_isready` "no response" is at 20:42:40.
- Stall runs: 67 checkpoints; 954.4 and 1 396.3 ms; 4 188 writes/s.
- Reproduction: maximum 868.2 ms.
- Variants: 98.5 / 3 825.2 (11 samples ≥500 ms) / 312.4 / 65.8 ms; 218 against 96 databases.
- The PostgreSQL 16.15 source excerpts confirm the mechanism: the forced checkpoint in `dropdb` (dbcommands.c:1783), the exclusive `RelationMappingLock` in `RelationMapCopy` (relmapper.c:312), and the shared map read during startup (`RelationCacheInitializePhase2`, postinit.c:824), which happens before authentication — so `pg_isready` is blocked as well.

I didn't check the `w_await` p99/max or the "17 creates / 64 drops" counts.

VERDICT: REQUEST_CHANGES
