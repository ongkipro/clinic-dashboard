# Round 2 business and money review: Clinic Dashboard kit v0.2

**Scope:** I read the focus files (`02`, `11`, `05`, `PLAN`, `18`) in full. I spot-checked `03`, `07` and `17` to confirm fixes. The decision register is the authority where the two disagree. I did not edit any file.

## 1. Verdict: **PASS-WITH-FIXES**

v0.2 closes all seven P1s from round 1 at the rule level:
- Revenue is now booked when the service is delivered, through two families of entries: payments into a liability, delivery out of it (A-11, BILL-27).
- Balance spent on a package is no longer counted twice.
- The new balance entry types are in place.
- B-10 commission adjustment, branch price override (PR-42) and the bounded settings list (B-16) are all in.

Two new P1s remain in the posting map and VAT logic. Both are small text edits:
- VAT can be charged twice on value moved to patient balance.
- One row can book revenue twice.

They are P1 because the VAT sub-ledger is a Release 1 Must (PR-25), not something that waits for step 2.

## 2. Prior findings

| ID | Status | Evidence |
|---|---|---|
| 1-1 Revenue timing | **Closed** | `11` BILL-27, posting map now split into payment and delivery rows; `03` ADR-5 |
| 1-2 VAT on prepaid paths | **Partially** | Fixed: VAT added to payment rows, VAT roll-forward, tax snapshot per session (DATA-29), scenario 16. Still open: no VAT reversal when value moves to balance, nothing for booking DP, and the tax timing does not match the receivable row (N-1, N-3) |
| 1-3 Balance pays package, revenue twice | **Closed** | `11` row "Balance used for a package installment → packages liability"; PLAN §3 #13 |
| 1-4 Value moved to balance not modelled | **Closed** | DATA-30 entry types; BILL-25; balance roll-forward; posting rows |
| 1-5 Commission on value moved to balance | **Closed** | B-10 in BILL-15 and PR-23; posting row "Commission adjustment (refund or moved to balance)" |
| 1-6 Branch price override | **Closed** | PR-42 with scenario; DATA-15 `branch_prices`; `07` catalog row |
| 1-7 Extra settings | **Closed** | CD-10/21/22/27 now F (fixed); IAM-7; BILL-18 has no tolerance setting; PR-38. A new extra setting appeared (N-6) |
| 2-1 Cross-branch package | **Closed** | BILL-16; `sold_branch_id` in DATA-6, DATA-27 and DATA-29 |
| 2-2 PR-25 scenario | **Closed** | `02` §8 now uses paid allocations |
| 2-3 When a session is redeemed | **Closed** | BILL-24; `17` state matrix (reserve vs redeem). Reservation gap in N-8 |
| 2-4 Refund destination | **Closed** | BILL-21; posting rows for refunds and consultation re-charge |
| 2-5 Commission sub-rules | **Closed** | BILL-15; DATA-36 `guiding_bc_assignments`, carry-forward |
| 2-6 Commission export | **Closed** | BILL-15, PR-23, `11` Exports |
| 2-7 Accountant gate | **Closed** | A-14, PR-25, PLAN M10 entry criterion |
| 2-8 Additional-treatment fields | **Closed** | DATA-21, BILL-22, PR-15 |
| 2-9 Receivable vs visit closure | **Closed** | PR-15 and its scenario; B-18 |
| 2-10 Write-off approvals | **Partially** | `07` and `17` are fixed. PR-37 and PR-44 still apply requester ≠ approver to write-offs with no exception for an owner acting alone (N-9) |
| 2-11 Multi-role staff | **Closed** | IAM-3; DATA-36 keyed on `staff_id` |
| 2-12 Missing roles | **Partially** | IAM-8 and the `07` matrix are fixed. PLAN CD-20 still says "Medical Director" and `09` still says `crm` |
| 2-13 Missing entities | **Partially** | Most added (DATA-25/27/28/29/33/35). Refund states have no `unknown`, and payment allocation targets are incomplete (N-7) |
| 2-14 PR-22 refund on request | **Closed** | PR-22 |
| 2-15 Status labels | **Closed** | BILL-6 and BILL-16 marked "Adopted recommendation (pending …)" |
| 2-16 WhatsApp bill content | **Closed** | BILL-22 |
| 2-17 Scenario gaps | **Partially** | PLAN §3 #12–18 added, but with no expected ledger, VAT or commission figures (only #8 has amounts) |
| P3-1, 2, 4, 5, 6, 8, 10 | **Closed** | PR-14, PR-15 scenarios, K5 expiry slice, `03` §unlock, B-13, `07`, `11` document control |
| P3-3 Unsourced defaults | **Open** | PR-30 "30/14/7 days", PR-30 scenario "2 days" |
| P3-7 Naming drift | **Partially** | `03` TD-7 still `balance_ledger`; `09` still `crm` |
| P3-9 H-03 / W-08 | **Partially** | W-08 is in PR-27. H-03 (do not reuse `99ribu-prod`) is still not in the kit |
| P3-11 VAT-inclusive pricing | **Closed, but now a new issue** | Added as a tenant setting (N-6) |

## 3. New findings

### P1

**N-1. VAT is charged twice on value moved to patient balance**
- **Where:** `11` posting map, the reclassification rows (package expiry or cancellation, interrupted single treatment, cheaper substitution, refund of an undelivered item to balance).
- **Problem:**
  - Under A-12, VAT payable is credited when payment for a taxable item arrives.
  - When that value later moves to balance, the reclass rows debit only the liability and do not reverse the VAT.
  - When the balance is spent on a taxable item, "Balance used" credits VAT again. The same rupiah carries VAT twice.
  - The liabilities are held net of VAT, so the patient's balance would also be credited with the net amount, not the full (VAT-inclusive) amount the patient paid.
- **Fix text** (add to each reclass row and to "Refund of undelivered item to balance"): "Dr Contract liability (net) + Dr VAT payable (taxable share, PKP) → Cr Contract liability — patient balance (gross). The VAT reversal is documented by a VAT credit/cancellation document; pending tax adviser (Q-05)."
- **Alternative if the tax adviser rules out a reversal:** tag the balance entry `vat_settled = true` and do not charge VAT again when it is used.
- **Also:** add PLAN scenario 19: "PKP taxable package, Rp3,000,000 paid, expires, balance reused for a taxable item; VAT counted once."

**N-2. "Delivered item still unpaid at close" can book revenue twice**
- **Where:** `11` posting map, the third delivery row.
- **Problem:** the generic row "Treatment counted / product handed over" already credits Revenue at the moment of delivery. If this row also fires at visit close, revenue is booked twice. That contradicts the map's own line "each rupiah is recognised once".
- **Fix text:** delete the row, and add this note: "Delivery before payment posts once at delivery. The line's paid-not-delivered balance goes negative and is shown as an unbilled receivable. Converting it to a receivable (settlement row) clears it."

### P2

**N-3. A-12 tax timing does not match the receivable row**
- **Where:** BILL-6 says "VAT due when payment … is received". The settlement row "Unpaid remainder converted to receivable" credits VAT without any payment.
- **Fix text:** "VAT is due at the earlier of payment or delivery." Update BILL-6 and A-12 to match.

**N-4. VAT gaps on booking DP, inputs and forfeits**
- **Where:** "Booking DP received" has no VAT, although the DP is an advance for a specific taxable item (DATA-15). Goods receipt has no input VAT for PKP tenants.
- **Fix:**
  - Add "(+ VAT payable if the item is taxable, PKP)" to "Booking DP received".
  - Add the row "Goods receipt (PKP): Dr Inventory + Dr VAT input (creditable share) → Cr AP". The non-creditable share is added to cost, pending tax adviser, because these tenants mix VAT-exempt and taxable sales.
  - Add the questions "VAT on forfeited DP?" and "VAT on DP" to Q-05.

**N-5. No cost posting when a product is handed over, and K7 is unclear**
- **Where:** `11` Stock rows cover only material consumed or wasted. K7 subtracts "commission" without saying which commission.
- **Fix:**
  - Add the row "Product handed over: Dr Cost of goods sold (moving average) → Cr Inventory (branch)" and its reverse for returns.
  - Redefine K7 as "K2 − materials − product cost − performer commission (executing branch)". Selling and guiding BC commission belong to the selling branch (B-17).

**N-6. BILL-6 adds a tenant setting outside B-09**
- **Problem:** "prices entered inclusive or exclusive of VAT per tenant" is not on the PR-38 / DATA-44 list.
- **Fix:** make it a fixed rule: "consumer prices are VAT-inclusive; the base amount is derived". Otherwise the owner must add it to B-09.

**N-7. Payment allocation targets are incomplete**
- **Where:** DATA-28 and `05` §4 say an allocation goes to exactly one of {invoice line, package}. Balance top-ups, booking DP and receivable collections have no target.
- **Fix:** targets become {invoice_line, package, booking_deposit, balance_top_up, receivable}, with exactly one per allocation. Add `unknown` to the DATA-33 refund states.

**N-8. Sessions can be reserved beyond the paid value**
- **Where:** `05` §4 and `03` unlock: `redeemed + selected ≤ paid`. Reserved sessions are not counted.
- **Fix:** `redeemed_value + reserved_value + selected_value ≤ paid_value`. Reservations are released when the package is cancelled or expires.

**N-9. PR-37 and PR-44 contradict B-14**
- **Problem:** both apply requester ≠ approver to every write-off, but B-14 lets the owner write off alone.
- **Fix text:** "except an owner-initiated write-off (B-14), which needs a mandatory reason and is audited".

**N-10. The KPI definitions conflict with the package rules**
- **Where:** K3 uses invoice lines only, but packages are separate allocation targets. K4 counts "unpaid invoice value" and could show unpaid package remainders as debt, against BILL-10.
- **Fix text:**
  - K3: "invoice lines and package contract value, after discount, excluding VAT; reduced by cancelled unpaid remainders in the month they are cancelled".
  - K4: "excludes unpaid package remainders and open bills of in-progress visits".

**N-11. Per-branch balance sheet and gateway fees**
- **Problem 1:** PR-26 promises a balance sheet per branch. Cross-branch delivery (liability at branch A, revenue at branch B) needs an inter-branch clearing account to support that.
- **Fix:** add the inter-branch clearing account, or limit PR-26 to "P&L per branch; balance sheet consolidated".
- **Problem 2:** BILL-17 and TD-40 have no row for gateway fees or settlement timing. Gateways and QRIS/EDC pay out net of fees, so receipts won't match the bank.
- **Fix:** add "Dr Gateway clearing → Cr Contract liability" at payment, and "Dr Bank + Dr Merchant fee expense → Cr Gateway clearing" at settlement.

**N-12. The event catalog does not cover every posting**
- **Where:** `18` TD-50. Postings are generated from events (ADR-3), but there are no events for several posting rows.
- **Fix:** add these events:
  - `BalanceToppedUp` / `BalanceUsed`
  - `BookingDepositReceived` / `Applied` / `Forfeited` / `MovedToBalance`
  - `ConsultationFeeCharged` / `Recharged`
  - `ProductHandedOver`
  - `SubstitutionApproved`
  - `GoodsReceived`
  - `ShiftClosed`
  - `TaxProfileChanged`
- **Also, TD-41:** a payment that arrives after its link expired should be credited to the patient's balance pending review.

### P3

- **P3-a.** PLAN §3: add the expected ledger, VAT and commission figures to scenarios 12–18.
- **P3-b.** `02` §12, Phase 0 says "external reviews done". This contradicts the owner's deferral. Map the gates instead: accountant to G3/M10, tax adviser to G2 (Q-05), clinical lead to G2 (Q-07).
- **P3-c.** K2 leaves out consultation revenue, so PR-34 reconciliation will always show a difference. Include consultation in K2, or list it as a known reconciling item.
- **P3-d.** BILL-13: say whether a "refund on request" for a clinic cancellation needs the B-04 cash-refund approver.
- **P3-e.** Remaining wording drift:
  - PLAN CD-20 "Medical Director" → Facility head.
  - `03` `balance_ledger` → `balance_accounts/balance_entries`.
  - `09` `crm` → `cs`.
  - Add H-03 (do not reuse the `99ribu-prod` instance) to `04`/`15`.

## 4. Recommendations on adopted (ADOPTED-REC) and open items

| Item | Rec. | Reason |
|---|---|---|
| B-10, B-11, B-12, B-14, B-16, B-18, B-19 | Adopt | Internally consistent, and each closes a double-count or approval gap |
| B-13 carry-forward | Adopt + amend | Add: "at staff exit the remaining deduction becomes a staff receivable for owner decision". Deducting from pay may need the staff member's written agreement, so it should go to legal review |
| B-15 | Adopt + amend | Count reserved sessions in the paid-value check (N-8) |
| B-17 | Adopt + amend | Add inter-branch clearing, or keep the balance sheet consolidated only (N-11) |
| A-02, A-03, A-05, A-06, A-07, A-08, A-09, A-13, A-14, A-15 | Adopt | Sound; gates are correctly placed (M10, Q-05, Q-06) |
| A-04, A-11 | Adopt | Standard contract-liability treatment; the accountant confirms at G3 |
| A-10 | Adopt pending | Add the "VAT on forfeit?" question to Q-05 |
| A-12 | **Change** | Use "earlier of payment or delivery" as the tax point, and add a VAT reversal (or a no-second-VAT flag) when value moves to balance (N-1, N-3) |
| D-09 | Change (register text) | A-14 supersedes the "CSV journal" export in step 1. Mark D-09 as superseded |
| H-09 | Adopt + amend | Add the gateway clearing and fee posting (N-11) |
| BILL-19 (Proposal) | Adopt | Per-branch monthly receipt numbering is low-risk |
| BILL-20 / Q-09 (OPEN) | Keep open | Not on the clinic money path; decide before G3 as listed |

**Gates checked, no new BLOCK:**
- Accountant sign-off before journal export: present (M10 entry; A-14).
- Tax adviser before G2: present (Q-05).
- H-02d legal opinion: present (PR-36, M9).
- Placeholder vendor entity: PR-55 blocks go-live until it is replaced.
- **Missing gate:** no rule stops a PKP tenant from going live with VAT until Q-05 is signed. Add to PR-24: "VAT computation for PKP tenants is enabled only after the Q-05 written advice is recorded".