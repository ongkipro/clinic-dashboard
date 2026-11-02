# Architecture — clinic-dashboard

Updated: 2026-11-02
Expected stack: Next.js (App Router, TypeScript)

## Selected capabilities

| Capability | Decision | Proven operational |
|---|---|---|
| Database | `postgres` | No |
| Authentication | `better-auth` | No |
| Deployment target | `coolify` | No |

Bootstrap source state: native generator: create-next-app@latest. These selections constrain future
architecture work but do not create services, credentials, schemas, or remote
resources.

## Current system

The repository holds only the create-next-app skeleton: one empty App Router page in `src/app/`. It has no database, authentication, worker or integrations yet.

Target design (not built): `docs/spec/03-TECHNICAL-DESIGN.md` covers modules TD-1–TD-14, and `docs/spec/04-SYSTEM-ARCHITECTURE.md` covers deployment, the three hosts and residency. The repository layout and module map are in `docs/spec/15-DEVOPS-CICD-MIGRATIONS.md` §3. Update this section only as tasks make parts of that design real.

## Boundaries

None built. Planned boundaries: app host, booking host and vendor host (ARCH-3, ARCH-11), tenant isolation (`docs/spec/06`), vendor support sessions (TEN-14), and the Meta, SATUSEHAT, payment-port and AutoLaris integrations (`docs/spec/18`).

## Threats and controls

Not applicable yet: no authentication, data or integration exists. The planned threat model is `docs/spec/12-SECURITY-ARCHITECTURE.md`. This table becomes required once the system handles authentication, payments,
personal or tenant data, uploads, webhooks, or server-side fetches of
user-supplied URLs; otherwise state `Not applicable: <reason>`. Answer what can go wrong at each
boundary above and what the system does about it:

| Boundary or component | Threat (STRIDE category) | Response: mitigate / eliminate / transfer / accept | Enforced in, tested by |
|---|---|---|---|
| [Real component] | [What goes wrong] | [Response; accepted risk names reason and owner] | [File and test] |

Each row names a component that exists in this repository. Revisit when a
boundary, data class, or integration changes.

## Data

None yet. Planned: PostgreSQL 16 with RLS (`docs/spec/05`, `06`), plus private object storage.

## Decisions

Record accepted constraints in `DECISIONS.md`. Costly-to-reverse decisions may
also have detailed ADRs; create that directory only when the first ADR exists.

## Verification

Current: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm docs:check`. Planned: `pnpm test:rls`, `pnpm test:isolation` (T-003, T-004).
