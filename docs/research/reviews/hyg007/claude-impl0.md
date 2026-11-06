**HYG-007 implementation review: request changes.** The server code follows the plan and is sound. But the concurrency test fails as written, and the existing backup-code test in `tests/auth/security.test.ts` is not updated and will now fail.

**(2) Library checks: all confirmed**
- **WeakMap key:** the before and after hooks see the same headers object for one request. `dispatchAuthEndpoint` copies the headers once (`dispatch.mjs:205`). The before hook gets the same reference (`{...context}`, then better-call `context.mjs:22` `headers: context?.headers`). When the before hook returns nothing, `defuReplaceArrays({}, internalContext)` makes a shallow copy, so the same `Headers` object reaches `runAfterHooks`.
- **Nested `verifyTOTP`:** it is a separate dispatch with its own copied headers. Its before hook counts it once and its own after hook clears it on success. The outer `/disable` and `/generate-backup-codes` are not in `CODE_PATHS`, so they are not counted again.
- **Thrown `APIError` inside the transaction:** drizzle rolls back and rethrows (`node-postgres/session.js:190–191`). `runBeforeHooks` rethrows it, so the 429 propagates, including out of the nested call from disable and regenerate.
- **`.for("update")`:** exists in this drizzle version (`pg-core/query-builders/select.d.ts:586`).
- **No `auth_two_factor` row:** the counter returns early, and the plugin answers `TOTP_NOT_ENABLED`. A test covers this.

**(1) Plan conformance: all items match**
- Check order: surface → allowlist → `get-totp-uri` refusal → session gate → classification and count → RATE-2 claim → possession check.
- `get-totp-uri` is removed from `PASSWORD_PATHS` and `ENROL_PATHS`.
- The expired lock is reset only after the lock check.
- The counter uses `Date.now()`; the reset after success is by user id.
- `storeBackupCodes: "encrypted"` is pinned; the UI field and the message mapping are in place.

## HIGH

1. **`second-factor.test.ts` ~350–375: the concurrency test cannot pass.**
   - `enrolled(u.email)` enrols through `env.auth`, so the TOTP secret is stored encrypted with env's `BETTER_AUTH_SECRET`.
   - The `hooked` instance is built with a new `randomBytes(32)` secret.
   - The user has 2FA on, so `c.signIn` only returns a challenge. The next `verify-totp` then fails to decrypt (`totp/index.mjs` try/catch rethrows a plain error, giving 500), so `expect(...).toBe(200)` fails before the concurrency part runs.
   - Fix: share one secret, either by exposing it from `createAuthEnv` (as the vendor block now does with `SECRET`), or by creating and enrolling the user through `hooked`.
2. **`tests/auth/security.test.ts:113–131` is not updated and will fail.**
   - Line 119 sends `{}` and expects 400. The possession check now answers 401 `INVALID_CODE` before the plugin's body validation runs.
   - Line 121 sends the password only and expects 200; it now gets 401.
   - The plan names `security.test.ts` and `auth.test.ts` as the test files. This test has to be changed to send a current code, or moved into the new file.

## MEDIUM

3. **Done-when items with no evidence yet:** the docs (`docs/tasks/HYG-007.md`, STATUS, BUILD-LOG, ARCHITECTURE, the DEC-041 (1) consequence sentence), the browser checks (item 5), the full suite ×3 (item 4), and a recorded mutation run (item 3). These may be planned for later, but none of them is in the drop.

## LOW

4. **`server.ts:151`:** the 429 message differs from the plugin's own text (`error-code.mjs:15`). The plan says "the plugin's code and message". Reuse `TWO_FACTOR_ERROR_CODES.ACCOUNT_TEMPORARILY_LOCKED` or copy its exact string.
5. **`server.ts:159–171`:** the counter adds the attempt before the code is checked. A *correct* 5th code therefore sets `locked_until` for a short time until the after hook clears it, and a concurrent sign-in in that gap gets 429. This is acceptable, but add a comment saying so.
6. **`second-factor.test.ts` (step-up TOTP test):** `env.clock.now` is moved forward 30 s and never restored, so the shared clock leaks into later tests. Restore it in `afterEach`.
7. **`second-factor.test.ts` (message test):** it checks only the `MESSAGES` map, not that `callAuth` maps a 429 with this code. That is enough for the mapping mutation, but say so in the test name or comment.
8. **`security-panel.tsx:178`:** the help text names the device but not the password. The plan says the text should say both are needed.

## (3) Tests: what checks out
- **Determinism:** only `Date` is faked, so `Date.now()` stays frozen and the TOTP codes and the plugin agree. `wrong()` now avoids every code the verifier accepts (±2 periods).
- **Vendor test (after its fix):**
  - Both surfaces share one secret, so the foreign-surface case is real: a clinic token renamed to `__Host-vendor.session_token` is refused with `SESSION_WRONG_SURFACE`.
  - The disallowed-address case asserts `ADDRESS_NOT_ALLOWED`.
  - `VendorClient` overrides `post`, so `signIn` goes to `/vendor/api/auth`.
- **Mutation coverage:** each listed mutation fails a named test. The one exception is the row-lock mutation, which waits on finding 1.
- **Concurrency logic:** once finding 1 is fixed, the logic is right. It reads the second backend's pid, checks `wait_event_type = 'Lock'`, fails at once when `reached >= 2`, uses `performance.now()` bounds, and releases in `finally`.

VERDICT: REQUEST_CHANGES
