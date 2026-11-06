**HYG-007 plan review, round 1**

F1–F3 are real as stated; I checked each against the Better Auth 1.7.15 source. Two things block approval. First, the F1 fix leaves an equivalent way to mint a second factor open. Second, the F2 design has three correctness gaps.

### HIGH

**H1. `/two-factor/generate-backup-codes` has the same weakness as F1, and the plan doesn't cover it.**
- The endpoint (`backup-codes/index.mjs:240-276`) only needs `sessionMiddleware` and the password. It returns 10 fresh plaintext backup codes.
- Backup codes pass the sign-in challenge and step-up `verify-backup-code`, which sets `second_factor_at` (`server.ts:79`, after hook ~`:299-302`).
- So someone with a session and the password still gets a lasting second factor without the device: they can sign in later from anywhere and refresh the vendor step-up.
- Refusing only `get-totp-uri` doesn't restore "possession of the device" (`server.ts:284-292`).
- The UI calls the endpoint with the password only (`src/app/(auth)/security-panel.tsx:141`).
- **Fix:** require a current TOTP code, the same pattern as `/two-factor/disable` (`server.ts:288-292`). That means:
  - a code field in `security-panel.tsx`, so the Allowed Paths must widen beyond "server.ts and tests only";
  - a negative test: password but no or wrong code gives 401 and no `backupCodes`;
  - a mutation that removes the check;
  - the browser evidence step must cover this flow.

### MEDIUM

**M1. An expired lock is never cleared before counting (plan §Change 2, "Otherwise record a pending attempt").**
- The plugin clears an expired lock lazily: `failedVerificationCount=0, lockedUntil=null` (`verify-two-factor.mjs:117-140`).
- As written, the plan increments a count that is already ≥5. The first attempt after the 15 minutes then re-locks immediately: one wrong code means another 15 minutes.
- Done-when 2.2 doesn't catch this, because it uses a correct code after expiry and the success resets the count.
- **Fix:** reset under the advisory lock when `locked_until <= now`. Add a test: after expiry, one wrong code gives 401 and the next correct code gives 200, not 429.

**M2. The after-hook reset can't find the session after enrolment succeeds.**
- On first verification (`verified !== true`), `verify-totp` creates a new session and deletes the old one (`totp/index.mjs:157-166`). `sessionRow(ctx.headers)` in the after hook then returns `undefined`, so the "on success … with a session" reset is skipped.
- The after hook can't use `ctx.context.newSession` to tell step-up from sign-in either: `valid()` sets it at sign-in too (`verify-two-factor.mjs:31-37`, `cookies/index.mjs:181`).
- **Fix:** decide "counted step-up for user X" once in the before hook, carry it to the after hook (for example a per-request `WeakMap` keyed on headers or context), and reset by user id.
- **Test:** wrong code(s) during enrolment, then a correct one, gives count 0.

**M3. The sign-in detection rule doesn't match the plugin's `isSignIn`.**
- The plan says "no session cookie for this surface". The plugin uses `getSessionFromCtx` (`verify-two-factor.mjs:14`), which looks up the database row. An expired or deleted session returns null (`api/routes/session.mjs:153-165`), so the plugin treats that request as a sign-in.
- A stale cookie next to a `two_factor` challenge cookie would then be counted twice.
- **Fix:** specify detection as `sessionRow(ctx.headers)` returning a row (a valid session of this surface), not cookie presence. Optionally test: stale session cookie + challenge cookie + one wrong code gives count 1.

**M4. The clock source for the lock is ambiguous.**
- The plan says "`locked_until > now()`" without saying whether that is SQL `now()` or the injected `config.now()`. Done-when 2.2 needs the injected clock.
- The plugin writes and reads `lockedUntil` with `Date.now()` (`verify-two-factor.mjs:118, 162-164`). The app would use `config.now()`. In production they are the same.
- In tests the shared `env.clock` has already been advanced (`auth.test.ts:174, 227`). Locks written by one path are then judged on a different clock by the other path, so any test mixing sign-in and step-up locks becomes order-dependent.
- **Fix:** state explicitly that the app uses `config.now()` for both the write and the compare. Either keep each test on one path, or reset `env.clock.now` per test (`beforeEach`).

### LOW

**L1. The "advisory lock removed" mutation may survive.**
- If counting is a single atomic `UPDATE … SET failed_verification_count = failed_verification_count + 1 … RETURNING`, the 12-way concurrency test passes without the lock. If it is select-then-update, the test fails only by chance.
- **Fix:** name the exact SQL shape (read under the lock, then write), or drop that mutation and rely on the atomic update.

**L2. Done-when 2.1's "session still enrolling" case passes for the wrong reason.**
- Once `get-totp-uri` leaves `ENROL_PATHS`, the session gate returns 403 `SESSION_LOCKED` (`server.ts:241-259`).
- **Fix:** assert `json.code === "TOTP_URI_UNAVAILABLE"` in both cases. Put the refusal before the session gate and the RATE-2 claim, so it never claims an attempt.

**L3. The lockout message isn't the one the plan describes.**
- `src/app/(auth)/client.ts:5-13` maps `ACCOUNT_LOCKED`, which is not a Better Auth code. `ACCOUNT_TEMPORARILY_LOCKED` therefore falls through to the generic 429 text "Terlalu banyak percobaan. Coba lagi sebentar lagi." (`client.ts:31-32`). The same already happens for the sign-in 2FA lock.
- The plan's risk note and the screenshot step assume the specific copy. Add the mapping ("Akun dikunci sementara. Coba lagi dalam 15 menit."), which needs Allowed Paths to include `client.ts`.

**L4. No test on the vendor surface.**
- The vendor surface is the one that relies on `second_factor_at`. Add one step-up lockout test with `surface: "vendor"` and allowlisted IP, confirming `second_factor_at` is unchanged.

**L5. Interaction with `/two-factor/disable` is unspecified.**
- The disable before hook calls `auth.api.verifyTOTP` (`server.ts:291`), which goes through the hooks, so wrong disable codes now count toward the 2FA lock. While locked, disable returns 429 `ACCOUNT_TEMPORARILY_LOCKED`.
- That behaviour is right, but it should be stated and tested. Existing `security.test.ts:79-80` sends `000000` to disable; check the counts there still fit.

**L6. No `auth_two_factor` row.**
- The before hook must skip counting when the row is absent (plugin returns `TOTP_NOT_ENABLED` / `BACKUP_CODES_NOT_ENABLED`). State it.

**L7. Decision record.**
- Refusing `get-totp-uri`, step-up counting, and (per H1) a code for backup-code regeneration all constrain later work.
- Add a `DECISIONS.md` row, or amend DEC-010 ("5 failed codes lock 15 min" now covers step-up too). Update `ARCHITECTURE.md`.

### Checked and sound
- **Refusing `get-totp-uri` outright is safe:**
  - Nothing in `src/` calls it; enrolment uses `/two-factor/enable`'s `totpURI` (`enrol-form.tsx:22-32`).
  - `twoFactorClient` only lists it in `pathMethods`; no client or plugin flow calls it automatically.
  - Server-side `auth.api.getTOTPURI` would also pass through the hooks.
- **The after hook sees failure correctly for both verify endpoints:**
  - `invalid()` and `INVALID_BACKUP_CODE` / `CONFLICT` throw an `APIError`.
  - `dispatch.mjs:240-251` stores it in `context.returned`, which the existing `failed`/`instanceof Error` check covers.
- **Endpoints that aren't configured are harmless:**
  - `send-otp` refuses without `sendOTP` (`otp/index.mjs:75-81`).
  - `verify-otp` can't succeed without a stored value, and it is outside `SECOND_FACTOR_PATHS`.
  - `enable` with `method:"otp"` refuses after the counted password check.
- **trustDevice:** the field is stripped on every `/two-factor/verify-*` call (`server.ts:237-239`), so no trust cookie is ever issued.
- **F3:** the mutation to `"plain"` would put the codes as JSON plaintext in `backup_codes`, so the planned substring check would catch it.

VERDICT: REQUEST_CHANGES
