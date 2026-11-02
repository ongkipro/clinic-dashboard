# Status — clinic-dashboard

Updated: 2026-11-02
Status: Active
State: INTEGRATING
Review-Risk: R3
Independent-Review: PASS
Primary-Worker: pi (9router-fantastico/cc/claude-opus-5-5)
Independent-Reviewer: claude-code 2.1.316 (claude-opus-5-5, separate context)
Independent-Review-Head: UNSET

## Delivery state machine

Allowed forward path:

`PLANNED -> READY -> IMPLEMENTING -> VERIFYING -> REVIEWING -> INTEGRATING -> PRODUCTION_READY -> AWAITING_DEPLOY_APPROVAL -> DEPLOYED -> SMOKE_TESTING -> VERIFIED`

Use `BLOCKED` only as an interruption state. Record the blocker and exact state to resume. Do not skip verification/review/integration states. `production-gate` proves the transition from `INTEGRATING` to `PRODUCTION_READY`; it never deploys.

`RELEASE.md` owns release-specific truth: release ID, base, declared risk, rollback reference/command, backup proof, and readiness status. `Review-Risk` is the highest semantic risk found during review. `production-gate` computes effective release risk as max(`RELEASE.md` Declared-Risk, deterministic `diff-risk`, `Review-Risk`). R3/R4 require `Independent-Review: PASS`, a reviewer distinct from `Primary-Worker`, and `Independent-Review-Head` bound to the reviewed release content. Only review-attestation files may change after that commit.

`OBSERVABILITY.md` owns post-deploy verification probes. After deployment, transition to `SMOKE_TESTING` and run `release-check`. Every configured observability probe must pass before transition to `VERIFIED`.

## Current state

M0 in progress. Owner instruction 2026-11-02: run tasks in order, independent review after each task, local commit per task; push only on explicit approval (not yet given, so no CI run exists).

| Task | Result | Commit |
|---|---|---|
| T-001 repository bootstrap | PASS locally; review APPROVE; CI proof pending push | `862307d` |
| T-002 database core | PASS; R3 review APPROVE after fixes | `60a4498`, `b08bc75` |
| T-003 RLS harness | PASS; R4 review APPROVE (claude-code and codex, four rounds) | `98067c6` |
| T-004 isolation CI gates | PASS; R3 review APPROVE after two rounds of fixes | this commit |

Built so far: see `DECISIONS.md` DEC-005 (toolchain), DEC-006 (database core), DEC-007 (RLS foundation) and DEC-008 (isolation gate); `ARCHITECTURE.md` is updated when runtime behaviour exists.

## Active work

None between tasks. Next: T-005 (platform basics, R4).

Carried forward (outside the owning task's Allowed Paths):
- `.dockerignore` (build context excludes `.env*`, `node_modules`, `docs/research/`).
- Runtime image does not yet ship `src/db/migrate.ts` and `drizzle/`, so migrations cannot run from the image; owner: the deploy/Dockerfile task.
- Copy `public/` into the runtime image once it exists; upgrade Next.js to 16.4.4 after `minimumReleaseAge`.
- Migrations from parallel worktrees must be regenerated on rebase (Drizzle skips an older `when`).
- TEN-4 (tenant keys in caches; lint against tenant-less `"use cache"`, `cacheTag`/`cacheLife`, `unstable_cache`, cached `fetch`; dynamic `(app)`/vendor/API routes) has no owning task in `TASKS.md`; owner to assign before the first cached page.
- Isolation lint gaps to close later: env lookups such as `process.env.<TENANT>`, identity props `tenant.id`/`brand`/`host`, map lookups keyed by tenant, and a grep for tenant literals outside `src/` (scripts, seeds, config).
- T-005 creates `src/proxy.ts`, which can answer requests itself: add it to the isolation gate (surface or guard) in that task.
- Release task: push the image to a registry and record the manifest digest (`packages: write` for GHCR); the CI record is a build attestation until then.
- Before the first task that writes branch or role predicates: TEMP privilege granted directly to the login is not yet refused by `assertAppRole`.

## Blockers

None for M0. Later gates: Q-12 (Numa job validation; PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83), G2 (H-02d, Q-08, Q-10, Q-11, Q-15, Q-17, R-01), G3 (Q-05, Q-06). See `docs/spec/02-PRD.md` §13 and `PLAN.md`.

## Verification evidence

- 2026-11-02 T-004: `pnpm test:isolation` failed (exit 1) on a real untested page `src/app/(app)/probe-untested` and passed after removal; probe cases proved the harness fails an empty case (positive control) and a leaking case, and passes a filtered list case; lint rule tests (slug, brand in template/JSX, UUID, three branching forms, no false positives, not applied outside `src/`); full CI step sequence simulated locally with `CI=1`; actionlint clean.
- 2026-11-02 T-003: 56 tests on PostgreSQL 16.15 (40 RLS: startup refusal per unsafe role shape, scope map incl. views/matviews, no app access to platform tables or definer functions, cross-tenant not-found, fail-closed without context, concurrency, nesting, dead-connection handling); mutation of each control fails its test; typecheck, lint, build, docs:check, drizzle-kit check PASS (`.delivery/`).
- 2026-11-02 T-002: fresh database migrate, 16 tests on PostgreSQL 16.15 (contract checker with a negative fixture per rule; advisory-lock test fails 3/3 with the lock removed), `drizzle-kit check`, typecheck, lint, build, docs:check — all PASS (`.delivery/`).
- 2026-11-02 T-001 (Node 26.13.0, clean `node_modules` and `.next`): install --frozen-lockfile, typecheck (`next typegen && tsc`), lint, build, `pnpm audit --prod`, docs:check (24 files, 653 declarations, 131 tasks, 0 findings), docs:promotion, actionlint, Docker image (HTTP 200, uid 1000), compose PostgreSQL 16.15 — all PASS, recorded as executed checks in `.delivery/`. CI run: pending push.

- 2026-11-02 `project-check --full`: lint, build and delivery contract passed (bootstrap).
- 2026-11-02 `pnpm docs:check`: PASS, 24 spec files, 653 declarations, 131 tasks, 0 findings.
- 2026-11-02 round 7 review (GPT-6 Astra route) applied; `pnpm docs:check` PASS, `project-check --full` VERIFIED.
- 2026-11-02 closure review and follow-up confirmation: all F1–F9 CLOSED as specification defects; final APPROVE (`docs/research/reviews/round7-closure-final-astra.md`). Generator reproduced byte-for-byte; 131 tasks, no forward dependencies, UI contracts and migration/schema-permission invariants checked. T-001 remains unstarted.

## Next verified action

Start T-005 (platform basics: pgBackRest backups, envelope key custody, host resolver). R4: independent review before integration.
