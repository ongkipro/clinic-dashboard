# Review 2: Architecture, Data Model, Tenancy, Security, Privacy, Residency, Buildability

- **Target:** `~/Documents/work/prd/clinic-dashboard/` (03, 04, 05, 06, 07, 09, 12, 13, 14, 15, 16, `CONTEXT-RECORD.md`, `AGENTS-DRAFT.md`, `PLAN.md`; also checked 02, 11, 17, `README.md`).
- **Sources checked:**
  - `DECISION-REGISTER.md` (P-, H-, S-, W- entries)
  - `COMPLIANCE-TAX-ACCOUNTING-SATUSEHAT-PSE-RESEARCH.md` (§1, §4–§9)
  - `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` (§2.9–§5.5)
- **Kliniknuma files read (read-only):**
  - `src/db/schema/{tenancy,identity-catalog,outbox-governance,clinical-longitudinal}.ts`
  - `src/lib/persistence/scope-map.ts`
  - `drizzle/0002_task032_tenancy_persistence_settings.sql`
  - `src/workers/runtime/index.ts`
  - `package.json`, `compose.yaml`
  - targeted greps in `PLAN.md`, `DECISIONS.md`, `TASKS.md`
- **Method:** I read the files and searched for specific terms. No code was run. Regulatory statements below are checked only against the research files, not against the law itself.

## Correct (what already works)

- **Residency intent is stated plainly and tied to sources.** It appears in PR-36, ARCH-1, DR-1, PRIV-5 and the AGENTS rule "Never configure a Singapore database or bucket for production clinical data". All trace back to H-02 and Permenkes 24/2022 Pasal 20/22 as quoted in COMPLIANCE §5.1.
- **The Kliniknuma tenancy layer is real and worth reusing:**
  - a scope map with a test that fails on unclassified tables (`scope-map.ts` header);
  - RLS enabled in a loop over table classes (`0002_…sql` ~L741–L770);
  - the app's database role is checked at runtime to have no superuser or BYPASSRLS rights (`postgres-adapters.ts` ~L2620–2650);
  - the worker binds tenant context per claimed row (`workers/runtime/index.ts` ~L226–L320, `FOR UPDATE SKIP LOCKED`).
- **The command pattern is sound:** one transaction writes the domain row, the audit row and the outbox row; idempotency keys are required; money is integer rupiah; signed rows are append-only (03 §7, DATA-2/3/5).
- **The SATUSEHAT direction is right:** a durable outbox per resource; the BC intake is not sent as a clinician finding (S-06, PR-35); a missing NIK never blocks care (CD-28).
- **WABA constraints are researched in useful detail:** the shared portfolio messaging limit, the 2→20 number cap and display-name rules (NEEDS §5.5). The decisions (W-06/W-07) reflect them.
- **The cross-border records exist (XFER-1..3)** and clearly mark counsel review as pending. Some of their factual descriptions need correcting (P1-2).
- **The stack is coherent and matches the Kliniknuma lockfile.** Versions in 15 §2 equal `package.json`: next 16.4.3, react 19.3.0, better-auth 1.7.14, drizzle-orm 0.45.4, drizzle-kit 0.31.11, vitest 5.0.5, pnpm 12.15.0, TS 5.9.3.

## Findings

### P1 — fix before PRD approval or before TASKS.md is written

**P1-1. Hosting public booking in Singapore conflicts with the residency rule, and the architecture contradicts itself.**
- **Where:** 04 §1 diagram (`PUB[Public booking pages\nVultr Singapore]`, `PUB -- API, no clinical data stored --> APP`); ARCH-2; XFER-1; 17 UX-24.
- **Evidence:**
  - Permenkes 24/2022 Pasal 14(2) puts medical record number, name and NIK inside the RME's identity data (COMPLIANCE §6). So patient identity collected at booking is RME content, not "non-clinical".
  - The chosen service (acne, melasma, filler) shows a health condition. PR-39 itself mentions "booking, intake or complaint fields" on these pages.
  - The 04 §3 containers table has no public-booking container. Its only "web/app" row says Indonesia (prod) / Singapore (staging). ARCH-4 says there is one image plus one worker. Nothing says how a Singapore front end gets tenant config and slots, or what credentials it uses to call the Indonesian API.
  - The research itself recommends: "run the whole production application and database in Indonesia, keep Singapore for non-production and public marketing" (NEEDS §3.5).
- **Fix:**
  - Serve `/{tenant}/booking` and `/api/v1/public/**` from the production app in Indonesia.
  - Allow Singapore to host only static marketing pages with no forms, plus staging and demo with synthetic data.
  - Remove the PUB node from the diagram, or define it as static-only.
  - Rewrite XFER-1 to cover non-production only.
  - Add a PR-36 acceptance check: "no production hostname that accepts patient input resolves to a non-Indonesian origin".

**P1-2. The Cloudflare record is factually wrong.**
- **Where:** H-02c ("traffic is encrypted in transit; storage stays in Indonesia"); `CONTEXT-RECORD.md` XFER-2 ("encrypted traffic incl. clinical requests in transit"); ARCH-3; SEC-4.
- **Evidence:**
  - With proxied DNS and Full (strict) TLS, Cloudflare ends TLS at its edge and inspects plaintext requests and responses so the WAF can work. That plaintext includes clinical forms, photo uploads and signed record views, processed at whichever PoP serves the user.
  - The register itself records that Cloudflare Regional Services has no Indonesian region (H-02). So the edge cannot be pinned to Indonesia.
  - Counsel would be reviewing XFER-2 against a wrong description of what happens.
- **Fix:**
  - Correct XFER-2 and H-02c to say: "Cloudflare decrypts and processes clinical request and response content in memory at non-pinned PoPs; no storage by design."
  - Add the controls:
    - WAF payload logging off;
    - no Logpush of request bodies;
    - a cache-bypass rule plus `Cache-Control: private, no-store` on `/staff/**`, `/api/v1/staff/**` and media routes;
    - no Workers on clinical routes.
  - Make the two hostnames an explicit decision. Option (a): proxy only the public and booking host, and run the staff/clinical host as DNS-only with an origin firewall and a WAF on the Indonesian side. Option (b): accept edge processing, backed by a written opinion recorded under H-02d.
  - Pick Cloudflare Tunnel or an IP allowlist at the origin. H-01 mentions "tunnel" and SEC-4 says "Cloudflare IPs only"; neither is chosen.

**P1-3. The Coolify control plane in Singapore can reach production data, and its role is described as harmless.**
- **Where:** 04 §3 (`Coolify | Vultr Singapore | Deployment metadata, no clinical data`); ARCH-2; SEC-6 ("app secrets via environment from Coolify"); 04 §4 trust boundaries (no row for Coolify).
- **Evidence:**
  - Coolify reaches the Indonesian server over SSH with root-equivalent access to deploy (H-02b). It stores every production environment variable: database credentials, auth secret, and the key that encrypts per-tenant WABA, SATUSEHAT and gateway secrets (TEN-7).
  - It can stream container logs and open container or database terminals.
  - Anyone who compromises the Singapore box therefore has full read access to clinical data in Indonesia, plus the keys.
  - Kliniknuma already required "Coolify dashboard reachable only through Cloudflare Access or an allowlisted IP" (`kliniknuma/TASKS.md` ~L764). The kit drops this.
  - No key custody design exists anywhere in the kit. In Kliniknuma this question was left open as OQ-8.
- **Fix:**
  - Either run Coolify on an Indonesian host, or keep it in Singapore but add an XFER-4 record plus these controls:
    - Cloudflare Access with MFA and an IP allowlist;
    - no Coolify-managed database backups going to non-Indonesian S3;
    - log streaming accepted as a remote-access path;
    - the key-encryption key kept outside Coolify env, e.g. a provider KMS in Jakarta if the provider is AWS/GCP, or a sealed file on the Indonesian host.
  - Add Coolify to 04 §4 and SEC-6.
  - Add a requirement for key custody and rotation (KEK/DEK, who holds it, rotation drill).

**P1-4. The tenancy model differs from the Kliniknuma RLS it plans to reuse, and the kit does not design the difference.**
- **Where:** 06 "Branch Scope" ("Patients, balance and packages are tenant-wide… Clinicians may open the full clinical history of a patient being served at their branch"); DATA-1; PLAN §2 ("tenancy scope map, RLS migration → Keep"); 07 role matrix (Owner ● Patient identity); PLAN §3 scenario 11 (cross-branch package).
- **Evidence from Kliniknuma:**
  - `scope-map.ts` classes these tables as FACILITY (`facility_strict`): `medical_records`, `medical_record_versions`, `care_plans`, `clinical_media_assets`, `patient_packages`, `package_entitlements`, `patient_deposits`, `payments`, `journal_entries`.
  - The RLS write check requires `facility_id = app_current_active_facility_id()` (`0002…sql` ~L746–L752). So:
    - a doctor at branch B cannot read A's history;
    - redeeming at B cannot write to a package owned at A;
    - a tenant-wide balance cannot exist.
  - The `patients` SELECT policy blocks `actor_role = 'owner'` and gates rows through `patient_facility_links` (~L775–L790). This contradicts 07, where the owner has full access to patient identity.
  - Several unique constraints are global, not per tenant (`0000_initial…sql` L169–L241, `identity-catalog.ts`, `clinical-longitudinal.ts` L40):
    - `patients.medical_record_no` and `patients.nik_hash`;
    - `staff_licenses.license_number`;
    - `staff_profiles.employee_code`;
    - `rooms.room_code`, `devices.device_code`;
    - `facilities.facility_code`, `integration_config.facility_code`;
    - `auth_accounts.email`.
  - In a multi-tenant SaaS this means:
    - the same patient cannot register at two clinic brands;
    - the same doctor (common in Indonesia) cannot hold a licence row at two tenants;
    - unique-violation errors reveal that a NIK exists in another tenant.
  - `staff_profiles` has no `organization_id` (classed AUTH_AND_SYSTEM). `account_id` is unique, so one login maps to one staff profile and one role. There is no tenant-membership model.
- **Fix:** Before M0, publish "Scope map v2" in 06. It should list every reused and new table with its class and policy kind. It needs policy kinds for:
  - tenant-shared patient master;
  - clinical rows readable across branches when the patient has an active visit or assignment at an allowed branch (plus break-glass);
  - tenant-wide entitlements and balance written from any allowed branch;
  - a branch-dimensioned tenant ledger.
  - Make every business unique key composite with `tenant_id`.
  - Add a `memberships` table (account ↔ tenant ↔ role ↔ allowed branches, effective dates).
  - Resolve the owner-PHI rule against 07 explicitly.
  - Add RLS raw-SQL tests for each policy kind.

**P1-5. Pre-tenant entry points have no design: webhooks, public host, worker claim, operator path.**
- **Where:** TEN-1/TEN-5; API-1 (`/api/v1/webhooks/{meta,payment}`); 03 §5 WhatsApp flow; UX-24 `/{tenant}/booking`; TEN-6.
- **Evidence:**
  - Meta sends webhooks for all onboarded WABAs to the app's callback. Gateway notifications and public requests also arrive with no tenant context. Under a non-BYPASSRLS role with `organization_id = app_current_organization_id()` policies, the app cannot look up which tenant owns a `phone_number_id`, order ID or host slug.
  - The Kliniknuma worker is built per tenant: `OutboxWorkerRuntimeOptions.organizationId: string` and `allowedFacilityIds` (`workers/runtime/index.ts` ~L62–L70), and it claims with `WHERE "organization_id" = $1`. A single shared worker cannot claim across tenants as written.
  - TEN-6 describes operator break-glass but not how it works. It is unclear whether operators use a platform role, how RLS is satisfied without BYPASSRLS, and where the tenant sees the audit. Tenant provisioning (PR-1, "vendor creates tenant") also needs platform-scope writes, and no platform tables are listed in 05.
- **Fix:**
  - Add a "platform" scope to 05/06 with routing tables, unique across all tenants:
    - `waba_routes(phone_number_id, waba_id → tenant_id, branch_id)`;
    - `payment_routes(merchant_ref/order_prefix → tenant_id)`;
    - `public_hosts(host|slug → tenant_id)`;
    - `tenants_registry`.
  - Read these only through narrow `SECURITY DEFINER` functions that return IDs only.
  - Add a claim function for the outbox that returns `(event_id, tenant_id, branch_id)` across tenants, then binds the context per row (as TEN-5 intends).
  - Define a `platform_operator` role with a break-glass grant table: reason, TTL, tenant-visible audit, no BYPASSRLS.
  - Add negative tests: an unknown `phone_number_id` is dropped and audited; a spoofed slug returns 404.

**P1-6. PR-27/PR-28 are Must requirements, but the WhatsApp Tech Provider design is only table names.**
- **Where:** PR-27 (incl. Coexistence), W-02..W-08; DATA-25; TEN-7; API-4; IAM-2; RATE-6/CD-27.
- **Evidence:** The kit has no text for "webhook", "Coexistence", tokens or number registration beyond PR-27's one line, DATA-25 table names and TEN-7. These pieces are missing:
  - the Embedded Signup code → business token exchange, which token type is stored, its scopes, refresh and revocation handling (removed-partner and account-update events);
  - subscribing the app to each WABA;
  - the `register` call and two-step PIN per number (NEEDS §5.5 notes that a separate register call is required) and where the PIN is stored;
  - one tenant with several WABAs or portfolios;
  - downloading inbound media (Meta media URLs are temporary) into the Indonesian bucket;
  - Coexistence: echoes of messages sent from the WA Business app, history and contact sync, how app-sent messages count in the inbox and SLA timers, feature limits;
  - which WABA sends the booking OTP (IAM-2), and what happens before a tenant has connected a WABA;
  - how the 80% budget (CD-27) is computed against a portfolio limit that Meta changes.
- **Fix:** Add a "Messaging integration contract" section (or doc 18) that covers:
  - the onboarding state machine per WABA and per number;
  - a token vault schema (encrypted DEK per tenant, `token_kind`, `granted_scopes`, `revoked_at`);
  - webhook routing (P1-5) and idempotency on message ID / status ID;
  - the media pipeline into the Indonesian bucket;
  - Coexistence ingest rules;
  - the OTP sender rule;
  - the budget calculator with its source fields;
  - a test plan using a Meta test number plus a recorded-fixture webhook replay.

**P1-7. SATUSEHAT has no data contract: identity, practitioner, coding and credential pieces are missing.**
- **Where:** PR-35; DATA-11, DATA-27; 03 §5 SATUSEHAT flow; COMPLIANCE §4.2–§4.4.
- **Evidence:**
  - **Patient identity:** Kliniknuma stores only `patients.nik_hash` (globally unique, `identity-catalog.ts` L69). SATUSEHAT Patient lookup needs the NIK value itself. Kliniknuma's own PLAN warns against "an unsalted hash of predictable identifiers" (`kliniknuma/PLAN.md` L246).
  - **Practitioners:** COMPLIANCE §4.2 says practitioners are resolved via SATUSEHAT practitioner lookup. No staff NIK or IHS-number field exists in Kliniknuma `staff_profiles`/`staff_licenses` or in the 05 deltas.
  - **Coding:** Kliniknuma has only `icd10_codes`/`icd9_cm_codes` arrays (`clinical-longitudinal.ts` L372–373). 05 adds no KFA codes for products, ICD-9-CM on treatments, LOINC/SNOMED for observations, or code tables.
  - **Other gaps:**
    - Location per room needs creating in SATUSEHAT;
    - the Encounter lifecycle (arrived → in-progress → finished, with timestamps) is not mapped to visit states;
    - no credentials table, sandbox/production flag, token cache keyed by tenant+branch, or rate-limit or 4xx error classification;
    - nothing for one PT with several licensed branches, each with its own Organization ID, versus sub-organizations.
  - The Kliniknuma outbox `CHECK` allows only 16 event types (`outbox-governance.ts` L60–L77). Clinic Dashboard needs new ones.
- **Fix:** Add a SATUSEHAT mapping spec: resource-by-resource field map with source columns, trigger events and update/cancel rules for amendments. Add data deltas:
  - `patients.nik_enc` + `nik_bidx` (HMAC with a tenant key), no-NIK identity types (passport, KITAS, newborn-via-guardian), `ihs_patient_id`;
  - `staff.nik_enc`, `ihs_practitioner_id`;
  - `branches.satusehat_org_id`, `rooms.satusehat_location_id`;
  - catalog `kfa_code`, `icd9cm_code`; code-system tables;
  - `satusehat_credentials(branch_id, env, client_id, secret_ref, rotated_at)`.
- Make M7's exit check "sandbox Encounter + Condition 200/201" use real mapped data, not hand-built JSON.

**P1-8. An AI agent cannot write TASKS.md yet: core contracts are missing and the codebase decision contradicts itself.**
- **Where:** PLAN §2 ("Reuse … `src/db/schema/**` (113 tables) … Engines … Auth … Tests → Keep"); DECISION-REGISTER P-05 ("Standalone project … nothing reused or derived", DECIDED) vs P-08/P-09 (OPEN); DEL-1 (fresh `project-init`); `README.md` ("Code: No code. Stack OPEN"); 09 header ("`openapi.yaml` … not written yet"); API-3 (points to the "Kliniknuma PLAN error contract"); PR-33/TD-12 ("KPI dictionary", which is not in the kit); 03 §5 (events such as `PaymentReceived` with no catalog); 05 §3 (names only, no columns).
- **Evidence:**
  - M0 can be either "fork Kliniknuma and rename `organizations`→`tenants`, `facilities`→`branches` across 113 tables and the code" or "start a new repo and copy contracts". These produce entirely different task lists and Allowed Paths.
  - TD-10 posting and TD-12 read models depend on an event catalog that does not exist.
  - The error codes live in another repo (`kliniknuma/PLAN.md` L413 table).
  - New Must tables have no columns, enums, constraints or scope class: `booking_deposits`, `balance_entries`, `selections`, `waba_*`, `leads`, `receivables`, `consultation_fee_states`. TEN-3 requires the scope class.
- **Fix:** Before running `prd-taskbreaker`:
  1. Decide Q-01/P-09 and amend P-05.
  2. Add `EVENTS.md`: name, version, producer module, consumers, payload schema with reference-only clinical fields, idempotency key.
  3. Add an error catalog (code, HTTP status, Indonesian message, when raised), copied rather than referenced.
  4. Give column-level definitions for every NEW and MODIFY table, including scope class (P1-4).
  5. Add a KPI dictionary (formula, source table or event, time basis, branch/consolidated, clinical-free).
  6. Add an `openapi.yaml` skeleton for M0–M1 route groups plus webhooks.

### P2 — fix before pilot (Phase 2)

**P2-1. Inbound WhatsApp content is health data, but the records assume it is not.**
- **Where:** XFER-3 ("message content (no clinical details per PR-31)"); PR-31; OBS-1.
- **Evidence:** PR-31 and W-05 restrict outbound templates only. Patients send symptoms and face photos inbound. Coexistence history sync would import past chats.
- **Fix:**
  - Classify `messages.body` and media as possibly specific personal data.
  - Store them only in the Indonesian DB and bucket.
  - Exclude them from logs and analytics.
  - Add a retention rule.
  - Restrict inbox access by role (07 currently gives BC and FO full inbox access).
  - Ask counsel whether Meta Cloud API local storage in Indonesia can be enabled (see verification item 13).

**P2-2. No rule for error tracking, APM or log shipping.**
- **Where:** 16 (no error tracker named), AGENTS-DRAFT (bans session replay and pixels only).
- **Evidence:** No error-tracking tool is named anywhere in the kit. Agents commonly add a hosted error tracker, which would send stack traces with SQL parameters, request bodies and user emails offshore. Log location and retention are undefined (Coolify container logs only).
- **Fix:** Add an OBS rule: no third-party error, APM or log SaaS outside Indonesia unless the privacy owner decides otherwise. Use a self-hosted tracker on the Indonesian host, or structured logs only. Add:
  - a scrubbing allowlist;
  - log retention (e.g. 30 days ops logs, separate from the audit log);
  - a CI check that fails on known SaaS SDK packages.

**P2-3. The outbox payload rule contradicts itself.**
- **Where:** AGENTS-DRAFT ("No clinical content in … events"), 03 §8, SEC-2 vs PR-35 (outbox carries SATUSEHAT data).
- **Evidence:**
  - Kliniknuma `integration_outbox.payload_json` is free JSONB. `last_error_redacted` only strips phone, email, 16-digit numbers and bearer tokens (`workers/runtime/index.ts` L21–L28).
  - SATUSEHAT 4xx bodies can echo clinical text.
- **Fix:**
  - Payloads carry only `{resource_type, local_id, version}`. The worker builds the FHIR body at send time inside the bound tenant transaction.
  - Store provider error bodies only in a clinical-class table in Indonesia, or truncate them to code plus path.
  - Add a test that fails if a payload contains clinical columns.

**P2-4. Backup and DR cover the database only, and the tooling is unspecified.**
- **Where:** DR-1, DR-2, SEC-11, ARCH-1.
- **Evidence:**
  - Clinical photos and signed PDFs in object storage have no RPO, versioning or replication target.
  - "WAL archiving" names no tool. Coolify's built-in database backups are scheduled dumps, not point-in-time recovery, so a 15-minute RPO needs a sidecar such as WAL-G or pgBackRest.
  - Backup encryption key custody is undefined.
  - The restore-drill location is unstated: it must not be Singapore staging.
  - A 2-hour RTO onto a fresh server at a second site needs a scripted rebuild that does not depend on the Singapore Coolify being up.
- **Fix:** Name the tool. Set object-storage versioning and cross-site replication inside Indonesia. Put the backup KEK outside Coolify. Run drills in Indonesia. Write a runbook for "Coolify unavailable".

**P2-5. Caches, exports, files and operator access are underspecified.**
- **Where:** TEN-4, TEN-8, RATE-5, PRIV-2.
- **Evidence:**
  - TEN-4 lists cache keys but not the Next.js App Router caches (data cache, full-route cache), which can serve one tenant's response to another if `fetch` or `unstable_cache` is used without a tenant key.
  - Nothing defines where exports live, how long they last, who may export clinical data, or which format is used for the 25-year handover at tenant exit.
  - Coretax XML contains buyer NIK/NPWP.
- **Fix:**
  - Rule: all `/staff/**` and `/api/v1/**` routes are dynamic with no shared cache; any shared cache must carry tenant in the key and pass a lint check.
  - Export jobs write to `exports/{tenant}/…` in the Indonesian bucket with a TTL of 24 hours or less, an audit row and clinical-export permission.
  - Define the exit format: FHIR bundle plus PDF per record, with a checksum manifest.

**P2-6. UU PDP obligations are missing or vague.**
- **Where:** PRIV-1..PRIV-9; 13 vendor checklist.
- **Evidence:**
  - No data protection impact assessment, no DPO, no defined breach deadline (PRIV-9 says "within legal deadline").
  - No transfer mechanism for XFER-1..3.
  - Controller/processor roles are not stated per data class. The clinic is controller for patient data; the vendor is controller for lead and tenant-billing data.
- **Fix:**
  - Add PRIV rows for: the impact assessment, DPO designation, a fixed breach-notification deadline in hours, a transfer mechanism per XFER, and a role table per data class.
  - Give data-subject request deadlines as numbers.
  - Each needs verification (list below).

**P2-7. The payment gateway's tenancy and money flow are undefined.**
- **Where:** BILL-17; API-1/API-4.
- **Evidence:** The kit does not say whether each clinic uses its own Midtrans/Xendit merchant account or the vendor's. It also lacks:
  - how webhooks are routed to a tenant;
  - per-tenant server-key storage;
  - what item descriptions are sent (treatment names reveal health information).
  If the vendor collects funds for clinics, payment-system licensing questions arise.
- **Fix:** Decide "merchant of record = clinic". Store keys in the tenant vault. Route via `payment_routes` (P1-5). Send generic item descriptions. Record a payment-system regulatory check (verification item 19).

**P2-8. The booking OTP and patient identity conflict with the auth stack.**
- **Where:** IAM-2 ("Patients do not have accounts"); 15 §2 ("Better Auth … phone OTP plugin"); Kliniknuma `auth_sessions` check allows `actor_kind='patient'`.
- **Evidence:** Better Auth's phone-number plugin creates user records and sessions. That contradicts IAM-2 and drags patient phones into the `auth_accounts` table, which has a global unique email and `otp_login_phone`.
- **Fix:** Build booking OTP as a custom challenge table (hashed code, TTL, tenant, attempts) with no session. Drop the plugin from 15 §2. Reference RATE-1.

**P2-9. Stack versions and platforms need re-verification.**
- **Where:** 15 §2.
- **Evidence:**
  - Node.js 22 is listed as "LTS". By November 2026 it will be in maintenance (EOL around April 2027, if Node's normal schedule holds). Kliniknuma pins `@types/node` 20.19.43 against a Node 22 runtime.
  - Coolify v4 release status and multi-server limits should be confirmed. NEEDS §3.5 already notes that multi-server deploys exclude Compose apps and persistent storage.
  - The versions in 15 §2 match `package.json`, but no registry or EOL check was done.
- **Fix:** Before pinning, verify Node 24 LTS vs 22, align `@types/node`, and confirm Coolify's support for "remote server in another country" plus a PITR sidecar. Record the results in DECISIONS.

**P2-10. Staff identity is ambiguous across tenants and roles.**
- **Where:** IAM-3 ("one account holds one role … or a role set approved by the owner"); NEEDS §4 ("One person may hold several roles (CONFIRMED)").
- **Evidence:**
  - Kliniknuma `staff_profiles.account_id` is unique and `role` is a single enum.
  - `auth_accounts.email` is globally unique.
  - Doctors often work at several clinic brands.
- **Fix:** Decide between "one account, several memberships (tenant, role, branches)" and "one account per tenant". Specify how the RLS `actor_role` is set when a person holds a role set. Add the result to P1-4's membership model.

**P2-11. Processor list is incomplete.**
- **Where:** CTX-6.
- **Evidence:** The list omits:
  - the transactional email provider (staff invitations and password reset; Kliniknuma OQ-1 extended it);
  - Cloudflare Turnstile (a third-party script on the booking page);
  - any SMS fallback.
- **Fix:** Add these as processors with location, and give each an XFER entry or a reason none is needed.

**P2-12. There is no seed and test strategy for tenancy and integrations.**
- **Where:** MIG-2, 03 §12, AGENTS-DRAFT test table.
- **Evidence:** No canonical fixture is defined, and no harness for:
  - RLS raw-SQL tests per policy kind;
  - provider fakes and recorded fixtures (Meta webhooks, SATUSEHAT sandbox, Midtrans sandbox);
  - a controllable clock for 24 h, 2×24 h, expiry and SLA rules.
- **Fix:** Add a "Test fixtures" section:
  - **Seed:** tenant A with 3 branches across WIB and WITA, tenant B with 1 branch, every role, a doctor shared across branches and tenants, a NIK-less patient and a minor with guardian.
  - **Harness:** an injectable clock, recorded provider fixtures, and a negative test per endpoint and job generated from the scope map.

### P3 — tidy-ups

1. **Settings list conflict.** PLAN §4 marks CD-10, CD-21, CD-22 and CD-27 as class S (settings), but they are not in the PR-38 list. AGENTS-DRAFT says "Settings are only the PR-38 list". Fix: align one or the other.
2. **Owners are role placeholders.** Every "Engineering, Security or Privacy owner" is unnamed. Fix: name the people, or state that the product owner fills all roles until hiring.
3. **Rename cost.** Renaming `organizations`→`tenants` and `facilities`→`branches` (DATA-10/11) touches every Kliniknuma table default (`current_setting('app.organization_id')`), function and test. If Q-01 chooses reuse, keep the physical names and change only labels.
4. **Approval gate is unticked.** `CONTEXT-RECORD.md` approval gate is fully unticked and XFER-1..3 are "Proposed". That is consistent with "In Review", but PR-36's acceptance should name the XFER status as a Phase 2 gate.
5. **ARCH rows label mismatch.** ARCH-1..3 say "Reviewed by Product owner 2026-11-02" while their status is Proposal. Fix: clarify that "reviewed" means checked against the register, not approved.

## Regulatory and platform claims that need verification

Each item lists the claim, where it is used, and the current evidence level.

1. **Permenkes 24/2022 Pasal 22.** Partner-PSE storage must be in Indonesia, with a Ministry recommendation and an NDA. Open questions: whether patient identity and booking data count as RME, and whether transient processing (Cloudflare edge, remote admin, Coolify) counts as "storage". Used in H-02, PRIV-5, PR-36. Evidence: TEXT (article read). The interpretation is INF and needs a legal opinion.
2. **Pasal 20 backup "in a different location".** Used in DR-1, H-02. Summary only; quote the exact text.
3. **The "Ministry recommendation" for a partner PSE (Pasal 22).** How it is obtained, and whether SATUSEHAT "Penyedia sistem RME (mitra)" registration satisfies it. Not covered by the research.
4. **Pasal 30(5–7) correction window.** 2×24 h; whether it applies to clinical as well as administrative errors; approval roles. Used in PR-13, CD-14. TEXT, but legal and clinical reading still pending.
5. **Pasal 39 retention.** At least 25 years from last visit, and whether that covers clinical audit logs. TEXT.
6. **Pasal 9(3) and Pasal 12.** Registration as PSE "sektor kesehatan" and RME system registration content (including **data storage location**). Changes must be reported; this affects any Singapore component.
7. **PP 28/2024 Pasal 781 and SE Menkes HK.02.01/MENKES/1030/2023.** Integration duty and sanctions. OFFICIAL summary only.
8. **PP 71/2019 Pasal 21.** Private PSE may store data abroad; whether sector rules override it. OFFICIAL summary.
9. **Permenkominfo 5/2020 jo. 10/2021.** Private PSE registration via OSS and access-blocking sanction. OFFICIAL summary; effective date "Not verified" in JUR-ID-5.
10. **UU 27/2022 obligations missing from the kit.** Impact assessment (believed Pasal 34), DPO (believed Pasal 53), breach-notice deadline (believed 3×24 hours, Pasal 46), cross-border transfer conditions (believed Pasal 56), specific-data status of health data and NIK. Article numbers are from memory and must be checked against the official text.
11. **PP 33/2026 (PDP implementing regulation) and the PDP agency's status.** SECONDARY (law-firm article). Not verified on JDIH.
12. **SATUSEHAT platform facts:**
    - Client ID/Secret valid for one Organization ID;
    - production credentials within about 3 working days;
    - whether multi-branch PTs need one organization per licensed branch;
    - minimum sandbox scope of Encounter + Condition;
    - security survey content;
    - whether patient consent is needed for any exchange.
    Source: OFFICIAL portal docs as summarised; recheck the current guides.
13. **SNOMED CT affiliate licence requirement and cost for Indonesian vendors.** Used in S-03. OFFICIAL (registration guide) and reasonably reliable; confirm Indonesia's membership status and the MLDS path.
14. **Meta WhatsApp facts:**
    - portfolio-level messaging limit starting at 250 and its scaling path (W-06);
    - number cap of 2, rising to 20 after verification (W-07);
    - Coexistence availability in Indonesia and its feature limits (W-04);
    - pricing: 1,000 free service messages per number per month from 1 Oct 2026, and IDR rates (SECONDARY, Gupshup copy);
    - Tech Provider onboarding cap of 200 per 7 days (SECONDARY);
    - webhook retry window;
    - whether Cloud API local storage can be pinned to Indonesia;
    - whether one app-level callback or per-WABA override URLs are supported.
    All DOC as of 2026-11-02 or SECONDARY; Meta changes these quarterly.
15. **Meta Business Messaging Policy on health content.** W-05, PRIV-7. DOC; recheck the current policy text.
16. **Vultr has no Indonesia region; Cloudflare Regional Services/DLS has no Indonesia region.** H-02. DOC, 2026-11-02; recheck before the provider decision.
17. **Candidate Indonesian providers' ISO 27001 scope covering the specific Jakarta facility** (H-02b). Not yet verified.
18. **Tax figures:** PMK 131/2024 (12% × 11/12 DPP), PKP threshold Rp4.8B, PP 20/2026, VAT status of beauty clinic services. Outside this review's focus; listed for completeness. OFFICIAL/SECONDARY.
19. **Payment-system regulation.** If the vendor ever collects or settles funds for clinics, Bank Indonesia payment-system licensing applies (P2-7). Not researched.
20. **Permenkes 24/2022 Pasal 26.** Patient right to record content: format, timing, whether a summary is enough. TEXT summary only.

## Verdict

**BLOCK for architecture approval and for writing TASKS.md. OK as a planning baseline.**

The kit's direction is sound: Indonesian residency, RLS backstop, outbox, append-only clinical and money records, SATUSEHAT in release 1. The P1 items fall into two groups:
- **Residency leak paths that the records describe incorrectly:** Singapore public booking, Cloudflare TLS termination, the Coolify control plane.
- **Contracts an agent would otherwise invent:** the tenancy delta against Kliniknuma's facility-strict RLS and global unique keys; cross-tenant routing and worker claim; the WABA and SATUSEHAT data contracts; the event and error catalogs, KPI dictionary and column-level schema; the Q-01/P-05 codebase contradiction.

Fixing P1-1 to P1-8 is mostly writing spec text, plus owner decisions on Q-01, the Cloudflare hostnames and where Coolify runs. After that, `prd-taskbreaker` could produce a reliable M0–M2. P2 items can be scheduled as M0 and M9 tasks. The regulatory items need counsel and platform rechecks before Phase 2.

When the kit is updated, the supervisor should run:
- `python3 ~/dotfiles/skills/local/development-spec-suite/scripts/check-traceability.py ~/Documents/work/prd/clinic-dashboard`

Once a repository exists, also run the RLS raw-SQL suite and the scope-map test.