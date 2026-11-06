## Findings

### MEDIUM — The deterministic concurrency mutation contradicts the retained row lock
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:69–75,128–132,141`

The counting transaction takes both an advisory lock and `SELECT … FOR UPDATE`. Removing only the advisory lock does **not** let the second request pass `afterRead` while the first holds its barrier: it instead waits on the row lock. After release, it reads the updated count and the final count remains **2**, not the planned **1**.

Consequently, round 1’s concurrency finding is not closed: the proposed mutation cannot produce its stated schedule.

**Required change:** Choose and document the actual serialization guarantee:
- Retain the row lock and test that removing the advisory lock still preserves correctness; drop the unnecessary advisory-lock mutation requirement, or
- Define a mutation removing the effective serialization and a bounded, deterministic test for that mutation.

Ensure barrier cleanup runs in `finally` and waits have bounded failure paths.

### MEDIUM — Sign-in recovery test reuses a challenge that expires before the account lock
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:111–114`; `node_modules/better-auth/dist/plugins/two-factor/index.mjs:298–310`; `node_modules/better-auth/dist/plugins/two-factor/verify-two-factor.mjs:16–21,71–98`

The default sign-in challenge lasts **600 seconds**, whereas the account lock lasts **900 seconds**. Advancing system time by 15 minutes makes the original challenge invalid. A correct TOTP with that challenge cannot return the planned 200.

There is also a separate five-attempt challenge budget, so account-lock tests must distinguish that budget from the account-level counter.

**Required change:** Explicitly obtain a fresh password sign-in challenge after advancing time, then verify the current TOTP and assert the counter reset. For shared-budget tests, likewise specify fresh challenges where needed so challenge expiry/exhaustion cannot mask the account-lock behavior.

### LOW — Regeneration guard ordering remains contradictory
**File:** `/data/tmp/hyg007/HYG-007.plan.md:48–60`

The section says both endpoint checks run **before the session gate and RATE-2 claim**, then says regeneration’s code verification runs **after the RATE-2 claim**. These are materially different implementations: placing the nested verification first means a wrong authenticator code does not preserve an outer password-attempt claim as promised.

**Required change:** State one unambiguous order:
1. Surface and vendor-address checks.
2. Unconditional `get-totp-uri` refusal.
3. Session gate.
4. RATE-2 claim for regeneration/disable.
5. Required-code validation and nested `verifyTOTP`.
6. Plugin password check.

Add an assertion that a wrong regeneration code retains exactly one RATE-2 claim while incrementing the second-factor budget exactly once.

### LOW — Round 1’s enrolment and surface-negative test requests are only partially closed
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:124–127`; `tests/vendor/host.test.ts:180–190,403–407`

The revised enrolment test covers partial failures followed by successful session rotation, but not **lockout while `verified=false`**, which round 1 explicitly requested. The vendor test covers an allowlisted successful classification/lockout path, but does not explicitly assert that rejected foreign-surface or disallowed-address verification calls leave the new counter untouched.

Existing vendor tests check surface isolation and address rejection, but do not establish the new counter’s lack of side effects.

**Required change:** Add:
- Five enrolment failures, refusal of a correct code while locked, and successful completion/reset after expiry.
- Verification requests rejected for foreign surface and disallowed vendor address, asserting unchanged counter, lock and `second_factor_at`.

## Verified and closed in the revised design

- **F1–F3 are real.** The installed library returns the decrypted TOTP URI after session/password checks; both verification endpoints skip account lockout for resolved sessions; the existing storage test selects backup codes without asserting their protection.
- **Refusing `get-totp-uri` outright is safe for current flows.** Its only `src/` references are the endpoint sets. Enrolment consumes `/two-factor/enable`’s URI. `twoFactorClient` lists the endpoint but does not invoke it automatically.
- **The round 1 HIGH is addressed.** Regeneration now requires current TOTP possession, has UI scope and negative tests, and is authorized by revisable DEC-041.
- **Session classification is now appropriate.** Resolving a valid database session matches the plugin’s `getSessionFromCtx`/`isSignIn`, unlike cookie presence. Capturing the user before verification handles enrolment’s session rotation. The dispatcher preserves the headers object between the before and after hooks; nested API calls receive their own cloned headers.
- **Failure settlement is sound.** Both verification endpoints throw `APIError` on rejection; the dispatcher places it in `ctx.context.returned` before the after hook. Preserve both the error exclusion and status check.
- **Expired-lock reset and the common `Date.now()` clock close the previous design gaps.** Fake-Date-only tests are appropriate, provided fresh challenges and current-time TOTP generation are used.
- **Disable/regeneration nesting counts once**, as designed: the nested verification is counted; the outer endpoint is not a verification path.
- **Missing-factor rows, explicit encrypted backup storage, the lockout message mapping, and vendor positive coverage** are addressed.
- **No additional configured OTP or trusted-device bypass found.** `send-otp` and OTP enablement reject without `sendOTP`; `verify-otp` requires an OTP record this configuration cannot issue. `trustDevice` is stripped from all verification requests.

Read-only review; no files modified or tests run.

VERDICT: REQUEST_CHANGES
