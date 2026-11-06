## Lane B1b review

**No confirmed HIGH, MEDIUM or LOW defects found in the reviewed scope.**

This was a read-only static review; no commands, builds or tests were run. The excluded tasks and specified in-flight changes were not assessed.

### Checked and found sound

- **Host separation:** `src/lib/hosts.ts` resolves the configured `Host` against three distinct hosts, rejects unknown hosts and noncanonical paths, restricts booking routes to an allowlist, and prevents vendor paths from being served on the app or booking hosts. Case and percent-decoding checks address alternate spellings of protected paths.
- **Production dev-route exclusion:** `/dev` is refused centrally in production. Both development page entry points also call `notFound()` in production: `src/app/(dev)/dev/galeri/page.tsx:9` and `src/app/(dev)/dev/templat/page.tsx:64`.
- **Vendor Server Action isolation:** `src/proxy.ts:67–70` refuses `Next-Action` requests, state-changing requests outside the permitted APIs, and form-encoded auth requests. Console mutations use JSON route handlers rather than Server Actions.
- **Console CSRF protection:** `src/app/vendor/api/console/[action]/route.ts:19` requires an exact match with the configured vendor origin before processing any action, including invitation acceptance. The proxy additionally restricts console requests to JSON POSTs.
- **Vendor entry gates:** Protected tenant, team and security pages invoke `consoleGate()`. That gate checks the vendor auth session and then calls the database console guard with the session token—not a caller-supplied account ID (`src/app/vendor/_lib/server.ts:91–102`).
- **Cookie and session separation tests:** `tests/vendor/host.test.ts` explicitly checks Secure, HttpOnly, SameSite=Strict, host-only `__Host-vendor.*` cookies; rejects clinic/vendor session substitution in both directions, including renamed cookies; and checks surface-specific logout and session termination.
- **IP allowlist boundary:** The scoped server code uses one configured trusted header, defaulting to `x-real-ip`, rather than selecting a browser-supplied element from an X-Forwarded-For chain. Tests cover missing, malformed and outside-allowlist addresses. Proxy overwriting and origin-only reachability are explicitly accepted deployment prerequisites in **DEC-029**; I did not treat that documented trust boundary as a defect.
- **Vendor response hardening:** Allowed vendor requests receive a fresh CSP nonce forwarded to rendering, restrictive framing/plugin/form directives, no-store and security headers. The vendor layout forces request-time rendering. Tenant-controlled strings are rendered as React text, with a hostile-name regression test.
- **Keys:** `src/lib/keys/envelope.ts` binds encrypted values to tenant, purpose and key version using authenticated encryption; tenant-key ownership is checked before field operations. `src/lib/keys/kek-file.ts` rejects symlinks, nonregular files, group/world permissions and incorrect ownership.
- **Error presentation:** Reviewed client helpers translate failures to bounded UI copy; tenant/team error boundaries do not display exception contents. No explicit internal exception or secret disclosure was found in the scoped code.

### Verification limits

The vendor auth route delegates to the shared auth factory, and console commands delegate authorization and step-up enforcement to modules/database functions outside this lane. Their implementations were not inspected. The scoped tests provide evidence for cookie/session isolation, TOTP and IP refusal behavior, but this review does **not** independently certify those external implementations or deployed reverse-proxy configuration.

Accepted decisions **DEC-028–033 and DEC-036** were checked to avoid reporting documented trust assumptions or approved invitation/security behavior as defects.

## Findings table

| Severity | File:line | Finding | Smallest fix |
|---|---|---|---|
| — | — | No confirmed actionable defects in Lane B1b. | — |

VERDICT: APPROVE
