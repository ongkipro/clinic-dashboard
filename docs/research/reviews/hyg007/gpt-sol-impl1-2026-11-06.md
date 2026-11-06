## Review

No issues found.

### Correct

- **Check ordering and pending attempts:** `src/auth/server.ts:280–335` applies the surface check, vendor allowlist, URI refusal and session gate before counting. A request refused by those gates cannot consume the second-factor budget. For a classified session-bearing verification, the row is locked and the active lock checked **before** incrementing and before the plugin verifies the code (`server.ts:150–175`). A correct fifth attempt can temporarily set the lock, but the plugin skips its sign-in-only lock check for a valid session; successful settlement then clears the pending count and lock (`server.ts:382–384`). This matches the documented conservative concurrency tradeoff.

- **Counting ownership:** Classification uses a database-backed session lookup, not cookie presence (`server.ts:190–195,331–335`). The installed plugin’s `totp/index.mjs:139–170` and `backup-codes/index.mjs:193–234` count only sign-in attempts. Thus ordinary session-bearing calls are counted by this implementation, while sign-in challenges remain plugin-owned. The outer disable/regenerate paths are not code paths; their nested `verifyTOTP` call owns the single second-factor attempt (`server.ts:366–369`). The tests explicitly assert single counting for wrong nested codes and revoked-session cookies.

- **WeakMap settlement:** Classification is retained by user ID, avoiding a session lookup after enrolment has replaced the session (`server.ts:183–186,335,382–384`). Nested session reads do not write this map, and the outer possession endpoint cannot settle it because settlement requires `CODE_PATHS`. Weak keys do not retain completed request headers. The supplied successful enrolment-reset tests provide behavioral evidence for identity-dependent settlement. **Boundary:** the hook dispatcher is outside the permitted source scope, so I cannot independently source-prove header-object identity across every internal API path.

- **Clock, expiry and serialization:** Both implementations use the system clock. The new code rejects a future lock, resets an expired lock’s budget, and counts the new attempt in the same row-locked transaction (`server.ts:161–173`), consistent with the plugin’s `verify-two-factor.mjs:134–149`. The deterministic concurrency test observes the second transaction waiting on a PostgreSQL lock before releasing the first; it does not use elapsed time as evidence of successful serialization.

- **Possession, storage and UI:** URI retrieval is refused before RATE-2 claiming (`server.ts:296–300`). Regeneration requires a six-digit authenticator code, then retains the plugin’s password check. Backup-code encryption is explicitly pinned (`server.ts:275–277`). The new field has an associated label, help-text association, numeric input mode, one-time-code autocomplete and Indonesian copy (`src/app/(auth)/security-panel.tsx:164–183`, added lines in `code.patch`). The client maps the plugin’s actual lockout error code, without exposing raw server messages.

### Verification assessment

The packet covers F1–F3, shared budgets, expiry, enrolment session replacement, nested verification, vendor refusals and concurrent counting. All **11 planned mutations** appear in `mutations.sh`, each scoped to a named test or test group.

I ran nothing, as requested. Gate outcomes are accepted as supplied. `mutation-results.txt` contains abbreviated summaries rather than assertion traces, so it does not independently establish each failure’s precise cause; the mutation edits and targeted tests are consistent with the claimed controls.

**Merge verdict: OK within the bounded packet.**

VERDICT: APPROVE