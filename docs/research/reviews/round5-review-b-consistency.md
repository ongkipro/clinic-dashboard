# Round 5 review b — consistency (kit v0.6)

- Reviewer: claude-fable-5-1 via direct pi run (read only), 2026-11-02.

**Verdict: READY-WITH-FIXES** — the catalogue (19) is the most current and internally coherent file; the problems are that 17 (v0.4) and 07 (v0.4) were not re-synced after the v0.5–v0.6 additions, and 19 delegates two things (tab bars, settings location) to the stale file.

## Findings

| ID | Sev | Evidence | Problem | Smallest fix |
|---|---|---|---|---|
| F-1 | P1 | 19 §Doc control ("17 owns … the role tab bars") vs 17 §Navigation tab table vs 19 §2.18 | The declared owner (17) contradicts 19 for 7 roles: Marketing (17: "Promo arrives in 1.1" vs 19: Promo tab, Kode Promo R1 — also contradicts P-24 and 17's own "Tab → screen: Promo UX-50"), Purchasing (+Utang), Auditor (+Persetujuan, Log), Finance (+Pajak), Records officer (+SATUSEHAT), Nurse (+Jadwal), Admin Pusat (Katalog vs Layanan) | Replace 17's tab table with 19 §2.18 (or make 19 §2.18 the owner and delete the table in 17); drop the "1.1 Promo" remark |
| F-2 | P1 | 19 §7 ("each UX-* names its PR-*"; new PR-88–PR-96) vs 17 inventory Requirement column | None of PR-88–PR-96 appear in any UX-* row (UX-25 lacks PR-88, UX-11 PR-89, UX-52 PR-90, UX-3 PR-91, UX-30 PR-92, UX-13 PR-93, UX-55 PR-94, UX-38 PR-95, UX-13/14 PR-96). Contracts also lack the segments: UX-52 has no Utang, UX-22 has no Kewajiban/Rekon/Pajak/Biaya/Buku Besar, UX-28 no Insiden, UX-9 no Logbook, UX-3 no Akses, UX-30 no Privasi. 17 states a Must screen without contract gets no task | Add the PR ids to the Requirement column and one line per new segment in the matching contract row |
| F-3 | P2 | 19 §2.2 Layar Antrean "tanpa nama pasien (fixed)" + §5 fixed rules vs 17 "Contract for UX-6 additions": "no patient names unless the tenant enables first names only" | Fixed rule vs tenant toggle | Delete the "unless…" clause in 17 |
| F-4 | P2 | 17 §Navigation Saya list ("Klinik & Cabang, Staf, Katalog & Harga, Pemasok, Template WhatsApp, Aturan…"); "Aturan (PR-38) is a Saya inset grouped form"; UX-11 "Pemasok in Saya"; UX-17 "Template list in Saya" vs 19 §2.16 Saya and §2.17 Pengaturan (16 pages) | Settings and masters live in two different places | Rewrite 17's Saya paragraph to 19 §2.16; replace "Aturan … Saya form" with "Pengaturan (19 §2.17)" |
| F-5 | P2 | 19 SET-48 group "Apotek" vs 19 §2.17 group list (16 groups, no Apotek) and §6 "16 setting pages" | SET-48 has no page | Move SET-48 to group "Klinis" or "Stok" (or add an Apotek group and change count to 17) |
| F-6 | P2 | 19 SET-26 "Changed by: Pharmacist, purchasing" vs 07 matrix "Tenant/branch settings" Purchasing = – | Purchasing edits a setting it may not access | 07: Purchasing ◐ (stock SET group), or SET-26 changed by pharmacist only |
| F-7 | P2 | 19 §2.5 Rencana Perawatan "BC, nurse, therapist (projection)" vs 07 "Plan options & prices": nurse/therapist = –, FO/cashier ◐ (view) | Nurse/therapist projection not granted in 07; FO view not in 19 | Add nurse/therapist ◐ (items of assigned visit) in 07; add FO (view) in 19 row or drop from 07 |
| F-8 | P2 | 19 §2.14 Kepatuhan & Pendapat Ahli (UX-58, PR-97) roles vs 07 matrix (no row) | Owner decision P-26/PR-97 feature has no capability row; FH/finance edit rights undefined in 07 | Add row "Compliance register (PR-97)": Owner ●, FH ◐ clinical, Finance ◐ tax/accounting, Admin Pusat/Auditor ◐ read |
| F-9 | P2 | 19 §2.18 Auditor tab "Persetujuan" vs 19 §2.14 Persetujuan roles (no auditor) vs 07 (auditor has no approval capability) | Tab points to a page the role cannot open (NAV-1) | Change auditor tab to "Log" + "Laporan" only, or state it opens UX-53 "approvals" list |
| F-10 | P2 | 17 UX-19 actor "Manager" vs 19 §2.11 Kampanye "Marketing" vs 07 Public site & promos: manager – | Wrong actor | 17 UX-19 actor → Marketing |
| F-11 | P2 | 19 §2.11 Otomasi roles "Admin Pusat, marketing; FH; manager (proposals); CS" vs 17 UX-55 visibility "Admin Pusat, CS (log)" vs 07 Templates & reminder rules: Marketing ◐ "marketing templates" only | Marketing editing automation scenarios is not in 07; 17 omits FH/manager/marketing | Align 07 Marketing cell to "◐ marketing templates, automation scenarios (SET-19 draft)" and 17 UX-55 visibility to 19 |
| F-12 | P3 | 19 SET-2 changed by "Admin Pusat, manager" vs 17 UX-2 "manager (view own)" | Manager can edit hours via settings but not via the page | Make UX-2 ▸ Jam editable by manager, or SET-2 Admin Pusat only |
| F-13 | P3 | 17 UX-3 actor "Owner, manager", primary "Undang" vs 19 §2.10 Undangan "Owner, Admin Pusat"; manager view-only | Manager invites in 17 | UX-3 actor → Owner, Admin Pusat |
| F-14 | P3 | 17 UX-28 contract "response target (CD-33)", hand-off map "≤ CD-33/CD-40", UX-20 "leads past 15 min" vs 19 SET-31 / SET-20 | Hard-coded values that are now settings (P-22) | Reference SET-31 / SET-20 |
| F-15 | P3 | 19 §2.13 "Kamus KPI is its own page" and §2.1 "UX-21 variant"/"UX-36 variant" (FH, Marketing homes) vs NAV-8 "new pages get the next UX-* ID" and 17 inventory | Pages without UX id / contract | Add UX-59 Kamus KPI, and either UX ids or a variant line in UX-21/36 contracts |
| F-16 | P3 | 07 IAM-11 "not owner-only powers: branch price overrides, cash-refund and write-off approval…" vs matrix (Owner ● only), SET-5 "Owner only" | Sentence reads as the opposite of intent | Reword: "Admin Pusat never holds the owner-only powers: …" |
| F-17 | P3 | 19 §2.11 Otomasi "tindak lanjut H+1/H+7/H+14" vs SET-19 default "H+7/H+14/H+21"; SET-31 hijau default "1 hari kerja" vs bounds "4–24 jam"; SET-41 "cicilan maks" has no bounds; SET-46 listed after SET-49 | Small default/bounds inconsistencies | Align offsets to SET-19; express hijau as hours; add cicilan bounds; reorder SET-46 |
| F-18 | P3 | 17 UX-6 segments (3), UX-5 views (2), UX-22 segments (3), UX-17/UX-31 visibility (no manager/owner; no records officer) vs 19 §2.2/2.3/2.12/2.11/2.14 and 07 | Contract bodies older than 19 | One-line updates to match 19 |

## Good

- 19 §5 registry is complete and consistent with P-22/P-25: every row has default + provenance, bounds, scope, changer; class-F list is explicit and matches IAM-7, B-04, gap-free sequencing.
- 07 control levels (IAM-9/10/11) and requester ≠ approver are applied consistently in 19 §3 vendor pages, SET-43 and the 17 state matrix.
- Daftar Pasien role list in 19 matches the 07 "Patient identity" row exactly; clinical projection (BC "items/stages/prices only") mirrors 07.
- UX-56 SIMULASI, UX-19 "sending off until Q-15", public site no-promo rules are stated identically in 17, 19 and 07/IAM-2.
- Release column is uniformly R1 (P-24) and the page count in §6 matches the group list.
