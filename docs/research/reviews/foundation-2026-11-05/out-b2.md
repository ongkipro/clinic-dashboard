## Review scope

Read-only static review; no commands or tests were run, no secrets were read, and no files were changed. I excluded T-027/T-028/T-032 and the identified in-flight changes.

I inspected the command wrapper, tenant-context resolution/binding, tenant mutation handlers, supporting module implementations, outbox worker, and selected integration/isolation tests and SQL enforcement paths. **I did not complete the requested exhaustive every-file pass**, so this is not a full-coverage M0 attestation.

## Findings

### B2-1 — HIGH: An open form can silently mutate a different clinic after a context switch

**Evidence:** `src/app/(app)/pengaturan/actions.ts:52–60`, `src/app/(app)/pengaturan/editor.tsx:183–185`, `src/modules/org/context/store.ts:40–42`.

The settings form posts its setting key and branch, but not the context in which it was rendered. The action resolves the **current** selection cookie and immediately writes using that context.

Concrete reproduction:

1. An account is Owner in clinics A and B.
2. In tab 1, open a tenant-wide setting in A—for example, SET-8, with an empty branch field.
3. In tab 2, switch to B. This replaces the shared `clinic_context` cookie.
4. Submit the still-open A form in tab 1.
5. `saveAction` resolves B and applies A’s submitted value to **B’s settings**, without warning.

RLS does not prevent this: the account legitimately belongs to B, and the action binds B before executing the write. The same structural problem affects key-based evidence uploads and invitation creation.

**Rule/spec:** DEC-021 says “every later action carries that context.” `STATUS.md` explicitly identifies the necessary guard: write actions must post the rendered tenant/role/branch and refuse a mismatch because two tabs share the selection (`STATUS.md`, T-030 follow-ups). IAM-3 also requires the acting identity to be recorded correctly (`docs/spec/07-IAM-RBAC-ABAC.md:18`). There is no accepted decision waiving this guard.

**Smallest fix:** Include the rendered tenant, acting role and active branch in mutation forms, and compare them with the freshly authenticated, server-resolved context **before entering the mutation**. Reject a mismatch with a refresh/context-changed message. These posted fields are an expected-context assertion, not authority to choose the tenant. Add a two-tab regression test proving that neither tenant is modified after a mismatch.

### B2-2 — MEDIUM: Settings mutations bypass the required idempotency/replay contract

**Evidence:** `src/app/(app)/pengaturan/actions.ts:33–60`, `src/modules/settings/settings.ts:145–162`, `drizzle/0028_settings_rules.sql:363–366`.

`saveAction` accepts no idempotency key and calls `changeSetting` directly. That module calls `setting_set`, whose direct-changer branch creates a fresh version on every invocation. Neither layer invokes `runCommand`.

Consequently:

- Repeating an identical submission creates another version/event rather than returning the original result.
- A delayed retry can overwrite an intervening change.
- There is no way to refuse “same key, different payload,” because no key is carried or persisted.

The one-pending-draft check is not a substitute: it applies only to drafts and returns a conflict rather than replaying the original result.

**Rule/spec:** API-2 explicitly requires: “Every mutation requires an `Idempotency-Key` header; replay returns the original result” (`docs/spec/09-API-SPECIFICATION.md:17`). The requested B2 review also requires idempotency keys on every state-changing command. DEC-016 defines the shared replay mechanism; it does not explicitly exempt settings mutations.

**Smallest fix:** Carry a stable per-submission key through the Server Action’s form transport and wrap the settings command in `runCommand` inside the existing tenant transaction. Fingerprint the normalized setting key, branch, value/restore intent, effective date and reason; persist a JSON result containing IDs/codes. Handle the returned failed outcome without throwing away its idempotency record. Test identical replay, changed-payload conflict, and a retry following an intervening settings change.

## Checked and found sound in the inspected paths

- **Tenant selection:** `activeContext`/`resolveContext` revalidate cookie selections against authenticated account memberships and acting-role branch scope. A posted tenant or branch is not simply accepted as authority.
- **Transaction binding:** `withTenantContext` uses an exclusively checked-out connection, transaction-local settings, rollback cleanup, nesting protection and destruction of broken connections.
- **Shared command wrapper:** The implementation and `tests/idempotency/command.test.ts` cover concurrent duplicates, changed-body conflicts, caller-private results, tenant-separated namespaces, and rollback of partial effects.
- **Approvals:** The inspected tests cover requester-versus-approver separation across roles, branch restrictions, foreign-tenant not-found responses, final decisions and immutable history.
- **Outbox:** Consumption binds the claim’s tenant/branch and completes the receipt atomically with database effects. Tests cover concurrent workers, expired leases, replay, handler rollback and tenant-bound effects. Worker failure logging contains event IDs/codes rather than payloads.
- **Evidence downloads:** The route authenticates, binds tenant context, maps inaccessible files to 404, and returns attachments with `private, no-store`.
- **Support access:** The inspected support module and scope tests cover transaction-bound tickets, owner approval for personal/clinical scope, cross-tenant refusals, ended sessions and access-log scoping. I did not flag the explicitly accepted DEC-038/039/040 residual risks.

## Findings table

| ID | Severity | Location | Defect |
|---|---|---|---|
| B2-1 | HIGH | `src/app/(app)/pengaturan/actions.ts:52–60` | Stale forms silently write under a different clinic’s current context |
| B2-2 | MEDIUM | `src/app/(app)/pengaturan/actions.ts:33–60` | Settings mutations lack required idempotency keys and replay semantics |

VERDICT: REQUEST_CHANGES
