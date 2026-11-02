# Security Architecture — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Security owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |

## Threats and Controls

| ID | Threat / control | Owner | Verification | Status |
|---|---|---|---|---|
| SEC-1 | Cross-tenant access: server-resolved tenant, RLS, composite unique keys, tenant in every key, platform routing (TEN-1–TEN-11) | Security owner | Negative tests per endpoint, job and export | Proposal |
| SEC-2 | Health data exposure: role/assignment projection; private media with ≤ 10 min tokens; no clinical data or message bodies in logs, events, analytics or WhatsApp templates | Security owner | Projection tests; log scan | Proposal |
| SEC-3 | Vendor regulatory duties: PSE registration, SATUSEHAT security survey, documented controls kept current; storage location declared truthfully and changes reported (Permenkes 24/2022 Pasal 12) | Security owner | Registration records | Proposal |
| SEC-4 | Edge: booking host proxied (WAF, Turnstile, DDoS, no body logging, no Logpush of bodies, cache bypass, `no-store`); app host DNS-only with origin firewall, rate limits and WAF; HSTS and security headers on both | Security owner | Header and firewall checks | Proposal |
| SEC-5 | Audit: append-only, content-free audit (attribution per DATA-60, object kind and id, no clinical values) of clinical reads, media views and downloads, exports, denied access, signing, approvals, money corrections, settings, operator sessions; audit rows are hash-chained per tenant and copied daily to write-once storage outside the application and database administrators' ordinary write path; a broken chain alerts; pgaudit for break-glass statements logs statement class and object only, never parameter values; audit-pipeline failure blocks clinical reads rather than silently skipping | Security owner | Audit tests | Proposal |
| SEC-6 | Secrets and keys: KEK outside Coolify (ARCH-7); tenant data keys wrapped; app secrets in Coolify behind allowlist + MFA; none in repository or memory files | Security owner | Secret scan; key drill | Proposal |
| SEC-7 | Account takeover: password + TOTP for privileged roles, throttling, session limits, idle lock, invitation-only staff | Security owner | Auth tests | Proposal |
| SEC-8 | Webhook forgery and replay: signature verification (Meta app secret, gateway signatures), timestamp window, idempotency on provider event id | Security owner | Webhook tests | Proposal |
| SEC-9 | Fraud: maker-checker approvals, versioned corrections, suspicious-activity report (voids, refunds, overrides, stock variance, write-offs, releases before payment) | Security owner | Report test | Proposal |
| SEC-10 | Supply chain: pinned dependencies, lockfile, audit in CI; CI fails on known SaaS telemetry/replay SDKs | Engineering owner | CI audit | Proposal |
| SEC-11 | Backups encrypted; KEK escrow; quarterly restore drills | Engineering owner | Drill report | Proposal |
| SEC-12 | Public booking abuse: OTP rate limits, Turnstile, slot-hold TTL | Security owner | Abuse tests | Proposal |
| SEC-13 | Error tracking and logs stay in the production environment, scrubbed by allowlist (H-08) | Security owner | Log scan | Proposal |
| SEC-14 | Inbound WhatsApp messages and media are possibly specific personal data: stored only in the production database and bucket, readable only by inbox roles, media downloaded from Meta into the private bucket (W-10) | Security owner | Access tests | Proposal |
| SEC-15 | Gateways receive generic item descriptions only; the clinic is merchant of record (H-09) | Security owner | Payload test | Proposal |
| SEC-16 | Vendor access: platform pages show counts and status codes only; tenant data only in owner-visible support sessions; clinical scope needs owner approval; vendor console behind IP allowlist + TOTP; every vendor action and every record read in a session audited in the vendor log and the clinic log; the per-tenant Audit tab in the vendor console shows vendor actions on that tenant only (PR-57, PR-60, TEN-14) | Security owner | Access tests | Proposal |
| SEC-17 | Payment webhooks for every adapter (mock included): signature verification, idempotency by provider event, amount match against the charge, tenant via `payment_routes`; mock charges can never post real money (PR-68, BILL-29) | Security owner | Adapter contract suite | Proposal |
| SEC-18 | Public site: generated from reviewed records only, no tenant HTML, CSS or scripts (UI-8), no third-party scripts before consent and none on booking routes, unpublished or suspended tenants reveal nothing (PR-64–PR-67) | Security owner | Header and content tests | Proposal |
| SEC-19 | Manual discounts above role limits need approval and appear in the suspicious-activity report with requester, approver and amount (PR-72, SEC-9) | Security owner | Report test | Proposal |
| SEC-20 | Production infrastructure access (database console, SSH, Coolify, backups, restore drills, error tracking) is limited to named vendor engineers with per-person accounts, uses an audited break-glass database role with pgaudit statement logging, and is reported to the affected tenant's owner in Akses Vendor as "Akses infrastruktur" with reason and time; the processor agreement discloses this path (PRIV-8, PRIV-16) | Security owner | Access review; pgaudit log check | Proposal |
| SEC-21 | The vendor console runs on its own hostname (same image, separate vhost) with separate `__Host-` session cookies (SameSite=Strict), a strict CSP, and never accepts a clinic session; tenant-controlled strings are escaped in vendor tables | Security owner | Header and session tests | Proposal |
