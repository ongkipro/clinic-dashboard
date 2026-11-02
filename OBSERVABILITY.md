# Observability Contract — clinic-dashboard

Updated: 2026-11-02
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

Probes stay TBD until a deployed host exists. Planned endpoints (`docs/spec/16`): `/api/health` (app), `/api/health/db` (database), `/api/health/worker` (worker heartbeat and outbox age), backup age, and SATUSEHAT and WhatsApp backlog per provider (UX-45).

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
