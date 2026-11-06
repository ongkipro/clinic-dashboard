**Lane C cross-review (delivery, ops, tests, docs): requesting changes.** I found one new HIGH, two new MEDIUM and two LOW findings. One is an extension of C-02 and one an extension of C-03.

## Prior findings

- **C-01, C-02, C-03:** I agree with all three. None of them is wrong.
- **C-02 is wider than one case.** Three more isolation cases are vacuous (N-1). I went through every `tests/isolation/cases/*.cases.ts`.
- **C-03 has more stale places** (N-4).

## New findings

**N-1 — HIGH — the isolation gate cannot fail for cross-tenant writes made by Server Actions**

- **Root cause.** `tests/isolation/isolation.test.ts:170-180`: for `action` and `job` cases the negative run only checks that no tenant-B secret appears in the result. Only `route` cases get a 404 or 2xx check. A cross-tenant write that succeeds and returns a plain code is therefore invisible.
- **Contract this breaks.** `case.ts` says the negative case means "deciding it is not found". DEC-008 asks for "a cross-tenant negative test for every route, job and export".
- **`tests/isolation/cases/staff.cases.ts:141-149`.** `revoke`, `end`, `duty`, `role`, `branch` and `cancel` turn into `"done"` or an error code. None of these is a secret, so if `staff_target` lost its `tenant_id` filter, tenant A could end B's membership and the test would still pass.
  - The victim never signs in, so `sessions` on line 116 (`/staf/[id]`) is always `[]` and cannot leak anything either.
- **`tests/isolation/cases/settings.cases.ts:91-96`.**
  - `change: "done"` (A writing a value into B's branch) is not a secret.
  - `withdraw`: the positive control already cancelled B's draft. A missing tenant filter in `setting_draft_cancel` would still give `ERR_NOT_FOUND` (state ≠ draft). This is the same consumed-state pattern as C-02.
- **`tests/isolation/cases/approvals.cases.ts:91-101`.** The positive control rejects B's approval first. If `approval_decide` (0036:68) lost `tenant_id = a.tenant_id`, A's owner would get `ERR_VERSION_CONFLICT`. That becomes `{refused: …}`, which contains no secret, so the test passes.
- **`staff.cases.ts:163`.** `answer` (A answering B's Owner grant) also maps success to `"done"`.
- **Cases that do observe something:** compliance action (a rejected item can be re-decided, so success would leak `itemId`), org-context action, all route cases, and audit.
- **Smallest fix:**
  1. In the harness, require action and job negatives to come back refused, e.g. a `refused: true` field, or fail on any `"done"`.
  2. Re-seed consumable victim state for each run (a fresh draft or approval in the negative run).
  3. Turn a success into a secret-bearing body everywhere (`{decided: id}`), as the compliance case already does.

**N-2 — MEDIUM — `role_assign`, `role_request_decide` and `role_owner_confirm` check the actor before the staff lock, using `now()`**

- **Where.** `drizzle/0036_owner_decisions.sql`:
  - `role_assign`: actor check at 313-319 uses `now()`; lock taken at 324; target check at 327-331 uses `now()`.
  - `role_request_decide`: check at 369-375, lock at 377.
  - `role_owner_confirm`: `approval_actor()` (0022:45, `now()`) runs before the lock at 424.
- **Why it is a defect.** 0026:34-35 and 47-50 explain why the staff functions take the lock *first* and use `clock_timestamp()`. After waiting on the lock, a membership ended by the lock holder still looks active under `now()`. The role functions repeat exactly that race:
  - Owner O1 ends O2 while O2's `role_assign` or `role_request_decide` waits on the lock.
  - O2 then grants a role or approves a request after their own membership has ended.
  - Or a role is assigned to a target whose membership ended during the wait.
- **No test covers it.** `tests/rls/readers.test.ts:277` is the only concurrency test, and it covers something else. The T-029 follow-up in STATUS mentions only the unlocked subject check, and DECISIONS does not accept the risk.
- **Fix:** in a new migration, take `pg_advisory_xact_lock('staff_access:'…)` before the actor check and use `clock_timestamp()` in both checks, as `staff_admin_lock` does. Add a barrier test modelled on `tests/org/access.test.ts:169`.

**N-3 — MEDIUM — `/staf/[id]` is a by-id route but its case declares `expect: "filtered"`**

- **Where.** `src/app/(app)/staf/[id]/page.tsx:27` calls `notFound()`. The case at `tests/isolation/cases/staff.cases.ts:107-120` declares `expect: "filtered"` and always returns 200.
- **Why it matters.** DEC-008 and `case.ts:7` say by-id routes answer 404 (TEN-1: another tenant's object is not-found, never forbidden). The `loadStaffDetail` not-found branch for another tenant's id is never asserted.
- **Fix:** run `loadStaffDetail`'s logic (`listStaff` + find) and return 404 when it finds nothing; declare `expect: "not-found"`.

**N-4 — LOW — more stale claims in STATUS.md (extends C-03)**

- `STATUS.md:66`: "Built so far" stops at DEC-015.
- `:78`: "No clinic page exists yet". About 20 `src/app/(app)` pages exist.
- `:93` and `:119`: "/audit reads tenant and role from the query string". `src/modules/audit/page-data.ts:13-22` uses the active context.
- `:112`: "`role_assign`/`role_request_decide` do not take the tenant staff-access lock yet". 0036:324 and 0036:377 do take it.
- **Fix:** delete or correct these lines.

**N-5 — LOW — DECISIONS rows changed in place, not marked superseded**

- DEC-031 D1 says it "replaces the DEC-024 environment gate". D7 changes DEC-015's rule that an Owner assignment "applies directly". DEC-031's Supersedes column is still "—", and DEC-024 and DEC-015 still state the old rules.
- That breaks the DECISIONS.md footer: "mark the old decision superseded".
- **Fix:** put "DEC-024 (part), DEC-015 (part)" in DEC-031's Supersedes column and add a note to both old rows.

## Checked and found sound

- **Dockerfile:**
  - Multi-stage, Node pinned (`node:26.13.0-bookworm-slim`; the tag-not-digest pin is accepted in DEC-005), runs as `USER node`.
  - Explicit allow-list `.dockerignore` keeps `.env*` and `*.pem` out.
  - The migration runner and bootstrap are root-owned; all their imports (`drizzle-orm`, `pg`, `better-auth/crypto`, `auth/policy.ts` with no imports) are present.
  - `image-migrate.sh` checks: non-root, no `.env`, migration files read-only, applied count equals the file count.
  - There is no HEALTHCHECK, but the health endpoint is still planned (OBS-3 in OBSERVABILITY.md), so this is not a defect yet.
- **CI:**
  - Actions pinned by SHA, `permissions: contents: read`, `persist-credentials: false`, no secrets, no `pull_request_target`.
  - Runs migrations from zero, the full suite with the restore drill, audit, `docs:check` and the promotion check. The traceability checker exits non-zero on findings.
- **Backups (pgBackRest):**
  - Config built from env with newline injection refused and the stanza regex-checked.
  - `aes-256-cbc` encryption; the cipher passphrase and S3 keys are never written to the config file.
  - The S3 region and endpoint are required config with no hard-coded region (ARCH-9). Nothing in `src/` hard-codes a host or region.
  - The drill proves base backup plus WAL replay (35 tenants after restore) using a random passphrase and throwaway resources.
- **Migration runner:** advisory lock, drift, missing-file and older-unapplied checks, MIG-1 timeouts; all tested.
- **Done-when sample (code and test both exist):**
  - T-002: contract checker.
  - T-003: BYPASSRLS, `scope_map`, cross-tenant not-found.
  - T-004: lint plus coverage self-test.
  - T-005: drill, keys, HTTP host negatives.
  - T-006: lockout, 120 s idle lock.
  - T-008: tamper and re-chain tests.
  - T-009: concurrent idempotency.
  - T-010: rollback and single processing.
  - T-011: `ERR_APPROVER_IS_REQUESTER`, write-off without a reason.
  - T-016: who and when on acknowledgement.
  - T-017: SET-44.
  - T-029: PR-63.
  - T-031: revoked session refused on its next request (access.test.ts:78).
- **TEN-17:** `clinic_vendor` and `clinic_operator` negatives are in `tests/vendor/support.test.ts:180,554,669`.
- **Other rules:**
  - The outbox payload validator is tested.
  - Worker and action logs carry ids or codes only.
  - Fixtures are synthetic (`klinik-sintetis.test`; NIK, NPWP and phone marked synthetic).
  - No `.only` anywhere. The `.skip` uses are only the opt-in browser and drill gates.

## Findings table

| ID | Severity | Location | Issue |
|---|---|---|---|
| N-1 | HIGH | `tests/isolation/isolation.test.ts:170-180`; `staff.cases.ts:116,141-149,163`; `settings.cases.ts:91-96`; `approvals.cases.ts:91-101` | Action negatives check only for secrets, and some victim state is consumed by the positive control, so cross-tenant writes pass the gate |
| N-2 | MEDIUM | `drizzle/0036_owner_decisions.sql:313-331, 369-377, 422-424` | Actor and target checked before the staff lock with `now()`; an ended member can assign or approve roles; no test |
| N-3 | MEDIUM | `tests/isolation/cases/staff.cases.ts:107-120` | By-id `/staf/[id]` declared `filtered`; the TEN-1 404 is never asserted |
| N-4 | LOW | `STATUS.md:66,78,93,112,119` | Stale claims the code contradicts (extends C-03) |
| N-5 | LOW | `DECISIONS.md` DEC-015, DEC-024, DEC-031 | Superseded parts not marked |

VERDICT: REQUEST_CHANGES
