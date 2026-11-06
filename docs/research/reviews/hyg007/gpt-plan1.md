## Findings

### HIGH — Password-only backup-code regeneration preserves an equivalent second-factor bypass
**Files:** `src/auth/server.ts:63–71,295–302`; `node_modules/better-auth/dist/plugins/two-factor/backup-codes/index.mjs:278–305`; `src/app/(auth)/security-panel.tsx:137–145`; `DECISIONS.md:44`

Blocking `get-totp-uri` fixes secret disclosure, but a holder of the same session and password can still:

1. Call `/two-factor/generate-backup-codes` without proving an existing second factor.
2. Use a newly issued code at `/two-factor/verify-backup-code`.
3. Obtain a fresh `second_factor_at` and retain codes for subsequent sign-ins.

This does not disclose the TOTP secret or directly satisfy the TOTP-only disable guard, but it preserves the central account-access and vendor-step-up bypass under F1’s threat model.

DEC-033 explicitly describes backup-code management after a password re-check, so this is also a **policy gap requiring an explicit decision**, not merely a missing implementation check. The plan should either require an existing second factor for regeneration, or document and obtain acceptance of the residual risk. Add app/vendor negative tests accordingly.

### MEDIUM — “No session cookie” does not match the plugin’s `isSignIn`
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:44`; `node_modules/better-auth/dist/plugins/two-factor/verify-two-factor.mjs:14–15`; `node_modules/better-auth/dist/api/routes/session.mjs:153–155,246–260`

The plugin uses a **resolved session**, not cookie presence. An expired, revoked, malformed or otherwise invalid session cookie does not make the request a step-up. With a valid challenge cookie, it can still be a sign-in verification.

The plan’s earlier wording (“with a session of this surface”) is appropriate, but its stated detection rule contradicts it. Specify:

- Resolve a valid session on the current surface, consistently with `getSessionFromCtx`.
- Capture the account/session classification **before verification**.
- Use that captured classification in settlement; do not classify again based on a newly created session.

Test stale/revoked cookies accompanying a valid sign-in challenge, plus foreign-surface rejection. Otherwise counting may be skipped, doubled, or attributed incorrectly.

### MEDIUM — Expired locks are not explicitly cleared before claiming the next attempt
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:40–43`; `node_modules/better-auth/dist/plugins/two-factor/verify-two-factor.mjs:136–158`

The proposed algorithm rejects an active lock, then otherwise increments the existing counter. It does not say to reset an **expired** lock and its counter.

After five failures and expiry, the next wrong code could increment five to six and immediately lock the account again. Better Auth explicitly clears the expired lock and resets the count before verification.

Specify expiry reset within the same locked transaction, before incrementing. Add a test that, after expiry, **one wrong code leaves count one and no lock**, followed by the remaining fresh budget. The planned “correct code succeeds after expiry” test would miss this defect because success clears the counter anyway.

### MEDIUM — The clock contract is incomplete for a counter shared with Better Auth
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:41–42,58`; `src/auth/server.ts:88`; `tests/auth/helpers.ts:37–46,110`; `node_modules/better-auth/dist/plugins/two-factor/verify-two-factor.mjs:139,188`

The application’s injected `now()` and Better Auth’s `Date.now()` would both interpret and write the same `locked_until` field. Advancing only `env.clock.now` can make step-up regard a lock as expired while sign-in still regards it as active. Conversely, a lock written using an advanced app clock can remain active unexpectedly from the plugin’s perspective.

Specify a common clock strategy for these tests, including TOTP generation and challenge/session validity. At minimum, cover:

- Sign-in failures locking step-up.
- Step-up failures locking sign-in.
- Expiry and reset in both directions.
- A mixed TOTP/backup-code failure budget.

Generating TOTP at the injected future time without advancing the library clock would also produce invalid “correct” codes. Use controlled system time or another explicitly documented, consistent approach.

### MEDIUM — Done-when assumes nonexistent sign-in lockout coverage and omits important new branches
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:45,53–61`; `tests/auth/auth.test.ts:168–243`; `tests/auth/security.test.ts:73–138`

The existing “sign-in lockout” tests exercise **password RATE-2**, not the plugin’s account-level second-factor lockout. Searching `tests/` found no assertions for `ACCOUNT_TEMPORARILY_LOCKED`, `failed_verification_count` or `locked_until`. Keeping existing tests green therefore does not establish the claimed unchanged sign-in behavior.

Add explicit tests for:

- Five failed sign-in second factors, refusal of a correct code while locked, and recovery.
- Both verification endpoints retaining failures and leaving `second_factor_at` unchanged.
- Success clearing a **partial** failure budget.
- `verified=false` enrolment failures, lockout and successful completion.
- Successful enrolment resetting the counter despite session rotation.
- Vendor-surface step-up, allowlist rejection and foreign-surface refusal.
- `/two-factor/disable` invoking nested `verifyTOTP`: shared lock enforcement, no double count, and unchanged disable behavior.

The pending-attempt/advisory-lock approach is reasonable for concurrent session-bearing requests, but these branches are not demonstrated by the proposed tests.

### LOW — Parallel requests alone do not make the advisory-lock mutation deterministic
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:60,68`; `tests/auth/helpers.ts:34`

Twelve requests through a four-connection pool provide useful concurrency coverage, but do not guarantee an overlapping read/check/update schedule when the advisory lock is removed. Depending on the eventual SQL and scheduling, that mutation may survive.

Specify deterministic coordination for the relevant race, or document a reliable mutation procedure that forces contention. Three full-suite passes do not establish that the lock-removal mutation must fail.

## Verified and sound

- **F1–F3 are real.** `get-totp-uri` returns the decrypted secret after session/password checks; both verification endpoints skip account lockout for existing sessions; the storage test selects backup codes without asserting their protection.
- **Refusing `get-totp-uri` outright is safe for current callers.** The only `src/` references are the two endpoint sets. Enrolment receives the URI from `/two-factor/enable`. The Better Auth client lists the endpoint but does not automatically invoke it; neither enrolment nor verification internally depends on it.
- **Failure observation works for both verification endpoints.** TOTP’s `invalid(...)` throws, as does backup-code rejection. Better Auth’s dispatcher places the `APIError` in `ctx.context.returned`, including `statusCode`, before the after hook (`node_modules/better-auth/dist/api/dispatch.mjs:236–247`). Preserve the existing error exclusion when implementing success settlement.
- **Unconfigured OTP is not a demonstrated bypass.** `send-otp` rejects without `sendOTP`; `enable` with `method: "otp"` also rejects. `verify-otp` lacks that configuration guard but requires an existing OTP verification record, which the current configuration cannot issue.
- **`trustDevice` stripping covers both verification endpoints**, and the proposed explicit encrypted backup-code option plus plaintext-storage assertion is appropriate.

VERDICT: REQUEST_CHANGES
