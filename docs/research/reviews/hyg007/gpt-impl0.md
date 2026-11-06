## Findings

Paths under `impl/` below refer to `/data/tmp/hyg007/impl/`. Repository paths are relative to the repository root. Review was read-only; no tests or commands were executed.

### MEDIUM

1. **The existing backup-code regeneration test will fail with these replacements.**  
   **`tests/auth/security.test.ts:119–122`; `impl/server.ts:370–373`**  
   The existing test expects regeneration without a code to return 200, and password-only invalid requests to return 400. The new possession guard instead returns 401 before the plugin checks the password. The staged new test does not replace or update that existing test, so the supplied implementation cannot satisfy the full-suite Done-when requirement. Update the existing test to supply a current authenticator code when testing password rejection and successful regeneration, retaining explicit missing-code rejection coverage.

2. **The vendor foreign-surface negative test silently skips its claimed check.**  
   **`impl/second-factor.test.ts:303–311`**  
   This user is already enrolled, so `clinic.signIn(email)` creates a two-factor challenge, **not an app session**. Consequently, `clinicCookie` is absent and the conditional skips the foreign-session request entirely. Additionally, the vendor instance uses a different signing secret from `env.auth`; merely obtaining and transplanting an app cookie would not exercise the foreign-surface row check because its signature would not validate.  
   Create an actual app-surface session with a signature accepted by the vendor instance, require the cookie to exist, and assert `SESSION_WRONG_SURFACE` specifically. Snapshot and compare the counter, lock and timestamp around that refusal. The `VendorClient` override itself does correctly dispatch to the vendor API and retain vendor cookies; the problem is the foreign-session setup.

3. **The concurrency test has an unbounded wait before reaching its bounded observation loop.**  
   **`impl/second-factor.test.ts:361–365`**  
   `await firstHeld` has no deadline. If the first verification fails before reaching `afterRead`, the test never reaches either its second-request observation or its `finally` cleanup; Vitest timing out the test does not cancel that awaited promise. This violates the plan’s explicit bounded-wait requirement and can leave the dedicated pool open.  
   Bound this wait using real time, surface early rejection/completion of the first request, and release and drain both request promises during cleanup. Once the first request reaches the hook, the existing backend-PID/`pg_stat_activity` observation and immediate plain-select mutation detection are meaningful.

4. **The TOTP timestamp-preservation assertion cannot detect an erroneous refresh.**  
   **`impl/second-factor.test.ts:138–147`; `tests/auth/helpers.ts:38–48`**  
   The test compares `second_factor_at` before and after failures, but `env.auth` uses the permanently fixed `env.clock.now`. Even a regression that stamps `second_factor_at` on every failed verification would write exactly the original value and pass this assertion. Faking `Date` does not change this injected clock.  
   Advance `env.clock.now` after capturing the baseline, without reaching the idle-session limit, or initialize the timestamp to a distinct earlier value. Then verify that both wrong-code failures and lock refusals preserve it.

### LOW

5. **The “wrong TOTP” helper is not deterministically wrong across the accepted window.**  
   **`impl/second-factor.test.ts:45–48`**  
   It excludes only the current TOTP. Better Auth’s installed OTP verifier accepts the previous, current and next periods (`@better-auth/utils/dist/otp.mjs`, `verifyTOTP`, default `window = 1`). A randomly generated secret can therefore make `"000000"`—or the fallback—valid in an adjacent period. Several tests also use real, moving time.  
   Choose a six-digit value absent from all accepted periods at a fixed test time; keep the concurrency test’s real timers and performance-based deadlines.

## Implementation checks that passed inspection

- Check ordering matches the plan: surface/address refusal, unconditional URI refusal, session gate, classification/counting for verify paths, RATE-2 for password paths, nested possession verification, then plugin password verification.
- **The WeakMap key is preserved between hooks.** `dispatch.mjs` copies incoming headers once when constructing `internalContext`. Both hooks receive that internal headers object; Better Call’s middleware context preserves `context.headers`. Nested `auth.api.verifyTOTP` dispatch gets its own copy, shared by its own before/after hooks.
- Nested verification is counted once: only verify paths classify/count; the outer disable/regenerate endpoint is not one.
- Drizzle’s installed implementation supports `.for("update")`. Its transaction implementation rolls back and rethrows the original callback error, so the lockout `APIError` propagates correctly.
- Row-lock counting, expired-lock reset, `Date.now()` clock, success reset by stored user ID, explicit encrypted backup-code storage, UI code submission and lockout message mapping match the plan.
- When no second-factor row exists, counting returns without mutation and allows the plugin’s `TOTP_NOT_ENABLED`/`BACKUP_CODES_NOT_ENABLED` response. There is no new regression test for that branch.

## Remaining Done-when evidence

The supplied files do not establish completion of typecheck/lint/docs checks, named mutation runs, full suite ×3, browser validation at all specified widths and 200% text, documentation updates, or both independent implementation approvals. Those remain integration gates, not claims verified by this read-only review.

VERDICT: REQUEST_CHANGES
