# Big Beauty Clinic Brands → Admin Dashboard, CRM and Operating Requirements

- Date: 2026-11-02 (Asia/Jakarta)
- Status: requirements research for the multi-tenant beauty clinic SaaS. **Not a PRD.** Items are labelled CONFIRMED (user decision in `SESSION-HANDOFF-2026-10-30.md` / blueprint §0.4), OBS/DOC/PRESS (market evidence), or PROPOSED (needs Paduka Ongki's approval).
- Inputs: `INDONESIA-BEAUTY-CLINIC-MARKET-REA-REVIEW-2026-11.md` (REA evidence `rea-2026-11/`), `beauty-clinic-admin-system-research.md` (vendor admin anatomy), `SESSION-HANDOFF-2026-10-30.md`, `BEAUTY-CLINIC-SYSTEM-BLUEPRINT.md`.
- Rule of this document: a dashboard number exists only if a record behind it exists. Each KPI names its source records.
- **Update 2026-11-02:** D1–D4 answered (1 client = 1 brand, multi-branch; first target 1–5 branches; WABA; accounting if feasible). See `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` §0. ZAP scheduling confirmed on Booker (Mindbody).

---

## 1. Which brands count as "big"

Selection: national or multi-region groups with ≥40 outlets, plus two premium groups that set the patient-experience bar. Counts are dated snapshots.

| # | Brand / group | Outlets | Evidence | Why it matters for the product |
|---|---|---|---|---|
| 1 | Natasha Group (Natasha + Naavagreen) | 104 + 80 listed; Natasha 189 per May 2025 press | CNT, PRESS | Two brands on one booking vendor; regional price books; mass volume |
| 2 | ERHA group (ERHA Clinic, Ultimate, DermiesMAX, sub-brands) — PT Arya Noble | 113 clinics, 58 cities (Sep 2025) | PRESS | Central booking service, patient app, SAP back office |
| 3 | ZAP Group (ZAP Clinic, Premiere, MEN/O/LOGY) | 100+ | DOC | One app for 3 brands, call center, gift cards, membership |
| 4 | SOZO Skin Clinic | 80+ claimed | DOC | WA funnel with source tags, paylater |
| 5 | Bening's Clinic | 74, no franchise (Jul 2026) | PRESS | One central WA for 70+ branches |
| 6 | Oriskin | 70+ claimed, 62 listed | DOC | WA-number login, app, memberships, packages API, AI skin check |
| 7 | Athena Beauty Clinic | 50+ claimed (unverified now) | UNV | Founder-led, domain churn |
| 8 | Larissa | 47 | OBS | Member login + cart, branch GeoJSON |
| 9 | B Clinic | 46 | PRESS | Slimming programs |
| 10 | LBC | 41 branch WA links | OBS | Zero-system baseline (Linktree) |
| 11 | Ella Skin Clinic | 38 (2026 press) | PRESS | Price books (regular/platinum) |
| 12 | Miracle (premium) | 19 | CNT | Premium tier inside the group, academy |
| 13 | NMW (premium) | 17–18 | CNT | Most complete patient portal |

Excluded from this document: chains under ~20 outlets and franchise facial spots (Kezia, Madeena, Ghanisa, Eudora). Revisit if franchise/partner customers become a target.

---

## 2. What the big brands actually run (evidence → system need)

| Observed at big brands | Brands | System need it implies | Our status |
|---|---|---|---|
| Central booking service outside the marketing site, with `sourceValue` (channel) and `branchId` | ERHA (OBS) | Booking API with source + branch parameters; marketing sites only link in | PROPOSED |
| Phone/WhatsApp as patient identity, OTP | Oriskin, DermiesMAX, Natasha (OBS) | Phone-verified identity; one phone → many patients | CONFIRMED that shared phone ≠ access to all family records |
| One app across several brands | ZAP (DOC), ERHA group | Tenant may hold multiple brands, not only branches | **OPEN** (§9 D1) |
| Booking form with outlet + slot check | Natasha, Naavagreen via Hepta CRS (OBS) | Slot availability by branch; member code lookup | PROPOSED |
| Call center + web + app + IG DM booking; WA reminders | ZAP (DOC) | Booking channel recorded on every appointment | PROPOSED |
| Arrive 15 min early, <5 min left → slot to walk-in, reschedule ≥3 h | ZAP (Oct OBS) | Configurable lateness/reschedule rules | Our cutoff decision is 24 h for booking DP (CONFIRMED); lateness rule OPEN |
| Single central WA for 70+ branches | Bening's (OBS) | Shared lead inbox with branch routing | PROPOSED (CRM core) |
| Per-branch WA lists | LBC 41, L'VIORS 26, Larissa per clinic (OBS) | Same inbox, branch number as routing key | PROPOSED |
| WA prefill with promo/source tag | SOZO, Gloskin (OBS) | Parse source/treatment from first message | PROPOSED |
| Region/tier price books on one catalog | Natasha 14 regions, Ella regular/platinum (OBS) | Shared master + branch price override | CONFIRMED (owner branch override); region price books OPEN |
| Membership from Rp5 juta; gift card min Rp299rb, valid 3 yr | ZAP (DOC) | Membership and gift card objects | NOT in scope (deferred) |
| Membership tiers | Oriskin "10+ pilihan", Airin 4 tiers (DOC) | Tier rules | NOT in scope |
| Journey/series packages | NMW Acne/Melasma Journey, Oriskin packages API, ZAP vouchers | Packages tied to care plan stages | CONFIRMED (package rules) |
| Paylater, 0% installment | SOZO (OBS) | Payment method record; installment via provider ≠ our package installment | PROPOSED: record as payment method only |
| Teleconsultation, Rx photo upload, delivery/drive-thru | ERHA Buddy (DOC), NMW portal | Patient app | Deferred (CONFIRMED exclusion list) |
| Waiting-time display in app | MS GLOW app (DOC) | Queue state per visit | PROPOSED (queue board), app deferred |
| AI skin check with liveness | Oriskin (OBS) | — | Deferred (AI diagnosis excluded) |
| SAP ERP (finance, MM, WM, PP, SD, QM) | Arya Noble (DOC) | Big chains keep ERP; we must **export** clean data, not replace ERP | PROPOSED: accounting export, no full accounting |
| Session replay and ad pixels on booking pages | Natasha, Naavagreen, ERHA, Miracle (OBS) | Consent-gated tracking; no replay on health inputs | PROPOSED (privacy guard) |
| Branch directory drift (Ella 6 vs 38, Larissa 404) | OBS | Facility master is the only source of branch data | PROPOSED |

**Reading:** big brands differ from small ones in three ways that the dashboard must support: (1) **multi-branch scale** with HQ control, (2) **centralized demand capture** (one WA/call center feeding many branches), (3) **prepaid liabilities** (packages, memberships, gift cards, deposits) that make cash and earned value diverge.

---

## 3. Business decision catalog

Decisions first; dashboards exist to support them. Cadence and owner are PROPOSED defaults for a big-brand tenant.

### 3.1 HQ / owner (strategic, weekly–monthly)

| ID | Decision | Data needed | Source records |
|---|---|---|---|
| D-HQ1 | Which branches to expand, fix, or close | Branch cash collected, completed treatment value, visits, new patients, margin after materials + commission, trend | Payments, visits, treatment executions, stock consumption, commission entitlements |
| D-HQ2 | Which treatments/packages to push or drop | Volume, value, materials cost, commission cost, repeat rate per treatment | Invoice lines, executions, consumption, commissions |
| D-HQ3 | Is prepaid money turning into service, or piling up as obligation? | Paid-but-unused package value, patient balance, booking DP held, expiries next 30/60/90 days | Package entitlements, payments, redemptions, balance ledger |
| D-HQ4 | Price changes and branch overrides | Price vs volume by branch, discount depth | Price master, overrides, invoice lines |
| D-HQ5 | Which channels deserve marketing budget | Leads → booked → arrived → paid by source and branch | Leads, appointments, visits, payments (with source) |
| D-HQ6 | Commission payout approval | Entitlements by staff/role/branch, refund adjustments, attribution corrections | Commission entitlements, adjustments, corrections log |
| D-HQ7 | Write-offs and cash refunds | Receivables aging, refund requests, approver | Receivables, refund records |
| D-HQ8 | Stock risk across branches | Low stock, expiring batches, transfers, variance | Stock ledger per branch, batches, counts |

### 3.2 Branch manager (operational, daily)

| ID | Decision | Data needed |
|---|---|---|
| D-BM1 | Staff and room allocation for tomorrow | Appointments by performer/room/device, gaps, leave |
| D-BM2 | Who to chase today | Unpaid bills, unpaid additions, receivables, no-shows to rebook |
| D-BM3 | Approve exceptions | Refund/write-off requests within scope, attribution corrections |
| D-BM4 | Reorder stock | Low-stock list, pending POs, reservations |
| D-BM5 | Coach staff | BC targets vs actual, conversion per BC, performer completions |

### 3.3 Front office / cashier (real time)

| ID | Decision | Data needed |
|---|---|---|
| D-FO1 | Who is next and where | Live queue with visit state per patient |
| D-FO2 | Can treatment start? | Payment status of selected items, consent status |
| D-FO3 | Allow an approved addition to start before payment | Addition approval, patient balance, who confirms (CONFIRMED flow) |
| D-FO4 | Can the visit close? | Outstanding amount (CONFIRMED: cannot close with unpaid bill) |
| D-FO5 | Is my cash drawer right? | Shift payments by method, refunds |

### 3.4 BC (per patient, daily)

| ID | Decision | Data needed |
|---|---|---|
| D-BC1 | What to offer within the doctor's plan and budget | Care plan stages, prices, balance, package entitlement, paid-unlocked sessions |
| D-BC2 | Who to follow up | Plans not started, partially selected plans, controls due, expiring packages |
| D-BC3 | Am I on target? | Own target vs actual (metric OPEN), own commission |

### 3.5 Doctor, treatment room, pharmacy

| ID | Decision | Data needed |
|---|---|---|
| D-DR1 | Plan and authorize treatment | History panel, photos, previous plans (CONFIRMED usability need) |
| D-TR1 | Start/complete/interrupt | Payment + consent ready, issued materials, interruption reason (CONFIRMED rules) |
| D-PH1 | Prepare and issue | Auto preparation list from approved selections (CONFIRMED) |
| D-PH2 | Restock | Min/target levels, reservations, pending POs (CONFIRMED) |

### 3.6 CRM / marketing / CS

| ID | Decision | Data needed |
|---|---|---|
| D-CR1 | Which lead to answer first and route to which branch | Lead age, source, intent, branch, assignee |
| D-CR2 | Which patients to contact today | Due controls, package expiry, outstanding installment, receivable, dormant, unbooked plan stage |
| D-CR3 | Did a campaign produce paid visits? | Campaign/source → appointment → payment |
| D-CR4 | Is the patient allowed to receive marketing? | Marketing consent per channel |

---

## 4. KPI dictionary (definitions bound to confirmed rules)

Conventions: all money in integer rupiah, displayed with `Intl.NumberFormat('id-ID')`; period boundaries in the branch's timezone (WIB/WITA/WIT shown); each KPI has branch and consolidated views (CONFIRMED). "Value" below is operational, **not accounting revenue**. Full accounting is deferred (CONFIRMED); revenue recognition policy is OPEN (§9 D4).

| ID | KPI | Definition | Source records | Notes |
|---|---|---|---|---|
| K1 | Cash collected | Sum of received payments − cash refunds, by payment date | Payments, refunds | Includes package/installment payments and balance top-ups; balance *usage* is not new cash |
| K2 | Completed service value | Value of treatments counted as used + products handed over, by execution/handover date | Executions (used flag per CONFIRMED interruption rules), invoice lines | Package session value = CONFIRMED session-value rule; counted at the **executing** branch |
| K3 | Sales booked | Invoiced item value after discount, by sale date | Invoice lines | Package sale value stays at the **selling** branch (CONFIRMED) |
| K4 | Outstanding receivable | Unpaid invoice value + recorded patient receivables, with aging | Invoices, receivables | Write-offs shown separately |
| K5 | Prepaid obligation | Paid-but-unused package value + patient balance + held booking DP | Package entitlements, balance ledger, booking DP | Expiry buckets 0–30/31–60/61–90/>90 days |
| K6 | Package expiry conversion | Paid-but-unused value moved to patient balance at expiry; unpaid remainder cancelled | Package close events | Per CONFIRMED expiry rule |
| K7 | Contribution after direct costs | K2 − materials consumed (cost) − commission entitlements | K2, consumption cost, commissions | Requires item cost; label "estimated" where consumption is standard rather than actual (CONFIRMED labelling rule) |
| K8 | Consultation-to-purchase conversion | Visits with consultation that end with any qualifying purchase ÷ consultation visits | Visits, invoice lines | Same-visit only; later purchase tracked separately (K9) |
| K9 | Plan uptake | Care-plan items selected ÷ items recommended, and value | Care plans, selections | Within 30/60/90 days |
| K10 | New vs returning patients | First visit in tenant vs repeat | Visits | Tenant-wide identity (CONFIRMED shared across branches) |
| K11 | Second-visit rate | New patients with a completed second visit within N days ÷ new patients | Visits | N OPEN (§9 D6) |
| K12 | No-show and late cancel | No-show + <24 h cancels ÷ booked | Appointments | Forfeited booking DP shown alongside |
| K13 | Lead conversion | Leads → booked → arrived → paid, by source, branch, assignee | Leads, appointments, visits, payments | Source captured at lead creation |
| K14 | Lead response time | Median first-response time, % answered within SLA | Lead messages | SLA OPEN |
| K15 | Performer utilization | Booked or executed minutes ÷ scheduled working minutes | Schedules, appointments, executions | Room/device utilization only if those resources are modelled |
| K16 | Product attach | Treatment visits that include a product purchase ÷ treatment visits | Invoice lines | — |
| K17 | Commission due | Entitlements − adjustments, by staff, role, contribution type | Commission ledger | Approval state shown (CONFIRMED monthly approval) |
| K18 | Stock risk | Items below minimum; batches expiring within N days; count variance | Stock ledger, batches, counts | Per branch |
| K19 | BC target attainment | Actual vs target | Targets, attribution | Metric definition OPEN (CONFIRMED that it is open) |

**Benchmarks:** the T2 standard lists targets (55–70% margin, 60–80% conversion, 37% first-rebook drop). None were verified. Show trend vs previous period and vs the tenant's own target; do not ship external benchmarks as defaults.

---

## 5. Dashboard specifications per role

Presentation rules apply (`admin-dashboard`): exceptions before charts, KPI cards only where a decision follows, numbers right-aligned, branch and timezone always visible, every card drills down to the filtered list behind it.

### 5.1 HQ / owner dashboard (analytical, branch selector incl. "Semua cabang")

1. **Exception strip** (hidden when zero): approvals waiting (refund, write-off, attribution correction, commission batch); branches with unpaid visits older than today; stock below minimum on clinically significant items; leads unanswered beyond SLA.
2. **Money row**: K1 cash collected · K2 completed service value · K4 receivable · K5 prepaid obligation (with 30-day expiry slice). Each with delta vs previous period.
3. **Trend**: K1 vs K2 by week (line), so cash running ahead of service is visible.
4. **Branch league table**: branch, K1, K2, K7, visits, new patients, K8, K12, K17 — sortable, numbers only, no chart.
5. **Treatment mix**: sorted bar of K2 and K7 by treatment family.
6. **Channel funnel**: K13 by source (stacked bar or step table).
7. **Prepaid obligation aging**: stacked column by expiry bucket.

### 5.2 Branch manager dashboard (operational, one branch)

1. **Today**: appointments, arrived, in treatment, waiting payment, no-shows (counts linking to the queue).
2. **Chase list**: unpaid bills, unpaid additions, receivables due, no-shows to rebook (queue, not chart).
3. **Tomorrow**: schedule gaps by performer; leave conflicts.
4. **Stock**: below minimum, expiring soon, pending POs.
5. **Staff**: BC attainment (K19), performer completions, commission accrued this month (K17).

### 5.3 Front office / cashier workspace (queue, not dashboard)

- Live visit board with independent states (CONFIRMED state separation): arrival · intake · doctor · selection · consent · payment · preparation · treatment · dispensing · closed.
- Outstanding payments panel always visible (CONFIRMED).
- Shift summary by payment method; drawer close.

### 5.4 BC workspace

- My patients today; plans awaiting selection; follow-ups due (§6.3 triggers filtered to my patients); own target and commission (own data only, CONFIRMED).

### 5.5 Doctor, treatment room, pharmacy

- Not dashboards. Doctor: patient workspace with history panel. Room: checklist. Pharmacy: preparation queue + low-stock list (CONFIRMED needs; see BC-SCREEN-SPEC and blueprint).

### 5.6 CRM / CS dashboard

- Lead inbox health: new, unassigned, overdue (K14), by branch.
- Funnel K13 by source and campaign.
- Recall queue counts by trigger type (§6.3), each linking to the list.
- Opt-out and consent-missing counts.

### 5.7 Finance view (export-first)

- K1 by payment method and branch; K4 aging; K5 detail; refunds and write-offs; commission payout batches.
- Exports for the tenant's accounting/ERP (big brands keep SAP or similar — Arya Noble evidence). Export format OPEN.

### 5.8 Privacy boundary on dashboards

- Aggregates only for owner/manager/finance; no clinical notes or photos on any dashboard (blueprint role matrix).
- Drill-down lists show identity and money, not diagnosis, unless the viewer is clinical staff serving that patient (CONFIRMED access scope).

---

## 6. CRM requirements

### 6.1 Objects

| Object | Purpose | Key fields |
|---|---|---|
| Lead | Contact before becoming a patient | phone, name, source, campaign, intent (consultation/appointment/price), preferred branch, assignee, status, first-message text, created/first-response timestamps |
| Patient | Person receiving care | tenant-wide; linked phone(s); guardian if minor |
| Contact point | Phone/WA number | one phone → many patients; verified flag |
| Consent | Permission per purpose/channel | marketing WA, clinical photo use, publication — separate (CONFIRMED separation of clinical photo vs marketing) |
| Interaction | Message, call, visit note | channel, direction, staff, timestamp |
| Follow-up task | Something to do for a patient | trigger type, due date, assignee, outcome |
| Campaign | Grouped outreach | segment, message, sent/delivered/replied, attributed bookings and payments |

### 6.2 Lead lifecycle (PROPOSED)

`new → contacted → qualified → booked → arrived → converted (paid) | lost (reason)`; reopened on new inbound message. Guards: `booked` requires an appointment; `converted` requires a received payment; `lost` requires a reason.

### 6.3 Follow-up triggers (from confirmed business rules)

| Trigger | Source rule | Default owner |
|---|---|---|
| Control due (doctor-set date; free until date + 7 days) | CONFIRMED free control | BC / FO |
| Next package stage due | CONFIRMED package follows doctor's stages | Guiding BC |
| Package expiring (30/14/7 days) | CONFIRMED validity default 12 months | Guiding BC |
| Installment package with locked sessions (paid < next session value) | CONFIRMED redemption rule | FO |
| Unpaid addition / patient receivable | CONFIRMED fallback | FO |
| Plan recommended but not selected | CONFIRMED plan vs selection separation | Guiding BC |
| No-show / late cancel → rebook | CONFIRMED booking DP rules | FO |
| Dormant patient (no visit > N days) | PROPOSED, N OPEN | CRM |
| Product refill estimate | PROPOSED, needs product usage duration | CRM |
| Birthday | PROPOSED | CRM |

### 6.4 Channels and attribution

- WhatsApp is the primary channel at every big brand (OBS). PROPOSED MVP: shared inbox per tenant, routing by branch number or chosen branch, assignment, quick replies; template sending with opt-in. Full omnichannel inbox is in the CONFIRMED deferral list — scope decision §9 D3.
- Source capture: booking link `?source=&branch=` (ERHA pattern), WA prefill tag parsing (SOZO pattern), manual source on walk-in.
- Attribution to commission: "new patient" contribution goes to who registered/brought the patient (CONFIRMED). Marketing attribution is reporting only and does not create commission unless a rule says so.

### 6.5 Guards

- No marketing message without marketing consent; clinical follow-ups (control, complication) are care communication, separated from promos.
- No session-replay or third-party pixels on booking, intake or complaint fields.
- Shared phone does not reveal another family member's records in messages.

---

## 7. Other needs surfaced by big brands

| Need | Evidence | Proposed position |
|---|---|---|
| Multi-brand under one tenant | ZAP (3 brands, 1 app), ERHA sub-brands, Natasha+Naavagreen | Decide D1; if yes: brand → branches, shared patients optional per brand |
| Facility master → public directory/API | Larissa GeoJSON, Oriskin `/api/oriskin/clinics`, directory drift | MVP: branch master with hours, address, WA, map link; read-only public endpoint |
| Booking API for marketing sites | ERHA, Hepta CRS | MVP candidate: slots by branch/service, phone verification, source param |
| Region/tier price books | Natasha, Ella | Branch override is CONFIRMED; region price book only if a big tenant needs it |
| Membership, gift card, points | ZAP, Oriskin, Airin | Deferred; patient balance covers stored value (CONFIRMED) |
| Call-center role | ZAP 1500 310 | Role "CS pusat" with cross-branch booking, no clinical access |
| ERP/accounting export | Arya Noble SAP | Export of payments, invoices, commissions, stock movements |
| Patient app/portal | ERHA, NMW, ZAP, Oriskin | Deferred (CONFIRMED); WA links + web booking first |
| Teleconsult, delivery | ERHA, NMW | Deferred |

---

## 8. Records the dashboards depend on (minimum event set)

If any of these is missing, the matching KPI cannot be computed honestly.

| Record | Feeds |
|---|---|
| Payment (amount, method, branch, timestamp, invoice, allocation to items) | K1, K4, K17 |
| Invoice line (item, price, discount, tax, selling branch) | K3, K8, K16 |
| Treatment execution (performer, branch, start/end, used flag, interruption reason) | K2, K15, K17 |
| Package entitlement + redemption + close event | K2, K5, K6 |
| Balance ledger (top-up, usage, transfer-in from expiry, refund) | K1, K5 |
| Booking DP (held, applied, forfeited, moved to balance) | K5, K12 |
| Appointment (source, branch, status history) | K12, K13, K15 |
| Lead + message timestamps | K13, K14 |
| Care plan + selection + consent | K8, K9 |
| Stock movement (receive, transfer, issue, consume, return, waste, count) with cost | K7, K18 |
| Commission entitlement + adjustment + payout batch | K17 |
| Consent records | CRM guards |
| Audit log of corrections and approvals | All approval queues |

---

## 9. Decisions needed from Paduka Ongki

**Status 2026-11-02:** D1–D4 decided; D5–D10 adopted from recommendations. Current values live in `DECISION-REGISTER.md` §§1, 3, 4, 7.

| ID | Question | Why it matters | Options |
|---|---|---|---|
| D1 | Do we target big chains that run **multiple brands** in one company? | Data model above branch | (a) tenant → branches only; (b) tenant → brands → branches |
| D2 | First target customer: big chain (40+ outlets) or small/mid clinic (1–10)? | Big chains already have SAP/apps and need integration; small ones need the whole system | Pilot criteria in handoff point to 1–2 branches |
| D3 | WhatsApp in MVP: links + manual logging, or a shared inbox with WhatsApp Business API? | Biggest market gap vs cost/compliance of WA API | (a) manual; (b) inbox; (c) inbox + templates |
| D4 | Do we report "completed service value" only, or also implement revenue recognition? | Finance numbers on dashboard | (a) operational values + export (fits "no full accounting"); (b) accounting module |
| D5 | Lateness rule (ZAP-style forfeit to walk-in) | FO queue behaviour | none / configurable minutes |
| D6 | Second-visit window N and dormant threshold N | K11, CRM dormant trigger | e.g. 60 / 90 days |
| D7 | BC target metric | K19 | revenue, closings, plan uptake, or mix |
| D8 | Lead SLA | K14 | e.g. 15 min in opening hours |
| D9 | Accounting export format | Finance view | CSV, specific software, SAP-ready |
| D10 | Call-center (cross-branch CS) role in MVP? | Big-brand requirement | yes/no |

---

## 10. Next step

After D1–D4 are answered: turn §§3–8 into the planning artifacts (PRD + TASKS per `prd-taskbreaker`), then screen contracts for HQ dashboard, branch dashboard, FO queue, and CRM inbox, and validate them in Google Stitch alongside the existing BC prompts.
