# Next work breakdown: resume point after 2026-11-05

Written at the end of the 2026-11-05 session. Owner: "kita berhenti dulu … task2 lanjutan kamu masukan dulu + breakdown md nya untuk kita lanjutkan nanti".

Authority order:
- `STATUS.md` ("Resume here") is the current state.
- `TASKS.md` ("Hygiene queue") is the order.
- `docs/tasks/HYG-*.md` are the plans.

This file is the step-by-step breakdown. It is advisory: when it and those disagree, they win. Update this file or delete it when its steps are done.

## Where things are

| Item | State |
|---|---|
| Pushed to `origin/main` | `ff336a1`: T-025, T-026, HYG-005, HYG-004. CI run 41974781029 green (760 tests, restore drill, image migration; the PostgreSQL service ran with `--init`). |
| Local database | `Init=true`, `pg_isready -t 2` healthcheck, healthy, 60 s grace, 0 restarts, 48/48 migrations, no leftover test databases. |
| Working tree | HYG-006 only (ledger run `RUN-20261104T230534Z-779db699` open), plus this session's docs (TASKS, STATUS, BUILD-LOG, ARCHITECTURE, DECISIONS DEC-041, `docs/tasks/HYG-006.md`, this file). |
| Held outside the repository | `/data/tmp/session-docs/`: `HYG-007.md` … `HYG-011.md` and the review reports `foundation-2026-11-05/`, `hyg007/`. They go back with HYG-007 (see step 2.1). |
| HYG-007 code draft | `/data/tmp/hyg007/impl/` |
| Backup of the drafts and scripts | `/data/backups/session-2026-11-05/` |
| Progress | 29/131 tasks (22 %); M0 29/32 (T-027, T-028, T-032 left); hygiene HYG-006 … HYG-011 first. |

**Host rule for every heavy run:** the 1-minute load is ≤ 4 and no test or browser suite of any project is running (`/data/tmp/t026-waitgate.sh`). Wait; do not start anyway.

## 1. HYG-006: finish, commit, push (R3)

1. **Ledger scope.** This file and `TASKS.md` are new edits. Either:
   - add them to HYG-006's run by scope expansion (`delivery-ledger expand-scope --path TASKS.md --path docs/tasks/NEXT-BREAKDOWN-2026-11-05.md --required-by HYG-006 …`, one `--path` per call); or
   - move this file out until the commit.

   Then `delivery-ledger check-boundary` must show REVIEW_REQUIRED with no failures.
2. **Run `/data/tmp/hyg006/commit-push.sh`.** It re-runs every check (typecheck, lint, docs, lock tests, 30 mutations, stress gate, full suite ×3), checks the surface is unchanged, finishes the ledger run, commits only HYG-006's files, records the hash in STATUS, and pushes.
   - **If test-full fails again,** the script stops. Read the failing suite's log in `/data/tmp/hyg006/full-<epoch>/`:
     - A timing-bound test timeout (DEC-041 (2)), or `hosts.spec.ts` "next start did not come up": record it in `docs/tasks/HYG-006.md`, re-run the full suite, and report to the owner. Never re-run silently until green.
     - Anything else: stop and investigate.
3. **Watch CI** for the push (`gh run list --branch main --limit 1`) until it is green.

## 2. HYG-007: second factor (R3)

1. Move the held docs back:
   - `mv /data/tmp/session-docs/HYG-00{7,8,9}.md /data/tmp/session-docs/HYG-01{0,1}.md docs/tasks/`
   - `mv /data/tmp/session-docs/foundation-2026-11-05 /data/tmp/session-docs/hyg007 docs/research/reviews/`
2. Correct DEC-041 (1)'s consequence: `python3 /data/tmp/hyg007/dec041-fix.py`. Backup codes recover sign-in only; replacing a lost authenticator needs it or an admin reset.
3. `delivery-ledger start --task HYG-007 --requirement HYG-007 --risk R3 --worker pi --model … --provider … --reasoning-effort …`.
   - Allowed paths: `src/auth/server.ts`, `src/app/(auth)/security-panel.tsx`, `src/app/(auth)/client.ts`, `tests/auth/**`, `docs/tasks/HYG-00{7..11}.md`, `docs/research/reviews/{foundation-2026-11-05,hyg007}/**`, `STATUS.md`, `BUILD-LOG.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `TASKS.md`.
   - Required checks: typecheck, lint, docs, auth-tests, mutations, browser, test-full.
4. Copy the draft from `/data/tmp/hyg007/impl/`:
   - `server.ts` → `src/auth/server.ts`
   - `client.ts` → `src/app/(auth)/client.ts`
   - `security-panel.tsx` → `src/app/(auth)/security-panel.tsx`
   - `security.test.ts` → `tests/auth/security.test.ts`
   - `second-factor.test.ts` → `tests/auth/second-factor.test.ts`

   (`auth.test.ts` and `helpers.ts` in the draft are unchanged copies.)
5. Add F3's storage assertion to `tests/auth/auth.test.ts` ("stores no plaintext …": no issued backup code in `backup_codes`). It is in the plan, not yet in the draft.
6. Run typecheck, lint, then `pnpm exec vitest run tests/auth` (under the host rule). Fix until green. The draft has not been executed yet.
7. **Mutations** (plan Done-when 3), each failing a named test:
   - `get-totp-uri` allowed;
   - the possession check on regenerate removed;
   - step-up counting removed;
   - the lock check removed;
   - the expired-lock reset removed;
   - the success reset removed;
   - the classification re-derived after verification;
   - `for update` removed;
   - counting applied at sign-in (double count);
   - `storeBackupCodes: "plain"`;
   - the message mapping removed.

   Write the script like `/data/tmp/hyg006/mutations.sh`: restore after each, judge "no test ran" as INVALID, `cmp` the originals.
8. **Browser** (`ui-validation`):
   - Profil & Keamanan: the backup-code form asks for the authenticator code.
   - The verification page shows "Akun dikunci sementara. Coba lagi dalam 15 menit." after 5 wrong codes.
   - At 390/820/1180/1440 and 200 % text.
9. Full suite ×3 under the host rule.
10. Docs:
    - `docs/tasks/HYG-007.md` results;
    - STATUS row;
    - a BUILD-LOG gotcha;
    - ARCHITECTURE: move the HYG-007 bullet from "Planned changes" into the auth lines.
11. Implementation review by GPT and claude (read-only `pi`, `/data/tmp/review-ro.sh`). Keep each prompt narrow, with a tool budget. Fix every finding, LOW included.
12. Finish the ledger, commit, record the hash, push, watch CI.

## 3. HYG-008: database authority (R3, migration 0048)

1. **Plan review** of `docs/tasks/HYG-008.md` by GPT and claude. Check especially:
   - the lock order: every re-created function takes `staff_access` first, and the `setting_draft_decide` inversion is fixed;
   - the list of re-created functions against their latest definitions (0036, 0046, 0028, 0030, 0032, 0044, 0022, 0011, 0024, 0009).
2. Write `drizzle/0048_authority_wall_clock.sql` (`CREATE OR REPLACE` with the latest bodies; only the planned lines change). Update `src/db/rls/operator.sql` for the column grants.
3. Tests in `tests/rls/authority-clock.test.ts`: two connections and barriers, no sleeps. One case per function family. Add the A-01, A-03, B-01…B-04 and lock-order cases.
4. A function-body drift check: `pg_get_functiondef` before and after, normalized, showing only the intended lines changed.
5. Mutations per function family, migration from zero and from 0047, full suite ×3, the isolation gate, the contract checker.
6. Docs: a DECISIONS row (actor validity on the wall clock after the tenant lock), ARCHITECTURE, BUILD-LOG, STATUS.
7. Implementation review (GPT and claude), commit, push, CI.

## 4. HYG-009: clinic write actions (R3)

1. Write the full plan in `docs/tasks/HYG-009.md` from its verified findings:
   - B2-1 stale context, all listed actions;
   - N1 `/staf/<id>`;
   - N2 Owner branch settings (a `setting_set` change, so a migration);
   - N3 context switch.
2. Design for B2-1: every clinic form carries hidden `ctxTenant`, `ctxRole` and `ctxBranch` fields from the rendered context. Each action compares them with the freshly resolved context before the mutation, and refuses with a reload message. Share one helper in `src/modules/org/context/`.
3. Plan review, then implement. Two-tab tests for each writing action; browser evidence for the refusal message.
4. Review, commit, push, CI.

## 5. HYG-010: isolation gate and docs (R2; GPT and claude review, it is a security control)

1. Plan from `docs/tasks/HYG-010.md`:
   - action and job negatives must return an explicit refusal;
   - consumable victim state is re-seeded per run;
   - a success becomes a secret-bearing body;
   - the outbox case seeds per run and asserts the handler ran;
   - `/staf/[id]` is `not-found`;
   - browser runners set `process.exitCode = 1` on failure;
   - stale STATUS and ARCHITECTURE lines corrected;
   - DEC-031 "Supersedes" for DEC-024 and DEC-015 (part).
2. Prove the gate can fail: a deliberately broken tenant filter in one action (a mutation) must fail the gate.
3. Review, commit, push, CI.

## 6. HYG-011: test limits (R2)

1. Collect the JSON reporter output of several full suites. List the tests whose p99 is above 40 % of their limit, and give each a measured explicit limit with its normal duration in a comment. No global change.
2. `tests/platform/hosts.spec.ts`:
   - write the standalone server's stdout and stderr to a temp file and print it when start fails;
   - take a port by listening on port 0 first;
   - keep the 30 s poll.
3. Full suite ×3; review; commit; push; CI.

## 7. Wave gate and push

- Local CI order, image migration (`tests/platform/image-migrate.sh`) and restore drill. Gate scripts are in `/data/tmp/gate*.sh`.
- Push, then watch CI until green.

## 8. Remaining M0 tasks (as in `TASKS.md`)

- **T-027:** onboarding checklist per tenant/branch and go-live confirmation. R3, UI and a migration, so it runs alone in its wave (DEC-035). K9: the clinical go-live gate is built with synthetic evidence.
- **T-028:** Saya › Akses Vendor. Carry from T-026:
  - event labels ("Jendela akses dibuka" for `window`, refusal reasons including `unknown`, `row_found` false = "data tidak ditemukan");
  - keyset paging on `(at, kind, key)`;
  - paginate the session list;
  - DEC-040 K6/K7/K8;
  - dual-identity revocation needs HYG-008's B-02 guard fix.
- **T-032:** M0 exit review (R4): all M0 scenarios, RLS, isolation and auth suites, independent review by GPT and claude, the wave gate, push.

## Standing rules (short)

- One task at a time.
- Plan first. A ledger run per task, with required checks recorded by `--command`.
- Re-run checks after any edit: stale evidence denies PASS.
- R3 work needs GPT and claude review; fix every finding, LOW included.
- Mutation-test every key control. "No test ran" counts as invalid.
- UI work needs browser evidence at 390/820/1180/1440 and 200 % text.
- Commit only the task's files, with the noreply identity and no AI trailer. Push after green, and watch CI.
- Decisions are revisable defaults (DEC-041). Every change is logged in BUILD-LOG and STATUS and mapped in ARCHITECTURE.
