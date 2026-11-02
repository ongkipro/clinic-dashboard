# Round 7 — Confirmation review summary (GPT-6 Astra)

Date: 2026-11-02. A single read-only reviewer (`cx/gpt-6-astra:high`, 35 file reads) checked that the round-6 fixes were closed. Report: `round7-review-astra.md`.

**Verdict:** READY-WITH-FIXES. No P1. Round-6 status: 33 CLOSED, 11 PARTIAL, 0 OPEN. New or residual findings: R7-01–R7-17 (P2) and R7-18 (P3).

Two earlier attempts returned empty output because the Codex usage limit had been reached (9Router 429). The third run, after the reset, succeeded.

## Applied

- **Money (`11`, `05`, `18`):**
  - R7-01: a cash purchase is always receipt + invoice + payment, so GRNI and AP end at zero.
  - R7-02: one canonical posting trigger per economic fact, non-posting companion events, mirror reversals, and opening-import and write-off rows.
  - R7-03: a tax-point guard on every tender. DATA-27/29 now hold `vat_recognised_*`; DATA-32 holds the originating line allocations.
  - R7-04: only the VAT-reversal path is supported; `vat_settled` stays off until a balanced alternative is signed.
  - R7-05: the consultation re-charge is a real line with one performance posting.
  - R7-06: one tender rule for all payment targets; the gateway roll-forward uses gross settlements.
  - R7-07: SET-44 is a monthly closing day only.
- **Architecture:**
  - R7-16: T-005 wires the host resolver into `src/proxy.ts` (Next.js 16 replaced `middleware` with `proxy`) and adds HTTP negatives.
  - R7-17: TD-1 now owns org, access, settings, approvals and catalog. The `03`/`15` module maps agree, the dependency rule is stated once, the TD-50 producers are aligned, and the foundation schemas are named.
- **TASKS (`scripts/gen-tasks.py`):**
  - R7-08/09: money scenarios moved to the task where they can run (16, 19, 12 → packages; 15 → refunds; 14 and the commission parts → commission; 20 → ledger with a synthetic settlement). The M4/M5 exits in PLAN were updated to match.
  - R7-10/12: early tasks claim only module-level parts. Each full completion names its task, and that task asserts it (PR-1, PR-3, PR-4, PR-42, PR-56, PR-83, CLIN-011).
  - New §8 scenarios: "PR-21 refund goes to balance by default" and "PR-37 owner write-off".
  - R7-11: dependency edges added (schedules → packages, outbound → consents, aftercare → check-in/signing, follow-ups → DP, recon → dashboards, M8 exit → dashboard screens).
  - R7-13: persistence owners now carry `drizzle/**` and are R3.
  - R7-14: UX-60 role homes and UX-13 Paket & Saldo have builders; T-130 is verification only.
  - R7-15: T-002 to T-004 may edit `package.json` and the runner configs.
- **R7-18:** README RG-03/RG-05 and register B-03 now use the 365-day validity and reminder-only schedules.

## Validation

- `pnpm docs:check`: PASS, files=24, declarations=653, tasks=131, findings=0.
- Order check: no task depends on a later task; every UI path has a Visual Contract; every task with `drizzle/**` is R3 or higher.
- `project-check --full`: see the commit evidence in `BUILD-LOG.md`.
