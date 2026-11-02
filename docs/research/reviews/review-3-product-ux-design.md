# Review 3: Product scope, UX/screens, design system and dashboards for the Clinic Dashboard planning kit

- **Reviewed:** `~/Documents/work/prd/clinic-dashboard/` — mainly `02-PRD.md`, `17-UX-FLOWS-SCREEN-CONTRACTS.md`, `10-DESIGN-SYSTEM-WHITELABEL.md`, `DESIGN.md`, `design-brief.md` and `README.md`. I also checked `07`, `11`, `13`, `PLAN.md` and `03` where needed to confirm something.
- **Compared with:** `BIG-BRAND-DASHBOARD-CRM-REQUIREMENTS.md`, `BC-SCREEN-SPEC.md`, `SESSION-HANDOFF-2026-10-30.md`, `INDONESIA-BEAUTY-CLINIC-MARKET-REA-REVIEW-2026-11.md`, `DECISION-REGISTER.md`, and the Kliniknuma `PRD.md`, `PLAN.md` (RG register), `DECISIONS.md` and `DESIGN.md`. All were read only.
- **Method:** I read the files and searched them for specific terms. All contrast ratios below are worked out by hand with the WCAG 2.x relative-luminance formula.
- **Date:** 2026-11-02. This is a read-only review.

## Review

### What is already good (with evidence)

- **Every Must has a scenario, and the money rules match the decisions.** Each Must PR in `02-PRD.md` §7 has a Gherkin scenario in §8. PR-15, PR-19 to PR-23 match DECISION-REGISTER B-01 to B-07 and BILL-1 to BILL-16. The PR-20 expiry example (Rp5,000,000 / 5 sessions / Rp3,000,000 paid / 2 used) reproduces the handoff example exactly.
- **The non-goals are honest and match handoff §6:** no payroll, multi-brand tenants, AI diagnosis, native app, loyalty or package sharing (`02-PRD.md` §5).
- **Every screen in the inventory traces to at least one PR-*** (UX-1 to UX-24, `17` lines ≈41–64). Primary actions are written in Indonesian.
- **The owner dashboard follows the research.** The UX-20 contract follows BIG-BRAND §5.1: exception strip first, then money row K1/K2/K4/K5 with time basis, K1-vs-K2 trend, league table and aging. This fits the admin-dashboard "exceptions before charts" rule and D-11 (no external benchmarks).
- **Key operational rules are in the board, room and IAM documents:**
  - The visit board shows independent states, an always-visible outstanding-payments panel and no clinical content (UX-6 contract; PR-7, PR-33 scenario).
  - The room checklist says a timer ending never completes the treatment, and lists the four interruption outcomes (UX-9; B-06).
  - BC limits are enforced (PR-9 scenario; IAM matrix "Intake (unverified)").
- **Most colour pairs pass AA.** All six status pairs, ink, muted text, accent and the four chart colours pass on white (table under F-11).
- **Two baseline corrections are right.** The Numa Skin palette was removed with the reason given (DEC-016). The RME correction window was changed to 2×24 h per Pasal 30 instead of Kliniknuma RG-15's 24 h.
- **The privacy guard is carried through.** D-12 (no session replay or ad pixels before consent) appears in PR-39, PRIV-10 and design-brief non-goals.

### Fixed

None. The review was read-only.

### Findings

---

#### P1 — fix before PRD approval

**F-1. P1 — There is no catalog/master-data requirement or screen, and no branch price override, even though both are confirmed decisions.**

- **Where:**
  - `02-PRD.md` §5 and §7 have no catalog PR.
  - `17` navigation line 32 lists "Katalog", but no UX-* screen exists for it. The only catalog mention is "catalog import" inside UX-1.
  - `README.md` line 81 maps `REQ-020 dynamic catalog | KEEP | PR-24 (tax)…`.
- **Evidence:**
  - Handoff §3 "Confirmed usability needs": "Centralized master data is required."
  - DECISION-REGISTER B-08 and handoff §8: "Treatment/product master and prices are shared across branches; owner may set branch-specific price overrides."
  - Searching the kit for "override" finds only commission overrides (PR-23, BILL-15). Branch price override appears nowhere.
  - Several Must PRs depend on data that only a catalog provides:
    - PR-18 needs a material formula per service ("Services expand through their master material formula", handoff §5).
    - PR-12 needs free-control count and validity per item (B-02).
    - PR-20 needs package validity, minimum DP % and the installments toggle per package (B-03).
    - PR-22 needs booking DP on/off per treatment (B-05).
    - PR-24 needs a tax category per item.
    - PR-23 needs commission scope per item.
  - Kliniknuma REQ-020 is a full versioned catalog editor with clinical review ("Minta Review PJ"), and RG-13 sets catalog approvals. Marking it "KEEP" while mapping it only to the tax field drops it without saying so.
- **Smallest fix:**
  - Add **PR-41 Catalog**: services, products, packages, materials/BHP formulas, per-item control rules, booking DP flag, tax category, versioning, and clinical-field review before publication.
  - Add **PR-42 Branch price override**: a shared master price plus an owner-set branch price, effective-dated, snapshotted on invoice lines; K3 uses the snapshotted price.
  - Add **UX-25 Katalog** (`/staff/settings/catalog`) and a branch price tab.
  - Change README line 81 to `MODIFY → PR-41, PR-42, PR-24`.

**F-2. P1 — PR-33 promises six role dashboards and "the KPI dictionary", but only two dashboards have screens and the K1–K19 dictionary isn't in the kit.**

- **Where:** `02-PRD.md` PR-33 (line 153) and §5 line 82; `17` UX-20 and UX-21; `03` TD-12.
- **Evidence:**
  - PR-33 names owner, branch manager, front office, BC, CRM and finance dashboards. `17` defines only UX-20 (owner) and UX-21 (branch).
  - Searching every kit file for `K1`–`K19` finds nothing. The dictionary exists only in the research file (BIG-BRAND §4), and some of its items were "OPEN" there but have since been decided (D-06 = 60/90 days, D-07 BC metric, D-08 = 15-minute SLA).
  - Rules that the KPI numbers depend on are missing from PRD and UX:
    - K2 is counted at the **executing** branch; K3 at the **selling** branch (B-08, BILL-16).
    - K7 must be labelled "estimated" when consumption is standard rather than actual (handoff §5).
    - K1 excludes balance *usage*.
  - KPIs with no screen at all: K3, K6, K9, K10, K11, K14 (only as an exception), K15, K16, K18 (only as an exception) and K19.
  - K15 needs scheduled working minutes, but no roster screen exists (F-9).
  - K7 needs item cost, but no costing method is specified anywhere (searching for "cost/HPP/COGS" finds only the posting-map line in `11`).
  - The PR-33 scenario tests only that clinical content is hidden, so "shows the KPI dictionary values" can't be tested.
- **Smallest fix:**
  - Copy BIG-BRAND §4 into the kit as `02-PRD.md` Appendix A "KPI dictionary" with the decided values filled in, with stable IDs K1–K19, branch attribution and an "estimated" flag.
  - Split PR-33 into one PR per dashboard, each listing its K-IDs and drill-down target.
  - Either add UX contracts for the FO, BC, CRM and finance dashboards, or state explicitly that FO = UX-6 plus shift summary, BC = UX-7 queue plus a "Saya" panel (K19/K17), CRM = UX-18 health strip (K13/K14), and finance = UX-22 (K1 by method, K4, K5, K17).
  - Add a scenario per KPI family, for example "K2 at executing branch for a package sold at A and redeemed at B".
  - Add a stock costing requirement (see the missing-requirements list).

**F-3. P1 — Clinical safety escalation (triage and adverse events) was dropped without being listed.**

- **Where:** `README.md` line 79 `REQ-018 … MODIFY → PR-27–PR-31`; `02-PRD.md` PR-28 to PR-31; `17` (no triage screen).
- **Evidence:**
  - Kliniknuma REQ-018 sends worsening post-treatment reports into a clinical triage queue (`RECEIVED → TRIAGED → ESCALATED → RESOLVED`). REQ-015 has pharmacist adverse-drug-reaction flags. Both are backed by CLIN-016 and CLIN-024, and by DESIGN UX-12 (triage queue) and RG-19 (triage SLA).
  - None of PR-27 to PR-31 covers clinical escalation. In Release 1 the main inbound channel is the shared WhatsApp inbox run by CS/FO/BC (UX-17), and none of those roles is clinical.
  - So "my face is swollen after yesterday's laser" arrives in a non-clinical queue with no defined way to reach a clinician.
  - `PLAN.md` §2 still lists a "triage" engine to reuse, so the plan and the PRD disagree.
  - Handoff §6 only defers *remote check-in through the member app*. It does not defer complaint handling.
- **Smallest fix:**
  - Add **PR-43**: "Staff shall flag an inbound message or visit note as a suspected complication or adverse event. This creates a clinical review task assigned to the branch's clinician on duty, visible to doctor, nurse and pharmacist, with status and SLA. A treatment-caused extra control is free (B-02)."
  - Add a "Tandai keluhan klinis" action to UX-17 and a clinical task list in UX-8 and UX-10.
  - Map REQ-018, CLIN-016, CLIN-024, Kliniknuma UX-12 and RG-19 to it in the README.

**F-4. P1 — There are no approval screens, and the decided "additional treatment" flow has no screen where the clinician approves.**

- **Where:**
  - `02-PRD.md` PR-37 (line 157), PR-13 and PR-15.
  - `17` navigation "Persetujuan" (line 32) has no UX-*.
  - UX-20 exception strip "approvals waiting"; Responsive contract "Phone: … approvals".
- **Evidence:**
  - PR-37 lists six approval types: refund exception, write-off, attribution correction, commission batch, stock adjustment, disposal. Only refund/write-off (UX-14) and commission batch (UX-16) have a screen.
  - Approvals that have no screen anywhere:
    - attribution correction and guiding-BC reassignment (handoff §4, owner/manager only)
    - stock adjustment and disposal
    - late RME administrative correction (PR-13, "records officer or facility head")
    - shift-close variance above tolerance (BILL-18)
  - B-01 requires an authorized clinician to approve an addition before it starts. BC-SCREEN-SPEC BC-6 sends the request "to the clinician in the room or the doctor". But UX-8 and UX-9 only offer "propose addition", and no contract describes where the clinician *approves* it, or where a doctor receives "Minta Dokter Ubah Rencana" or "Minta Tukar Treatment" (BC-4, §5.7; BILL-11).
  - The owner's exception strip and the phone subset both point to a screen that doesn't exist.
- **Smallest fix:**
  - Add **UX-26 Persetujuan** (`/staff/approvals`): one inbox with a type filter and requester ≠ approver shown, covering all PR-37 types plus PR-13 corrections and shift variance.
  - Add a "Permintaan klinis" panel to the UX-8 and UX-9 contracts covering addition authorization, plan-change requests and substitution requests, each with approve/decline and a reason.
  - Add a PR-15 scenario where the clinician approves on a tablet in the room.

**F-5. P1 — README says CLIN-001 to CLIN-028 are kept and mapped to "PRD acceptance", but the PRD contains none of them, and §15 claims every Must is testable.**

- **Where:** `README.md` line 85; `02-PRD.md` §8 and §15.
- **Evidence:**
  - §8 has 39 scenarios, all named PR-*. None of the 28 CLIN scenarios appears.
  - Several CLIN scenarios depend on features the kit marks LATER or dropped: CLIN-013 (REQ-006 member app), CLIN-016 and CLIN-024 (triage, F-3), CLIN-027 (REQ-003 testimonials).
  - Others are clinical-integrity checks with no PR scenario at all:
    - CLIN-002: unverified allergy spreads to nurse and pharmacist.
    - CLIN-008 and CLIN-018: retry gives exactly one deduction.
    - CLIN-019: expired, recalled or BUD-lapsed stock is blocked.
    - CLIN-020: dose delta of 25 vs 20 units.
    - CLIN-025: visit can't close while pharmacy is pending.
    - CLIN-026: access ends when assignment is lost.
  - §15 ticks "Every PR-* is unique and testable; Must items have scenarios". In fact each Must has one scenario that covers one clause (F-6).
- **Smallest fix:**
  - Add `02-PRD.md` §8.1 "Carried clinical scenarios" with a row for each CLIN-ID: kept as is, reworded, or deferred/removed with a reason, plus the owning PR.
  - Untick the §15 box until F-6 is done.

---

#### P2 — should be fixed before release

**F-6. P2 — Many Must requirements bundle several behaviours but test only one.**

- **Where:** `02-PRD.md` §7 and §8.
- **Evidence and how to split:**

| PR | Clauses inside it | What the scenario tests | Split into |
|---|---|---|---|
| PR-2 | address, hours, closures, timezone, rooms, devices, services, WA number, map, publish window | closures only | hours/closures; resources; services offered; public listing/publish window |
| PR-3 | individual accounts; 2FA for 4 roles; idle lock | 2FA only | 3 PRs (idle lock = IAM-7 / CD-10) |
| PR-5 | minimum identity incl. NIK/no-NIK reason; duplicate decision; shared phone | shared phone only | identity fields + no-NIK path (CD-28); duplicates; shared phone; guardian for minors (J2) |
| PR-6 | staff + public booking; resource reservation; source/channel; booking DP | resources + source | add DP-at-booking and public-link scenarios |
| PR-7 | check-in; one visit; 9 states; outstanding list | outstanding list | board states; close conditions incl. pending dispensing (CLIN-025) |
| PR-10 | verify "without retyping"; face map; staged plan; history on same screen | history only | "without retyping" needs a measurable form, e.g. "each intake item has accept/correct; accepted items are not re-entered" |
| PR-13 | immutable; 2×24 h author correction; later approval; ≥25-year retention; patient copy | late approval only | 5 PRs; patient copy needs its own screen (F-8) |
| PR-15 | dual agreement; FO pre-start release; 2 alerts; no close unpaid; receivable fallback | no close unpaid | add first-alert, receivable creation and write-off/no-commission scenarios |
| PR-17 | batches, expiry, opened-vial use-by, FEFO, min/target, PO, goods receipt, transfers, counts | transfers only | at least FEFO/expiry block (CLIN-019), PO→receipt, counts/variance, min-stock reminder (handoff "incl. cotton") |
| PR-19 | frozen price, 6 tenders, allocation, receipts, shift close | allocation only | shift close and receipt numbering (BILL-18/19) |
| PR-23 | about ten rule elements | refund after payout only | override replaces default; guiding vs closing; performer only when counted; fixed amount only when fully paid; rule snapshot |
| PR-30 | 8 triggers | control due only | one row per trigger in a scenario outline |
| PR-33 | 6 dashboards + KPI + drill-down | no clinical content | see F-2 |

- **Vague wording:**
  - PR-12 ("apply the decided rules") and PR-18 ("required checks and labels") only point to other documents. Name BILL-4/BILL-5 and CD-19 / RG-21's seven checks inline.
  - PR-40 ("shall follow Kliniknuma REQ-001–REQ-004") points at a Numa-specific 10-section homepage. Rewrite it as tenant-generic or mark it as a placeholder.
- **Fix:** split as shown, using PR-nn.a/b IDs to keep numbering stable, and give each sub-requirement its own scenario row.

**F-7. P2 — README's Kliniknuma map has wrong, missing and contradictory rows.**

- **Where:** `README.md` "Kliniknuma → Clinic Dashboard map" (lines ≈58–112).
- **Evidence:**
  - **No UX-1 to UX-17 rows at all**, although the Sources section lists them. The kit also reuses the IDs UX-1 to UX-24 with different meanings (Kliniknuma UX-10 = manager catalog/approvals; kit UX-10 = pharmacy), and `PLAN.md` §2 says "DESIGN.md components: Keep anatomy". The two numbering schemes will be confused. Dropped Kliniknuma screens:
    - UX-10 catalog editor, dual-control approval queue and credential tracker (→ F-1, F-4)
    - UX-12 triage (→ F-3)
    - UX-14 roster (→ F-9)
    - UX-17 purchasing with suppliers (partly in kit UX-11, no supplier master)
    - UX-1, UX-2 and UX-4 (public site, quiz, member area), which are LATER but not listed
  - **RG items missing:** RG-04 (rounding; used as a source in CD-12 but not mapped), RG-09, RG-13, RG-14 (consent validity, 90 days), RG-29, RG-30 (recall trace), RG-33, RG-34 (→ CD-28), RG-35, RG-37 (→ CD-29) and RG-38 (pilot feature flags).
  - **Range claim wrong:** "RG-16–RG-28 → CD-16–CD-22", but RG-19 (triage SLA), RG-20 (patient projection), RG-22 (refill cooldown) and RG-23 (Rx validity) have no CD row (`PLAN.md` §4).
  - **Wrong target:** RG-02 → "PR-6, PR-7". The lateness rule is PR-8 and the DP rule is PR-22. RG-06 → "PR-21, PR-22": write-off is in PR-37 / UX-14, not PR-22 (booking DP).
  - **"KEEP" rows that silently drop content:**
    - REQ-016 KEEP → PR-17 drops the accreditation logbooks (chiller temperatures, emergency kit, MESO, calibration, incident log KTD/KNC) and the daily stock count.
    - REQ-011 MODIFY → PR-14 drops the nursing logbooks (autoclave, B3 waste, INM).
    - REQ-012 KEEP+MODIFY drops the CLIN-025 pharmacy-pending close block (the UX-6 close rule checks only "unpaid bill and open execution").
    - REQ-014 MODIFY → PR-15 drops dose-delta reconciliation (CLIN-020; a negative delta becomes credit).
  - **DEC items missing:** DEC-008 (3-tier stock modes and follow-up visit type; directly relevant to PR-16's material classes), DEC-009, DEC-011 (idempotent persistence and repository ports; relevant to NFR-5), DEC-014 and DEC-016 (DEC-016 is cited in `10` and `DESIGN.md` but not mapped).
  - **Legend gaps:** "OPEN" (DEC-001) and "NOT APPLICABLE" (DEC-006) are used but not in the legend.
  - **Contradiction:** the NEW row lists PR-15, PR-20–22, PR-24, PR-27–31, PR-33–35 as "Not in Kliniknuma", but earlier rows map the same PRs as MODIFY, SUPERSEDED or KEEP of Kliniknuma items.
- **Fix:**
  - Add UX rows and rename the kit's screens to a separate prefix (e.g. `SCR-1…`) or note the collision.
  - Add every RG-01 to RG-39 and DEC-001 to DEC-018 row explicitly, using DROP or LATER with a reason where that applies.
  - Correct the targets above, add the missing legend values, and remove from the NEW row any PR that has a Kliniknuma ancestor.

**F-8. P2 — Privacy, compliance and tenant-lifecycle screens are missing.**

- **Where:** `13` PRIV-2, PRIV-5, PRIV-8; `12` SEC-5; `02-PRD.md` §3 "Vendor operator"; `17` inventory.
- **Evidence:**
  - PRIV-2 requires a tracked queue with deadlines for data-subject requests. There is no PR and no screen.
  - PR-13 promises patients "a copy of record content", but no screen or print output delivers it.
  - PRIV-5 says the facility keeps unlimited access and export; PRIV-8 covers exit terms. There is no tenant data-export or exit requirement and no screen. Permenkes 24/2022 Pasal 22 makes facility access a condition for partner storage.
  - SEC-5 defines an append-only audit, and §11 retains audit for 25 years. There is no screen where the owner or facility head reviews clinical access, break-glass use (IAM-6) or settings changes.
  - PR-4 requires consent withdrawal, but the only patient screen is UX-4 (registration). There is no patient profile where consents are viewed or withdrawn.
  - The vendor operator (PR-1 "When the vendor creates a tenant"; audited support access) has no console screen.
- **Fix:** add PRs and screens for:
  - **UX-27** Pasien › Profil: identity, contacts and guardian, consents with withdraw, balance, packages, receivables, "Salinan rekam medis".
  - **UX-28** Permintaan data pasien: the DSR queue.
  - **UX-29** Log audit: filters by patient, staff and action; break-glass review.
  - **UX-30** Ekspor data klinik: full tenant export in a documented format, used at exit.
  - **UX-31** Vendor console: provisioning and audited support sessions.

**F-9. P2 — Several operational screens that role jobs need have no contract.**

- **Where:** `17` navigation vs inventory; IAM matrix.
- **Evidence:**
  - **Staff roster / schedules:** in scope in `02-PRD.md` §5 ("schedules, resources"). Needed for PR-6 performer availability (handoff §6: "a shift roster alone is insufficient" but is still required), K15 and UX-21 "tomorrow gaps / leave conflicts". Kliniknuma UX-14 was dropped.
  - **Doctor worklist:** UX-8 is a per-visit sheet. There is no queue of "intake ready for doctor".
  - **Procedure consent capture:** PR-11 blocks start without matching consent. The signature screen, its owner (Q-07) and the separation from the BC-5 purchase agreement have no contract.
  - **Settings "Aturan":** PR-38's scenario says "Given the settings screen", but no UX exists for it.
  - **Own commission and target:** IAM gives ◐ to nine roles. UX-16 puts the own view inside the Keuangan group, so a BC would need that whole group. BC-SCREEN-SPEC already uses a "SAYA › Komisi Saya" group.
  - **WhatsApp settings and template management:** PR-28 template sending needs template status (pending, approved, rejected; R-02). Only onboarding in UX-1 exists.
  - **Supplier master** for PO in UX-11.
  - **"Laporan"** in the navigation has no screen.
  - **Notification centre:** the two FO alerts in PR-15 are a confirmed core feature, but there is no contract for alert delivery or acknowledgement.
- **Fix:** add contracts for Jadwal Staf, Antrean Dokter, Persetujuan Tindakan (consent capture), Aturan, "Saya" (Komisi Saya / Target Saya), WhatsApp › Template, Pemasok and a notification panel. Remove "Laporan" or define it as the export list.

**F-10. P2 — The UX-7 BC workspace contract contradicts BC-SCREEN-SPEC and risks breaking the confirmed non-medical BC boundary.**

- **Where:** `17` "Contract for UX-7" (≈lines 76–81), which claims to be "from BC-SCREEN-SPEC.md"; `02-PRD.md` PR-9 "skin assessment"; `10` component "SelectionPanel".
- **Evidence:**
  - BC-SCREEN-SPEC §2 and §5 define **one workspace with a 4-step indicator** (Intake & Foto → Pemeriksaan Dokter → Diskusi Pilihan → Konfirmasi & Kasir), a persistent "Riwayat Singkat" column, patient purchase confirmation with signature (BC-5), a tracker after sending, and the actions "Pasien Tidak Membeli" and "Minta Dokter Ubah Rencana".
  - UX-7 instead lists **tabs** (Intake, Foto, Penilaian kulit, Rencana dokter, Pilihan pasien, Tindak lanjut) and omits the confirm-and-send step, the purchase agreement, the history column and both actions.
  - BC-SCREEN-SPEC §5.3D deliberately names the section "**Observasi** Kulit Sederhana" with "no device measurements, grades, percentages or clinical terms [C]".
  - UX-7 and PR-9 say "**Penilaian kulit** / skin assessment". In Kliniknuma, `penilaian_kulit` is the BC-captured skin assessment with Fitzpatrick I–VI and 0–3 zone scores (REQ-008). `PLAN.md` §2 plans to reuse Kliniknuma engines, so the clinical-grade structure could come back for a non-medical role.
- **Fix:**
  - Rewrite the UX-7 contract to match BC-1 to BC-7, keeping the step model.
  - Rename the section to "Observasi kulit" in PR-9, UX-7 and the glossary.
  - Add a PR-9 clause: "BC observation has no grades, scores or Fitzpatrick type."
  - Add a scenario that rejects a BC submission containing a score field.

**F-11. P2 — Colour tokens: three combinations fail the kit's own UI-1 rule, and rail tokens are missing.**

- **Where:** `DESIGN.md` › Tokens › Colour; `10` UI-1 and the white-label capability matrix.
- **Contrast checks (hand-computed with the WCAG relative-luminance formula):**

| Pair | Ratio | Required | Result |
|---|---|---|---|
| `--ink` #0F172A on white | 17.85 | 4.5 | Pass (doc 17.8 ✓) |
| `--ink-muted` #475569 on white | 7.58 | 4.5 | Pass (doc 7.5 ✓) |
| `--ink-muted` on canvas #F4F7F9 | 7.04 | 4.5 | Pass |
| `--ink-muted` on `--surface-subtle` #EEF3F6 | 6.78 | 4.5 | Pass |
| `--accent` #0E7490 on white (and white on accent button) | 5.36 | 4.5 | Pass |
| `--accent` on canvas | 4.98 | 4.5 | Pass |
| `--accent` on `--surface-subtle` (selected row) | 4.79 | 4.5 | Pass |
| `--accent` text on `--accent-soft` #E0F2F7 (chip) | 4.65 | 4.5 | Pass, small margin |
| verified #166534 / #E6F4EA | 6.28 | 4.5 | Pass |
| warning #92400E / #FEF3C7 | 6.37 | 4.5 | Pass |
| danger #991B1B / #FEE2E2 | 6.80 | 4.5 | Pass |
| info #0B4A5C / #E0F2F7 | 8.48 | 4.5 | Pass |
| neutral #334155 / #F1F5F9 | 9.45 | 4.5 | Pass |
| locked #5B21B6 / #EDE9FE | 7.57 | 4.5 | Pass |
| chart-1 #0072B2 / chart-2 #D55E00 / chart-3 #009E73 / chart-4 #CC79A7 on white | 5.19 / 3.87 / 3.42 / **3.06** | 3.0 | Pass ("3:1 on white" holds; chart-4 only just) |
| chart-4 #CC79A7 on canvas #F4F7F9 | **2.85** | 3.0 | **Fail** if any chart sits on the canvas |
| face-map complaint #C25900 on white | 4.45 | 3.0 (graphic) | Pass |
| **`--border-strong` #CBD5E1 (input boundary) on white** | **1.48** | 3.0 (UI-1 "UI boundaries"; WCAG 1.4.11) | **Fail** |
| `--border` #E2E8F0 on white | ≈1.23 | decorative | Acceptable only for hairlines |
| **`--surface-rail-active` #133550 vs `--surface-rail` #0B2236** | **1.28** | 3.0 if it is the only active cue | **Fail** (no other cue is defined) |
| `--focus` #0E7490 ring on rail #0B2236 | 3.02 | 3.0 | Only just passes |

- **Other gaps:**
  - No rail text tokens (default or active nav text on navy) are defined. Kliniknuma had `#CBD5E1` muted nav text and a `#38B6CD` left accent bar.
  - The tenant accent check covers only "white and canvas ≥4.5:1". It doesn't cover the accent on `--accent-soft` or on the rail, and it doesn't say how `--accent-soft` and `--accent-ink` are derived for a replacement accent.
- **Fix:**
  - Set input borders to about `#94A3B8` or darker; #94A3B8 on white is roughly 2.6:1, so check it, and #64748B gives about 4.8:1. Alternatively keep #CBD5E1 but give inputs a white fill on a raised background plus a ≥3:1 bottom border.
  - Add `--ink-on-rail`, `--ink-on-rail-muted`, and a 3 px left accent bar or bold weight for the active rail item.
  - Require charts to render on `--surface-card` only.
  - Make the tenant accent check also cover accent on `--accent-soft` ≥4.5 and a derived soft colour; or fix the soft colour as accent at about 12% opacity on white and recheck.

**F-12. P2 — Tablet layout is under-specified for the screens in clinical rooms.**

- **Where:** `17` "Responsive and Input Contract"; `DESIGN.md` › Layout and Type; NFR-4; UI-10.
- **Evidence:**
  - `17` defines tablet as 768–1023 and desktop as 1366–1600, so **1024–1365 is undefined**. iPad landscape (1024–1194) is the most likely orientation in clinic rooms, and DESIGN.md gives that width the full 240 px rail.
  - At 768 px portrait: 72 px icon rail, then 696 px of content, minus a 320–360 px history drawer, leaves about 340 px for the UX-8 exam sheet. The face map alone is up to 460 px wide in the Kliniknuma anatomy the kit keeps.
  - Body text is 0.875 rem (14 px), tables are 13 px and micro-labels are 12 px uppercase. That is the desktop admin scale applied unchanged to "tablet-first" UX-7 to UX-10 used at arm's length in bright rooms.
  - The test viewports are inconsistent: NFR-4 uses 390/768/1440, UI-10 uses 360/768/1440. No 1024/1180 check exists.
  - Not specified: the on-screen keyboard over sticky footers (BC-2 footer), camera capture flow and signature pad sizing.
- **Fix:**
  - Define 1024–1365 (tablet landscape) with the icon rail and history as an overlay sheet.
  - In portrait, UX-8 history becomes a full-height overlay that keeps the edit state.
  - Use 16 px body text and 15 px table text on UX-7 to UX-10.
  - Add 1024 and 1180 to the browser-check viewports and pick one phone width (390).
  - Require sticky action bars to sit above the keyboard (`visualViewport`).

**F-13. P2 — Indonesian terminology: one wrong-meaning term, one Malay-leaning term, and one inconsistency with the BC spec.**

- **Where:** `10` Indonesian Glossary; `17` navigation and UX-20.
- **Evidence:**
  - **"BC Pendamping"** is used for the guiding BC. In this product "Pendampingan" is the BC's live accompaniment work, so "BC Pendamping" naturally means *today's accompanying BC*. The decided definition (handoff §4) is different: the guiding BC is the BC tied to the care plan, who may *not* be the one accompanying today. BC-SCREEN-SPEC §3.3 and §5.5F use **"BC Pembimbing"**. The glossary contradicts the screen spec and blurs a distinction that commission depends on.
  - **"Bilik" / "Bilik Tindakan"** for treatment room comes from Kliniknuma LOC-1. In Malay, "bilik" is the ordinary word for room. In Indonesian it suggests a booth or cubicle ("bilik suara"). Indonesian clinics and regulations use "Ruang Tindakan" (BC-SCREEN-SPEC itself writes "Ruang Treatment 2"). It is understandable, but it reads non-standard to Indonesian staff.
  - **"Buka pengecualian"** (owner's primary action) translates "exception" literally. In Indonesian, "pengecualian" means exemption or exclusion. "Perlu tindakan" or "Lihat yang perlu ditangani" says the right thing.
  - The rest checks out as Indonesian, not Malay: Antrean (KBBI form), Cabang (not "cawangan"), Staf, Kampanye, Piutang, Saldo, Etiket Biru, Tanda tangani. English loanwords (Lead, Inbox, DP Booking, Check-in, BC Closing) are normal in the industry but should be listed in the glossary so they are used consistently.
- **Fix:**
  - Glossary: "Guiding BC → **BC Pembimbing**".
  - Treatment room → **Ruang Tindakan**, keeping "Bilik" only for a curtained bed if a clinic uses it.
  - UX-20 action → **"Lihat yang perlu ditangani"**.
  - Add a glossary column "loanword allowed: yes/no".

**F-14. P2 — Release 1 scope is larger than a 1–2 branch pilot needs (YAGNI).**

- **Where:** `02-PRD.md` §5 In scope, PR-25, PR-27, PR-31; `17` UX-19; `03` TD-4; `PLAN.md` §2 and CD-17.
- **Evidence:**
  - **Campaigns** (UX-19: segments, scheduling, budget preview) are in Release 1. Handoff §6 defers "advanced loyalty/marketing automation". The pilot target is one clinic with 1–2 branches (§12 Phase 2). The follow-up queue (PR-30) plus template sending covers the confirmed jobs.
  - **Coretax XML export** is inside Must PR-25. It only matters for PKP tenants, and medical services are largely VAT-exempt (A-06; Q-05 still open).
  - **Condition progress, measurement templates (GAGS, mMASI, IGA) and clinical letters** come in through TD-4 and CD-17 via Kliniknuma reuse, with no PR. That is scope added by reuse, not by decision.
  - **Own Meta Tech Provider plus Embedded Signup and Coexistence** (PR-27) is a Release 1 gate with an external review dependency (Phase 0). Nothing describes what happens if Meta App Review slips.
- **Fix:**
  - Move UX-19 / campaigns to Release 1.1 and keep PR-31 consent and budget for reminders.
  - Make Coretax XML a Should, triggered when a tenant has PKP set.
  - Either add explicit PRs for condition progress and letters, or mark them LATER in PLAN §2.
  - Add a fallback to PR-27, e.g. "if Tech Provider approval is pending, the pilot clinic onboards via a Meta-approved BSP or Coexistence on its existing number"; this needs an owner decision.

---

#### P3 — notes

- **F-15.** PR-22 says clinic cancellation moves the DP to balance but leaves out "or refund on request" (B-05, BILL-13). Add it.
- **F-16.** UX-13 lists "Cashier, BC" for "Pakai sesi", but the state matrix lists "Cashier, front office" for "Redeem session". Make them match; BC has no cashier rights per BC-SCREEN-SPEC §1.
- **F-17.** The navigation label "Buku Besar" (general ledger) appears in Release 1, but the GL is accounting step 2 (PR-26, Should). Label it "Laporan Keuangan" until step 2.
- **F-18.** UX-20:
  - Prepaid aging uses ordered buckets (0–30 / 31–60 / 61–90 / >90) but would be drawn with categorical Okabe-Ito colours. Use one sequential hue instead.
  - Drill-down targets per card aren't specified.
  - The consolidated view across WIB, WITA and WIT branches doesn't define period boundaries. State "each branch uses its own local day; consolidated = sum of branch days".
- **F-19.** UI-6: `Intl.NumberFormat('id-ID', {style:'currency', currency:'IDR'})` prints `,00` by default. Specify `maximumFractionDigits: 0`, and state the separator ("Rp 350.000" in BC-SCREEN-SPEC).
- **F-20.** The `DESIGN.md` › Allow line lists five navigation groups and omits "Laporan", which `17` has.
- **F-21.** The canvas #F4F7F9 against white cards is about 1.08:1, and the hairline #E2E8F0 is about 1.23:1. Under strong glare, sheet edges disappear on tablets. Consider `--border-strong` around sheets in clinical-room screens.
- **F-22.** UX-24 public booking verifies the phone by WhatsApp OTP (IAM-2), which depends on PR-27 onboarding. Add a scenario for OTP failure or WABA unavailability (fallback: book without OTP, flagged for FO confirmation).

### Missing screens and requirements

| # | Missing item | Needed by (evidence) | Suggested ID |
|---|---|---|---|
| 1 | Catalog / master data (services, products, packages, material formulas, control rules, DP flag, tax, versioning, clinical review) | Handoff §3; B-02, B-03, B-05; PR-12/18/20/22/24; Kliniknuma REQ-020, RG-13 | PR-41, UX-25 |
| 2 | Branch price override | B-08; BIG-BRAND §2 / §7 | PR-42 |
| 3 | Clinical complaint / adverse-event escalation | Kliniknuma REQ-018, CLIN-016, CLIN-024, UX-12, RG-19 | PR-43 + UX-17/UX-8 actions |
| 4 | Approvals inbox (all PR-37 types, PR-13 late corrections, guiding-BC reassignment, shift variance) | PR-37, PR-13, BILL-18; UX-20 exception strip | UX-26 |
| 5 | Clinician authorization surface (addition, plan change, substitution) | B-01, BILL-11, BC-6, BC-4 | UX-8 / UX-9 contract |
| 6 | KPI dictionary K1–K19 inside the kit, plus per-dashboard PRs and the FO, BC, CRM and finance dashboards | PR-33; BIG-BRAND §4–5 | PRD App. A; PR-33a–f |
| 7 | Stock costing method (cost per batch / moving average) for K7 and the posting map | K7; `11` "Material consumed" | PR-44 |
| 8 | BC target setting and attainment (D-07 metric) | §5 "BC targets"; D-07; K19 | PR-23 split or PR-45 |
| 9 | Staff roster / schedules | §5 scope; K15; UX-21; Kliniknuma UX-14 | UX-32 |
| 10 | Patient profile with consent withdrawal, guardian and record copy | PR-4, PR-5 (J2 minor), PR-13 | UX-27 |
| 11 | Data-subject request queue | PRIV-2 | PR + UX-28 |
| 12 | Audit log viewer and break-glass review | SEC-5, IAM-6, §11 | UX-29 |
| 13 | Tenant data export / exit | PRIV-5, PRIV-8; Pasal 22 | PR + UX-30 |
| 14 | Vendor operator console (provisioning, audited support) | PR-1; §3 actor | UX-31 |
| 15 | Settings "Aturan" screen | PR-38 scenario | UX contract |
| 16 | "Saya" self-service (Komisi Saya, Target Saya) | IAM own-commission row; BC-8 | UX contract |
| 17 | Doctor worklist | UX-8 entry point | UX contract |
| 18 | Procedure consent capture (separate from purchase agreement) | PR-11; BC-5 [C]; Q-07 | UX contract |
| 19 | WhatsApp template management and number settings | PR-28; R-02; navigation "WhatsApp" | UX contract |
| 20 | Supplier master for purchase orders | PR-17; Kliniknuma UX-17 | UX-11 extension |
| 21 | In-app notification centre (FO alerts) | PR-15 [C] | Component contract |
| 22 | Pending-dispensing close block; dose-delta reconciliation | CLIN-025, CLIN-020 | PR-7 / PR-15 clauses |
| 23 | Accreditation logbooks (stock and nursing) — decide LATER or keep | Kliniknuma REQ-011, REQ-016 | README row |

### Test commands for the supervisor to run

- `python3 ~/dotfiles/skills/local/development-spec-suite/scripts/check-traceability.py ~/Documents/work/prd/clinic-dashboard`. The README records this check as PASS, but it only checks ID-to-ID links. It won't catch F-1, F-2, F-5 or F-7. Run it again after the fixes.
- After the colour token fixes, check the ratios above again with a contrast tool, for example the `dotuiux check` floor gates in UI-10.

### Verdict

**BLOCK — not ready for owner approval.** The money rules and the visit, board and room flows are solid and match the decisions. But five P1 gaps need fixing first:

1. No catalog screen and no branch price override (F-1).
2. The KPI dictionary and four of the six role dashboards are missing (F-2).
3. Clinical complaint and adverse-event escalation was dropped (F-3).
4. No approval screens, including where a clinician approves an addition (F-4).
5. CLIN-001 to CLIN-028 have no home in the PRD (F-5).

Fixing these, plus F-6 (splitting the bundled requirements) and F-7 (completing the README map), should move the kit to "OK with notes". The design-system fixes (F-11 to F-13) are small token and glossary edits.