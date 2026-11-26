# M9 Exit & Release-Readiness Evidence Pack (T-131, PR-59, R4)

- **Task:** `T-131` (`PR-59`, R4). Allowed paths: `docs/evidence/m9/**`, `STATUS.md`, `RELEASE.md` (`RELEASE.md` intentionally preserved at `Status: DRAFT` — nothing deployed).
- **Base Commit:** `5210d969` (all 130 prior tasks `T-001`–`T-130` + consolidated 12-row `DEC-117` hardening `0143_dec117_hardening.sql` integrated on `origin/main`).
- **Scope Boundary (`DEC-034`):** No staging/production provisioning, no Vultr/Coolify/Cloudflare deployment, no live provider calls (Meta, SATUSEHAT, AutoLaris, Turnstile), synthetic data only (`MIG-2`). Every deploy-gated probe or manual owner staging walkthrough remains explicitly `PENDING EXECUTION` with zero fabricated claims.

## Summary of Executed Evidence vs Pre-Staging Gates

| Category | Count | Status | Evidence |
|---|---:|---|---|
| **M9 PRD §8 Scenarios (`PR-36`, `PR-39`, `PR-50`, `PR-52`, `PR-59`, `PR-64`–`PR-67`, `PR-85`, `PR-86`, `PR-87`)** | **15 / 15** | **15 mapped / 0 deferred (38/38 JUnit cases passed in scaffold check)** | `docs/evidence/m9/scenarios.json` + executed 85-file JUnit run (`1,008` tests, `0` failed, `6` accounted skips) checked via `check-scenarios.py --scaffold` (non-scaffold M9 exit remains open until staging execution of the 6 `PENDING EXECUTION` items below) |
| **M9 Exit Checklist Items (Code/Local/CI Executable)** | **6 / 8** | **PASSED** | `restore-drill.md`, `browser-sweep.md`, `security-review.md`, `residency.test.ts`, `parser.test.ts`, `m9-flow.test.ts` |
| **M9 Exit Checklist Items (Manual Owner Staging Walkthroughs J9 & J11)** | **2 / 8** | **PENDING EXECUTION (`DEC-034`)** | `walkthrough-j9.md`, `walkthrough-j11.md` (automated contracts pass; owner sign-off BLANK) |
| **NFR Probes Executable Pre-Staging (`NFR-3`, `NFR-5`, `NFR-6`, `NFR-8`)** | **4 / 8** | **PASSED** | `docs/evidence/m9/nfr/NFR-{3,5,6,8}.json` via `nfr-probes.mjs` |
| **NFR Probes Deploy/Staging-Gated (`NFR-1`, `NFR-2`, `NFR-4` full axe, `NFR-7` rehearsal)** | **4 / 8** | **PENDING EXECUTION (`DEC-034`)** | No fabricated JSON files; `nfr-probes.mjs` exits 3 (`PENDING EXECUTION`) |

## M9 Task & Hardening Traceability on `origin/main` (Exact SHA → CI Run)

| Task | Migration | Exact Commit SHA | Exact-SHA CI Run | Review |
|---|---|---|---|---|
| `T-120` (PR-36 ARCH-10 gate) | `0133_real_patient_gate.sql` | `088e5a92` | `45411724713` GREEN | R4 two-family APPROVE |
| `T-121` (PR-50 DSR) | `0134_data_subject_requests.sql` | `61640f57` | `45438328455` GREEN | R3 r4 APPROVE |
| `T-122` (PR-52 Tenant export) | `0135_tenant_export.sql` | `0770321c` | `45550687412` GREEN | R3 APPROVE |
| `T-123` + `HYG-CI-OTOMASI-LINK` (PR-64 Public site) | `0136_public_site.sql` | `c53a486c` → `98c2f5ca` | `45582352233` RED (lint) → `45584531793` GREEN (`98c2f5ca`) | R3 r2 APPROVE |
| `T-124` (PR-65 Public rules) | none | `80972557` | `45625283311` GREEN | R2 PASS |
| `T-126` (PR-67 Public booking) | `0137_public_booking.sql` | `1201c189` | `45638940440` GREEN | R3 r5 APPROVE |
| `T-125` (PR-66 Doctor consent) | `0138_public_doctors.sql` | `c66cd23f` | `45671997627` GREEN | R3 r5 APPROVE |
| `T-127` (PR-39 Pixel policy) | `0139_public_pixel_revision.sql` | `ad699ab2` | `45677037102` GREEN | R3 APPROVE |
| `HYG-LOC-1` (NFR-8 BC labels) | none | `ac94d88c` | `45679194771` GREEN | R1 PASS |
| `T-129` Vendor UI tree | none | `90c57212` | `45681460586` GREEN | R3 APPROVE |
| `HYG-NAV-3` (Orphan pages) | none | `c483407a` → `e8a6fc74` | `45684892386` RED (lint) → `45687605351` GREEN (`e8a6fc74`) | R3 r4 APPROVE |
| `T-128` Slice 1 dry-run + flake fix | none | `865b666e` → `2391aaf1` | `45690532009` RED (flake) → `45693785796` GREEN (`2391aaf1`) | R3 r2 APPROVE |
| `T-129` + `HYG-024` (PR-87 Vendor console) | `0140_vendor_console_readers.sql` | `5cfa0f52` | `45699093816` GREEN | R3 r6 APPROVE |
| `T-130` (PR-86 16-role nav sweep) | none | `1315574a` | `45704660494` GREEN | R2 PASS (924/924 Chromium) |
| `T-128` Apply & Reversal + `0142` hotfix (PR-85) | `0141` + `0142` | `09745b52` → `0670e6fa` | `45719923702` RED (trigger) → `45722603866` GREEN (`0670e6fa`) | R3 r10 APPROVE (Row 11 closed) |
| `DEC-117` (12-row hardening) | `0143_dec117_hardening.sql` | `5210d969` | `45725293168` GREEN | `cx/gpt-6.2-sol` r5 APPROVE |

## Explicit Open Operational / Staging Gates (Not Claimed Done)

1. **Staging provisioning & live probes (`DEC-034`):** `NFR-1` (availability), `NFR-2` (p95 load), `NFR-4` (full-site axe + 200% zoom), `NFR-7` (Indonesia-provider migration rehearsal), and Cloudflare `APP_HOST` DNS-only verification.
2. **Manual Owner Staging Walkthroughs:** Phase 1 `J1–J8/J10` (`M8-AMEND-4-WALKTHROUGH-STAGING`) and M9 `J9`/`J11` (`walkthrough-j9.md`, `walkthrough-j11.md`) — owner sign-offs stay BLANK until staging execution.
3. **External Sandbox & Live Activation Gates:** `T-102 TD-31/TD-34` SATUSEHAT sandbox fixtures, `G-ACT`/`A-02` accountant-signed posting map, `T-103` live AutoLaris payment gates, `T-122` scheduled export worker/purge cron, `T-126` periodic booking purge cron & live OTP sender, and `RELEASE.md` `production-gate` approval.
