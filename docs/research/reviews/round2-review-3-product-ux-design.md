# Round 2 product, UX and design-system review of the Clinic Dashboard planning kit (v0.2)

- **Scope:** I read the full focus files: DESIGN.md, design-brief.md, `10`, `17`, UX-CONCEPT-APPLE-STYLE.md, 02-PRD.md, PLAN.md, AGENTS-DRAFT.md and README.md. I also checked `07-IAM` for roles.
- **Baseline:** DECISION-REGISTER wins wherever it disagrees with the kit.
- **Contrast:** every ratio below is worked out by hand with the WCAG 2.x relative-luminance formula.
- **Read-only:** I did not edit any file.

## 1. Verdict: **PASS-WITH-FIXES**

Four of the five round-1 P1s are closed. F-2 (KPI dictionary and dashboards) is only partly closed: two dashboards still have no screen. The new Apple-style token set checks out numerically.

Still to fix:
- **One new P1:** staff who hold several roles have no defined navigation.
- **P2s:** gaps in screen-contract depth, tab and dashboard mapping, bar-glass contrast, iOS Dynamic Type wiring, and contradictions inside the concept document.

---

## 2. Prior findings

| ID | Status | Evidence |
|---|---|---|
| F-1 Catalog and branch price | **Closed** | PR-41 and PR-42 with scenarios; UX-25; README REQ-020 → PR-41/42/24 |
| F-2 KPI dictionary and dashboards | **Partially** | Appendix A K1–K19 and PR-33a–f are done. Two gaps remain (N-3, N-4): **PR-33d (BC) and PR-33e (CS) map to no UX-\***, and K3, K6, K9, K11, K16 appear on no dashboard |
| F-3 Clinical escalation | **Partially** | PR-43, UX-28, IAM row and CLIN-016/024 → PR-43 are done. "Response target" has no default value (no CD-\* row) and UX-28 has no contract |
| F-4 Approvals | **Closed** | UX-26, UX-27 with contract, PR-44, PR-45 and scenario; shift variance and late correction included |
| F-5 CLIN scenarios | **Closed** | `02` §8.1 maps all 28; the §15 box is honestly unticked |
| F-6 Bundled requirements | **Partially** | Scenarios were added for PR-9 and PR-15, and PR-12, PR-18 and PR-40 were reworded. PR-2, 3, 5, 13, 17, 19, 23 and 30 still have one scenario each; §15 defers the split "to task level" |
| F-7 README map | **Partially** | Mostly fixed. The NEW row still lists PRs that have Kliniknuma ancestors: PR-44 (RG-06), PR-46 (REQ-016) and PR-48 (TASK-037 / UX-14). "KEEP + GATE" is missing from the legend |
| F-8 Privacy and lifecycle screens | **Closed** | PR-49 to PR-53 and PR-55; UX-29 to UX-34 |
| F-9 Operational screens | **Partially** | Closed: roster (UX-33), Aturan, Saya › Komisi/Target, Notifikasi. Still open: **procedure consent capture** has no screen (PR-11, CLIN-022), the Finance tab **"Laporan" is undefined**, WhatsApp template management has no UX ID, and there is no supplier master |
| F-10 BC workspace | **Closed** | UX-7 uses the 4-step model; "Observasi Kulit" with chips only; PR-9 clause and rejection scenario |
| F-11 Tokens | **Closed** | `--control-border` #7C7C80 = 4.16 on white and 3.73 on grouped (verified). Chart-4 #B5568C = 4.49 (verified). The rail is gone. UI-2 covers the soft variant |
| F-12 Tablet layout | **Closed** | Size classes are <700 / ≥700 / ≥1180, body text 17 px, viewports 390/820/1180/1440 everywhere, keyboard rule via `visualViewport` |
| F-13 Terms | **Closed** | Glossary now uses Ruang Tindakan, BC Pembimbing and Perlu Ditangani, with a loanword column (D-17) |
| F-14 YAGNI | **Partially** | Closed: campaigns in Release 1.1 (D-13), Coretax as a Should (A-15), BSP fallback (W-09). Still open: PLAN CD-17 measurement templates (GAGS/mMASI/IGA) have no PR |
| F-15 to F-17, F-22 | **Closed** | PR-22 refund on request; UX-13 actor; "Buku Besar" removed; OTP fallback via vendor WABA (W-11, TD-26) |
| F-18 Owner dashboard details | **Closed** | Sequential hue for aging; local day per branch, summed for consolidated view |
| F-19 Money format | **Partially** | `maximumFractionDigits: 0` is set. The separator is still inconsistent: Intl output is `Rp 350.000` with a non-breaking space, but UX-12 shows "Terima Rp350.000" and the sketch shows "Rp 18,4 jt". The compact format is not specified |
| F-20 Navigation groups | **Open** (folded into F-9) | Finance tab "Laporan" has no screen |
| F-21 Glare / sheet edges | **Open (P3)** | White cells on #F2F2F7 ≈ 1.12:1, and clinical-room screens get no edge rule |

---

## 3. New findings

### P1

**N-1. P1 — Staff with more than one role have no defined navigation.**
- **Where:** `17` Navigation; `10` UI-11; DECISION B-19; IAM-3 ("acting role").
- **Problem:**
  - Each role has a fixed set of up to 5 tabs.
  - B-19 lets one person hold several roles. Owner-doctor and FO+cashier+CS are common combinations in mid-size Indonesian clinics.
  - Owner plus Doctor would be 9 tabs. Nothing defines merging the tab sets or switching between roles.
  - IAM-3 requires every action to record the acting role, but the UI has no way to choose that role.
  - The roles facility head and records officer (IAM-8) have no tab row at all.
- **Fix:** add to `17` Navigation:
  > "A person with several roles chooses an active role in Saya › Ganti Peran. The tab bar shows that role's tabs. The active role is shown under the large title and recorded as the acting role (IAM-3). The last choice is remembered per device. Facility head: Ringkasan · Persetujuan · Keluhan · Audit · Saya. Records officer: Koreksi · Pasien · Audit · Saya."

  Add a scenario to PR-3 or PR-44: "an owner who is also a doctor switches to Dokter; actions are recorded with acting role Dokter."

### P2

**N-2. Most screens are a single inventory row, which AI coding agents cannot build from without guessing.**
- **Where:** `17`.
- **Problem:** only UX-6, 7, 8, 9, 12, 20 and 27 have contracts. UX-25, 26, 28, 29 and 33 (new P1 fixes), UX-13, 14 and 16 (money), and UX-17, 21 and 22 have no fields, sections, blocked states or permissions.
- **Fix:** add a contract block of five or six bullets to each Must screen using one template: sections · primary/secondary actions · blocked-with-reason states · role visibility (IAM row) · drill-down targets. Make this a gate before M0.5 and M1 tasks are written.

**N-3. Several tabs and dashboards have no screen.**
- **Where:** `17`, `02` §7.1.
- **Problem:**
  - BC tabs "Pasienku" and "Target" have no screen; PR-33d is unmapped.
  - CS dashboard PR-33e is unmapped.
  - Doctor tab "Pasien", Owner tab "Cabang" and Finance tab "Laporan" have no UX ID.
- **Fix:** add these screens:
  - UX-35 Pasienku (BC home, PR-33d)
  - UX-36 Ringkasan CS (PR-33e; or make it a section of UX-17)
  - UX-37 Cabang (branch detail and league)
  - UX-38 Laporan (export list: K-reports, roll-forwards)
  - Pasien search, inside UX-29

**N-4. The KPI dictionary and the dashboards do not match.**
- **Where:** `02` Appendix A vs PR-33a–f.
- **Problem:**
  - K3, K6, K9, K11 and K16 appear on no dashboard.
  - The PR-33a scenario asserts K3, but PR-33a does not list K3.
  - PR-33d (Must) shows K19 target attainment, but target setting PR-47 is only a Should, so the dependency runs the wrong way.
- **Fix:**
  - Add K3 and K6 to PR-33a and PR-33f.
  - Add K9, K11 and K16 to the PR-33a branch league, or mark them "Laporan only".
  - Raise PR-47 to Must, or drop K19 target attainment from PR-33d.

**N-5. The tab bar's glass background is too transparent for its 11 px labels.**
- **Where:** DESIGN.md Materials; UX-CONCEPT §4.4.
- **Problem:**
  - Glass is 86% white. Over dark scrolled content, for example clinical photos, the worst-case backdrop is L = 0.7105. That gives:
    - tint text: **4.24:1**
    - `--label-2`: **4.34:1**
  - Tab labels are 11 px semibold, so both need 4.5:1, and both fail.
  - UX-CONCEPT's 72% `color-mix` version gives **2.94:1**.
  - The "5.47 bar glass" figure in DESIGN.md does not state what backdrop it assumes.
  - UI-2 does not check the tenant accent against the bar.
- **Fix:**
  - Set glass opacity to **0.92**. Over a black backdrop that gives tint 4.89:1 and label-2 5.00:1. Opacity must be at least 0.885.
  - Define the unselected tab colour as `--label-2`.
  - Add a fifth UI-2 check: "accent on glass over black ≥ 4.5:1".
  - Delete the CSS block in UX-CONCEPT §4.4.

**N-6. iOS text-size settings will not reach the app as specified.**
- **Where:** DESIGN.md Type; UI-12.
- **Problem:** DESIGN.md says `html{font-size:100%}` lets "OS text size settings scale everything". In WebKit, the iOS Dynamic Type setting reaches web content only through `font: -apple-system-body`.
- **Fix:** add:
  > `@supports (font: -apple-system-body) { html { font: -apple-system-body; font-family: <stack>; } }`

  Define every size relative to a 17 px root (Body = 1rem). Add a text-size check on iPad to UI-12.

**N-7. UX-CONCEPT contradicts the canonical tokens that agents are told to read.**
- **Where:** UX-CONCEPT §4 and §7–§8.
- **Problem:** AGENTS-DRAFT lists UX-CONCEPT as a UI source, and it conflicts with DESIGN.md in several places:

| Item | UX-CONCEPT | DESIGN.md / `10` |
|---|---|---|
| §4 heading | "replace `DESIGN.md` tokens if accepted" | — |
| Cell radius | 10 px | 12 px |
| Touch target floor | "never below 28" | UI-4: 44 |
| Press feedback | 150 ms | 120 ms |
| Font note | "replaces Archivo/Bodoni" (stale) | — |
| §7 | lists "no dark appearance" as a finding | — |
| §8 | "both appearances"; 320 px viewport | — |

- **Fix:** add a header line: "Rationale only; on conflict DESIGN.md / `10` win." Delete the value tables in §4.2–§4.5 and point to DESIGN.md. Fix §7 and §8.

**N-8. "Single-word tab" rule is broken by the kit's own tabs.**
- **Where:** UI-11 and DESIGN.md say "single-word". The kit's own tabs include "Hari Ini" and "Tindak Lanjut".
- **Problem:** an agent that tests against UI-11 will fail the kit's own design.
- **Fix:** change the rule to "≤ 2 words, ≤ 13 characters". Also rename "Serah", which is a bare root word, to **"Serahkan"** or **"Penyerahan"**, both in the tab and in the VisitTrack segment.

**N-9. There is no screen for capturing procedure consent.**
- **Where:** PR-11, CLIN-022.
- **Problem:** UX-9 only checks that consent exists. Who captures it, on which device, and the signature pad are all unspecified.
- **Fix:** add UX-39 "Persetujuan Tindakan":
  - full-screen and signable
  - items and doses taken from the plan
  - re-consent when the dose increases
  - owner role pending Q-07
  - signature pad at least 320×160 px, with "Ulangi"

### P3

- **N-10. Accent rules.**
  - The documented `--tint-soft` #E3F1F5 is not what the "12% over white" formula produces (#E2EEF0, tint-on-soft 4.94). Fix: say the blend is done in sRGB and list the computed default.
  - Accent-on-white and white-on-accent give the same ratio, so one of the two checks is redundant.
- **N-11. Placeholder contrast.** `--label-3` placeholder text is 3.44:1, which fails WCAG 1.4.3 because placeholders are not exempt. Fix: use `--label-2` for placeholders, or allow placeholders only as examples beside a visible label.
- **N-12. VisitTrack segments.** 10 segments at 390 px are about 36 px each. Fix: define the segment states (selesai, berjalan, terblokir, tidak perlu), each with a symbol, plus an accessible name such as "Langkah 4 dari 10: Dokter — menunggu".
- **N-13. Approval cards.** A prominent "Setujui" on every card in the UX-26/27 inbox breaks UI-13 (one prominent action per view). Fix: keep the prominent button in the card detail only; in the list use swipe actions or plain buttons.
- **N-14. Forced dark mode.** Declare `<meta name="color-scheme" content="only light">` to stop Chrome Android from forcing dark mode on a light-only app. Set manifest `theme_color` and `background_color` to #FFFFFF.
- **N-15. Stale PR ranges.** README and PLAN say "PR-1–PR-54"; PR-55 exists.
- **N-16. Manager action label.** UX-21's primary action "Buka Daftar" is vague. Use "Lihat yang perlu ditangani", the same as UX-20.

**Contrast checks that pass** (recomputed, matching the document to ±0.01):

| Pair | Ratio |
|---|---|
| `--label-2` on white / grouped / surface-2 / tint-soft | 5.99 / 5.37 / 4.95 / 5.18 |
| `--label-3` on white | 3.44 |
| Separator | 1.71 |
| `--tint` on white / grouped | 5.85 / 5.25 |
| Danger on white / soft | 5.73 / 5.01 |
| Warning on white / soft | 5.78 / 5.20 |
| Success on white / grouped / soft | 5.40 / 4.84 / 4.80 |
| Locked on soft | 6.69 |
| Neutral on soft | 9.38 |
| Badge | 5.38 |
| Face-map complaint | 5.30 |
| `--control-border` on surface-2 | 3.43 |

---

## 4. Recommendations for still-open and ADOPTED-REC items in this lens

| Item | Recommendation |
|---|---|
| B-19 multi-role (ADOPTED-REC) | Fix N-1: role switcher and acting-role display |
| D-07 BC target (ADOPTED-REC) | Make PR-47 a Must, or remove K19 from PR-33d (N-4) |
| D-06 / K11, D-08 / K14 | Put K11 on PR-33a. K14 is covered by PR-33e but needs the UX-36 screen |
| D-11 own trend only | Already met. State in UX-20 that the delta compares with the tenant's own previous period |
| D-13 campaigns | Mark the UX-19 row "Release 1.1 — not built in R1" so agents skip it |
| D-17 terms | Done. Add "Serahkan" and the Ganti Peran label to the glossary |
| B-15, B-18, B-14 | Write contracts for UX-13 and UX-14 (N-2): reserve vs redeem wording, receivable conversion, owner-only write-off with required reason |
| W-11 OTP | Add the UX-24 contract state "Kode dikirim dari nomor layanan [Brand]" for the vendor-WABA fallback |
| PD-01 consent ledger | Write the UX-29 contract: consent list with purpose, date and withdraw button |
| F-3 response target | Add CD-33 "Complaint first clinical response ≤ 2 h in opening hours (pending clinical lead)" |
| F-14 CD-17 | Mark the measurement templates LATER, or add a PR |

**For the supervisor to run** (I have no shell access):
- `python3 ~/dotfiles/skills/local/development-spec-suite/scripts/check-traceability.py ~/Documents/work/prd/clinic-dashboard`. It will not catch N-3 or N-4, so also check by hand that every PR-33x maps to a UX-\*.
- After fixing N-5, verify the bar-glass contrast with a contrast tool over a black backdrop.