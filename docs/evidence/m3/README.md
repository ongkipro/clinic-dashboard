# M3 exit evidence (T-069)

Task T-069 (PR-16, R3). Base `18c3ef9` (T-068 with its review fixes, on T-067 with its review fixes `8551d95`, on main `c5bf36f`). Ledger runs `RUN-20261112T051118Z-ae0f992d` (the build, finished BLOCKED for the rebase; close run 1 FAIL kept) and the review-round run. The independent R3 review that T-069's Done-when requires is recorded in `docs/tasks/T-069.md`.

Exit check (PLAN.md §1, M3 row): scenarios PR-14 (outcomes; session and commission effects in M4/M5), PR-16–PR-18, PR-75, PR-82, PR-89, PR-90 and CLIN-008, 017–019, 024–025 pass; stock fixture: no double deduction, depot balances never negative. Done when (TASKS.md T-069): `pnpm test -- m3` passes; an independent R3 review is recorded.

## What the command is

`pnpm test -- m3` is not a filter (as `m0`–`m2`): vitest receives `m3` after `--` and runs every file, so it is the whole suite on a real PostgreSQL. With a JUnit report the reporter flags go before `--`: `pnpm test --reporter=default --reporter=junit --outputFile.junit=<run>/junit.xml -- m3`. The M3 scenarios, CLIN items and the stock fixture are tied to exact test cases by `scenarios.json`, checked against that report by `check-scenarios.py`.

## The stock fixture (`m3-flow.test.ts`)

One stock item through every M3 stock writer on a real database, through the real writers only (no trigger disabled; the documented stand-ins are the patient and visit rows of the M1 writers and the step-up proof of the prescription signing UI):
- A supplier's batch of 40 received at a cost (T-066).
- Moved gudang → apotek 15 and gudang → room 10 (T-061). An over-draw is refused whole.
- Inter-branch transfers (T-061): 5 sent to branch 2 and received there; 3 more sent and cancelled.
- Room materials (T-062):
  - 6 issued to the room and consumed. The completion was retried with the same key and raced with a new key, giving one consumption and one consume movement (CLIN-008).
  - A second request of 4: 2 returned unopened and accepted usable, 1 wasted (the replay wastes nothing more; wasting more than is free is refused), 1 used.
- Pharmacy (T-065): a signed prescription of 3, prepared without moving stock (CLIN-017), then handed over with retries and a race, giving one dispensing (CLIN-018).
- A supplier return of 2 (T-066). Returning more than the depot holds is refused; the replay returns nothing more.

After every step it checks:
- every depot holding ≥ 0;
- each batch equals the sum of its holdings;
- each holding equals the last balance its movements wrote;
- stock plus stock in transit equals receipts minus outflows.

The end state is: gudang 4, apotek 8, room 10, branch 2 holding 5. 40 received, 13 out, each outflow movement written once.

## Local run

From the ledger's close runs, see `docs/tasks/T-069.md` "Results". The build run gave 1815 passed, 0 failed, 34 skipped (1849); `check-scenarios.py` reported 10/10 scenarios, 6/6 CLIN ids and 32 mapped cases, all passed. The review-round run re-runs `pnpm test -- m3` with a JUnit report and the scenario check on the rebased commit.

## Not proven in M3 (deferred)

| Scenario part | Completes in |
|---|---|
| PR-14: the session counts as used; the performer earns commission | T-076 (package sessions, M4); T-087 (commission, M5) |

Per scenario, `scenarios.json` "open" lists later work, including:
- the Ringkasan / Perlu Ditangani pages and the scheduler of the due scan;
- the UX-7 / UX-8 panels and the dispensing payment rule (T-072);
- posting (BILL-34, M8).

## CI

No CI receipt yet. T-067, T-068 and T-069 are integrated into `main` together after this review (merge --ff-only, push), and the CI run on that commit is recorded in `STATUS.md`.

## Independent R3 review

See `docs/tasks/T-069.md` "Independent R3 review".
