# Round 4 review A — navigation and page catalogue (19)

- Reviewer: cx/gpt-6.1-sol:high via direct pi run (read only), 2026-11-02.

# Verdict: **BLOCK**

The catalogue is a strong structural foundation, but it is **not yet a complete, implementable Release 1 catalogue** under the owner’s “full research-based product, no narrowing” decision.

The principal blockers are:

1. Research-backed functionality remains deferred to R1.1 or later.
2. Essential configuration and operational surfaces are missing—notably the service master, depot management and supplier payables.
3. Some role visibility contradicts `07`, while other entries are too broad to implement safely.
4. The settings registry does not yet cover the operational choices represented in the research.

This is a **planning-document review**, not evidence of an implemented authorization vulnerability. References to `17`, `PLAN`, CD-* and other unavailable documents cannot establish that missing details are covered elsewhere.

## Findings

**P1:** release completeness or authorization-contract blocker.  
**P2:** material implementation gap or ambiguity.  
**P3:** documentation consistency.

| ID | Severity | Evidence section / ID | Problem | Smallest fix |
|---|---|---|---|---|
| F01 | **P1** | `19` §§2.3, 2.6, 2.8, 2.11–2.13; research §§5.2, 7.12 | **Release narrowing remains.** Waitlist, logbook, vouchers/promos, campaigns, reviews/surveys, reconciliation, expenses, ledger/period locking and scheduled reports are deferred. These are research-backed and not among the instructed exclusions. Article CMS is also effectively deferred through §4. | Move the applicable capabilities into R1 and identify their owning pages. Keep genuine exclusions explicit; do not use R1.1 labels to narrow the owner-approved scope. |
| F02 | **P1** | Research §5.2, Pengaturan › Master layanan; `19` §§2.8, 5 SET-4/5/28/32 | **No complete service/treatment master page.** Package templates and individual settings do not provide a service list/editor covering category, resources, permitted staff, branch prices, tax class, BHP recipe and consent linkage. | Add **Layanan & Perawatan → Daftar / Detail / Editor**, including the research fields and clinical-review versus commercial-edit permissions. |
| F03 | **P1** | Research §§5.2 Apotek/Keuangan, 7.9; `19` §§2.9, 2.12 | **Depot management and supplier payables are missing.** Cross-branch transfers do not cover intra-branch depot movements. “Utang Layanan” describes prepaid service liabilities, not supplier accounts payable. | Add warehouse/depot management and intra-depot transfers; add supplier invoices, outstanding balances, due dates and payment allocation under **Utang Pemasok**. |
| F04 | **P2** | Research §§5.2, 7.3, 7.8; `19` §§2.3–2.4, 2.7–2.8 | Missing group/corporate booking, referral tracking, patient voucher/review views, and explicit family package sharing. Guardian relationships alone do not implement entitlement sharing. | Add bounded routes/tabs/actions for these jobs. Referral tracking need not introduce excluded loyalty points or tiers. Specify separate guardian, beneficiary and package-sharing permissions. |
| F05 | **P2** | Research §5.2 Marketing, §7.11; `19` §2.11, SET-18/19/22/23 | Automation coverage is incomplete: birthday, refill and configurable post-treatment follow-up timing are absent. Inbox content omits price-list attachment and bot/human handoff. The on-demand dashboard AI summary in §5.2 is also absent; it is distinct from the excluded AI scribe. | Add these capabilities to the relevant pages, or obtain an explicit owner exclusion. Keep operational AI separate from clinical documentation AI. |
| F06 | **P2** | Research §§7.4–7.5; `19` §2.5 | **Clinical content is too abbreviated.** Missing explicit vitals, Fitzpatrick/skin assessment, contraindications, dose per map point, draft autosave, signing lock and amendment behavior. Photo comparison omits collage/export consent handling. | Expand the examination and photo rows with these fields, transitions and guards. Do not treat “SOAP”, “map” and “sign” as sufficient specifications. |
| F07 | **P2** | Research §§4.2, 5.2 Ruang Tindakan, 7.14; `19` §§2.2, 2.6 | Treatment/logbook/TV content is thin: no distinct prep/numbing/treatment stages, B3 waste entries, TV orientation or voice-call configuration. | Name the timer stages and logbook entry types; specify TV landscape/portrait and privacy-preserving voice calls. Do not assume the research’s promotional slideshow is legally acceptable. |
| F08 | **P2** | Research §§7.1, 7.6, 7.8, 7.10; `19` §§2.3, 2.7–2.10 | Several core workflows lack necessary controls: calendar duration resizing and conflict alternatives; explicit voucher redemption, VA/e-wallet coverage and POS remarks; offline policy; package share/swap/refund paths; commission priority, effective period and payout status. | Add the missing actions/states to the existing rows. For offline POS, specify either a supported recovery model or a clear online-only policy—do not leave it undecided. |
| F09 | **P2** | Research §§5.2 Laporan, 6, 7.12; `19` §§2.1, 2.13 | Reports and role homes do not fully carry the research content. Examples: patient churn/top spender/LTV, campaign/promo performance, owner average ticket/new-versus-returning/no-show measures, and doctor unsigned-record/follow-up alerts. | Add the missing metrics to named reports and role landing surfaces, with definitions and role-safe projections. Not every metric needs a separate page. |
| F10 | **P1** | `19` §2.5 Rencana Perawatan; `07` matrix: Examination, plan, sign; IAM-5 | **BC is explicitly given care-plan view**, while `07` gives BC no examination/plan/sign capability. A clinical plan and a non-clinical quotation are not interchangeable. | Specify a BC projection containing selectable services, commercial status and prices only; exclude SOAP, diagnosis, dose and clinical rationale. If broader access is intended, resolve it explicitly in `07`. |
| F11 | **P2** | `19` §§2.7, 2.10–2.11, 2.14–2.16; `07` capability matrix | **Permitted roles are omitted from relevant navigation.** Examples include manager/owner inbox access; manager and limited owner/finance/auditor cashier/receipt access; records-officer audit access; Admin Pusat/auditor server-invoice and vendor-access views. Conversely, “Saya (every role)” lists commission and target without qualification. | Reconcile page visibility against `07`, distinguishing operate, prepare, approve, read and own-only access. Hide personal commission/target entries where `07` grants none. |
| F12 | **P1** | `19` §§2.5, 5 SET-28/30/32; `07` matrix, IAM-8/11 | **Clinical governance permissions are internally unresolved.** `19` lets the facility head edit clinical templates/delegation, but the matrix gives that role no Templates & reminder rules capability. `19` gives managers service complaints, while Complaint tasks gives managers none. | Amend `07` with explicit **clinical-template governance** and **service-complaint** capabilities, then mirror them in `19`. Preserve the research-supported jobs rather than deleting them to fit a coarse matrix. |
| F13 | **P2** | Research §7.13; `19` §§2.10, 2.14–2.16, SET-34/35; `07` IAM-7/11/13 | User/role administration lacks a permission-matrix surface, administrator session controls and duty-assignment workflow. SET-35 allows 60–600 seconds, but IAM-7 specifies locking after 120 seconds. SET-34’s shorthand also obscures protected role changes and prohibition on self-role changes. | Add an access-administration page, explicitly read-only for fixed policy where appropriate. Reconcile the idle-lock policy. Include protected-role approval, self-change prohibition and IT/data-protection duty assignment. |
| F14 | **P2** | Research §5.2 Pengaturan; `19` §§2.15, 5 | The registry does not cover several researched operational settings: booking/refund/no-show policies, payment fees, queue configuration, expiry alerts, automation timing, approval routing and several integration configurations. NAV-6 says nothing outside the registry is configurable. | Add SET rows for the missing adjustable policies and configurations; map every editable control to its SET row. Separate configuration data, editable policies and fixed invariants. |
| F15 | **P2** | Research §§4.2, 5.2 Pengaturan; `19` §2.14, SET-1/32/34; `07` IAM-13 | Privacy/IT coverage is incomplete: no clinic-wide consent ledger, breach register or processor register; no clear clinic backup-status/request surface. Clinic profile content omits the research’s licence, NIB and PJ fields. | Add these as pages or explicit tabs, with duty-gated access. Backup visibility/request capability does not imply granting tenants unrestricted production restore access. |
| F16 | **P2** | `19` §5, especially SET-12/30/32/33; `07` IAM-4/10/11/14 | The general “class F is fixed” statement is good, but sensitive settings lack local immutable guardrails. Clinical delegation, document templates, approval settings and numbering patterns could otherwise be implemented too broadly. | State that settings cannot override clinical credentials/competence, required clinical/legal content, mandatory independent approval, historical identifiers, uniqueness or posted financial records. Apply numbering changes prospectively only. |
| F17 | **P2** | `19` §5 SET-13/16/33/36 and registry rules | Some defaults lack an identified research/owner source: the 30-day/2-hour booking window, numbering pattern and public-price visibility. Rp50,000 is explicitly a proposal, not an established research default. Other CD-* defaults are cited but cannot be verified from the supplied files. | Add provenance per default: research section, approved owner decision, tenant input or **proposal awaiting approval**. “Restore default” must distinguish an approved default from an unapproved proposal. |
| F18 | **P2** | `19` §5 SET-4/7–12/15/18/23/25/30/32/33 | Types and bounds are incomplete or ambiguous. Treatment duration can be zero; “Off” versus zero minutes is unclear; discount “10% **or** Rp500,000” has no evaluation rule; day-list settings lack validation; “—”, “Clinical review” and “Versioned” are not bounds. Package validity in months loses the research editor’s day-level granularity. | Define typed schemas and cross-field rules. Allow zero prep/buffer but require positive appointment duration. Define discount-limit precedence, disabled states, timezone handling and valid reminder lists. Support day-level package validity. |
| F19 | **P2** | `19` NAV-2/3, §§2.4–2.5, 2.11, 2.13; research §§7.1, 7.4, 7.11 | **Responsive navigation is only a shell rule.** Three-pane inboxes, clinical workspaces, numerous patient tabs and report tables have no phone/tablet adaptation. “Menu” versus last-tab “Saya” is inconsistent. No landing/navigation mapping is supplied for all 16 matrix roles. | Add a 16-role landing/navigation table and compact/regular behavior for these dense pages. Use phone agenda views, inbox list→thread→context navigation, progressive patient sections and tablet focus modes. Standardize Menu/Saya naming. |
| F20 | **P2** | `19` §3; `07` IAM-9/10 | Vendor pages are too thin for consequential actions. “Tenant”, “Tagihan” and “Sesi Dukungan” do not enumerate suspension/exit, fee change, invoice waiver or clinical-data grant request/checker flows. Generic “Vendor” visibility is not an action-permission specification. | Add these actions and states to the existing vendor detail pages, including requester/checker separation and the explicit support-session boundary. |
| F21 | **P3** | `19` §§2.15, 6–7 | The R1 count mixes route pages, segments and deferred entries, so approximately 118 does not demonstrate coverage. The payment integration row uses “Pengaturan” rather than a UX-* identifier despite the traceability claim. | Produce a counted inventory with stable page IDs, surface type, release, roles and owning contract. Replace the unresolved contract reference. |

## Missing pages or explicit page-level surfaces

These **do not all need new top-level menus**. Tabs, editors and detail subpages are acceptable where their ownership and content are explicit.

### Missing from the current inventory

- **Service/treatment catalogue and editor**, including BHP recipes and resource/staff eligibility.
- **Warehouse/depot management**, stock-by-depot and intra-branch depot transfers.
- **Supplier payables**: invoices, due balances, payments and credit allocation.
- **Group/corporate booking** and company-invoice handling.
- **Referral tracking**, without introducing excluded loyalty mechanics.
- **Access administration**: role/capability view, staff sessions and duty assignments.
- **Privacy/compliance workspace**: clinic-wide consent ledger, breach register and processors.
- **Clinic backup status/request surface**.
- **Non-courier integrations** from the research: email, Google Business and accounting configuration/status.
- Explicit patient-profile surfaces for **vouchers and reviews**, and a **family package-sharing workflow**.
- Explicit **automation/scenario editor** covering birthday, refill and scheduled follow-ups.
- On-demand **operational AI summary** and inbox **human/bot handoff**, unless expressly excluded by the owner.

### Present, but unavailable in R1 as currently labelled

- Waitlist.
- Sterilization/calibration/**B3 waste** logbook.
- Promo codes/vouchers.
- Campaigns and segments.
- Reviews and satisfaction surveys.
- Payment/bank reconciliation.
- Operating expenses and petty cash.
- Ledger, manual journals and period locking.
- Scheduled report delivery.
- Article CMS.

The public-site legal restrictions should remain respected; internal promo administration does **not** automatically authorize public advertising.

## Missing settings

| Setting family | Required adjustable content / boundary |
|---|---|
| **Service configuration** | Category, room/device needs, eligible staff, BHP recipe, consent-template linkage and relevant price/tax mapping. Fixed clinical eligibility checks remain enforced. |
| **Clinic/facility profile** | Licence identifiers, NIB, PJ and required facility identity fields—not just branding. |
| **Booking policies** | Cancellation behavior, no-show handling, booking-DP amount/type, deposit refund/forfeiture conditions, rescheduling outcomes and any staff-selection fee. |
| **Packages** | Family sharing/beneficiary eligibility and swap/transfer policy, subject to fixed entitlement and financial-integrity rules. |
| **Payments and approvals** | Payment-channel configuration/fees; approval routing and thresholds for voids, backdating, stock variance and procurement returns. Mandatory maker-checker controls must not become optional. |
| **Queue/TV** | Counter/room mapping, layout/orientation, voice-call behavior and privacy-safe display choices. |
| **Inventory** | Depot/location setup, near-expiry alert windows and operational alert recipients. BUD/expiry safety limits must not be freely extendable clinic preferences. |
| **Communication automation** | Reminder/follow-up offsets, aftercare timing, birthday/refill/reactivation scenarios, campaign frequency caps and relevant sending windows. Meta capacity limits are not a substitute for patient-level frequency controls. |
| **Privacy and consent** | Consent purposes and optional communications choices; documented retention schedules within applicable legal floors and hold requirements—not a switch to shorten mandatory RME retention. |
| **Integrations and reporting** | Email, Google Business/accounting connections, appropriate status controls, report recipients and delivery channels. |
| **Staff targets/commission** | Targets beyond BC where the research’s staff KPI scope applies; rule priority, effective periods and payout configuration where adjustable. |

For all new rows, supply a type, scope, authorized changer, validated bounds and provenance. Clinic-specific input is a valid default category; it should not be mislabelled “research default.”

## Phone, tablet and desktop assessment

- **Desktop:** The job-grouped sidebar is a sensible baseline. The primary issue is missing role/action precision, not the number of top-level groups.
- **Tablet:** Treating tablet exactly like desktop is insufficient for the doctor’s workspace and treatment-room use. Define collapsible navigation and focused clinical panels.
- **Phone:** Five bottom tabs are sensible, but putting everything else into an undifferentiated Saya tree will produce long journeys. Each role needs a named landing page and prioritized destinations.
- **Across all 16 roles:** Specify acting-role and branch scope consistently. Tenant-wide roles need an all-branches context; branch roles must never see unauthorized branch choices. Roles without dashboard permission should land on their authorized work queue—not receive a new dashboard merely for symmetry.

## What is good

- Clear separation of **vendor console, tenant clinic app and public site**.
- Strong recognition that **clinical content requires role-specific projection**.
- Useful distinction between **cash collected, completed services, receivables and prepaid liabilities**.
- Broad coverage of the actual clinic workflow: registration → clinical assessment → treatment → dispensing → settlement.
- Good operational controls already named: duplicate checking, FEFO, blind stock counts, refund/void approval and cash variance.
- Versioned settings, effective dates, audit history and transaction snapshots are sound foundations.
- The catalogue stays focused on a **clinic SaaS**, not an online shop.

**Bottom line:** retain the structure. Resolve the R1 deferrals and authorization contradictions first, then complete the missing master-data, finance, settings and responsive screen specifications. The page count should follow that reconciliation—not serve as proof that it is complete.
