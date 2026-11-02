# SLA and Disaster Recovery — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Engineering owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |

No external SLA is promised (CTX-12). Internal objectives:

| ID | Objective | Owner | Measurement | Status |
|---|---|---|---|---|
| SLO-1 | Availability ≥ 99.5% during clinic hours 08:00–21:00 local | Engineering owner | Health probe + incident log | Proposal |
| SLO-2 | Outbox delivery (WhatsApp, SATUSEHAT) ≥ 99% within 24 h; backlog age alert at 15 min | Engineering owner | Worker metrics | Proposal |
| DR-1 | RPO ≤ 15 min with pgBackRest WAL archiving; RTO ≤ 2 h; encrypted backups and versioned object replication to a location separate from production | Engineering owner | Restore drill | Proposal |
| DR-2 | Quarterly restore drill into an isolated environment classed as production (same access controls) and destroyed after the drill; recorded timings; pgBackRest key escrowed with the KEK; at least yearly a clean-room drill restores using only escrowed backup keys, KEK versions and wrapped data keys (no live KEK service, Coolify or usual administrators) and proves decryption of database and objects, including a backup older than the last key rotation; custodians named | Engineering owner | Drill report | Proposal |
| DR-3 | Clinical downtime SOP (approved by Numa's clinical lead and pharmacist, drilled before go-live): activation by branch manager; safe-care limits and escalation; uniquely numbered branch-specific paper forms (registration, examination, consent, prescription, dispensing, payment); allergy and medication list printed daily for the day's booked patients; entry after restoration with original author and care time plus actual entry time and audit reason, by a named transcriber and reviewed by the authoring clinician within 24 h of **service restoration**; reconciliation of paper care against restored records, stock and payments before the outage is closed; duplicate check on patients and payments | Clinical lead | SOP + witnessed drill | Proposal |
| DR-4 | Rebuild runbook that works without Coolify (scripted server rebuild) and a residency migration runbook (ARCH-9) | Engineering owner | Drill | Proposal |
