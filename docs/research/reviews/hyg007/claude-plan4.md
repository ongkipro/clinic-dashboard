I checked all 12 round-1 findings against the current plan. Each one is closed by the plan text. The new parts hold up against the Better Auth 1.7.15 source. I found three LOW issues and nothing above that.

### Round-1 findings, now closed (plan = `/data/tmp/hyg007/HYG-007.plan.md`)

| Finding | Closed by |
|---|---|
| **H1** (backup codes minted with only the password) | :62–66 (a current code is required, same pattern as disable). Also :41–43 (allowed paths), :96 (UI field), :112–115 (tests), :150 (mutation), :162 (browser check). |
| **M1** (expired lock not cleared before counting) | :74 (reset first). Test :125 (after expiry, one wrong code leaves count 1 and no lock). |
| **M2** (reset can't find the session after enrolment) | :71 (decided once, stored in a `WeakMap` on the request headers) and :80 (reset by `user_id`). Test :134–135. I checked `dispatch.mjs:195–250`: the before and after hooks see the same headers object, and the nested `verifyTOTP` gets its own copy, so it is classified separately. |
| **M3** (sign-in detection differed from the plugin) | :69–70 (a valid session row, not the cookie). Test :136 (stale cookie plus challenge gives count 1). |
| **M4** (two clocks) | :81–83. The plan uses `Date.now()` rather than `config.now`, which is a different fix from the one I suggested. It is sound: the plugin reads and writes `lockedUntil` only with `Date.now()` (`verify-two-factor.mjs:133,180`), and `totp()` in `helpers.ts:93` defaults to `Date.now()`. |
| **L1** (lock mutation might survive) | :73, :77–79, test 2.12 (:142–147), mutation :156. |
| **L2** (enrolling case passing for the wrong reason) | :52 (refusal comes before the session gate and the RATE-2 claim). :110–111 assert the code `TOTP_URI_UNAVAILABLE` in both cases. |
| **L3** (lockout message) | :97, plus a `client.ts` unit test as a mutation. |
| **L4** (vendor surface) | :139–140. |
| **L5** (disable interaction) | :85–86. Test :137. |
| **L6** (no `auth_two_factor` row) | :73. |
| **L7** (decision record) | :102–103. `DECISIONS.md:52` already records DEC-041 (1), including the step-up lockout under DEC-010. |

### New parts

- **6-step order (:48–57).** Correct.
  - A wrong code makes the nested `verifyTOTP` throw inside the outer before hook. `dispatchAuthEndpoint` doesn't catch errors from `runBeforeHooks` (`dispatch.mjs:211`), so the outer after hook never runs and the RATE-2 claim stays: exactly one claim.
  - The nested path `/two-factor/verify-totp` isn't in `PASSWORD_PATHS`, so it adds no claim and counts exactly one second-factor failure. The claim in :57 is right.
- **Row lock (:73, :77–79).** Sound. A second `select … for update` waits on the first transaction's lock (a `transactionid` lock that isn't granted), and the second request's backend shows `wait_event_type='Lock'`. Both requests use the same login role, so `pg_stat_activity` shows that column.
  - The test pool has `max: 4` (`helpers.ts:28`): two held transactions plus the observer query fit.
- **Test 2.12 mutation (:145).** Deterministic. Detection depends on the hook count reaching 2, not on the final count, so it also works if the write is an atomic `+1`.
- **Fresh challenges in test 2.3 (:118).** Correct and needed:
  - `beginAttempt(5)` refuses on the 6th try on the same challenge (`verify-two-factor.mjs:72–85`), with 400 `TOO_MANY_ATTEMPTS`.
  - The challenge expires after 600 s (`index.mjs:293–296`), and that expiry uses `Date.now()`, so the 15-minute jump would invalidate an old challenge.
- **Clock rule (:81–83).** Consistent.
  - Session expiry, challenge expiry and `lockedUntil` all follow the faked `Date`.
  - The session gate and RATE-2 stay on `env.clock`, which doesn't move, so the jump can't trigger the idle lock.

### HIGH
None.

### MEDIUM
None.

### LOW
1. **Plan :48–57 / :68–80: where the step-up counting runs isn't stated.** The 6-step list orders only disable and regenerate. Say that classification and counting for `verify-totp` and `verify-backup-code` run after step 3, the session gate. Test :140 requires refused foreign-surface and disallowed-address requests to leave the counter unchanged, and a gate-refused (locked) session should not count either.
2. **Plan :143: "a lock wait for its backend".** The waiting request never reaches `afterRead`, so the test has no direct way to learn its backend ID. Either assert "an ungranted lock in this test database", which is safe because the database is a throwaway, or expose `pg_backend_pid()` from the counting transaction before the `select … for update`.
3. **Plan :83 / :147: frozen `Date` versus the 10 s bounds.** With `toFake: ["Date"]` and no `shouldAdvanceTime`, `Date.now()` is frozen. A wait loop that measures 10 s with `Date.now()` would never end. State that the bounds use real timers or `performance.now()`, or that test 2.12 runs without fake time.

Observation, not a finding: a correct code with a wrong password on disable or regenerate still resets the counter and sets `second_factor_at` through the nested call. The device was proven, so this is acceptable. It is also already the behaviour of disable today.

VERDICT: APPROVE
