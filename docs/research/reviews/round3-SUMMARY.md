# Round 3 multi-model review — summary (Clinic Dashboard kit v0.4)

- Date: 2026-11-02 (Asia/Jakarta). Owner: Paduka Ongki. Scope: documents only, no development authorized.
- Kit: `~/Documents/work/prd/clinic-dashboard/` (25 files). Final validation after all fixes: `check-traceability.py` **PASS, 488 declarations, 0 findings**; `dotuiux validate` PASS.
- Backups: `/data/backups/clinic-dashboard-kit/` (v0.2, v0.3, v0.4, v0.4r3).

## Reviewers

| ID | Model | Focus | Verdict | Findings (P1) | Report |
|---|---|---|---|---|---|
| R3-A | cc/claude-opus-5-5 | Business model, vendor platform, server fee, payment port, discounts | PASS-WITH-FIXES | 18 (3) | `round3-review-1-vendor-money.md` |
| R3-B | cc/claude-opus-5-5 | Multi-tenant isolation, IAM, vendor access, security | PASS-WITH-FIXES | 24 (5) | `round3-review-2-tenancy-security.md` |
| R3-C | cc/claude-opus-5-5 | Clinic workflow, screens, hand-off map, public site | PASS-WITH-FIXES | 16 (2) | `round3-review-3-clinic-ux-public-site.md` |
| R3-D | cx/gpt-6.1-sol | Data model end to end (FK chain, scope map, idempotency, import) | BLOCK → fixed | 15 (10) | `round3-review-4-data-model-gpt-sol.md` |
| R3-E | cx/gpt-6-astra | Indonesian regulation: privacy (part 1); SATUSEHAT, downtime, pharmacy, credentials, security (part 2) | HOLD / BLOCK → fixed | 9 + 13 (3 + 10) | `round3-review-5-regulatory-gpt-astra.md` |
| R3-F | cc/claude-fable-5-1 | Readiness for AI coding agents, Release 1 scope, owner understanding | READY-WITH-FIXES | 18 (5) | `round3-review-6-agent-readiness-fable.md` |

Three delegate runs stopped early (turn or context limits); they were rerun with narrower reading or as direct `pi -p --tools read` runs until each produced a complete report. Partial outputs are kept in the report files for transparency.

## Additional research during the round (main agent, web)

- **Permenkes 1787/2010** (health-service advertising) confirmed in force (JDIH Kemenkes); Pasal 4, 5, 8, 10 read. Consequences: no testimonials, no advertised discounts, no superlatives or comparisons, health workers never as advertising models → public site and promo rules changed (JUR-ID-7, PR-40, PR-65, PR-66, PR-77, PRIV-17).
- **Permenkes 11/2017** (patient safety) in force → incident register duties (JUR-ID-8, PR-82).
- **Midtrans notification** pattern (SHA512 signature, idempotent handling) matches the payment-port contract (TD-41, TD-43).

## What changed in the kit (by theme)

1. **Hierarchy and database** — platform hierarchy diagram (05 §2.1); identity chain 1:1 membership:staff with composite tenant FKs (DATA-55); relationship and constraint contract for every link (05 §3.1); per-table scope map (TEN-19); routing tables (DATA-57); opening-data import for the first client without fake sales/VAT/commission (DATA-58); domain events and consumer receipts (DATA-59); mandatory audit attribution incl. acting role and vendor session (DATA-60); idempotency with request fingerprint (DATA-45).
2. **Vendor access** — onboarding invitations are owner-confirmed drafts; vendors never assign Level 2 roles; imports are owner-started and count-only for vendor; processor agreement before onboarding; owner approval for any session touching clinical or specific personal data; reads in sessions audited and shown to the owner; infrastructure break-glass governed (SEC-20); vendor console on its own host (SEC-21); dual vendor/clinic identities need two approvals.
3. **Roles** — Admin Pusat cannot grant Level 2 roles or change its own; role-aware RLS (TEN-18); branch scope per acting role (IAM-9); TOTP for all tenant-wide roles; account recovery (IAM-15) and revocation within 60 s (IAM-16); STR vs facility-specific SIP (IAM-4).
4. **Money** — mock payments never satisfy payment gates and are hidden in production; server-fee invoices, payment attempts, waivers, credit notes, proration formula, VAT/withholding questions (BILL-20, BILL-31–BILL-33); discount rules per line and approver cap (BILL-28); posting rows for supplier returns and petty cash.
5. **Clinic workflow** — hand-off map extended with 11 situations (no-show, reschedule, interrupted treatment, control, consultation only, package session, counter sale, service complaints); appointment states (PR-83); branch/brand switch (PR-84); merge and import (PR-85); complaint split Klinis/Layanan; counter sale and invoice void; 21 screen contracts added; Admin Pusat home (UX-57).
6. **Regulation and safety** — residency gate requires a favourable legal opinion; breach notice to patients and authority; neutral WhatsApp care messages with protected aftercare links; lawful-basis matrix; retention schedule; DPIA before any real data; SATUSEHAT facility-context invariant, identity states, per-resource sync ledger, `outcome_unknown` reconciliation, version-bound amendments, terminology register; clinical downtime SOP; pharmacy dispensing controls (quarantine, recall, special drugs excluded); hash-chained, content-free audit; clean-room key-escrow restore drill.
7. **Agent readiness** — gates G0–G3 defined; milestones for every Must; Release 1 boundary sentence; AGENTS-DRAFT safety rules; state copy patterns; who-is-who table; first-commit contents; `00-OVERVIEW.md` (one page in Indonesian for the owner).

## Decisions added to DECISION-REGISTER

P-11–P-20 (platform, levels, clinic-not-shop, server fee, roles, vendor console, public site, research gaps, validation, Numa Klinik first client), H-10 (payment port), B-22 (settings list extended), B-23 (tender feature flags).

## Open items for the owner (PRD §13)

| ID | Question | Needed before |
|---|---|---|
| Q-18 | Narrow Release 1 for one pilot clinic (R3-F list in PLAN) or keep the full Must set | TASKS.md (G1) |
| Q-12 | Clinic-job validation at Numa Klinik (changes at most 7 PRs) | PRD approval for those PRs |
| Q-17 | Regulatory verification pack (RME, SATUSEHAT, PSE, licensing, patient safety, pharmacy, waste, VAT, breach/DPO) | PRD approval (G1) |
| Q-19 | SATUSEHAT guide details (identity pathways, conditional create, corrections, terminology releases) | M7 |
| Q-13, Q-16 | AutoLaris settlement status; PPh 23, channel fee, Numa pilot billing | First invoice |
| Q-14 | Patient payment gateway partner | Online payments in a live tenant |
| Q-15 | Counsel on Permenkes 1787/2010 for tariffs, titles, before/after, direct promo messages | First public site publish |
| Q-03, Q-04/H-02d, Q-05, Q-06, Q-07 | Vendor entity, data location opinion, tax adviser, accountant, clinical authority matrix | G0 / G2 / M2 / M4 |

## Remaining honest limits

- All legal items marked "verify" are knowledge-based or secondary unless a JUR-ID record shows the article read; counsel must confirm.
- Role jobs remain assumptions until Numa validation (Q-12).
- No reviewer saw a running system; every control is a planning contract (status Proposal).

## Round 4 (navigation and page catalogue, `19`) — 2026-11-02

| Reviewer | Model | Verdict | Report |
|---|---|---|---|
| R4-A | cx/gpt-6.1-sol | BLOCK → fixed | `round4-review-a-navigation-gpt-sol.md` |
| R4-B | cc/claude-opus-5-5 | PASS-WITH-FIXES → fixed | `round4-review-b-navigation-opus.md` |

Applied in kit v0.6: every former Should became Must (P-24; campaign sending waits for Q-15, journal export for the posting map); new Master Layanan (PR-88), depots (PR-89), supplier payables (PR-90), access administration (PR-91), privacy workspace (PR-92), family package sharing switch (PR-93, amends B-03), automation scenarios (PR-94), extra reports and KPI dictionary page (PR-95), instalment schedules (PR-96); Pengaturan menu in the tree (§2.17) and landing page per role (§2.18); phone tab = Menu with search, tablet focus mode, desktop command palette; role visibility reconciled with 07 (BC plan projection, manager service complaints, facility-head credential verification and clinical templates, settings authority per SET group); settings SET-38–SET-46 added, bounds and provenance fixed, fixed rules listed (idle lock, queue TV without names, gap-free numbering, delegation floor, prices > 0, PPN rate, retention, balance never expires, maker-checker). Validation: PASS, 26 files, 499 declarations.
