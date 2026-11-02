# Round 3 review 4 — data model and consistency (kit v0.4)

- Reviewer: independent cross-model delegate R3-D (cx/gpt-6.1-sol via 9router-fantastico), read-only, 2026-11-02.

## Verdict: BLOCK — Review Completion Gate

This is an **incomplete review, not evidence that the entire kit is defective**. I inspected only the first 95 lines of `05-DATA-MODEL.md` before the investigation was stopped by the delegate’s finalization limit. I did not inspect the remaining data model, the other required documents, the decision register, or the existing UX review. Consequently, I cannot certify end-to-end schema coverage or cross-document consistency.

### Confirmed Finding

All paths below are relative to `~/Documents/work/prd/clinic-dashboard/`.

| ID | Severity | Evidence | Problem | Smallest Concrete Fix |
|---|---|---|---|---|
| R3D-1 | P2 | `05-DATA-MODEL.md` §2 and §2.1, `MEMBERSHIP`–`STAFF` relationship | The conceptual ERD declares `MEMBERSHIP }|--|| STAFF`, allowing multiple memberships per staff, while the platform ERD declares `MEMBERSHIP ||--|| STAFF`, requiring exactly one membership per staff. These are different identity models. Implementers cannot derive one unambiguous constraint from both diagrams. | Choose the intended cardinality and make both diagrams agree. If the intended rule is one staff record per tenant membership, explicitly specify `staff.membership_id NOT NULL UNIQUE`, a tenant-consistent membership foreign key, and whether creating a membership must immediately create a staff record. |

### Missing Tables/Columns: Not Yet Established

I cannot responsibly label tables or columns “missing” from an unread portion of the specification. The visible ERDs name many entities, but an entity name does not establish its columns, constraints, scope policy, or module ownership.

The follow-up review must establish these concrete contracts:

- **Identity and tenancy:** keys connecting `account`, `membership`, `staff`, `staff_role`, `staff_branch`, `branch`, and `tenant`; particularly constraints preventing a staff assignment from referencing another tenant’s branch.
- **Clinical and financial linkage:** tenant-consistent references connecting `patient`, `visit`, `visit_assignment`, `invoice`, `payment_allocation`, `package_session`, `treatment_execution`, `commission_contribution`, and `stock_movement`.
- **Vendor operations:** persisted relationships and permissions for `vendor_staff`, `support_session`, `onboarding_grant`, `tenant_lifecycle_event`, `server_fee_version`, `vendor_invoice`, and `vendor_payment`.
- **Command integrity:** the uniqueness scope, request fingerprint, and result/retry semantics of `idempotency_records`; clinical signing/versioning command replay protection; audit actor, active role, tenant, branch, and vendor-session attribution.
- **First-client import:** documented staging/mapping and opening-entry structures for Numa Klinik patients, remaining package sessions, balances, and reconciliation—not merely a statement that the old schema is a naming reference.
- **Coverage:** table-by-table scope kind, owner module, and RLS policy, including DATA-48–DATA-56; complete mapping from every Must requirement to persisted data or an explicitly derived value.

These are **verification targets, not confirmed omissions**.

### Good Foundations Observed

- DATA-1 explicitly distinguishes tenant rows from branch-scoped and ledger rows.
- DATA-2 and DATA-3 establish append-only clinical versions and financial records, with corrections rather than destructive edits.
- DATA-5 requires idempotency for commands moving money, stock, sessions, or commissions.
- DATA-6 preserves sale-time price, tax, commission-rule, session-value, and selling-branch snapshots.
- The hierarchy ERD separates vendor staff from clinic memberships and connects tenants to branches, patients, visits, vendor support, and vendor billing.
- Patient ownership is drawn at tenant level, while visits are connected to both patient and hosting branch.

**Release this review gate only after the unread specifications are checked. No conclusions about undefined IDs, complete RLS coverage, import readiness, or contradictions among files 05, 06, 11, and 18 are supported by this partial inspection.**

---

# Retry (full read of 05, 06, 11, 18)

## Verdict: BLOCK — Review Not Completed

This is a **verification block**, not a finding that the kit itself is defective. My first full-read request for `05-DATA-MODEL.md` returned only a protected-finalization notice, with no file contents. I was then instructed to stop investigating. I therefore read **none of the four files** and cannot substantiate schema findings or give a technical PASS.

| ID | Severity | Evidence | Problem | Smallest Concrete Fix |
|---|---|---|---|---|
| R3D-2 | P2 — verification gap | The attempted read of `05-DATA-MODEL.md` returned no document contents; no DATA/BILL/TD rule was inspected. | The requested independent review has no primary-source evidence. Tenant-consistent FKs, scope coverage, command attribution, import completeness, cross-document consistency, and missing persistence structures remain unverified. | Rerun this bounded review with the four complete file contents supplied directly to the reviewer, or with a functioning read-only file-reading budget. Do not treat this attempt as technical approval. |

### Missing Tables/Columns

**Not assessed.** No missing table or column can responsibly be identified without reading the documents.

### Good

- The directive specifies a bounded, concrete review covering hierarchy, tenant consistency, financial integrity, and first-client migration.
- The directive reports the membership–staff cardinality correction (`DATA-55`); **I did not independently verify it**.

No files were written, no commands were executed, and no technical conclusions from earlier reviewers were adopted as independently verified evidence.

---

# Second retry (direct pi run, read tool only, cx/gpt-6.1-sol:high) — completed

## Verdict: **BLOCK**

Read all four requested files in full; no other files were reviewed. This is a review of the **planning contracts**, not an assertion about implemented tables or code.

The hierarchy and financial principles are sound, but tenant-consistent relationships, operator access, command attribution, and opening-data migration are not sufficiently specified to implement safely. Several billing requirements also lack corresponding persistence contracts.

## Findings

| ID | Severity | Evidence: file + ID | Problem | Smallest concrete fix |
|---|---|---|---|---|
| **R3D-301** | **P1** | **05**, DATA-1, DATA-12–40, DATA-55–56, §2.1; **06**, TEN-10–11 | **The FK chain is described, not completely constrained.** DATA-55 explicitly constrains membership → staff and the branch side of staff assignments, but equivalent composite FKs are not specified for staff roles, visit assignments, patient → visit → execution/invoice, payment targets, packages/sessions, stock, journals, or platform billing documents. Tenant-consistent FKs alone also do not prevent allocating patient A’s payment to patient B’s package. `allowed_branch_ids` has no referential-enforcement contract. | Add a relationship/constraint matrix: referenced composite unique keys, composite FKs, nullability, and deletion behavior. Specify same-patient constraints for financial targets and same-visit constraints for clinical/execution links. Normalize or validate allowed branches. Preserve explicitly permitted cross-branch package redemption rather than requiring every branch reference to match. |
| **R3D-302** | **P1** | **05**, DATA-25, DATA-32, DATA-36, DATA-40, DATA-43, DATA-48–56; **06**, TEN-3, Policy Kinds | **There is no unambiguous per-table scope map.** Receivables and commission rules are tenant-ledger in 05 but tenant-shared in 06. Suppliers appear under both branch-scoped DATA-25 and mixed-scope DATA-54. DATA-52–55 group differently scoped tables without assigning each one a kind. DATA-51 puts payment configuration, charges, and webhook events under posting-service-only tenant-ledger writes without distinguishing their writers. | Add one row per physical table with exactly one policy kind, owner, permitted readers/writers, and branch semantics. Resolve the contradictory classifications. Include tables introduced through DATA-55/56, particularly `visit_assignments`, `patient_portal_identity`, and `otp_challenges`. **All DATA entries do name Engineering owner; ownership is not the missing part.** |
| **R3D-303** | **P1** | **06**, TEN-13–14, TEN-17, Policy Kinds; **05**, DATA-13–14, DATA-38 | **Policy-kind-only operator authorization is broader than the approved support scope.** TEN-14 limits notify-only sessions to configuration/status/money totals and requires approval for specific personal data. TEN-17’s stated predicate checks active session plus policy kind. Granting `tenant-shared` for catalog/settings could therefore also authorize patients, consents, conversations, and messages. | Make operator predicates enforce approved **object kinds and permitted projection**, not just policy kind. Require the appropriate approval for personal-data objects. Expose money totals through bounded functions/views, not unrestricted ledger reads. Apply the same distinction to onboarding grants and count-only import visibility. |
| **R3D-304** | **P1** | **06**, TEN-18, clinical and tenant-ledger policies; **11**, BILL-15 | **The read predicates do not fully express required role restrictions.** “Others by branch” on tenant-ledger rows does not enforce “staff see own” commission. Conversely, the clinical policy lists clinicians/assignment/break-glass but does not incorporate TEN-18’s declared-purpose access for records officers and facility heads. | Specify table-specific role and row predicates: commission recipient/self restrictions; authorized finance access; and audited purpose-based clinical access. Include these paths in the role × table tests. |
| **R3D-305** | **P1** | **05**, DATA-19, DATA-43, DATA-48; **06**, TEN-2, TEN-14, TEN-17; **18**, TD-50 | **A complete command/audit attribution contract is missing.** Individual entities contain some actors, but neither DATA-43 nor TD-50 establishes immutable actor account/membership/staff, selected acting role, tenant, relevant branch, vendor session, and command linkage. `app.roles` is a role set, not necessarily the role used to authorize a command. Async processing can lose the originating attribution. | Define mandatory command/audit fields and bind them server-side. Include `acting_role`, origin actor, tenant, active/source branch as applicable, nullable vendor session, command/correlation ID, affected object, and outcome. Preserve origin attribution through outbox references while recording the executing service separately. |
| **R3D-306** | **P1** | **05**, DATA-5, DATA-45; **18**, TD-41–43, TD-50–51 | **Idempotency is incomplete across command types and domains.** DATA-5 covers money/stock/sessions/commission, not clinical signing/amendment or consent commands. DATA-45 provides a tenant-unique key, command, and result hash, but no request fingerprint or execution/replay contract. Its tenant-shared policy does not explain vendor-platform commands. Provider webhook deduplication alone does not protect downstream posting. | Define clinical and platform coverage; key namespace; request fingerprint; atomic claim/status/result storage; same-key/different-request rejection; and replay behavior. Add durable consumer deduplication tied to source events for journals, stock effects, sessions, and commission. |
| **R3D-307** | **P1** | **05**, DATA-29–32, DATA-37, §6; **06**, TEN-13; **11**, Roll-forwards | **The first-client opening-data path is missing.** TEN-13 mentions owner-started patient/contact/balance imports, but no contract covers open packages, remaining sessions, paid-unused values, original validity/sold branch, receivables, or opening ledger entries. DATA-30 has no opening entry type. §6 describes fixtures and migration mechanics, not operational onboarding. | Define an owner-started import batch with staged validation, tenant/source/external-ID deduplication, patient/branch mapping, approval, and reconciliation totals. Specify opening package/session, balance, receivable, and ledger records that do **not** fabricate fresh sales, tax, or commission. Vendor visibility must remain counts/error codes only. |
| **R3D-308** | **P1** | **05**, DATA-37, DATA-40; **11**, Posting Map; **18**, TD-50 | **The domain-event/posting persistence contract is incomplete.** DATA-40 describes the SATUSEHAT-oriented integration outbox, but 05 does not explicitly define TD-50’s general event envelope, consumer receipts, or journal-to-source-event uniqueness. TD-50 also lacks explicit posting triggers for commission payout, supplier return, and operational expense, despite corresponding posting rows. | Declare whether `integration_outbox` is the shared domain outbox or add a dedicated one. Specify envelope columns, transaction coupling, consumer deduplication, and journal source references. Add the missing event types or explicitly map them to existing events with unambiguous fact IDs. |
| **R3D-309** | **P1** | **05**, DATA-49; **11**, BILL-32; **18**, TD-42 | **AutoLaris recovery has unresolved identity and reconciliation boundaries.** BILL-32 defines a `reff_id` per attempt; TD-42 says a stable reference per invoice. Advice requires `transaction_id`, but an unknown create response may not have returned one. Polling ends at expiry + 24 hours, while BILL-32 requires handling late settlements without stating that deadline. | Make the reference explicitly attempt-scoped, enforce one open/unresolved attempt per invoice, and document a provider-supported recovery path when no transaction ID was received. Keep an unresolved attempt blocked from recreation. Define a durable late-settlement reconciliation/exception path beyond routine polling. |
| **R3D-310** | **P1** | **05**, DATA-28–30, DATA-51; **11**, BILL-29; **18**, TD-43 | **Simulation provenance is not specified throughout financial facts.** DATA-51 flags a charge as simulated, but DATA-28 does not specify it on payments/allocations. BILL-29 prohibits simulated allocations from affecting readiness, balances, receivables, sub-ledgers, and commission; TD-43 says every artifact is flagged. | Persist immutable provider/environment/simulation provenance on payment facts and derived allocations, with enforced propagation or segregation. Define gate and posting predicates that reject simulated value, including value routed through patient balance. |
| **R3D-311** | **P2** | **05**, DATA-47, DATA-49; **11**, BILL-20, BILL-31–33 | **Vendor billing documents lack key lifecycle, tax, and credit persistence details.** DATA-49 does not specify issue/due dates, applied fee version, prorated service dates/calculation snapshot, or documents/applications for waivers and carried-forward double-settlement credits. DATA-47 does not specify the vendor PKP profile required by BILL-33. | Extend the existing vendor entities with frozen calculation/tax totals and dates, approval/document references, vendor tax-profile evidence, and credit applications to later invoices. Represent a waiver as the new document required by BILL-31, not only an invoice state change. |
| **R3D-312** | **P2** | **05**, DATA-15, DATA-27, DATA-30, DATA-33, DATA-53–54; **11**, BILL-6, BILL-13, BILL-27–30, Posting Map notes | **Several clinic-money rules lack corresponding state/column contracts.** Examples: the written tax-advice gate; explicit `balance_entries.vat_settled`; manual-versus-promo discount provenance and pending approval; generic product handover/return facts; booking-DP cash-refund source; and the supplier credit expectation. Refund sources in DATA-33 are limited to line/package despite BILL-13 permitting DP refunds. | Add the required fields or explicitly map each rule to an existing entity. Extend refund source typing to booking deposits. Store discount approval/provenance and fulfillment facts. Model supplier credit expectations and the tax-evidence/VAT-settled path. Keep unresolved tax treatments gated pending advice. |
| **R3D-313** | **P2** | **05**, DATA-41; **11**, BILL-23; **18**, TD-51 | **The owner write-off exception conflicts with universal separation of duties.** BILL-23 allows the owner to write off alone with a reason; DATA-41 requires approver ≠ requester, and TD-51 supplies the corresponding rejection without documenting the exception. | Make the constraint conditional on approval type and authorized acting role: owner self-write-off allowed with reason/audit; other write-offs retain independent owner approval. Add matching tests/error behavior. |
| **R3D-314** | **P2** | **05**, DATA-28, DATA-51; **06**, TEN-9–10; **18**, TD-40–43 | **Patient-payment identities and canonical records are ambiguous.** Both `gateway_transactions/events` and `payment_charges/webhook_events` exist without a relationship or canonical-writer contract. DATA-28’s provider event uniqueness and DATA-51’s provider-reference/event uniqueness use different namespaces; no tenant/provider-account/environment namespace guarantee is specified. | Define one canonical charge, event receipt, payment, and allocation chain, with explicit FKs. Namespace external IDs by tenant, provider account, provider, and environment unless the provider guarantees a stronger global identity. Align route validation and deduplication with that namespace. |

## Missing tables/columns or explicit persistence mappings in **05**

These are specification gaps; a new table is not necessary where an existing entity can safely own the fields.

- **Platform routing tables:** `waba_routes`, `payment_routes`, `public_hosts` from TEN-9/TD-22/TD-40.
- **Opening-import storage:** import batches, staged rows/error codes, source-ID mappings, approvals and reconciliation results; opening balance/package/receivable/ledger markers and source references.
- **General event delivery storage:** TD-50 envelope columns, durable consumer deduplication/processing receipts, and unique journal/posting source references.
- **Audit/idempotency columns:** immutable origin actor, acting role, tenant/branch/vendor session, command linkage; request fingerprint, execution status, replayable result, and platform-domain namespace.
- **Vendor billing extensions:** issue/due/service dates, fee-version and proration snapshots, tax totals/profile evidence, waiver documents, credit balances/applications, and durable unresolved-attempt reconciliation state.
- **Clinic financial extensions:** simulation provenance on payments/allocations; `vat_settled`; tax-advice evidence; discount type/approval state; product handover/return facts; booking-deposit refund linkage; supplier credit-expectation amount/state.
- **Integration persistence details:** Meta raw-event deduplication storage; encrypted WABA registration PIN from TD-20; a named clinical-class provider-error store from TD-33. DATA-40 mentions that error store but does not identify its entity.
- **Relationship keys:** explicit tenant/patient/visit/branch composite keys and FKs across the business chain, including the newly introduced identity and assignment tables.

## Good

- **Identity separation is deliberate:** global account → tenant membership → tenant staff; vendor staff remain separate; patients belong to one brand. DATA-55 already supplies an important composite membership/staff FK.
- **Financial foundations are strong:** integer rupiah, append-only financial facts, reversing adjustments, sale-time snapshots, nonnegative balances/stock, and locked accounting periods.
- **The two money domains are clearly separated:** clinic patient payments use the payment port; vendor server fees use the vendor’s AutoLaris account and secrets.
- **Several important reliability controls are already stated:** transactional fact/outbox writes, verified payment settlement, duplicate/late webhook scenarios, owner-started imports, and negative RLS tests. The main need is to turn these into complete, consistent persistence and authorization contracts.
