# Independent Re-review: Follow-up Specification Fixes

**Overall verdict: CHANGES REQUIRED.** Eight findings are closed; F4 remains partially closed because module-root schema permissions are still inconsistent with the declared persistence tasks.

**T-001 assessment: safe to start as bootstrap work.** The remaining defect does not block T-001, but bootstrap readiness is not approval of the downstream specification as a whole. I did not start it.

## Remaining Finding

### F4 — P2: Module-root schema permissions remain incomplete

**Locations:** `docs/spec/15-DEVOPS-CICD-MIGRATIONS.md:89`, `TASKS.md:10`, `scripts/gen-tasks.py:632`, and the task locations below.

The five specifically repaired tasks—T-027, T-031, T-036, T-042 and T-085—now permit their owning module-root schemas. T-027’s conflicting nested schema permission is also removed.

However, the normative convention still requires `src/modules/<module>/schema.ts`, while other declared persistence builders permit only subdirectories. The generator’s final F4 override repairs only those five tasks; no subsequent override resolves the remaining cases.

| Task and location | Required persistence | Missing Allowed Path |
|---|---|---|
| T-018 — `TASKS.md:225` | DATA-47 vendor profile | `src/modules/vendor/schema.ts` |
| T-043 — `TASKS.md:502`; T-044 — `TASKS.md:513` | Persisted schedules/leave, then appointments and resource reservations | `src/modules/scheduling/schema.ts` |
| T-050 — `TASKS.md:581` | Credential model and credential-alert persistence | `src/modules/org/schema.ts` |
| T-071 — `TASKS.md:816` | Invoice and invoice-line foundation | `src/modules/cashier/schema.ts` |
| T-105 — `TASKS.md:1198` | Chart of accounts, posting rules, journals and periods | `src/modules/accounting/schema.ts` |

**Concrete failing scenario:** T-043 implements its revised acceptance requirement by adding schedules and leave to `src/modules/scheduling/schema.ts`. That edit violates its Allowed Paths. Putting the definitions in `scheduling/rosters/schema.ts` instead violates the module-root convention. T-044 has the same restriction, so it cannot supply the missing canonical schema either. Permission to write migrations or add an index re-export does not authorize either task to edit the source schema.

**Minimal fix:** Add the owning root schema paths to the affected persistence tasks in `scripts/gen-tasks.py` and regenerate `TASKS.md`. Apply the existing convention consistently to the already-declared table-changing tasks; no new feature scope or schema-layout redesign is needed.

**Gate:** Before the first affected persistence task, T-018, and before each subsequent affected builder. This is a specification/task-permission correction, not a demand for implementation now.

## F1–F9 Closure Table

“Closed” means the reviewed specification defect is repaired, not that the feature is implemented or tested.

| Finding | Status | Independent conclusion |
|---|---|---|
| **F1 — Posting-event contract** | **CLOSED** | The authoritative matrix uses TD-50 event names, separates eligible targets, suppresses companion postings, and identifies reversal ownership. TD-50 explicitly defers posting eligibility to that matrix. See `docs/spec/11-BILLING-PAYMENTS.md:103` and `docs/spec/18-INTEGRATION-CONTRACTS.md:152`. |
| **F2 — Balanced opening entries** | **CLOSED** | Liability imports debit opening equity and credit liability; receivable imports debit patient receivable and credit opening equity. Neither creates revenue, VAT or commission. T-128 explicitly owns import-to-journal reconciliation. See `docs/spec/11-BILLING-PAYMENTS.md:133` and `scripts/gen-tasks.py:628`. |
| **F3 — SET-44 default and bounds** | **CLOSED** | `month_end` is now an allowed value and the default; `day(1..28)` is the alternative. Monthly cadence remains fixed, and settings acceptance checks this. See `docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md:332` and `scripts/gen-tasks.py:630`. |
| **F4 — Canonical schema permissions** | **PARTIAL** | All five originally singled-out tasks are repaired, but the same contradiction remains in other declared persistence builders, including the revised roster and credential tasks. See the remaining finding. |
| **F5 — Roster versus booking acceptance** | **CLOSED** | T-043 now proves persisted roster/leave availability at module level. T-044 depends on it and explicitly completes the PR-48 scenario by requesting a slot for a doctor on leave. See `TASKS.md:506` and `TASKS.md:517`. The separate schema-permission problem remains under F4. |
| **F6 — Money acceptance handoffs** | **CLOSED** | T-074 uses the actual PR-15 scenario titles; T-078 limits its claim to module-level conversion/write-off behavior. T-094 depends on T-078 and owns the full WhatsApp-bill fallback, closure and next-visit assertions. T-087 explicitly completes owner write-off with commission-payment exclusion. See `TASKS.md:853`, `TASKS.md:897`, `TASKS.md:997` and `TASKS.md:1088`. |
| **F7 — Patient-list and staff UI builders** | **CLOSED** | T-041 explicitly builds the patient-list route, filters and persisted saved segments, with browser and cross-tenant assertions. T-031 builds staff/invitation/access segments and fixture-backed credential status; T-050 completes credential verification UI. These are builders, not work deferred to T-130’s sweep. See `TASKS.md:477`, `TASKS.md:368` and `TASKS.md:578`. Credential schema permission remains under F4. |
| **F8 — Coretax ownership/path** | **CLOSED** | TD-10 ownership, the `accounting/coretax` module path, task paths and final generator override agree. The dependency-rule reference now points to `03` §4. See `docs/spec/15-DEVOPS-CICD-MIGRATIONS.md:107`, `TASKS.md:1209` and `scripts/gen-tasks.py:659`. |
| **F9 — Exit titles and authority summaries** | **CLOSED** | T-086’s title and acceptance distinguish M4 domain behavior, M5 commission and M8 journals/scenario 20. PLAN’s suite heading agrees. The specification README identifies the repository pack as canonical and only retired staging copies as non-authoritative. See `TASKS.md:978`, `PLAN.md:59`, `docs/spec/README.md:5` and `scripts/gen-tasks.py:661`. |

## Posting Contract Checks

The following conclusions come from reading the normative rules together, not executing posting tests.

- **Exact events and performance ownership:** `TreatmentFinished` owns counted single-treatment performance; package executions exclude that posting and use `SessionRedeemed`. `OpeningImportApplied` agrees with TD-50. `ProductHandedOver` coordinates revenue and COGS, and cross-branch package performance uses one journal with clearing legs rather than a second revenue posting.
- **Settlement ownership:** `PaymentAllocated` is limited to line/package funding. Receivable collection, external top-up and booking-DP receipt have dedicated owners. Applying DP explicitly suppresses the related allocation’s DP-funded portion. Different companion event IDs therefore do not authorize duplicate economic postings.
- **Consultation recharge and VAT:** Settlement belongs to `PaymentAllocated`; performance belongs to `ConsultationFeeCharged`; `ConsultationFeeRecharged` only notifies. For a taxable Rp111,000 recharge under the documented tax assumptions, settlement can debit balance Rp111,000 and credit liability Rp100,000 plus VAT Rp11,000; performance then transfers Rp100,000 from liability to revenue without another VAT credit.
- **Delivery-first receivables:** Performance recognizes revenue/VAT first; receivable creation clears the negative paid-not-delivered liability. Collection—including balance-funded collection—credits the receivable without new revenue or VAT.
- **Expense versus GRNI payables:** `SupplierInvoiceRecorded` posts only goods/GRNI invoices. An unpaid expense’s linked expense-type invoice cannot create a second AP credit; `ExpenseRecorded` owns recognition and `SupplierPaymentAllocated` owns later settlement.
- **Reversals:** Domain reversals reference original journals and unreversed portions. `JournalReversed` is explicitly post-recording notification only. Delivered-product refund revenue belongs to `BalanceMoved`, while `ProductReturned` reverses COGS only.

The tax-adviser and accountant gates remain legitimate later evidence gates. Their pending status is not a finding in this pre-development review.

## Review Boundary and Start Gate

I read the prior review and closure summary as evidence, then inspected the actual normative files, all of `TASKS.md`, and the generator through its final overrides and output-writing logic. Relevant PRD scenarios, data definitions, technical ownership and screen contracts were also checked.

I did **not** edit files, implement features, execute commands, run tests, reproduce generator output, or independently verify the summary’s reported checks. I make no claim about independently verified upstream model identity.

**Final disposition:** T-001 remains safe to start separately. The follow-up specification fixes as a whole require the remaining F4 permission correction before they can be approved as fully closed.