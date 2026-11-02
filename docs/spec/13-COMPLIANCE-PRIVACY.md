# Compliance and Privacy — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Privacy owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Source research | `docs/research/COMPLIANCE-TAX-ACCOUNTING-SATUSEHAT-PSE-RESEARCH.md`; claims to verify: `reviews/review-2-architecture-security.md` (regulatory list) |

Maps obligations to engineering controls. Not legal advice; qualified review required (BRD §4). Article numbers marked "verify" come from memory or secondary sources.

## Requirements

| ID | Obligation → control | Owner | Source | Status |
|---|---|---|---|---|
| PRIV-1 | Classification vs lawful basis are separate. Security class: health data, clinical photos, inbound WhatsApp content are treated as specific personal data; NIK is protected as sensitive. Lawful basis per purpose (matrix below): care and mandatory RME records = legal obligation of the facility (no consent needed, cannot be withdrawn); optional purposes (marketing, clinical photo for teaching, publication) = consent with history and withdrawal; withdrawal stops optional processing and never deletes retained records | Privacy owner | UU 27/2022 Pasal 4, 20 (verify); JUR-ID-1 | Proposal |
| PRIV-2 | Data-subject requests (PR-50) follow a counsel-validated matrix: right, statutory deadline, identity or representative check, responsible role, exceptions, delivery evidence; demographic correction edits the patient record, clinical correction is an append-only addendum under PR-13 that keeps authorship and the original | Privacy owner | UU 27/2022; Permenkes 24/2022 Pasal 26, 30 (verify) | Proposal |
| PRIV-3 | Retention schedule per class: RME and clinical photos ≥ 25 years from last visit (Permenkes 24/2022 Pasal 39, text verified); financial and tax records per tax/accounting rules (verify with accountant, CD default 10 years); audit ≥ 25 years for clinical-access events; communications and leads per tenant policy; rejected uploads and temporary exports short-lived; legal hold possible; disposal only after the period, authorized and recorded; suspension or exit never erases required records | Privacy owner | Permenkes 24/2022 Pasal 39; tax rules (verify) | Proposal |
| PRIV-4 | Leads never treated: retained for a tenant-defined period; deleted on request | Privacy owner | UU 27/2022 | Proposal |
| PRIV-5 | Owner decision H-02b stores production data in Singapore with risk accepted; before the first real patient record, a written legal opinion that **concludes the actual deployment (database, object storage, backups, logs, error tracking, DR and support access) is lawful** under Pasal 20 and 22 (H-02d), or a tested migration to an Indonesian location (PR-36); an adverse or inconclusive opinion fails the gate; owner risk acceptance cannot replace it; facility retains unlimited access and export (PR-52) | Privacy owner | Permenkes 24/2022 Pasal 20, 22; H-02b, H-02d | Proposal |
| PRIV-6 | Cross-border records XFER-1–XFER-3 reviewed by counsel before production | Privacy owner | UU 27/2022 transfer rules (verify article) | Proposal |
| PRIV-7 | WhatsApp: opt-in for marketing recorded, purpose stated, opt-out honoured; templates never carry diagnosis, procedure names, doses or photos; promotional templates (including discounts) stay disabled until counsel confirms the position under Permenkes 1787/2010 for direct messages (Q-15) | Privacy owner | Meta policy; JUR-ID-7 | Proposal |
| PRIV-8 | Processor agreement + NDA per clinic: roles, access, residency, breach notice, exit | Privacy owner | Permenkes 24/2022 Pasal 22(2–3) | Proposal |
| PRIV-9 | Breach procedure: vendor detects and escalates to the clinic (controller) within 24 h of awareness; the controller notifies data subjects and the authority in writing within 3×24 h with the content the law requires (UU 27/2022 Pasal 46, verify); incident timestamps, recipients, notice content and delivery evidence kept in the breach register; contractual escalation targets are separate from statutory deadlines | Privacy owner | UU 27/2022 Pasal 46 (verify) | Proposal |
| PRIV-10 | No session replay or third-party pixels on health-intent pages; marketing pixels after consent only | Privacy owner | Decision D-12 | Proposal |
| PRIV-11 | A completed DPIA gates any real-patient processing (booking, clinical records, photos, WhatsApp) regardless of release phase | Privacy owner | UU 27/2022 Pasal 34 (verify); PD-03 | Proposal |
| PRIV-12 | DPO applicability recorded separately for the vendor and for each clinic (contact, competence, independence, shared-service arrangement allowed if the law permits); the vendor designates its DPO | Privacy owner | UU 27/2022 Pasal 53–54 (verify); PD-03 | Proposal |
| PRIV-13 | Role per data class: clinic = controller for patient, clinical, CRM and staff data; vendor = processor for those (including OTP sent from the vendor WhatsApp account for tenants without their own WABA, TD-26) and controller for tenant billing and vendor-lead data; Vultr, backup storage, email provider, Cloudflare, Meta and any BSP are sub-processors listed in CTX-6 | Privacy owner | PD-03 | Proposal |
| PRIV-14 | Doctor listing on the public site needs recorded consent of the doctor; withdrawal unpublishes the profile and purges the edge cache immediately (PR-66) | Privacy owner | UU 27/2022 | Proposal |
| PRIV-15 | Appointment reminders and aftercare are care communication under the facility's legal basis, not marketing consent; WhatsApp texts stay neutral (clinic, branch, date and time, "perawatan Anda"), never the service or procedure name, diagnosis or photos; detailed aftercare is opened through a short-lived authenticated link (OTP to the patient's phone) or handed over printed at the clinic; patients can choose their care-message channel | Privacy owner | UU 27/2022; Meta policy | Proposal |
| PRIV-16 | Vendor staff process clinic data only inside support sessions for a stated purpose or through audited infrastructure break-glass (SEC-20), recorded per processor agreement (PRIV-8, PR-60); vendor billing data (owner contact, invoices) is vendor-controlled | Privacy owner | PD-03 | Proposal |
| PRIV-17 | Public pages follow Permenkes 1787/2010 (JUR-ID-7): no testimonials, no advertised discounts or sales promotions, no superlatives or comparisons, no promised results, no professional titles as promotion, health workers never as advertising models; counsel confirms the open readings (Q-15) | Privacy owner | Permenkes 1787/2010 Pasal 4, 5, 8 (text read 2026-11-02); EPI 2020 | Proposal |
| PRIV-18 | Cross-border register per recipient and onward transfer (XFER-*): purpose, data, location, controller/processor role, transfer basis and evidence; transfer consent is never used to work around RME residency (Permenkes 24/2022 Pasal 22) | Privacy owner | UU 27/2022 Pasal 56 (verify) | Proposal |

### Purpose and lawful-basis matrix (PRIV-1)

| Purpose | Data | Basis | Withdrawable |
|---|---|---|---|
| Care and RME (visits, records, prescriptions, consent forms) | Identity, health data, clinical photos | Legal obligation of the facility (Permenkes 24/2022) | No (record retained) |
| SATUSEHAT reporting | Encounter, condition, procedure, IHS IDs | Legal obligation (PP 28/2024) | No |
| Appointment reminders, aftercare, complaint replies | Name, phone, appointment time | Care communication under the facility's basis; channel preference honoured | Channel can change; care itself continues |
| Marketing messages and promos | Name, phone, consented segments | Consent (PR-4) | Yes |
| Clinical photo for teaching / publication | Photos | Explicit consent per use | Yes (future use stops) |
| Vendor billing of the clinic | Owner contact, invoices | Contract (vendor is controller, PRIV-13) | No |

## Vendor Compliance Checklist (Phase 0)

| Item | Needed for | Status |
|---|---|---|
| Legal entity with NIB (OSS) | PSE, Meta | Open (S-04) |
| PSE registration (Komdigi via OSS) | SATUSEHAT vendor registration | Open |
| SNOMED CT affiliate licence | SATUSEHAT | Open |
| SATUSEHAT vendor registration | First clinic | Open |
| Website + privacy policy | Meta, PSE, PDP | Open |
| Meta business verification, App Review, Access Verification (or BSP fallback W-09) | WABA | Open |
| Legal opinion on Singapore storage of RME, or residency migration | PR-36, ARCH-10 | Open (H-02d) |
| Vendor profile filled (replace placeholder) | PR-55 | Open (S-04) |
| Processor agreement template | Each clinic | Open |
| DPIA, DPO | PRIV-11, PRIV-12 | Open |
| Verify PP 33/2026 text and the 20 regulatory claims | PRIV-* | Open (PRD Q-11) |
