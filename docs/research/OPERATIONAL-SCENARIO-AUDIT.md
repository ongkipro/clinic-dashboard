# Beauty Clinic — Operational Scenario Audit

Status: desk audit of existing research and confirmed discovery decisions. Not an approved specification, clinical SOP, regulatory opinion, implementation, or live-product test.

## 1. Authority and method

- Confirmed user decisions: [discovery checkpoint](SESSION-HANDOFF-2026-10-30.md), §§3–4.
- Earlier research: [blueprint](BEAUTY-CLINIC-SYSTEM-BLUEPRINT.md), F1–F13 and §3; [deep dive](indonesia-beauty-clinic-system-deep-dive.md), §§5–7.
- Explicit user decisions take precedence over vendor-derived recommendations. Clinical/legal applicability remains a separate validation gate.
- **Confirmed** means already accepted by the user. **Proposed** means a control or workflow recommendation awaiting calibration. **Open** means a business or clinical decision must not be invented.
- Each scenario is traced through actor/approval, money, materials, clinical record, commission, and follow-up. Findings are document contradictions or unresolved rules—not observed software defects.
- No new vendor walkthrough, authenticated account access, or official-source regulatory verification was performed for this audit.

## 2. Executive finding

The agreed normal journey is coherent, but the older blueprint is unsafe to treat as build-ready. It mixes recommended, selected, paid, issued, and performed states. It also places initial payment after treatment in places, contrary to the confirmed workflow.

The minimum design correction is not another module: preserve independent clinical, commercial, payment, execution, stock, and commission records under one visit. A single `DONE` status cannot establish that all six are complete.

### Research conflicts to reconcile after calibration

| ID | Existing research location | Conflict with newer discovery | Proposed treatment |
|---|---|---|---|
| A01 | Blueprint F3: plan includes BHP auto-deduction | Recommendation/selection is not consumption | Plan may generate preparation demand; only an explicit stock event changes the relevant stock balance |
| A02 | Blueprint F4 and F7: recipe/claim auto-deduct | Issue, consumption, and package redemption are conflated | Separate material transfer, actual usage, and session redemption; decide the redemption trigger explicitly |
| A03 | Blueprint F3/F6: finished exam/treatment routes to cashier | Initial treatment must be paid before it starts | Cashier receives patient-selected authorized items before initial treatment; later additions have a separate settlement path |
| A04 | Blueprint F12: accrue on completion/sale | Confirmed basis is actual allocated payment; performer also requires completion | Payment, contribution, and completion are independent entitlement guards |
| A05 | Blueprint F7: returned package becomes deposit | Now consistent with approved policy: paid-but-unused value goes to patient balance; cash refund is an approved exception | Reconcile wording when updating the blueprint |
| A06 | Blueprint §3: appointment spans consultation and treatment through `DONE` | Booking, visit, treatment, and payment can finish differently | Separate lifecycle views; show outstanding work instead of silently closing everything |
| A07 | Blueprint F3/§3: three signatures and finalization-to-outbox | Vendor UI does not prove applicable consent/signature or interoperability requirements | Validate templates, signers, amendment rules, and integration obligations with authoritative sources and the clinical lead |
| A08 | Blueprint F8/F9 and later “final” headings | Deposit expiry, accounting, portal, and marketing scope are not approved | Keep as research options; do not inherit them into MVP scope |

## 3. Scenario walkthroughs

### S1. New patient purchases products only

- **Actor/approval:** FO identifies/registers the patient; BC records preliminary intake; doctor authorizes any clinical recommendation/prescription that requires it. Whether ordinary non-prescription repeat retail can bypass consultation is **open**.
- **Money — confirmed:** product purchase qualifies for consultation-fee waiver in the purchase visit. A prior consultation-only fee is not refunded or retroactively waived by a later purchase. **Open:** whether a minimum purchase exists; do not introduce a threshold by assumption.
- **Materials — proposed:** authorized/selected product quantity creates a preparation request. Reservation is not dispensing. Handover is recorded once against the selected product line; pharmacy requirements depend on product classification and validated SOP.
- **Record:** no treatment execution record is fabricated. Record actual consultation/product advice and dispensing as applicable.
- **Commission:** eligible sale contribution uses allocated actual payment. Fixed entitlement waits for full payment of the relevant item. No performer commission for an unperformed treatment.
- **Follow-up:** actual product instructions and clinically determined review needs; marketing permission remains separate.
- **Exception / confirmed:** if every qualifying purchase is fully refunded, deduct the previously waived consultation fee from the refund. If any qualifying purchase remains after a partial refund, the consultation fee stays waived.

### S2. New patient prepays and completes treatment normally

- **Actor/approval — confirmed:** BC intake → doctor examination/plan → patient selects → action-specific consent → FO collects payment → pharmacy prepares → treatment-room staff check and execute.
- **Money:** verify the initial selected treatment is paid before start. A generated QR code or patient screenshot alone is not verified payment evidence.
- **Materials — proposed:** service formula expands into a request using its applicable version and authorized overrides. Pharmacy allocates/issues; treatment staff acknowledge receipt, confirm actual use, and identify returns/waste.
- **Record:** store clinical author, approved treatment/instructions, consent version, actual performer, start/end, variations, and before/after photos as applicable. Expired timer is not clinical completion.
- **Commission:** sales eligibility follows actual allocated payment; performer eligibility additionally waits for recorded completion. Rule snapshot and contribution identity remain attached.
- **Follow-up:** aftercare and next visit derive from the clinical record, not an invented universal interval.
- **Exception:** payment received but materials unavailable leads to a visible hold and reschedule/refund decision—not automatic substitution or treatment completion.

### S3. Additional treatment is proposed in the room

- **Actor/approval — confirmed:** BC may propose; only appropriately authorized clinical personnel approve. “Doctor absent” must not automatically grant prescribing/authorization rights to every nurse or therapist.
- **Money — confirmed:** FO handles in-room EDC/QRIS or post-treatment payment. FO/cashier may confirm starting an approved addition before payment; manager approval is not required. The addition requires recorded patient and clinical agreement; it may be paid from patient balance or through FO/cashier; no unpaid-amount limit. Leaving unpaid is prevented by balance deduction or in-room EDC/QRIS, a visit-close guard, and FO reminders; fallback is manual WhatsApp billing, then a recorded receivable or owner write-off without commission.
- **Materials — proposed:** create an additional selected line linked to its clinical authorization, price, patient agreement, and any updated consent. Generate incremental materials only; never replay the original request.
- **Record:** preserve the original signed/approved version and the addition's author/time. Signed consent for treatment A does not silently cover treatment B.
- **Commission:** paid additions may generate eligible sale commission; unpaid additions do not. Performer entitlement also requires completion.
- **Follow-up:** include the actual addition and its aftercare in the visit summary.
- **Confirmed boundary:** an addition without clinical authorization cannot start. A clinically approved, unpaid addition can start only after FO/cashier confirms the payment exception; record the confirming user and accountable collector.

### S4. Consultation only

- **Actor/approval:** doctor completes consultation; BC may discuss the plan, but declined items do not become ordered treatments.
- **Money — confirmed:** consultation fee is charged when nothing is purchased/used, including when the patient purchases on a later visit. That later purchase visit has no consultation fee. Contraindication with no purchase remains chargeable. A control visit has no consultation charge because it is included in the related treatment, package, or product. Eligibility follows the approved free-control policy in the checkpoint. **Open:** clinic-caused cancellation exceptions.
- **Materials:** no treatment material demand merely because the doctor recommended a plan. Cancel unissued requests if an earlier selection is withdrawn; reconcile anything already issued.
- **Record:** retain actual findings, recommendations, and decline/defer decision without recording unperformed care.
- **Commission:** doctors have fixed salary plus commission (confirmed). Consultation commission is decided: optional per-service rule, default none, paid consultations only; waived consultations earn none.
- **Follow-up:** retain the staged plan if clinically appropriate; do not automatically turn a declined recommendation into a marketing campaign.

### S5. Returning patient redeems a package session

- **Actor/approval:** FO confirms identity and entitlement; authorized clinical staff review today's suitability and current instructions. An old package purchase is not authorization for today's procedure.
- **Money:** distinguish historical package payment from today's redemption. **Confirmed:** package-session redemption has no consultation charge unless there is an unrelated new complaint/need. **Confirmed:** before full payment, redeemable sessions are limited to the sessions covered by the amount actually paid. Session value is an equal split for same-treatment packages, or proportional to normal prices for mixed packages; a session needs its full allocated value paid. Patients may choose the session order if total redeemed value stays within actual payments and the doctor's stages allow it. Minimum DP is the first-session value, or the greater of that value and an optional per-package percentage. Installments have no due schedule, interest, or late fee; payments may be made anytime within package validity. At expiry, paid-but-unused value moves to patient balance, unpaid remainder is cancelled without debt, and the package closes. Patient balance never expires, is usable for treatments/products/packages/installments, and is withdrawable only by recorded owner/manager exception refund. Installments are enabled by default; validity defaults to 12 months from purchase. Packages are not shareable; doctor-approved substitutions use unused value as credit, with higher differences paid and lower differences sent to patient balance.
- **Materials:** today's service creates today's preparation request; purchase of five future sessions must not consume five sessions' materials immediately.
- **Record:** attach today's actual execution to the package entitlement and relevant care-plan stage; avoid copying old findings as new examination findings.
- **Commission:** no second sales commission merely because a session is redeemed. Session value and paid-session eligibility are decided. **Open:** performer commission amount per session is configured in commission rules.
- **Follow-up:** show remaining entitlement separately from scheduled future visits and from the clinical plan.
- **Proposed guard:** reserve a session when needed, then record redemption at the agreed execution milestone. Interrupted sessions require explicit resolution; neither check-in nor timer expiry silently uses a full session.

### S6. Treatment is cancelled or interrupted

- **Actor/approval:** distinguish patient cancellation, clinical stop, equipment/material failure, and no-show. Clinical staff record clinical reasons; commercial refunds follow authorized business approval.
- **Money — confirmed:** medical/clinic-caused stop allows free reschedule or transfer to patient balance; patient-chosen stop has no refund. Booking-DP cancellation follows the 24-hour rule. Never derive a refund from elapsed timer percentage.
- **Materials:** before issue, release allocations; after issue, reconcile unused usable returns, actual use, and waste. A cancelled invoice cannot restore contaminated material to usable stock.
- **Record:** preserve performed portion and reason for stopping, relevant safety/adverse-event notes, and the responsible clinician's follow-up instructions.
- **Package session — confirmed:** medical stop and clinic-caused stop do not count the session as used; patient-chosen stop counts it as used. Actual material consumption is always recorded.
- **Commission — confirmed:** performer commission applies only when the session counts as used. Paid single treatments follow the same rule: medical/clinic-caused stop → free reschedule or patient balance; patient-chosen stop → completed, no refund.
- **Follow-up:** assign an owner for outstanding clinical and commercial resolution. Visit closure must not hide an unresolved refund or care concern.

### S7. Materials are returned and patient payment is refunded

- **Actor/approval:** treatment staff request return; pharmacy accepts/rejects based on condition and applicable SOP. A separately authorized user approves the financial refund.
- **Money — proposed:** refund references original paid lines and refundable balance; pending, successful, failed, and unknown outcomes remain distinguishable. Correct posted records through linked adjustments rather than deletion.
- **Materials:** patient refund and stock return are separate events. Usable unopened stock may return after acceptance; opened/uncertain/contaminated material is not automatically saleable. Actual consumption remains recorded.
- **Record:** retain original care and reasons for correction. Never erase performed treatment to make the refund screen balance.
- **Commission — confirmed:** unpaid commission is reduced automatically; already-paid commission becomes a recorded deduction from next month's commission. History is preserved.
- **Follow-up:** track any clinical concern separately from refund completion. On a full refund of all qualifying purchases, deduct the waived consultation fee from the refund. If any qualifying purchase remains after a partial refund, keep the consultation fee waived.

### S8. One sale has BC, FO, and performer contributions

- **Actor/approval:** record each actual contribution and applicable role/rule. FO collecting payment alone does not automatically establish a closing or acquisition contribution.
- **Money:** one receipt allocation is the shared basis; it must not become three duplicate receipts or three full-value sales in revenue reporting.
- **Materials/record:** one actual treatment and one consumption history regardless of the number of commission recipients; actual performer may differ from scheduled performer.
- **Commission — confirmed:** multiple eligible contributors may earn; individual override replaces the default for that scope. Fixed nominal “base commission” is not a minimum clinic margin or revenue threshold. Owner bonus is separate.
- **Confirmed:** separate guiding-BC and closing-BC commissions; one staff member may earn each contribution actually performed, never the same one twice; actual performer receives performer commission; new-patient commission belongs to the first-visit registrar/referrer; owner/manager corrections and guiding-BC reassignments are recorded.
- **Follow-up:** commission statement shows contribution, item, rule snapshot, payment basis, completion guard, adjustments, and payout—not another staff member's private earnings.

## 4. Cross-scenario failure and recovery checks

These are proposed acceptance checks, not executed software tests.

| Check | Required observable outcome |
|---|---|
| Repeated patient selection/prepare click | One effective request for the same selection version; quantities are not doubled |
| Two rooms request the last available item | Allocation cannot silently promise the same quantity twice; losing request shows a shortage |
| Issue from pharmacy to room | Pharmacy usable quantity decreases and room custody increases; this transfer is not also reported as final consumption |
| Consumption and later return | Consumed + accepted return + waste + still-held quantity reconcile to net issued quantity, in a consistent stock unit |
| Low-value supplies issued by pack | Use room-level consumption/counting OR per-treatment deduction for the same quantity, not both; estimates are labeled |
| Formula/price/commission rule changes mid-visit | Existing authorized/accepted version remains traceable; changes require explicit revised selection/authorization where applicable |
| QRIS succeeds but app response is lost | Show unresolved payment; reconcile against authoritative payment evidence before asking for payment again or retrying a charge |
| Duplicate or out-of-order payment notification | One effective payment posting; older events do not overwrite a newer confirmed state |
| Refund response times out | Keep unknown/pending outcome and investigate using the original reference before retrying |
| Staff changes or two users edit concurrently | Preserve actual author/performer; detect stale edits rather than silently overwriting approved content |
| Network fails during treatment | Do not claim unsaved changes are saved. Use an approved downtime SOP and audited later entry; no full offline app is assumed |
| Patient leaves with unpaid approved addition | Keep outstanding balance and accountable follow-up visible; do not mark paid or grant unpaid commission |
| Same family phone number | Verify the individual patient; phone matching is not permission to open every family clinical record |
| Photo is reused for marketing | Require separate applicable permission; clinical-photo access is not marketing publication consent |

Stock reconciliation above describes issued treatment materials, not a universal retail return or open-vial policy. Batch, unit conversion, usable quantity, and product-specific handling require validated master data/SOP.

## 5. Decision queue — resolve without inventing scope

### First calibration: workflow and money

1. **Added treatment before payment — decided:** clinical authorization remains separate; FO/cashier confirms the payment exception without manager approval. Patient and clinical agreement is required; payment may use patient balance or FO/cashier; no amount limit. Unpaid departure handling decided: visit-close guard, staff reminders, manual WhatsApp billing, receivable/write-off without commission; no booking block.
2. **Consultation waiver timing — decided:** a consultation-only visit stays charged even if a purchase happens later; a later purchase visit is not charged consultation. Full refund of all qualifying purchases deducts the waived consultation fee from the refund. A partial refund that leaves any qualifying purchase keeps the consultation waiver. Contraindication with no purchase remains chargeable. Control visit is not charged because it is included in the related treatment, package, or product. Control eligibility is decided: per-item free-control count and validity; default one doctor-scheduled control linked to the purchase, valid to the control date plus 7 days; package controls follow plan stages; unrelated complaints are charged; treatment-caused problems are not charged. Package-session redemption has no consultation charge unless there is a new complaint/need outside the package.
3. **Packages/installments/deposits — decided:** all three are first-release needs. Installment, minimum DP, expiry, patient-balance, and booking-DP rules are decided in the checkpoint. Installments are enabled by default and package validity defaults to 12 months from purchase. Sharing is excluded; doctor-approved substitution and pre-expiry refund to balance are decided. Still open: incomplete-session handling, and commission allocation.
4. **Interrupted care — package sessions decided:** doctor assesses medical stops; medical/clinic-caused stops do not use the session; patient-chosen stops do. Paid single treatments follow the same principle (free reschedule or patient balance; patient-chosen stop has no refund).
5. **Commission attribution — decided:** guiding BC and closing BC are separate contributions; multi-role staff earn each actual contribution once; actual performer and first-visit new-patient attribution apply; corrections/reassignments are recorded. Partial payments are allocated proportionally after discount; commission is approved and paid monthly; refunds reduce unpaid commission or next month's commission.

### Separate validation gates

- Clinical lead: permitted actions by qualification/service, delegation, absence coverage, prescribing/dispensing, clinical checklist precision, contraindications, consent versions, and product-specific open-vial handling.
- Authoritative regulatory research plus clinic applicability: RME/corrections/retention, consent/signatures, clinical scope, pharmacy, SATUSEHAT, privacy, and applicable tax/financial treatment. Earlier vendor/REG labels are not fresh legal verification.
- Product boundary: internal system versus SaaS, pilot clinic/branches, MVP boundary, booking/payment/WhatsApp integration depth. These remain open; this audit does not select a stack or repository.

## 6. Completion and next action

**Completed:** document-based walkthrough of all eight checkpoint scenarios; eight research conflicts identified; failure/recovery checks and a decision queue recorded.

**Not completed:** policy approval, clinical validation, fresh legal/source verification, authenticated vendor testing, approved MVP/PRD, technical design, implementation, or executable product verification.

Update 2026-10-31: §5 business decisions were calibrated with the user and recorded in the checkpoint; blueprint conflicts A01–A08 are annotated through blueprint §0.4. Next: clinical-lead validation, fresh regulatory verification, and product-boundary decisions before a PRD.
