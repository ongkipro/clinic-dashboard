# Independent Closure Review

**Verdict: APPROVE for starting T-001 only.**

No P1 issue or blocker specific to T-001 was found. The bootstrap task has sufficient scope to start without implementing later features or choosing a real payment partner.

The round-7 fixes are **not fully closed: 9 CLOSED, 9 PARTIAL, 0 OPEN**. Remaining issues must be fixed before their owning tasks, particularly the posting-event contract, schema permissions, and incomplete acceptance/UI ownership.

This is a read-only specification review. I inspected the requested documents, the task generator—including its subsequent overrides—and relevant cross-references. I did not edit files, execute the generator, run commands or tests, or independently reproduce the validation claims in the summary. “CLOSED” means corrected as a specification, not implemented or runtime-verified.

Model provenance: I cannot verify or switch this session to the requested **GPT-6 Astra high**, so this report does not claim that model identity.

## Remaining Findings

### F1 — P2: Posting events still do not form one unambiguous, executable contract

**Locations:** `docs/spec/11-BILLING-PAYMENTS.md:101`, `docs/spec/11-BILLING-PAYMENTS.md:87`, `docs/spec/18-INTEGRATION-CONTRACTS.md:162`, `docs/spec/18-INTEGRATION-CONTRACTS.md:179`, `docs/spec/18-INTEGRATION-CONTRACTS.md:187`.

The new canonical-trigger paragraph improves the intent but leaves several concrete conflicts:

| Conflict | Failing concrete scenario |
|---|---|
| Single-treatment performance uses `TreatmentOutcomeCounted`, absent from TD-50; TD-50 still declares `TreatmentFinished(outcome)` with posting consumers. | A counted single treatment emits the documented TD-50 event, but a posting engine subscribing to the new canonical name recognizes no revenue. |
| The same sentence says `SessionRedeemed` does not post on its own and that package sessions post through `SessionRedeemed` only. | Package redemption cannot be implemented from one consistent trigger/eligibility rule. |
| `PaymentAllocated` owns “settlement rows,” while `ReceivableCollected`, balance events and booking-deposit events also remain posting events without an explicit exclusion matrix. | Collecting one receivable produces both an allocation and a collection event; event-level deduplication does not prevent two postings for the collection. |
| Consultation recharge owns both settlement and performance through `ConsultationFeeRecharged`, but settlement is also assigned generally to `PaymentAllocated`. Only a second `ConsultationFeeCharged` posting is explicitly suppressed. | A taxable Rp111,000 recharge follows the normal line-settlement path and emits recharge: both handlers can debit balance and credit liability for the same fee. |
| TD-50’s `OpeningImportApplied` row still points to an `OpeningBalanceImported` trigger that the billing document does not use. | Import producer and posting consumer implement different event names. |
| Expense/supplier invoice eligibility and reversal ownership remain unspecified. | An unpaid Rp100,000 expense creates its required supplier invoice: `ExpenseRecorded` credits AP, while the unrestricted supplier-invoice rule credits AP again. Likewise, both a domain reversal and `JournalReversed` can mirror the same original unless one is explicitly non-posting. |

**Minimal fix:** Replace the prose list with the requested authoritative matrix: exact TD-50 event name, eligibility predicate, journal legs, non-posting companions, and reversal owner/reference. Explicitly exclude expense-type invoices from purchase/GRNI posting. Specify whether `JournalReversed` is a command-driving event or a notification of an already-posted reversal. Preserve the coordinated product revenue/COGS and cross-branch package journals.

**Gate:** Fix before the affected event-producing tasks and T-070’s expected-posting fixtures; certainly before T-105. Not a T-001 blocker.

### F2 — P2: Opening receivables lack a complete balanced posting

**Location:** `docs/spec/11-BILLING-PAYMENTS.md:101`.

The new opening-import rule reads: “Dr Opening balance equity / Cr the imported liability or Dr receivable.” The liability alternative is balanced; the receivable alternative never identifies its credit counterpart.

**Failing scenario:** Import a Rp150,000 opening receivable. A literal implementation either produces two debits or leaves the credit unspecified, violating the balanced-journal invariant.

**Minimal fix:** State the two alternatives separately:

- Opening liability: Dr Opening balance equity / Cr relevant liability.
- Opening receivable: Dr Patient receivable / Cr Opening balance equity.

Keep both free of new revenue, VAT and commission; assign the import-to-posting reconciliation assertion to T-128.

**Gate:** Before T-105 defines opening posting rules and T-128 integrates imports.

### F3 — P2: SET-44’s replacement default is outside its own bounds

**Locations:** `docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md:332`, `docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md:349`.

Fortnightly commission batches were correctly removed. However, the replacement default is **“Akhir bulan”**, while the allowed values are only **dates 1–28**.

**Failing scenario:** T-017 initializes or restores the approved default in January. Month-end is the 31st, which cannot satisfy the declared value bounds.

**Minimal fix:** Define the value type as `month_end | day(1..28)`, retaining `month_end` as the default. Keep the monthly cadence fixed.

**Gate:** Before T-017. This is a new inconsistency introduced by the fix.

### F4 — P2: Migration permission was added without consistently permitting the canonical schema files

**Locations:** `docs/spec/15-DEVOPS-CICD-MIGRATIONS.md:89`, `TASKS.md:374`, `TASKS.md:425`, `TASKS.md:491`, `TASKS.md:970`, `scripts/gen-tasks.py:610`.

The convention requires each module’s schema at `src/modules/<module>/schema.ts`. Several repaired tasks still permit only a nested implementation directory:

| Task | Persistence responsibility | Missing permission under the declared convention |
|---|---|---|
| T-031 | `duty_assignments` | `src/modules/org/schema.ts` |
| T-036 | Rooms/devices and branch-master persistence | `src/modules/org/schema.ts` |
| T-042 | Reversible merge records | `src/modules/patients/schema.ts` |
| T-085 | `cash_shifts` | `src/modules/cashier/schema.ts` |

The schema-index standing exception grants a re-export line, not permission to modify these schemas. T-027 explicitly permits `vendor/checklist/schema.ts`, which also needs reconciliation with the root-module convention.

**Failing scenario:** T-031 adds `duty_assignments` in its TD-1 owning schema. The required edit is outside Allowed Paths; placing it under `org/access/schema.ts` instead follows an undocumented alternative convention.

**Minimal fix:** Either add each owning root schema to the task and generator, or explicitly permit submodule schemas with a defined module export convention. Do not treat `drizzle/**` as permission to edit unrelated source schemas.

**Gate:** Before the first affected schema task. T-002’s explicitly named foundation schemas are correctly permitted.

### F5 — P2: T-043 still requires the booking engine before T-044 builds it

**Locations:** `TASKS.md:507`, `TASKS.md:510`, `docs/spec/02-PRD.md:544`.

T-043 still requires the full **PR-48 roster** scenario. That scenario requests a booking slot for a doctor on leave and expects no slot. T-044, dependent on T-043, builds slot selection.

**Failing scenario:** Completing T-043 from its dependency closure provides schedules and leave but no booking engine through which to execute the required slot request.

**Minimal fix:** Make T-043 prove persisted roster/leave availability at module level; explicitly add the complete PR-48 slot scenario to T-044. Update the generator, not only generated TASKS.

**Gate:** Before T-043. Most other R7-10 splits were repaired correctly.

### F6 — P2: Money acceptance handoffs still leave an unowned completion and a premature full claim

**Locations:** `TASKS.md:853`, `TASKS.md:897`, `TASKS.md:1086`, `TASKS.md:1088`, `docs/spec/02-PRD.md:499`, `scripts/gen-tasks.py:590`, `scripts/gen-tasks.py:598`.

Two problems remain:

| Problem | Failing concrete scenario | Minimal fix |
|---|---|---|
| T-074 delegates the WhatsApp-bill portion to “the reminders task,” but T-095 owns appointment confirmations only and has no receivable dependency. | An unpaid addition reaches the required WhatsApp-bill fallback. Appointment-reminder tests pass, but no later task proves sending the bill and then permitting receivable conversion. | Assign the complete bill-fallback flow explicitly to a messaging task, add T-078 to its dependency closure, and name the full PR-15 receivable scenario there. |
| T-078 claims the full new **PR-37 owner write-off** scenario, whose final assertion is “no commission is paid,” while commission is built in T-087. | T-078 can prove the write-off and audit but cannot exercise commission exclusion. An assertion over nonexistent commission machinery passes vacuously. | Label T-078’s portion explicitly and require T-087 to complete the exact owner-write-off scenario, not merely money scenario 14. |

Additionally, **“PR-15 additional payment”** and **“PR-15 receivable fallback”** are not the actual §8 scenario titles. Use the existing titles or explicitly identify them as module-level assertions.

**Gate:** Before T-074/T-078; complete the messaging integration at its designated M6 owner.

### F7 — P2: UX-60 and UX-13 now have builders, but the complete page inventory still does not

**Locations:** `docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md:77`, `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md:40`, `TASKS.md:437`, `TASKS.md:470`, `TASKS.md:374`, `TASKS.md:1467`, `scripts/gen-tasks.py:616`.

The added role-home builder and Paket & Saldo route are real improvements. They do not close the broader “every page has an implementation owner” finding.

Concrete remaining examples:

- **Daftar Pasien:** T-037 permits `/pasien/baru/**`; T-040 permits `/pasien/[id]/**`; T-041 is search-backend work. None explicitly builds the required patient-list route with its filters and saved segments.
- **UX-3 Staf & Undangan:** T-031 owns the **Akses** segment; T-007 and T-050 provide identity/credential backends. No task explicitly owns the staff, invitation and credential-verification screen segments.

**Failing scenario:** T-130 visits the required patient list or staff invitations page. It can discover a missing page but cannot build it, and there is no unambiguous builder to which the defect can be returned.

**Minimal fix:** Assign these pages/segments to existing owning tasks with explicit route paths, full Visual Contracts and completion assertions. Retain T-130 as verification only.

**Gate:** Before the corresponding M0/M1 UI builders, not merely before T-130.

### F8 — P2: Coretax’s declared owner and executable task paths disagree

**Locations:** `docs/spec/15-DEVOPS-CICD-MIGRATIONS.md:107`, `TASKS.md:1209`, `scripts/gen-tasks.py:362`.

The corrected module map places Coretax in **TD-10 accounting**, explicitly at `accounting/coretax`. T-106 and its generator still allow only `src/modules/tax/coretax/**`, under the TD-7 tax module.

**Failing scenario:** Implementing Coretax at its declared owning location violates T-106’s Allowed Paths; implementing it within those paths violates the corrected ownership map.

**Minimal fix:** Change T-106 and the generator to the accounting-owned path, or consistently change the normative owner. Correct the dependency-rule cross-reference in `15` from `03` §2 to §4 while aligning these documents.

**Gate:** Before T-106.

### F9 — P3: Milestone and authority summaries still contradict the corrected detailed contracts

**Locations:** `TASKS.md:978`, `PLAN.md:59`, `docs/spec/README.md:5`.

- T-086’s title still claims scenarios **1–9, 11–20**, including 14 and 20, while its Done-when correctly defers them.
- PLAN’s money-suite heading still says **“must pass in M4/M5”**, although journal verification and scenario 20 now belong to M8.
- The canonical spec README calls **“this folder” a non-authoritative snapshot**, immediately before declaring it canonical.

**Failing scenario:** An exit reviewer following the heading requires scenario 20 before the ledger exists; an agent following the README’s status sentence discounts the actual normative documents.

**Minimal fix:** Align the titles with the corrected milestone split, update the generator’s T-086 title, and remove the retired staging-folder wording.

**Gate:** Before relying on those summaries for the relevant exit. These do not block T-001.

## R7 Closure Table

| Finding | Status | Current evidence |
|---|---|---|
| R7-01 | **CLOSED** | Goods receipt always credits GRNI; cash purchase explicitly combines receipt, invoice and payment, leaving GRNI/AP zero and one cash credit. `docs/spec/11-BILLING-PAYMENTS.md:91`, `docs/spec/11-BILLING-PAYMENTS.md:99`. |
| R7-02 | **PARTIAL** | Canonical-trigger intent, supplier credit application, coordinated journals and mirror reversals were added. Event names, eligibility and companion suppression remain inconsistent; opening receivable legs are incomplete. F1–F2. |
| R7-03 | **CLOSED** | The tax-point guard now applies to all tenders; balance-funded receivable collection explicitly creates neither revenue nor VAT. Recognition fields and immutable originating-line allocations are documented. `docs/spec/11-BILLING-PAYMENTS.md:63`, `docs/spec/11-BILLING-PAYMENTS.md:68`, `docs/spec/05-DATA-MODEL.md:134`, `docs/spec/05-DATA-MODEL.md:139`. |
| R7-04 | **CLOSED** | DP/package moves debit net liability plus reversed VAT and credit gross balance. The unsupported `vat_settled` alternative is disabled pending a specified, signed balanced alternative. T-077 requires gross-DP/reuse/refund fixtures. `docs/spec/11-BILLING-PAYMENTS.md:77`, `docs/spec/11-BILLING-PAYMENTS.md:82`, `docs/spec/11-BILLING-PAYMENTS.md:103`, `TASKS.md:886`. |
| R7-05 | **PARTIAL** | Recharge now creates a tax-snapshotted line, settles through liability and recognizes performance separately. Duplicate `ConsultationFeeCharged` posting is suppressed, but overlap with `PaymentAllocated` remains. F1. |
| R7-06 | **CLOSED** | One tender-account rule covers all targets; clearing roll-forward subtracts gross settlement, explicitly net bank proceeds plus fees. `docs/spec/11-BILLING-PAYMENTS.md:63`, `docs/spec/11-BILLING-PAYMENTS.md:115`. |
| R7-07 | **PARTIAL** | Monthly-only cadence restored; replacement month-end default is outside its bounds. F3. |
| R7-08 | **PARTIAL** | Scenario 12/16/19 package placement, scenario 15 refunds, commission portions and M8 journal separation are corrected. The WhatsApp-bill completion and residual exit wording remain defective. F6, F9. |
| R7-09 | **CLOSED** | T-073 no longer owns scenario 20. TD-43 and T-105 assign an offline synthetic ledger settlement; real-provider verification remains behind Q-14 and its later adapter task. `TASKS.md:842`, `TASKS.md:1202`. |
| R7-10 | **PARTIAL** | Patient/audit isolation, acting-role signing, catalog immutability, branch-price invoicing and no-show follow-ups have named completions. T-043 still requires booking before its builder. F5. |
| R7-11 | **CLOSED** | Package schedules now depend on packages; outbound on consent; aftercare on visits/signing. Dashboard read models are now T-107, reconciliation T-108 depends on them, and T-119 includes all six dashboard builders. `TASKS.md:944`, `TASKS.md:1228`, `TASKS.md:1349`. |
| R7-12 | **PARTIAL** | Consent withdrawal includes continued care sending; suspended aftercare completes at T-096; no-show follow-ups complete at T-093. Real refund/write-off scenarios exist, but money completion claims still need the explicit splits in F6. |
| R7-13 | **PARTIAL** | Listed persistence tasks now have migrations and appropriate risk levels; onboarding-checklist persistence is assigned. Canonical schema permissions remain incomplete. F4. |
| R7-14 | **PARTIAL** | UX-60 has T-107 and UX-13 has T-076, with paths and Visual Contracts. T-130 remains verification-only, but patient-list and complete staff-screen ownership are still missing. F7. |
| R7-15 | **CLOSED** | T-002–T-004 can introduce scripts/dependencies; T-003 can configure Vitest; T-002 can edit both foundation module schemas. `TASKS.md:53`, `TASKS.md:64`, `TASKS.md:75`, `scripts/gen-tasks.py:565`. |
| R7-16 | **CLOSED** | T-005 permits `src/proxy.ts`, requires wiring the resolver there and requires HTTP wrong-host negatives. `TASKS.md:86`, `TASKS.md:90`, `scripts/gen-tasks.py:571`. |
| R7-17 | **PARTIAL** | TD-to-folder ownership and dependency-direction prose are substantially aligned; foundation schemas are named. Coretax’s task/generator still contradict the corrected map. F8. |
| R7-18 | **CLOSED** | RG-03 uses the 365-day default and bounds; RG-05 allows reminder-only schedules; B-03 and decision history record the validity wording alignment. The historical “12 months” label describes the old source behavior, not the current rule. |

## Start Gate and Sequencing

| Area | Review conclusion |
|---|---|
| **Before T-001** | **No blocking change required.** Approve bootstrap only. |
| **T-001** | Its manifest, lockfile, configuration, CI and decision-document permissions support the stated bootstrap work. |
| **T-002–T-004** | The original dependency/script/schema-location restrictions are repaired. Their missing implementation is expected at this stage, not a defect. |
| **T-005** | Host enforcement now has an actual request-entry-point owner and HTTP acceptance requirements, rather than only a resolver unit test. |
| **Dependency graph** | By static inspection, the explicit dependencies remain backward-pointing after reordering. That does not cure missing scenario or builder ownership. |
| **Later gates** | Accountant/tax-adviser evidence, real-partner selection and real-provider verification remain valid later gates. They are not conditions for starting scaffold work. |

**Bottom line:** Start T-001. Do not mark round 7 wholly closed or treat this as approval of unrestricted downstream execution. The substantive repairs are real, but the remaining findings require targeted specification/task-generator changes before their owning tasks.