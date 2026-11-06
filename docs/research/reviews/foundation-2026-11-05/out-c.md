## Review scope and limitations

Read-only static review; no commands or tests were run, and no `.env` files or secrets were read. I excluded T-027, T-028, T-032 and the specified HYG-004/HYG-005 in-flight changes.

**Found: two MEDIUM test-integrity defects and one LOW documentation defect. No HIGH defect identified in this lane.**

## Findings

### C-01 — MEDIUM: Browser validation can exit successfully after a failed flow

**Evidence:** `tests/ui/shell.spec.ts:367–373`; invoked by `package.json:24`.

The browser runner catches failures, assigns `report.error`, writes the report, and returns normally. It neither rethrows nor sets a failing exit status. Consequently, a failed sign-in, missing element, failed navigation or timeout inside the browser flow can still make **`pnpm test:ui` exit 0**.

The same failure-swallowing pattern appears in:

- `tests/ui/audit.spec.ts:127–133`
- `tests/ui/pengaturan.spec.ts:226–232`
- `tests/ui/vendor.spec.ts:226–230`

**Why this is a defect:** T-013’s Done-when procedure explicitly requires `pnpm test:ui` to check the browser layouts and 200% text (`TASKS.md:175–183`). AGENTS.md also requires browser evidence for UI work. Recording an error in JSON is useful diagnostic evidence, but it must not turn a failed validation command into a successful one.

This finding concerns **failure propagation**, not the accepted choice to run browser evidence manually rather than in every CI run.

**Smallest fix:** Preserve the report, but rethrow the captured error after cleanup/report writing, or set `process.exitCode = 1`. Apply the same behavior to the other browser runners using this pattern.

### C-02 — MEDIUM: The outbox job’s cross-tenant negative run processes no event

**Evidence:** `tests/isolation/cases/events.cases.ts:10–44`; execution order in `tests/isolation/isolation.test.ts:204–225`.

The case creates its sole victim event only while the module-global `marker` is empty:

```ts
if (!marker) {
  marker = crypto.randomUUID();
  // emit victim event
}
```

The isolation harness first runs the positive control as tenant B. That run consumes B’s event and completes its receipt. The subsequent negative run as tenant A creates no replacement event, so `runOutboxBatch` has no pending event for `iso.outbox`. It returns an empty `seen` array without exercising a cross-tenant handler invocation.

Thus, the named job negative passes **vacuously**. A regression affecting tenant binding in the batch path can escape this case because the negative phase performs no work.

**Why this is a defect:** AGENTS.md:25 requires “a cross-tenant negative test for every new endpoint, job and export”; DEL-2 (`docs/spec/15-DEVOPS-CICD-MIGRATIONS.md:17`) requires the corresponding isolation gate.

There is useful, non-vacuous lower-level coverage in `tests/events/events.test.ts:203–220`: it checks the tenant bound by `consume()`. That does not repair the empty negative phase of the separate `workers/outbox` case.

**Smallest fix:** Seed a fresh victim event for each invocation, including the negative phase. Assert that the handler actually ran, and inside it assert that tenant-scoped reads contain only the event’s tenant and exclude the other tenant. Avoid relying solely on a conditional that suppresses observations.

### C-03 — LOW: Current-state summaries contradict recorded implementation and delivery evidence

**Evidence:**

- `STATUS.md:26` says push approval has not been given and “no CI run exists.”
- `STATUS.md:72` records multiple pushed waves and successful GitHub CI runs.
- `ARCHITECTURE.md:3` says M0 is 27/32 after T-026, although the completed task list represents 29 tasks.
- `ARCHITECTURE.md:94` says there are 45 migrations, ending at 0044, despite the implemented support-session migrations through 0047.
- `ARCHITECTURE.md:105` presents 718 tests as the current verification count; the later T-026 evidence in `STATUS.md` records 759 passing.

**Why this is a defect:** AGENTS.md:17 makes STATUS.md the source of current state, and AGENTS.md:65 requires ARCHITECTURE.md to describe what the code now does. These are current-state assertions, not clearly labelled historical snapshots.

**Smallest fix:** Update the opening/current architecture summaries to the latest completed task and migration state. Label historical test counts by verification run, or link to STATUS.md instead of duplicating them. Preserve historical evidence entries.

## What I checked and found sound

### Delivery and operations

- **Application image:** `Dockerfile:3–46` uses an exact Node version tag, standalone output, a multi-stage production-dependency installation, and `USER node`. Migration files are copied without runtime-user ownership. The exact-tag rather than digest pin is explicitly accepted by DEC-005.
- **Build-context protection:** `.dockerignore:1–17` is an allow-list with additional exclusions for `.env*`, nested dependencies/build output and PEM files.
- **Image migration check:** `tests/platform/image-migrate.sh:17–38` migrates a fresh throwaway database from the image, compares the migration count, checks non-root execution and refuses writable migration files or `.env` files.
- **Migration safety:** `src/db/migrate.ts:25–81` checks applied-file hashes, missing migration files and older unapplied migrations; serializes runners with a session advisory lock; restores the configured DDL timeouts; and releases the connection in `finally`. Tests include fresh/concurrent migration runs and drift negatives in `tests/db/migrations.test.ts:46–128`.
- **CI:** `.github/workflows/ci.yml` pins actions by SHA, grants only `contents: read`, disables persisted checkout credentials, uses a disposable PostgreSQL service, runs migrations/tests/build/audit/traceability, enables the restore drill and records a build attestation. The distinction between this attestation and a future registry manifest digest is documented in DEC-008 and `scripts/record-digest.mjs:1–8`.
- **Backup configuration:** `ops/pgbackrest/entrypoint-pgbackrest.sh:14–67` requires a cipher passphrase, selects encrypted repositories, keeps credentials out of the generated configuration, and takes S3 endpoint/bucket/region from configuration.
- **Restore realism:** `ops/pgbackrest/restore-drill.sh:87–140` writes additional synthetic rows after the full backup, archives WAL, restores into a scratch instance with archiving disabled, waits for recovery to finish and compares counts plus content checksums. The explicit 35-tenant assertion prevents a base-backup-only restore from passing.
- **Deployment claims:** RELEASE.md remains DRAFT and says nothing is deployed; OBSERVABILITY.md labels its probes as TBD. I did not treat later deployment scheduling, production health probes or clean-room operational drills as completed M0 capabilities.

### Requirement sampling — ten distinct PRs

These samples have implementation entry points and meaningful assertions, not merely named test files:

| Requirement / task | Implementation evidence | Test evidence checked |
|---|---|---|
| PR-1 / T-002–005 | `src/db/migrate.ts:25`; `src/db/rls/context.ts:39` | `tests/db/migrations.test.ts:46–128`; isolation gate self-tests in `tests/isolation/isolation.test.ts:52–130` |
| PR-3 / T-006–007 | `src/modules/org/identity.ts:27,132`; auth session implementation | `tests/auth/auth.test.ts:100–210`: TOTP, refused account endpoints, cross-IP lockout; `tests/org/identity.test.ts:71–149`: identity constraints and cross-tenant branch refusal |
| PR-51 / T-008 | `src/modules/audit/audit.ts:26,124,157` | `tests/audit/audit.test.ts:126–188`: reason restrictions, attribution, forged-context refusal |
| PR-37 / T-011 | `src/modules/approvals/approvals.ts:34–57` | `tests/approvals/approvals.test.ts:72–125`: requester/approver separation, owner whitelist, mandatory reason |
| PR-54 / T-016 | `src/modules/notifications/notifications.ts:29–80` | `tests/notifications/notifications.test.ts:61–137`: acknowledgement identity/time, immutable first acknowledgement, branch/recipient negatives |
| PR-38 / T-017 | `src/modules/settings/settings.ts:145–173` | `tests/settings/settings.test.ts:72–121`: bounds, retained old value, unknown-setting and direct-SQL refusal |
| PR-97 / T-019 | `src/modules/compliance/compliance.ts:110–158` | `tests/compliance/compliance.test.ts:70–119`: fail-closed gates, approval/config binding, new-file invalidation |
| PR-63 / T-029 | `src/modules/org/roles/roles.ts:13–49` | `tests/rls/readers.test.ts:143–174`: Admin Pusat cannot activate Owner; approval and subject confirmation required |
| PR-56 / T-022 | `src/modules/vendor/lifecycle/lifecycle.ts:22,56` | `tests/vendor/lifecycle.test.ts:113–149`: suspension refusals, retained capabilities, owner notification and ID/code-only event |
| PR-60 / T-026 | `src/modules/vendor/support/scope.ts:15–41` | `tests/vendor/support-scope.test.ts:119–182`: pending clinical scope refuses reads, approval activates it, Owner ending access blocks reads, expired grant denied |

The test-tree scan found no focused `.only` tests or TODO test cases. Conditional backup skipping is overridden by CI; browser-only skips are explicitly labelled. In the inspected fixtures, identities use synthetic names, `.test` email domains and documentation IP ranges. I found no live provider calls or real credentials in those inspected fixtures. This was not a substitute for a repository-history secret scan.

## Findings table

| ID | Severity | Location | Defect |
|---|---|---|---|
| C-01 | MEDIUM | `tests/ui/shell.spec.ts:367–373` and matching browser runners | Browser failures are swallowed, allowing successful command exit |
| C-02 | MEDIUM | `tests/isolation/cases/events.cases.ts:10–44` | Outbox cross-tenant negative phase has no pending event and passes vacuously |
| C-03 | LOW | `STATUS.md:26`; `ARCHITECTURE.md:3,94,105` | Current-state summaries contradict later implementation/delivery evidence |

VERDICT: REQUEST_CHANGES
