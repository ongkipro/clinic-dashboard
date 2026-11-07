# M0 exit evidence (T-032)

Task T-032 (PR-1, R4). Run 2 on `b20f991` (main after HYG-014). Ledger run `RUN-20261107T184822Z-0d7785ff`; run 1 (`RUN-20261107T163334Z-08c7f8ed`) ended BLOCKED by its R4 review (PR-59's go-live did not re-check the processor agreement), fixed by HYG-014 (DEC-045).

Exit check (PLAN.md §1, M0 row): `pnpm test:rls` and `pnpm test:isolation` pass (every route/job has a cross-tenant negative test); the module-level parts of PR-1 (fixture rows), PR-38, PR-53, PR-56 manual suspension, PR-57–PR-60, PR-63 (cannot grant Owner), PR-91 and PR-97 pass. Done when (TASKS.md T-032): `pnpm test:rls && pnpm test:isolation && pnpm test -- m0` pass in CI; independent reviewer PASS recorded in `.delivery/`.

## Local run (`/data/tmp/clinic-dashboard/t032/run-1794077433/`, under the host rule)

| Command | Result |
|---|---|
| `pnpm test:rls` | 178 passed |
| `pnpm test:isolation` | 41 passed, 1 skipped |
| `pnpm test -- m0` | 936 passed, 14 skipped, 0 failed |

`pnpm test -- m0` is not a filter: vitest receives `m0` after `--` and runs every file (`vitest list` gives the same 62 files with or without it, at `b20f991`). It runs the whole suite; the M0 scenarios are tied to tests by the map below, not by a file name.

Per suite (passed / failed / skipped):

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| `tests/approvals` | 26 | 0 | 0 |
| `tests/audit` | 23 | 0 | 0 |
| `tests/auth` | 68 | 0 | 0 |
| `tests/compliance` | 16 | 0 | 0 |
| `tests/context` | 14 | 0 | 0 |
| `tests/db` | 36 | 0 | 0 |
| `tests/events` | 17 | 0 | 0 |
| `tests/idempotency` | 17 | 0 | 0 |
| `tests/isolation` | 41 | 0 | 1 |
| `tests/notifications` | 13 | 0 | 0 |
| `tests/org` | 64 | 0 | 0 |
| `tests/platform` | 44 | 0 | 1 |
| `tests/rls` | 178 | 0 | 0 |
| `tests/settings` | 29 | 0 | 0 |
| `tests/ui` | 157 | 0 | 12 |
| `tests/vendor` | 193 | 0 | 0 |

Skipped (14): the browser specs run on request with `RUN_UI=1` (each task recorded its browser evidence), the isolation placeholder that only runs while no case exists, and the pgBackRest restore drill (`RUN_BACKUP_DRILL=1`, run in CI, see below):

- `tests/isolation/isolation.test.ts` — cross-tenant negative cases > no cases yet: foundation has no tenant surface
- `tests/platform/backup.test.ts` — pgBackRest restore drill > restores a seeded database to a scratch instance with matching row counts
- `tests/ui/akses-vendor.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/audit.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/context.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/gallery.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/kepatuhan.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/owner-grant.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/pengaturan.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/persetujuan.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/staf.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/tenant-provisioning.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/vendor-team.spec.ts` — browser evidence (RUN_UI=1)
- `tests/ui/vendor.spec.ts` — browser evidence (RUN_UI=1)

## Scenario map (`scenarios.json`, checked by `check-scenarios.py <junit.xml>`)

Each scenario maps to the exact test cases (file and full name) that assert it. The check needs the JUnit report: every mapped case must be present once and passed (a skipped case fails it), the report must have no failure, and every scenario title must be a PRD §8 scenario. Run 2: 17 scenarios, 23 mapped cases, all passed.

| Scenario (PRD §8) | Test file | What the cases assert | Not proven in M0 (where it completes) |
|---|---|---|---|
| PR-1 tenant isolation | `tests/rls/rls.test.ts` (3 cases) | a staff member of tenant A requesting tenant B's row by id gets not-found (fixture rows; no patients exist in M0) | the audit event for the denied attempt, and the patient row itself: completed with patients in M1 (PLAN.md §1 M0 row: 'PR-1 (with fixture rows; full with patients in M1)') |
| PR-1 tenant isolation | `tests/isolation/isolation.test.ts` (1 case) | every route, job and export registered in src has a cross-tenant negative case (the cases run in the same file; their results are in the report) | — |
| PR-38 bounded settings | `tests/settings/settings.test.ts` (1 case) | a setting outside the decided list does not exist and fixed rules cannot be changed | — |
| PR-38 setting out of bounds | `tests/settings/settings.test.ts` (1 case) | 1500 days rejected naming the 30-1095 bound; the old value stays active | — |
| PR-38 restore default | `tests/settings/settings.test.ts` (1 case) | Admin Pusat restores H-1 10:00 with a new audited version | — |
| PR-53 support session | `tests/vendor/support.test.ts` (1 case) | opened with a reason, ends at its time limit, tenant A's owner sees it in the audit log | — |
| PR-56 manual suspension keeps records | `tests/vendor/lifecycle.test.ts` (1 case) | suspension with a reason; booking capability refused; owner notified; clinical read/export capabilities continue (module level: bookings and exports are later features that call the capability check) | care messages for suspended tenants: M6 aftercare (TASKS.md) |
| PR-57 maker-checker for vendor actions | `tests/vendor/staff.test.ts` (1 case) | the same person cannot approve their server-fee proposal; refused and audited | — |
| PR-58 onboarding grant boundary | `tests/vendor/onboarding.test.ts` (1 case) | with an active grant, a medical record (any clinical kind) is denied and audited | — |
| PR-58 onboarding self-invite refused | `tests/vendor/onboarding.test.ts` (1 case) | self-invite as Owner refused and audited | — |
| PR-59 go-live gate | `tests/vendor/checklist.test.ts` (4 cases) | a tenant whose processor agreement is not signed/approved (revoked, unapproved new version, or none) is refused go-live by the platform owner, the refusal names the blocker, the tenant stays in onboarding (HYG-014, DEC-045); open checklist items are named likewise | 'no server-fee invoice is created': invoices do not exist until PR-61 (M7); the refused go-live sets no go-live date (tenant_go_live_at), which is the billing start |
| PR-60 owner sees vendor access | `tests/vendor/support-scope.test.ts` (1 case) | operator, reason, scope and end time shown to the owner, who can end it (page: tests/ui/akses-vendor.spec.ts, T-028) | — |
| PR-60 clinical scope without approval | `tests/vendor/support-scope.test.ts` (1 case) | without approval the session does not activate and the request is audited | — |
| PR-60 expired grant | `tests/vendor/onboarding.test.ts` (1 case) | a grant created 31 days ago, tenant not live: the catalog is denied | — |
| PR-63 Admin Pusat cannot grant Owner | `tests/rls/readers.test.ts` (1 case) | Admin Pusat's Owner assignment waits for the owner's approval and is not active | — |
| PR-91 revoke session | `tests/org/access.test.ts` (1 case) | the revoked tablet session has no access on its next request (within 60 s) | — |
| PR-97 gated feature | `tests/compliance/compliance.test.ts` (1 case) | the VAT gate is refused naming the missing tax advice (gate level; VAT itself is T-071) | — |
| PR-97 evidence unlocks | `tests/compliance/compliance.test.ts` (1 case) | finance's approval opens the journal-export gate, audited (gate level; the export itself is M8) | — |

Deferred (plan-backed, not M0 exit criteria): PR-1 tenant isolation → M1: patient rows and the audit event of the denied attempt; PR-84 → M1 walk-in (TASKS.md); PR-56 suspended tenant keeps care messages → M6 aftercare (TASKS.md); PR-63 Admin Pusat boundary → T-078 (M4 cash refund; TASKS.md assigns it there).

## CI (`check-ci.sh <sha> <run> <receipt>`)

T-032 changes no code, test, migration or workflow; the check refuses a tree that differs from the commit outside the T-032 allowed paths. For `b20f991`, run 42402769725: workflow `ci` (`.github/workflows/ci.yml`, id-checked), push to `main`, conclusion `success`; `verify` › "Run pnpm test" succeeded (937 passed | 13 skipped (950)), the restore drill passed, and the RLS, readers, isolation and checklist files ran. Receipt: `ci-receipt.json`. The T-032 commit's own CI run is watched after the push and recorded in STATUS.

## Review

Independent R4 review: round 1 (run 1) REQUEST_CHANGES, see above and HYG-014; round 2 on this evidence: see `.delivery/` and STATUS.

## Process lapse (run 2, kept on record)

After round 2's APPROVE, a one-line README fix (61 → 62 files) made every check stale. Only docs, scenario-map and ci were re-recorded; `finish` then refused PASS (`test-all-m0` stale), but the commit and push in the same command chain still ran, so `ea9610f` reached `main` before the ledger closed. Run 2 was closed BLOCKED (`9177d4d`); the closure run `RUN-20261107T185906Z-7d05d73e` re-ran every required check against the final surface. Lessons (for BUILD-LOG with the next task that may edit it): a doc fix after the final checks makes every check stale, the suites included; never chain `finish`, commit and push: run `finish` alone and read its result first.
