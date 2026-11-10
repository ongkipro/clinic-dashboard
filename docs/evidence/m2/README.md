# M2 exit evidence (T-059)

Task T-059 (PR-13, R3). Base `0816baa` (main after T-056). Ledger run `RUN-20261110T202232Z-ee27b658`. Plan review Argon r1 `556ef61c` (REVISE, adopted), r2 `cda0f2ff` (APPROVE).

Exit check (PLAN.md §1, M2 row): scenarios PR-9–PR-11, PR-13 (sign, version, correction window), PR-43 visit-note flag, PR-45, PR-73, PR-74 and CLIN-001–005, 012, 014–016, 021–023, 026 pass. Done when (TASKS.md T-059): `pnpm test -- m2` passes including those CLIN ids; an independent R3 review is recorded.

## What the command is

`pnpm test -- m2` is not a filter (as `m0` in T-032 and `m1` in T-049): vitest receives `m2` after `--` and runs every file, so it is the whole suite on a real PostgreSQL. The JUnit form puts the reporter flags before `--`: `pnpm test --reporter=default --reporter=junit --outputFile.junit=<run>/junit.xml -- m2` (flags after `--` write no report; T-049). The M2 scenarios and CLIN items are tied to exact test cases by `scenarios.json`, checked against that report by `check-scenarios.py`.

## The M2 flow on a real database (`m2-flow.test.ts`)

One patient through every M2 module through the real writers only (no trigger disabled; the documented stand-ins are the visit row of the M1 check-in writer and the step-up proof the clinical signing UI will produce, T-053): the doctor's STR and branch SIP recorded and verified (T-050); the BC's intake with an allergy, a caution for the clinicians (T-051); the sheet with the BC fact verified, SOAP and ICD-10, a face-map mark with a dose, two parallel plans, the BC/FO projection without condition or dose, a contraindication cleared (T-052, T-054); a photo behind the issuer's short-lived link (T-055); signing as version 1 (T-053); consent per plan and the start gate per plan (T-054); a nurse's addition approved by the doctor — the plan grows, the consent is outdated, the visit's consent step reopens, the gate blocks, FO is alerted — then re-consent and the gate passes (T-056); a visit-note complaint by FO, taken and resolved with a free control, FO seeing the status only (T-057); a letter template, a signed surat keterangan with the doctor's SIP, corrected as version 2 (T-058); a record correction as version 2 and the patient copy as a PDF (T-053); events, audit reasons and notifications content-free.

## Local run

| Command | Result | Evidence |
|---|---|---|
| `pnpm test -- m2` (with a JUnit report) | 1520 passed, 0 failed, 29 skipped (1549); 89 files passed, 28 skipped (117) | `/data/tmp/clinic-dashboard/t059/run-1794342551/` (the ledger's own run in the close run directory, see `docs/tasks/T-059.md`) |
| `check-scenarios.py <junit.xml>` | 13 scenarios (12 required), 14 CLIN ids (13 required), 17 items, 51 mapped cases, all passed; 2 deferred | same |
| `check-ci.sh 0816baa 42891496954` | the integrated M2 base passed in CI: 1520 passed, 28 skipped; the restore drill passed; the twelve M2 test and drift files and the cross-cutting suites ran; no problem | `ci-receipt.json` |

Per suite (passed / failed / skipped):

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| `docs/evidence/m1` | 1 | 0 | 0 |
| `docs/evidence/m2` | 1 | 0 | 0 |
| `tests/approvals` | 26 | 0 | 0 |
| `tests/audit` | 23 | 0 | 0 |
| `tests/auth` | 68 | 0 | 0 |
| `tests/catalog` | 44 | 0 | 0 |
| `tests/clinical` | 70 | 0 | 0 |
| `tests/compliance` | 16 | 0 | 0 |
| `tests/context` | 87 | 0 | 0 |
| `tests/db` | 69 | 0 | 0 |
| `tests/documents` | 9 | 0 | 0 |
| `tests/events` | 17 | 0 | 0 |
| `tests/idempotency` | 17 | 0 | 0 |
| `tests/isolation` | 106 | 0 | 1 |
| `tests/notifications` | 13 | 0 | 0 |
| `tests/org` | 105 | 0 | 0 |
| `tests/patients` | 60 | 0 | 0 |
| `tests/platform` | 44 | 0 | 1 |
| `tests/privacy` | 10 | 0 | 0 |
| `tests/rls` | 276 | 0 | 0 |
| `tests/scheduling` | 56 | 0 | 0 |
| `tests/settings` | 29 | 0 | 0 |
| `tests/ui` | 157 | 0 | 27 |
| `tests/vendor` | 193 | 0 | 0 |
| `tests/visits` | 23 | 0 | 0 |

Skipped (29): the browser specs run on request with `RUN_UI=1` (each task recorded its browser evidence, below), the isolation placeholder that only runs while no case exists, and the pgBackRest restore drill (`RUN_BACKUP_DRILL=1`, run in CI):

- `tests/isolation/isolation.test.ts — cross-tenant negative cases > no cases yet: foundation has no tenant surface`
- `tests/platform/backup.test.ts — pgBackRest restore drill > restores a seeded database to a scratch instance with matching row counts`
- `tests/ui/akses-vendor.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/audit.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/cabang.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/context.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/gallery.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/harga-cabang.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/jadwal-staf.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/jadwal.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/katalog.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/keluhan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/kepatuhan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/layanan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/owner-grant.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pasien-baru.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pasien-list.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pemeriksaan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pendampingan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/pengaturan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/permintaan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/persetujuan-tindakan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/persetujuan.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/staf-kredensial.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/staf.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/templat.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/tenant-provisioning.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/vendor-team.spec.ts — browser evidence (RUN_UI=1)`
- `tests/ui/vendor.spec.ts — browser evidence (RUN_UI=1)`

## Browser evidence (per task; no UI command in T-059's Done-when)

| Task | Spec | Flows / layouts (390/820/1180/1440 and 200 %) | Evidence |
|---|---|---|---|
| T-050 Kredensial | `tests/ui/staf-kredensial.spec.ts` | 20 / 16 | `/data/tmp/clinic-dashboard/t050-ui/out-1794246326/` |
| T-051 Pendampingan | `tests/ui/pendampingan.spec.ts` | 12 / 16 | `/data/tmp/clinic-dashboard/t051-ui/out-1794264558/` |
| T-052 Lembar Pemeriksaan | `tests/ui/pemeriksaan.spec.ts` | 12 / 16 | `/data/tmp/clinic-dashboard/t052-ui/out-1794288632/` |
| T-054 Persetujuan Tindakan | `tests/ui/persetujuan-tindakan.spec.ts` | 13 / 16 | `/data/tmp/clinic-dashboard/t054-ui/out-1794315859/` |
| T-056 Permintaan Klinis | `tests/ui/permintaan.spec.ts` | 10 / 24 | `/data/tmp/clinic-dashboard/t056-ui/out-1794340235/` |
| T-057 Keluhan | `tests/ui/keluhan.spec.ts` | 14 / 32 | `/data/tmp/clinic-dashboard/t057-ui/out-1794328916/` |
| T-058 Templat Dokumen and Surat | `tests/ui/templat.spec.ts` | 13 / 56 | `/data/tmp/clinic-dashboard/t058-ui/out-1794335231/` |

T-053 (signing and records) and T-055 (private clinical media) have Visual Contract: not applicable; their UI (the "Tanda Tangani" prompt with the TOTP step-up, the photo upload and viewer) is open below.

## Scenario map (`scenarios.json`, checked by `check-scenarios.py <junit.xml>`)

| Scenario (PRD §8) | File (cases) | Proves | Open |
|---|---|---|---|
| PR-9 no scores from BC | `tests/clinical/intake.test.ts` (2) | a BC submission with a score, grade or Fitzpatrick field is rejected, audited once, and writes nothing (T-051) | UX-7 steps 3–4 (Diskusi Pilihan, Konfirmasi) in M3/M4; per-visit BC assignment with the room (T-064) |
| PR-9 BC cannot diagnose | `tests/clinical/intake.test.ts` (1) | a BC's diagnosis and signing fields are refused as audited values and the BC has no table write; the intake stays BC-captured and unverified (T-051) | per-visit BC assignment (T-064); UX-7 photo panel wiring to clinical_media |
| PR-9 BC cannot diagnose | `tests/clinical/exam.test.ts` (1) | the examination writers refuse a BC (and every non-doctor) before any lookup (T-052) | as above |
| PR-9 BC cannot diagnose | `tests/clinical/records.test.ts` (1) | only the examining doctor acting as Dokter signs; a BC never signs (T-053) | as above |
| PR-10 history on one screen | `tests/clinical/exam.test.ts` (2) | one exam_sheet read holds two earlier visits, the intake to verify, active plans and the photos state (T-052; the photos field was a placeholder then); the BC/FO projection carries items and prices only | wiring the UX-8 Foto & Bandingkan panel to clinical_media (UI follow-up of T-052/T-055); closed ICD-10 code system (T-102); prescriptions (T-063); Kirim ke Kasir (T-072) |
| PR-10 history on one screen | `tests/clinical/media.test.ts` (1) | the patient's photos across visits list and compare, also across a merged duplicate (T-055) | as above |
| PR-11 consent mismatch | `tests/clinical/consent.test.ts` (1) | consent for 20 units; the plan raised to 25 → the start gate blocks until a new consent is recorded (T-054) | the treatment-start writer in the room calling assertCanStart (T-064, PR-14) |
| PR-11 consent mismatch | `tests/clinical/requests.test.ts` (1) | a plan raised after signing through an approved request makes the consent outdated and the gate blocks until re-consent (T-056) | as above |
| PR-13 correction window | `tests/clinical/records.test.ts` (6) | sign (version 1, the row final, second factor and step-up), version (a correction within 48 h is version 2 with the net delta), the correction window (50 h → records officer or facility head approval, the prior version readable; 47:59 direct, 48:01 approval), retention 25 years (T-053) | the TOTP step-up producer and the signing prompt on /pemeriksaan (deferred from T-053 by SEC-21); disposal after retention (PRIV-3) |
| PR-32 private photo | `tests/clinical/media.test.ts` (2) | bytes only through a short-lived token (≤ 10 min) of its issuer; an expired or foreign link is refused (T-055) | upload/viewer UI and the serving route (no-store); the S3 MediaStore when provisioned (ARCH-9; DB store per DEC-027); photo publication with consent per purpose (T-123, PR-40) |
| PR-43 complaint escalation | `tests/clinical/complaints.test.ts` (2) | M2 builds the visit-note and staff flag (PLAN M2 'PR-43 visit-note flag'): a Klinis task with the SET-31 due time for the clinical pool; flaggers FO, central CS (named branch), BC see the status only; a free control recorded as the outcome; the message source is refused (message_source_not_ready) (T-057) | the PRD scenario's WhatsApp message flag by CS (T-090, M6 inbox); the free-control billing waiver (M4 cashier) |
| PR-45 clinician approves addition | `tests/clinical/requests.test.ts` (2) | a nurse's addition approved by the doctor: the plan gets the item, the consent is outdated, the visit's consent step reopens, the start gate blocks, FO is alerted; plan change, substitution and decline (T-056) | the 'Usul Tindakan Tambahan' entry from the room (UX-9, T-064) and the exam sheet; payment of the addition and release before payment (T-074, PR-15) |
| PR-49 record copy | `tests/clinical/records.test.ts` (1) | FO requests a copy: logged content-free, a PDF of the signed records across the merge cluster, drafts left out (T-053) | delivery to the patient; signed letters in the copy; the profile money tabs (T-075, T-076, T-078) |
| PR-3 acting role for multi-role staff | `tests/clinical/records.test.ts` (1) | an owner who also holds Dokter switches to Dokter and signs; the signature and audit say Dokter (T-053) | none |
| PR-73 credential alert | `tests/org/credentials.test.ts` (4) | a SIP expiring in 30 days: the daily job alerts the doctor and the facility head once; thresholds 60/30/7; lifetime STR; an invalid credential stays blocked (T-050) | rendering the alerts in Ringkasan Klinis › Perlu Ditangani (UX-60, T-115) and Saya › Notifikasi; the daily scheduler calling runCredentialAlerts |
| PR-74 signed letter | `tests/documents/documents.test.ts` (3) | a surat keterangan from a template, signed with the step-up proof, stored with the record, never edited, corrected only by a new version (within 48 h by the author, later through the record-correction approval); templates versioned and frozen once used (T-058) | the TOTP step-up producer and the signing prompt on /templat/surat; 'Buat Surat' links from UX-8 / UX-29; receipt (T-072) and legal-page (T-123) consumers of the template store; letters in the patient copy |
| PR-84 branch switch | `tests/clinical/exam.test.ts` (1) | completes M1's deferral 'the doctor's Antrean (UX-8): T-052': the doctor's queue and sheet follow the active branch; a removed branch role loses the read (T-052) | none |

| CLIN item (PRD §8.1) | File (cases) | Proves |
|---|---|---|
| CLIN-001 Repeat visit: prior intake as history, only changes are new facts | `tests/clinical/intake.test.ts` (1) | unchanged answers add no fact, changed ones do (linked to the prior), history across a merged duplicate (T-051) |
| CLIN-002 Unverified allergy flag reaches doctor, nurse, pharmacist as caution | `tests/clinical/intake.test.ts` (1) | the caution reaches the clinical roles only, kind, value, provenance; survives an unchanged repeat visit (T-051) |
| CLIN-003 BC cannot diagnose or sign | `tests/clinical/intake.test.ts` (1) | as PR-9 BC cannot diagnose (T-051) |
| CLIN-004 Doctor confirms BC facts; BC authorship kept | `tests/clinical/exam.test.ts` (2) | confirm and correct are separate rows; the BC fact row never changes (T-052) |
| CLIN-005 Missing credential blocks start | `tests/clinical/consent.test.ts` (1) | no or an expired credential blocks start; eligibility and supervision (T-054) |
| CLIN-012 Two parallel care plans stay separate | `tests/clinical/exam.test.ts` (1) | two active plans for two conditions, items per plan and stage, live prices (T-052) |
| CLIN-014 New assessment adds a timepoint; old record unchanged | `tests/clinical/records.test.ts` (1) | a later visit's examination is its own record; the earlier signed record stays (T-053) |
| CLIN-015 Non-comparable photos warn, no score | `tests/clinical/media.test.ts` (1) | comparable only with the same angle and aspect a day apart, otherwise reasons; never a score (T-055) |
| CLIN-016 Worse symptoms create a clinical task | `tests/clinical/complaints.test.ts` (1) | worse symptoms → a Klinis task due by SET-31 (T-057) |
| CLIN-021 Non-clinical roles cannot read diagnosis or photos | `tests/clinical/media.test.ts` (1) | photos: clinical readers only; non-clinical roles forbidden; tables unreadable (T-055) |
| CLIN-021 Non-clinical roles cannot read diagnosis or photos | `tests/clinical/exam.test.ts` (2) | diagnosis: the examination is read by doctor, facility head, records officer only; the BC/FO projection carries no condition or dose (T-052) |
| CLIN-022 Added item or higher dose needs re-consent | `tests/clinical/consent.test.ts` (1) | an added item, higher quantity or dose, other version or unit needs re-consent; equal or lower stays valid (T-054) |
| CLIN-023 Amendment: new version and net delta only | `tests/clinical/records.test.ts` (1) | a correction is version n+1 holding the net delta only; a no-op is refused (T-053) |
| CLIN-024 Pharmacist adverse-effect flag escalates clinically | `tests/clinical/complaints.test.ts` (1) | the pharmacist source is a pharmacist's Klinis flag (T-057) |
| CLIN-026 Lost assignment removes access | `tests/clinical/media.test.ts` (1) | removing the branch role empties the photo list and refuses an issued token at once (T-055); M2 enforces the branch-role assignment on the wall clock, per-visit assignment arrives with the room (T-064) |
| CLIN-026 Lost assignment removes access | `tests/clinical/exam.test.ts` (1) | the examination reader loses the read when the branch role is removed (T-052) |
| M2 flow: one patient through every M2 module | `docs/evidence/m2/m2-flow.test.ts` (1) | credential, intake and caution, sheet with verification, mark and two plans, projection, contraindication clearing, a photo behind a token, signing, consent and the gate, an approved addition reopening consent and alerting FO, re-consent, a visit-note complaint, a signed letter and its correction, a record correction and the patient copy; events, audit and notifications content-free (T-059) |

Deferred (named in `scenarios.json`): **PR-43 complaint escalation** — the PRD scenario is a WhatsApp message flagged by CS; M2 built the visit-note and staff flag and refuses the message source; the message flag completes in T-090 (M6 inbox), the free-control billing waiver in the M4 cashier. **PR-45 clinician approves addition** — payment of the addition and release before payment in T-074 (M4); the entry from the treatment room in T-064 (M3).

## Integration and CI

The M2 tasks are on main in this order (DEC-063, one builder): T-050 `9b2820c`, T-051 `833b84d`, T-052 `0d30df1`, T-053 `6dc5dab`, T-055 `c9dddda`, T-054 `7fb71cb`, T-057 `e06549c`, T-058 `7873dcc`, T-056 `0816baa`, each after its ledger PASS, independent review and green CI (STATUS.md table). `ci-receipt.json` is the receipt of CI run 42891496954 on `0816baa` (the integrated M2 content); T-059's own commit adds evidence only and its CI run (which also runs `m2-flow.test.ts`) is recorded in STATUS.md after the push.

## Open items carried (not hidden)

- Two unexplained intermittents from T-057: `tests/clinical/media.test.ts:213` (T-055's 600 s token issue reported as replayed, once in T-057 close run 1; passes alone) and one full-suite failure in T-057 close run 4 (only the tail was recorded; passed on rerun). Neither recurred in this run.
- The raw `pg.Pool` without an error listener in some test files (an unhandled `57P01` in CI 42753612376 attempt 1, T-051): a hygiene task, not yet scheduled.
- The TOTP step-up producer and the signing prompts (examination and letters), the photo upload/viewer UI and serving route, and the entries from the room (T-064) and the exam sheet: listed per scenario above.
