# Review 1: Business rules and money correctness, Clinic Dashboard planning kit

- **Reviewed:** every `.md` file in `/home/ongki/Documents/work/prd/clinic-dashboard/`. The money-relevant files were read in full: 01, 02, 03, 05, 06, 07, 09, 11, 13, 17, PLAN, README and AGENTS-DRAFT. The remaining files were checked by targeted search.
- **Sources:** `DECISION-REGISTER.md` (authoritative), `SESSION-HANDOFF-2026-10-30.md` §§3–4 and 8, `OPERATIONAL-SCENARIO-AUDIT.md`. Also used: `COMPLIANCE-TAX-ACCOUNTING-SATUSEHAT-PSE-RESEARCH.md` §§2–3 and `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` §6.3, the origin of the posting map draft.
- **Method:** I traced each DECIDED / ADOPTED-REC rule to PR-*, BILL-*, CD-*, DATA-* and the role matrix. I walked the 11 scenarios in PLAN §3 through BILL-1–BILL-16, the posting map and the roll-forwards in `11`. I checked role and entity consistency across 02, 07, 17 and 05.
- **Severity:** P1 blocks approval · P2 should fix · P3 nit.

## What is already right

- Package rules (B-03) are correct and consistent across PR-20, BILL-7 to BILL-11, CD-03/04/05/11, DATA-15 and the integrity rules in `05` §4.
  - Session value: equal split or proportional to normal prices.
  - Unlock only when cumulative payment covers the session's full value.
  - Minimum DP = the greater of the first-session value and the optional per-package %.
  - Installments have no schedule, interest or late fee; validity 12 months from purchase.
  - On expiry or cancellation, paid-unused value moves to balance and the unpaid remainder is cancelled, never a receivable.
  - The PR-20 scenario (Rp5,000,000 / 5 sessions / Rp3,000,000 paid / 2 used → Rp1,000,000 to balance, Rp2,000,000 cancelled) and PLAN scenario 8 add up correctly.
- Balance never expires and has no breakage income (B-04, A-05): PR-21, BILL-12, the "Consequences" line in `11`, DATA-16.
- Additional treatment (B-01) is covered by PR-15, BILL-3, the additional-treatment flow in `03`, the UX-6 close guard and the UX state matrix: patient + clinician agreement, FO may let it start before payment, alerts, close guard, receivable fallback, no booking block. Two gaps are listed in finding 2-8.
- Interrupted treatment (B-06) is correct in BILL-14, DATA-19 and the UX-9 outcome picker, including the rule that performer commission is earned only when the session counts.
- Commission core (B-07) is correct in BILL-15: override replaces the default, % or fixed, % basis = allocated payment after discount and excluding tax, fixed requires the item fully paid, performer also requires counted completion, monthly approval, refund adjustment, rule snapshots, consultation commission default none. The PR-19 allocation scenario (Rp500,000 → Rp300,000 / Rp200,000) is correct.
- Tax: A-06/A-07 match PR-24, BILL-6, CD-13 and DATA-10/23. The PKP-switch scenario is sound. A-10 (forfeited DP) is correctly left OPEN in the posting map and Q-06.
- The posting map keeps packages, balance and booking DP as contract liabilities (A-04). Cancelled package remainders never become receivables.
- S-*, H-02 (a–c), H-04, W-01 to W-07, D-05 to D-12 and PD-01 are all represented, apart from the notes below.

---

## P1: blocks approval

### 1-1. Revenue timing for single treatments paid before execution is wrong or ambiguous
- **Where:** `11-BILLING-PAYMENTS.md`, posting map, row "Payment for single treatment or product (counted / handed over) → Cr Revenue (executing branch) + VAT". Also rows "Balance used → Revenue / settle invoice" and "Booking DP applied → Invoice settlement".
- **Problem:** B-01 / BILL-1 require the initial treatment to be paid before it starts, so payment and performance are always separate events. The map has one row that merges them ("payment … counted"). The other paths credit "Invoice settlement" or "settle invoice", which are not accounts.
  - Read literally, revenue is booked when payment arrives, contradicting the accrual principle in A-04 and research §3.2 ("recognised when service is provided").
  - B-06 / BILL-14 say a medical or clinic stop on a paid single treatment means a free reschedule or the payment moves to balance. If revenue was booked at payment, that reversal has no posting row.
  - The booking DP portion of an invoice and the balance-paid portion have no defined revenue credit.
- **Fix:** split the map into two families.
  - **Settlement events:** Dr Cash/Bank, balance liability, DP liability or receivable → Cr *Contract liability: paid, not yet delivered* (or a clearing account) per invoice line.
  - **Performance events:** session or treatment counted, product handed over → Dr that liability → Cr Revenue (executing branch) [+ VAT, see 1-2].
  - Add rows for "paid single treatment moved to balance (medical/clinic stop)" and "patient-stop counted".
  - Add the new liability to the PR-25 sub-ledger list and to the roll-forwards.

### 1-2. VAT has no posting on the package, balance, DP and receivable paths
- **Where:** `11` posting map (VAT appears only in the single-treatment row); `11` roll-forwards (no VAT roll-forward, although PR-25 lists a VAT sub-ledger); PR-24; BILL-6; Q-05.
- **Problem:** for a PKP tenant selling taxable items:
  - "Payment allocated to package", "Package session counted", "Balance used", "Booking DP applied" and "Invoice unpaid at close → Cr Revenue" never credit VAT payable. Taxable package sessions, balance-funded taxable sales and taxable additions left as receivables would carry no VAT.
  - Prepaid VAT timing is explicitly OPEN for the tax adviser (research §3.5 Q2; PRD Q-05). The map silently picks "never" rather than offering either option.
  - Mixed packages with exempt and taxable items are not handled. Research §2.4 says each allocated part keeps its item's tax category; BILL-7, DATA-15 and DATA-6 have no per-session tax snapshot.
  - The PR-24 scenario does not cover a package paid before the PKP effective date and redeemed after it.
- **Fix:**
  - Add "VAT payable" to every revenue-crediting row.
  - Add a parameterised VAT-timing rule (at payment received vs at delivery) with both posting variants, marked "pending tax adviser (Q-05)".
  - Snapshot the tax category per package session (DATA-15 / DATA-6).
  - Add a VAT roll-forward in `11` and a PKP-boundary package scenario to PLAN §3.

### 1-3. "Balance used" can double-count revenue when balance pays a package installment
- **Where:** `11` posting map, row "Balance used | Contract liability — patient balance | Revenue / settle invoice".
- **Problem:** handoff §3 / B-04 say balance can pay for packages and installments. If that payment credits Revenue, revenue is booked again when each session is counted ("Package session counted → Revenue"): a double count. The same happens if balance pays a single treatment not yet performed.
- **Fix:** route balance used for a package to Cr *Contract liability: packages*, and for an unperformed item to the liability from 1-1. Only performance events credit Revenue. Add a PLAN §3 scenario: "balance pays installment, then session redeemed; revenue counted once".

### 1-4. Value moved to balance has no balance entry, roll-forward line or posting
- **Where:** `05` DATA-16 entry types (top-up, use, from-expiry, from-cancel, DP-transfer, refund); `11` patient balance roll-forward ("+ top-ups + from expiry/cancel + DP moved − used − refunded"); `11` posting map.
- **Problem:** two DECIDED flows credit patient balance but are missing everywhere:
  - B-06: paid single treatment stopped for medical or clinic reasons and not continued → payment to balance.
  - B-03 / BILL-11: substitution where the replacement is cheaper → the difference goes to balance.

  Neither the balance ledger nor the roll-forward can reconcile without them (NFR-5 "zero unexplained drift").
- **Fix:** add entry types `from_interrupted_treatment` and `from_substitution`, matching roll-forward terms, and posting rows (liability → balance liability, or revenue reversal if 1-1 is not adopted). Add a substitution row to the package roll-forward.

### 1-5. Commission is undefined, and likely double-paid, when paid value moves to balance and is spent again
- **Where:** BILL-15, PR-23, PLAN §3 scenarios 7, 8 and 10. Rule gap in the sources.
- **Problem:** commission is earned on actual allocated payment (B-07), and "eligible spending" from balance creates commission (handoff §4: "Deposit top-up alone does not create service/product commission; eligible spending does").
  - Rp3,000,000 paid on a package already earned closing/guiding commission. At expiry Rp1,000,000 moves to balance (B-03); when the patient spends it on a new package or treatment, commission is earned again on the same rupiah.
  - The same applies to pre-expiry cancellation to balance, interrupted single treatments moved to balance (B-06), and the cheaper-substitution difference.
  - The sources only define adjustments for *refunds*. Whether "moved to balance" counts as a refund is not decided, so scenarios 7 and 8 have no defined commission outcome.
- **Fix:** take this to the owner for a decision. Recommended rule: moving paid value to balance reverses or adjusts the sales commission on the unused part, exactly like a refund (unpaid → reduced; paid → deduction next month). Spending the balance later then earns commission normally. Record the decision in the register, then in BILL-15 and PR-23, and add the expected commission figures to scenarios 7, 8 and 10.

### 1-6. Branch price override (B-08, DECIDED) is missing from the whole kit
- **Where:** PRD (PR-2, PR-19, PR-38), `05` (no price-override entity; DATA-6 snapshot), `11` BILL-7, `17` UX-12. A search for "price override" or "branch price" finds nothing.
- **Problem:** B-08 / handoff §8: "Treatment/product master and prices are shared across branches; owner may set branch-specific price overrides." The capability is absent. That leaves undefined which "normal prices" set mixed-package session value (BILL-7), and which price applies to a cross-branch substitution or addition.
- **Fix:**
  - Add a PR line: "Owner sets branch price overrides on the shared master; invoices snapshot the branch-effective price."
  - Add `branch_price_overrides` (or versioned catalog price per branch) to `05`.
  - In BILL-7, state that session value uses the selling branch's effective normal prices at sale time.
  - Add an override field to UX catalog/branch settings, owner only.

### 1-7. PLAN adds tenant settings beyond the closed list (B-09, DECIDED)
- **Where:** `PLAN.md` §4: CD-10 idle lock "S (60–900)", CD-21 disposal approvals "S", CD-22 stock counts "S", CD-27 outbound budget "S (bounded)". Also `07` IAM-7 ("branch setting idle time") and `11` BILL-18 ("approval above tolerance", an implied tolerance setting).
- **Problem:** PLAN defines S as "only the PR-38 list". B-09 and handoff §8 say "Do not add further settings at launch". PR-38 does not list these items, so the kit contradicts itself and a DECIDED rule.
- **Fix:** reclassify CD-10, CD-21, CD-22 and CD-27 as F (fixed product default) or D (versioned data), and drop "branch setting" from IAM-7. Fix the BILL-18 tolerance as a constant. Otherwise get an explicit owner decision to extend B-09 and add them to PR-38.

---

## P2: should fix

### 2-1. Cross-branch package: B-08 ("sales revenue at A") vs A-04 ("revenue at executing branch") is resolved silently
- **Where:** `11` BILL-16; PLAN §3 scenario 11; `05` DATA-1.
- **Problem:**
  - BILL-16 turns the DECIDED "sales revenue recorded at A" into "sale KPI at A", with revenue at B. This follows the ADOPTED-REC rule A-04 (pending accountant) and research §6.3, but the conflict inside the register is not recorded as a decision.
  - BILL-16 omits the confirmed clause that guiding/closing BC commissions go to the entitled BCs regardless of branch.
  - DATA-1 makes packages tenant-wide with `tenant_id` only, so the selling branch needed for "sale at A" has no field.
  - BILL-16 is labelled "Decision", although its revenue part is ADOPTED-REC pending accountant.
- **Fix:**
  - Add a note to BILL-16 and to Q-06: "Sales (KPI, closing commission) at selling branch A; revenue recognised at executing branch B per A-04; pending accountant."
  - Add the BC-regardless-of-branch clause.
  - Add `sold_branch_id` to packages (and invoices) in DATA-15.
  - Say which branch carries the closing-BC commission expense.

### 2-2. The PR-25 roll-forward scenario contradicts the posting map
- **Where:** `02` §8, scenario "PR-25 liability roll-forward" ("opening + sold − redeemed − moved − refunded").
- **Problem:** the liability grows with *paid allocations*, not with *sold* value (`11` roll-forward; BILL-10: the unpaid remainder is never debt or liability). Using "sold" would put unpaid installment value in the liability.
- **Fix:** change the scenario to "opening + paid allocations − counted sessions − moved to balance − refunded = closing".

### 2-3. Session redemption happens at two different moments
- **Where:** `17` UX-13 primary action "Pakai sesi" and the state-matrix row "Redeem session: Cashier, front office … Paid value insufficient"; `03` §5 step 6 ("package session redeemed if counted").
- **Problem:** the UX redeems at the counter before treatment; the technical design redeems at the counted outcome. Redeeming at the counter breaks B-06 (a medical or clinic stop must not use the session) and the audit S5 guard ("neither check-in nor timer expiry silently uses a full session").
- **Fix:** make the UX action "Reserve session" (unlock check + hold) and record redemption only on a counted outcome (TD-5/TD-7). Rename the UX-13 action and the state-matrix row.

### 2-4. Refund destination and posting for single treatments and products are undefined
- **Where:** `11` posting map (only "Refund (cash exception)"); PLAN §3 scenarios 4 and 9; BILL-4.
- **Problem:** the sources define refunds as a cash exception for balance (B-04) and packages (B-03). B-02 implies purchases can be "fully refunded", but nothing says whether a product or treatment refund goes to balance or cash, so scenario 9 has no expected result. The waived consultation fee re-charged from a refund (BILL-4) has no posting row (Dr refund liability/balance → Cr consultation revenue).
- **Fix:** ask the owner to confirm (recommended: refund to balance by default; cash only as an approved exception, matching B-04). Then add posting rows "refund to balance" and "consultation fee re-charged on refund", and expected figures for scenarios 4 and 9.

### 2-5. Confirmed commission rules missing from BILL-15 / PR-23
- **Where:** `11` BILL-15; `02` PR-23; `05` DATA-14 and DATA-21.
- **Missing from handoff §4:**
  - "Deposit top-up alone does not create commission; eligible spending does."
  - Guiding-BC scope: all transactions under the care plan until it is completed or replaced by the doctor. Owner/manager reassignment is recorded and applies to subsequent transactions; `05` has no reassignment history.
  - "No commission is paid for written-off items" (handoff §3).
  - Performer = the staff member who actually performed, not the scheduled one.
  - The owner's discretionary bonus is separate from regular commission.
  - New-patient commission scope is undefined in the sources too: first-visit transactions only, or all of them? This is a rule gap for the owner.
- **Fix:** add these as BILL-15 sub-clauses, add a guiding-BC assignment history table to DATA-21, and raise the new-patient scope as an owner question.

### 2-6. Commission export for the tax adviser (A-09, ADOPTED-REC) is missing
- **Where:** `02` PR-25 (exports = CSV journal + Coretax XML only); PR-23; `11` "Exports".
- **Fix:** add "Commission and fee export per recipient and period for the clinic's PPh 21/23 adviser (A-09)" to PR-23 or PR-25 and to `11` Exports.

### 2-7. The A-02 gate is placed after the build instead of before it; step 1 exports journals
- **Where:** `PLAN.md` §1 M10 (exit check "Accountant sign-off"); `02` PR-25 ("CSV journal" in step 1).
- **Problem:** A-02 makes accountant review of the posting map the gate *between* step 1 and step 2, but PLAN builds the posting engine first and asks for sign-off at the end. PR-25 also exports a "CSV journal" in step 1, which means postings exist before the map is approved.
- **Fix:**
  - Make "posting map signed by accountant (Q-06)" an M10 entry criterion.
  - Either limit the step 1 export to sub-ledger/transaction CSV, or label step 1 journals "draft, unapproved map".

### 2-8. Additional-treatment records are missing confirmed fields
- **Where:** `02` PR-15; `11` BILL-3; `05` (no additions/exception entity); `17` state matrix ("Recorded confirmation").
- **Problem:** the handoff requires recording who confirmed the exception *and who is responsible for collecting the outstanding balance*. It also says no manager approval and no unpaid-amount limit. None of this is stated, and `05` has no entity for the addition (clinical authoriser, patient agreement, FO confirmer, accountable collector).
- **Fix:**
  - Add the fields to PR-15 / BILL-3.
  - Add an `additional_treatments` (or selection-version) entity to `05`.
  - State "no amount limit; no manager approval" so nobody builds one.

### 2-9. Receivable conversion and visit closure don't line up
- **Where:** `05` §4 ("no open invoice balance unless converted to receivable"); `17` UX-6 ("enabled only when no unpaid bill"); PR-15.
- **Problem:** UX-6 blocks closure with any unpaid amount, `05` allows closure after conversion, and nothing says who converts an unpaid amount into a receivable or when (only after the WhatsApp-bill fallback?).
- **Fix:** state in PR-15 / BILL-3: "FO converts the unpaid remainder to a patient receivable after the fallback; conversion settles the visit bill; then closure is allowed." Mirror this in the UX-6 contract.

### 2-10. Write-off and refund approvals go beyond the decision and can deadlock
- **Where:** `07` role matrix row "Refund exception / write-off approval: Manager ◐ (setting)"; `02` PR-37 (requester ≠ approver for write-off).
- **Problem:**
  - The B-09 setting covers *cash refund* approvers only. The handoff says "Owner may write it off", so manager write-off is invented.
  - With the owner as the only write-off approver plus maker-checker, an owner can never write off a receivable on their own initiative.
  - CD-08 defaults the refund approver to "Owner only", while B-03 and B-04 say "owner/manager". That default has no source.
- **Fix:**
  - Make write-off owner-only, with no setting.
  - Define maker-checker for write-off as "requested by FO/finance, approved by owner", and allow an owner-initiated write-off with a mandatory reason.
  - Mark the CD-08 default as a proposal or get owner confirmation.

### 2-11. One account per role (IAM-3) conflicts with multi-role staff and attribution
- **Where:** `07` IAM-3; `05` §4 commission uniqueness "(staff, contribution type, source item)".
- **Problem:** the handoff says one employee may hold several roles (without automatically getting all permissions) and earns each actual contribution once. Two accounts per person split one staff identity. The once-per-person guard and own-commission view then fail, or count twice.
- **Fix:** one staff identity with an owner-approved role set (union of capabilities, each audited). Commission keys on `staff_id`, not on the account.

### 2-12. Roles used in the kit are missing from the role matrix
- **Where:**
  - `02` PR-13 and its scenario ("records officer or facility head").
  - `07` IAM-6 and PLAN CD-20 ("Medical Director").
  - S-05 ("access by role set by facility head").
  - `02` PR-33 and `09` (a "CRM" dashboard role).
  - `06` branch scope (central CS's cross-branch scope, D-10, is not listed as an exception to "assigned branches").
- **Fix:**
  - Add Facility head / Medical Director and a Records officer (or map them to existing roles) to the `07` matrix, with correction-approval and access-setting capabilities.
  - Map "CRM" to Central CS.
  - Add "Central CS: tenant-wide booking and inbox, no clinical access" to `06`.

### 2-13. Entities used by screens and money rules are missing from `05`
- **Where:** `05` §3 against `17` and `11`.
- **Missing or not listed:**
  - shifts / cash drawers (UX-15, BILL-18, `09` `/shifts`)
  - refunds with pending/success/failed/unknown states (UX-14, `09` `/refunds`, audit S7)
  - receipts with per-branch monthly numbering (BILL-19)
  - purchase orders, goods receipts, suppliers / accounts payable (UX-11; posting row "Goods receipt → Accounts payable")
  - transfers and stock counts as entities (only mentioned in DATA-20 text)
  - package substitutions
  - payment-gateway transactions / webhook events (BILL-17)
  - booking DP amount per treatment (catalog field, B-05)
- **Also:** the ERD links `INVOICE ||--o{ PAYMENT_ALLOCATION`, but B-07 allocates to *items*. Commission and VAT need allocation per invoice line.
- **Fix:** add these DATA-* rows and change the ERD to `INVOICE_LINE ||--o{ PAYMENT_ALLOCATION`. If packages are not invoice lines, also add `PACKAGE ||--o{ PAYMENT_ALLOCATION`.

### 2-14. PR-22 is missing "refund on request" for clinic cancellations
- **Where:** `02` PR-22 (BILL-13 is correct).
- **Fix:** "… clinic cancellation → balance, or refund if the patient requests (B-05)."

### 2-15. Rule status labels overstate certainty
- **Where:** `11` BILL-6 and BILL-16 status "Decision"; posting map rows that rest on A-04.
- **Problem:** A-04, A-06 and A-07 are ADOPTED-REC, and A-04 is still pending accountant confirmation.
- **Fix:** label these "Adopted recommendation (pending accountant/tax adviser)".

### 2-16. The WhatsApp receivable bill may break W-05 / PR-31
- **Where:** `17` UX-14 ("send WA bill"); BILL-3; PR-31.
- **Problem:** the handoff fallback sends "bill details" by WhatsApp. W-05 / PR-31 forbid treatment detail in templates.
- **Fix:** define the WA bill content as amount + reference + clinic QRIS/bank account + authenticated link to the itemised bill, with no treatment names.

### 2-17. The scenario suite has gaps for the decided rules
- **Where:** `PLAN.md` §3.
- **Missing:**
  - doctor-approved substitution (higher and lower difference)
  - balance paying a package installment (1-3)
  - receivable written off (no commission)
  - product/treatment refund destination
  - a PKP-boundary package (1-2)
  - booking DP clinic cancellation with refund on request
  - payment success with lost app response / duplicate webhook (audit §4)
- **Fix:** add them as 3a–3g, each with expected ledger, balance and commission figures.

---

## P3: nits

1. **PR-14 says "refund effects".** The decided effect is "reschedule free or move payment to balance". Replace the wording (`02` PR-14).
2. **PR-15 scenario mixes alert triggers.** It fires the second alert on a close attempt; the handoff fires it "when the treatment is finished but still unpaid". Split into two scenarios.
3. **Unsourced defaults:** PR-30 "package expiry 30/14/7 days" and "control due 2 days away", PR-29 lead states, CD-27 "≤ 80%". These come from research marked PROPOSED, not the register. Mark them Proposal or get owner confirmation.
4. **UX-20 money row** applies the "30-day expiry slice" to paket + saldo + DP. Only packages expire (B-04: balance never expires). Restrict the slice to packages.
5. **Package unlock formula in `03`** ("sessions whose cumulative allocated value ≤ paid value minus redeemed") is ambiguous for mixed packages. Restate it as `redeemed_value + selected_session_value ≤ paid_value`, within the doctor's stage.
6. **Commission deduction larger than next month's commission:** carry-over is not decided. Add "carry forward until recovered" as an owner question.
7. **Naming drift:**
   - `03` TD-7 says `balance_ledger`, `05` says `balance_accounts/balance_entries`.
   - "Branch manager" (02) vs "Manager" (07/17).
   - Dashboard set "crm" (09) vs Central CS.
   - PR-8 calls the lateness rule a "branch setting", PR-38 calls it a "tenant setting".
8. **Capabilities without a decision:** pharmacist "product sale" (07) and finance "Commission rules ●" (07). The handoff puts product sale at the cashier and leaves commission rules to "authorized roles". Mark them Proposal.
9. **Missing register items (non-money):**
   - H-03: do not reuse the `99ribu-prod` Coolify instance.
   - W-08: display name format `Brand – Branch` (PR-27 only tracks the name).
   - Add both to `04` / PR-27.
10. **`11` Document Control** cites "B-01–B-07", but BILL-12 uses B-09 and BILL-16 uses B-08. Change to B-01–B-09.
11. **Research §2.4 "price includes or excludes VAT (clinic choice)"** is not in BILL-6 or DATA-23. Add it, or record it as deferred.

---

## Scenario walk-through (PLAN §3) against the stated rules and the `11` map

| # | Scenario | Result |
|---|---|---|
| 1 | Products only | OK (consultation fee waived; handed over after payment). VAT on taxable goods only if PKP: OK. |
| 2 | Prepay + treatment | **Gap 1-1:** revenue timing at payment vs at counted outcome is ambiguous. Commission: closing on payment, performer on counted: OK. |
| 3 | Addition unpaid → receivable | Receivable posting OK but no VAT (1-2). Collector field missing (2-8). Conversion/closure undefined (2-9). Write-off commission rule missing (2-5). |
| 4 | Consultation, refund re-charge | Rules OK. No posting for the re-charge (2-4). |
| 5 | Package redeem / locked sessions | Rules OK. Redemption moment conflict (2-3). VAT missing (1-2). |
| 6 | Booking DP ≥24 h / <24 h / no-show / clinic cancel | OK in BILL-13. PR-22 misses refund on request (2-14). Forfeit classification OPEN (A-10): correctly flagged. |
| 7 | Interrupted medical / clinic / patient | Package path OK. Single treatment moved to balance: no balance entry, roll-forward line or posting (1-4). Commission on value moved to balance undefined (1-5). |
| 8 | Expiry Rp5M/5/Rp3M/2 | Amounts and posting OK. Commission double-count risk (1-5). |
| 9 | Material return + refund | Refund destination undefined; only a cash-exception posting (2-4). |
| 10 | Guiding / closing / new patient / performer; refund after payout | Basis OK. New-patient scope, guiding reassignment and top-up rule missing (2-5). Multi-account identity issue (2-11). |
| 11 | Cross-branch package | Revenue/KPI split not recorded as a decision. BC-regardless-of-branch clause missing. No selling-branch field (2-1). Branch price override missing (1-6). |

---

## Verdict

**BLOCK: not ready to approve as written.**

The rules for packages, balance, booking DP, interrupted treatment and the commission core are carried over faithfully and agree across documents. What blocks approval is the money layer:

- The posting map is driven by payments instead of by delivered service, which mis-times revenue for prepaid single treatments and risks double-counting balance-funded package payments.
- VAT is missing from every prepaid and receivable path.
- Value moved to balance is not modelled, and its commission outcome is undefined (likely paid twice).
- A DECIDED rule (branch price override) is missing.
- PLAN adds settings that break the closed settings list in B-09.

Fixing P1 items 1-1 to 1-4 and 1-7 means editing `11`, `05` and PLAN. Items 1-5 and 1-6 need a short owner decision recorded in the register. After that and the P2 consistency fixes, the kit should be ready for the accountant and tax-adviser reviews in register §9.