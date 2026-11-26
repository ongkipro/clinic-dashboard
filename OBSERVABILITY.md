# Observability Contract — clinic-dashboard

Updated: 2026-11-27
Status: REQUIRED

Probe format:

```text
Probe: <name>|<url>|<expected-status>|<contains-or-TBD>|<max-latency-ms>
```

The expected status may be an exact code (`200`) or an inclusive range
(`200-299`). Every configured probe is mandatory. Use stable, non-secret public
endpoints only; private-network probes require an explicit local-test override.

Probe: app|TBD|200-399|TBD|2000
Probe: health|TBD|200-299|TBD|1000

Production probes stay TBD until a production host exists (`RELEASE.md`). Implemented endpoints (`docs/spec/16`, `OBS-3`):
- `GET /api/health` (`APP_HOST` only): HTTP 200 `{ "status": "ok" }` liveness probe (`no-store`, zero DB/tenant access).
- `GET /api/health/db` (`APP_HOST` only): HTTP 200 `{ "status": "ok", "check": "db" }` / 503 readiness probe via bounded `SELECT 1` on `clinic_app` (`TEN-2`).
- Worker container heartbeat (`DEL-4`, `src/workers/runner.ts`): atomic JSON liveness heartbeat at `WORKER_HEARTBEAT_FILE` (`/tmp/clinic-worker-heartbeat.json`) verified by Docker healthcheck (live positive PID, `ok === true`, publication age < 180 s). This verifies process liveness only and does **not** replace outbox age monitoring.
- Remaining planned endpoints (`docs/spec/16`, `OBS-3`): `/api/health/worker` (combined worker heartbeat **and** outbox backlog age), backup age, and SATUSEHAT/WhatsApp provider backlog metrics (outbox age and provider backlogs are currently surfaced per tenant in Konsol Vendor › Kesehatan Platform, `UX-45`, via `vendor_console_health`).

## Recommended production probes

Add probes for database connectivity, background jobs, queue/worker health, or a
critical-error sentinel when the application exposes stable HTTP endpoints for
them. Keep vendor-specific credentials and query tokens out of this file.

Examples:

```text
Probe: database|https://example.com/health/db|200-299|ok|750
Probe: background-jobs|https://example.com/health/workers|200-299|ok|1000
Probe: critical-errors|https://example.com/health/errors|200-299|critical_errors=0|1000
```

## Runbook

No runbook entry exists yet. Add one for each probe or alert whose failure needs
more than `RELEASE.md` Rollback-Command; when an entry becomes a fixed command
sequence, move it into a script and name the script.

```text
### <probe-name>
- Symptom and impact:
- Check: <command or URL>
- Mitigation:
- Rollback: RELEASE.md Rollback-Command; migration phase (expand/migrate/contract) and whether it reverses
- Escalation: <owner or provider status page>
```

After user-visible downtime, data loss, or a manual rollback, add a short
blameless note to `BUILD-LOG.md`: impact, cause, fix, and the check that now catches it.
