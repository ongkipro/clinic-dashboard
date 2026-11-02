**APPROVE — F4 is closed.** No remaining schema-permission defect or concrete regression from this fix was found.

The canonical convention at `docs/spec/15-DEVOPS-CICD-MIGRATIONS.md:89` now agrees with the affected tasks’ Allowed Paths:

| Task | Canonical schema explicitly permitted | Evidence |
|---|---|---|
| T-018 | `src/modules/vendor/schema.ts` | `TASKS.md:225` |
| T-043 | `src/modules/scheduling/schema.ts` | `TASKS.md:502` |
| T-044 | `src/modules/scheduling/schema.ts` | `TASKS.md:513` |
| T-050 | `src/modules/org/schema.ts` | `TASKS.md:581` |
| T-071 | `src/modules/cashier/schema.ts` and `src/modules/tax/schema.ts` | `TASKS.md:816` |
| T-105 | `src/modules/accounting/schema.ts` | `TASKS.md:1198` |

The previously repaired permissions remain intact: T-027 (`TASKS.md:324`), T-031 (`TASKS.md:368`), T-036 (`TASKS.md:425`), T-042 (`TASKS.md:491`) and T-085 (`TASKS.md:970`). T-027’s explicit nested schema entry remains removed.

**Generator and scope checks**
- The final override at `scripts/gen-tasks.py:665` processes tasks with `drizzle/**` and adds canonical schemas only for modules already represented in their source paths. The `paths()` helper deduplicates additions (`scripts/gen-tasks.py:434`).
- It runs after the earlier repairs and Coretax ownership correction. No subsequent override removes these permissions; output serializes the resulting path lists (`scripts/gen-tasks.py:698`).
- The fix changes only schema-file permissions—not task ordering, dependencies, requirements or acceptance scope. In particular, T-043 can now define roster persistence itself; T-044 still depends on T-043, not vice versa.
- The prior failing scenario is resolved: T-043 may edit `src/modules/scheduling/schema.ts`, generate migrations in `drizzle/**`, and add the index re-export under `TASKS.md:10`, without violating either convention or Allowed Paths.

**F1–F9 disposition: all CLOSED**, combining the prior independent closure of F1–F3 and F5–F9 in `docs/research/reviews/round7-closure-rereview-astra.md` with this F4 check. This is specification-defect closure, not implementation acceptance.

Read-only inspection only; no edits, development, generator execution or tests were performed.