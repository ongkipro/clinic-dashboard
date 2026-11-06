I found no new HIGH defect in this lane, but B2-1 stands and reaches two more actions that write into the wrong clinic. I also found three new defects: one MEDIUM, two LOW.

# Lane B2 cross-review: server actions, modules, workers

## B2-1: every place that resolves the context at submit time

Every clinic write action reads the current `clinic_context` cookie when it runs, not the clinic, role and branch the form was shown in. The result depends on whether the action's input only means something inside one tenant.

**Actions that write into the wrong clinic** (their input is valid in any tenant):
- `src/app/(app)/pengaturan/actions.ts:52-60` `saveAction`: already reported. It is open for tenant-scope settings, and for a branch-scope setting's tenant value (`branch=""`).
- `src/app/(app)/kepatuhan/actions.ts:56-58` `uploadAction`: the input is only an obligation key such as `tax_advice`. A file meant for clinic A becomes a new evidence version in clinic B, and an approved item in B drops back to `submitted`, which closes its gate (`0030_compliance_rules.sql:325`).
- `src/modules/org/staff/actions.ts:44` `inviteAction`: the input is email, name and roles. An invitation with no branch (Level 2 roles, e.g. finance) is created in clinic B with B's link.

**Actions that bind the wrong context but fail closed** (they take an id that belongs to one tenant, so the database answers ERR_NOT_FOUND / P0002 for clinic B):
- `src/app/(app)/pengaturan/actions.ts:83` `withdrawAction`
- `src/app/(app)/persetujuan/actions.ts:35-42` `decideAction`
- `src/app/(app)/kepatuhan/actions.ts:75` `decideAction`
- `src/modules/org/staff/actions.ts:53, 62, 74, 83, 94` (`cancelInviteAction`, `revokeSessionAction`, `endMembershipAction`, `removeRoleAction`, `dutyAction`)
- `src/modules/org/roles/actions.ts:21-22` `answerOwnerGrantAction`
- `src/modules/org/context/actions.ts:22-26` `switchAction`: a role switch applies to whatever clinic the cookie names now. A branch switch to clinic A's branch is refused.

**The same race inside one clinic:** if another tab switches the acting role or branch, every action above runs with the new role. The database re-checks authority, but the outcome can change; for example an Owner's "Simpan" becomes an Admin Pusat draft.

**Not affected:** `src/app/vendor/api/console/[action]/route.ts` uses the vendor session token and an explicit `tenantId` in the body, with no clinic cookie. `kepatuhan/berkas/[id]/route.ts` is read-only and returns 404 outside the bound tenant.

## New findings

### N1 (MEDIUM): Staff detail page crashes when Admin Pusat opens a privileged staff member
- **Where:** `src/modules/org/staff/page-data.ts:64`, which calls `sessions: canManage ? await staffSessions(db, staffId) : []` with no error handling.
- **Why it breaks:** `staff_sessions()` raises `ERR_NOT_FOUND` when `staff_admin_may_touch` is false (`drizzle/0026_staff_access_rules.sql:509-510`). That is the case for Admin Pusat looking at an owner, finance, facility head, records officer, auditor or another Admin Pusat. `tests/org/access.test.ts:166` confirms the refusal.
- **Effect:** the `CommandError` escapes `loadStaffDetail`. There is no `error.tsx` under `staf/`, so `/staf/<id>` fails with the generic error page. These staff are listed and linked from `/staf` (`staf/page.tsx:118`).
- **Fix:** list sessions only when the viewer may touch that staff member: catch `CommandError` from `staffSessions` and return `[]`, and set `canManage` to false for that row so the remove and end buttons are hidden too. Add a test where Admin Pusat opens an owner's detail page.

### N2 (LOW): Owner with a branch selected cannot save branch settings except at that branch
- **The conflict:**
  - `loadGroup` treats every Level 2 role as tenant-wide and offers "Semua cabang" plus every branch (`src/app/(app)/pengaturan/data.ts:51-54`, `[grup]/page.tsx:168-183`).
  - `setting_set` reads the actor's active branch and refuses any other branch, and refuses `p_branch IS NULL` for branch-scope rows (`drizzle/0028_settings_rules.sql:349-354`).
- **Effect:** an Owner who chose a branch in Ganti Cabang gets "Anda tidak punya akses…" on every branch-scope row except that branch. That contradicts DEC-026 ("The owner changes every row"). Settings tests bind Level 2 roles without an active branch (`tests/settings/settings.test.ts:48`), so this path is untested.
- **Fix:** in `setting_set`, apply the branch checks only to Level 3 roles (`a.role NOT IN` the Level 2 list), or have `loadGroup` offer only the active branch when one is set. Add a test with an Owner bound to a branch.

### N3 (LOW): A revoked session can still write `org_actions` into the revoked clinic
- **Where:** `switchContext` calls `activeContext(app, accountId, current)` and `activeContext(app, accountId, next)` without the session id (`src/modules/org/context/context.ts:149` and `:164`).
- **Effect:** a membership revoked for this session (IAM-16 / DEC-024) is still offered in `now.clinics`. A clinic switch to it passes, and `recordContextSelected` inserts an `org_actions` row in that tenant, attributed to the staff member, from a revoked session. The next request falls back, so no data is read, but a revoked session should not write at all.
- **Fix:** pass `gate.sessionId` through `switchAction` to both `activeContext` calls. Add a test: revoke the session for clinic A, try a switch to A, and expect `ContextSwitchError` and no new row.

## Checked and sound
- **Context binding:** `withTenantContext` validates UUIDs and roles, binds settings with `set_config(...,true)`, refuses nesting, clears session-level leftovers and destroys broken clients. `activeContext`/`resolveContext` re-validate the cookie against `account_memberships` on every request. `app.roles` carries the acting role only.
- **Authorization on every write:** every action calls `requestContext()` (session gates) and runs inside `withTenantContext`. Authority is decided again in SECURITY DEFINER functions through `approval_actor`, `staff_admin_lock` and `staff_target`: actor from context, role held, branch in scope. Ids from forms are checked against the tenant (`WHERE tenant_id = a.tenant_id`).
- **Error paths:** refusals return not-found with no existence leak (`approval_decide`, `evidence_file_content`, `staff_target`, `staff_sessions`). Logs carry codes or messages only, never payloads.
- **`runCommand`:** a different body or another caller's key gives a conflict. The claim plus `on conflict do nothing` waits for a concurrent duplicate, which then replays under READ COMMITTED. Savepoints roll back correctly. **No money, stock, session or commission command exists in M0** (no `runCommand` call site), so nothing is missing an idempotency key.
- **Outbox:**
  - `events_claim` refuses bound connections, uses SKIP LOCKED and returns ids only.
  - `consume` binds the event's own tenant and branch and marks the receipt done first under a 5 s lock timeout, so a duplicate is skipped.
  - Payloads are limited to ids and codes by `events_payload_ok`. Approval, setting and lifecycle events carry ids and codes only.
  - The worker logs consumer, event id and code only.
- **Lock order:** approval row → draft row → `setting:` advisory lock → `audit:` lock is the same order on both decide paths and in `setting_set`. The D3 self-approval in `evidence_decide` takes `staff_access:` after the item row lock, and no staff-lock holder touches evidence rows, so there is no lock cycle.
- **Caching:** `cacheComponents` is on, there is no `"use cache"`/`unstable_cache`, every page reads `headers()`/cookies through `requestContext` inside Suspense, the layout fallback is static, and only `revalidatePath` is used. Nothing tenant-specific can be served from a shared cache.
- **Notifications, audit list and compliance register:** visibility is enforced by RLS and definer checks, and the auditor mask is applied.
- **Approvals inbox:** `decidableTypes` and `approval_owner_decides_fh` match `approval_decide`.

| ID | Severity | File:line | Issue |
|---|---|---|---|
| B2-1 (extended) | HIGH | `kepatuhan/actions.ts:56-58`, `modules/org/staff/actions.ts:44` (plus `pengaturan/actions.ts:52-60`) | Writes go into the clinic in the current cookie, not the one the form was shown in; fail-closed actions listed above |
| N1 | MEDIUM | `src/modules/org/staff/page-data.ts:64` | `/staf/<id>` crashes when Admin Pusat opens a privileged staff member (`staff_sessions` ERR_NOT_FOUND not handled) |
| N2 | LOW | `drizzle/0028_settings_rules.sql:349-354` vs `pengaturan/data.ts:51-54` | Owner with an active branch cannot save branch-scope settings for other branches or "Semua cabang" |
| N3 | LOW | `src/modules/org/context/context.ts:149,164` | `switchContext` ignores session revocation, so a revoked session can write `org_actions` in the revoked clinic |

VERDICT: REQUEST_CHANGES
