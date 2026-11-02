# Decision Register — clinic-dashboard

Updated: 2026-11-02

Record accepted decisions that materially constrain product behavior,
architecture, security, data, operations, or delivery. Repository evidence must
support each decision; AI output alone is not evidence.

| ID | Status | Decision | Drivers | Evidence | Supersedes |
|---|---|---|---|---|---|
| DEC-000 | Accepted | Product decisions live in [`docs/spec/DECISION-REGISTER.md`](docs/spec/DECISION-REGISTER.md) (P-01–P-27, B-, A-, W-, S-, H-, D-, PD-). This file indexes them and records repository decisions | Single decision index | Promotion 2026-11-02 | — |
| DEC-001 | Accepted | Development authorized and the repository created from kit v0.7 with `project-init` (stack nextjs, postgres, better-auth, coolify, pnpm) | P-27, DEL-1 | `project-check --full` VERIFIED 2026-11-02 | — |
| DEC-002 | Accepted | Codebase built from zero; Kliniknuma is a read-only reference | P-09 | docs/spec/02-PRD.md Document Control | — |
| DEC-003 | Accepted | Production on Vultr Singapore via Coolify; residency-portable configuration; real-patient gate on legal opinion | H-01, H-02b, H-02d, ARCH-9, ARCH-10 | docs/spec/04 | — |
| DEC-004 | Accepted | Patient payments through a gateway-neutral port with a mock adapter; partner decided later | H-10, Q-14 | docs/spec/18 | — |
| DEC-005 | Accepted | Versions pinned at T-001 (registry checked 2026-11-02): Node.js 26.13.0 (Active LTS since 2026-10-28, EOL 2029-04-30; enforced by `devEngines.runtime` onFail=error and the image `node:26.13.0-bookworm-slim`), pnpm 12.15.0, Next.js 16.4.3 (16.4.4 was published 3 hours earlier and is rejected by pnpm `minimumReleaseAge`; take it in a later task once it ages past the cutoff — never by adding a policy exclusion), React 19.3.1, TypeScript 5.9.3 (TS 7 rejected: typescript-eslint supports <6.1), ESLint 10.14.0 (9.x is deprecated upstream; next, typescript-eslint and jsx-a11y rules verified firing under 10), Tailwind CSS 4.3.3, `@types/node` 26.6.6, PostgreSQL 16.15 (`postgres:16.15-bookworm`). Verified for later tasks, installed by them: drizzle-orm 0.45.4 and drizzle-kit 0.31.11 (T-002), better-auth 1.7.15 (its auth task), Vitest 5.0.5 (T-003). CI actions pinned by SHA: checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.0. Container images are pinned by exact tag, not digest, until the release task records image digests (DEL-2) | docs/spec/15 §2 | `package.json`, `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml`; local install/typecheck/lint/build/docs:check on Node 26.13.0 | — |
| DEC-006 | Accepted | Database core (T-002): ids default to `uuid_generate_v7()` (SQL, RFC 9562; PostgreSQL 16 has no built-in uuidv7); `tenants.id` is the `tenants_registry.id` (tenant root, no `tenant_id` column); every FK `ON DELETE RESTRICT`; the 05 §3.1 contract is a test (`tests/db/contract.ts`) that treats every non-platform table as a tenant table; `pnpm db:migrate` needs `DATABASE_URL` (local: `pnpm db:migrate:local`), uses a direct connection, an advisory lock and MIG-1 timeouts; Drizzle applies pending migrations in one transaction; pnpm `allowBuilds` denies esbuild scripts | DATA-7, 05 §3.1, MIG-1, ARCH-9 | `pnpm test` (16 tests, negative fixtures per contract rule) | — |

Use stable IDs such as `DEC-001`. When a decision needs detailed alternatives or
consequences, record a full ADR in `docs/adr/` and use its ID here as a link,
for example `[ADR-0007](docs/adr/ADR-0007-d1-drizzle-orm.md)`. This file is the
only decision index. Never rewrite history silently: mark the old decision
superseded or deprecated and add the new one.
