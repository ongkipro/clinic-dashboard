# M8 exit evidence (T-119) — final run

Task T-119 (PR-26, R3). Allowed paths `docs/evidence/m8/**`, `STATUS.md`. Depends on T-106, T-108, T-115, T-117, T-118, T-102, T-109–T-114.
Started as the scaffold (Lane C, 2026-11-19, base `af295ec1`). It is now the **preliminary gate on base `353387aa`**, ledger run
`RUN-20261122T173821Z-16a51bfd`, candidates r1–r5 (derivations kept outside the repo with the gate kit). On this base T-106–T-116 and
T-118 are integrated except T-110's waiting-payment tile (`b7fdd645`) and T-114 (`a0e04659`), which are on main but not ancestors of
`353387aa`. T-117 is not integrated. The final run uses the final green SHA. `STATUS.md` is not
touched until the final T-119 integration. Ledger run `RUN-20261119T124205Z-dabd64a2`.

Exit check (PLAN.md §1, M8 row): "Ledger reconciles to sub-ledgers on the §3 fixtures; KPI values equal fixture expectations for K1–K19 and
PR-95 metrics." Done when (TASKS.md T-119): `pnpm test -- m8` passes; owner walkthrough recorded (Phase 1 demo: J1–J8 and J10 on synthetic
data, 02-PRD §Release phases).

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
allowlist `OWNER_AMENDMENTS` in `check-scenarios.py` (id, exit item, the file `t119/final/OWNER-AMENDMENT-M8-EXIT-20261123.md`, exact
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

Still open (machine-checked): the two OWNER GATES in `deferred_items` (T-102 TD-31 SATUSEHAT practitioner path; the owner walkthrough).
`--final` lists the two `owner_amended` entries as "AMENDED (owner exception to the exit scope, not passed)".

Reconciliation is checked gross, not only net: per sub-ledger the increasing / decreasing terms equal the ledger's two sides, and the
zero-net accounts (paid-not-delivered, patient receivable) are proven by their exact debit and credit. Each T-104 comparator must
have run (`ran: true` where it has that form) and report no mismatch.

J1, J2, J3 and J10 are mapped to the earlier milestones' flows and tests (M6 flow step 4 + PR-6; M1 flow + PR-5; M2 flow; T-103 PR-61);
J8's commission path to money scenario 10 (T-087).

## Open gates (not proven in M8)

| Gate | Owner / completes in |
|---|---|
| **T-102 TD-31** — SATUSEHAT practitioner path (owner decision); T-102 final acceptance OPEN/BLOCKED | Paduka Ongki → T-102 final; J3 / J6 SATUSEHAT steps of the walkthrough use recorded fixtures only after it |
| G-ACT books activation; A-02 accountant's posting map | the journal export stays refused (fail-closed) in M8 |
| G-Q4 U1–U4 unlinked visit selection products | shown as "Selisih penyerahan produk" (an exception, not valued) |
| KPI fixture expectations K1–K19, K20–K27 | T-107, T-116 |

## Owner walkthrough checklist (Phase 1 demo; synthetic tenant; to be recorded at T-119 final)

Run on a synthetic tenant after the M8 integrations; record date, build SHA, who attended, and per step pass / issue (with the issue's task).

| # | Journey | Walk | Pass when |
|---|---|---|---|
| 1 | J1 | CS answers a WhatsApp lead (recorded fixture), routes it, books with source | lead → booked with source; no slot → waitlist note |
| 2 | J2 | FO checks the patient in (duplicate phone → explicit choice), BC intake with photos | visit open, intake visible to the doctor |
| 3 | J3 | doctor verifies intake, writes the plan, contraindication cleared, consent requirement known | plan with stages; consent recorded |
| 4 | J4 | BC selection, cashier takes payment (partial / package DP / balance shown) | paid before the first treatment |
| 5 | J5 | treatment in the room, materials, an addition approved and re-consented | treatment counted, materials reconciled |
| 6 | J6 | pharmacist hands over, visit closes (unpaid → receivable) | visit closed, follow-up created |
| 7 | J7 | package redeemed at another branch; expiry moves value to balance | inter-branch 0; balance shows the moved value |
| 8 | J8 | finance: Piutang & Kewajiban roll-forwards, Buku Besar statements, commission batch approved, Kunci Periode | sub-ledgers = ledger; export refused (preview) |
| 9 | J10 | vendor finance issues the server-fee invoice; owner pays by QRIS mock; status reconciled | paid after verified settlement only |
| 10 | dashboards | Ringkasan per role (T-107, T-109–T-115), reports, digest, platform health | per their scenarios |

## CI of the M8 tasks (filled at final)

| Task | Commit | CI |
|---|---|---|
| T-104 | `1e54042a` | 44335438904 |
| T-105 | `af295ec1` (main) | to record from STATUS.md at final (this worktree's STATUS.md predates the T-105 integration) |
| T-106 – T-118 | — | — |
