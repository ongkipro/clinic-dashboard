# Observability and Rate Limiting — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Engineering owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |

| ID | Requirement | Owner | Status |
|---|---|---|---|
| OBS-1 | Structured logs with correlation, tenant and branch IDs; no names, phone numbers, NIK, clinical text or message bodies; scrubbing by allowlist; ops logs kept 30 days in the production environment | Engineering owner | Proposal |
| OBS-2 | Metrics: latency per route group, outbox backlog age and failures per provider, worker heartbeat, DB connections, webhook lag | Engineering owner | Proposal |
| OBS-3 | Health endpoint reports DB, worker heartbeat, outbox backlog; used by Coolify and uptime probe | Engineering owner | Proposal |
| OBS-4 | Alerts: app down, worker heartbeat stale > 5 min, outbox backlog > 15 min, SATUSEHAT failures > 5%/h, backup missing > 26 h, KEK access outside deploy | Engineering owner | Proposal |
| OBS-5 | Per-tenant WhatsApp usage and cost estimate from message categories | Engineering owner | Proposal |
| OBS-6 | Error tracking self-hosted in the production environment or logs only; no SaaS telemetry SDKs (H-08) | Engineering owner | Proposal |
| RATE-1 | Booking OTP ≤ 3 per 10 min per phone; ≤ 10 per min per IP | Engineering owner | Proposal |
| RATE-2 | Staff login ≤ 5 failures per 15 min per account plus progressive delay | Engineering owner | Proposal |
| RATE-3 | Public booking ≤ 10 requests per min per IP | Engineering owner | Proposal |
| RATE-4 | Private media ≤ 60 requests per min per session | Engineering owner | Proposal |
| RATE-5 | Exports ≤ 5 per 5 min per user; large exports queued | Engineering owner | Proposal |
| RATE-6 | Tenant outbound WhatsApp daily budget fixed at 80% of the portfolio messaging limit read from Meta (B-16, fixed default) | Engineering owner | Proposal |
