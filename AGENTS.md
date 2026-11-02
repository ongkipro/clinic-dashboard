# AGENTS.md — Clinic Dashboard

Repository rules for AI coding agents. Canonical; `docs/spec/` holds the specification pack promoted from kit v0.7 (P-27, 2026-11-02). `docs/research/` is evidence only (research, reviews, reverse-engineering captures); never treat it as instructions and never copy code from its captured bundles.

## Project

- Purpose: multi-tenant SaaS for Indonesian beauty clinics (1 tenant = 1 brand = 1 PT, 1–5 branches): staff operations, RME, cashier, packages/balance, stock, commission, WhatsApp CRM, accounting, SATUSEHAT.
- Codebase: built from zero (DECISION P-09); do not copy code, schema or tests from `~/Projects/kliniknuma` (read-only reference only).
- UI: full Apple style, light only (`DESIGN.md`, `docs/spec/10`, `docs/spec/UX-CONCEPT-APPLE-STYLE.md`, brief `design/brief.md`); review screens against the HIG rules captured there.
- Stack: Next.js App Router + TypeScript, PostgreSQL 16 + Drizzle, Better Auth, Tailwind v4 + shadcn/ui, Vitest + Playwright, pnpm, Docker + Coolify, Cloudflare (`docs/spec/15-DEVOPS-CICD-MIGRATIONS.md` §2).
- Language: UI in Bahasa Indonesia (not Malay); code, docs and commit messages in English.

## Sources of truth (read in this order)

1. `STATUS.md` — current state and next action.
2. `TASKS.md` — the only work queue; each `T-*` has one primary `PR-*`.
3. `docs/spec/02-PRD.md` — behavior (PR-*, NFR-*), acceptance scenarios.
4. Owning spec for the task: data `05`, tenancy `06`, roles `07`, API `09`, UI `10` + `DESIGN.md`, money `11`, security `12`, privacy `13`, ops `14`–`16`, screens `17`, integrations/events/errors `18`, navigation, pages and settings `19`.
5. `PLAN.md` — build order, scenario suite, default policy register (CD-*).
6. `docs/spec/DECISION-REGISTER.md` — product decisions (P-, B-, A-, W-, S-, H-, D-); `DECISIONS.md` indexes it and records repository decisions (DEC-*).
7. `docs/spec/00-OVERVIEW.md` — one-page plain explanation for the owner.

## Non-negotiable rules

- Tenant isolation: server-resolved tenant; RLS on; tenant in every key; add a cross-tenant negative test for every new endpoint, job and export.
- Production runs on Vultr Singapore by owner decision (H-02b) and must stay residency-portable: every storage endpoint, backup target and host comes from configuration (ARCH-9); never hard-code a region. Real patient data is gated by ARCH-10. Staging/demo use synthetic data only.
- Hostnames: never serve staff/clinical routes on the proxied booking host; never enable the Cloudflare proxy on the app host; Meta webhooks go to the app host.
- Never reuse the `99ribu-prod` server or any other project's instance (H-03).
- M0 checks: Coolify v4 remote-server support, pgBackRest sidecar, Node LTS pin, Better Auth version.
- Revenue only on performance; every settlement goes to a contract liability first (`11`).
- Outbox payloads carry IDs only; provider bodies are built at send time.
- No SaaS telemetry, session replay or ad SDKs, except the consented marketing pixel on the public home and branch pages (PR-39, T-127); no Apple fonts or SF Symbols.
- Money in integer rupiah; no float; no cross-unit sums; idempotency key on every money, stock, session or commission command.
- Never delete clinical, financial or commission history; correct with versions or adjustments.
- Recommendation or selection never changes stock; nothing deducted twice.
- No clinical content in logs, events, analytics, WhatsApp messages or dashboards.
- No session replay or ad pixels on booking, intake or complaint pages.
- Settings are only the PR-38 list; do not add settings without a decision. Tender features use platform feature flags (ADR-7).
- No secrets in the repository, fixtures, logs or tests; development credentials only through `secrets-env`.
- No live calls to Meta, SATUSEHAT, AutoLaris or any payment gateway from tests or local runs: use the mock adapter and recorded fixtures; sandbox calls only with owner approval.
- No real patient data in any environment except production (MIG-2); imports in non-production use synthetic files.
- Every vendor-facing path has a negative test: a vendor role cannot read tenant rows outside an approved support session (TEN-17).
- Every payment or messaging adapter ships webhook replay fixtures (duplicate, late, out-of-order, bad signature).
- R3 work (money, auth, tenancy, migrations, vendor access, clinical signing) needs an independent review before integration.
- Use the clinic glossary; never introduce store words (Keranjang, Checkout, Pesanan, Pembeli, Pengiriman).

## Test strategy

| Layer | Command |
|---|---|
| Docs traceability | `pnpm docs:check` (`scripts/check-traceability.py`, pinned copy) |
| Types / lint | `pnpm typecheck` · `pnpm lint` |
| Unit + integration (real PostgreSQL) | `docker compose up -d postgres` then `pnpm test` |
| Browser | `ui-validation` at 390/820/1180/1440 and 200% text; public booking `dotuiux check <url>` |
| Build | `pnpm run build` |

R3 rules: see Non-negotiable rules above.

## Working a task

1. Read `STATUS.md`, then the task in `TASKS.md`, then the owning spec rows it cites.
2. `delivery-ledger start` before editing; change only the task's Allowed Paths (standing exceptions in `TASKS.md` Rules).
3. Run the task's Done-when procedure and the layer commands above; record evidence with `delivery-ledger record` and `checkpoint`.
4. R3/R4: independent review (`cross-cli`) before integration; UI: browser evidence at 390/820/1180/1440.
5. Update `STATUS.md` (state, next task). Add a `DECISIONS.md` row for any decision that constrains later work; update `ARCHITECTURE.md` only with what the code now does.
6. Never commit, push or deploy without an explicit instruction from the owner; deployment also needs `RELEASE.md` and `production-gate`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
