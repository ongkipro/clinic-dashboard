# Status — clinic-dashboard

Updated: 2026-11-02
Status: Active
State: INTEGRATING
Review-Risk: R3
Independent-Review: PASS
Primary-Worker: pi (9router-fantastico/cc/claude-opus-5-5)
Independent-Reviewer: claude-code 2.1.316 (claude-opus-5-5, separate context; codex lane failed: sandbox bwrap error)
Independent-Review-Head: UNSET

## Delivery state machine

Allowed forward path:

`PLANNED -> READY -> IMPLEMENTING -> VERIFYING -> REVIEWING -> INTEGRATING -> PRODUCTION_READY -> AWAITING_DEPLOY_APPROVAL -> DEPLOYED -> SMOKE_TESTING -> VERIFIED`

Use `BLOCKED` only as an interruption state. Record the blocker and exact state to resume. Do not skip verification/review/integration states. `production-gate` proves the transition from `INTEGRATING` to `PRODUCTION_READY`; it never deploys.

`RELEASE.md` owns release-specific truth: release ID, base, declared risk, rollback reference/command, backup proof, and readiness status. `Review-Risk` is the highest semantic risk found during review. `production-gate` computes effective release risk as max(`RELEASE.md` Declared-Risk, deterministic `diff-risk`, `Review-Risk`). R3/R4 require `Independent-Review: PASS`, a reviewer distinct from `Primary-Worker`, and `Independent-Review-Head` bound to the reviewed release content. Only review-attestation files may change after that commit.

`OBSERVABILITY.md` owns post-deploy verification probes. After deployment, transition to `SMOKE_TESTING` and run `release-check`. Every configured observability probe must pass before transition to `VERIFIED`.

## Current state

M0 in progress. T-001 (repository bootstrap, PR-1) is implemented and verified locally; it waits for the owner to approve commit and push so the first GitHub Actions run can prove the "exit 0 in CI" part of Done-when.

Built so far: Node 26.13.0 pinned (`devEngines`, Docker image), Next.js 16.4.3 with `output: "standalone"`, `compose.yaml` (PostgreSQL 16.15, loopback only), multi-stage non-root `Dockerfile`, `.github/workflows/ci.yml` (SHA-pinned actions, PostgreSQL service ready for later tests), `pnpm docs:promotion`. Versions and their reasons: `DECISIONS.md` DEC-005.

## Active work

T-001, run `RUN-20261102T130612Z-c5339ef8`. Ledger risk escalated R2 → R3 (CI and Dockerfile); independent review APPROVE after fixes, boundary approved.

Carried forward (not in T-001 Allowed Paths):
- Add `.dockerignore` (keeps `.env*`, `node_modules`, `docs/research/` out of the build context sent to Coolify) — needs a task or a Rules exception.
- Copy `public/` into the runtime image once the folder exists.
- Upgrade Next.js to 16.4.4 once it passes pnpm `minimumReleaseAge`.

## Blockers

None for M0. These open questions gate later milestones (see `docs/spec/02-PRD.md` §13 and `PLAN.md` gates):

- Q-12: Numa job validation. It may change PR-7, PR-9, PR-14, PR-15, PR-18, PR-71 and PR-83.
- G2 (first real patient): H-02d residency opinion, plus Q-08, Q-10, Q-11, Q-15, Q-17 and R-01.
- G3 (journal export, VAT): Q-05 and Q-06 accountant and tax-adviser evidence in the compliance register.

## Verification evidence

- 2026-11-02 T-001 (Node 26.13.0, clean `node_modules` and `.next`): install --frozen-lockfile, typecheck (`next typegen && tsc`), lint, build, `pnpm audit --prod`, docs:check (24 files, 653 declarations, 131 tasks, 0 findings), docs:promotion, actionlint, Docker image (HTTP 200, uid 1000), compose PostgreSQL 16.15 — all PASS, recorded as executed checks in `.delivery/`. CI run: pending push.

- 2026-11-02 `project-check --full`: lint, build and delivery contract passed (bootstrap).
- 2026-11-02 `pnpm docs:check`: PASS, 24 spec files, 653 declarations, 131 tasks, 0 findings.
- 2026-11-02 round 7 review (GPT-6 Astra route) applied; `pnpm docs:check` PASS, `project-check --full` VERIFIED.
- 2026-11-02 closure review and follow-up confirmation: all F1–F9 CLOSED as specification defects; final APPROVE (`docs/research/reviews/round7-closure-final-astra.md`). Generator reproduced byte-for-byte; 131 tasks, no forward dependencies, UI contracts and migration/schema-permission invariants checked. T-001 remains unstarted.

## Next verified action

Owner: approve commit and push of T-001. Then record the CI run URL and conclusion in the ledger, finish the run, and start T-002 (database core, R3).
