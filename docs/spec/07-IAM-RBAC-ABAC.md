# IAM — Roles and Access — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Security owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |

## Requirements

| ID | Requirement | Owner | Verification | Status |
|---|---|---|---|---|
| IAM-1 | Staff sign in with email + password (≥ 15 chars, blocklist, throttle); owner, Admin Pusat, manager, doctor, finance, facility head, records officer, internal auditor, central CS and every vendor role require TOTP; staff accounts by invitation only | Security owner | Auth tests | Proposal |
| IAM-2 | Patients have no accounts in Release 1; public booking verifies the phone with a custom OTP challenge (hashed code, TTL, attempts, tenant) sent as a WhatsApp authentication template (W-11); no session is created | Security owner | OTP tests | Proposal |
| IAM-3 | One login account may hold memberships in several tenants; within a tenant a person is one staff identity with an owner-approved role set; every action records staff and acting role (B-19) | Product owner (Paduka Ongki) | Membership tests | Proposal |
| IAM-4 | Clinical credentials are modelled separately: registration (STR: type, issuer, status, expiry nullable for non-expiring STR — verify current regime) and **facility-specific practice permission** (SIP/SIPP/SIPA: profession, scope, the branch/facility it is valid for, expiry, verification evidence) plus competence; verified by someone other than the inviter; clinical acts at a branch require a valid permission for that branch and competence; suspension or revocation blocks immediately; IHS practitioner ID is an identifier, not authorization evidence | Clinical lead | Licence tests | Proposal |
| IAM-5 | Access decisions combine role set, branch scope, visit assignment and purpose; UI visibility is never the control | Security owner | Policy tests | Proposal |
| IAM-6 | Doctor break-glass read outside assignment: reason ≥ 15 chars, 60 minutes, audited, facility head notified | Clinical lead | Break-glass test | Proposal |
| IAM-7 | Front-desk sessions lock after 120 s idle (fixed default, B-16); unlock by password re-check | Security owner | Idle-lock test | Proposal |
| IAM-8 | Facility head (Penanggung Jawab Klinik) and records officer (Perekam Medis) are roles scoped to a **branch set** (each licensed branch has its own Penanggung Jawab; one person may cover several branches or the whole brand where the licence allows — confirm at Numa, Q-12): they set clinical access policy for their branches, approve late record corrections and review the audit log | Clinical lead | Role tests | Proposal |
| IAM-9 | Control levels: Level 1 vendor roles live only in the vendor console and never hold clinic memberships implicitly; Level 2 roles hold all branches of their tenant; Level 3 roles hold their branch(es) through `staff_branches`; branch scope is evaluated per acting role — Level 2 roles use all current and future branches (wildcard, never a stored list), Level 3 roles use `staff_branches` for that role; `app.allowed_branch_ids` is set from the acting role (P-12, TEN-11, B-20) | Security owner | Membership tests | Proposal |
| IAM-10 | Vendor roles: platform owner, onboarding specialist, support operator, vendor finance, vendor auditor; all need TOTP; console reachable from an IP allowlist; requester ≠ approver for clinical-data grant, suspension, exit, server-fee change and invoice waiver; an account may hold both a `vendor_staff` row and a clinic membership only with platform-owner approval **and** that clinic owner's approval; the dual identity is listed permanently in that tenant's Akses Vendor; the person acts with one identity at a time and every action records which; go-live needs ≥ 2 vendor staff so maker and checker differ; suspension is requested by vendor finance or support and approved by the platform owner (PR-57) | Security owner | Vendor auth tests | Proposal |
| IAM-11 | Admin Pusat holds tenant-wide configuration (branches, catalog, staff invitations, settings drafts, public site, templates, reminder rules) and may assign Level 3 roles; assigning or removing Owner, Admin Pusat, Finance, Facility head, Records officer or Internal auditor needs owner approval (requester ≠ approver); nobody changes their own role set. Admin Pusat never holds the owner-only powers: branch price overrides, cash-refund and write-off approval, commission batch approval, tenant export, vendor clinical-access approval (PR-63) | Product owner (Paduka Ongki) | Role tests | Proposal |
| IAM-12 | Marketing, Purchasing and Internal auditor are tenant-wide roles with no clinical projection; auditor is read-only on every object; auditor and purchasing projections show patient-linked stock and receipt rows with masked patient reference and no free-text reasons; data-subject request content is hidden unless the data-protection duty is assigned (PR-63) | Security owner | Projection tests | Proposal |
| IAM-13 | Data-protection and IT-admin duties are assignments on Owner or Admin Pusat (not roles), granting data-subject requests, breach register and integration status (P-15, PRIV-12) | Privacy owner | Duty tests | Proposal |
| IAM-14 | Manual discount limits per role (percent and rupiah) are a tenant setting; above the limit the discount needs an approver ≠ requester (PR-72) | Finance owner | Discount tests | Proposal |
| IAM-15 | Account and factor recovery: lost TOTP or privileged account recovery needs identity verification, approval by a different authorized person (platform owner for vendor roles, owner for clinic roles), a short-lived recovery grant, factor re-enrolment, notification to the account holder and owner, and post-use review; no unlogged permanent account is ever created | Security owner | Recovery tests | Proposal |
| IAM-16 | Revocation: suspending staff, ending a membership, removing a role or branch, resetting a factor, a compromised-credential flag or ending a support session invalidates affected sessions, cached permissions and temporary grants within 60 seconds; tests cover an already-open session losing access | Security owner | Revocation tests | Proposal |

## Role Matrix

● full · ◐ limited/own · – none. Clinical content never visible to non-clinical roles.

| Capability | Owner | Admin Pusat | Manager | Facility head | Records officer | FO/cashier | Central CS | BC | Doctor | Nurse | Therapist | Pharmacist | Finance | Marketing | Purchasing | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tenant/branch settings (Pengaturan, 19 §5) | ● | ◐ (operational SET groups directly; money and clinical SET groups as drafts for Owner/facility head) | ◐ (branch operational SET rows) | ◐ (clinical SET group) | – | – | – | – | – | – | – | ◐ (stock SET group; SET-48 proposals) | – | ◐ (public-site SET group) | ◐ (stock SET group) | – |
| Staff & invitations | ● | ◐ (Level 3 roles; others need owner approval) | ◐ | ◐ (verify clinical credentials) | – | – | – | – | – | – | – | – | – | – | – | – |
| Catalog & branch prices | ● | ◐ (no price override) | ◐ (no price override) | ◐ (clinical review) | – | – | – | – | – | – | – | ◐ (materials) | – | – | – | – |
| Patient identity | ● | ◐ | ● | ● | ● | ● | ◐ | ◐ | ● | ◐ | ◐ | ◐ | ◐ | ◐ (consented contacts) | – | – |
| Booking & schedule | ◐ | ◐ | ● | – | – | ● | ● (tenant-wide) | ◐ | ◐ | ◐ | ◐ | – | – | – | – | – |
| Staff schedules | ● | ● | ● | – | – | – | – | – | – | – | – | – | – | – | – | – |
| Intake / observasi kulit | – | – | – | – | – | – | – | ● | ● | – | – | – | – | – | – | – |
| Plan options & prices (no assessment, diagnosis, dose or rationale) | – | – | – | – | – | ◐ (view) | – | ● | ● | ◐ (items of assigned visit) | ◐ (items of assigned visit) | – | – | – | – | – |
| Examination, plan, sign | – | – | – | ◐ | – | – | – | – | ● | – | – | – | – | – | – | – |
| Clinical requests decide | – | – | – | ● | – | – | – | – | ● | ◐ (delegated) | – | – | – | – | – | – |
| Complaint tasks | – | – | ◐ (service complaints only, no clinical content) | ● | – | ◐ (flag, status only) | ◐ (flag, status only) | ◐ (flag) | ● | ● | – | ● | – | – | – | – |
| Treatment checklist | – | – | – | – | – | – | – | – | ● | ● | ● (non-invasive) | – | – | – | – | – |
| Prescribe / dispense | – | – | – | – | – | – | – | – | ◐ (prescribe) | – | – | ● | – | – | – | – |
| Stock & purchasing | ◐ | ◐ | ● | – | – | – | – | – | – | ◐ | ◐ | ● | ◐ | – | ● | ◐ (read) |
| Cashier & receipts | ◐ | – | ● | – | – | ● | – | ◐ (quote) | – | – | – | – | ◐ | – | – | ◐ (read) |
| Cash refund approval | ● | – | ◐ (if tenant setting) | – | – | – | – | – | – | – | – | – | – | – | – | – |
| Write-off approval | ● | – | – | – | – | ◐ (request) | – | – | – | – | – | – | ◐ (request) | – | – | – |
| Late record correction approval | – | – | – | ● | ● | – | – | – | – | – | – | – | – | – | – | – |
| Commission rules & batches | ● | – | ◐ | – | – | – | – | – | – | – | – | – | ◐ (prepare) | – | – | ◐ (read) |
| Own commission & target | – | – | ◐ | – | – | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | – | – | – | – |
| WhatsApp inbox | ◐ | – | ● | – | – | ● | ● | ● | – | – | – | – | – | ◐ (templates, lead reports) | – | – |
| Dashboards | ● | ● | ● (branches) | ◐ | – | ◐ | ◐ | ◐ | ◐ | – | – | ◐ | ● | ◐ (K13, K14) | ◐ (K18) | ◐ (read) |
| Ledger, periods, exports | ◐ | – | – | – | – | – | – | – | – | – | – | – | ● | – | – | ◐ (read) |
| Audit log, data requests | ● | ◐ (if duty assigned) | – | ● | ◐ | – | – | – | – | – | – | – | – | – | – | ◐ (read) |
| Tenant data export | ● | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| SATUSEHAT monitor | ● | ◐ | ● | ● | ◐ | – | – | – | ◐ | – | – | – | – | – | – | – |
| Public site & promos | ● | ● | – | – | – | – | – | – | – | – | – | – | – | ● | – | ◐ (read) |
| Templates & reminder rules | ● | ● | ◐ (view; aftercare text proposals) | ● (clinical templates, delegation, aftercare text) | – | – | ◐ (send log, read) | – | – | – | – | – | – | ◐ (marketing templates; automation scenarios as SET-19 drafts) | – | – |
| Manual discount above limit (approve) | ● | – | ● | – | – | – | – | – | – | – | – | – | – | – | – | – |
| Server-fee invoices (view, pay) | ● | ◐ (view) | – | – | – | – | – | – | – | – | – | – | ● | – | – | ◐ (read) |
| Vendor access (Akses Vendor) | ● | ◐ (view) | – | – | – | – | – | – | – | – | – | – | – | – | – | ◐ (read) |
| Compliance register (PR-97) | ● | ◐ (read) | – | ◐ (clinical items) | – | – | – | – | – | – | – | – | ◐ (tax and accounting items) | – | – | ◐ (read) |

Vendor (Level 1) is not in this matrix: it has no clinic capability; tenant data only through support sessions (PR-60, TEN-6).
