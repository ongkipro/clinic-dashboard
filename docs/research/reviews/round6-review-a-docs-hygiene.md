# Round 6 pre-commit review a — docs-hygiene (kit v0.7)

- Reviewer: claude-opus-5-5 via direct pi run (read only), 2026-11-02.

# Pre-commit review: Clinic Dashboard kit v0.7, Focus A (documentation hygiene and navigation)

## Verdict: **READY-WITH-FIXES**

The structure, ID ranges and milestone coverage hold up. One P1 must be fixed in the promotion commit. The P2s should be fixed before the first development task. Nothing found needs a rewrite.

## Findings

| ID | Sev | File + location | Problem | Exact fix |
|---|---|---|---|---|
| A-01 | **P1** | `README.md` Status ("Planning only: no repository, code or deployment is authorized"); `PLAN.md` header ("Planning only; no development authorized"); `DECISION-REGISTER.md` header ("No development, repository, deployment, or provisioning is authorized"); `02-PRD.md` §1 ("development not yet authorized"); `15` DEL-1 ("awaiting authorization") | Once promoted, the first commit of the new repository would say that the repository is not authorized. No authorization decision is recorded. G1 also needs "PRD approved", but `02-PRD` §15 "[ ] Owner approval" is still unticked. | Add a register entry, e.g. **P-27** "Development authorized (DEL-1/G1), date, scope". Update these status lines to "Authorized per P-27" and tick the §15 approval, or record that G1 is partial for the 7 PRs held by Q-12. Otherwise, commit only as a non-authoritative snapshot and keep the wording. |
| A-02 | P2 | `DECISION-REGISTER.md` D-13 | The term "Release 1.1" survives here: "Campaigns … move to Release 1.1". P-24 says D-13 was amended, but the row itself was never changed. The register says it "wins" in conflicts, so the stale row carries authority. | Reword D-13: "Campaigns and segments built in Release 1; sending switched off until Q-15 (amended by P-24)". |
| A-03 | P2 | `DECISION-REGISTER.md` P-15, P-18, A-15, D-09 | "Should" still appears in four rows: "Purchasing/Gudang Pusat (Should), Auditor Internal read-only (Should)" in P-15, "Should — promo codes…" in P-18, "Coretax XML export is a Should" in A-15, and "Coretax XML Should" in D-09. P-24 states that every Should became Must. | Replace each "Should" with "Must (P-24)", or add "→ Must per P-24" to each row. |
| A-04 | P2 | `DECISION-REGISTER.md` B-16 | B-16 says outbound budget, disposal thresholds and stock-count cadence are "fixed product defaults, not settings". That contradicts `19` SET-21, SET-43 and SET-27 and `PLAN` CD-21/CD-27, which are class S. B-24 only supersedes "B-09/B-22", so B-16 is still in force. | Add "Superseded by B-24/P-22 except idle lock (CD-10, class F)" to B-16, and name B-16 in B-24. |
| A-05 | P2 | `02-PRD.md` §7 PR-40, Priority column = "**Could**" | This contradicts the owner decision ("all Must; PR-40 Phase 4") and the README ("all Must … PR-40 Phase 4"). "Could" is a stale MoSCoW term. | Set Priority to "Phase 4 (P-21, P-17)". |
| A-06 | P2 | `README.md` Kliniknuma tables, Money model row ("no sharing, no loyalty in release 1") and RG-36 row ("no package sharing") | Both contradict PR-93 and P-24: family sharing is a per-template switch, default off. | Change to "sharing only when enabled per package template (PR-93, default off)". |
| A-07 | P2 | `AGENTS-DRAFT.md` Non-negotiable rules ("No SaaS telemetry, session replay or ad SDKs") | This is an absolute ban. PR-39 and T-126 allow a consented marketing pixel on the home and branch pages, so an agent following AGENTS.md would refuse T-126. | Reword: "…no ad SDKs except the consented home/branch pixel of PR-39". |
| A-08 | P2 | `TASKS.md` T-001 | The Done-when says versions are "recorded in DECISIONS.md", but `DECISIONS.md` is not in Allowed Paths. The task cannot pass under its own scope rule. | Add `DECISIONS.md` to T-001 Allowed Paths. |
| A-09 | P2 | `TASKS.md` T-128 | Scope covers "Vendor console complete tree **and public site page set**", but Allowed Paths is only `src/app/vendor/**`. | Add `src/app/(public)/[slug]/**` (read-only nav test) and `tests/public/tree.spec.ts`, or split the public part into its own task. |
| A-10 | P2 | `PLAN.md` G1 ("`TASKS.md` for all milestones may be written") and `15` DEL-1 ("`TASKS.md` (written by `prd-taskbreaker` after G1)") | `TASKS.md` already exists with 129 tasks, before G1. A first-time reader cannot tell whether it is valid. | Add to the TASKS.md header: "Pre-G1 draft; re-validated at G1 (Q-12 may change tasks for PR-7/9/14/15/18/71/83)". Align DEL-1 wording to match. |
| A-11 | P2 | `00-OVERVIEW.md` "Navigasi dan pengaturan" ("46 pengaturan") | The registry is SET-1–SET-49 (README, PR-38, `19` §5), so the owner-facing number is wrong. | Change to "49 pengaturan". |
| A-12 | P2 | `02-PRD.md` Document Control/baseline ("refined by the discovery decisions in `~/Documents/work/research/…/DECISION-REGISTER.md`"); `15` DEL-1 and `AGENTS-DRAFT` §Sources item 6 ("copied from research at promotion") | The kit already contains `DECISION-REGISTER.md`. Two copies with no stated canonical one risks drift during the commit. | State once (README "Sources and precedence"): "The kit copy is canonical; the research copy is frozen." Update the PRD path and DEL-1 to "the kit's `DECISION-REGISTER.md`". |
| A-13 | P3 | `00-OVERVIEW.md` ("sekitar 118 halaman") vs `19` §6 ("about 110 page rows in §2 … Vendor console: 12. Public site: 11") | The two counts do not reconcile: 110 + 12 + 11 ≈ 133. | Use one figure taken from `19` §6. |
| A-14 | P3 | `02-PRD.md` §10 ("UX-1–UX-57"); `README.md` map row "Kliniknuma UX-1–UX-17 … 17 UX-1–UX-57" | The current range is UX-1–UX-60 (README kit table, `17` inventory). | Change both to UX-60. |
| A-15 | P3 | `02-PRD.md` Appendix A heading "KPI Dictionary (K1–K19)" | The table runs to K27, and the K19 row sits after K27. | Retitle to "K1–K27" and move K19 after K18. |
| A-16 | P3 | `02-PRD.md` §3 ("JUR-ID-1–JUR-ID-8") | README and the register change log give JUR-ID-1–JUR-ID-11. | Change to JUR-ID-11. |
| A-17 | P3 | `02-PRD.md` §14 Cross-Document Contract | The list stops at `17`. It is missing `18`, `19`, `CONTEXT-RECORD.md`, `DECISION-REGISTER.md` and `PLAN.md`. | Add the missing files. |
| A-18 | P3 | `DECISION-REGISTER.md` H-10 and `02-PRD.md` Q-14 ("Midtrans-style first candidate") | This is a vendor-leaning term the review asked me to flag. The owner decision is "payment port with mock adapter". | Reword to "gateway partner open; mock adapter until Q-14". |
| A-19 | P3 | `README.md` map RG-35 ("LATER · PR-40 · Public pages Phase 4") | The basic public pages are Release 1 (PR-64–PR-67), and publication blocks apply to PR-65. | Change to "MODIFY · PR-65 (R1), PR-40 (Phase 4)". |
| A-20 | P3 | `README.md` map REQ-004 reason "Same" | The reason has no referent. | Write "Phase 4 rich content". |
| A-21 | P3 | `README.md` map "NEW" row | It lists "PR-33a–f", omits PR-33g, and has no entries for PR-56–PR-63 or PR-68–PR-98. | List "PR-33a–g, PR-56–PR-63, PR-68–PR-98 (except those mapped above)". |
| A-22 | P3 | `README.md` Kit contents | Numbering jumps from `07` to `09`, and a first-time reader will look for `08`. | Add the note "08 not used (no separate file in this pack)". |
| A-23 | P3 | `PLAN.md` §1 "Release 1 scope" | The declined narrowing is stated twice, and "the narrowing option below" has nothing below it. | Keep one sentence. |
| A-24 | P3 | `PLAN.md` §3 | The fixture rule is repeated: "(written as the **first M4 task** … (written in that first M4 document task)". The section also cites `SESSION-HANDOFF-2026-10-30.md` and `OPERATIONAL-SCENARIO-AUDIT.md` without a path, though neither is in the kit. | Remove the duplicate and prefix the files with `docs/research/`. |
| A-25 | P3 | `PLAN.md` §4 | The header says "the SET row holds the canonical default", but CD-01–CD-09, CD-36, CD-37 and CD-39 (class S) have no SET pointer. Mapping: CD-01→SET-6, CD-02→SET-7, CD-03→SET-8, CD-04/05→SET-9, CD-06→SET-10, CD-08→SET-11, CD-09→SET-15, CD-36→SET-18, CD-37→SET-12, CD-39→SET-14. | Add "→ SET-n" to each. |
| A-26 | P3 | `DECISION-REGISTER.md` B-24 ("categories per `17` Pengaturan menu") | The menu is owned by `19` §2.17/§5. | Change to `19`. |
| A-27 | P3 | `DECISION-REGISTER.md` §10 Change log | The entries are not in chronological order (the kit-v0.4 and kit-created rows sit at the bottom), and P-24 has no entry. | Reorder the entries and add P-24. |
| A-28 | P3 | `TASKS.md` T-011, T-012, T-013 Visual Contract ("per `docs/spec/17` 10 / DESIGN.md", "`docs/spec/17` 19 NAV-1–NAV-8", "`docs/spec/17` 10 Component Contract") | These are garbled template references. | Change to "`docs/spec/10` …", "`docs/spec/19` §1 NAV-1–NAV-8" and "`docs/spec/10` Component Contract". |
| A-29 | P3 | `TASKS.md` T-014 Done-when ("browser check of UX-26 at 390/1440") | This conflicts with the Rules header ("390/820/1180/1440"). | Use all four widths. |
| A-30 | P3 | `AGENTS-DRAFT.md` | The R3 review rule appears twice with different lists: "(money, auth, tenancy, migrations, vendor access)" and "(money, auth, tenancy, migrations, clinical signing)". The test table also uses `pnpm exec tsc --noEmit`, while T-001 uses `pnpm typecheck`. | Merge into one list with both items, and use `pnpm typecheck`. |
| A-31 | P3 | `02-PRD.md` §13 | Q-06 is due "before Phase 3", but G3 is "Phase 2 onward" (PLAN). Q-17 says "before PRD approval" but blocks G2. The rows run in reverse order (Q-19 to Q-15). | Q-06: "before journal export (G3)". Q-17: drop "before PRD approval". Sort the rows by ID. |
| A-32 | P3 | `17` Screen inventory | The UX-57 row sits after UX-60. | Move it after UX-56. |
| A-33 | P3 | `00-OVERVIEW.md` | Level 1 text ("di sesi yang terlihat dan bisa dihentikan owner klinik") leaves out that owner approval is required first for clinical scope (PR-60). The pending-decisions table also leaves out G2 blockers Q-08, Q-10, Q-11 and R-01. | Add "dan untuk data klinis harus disetujui owner dulu". Add one row: "Q-08, Q-10, Q-11, R-01 — Pasien sungguhan pertama (G2)". |
| A-34 | P3 | Version headers: `PLAN.md`, `TASKS.md`, `DECISION-REGISTER.md`, `CONTEXT-RECORD.md` | These lack the "kit v0.7" marker that every numbered file carries. | Add "kit v0.7 / 2026-11-02". |

## Verified good

- The README kit table has 28 entries, matching the 28 files. Its ID ranges match the bodies I read: PR-1–PR-98 plus PR-33a–g, K1–K27, SET-1–SET-49, UX-1–UX-60, T-001–T-129, CD-01–CD-40, and a 16-role matrix.
- Every PR-1–PR-98 except PR-40 maps to a milestone in PLAN §1; PR-40 is explicitly Phase 4.
- The TASKS summary counts add up to 129, matching the README, the overview and the PLAN header.
- Every numbered file I spot-checked carries an identical Document Control line: "kit v0.7 / 2026-11-02 (history: review rounds 1–5 …)". That covers 01–07, 09–19.
- The owner decisions are applied consistently in the README, the overview, the PRD and the register: Release 1 is complete (P-21/P-24); research defaults are adjustable in Pengaturan (P-22/P-25, `19` §5 with bounds and "Kembalikan ke default"); expert input goes into the compliance register (P-26/PR-97/UX-58); Numa Klinik is first (P-20/P-23); tenders plus a server fee via AutoLaris (P-14/PR-61); payment port with a mock adapter (PR-68, CD-39, SET-14).
- The Q-12 scope is the same wherever it appears (7 PRs): PRD Q-12, PLAN G1 and the overview.
- Store words appear only in prohibitions (PRD §3 domain guard, AGENTS-DRAFT). "Subscription" appears only as a non-goal. No "M10" anywhere.
- The `00-OVERVIEW` Indonesian is clear, plain and consistent with the PRD rules: 10 steps, 5 money rules, Release 1 scope, and the rule that simulated payments never count as money.

Not reviewed: TASKS.md lines 240–760 and 810–1380, and the bodies of the numbered files 03–16 and 18 beyond their headers.
