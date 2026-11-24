# M8 exit evidence (T-119) — final exit candidate (e2)

Task T-119 (PR-26, R3). Allowed paths `docs/evidence/m8/**`, `STATUS.md` (plus owner-authorized Option 1 requirement-linked scope expansion to `TASKS.md` for T-119 Done-when timing alignment, 2026-11-24 18:10 WIB). Depends on T-106, T-108, T-115, T-117, T-118, T-102, T-109–T-114.
Started as the scaffold (Lane C, 2026-11-19, base `af295ec1`, run `RUN-20261119T124205Z-dabd64a2`), verified through preliminary gate `353387aa` (`RUN-20261122T173821Z-16a51bfd`), final runs f1–f3 on `aa8603bb` (`RUN-20261123T113506Z-d634565d`, R3 APPROVE pending owner gates), unified u1 on `40cc4e99` (`RUN-20261124T030704Z-d7dda389`, integrated at `dc3a9ee5`, CI `45323638379` green), and final exit candidate e1 on `2e417cb8` (`RUN-20261124T095701Z-7700d9e7`, `freeze-e1` preserved read-only, closed FAIL after Panel 1 R3 review `R3-REVIEW-e1-panel1.md` REQUEST_CHANGES on canonical `TASKS.md:1402` timing alignment).
This **final exit candidate (e2)** runs on verified green `main` **`2e417cb8`** (`HYG-027`, CI `45326107021` green), ledger run **`RUN-20261124T111142Z-4f88726e`**, recording Paduka Ongki's explicit owner amendments in canonical `TASKS.md:1402` alongside the evidence pack: `2026-11-23` Panel 2 (`t119/final/OWNER-AMENDMENT-M8-EXIT-20261123.md`, `M8-AMEND-1`/`M8-AMEND-2`) and `2026-11-24` Panel 3 (`16:36 WIB` `M8-AMEND-3-TD31-SATUSEHAT` + `SET-35 = PIN`; `16:55 WIB` `M8-AMEND-4-WALKTHROUGH-STAGING`; `18:10 WIB` Option 1 `TASKS.md` timing amendment; `t119/final/OWNER-AMENDMENT-M8-EXIT-20261124.md`).

Exit check (PLAN.md §1, M8 row): "Ledger reconciles to sub-ledgers on the §3 fixtures; KPI values equal fixture expectations for K1–K19 and
PR-95 metrics." Done when (TASKS.md T-119, amended 2026-11-24): `pnpm test -- m8` passes and `check-scenarios.py --final` exits 0 with 0
deferrals and only owner-amended exceptions; manual owner walkthrough J1–J8, J10 (Phase 1 demo on synthetic data, 02-PRD §Release phases) is
deferred to mandatory synthetic staging acceptance after M9 under `DEC-034` (`M8-AMEND-4-WALKTHROUGH-STAGING`, not signed off and not an M8
exit prerequisite); `T-102 TD-31`/`TD-34` external SATUSEHAT sandbox acceptance remains OPEN/HELD (`M8-AMEND-3-TD31-SATUSEHAT`); draft KPIs
K4/K12/K14/K15/K17 and G-Q4 U1–U4 remain tracked exceptions (`M8-AMEND-1`/`M8-AMEND-2`).

## What the command is

As in M6: `pnpm test -- m8` is not a filter; vitest gets `m8` after `--` and runs every file — the whole suite on a real PostgreSQL. The JUnit
form puts the reporter flags before `--`:

```
pnpm test --reporter=default --reporter=junit --outputFile.junit=<run>/junit.xml -- m8
python3 docs/evidence/m8/check-scenarios.py <run>/junit.xml            # scaffold / interim: deferred entries allowed
python3 docs/evidence/m8/check-scenarios.py --final <run>/junit.xml    # T-119 close: no deferred scenario, item or journey
```

`check-scenarios.py` requires every M8 PRD §8 scenario (PR-25, PR-26, PR-33a–g, PR-34, PR-62, PR-80, PR-95, PR-98) to be mapped to passing
test cases **or** deferred to its named task; every M8 exit item mapped or deferred, the m8 flow among the mapped; every Phase 1 journey
(J1–J8, J10) mapped; every mapped name present verbatim in its file and exactly once, passed, in the report; no failure anywhere. With
`--final` any deferral fails, and so does any `final_required` entry: a mapped case that proves only part of its journey or item lists
the missing parts there (machine-checked, unlike the free-text `open` notes). An `owner_amended` entry must equal one entry of the reviewed
allowlist `OWNER_AMENDMENTS` in `check-scenarios.py` (id, exit item, the exact pinned amendment file `t119/final/OWNER-AMENDMENT-M8-EXIT-20261123.md` or `t119/final/OWNER-AMENDMENT-M8-EXIT-20261124.md`, exact
scope); anything else fails the check. An allowlisted entry is reported by `--final` as AMENDED, never as passed and never as a failure. The report also fails on aggregate `errors` or `failures`
on the root or a suite. Structure alone never passes.

Checker self-test (2026-11-19, synthetic JUnit fixtures in `/tmp`, removed after): the full map passes (22 distinct mapped cases + one
unrelated case); it fails on a mapped case missing, failed, skipped or duplicated, on an unrelated failed case, on J10 unmapped, on PR-98
neither mapped nor deferred, and `--final` fails the scaffold (15 deferrals). The checker's own self-test (`selftest.py` in the gate kit) is executable. Preliminary limit: the gate records the m8-flow JUnit only. The
mapped cases in other files (ledger, sub-ledgers, recon, M1/M2/M6 flows, billing, commission) are proven green at the final run, where
check-scenarios.py runs on the full `pnpm test -- m8` report.

## The M8 flow (`m8-flow.test.ts`)

One tenant, two branches (Kemang b1, BSD b2), a month of §3 fixture scenarios through the real writers and the real ledger posting consumer
(`runOutboxBatch` with `ledgerPostingConsumer`, as production). Stand-ins only of earlier milestones (closing a patient's earlier open visit
before a new treatment visit, credentials), exactly as `tests/accounting/ledger.test.ts`; no guard paused around an M8 writer.

| Step | Journey | Proves |
|---|---|---|
| J4–J6 (S2) | J4, J5 | selection confirmed, EDC before the treatment, treatment counted: clearing 1,500,000 and revenue 1,500,000 in the ledger |
| J5 addition + J6 receivable (S3b, S14 pattern) | J5, J6 | addition proposed, approved, re-consented, released, performed before billing; converted to a receivable (before any close) and collected in cash: Dr / Cr 400,000 (receivable nets 0) |
| J7 package (S5a / S11) | J7 | package paid in cash at b1, sessions at b1 and b2: inter-branch clearing 0 tenant-wide, +600,000 at b2 |
| J7 balance + J8 expense (S13 pattern, PR-79) | J7, J8 | a top-up by transfer (patient balance +500,000) and a bank-funded expense (Dr branch expense 125,000 at b1) |
| **J8 month end — the M8 exit check** | J8 | for each sub-ledger with ledger accounts (cash/bank = Kas shift + Kas kecil + Bank; gateway clearing; patient receivable; paid-not-delivered; packages; patient balance; booking DP — no deposit on this month, so 0 = 0, `final_required`): sub-ledger period movement = ledger account movement, gross (increasing / decreasing terms vs the two ledger sides) and net, tenant-wide; sub-ledger closing per branch = ledger balance per branch; inter-branch 0; each T-104 comparator ran and reported no mismatch; exact cash / bank 5,275,000 and packages 1,800,000. The month is NOT locked here (J8's lock and export are `final_required`) |
| J8 statements and gates | J8 | every entry balanced with ≥ 2 lines; trial balance 0; preview status; journal export refused (map unsigned, G-ACT); no handover exception; a cashier refused |

Integrated hooks asserted on this month: T-108 PR-34 (recon bersih; J7 clearing legs; exact K1 / K2 totals per branch on both sides) and
T-109 PR-33a (K3 at the selling branch, K2 at the executing branch, b1 and b2 exact).

**Final run (base `aa8603bb`, ledger run `RUN-20261123T113506Z-d634565d`), f2 after the f1 R3 review.** Every former `it.todo` hook
is an assertion on the SAME month, through the production readers and writers on main, with exact values derived in the test comments
and in the derivation note kept with the freeze: T-114 PR-33f, T-115 PR-33g, T-113 PR-33e, T-111 PR-33c, T-112 PR-33d, T-110 PR-33b,
T-116 PR-95, T-117 PR-80 (exactly one outbox entry, keyed `digestKey(tenant, day, email)`), T-118 PR-62, J8 Kunci Periode + payments
export, T-106 PR-98 (runs last of its describe because it makes the tenant PKP).

**KPIs (owner amendment 2026-11-23).** Every SETTLED KPI is asserted EXACTLY on this month from distinguishing fixture facts: K1–K3,
K5–K11, K13, K16, K18 (`dashboard_kpi`) and K19–K27 (`loadReport` / `target_list`, the 0130 report readers). KPI-only facts are added on
the same month through the real writers: a consultation visit with a charged fee (K8), a lead taken from new to converted (K13), a promo
code use (K25), two surveys (K26), costed stock receipts (K7). The draft KPIs K4 / K12 / K14 / K15 / K17 are an **owner-amended exception**
(pending Finance; `owner_amended` M8-AMEND-1-DRAFT-KPI on the KPI item, pinned in the checker): read on this month, not asserted as
acceptance values. K27's median check-in → signature is asserted exactly: the six signed-exam visits get controlled, distinct check-in
instants (90 / 70 / 50 / 30 / 20 / 10 minutes before their signing step, set once at the visit insert); the median is recomputed from the
six (check-in, signature) pairs and differs from 0, the mean and any single pair.

**G-Q4 U1–U4 (owner amendment 2026-11-23, tracked product work).** The linked path (the product billed on its selection line, as the
cashier screen does) reconciles exactly, and right after that hand-over `ledger_handover_exceptions` reports unlinked 0 / fractional 0.
The UNLINKED case runs separately (a product billed without the link and handed over): "Selisih penyerahan produk" counts unlinked 1 at
b1; the sub-ledger records the −150,000 performance while the journal posts nothing; the reconciliation differs by exactly four
paid_not_delivered lines at b1 (net 3,000,000 vs 3,150,000; gross −3,700,000 vs −3,550,000). No journal line is guessed. It is the
`owner_amended` entry M8-AMEND-2-GQ4-U1-U4 on the reconcile item (pinned in the checker); the exact (ledger, term, branch) movement check runs BEFORE this case.

Journey parts on the same month: J1 no slot → waitlist entry; J4 booking DP received and decided (moved to balance), balance shown and
used, a partial payment, a package DP; J5 materials issued and reconciled in the room; J6 the pharmacist's hand-over on the linked line,
`visit_close` refused with `pending_dispensing` before it and accepted after, the close's aftercare notice; J7 expiry → balance; PR-30: the
daily scan creates the J6 patient's own `dormant` follow-up (source patient, CS queue, due day + 91; none at day + 90) — PR-30 belongs to
the scan, not to `visit_close`; then the M8 exit check again: net, gross tenant-wide, closing per branch, gross per branch (sign-folded),
and EXACT per (ledger, term, branch) for every movement of the month (`MOVEMENTS`).

**Seed boundaries** (the state is seeded; the later behaviour runs on the real code): the DP appointment row (the booking writer is proven
in J1 and tests/scheduling), the J7 package's validity end (the expiry scan is real), the PKP-without-advice state and the 70-day PKP
history (the Coretax gate and export are real), the T-113 leads' creation times, the K13 lead's appointment row, SET-37. J2: the BC's
photo upload and the doctor's verification of the BC's intake FACTS are mapped; a separate doctor "photo verified" action does not exist on
main — an open product question only if the walkthrough requires it.

**Owner amendments to M8 exit scope (machine-checked, reported as `AMENDED`, never passed):**
- `M8-AMEND-1-DRAFT-KPI` (`t119/final/OWNER-AMENDMENT-M8-EXIT-20261123.md`): draft KPIs `K4`, `K12`, `K14`, `K15`, `K17` (pending Finance sign-off).
- `M8-AMEND-2-GQ4-U1-U4` (`t119/final/OWNER-AMENDMENT-M8-EXIT-20261123.md`): `G-Q4 U1–U4` unlinked visit product line (tracked product work; exact exception & Rp150,000 PND difference asserted separately).
- `M8-AMEND-3-TD31-SATUSEHAT` (`t119/final/OWNER-AMENDMENT-M8-EXIT-20261124.md`): `T-102 TD-31` / `TD-34` live recorded SATUSEHAT sandbox fixtures (open external activation gate; T-102 increments 1–4 pass on guide-shaped synthetic fixtures; **T-102 final acceptance stays OPEN/HELD**).
- `M8-AMEND-4-WALKTHROUGH-STAGING` (`t119/final/OWNER-AMENDMENT-M8-EXIT-20261124.md`): manual owner walkthrough of Phase 1 demo journeys J1–J8 and J10 deferred to Staging on Vultr + Coolify + Cloudflare over real HTTPS with normal TOTP enrolment (`DEC-034`, after M9 `T-120`–`T-131`). Local synthetic walkthrough preparation on `2e417cb8` (`clinic_m8_walkthrough`, stopped after prep) verified exact J8 hooks (T-108 Rekon `bersih`, T-109 Owner `M8-KMG` K3 Rp6,400,000 / K2 Rp2,500,000 and `M8-BSD` K3 Rp0 / K2 Rp600,000), host isolation (`404`), RBAC and PR-3 TOTP gate; **owner walkthrough sign-off is NOT claimed**.

Reconciliation is checked gross, not only net: per sub-ledger the increasing / decreasing terms equal the ledger's two sides, and the
zero-net accounts (paid-not-delivered, patient receivable) are proven by their exact debit and credit. Each T-104 comparator must
have run (`ran: true` where it has that form) and report no mismatch.

J1, J2, J3 and J10 are mapped to the earlier milestones' flows and tests (M6 flow step 4 + PR-6; M1 flow + PR-5; M2 flow; T-103 PR-61);
J8's commission path to money scenario 10 (T-087).

## Open gates (tracked; not claimed passed in M8)

| Gate | Status / completes in |
|---|---|
| **T-102 TD-31 / TD-34** — SATUSEHAT recorded sandbox fixtures (`M8-AMEND-3-TD31-SATUSEHAT`) | Open external activation gate; T-102 increments 1–4 integrated (`3f0e726e`, `0128`), **T-102 final acceptance stays OPEN/HELD** until sandbox TD-34 |
| **Owner walkthrough J1–J8, J10** (`M8-AMEND-4-WALKTHROUGH-STAGING`) | **Deferred to Staging (`DEC-034`)** after M9 `T-120`–`T-131`; owner sign-off NOT claimed |
| **G-ACT** books activation; **A-02** accountant's posting map | Journal export stays refused (fail-closed) in M8 |
| **G-Q4 U1–U4** unlinked visit selection products (`M8-AMEND-2-GQ4-U1-U4`) | Shown as "Selisih penyerahan produk" (an exception, not valued); tracked product work |
| **Draft KPIs K4 / K12 / K14 / K15 / K17** (`M8-AMEND-1-DRAFT-KPI`) | Pending Finance sign-off (settled KPIs K1–K3, K5–K11, K13, K16, K18–K27 asserted exact on this month) |
| **T-103** live payment gates (`Q-13`, `D2`, `Q-16`, `BILL-33`) | Fail-closed; no live AutoLaris call |

## Owner walkthrough checklist (Phase 1 demo; mandatory synthetic staging acceptance after M9 per `M8-AMEND-4-WALKTHROUGH-STAGING` & `DEC-034`)

Mandatory synthetic staging acceptance after M9 `T-120`–`T-131` (not signed off and not an M8 exit prerequisite under canonical `TASKS.md:1402` and `M8-AMEND-4-WALKTHROUGH-STAGING`): run on Staging (synthetic tenant, real HTTPS, normal TOTP enrolment); record date, build SHA, who attended, and per step pass / issue (with the issue's task). **Owner sign-off: BLANK (not claimed at M8 exit).**

| # | Journey | Walk | Pass when |
|---|---|---|---|
| 1 | J1 | CS answers a WhatsApp lead (recorded fixture), routes it, books with source | lead → booked with source; no slot → waitlist note |
| 2 | J2 | FO checks the patient in (duplicate phone → explicit choice), BC intake with photos | visit open, intake visible to the doctor |
| 3 | J3 | doctor verifies intake, writes the plan, contraindication cleared, consent requirement known | plan with stages; consent recorded *(SATUSEHAT: OPEN / TD-34)* |
| 4 | J4 | BC selection, cashier takes payment (partial / package DP / balance shown) | paid before the first treatment |
| 5 | J5 | treatment in the room, materials, an addition approved and re-consented | treatment counted, materials reconciled |
| 6 | J6 | pharmacist hands over, visit closes (unpaid → receivable) | visit closed, follow-up created *(SATUSEHAT: OPEN / TD-34)* |
| 7 | J7 | package redeemed at another branch; expiry moves value to balance | inter-branch 0; balance shows the moved value |
| 8 | J8 | finance: Piutang & Kewajiban roll-forwards, Buku Besar statements, commission batch approved, Kunci Periode; T-108 Rekon `bersih`; T-109 Owner K2/K3 | sub-ledgers = ledger; export refused (preview); Rekon `bersih`; K2/K3 exact |
| 9 | J10 | vendor finance issues the server-fee invoice (Tier 1 fail-closed gates; Tier 2 fixture if enabled); owner views `/saya/tagihan-server` | fail-closed gates / paid after verified settlement only |
| 10 | dashboards | Ringkasan per role (T-107, T-109–T-115), reports, digest, platform health | per their scenarios |

## CI of the M8 tasks (recorded from `STATUS.md` on `2e417cb8`)

| Task | Commit | Exact-SHA CI |
|---|---|---|
| T-102 inc 1–4 (M7; final acceptance OPEN on TD-34) | `a9ac93e0` / `1d449ff8` / `882b2ab3` / `3f0e726e` | 44020055417 / 44040421996 / 44062946402 / 44784435200 |
| T-103 (M7; live payment gates OPEN) | `46c4592e` / `7c56843b` | 44095172936 / 44143966634 |
| T-104 | `1e54042a` | 44335438904 |
| HYG-023 | `14c99035` | 44369421813 |
| T-105 (PREVIEW) | `af295ec1` | 44509284530 |
| T-106 | `c7f29c4e` | 44551597530 |
| T-107 (+ fixtures) | `f0bd3c44` / `83891200` | 44610920846 / 45063804380 |
| T-118 | `9de482f0` | 44692882076 |
| T-108 | `00df0033` / `44a24f48` | 44852176223 / 44874262682 |
| T-111 | `db08f6c4` | 44860532627 |
| T-116 (+ K19 fixture) | `4f685eda` / `68573cee` / `e5670c2d` / `a3414213` | 44882577653 / 44886138591 / 45008959231 / 45064979095 |
| T-113 | `f14a554f` | 45024990389 |
| T-109 (+ K7 cleanup) | `ef8e1f1d` / `6c00bf4c` | 45033824080 / 45066187931 |
| T-110 (+ waiting-payment tile) | `2b0d5a8c` / `b7fdd645` | 45038330642 / 45068171413 |
| T-115 | `82340dfa` | 45040497301 |
| T-112 | `353387aa` | 45043361121 |
| T-114 | `a0e04659` | 45062707582 |
| HYG-NAV-2 / HYG-NAV-1 | `50dd8d94` / `dd611ac0` | 45141633374 / 45143447680 |
| T-117 (+ TEN-19 hotfix 0132) | `0e5bd462` + `aa8603bb` | 45164282188 |
| HYG-026 | `40cc4e99` | 45314572999 |
| T-119 u1 evidence / HYG-027 | `dc3a9ee5` / `2e417cb8` | 45323638379 / 45326107021 |
