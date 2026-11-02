# Release Manifest — clinic-dashboard

Release-ID: UNSET
Base: UNSET
Environment: production
Declared-Risk: R0
Rollback-Ref: UNSET
Rollback-Command: UNSET
Backup-Proof: NOT_REQUIRED
Status: DRAFT

No release is approved. Nothing is deployed. The first deployment requires the owner's explicit approval, `production-gate`, and for real patient data the ARCH-10 residency gate. When this file is first filled, the expected Declared-Risk is R4 (tenant isolation, money, clinical data).

## Contract

This file defines the current release boundary. It is repository truth for release-specific metadata and MUST describe only the release currently being prepared.

- `Base` is the last deployed/accepted commit and must be an ancestor of `HEAD`.
- `Declared-Risk` is the human/agent-declared release risk (`R0`–`R4`).
- `Rollback-Ref` is the commit to restore if deployment fails; normally it equals `Base`.
- `Rollback-Command` is an explicit supported repository/runbook command, not an assertion such as `true`; runbook entries live in `OBSERVABILITY.md`. Do not put secrets here.
- `Backup-Proof` is `NOT_REQUIRED` unless migration risk requires a structured `backup://`, `snapshot://`, or artifact reference.
- Set `Status: READY` only after the release scope is frozen for production gating.
