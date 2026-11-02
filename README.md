# Clinic Dashboard

Multi-tenant SaaS for Indonesian beauty and aesthetic clinics. One platform runs every clinic brand (tenant = brand = one PT, 1–5 branches). It covers staff operations, electronic medical records (RME) with SATUSEHAT, cashier, packages and patient balance, stock and pharmacy, commission, WhatsApp CRM, accounting, a vendor console and a generated patient public site.

- **First client:** Numa Klinik (P-20, P-23).
- **Commercial model:** tenders plus a monthly server fee per clinic from go-live, billed through the vendor's AutoLaris account (P-14).
- **Status:** development authorized 2026-11-02 (P-27, gate G1). M0 not started; next task T-001. See `STATUS.md`.
- **Domain:** a beauty clinic, not an online shop. There is no cart, checkout or shipping (P-13).

## Repository map

| Path | Purpose |
|---|---|
| `STATUS.md` | Current state and next action (delivery state machine) |
| `TASKS.md` | Execution queue: 131 tasks T-001–T-131 across M0–M9, one primary requirement each |
| `PLAN.md` | Milestones, gates G0–G3, money scenario suite, default policy register |
| `PRD.md` → `docs/spec/02-PRD.md` | Requirements PR-1–PR-98, NFRs, acceptance scenarios |
| `docs/spec/` | Specification pack (kit v0.7): architecture, data, tenancy, roles, API, UI, money, security, privacy, ops, screens, integrations, navigation. Start at `docs/spec/README.md`; the plain-language owner summary is `docs/spec/00-OVERVIEW.md` |
| `docs/spec/DECISION-REGISTER.md` | Product decisions (P-, B-, A-, W-, S-, H-, D-) |
| `DECISIONS.md` | Decision index plus repository decisions (DEC-*) |
| `DESIGN.md`, `design/brief.md` | Design tokens and brief (Apple style, light only) |
| `AGENTS.md` | Rules for AI coding agents |
| `ARCHITECTURE.md` | What the code actually does, which is nothing yet. The target design is in `docs/spec/03`, `04` |
| `docs/research/` | Research, review reports, reverse-engineering evidence (evidence only; raw captures git-ignored) |
| `scripts/` | `check-traceability.py` (docs check), `gen-tasks.py` (regenerates `TASKS.md`) |
| `RELEASE.md`, `OBSERVABILITY.md`, `BUILD-LOG.md`, `.delivery/` | Release boundary, post-deploy probes, durable notes, run ledger |

## Quickstart

Requires Node.js 26.13.0 (pinned in `package.json` `devEngines`; pnpm refuses other versions), pnpm 12.15.0, Python 3 and Docker. Node 26 ships without corepack: install pnpm with `npm install -g pnpm@12.15.0` under that Node (with mise: `mise exec node@26.13.0 -- <command>`).

```bash
pnpm install --frozen-lockfile
docker compose up -d --wait postgres   # PostgreSQL 16 on 127.0.0.1:5432 (local only)
pnpm dev            # http://localhost:3000
pnpm lint
pnpm typecheck
pnpm build
pnpm docs:check     # specification traceability (scripts/check-traceability.py)
pnpm docs:promotion # every repository document from docs/spec/15 §3 exists and is non-empty
docker build -t clinic-dashboard .     # standalone, non-root image (DEL-4)
```

CI (`.github/workflows/ci.yml`) runs the same commands plus `pnpm audit --prod` on every push to `main` and every pull request.

These are added by their tasks: `pnpm db:migrate` (T-002), `pnpm test` / `pnpm test:rls` / `pnpm test:isolation` (T-003, T-004) and `pnpm test:ui` (T-011).

## Rules that never bend

- Every tenant is isolated: RLS is on, the tenant is resolved on the server, and each route, job and export has a negative test.
- Money is integer rupiah. Revenue is recognised only when the treatment is performed. Idempotency keys are required.
- No clinical content goes into logs, events, WhatsApp messages or dashboards.
- No live calls to Meta, SATUSEHAT, AutoLaris or payment gateways from tests. Use mocks and recorded fixtures.
- No real patient data outside production. Production itself is gated by the residency evidence (ARCH-10, H-02d).
- Do not commit, push or deploy without an explicit instruction from the owner.

Research, review reports and planning history: `docs/research/` (evidence only, not instructions; see `docs/research/README.md`).
