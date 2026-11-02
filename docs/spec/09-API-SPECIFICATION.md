# API Specification — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Engineering owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Machine contract | `openapi.yaml` to be generated with skill `openapi-spec` when TASKS start; not written yet |

## Requirements

| ID | Requirement | Owner | Contract | Status |
|---|---|---|---|---|
| API-1 | Staff API under `/api/v1/staff/**` on the app host; public booking API under `/api/v1/public/**` webhooks under `/api/v1/webhooks/payment` on the booking host and `/api/v1/webhooks/meta` on the DNS-only app host; versioned path prefix; `openapi.yaml` skeleton for M0–M1 is the first API task | Engineering owner | openapi.yaml (pending) | Proposal |
| API-2 | Every mutation requires an `Idempotency-Key` header; replay returns the original result | Engineering owner | openapi.yaml (pending) | Proposal |
| API-3 | Errors return stable machine codes with Indonesian messages from the error catalog (`18` TD-51) | Engineering owner | openapi.yaml (pending) | Proposal |
| API-4 | Webhooks verify signatures (Meta app secret HMAC, gateway signatures) and are idempotent by provider event ID | Engineering owner | openapi.yaml (pending) | Proposal |
| API-5 | Public endpoints: branch list, services by branch, slots, booking with OTP, booking status; rate-limited; no clinical reads | Engineering owner | openapi.yaml (pending) | Proposal |
| API-6 | No third-party public API in Release 1; partner API is a later decision | Product owner (Paduka Ongki) | — | Decision |

## Route Groups (from Kliniknuma PLAN "Integrations & Contracts", modified)

| Group | Examples |
|---|---|
| Tenant & access | `/staff/tenant`, `/staff/branches`, `/staff/staff`, `/staff/settings`, `/staff/approvals` |
| Patients | `/staff/patients`, `/staff/patients/{id}/consents`, `/staff/patients/{id}/workspace` |
| Scheduling | `/staff/schedules`, `/staff/appointments`, `/staff/visits`, `/staff/board` |
| Clinical | `/staff/visits/{id}/intake`, `/exam`, `/plan`, `/consent`, `/amendments`, `/photos` |
| Treatment | `/staff/visits/{id}/executions/{eid}/start`, `/finish`, `/interrupt`, `/additions` |
| Inventory | `/staff/stock/requests`, `/issues`, `/returns`, `/counts`, `/transfers`, `/purchase-orders`, `/prescriptions` |
| Cashier | `/staff/invoices`, `/payments`, `/packages`, `/balance`, `/booking-deposits`, `/receivables`, `/refunds`, `/shifts` |
| Commission | `/staff/commission/rules`, `/contributions`, `/batches`, `/targets`, `/me` |
| Messaging & CRM | `/staff/waba/onboarding`, `/numbers`, `/templates`, `/conversations`, `/leads`, `/followups`, `/campaigns` |
| Accounting | `/staff/ledger/accounts`, `/journals`, `/periods`, `/reports`, `/exports` |
| Integration | `/staff/satusehat/outbox`, `/staff/satusehat/credentials` |
| Dashboards | `/staff/dashboard/{owner,branch,frontdesk,bc,cs,finance}` |
