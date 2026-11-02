# Round 6 — Pre-commit review summary (kit v0.7)

Date: 2026-11-02. Four read-only reviewers (direct `pi -p --tools read`):

| Run | Model | Focus | Verdict | P1 | P2 | P3 |
|---|---|---|---|---|---|---|
| a | cc/claude-opus-5-5 | Doc hygiene, navigation | READY-WITH-FIXES | 1 | 10 | 23 |
| b | cx/gpt-6.1-sol | Architecture, repo structure | READY-WITH-FIXES | 0 | 6 | 0 |
| c | cc/claude-fable-5-1 | Requirements → tasks | READY-WITH-FIXES | 0 | 15 | 7 |
| d | cx/gpt-6-astra | Money, data, regulatory | READY-WITH-FIXES | 0 | 12 | 1 |

## Applied

- **A-01 (P1)** authorization wording: status lines now say development starts only with owner authorization recorded as **P-27** (reserved, OPEN) at G1; PRD §15 approval box references P-27 and the 7 PRs Q-12 may still change. Kit stays non-authoritative for development until P-27 is recorded.
- Register: D-13, P-15, P-18, A-15, D-09 aligned with P-24; B-16 superseded by B-24; H-10/Q-14 neutral wording; change log rebuilt chronologically; canonical copy = kit.
- Architecture: three hosts (app, booking, vendor); Meta webhooks via app host; TEN-4 covers every authenticated page regardless of URL prefix; `15` §3 full layout, module map for TD-13/TD-14 and platform core, dependency direction, module-local schema convention, promotion document table.
- Money/data: receivable-collection and booking-DP refund posting rows; VAT not doubled; GRNI/AP/expense funding options; supplier credit notes entity; promo code versions entity; package validity in days (SET-8, BILL-10, DATA-15, PR-38 scenario); SET-14 MDR clinic-borne; SET-15 no session deduction; SET-44 batch period only; SET-48 approval wording + IAM pharmacist cell; owner self-write-off exception; NIK classification left to counsel; CTX-12 Numa as first client; TD-50 supplier and receivable events.
- PRD: PR-40 Phase 4; ranges JUR-ID-11, UX-60, K1–K27; §14 full cross-document list; Q rows sorted; new scenarios "PR-83 no-show without DP" and "PR-94 campaign sending gated"; PR-94 covers campaigns.
- TASKS (generator `proposals/gen_tasks_v0.7.py`): 131 tasks. New T-005 platform basics (backups, key custody, hosts) and T-130 navigation sweep. Fixed dependency order (balance before packages, credential model before consent gates, consultation fee after refunds), money scenarios assigned to building tasks, module-level vs full scenario split, settings/compliance/audit/catalog/finance/export/DSR screens added, Visual Contracts on every UI path, `drizzle/**` + schema index on table tasks with R3 minimum, product routes for dashboards, standing exceptions for `.delivery/**` and `STATUS.md`.
- README, AGENTS-DRAFT, PLAN, 00-OVERVIEW, 17 tidy items (A-06–A-34).

## Not changed

- None of the findings were rejected. P-27 stays OPEN until the owner authorizes development.

## Validation

- `check-traceability.py` → PASS files=28 declarations=653 tasks=131 findings=0.
- `dotuiux validate` → PASSED (warning: no composition contract, expected at this stage).
- Backup: `/data/backups/clinic-dashboard-kit/clinic-dashboard-v0.7-round6.tar.gz`.
