## Review scope and limits

Read-only review of the 48 journaled migrations (`0000`–`0047`), `src/db/**`, and relevant database, RLS, isolation, audit, and support-session tests. I checked the findings against `DECISIONS.md` and the product decision register.

No commands or tests were run, no files were changed, and no `.env` files were read. The excluded tasks and in-flight hygiene changes are not findings.

## Findings

### 1. HIGH — Removing an operator’s vendor role does not revoke an already-bound support read

**Evidence:** `drizzle/0046_support_session_rules.sql:122–139`, especially line **134**; role removal at `drizzle/0032_vendor_staff_rules.sql:330–332`.

The RLS authority, `operator_scope_allows`, rechecks that the operator is signed in, active, the opener, and within the session’s tenant/scope/TTL. It **does not recheck `vendor_staff_roles`**.

Consequently:

1. A support operator opens an approved session and binds a read transaction.
2. A platform owner removes their `support` role, leaving only `vendor_auditor` and keeping their staff state active.
3. Subsequent SELECTs in the bound transaction still pass RLS until the support session expires.

New binds correctly check for a support-capable role through `support_read_caller` (`0046:218–225`), but an existing binding bypasses that check. The current revocation test covers suspension and sign-out, not role removal (`tests/vendor/support.test.ts:243–273`).

**Rule:** `docs/spec/07-IAM-RBAC-ABAC.md:30`, IAM-16: removing a role must invalidate affected sessions, cached permissions, and temporary grants within **60 seconds**.

**Smallest fix:** Add a current-role predicate to `operator_scope_allows`, requiring at least one of `support`, `onboarding`, or `platform_owner`. Add a two-connection regression test that removes the last support-capable role after binding and verifies the next SELECT returns no rows.

---

### 2. HIGH — Transaction-start timestamps let an offboarded Owner continue granting roles

**Evidence:** `drizzle/0036_owner_decisions.sql:312–324`, particularly line **318**; `drizzle/0011_audit_chain.sql:62–67`.

The final `role_assign` implementation checks membership validity using PostgreSQL `now()`, which remains the **transaction-start timestamp**. Its audit backstop uses the same timestamp.

`staff_end_membership`, however, ends membership using `clock_timestamp()` and leaves the historical `staff_roles` rows present (`drizzle/0026_staff_access_rules.sql:207–209`).

A concrete sequence is therefore allowed:

1. Owner A starts a transaction and binds their existing context.
2. Owner B ends A’s membership and commits.
3. In A’s older transaction, `role_assign(other_staff, 'finance')` still sees `effective_to > now()`.
4. The role insertion and `audit_append` both succeed, despite A already being offboarded.

The stale authorization can persist beyond 60 seconds because this path has no transaction-duration bound. `role_request_decide` repeats the same actor-check pattern (`0036:369–377`).

This is not the accepted assumption that server code supplies the GUCs: the bound context was valid when supplied and became invalid afterwards.

**Rule:** IAM-16, `docs/spec/07-IAM-RBAC-ABAC.md:30`, requires membership termination to invalidate affected access within 60 seconds. The repository already recognizes this exact timestamp problem in `staff_admin`, using `clock_timestamp()` after the staff lock (`drizzle/0026_staff_access_rules.sql:37–39`).

**Smallest fix:** In a new migration, acquire `staff_access` before validating the actor and use wall-clock membership validity. Reuse `staff_admin_lock` where appropriate. Update the corresponding audit membership check so it cannot accept an ended membership solely because the transaction started earlier. Add a regression test with a transaction opened before another connection ends its actor’s membership.

---

### 3. MEDIUM — The expiry sweep can terminate a successfully extended session using a stale candidate

**Evidence:** `drizzle/0046_support_session_rules.sql:545–552`; extension at **310–312**; unconditional end at **329–334**.

`support_session_expire` selects expired candidates **before** taking their tenant’s `staff_access` lock. After obtaining the lock, it calls `support_session_end` without rechecking expiry.

The following race is possible:

1. The opener extends a still-live session, holding `staff_access`, but has not committed.
2. The original expiry passes.
3. The sweep sees the old committed expiry, selects the session, then waits for `staff_access`.
4. The extension commits with a future `ends_at`.
5. The sweep acquires the lock and ends the newly extended session anyway.

`support_session_end` only checks whether the session exists or is already ended; it does not validate that an `expired` reason is still true.

**Rule/contract:** TEN-14 says sessions end at their TTL (`docs/spec/06-TENANT-ISOLATION.md:30`); the implemented extension moves that TTL forward. An expired pre-lock snapshot must not override the committed extension.

**Smallest fix:** After acquiring `staff_access`, reread the session and tenant and reevaluate the expiry/closed condition before ending it. Add a concurrent extension-versus-sweep test with the extension held uncommitted across the original expiry.

## Checked and found sound

Within the inspected scope:

- **Tenant relationships:** Tenant tables expose composite tenant keys; tenant-to-tenant FKs carry tenant identity; business FKs use `ON DELETE RESTRICT`. The contract suite includes deliberately invalid schemas to prove those checks fire.
- **RLS coverage:** Every physical application table receives RLS enablement. Platform tables are denied to `clinic_app`; operator-readable tables have explicit tenant-comparing policies and a support-class registry.
- **Important architecture distinction:** The migrations do **not** use `FORCE ROW LEVEL SECURITY`. They rely on non-owner application logins and migration-owner bypass for definer functions—the owner-bypass trust model documented in DEC-007/DEC-013. I have not described this as forced RLS.
- **Context isolation:** Transaction-local bindings, exclusive checked-out connections, nesting refusal, rollback handling, session-setting cleanup, and destroyed-backend handling are present and tested. Arbitrary `clinic_app` GUC forgery remains the explicitly accepted server-trust boundary in DEC-013.
- **Support binding:** GUCs alone do not authorize operator reads. Backend/transaction-bound tickets, durable pre-read ticket logging, tenant/scope checks, wall-clock expiry, and READ COMMITTED enforcement are present. Owner termination, suspension, and sign-out have negative tests.
- **Definer surface:** Inspected SECURITY DEFINER functions pin `search_path`, qualify application relations, revoke PUBLIC execution, and grant explicit entry points. Vendor actor-ID entry points lose their `clinic_vendor` grants in migration `0034`.
- **History and audit:** Audit, outbox, approval, evidence, vendor-action, lifecycle, and support-history paths have mutation guards, including TRUNCATE guards for their immutable histories. Audit appends serialize per tenant and chain canonical rows.
- **Migrations:** The runner serializes concurrent migration runs, checks applied-file hashes, rejects missing and backdated migrations, and has rerun/concurrency tests.
- **Isolation tests:** The surface-coverage gate includes positive tenant-B controls, tenant-A negative cases, and self-tests proving uncovered routes/jobs/exports are rejected.

## Findings table

| ID | Severity | Location | Defect |
|---|---|---|---|
| A-01 | HIGH | `drizzle/0046_support_session_rules.sql:134` | Bound support reads survive removal of the operator’s support-capable vendor roles |
| A-02 | HIGH | `drizzle/0036_owner_decisions.sql:318` | Transaction-start membership checks allow an offboarded Owner to continue granting roles |
| A-03 | MEDIUM | `drizzle/0046_support_session_rules.sql:545–552` | Expiry sweep can terminate a session whose extension committed while it waited |

VERDICT: REQUEST_CHANGES
