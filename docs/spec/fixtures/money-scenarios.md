# Money fixture: PLAN §3 scenarios 1–20

| Field | Value |
|---|---|
| Task | T-070 (PR-19, R2), the first M4 task, written before any M4 code (PLAN §3, R3F-18) |
| Purpose | The expected ledger lines, VAT and commission for each money scenario, so that the accountant can review them while M4 is built. M4 tests assert the domain facts here (amounts, liabilities, balances, VAT recognised). M5 asserts the commission figures and M8 the journals. |
| Sources | `11-BILLING-PAYMENTS.md` (BILL rules, the posting map and the canonical posting-trigger matrix, roll-forwards); `DECISION-REGISTER.md` B-01–B-19, A-02–A-14; `02-PRD.md` §8 scenarios PR-12, PR-14, PR-15, PR-19–PR-24, PR-68, PR-83, PR-93; `docs/research/OPERATIONAL-SCENARIO-AUDIT.md` S1–S8 |
| Status | Signed off by the finance owner on 2026-11-12. The accountant's and the tax adviser's reviews are pending (see "Sign-off" at the end). Nothing in this document is a new product decision. Where the specification leaves a point open, the point is marked **PENDING** with the deciding party. |
| Checked by | The T-070 fixture-balance check (kept outside the repository, since the task's allowed path is this file alone; see `docs/tasks/T-070.md`). It checks that every journal balances (debits = credits), every account is a declared account, every journal row is well formed and every scenario 1–20 is present. |

## Fixture parameters (illustrative, not decisions)

These values exist only so that each scenario has concrete numbers. They are not defaults and not settings, and they do not stand in for the clinic's own configuration (B-09).

- **Tenant:** one PT, branches A and B, not PKP unless the scenario says so. When a scenario is PKP, the PKP date is 2026-07-01 and the tax-advice evidence (Q-05) is recorded, so VAT is enabled (BILL-6, PR-24).
- **Tax categories:**
  - Treatments: `exempt_medical`.
  - Products: `taxable_goods`.
  - The non-medical facial used in scenarios 16 and 19: `taxable_service`.
  - Consultation: `exempt_medical`.
  - The clinic and its tax adviser choose the real categories (A-06).
- **VAT on a VAT-inclusive consumer price P (BILL-6):** VAT = 12 % × DPP, where DPP = 11/12 × base. So VAT = 11 % × base and P = 1.11 × base.
  - Fixture prices are multiples of 111, so the result is exact: base = P ÷ 1.11 and VAT = P − base.
  - **PENDING (tax adviser, Q-05; accountant, A-02):** the rounding rule for prices that are not multiples of 111.
- **Commission rule set** (B-07; the tenant configures the real one):

  | Contribution | Rule |
  |---|---|
  | Closing BC | 5 % of the allocated payment |
  | Guiding BC | 2 % of the allocated payment |
  | New-patient registrar | 1 % of first-visit allocated payment (B-12) |
  | Performer | Rp50,000 fixed per counted treatment or session. Fixed requires the item fully paid **and** a counted outcome (BILL-15). |
  | Consultation commission | None (the default) |

  The % basis is the allocated payment after discount, excluding tax (BILL-15).
- **Contributors in each scenario** (so the commission figures can be checked):
  - Every sale has a closing BC.
  - A guiding BC is assigned, under an active care plan, only in scenarios 2, 5, 8, 10 and 11. No other scenario has one.
  - A new-patient registrar earns only in scenarios 1, 2 and 10, the first visits (B-12).
  - Every counted treatment or session has a performer.
- **Consultation.** Only scenario 4 involves a consultation fee. The other scenarios are visits with a qualifying purchase (fee waived) or package or control visits (no fee). So a refund re-charges a fee only in 4c.
- **Moving-average costs (A-13):** serum Rp150,000 a unit, sunscreen Rp90,000 a unit. Treatment materials are given per scenario.
- **Payment methods:** cash goes to **Cash (shift)**; transfer to **Bank**; QRIS, EDC and payment link to **Gateway clearing** (the tender rule in `11`).

## Accounts

The checker accepts only these names. The bracket gives the branch where the posting map assigns one.

- Cash (shift)
- Bank
- Gateway clearing
- Contract liability — paid not delivered
- Contract liability — packages
- Contract liability — patient balance
- Contract liability — booking DP
- VAT payable
- Patient receivable
- Revenue — treatment
- Revenue — product
- Revenue — consultation
- Other income
- Cost of goods sold
- Materials cost
- Waste expense
- Inventory
- Bad-debt expense
- Merchant fee expense
- Inter-branch clearing
- Commission expense
- Commission payable
- Staff receivable

## Format

Each scenario has three parts:
1. **Facts:** what happens, with amounts.
2. **Journals:** what the posting map produces. Each journal has an id (`S<n>-J<k>`) and its owning TD-50 event; its rows list the account, debit and credit in rupiah. The M4 tests assert the same amounts as domain facts (liability, receivable and balance movements, VAT recognised); the journals themselves post in M8 (PR-26).
3. **VAT and commission:** the expected figures, and what is **not** expected (no double count).

---

## Scenario 1 — New patient buys products only

**Facts.** New patient, branch A. A serum at Rp333,000 and a sunscreen at Rp222,000 are paid in cash (Rp555,000) and handed over. The consultation fee is waived because the visit has a qualifying purchase (BILL-4).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S1-J1 | PaymentAllocated (serum line) | Cash (shift) | 333,000 | |
| S1-J1 | | Contract liability — paid not delivered | | 333,000 |
| S1-J4 | PaymentAllocated (sunscreen line) | Cash (shift) | 222,000 | |
| S1-J4 | | Contract liability — paid not delivered | | 222,000 |
| S1-J2 | ProductHandedOver (serum) | Contract liability — paid not delivered | 333,000 | |
| S1-J2 | | Revenue — product | | 333,000 |
| S1-J2 | | Cost of goods sold | 150,000 | |
| S1-J2 | | Inventory | | 150,000 |
| S1-J3 | ProductHandedOver (sunscreen) | Contract liability — paid not delivered | 222,000 | |
| S1-J3 | | Revenue — product | | 222,000 |
| S1-J3 | | Cost of goods sold | 90,000 | |
| S1-J3 | | Inventory | | 90,000 |

**VAT.** None, because the tenant is not PKP.

**VAT, PKP variant.** Payment is the earlier tax point:
- Serum: base 300,000, VAT 33,000. Sunscreen: base 200,000, VAT 22,000.
- At payment, one journal per line: VAT is credited, 33,000 + 22,000 = 55,000.
- At handover: no second VAT (tax-point guard). Revenue is 300,000 and 200,000.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S1P-J1 | PaymentAllocated (serum line, PKP) | Cash (shift) | 333,000 | |
| S1P-J1 | | Contract liability — paid not delivered | | 300,000 |
| S1P-J1 | | VAT payable | | 33,000 |
| S1P-J2 | PaymentAllocated (sunscreen line, PKP) | Cash (shift) | 222,000 | |
| S1P-J2 | | Contract liability — paid not delivered | | 200,000 |
| S1P-J2 | | VAT payable | | 22,000 |
| S1P-J3 | ProductHandedOver (serum; no second VAT) | Contract liability — paid not delivered | 300,000 | |
| S1P-J3 | | Revenue — product | | 300,000 |
| S1P-J3 | | Cost of goods sold | 150,000 | |
| S1P-J3 | | Inventory | | 150,000 |
| S1P-J4 | ProductHandedOver (sunscreen; no second VAT) | Contract liability — paid not delivered | 200,000 | |
| S1P-J4 | | Revenue — product | | 200,000 |
| S1P-J4 | | Cost of goods sold | 90,000 | |
| S1P-J4 | | Inventory | | 90,000 |

**Commission.**
- Non-PKP: closing BC 27,750 (5 % × 555,000); new-patient registrar 5,550 (1 %).
- PKP: closing BC 25,000 and registrar 5,000, on the basis excluding tax.
- No performer commission (no treatment), and no commission on the waived consultation.

## Scenario 2 — New patient prepays and completes treatment

**Facts.** New patient, branch A. A treatment at Rp1,500,000 is paid by QRIS before it starts (BILL-1). The treatment is completed and counted, and materials are consumed at a moving-average cost of Rp120,000. The consultation fee is waived.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S2-J1 | PaymentAllocated | Gateway clearing | 1,500,000 | |
| S2-J1 | | Contract liability — paid not delivered | | 1,500,000 |
| S2-J2 | TreatmentFinished (counted) | Contract liability — paid not delivered | 1,500,000 | |
| S2-J2 | | Revenue — treatment | | 1,500,000 |
| S2-J3 | StockConsumed | Materials cost | 120,000 | |
| S2-J3 | | Inventory | | 120,000 |

**VAT.** None (`exempt_medical`).

**Commission.** Guiding BC 30,000; closing BC 75,000; new-patient registrar 15,000; performer 50,000 (the item is fully paid and counted). Gateway clearing stays open until settlement (see scenario 20).

## Scenario 3 — Additional treatment approved in the room

**Facts.** During the visit an addition at Rp400,000 is authorized by the clinician and agreed by the patient. FO releases it before payment (BILL-3, BILL-22) and it is performed and counted.

**3a. Settled the same visit by EDC, after the treatment:**

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S3a-J1 | TreatmentFinished (counted, before payment) | Contract liability — paid not delivered | 400,000 | |
| S3a-J1 | | Revenue — treatment | | 400,000 |
| S3a-J2 | PaymentAllocated | Gateway clearing | 400,000 | |
| S3a-J2 | | Contract liability — paid not delivered | | 400,000 |

The line's paid-not-delivered balance is −400,000 (unbilled) between the two journals and 0 after them (posting-map note).

**3b. Unsettled at close.** After the WhatsApp-bill fallback, FO converts the remainder to a patient receivable (B-18). The receivable is collected in cash at the next visit.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S3b-J1 | TreatmentFinished (counted, before payment) | Contract liability — paid not delivered | 400,000 | |
| S3b-J1 | | Revenue — treatment | | 400,000 |
| S3b-J2 | ReceivableCreated | Patient receivable | 400,000 | |
| S3b-J2 | | Contract liability — paid not delivered | | 400,000 |
| S3b-J3 | ReceivableCollected (next visit) | Cash (shift) | 400,000 | |
| S3b-J3 | | Patient receivable | | 400,000 |

**VAT.** None.

**Commission.**
- 3a: closing BC 20,000; performer 50,000 once the item is fully paid.
- 3b: nothing while unpaid. At collection, closing BC 20,000 and performer 50,000; collection uses the originating line allocation.
- If the receivable is written off instead (scenario 14), there is no commission.
- The visit cannot close while the remainder is unpaid and not converted (PR-15).

## Scenario 4 — Consultation only, later purchase, full and partial refund

**4a. Consultation only.** The fee is Rp150,000, paid in cash, and nothing is bought (BILL-4).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S4a-J1 | ConsultationFeeCharged | Contract liability — paid not delivered | 150,000 | |
| S4a-J1 | | Revenue — consultation | | 150,000 |
| S4a-J2 | PaymentAllocated | Cash (shift) | 150,000 | |
| S4a-J2 | | Contract liability — paid not delivered | | 150,000 |

**4b. Consultation, then a purchase on a later day.**
- Day 1 posts exactly as 4a.
- Day 2: a serum at Rp333,000 is bought (journals as scenario 1). Day 2 has no consultation fee, and day 1's fee is not refunded or waived retroactively.

**4c. Full refund re-charges the fee.**
- A visit with a serum at Rp333,000, paid and handed over; the fee was waived.
- The serum is returned unopened. The refund goes to balance by default (B-11); the stock comes back at its moving-average cost.
- Because every qualifying purchase is refunded, the waived fee is re-charged from the refund as a new line (BILL-21, PR-12).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S4c-J1 | BalanceMoved (refund of delivered item) | Revenue — product | 333,000 | |
| S4c-J1 | | Contract liability — patient balance | | 333,000 |
| S4c-J2 | ProductReturned (COGS only) | Inventory | 150,000 | |
| S4c-J2 | | Cost of goods sold | | 150,000 |
| S4c-J3 | ConsultationFeeCharged (re-charge line) | Contract liability — paid not delivered | 150,000 | |
| S4c-J3 | | Revenue — consultation | | 150,000 |
| S4c-J4 | PaymentAllocated (funded from balance) | Contract liability — patient balance | 150,000 | |
| S4c-J4 | | Contract liability — paid not delivered | | 150,000 |

The patient's balance ends at 183,000 (333,000 − 150,000). `ConsultationFeeRecharged` only notifies; it posts nothing.

**4d. Partial refund keeps the waiver.**
- A serum at Rp333,000 and a sunscreen at Rp222,000; only the sunscreen is refunded to balance.
- The fee stays waived. No re-charge line is created.
- The scenario starts from scenario 1's two delivered products.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S4d-J1 | BalanceMoved (refund of delivered sunscreen) | Revenue — product | 222,000 | |
| S4d-J1 | | Contract liability — patient balance | | 222,000 |
| S4d-J2 | ProductReturned (COGS only) | Inventory | 90,000 | |
| S4d-J2 | | Cost of goods sold | | 90,000 |

**VAT.** None (non-PKP).

**Commission.**
- Consultation: none (default none; a waived consultation never earns).
- 4c: the serum's closing BC 16,650 becomes an adjustment of −16,650 (refund, BILL-15).
- 4d: the sunscreen's closing BC 11,100 becomes an adjustment of −11,100.

## Scenario 5 — Package session redeemed; instalment package with locked sessions

**5a. Returning patient, fully paid package.**
- The package costs Rp3,000,000 for 5 equal sessions of 600,000 each (BILL-7), paid earlier, so the package liability is 3,000,000.
- One session is counted. No consultation fee: a package-session visit without a new complaint is not charged (BILL-4).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S5a-J1 | SessionRedeemed | Contract liability — packages | 600,000 | |
| S5a-J1 | | Revenue — treatment | | 600,000 |

**5b. Instalment package.**
- The same package with Rp1,000,000 paid in cash as the first instalment. The DP is at least the first session's value (BILL-9).
- One session is redeemable: 1,000,000 ÷ 600,000, rounded down. Session 2 is locked until the cumulative payment reaches 1,200,000 (BILL-8).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S5b-J1 | PaymentAllocated (package) | Cash (shift) | 1,000,000 | |
| S5b-J1 | | Contract liability — packages | | 1,000,000 |

**VAT.** None.

**Commission.**
- 5a: performer 50,000 per counted session. There is **no** second sales commission on a redemption.
- 5b: closing BC 50,000 and guiding BC 20,000 on the 1,000,000 allocated. Later instalments earn on what they allocate.

## Scenario 6 — Booking DP: change ≥ 24 h, change < 24 h, no-show, clinic cancel

**Facts.** A booking DP of Rp200,000 is paid in cash for a treatment at Rp1,500,000 (BILL-13, SET-10, cutoff 24 h). Every case starts with this journal:

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S6-J1 | BookingDepositReceived | Cash (shift) | 200,000 | |
| S6-J1 | | Contract liability — booking DP | | 200,000 |

**6a. The patient changes ≥ 24 h ahead.** The DP moves to balance.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S6a-J2 | BalanceMoved (booking DP) | Contract liability — booking DP | 200,000 | |
| S6a-J2 | | Contract liability — patient balance | | 200,000 |

**6b. The patient changes < 24 h ahead,** and **6c. no-show.** The DP is forfeited. For a no-show, CS also gets a follow-up task (PR-83).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S6b-J2 | BookingDepositForfeited | Contract liability — booking DP | 200,000 | |
| S6b-J2 | | Other income | | 200,000 |

**PENDING (accountant, A-10):** the classification of forfeited DP as other income.

**6d. The clinic cancels.** By default the DP moves to balance (as 6a). A cash refund on the patient's request is scenario 17.

**6e. The patient arrives.** The DP is applied to the treatment line. The remaining 1,300,000 is paid by QRIS, and the counted treatment posts as in scenario 2.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S6e-J2 | BookingDepositApplied | Contract liability — booking DP | 200,000 | |
| S6e-J2 | | Contract liability — paid not delivered | | 200,000 |
| S6e-J3 | PaymentAllocated (remainder) | Gateway clearing | 1,300,000 | |
| S6e-J3 | | Contract liability — paid not delivered | | 1,300,000 |
| S6e-J4 | TreatmentFinished (counted) | Contract liability — paid not delivered | 1,500,000 | |
| S6e-J4 | | Revenue — treatment | | 1,500,000 |

**VAT.** None (`exempt_medical`).

**VAT, PKP gross-DP variant** (for T-077).
- The tenant is PKP. The booked item is a `taxable_service` at Rp1,665,000, and its DP is Rp222,000 (base 200,000, VAT 22,000).
- **PENDING (tax adviser, Q-05):** the DP tax point (`11`: "+ VAT payable if the booked item is taxable, PKP; pending Q-05") and the VAT on a forfeit. The rows below follow the posting map as drafted.
- The DP moves to balance at its gross value with the VAT reversed (a credit document). The balance is spent later on a taxable item, which recognises VAT once.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S6P-J1 | BookingDepositReceived (PKP) | Cash (shift) | 222,000 | |
| S6P-J1 | | Contract liability — booking DP | | 200,000 |
| S6P-J1 | | VAT payable | | 22,000 |
| S6P-J2 | BalanceMoved (booking DP; VAT credit document) | Contract liability — booking DP | 200,000 | |
| S6P-J2 | | VAT payable | 22,000 | |
| S6P-J2 | | Contract liability — patient balance | | 222,000 |
| S6P-J3 | PaymentAllocated (taxable line, funded from balance) | Contract liability — patient balance | 222,000 | |
| S6P-J3 | | Contract liability — paid not delivered | | 200,000 |
| S6P-J3 | | VAT payable | | 22,000 |

Net VAT payable is 22,000, counted **once**. It is credited in J1, reversed in J2 and credited in J3.

**Commission.** None on a DP alone (a deposit earns nothing) and none on a forfeit. When the DP is applied and the treatment is paid, commission follows scenario 2 on the full allocated 1,500,000.

## Scenario 7 — Interrupted treatment: medical, clinic, patient

**Facts.**
- A single treatment at Rp1,500,000 is paid in cash, so paid-not-delivered stands at 1,500,000. Closing BC accrued 75,000 at payment.
- The treatment stops part-way. The materials actually used are Rp60,000 and are always recorded (BILL-14).

**7a. Medical stop** and **7b. clinic stop.**
- Not counted: no revenue and no performer commission.
- The patient chooses either a free reschedule (no journal) or balance (BILL-25, `from_interrupted_treatment`).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S7a-J1 | StockConsumed (actual) | Materials cost | 60,000 | |
| S7a-J1 | | Inventory | | 60,000 |
| S7a-J2 | BalanceMoved (interrupted, to balance) | Contract liability — paid not delivered | 1,500,000 | |
| S7a-J2 | | Contract liability — patient balance | | 1,500,000 |

**7c. Patient stop.** Counted, with no refund.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S7c-J1 | StockConsumed (actual) | Materials cost | 60,000 | |
| S7c-J1 | | Inventory | | 60,000 |
| S7c-J2 | TreatmentFinished (counted) | Contract liability — paid not delivered | 1,500,000 | |
| S7c-J2 | | Revenue — treatment | | 1,500,000 |

**7d. Package-session interruption** (BILL-24, PR-14; for T-076).
- A fully paid package session worth 600,000 is reserved at check-in (scenario 5a's package). Actual materials are 60,000.
- **Medical or clinic stop:** the session goes back to `available` and is not redeemed, so there is no revenue. Only the materials post:

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S7d-J1 | StockConsumed (actual) | Materials cost | 60,000 | |
| S7d-J1 | | Inventory | | 60,000 |

- **Patient stop:** the session counts as used (PR-14), so the materials journal above plus:

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S7d-J2 | SessionRedeemed (patient stop, counted) | Contract liability — packages | 600,000 | |
| S7d-J2 | | Revenue — treatment | | 600,000 |

**VAT.** None.

**Commission.**
- 7a and 7b: when moved to balance, closing BC is adjusted −75,000, treated like a refund (B-10). A reschedule needs no adjustment.
- 7c: performer 50,000; closing BC stays.
- 7d: a medical or clinic stop earns nothing and adjusts nothing; the session is unused and the package's sales commission is untouched. A patient stop earns the performer 50,000.

## Scenario 8 — Package expiry

**Facts.**
- The package costs Rp5,000,000 for 5 sessions of 1,000,000 each. Rp3,000,000 is paid and 2 sessions are counted, so the package liability is 1,000,000.
- The validity ends (BILL-10, SET-8). This is the PR-20 scenario.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S8-J1 | BalanceMoved (package expiry) | Contract liability — packages | 1,000,000 | |
| S8-J1 | | Contract liability — patient balance | | 1,000,000 |

**Expected.**
- Rp1,000,000 goes to balance.
- The unpaid Rp2,000,000 is cancelled. No receivable is created and no journal is posted for it.
- The package is closed.

**VAT.** None.

**Commission.** The paid value moved to balance is adjusted like a refund (B-10): closing BC −50,000 (5 % × 1,000,000) and guiding BC −20,000.

## Scenario 9 — Material return plus payment refund

**Facts.**
- A treatment at Rp1,500,000 is paid in cash. The visit had no consultation fee: it was a planned treatment visit, so a refund re-charges nothing.
- Two serum vials are issued to the room at a moving-average cost of 40,000 each.
- The treatment is not performed and the patient asks for a refund. By default the refund goes to balance (B-11).
- One vial comes back unopened and is accepted as usable (StockReturned of unconsumed issued stock: no ledger movement). The other was opened and is wasted.
- In variant 9b, the owner approves a cash refund exception (BILL-12, SET-11).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S9-J1 | BalanceMoved (refund of undelivered item) | Contract liability — paid not delivered | 1,500,000 | |
| S9-J1 | | Contract liability — patient balance | | 1,500,000 |
| S9-J2 | StockWasted (opened vial) | Waste expense | 40,000 | |
| S9-J2 | | Inventory | | 40,000 |
| S9b-J3 | RefundPaid (cash exception) | Contract liability — patient balance | 1,500,000 | |
| S9b-J3 | | Cash (shift) | | 1,500,000 |

**VAT.** None.

**Commission.** Closing BC 75,000 is adjusted −75,000. No performer commission, since there was no counted treatment.

## Scenario 10 — One sale with guiding BC, closing BC, new-patient registrar and performer; refund after payout

**Facts.**
- New patient, branch A. A treatment at Rp2,000,000 is paid by transfer and counted.
- Each contribution goes to a different person: guiding BC G, closing BC C, registrar R, performer P.
- The commissions are approved and paid in month 1. In month 2 the treatment is refunded to balance.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S10-J1 | PaymentAllocated | Bank | 2,000,000 | |
| S10-J1 | | Contract liability — paid not delivered | | 2,000,000 |
| S10-J2 | TreatmentFinished (counted) | Contract liability — paid not delivered | 2,000,000 | |
| S10-J2 | | Revenue — treatment | | 2,000,000 |
| S10-J3 | CommissionAccrued (month 1) | Commission expense | 210,000 | |
| S10-J3 | | Commission payable | | 210,000 |
| S10-J4 | CommissionPaid (month 1) | Commission payable | 210,000 | |
| S10-J4 | | Bank | | 210,000 |
| S10-J5 | BalanceMoved (refund of delivered item, month 2) | Revenue — treatment | 2,000,000 | |
| S10-J5 | | Contract liability — patient balance | | 2,000,000 |
| S10-J6 | CommissionAdjusted (after payout) | Staff receivable | 210,000 | |
| S10-J6 | | Commission expense | | 210,000 |

**Commission.** G 40,000 (2 %), C 100,000 (5 %), R 20,000 (1 %, first visit), P 50,000 (fixed). Total 210,000.
- The revenue report counts **one** sale of 2,000,000, not four.
- If one person held two contributions, for example G = C, they earn each once: 140,000 (BILL-15).
- After payout, the refund produces deductions of −210,000 against month 2. The paid records stay unchanged (PR-23).
- A deduction larger than month 2's commission carries forward (B-13). The staff receivable clears as the deductions are recovered.

**VAT.** None.

## Scenario 11 — Cross-branch package: sold at A, redeemed at B

**Facts.**
- A package at Rp3,000,000 for 5 sessions of 600,000 each is sold and fully paid in cash at branch A. One session is counted at branch B (BILL-16, B-17).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S11-J1 | PaymentAllocated (package, branch A) | Cash (shift) | 3,000,000 | |
| S11-J1 | | Contract liability — packages | | 3,000,000 |
| S11-J2 | SessionRedeemed (branch B; one journal) | Contract liability — packages | 600,000 | |
| S11-J2 | | Inter-branch clearing | | 600,000 |
| S11-J2 | | Inter-branch clearing | 600,000 | |
| S11-J2 | | Revenue — treatment | | 600,000 |

Branch postings in S11-J2:
- Packages and the first clearing row are at A.
- The second clearing row and the revenue are at B.

Clearing nets to zero across the branches. The materials and the performer are at B.

**VAT.** None.

**Commission.**
- At sale: closing BC 150,000 and guiding BC 60,000, both at A, paid regardless of branch. The sales KPI is at A.
- Per counted session: performer 50,000 at B.

## Scenario 12 — Substitution: higher difference paid, lower difference to balance

**Facts.** In a fully paid package, an unused session is worth Rp600,000. The doctor approves a substitution (BILL-11).

**12a. Higher-priced substitute** at Rp800,000; the patient pays the Rp200,000 difference in cash.

**12b. Lower-priced substitute** at Rp450,000; Rp150,000 moves to balance (BILL-25, `from_substitution`).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S12a-J1 | SessionRedeemed (substituted session) | Contract liability — packages | 600,000 | |
| S12a-J1 | | Revenue — treatment | | 600,000 |
| S12a-J2 | PaymentAllocated (difference line) | Cash (shift) | 200,000 | |
| S12a-J2 | | Contract liability — paid not delivered | | 200,000 |
| S12a-J3 | TreatmentFinished (difference line) | Contract liability — paid not delivered | 200,000 | |
| S12a-J3 | | Revenue — treatment | | 200,000 |
| S12b-J1 | BalanceMoved (cheaper substitution) | Contract liability — packages | 150,000 | |
| S12b-J1 | | Contract liability — patient balance | | 150,000 |
| S12b-J2 | SessionRedeemed (substituted session) | Contract liability — packages | 450,000 | |
| S12b-J2 | | Revenue — treatment | | 450,000 |

**PENDING (accountant, A-02).** The posting map lists only the cheaper-substitution reclass. Splitting 12a into the session redemption plus a difference line is this fixture's proposal. The amounts that must hold whatever the split:
- 12a: revenue 800,000 recognised once.
- 12b: revenue 450,000 recognised once.

**VAT.** None.

**Commission.**
- 12a: closing BC on the paid difference, 10,000; performer 50,000.
- 12b: closing BC adjusted −7,500 on the 150,000 moved to balance (B-10); performer 50,000.

## Scenario 13 — Balance pays a package instalment, then a session is redeemed

**Facts.**
- The patient holds a balance of Rp1,000,000, from scenario 8.
- A package at Rp3,000,000 (5 sessions of 600,000) gets a first instalment of Rp600,000 paid from the balance. One session is then counted.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S13-J1 | PaymentAllocated (package, funded from balance) | Contract liability — patient balance | 600,000 | |
| S13-J1 | | Contract liability — packages | | 600,000 |
| S13-J2 | SessionRedeemed | Contract liability — packages | 600,000 | |
| S13-J2 | | Revenue — treatment | | 600,000 |

**Expected.** Revenue 600,000, counted **once**. The money that reached the balance in scenario 8 was never revenue, and using it is not revenue. The balance left is 400,000.

**VAT.** None.

**Commission.** Spending the balance earns normally (B-10): closing BC 30,000 on the 600,000 allocated, and performer 50,000.

## Scenario 14 — Receivable written off: no commission

**Facts.**
- Scenario 3b's receivable of Rp400,000 is never collected.
- FO requests a write-off and the owner approves it (BILL-23, B-14).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S14-J1 | ReceivableWrittenOff | Bad-debt expense | 400,000 | |
| S14-J1 | | Patient receivable | | 400,000 |

**Commission.** None for any contribution on the written-off item, because the payment basis is 0.

**VAT.** None.

## Scenario 15 — Product refund to balance (default) and cash refund exception

**Facts.**
- A serum at Rp333,000 is paid and handed over (scenario 1). It is returned unopened and usable.
- The sunscreen from the same visit is kept. A qualifying purchase remains, so the consultation fee stays waived (as in 4d).
- **15a:** the refund goes to balance by default.
- **15b:** the owner approves a cash exception.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S15-J1 | BalanceMoved (refund of delivered item) | Revenue — product | 333,000 | |
| S15-J1 | | Contract liability — patient balance | | 333,000 |
| S15-J2 | ProductReturned (COGS only) | Inventory | 150,000 | |
| S15-J2 | | Cost of goods sold | | 150,000 |
| S15b-J3 | RefundPaid (cash exception) | Contract liability — patient balance | 333,000 | |
| S15b-J3 | | Cash (shift) | | 333,000 |

**VAT.** None (non-PKP). For a PKP tenant, see the scenario-19 pattern for the VAT reversal with a credit document.

**Commission.** Closing BC adjusted −16,650 (refund).

## Scenario 16 — PKP boundary: package paid before the PKP date, redeemed after

**Facts.**
- The tenant becomes PKP on 2026-07-01.
- On 2026-06-15, before PKP, a `taxable_service` package at Rp3,330,000 (5 sessions of 666,000) is paid in cash. No VAT is recognised: `vat_recognised_amount` is 0 on each session.
- A session is counted on 2026-07-10, after PKP.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S16-J1 | PaymentAllocated (package, before PKP) | Cash (shift) | 3,330,000 | |
| S16-J1 | | Contract liability — packages | | 3,330,000 |
| S16-J2 | SessionRedeemed (after PKP; tax-point guard) | Contract liability — packages | 666,000 | |
| S16-J2 | | Revenue — treatment | | 600,000 |
| S16-J2 | | VAT payable | | 66,000 |

**VAT.** S16-J2: VAT 66,000 at delivery under the tax-point guard.

**PENDING (tax adviser, Q-05).**
- S16-J2 applies the specification's tax-point guard literally: VAT is credited for the part of a taxable session whose VAT was not already recognised, at the earlier of payment and delivery, while PKP.
- The alternative reading: consideration received before PKP is outside VAT. The redemption would then post revenue 666,000 with no VAT.
- The adviser decides which one applies. VAT is computed only after the advice is recorded (BILL-6).

**Commission.** At sale: closing BC 166,500 (5 % × 3,330,000, non-PKP basis). Per counted session: performer 50,000.

## Scenario 17 — Booking DP: clinic cancellation with refund on request

**Facts.**
- A booking DP of Rp200,000 is paid in cash, as in scenario 6.
- The clinic cancels and the patient asks for cash. This is clinic-caused, so the B-04 exception approval is not needed (BILL-13).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S17-J1 | BookingDepositReceived | Cash (shift) | 200,000 | |
| S17-J1 | | Contract liability — booking DP | | 200,000 |
| S17-J2 | BookingDepositRefunded | Contract liability — booking DP | 200,000 | |
| S17-J2 | | Cash (shift) | | 200,000 |

**VAT.** None.

**VAT, PKP gross-DP variant** (for T-077; the same DP as scenario 6's variant, with the same **PENDING (Q-05)**).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S17P-J1 | BookingDepositReceived (PKP) | Cash (shift) | 222,000 | |
| S17P-J1 | | Contract liability — booking DP | | 200,000 |
| S17P-J1 | | VAT payable | | 22,000 |
| S17P-J2 | BookingDepositRefunded (PKP; VAT reversed) | Contract liability — booking DP | 200,000 | |
| S17P-J2 | | VAT payable | 22,000 | |
| S17P-J2 | | Cash (shift) | | 222,000 |

Net VAT payable is 0. The refund returns the gross DP.

**Commission.** None.

## Scenario 18 — Payment succeeded but the app response was lost; duplicate gateway webhook

**Facts.**
- A QRIS charge of Rp1,500,000 is created for a treatment line through the payment port (mock adapter in non-production, PR-68, BILL-29).
- The provider marks the charge paid, but the app's response is lost.
- The cashier's retry checks the charge **status**; it does not create a new charge.
- The webhook then arrives twice.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S18-J1 | PaymentAllocated (once) | Gateway clearing | 1,500,000 | |
| S18-J1 | | Contract liability — paid not delivered | | 1,500,000 |

**Expected.**
- Exactly one payment, one allocation and one journal.
- The second webhook and the status-driven retry are no-ops: they are idempotent on the provider reference and the command key.
- A simulated (mock) payment never enters these ledgers or K1 (BILL-29). In non-production the same idempotency is asserted on the simulated records.

**VAT.** None. **Commission.** Once, on the one allocation: closing BC 75,000.

## Scenario 19 — PKP taxable package paid, expired, balance reused for a taxable item: VAT once

**Facts.**
- The tenant is PKP.
- A `taxable_service` package at Rp3,330,000 (5 sessions of 666,000) is paid in cash. Payment is the tax point: base 3,000,000, VAT 330,000.
- No session is used and the package expires. The paid-unused value moves to balance at its gross value, and the VAT is reversed with a VAT credit document (A-12).
- The balance then pays for a `taxable_goods` product at Rp3,330,000, which is handed over: ten serums at Rp333,000, moving-average cost 1,500,000.
- The amounts correspond to PLAN §3's "Rp3,000,000 package" as the base, plus VAT 330,000.

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S19-J1 | PaymentAllocated (package, PKP) | Cash (shift) | 3,330,000 | |
| S19-J1 | | Contract liability — packages | | 3,000,000 |
| S19-J1 | | VAT payable | | 330,000 |
| S19-J2 | BalanceMoved (package expiry; VAT credit document) | Contract liability — packages | 3,000,000 | |
| S19-J2 | | VAT payable | 330,000 | |
| S19-J2 | | Contract liability — patient balance | | 3,330,000 |
| S19-J3 | PaymentAllocated (product, funded from balance) | Contract liability — patient balance | 3,330,000 | |
| S19-J3 | | Contract liability — paid not delivered | | 3,000,000 |
| S19-J3 | | VAT payable | | 330,000 |
| S19-J4 | ProductHandedOver (no second VAT) | Contract liability — paid not delivered | 3,000,000 | |
| S19-J4 | | Revenue — product | | 3,000,000 |
| S19-J4 | | Cost of goods sold | 1,500,000 | |
| S19-J4 | | Inventory | | 1,500,000 |

**VAT.** Net VAT payable is 330,000, counted **once**. It is credited in J1, reversed in J2 and credited in J3; J4 adds nothing.

**PENDING (tax adviser, Q-05).** If VAT reversal on a move to balance is ruled out, the `vat_settled` balance path applies, and it stays switched off until it is specified and signed (posting-map note).

**Commission.**
- On the package payment: closing BC 150,000 (5 % of base 3,000,000).
- On the expiry: adjusted −150,000 (B-10).
- On the product paid from the balance: 150,000 (spending earns normally).

## Scenario 20 — Gateway payment net of fee: clearing nets to zero, the fee is an expense

**Facts.**
- A QRIS payment of Rp1,000,000 is allocated to a treatment line.
- The provider settles the net amount after a 0.7 % merchant fee: Rp993,000 to the bank, Rp7,000 fee. The clinic bears the fee (SET-14).

| Journal | Event | Account | Debit | Credit |
|---|---|---|---|---|
| S20-J1 | PaymentAllocated | Gateway clearing | 1,000,000 | |
| S20-J1 | | Contract liability — paid not delivered | | 1,000,000 |
| S20-J2 | GatewaySettlementReceived | Bank | 993,000 | |
| S20-J2 | | Merchant fee expense | 7,000 | |
| S20-J2 | | Gateway clearing | | 1,000,000 |

**Expected.**
- Gateway clearing ends at 0.
- The fee is an expense, never a revenue reduction.
- The commission basis is unchanged.

**VAT.** None.

**Commission.** Closing BC 50,000 on 1,000,000; the fee does not reduce it.

## Roll-forward checks (`11` Roll-forwards)

Each scenario must leave the liability roll-forwards consistent. The checker verifies that every journal balances. The M4 tests verify the sub-ledger movements. Spot values:

| Scenario | Ledger | Movement (closing − opening) |
|---|---|---|
| 8 | Package liability | −1,000,000 (moved to balance) |
| 8 | Patient balance | +1,000,000 |
| 13 | Patient balance | −600,000 |
| 13 | Package liability | +600,000 − 600,000 = 0 |
| 19 | VAT payable | +330,000 − 330,000 + 330,000 = +330,000 |
| 20 | Gateway clearing | +1,000,000 − 1,000,000 = 0 |
| 3b | Receivables | +400,000 − 400,000 = 0 |
| 14 | Receivables | −400,000 (write-off) |
| 11 | Inter-branch clearing | 0 across branches |

## Which milestone asserts what

| Scenario | M4 domain behaviour (T-086) | M5 commission | M8 journals |
|---|---|---|---|
| 1–9, 11–13, 15–19 | Yes | Commission figures | Journals above |
| 10, 14 | Liability, receivable and balance facts only | Yes (main purpose) | Yes |
| 20 | Clearing facts | — | Yes (T-086: scenario 20 in M8) |

## Sign-off

| Party | What | Status |
|---|---|---|
| Finance owner (Paduka Ongki) | Confirms the scenarios, the facts and the expected figures; records the sign-off here and in `DECISIONS.md` | **Signed off 2026-11-12** ("setuju", DEC-080). Approved as a specification fixture: the illustrative parameters (commission rates, prices) are not settings, and the PENDING items wait for the accountant and the tax adviser. |
| Accountant (A-02) | Reviews the journals, the PENDING items (A-10 forfeited DP, the 12a decomposition, rounding) and the posting map | **Review requested 2026-11-12** (owner-approved route, DEC-080). This document is the review package. No tenant exists yet, so the compliance register cannot hold the request. Once the pilot tenant exists, the obligation `posting_map_signoff` (PR-97) is opened in Kepatuhan with this document attached. **Review result pending.** |
| Tax adviser (Q-05) | Decides the VAT points (scenarios 1 PKP, 6, 16, 19; rounding) | **Pending.** Obligation `tax_advice` |
