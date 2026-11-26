# M9 J9 Walkthrough — Clinic Onboarding (Pre-Staging Status)

Status: PENDING EXECUTION (manual owner staging walkthrough deferred under `DEC-034`; automated contract tests pass across `docs/evidence/m9/m9-flow.test.ts` [2 J9 pure-contract checks: residency gate & import dry-run] and the owning suites cited per step below)

## Automated Coverage Verified on `5210d969`

- `docs/evidence/m9/m9-flow.test.ts` directly exercises 2 J9 pure-contract checks: ARCH-10 residency gate refusal/open (`PR-36`) and synthetic Numa-shaped opening-data dry-run reconciliation (`PR-85`).
- Individual J9 steps are covered by their owning integration suites on `5210d969`:
  - `J9-1` / `J9-2`: `tests/vendor/tenants.test.ts`, `tests/vendor/onboarding.test.ts`, `tests/vendor/checklist.test.ts`
  - `J9-3`: `tests/import/parser.test.ts`, `tests/import/import.test.ts`, `docs/evidence/m9/m9-flow.test.ts`
  - `J9-4`: `tests/messaging/waba.test.ts`
  - `J9-5` / `J9-7`: `tests/vendor/checklist.test.ts`
  - `J9-6`: `tests/platform/residency.test.ts`, `docs/evidence/m9/m9-flow.test.ts`
  - `J9-8`: `tests/vendor/billing/billing.test.ts`
  - `J9-9`: `tests/vendor/tree.spec.ts`, `tests/vendor/console-readers.test.ts`

## Manual Owner Staging Walkthrough Checklist (Pending Staging Provisioning — `DEC-034`)

Run on synthetic staging over real HTTPS with normal TOTP enrolment before signing off:

| Step | Action | Expected | Sign-off |
|---|---|---|---|
| J9-1 | Platform owner creates synthetic tenant + dual-approved first owner invitation | Invitation link issued once; owner accepts and enrols TOTP | BLANK |
| J9-2 | Processor agreement uploaded and approved; onboarding grant opened | Onboarding workspace active; support isolation holds | BLANK |
| J9-3 | Owner runs `/pasien/impor` dry-run, approves batch, executor applies & reconciles | Sub-ledgers match `OpeningImportApplied` GL; rollback/re-import works | BLANK |
| J9-4 | Third WABA number waits for Meta business verification (alternate path) | Number blocked cleanly without live Meta call | BLANK |
| J9-5 | Checklist item left open -> go-live attempted | Refused naming exact open blocker | BLANK |
| J9-6 | Real-patient gate tested with missing residency/DPIA/DPO evidence | Patient creation & import refused (`ERR_FORBIDDEN`) | BLANK |
| J9-7 | All blockers cleared -> platform owner confirms go-live | Tenant transitions to `live`; `go_live_at` recorded | BLANK |
| J9-8 | Server-fee billing starts from `go_live_at` | Prorated invoice visible at `/saya/tagihan-server` | BLANK |
| J9-9 | Platform owner opens all 11 `/vendor/*` sidebar pages | All 11 pages render cleanly; audit export & template forms work | BLANK |

**Owner Sign-off:** BLANK (not claimed before staging execution).
