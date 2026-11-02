# Round 5 confirmation (gpt-6.1-sol, read only), 2026-11-02

## Pass 1

## Confirmation result

**NOT-READY** — several fixes are substantive, but unresolved financial contradictions, incomplete data contracts, and release/dependency inconsistencies still require implementation decisions before task generation.

Read-only verification completed using **only `read`**, stopping after **17 calls**. All three review files were read first, followed by targeted reads of the nine requested current files.

**Evidence paths below are relative to:**  
`/home/ongki/Documents/work/prd/clinic-dashboard/`

**Status interpretation:** FIXED means the original finding is resolved; PARTIAL means relevant fixes exist but material omissions or contradictions remain; OPEN means the original problem remains substantially unchanged. P3 findings are excluded as requested.

### A — Buildability

| Finding ID | Status | Evidence |
|---|---|---|
| **A-01 — Requirement coverage** | **FIXED** | `PLAN.md` now covers PR-1–PR-98; M0 explicitly includes PR-55 and PR-97’s register/evaluator. Its dependency paragraph explicitly places PR-40 outside the sequence in Phase 4. |
| **A-02 — R1 accounting, campaigns, Coretax** | **PARTIAL** | `PLAN.md` M6/M8 and `02-PRD.md` §5, PR-26/PR-98 now include campaigns, both accounting steps and Must Coretax XML in R1. However, `11-BILLING-PAYMENTS.md` **Exports** still calls Coretax XML **Should**, and BILL-30 still calls operational expenses **Should**. |
| **A-03 — Executable dependency graph** | **PARTIAL** | `PLAN.md` moves depots to M3, accounting/reconciliation together to M8, and explicitly slices complaints, appointment states and privacy. But `02-PRD.md` §7 still declares **PR-19 → PR-24 → PR-19**. Other unsliced forward prerequisites remain, e.g. PR-6/M1 → PR-20/M4 and PR-45/M2 → PR-15/M4. PR-97/M0 also retains dependencies on PR-24/PR-26. The PLAN’s shared-foundation paragraph does not reconcile the declared graph. |
| **A-04 — Reachable rollout acceptance** | **PARTIAL** | `02-PRD.md` §12 now requires all M0–M9 exits for the pilot. However, Phase 1 requires only **M0–M8** while its walkthrough covers **J1–J11**: J9 includes PR-59 and J11 includes public-site requirements assigned to **M9**. No reduced synthetic journey contract is provided. |
| **A-05 — Unified gate contract** | **PARTIAL** | `PLAN.md` G1 now permits task authoring across M0–M9, preserves Q-12’s named exceptions, and G2 includes Q-17. But PRD §12 still defines Phase-0 entry using completed prerequisites, versus PLAN G0’s “started”; it also retains the obsolete **“G3/M10”** reference. Synthetic deployment authorization is not explicitly unified in the gate matrix. |
| **A-06 — Import versus opening journals** | **FIXED** | `PLAN.md` schedules the posting engine in M8 before M9 import. `15-DEVOPS-CICD-MIGRATIONS.md` MIG-3 specifies audited opening sub-ledgers, posting-engine initialization, export withheld pending evidence, and a unique source-identity key preventing duplicate opening recognition. |
| **A-07 — Objective exits and oracle timing** | **PARTIAL** | `PLAN.md` now names PR/CLIN scenarios and separates M4 money scenarios from M5 scenario 10. However, §3 still says monetary figures are written **“with the first M4 task,”** contradicting the earlier requirement to complete the fixture document **before any M4 code task**. M8’s KPI expectations remain insufficiently specified for the incomplete PR-95 dictionary. |
| **A-08 — Defaults versus settings** | **FIXED** | `PLAN.md` CD-23–CD-27 now classify the adjustable policies as settings and reference canonical SET rows; CD-21 aligns the disposal thresholds with SET-43. SET-31 defines the complaint-response defaults. `02-PRD.md` PR-38 now covers SET-1–SET-49. |
| **A-09 — Self-contained agent handoff** | **PARTIAL** | `AGENTS-DRAFT.md` now includes `19` in its authoritative read order; PRD §14 consistently requires one primary PR. `15` §4 specifies repository-owned `pnpm docs:check`. But AGENTS’ test table still invokes **`~/dotfiles/.../check-traceability.py`**; `15` §3 still says **01–18**, and its agent read-order row still omits `19`. |

### F — Cross-document consistency

| Finding ID | Status | Evidence |
|---|---|---|
| **F-1 — Role tab ownership** | **FIXED** | `17-UX-FLOWS-SCREEN-CONTRACTS.md` removes the competing role table and delegates tab sets to `19` §2.18. `19` explicitly owns them and contains the corrected role destinations, including Marketing Promo in R1. |
| **F-2 — PR-88–PR-96 screen coverage** | **PARTIAL** | `17` inventory now maps all these PRs, and new contract rows cover Depot, Utang, financial segments, Insiden, Logbook, Akses and Privasi. However, UX-55’s binding contract still lacks automation scenarios and retains its old visibility; UX-13/14 contract bodies still omit beneficiary management and reminder-only instalment schedule behavior despite the new requirement mappings. |
| **F-3 — Queue-display privacy** | **FIXED** | `17`, **UX-6 additions**, now says **“never patient names (fixed rule)”**, matching `19` §2.2 and its fixed-rule list. |
| **F-4 — Saya versus settings/masters** | **PARTIAL** | `17` Navigation now correctly delegates Saya/Pengaturan to `19` and moves masters out of Saya. But its UX-2 inventory still names **“Saya › Klinik & Cabang”**, and UX-1’s contract still drills down to **“Aturan.”** |
| **F-5 — SET-48 orphan group** | **FIXED** | `19` §5 assigns SET-48 to **Klinis**, an existing settings page. |
| **F-6 — Purchasing settings permission** | **FIXED** | `07-IAM-RBAC-ABAC.md`, **Tenant/branch settings**, now grants Purchasing limited stock-setting access, consistent with SET-26. |
| **F-7 — Plan projection permissions** | **PARTIAL** | `07`, **Plan options & prices**, now grants nurse/therapist assigned-visit projections. But it still grants FO/cashier view while `19` §2.5 **Rencana Perawatan** omits FO from its roles. |
| **F-8 — Compliance-register capability** | **FIXED** | `07` now has a **Compliance register (PR-97)** row: Owner full, facility head clinical, Finance tax/accounting, Admin Pusat/Auditor read. This matches `19` §2.14. |
| **F-9 — Auditor approval destination** | **FIXED** | `19` §2.18 replaces Auditor’s Persetujuan tab with **Audit · Laporan · Log · Stok**; those destinations have corresponding read access. |
| **F-10 — Campaign actor** | **FIXED** | `17` UX-19 now names **Marketing**, matching `19` §2.11 and `07`. |
| **F-11 — Automation roles** | **PARTIAL** | `07` now grants Marketing automation-scenario drafts, and `17` UX-55’s inventory includes Marketing, facility head and manager. But its binding contract row still says **“Admin Pusat, CS (log)”** only. `19`’s role listing also does not explicitly distinguish Marketing draft access from direct changes; SET-19 lists Admin Pusat as changer. |

### C — Data and money

| Finding ID | Status | Evidence |
|---|---|---|
| **C-01 — Supplier payable lifecycle** | **PARTIAL** | `05-DATA-MODEL.md` DATA-64 adds invoices, matching, payments, allocations and credit applications. `11` BILL-34 adopts **receipt → GRNI → AP**, payment and credit-application postings. But the main posting table still credits **AP/Cash on goods receipt**, contradicting BILL-34 and the added GRNI row. Supplier outstanding roll-forward, reversal rules and dedicated replay/concurrency acceptance remain unspecified. |
| **C-02 — Family sharing ownership** | **PARTIAL** | PRD non-goals and `11` BILL-11 now permit opt-in sharing; BILL-11 preserves package-owner refunds/balance and single performance recognition. DATA-67 adds beneficiaries and treated-patient redemption links. Still missing: an explicit **sale-time sharing-policy snapshot**, beneficiary-specific clinical authorization, and atomic cross-beneficiary reservation acceptance. |
| **C-03 — Depot stock integrity** | **PARTIAL** | DATA-63 adds depots, non-negative holdings, transfers and source availability; BILL-35 preserves same-branch quantity/value with no revenue/expense. However, linked movement legs and the atomic transfer/conservation contract are not defined. The PR-89 scenario tests only a successful 10→6/4 transfer, not concurrent depletion or replay. |
| **C-04 — Compliance evidence and gates** | **PARTIAL** | DATA-71 now supplies evidence records, file checksums/versions, approvals, feature-gate requirements, server-side evaluation and gate closure on expiry/revocation. But approval is not explicitly bound to an **immutable evidence version and applicable configuration/posting-map version**. Mixed platform/tenant tables are named without a concrete separation contract. |
| **C-05 — Optional instalment schedules** | **PARTIAL** | PR-20 and BILL-9 now clearly permit reminder-only schedules without debt or entitlement; DATA-67 adds versions, dated amounts and linked payments. It still lacks an explicit **exactly-one-target constraint**, schedule/row scope allocation, and cancellation/expiry rules for obsolete reminders. |
| **C-06 — Promo reservation lifecycle** | **PARTIAL** | DATA-68 and BILL-36 add code/version usage, atomic reservation/consumption/release and invoice-line linkage. But DATA-68 says **invoice line unique**, while BILL-36 says **unique per code-version/invoice-line**. Version immutability and quota treatment for partial refunds/cash refunds remain unspecified. |
| **C-07 — Expense records and settlement** | **PARTIAL** | DATA-69 adds branch/category/date/amount/funding/receipt/state/event fields; BILL-37 defines recognition and reversal. However, BILL-30 still labels expenses **Should**, and BILL-37 permits **unpaid/AP** funding without defining its later settlement/allocation lifecycle or preventing expense recognition twice. |
| **C-08 — Structured service master** | **FIXED** | DATA-62 adds bounded prep/treatment/buffer durations, resource and staff-eligibility relations, online-bookable state and separate clinical/material review references. It assigns tenant-shared scope and freezes the booking’s catalog version. |
| **C-09 — Sessions and duties** | **FIXED** | DATA-65 maps auth-provider sessions through a membership-scoped tenant view and limits revocation to that membership, preserving other tenants’ logins. It adds effective-dated duty assignments. DATA-60 supplies command audit attribution; IAM-16 supplies the ≤60-second enforcement contract. |
| **C-10 — Privacy workspace records** | **PARTIAL** | DATA-66 adds consent-text FKs, processors, breaches, awareness/deadline timestamps and notice evidence. `07` IAM-13 and `19` §2.14 provide duty-based access. Immutable consent-text/evidence versions and the breach/notice state-transition contract remain undefined; the generic `state` field is not that lifecycle. |
| **C-11 — Automation occurrence identity** | **PARTIAL** | DATA-44 now references B-24; DATA-70 adds scenario versions, occurrences, attempts, atomic patient caps and pre-send checks/cancellation. But its unique key **(scenario, patient, trigger fact)** does not distinguish multiple scheduled offsets for one trigger. The model needs an explicit occurrence/offset identity to support SET-19’s H+7/H+14/H+21 sequence without collision. |
| **C-12 — Report formulas and sources** | **PARTIAL** | Appendix A adds K20–K26; DATA-72 adds payment-shift links and pharmacy timestamps. However, **doctor activity** still lacks a canonical definition; K23 “sales per shift” is defined as **K1 cash**, not K3 sales; K20’s package/invoice denominator and K22’s relationship to K3 refunds/cancellations remain ambiguous. Metric version/window/refund semantics are not complete across PR-95. |

## New blockers noticed

1. **Circular pilot-readiness acceptance.**  
   `PLAN.md` M9 exits only when **Phase-2 entry criteria are all checked**; PRD §12 makes Phase-2 entry require **every M0–M9 exit**. M9 cannot be independently accepted as written. Define M9’s evidence checklist first, then make G2 consume that result.

2. **Cash-variance approval contradicts a fixed financial rule.**  
   `11` BILL-18 requires approval for **every non-zero cash variance**, explicitly with **no tolerance setting**. `19` SET-13 instead supplies an adjustable **Rp50,000 threshold**, and `17` UX-15 uses “above threshold.” Resolve which rule is authoritative and propagate it across all three.

## Minimal remaining fixes

1. **Reconcile the scheduling contract:** remove dependency cycles/unsliced forward prerequisites; make Phase-1 journeys achievable; eliminate M9/G2 recursion and stale M10 references.
2. **Finish the financial consistency pass:** replace the old goods-receipt AP posting with GRNI, resolve cash-variance policy, remove stale Should labels, and define supplier/unpaid-expense settlement and reconciliation.
3. **Complete the transaction-critical data invariants:** version-bound evidence approval, snapshotted sharing authorization, atomic depot/beneficiary operations, exact schedule targets, promo uniqueness/refund policy, and multi-offset automation identity.
4. **Finish metric and acceptance contracts:** canonical PR-95 definitions, one unambiguous pre-M4 oracle preparation dependency, and the missing negative/replay/concurrency assertions.
5. **Remove stale duplicate instructions:** UX contract visibility/routes, FO plan access, AGENTS’ personal checker path, and `15`’s pack/read-order references.

**Final verdict: NOT-READY.** These are targeted specification repairs—not a reason to reduce the approved Release-1 scope or require expert opinions before planning.


## Pass 2 (after fixes)

Verified the requested items using **read only**. Paths below are relative to `/home/ongki/Documents/work/prd/clinic-dashboard/`. Remaining P3-level wording is treated as non-blocking.

| ID | Status | One-line evidence |
|---|---|---|
| **A-02** | **FIXED** | `11-BILLING-PAYMENTS.md` Exports now labels Coretax XML **Must**; BILL-30 no longer labels operational expenses Should, matching PLAN’s R1 scope. |
| **A-03** | **PARTIAL** | PR-19/PR-24 circularity and the cited booking/clinical/compliance dependencies are repaired, but unsliced forward prerequisites remain: PR-54 in M0 → PR-15/M4 and PR-79 in M4 → PR-25/M8 (`PLAN.md`, PRD §7). |
| **A-04** | **FIXED** | PRD §12 limits the M0–M8 demo walkthrough to J1–J8/J10 and explicitly moves J9/J11 to M9. |
| **A-05** | **FIXED** | PLAN gates and PRD §12 now distinguish prerequisites started at G0 versus completed before G2; the obsolete G3/M10 reference is removed. |
| **A-07** | **PARTIAL** | PLAN §3 consistently requires the money-oracle document before M4 code; M8’s KPI exit still relies on unresolved PR-95 definitions, notably sales per shift and refund treatment. |
| **A-09** | **FIXED** | `AGENTS-DRAFT.md` uses repository-owned `pnpm docs:check`; `15-DEVOPS-CICD-MIGRATIONS.md` includes the pack through `19` and adds `19` to agent read order. |
| **F-2** | **PARTIAL** | `17-UX-FLOWS-SCREEN-CONTRACTS.md` now covers automation and package beneficiaries/schedules, but UX-14 still lacks the receivable reminder-schedule behavior required by PR-96. |
| **F-4** | **FIXED** | UX-2 inventory now routes through Pengaturan, and UX-1’s binding contract replaces Aturan with Pengaturan Uang and its canonical destination. |
| **F-7** | **FIXED** | `19-NAVIGATION-PAGE-CATALOGUE.md` Rencana Perawatan explicitly includes FO/cashier, nurse and therapist projection access. |
| **F-11** | **FIXED** | UX-55’s binding contract and `19` §2.11 consistently distinguish Admin Pusat changes, Marketing drafts, clinical aftercare review, manager proposals and CS log access. |
| **C-01** | **FIXED** | BILL-34 defines supplier roll-forward, reversals and allocation integrity; the posting map now uses GRNI for invoiced purchasing, with an explicit direct-cash exception. |
| **C-02** | **FIXED** | DATA-67 adds sale-time sharing snapshots, beneficiary-specific clinical checks and package-row locking; PRD acceptance tests concurrent beneficiary reservations. |
| **C-03** | **FIXED** | DATA-63 defines linked movement legs, atomic posting, source locking, replay safety and quantity/value conservation; PRD adds concurrent-transfer acceptance. |
| **C-04** | **FIXED** | DATA-71 binds approvals to evidence/configuration versions, reopens gates on changes and explicitly separates platform versus tenant access. |
| **C-05** | **FIXED** | DATA-67 adds an exactly-one-target CHECK and automatic reminder cancellation when the target closes, expires or becomes fully paid; schedules remain non-posting. |
| **C-06** | **PARTIAL** | BILL-36 fixes uniqueness and version immutability, but still says “released on … refund to balance” before saying partial refunds keep usage consumed—conflicting quota outcomes for partial balance refunds. |
| **C-07** | **PARTIAL** | BILL-37 specifies AP settlement without double expense recognition, but DATA-64 allocations target supplier invoices only; DATA-69/BILL-37 do not define how an unpaid expense becomes an allocatable payable. |
| **C-10** | **FIXED** | DATA-66 now defines immutable referenced consent texts, audited breach-state transitions and immutable notice evidence with checksums. |
| **C-11** | **FIXED** | DATA-70’s occurrence uniqueness includes scenario version and offset step, distinguishing multiple offsets from one trigger fact. |
| **C-12** | **PARTIAL** | Appendix A adds K27, but K23 remains **cash received** rather than required **sales per shift**; K20/K22 assume refund-net K3 while K3 itself specifies only cancellation reductions. |
| **M9/G2 circularity** | **FIXED** | PLAN gives M9 an independent evidence checklist and says G2 consumes it; PRD §12 references that checklist rather than making M9 depend on G2. |
| **Cash variance: BILL-18 / SET-13** | **FIXED** | BILL-18 retains approval for every non-zero variance; SET-13 now controls additional Owner escalation, and UX-15 explicitly applies both rules. |

## Verdict: **NOT-READY**

The two previously new blockers are resolved. Remaining material repairs concern the dependency order, receivable-schedule screen contract, promo refund/quota rule, unpaid-expense payable linkage, and PR-95 metric consistency. These require specification decisions before implementation tasks can have unambiguous dependencies and acceptance criteria.


## Main agent follow-up

Remaining PARTIAL items closed: dependency slices for PR-54 and PR-79; K3 refund rule and K23 sales+cash per shift; BILL-36 quota release only on full-line refund; unpaid expense creates one payable document (DATA-64/69, BILL-37); UX-14 receivable reminder schedule. TASKS.md written: 129 tasks, check-traceability PASS (651 declarations, 0 findings), dependency order verified.
