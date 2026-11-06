## Findings

### LOW — Recovery consequence still promises a replacement flow that the possession rule prevents
**Files:** `/data/tmp/hyg007/HYG-007.plan.md:169`; `DECISIONS.md:52` (DEC-041 (1)); `src/auth/server.ts:287–292`; `node_modules/better-auth/dist/plugins/two-factor/index.mjs:133–140`

DEC-041 says someone who loses the authenticator can sign in with a remaining backup code **and replace it**. That second step is unavailable:

- Backup-code verification permits sign-in but does not reveal the authenticator secret.
- `/two-factor/disable` requires a current **TOTP** code, even after backup-code sign-in.
- `/two-factor/enable` refuses replacement of an already verified authenticator.
- The plan correctly closes URI retrieval and requires TOTP for backup-code regeneration.

Consequently, losing the authenticator requires assisted recovery **to replace the factor even when backup codes remain**. Remaining backup codes permit continued sign-in, not self-service replacement. The plan’s risk statement mentions only the case with no backup codes left, leaving DEC-041’s incorrect consequence uncorrected.

**Required change:** Preserve the possession guards, but correct the documented consequence in the plan and decision record: backup codes recover sign-in access; authenticator replacement requires assisted recovery when the old authenticator is unavailable. Widen the decision-record Allowed Paths restriction beyond “only its status note” to permit this clarification. Alternatively, obtain a revised recovery decision and separately scope its implementation—do not silently accept a backup code in place of the required current authenticator code.

## Previous findings and requested checks

All findings from both round-1 reviews and GPT round 2 are **closed in the revised design**:

- **F1–F3 are real:** the installed library exposes the decrypted URI after session/password checks; session-bearing TOTP and backup-code verification skip account lockout; the existing storage test does not assert backup-code protection.
- **Unconditional URI refusal is safe:** enrolment consumes `/two-factor/enable`’s URI. No application caller needs `get-totp-uri`; the Better Auth client merely registers its HTTP method and does not invoke it automatically.
- **Classification and settlement are sound:** database-resolved sessions match the plugin’s `isSignIn`; capturing the user before verification handles enrolment session rotation. The dispatcher preserves the request headers object between hooks and clones headers for nested dispatches. Both verification endpoints expose rejection as an `APIError` in `ctx.context.returned`.
- **Counting is coherent:** the row lock is the actual serialization mechanism; pending claims prevent concurrent session-bearing requests from exceeding the budget. Expired-lock reset, success reset by user ID, and a shared `Date.now()` clock address the earlier gaps. Disable/regeneration count through the nested verification once, not through the outer endpoint.
- **Round-2 test corrections are present:** fresh sign-in challenges, unambiguous guard ordering, exactly one RATE-2 claim and second-factor failure, enrolment lockout, and vendor/surface-negative side-effect assertions.
- **Concurrency testing is now appropriately deterministic:** it observes the second transaction waiting on the retained row lock; removing that lock lets the second request reach the barrier. Cleanup and bounded failure waits are specified.
- **No additional configured OTP or trusted-device bypass found:** OTP sending and OTP enablement reject without `sendOTP`; verification needs an OTP record this configuration cannot issue. `trustDevice` remains stripped from verification requests.

The remaining issue is documentation/recovery-contract accuracy, not another demonstrated authentication bypass. Read-only review; no files modified or tests run.

VERDICT: REQUEST_CHANGES
