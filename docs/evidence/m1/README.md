# M1 exit evidence (T-049)

Task T-049 (PR-7, R2). Base `8ffc113` (main after T-042). Ledger run `RUN-20261109T143605Z-6adc6de0`.

Exit check (PLAN.md §1, M1 row): module-level assertions of PR-2, PR-4–PR-8, PR-84, PR-71, PR-76, PR-83 (no-show, reschedule), PR-85 merge, PR-88 and PR-92 pass on a real database. Done when (TASKS.md T-049): `pnpm test -- m1` and `pnpm test:ui -- m1` pass; the flow "book → check-in → board on a real database".

## The flow on a real database (`m1-flow.test.ts`)

`docs/evidence/m1/m1-flow.test.ts` (collected by `pnpm test`; plan review r1 P1-1): one clinic set up and run through the real writers only — no trigger disabled, no row inserted around a writer — except the payment column, whose writer is the cashier of M4 (DEC-057), set by the database owner as its stand-in. Branch hours, a room, a service published and clinically approved, the branch offering it, a branch price override, the doctor's week, a consent text; a patient registered with an encrypted NIK and a care-notice consent; a slot taken from `slots()` and booked with `book()` (doctor and room reserved together); check-in (appointment arrived; ticket A-001); Hari Ini lists the visit and VisitTrack; Antrean lists the number; a paired TV shows the called number and room and no name; an unpaid bill keeps the visit on Belum dibayar and the close is refused (`unpaid_bill`); settled, the visit closes, the slot is released, the ticket is done; the events AppointmentBooked, VisitCheckedIn, VisitClosed.

## Local run (under the host rule)

| Command | Result | Evidence |
|---|---|---|
| `pnpm test -- m1` (with a JUnit report) | 1298 passed, 0 failed, 22 skipped (1320) | `/data/tmp/clinic-dashboard/t049/run-1794236163/` |
| `check-scenarios.py <junit.xml>` | 17 scenarios, 3 items, 35 mapped cases, all passed; 2 deferred | same |
| `pnpm test:ui -- m1` | exit 0; 50 flows, 16 layouts clean, no console error | `/data/tmp/clinic-dashboard/t049-ui/out-1794236382/` |

`pnpm test -- m1` is not a filter (as `m0` in T-032): vitest receives `m1` after `--` and runs every file, so it is the whole suite on a real PostgreSQL. The scenarios are tied to tests by the map below.

`pnpm test:ui -- m1` runs the script as defined (`RUN_UI=1 … tests/ui/shell.spec.ts`: the clinic shell, role menus, keyboard paths, sign-out, at 390/820/1180/1440 and 200 %) against a freshly built standalone server and a synthetic seed. pnpm passes `--` through, so the spec's output directory is `--`: the runner moves it out of the repository at once and fails if anything else is left behind (plan review r1 P2-1). The M1 screens' browser checks ran per task (table below).

Per suite (passed / failed / skipped):

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| `docs/evidence/m1` | 1 | 0 | 0 |
| `tests/approvals` | 26 | 0 | 0 |
| `tests/audit` | 23 | 0 | 0 |
| `tests/auth` | 68 | 0 | 0 |
| `tests/catalog` | 44 | 0 | 0 |
| `tests/compliance` | 16 | 0 | 0 |
| `tests/context` | 56 | 0 | 0 |
| `tests/db` | 60 | 0 | 0 |
| `tests/events` | 17 | 0 | 0 |
| `tests/idempotency` | 17 | 0 | 0 |
| `tests/isolation` | 79 | 0 | 1 |
| `tests/notifications` | 13 | 0 | 0 |
| `tests/org` | 78 | 0 | 0 |
| `tests/patients` | 60 | 0 | 0 |
| `tests/platform` | 44 | 0 | 1 |
| `tests/privacy` | 10 | 0 | 0 |
| `tests/rls` | 228 | 0 | 0 |
| `tests/scheduling` | 56 | 0 | 0 |
| `tests/settings` | 29 | 0 | 0 |
| `tests/ui` | 157 | 0 | 20 |
| `tests/vendor` | 193 | 0 | 0 |
| `tests/visits` | 23 | 0 | 0 |

Skipped (22): the browser specs run on request with `RUN_UI=1` (each task recorded its browser evidence), the isolation placeholder that only runs while no case exists, and the pgBackRest restore drill (`RUN_BACKUP_DRILL=1`, run in CI):

- `tests/isolation/isolation.test.ts — cross-tenant negative cases > no cases yet: foundation has no tenant surface`
- `tests/platform/backup.test.ts — pgBackRest restore drill > restores a seeded database to a scratch instance with matching row counts`
- `tests/ui/akses-vendor.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/audit.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/cabang.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/context.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/gallery.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/harga-cabang.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/jadwal-staf.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/jadwal.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/katalog.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/kepatuhan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/layanan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/owner-grant.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pasien-baru.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pasien-list.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pengaturan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/persetujuan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/staf.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/tenant-provisioning.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/vendor-team.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/vendor.spec.ts — browser evidence (RUN_UI=1)`

## Scenario map (`scenarios.json`, checked by `check-scenarios.py <junit.xml>`)

Each scenario maps to the exact test cases (file and full name) that assert it; `items` are M1 requirements without a PRD §8 scenario title, checked the same way. The check needs the JUnit report: every mapped case must be present once and passed (a skipped case fails it), the report must have no failure, every scenario title must be a PRD §8 scenario, and every deferred scenario needs the task where it completes.

| Scenario (PRD §8) | Test file | Cases | What the cases assert | Not proven in M1 (where it completes) |
|---|---|---|---|---|
| PR-1 tenant isolation | `tests/patients/registration.test.ts` | 1 | with patient rows (M0 had fixture rows only): another tenant's patient by id is not-found and the denied attempt is audited in the caller's chain | none in M1 (M0 deferred this half to M1) |
| PR-1 tenant isolation | `tests/isolation/isolation.test.ts` | 1 | every M1 route and action has a cross-tenant negative case with a positive control | none |
| PR-2 structured hours | `tests/org/branches.test.ts` | 2 | structured weekly hours with a break and closures decide open/closed per branch timezone | the public listing of hours: T-123 |
| PR-2 structured hours | `tests/scheduling/booking.test.ts` | 1 | booking offers slots only inside the hours and never on a closure | none |
| PR-4 consent withdrawal | `tests/patients/consents.test.ts` | 2 | the ledger half: withdrawal recorded with history; versions immutable | a queued promo not sent and care reminders continuing: T-094 / T-095 |
| PR-4 consent withdrawal | `tests/patients/profile.test.ts` | 1 | withdrawal from the patient profile | none |
| PR-5 shared phone | `tests/patients/registration.test.ts` | 1 | two patients may share a phone; the search lists both for an explicit choice | none |
| PR-6 resources and source | `tests/scheduling/booking.test.ts` | 1 | the service's resources reserved together; the source, branch and version stored | the public booking link: T-126; booking DP: T-077 |
| PR-7 outstanding list | `tests/visits/visits.test.ts` | 2 | a visit with an unpaid bill is on the outstanding list and cannot close until settled (the payment column standing in for the cashier, DEC-057) | the unpaid addition and the cashier's writer: T-074 with T-071 / T-072 (M4) |
| PR-8 lateness default | `tests/scheduling/lateness.test.ts` | 2 | off by default; released only when the branch enabled SET-15 | the scheduled job calling the release: an operations task |
| PR-41 clinical review before publish | `tests/catalog/catalog.test.ts` | 1 | a clinical change waits for review; the previous version stays active | none |
| PR-42 branch price | `tests/catalog/prices.test.ts` | 1 | the price half: the branch override applies at its branch only | the invoice snapshot: T-071 / T-072; the package session value: T-076 |
| PR-48 roster | `tests/scheduling/rosters.test.ts` | 1 | a doctor on leave is not available that date | none |
| PR-48 roster | `tests/scheduling/booking.test.ts` | 1 | no slot for the doctor on leave | none |
| PR-49 record copy | `tests/patients/profile.test.ts` | 2 | the role projections of the profile (TASKS T-040 Done-when) | the record copy (a PDF of signed records, logged): T-053; balance, packages and receivables: T-075 / T-076 / T-078 |
| PR-71 walk-in | `tests/visits/queue.test.ts` | 2 | a walk-in opens a visit with the next number; the TV payload has no patient name | none |
| PR-76 search projection | `tests/patients/search.test.ts` | 2 | name and visit status without a diagnosis; the rate limit; no query text stored or logged | invoice-number search and invoice totals: T-071 / T-072 |
| PR-83 no-show without DP | `tests/scheduling/appointments.test.ts` | 2 | no-show without DP (no money moves) and the reschedule (PLAN M1: no-show, reschedule) | the CS follow-up task: T-093; reminder replies: T-095 |
| PR-84 branch switch | `tests/org/context.test.ts` | 1 | the switch and later actions record B2 | none |
| PR-84 branch switch | `tests/visits/queue.test.ts` | 1 | Antrean shows B2 patients and actions record B2 (with a manager) | the doctor's Antrean (UX-8): T-052 |
| PR-88 service needs a room | `tests/catalog/service.test.ts` | 1 | a service declares its resources and durations | none |
| PR-88 service needs a room | `tests/scheduling/booking.test.ts` | 1 | no slot where the resource is missing | none |
| PR-92 breach record | `tests/privacy/privacy.test.ts` | 2 | awareness time, the 72 h deadline and notice evidence; every transition audited | data-subject requests (PR-50): T-121 |
| M1 exit: book → check-in → board on a real database (item) | `docs/evidence/m1/m1-flow.test.ts` | 1 | registration (encrypted NIK) → consent → booking from slots() → check-in → Hari Ini and Antrean → TV without a name → unpaid blocks the close → settled closes, slot released, ticket done, through the real writers | — |
| PR-85 duplicate patient merge (item) | `tests/patients/merge.test.ts` | 1 | merge then unmerge restores both patients with all linked rows; the audit shows actor and reason (TASKS T-042 Done-when) | — |
| CLIN-011 catalog versions immutable once referenced (item) | `tests/catalog/catalog.test.ts` | 1 | catalog versions are immutable and never deleted | — |

Deferred: `PR-85 import dry-run` → T-128 (M9 opening-data import); `PR-83 no-show` (the DP forfeit) → T-077 (M4) and T-093 (M6 CS follow-up).

## Browser evidence of the M1 screens (per task)

| Task | Screen | Commit | Ledger run | Flows / layouts | Spec |
|---|---|---|---|---|---|
| T-033 | Katalog (PR-41) | `f00fbd8` | `RUN-20261107T192103Z-1c3bf9e1` | 8 / 23 | `tests/ui/katalog.spec.ts` |
| T-034 | Master Layanan (PR-88) | `e1b96a9` | `RUN-20261108T105658Z-7ab4b490` | 11 / 24 | `tests/ui/layanan.spec.ts` |
| T-035 | Harga Cabang (PR-42) | `7a5a3e5` | `RUN-20261108T130211Z-f850dd6a` | 10 / 17 | `tests/ui/harga-cabang.spec.ts` |
| T-036 | Cabang (PR-2) | `eff32e6` | `RUN-20261108T181417Z-3834e549` | 10 / 17 | `tests/ui/cabang.spec.ts` |
| T-037 | Pendaftaran Pasien (PR-5) | `3ffb87f` | `RUN-20261108T163951Z-2b3102fd` | 11 / 10 | `tests/ui/pasien-baru.spec.ts` |
| T-043 | Jadwal Staf (PR-48) | `586ec05` | `RUN-20261108T213336Z-27476cc4` | 9 / 9 | `tests/ui/jadwal-staf.spec.ts` |
| T-045 | Jadwal (PR-83) | `9d0b0e8` | `RUN-20261109T030054Z-dc0cd085` | 10 / 16 | `tests/ui/jadwal.spec.ts` |
| T-041 | Daftar Pasien (PR-76) | `ff5c2e0` | `RUN-20261109T125721Z-b0da8b5d` | 10 / 11 | `tests/ui/pasien-list.spec.ts` |
| T-040 | Profil Pasien (PR-49) | `2479a43` | `RUN-20261109T083630Z-34790674` | 10 / 27 | `/data/tmp/clinic-dashboard/t040-ui/profil.spec.ts (outside: tests/ui not allowed)` |
| T-047 | Hari Ini (PR-7) | `99d017b` | `RUN-20261109T091326Z-2ca5e78e` | 12 / 19 | `/data/tmp/clinic-dashboard/t047-ui/hari-ini.spec.ts (outside)` |
| T-048 | Antrean and Layar TV (PR-71, PR-84) | `d9a38d0` | `RUN-20261109T095953Z-264d573c` | 13 / 9 | `/data/tmp/clinic-dashboard/t048-ui/antrean.spec.ts (outside)` |
| T-039 | Privasi & Persetujuan (PR-92) | `f375394` | `RUN-20261109T121454Z-02d9bedc` | 10 / 25 | `/data/tmp/clinic-dashboard/t039-ui/privasi.spec.ts (outside)` |

Each ran at 390/820/1180/1440 and 200 % text with no console error and every layout clean (no horizontal overflow, targets ≥ 44 px, every control named); the four outside the repository were kept outside because `tests/ui/**` was not in those tasks' Allowed Paths.

## CI (`check-ci.sh`, receipt `ci-receipt.json`)

`check-ci.sh 8ffc113 42635989790 docs/evidence/m1/ci-receipt.json` (before the final checks, plan review r1 P1-3): the `ci` workflow on the push of `8ffc113` to main concluded success; its verify job's "Run pnpm test" step passed (1298 passed, 21 skipped), the restore drill passed, the sixteen M1 test files and the RLS and isolation files ran, no test failed. T-049's own CI run is recorded in `STATUS.md` after its push.

## Independent review

R2 does not require one by the ledger; the owner asked for a review and audit of every finding, so the plan was reviewed (Argon `6b37f5db`, REVISE: the flow test, the map, the CI sequencing, the UI output directory — all adopted) and the evidence is reviewed before closure.
