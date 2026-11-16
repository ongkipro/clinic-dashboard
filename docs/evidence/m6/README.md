# M6 exit evidence (T-101)

Task T-101 (PR-28, R2). Base `4f71af61` (main with T-100 on HYG-022 `bada9260`). Plan: `PLAN.md` in this folder (r1; Sol `24c7231c`
failed on a dropped stream with no verdict, `5e49112a` REVISE adopted, `347f8487` APPROVE). Ledger run `RUN-20261116T221603Z-06a5f147`.

Exit check (PLAN.md §1, M6 row): "Test number end to end with recorded fixtures; webhook replay fixtures (duplicate, late, out of order,
bad signature); PR-94 per-patient cap under concurrency." Done when (TASKS.md T-101): `pnpm test -- m6` passes.

## What the command is

`pnpm test -- m6` is not a filter (as `m0`–`m4`): vitest receives `m6` after `--` and runs every file, so it is the whole suite on a real
PostgreSQL. The JUnit form puts the reporter flags before `--`: `pnpm test --reporter=default --reporter=junit --outputFile.junit=<run>/junit.xml -- m6`.
`check-scenarios.py <junit.xml>` then requires every M6 scenario and exit item mapped in `scenarios.json` to be present exactly once and
passed in that report, and the report to have no failure anywhere. Structure alone never passes; the checker was also shown to fail a
report with a mapped case missing and one with a failed case (t101/checker-neg).

## The test number end to end (`m6-flow.test.ts`)

One tenant and its test number — the mock Graph port's Embedded Signup and a registered Kemang number — through every M6 path on a real
database, through the real writers and the real webhook intake (`receiveMetaWebhook`, the function the route calls) with recorded Graph
v21.0 payloads signed with the mock app secret. The Meta ports are the mocks (DEC-082): `fetch` is stubbed and asserted never called after
every test. Documented stand-ins only, of earlier milestones (appointment, visit and treatment rows the M1–M3 writers make; an invoice
attribution of the M5 commission module, as T-093's tests): the guard is paused for those inserts, never around an M6 writer — the WABA's
portfolio limit in step 10 changes through the real `syncWabaStatus` with a mock status port (review r1 P1).

| Step | Proves |
|---|---|
| 1 onboarding (PR-27) | Embedded Signup registers the test number; an unverified business is held at two numbers |
| 2 inbound (PR-28) | a recorded inbound opens the conversation at Kemang; a reply in the window; 25 h later only approved templates |
| 3 complaint flag (PR-43 inbox) | CS flags a recorded inbound message clinical → a task for Kemang's clinicians; CS sees status only |
| 4 lead (PR-29) | the conversation becomes a lead; converted refused while unpaid, allowed once paid |
| 5 reminder reply (PR-69) | the H-1 reminder through the mock port; a recorded Konfirmasi button reply on the test number → confirmed |
| 6 aftercare (PR-70) | the visit closes → a neutral care message with a protected link, no marketing consent needed, no treatment name |
| 7 survey (PR-78) | a score of 2 → a manager task; no outbound message (no review request) |
| 8 waitlist (PR-81) | a matching cancelled slot → the branch's FO, CS and manager are prompted |
| 9 follow-up (PR-30) | a free control two days away → a task for the guiding BC |
| 10 budget (PR-31) | the daily budget reached → more due messages queued for the next window; the backlog shows counts only |
| 11 campaign (PR-94) | a scheduled campaign to a consented segment is refused while the Q-15 evidence is not approved; nothing queued |
| 12 cap under concurrency (PR-94) | isolated: approved synthetic Q-15 evidence, consent, a wide budget, one slot left on D; an automation-style writer (staff_access + the cap lock) and campaign_send overlap (pg_blocking_pids); the automation message takes D, the campaign message D+1; dispatch on D sends 2 (the cap — care counts and is never deferred), D+1 the campaign |

Webhook replay fixtures, on the same test number: the same inbound twice → one message; a bad signature → 401, no event id claimed, the
genuine delivery then processes; a status before its message → held and applied; a late inbound never moves the window back.

## Local run

Close run 1 on freeze-r1 (2026-11-17, test-full started 05:28:01 WIB; `/data/tmp/clinic-dashboard/t101/run-1794868081/`, close log
`close-1794868041.log`), all six required checks PASS:

| Command | Result |
|---|---|
| `pnpm test -- m6` (with a JUnit report) | 2550 passed, 0 failed, 46 skipped (2596); 170 files passed, 45 skipped (215) |
| `check-scenarios.py <junit.xml>` | 2596 tests in the report, 0 failed; 12 scenarios (12 required), 6 exit items (3 required), 31 mapped cases, all passed |
| `m6-flow.test.ts` alone | 13 passed |

These figures were copied in after close 1, which changed this file; the final surface was therefore closed again, and that later close's
records are the integration evidence (named in the ledger and the T-101 commit). Close 2 on the first re-freeze reproduced the same
figures; review r1 (Sol `8a9613de`) then required two fixes to the flow (step 10 through the real WABA writer; the campaign steps scheduled
from one calendar anchor for tomorrow), so the final surface was closed once more.

## CI of the M6 tasks

| Task | Commit | CI |
|---|---|---|
| T-089 – T-097 | `e511d475` … `672d07f0` | recorded per task in `STATUS.md` |
| T-098 | `9fc9a162` | 43896595499 success |
| T-099 | `7128b746` | 43924029789 success |
| HYG-022 (next 16.4.5) | `bada9260` | 43953656875 success |
| T-100 | `4f71af61` | 43962630533 success |

## Not proven in M6 (deferred)

| Part | Completes in / waits for |
|---|---|
| Live Meta (Embedded Signup, sending, webhooks from Meta) | the Tech Provider app approval and an owner go-ahead (DEC-082: mock ports only) |
| Campaign sending | counsel clearing Q-15 (PR-97 evidence) |
| Survey page, WhatsApp survey reply, branch review link | DEC-110 (5): a hygiene task proposed |
| Daftar Tunggu page; hold expiry of an offer | DEC-111 (5) |
| The budget backlog tile on dashboards | M8 dashboards |

## Independent review

GPT-6.1 Sol (Panel 2): the plan reviews above; the implementation review is recorded in the ledger and `STATUS.md`.
