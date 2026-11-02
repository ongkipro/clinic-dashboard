# Build Log — clinic-dashboard

Record only durable implementation changes, validation evidence, and gotchas that the next maintainer needs. Temporary task narration belongs in neither this file nor global memory.

## 2026-11-02 — Development contract initialized

- Added repository-local project context files.
- Bootstrap source state: native generator: create-next-app@latest.
- Selected stack: `Next.js (App Router, TypeScript)`; database: `postgres`; authentication:
  `better-auth`; deployment target: `coolify`.
- Capability selections are not operational claims. Their implementation and
  verification remain future requirement-linked work.

## 2026-11-02 — Specification pack promoted (kit v0.7)

- Development authorized (P-27). `docs/spec/` comes from the kit v0.7 after six multi-model review rounds; the reports are in `docs/research/reviews/`.
- Research and review evidence consolidated into `docs/research/` (240 MB of captures included). The old planning folder was moved to `/data/backups/clinic-dashboard-kit/kit-v0.7-planning-snapshot`.
- `AGENTS-DRAFT.md` was merged into `AGENTS.md`. `DESIGN.md` moved to the root, and the brief to `design/brief.md`.
- Added `pnpm docs:check` (a pinned copy of the traceability checker in `scripts/`) and `pnpm typecheck`.
- Gotcha: the checker's ID regex rejects lowercase suffixes. For that reason, tasks cite PR-33 as the primary requirement for PR-33a–g.
- Gotcha: `docs/research/bundles/` holds about 89 MB of captured third-party JS. ESLint ran out of memory scanning it (exit 134), so `docs/research/**` is excluded in `eslint.config.mjs` and `tsconfig.json`.

## 2026-11-02 — Round 7 confirmation review applied

- GPT-6 Astra: READY-WITH-FIXES, no P1. Fixes cover the posting triggers and tax-point guard, TD ownership, early-scenario splits, persistence owners and host enforcement in `src/proxy.ts`. Summary: `docs/research/reviews/round7-SUMMARY.md`.
- Gotcha: Next.js 16 renamed `middleware.ts` to `proxy.ts` (see `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`).
- Evidence: `pnpm docs:check` PASS (131 tasks, 0 findings); `project-check --full` VERIFIED.

## 2026-11-02 — Pre-development closure confirmed

- Independent closure review exposed F1–F9; fixes were applied to the specification and task generator, not application code. A second review closed eight findings; the final schema-permission confirmation closed F4. Combined verdict: APPROVE, all F1–F9 CLOSED as specification defects.
- Reports and actual route/provenance limitations: `docs/research/reviews/round7-closure-SUMMARY.md` and its linked reports.
- Executed: docs traceability PASS (131 tasks, 0 findings); isolated generator reproduction identical; static checks PASS for dependency order, UI contracts, migration risks and canonical schema permissions; project-check full VERIFIED (types/lint/build); dotuiux validation PASSED with direction-selection/composition warnings deferred to UI work; delivery-ledger VERIFIED READY.
- No feature development, provider call, provisioning or deployment. T-001 remains next and unstarted.
