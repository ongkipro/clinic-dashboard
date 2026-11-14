# M4 exit evidence (T-086)

Task T-086 (PR-19, R3). Base `ea2a8e88` (T-085 on HYG-018 `75ab7b9c` on T-084 `1f42c0c7`). Ledger run `RUN-20261114T231301Z-11f8642e`. The independent R3 review that T-086's Done-when requires is recorded in `docs/tasks/T-086.md`.

Exit check (PLAN.md §1, M4 row and §3 Money Scenario Suite): the domain behaviour of money scenarios 1–9, 11–13 and 15–19 (with their sub-parts and PKP variants); the facts of 10 and 14 (their commission is M5); the M4 PRD §8 scenarios, incl. the M0–M3 deferrals that complete in M4; CLIN-006, 007, 009, 010, 011, 020, 025, 028; "PR-68 mock never counts"; "PR-77 quota atomic under 2 concurrent cashiers"; the T-085 shift close. Done when (TASKS.md T-086): `pnpm test -- money` passes for the domain behaviour of those scenarios; an independent R3 review is recorded.

## What the command is

`pnpm test -- money` is not a filter (as `m0`–`m3`): vitest receives `money` after `--` and runs every file, so it is the whole suite on a real PostgreSQL. With a JUnit report the reporter flags go before `--`: `pnpm test --reporter=default --reporter=junit --outputFile.junit=<run>/junit.xml -- money`. `scenarios.json` ties each money scenario, PRD scenario and item to exact test cases ("describe > test", verbatim); `check-scenarios.py` checks that map against the report: every required id and title mapped, every mapped name present in its file, every mapped case present once and passed, no failure anywhere. A JUnit report is required.

## Fixture prices

The money fixture (`docs/spec/fixtures/money-scenarios.md`, signed off by the finance owner, DEC-080) gives illustrative parameters; several tests assert the same facts at other prices: scenarios 2 and 7a–7c at 600,000; 9 at 200,000 + 300,000; 19 at 1,998,000 and 333,000. `proves` in `scenarios.json` states the rupiah each case asserts.

## Local run

The evidence run (2026-11-15 06:13 WIB, before the close run re-records it): `pnpm test --reporter=default --reporter=junit --outputFile.junit=<run>/junit.xml -- money` gave 140 files passed and 39 skipped; 2221 tests passed, 0 failed, 40 skipped (2261). `check-scenarios.py` reported 38/38 money ids, 28/28 scenarios, 8/8 CLIN ids, 13 items, 91 mapped test cases (93 after the review r1 P3 remap: 5a/5b split per the fixture, PR-7 and PR-21 each gain the case of the PRD's own Given), all present once and passed; 3 deferred entries. The close run's counts are in `docs/tasks/T-086.md` "Results".

## Browser evidence of the M4 UI tasks

Local evidence folders (synthetic data; each report has no error and every flow true):

| Task | Screen | Evidence |
|---|---|---|
| T-072 | Kasir | `/data/tmp/clinic-dashboard/t072-ui/out-1794512661/` (15 flows, 64 layouts) |
| T-073 | Simulasi / port | `/data/tmp/clinic-dashboard/t073-ui/out-1794524294/` (10 flows, 40 layouts) |
| T-076 | Paket & Saldo | `/data/tmp/clinic-dashboard/t076-ui/out-1794572753/` (13 flows, 56 layouts) |
| T-078 | Piutang & Refund | `/data/tmp/clinic-dashboard/t078-ui/out-1794632992/` (15 flows, 72 layouts) |
| T-084 | Biaya Operasional & Kas Kecil | `/data/tmp/clinic-dashboard/t084-ui/out-1794662306/` (12 flows, 65 layouts) |
| T-085 | Tutup Kasir | `/data/tmp/clinic-dashboard/t085-ui/out-1794697092/` (14 flows, 73 layouts) |

## Not proven in M4 (deferred)

| Part | Completes in |
|---|---|
| Commission figures of scenarios 2, 3a, 5a, 7c, 7d, 10, 11, 14 and PR-14 | T-087 (M5) |
| Journal lines of every scenario; scenario 20 (gateway settlement) | M8 (the ledger and settlement tasks) |
| The real payment gateway adapter (PR-68 beyond the mock) | owner-gated (no live provider calls) |

Pending outside the code:
- tax adviser Q-05: 1 PKP, 6 PKP, 16 (both readings pinned in `tests/tax/policy.test.ts`), 17 PKP, 19, rounding;
- accountant A-02 / A-10: 6b/6c forfeited DP, 12a decomposition, the posting map for M8.

## CI

The last M4 task commits: T-084 `1f42c0c7` CI 43601481764 green; HYG-018 `75ab7b9c` CI 43649603584 green; T-085 `ea2a8e88` CI 43652047539 (recorded in `STATUS.md`). The CI run of the T-086 commit is recorded in `STATUS.md` after integration.

## Independent R3 review

See `docs/tasks/T-086.md` "Independent R3 review".
