# Lane A cross-review: database, tenancy and RLS (M0)

The three findings already reported (A-01, A-02, A-03) hold up against the code; I found nothing to contradict them. The same defect class as A-02 shows up in more places (A-02x below), plus one new MEDIUM and three LOW findings.

## A-02x: more places where an actor check can be outlived by a concurrent revocation

The first reviewer named `role_assign`, `role_request_decide` and `audit_append`. These are the remaining places that check the actor's validity with transaction-start `now()`, or before the tenant's `staff_access` lock, or with no lock at all.

**Real defects:**

1. **`approval_actor()`** checks `effective_from <= now() AND effective_to > now()` (`drizzle/0022_approvals_rules.sql:45`) and takes no lock. `staff_end_membership` sets `effective_to = clock_timestamp()` (`0026:197`). Any transaction that started before that instant still passes, even if its check runs after the end has committed. Every caller inherits this:
   - **Money approvals:** `approval_request`, `approval_decide` and `approval_owner_self` (`0022:70,115,170`; `approval_decide` redefined at `0036:68`), and `approval_cancel` (`0022:221`). These decide refund_exception and write_off approvals.
   - **Settings:** `setting_set` (`0028:342`); `setting_draft_decide` reaches it through `approval_decide`.
   - **Evidence:** `evidence_upload` (`0030:284`) and `evidence_decide` (`0036:156`). `evidence_decide` takes `staff_access` only later, at `0036:186`, so the actor check runs before the lock.
   - **Owner grants:** `role_owner_confirm` checks at `0036:423` and locks at `0036:424`. A member whose membership is being ended can still confirm an Owner grant and get an `owner` role row (`0036:437`). `role_owner_grant_withdraw` checks at `0036:483` and locks at `0036:487`.
   - **`vendor_dual_identity_clinic_decide`** (`0032:658`) takes no `staff_access` lock at all. An Owner whose membership or role is being ended can still approve the clinic half of a vendor dual identity (IAM-10).
   - Read-only callers: `compliance_register` (`0036:231`), `vendor_dual_identities` (`0032:700`), `support_owner_reader` (`0047:71`).
2. **`notification_ack`** (`0024:150`): same `now()` check; low impact.
3. **`org_actions_insert` policy** (`0009:21`): same `now()` check in WITH CHECK; low impact (context-selection log).
4. **Vendor session checked before the lock:** `support_caller` (`0046:193` before the lock at `0046:200`) and `onboarding_grant_check` (`0044:136` before `0044:139`) read `vendor_session(token)`, which uses `expires_at > now()` (`0034:17`), before waiting on `staff_access`. `vendor_guard` then re-reads the staff row under FOR SHARE but never re-reads `auth_session`. A sign-out or idle lock that commits during the wait is not seen, and the 10-minute step-up age (`0032:135`) is judged against transaction start.

**Checked and not defects:**
- `account_memberships` (`0007:40-41`): one statement per request, no lock wait.
- `vendor_account_has_unapproved_membership` (`0032:173`): it has no lower bound, so it fails closed.
- `tenant_has_role` (`0036:52`): used only to refuse ("an owner exists"), and the first-owner path is serialised by the invitation row lock plus the close-on-owner trigger.
- Invitation and owner-invitation expiry checks (`0026:439`, `0040:301`, `0042:222`): the row is locked, so the error is milliseconds.
- `role_owner_grants_lapse` / `vendor_request_consume` 14- and 30-day windows: negligible.
- `staff_admin()`, `staff_inviter_may_grant`, `tenant_staff_has_role`, `compliance_other_decider`, `approval_fh_available` and `onboarding_grant_active` already use `clock_timestamp()` after their lock.

**Smallest fix:** use `clock_timestamp()` in `approval_actor`, `notification_ack` and the `org_actions_insert` policy. In `evidence_decide`, `role_owner_confirm`, `role_owner_grant_withdraw` and `vendor_dual_identity_clinic_decide`, take `staff_access` before calling `approval_actor` (the `staff_admin_lock` pattern). In `support_caller` and `onboarding_grant_check`, re-read `vendor_session` after the lock.

## A-03: no further places

Every other path that ends or extends a session locks before it judges. `support_session_end` callers other than the sweep, the extend and ticket functions and `support_session_owner_decide` all take `staff_access` first and then lock or re-read the row.

## New findings

### B-01 (MEDIUM): the operator role reads columns the app role is denied (TEN-19 projections)

- **The app is restricted:**
  - `0030:93-95` gives `clinic_app` a column list on `evidence_files` without `content`, with the comment "The file content is read through evidence_file_content() (audited download), not by SELECT".
  - `0026:20-22` gives a column list on `staff_invitations` without `token_hash`, with the comment "The token hash never leaves the database" (DEC-024: "column grant excludes it").
- **The operator is not:** `0046:585` (`GRANT SELECT ON public.evidence_files TO clinic_operator`) and `0046:618` (`staff_invitations`) grant the whole table, and the same holds in `src/db/rls/operator.sql`. A bound support session with these tables in scope returns the file bytes and the invitation token hashes.
- **Rule:** TEN-19 says "operator predicates (TEN-17) check approved **object kinds and projections**, not only policy kinds". No test in `tests/vendor/support.test.ts` checks operator column privileges. DEC-038 and DEC-039 do not accept this.
- **Fix:** give `clinic_operator` the same column-list GRANTs as `clinic_app` for these two tables. Add a test that every column `clinic_operator` can read is also readable by `clinic_app` (`has_column_privilege`).

### B-02 (LOW): the "ending a membership is always allowed" branch never fires

- `memberships_vendor_guard` (`0032:222`) skips its check only when `NEW.effective_to <= now()`.
- `staff_end_membership` writes `greatest(clock_timestamp(), …)` (`0026:197`), which is always later than `now()`. So every real end falls through to the vendor dual-identity check and can raise ERR_FORBIDDEN.
- Unreachable today, because an approved dual identity cannot be revoked. Once T-028 adds revocation (DEC-030 (1)), offboarding such a member would be refused.
- **Fix:** test `TG_OP = 'UPDATE' AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL`, or compare with `clock_timestamp()`.

### B-03 (LOW): a global identity sequence leaks other tenants' activity

- `evidence_approvals.seq` is a table-wide `GENERATED ALWAYS AS IDENTITY` (`0029:16`).
- It is readable by `clinic_app` through the full-table grant at `0030:93`. Gaps in `seq` show how many evidence decisions other tenants made.
- **Fix:** revoke `seq` from the app's column grant, or order by `(decided_at, id)` and drop the column from the app projection.

### B-04 (LOW): `membership_revocations` has no TRUNCATE guard

- `0026:522` covers only `BEFORE UPDATE OR DELETE`. Every other append-only table has a `*_no_truncate` trigger, which the comment's own rule ("never deleted") calls for.
- **Fix:** add `CREATE TRIGGER membership_revocations_no_truncate BEFORE TRUNCATE … EXECUTE FUNCTION public.domain_events_immutable()`.

## Checked and found sound

- **RLS on every table:**
  - RLS is enabled on every table, and the test at `tests/rls/rls.test.ts:320` enforces it.
  - Platform tables have no app grant (test at line 347).
  - No table uses FORCE. That is consistent with the design: no app, auth, vendor, operator or executor role owns a table, `assertAppRole` refuses owners, and SECURITY DEFINER functions rely on owner bypass.
- **Tenant keys and foreign keys:** every tenant table has `UNIQUE(tenant_id, id)`, and every foreign key between tenant tables is composite and ON DELETE RESTRICT. I checked all FKs in the migrations, and `tests/db/contract.ts` enforces the 05 §3.1 contract.
- **SECURITY DEFINER functions:**
  - All of them set `search_path = pg_catalog, pg_temp`, revoke PUBLIC, and sit behind default privileges that revoke EXECUTE (`0003:39`).
  - The app-executable set is allow-listed (`rls.test.ts:362`).
  - Each one binds to `app_tenant_id()` or a token or session, not to a caller-supplied tenant.
  - Dynamic SQL in `support_read_row_exists` uses a whitelisted, quoted regclass.
- **Context settings:**
  - Every policy reads `app.*` through `current_setting(…, true)`, wrapped in NULLIF, so a missing setting fails closed.
  - `app_branch_allowed` was fixed to return no NULL (`0024:12`).
  - A client resetting `app.tenant_id` mid-transaction only narrows what it sees, because writes go through definers that re-verify membership.
  - For `clinic_operator`, forging `app.tenant_id` or `app.operator_session_id` reads nothing: the binding row must match pid and txid, and `s.tenant_id = app_tenant_id()`.
  - Session-level `app.*` is cleared after commit and refused at startup.
- **Append-only history:** audit, domain events, approvals, notifications, settings, evidence, vendor history, lifecycle, invitations, onboarding and support tables are guarded against UPDATE, DELETE and TRUNCATE (except B-04).
- **Audit chain:**
  - Per-tenant advisory lock; fresh READ COMMITTED snapshot after the lock.
  - `vendor_log` uses the same lock key.
- **Idempotency records:** private to their owner, with a forge-proof `staff_id` in WITH CHECK.
- **Event payloads:** checked by a validator to IDs, codes and booleans only.
- **Group roles:**
  - `clinic_vendor` holds EXECUTE only, test-enforced (`team.test.ts:301`).
  - `clinic_executor` holds 5 functions.
  - `clinic_operator` holds SELECT, `operator_row_read` and bind.
  - No grant goes to PUBLIC.
  - Database CONNECT and TEMP were revoked from PUBLIC.
- **Migrations:** advisory-locked, hash-drift and skipped-file checks (`migrate.ts`), MIG-1 timeouts.
- **Other support-session controls:**
  - The ticket is bound to one txid (unique).
  - Binds outside READ COMMITTED are refused.
  - Tenant closure stops reads.
  - TEN-17 negative tests: other tenant, expired, ended, unbound, forged.

## Findings table

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| A-02x | MEDIUM | 0022:45 (`approval_actor`, all callers); 0036:156/186, 0036:423/424, 0036:483/487, 0032:658; 0024:150; 0009:21; 0046:193/200, 0044:136/139 | Actor or vendor-session validity judged with `now()` or before the `staff_access` lock, so a concurrent end or role removal is outlived (money approvals, Owner-grant confirm, dual-identity clinic half) | Use `clock_timestamp()`; take `staff_access` before `approval_actor`; re-read `vendor_session` after the lock |
| B-01 | MEDIUM | 0046:585, 0046:618 (operator.sql) vs 0030:93-95, 0026:20-22 | `clinic_operator` gets full-row SELECT, so it reads `evidence_files.content` and `staff_invitations.token_hash`, which `clinic_app` is column-denied; TEN-19 projections not enforced, no test | Mirror the app's column grants; add a column-privilege subset test |
| B-02 | LOW | 0032:222 vs 0026:197 | Membership end uses `clock_timestamp() > now()`, so the "ending always allowed" branch never fires; a future dual-identity revocation would block offboarding | Detect the end transition instead of comparing with `now()` |
| B-03 | LOW | 0029:16, 0030:93 | Global identity `evidence_approvals.seq` readable by `clinic_app` leaks cross-tenant volume | Exclude `seq` from the app grant or order by `(decided_at, id)` |
| B-04 | LOW | 0026:522 | `membership_revocations` lacks a TRUNCATE guard, unlike every other history table | Add a BEFORE TRUNCATE trigger |

VERDICT: REQUEST_CHANGES
