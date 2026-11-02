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
| DEC-005 | Proposed | Versions pinned at bootstrap: Next.js 16.4.3, React 19.3.0, pnpm 12.15.0; Node LTS, PostgreSQL 16, Drizzle and Better Auth versions to be verified and recorded by T-001 | docs/spec/15 §2 | package.json | — |

Use stable IDs such as `DEC-001`. When a decision needs detailed alternatives or
consequences, record a full ADR in `docs/adr/` and use its ID here as a link,
for example `[ADR-0007](docs/adr/ADR-0007-d1-drizzle-orm.md)`. This file is the
only decision index. Never rewrite history silently: mark the old decision
superseded or deprecated and add the new one.
