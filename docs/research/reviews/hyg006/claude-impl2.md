**HYG-006 implementation review, round 2**

All round-1 findings from both reviewers are closed, and nothing above LOW remains. The new code is correct, its tests are deterministic and the mutation evidence now holds. I changed nothing.

### HIGH
None.

### MEDIUM
None.

### LOW

1. **The structural scan can be fooled by a quote inside a regex.** `tests/rls/harness-lock.test.ts:91–113`
   - The scanner tracks `'`, `"` and `` ` `` strings, but it does not recognise regex literals.
   - A regex with an unmatched quote opens a fake string. One exists today: `tests/platform/hosts.spec.ts:183`, `/<[a-z][^>]*\sstyle="/`.
   - From then on the file is read with strings and code swapped. In that state, a `//` inside a later real string (for example `"https://…"`) is read as a comment and blanks the rest of that line.
   - A DDL statement placed after such a URL on the same line would then be missed. That is the only way past the guard, and no file is affected today: the scan finds no offenders and the mutations show it catches direct statements.
   - Suggestions: treat `/…/` after an operator or `(` as a regex, or add a self-check case with a quote in a regex.

2. **The new 2 s observer timeouts can make test 11 hang until its 60 s timeout under load.**
   - Location: test 11 in `tests/rls/harness-lock.test.ts` (about 359–385) and `defaultObserver` in `tests/rls/harness.ts:68–69`.
   - Test 11 waits for a line containing `pid <holder>`. If the observer's connect or query hits the 2 s limit (new in round 1), it prints only "holder report failed". The barrier never resolves.
   - The test then fails at 60 s with no useful message, instead of failing at once on the failure line. This is unlikely given this round's stress (worst new connection 534 ms), but the control runs reached 1 978 ms.
   - Suggestion: resolve the barrier on any `DDL lock wait over` line, then assert that it names the pid.

3. **No mutation covers the `stopped` guard that suppresses a late report line.**
   - Location: the `if (!stopped)` checks in `tests/rls/harness.ts:80–92`.
   - The doc says a cut-off report "is then not printed". Test 11b's final assertion would catch removing the guard: the fake's `end()` rejects `connect`, and the catch runs before the test's checks.
   - That mutation is not in `mutations.sh`, so the claim has no recorded mutation. Optional: add one.

4. **One sentence in the doc slightly overstates how the mutation evidence was produced.** `docs/tasks/HYG-006.md` (Results after round 1, opening line)
   - It says every check was re-run on the final files by `rerun-all.sh`. The passing mutation run (00:57, `mutations-1793840022`) was a separate run after the script was patched (`observer-mutate.py`), not part of `rerun-all.sh`'s sequence.
   - The code digest (`40519029…`) is the same for every check, and the next bullets explain the replaced mutation, so nothing is hidden.
   - Suggestion: say that the mutation check was re-run after the script fix.

### Round-1 findings: closed
- **GPT 1 and claude 4 (observer could delay the operation; test 11b depended on the host):** the report is now stopped when the acquisition settles, never awaited, and the default observer has 2 s timeouts. Test 11b injects a fake observer whose connect never settles, waits for the report to start, and checks that the operation settles, that `end()` was called and that no line was printed. The `await-stalled-report` mutation times out and `no-stop-observer` fails on `ended`.
- **GPT 2 (multiline DDL):** the scan now matches over the whole text, with a multiline self-check.
- **GPT 3 (observer isolation):** each call's observer has its own name, and test 11 waits for that name to disappear.
- **GPT 4:** test 3 uses one polling loop. `drop-exclusive.log` now shows `expected 'waiting' to be 'granted'` after 131 ms.
- **GPT 5 (`lock_wait` missing):** `onLockWait` runs in the acquisition's `finally`, and setup and close both report it. Test 14 checks this; both "dropped" mutations are caught.
- **GPT 6 and claude 5 (test-3 timing claim):** the superseded section now says the cited run predates the change; the new evidence above supports the current test.
- **claude 1 (Results described old code):** 20 lock tests and 779 per full run, matching `full-1793839700/full-*.log`.
- **claude 2 (call-site positions):** `sites.txt` is computed after `restore`. `sites-mutate.py` checks the call text at each position before mutating, and every site is judged. The kept `migrations-site-N.test.ts` copies show exactly one direct statement each, at lines 60/68/74/88, and the logs name those lines.
- **claude 3 (stale patterns):** all patterns match the current code; there were no setup failures.
- **claude 6:** `onLockWait` errors are caught.
- **claude 7 (sweep error replaced):** fixed. Test 8c checks it, and the `sweep-unlock-replaces-error` mutation reproduces "Client was closed".
- **claude 8 (string-blind comment stripper):** fixed, with self-checks; see LOW 1 for the remaining regex case.
- **claude 9:** `observerUrl` is gone (replaced by the `observer` factory), and `HarnessOptions` omits `onLockWait`.
- **claude 10:** `ARCHITECTURE.md` points to `STATUS.md` for the count. The cited probe line (`round1-evidence/stress-fnew4-1793834350/probe.log` line 120, 580.4 ms) checks out.

### New code: correctness
- `connect()` is called synchronously when the report starts, so `stop()` always ends a connection that has begun. The report's promise cannot reject, and the timer is cleared on every settlement path.
- The sweep's `failed` flag ignores only an unlock error that follows a real failure.
- The slow-setup report also runs on error paths, and the full-suite logs contain no `[harness]` line.

### Evidence vs the doc
- **Stress:** the stress copy equals `tests/rls/harness.ts` apart from the import path. Every gate figure matches `final-stress-gates-r2.txt` (median window 23.95 against 25.6 s, +6.9 %; checkpoints 18–23 against 18; `create_beside_ddl` 0; worst new connection 534 against 1 978 ms; harness p50 timings).
- **Full suites:** 779 passed and 13 skipped in each run, 42.36–43.74 s. Forced checkpoints are 39, 37 and 35 by counting the `pg-*.log` lines. No crash lines.
- **Mutations:** 28 run, each with a test executed, each failing the intended test.
- **Ledger:** the typecheck, lint, lock-tests, stress, test-full and mutations records all carry the same digest (`40519029…`).

VERDICT: APPROVE
