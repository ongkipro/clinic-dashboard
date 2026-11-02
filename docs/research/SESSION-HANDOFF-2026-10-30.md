# Beauty Clinic System — Discovery Session Handoff

Saved: 2026-10-30 (Asia/Jakarta), following the 29–30 October discussion.
Status: discovery checkpoint, not a PRD, final MVP scope, legal assessment, or implementation report.
Purpose: preserve user decisions, proposed refinements, unresolved rules, and the next audit before pausing.

## 0. Update 2026-11-02 — read first

- **Decision register:** `DECISION-REGISTER.md` is now the authoritative list of decisions (product, business rules, WhatsApp, accounting/tax, SATUSEHAT/PSE, hosting, dashboards, personal data). It wins over any older file.
- New research added on 2026-11-02 (all research only, nothing built):
  - `INDONESIA-BEAUTY-CLINIC-MARKET-REA-REVIEW-2026-11.md` — re-review + 31-brand list + REA evidence (`rea-2026-11/`).
  - `BIG-BRAND-DASHBOARD-CRM-REQUIREMENTS.md` — big brands → decisions, KPI dictionary, role dashboards, CRM.
  - `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` — needs for 1–5 branches, system shape, WABA research, accounting feasibility; black-magic on ZAP outlet master (Booker confirmed), ERHA Digital Lounge, Oriskin (`bundles/`).
  - `COMPLIANCE-TAX-ACCOUNTING-SATUSEHAT-PSE-RESEARCH.md` — VAT/PKP, PP 20/2026, SAK EMKM/EP, SATUSEHAT and PSE obligations, vendor checklist.
- Key 2026-11-02 decisions: tenant = 1 brand = 1 PT, 1–5 branches; WABA via our own Meta Tech Provider; WA numbers per branch or per brand; accounting Level B in two steps; SATUSEHAT in first release; vendor registrations (NIB, PSE, SNOMED CT, SATUSEHAT) required; hosting Vultr + Coolify (Singapore) + Cloudflare **with the clinical-data residency condition H-02** (RME data and backups in Indonesia).
- Still open: entity name for NIB/PSE/Meta (S-04), Indonesian server provider for clinical data (H-02b), accountant/tax/clinical/legal reviews (register §9), PP 33/2026 verification.
- **Clinic Dashboard development kit** (2026-11-02): `~/Documents/work/prd/clinic-dashboard/` — spec pack 01–17 + CONTEXT-RECORD + PLAN + DESIGN.md + design brief + AGENTS draft, based on Kliniknuma and refined with this research; read its `README.md` first.
- Kit v0.2 (2026-11-02): revised after three independent reviews (`reviews/`); codebase from zero (P-09); remaining items adopted from research (P-10); full Apple-style UI, light only, tenant accent (D-14–D-16); new `18-INTEGRATION-CONTRACTS.md`.
- Kit v0.3 (2026-11-02): S-04 placeholder vendor profile (PR-55); H-02b production on Vultr Singapore (risk accepted, ARCH-9 portability, ARCH-10 legal-opinion gate H-02d); round 2 re-review by 3 agents = PASS-WITH-FIXES ×3 (`reviews/round2-*`), all findings applied; external reviews deferred by owner.
- Next step: owner review of v0.3, then `TASKS.md` via `prd-taskbreaker`. Still no development.

## 1. Resume here

The user is pausing to rest. Do not restart discovery from zero or immediately add features. Continue by auditing the agreed operational journey and exceptions against the research, then calibrate scope with the user before producing the PRD.

The product is a beauty clinic management system grounded in the user's actual intended workflow, not a generic hospital ERP or a copy of every T2 feature. No application code, final PRD, PLAN, or TASKS has been produced in this session. No clinic-specific regulatory compliance has been verified.

Important distinction throughout this note:
- **Confirmed**: explicitly stated or accepted by the user.
- **Proposed**: assistant recommendations, not automatically approved requirements.
- **Open**: unresolved business, clinical, or implementation decisions.

## 2. Existing research and precedence

Research folder: `docs/research/`.

Sources:
- `BEAUTY-CLINIC-SYSTEM-BLUEPRINT.md`: existing consolidated research blueprint; retains older vendor-derived flows that have not yet been reconciled with this discovery.
- `beauty-clinic-admin-system-research.md`: initial reverse-engineering research.
- `indonesia-beauty-clinic-system-ui-ux-research.md`: vendor/admin/public-site research.
- `indonesia-beauty-clinic-system-deep-dive.md`: workflows, fields, rules, data, regulatory research.
- `other-platforms-benchmark.md`: additional international/Asian platforms.
- `../indonesia-beauty-clinic-admin-dashboard-standard.md`: Gemini/T2 dashboard research.
- `../indonesia-clinic-management-system-standard.md`: Gemini/T2 system research.
- Evidence directories: `shots/`, `vendor-img/`, `video-frames/`, `rea/`, `bundles/`.

This checkpoint records newer user decisions, not a competing specification. During reconciliation, explicit user workflow decisions supersede conflicting research recommendations, subject to applicable clinical/legal requirements. Research labels and vendor claims are not independent proof of legal obligations. Preserve source evidence; do not silently rewrite it as user requirements.

## 3. Confirmed operational journey

1. Patient arrives as a walk-in or through online booking and registers/checks in.
2. A beauty consultant (BC) accompanies the patient, records preliminary history/intake, takes before photos, records skin analysis, and discusses possible products/treatments.
3. The doctor reviews the preliminary record, examines the patient, gives advice, and creates a staged care plan (weeks/sessions), product/supplement choices, and annotations on a face sketch.
4. The patient may return to the BC to discuss budget, select part/all of the plan, defer, or decline.
5. If proceeding with treatment, obtain digital consent/signature for the agreed action. Commercial acceptance and clinical consent must not be conflated in the eventual design.
6. Front office receives payment before the initial treatment.
7. Pharmacy prepares materials/products; treatment-room staff check received materials and start a timer.
8. During treatment, additional treatment may be proposed by the BC when needed. It requires appropriate clinical authorization and patient agreement. Additional payment may occur after treatment or in the room using EDC/QRIS handled by front office.
9. Staff may return unused materials. After photos are taken following treatment.
10. Complete remaining payment/dispensing and arrange follow-up. Front office can perform CRM/follow-up.

### Confirmed role boundaries

- BC is a non-medical patient companion, not a healthcare professional.
- BC clinical proposals require approval by authorized clinical personnel, including doctors where required.
- BC intake is not an independently finalized diagnosis, prescription, or treatment order.
- The user expects qualified personnel in the treatment room to authorize additions when the doctor is absent. Exact permitted actions/delegation remain a clinical-validation gate; do not assume any clinical staff member may authorize any treatment.

### Confirmed additional-treatment payment exception

- Clinical authorization for an additional treatment remains with authorized clinical personnel.
- FO/cashier confirms the exception allowing the approved addition to start before its additional payment is received.
- Manager approval is not required for this exception.
- The system should record who confirmed the exception and who is responsible for collecting the outstanding balance.
- An additional treatment occurs only after both the patient and the authorized clinical personnel agree. The patient's recorded agreement is the commercial commitment.
- The additional treatment may be paid from patient balance or through FO/cashier (including in-room EDC/QRIS).
- No unpaid-amount limit is required.
- Prevention of leaving unpaid (approved):
  - Core feature: once patient and clinician agree, FO/cashier is notified; deduct patient balance if sufficient, otherwise FO collects in the room by EDC/QRIS.
  - Core feature: a visit cannot be marked completed while any bill remains unpaid.
  - Core feature (user addition): staff reminder for unpaid additional treatments/products. Approved form: in-app alert to FO/cashier when the addition is approved, a repeat alert when the treatment is finished but still unpaid, and an always-visible outstanding-payments list until settled. No external staff messaging integration required.
  - Clinic SOP: room staff escort the patient to FO; purchased products/medicines are handed over at the cashier after payment.
  - Fallback: FO manually sends bill details plus clinic QRIS/bank account via WhatsApp; if still unpaid, record a patient receivable shown on the next visit. Owner may write it off with a record; no commission is paid for written-off items. No booking block for receivables.

### Confirmed first-release payment capabilities

- Treatment packages, installments/down payments (DP), and patient deposit/balance are all required from the first release because customers pay in different ways.
- Research check: existing evidence includes package-session tracking (DocterIT, ICONIX, Aoikumo), package installments/minimum payment (ICONIX), partial/DP invoice status (Klinik Pintar), and deposits/booking fees used as payment (Assist, Kasera). This confirms market precedent, not this clinic's specific policy.
- Keep booking/DP deposits distinct from stored patient balance in the design. Package entitlement, installment receivable, and deposit balance must remain separate records.
- For a package bought by installment/DP, the patient may redeem sessions before full payment only up to the number of sessions covered by the amount actually paid. Rationale: clear revenue recognition and healthy clinic finances.
- Session value for that limit:
  - Same treatment across all sessions: package price divided equally by the number of sessions.
  - Mixed treatments: allocate package price across included treatments in proportion to their normal prices.
  - A session becomes redeemable only when the cumulative actual payment covers its full allocated value.
  - In a mixed package, the patient may choose which session to redeem, provided the total allocated value of redeemed sessions plus the selected session does not exceed actual payments. The choice must still follow the doctor's care-plan stages.
- Default minimum DP for an installment package equals the allocated value of the first session to be redeemed. Each package has one optional `Minimum DP (%)` field. If empty, use the first-session value. If filled, minimum DP is the greater of the first-session value and that percentage of the package price. No global percentage setting, approval flow, or extra rule table.
- Installments have no due-date schedule, interest, or late fee. The patient may pay any amount at any time; sessions unlock according to cumulative actual payment. Each package has a validity period. Show outstanding balance, redeemable sessions, and package end date for FO follow-up.
- At package expiry: the paid-but-unused value (actual payments minus allocated value of redeemed sessions) moves to patient balance; the unpaid remainder is cancelled and is not a patient debt; the package closes. Example: Rp5,000,000 / 5 sessions, Rp3,000,000 paid, 2 sessions used → Rp1,000,000 to balance and Rp2,000,000 unpaid remainder cancelled. Vendor evidence (ICONIX return to deposit) is precedent, not the source of this decision.
- Patient balance has no expiry, extension flow, or extension approval. It can pay for treatments, products, packages, and installments. It is not ordinarily cash-withdrawable; exceptional refunds (for example relocation) are manual owner/manager refunds recorded in the system. Assist's 90-day deposit expiry remains vendor evidence only.
- Booking DP is optional per treatment and disabled by default; enable it for long or expensive treatments. On arrival, apply it to that visit's bill. Patient cancellation/reschedule at least 24 hours before the appointment moves it to patient balance. No-show or patient cancellation under 24 hours forfeits it as compensation for the held slot. Clinic cancellation always moves it to patient balance, or refunds it if the patient requests.
- All packages allow installments by default; the clinic can disable installments for a specific package.
- Package validity is required on every package, defaults to 12 months, is editable per package, and is counted from the purchase date. Vendor evidence showed per-package validity in days/months but no standard duration.
- Packages cannot be shared because treatment depends on each patient's condition. Family sharing is excluded.
- Treatment substitution is allowed only with doctor approval. The unused session value becomes credit for the replacement; the patient pays any higher difference, and any lower difference goes to patient balance.
- Pre-expiry package refund/cancellation: paid-but-unused value goes to patient balance; unpaid remainder is cancelled. Cash refund is an exception only (for example medical reason or relocation), approved by owner/manager and recorded.

### Confirmed interrupted package-session policy

- Medical stop (for example a reaction), assessed by the doctor: the session is not counted as used; the patient may continue later.
- Patient chooses to stop: the session is counted as used because slot, staff time, and materials were used.
- Clinic-caused stop (for example equipment failure or material shortage): the session is not counted as used; reschedule the patient.
- Materials actually consumed are recorded as consumption in every case.
- Performer commission is earned only when the session is counted as used. This refines the earlier completion guard: a patient-chosen stop counts as used for performer commission.
- Paid single treatment outside a package follows the same principle: medical or clinic-caused stop allows rescheduling at no extra charge, or moves the payment to patient balance if the patient does not continue; patient-chosen stop counts as completed with no refund; actual materials are recorded; performer commission applies when it counts as completed.

### Confirmed consultation-fee policy

- Consultation is charged when the patient only consults and buys/uses nothing.
- Purchase of products or use of services qualifies for consultation-fee waiver; package purchase was included in the agreed working interpretation.
- A consultation-only visit remains chargeable even if the patient later buys a product or treatment. A later purchase does not refund or retroactively waive that earlier consultation fee.
- For a later visit where the patient makes an eligible purchase, the consultation fee for that purchase visit is waived.
- If every purchase that qualified the visit for the waiver is fully refunded, the waived consultation fee becomes chargeable and is deducted from the refund.
- If at least one qualifying product or treatment purchase remains after a partial refund, the consultation fee remains waived.
- If the doctor determines the patient cannot undergo the desired treatment and the patient buys nothing, the consultation fee remains chargeable.
- A control visit has no consultation charge because it is included in the related treatment, package, or product purchase.
- Free-control policy (user-approved after the assistant noted that the research provided no market standard):
  - Configure on each treatment/product master: number of free controls and validity period.
  - Initial default: one free control per purchase of a treatment/product that requires control.
  - The control must be scheduled or instructed by the doctor and linked to the related purchase.
  - Valid until the doctor-set control date plus a 7-day tolerance.
  - Package controls follow the doctor's planned stages.
  - A new complaint/need unrelated to that purchase is an ordinary consultation and chargeable.
  - Additional controls the doctor determines are needed for a reaction, complication, or problem caused by that treatment are not charged.
- A visit solely to redeem an already-purchased package session has no consultation charge, provided there is no new complaint/need outside that package; an unrelated new complaint/need is an ordinary chargeable consultation.

### Confirmed usability needs

- Doctor must see previous visits/history while examining the current visit, without navigating many screens.
- Pharmacy preparation lists must populate automatically from patient-approved services/products; do not require manual list creation.
- Pharmacy needs minimum-stock/restock reminders, including routine materials such as cotton.
- Treatment-room recording should use checklists wherever safe and avoid burdening nurses/therapists during procedures.
- Centralized master data is required.
- BC has quantity and/or revenue targets; exact quantity metric remains to be defined.

## 4. Confirmed commission model

The user explicitly accepted the proposed simple model and clarified the meaning of the lower bound.

- Role-based default rules, with individual staff overrides for the same scope.
- Staff override replaces the default; it does not automatically stack with it.
- Eligible contribution can include closing/assisting a sale, acquiring a new patient, follow-up leading to a transaction, and performing a treatment.
- Percentage OR fixed amount per eligible service/product scope.
- Basis: actual patient payments received, not merely invoiced sales.
- Percentage basis proposed and accepted in the model: eligible allocated payment after discount, excluding tax; exact allocation rules remain to be specified.
- Initial fixed-amount rule: entitlement after the relevant item is fully paid.
- Performer commission additionally requires actual treatment completion.
- Deposit top-up alone does not create service/product commission; eligible spending does.
- Multiple contributors may earn on the same transaction if policy and recorded contribution permit it; no automatic full payout to everyone.
- Owner-approved discretionary bonus is separate from regular commission.
- Refunds create commission adjustments, including adjustments when already paid out; no erasing history.
- Preserve the applicable rule/rate snapshot so future changes do not recalculate historical entitlements.
- Staff see their own commissions; authorized roles manage rules and payouts.
- Quantity/revenue targets are separate from commission entitlement.

**Resolved ambiguity:** “batas bawah” means a staff base commission represented by a fixed nominal amount. Example: IDR 200,000 fixed commission on a particular service for a particular staff member, with an optional separate bonus. It is NOT a minimum retained clinic amount, monthly revenue threshold, or patient-payment threshold. Do not add a separate lower-bound mechanism.

Confirmed attribution rules:
- Contribution types are guiding BC, closing, new patient, and performer.
- A staff member holding multiple roles may earn for each contribution actually performed, but the same contribution is never counted twice.
- Performer commission goes to the staff member who actually performed the treatment, not the originally scheduled performer.
- New-patient commission goes to the staff member who registered or brought the patient on the first visit.
- Owner/manager may correct attribution; corrections are recorded.
- The proposed "last BC before transaction receives follow-up" rule was rejected as potentially unfair: the BC who guided the patient earlier may differ from the BC who closed. Replaced by the approved split:
  - Guiding BC: the BC who first accompanies the patient and prepares guidance based on the doctor's care plan.
  - Closing BC: the BC who actually completes the transaction.
  - The same BC may receive both commissions; different BCs receive their respective commissions.
  - Guiding-BC attribution applies to all transactions under that care plan until it is completed or replaced by the doctor.
  - Owner/manager may reassign the guiding BC (for example resignation or handover); the change is recorded and applies to subsequent transactions.
  - The clinic configures guiding and closing commission amounts in commission rules; no manual percentage split.

Confirmed settlement rules:
- Partial payment on one invoice is allocated across items in proportion to each item's value after discount. Packages use the agreed session-value rule.
- Commission is paid monthly. Owner/manager reviews and approves the commission list, then marks it paid. The system does not calculate payroll.
- Refund adjustment: unpaid commission is reduced automatically; already-paid commission creates a recorded deduction from the next month's commission. Historical commission records are never deleted.

Doctor compensation (confirmed): doctors receive a fixed salary plus commission. Fixed salary stays outside the system (no payroll); doctor commission uses the same commission rules as other staff.

Consultation commission (confirmed): research shows vendors support configurable doctor fees per service including consultation (ICONIX) but no universal standard. Treat Consultation as a normal service with an optional rule, default none; only paid consultation fees qualify; waived consultations (purchase visit, control, package session) earn no consultation commission.

## 5. Proposed product structure and interaction refinements

These are recommendations discussed with the user, not a final approved screen specification.

### One shared visit, different role workspaces

A visit connects intake, clinical review, care plan, patient selection, consent, payment, materials, execution, photographs, dispensing, follow-up, and commissions. Avoid re-entry between departments.

Keep distinct:
- Recommended care versus selected/consented services.
- Paid items versus performed treatment.
- Materials allocated/issued versus actually consumed.
- Commission entitlement versus staff payout.
- Multi-visit care plan versus commercial package.

Role workspaces: front office; BC; doctor; treatment room; pharmacy; cashier; manager/owner. One employee may have multiple roles but does not automatically receive all permissions.

### Doctor workspace

- Persistent identity and important clinical warnings.
- Current BC intake, doctor examination, face sketch, and plan in the main area.
- Same-screen history panel with recent visits, active plan, actual treatments, prescriptions/products, photos, and unresolved complaints.
- Open older visit details without losing current edits; compare photos in context.
- Historical findings are references, not copied as today's findings automatically.

### Automatic pharmacy list

- Clinically authorized plan plus patient-selected items generates preparation requests.
- Services expand through their master material formula; products expand by approved quantity.
- Individualized doses/quantities come from authorized instructions, not blindly from defaults.
- Request visibility is distinct from permission to issue; show payment/authorization readiness.
- Additions append only incremental requirements.
- Cancellation before preparation cancels requests; after issue requires reconciliation/return handling.
- Patient acceptance must not post actual consumption.

### Inventory and replenishment

- Per-item minimum level and target level, appropriate stock unit, low-stock list, and suggested replenishment quantity.
- Account for reservations and pending purchases; avoid duplicate reorder suggestions.
- Start with reminders/draft purchasing requests, not automatic purchasing or AI forecasting.
- Standard replenishment, goods receipt, expiry checks, and stock count remain necessary.

### Low-burden treatment checklist

Auto-fill patient, approved treatment, scheduled performer, issued materials, instructions, and consent/payment status.

Before start: confirm identity/treatment, required authorizations, materials/condition, and performer. Record only discrepancies. Start timer explicitly.

During treatment: quick actions for extra materials, proposed extra treatment, and pause/resume; no long mandatory form during routine execution.

At completion: actively confirm performed-as-planned or record variation/incomplete treatment; review standard consumption and record deviations only. Timer expiry must never automatically complete treatment or consume all issued stock.

Three material classes:
1. Common low-value supplies: issue by pack to room plus counts/replenishment, OR a standard per-treatment model; choose one coherent method. Do not demand counting every cotton pad.
2. Predictable per-treatment materials: prefilled standard list with explicit confirmation and exception edits.
3. Clinically significant/high-value materials: actual quantities, relevant batch and clinical parameters must remain precise.

Returns require item/quantity and pharmacy acceptance. Unopened eligible stock may return to usable stock; opened material follows product/SOP rules; contaminated/damaged material is waste; uncertain material is held pending review.

Pack issue is not proof the pack is fully consumed. If consumption is estimated, label reports accordingly. Never deduct the same supply twice through both room issue and per-treatment consumption.

### Candidate module groups

Patient/visits; BC accompaniment; clinical/RME; treatment execution; pharmacy/inventory; cashier/transactions; CRM/follow-up; staff/targets/commissions; reporting; centralized masters/settings.

These are functional groups, not a commitment to ten separate apps or a fixed page count.

## 6. Research calibration and corrections to earlier advice

Do not carry earlier unsupported certainty into the specification:
- Absence of an observed vendor feature is not proof it is unnecessary.
- Therapist scheduling conflicts still need prevention; a shift roster alone is insufficient.
- Reserve resources actually required by the service, not all four for every booking.
- Clinical authority cannot be fully represented by one generic three-way service dropdown without validated scope/delegation.
- Open-vial expiry/BUD must follow the actual product and validated SOP; prior blanket 24-hour/28-day assumptions are not approved rules.
- Refill cooldown percentages, pharmacy check counts, photography comparability algorithms, and triage SLAs are not universal requirements merely because T2 states them.
- Lack of staffing is not a reason to bypass professional dispensing/approval requirements.
- Regulatory restrictions must not become optional settings simply for convenience.
- Commission refund adjustments are necessary from the start if refunds exist; sophisticated automation may wait.
- Revenue/liability dashboard figures require underlying reliable records; they are not just three manually maintained numbers.
- A basic outbox is not proof of production SATUSEHAT compliance.
- Device calibration/accreditation duties, where applicable, do not vanish because a dedicated software module is deferred.

Proposed exclusions/deferments unless validated need emerges: AI diagnosis, direct skin-analyzer integration, 3D face mapping, laser hardware integration, full omnichannel inbox, unrestricted commission formulas, payroll/full accounting, complex multi-branch commerce, full native patient app, and advanced loyalty/marketing automation.

Online booking remains a user need. It does not imply a large marketing site, ecommerce system, or complete patient portal in the first release.

## 7. Pending audit — next work, not completed results

Resume update (2026-10-31): business-rule calibration with the user is complete for payment, consultation fee, controls, packages/installments/balance/booking DP, interrupted treatment, and commission (see §§3–4). The blueprint now carries these as §0.4 overrides with conflicting sections annotated; vendor evidence is preserved. Remaining before PRD: clinical-lead validation, fresh regulatory verification, and product-boundary decisions (§8).

Next step chosen by the user (2026-10-31): validate the agreed workflows visually in Google Stitch before writing a PRD. Prompt pack: [STITCH-PROMPTS.md](STITCH-PROMPTS.md) (8 screens). Detailed BC role specification with user stories, actions, edge cases, and 7 Stitch prompts: [BC-SCREEN-SPEC.md](BC-SCREEN-SPEC.md); its [P] items are proposals awaiting confirmation. MVP scope and pilot criteria remain proposals until confirmed.

Earlier update: the document-based walkthrough of all eight scenarios is now recorded in [OPERATIONAL-SCENARIO-AUDIT.md](OPERATIONAL-SCENARIO-AUDIT.md). It identifies conflicts with the older blueprint, proposed controls, and unresolved decisions. This completes the scenario desk-audit step only; user calibration, clinical validation, and fresh regulatory verification remain pending. Confirmed decisions in §§3–4 are unchanged.

### High-priority checks

1. **Stock lifecycle:** patient selection -> request -> allocation -> issue -> actual consumption/return/waste. Prevent double deductions and duplicated additions.
2. **Checklist safety:** distinguish routine supplies from precision-required clinical materials; do not disguise estimates as actual consumption.
3. **Plan/consent versioning:** track what changed, clinical authorizer, patient agreement, price, and required consent updates.
4. **Clinical authority:** validate BC limits, prescribing, execution, delegation, and authorization of additions with the responsible clinical lead.
5. **Consultation waiver exceptions:** later-day purchase, full/partial refund, contraindication, and control-visit charging are now decided in "Confirmed consultation-fee policy" above. Control eligibility and existing package-session charging are also decided. No consultation-fee exception from this checklist remains open.
6. **Commission lifecycle:** allocation, attribution, package/session handling, staff changes, refund adjustments, entitlement versus payout.
7. **History/privacy:** preserve authorship and versions; least-privilege access; separate clinical-photo use from marketing permission; shared phone does not grant access to all family records.
8. **Failure/recovery:** repeated clicks, payment success with app failure, network interruption, stock shortage, partial treatment, and unpaid additions.
9. **Regulatory verification:** current official sources and clinic applicability for RME, retention/corrections, signatures/consent, pharmacy/BUD, clinical scope, SATUSEHAT, privacy, taxation and financial treatment. Not yet performed for this proposed product.

### Scenario walkthroughs to perform

For each, trace actor -> approval -> money -> materials -> clinical record -> commission -> follow-up:
1. New patient buys products only.
2. New patient prepays and completes treatment normally.
3. Additional treatment is approved in the room.
4. Consultation only.
5. Returning patient / package session.
6. Cancellation or interrupted treatment.
7. Material return plus payment refund.
8. One sale attributed to BC, FO, and performer.

Include retries/double submissions and payment reconciliation. A temporary outage SOP with audited later entry may be more appropriate than building a full offline application initially.

## 8. Decisions still open beyond the flow

- **Decided (2026-11-02, later):** one tenant = one legal entity (PT); we register as Meta Tech Provider ourselves; WhatsApp numbers per branch or per brand, chosen per clinic.
- **Decided (2026-11-02):** one client (tenant) = one brand with multiple branches (no multi-brand tenant); first target segment = mid-size clinics with 1–5 branches; WhatsApp via WhatsApp Business Platform (WABA/Cloud API); accounting module if feasible (feasibility and scope in `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` §6). Payroll remains out. Instruction: research only, no development.
- **Decided (2026-10-31):** product is a multi-tenant SaaS sold to beauty clinics; each clinic (tenant) may have multiple branches. Tenant data isolation is mandatory; branch is a scope inside a tenant.
- **Decided — multi-branch (within one tenant):**
  - Patient data, clinical history, patient balance, and packages are shared across all branches of the same clinic; no re-registration per branch.
  - Stock is tracked per branch; inter-branch transfers are recorded.
  - Treatment/product master and prices are shared across branches; owner may set branch-specific price overrides.
  - Staff may be assigned to multiple branches; schedules and work are recorded per branch.
  - Access scope: owner sees all branches; manager may be scoped to one, several, or all branches; other staff access only their assigned branches. Clinical staff may open the patient's full clinical history at any branch where the patient is being served.
  - Reports are available per branch and consolidated.
  - Package bought at branch A, redeemed at branch B: sales revenue recorded at A; execution, performer commission, and material consumption recorded at B; guiding/closing BC commissions go to the entitled BCs regardless of branch.
- No multi-branch rule from this checklist remains open.
- **Decided — per-tenant configurability** (defaults = the decisions in §§3–4):
  - Configurable per clinic: consultation fee and waiver conditions; free-control count and validity; package validity, minimum DP, and installment availability; booking DP on/off and cancellation cutoff (default 24 h); commission amounts per role and service; who may approve cash refunds (owner only, or owner and manager).
  - Fixed product rules: sessions redeemable only within paid value; commission based on actual received payment; no double stock deduction and no stock deduction from recommendation; no deletion of clinical, transaction, or commission history (corrections recorded); additional treatment requires patient and clinical agreement; a visit cannot close with an unpaid bill; complete tenant data isolation.
  - Do not add further settings at launch; add one only when a real clinic needs it.
- **Decided — project identity:** this is a new, standalone project. It is separate from `~/Projects/kliniknuma` (a different single-brand clinic project). Do not reuse, fork, or derive from its code, PRD, tasks, decisions, or design, and do not modify that repository for this work.
- Actual pilot clinic and its branch count. Proposed pilot criteria (pending approval): 1–2 branches; a resident doctor willing to validate clinical rules; currently using spreadsheets/paper or dissatisfied with current software; actually uses packages, installments, and BC commissions.
- Product name, repository/slug, and technical stack.
- Final MVP boundary; earlier counts of 75/80/90 capabilities and page counts are not commitments.
- Payment gateway/WhatsApp integration depth and launch readiness.
- SaaS commercial model (subscription plans, onboarding/data migration) — not yet discussed.
- Regulatory implementation gates and actual authorized clinical roles.
- Detailed permission matrix and BC target definitions. (Package/installment/deposit, refund/cancellation, attribution, and payout rules are decided in §§3–4.)

## 9. Next-session instruction

Read this checkpoint and the linked research sections. Start with the scenario audit and unresolved rules, not another feature inventory. Preserve confirmed commission decisions and the non-medical BC boundary. Explain differences between approved decisions and recommendations. Reconcile the existing blueprint after user-approved calibration; only then produce the agreed planning artifacts. No implementation, deployment, or Git actions are authorized by this checkpoint. Since 2026-11-02, start from `DECISION-REGISTER.md` and §0 above.
