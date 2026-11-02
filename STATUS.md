# Status — clinic-dashboard

Updated: 2026-11-02
Status: Active
State: READY
Review-Risk: R0
Independent-Review: PENDING
Primary-Worker: UNSET
Independent-Reviewer: UNSET
Independent-Review-Head: UNSET

## Delivery state machine

Allowed forward path:

`PLANNED -> READY -> IMPLEMENTING -> VERIFYING -> REVIEWING -> INTEGRATING -> PRODUCTION_READY -> AWAITING_DEPLOY_APPROVAL -> DEPLOYED -> SMOKE_TESTING -> VERIFIED`

Use `BLOCKED` only as an interruption state. Record the blocker and exact state to resume. Do not skip verification/review/integration states. `production-gate` proves the transition from `INTEGRATING` to `PRODUCTION_READY`; it never deploys.

`RELEASE.md` owns release-specific truth: release ID, base, declared risk, rollback reference/command, backup proof, and readiness status. `Review-Risk` is the highest semantic risk found during review. `production-gate` computes effective release risk as max(`RELEASE.md` Declared-Risk, deterministic `diff-risk`, `Review-Risk`). R3/R4 require `Independent-Review: PASS`, a reviewer distinct from `Primary-Worker`, and `Independent-Review-Head` bound to the reviewed release content. Only review-attestation files may change after that commit.

`OBSERVABILITY.md` owns post-deploy verification probes. After deployment, transition to `SMOKE_TESTING` and run `release-check`. Every configured observability probe must pass before transition to `VERIFIED`.

## Current state

M0 not started. Development authorized 2026-11-02 (P-27, gate G1). The specification pack, kit v0.7, is promoted into `docs/spec/`, and `TASKS.md` (131 tasks) has been re-validated.

Bootstrap evidence comes from the create-next-app generator: Next.js 16.4.3, React 19.3.0, an empty App Router page. PostgreSQL 16 + Drizzle, Better Auth and Coolify are decisions only. Each one becomes real only when its M0 task passes executable checks.

## Active work

No active implementation task is recorded.

## Blockers

None for M0. These open questions gate later milestones (see `docs/spec/02-PRD.md` §13 and `PLAN.md` gates):

- Q-12: Numa job validation. It may change PR-7, PR-9, PR-14, PR-15, PR-18, PR-71 and PR-83.
- G2 (first real patient): H-02d residency opinion, plus Q-08, Q-10, Q-11, Q-15, Q-17 and R-01.
- G3 (journal export, VAT): Q-05 and Q-06 accountant and tax-adviser evidence in the compliance register.

## Verification evidence

- 2026-11-02 `project-check --full`: lint, build and delivery contract passed (bootstrap).
- 2026-11-02 `pnpm docs:check`: PASS, 24 spec files, 653 declarations, 131 tasks, 0 findings.

## Next verified action

Start T-001 (repository bootstrap: pin versions, Compose PostgreSQL, CI skeleton, `pnpm docs:check` in CI). T-001 is R2 and needs no independent review.
