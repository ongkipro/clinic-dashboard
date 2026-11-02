# Stack, Delivery, CI/CD and Migrations — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Engineering owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Reference | Kliniknuma stack choices (read-only reference; nothing forked, P-09) |

## 1. Delivery Requirements

| ID | Requirement | Owner | Status |
|---|---|---|---|
| DEL-1 | A new repository `~/Projects/clinic-dashboard` is created from zero only on explicit development authorization with `project-init clinic-dashboard --stack nextjs --database postgres --auth better-auth --deploy coolify --package-manager pnpm --from-docs ~/Documents/work/prd/clinic-dashboard/`  First commit also contains: `docs/spec/` (this pack incl. `DECISION-REGISTER.md` and `00-OVERVIEW.md`), `DESIGN.md`, `design/brief.md`, `STATUS.md` ("M0 not started; next: T-001"), `TASKS.md` (promoted from the kit; re-validated at G1), `AGENTS.md` merged from `AGENTS-DRAFT.md`, `.delivery/` from `project-init`. | Product owner (Paduka Ongki) | Decision (P-09, P-27); done 2026-11-02 |
| DEL-2 | CI on every push: install with frozen lockfile, typecheck, lint, unit + integration tests against PostgreSQL 16 service, build, dependency audit, traceability check; isolation gates: RLS suite per policy kind including operator predicates (TEN-17), TEN-3 scope-map test, a cross-tenant negative test for every route, job and export (CI fails on a route without one), a lint rule forbidding tenant ids, slugs or brand names in source outside fixtures and any branching on tenant identity except through the feature-flag API, one build artifact per release with its digest recorded for every instance | Engineering owner | Proposal |
| DEL-3 | Environments: local (Docker Compose PostgreSQL), staging/demo (Vultr Singapore, separate servers, synthetic data), production (Vultr Singapore, dedicated servers; H-02b); all locations are configuration (ARCH-9) | Engineering owner | Proposal |
| DEL-4 | Release: one Docker image (multi-stage, `output: standalone`, non-root) for app and worker; deployed by Coolify; rollback = redeploy previous image tag; migrations are backward compatible for one release | Engineering owner | Proposal |
| DEL-5 | No production deploy, DNS change, or data migration without owner approval recorded in the repository's release record | Product owner (Paduka Ongki) | Decision |
| DEL-6 | One image serves every tenant; a tender that needs a dedicated server gets a separate Coolify app from the same image with one tenant; no per-client fork or build flag (P-11, TEN-15); a dedicated instance is a separate environment with its own KEK, ARCH-10 gate, backups and declared locations, runs the current release digest within 14 days, and has webhook routing for its numbers and merchants declared before activation; moving an existing tenant out of the shared database needs an ADR and a rehearsed per-tenant export/import runbook (Phase-later) | Engineering owner | Proposal |
| MIG-1 | Migrations are expand → migrate → contract; each migration sets `lock_timeout 5s`, `statement_timeout 30s`; signed clinical rows and posted journals are never rewritten | Engineering owner | Proposal |
| MIG-2 | Seeds and fixtures are synthetic, flagged non-production, never contain real patient data | Engineering owner | Proposal |
| MIG-3 | Tenant onboarding import (patients, open packages and sessions, balances, receivables) uses a validated CSV import with dry-run report (DATA-58); opening amounts are recorded as audited opening sub-ledger entries; one opening journal per account is created by the posting engine (M8) and stays unexported until the posting-map evidence is approved; a unique (tenant, source system, entity, external id) key prevents double opening | Engineering owner | Proposal |

## 2. Framework and Stack (Proposal)

Built from zero (P-09). The stack follows choices that Kliniknuma validated, but every version is re-verified against the registry and EOL schedules in the first task and recorded in DECISIONS.md. Versions in the table are Kliniknuma's pins on 2026-11-02 (reference only).

| Layer | Choice | Version (Kliniknuma) | Why | Skill to use |
|---|---|---|---|---|
| Language | TypeScript (strict) | 5.9.x | One language front to back; AI agents work well with types | — |
| Runtime | Node.js | current Active LTS (verify 24 vs 22; align `@types/node`) | Coolify image base | — |
| Web framework | Next.js App Router | 16.4.x | Server components, route handlers, one deployable | `nextjs-development` |
| UI | React | 19.3.x | — | — |
| Styling | Tailwind CSS v4 | 4.3.x | Tokens from `DESIGN.md` (full Apple style, light only) as CSS variables | `admin-product-ux`, `ui-validation` (HIG rules from `DESIGN.md`) |
| Components | shadcn/ui via CLI (Radix primitives; Drawer/vaul for sheets with detents) restyled to Apple-style tokens | CLI current | Accessible primitives; one library | `shadcn-ui` |
| Tables | TanStack Table (via shadcn data-table) | match lockfile | Server pagination, URL state | `admin-dashboard` |
| Charts | Recharts (via shadcn charts) | match lockfile | Simple KPI charts | `admin-dashboard` |
| Forms/validation | Native forms + Zod schema at trust boundaries | current | One parser per boundary | `native-first` |
| Database | PostgreSQL | 16 | RLS, transactions, `SKIP LOCKED` | `postgres-drizzle` |
| ORM/migrations | Drizzle ORM + drizzle-kit | 0.45.x / 0.31.x | Typed SQL, plain migrations | `postgres-drizzle` |
| Auth | Better Auth for staff (email+password, TOTP, memberships); patient booking OTP is a custom challenge table, not a Better Auth plugin (IAM-2) | 1.7.x (verify) | — | `better-auth-security` |
| Jobs/outbox | PostgreSQL outbox + worker process (`FOR UPDATE SKIP LOCKED`) | — | No extra broker | `postgres-drizzle` |
| Object storage | S3-compatible client (AWS SDK v3 S3) | current | Private, versioned bucket (Vultr Object Storage; endpoint is configuration) | — |
| Backup | pgBackRest (WAL archiving + base backups) | current | PITR, RPO 15 min (H-07) | `vps-deploy` |
| Error tracking | Self-hosted (e.g. GlitchTip) in the production environment, or structured logs only | current | No SaaS telemetry (H-08) | `observability-engineering` |
| WhatsApp | Meta WhatsApp Cloud API (Graph API) direct via `fetch`; Embedded Signup JS SDK | Graph API version current | Own Tech Provider (W-02) | — |
| Payments (patients) | Payment port with `mock` adapter in Release 1; one real adapter after the partner decision (Q-14), Midtrans-style first candidate | current | H-10 | — |
| Vendor billing | AutoLaris H2H (vendor account): `create_payment`, `list_payment`, `advice`; never shipping endpoints | current | P-14 | `autolaris-h2h` |
| SATUSEHAT | FHIR R4 REST via `fetch`, OAuth2 client credentials per branch | — | S-01 | — |
| Tests | Vitest (unit/integration), Playwright (browser) | 5.0.x / current | Kliniknuma harness | `testing-engineering`, `ui-validation` |
| Lint | ESLint (next config) | 9.x | — | — |
| Package manager | pnpm | 12.x | Kliniknuma | — |
| Containers | Docker multi-stage; Compose for local | — | — | `vps-deploy` |
| Deploy | Coolify v4 (Traefik) on its own Vultr instance; production and staging as separate servers | — | H-01, H-02b, H-05 | `vps-deploy`, `vultr` |
| Edge | Cloudflare: booking host proxied (WAF, Turnstile, no body logs); app host DNS-only | — | H-02c | `cloudflare`, `turnstile-spin` |
| Diagrams | Mermaid in Markdown | — | — | `mermaid-diagram` |
| API contract | OpenAPI 3.1 file | — | API-1 | `openapi-spec` |

Do not add: Apple fonts or SF Symbols, a second component library, a message broker, an ORM besides Drizzle, client-state libraries unless a screen contract requires them, or session-replay/analytics SDKs on health pages.

## 3. Repository Layout (after promotion)

```
clinic-dashboard/
  README.md  AGENTS.md  PRD.md (index → docs/spec/02-PRD.md)  TASKS.md  PLAN.md  STATUS.md  DECISIONS.md
  ARCHITECTURE.md  RELEASE.md  OBSERVABILITY.md  BUILD-LOG.md  DESIGN.md
  .delivery/                 ← run ledger and evidence (written by delivery-ledger, never by hand)
  docs/spec/                 ← this pack: 00–19 (no 08), CONTEXT-RECORD.md, DECISION-REGISTER.md, UX-CONCEPT-APPLE-STYLE.md (DESIGN.md at root, brief in design/)
  docs/adr/                  ← ADR-NNNN files when a costly decision is recorded
  docs/evidence/mN/          ← milestone exit evidence (M0–M9)
  design/brief.md  design/refs/
  scripts/check-traceability.py  scripts/record-digest.mjs
  src/app/(app)/**           ← authenticated clinic pages (no URL prefix; e.g. /hari-ini, /kasir, /saya)
  src/app/(public)/**        ← booking host: public site /{slug}/**, booking, aftercare links
  src/app/vendor/**          ← vendor console, served only on the vendor host (SEC-21)
  src/app/api/v1/**          ← staff, public and webhook APIs (API-1)
  src/modules/               ← one folder per module; table below
  src/db/                    ← drizzle client, migrate.ts, seed.ts, scope-map.ts, rls/ (SQL policies), schema/index.ts (re-exports module schemas)
  src/workers/               ← outbox, scheduler (reminders, expiries, follow-ups, automation)
  src/components/ ui/ (shadcn) · shell/ · templates/ · visit-track/
  src/lib/                   ← command wrapper (idempotency), money, dates, i18n
  drizzle/                   ← generated SQL migrations (protected)
  tests/<module>/**          ← unit and integration (real PostgreSQL); tests/rls/**, tests/isolation/**, tests/ui/** (Playwright)
  compose.yaml  Dockerfile  drizzle.config.ts  package.json  pnpm-lock.yaml
```

Schema convention: each module owns `src/modules/<module>/schema.ts`; `src/db/schema/index.ts` only re-exports them; migrations are generated into `drizzle/**`. A task that adds or changes tables lists its module schema file and `drizzle/**` in Allowed Paths and is R3 or higher.

### Module map (TD → folder)

| Folder | Module | Owning design ID |
|---|---|---|
| `src/modules/vendor/**` | tenants registry, lifecycle, vendor console, onboarding, support sessions, server-fee billing | TD-13 (03) |
| `src/modules/{memberships,audit,idempotency,events,notifications,compliance,payments,platform,import,export}/**` | memberships and IAM, audit, idempotency, events/outbox, notifications, compliance register, payment port, platform residency, import, export | TD-13 (03) |
| `src/modules/public-site/**` | public-site generator and rules | TD-14 (03) |
| `src/modules/{org,settings,approvals,catalog}/**` | tenant profile, branches, rooms, staff, roles, context, access; settings registry; approvals; catalog, Master Layanan, prices | TD-1 (03) |
| `src/modules/{patients,privacy}/**` | patients, consents, privacy | TD-2 (03) |
| `src/modules/{scheduling,visits}/**` | scheduling, visits, queue | TD-3 (03) |
| `src/modules/{clinical,documents,safety}/**` | clinical (intake, exam, records, consent, media, requests, complaints), documents, safety | TD-4 (03) |
| `src/modules/treatment/**` | treatment room | TD-5 (03) |
| `src/modules/{inventory,pharmacy,purchasing}/**` | inventory, depots, pharmacy, purchasing | TD-6 (03) |
| `src/modules/{cashier,packages,balance,promo,tax,expenses}/**` | cashier, packages, balance, promo, tax profile/VAT, expenses | TD-7 (03) |
| `src/modules/commission/**` | commission and targets | TD-8 (03) |
| `src/modules/{messaging,crm}/**` | messaging, CRM, automation | TD-9 (03) |
| `src/modules/accounting/**` | accounting, journals, Coretax export (`accounting/coretax`) | TD-10 (03) |
| `src/modules/integrations/**` | SATUSEHAT, real payment adapters | TD-11 (03) |
| `src/modules/reporting/**` | reporting | TD-12 (03) |

Foundation schemas (T-002): `tenants`, `branches` in `src/modules/org/schema.ts`; `tenants_registry` in `src/modules/vendor/schema.ts`.

Dependency direction: the single rule is in `03` §2 (platform core never imports clinic-domain modules except through their published interfaces or events); a module writes only its own tables; cross-module reads go through exported queries or events.

### Repository documents at promotion

| File | Created by | Initial content | Updated by / when |
|---|---|---|---|
| `README.md` | project-init, then edited in the first task | What the product is, quickstart (`pnpm install`, `docker compose up -d db`, `pnpm db:migrate`, `pnpm dev`), links to docs | Engineering owner when setup changes |
| `AGENTS.md` | project-init template + merge of the kit's `AGENTS-DRAFT.md` (done at promotion) | Sources of truth, non-negotiable rules, test commands | When a rule or command changes |
| `PRD.md` | project-init | Index pointing to `docs/spec/02-PRD.md` | Never duplicated; edit `02-PRD.md` |
| `TASKS.md` | promoted from this kit | 131 tasks | prd-taskbreaker when requirements change |
| `PLAN.md` | promoted | Milestones, gates, scenarios, defaults | When a milestone or gate changes |
| `STATUS.md` | project-init | "M0 not started; next: T-001" | After every task (delivery-ledger checkpoint) |
| `DECISIONS.md` | project-init | Index linking `docs/spec/DECISION-REGISTER.md`; DEC rows for stack versions (T-001) | Each new decision; ADR rows |
| `ARCHITECTURE.md` | project-init | "Nothing built yet; design in `docs/spec/03`, `04`, `05`, `06`" | When built shape changes (records what the code does) |
| `BUILD-LOG.md` | project-init | Promotion entry: kit v0.7 promoted on date | Durable notes per milestone |
| `RELEASE.md` | project-init | No approved release; declared risk R4; rollback = none deployed | Before any deployment (production-gate) |
| `OBSERVABILITY.md` | project-init | Probes planned per `docs/spec/16` (health endpoint, worker heartbeat, outbox age); none live | When a probe exists |
| `.delivery/` | project-init | Empty ledger | `delivery-ledger` only; task Allowed Paths implicitly include tool-written `.delivery/**` |

A promotion check (part of T-001) verifies every file above exists and is non-empty.

## 4. AI Terminal Workflow (development kit)

| Step | Tool / skill |
|---|---|
| Read order for any agent | `AGENTS.md` → `STATUS.md` → task in `TASKS.md` → its primary `PR-*` in `docs/spec/02-PRD.md` → owning spec (`05`, `06`, `07`, `11`, `17`, `18`, `19`) |
| Write tasks | `prd-taskbreaker` (suite mode: `T-*` tasks, one primary `PR-*`) |
| Validate docs | `pnpm docs:check` → runs `scripts/check-traceability.py docs/spec --tasks TASKS.md` (the checker is copied into the repository at promotion and pinned; CI runs the same command) |
| Execute a task | `delivery-ledger start` with Allowed Paths; R3 tasks (money, auth, tenancy, migrations) need independent review |
| UI work | `admin-product-ux` (workflow) → HIG rules in `UX-CONCEPT-APPLE-STYLE.md` and `DESIGN.md` (external apple-design-skill optional, pinned @ff4ebdd) → `shadcn-ui` → `ui-validation` at 390/820/1180/1440; public booking also `dotuiux check` |
| Security review | `application-security`, `better-auth-security` |
| Release | `production-gate`, then owner-approved deploy via Coolify |
