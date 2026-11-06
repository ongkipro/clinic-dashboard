I found one HIGH and one MEDIUM defect in the Better Auth lane, plus one LOW test gap, so the verdict is REQUEST_CHANGES. I read every file in scope. To check claims about Better Auth 1.7.15 I also read its source in `node_modules/better-auth/dist`; I didn't run anything.

## Findings

### F1 — HIGH: anyone holding a session and the password can read the enrolled TOTP secret, so possession of the authenticator device is no longer proven
- **Where:**
  - `src/auth/server.ts:63-71`: `/two-factor/get-totp-uri` is listed only as a password path. Nothing blocks it once TOTP is enrolled.
  - `src/auth/server.ts:76`: it is also in `ENROL_PATHS`.
  - Library: `node_modules/better-auth/dist/plugins/two-factor/totp/index.mjs:70-112`. The endpoint uses only `sessionMiddleware`. It decrypts the stored secret and, after `checkPassword`, returns `totpURI`, which contains the secret. It never checks `twoFactorEnabled`, `verified` or session freshness.
- **What is wrong:** the code says turning the authenticator off needs "the password and a current code: possession of the device, not only of the session" (`server.ts:276-279`). T-023 says the authenticator can be replaced only by turning it off with a current code. The test `security.test.ts` "an enrolled authenticator cannot be replaced through setup" refuses `/two-factor/enable` for this reason. But with a session and the password, an attacker can:
  1. call `get-totp-uri` and get the live secret;
  2. generate valid codes forever;
  3. turn TOTP off, or keep a copy of the authenticator and sign in later from anywhere.

  Doctors, owners and finance staff have no idle lock (`policy.ts:43`), so an unattended session plus a shoulder-surfed password is enough. That defeats IAM-1's second factor for the TOTP roles. On the vendor surface it also lets the attacker refresh `second_factor_at` without limit. `vendor_guard`'s 10-minute step-up (`drizzle/0044:134`, `0046:188`) relies on that column.
- **Fix:** in the before hook, refuse `/two-factor/get-totp-uri` when `user.twoFactorEnabled` is true. Enrolment does not need this endpoint because `/two-factor/enable` already returns `totpURI`, so it could also be removed from `ENROL_PATHS` and refused outright. Add a negative test: an enrolled account calls `get-totp-uri` with the right password and gets a 4xx with no `totpURI`.

### F2 — MEDIUM: wrong TOTP codes sent from an existing session are never counted, so step-up codes can be brute-forced
- **Where:**
  - `src/auth/server.ts:63-71`: `/two-factor/verify-totp` is not a password path, so no RATE-2 attempt is claimed.
  - `src/auth/server.ts:295-302`: a successful call sets `secondFactorAt`.
  - Library: `totp/index.mjs:139-170` and `verify-two-factor.mjs:99-113`. When a session exists, `isSignIn` is false, so `assertTwoFactorNotLocked`, `beginAttempt` and `recordTwoFactorFailure` are all skipped.
- **Why it matters:** DEC-010 says "5 failed codes lock 15 min", but that only holds at the sign-in step. In the step-up path (session already open), the only limit is the plugin's per-IP limiter of 3 requests per 10 s (`two-factor/index.mjs:341-346`). That is about 8.6k guesses in one 8-hour vendor session, more with several allowlisted IPs. A success writes a fresh `second_factor_at`, which `vendor_guard` uses to allow write actions. No test covers wrong step-up codes.
- **Fix:** in the before hook, treat a session-bearing `/two-factor/verify-totp` as an attempt per account. Either claim a RATE-2 attempt (and clear it in the after hook on success), or count it against `auth_two_factor.failed_verification_count` and `locked_until`. Add a test: after 5 wrong step-up codes, a correct code is refused and `second_factor_at` is unchanged.

### F3 — LOW: the storage test reads `backup_codes` but never checks it
- **Where:** `tests/auth/auth.test.ts`, test "stores no plaintext password or TOTP secret". It selects `t.backup_codes` but has no assertion on it.
- **Why it matters:** backup codes are protected only by Better Auth's default `storeBackupCodes: "encrypted"` (`two-factor/index.mjs:26`): reversible encryption with `BETTER_AUTH_SECRET`, not hashing. If that default changed to `"plain"`, no test would fail. No spec line requires hashing, so this is a test gap, not a rule breach.
- **Fix:** enrol, keep the returned `backupCodes`, and assert that none of them appears in the stored `backup_codes`. Optionally set `backupCodeOptions.storeBackupCodes` explicitly.

## Checked and sound
- **RATE-2 counting:** an attempt is claimed per normalised email under `pg_advisory_xact_lock`, counted and inserted in one transaction (`server.ts:98-112`). The concurrency test (12 parallel requests give exactly 5×401 and 7×429) proves it is atomic.
  - The lockout is independent of IP (tested across IPs).
  - The 15-minute window and expiry are tested.
  - Only a proven password clears an account's attempts.
  - Validation errors keep their claim.
  - Unlock uses the same claim and ends the session at the limit.
  - Weak new passwords are refused before the claim (documented).
- **Account-existence leaks:** an unknown email gets the same 429 and the same delay. Better Auth hashes a dummy password for unknown users (`sign-in.mjs:320`). The logger message has no email.
- **Progressive delay:** 0/250/500/1000/2000 ms, counting in-flight attempts. Tested with an injected sleep.
- **Idle lock (IAM-7):** 120 s, applied only to `fo_cashier`.
  - `checkSession` records the lock on the server; it stays locked until a password re-check. Background reads don't extend the session.
  - The before hook refuses every Better Auth endpoint for locked or not-yet-enrolled sessions, except get-session and sign-out (tested).
- **TOTP enrolment gate:** the role set matches IAM-1/PR-3 exactly, and the test uses literal spec values. The strictest role wins, an unverified enrolment doesn't count, and the vendor surface always requires TOTP. A trusted-device cookie is never issued (body field removed; tested).
- **Backup codes:** single use (compare-and-set at `backup-codes/index.mjs:220-230`) and replaced on regeneration (tested). At sign-in, wrong codes count toward the account lockout.
- **Passwords (IAM-1):** at least 15 characters, a blocklist, and no email-derived passwords, enforced both in `createStaffAccount` and in change-password.
  - Change-password needs the current password, counts toward RATE-2, and always ends other sessions (the client's `false` is overridden; tested).
  - Password reset isn't reachable because no reset sender is configured.
  - Public sign-up is disabled.
- **Sessions:** 12 h absolute for staff and 8 h for vendors, with no refresh, no cookie cache and no bearer plugin.
  - Sessions are tagged by surface and foreign tokens are refused.
  - Sign-out, `endSession` and `endOwnSession` are tied to the owner and the surface. The current session or another user's session is refused (tested).
- **`createStaffAccount` / `discardNewAccount` races:** a duplicate email (23505) maps to `AccountExistsError`, and a failed credential link is cleaned up. The discard runs in one transaction, and the membership foreign key (restrict) blocks or waits on a concurrent accept.
- **Configuration and logs:** the secret is at least 32 characters; `APP_URL` must be https unless explicitly allowed for loopback; telemetry is off; the route sets `cache-control: no-store`. No secrets or personal data are logged (only `userId`). Test fixtures are synthetic and the secret is random.

## Findings table

| # | Severity | File:line | Issue | Smallest fix |
|---|---|---|---|---|
| F1 | HIGH | `src/auth/server.ts:63-76` (Better Auth `totp/index.mjs:70-112`) | `get-totp-uri` returns the enrolled TOTP secret to anyone with a session and the password, so possession of the device is no longer proven and the attacker can keep a working copy of the authenticator | Refuse it when `twoFactorEnabled`; add a negative test |
| F2 | MEDIUM | `src/auth/server.ts:63-71, 295-302` (`verify-two-factor.mjs:99-113`) | Step-up `verify-totp` from an open session has no per-account failure limit, yet sets `second_factor_at`, which `vendor_guard` uses for writes | Count step-up failures per account (RATE-2 claim or the 2FA counter); add a test |
| F3 | LOW | `tests/auth/auth.test.ts` (storage test) | `backup_codes` is selected but not checked; storage relies on an unpinned library default (encrypted, not hashed) | Assert no issued code appears in storage; pin `storeBackupCodes` |

VERDICT: REQUEST_CHANGES
