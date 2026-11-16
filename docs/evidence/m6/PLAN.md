# T-101 — M6 exit: messaging end to end with recorded fixtures — plan r1

Status: r1 (r0 kept; Sol `24c7231c` failed: stream disconnected, no verdict; retry Sol `5e49112a` REVISE — P1 step 12 and P2 path scope adopted).

## Contract (TASKS.md "#### T-101")
PR-28, R2. Allowed: `docs/evidence/m6/**`, `STATUS.md` and the ledger's own `.delivery/**` (TASKS.md:9 standing exception). The plan lives in
the repository as `docs/evidence/m6/PLAN.md` (review r1 P2: `docs/tasks/T-101.md` is not in the contract; no scope expansion needed). Depends on T-088, T-091, T-093, T-098, T-099, T-100 (all integrated; main 4f71af61). Done when:
`pnpm test -- m6` passes. No live provider calls; no production data.

Exit check (PLAN.md §1, M6 row): "Test number end to end with recorded fixtures; webhook replay fixtures (duplicate, late, out of order,
bad signature); PR-94 per-patient cap under concurrency." Requirements in scope (PLAN M6): PR-27–PR-31, PR-43 (inbox flag), PR-69,
PR-70, PR-78, PR-81, PR-94.

## What the command is (same as m0–m4)
`pnpm test -- m6` is not a filter: vitest receives `m6` after `--` and runs every file — the whole suite on a real PostgreSQL. The
evidence is therefore: (1) a new end-to-end flow file that exercises M6 across modules on one tenant, (2) a scenario map that pins every
M6 exit item to exact test cases, (3) a checker that reads a JUnit report of that command and fails unless every mapped case is present
once and passed and the report has no failure. Executable evidence, not a summary of earlier green runs.

## 1. `docs/evidence/m6/m6-flow.test.ts` — the test number end to end (recorded fixtures, mock ports only)
One tenant, one "test number" (the mock Graph port's Embedded Signup, a registered number at Kemang; the mock inbox port; the recorded
template list) through every M6 path, on a real database, through the real writers and the real webhook intake
(`receiveMetaWebhook` with a valid `X-Hub-Signature-256` from the mock app secret — the same function the route calls); no trigger
disabled except where an earlier task's documented stand-in is needed (patient / visit rows of the M1 writers, as m2/m3):
1. onboarding (PR-27): Embedded Signup → the test number registered; the unverified-business number cap answer;
2. inbound (PR-28): a recorded inbound text creates the conversation at the number's branch; replies within the window; 25 h later
   free-form refused, an approved template allowed;
3. complaint flag (PR-43 inbox): CS flags the inbound message as a clinical complaint → a task for the doctor on duty, CS sees status only;
4. lead (PR-29): the conversation becomes a lead; converted refused without a payment;
5. reminders (PR-69): a booking tomorrow, the reminder queued and dispatched through the mock port, a recorded button reply "Konfirmasi"
   through the webhook → the appointment confirmed;
6. aftercare (PR-70): the visit closes → a neutral care message with a protected link queued and sent (no treatment name in the text);
7. survey (PR-78): a score of 2 → the manager task, no review request;
8. waitlist (PR-81): a matching slot cancelled → staff prompted;
9. follow-up (PR-30): a control due in 2 days → the BC task;
10. budget (PR-31): budget reached → more due messages queued for the next window, the backlog reader shows them;
11. campaign (PR-94): scheduled, Q-15 evidence not approved → refused with the copy, nothing queued;
12. the per-patient cap (PR-94) under concurrency — an ISOLATED block, distinct from step 11 (review r1 P1): its own patient with marketing
    consent; synthetic APPROVED Q-15 evidence for the flow tenant (uploaded and approved by the owner, as tests/crm/campaigns.test.ts
    does); the tenant budget wide (portfolio limit 1000); a fixed branch-local day D. Arrange one remaining cap slot on D (batas_harian 2:
    one care message already queued for D). Then the real writers overlap on that patient: an automation-style enqueue (holding
    staff_access + the patient's cap lock, as automation_occur does) and campaign_send for a campaign whose segment holds that patient,
    with a deterministic interleaving (pg_blocking_pids shows campaign_send waiting). Assert: exactly one of them takes D (the automation
    message, which committed first) and the campaign message is queued on D+1 (never three automated rows on D); then dispatch on D sends
    the care message and the automation message through the mock port (2 sends on D), and dispatch on D+1 sends the campaign message.
    Care messages are exempt from cap deferral but count toward the cap: the assertion is "promos never exceed the cap on the day they go
    out", checked by counting sending/sent automated rows per day, not "all outbound ≤ cap".
Steps 11 and 12 are separate: 11 keeps the tenant's Q-15 evidence unapproved (the gate refuses); 12 approves it for its own isolated
patient. Step 10's budget exhaustion is undone before 12 (the budget window passes: 12 runs on a later fixed day D). Each step asserts
the outbound rows / events it should write and that the mock port received only what the step sends (no live call:
the mock throws on any network use; the test asserts `fetch` is never called, as T-094's outbound test does).

## 2. Webhook replay fixtures (the PLAN line, one place)
In the flow file, a "replay" block feeding the real intake recorded deliveries: the same inbound delivered twice (duplicate: one
message), a status that arrives before its message (out of order: held, then applied), a late inbound older than the last one (late:
the window never moves back), a bad signature (401, claims no event id; the genuine delivery then processes), plus a button reply
redelivered after a handler failure (applied once; T-095's case). These mirror the per-task tests but run as one sequence on the flow
tenant so the M6 exit has its own evidence.

## 3. `docs/evidence/m6/scenarios.json` + `check-scenarios.py` (T-069's checker pointed at M6)
Required: every PRD §8 scenario of the M6 requirements (PR-27 number cap, PR-28 service window, PR-29 converted requires payment, PR-30
control due, PR-31 budget, PR-43 complaint escalation [inbox flag part], PR-69 reminder reply, PR-70 aftercare, PR-78 low score, PR-81
waitlist, PR-94 frequency cap, PR-94 campaign sending gated) mapped to the existing per-task test cases AND the flow step; the replay
fixtures (duplicate, late, out of order, bad signature) and "PR-94 cap under concurrency" as required items. The checker: every title is
a PRD §8 scenario; every mapped name occurs verbatim in its file; in the JUnit report every mapped case present exactly once and passed;
no failure anywhere; "proves" and "open" stated per item (open: campaign sending until Q-15; live Meta until owner/Meta approval; the
Daftar Tunggu page and survey page per DEC-110/111; hold expiry).

## 4. README (docs/evidence/m6/README.md), the plan copy (docs/evidence/m6/PLAN.md) and STATUS
What the command is, the flow, the local run (the ledger's own run with a JUnit report), per-suite counts, CI of the M6 tasks' commits,
not proven in M6 (deferred, with the owning task / gate), and the independent review. STATUS: T-101 line; M6 complete when green.

## Checks (required)
docs, flow (the new flow file alone), test-full (`pnpm test --reporter=default --reporter=junit --outputFile.junit=<run>/junit.xml -- m6`),
scenarios (`check-scenarios.py <junit.xml>`), typecheck, lint. R2: Panel 2 requires a Sol review of plan and implementation.

## Not in scope
No product code, no migration, no UI (the flow tests through modules). No new fixture beyond the recorded builders already in
src/modules/messaging/*/fixtures.ts (the flow composes them).
