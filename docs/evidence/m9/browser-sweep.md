# M9 Browser Sweep Evidence (T-130 / T-129 / T-123–T-127)

Result: PASS

- **Scope:** Real Playwright Chromium verification of all 16 clinic staff roles (`19 §2` × `07`), all 11 vendor console pages (`19 §3`), and all public site / booking / consent pages (`19 §4`).
- **Build & Commit References:**
  - **T-130 16-Role Clinic Navigation Sweep (`1315574a`, CI `45704660494` green, report `~/Documents/work/notes/clinic-dashboard/t130/report-5cfa0f52.json`):**
    - Structural matrix checks (`tests/ui/nav-sweep.spec.ts`): **46/46 PASS** (`19 §2` ↔ `src/components/shell/nav.ts` ↔ `07` capability matrix; zero foreign pages; mobile tab bar `<= 5` items per role; `/pasien/impor` mounted in `T-128` `09745b52` and removed from `ORPHANS`).
    - Real Chromium browser sweep (`RUN_UI_SWEEP=1` against standalone production build on fresh seeded PostgreSQL across **16/16 roles** at `390px` and `1440px`): **924/924 checks PASS**, `0` foreign menu links, `0` foreign page leaks, `0` missing states (`missingStates: []`).
  - **T-129 Vendor Console UI Sweep (`5cfa0f52`, CI `45699093816` green, `tests/vendor/console-ui.spec.ts`):**
    - Real Chromium verification across **`390 / 820 / 1180 / 1440` px** viewports: **20/20 checks PASS** (all 11 vendor sidebar pages, interactive `AuditExportForm` and `TemplateSaveForm`, zero horizontal overflow, zero inline styles).
  - **T-123 / T-124 / T-125 / T-126 / T-127 Public Site & Booking Sweeps (`c53a486c`..`ad699ab2`):**
    - All 11 Release 1 public pages verified in `tests/public/tree.spec.ts`, `tests/ui/public-booking.spec.ts`, and `tests/ui/public-pixels.spec.ts` (zero pixel/replay leakage on health-intent and booking pages).
- **Pre-Staging Scope Boundary (`DEC-034`):**
  - Full-site automated axe-core (`axe_violations === 0`) and 200% zoom pass across every rendered route on the live HTTPS staging host remains explicitly tracked under **`NFR-4` (`PENDING EXECUTION`)** until staging is provisioned (`DEC-034`). No unmeasured `axe_violations: 0` JSON record is claimed here.
