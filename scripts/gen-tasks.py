#!/usr/bin/env python3
"""Generate TASKS.md for the Clinic Dashboard kit from a curated task list.

Each entry: (milestone, primary, title, risk, allowed_paths, depends(list of local keys), done_when, extra)
Keys are local labels; IDs T-001.. are assigned in order.
"""
import json, re, datetime

pr = json.load(open('scripts/gen-tasks-prrows.json'))

R3 = "R3"; R2 = "R2"; R1 = "R1"; R4 = "R4"

# (key, milestone, primary, title, risk, paths, deps, done_when, protected, visual)
T = []
def t(key, ms, primary, title, risk, paths, deps, done, protected=None, visual=None, owners=None, nonscope=None):
    T.append(dict(key=key, ms=ms, primary=primary, title=title, risk=risk, paths=paths, deps=deps,
                  done=done, protected=protected, visual=visual, owners=owners, nonscope=nonscope))

UI = "Visual contract per `docs/spec/17` {ux} and `19` row; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (10 State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7."

# ---------------- M0 Foundation ----------------
M="M0"
t("repo",M,"PR-1","Repository bootstrap: Next.js App Router, TypeScript strict, pnpm, Docker Compose PostgreSQL 16, CI skeleton, `pnpm docs:check`",R2,
  ["package.json","pnpm-lock.yaml","next.config.ts","tsconfig.json","compose.yaml","Dockerfile",".github/workflows/ci.yml","scripts/check-traceability.py","docs/spec/**"],[],
  "`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm build && pnpm docs:check` all exit 0 in CI and locally; versions pinned per `15` §2 are recorded in DECISIONS.md")
t("dbcore",M,"PR-1","Database core: Drizzle setup, migration runner, `tenants`, `tenants_registry`, `branches` with composite keys `(tenant_id,id)`",R3,
  ["src/db/**","drizzle/**","drizzle.config.ts"],["repo"],
  "Fresh database migrates with `pnpm db:migrate`; a migration test asserts `UNIQUE(tenant_id,id)` on every tenant table and `ON DELETE RESTRICT` on business FKs (05 §3.1)",protected=["drizzle/**"])
t("rls",M,"PR-1","RLS harness: non-owner app role without BYPASSRLS, per-transaction tenant context (TEN-2), scope map table and TEN-3/TEN-19 test",R4,
  ["src/db/rls/**","src/db/scope-map.ts","tests/rls/**","drizzle/**"],["dbcore"],
  "`pnpm test:rls` passes: startup refuses a BYPASSRLS role; a table missing from `scope_map` or classified twice fails the test; scenario PR-1 (tenant A reading tenant B → not found + audit) passes",protected=["drizzle/**","src/db/rls/**"])
t("isolation_ci",M,"PR-1","Isolation CI gates: cross-tenant negative test generator per route/job/export, tenant-literal lint rule, build digest record (DEL-2)",R3,
  ["tests/isolation/**","eslint.config.mjs",".github/workflows/ci.yml","scripts/record-digest.mjs"],["rls"],
  "`pnpm test:isolation` fails when a route has no negative test (demonstrated with a deliberately untested fixture route, then removed); lint fails on a hard-coded tenant slug in `src/`")
t("auth",M,"PR-3","Staff authentication: Better Auth email+password, TOTP for roles in IAM-1, throttling, front-desk idle lock 120 s",R4,
  ["src/auth/**","src/app/(auth)/**","tests/auth/**","drizzle/**"],["rls"],
  "Scenario PR-3 passes; tests prove TOTP required for owner/Admin Pusat/manager/doctor/finance/facility head/records officer/auditor/central CS, lockout after 5 failures/15 min (RATE-2), FO idle lock at 120 s",protected=["src/auth/**"])
t("membership",M,"PR-3","Identity chain: accounts → memberships → staff (1:1), staff_roles, staff_branches with composite FKs, acting role and branch scope per IAM-9 (DATA-55)",R4,
  ["src/modules/org/**","drizzle/**","tests/org/**"],["auth"],
  "Migration and tests prove `staff.membership_id NOT NULL UNIQUE`, staff cannot be assigned another tenant's branch, Level 2 roles see future branches (wildcard), acting role recorded on actions",protected=["drizzle/**"])
t("audit",M,"PR-51","Audit attribution and log: `audit_events` with DATA-60 fields set server-side, hash chain per tenant, daily write-once copy, Log Audit read API",R3,
  ["src/modules/audit/**","drizzle/**","tests/audit/**"],["membership"],
  "Scenario PR-51 passes; a test tampering with an audit row breaks the chain check; audit rows carry account, membership, staff, acting role, tenant, branch, vendor session; no clinical values stored")
t("idem",M,"PR-37","Idempotency records with request fingerprint and replay contract (DATA-45) as a shared command wrapper",R3,
  ["src/lib/command.ts","src/modules/idempotency/**","drizzle/**","tests/idempotency/**"],["audit"],
  "Tests: same key + same body returns stored result; same key + different body → ERR rejected (TD-51); concurrent duplicates execute once")
t("events",M,"PR-37","Domain events outbox, worker claim with SKIP LOCKED and per-row tenant binding, consumer receipts (DATA-59, TEN-5)",R3,
  ["src/modules/events/**","src/workers/outbox.ts","drizzle/**","tests/events/**"],["idem"],
  "Tests: event written in the same transaction as its fact (rollback leaves none); two workers never process one event; a consumer applies an event once (`event_receipts`)")
t("approvals",M,"PR-37","Approvals engine: requester ≠ approver, owner self-write-off whitelist, approval types registry",R3,
  ["src/modules/approvals/**","drizzle/**","tests/approvals/**"],["events"],
  "Scenario PR-37 passes; requester approving own request is refused with TD-51 code; owner write-off without reason refused")
# ---------------- M0.5 Design system ----------------
M="M0"
t("tokens",M,"PR-86","Design tokens and base components from DESIGN.md (shadcn restyled, Drawer sheets), state copy patterns",R1,
  ["src/styles/**","src/components/ui/**","tests/ui/tokens.spec.ts"],["repo"],
  "Contrast test over all token pairs passes (UI-1); accent validation rejects a failing hex (UI-2); browser snapshot of the component gallery at 390/1440",visual=UI.format(ux="10 / DESIGN.md"))
t("shell",M,"PR-86","App shell: role-filtered sidebar and phone tab bar with Menu (search, pinned, recent), global search slot, quick actions, notifications, command palette",R2,
  ["src/components/shell/**","src/app/(app)/layout.tsx","tests/ui/shell.spec.ts"],["tokens","membership"],
  "Scenario PR-86 passes for pharmacist and owner; `pnpm test:ui` checks 390/820/1180/1440 and 200% text",visual=UI.format(ux="19 NAV-1–NAV-8"))
t("visittrack",M,"PR-86","VisitTrack component, list/detail page templates (NAV-4, NAV-5), report table→card pattern",R1,
  ["src/components/visit-track/**","src/components/templates/**","tests/ui/templates.spec.ts"],["shell"],
  "Browser check of templates with loading, empty, filtered-empty, error, blocked states; VisitTrack renders all 10 segments with word labels",visual=UI.format(ux="10 Component Contract"))

M="M0"
t("approvals_inbox",M,"PR-44","Persetujuan inbox API and screen (UX-26) with type filter and detail",R2,
  ["src/app/(app)/persetujuan/**","src/modules/approvals/inbox.ts","tests/approvals/inbox.test.ts"],["approvals","shell"],
  "Scenario PR-44 passes; browser check of UX-26 at 390/1440 with empty, list and blocked (own request) states",visual=UI.format(ux="UX-26"))
t("notif",M,"PR-54","In-app notifications with acknowledgement (generic engine; alert types added by later tasks)",R2,
  ["src/modules/notifications/**","drizzle/**","tests/notifications/**"],["events"],
  "Scenario PR-54 passes with a test alert type; acknowledgement records who and when")
t("settings",M,"PR-38","Settings registry SET-1–SET-49: typed values, bounds, scope, versions, drafts and approvals, Kembalikan ke default, snapshot helper",R3,
  ["src/modules/settings/**","drizzle/**","tests/settings/**"],["approvals"],
  "Scenarios PR-38 (out of bounds, restore default) pass; every SET row in `19` §5 exists with its default, bound and changer; fixed rules are absent from the registry")
t("vendor_profile",M,"PR-55","Vendor profile with placeholder marking and residency fields (DATA-47)",R2,
  ["src/modules/vendor/profile/**","drizzle/**","tests/vendor/profile.test.ts"],["audit"],
  "Scenario PR-55 passes; placeholder values render marked and block production go-live")
t("compliance",M,"PR-97","Compliance register: evidence items, file versions with checksum, approvals bound to file/config version, feature-gate evaluator (DATA-71)",R3,
  ["src/modules/compliance/**","drizzle/**","tests/compliance/**"],["vendor_profile","approvals"],
  "Scenarios PR-97 pass with a test gate; a new evidence file version reopens the gate; expiry closes it; vendor-level items invisible to tenants except status view")
t("vendor_roles",M,"PR-57","Vendor staff and roles with TOTP, IP allowlist, maker-checker for fee change, suspension, exit, waiver, clinical grant",R4,
  ["src/modules/vendor/staff/**","drizzle/**","tests/vendor/staff.test.ts"],["auth","approvals"],
  "Scenario PR-57 passes; dual vendor/clinic identity refused without both approvals; go-live refused with fewer than two vendor staff",protected=["src/modules/vendor/**"])
t("vendor_console_host",M,"PR-57","Vendor console on its own hostname with separate __Host- cookies, strict CSP, no clinic session accepted (SEC-21)",R3,
  ["src/app/vendor/**","src/proxy.ts","tests/vendor/host.test.ts"],["vendor_roles"],
  "Tests: clinic session cookie rejected on vendor host and vice versa; CSP header present; tenant strings escaped in vendor tables")
t("lifecycle",M,"PR-56","Tenant lifecycle states and suspension effects (TEN-12)",R3,
  ["src/modules/vendor/lifecycle/**","drizzle/**","tests/vendor/lifecycle.test.ts"],["vendor_roles"],
  "Scenarios PR-56 pass (suspension keeps records and care messages, blocks new bookings and marketing)")
t("tenant_create",M,"PR-1","Tenant provisioning: create brand + PT + first branch from vendor console; processor agreement gate before onboarding",R3,
  ["src/modules/vendor/tenants/**","src/app/vendor/tenant/**","tests/vendor/tenants.test.ts"],["lifecycle","compliance"],
  "Creating a tenant writes registry, tenant and branch rows; moving to onboarding is refused while the processor-agreement evidence is not approved")
t("onboarding_grant",M,"PR-58","Onboarding grant: configuration-only scope, draft invitations, owner-confirmed, never Level 2 roles, imports owner-started (TEN-13)",R4,
  ["src/modules/vendor/onboarding/**","drizzle/**","tests/vendor/onboarding.test.ts"],["tenant_create"],
  "Scenarios PR-58 pass (no clinical read; self-invite as Owner refused); grant expires at go-live or day 30",protected=["src/modules/vendor/**"])
t("support_sessions",M,"PR-53","Support sessions: scope by object kind, owner approval for clinical/specific personal data, TTL ≤ 2 h, read audit, operator RLS predicates (TEN-14, TEN-17)",R4,
  ["src/modules/vendor/support/**","src/db/rls/operator.sql","drizzle/**","tests/vendor/support.test.ts"],["onboarding_grant","rls"],
  "Scenario PR-53 passes; RLS tests for in-scope, out-of-scope and expired sessions pass",protected=["src/db/rls/**"])
t("support_scope",M,"PR-60","Support-session scope approval and read audit: owner approval for clinical/specific personal data, every read listed (TEN-14)",R4,
  ["src/modules/vendor/support/scope.ts","tests/vendor/support-scope.test.ts"],["support_sessions"],
  "Scenarios PR-60 (owner sees access, clinical scope without approval, expired grant) pass",protected=["src/modules/vendor/**"])
t("golive",M,"PR-59","Onboarding checklist per tenant/branch and go-live confirmation",R3,
  ["src/modules/vendor/checklist/**","src/app/vendor/onboarding/**","tests/vendor/checklist.test.ts"],["support_sessions"],
  "Scenario PR-59 passes: go-live refused naming a blocking item; go-live date recorded for server-fee billing",visual=UI.format(ux="UX-41"))
t("akses_vendor",M,"PR-60","Owner view Saya › Akses Vendor (UX-48): grants, sessions, reads, infrastructure access, dual identities; end session; approve clinical scope",R3,
  ["src/app/(app)/saya/akses-vendor/**","tests/ui/akses-vendor.spec.ts"],["support_sessions","shell"],
  "Browser check: owner sees a seeded session with reads and can end it; approval request appears for a clinical-scope session",visual=UI.format(ux="UX-48"))
t("roles_new",M,"PR-63","Admin Pusat, Marketing, Purchasing, Internal auditor roles with role-aware RLS readers (TEN-18) and owner-only guard",R4,
  ["src/modules/org/roles/**","src/db/rls/readers.sql","tests/rls/readers.test.ts"],["membership","rls"],
  "Scenario PR-63 passes; projection test per role × table generated from the 07 matrix passes",protected=["src/db/rls/**"])
t("switch",M,"PR-84","Ganti Cabang / Ganti Klinik / Ganti Peran with active context under the title",R3,
  ["src/modules/org/context/**","src/app/(app)/saya/**","tests/org/context.test.ts"],["roles_new","shell"],
  "Scenario PR-84 passes; actions record the active branch and brand",visual=UI.format(ux="17 Navigation"))
t("access_admin",M,"PR-91","Pengguna & Akses: read-only permission matrix, sessions with revoke (≤ 60 s), duty assignments, change log (DATA-65, IAM-16)",R3,
  ["src/modules/org/access/**","src/app/(app)/pengguna-akses/**","tests/org/access.test.ts"],["switch"],
  "Scenario PR-91 passes; revoking ends only that membership's sessions; an already open session loses access within 60 s",visual=UI.format(ux="UX-3 ▸ Akses"))
t("m0_exit",M,"PR-1","M0 exit review: run all M0 scenarios, RLS, isolation and auth suites; independent R4 review recorded",R4,
  ["docs/evidence/m0/**","STATUS.md"],["isolation_ci","access_admin","golive","akses_vendor","settings","approvals_inbox","notif"],
  "`pnpm test:rls && pnpm test:isolation && pnpm test -- m0` pass in CI; independent reviewer PASS recorded in `.delivery/`")

# ---------------- M1 ----------------
M="M1"
t("catalog",M,"PR-41","Catalog versions with clinical-review publishing gate",R3,
  ["src/modules/catalog/**","drizzle/**","tests/catalog/**"],["m0_exit"],
  "Scenario PR-41 passes; CLIN-011 (catalog change keeps old receipts) passes")
t("master_layanan",M,"PR-88","Master Layanan: durations, resources, staff eligibility, BHP recipe, consent and aftercare links, online-bookable (DATA-62) + UX-25 screen",R2,
  ["src/modules/catalog/service/**","src/app/(app)/layanan/**","drizzle/**","tests/catalog/service.test.ts"],["catalog","visittrack"],
  "Scenario PR-88 passes; bookings store the catalog version used",visual=UI.format(ux="UX-25"))
t("branch_price",M,"PR-42","Branch price overrides (owner only), effective-dated",R3,
  ["src/modules/catalog/prices/**","drizzle/**","tests/catalog/prices.test.ts"],["catalog"],
  "Scenario PR-42 passes; Admin Pusat cannot override")
t("branches",M,"PR-2","Branch master UX-2: hours, closures, rooms, devices, services, WhatsApp, map, publish window, licence fields (SET-46)",R2,
  ["src/modules/org/branches/**","src/app/(app)/pengaturan/cabang/**","tests/org/branches.test.ts"],["m0_exit","visittrack"],
  "Scenario PR-2 passes; browser check UX-2",visual=UI.format(ux="UX-2"))
t("patients",M,"PR-5","Patient registration with identity types, guardian, duplicate decision, encrypted NIK + blind index (UX-4)",R3,
  ["src/modules/patients/**","src/app/(app)/pasien/baru/**","drizzle/**","tests/patients/**"],["m0_exit","visittrack"],
  "Scenario PR-5 passes; NIK never stored in clear; one phone for two patients does not expose either",visual=UI.format(ux="UX-4"))
t("consents",M,"PR-4","Consent ledger with immutable consent-text versions and withdrawal",R3,
  ["src/modules/patients/consents/**","drizzle/**","tests/patients/consents.test.ts"],["patients"],
  "Scenario PR-4 passes; a consent text referenced by a consent cannot be edited")
t("privacy",M,"PR-92","Privacy workspace: consent texts, consent ledger view, processors, breach register with 72 h deadline and notices (UX-30 ▸ Privasi)",R3,
  ["src/modules/privacy/**","src/app/(app)/privasi/**","drizzle/**","tests/privacy/**"],["consents"],
  "Scenario PR-92 passes; breach state transitions audited",visual=UI.format(ux="UX-30"))
t("profile",M,"PR-49","Patient profile 360° with role projections and patient copy (UX-29)",R3,
  ["src/app/(app)/pasien/[id]/**","src/modules/patients/profile.ts","tests/patients/profile.test.ts"],["consents"],
  "Scenario PR-49 passes; cashier sees no clinical tabs; projection test per role",visual=UI.format(ux="UX-29"))
t("search",M,"PR-76","Global patient search under RLS: masked phone, rate limit, no query logging, abuse alert",R3,
  ["src/modules/patients/search/**","tests/patients/search.test.ts"],["profile"],
  "Scenario PR-76 passes; query string absent from logs; rate limit enforced")
t("merge",M,"PR-85","Duplicate patient merge (records officer), audited and reversible",R3,
  ["src/modules/patients/merge/**","tests/patients/merge.test.ts"],["profile"],
  "Merge then unmerge restores both patients with all linked rows; audit shows actor and reason")
t("schedules",M,"PR-48","Staff schedules (shifts, leave) per branch (UX-33)",R2,
  ["src/modules/scheduling/rosters/**","src/app/(app)/jadwal-staf/**","tests/scheduling/rosters.test.ts"],["branches"],
  "Scenario PR-48 passes",visual=UI.format(ux="UX-33"))
t("booking",M,"PR-6","Booking engine: valid slots from service master, resources reserved together, channel and source, slot hold",R3,
  ["src/modules/scheduling/booking/**","drizzle/**","tests/scheduling/booking.test.ts"],["master_layanan","schedules"],
  "Scenario PR-6 passes; overlapping reservations refused by exclusion constraint; scenario PR-88 (no device → no slot) passes")
t("calendar",M,"PR-83","Jadwal UX-5: calendar views, appointment states, Ubah Jadwal, Batalkan, Tandai Tidak Datang (DP effects in M4)",R2,
  ["src/app/(app)/jadwal/**","src/modules/scheduling/appointments/**","tests/scheduling/appointments.test.ts"],["booking"],
  "Scenarios PR-83 no-show (without DP) and PR-84 pass; browser check UX-5 phone agenda and desktop week",visual=UI.format(ux="UX-5"))
t("lateness",M,"PR-8","Lateness release setting (SET-15)",R1,
  ["src/modules/scheduling/lateness.ts","tests/scheduling/lateness.test.ts"],["calendar"],
  "Scenario PR-8 passes")
t("checkin",M,"PR-7","Check-in, visit with independent states, Hari Ini board with VisitTrack and Belum dibayar section (UX-6)",R3,
  ["src/modules/visits/**","src/app/(app)/hari-ini/**","drizzle/**","tests/visits/**"],["calendar","profile"],
  "Scenario PR-7 passes; close blocked with named blocker",visual=UI.format(ux="UX-6"))
t("walkin",M,"PR-71","Walk-in registration and daily queue numbers; paired TV display without names",R2,
  ["src/modules/visits/queue/**","src/app/(app)/antrean/**","tests/visits/queue.test.ts"],["checkin"],
  "Scenario PR-71 passes; TV payload contains no patient name",visual=UI.format(ux="UX-6 ▸ Antrean"))
t("m1_exit",M,"PR-7","M1 exit: book → check-in → board on a real database; all M1 scenarios",R2,
  ["docs/evidence/m1/**","STATUS.md"],["walkin","lateness","merge","search","privacy","branch_price"],
  "`pnpm test -- m1` and `pnpm test:ui -- m1` pass")

# ---------------- M2 Clinical ----------------
M="M2"
t("bc",M,"PR-9","BC Pendampingan flow (UX-7): intake, photos, Observasi Kulit, Kirim ke Dokter; no scores",R3,
  ["src/modules/clinical/intake/**","src/app/(app)/pendampingan/**","drizzle/**","tests/clinical/intake.test.ts"],["m1_exit"],
  "Scenario PR-9 and CLIN-001–003 pass",visual=UI.format(ux="UX-7"))
t("exam",M,"PR-10","Lembar Pemeriksaan (UX-8): verify intake, SOAP templates, face map with dose per point, staged plan, BC/FO projection",R3,
  ["src/modules/clinical/exam/**","src/app/(app)/pemeriksaan/**","drizzle/**","tests/clinical/exam.test.ts"],["bc"],
  "Scenario PR-10 and CLIN-004, CLIN-012 pass; BC projection shows items and prices only",visual=UI.format(ux="UX-8"))
t("signing",M,"PR-13","Signing, immutability, 2×24 h correction, late corrections via approval, patient copy, retention",R3,
  ["src/modules/clinical/records/**","drizzle/**","tests/clinical/records.test.ts"],["exam"],
  "Scenario PR-13 and CLIN-014, CLIN-023 pass")
t("consent_proc",M,"PR-11","Procedure consent (UX-39) and start gates: credentials, competence, contraindication, consent matches items and doses",R3,
  ["src/modules/clinical/consent/**","src/app/(app)/persetujuan-tindakan/**","tests/clinical/consent.test.ts"],["signing"],
  "Scenario PR-11 and CLIN-005, CLIN-022 pass",visual=UI.format(ux="UX-39"))
t("photos",M,"PR-32","Private clinical media with short-lived tokens; photo compare",R3,
  ["src/modules/clinical/media/**","tests/clinical/media.test.ts"],["exam"],
  "Scenario PR-32 and CLIN-015, CLIN-021, CLIN-026 pass; tokens expire ≤ 10 min")
t("requests",M,"PR-45","Permintaan Klinis (UX-27): additions, plan changes, substitutions decided by clinician",R3,
  ["src/modules/clinical/requests/**","src/app/(app)/permintaan/**","tests/clinical/requests.test.ts"],["consent_proc"],
  "Scenario PR-45 passes (payment effects integrate in M4)",visual=UI.format(ux="UX-27"))
t("complaints",M,"PR-43","Keluhan Klinis and Layanan tasks from visit notes and staff flags, SET-31 targets (UX-28)",R3,
  ["src/modules/clinical/complaints/**","src/app/(app)/keluhan/**","tests/clinical/complaints.test.ts"],["signing"],
  "Scenario PR-43 visit-note flag and CLIN-016 pass",visual=UI.format(ux="UX-28"))
t("letters",M,"PR-74","Document templates (UX-54) and signed medical letters",R3,
  ["src/modules/documents/**","src/app/(app)/templat/**","tests/documents/**"],["signing"],
  "Scenario PR-74 passes",visual=UI.format(ux="UX-54"))
t("cred_alerts",M,"PR-73","Credential model (STR lifetime, SIP per branch) and expiry alerts 60/30/7",R2,
  ["src/modules/org/licences/**","tests/org/credentials.test.ts"],["m1_exit"],
  "Scenario PR-73 passes; no alert for lifetime STR")
t("m2_exit",M,"PR-13","M2 exit: clinical scenarios and CLIN set",R3,
  ["docs/evidence/m2/**","STATUS.md"],["requests","complaints","letters","cred_alerts","photos"],
  "`pnpm test -- m2` passes including CLIN-001–005, 012, 014–016, 021–023, 026; independent R3 review recorded")

# ---------------- M3 ----------------
M="M3"
t("items",M,"PR-17","Items, batches, opened vials, FEFO, min/target, counts (UX-11)",R3,
  ["src/modules/inventory/**","src/app/(app)/stok/**","drizzle/**","tests/inventory/items.test.ts"],["m2_exit"],
  "Scenario PR-17 and CLIN-019 pass",visual=UI.format(ux="UX-11"))
t("depots",M,"PR-89","Depots, batch holdings, atomic linked transfers (DATA-63)",R3,
  ["src/modules/inventory/depots/**","drizzle/**","tests/inventory/depots.test.ts"],["items"],
  "Scenarios PR-89 (transfer, concurrent transfers) pass")
t("materials",M,"PR-16","Material lifecycle request → issue → consume/return/waste; no double deduction",R3,
  ["src/modules/inventory/materials/**","tests/inventory/materials.test.ts"],["depots"],
  "Scenario PR-16 and CLIN-008 pass")
t("mac",M,"PR-46","Moving average cost per item per branch",R3,
  ["src/modules/inventory/costing/**","tests/inventory/costing.test.ts"],["materials"],
  "Scenario PR-46 passes")
t("room",M,"PR-14","Ruang Tindakan checklist, staged timer, four outcomes, session effects contract (UX-9)",R3,
  ["src/modules/treatment/**","src/app/(app)/ruang/**","drizzle/**","tests/treatment/**"],["materials"],
  "Scenario PR-14 passes",visual=UI.format(ux="UX-9"))
t("pharmacy",M,"PR-18","Siapkan & Serahkan: prep list, seven checks, quarantine/recall blocks, labels (UX-10)",R3,
  ["src/modules/pharmacy/**","src/app/(app)/apotek/**","tests/pharmacy/**"],["room"],
  "Scenario PR-18 and CLIN-017, CLIN-018, CLIN-024, CLIN-025 pass",visual=UI.format(ux="UX-10"))
t("supplier_returns",M,"PR-75","Suppliers and supplier returns",R2,
  ["src/modules/purchasing/suppliers/**","tests/purchasing/returns.test.ts"],["mac"],
  "Scenario PR-75 passes")
t("payables",M,"PR-90","Purchase orders, goods receipts (GRNI), supplier invoices, payments, allocations, credit applications (UX-52)",R3,
  ["src/modules/purchasing/**","src/app/(app)/pembelian/**","drizzle/**","tests/purchasing/payables.test.ts"],["supplier_returns"],
  "Scenarios PR-90 (payable, no double allocation) pass",visual=UI.format(ux="UX-52"))
t("logbooks",M,"PR-82","Logbooks (sterilization, calibration, B3 waste) and patient-safety incident register",R2,
  ["src/modules/safety/**","src/app/(app)/logbook/**","tests/safety/**"],["room"],
  "Scenario PR-82 passes",visual=UI.format(ux="UX-9 ▸ Logbook, UX-28 ▸ Insiden"))
t("m3_exit",M,"PR-16","M3 exit: stock fixtures reconcile, no double deduction, depots never negative",R3,
  ["docs/evidence/m3/**","STATUS.md"],["pharmacy","payables","logbooks"],
  "`pnpm test -- m3` passes; independent R3 review recorded")

# ---------------- M4 ----------------
M="M4"
t("money_fixtures",M,"PR-19","Money fixture document: expected ledger lines, VAT and commission for PLAN §3 scenarios 1–20 (document task, before M4 code)",R2,
  ["docs/spec/fixtures/money-scenarios.md"],["m3_exit"],
  "Fixture document exists with a table per scenario; finance owner sign-off recorded; accountant review requested in the compliance register")
t("tax",M,"PR-24","Invoice and tax foundation: frozen price, tax category snapshot, PKP gate via compliance register, PKP turnover monitor",R3,
  ["src/modules/cashier/invoice/**","src/modules/tax/**","drizzle/**","tests/tax/**"],["money_fixtures","compliance"],
  "Scenario PR-24 passes; VAT switch refused without approved tax-advice evidence (PR-97)")
t("cashier",M,"PR-19","Kasir (UX-12): invoices, split tender, proportional allocation, receipts, counter sale, void via approval",R3,
  ["src/modules/cashier/**","src/app/(app)/kasir/**","tests/cashier/**"],["tax"],
  "Scenario PR-19 and money scenarios 1, 18 pass",visual=UI.format(ux="UX-12"))
t("port",M,"PR-68","Payment port and mock adapter (UX-56) with contract suite; mock hidden in production",R3,
  ["src/modules/payments/**","src/app/(app)/simulasi/**","tests/payments/**"],["cashier"],
  "Scenarios PR-68 pass; TD-43 contract suite passes against the mock")
t("consult_fee",M,"PR-12","Consultation fee and free controls",R3,
  ["src/modules/cashier/consultation/**","tests/cashier/consultation.test.ts"],["cashier"],
  "Scenario PR-12 and money scenario 4 pass")
t("additions",M,"PR-15","Additional treatment payment flow, release before payment, receivable fallback, close guard",R3,
  ["src/modules/cashier/additions/**","tests/cashier/additions.test.ts"],["cashier","requests"],
  "Scenario PR-15, CLIN-020, CLIN-025 and money scenario 3 pass")
t("packages",M,"PR-20","Packages: unlock by paid value, reserve/redeem, expiry and cancellation to balance",R3,
  ["src/modules/packages/**","drizzle/**","tests/packages/**"],["cashier"],
  "Scenario PR-20, CLIN-006, 007, 009, 010, 028 and money scenarios 5, 8, 11, 13 pass")
t("balance",M,"PR-21","Patient balance (never expires), cash refund exception",R3,
  ["src/modules/balance/**","tests/balance/**"],["packages"],
  "Scenario PR-21 and money scenario 15 pass")
t("dp",M,"PR-22","Booking DP lifecycle incl. no-show and reschedule effects (PR-83 integration)",R3,
  ["src/modules/cashier/deposits/**","tests/cashier/deposits.test.ts"],["balance","calendar"],
  "Scenarios PR-22, PR-83 no-show with DP and money scenarios 6, 17 pass")
t("refunds",M,"PR-21","Receivables, refunds, write-offs (UX-14)",R3,
  ["src/modules/cashier/receivables/**","src/app/(app)/piutang/**","tests/cashier/receivables.test.ts"],["dp"],
  "Money scenarios 9, 14 pass; refunds to balance by default",visual=UI.format(ux="UX-14"))
t("discounts",M,"PR-72","Manual discount limits per role and approval",R3,
  ["src/modules/cashier/discounts/**","tests/cashier/discounts.test.ts"],["cashier"],
  "Scenario PR-72 passes; approver capped by own limit")
t("promo",M,"PR-77","Promo codes with atomic quota (BILL-36)",R3,
  ["src/modules/promo/**","drizzle/**","tests/promo/**"],["discounts"],
  "Scenario PR-77 passes; two concurrent cashiers cannot exceed quota")
t("sharing",M,"PR-93","Family package sharing switch, beneficiaries, locked reservations",R3,
  ["src/modules/packages/sharing/**","tests/packages/sharing.test.ts"],["packages"],
  "Scenarios PR-93 (disabled by default, concurrent beneficiaries) pass")
t("schedules_inst",M,"PR-96","Reminder-only instalment schedules for packages and receivables",R2,
  ["src/modules/packages/schedules/**","tests/packages/schedules.test.ts"],["refunds"],
  "Scenario PR-96 passes; schedule never unlocks or creates debt")
t("expenses",M,"PR-79","Expenses and petty cash (posting integrates in M8)",R2,
  ["src/modules/expenses/**","src/app/(app)/keuangan/biaya/**","tests/expenses/**"],["cashier","payables"],
  "Scenario PR-79 passes; unpaid expense creates one payable document")
t("shift",M,"PR-19","Tutup Kasir (UX-15): any variance → manager approval, above SET-13 → owner",R3,
  ["src/modules/cashier/shifts/**","src/app/(app)/kasir/tutup/**","tests/cashier/shifts.test.ts"],["cashier"],
  "Shift close tests: non-zero variance always waits for approval; above threshold escalates",visual=UI.format(ux="UX-15"))
t("m4_exit",M,"PR-19","M4 exit: money scenarios 1–9, 11–20 against the fixture document",R3,
  ["docs/evidence/m4/**","STATUS.md"],["port","consult_fee","additions","refunds","promo","sharing","schedules_inst","expenses","shift"],
  "`pnpm test -- money` passes; independent R3 review recorded")

# ---------------- M5 ----------------
M="M5"
t("commission",M,"PR-23","Commission engine: rules, snapshots, contributions, adjustments, carry-forward, batches, per-recipient export (UX-16)",R3,
  ["src/modules/commission/**","src/app/(app)/komisi/**","drizzle/**","tests/commission/**"],["m4_exit"],
  "Scenario PR-23 and money scenario 10 pass",visual=UI.format(ux="UX-16"))
t("targets",M,"PR-47","BC targets and staff scorecard",R2,
  ["src/modules/commission/targets/**","tests/commission/targets.test.ts"],["commission"],
  "Scenario PR-47 passes")

# ---------------- M6 ----------------
M="M6"
t("waba",M,"PR-27","WABA onboarding state machine (Embedded Signup, BSP fallback), numbers, encrypted PIN, token vault",R3,
  ["src/modules/messaging/waba/**","drizzle/**","tests/messaging/waba.test.ts"],["m0_exit"],
  "Scenario PR-27 passes with recorded fixtures; no live Meta call in tests")
t("inbox",M,"PR-28","Pesan inbox (UX-17): routing, assignment, 24 h window, templates, raw webhook receipts",R3,
  ["src/modules/messaging/inbox/**","src/app/(app)/pesan/**","tests/messaging/inbox.test.ts"],["waba"],
  "Scenario PR-28 passes; webhook replay fixtures (duplicate, late, out of order, bad signature) pass",visual=UI.format(ux="UX-17"))
t("inbox_flag",M,"PR-43","Complaint flag from inbox messages into Keluhan",R2,
  ["src/modules/messaging/inbox/flag.ts","tests/messaging/flag.test.ts"],["inbox","complaints"],
  "Scenario PR-43 inbox flag passes")
t("leads",M,"PR-29","Leads pipeline and source (UX-18)",R2,
  ["src/modules/crm/leads/**","src/app/(app)/lead/**","tests/crm/leads.test.ts"],["inbox"],
  "Scenario PR-29 passes",visual=UI.format(ux="UX-18"))
t("followups",M,"PR-30","Follow-up tasks from rules",R2,
  ["src/modules/crm/followups/**","tests/crm/followups.test.ts"],["leads","packages"],
  "Scenario PR-30 passes")
t("outbound",M,"PR-31","Outbound consent, daily budget, no health content in templates",R3,
  ["src/modules/messaging/outbound/**","tests/messaging/outbound.test.ts"],["inbox"],
  "Scenario PR-31 passes")
t("reminders",M,"PR-69","Neutral appointment reminders with Konfirmasi/Ubah Jadwal replies",R2,
  ["src/modules/crm/reminders/**","tests/crm/reminders.test.ts"],["outbound","calendar"],
  "Scenario PR-69 passes")
t("aftercare",M,"PR-70","Aftercare via neutral notice and OTP-protected link",R3,
  ["src/modules/crm/aftercare/**","src/app/(public)/aftercare/**","tests/crm/aftercare.test.ts"],["outbound"],
  "Scenario PR-70 passes; WhatsApp text contains no treatment name")
t("automation",M,"PR-94","Automation scenarios with occurrences per offset and per-patient cap (UX-55)",R3,
  ["src/modules/crm/automation/**","src/app/(app)/otomasi/**","drizzle/**","tests/crm/automation.test.ts"],["reminders","aftercare"],
  "Scenario PR-94 passes; concurrent workers respect the cap",visual=UI.format(ux="UX-55"))
t("surveys",M,"PR-78","Satisfaction surveys and review-request rule",R2,
  ["src/modules/crm/surveys/**","tests/crm/surveys.test.ts"],["automation"],
  "Scenario PR-78 passes")
t("waitlist",M,"PR-81","Waitlist and offer on cancellation",R2,
  ["src/modules/scheduling/waitlist/**","tests/scheduling/waitlist.test.ts"],["calendar"],
  "Scenario PR-81 passes")
t("campaigns",M,"PR-94","Campaigns and segments with sending switched off until Q-15 evidence (UX-19)",R2,
  ["src/modules/crm/campaigns/**","src/app/(app)/kampanye/**","tests/crm/campaigns.test.ts"],["automation","compliance"],
  "Sending refused while the counsel evidence gate is closed; segments respect marketing consent",visual=UI.format(ux="UX-19"))
t("m6_exit",M,"PR-28","M6 exit: messaging end to end with recorded fixtures",R2,
  ["docs/evidence/m6/**","STATUS.md"],["inbox_flag","followups","surveys","waitlist","campaigns","targets"],
  "`pnpm test -- m6` passes")

# ---------------- M7 ----------------
M="M7"
t("satusehat",M,"PR-35","SATUSEHAT: per-branch credentials, facility-context invariant, identity states, sync ledger, outcome_unknown reconciliation, amendments (UX-23)",R3,
  ["src/modules/integrations/satusehat/**","src/app/(app)/satusehat/**","drizzle/**","tests/integrations/satusehat/**"],["m2_exit","pharmacy"],
  "Scenario PR-35 passes with recorded sandbox fixtures; lost-response and amendment-during-send tests pass",visual=UI.format(ux="UX-23"))
t("server_fee",M,"PR-61","Server-fee billing: fee versions, invoices, proration, AutoLaris attempts and Advice (mock HTTP), waivers, reminders (UX-43, UX-49)",R3,
  ["src/modules/vendor/billing/**","src/app/vendor/tagihan/**","src/app/(app)/saya/tagihan-server/**","tests/vendor/billing/**"],["golive"],
  "Scenarios PR-61 (prorata, expired attempt, rc≠00, waiver) pass; no live AutoLaris call in tests")

# ---------------- M8 ----------------
M="M8"
t("subledgers",M,"PR-25","Sub-ledgers and roll-forwards (step 1), exports",R3,
  ["src/modules/accounting/subledgers/**","tests/accounting/subledgers.test.ts"],["m4_exit","commission"],
  "Scenario PR-25 passes; roll-forwards reconcile on money fixtures")
t("ledger",M,"PR-26","Chart of accounts, posting engine from events, periods, statements; journal export gated by posting-map evidence",R3,
  ["src/modules/accounting/ledger/**","drizzle/**","tests/accounting/ledger.test.ts"],["subledgers","expenses","payables"],
  "Scenario PR-26 passes; every fixture posting matches the money fixture document; export refused without evidence")
t("coretax",M,"PR-98","Coretax XML export for PKP tenants, gated",R3,
  ["src/modules/tax/coretax/**","tests/tax/coretax.test.ts"],["ledger"],
  "Scenario PR-98 passes; XML validates against the published schema fixture")
t("recon",M,"PR-34","Reconciliation report KPI vs ledger",R2,
  ["src/modules/accounting/recon/**","tests/accounting/recon.test.ts"],["ledger"],
  "Scenario PR-34 passes")
t("dashboards",M,"PR-33","Dashboard read models, drill-down and per-role homes (UX-60), K1–K19 computed from fixtures",R2,
  ["src/modules/reporting/dashboards/**","tests/reporting/dashboards.test.ts"],["subledgers","m6_exit"],
  "Scenario PR-33 passes; K1–K19 equal fixture expectations; no clinical content in any dashboard payload")
for code,ux,name in [("PR-33a","UX-20, UX-37","Ringkasan Owner and Cabang league"),("PR-33b","UX-21","Ringkasan Cabang (manager)"),("PR-33c","UX-6","FO shift summary on Hari Ini"),("PR-33d","UX-35","Pasienku (BC home)"),("PR-33e","UX-36","Ringkasan CS"),("PR-33f","UX-22","Ringkasan Keuangan")]:
    t("dash_"+code,M,"PR-33",name+" ("+code+")",R2,
      ["src/app/(app)/ringkasan/%s/**" % code.lower(),"tests/reporting/%s.test.ts" % code.lower()],["dashboards"],
      "Scenario %s passes; browser check %s" % (code,ux),visual=UI.format(ux=ux))
t("adminpusat_home",M,"PR-33","Admin Pusat home (UX-57, PR-33g)",R1,
  ["src/app/(app)/ringkasan/admin-pusat/**","tests/reporting/admin-pusat.test.ts"],["dash_PR-33a"],
  "Scenario PR-33g passes",visual=UI.format(ux="UX-57"))
t("reports",M,"PR-95","Reports and KPI dictionary K1–K27 (UX-38, UX-59)",R2,
  ["src/modules/reporting/reports/**","src/app/(app)/laporan/**","tests/reporting/reports.test.ts"],["dashboards"],
  "Scenario PR-95 passes; each K20–K27 value equals its fixture",visual=UI.format(ux="UX-38, UX-59"))
t("digest",M,"PR-80","Owner daily digest",R1,
  ["src/modules/reporting/digest/**","tests/reporting/digest.test.ts"],["reports"],
  "Scenario PR-80 passes; digest contains no patient names")
t("platform_health",M,"PR-62","Vendor platform health (UX-45)",R2,
  ["src/app/vendor/kesehatan/**","tests/vendor/health.test.ts"],["server_fee"],
  "Scenario PR-62 passes")
t("m8_exit",M,"PR-26","M8 exit: ledger reconciles to sub-ledgers on fixtures; Phase 1 demo walkthrough J1–J8, J10",R3,
  ["docs/evidence/m8/**","STATUS.md"],["coretax","recon","adminpusat_home","digest","platform_health","satusehat"],
  "`pnpm test -- m8` passes; owner walkthrough recorded")

# ---------------- M9 ----------------
M="M9"
t("residency",M,"PR-36","Residency configuration and real-patient gate (ARCH-10) bound to compliance evidence",R4,
  ["src/modules/platform/residency/**","tests/platform/residency.test.ts"],["m8_exit"],
  "Scenario PR-36 passes; patient creation and imports refused while evidence is missing",protected=["src/modules/platform/**"])
t("dsr",M,"PR-50","Data-subject requests (UX-30) linked to the privacy workspace",R2,
  ["src/modules/privacy/requests/**","tests/privacy/requests.test.ts"],["m8_exit"],
  "Scenario PR-50 passes")
t("export",M,"PR-52","Tenant export job with manifest and 24 h expiry (UX-32)",R3,
  ["src/modules/export/**","tests/export/**"],["m8_exit"],
  "Scenario PR-52 passes")
t("public_site",M,"PR-64","Public site generator and Situs Klinik admin (UX-50, UX-51)",R2,
  ["src/modules/public-site/**","src/app/(public)/[slug]/**","src/app/(app)/situs/**","tests/public/**"],["m8_exit"],
  "Scenario PR-64 passes",visual=UI.format(ux="UX-50, UX-51"))
t("public_rules",M,"PR-65","Treatment page rules (Permenkes 1787/2010): no discount, no superlatives, reviewed text, price only when published",R2,
  ["src/modules/public-site/rules/**","tests/public/rules.test.ts"],["public_site"],
  "Scenarios PR-65 pass")
t("doctors_public",M,"PR-66","Doctor listing with consent and immediate purge on withdrawal",R2,
  ["src/modules/public-site/doctors/**","tests/public/doctors.test.ts"],["public_site"],
  "Scenario PR-66 passes")
t("public_booking",M,"PR-67","Booking with context from public pages, WhatsApp source tag, closed tenants reveal nothing (UX-24)",R2,
  ["src/app/(public)/[slug]/booking/**","tests/public/booking.spec.ts"],["public_site","booking"],
  "Scenario PR-67 passes",visual=UI.format(ux="UX-24"))
t("pixels",M,"PR-39","Public pixel policy: none on health-intent routes; consented pixels on home and branch only",R2,
  ["src/app/(public)/**","tests/public/pixels.spec.ts"],["public_site"],
  "Scenarios PR-39 pass with a network capture")
t("import",M,"PR-85","Opening-data import: batches, dry-run, source-ID map, opening sub-ledgers, owner approval (DATA-58)",R3,
  ["src/modules/import/**","tests/import/**"],["residency"],
  "Scenario PR-85 import dry-run passes; synthetic Numa-shaped file reconciles; re-import creates no duplicates")
t("vendor_tree",M,"PR-87","Vendor console complete tree and public site page set (19 §3–§4)",R1,
  ["src/app/vendor/**","tests/vendor/tree.spec.ts"],["platform_health","public_site"],
  "Scenario PR-87 passes")
t("m9_exit",M,"PR-59","M9 exit checklist: restore drill, residency gate, browser sweep, security review, J9 and J11 walkthroughs",R4,
  ["docs/evidence/m9/**","STATUS.md","RELEASE.md"],["pixels","dsr","export","public_rules","doctors_public","public_booking","import","vendor_tree"],
  "Every item of the PLAN M9 checklist has evidence; NFR-1–NFR-8 probes recorded; independent R4 review recorded")


# ---------------- round 6 pre-commit fixes ----------------
def K(k): return [x for x in T if x['key']==k][0]
def done(k, txt): K(k)['done']=txt
def add_done(k, txt): K(k)['done']+= "; "+txt
def deps(k,*d): K(k)['deps']+= [x for x in d if x not in K(k)['deps']]
def paths(k,*p): K(k)['paths']+= [x for x in p if x not in K(k)['paths']]
def move_before(k, before):
    x=K(k); T.remove(x); T.insert(T.index(K(before)), x)
def insert_after(after, **kw):
    t(**kw); x=T.pop(); T.insert(T.index(K(after))+1, x)
def V(ref): return "Visual contract per %s; tokens from `DESIGN.md`; states loading/empty/filtered-empty/error/success/blocked (`docs/spec/10` State Copy Patterns); compact 390 and regular 820/1180/1440 layouts per NAV-7." % ref

# A-08, B-05: T-001 owns the promotion documents
paths("repo","DECISIONS.md","README.md","AGENTS.md","STATUS.md")
done("repo","`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm build && pnpm docs:check` all exit 0 in CI and locally; versions pinned per `15` §2 are recorded in DECISIONS.md; the promotion check confirms every `15` §3 repository document exists and is non-empty")
# B-04: migration test path and schema convention
paths("dbcore","tests/db/**","src/db/schema/index.ts")
# C-14: backups, key custody, hostnames
insert_after("isolation_ci", key="platform", ms="M0", primary="PR-1", title="Platform basics: pgBackRest backups, key custody (envelope keys for NIK, tokens and PINs), app/booking/vendor host resolver (ARCH-3)", risk=R4,
  paths=["ops/pgbackrest/**","compose.yaml","src/lib/keys/**","src/lib/hosts.ts","tests/platform/**"], deps=["rls"],
  done="A seeded database restores to a scratch instance with matching row counts; envelope encryption round-trip and key-rotation tests pass; the host resolver serves clinic routes only on the app host, booking routes only on the booking host and vendor routes only on the vendor host",
  protected=["src/lib/keys/**"])
# A-28, A-29: visual references and widths
K("tokens")['visual']=V("`docs/spec/10` and `DESIGN.md`")
done("tokens","Contrast test over all token pairs passes (UI-1); accent validation rejects a failing hex (UI-2); browser snapshot of the component gallery at 390/820/1180/1440")
K("shell")['visual']=V("`docs/spec/19` §1 NAV-1–NAV-8")
K("visittrack")['visual']=V("`docs/spec/10` Component Contract")
# C-19, A-29
done("approvals_inbox","Scenario PR-44 passes with a fixture approval type (the stock-adjustment type attaches in the items task); browser check of UX-26 at 390/820/1180/1440 with empty, list and blocked (own request) states")
# C-18
K("idem")['primary']="PR-1"; K("events")['primary']="PR-1"
# C-13 screens
paths("settings","src/app/(app)/pengaturan/**","tests/ui/pengaturan.spec.ts"); K("settings")['visual']=V("`docs/spec/19` §2.17 and §5")
add_done("settings","browser check of the Pengaturan editor including Kembalikan ke default")
paths("compliance","src/app/(app)/kepatuhan/**","src/app/vendor/kepatuhan/**","tests/ui/kepatuhan.spec.ts"); K("compliance")['visual']=V("`docs/spec/17` UX-58")
paths("audit","src/app/(app)/audit/**","tests/ui/audit.spec.ts"); K("audit")['visual']=V("`docs/spec/17` UX-31")
paths("catalog","src/app/(app)/katalog/**"); K("catalog")['visual']=V("`docs/spec/17` UX-25")
paths("branch_price","src/app/(app)/katalog/harga-cabang/**"); K("branch_price")['visual']=V("`docs/spec/17` UX-25 branch price tab")
paths("subledgers","src/app/(app)/keuangan/kewajiban/**"); K("subledgers")['visual']=V("`docs/spec/17` UX-22 ▸ Kewajiban")
paths("ledger","src/app/(app)/keuangan/buku-besar/**"); K("ledger")['visual']=V("`docs/spec/17` UX-22 ▸ Buku Besar")
paths("coretax","src/app/(app)/keuangan/pajak/**"); K("coretax")['visual']=V("`docs/spec/17` UX-22 ▸ Pajak")
paths("recon","src/app/(app)/keuangan/rekon/**"); K("recon")['visual']=V("`docs/spec/17` UX-22 ▸ Rekon")
paths("dsr","src/app/(app)/privasi/permintaan/**"); K("dsr")['visual']=V("`docs/spec/17` UX-30")
paths("export","src/app/(app)/ekspor/**"); K("export")['visual']=V("`docs/spec/17` UX-32")
# C-12 visual contracts on UI paths
K("port")['visual']=V("`docs/spec/17` UX-56")
K("server_fee")['visual']=V("`docs/spec/17` UX-43, UX-49")
K("platform_health")['visual']=V("`docs/spec/17` UX-45")
K("vendor_tree")['visual']=V("`docs/spec/19` §3–§4")
# A-09
paths("vendor_tree","tests/public/tree.spec.ts")
done("vendor_tree","Scenario PR-87 passes; the public page set of `19` §4 is checked read-only by `tests/public/tree.spec.ts` (public pages are built in the public-site tasks)")
# C-03: credential model before consent gates
move_before("cred_alerts","bc"); deps("consent_proc","cred_alerts")
# C-04
deps("akses_vendor","support_scope"); deps("m0_exit","visittrack","vendor_console_host","support_scope","platform")
paths("m0_exit",".delivery/**")
# C-16
K("support_sessions")['title']="Support sessions: scope by object kind, TTL ≤ 2 h, operator RLS predicates (TEN-14, TEN-17)"
# C-17
done("vendor_roles","Scenario PR-57 passes; dual vendor/clinic identity refused without both approvals")
done("golive","Scenario PR-59 passes: go-live refused naming a blocking item, refused with fewer than two vendor staff, and refused while the clinical go-live evidence (Q-07 authority matrix, PR-97) is unapproved; go-live date recorded for server-fee billing")
done("master_layanan","Scenario PR-88 passes")
add_done("booking","bookings store the catalog version used; slot half of scenario PR-2 (branch hours and closures limit slots) passes")
# C-05 module-level vs full scenarios
done("lifecycle","Scenarios PR-56 pass at module level: suspension keeps records, blocks new bookings and marketing, keeps care-message eligibility (delivery verified in the reminders task)")
add_done("reminders","care messages still send for a suspended tenant (PR-56)")
done("switch","Context switching records the active branch, brand and acting role on actions; scenario PR-3 acting role for multi-role staff passes (full PR-84 with Antrean in the walk-in task)")
add_done("walkin","Scenario PR-84 branch switch passes")
done("branches","Branch master saved and audited; browser check UX-2 (slot half of PR-2 in the booking task, public listing half in the public-site task)")
add_done("public_site","listing half of scenario PR-2 passes; publish refused while the Q-15 counsel evidence (PR-97) is unapproved")
done("consents","Consent-ledger half of scenario PR-4 passes (withdrawal recorded, text versions immutable); the queued-message half passes in the outbound task")
add_done("outbound","withdrawn marketing consent stops queued promotional messages (PR-4)")
done("profile","Role projections of scenario PR-49 pass (cashier sees no clinical tabs; projection test per role); the record-copy half passes in the signing task")
add_done("signing","patient record copy of scenario PR-49 passes")
done("checkin","Board and close blocker of scenario PR-7 pass for an unpaid bill; the unpaid-addition half passes in the additions task")
add_done("additions","scenario PR-7 unpaid-addition blocker passes")
done("items","Items, batches and FEFO of scenario PR-17 and CLIN-019 pass; stock-adjustment approval type attaches to the inbox (PR-44); the transfer half passes in the depots task")
add_done("depots","transfer half of scenario PR-17 passes")
done("room","Four outcomes of scenario PR-14 pass; session effects pass in the packages task and the commission effect in the commission task")
deps("consult_fee","refunds")
# C-06
done("auth","Scenario PR-3 second factor passes; tests prove TOTP required for owner/Admin Pusat/manager/doctor/finance/facility head/records officer/auditor/central CS, lockout after 5 failures/15 min (RATE-2), FO idle lock at 120 s")
done("roles_new","Scenario PR-63 Admin Pusat cannot grant Owner passes; projection test per role × table generated from the 07 matrix passes")
done("calendar","Scenario PR-83 no-show without DP passes; browser check UX-5 phone agenda and desktop week")
# C-01, C-02, C-07, C-08 money order and scenarios
K("balance")['title']="Patient balance ledger (never expires)"; K("balance")['deps']=["cashier"]
done("balance","Balance half of scenario PR-21 and money scenario 15 pass")
move_before("balance","packages"); deps("packages","balance")
done("packages","Scenario PR-20, PR-14 session effects, CLIN-006, 007, 009, 010, 028 and money scenarios 2, 5, 7, 8, 11, 13 pass")
done("cashier","Scenario PR-19 and money scenario 1 pass")
done("port","Scenarios PR-68 and money scenarios 18, 20 pass; TD-43 contract suite passes against the mock")
add_done("tax","money scenarios 16, 19 pass")
add_done("additions","money scenario 12 (substitution difference) passes")
K("refunds")['title']="Refunds (balance default, cash exception), receivables and write-offs (UX-14)"
done("refunds","Scenarios PR-21 refund, PR-15 receivable, PR-37 owner write-off, PR-63 Admin Pusat boundary and money scenario 9 pass; the commission half of money scenario 14 passes in the commission task")
add_done("commission","scenario PR-14 commission effect and money scenario 14 pass")
# C-09
done("campaigns","Scenario PR-94 campaign sending gated passes; segments respect marketing consent")
# C-20
deps("leads","cashier")
# C-22
add_done("satusehat","Q-19 official-guide references recorded in the task evidence")
add_done("server_fee","the Advice→paid mapping is a fixture flagged pending Q-13")
# C-21 product routes
routes={"PR-33a":"ringkasan/owner","PR-33b":"ringkasan/cabang","PR-33c":"hari-ini/ringkasan","PR-33d":"pasienku","PR-33e":"ringkasan/cs","PR-33f":"keuangan/ringkasan"}
for code,r in routes.items():
    x=K("dash_"+code); x["paths"]=["src/app/(app)/%s/**"%r, x["paths"][1]]
# C-13 navigation sweep
insert_after("vendor_tree", key="nav_sweep", ms="M9", primary="PR-86", title="Navigation sweep: every `19` §2 page renders for its allowed roles and is absent for the others", risk=R2,
  paths=["tests/ui/nav-sweep.spec.ts"], deps=["vendor_tree","public_booking","export","dsr"],
  done="`pnpm test:ui -- nav-sweep` passes for every role in the `07` matrix at 390 and 1440", visual=V("`docs/spec/19` §2"))
deps("m9_exit","nav_sweep")
# C-10, C-11: table-creating tasks own their migrations and are R3+
tables={"schedules","walkin","consent_proc","photos","requests","complaints","cred_alerts","materials","mac","supplier_returns","logbooks","port","consult_fee","additions","balance","dp","refunds","discounts","sharing","schedules_inst","expenses","targets","inbox","leads","followups","outbound","reminders","aftercare","surveys","waitlist","campaigns","server_fee","subledgers","coretax","recon","dashboards","reports","digest","platform_health","residency","dsr","export","public_site","doctors_public","import","catalog","master_layanan","settings","notif","vendor_profile","letters"}
for x in T:
    if x['key'] in tables: paths(x['key'],"drizzle/**")
    if "drizzle/**" in x['paths']:
        paths(x['key'],"src/db/schema/index.ts")
        if x['risk'] in (R1,R2): x['risk']=R3
        if x['protected'] is None: x['protected']=["drizzle/**","src/db/rls/**"]
# C-20 risk levels
K("public_booking")['risk']=R3
if K("digest")['risk']==R1: K("digest")['risk']=R2


move_before("consult_fee","discounts")
K("auth")['visual']=V("`docs/spec/10` and `DESIGN.md` (sign-in, TOTP, idle-lock screens)")
K("vendor_console_host")['visual']=V("`docs/spec/17` UX-40–UX-49 shell (desktop-first)")
K("tenant_create")['visual']=V("`docs/spec/17` UX-40")
K("expenses")['visual']=V("`docs/spec/17` UX-22 ▸ Biaya")
K("aftercare")['visual']=V("`docs/spec/17` UX-51 patient pages (aftercare link)")
K("pixels")['visual']=V("`docs/spec/17` UX-51 (consent banner only)")


# ---------------- round 7 (Astra) fixes ----------------
# R7-15: dependencies and scripts introduced by their tasks; foundation module schemas
paths("dbcore","package.json","pnpm-lock.yaml","src/modules/org/schema.ts","src/modules/vendor/schema.ts")
add_done("dbcore","`pnpm db:migrate` script and Drizzle dependencies added by this task")
paths("rls","package.json","pnpm-lock.yaml","vitest.config.ts")
paths("isolation_ci","package.json","pnpm-lock.yaml")
paths("tokens","package.json","pnpm-lock.yaml","playwright.config.ts","components.json")
# R7-16: host enforcement wired into the request entry point
paths("platform","src/proxy.ts","tests/platform/hosts.spec.ts")
done("platform","A seeded database restores to a scratch instance with matching row counts; envelope encryption round-trip and key-rotation tests pass; the host resolver is wired into `src/proxy.ts` (Next.js 16 proxy convention) and HTTP negatives prove `/saya` and `/persetujuan` are refused on the booking and vendor hosts, public routes are refused on the app host, and vendor routes are refused on every non-vendor host")
# R7-10: early tasks claim only module-level parts; completions named
done("rls","`pnpm test:rls` passes: startup refuses a BYPASSRLS role; a table missing from `scope_map` or classified twice fails the test; cross-tenant read of a fixture row returns not-found (full scenario PR-1 with patients and audit in the patient-registration task)")
add_done("patients","scenario PR-1 tenant isolation passes in full (patients of two tenants, audit event recorded)")
done("switch","Context switching records the active branch, brand and acting role on actions (full PR-84 with Antrean in the walk-in task; PR-3 acting role with signing in the signing task)")
add_done("signing","scenario PR-3 acting role for multi-role staff passes")
done("catalog","Scenario PR-41 passes; catalog versions are immutable once referenced (CLIN-011 old receipts and entitlements complete in the packages task)")
add_done("packages","CLIN-011 passes (catalog change keeps old receipts and entitlements)")
done("master_layanan","Master Layanan saved and versioned with resources and staff eligibility (scenario PR-88 slot effect in the booking task)")
done("branch_price","Branch price override stored owner-only and effective-dated; Admin Pusat cannot override (invoice half of scenario PR-42 in the cashier task)")
add_done("cashier","scenario PR-42 branch price on an invoice passes")
done("calendar","Appointment states and actions of scenario PR-83 no-show without DP pass (state no-show, no money moves); the CS follow-up half passes in the follow-ups task; browser check UX-5 phone agenda and desktop week")
done("followups","Scenario PR-30 passes; follow-up tasks for no-shows (PR-83 without and with DP) are created for CS")
deps("followups","dp")
done("dp","Scenario PR-22 and the money part of PR-83 no-show with DP (DP forfeited) pass; money scenarios 6, 17 pass with gross-DP fixtures: DP moved to balance (VAT reversed, balance gross), spent later, and clinic-caused cash refund, all balanced with no duplicate VAT")
# R7-12: completions owned by the task that builds them
done("lifecycle","Scenario PR-56 manual suspension keeps records passes; suspended tenants keep care-message eligibility (the aftercare half of PR-56 completes in the aftercare task)")
done("reminders","Scenario PR-69 passes")
done("aftercare","Scenario PR-70 passes; WhatsApp text contains no treatment name; scenario PR-56 suspended tenant keeps care messages passes")
done("consents","Consent-ledger half of scenario PR-4 passes (withdrawal recorded, text versions immutable); the full scenario completes in the outbound task")
done("outbound","Scenario PR-31 passes; scenario PR-4 consent withdrawal passes in full (queued promo not sent, care reminders continue)")
deps("outbound","consents"); deps("aftercare","checkin","signing")
# R7-08, R7-09: money scenarios where executable
done("tax","Scenario PR-24 passes; VAT switch refused without approved tax-advice evidence (PR-97); tax-policy unit checks for the PKP boundary and VAT tax point pass (full money scenarios 16, 19 in the packages task)")
done("port","Scenario PR-68 and money scenario 18 pass; TD-43 contract suite passes against the mock (scenario 20 is verified in the ledger task with a synthetic settlement)")
done("additions","Scenario PR-15 additional payment, CLIN-020, CLIN-025 and the domain part of money scenario 3 pass; scenario PR-7 unpaid-addition blocker passes (receivable conversion in the refunds task, WhatsApp reminder in the reminders task)")
done("balance","Balance ledger tests pass: scenario PR-21 balance never expires; entries never negative (product refund parts of money scenario 15 in the refunds task)")
done("packages","Scenario PR-20, PR-14 session effects, CLIN-006, 007, 009, 010, 011, 028 and the domain parts of money scenarios 2, 5, 7, 8, 11, 12 (substitution), 13, 16, 19 pass (commission parts in the commission task)")
deps("packages","additions")
done("refunds","Scenarios PR-21 refund goes to balance by default, PR-15 receivable fallback, PR-37 owner write-off and PR-63 Admin Pusat boundary pass; money scenarios 9 and 15 pass and the receivable half of 3; the commission half of money scenario 14 passes in the commission task")
done("commission","Scenario PR-23, PR-14 commission effect and money scenarios 10 and 14 pass; commission parts of money scenarios 11 and 12 pass")
done("m4_exit","`pnpm test -- money` passes for the domain behaviour of money scenarios 1–9, 11–13, 15–19 (commission parts and scenario 14 in M5, journal lines and scenario 20 in M8); independent R3 review recorded")
add_done("ledger","every money scenario 1–20 posts the journal lines of the fixture document; scenario 20 runs with a synthetic gateway settlement posted directly (clearing ends at zero, fee is expense); posting triggers post each economic fact once")
# R7-11: missing dependency edges
deps("schedules_inst","packages")
deps("recon","dashboards")
move_before("dashboards","recon")
# R7-13: persistence owners
for k in ("access_admin","branches","merge","pharmacy","cashier","shift","golive"):
    paths(k,"drizzle/**","src/db/schema/index.ts")
    if K(k)['risk'] in (R1,R2): K(k)['risk']=R3
    if K(k)['protected'] is None: K(k)['protected']=["drizzle/**","src/db/rls/**"]
paths("golive","src/modules/vendor/checklist/schema.ts")
# R7-14: screen builders
paths("dashboards","src/app/(app)/ringkasan/peran/**","tests/ui/ringkasan-peran.spec.ts")
K("dashboards")['title']="Dashboard read models, drill-down and per-role homes (UX-60: Klinis, Marketing, Apotek, Pembelian, Audit, Ruang Saya), K1–K19 computed from fixtures"
K("dashboards")['visual']=V("`docs/spec/17` UX-60 and `docs/spec/19` §2.1")
add_done("dashboards","browser check of each UX-60 home")
paths("packages","src/app/(app)/kasir/paket-saldo/**","tests/ui/paket-saldo.spec.ts")
K("packages")['visual']=V("`docs/spec/17` UX-13")
deps("m8_exit","dash_PR-33a","dash_PR-33b","dash_PR-33c","dash_PR-33d","dash_PR-33e","dash_PR-33f")
K("nav_sweep")['done']="`pnpm test:ui -- nav-sweep` passes for every role in the `07` matrix at 390 and 1440 (verification only: a missing page is a defect in its builder task, not built here)"

# ---------------- closure review follow-up (F1–F9) ----------------
# F2: import reconciliation proves both balanced opening alternatives.
add_done("import","each imported opening liability and receivable reconciles to its balanced OpeningImportApplied journal in `11`, with no new revenue, VAT or commission")
# F3 is fixed in SET-44; the settings task validates its typed default.
add_done("settings","SET-44 accepts month_end or day(1..28), defaults to month_end and never changes the monthly cadence")
# F4: canonical module-root schemas, not just migration permission.
for k, schema in (("access_admin","org"),("branches","org"),("merge","patients"),("shift","cashier"),("golive","vendor")):
    paths(k,"src/modules/"+schema+"/schema.ts")
K("golive")['paths']=[p for p in K("golive")['paths'] if p != "src/modules/vendor/checklist/schema.ts"]
# F5: roster storage precedes the slot engine.
done("schedules","Roster shifts and leave persist per branch; module-level availability excludes a doctor on leave (full scenario PR-48 roster in the booking task)")
add_done("booking","full scenario PR-48 roster passes: requesting a slot for a doctor on leave yields no slot")
# F6: real scenario names and explicit downstream integration ownership.
done("additions","Scenarios PR-15 alerts and PR-15 cannot close unpaid, CLIN-020, CLIN-025 and the domain part of money scenario 3 pass; PR-7 unpaid-addition blocker passes (receivable conversion in refunds; full PR-15 receivable after the WhatsApp-bill fallback in outbound)")
done("refunds","PR-21 refund goes to balance by default and PR-63 Admin Pusat boundary pass; PR-37 owner write-off passes at module level (owner self-approval, mandatory reason, audit; commission exclusion completed in commission); PR-15 receivable conversion passes at module level (full WhatsApp-bill fallback in outbound); money scenarios 9 and 15 and the receivable half of 3 pass")
add_done("commission","full scenario PR-37 owner write-off passes, including exclusion from commission payment")
deps("outbound","refunds")
add_done("outbound","full scenario PR-15 receivable passes: send the WhatsApp bill through the mock adapter, keep an unpaid visit blocked, then convert to receivable so the bill is settled and the visit can close; the receivable appears at the next visit")
paths("outbound","tests/messaging/receivable-fallback.test.ts")
# F7: explicit builders for list and staff-screen segments.
paths("search","src/app/(app)/pasien/page.tsx","src/app/(app)/pasien/_components/**","tests/ui/pasien-list.spec.ts","src/modules/patients/schema.ts","drizzle/**")
K("search")['title']="Patient list UX-4 (filters and saved segments) and global patient search under RLS: masked phone, rate limit, no query logging, abuse alert"
K("search")['visual']=V("`docs/spec/17` UX-4 and `docs/spec/19` §2 Daftar Pasien")
add_done("search","browser check of Daftar Pasien filters and persisted saved segments; cross-tenant negatives on list and saved segments")
paths("access_admin","src/app/(app)/staf/**","src/modules/org/staff/**","tests/ui/staf.spec.ts")
K("access_admin")['title']="Staf & Undangan UX-3: staff, invitations and credential-status segments; Pengguna & Akses permission matrix, membership sessions, duties and change log"
K("access_admin")['visual']=V("`docs/spec/17` UX-3 and `docs/spec/19` Staf & Undangan (all segments)")
add_done("access_admin","browser checks of staff list/detail, invite creation/acceptance and credential-status segment using fixtures (credential verification actions completed in the credentials task)")
deps("access_admin","membership")
paths("cred_alerts","src/app/(app)/staf/**","tests/ui/staf-kredensial.spec.ts")
K("cred_alerts")['visual']=V("`docs/spec/17` UX-3 credential verification segment")
add_done("cred_alerts","browser check of STR/SIP credential verification in Staf & Undangan; expired/invalid credentials remain blocked")
# F8: accounting owns Coretax, including its task paths.
K("coretax")['paths']=[p.replace("src/modules/tax/coretax/","src/modules/accounting/coretax/").replace("tests/tax/coretax.test.ts","tests/accounting/coretax.test.ts") for p in K("coretax")['paths']]
# F9: exit heading must agree with its executable acceptance scope.
K("m4_exit")['title']="M4 exit: domain money scenarios 1–9, 11–13, 15–19 (commission M5; journals and scenario 20 M8)"

# F4 final closure: every migration builder may edit the canonical root schema
# of each module already in its declared source surface (15 §3).
for task in T:
    if "drizzle/**" in task['paths']:
        for path in list(task['paths']):
            match = re.match(r"src/modules/([^/]+)/", path)
            if match:
                paths(task['key'], "src/modules/" + match[1] + "/schema.ts")

# ---------------- missing-PR sweep: add tasks for PRs not yet primary ----------------
assigned={x['primary'] for x in T}
missing=[p for p in pr if p not in assigned and p!='PR-40' and not p.startswith('PR-33')]
for p in missing:
    print("MISSING PRIMARY", p, pr[p][:80])

keys={}
for i,x in enumerate(T,1): keys[x['key']]="T-%03d"%i
out=[]
today=datetime.date(2026,11,2).isoformat()
out.append("# Tasks — Clinic Dashboard\n\nUpdated: %s\n\nKit v0.7, re-validated at G1 on 2026-11-02 (P-27; Q-12 may still change PR-7, PR-9, PR-14, PR-15, PR-18, PR-71, PR-83). Root execution queue of `~/Projects/clinic-dashboard` (DEL-1). Every task traces to exactly one primary `PR-*` in `02-PRD.md`; other IDs are constraints. Task state lives in `STATUS.md` and `.delivery/`, not here.\n\n## Rules for the AI\n\n- One task per request; change only `Allowed Paths`; need more → stop and ask. Standing exceptions: tool-written `.delivery/**` records and the `STATUS.md` checkpoint line; a task with `drizzle/**` may add its module's re-export line to `src/db/schema/index.ts`.\n- A Done-when that names part of a scenario (\"half\", \"module level\") is complete when that part passes; the named later task completes the full §8 scenario.\n- Respect `AGENTS.md`: tenant isolation tests for every route/job/export, no secrets, no live provider calls, integer rupiah, idempotency, clinic glossary.\n- R3/R4 tasks need an independent review before integration (`cross-cli` or the runtime's review lane).\n- A task with UI paths is done only with browser evidence at 390/820/1180/1440 (`ui-validation`).\n- `Done when` names the procedure; the result is recorded as evidence only after it runs.\n\n## Summary\n\n| Milestone | Tasks |\n|---|---|\n" % today)
from collections import OrderedDict
cnt=OrderedDict()
for x in T: cnt.setdefault(x['ms'],[]).append(keys[x['key']])
for m,ids in cnt.items(): out.append("| %s | %s–%s (%d) |\n"%(m,ids[0],ids[-1],len(ids)))
out.append("\n## Pending\n")
cur=None
for x in T:
    if x['ms']!=cur:
        cur=x['ms']; out.append("\n### Milestone %s\n"%cur)
    tid=keys[x['key']]
    deps=", ".join(keys[d] for d in x['deps']) or "None"
    prot=", ".join("`%s`"%p for p in (x['protected'] or [])) or ("`drizzle/**`, `src/db/rls/**`" if x['risk'] in ("R3","R4") else "None")
    lines=["\n#### %s: %s\n"%(tid,x['title']),
      "- **Primary requirement:** %s\n"%x['primary'],
      "- **Risk Level:** %s\n"%x['risk'],
      "- **Allowed Paths:** %s\n"%", ".join("`%s`"%p for p in x['paths']),
      "- **Protected Paths:** %s\n"%prot,
      "- **Depends On:** %s\n"%deps,
      "- **Visual Contract:** %s\n"%(x['visual'] or "Not applicable"),
      "- **Done when:** %s\n"%x['done'],
      "- **Non-Scope:** anything outside Allowed Paths; live provider calls; production data\n",
      "- **Escalation Conditions:** verification fails after one repair attempt, or the task needs a contract change in `docs/spec/`\n"]
    out.extend(lines)
open('TASKS.md','w').write("".join(out))
print(len(T),"tasks")
