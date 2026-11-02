# Round 2 Review: Clinic Dashboard kit v0.2 (architecture, tenancy, security, privacy, integrations, ops/DR)

I read the files listed in the brief, plus `02-PRD.md`, `README.md` and the relevant `11` rows. I checked them against `DECISION-REGISTER.md` and my round 1 review. Nothing was edited and no commands were run.

## 1. Verdict

**PASS-WITH-FIXES.** The round 1 blockers are resolved in the text:
- tenancy policy kinds and memberships (06, TEN-9–11);
- platform routing tables;
- the WhatsApp (18 TD-20–27), SATUSEHAT (TD-30–34) and payment gateway (TD-40–41) contracts;
- the event catalog (TD-50), error catalog (TD-51) and KPI dictionary (PRD Appendix A);
- the corrected Cloudflare record (H-02c, XFER-2);
- the move to a codebase from zero (P-09), applied everywhere.

The owner's decisions (H-02b, S-04, P-09) are reflected in 01, 02, 04, 13, 15, `AGENTS-DRAFT.md` and `README.md`. Two P1s still need to be fixed before architecture approval or writing `TASKS.md`. Both are text-only fixes:
- the go-live gate (ARCH-10) is incomplete;
- the key custody claim (KEK kept outside Coolify) does not hold.

A few leftover contradictions remain (P2/P3 below).

## 2. Prior findings

| ID | Status | Evidence |
|---|---|---|
| P1-1 Singapore public booking | **Closed** (moot under H-02b) | The 04 §1 diagram routes the booking host through the Cloudflare proxy to the production app. No separate public-booking node remains. |
| P1-2 Cloudflare described wrongly | **Partially** | H-02c, ARCH-3, SEC-4 and XFER-2 are now accurate. Still open: the origin can be reached directly, bypassing Cloudflare (N-3), and Meta webhook content passes through the edge (N-4). |
| P1-3 Coolify reach | **Partially** | H-05, ARCH-6, ARCH-7, SEC-6 and trust boundary 5 are in place. But Coolify's root SSH access defeats the "KEK outside Coolify" claim (N-2), and the kit does not say whether Coolify's built-in database backups are disabled. |
| P1-4 Tenancy model | **Closed** | 06 policy-kinds table; TEN-10 composite unique keys; TEN-11 memberships; a scope class on every 05 entity; PLAN §2 "Not repeated". |
| P1-5 Requests with no tenant context | **Closed** | TEN-5, TEN-6, TEN-9, ARCH-8, ADR-6, with negative tests for unknown IDs and spoofed slugs. |
| P1-6 WhatsApp contract | **Closed** | 18 TD-20–27: onboarding state machine, token vault, webhook routing, media, Coexistence, budget, OTP sender, BSP fallback. |
| P1-7 SATUSEHAT contract | **Closed** (one note, N-8) | TD-30–34; DATA-8, DATA-12, DATA-13, DATA-40; KFA and ICD-9-CM codes. |
| P1-8 Missing build contracts | **Closed** | P-09 decided; TD-50 and TD-51; Appendix A K1–K19; the 05 key columns; `openapi.yaml` skeleton is the first API task (API-1). |
| P2-1 Inbound WhatsApp is health data | **Partially** | W-10, SEC-14, PRIV-1 and TD-23 are in place. Still missing: a retention period for messages and media (05 §5 has none) and webhook transit through Cloudflare (N-4). |
| P2-2 Error tracking / APM / log SaaS | **Closed** | H-08, OBS-1, OBS-6, SEC-10, SEC-13. |
| P2-3 Outbox payloads | **Closed** | ARCH-5, TD-33, the TD-50 acceptance check, `AGENTS-DRAFT.md`. |
| P2-4 Backup/DR | **Partially** | pgBackRest, object versioning and DR-4 are in place. Missing: who holds the pgBackRest encryption key, which country the backups are in (N-5), and whether the drill environment counts as production. |
| P2-5 Caches and exports | **Partially** | 24 h export expiry and PR-52 manifest are in place. The TEN-4 route pattern is wrong (N-6). |
| P2-6 UU PDP obligations | **Partially** (acceptable pending counsel) | PRIV-9 and PRIV-11–13 added. Request deadlines are still "set by counsel". |
| P2-7 Payment gateway tenancy | **Closed** | H-09, TD-40, BILL-17, SEC-15. |
| P2-8 Booking OTP vs auth stack | **Closed** | IAM-2 and the 15 §2 auth row (custom OTP table, not a Better Auth plugin). |
| P2-9 Version checks | **Partially** | Node version verification is noted. Checking Coolify v4 remote-server support and running pgBackRest as a sidecar is not listed as an M0 check. |
| P2-10 Multi-role staff | **Closed** | TEN-2 `app.roles`, TEN-11, IAM-3, B-19. |
| P2-11 Processor list | **Open** | CTX-6 still lists "Indonesian host". It omits the transactional email provider, the backup storage provider and the vendor's own WhatsApp account used for OTP (TD-26). |
| P2-12 Test fixtures | **Closed** | 05 §6. |
| P3-1 Settings list | **Closed** | CD-10, CD-21, CD-22 and CD-27 are now class F (fixed). |
| P3-2 Unnamed owners | **Open** | Owners are still role placeholders. |
| P3-3 Rename cost | **Closed** (moot under P-09) | — |
| P3-4 Transfer records as a gate | **Closed** | Phase 0 entry criteria and PRIV-6. |
| P3-5 ARCH "reviewed" label | **Closed** | Rows now say "Checked against". |

## 3. New findings

### P1

**N-1. The go-live gate (ARCH-10, PR-36) is incomplete and inconsistent.**
- **Where:** 04 ARCH-10 (L47); 02 PR-36 (L160) and its scenario (L416–421); PR-55 (L179).
- **Problem:**
  - ARCH-10 checks only "the declared **database** location". PR-36 says "locations are Indonesian" (all of them). Pasal 20 covers backups too, and H-07 backups go to "another region", which cannot be Indonesia on Vultr.
  - No requirement says where the flag lives, who may set it, what evidence it needs, or where it is enforced. The PR-55 field list has no flag field.
- **Fix text:** add ARCH-10a:

  > "The vendor profile holds `residency_opinion_ref`, `opinion_date`, `opinion_outcome` and `set_by`. The flag is set only by the product owner, with the opinion file's checksum, and is audited. When the flag is unset, enforcement covers: tenant activation (PR-53), patient creation and public booking in the production environment. The location check covers the database, object storage, backups, logs and error tracking, read from deployed configuration rather than typed in by hand."

  Then:
  - add these fields to the PR-55 field list;
  - add a negative scenario to PR-36: "flag unset + backup target outside Indonesia → activation refused".

**N-2. The claim that the KEK is outside Coolify is misleading.**
- **Where:** H-06; 04 ARCH-6 and ARCH-7 (L43–44); 12 SEC-6; 04 §4 item 5.
- **Problem:** Coolify connects over SSH with root-equivalent rights. A root-only sealed file on the production host can therefore be read by anyone who controls Coolify. The control as written does not separate Coolify from the KEK.
- **Fix text:** add to ARCH-6:

  > "The Coolify instance is tier-0: compromising it equals compromising production, including the KEK. Controls: IP allowlist + MFA, no other workloads, OS and Coolify patching SLA, auditd on KEK file access (feeds the OBS-4 alert), Coolify built-in database backups disabled. Use a non-root SSH deploy user where Coolify supports it. Move the KEK to a KMS when the provider offers one."

  Then amend H-06's wording in the decision register to match.

### P2

**N-3. The origin can be reached directly, bypassing Cloudflare.**
- **Where:** ARCH-3, SEC-4.
- **Problem:** The app host is DNS-only, so its DNS record exposes the origin IP. Both hosts sit on the same origin, so an attacker can send requests with `Host: <booking host>` straight to that IP. This skips the Cloudflare WAF and DDoS protection on the booking host, and Turnstile too if it is checked only at the edge.
- **Fix text:**

  > "The booking-host vhost accepts only Cloudflare Authenticated Origin Pulls (mTLS) or Cloudflare IP ranges. Turnstile tokens are verified server-side. The origin WAF and rate limits apply to both vhosts."

  Also name the origin WAF component.

**N-4. Inbound WhatsApp content crosses the Cloudflare edge.**
- **Where:** TD-22 ("one app-level callback on the booking host"); API-1; XFER-2 data categories.
- **Problem:** Meta webhook bodies carry patient message text and media IDs, which are possibly specific personal data under W-10. XFER-2 lists "Meta and gateway webhook payloads" without saying that.
- **Fix:** Preferred: move `/api/v1/webhooks/meta` to the DNS-only app host. Authenticity already comes from the `X-Hub-Signature-256` check. Otherwise, add "inbound message content (possibly health data)" to the XFER-2 data categories and to the R-01 counsel question.

**N-5. The cross-border transfer records describe the wrong parties and leave out the backup country.**
- **Where:** CONTEXT-RECORD XFER-1 (L115).
- **Problem:**
  - The importer is listed as "Vendor … Singapore". In fact the vendor (an Indonesian PT) is the processor, and Vultr is the sub-processor hosting in Singapore. Vultr's contracting entity and its country need verifying.
  - Backups go to "a separate location" with no country named.
- **Fix:**
  - List Vultr as a sub-processor with its legal entity and country.
  - Add XFER-4 for the backup target country, or require that backups stay in Singapore in a separate facility.
  - Record who holds the pgBackRest encryption key (escrowed alongside the KEK).
  - State that the DR-2 drill environment is classed as production and is destroyed after the drill.

**N-6. The cache rule in TEN-4 names a route that does not exist.**
- **Where:** 06 TEN-4 (L19).
- **Problem:** TEN-4 says "all `/app/**` and `/api/**` responses are dynamic". The staff routes are `staff/**` (15 §3, 09). An agent applying TEN-4 literally would leave the staff UI cacheable across tenants.
- **Fix text:**

  > "`/staff/**`, `/api/v1/**` and `/{tenant}/booking/**` are dynamic with no shared cache; any shared cache key includes `tenant_id`; a lint check fails on `unstable_cache` or `fetch` cache without a tenant key."

**N-7. Leftover contradictions after H-02b.**
- **03 §2 L20:** "Vultr Singapore + Coolify + Cloudflare **for non-clinical** (H-01)". Change to "for all environments including clinical data (H-02b), residency-portable (ARCH-9)".
- **CTX-6 (L24):** "Indonesian host". Replace with the actual processor list (see P2-11).
- **DECISION-REGISTER W-10:** still says inbound messages are "stored only in **Indonesia**". The kit's SEC-14 correctly says "production database and bucket". Because the register wins over the kit, amend W-10 to "stored only in the production environment (H-02b)".
- **CTX-2:** the recheck trigger "S-04 decided" is outdated. Change it to "vendor entity named (placeholder replaced)".

**N-8. Where the SATUSEHAT Location ID lives is inconsistent.**
- **Where:** TD-31 says each room is a SATUSEHAT Location. DATA-11 puts `satusehat_location_id` on `branches`, and 05 has no `rooms` entity.
- **Fix:** add a `rooms` / `devices` entity (branch-scoped) with `satusehat_location_id`. Keep `satusehat_org_id` on branches.

### P3

- **README kit table is out of date:** it lists TEN-1–8, IAM-1–7, SEC-1–12, PRIV-1–10, DR-1–3, OBS-1–5, ADR-1–4, PR-1–54, and "05 deltas against Kliniknuma DATA-1–29". The PLAN header also says PR-1–PR-54. Update all of these.
- **15 §3 omits doc 18:** `docs/spec/ ← (01–17, …)` should include 18.
- **Environment vs tenant migration:** ARCH-9 says "migrates an environment" but PR-36 says "tenant environment". In a shared database the whole environment moves, not one tenant. Align the wording, and add KEK transfer to the runbook.
- **Vendor WhatsApp account for OTP (TD-26):** the vendor processes patient phone numbers for tenants without their own WhatsApp account. Add this to the PRIV-13 role table.
- **`AGENTS-DRAFT.md` lacks the hostname rules:** add "never serve staff/clinical routes on the proxied booking host; never enable the Cloudflare proxy on the app host".

## 4. Recommendations for still-open and ADOPTED-REC items

| Item | Recommendation |
|---|---|
| H-02d (OPEN, gate) | Brief counsel with the corrected XFER-1, XFER-2 and new XFER-4 (N-5) and the Pasal 12 declaration. Have the gate enforced by ARCH-10a (N-1). |
| H-02c (ADOPTED-REC) | Keep. Add origin protection (N-3) and move the Meta webhook to the app host (N-4). |
| H-05 / H-06 (ADOPTED-REC) | Amend the wording to treat the Coolify instance as tier-0 (N-2), and add Coolify's root reach to the counsel and security records. |
| H-07 (ADOPTED-REC) | Name the backup country; if residency moves to Indonesia, backups must move too (Pasal 20). Escrow the pgBackRest key. |
| H-08 / H-09 (ADOPTED-REC) | Keep as written. |
| W-04 (Coexistence) | Keep. Before M6, re-check that Coexistence is available in Indonesia and its feature limits (Q-11 item 14). |
| W-09 (BSP fallback) | Keep. The BSP is an extra processor, so add it to CTX-6 and to the transfer records when it is chosen. |
| W-10 / W-11 | Amend W-10's location wording (N-7). Add a retention period for messages and media to 05 §5. Record the vendor WhatsApp account's role (P3). |
| PD-02 / PD-03 | PD-02 stays OPEN as Q-08. PD-03 is done in the text (PRIV-11–13); the article numbers still need counsel. |
| S-04 / PR-55 | Correct as written. Add the residency flag fields to PR-55 (N-1). |
| P2-11 / P3-2 | Update CTX-6. Name the people for each owner role, or state that the product owner holds all of them. |

**Commands for you to run after the fixes:**
- `python3 ~/dotfiles/skills/local/development-spec-suite/scripts/check-traceability.py ~/Documents/work/prd/clinic-dashboard`
- a search across the kit for "non-clinical", "Indonesian host" and `/app/**`, which should return nothing.