# Round 3 review 5 — Indonesian regulatory and operational completeness (kit v0.4)

- Reviewer: independent cross-model delegate R3-E (cx/gpt-6-astra via 9router-fantastico), read-only, no web access; knowledge-based items marked verify, 2026-11-02.

## Verdict

**HOLD regulatory approval; continue document refinement only.** The privacy document contains useful safeguards, but several obligations remain unverified or are expressed too broadly to serve as implementable compliance requirements.

**Review limitation:** I directly read only `13-COMPLIANCE-PRIVACY.md` before the investigation was stopped. I could not inspect the requested PRD sections, integration contracts, research sources, or `reviews/round3-review-3-clinic-ux-public-site.md`. Consequently:
- Findings below concern statements verified in the privacy document, not confirmed omissions throughout the kit.
- Deduplication against the existing reviewer report remains pending.
- Legal observations from knowledge are explicitly marked **verify**. No current legal status was independently checked.
- This is not legal advice or a completed regulatory audit.

All file references below are relative to `~/Documents/work/prd/clinic-dashboard/`.

## Findings

| ID | Severity | Evidence | Problem | Smallest fix |
|---|---|---|---|---|
| R3E-1 | P1 | `13-COMPLIANCE-PRIVACY.md`, PRIV-5: Singapore production storage allowed after “a written legal opinion … or migration.” | The gate does not expressly require a **favorable, applicable legal conclusion**. Merely obtaining an opinion—including one concluding that Indonesian storage is required—could satisfy its literal wording. Owner risk acceptance cannot override a statutory location requirement. **Verify:** precise application of Permenkes 24/2022 Pasal 20 and 22 to this vendor-operated RME architecture. | Require documented legal approval identifying the lawful basis for the actual deployment, or Indonesian migration completed and tested **before any real patient data is processed**. Include database, photos, backups, logs, disaster recovery and support access in the assessment. An adverse or inconclusive opinion must fail the gate. |
| R3E-2 | P1 | `13-COMPLIANCE-PRIVACY.md`, PRIV-9: notify “clinic and authorities”; deadline “believed 3×24 h — verify.” | The requirement omits affected data subjects as explicit notice recipients and lacks the deadline trigger and minimum notice content. A vendor-to-clinic notification alone does not discharge the controller’s obligations. **Verify:** UU 27/2022 Pasal 46 specifies written notification to data subjects and the institution within 3×24 hours, with required content; confirm applicable interpretation and reporting channel. | Define vendor-to-controller escalation promptly enough to preserve the statutory deadline, controller responsibility for required notices, incident timestamps, recipients, notice contents and evidence of delivery. Separate contractual escalation targets from statutory deadlines. |
| R3E-3 | P1 | `13-COMPLIANCE-PRIVACY.md`, PRIV-15 permits reminders and aftercare without marketing consent, including the booked service name; PRIV-7 says templates “never carry health details.” | These requirements conflict. A booked aesthetic service can reveal health or treatment information, especially in messages displayed on shared phones. “Not marketing” does not by itself establish a lawful basis or permission to disclose the service name through WhatsApp. | Default outbound messages to neutral appointment information without service names, diagnosis, procedure or clinical photographs. Deliver sensitive aftercare through an appropriately authenticated channel. Record the lawful basis and communication preference separately from marketing consent, and document any specifically approved exception. |
| R3E-4 | P2 | `13-COMPLIANCE-PRIVACY.md`, PRIV-1: health data, photos, NIK and inbound WhatsApp content are all “specific personal data,” followed by a consent-ledger control. | This conflates data classification and lawful basis. NIK is personal data and warrants strong protection, but is not automatically the same statutory category as health data; WhatsApp content depends on what it contains. Consent is not the sole possible basis for statutory RME processing. **Verify:** UU 27/2022 Pasal 4 and 20. | Add a small purpose/basis matrix: care and mandatory records, legal reporting, optional marketing, photographs for clinical use, publication and vendor billing. Distinguish legal classification from the system’s conservative security classification. Preserve withdrawal controls for optional purposes without suggesting statutory records disappear when consent is withdrawn. |
| R3E-5 | P2 | `13-COMPLIANCE-PRIVACY.md`, PRIV-2: requests have due dates “set by counsel”; source cites UU PDP and Permenkes 24/2022 Pasal 26. | Counsel should validate statutory deadlines, not invent a single discretionary SLA. Access, correction, consent withdrawal and patient copies require different decisions; clinical correction must not become unrestricted editing of signed records. The cited article also needs checking against the exact duty. | Specify a counsel-validated request matrix covering right, deadline, identity/representative verification, responsible role, exceptions and delivery evidence. Separate demographic correction from append-only clinical correction/addenda, preserving authorship and original entries. Cross-reference PR-50 rather than creating another workflow. |
| R3E-6 | P2 | `13-COMPLIANCE-PRIVACY.md`, PRIV-3: RME retention ≥25 years, followed by “no automatic deletion of clinical or financial records.” | The RME retention rule is extended to financial records without a separate source, and an indefinite no-deletion rule is not a complete retention policy. Different classes need different triggers, legal holds and disposal decisions. **Verify:** Permenkes 24/2022 Pasal 39 and applicable tax/accounting retention rules. | Keep the sourced RME minimum, but add a class-specific schedule for clinical records/photos, finance/tax, audit, communications, rejected uploads and backups. Define hold, review and authorized disposal after applicable periods. Suspension or tenant exit must not erase required records. |
| R3E-7 | P2 | `13-COMPLIANCE-PRIVACY.md`, PRIV-6: cross-border records reviewed by counsel, transfer article unverified; PRIV-13 lists several sub-processors. | A reviewed transfer register does not itself specify the transfer conditions or the evidence required to satisfy them. Hosting approval and UU PDP transfer compliance are separate tests. **Verify:** UU 27/2022 Pasal 56 and its hierarchy of safeguards. | For each recipient and onward transfer, record purpose, data, processing location, controller/processor role, applicable transfer basis and supporting evidence. Explicitly prohibit using transfer consent as an automatic workaround for sector-specific RME residency restrictions. |
| R3E-8 | P2 | `13-COMPLIANCE-PRIVACY.md`, PRIV-11 schedules DPIA “before Phase 2”; PRIV-12 designates a vendor DPO but only “advises” clinics to do so. | A phase label is a fragile legal trigger if booking, health-intent data, photographs or messaging already operate earlier. Clinic DPO applicability requires an assessment, not merely advice; conversely the document should not assert that every small clinic necessarily requires a dedicated full-time DPO. **Verify:** UU 27/2022 Pasal 34 and 53–54. | Gate relevant high-risk processing on a completed DPIA before real-data operation, regardless of release phase. Record DPO applicability separately for vendor and each clinic, including responsible contact, competence, independence and permitted shared-service arrangements. |
| R3E-9 | P2 | `13-COMPLIANCE-PRIVACY.md`, PRIV-17 restricts “public pages”; the visible parent narrative says discounts remain usable in opted-in WhatsApp marketing. | Public-page restrictions may leave an unjustified channel exemption. Patient consent to marketing does not automatically exempt a message from substantive health-advertising rules. This is a **cross-channel verification concern**, not a finding that every private message is prohibited. **Verify:** scope and current applicability of Permenkes 1787/2010. | Apply legal review to all promotional channels, including WhatsApp templates and campaigns. Distinguish an internal cashier discount from advertising that discount. Keep promotion templates disabled until counsel resolves the channel-specific position. |

**Severity meaning:** P1 blocks regulatory approval of the affected operation; P2 requires a documented resolution or explicit acceptance gate before approval. None of these findings authorizes development.

## Verify Before Approval

The items below are **checks still required**, not assertions that the unread kit lacks them.

1. **Complete and deduplicate this review.** Inspect the specified PRD requirements, `12-SECURITY-ARCHITECTURE.md`, `14-SLA-DRP.md`, `18-INTEGRATION-CONTRACTS.md` and the existing R3-C report. Confirm that fixes already present elsewhere are incorporated by reference rather than duplicated.

2. **RME lifecycle — Permenkes 24/2022, verify current text and applicability.**
   - Required encounter content, author identity, timestamps, authentication and responsibility for completion.
   - Exact correction window and approval requirements; preservation of original entries and late addenda.
   - Facility ownership of records versus patient rights to their contents; authenticated copies, authorized representatives, minors and lawful disclosures.
   - Retention from the legally correct trigger, continuing access during suspension and exit, and long-term custody if either clinic or vendor closes.
   - Backup/restore and downtime procedures that preserve record integrity, including reconciliation of paper records created during outages.
   - Location and access requirements must be resolved for the full deployment, not the database alone.

3. **SATUSEHAT — official onboarding requirements and current use-case implementation guides, verify.**
   - Distinguish vendor registration, each clinic facility’s registration and credentials, and branch/facility identity.
   - Specify Organization, Location, Practitioner and Patient/IHS mappings; never assume one commercial brand equals one licensed facility.
   - Handle missing NIK, foreign patients, children, demographic mismatches and duplicate patient identities without blocking clinically necessary care or inventing identifiers.
   - Confirm ICD-10, ICD-9-CM, KFA and SNOMED CT use by the applicable resource/profile; pin terminology versions and clarify licensing obligations.
   - Require submission acknowledgment, rejection remediation, retries, reconciliation and correction propagation. “FHIR sent successfully” is not proof of accepted reporting.

4. **PSE and RME vendor eligibility — verify.**
   - Confirm the applicable registration duties under PP 71/2019 and the relevant private-PSE rules, including any subsequent amendments.
   - Record who registers which electronic system and the supporting evidence needed for SATUSEHAT vendor onboarding.
   - PSE registration must not be represented as blanket approval of clinical compliance or foreign hosting.

5. **Clinic licensing and accreditation — verify current rules with the medical lead.**
   - Model each branch’s licensed facility, responsible clinician, permitted services and current professional practice authorization.
   - Do not impose one universal expiry model on STR and SIP: applicable validity regimes can differ, including lifetime STR arrangements.
   - Accreditation evidence may include SOP versions, competency records, infection prevention, equipment calibration and corrective-action follow-up. Decide whether the kit stores the records or links to an external controlled register.
   - Confirm current clinic accreditation requirements, including the applicability of Permenkes 34/2022 and successor rules.

6. **Patient safety — Permenkes 11/2017, verify.**
   - Validate incident categories, reporting recipients, deadlines, confidentiality and escalation.
   - Do not assume only KTD and sentinel events can require external reporting.
   - If PR-82 remains Release 1.1, specify a functioning manual incident-management SOP for Release 1. A software deferral cannot defer a clinical obligation.

7. **Clinic pharmacy — Permenkes 34/2021 on pharmacy-service standards in clinics, verify applicability and amendments.**
   - Prescription validation, dispensing authority, allergy/interactions review, counseling and handover documentation.
   - Batch/expiry traceability, recalls, quarantine, cold-chain excursions where relevant, stock discrepancies and destruction.
   - Separate controls for narcotics/psychotropics and other specially regulated medicines if actually handled.
   - Determine which tasks may be assigned to pharmacy staff; do not let a generic purchasing role acquire clinical dispensing powers.

8. **Medical waste/B3 — PP 22/2021 and applicable implementing rules, verify.**
   - Define an external SOP or minimal register for segregation, temporary storage, quantities, collection, authorized transporter/processor evidence, manifests and incidents.
   - Establish whether the product records these duties or merely references the clinic’s controlled records. Do not add a full waste-management module without a scope decision.

9. **Tax and Coretax — verify with an Indonesian tax practitioner against current DJP rules.**
   - Do not apply one blanket PPN treatment to all aesthetic services and skincare sales.
   - Assess medical-service exemption eligibility, non-medical cosmetic services, retail products, packages and mixed transactions separately.
   - Separate clinic tax obligations from the vendor’s tender/server invoices; confirm PKP status and applicable withholding.
   - Define tax-invoice identifiers, corrections/returns, effective-dated rates and rounding. Do not assume a generic invoice export is a valid Coretax filing.
   - PP 49/2022 is a relevant starting source for exemptions; current treatment and subsequent changes require verification.

10. **Unverified citation inventory.**
    - `13-COMPLIANCE-PRIVACY.md` explicitly lists “PP 33/2026” and “20 regulatory claims” as open verification work. Confirm the regulation’s existence, title, relevant provisions and applicability; do not rely on its number alone.
    - Close each applicable claim with an authoritative source, exact provision or official guidance, date checked, interpretation owner and linked acceptance criterion.

## Good

- The kit expressly treats legal review as necessary and does not present the privacy document as legal advice.
- PRIV-5 already establishes a pre-real-patient-data residency gate; strengthening its pass/fail wording is a small but important change.
- The clinic/controller and vendor/processor distinction is documented, including separate vendor billing purposes.
- Consent withdrawal is correctly distinguished from deleting legally retained clinical records.
- Vendor compliance onboarding, DPIA/DPO work, sub-processors and public health-advertising restrictions are visible rather than silently assumed complete.

**Bottom line:** strengthen the existing compliance contracts and close the legal evidence gates before declaring the PRD approved. The evidence available here does not support a claim that the whole kit is regulatorily complete.

---

# Part 2 (R3-E2: SATUSEHAT, security, DR, pharmacy)

## Verdict: INCOMPLETE — regulatory approval cannot be assessed

The first requested file read returned a protected-runway notice rather than file contents. I therefore could not inspect `18-INTEGRATION-CONTRACTS.md`, `12-SECURITY-ARCHITECTURE.md`, `14-SLA-DRP.md`, or the eight PRD rows. No files were changed and no web research was performed.

**No new document defects are confirmed.** The table below is a bounded verification checklist, not evidence that the kit lacks these controls. Severities indicate the potential impact **if the check fails**. References identify inspection targets, not verified citations. Findings from the previous privacy review are excluded as instructed.

## Findings Pending Verification

All paths are relative to `~/Documents/work/prd/clinic-dashboard/`.

| ID | Potential severity | Evidence / inspection target | Problem to verify | Smallest fix if absent |
|---|---|---|---|---|
| R3E-10 | P1 | `18-INTEGRATION-CONTRACTS.md` §2; contents unavailable | **Verify:** A brand/tenant is not necessarily one licensed healthcare facility. SATUSEHAT submissions could use the wrong Organization, Location, or practitioner association if configured only at tenant level. | Add an explicit branch-to-facility mapping, including Organization/Location identifiers, credential scope, practitioner identifiers, and a submission guard against mismatched facility context. Verify the actual provider credential model rather than assuming one credential per branch. |
| R3E-11 | P1 | `18-INTEGRATION-CONTRACTS.md` §2; contents unavailable | **Verify:** Patient/IHS resolution must handle missing NIK, minors, foreigners, duplicate matches, and identity corrections without fabricating identifiers or blocking necessary care. | Document supported identity-resolution paths, a manual unresolved queue, and care-continuity behavior. Never substitute a guardian’s identity for the child’s. Validate supported paths against current SATUSEHAT guidance. |
| R3E-12 | P1 | `18-INTEGRATION-CONTRACTS.md` §2; contents unavailable | **Verify:** Transport success or submission is not sufficient proof that all required clinical resources were successfully persisted and linked. Corrections could leave national records inconsistent with amended local RME. | Specify per-resource outcomes, remote IDs/versions, dependency handling, retry reconciliation after ambiguous timeouts, and an amendment-to-remote-update workflow. Label UI states precisely; do not invent a separate acceptance endpoint or status. |
| R3E-13 | P2 | `18-INTEGRATION-CONTRACTS.md` §2; contents unavailable | **Verify:** Terminology mappings can change, while terminology redistribution or use may have licensing conditions. | Record each required code system’s version, provenance, mapping owner, effective date, update process, and applicable licence. Preserve the originally submitted coding alongside later mappings. |
| R3E-14 | P1 | `14-SLA-DRP.md`; contents unavailable | **Verify:** Infrastructure recovery objectives alone do not preserve clinical continuity or integrity during internet/application outages. Paper notes can be omitted, duplicated, or entered as if contemporaneous. | Add a short clinical downtime SOP: authorized paper forms, temporary encounter IDs, patient/allergy checks, secure custody, actual care time versus transcription time, named transcriber/reviewer, reconciliation of medicines/payments, and closure of the backlog. Exercise it before go-live. |
| R3E-15 | P1 | `02-PRD.md`, requested PR-13/PR-18/PR-35/PR-49/PR-52 rows; contents and ownership unavailable | **Verify:** Stock deduction and handing over medicine are not a complete pharmacy dispensing workflow. Prescription review, clarification, counselling, and pharmacist accountability need explicit coverage. | Add a pharmacist-reviewed dispensing checklist and recorded exceptions: patient/prescriber identity, prescription validity, dose/route/frequency, allergies/interactions and relevant contraindications, clarification outcome, label, counselling, and dispenser identity. Verify scope against Permenkes 34/2021 and current rules. |
| R3E-16 | P1 | `02-PRD.md`, requested pharmacy-related rows; contents unavailable | **Verify:** Batch tracking alone may not prevent dispensing recalled, quarantined, or temperature-exposed stock; special-drug controls may be undefined. | Define non-dispensable inventory statuses, recall traceability to affected dispenses, temperature-excursion records and release authorization. Explicitly support or exclude regulated special-drug workflows; exclusion must prevent those items being enabled. |
| R3E-17 | P2 | `02-PRD.md`, PR-73; only an earlier summary of expiry alerts is available | **Verify:** Treating every STR as periodically expiring may misrepresent current registration regimes; a valid registration alone does not establish valid practice authorization at a particular facility. | Separate registration status and validity type from facility-specific SIP authorization, expiry, and verification evidence. Allow non-expiring registration where legally applicable; retain revocation/suspension handling. Verify current transitional rules. |
| R3E-18 | P1 | `02-PRD.md`, PR-82; earlier summary describes incident types and external-report flags | **Verify:** Flagging only KTD/sentinel incidents for external reporting may be an incomplete interpretation. A register deferred to Release 1.1 also needs an operational reporting fallback for Release 1. | Record responsible officer, classification, immediate response, investigation, reporting determination, verified deadline/recipient, submission evidence, and corrective-action closure. Until built, link an approved external/manual register and SOP. Do not invent deadlines. |
| R3E-19 | P2 | `02-PRD.md`, requested rows; contents unavailable | **Verify:** Medical-waste accountability may be omitted because waste processing is outside application scope. | Keep scope small: record or link the clinic’s waste register and handover evidence, with date, category/quantity as applicable, authorized handler, evidence reference, and responsible officer. No logistics or waste-management subsystem is needed. |
| R3E-20 | P1 | `12-SECURITY-ARCHITECTURE.md`; contents unavailable | **Verify:** Tenant isolation does not by itself address inappropriate clinical-record access, shared-workstation sessions, privileged recovery, or tampering with audit evidence. | Check explicit controls for clinical read/export auditing, least privilege, privileged MFA and recovery, session locking/revocation, restricted emergency access where applicable, protected audit storage, encrypted backups with recoverable keys, and restoration testing. Add only missing controls and corresponding acceptance tests. |

## Verify Before Approval

These are **new checks**, not repeated privacy findings:

- **SATUSEHAT:** Confirm current facility onboarding, identity-resolution paths, required resource profiles, submission-success semantics, permitted correction operations, terminology versions, and licence conditions with official integration guidance.
- **Clinical downtime:** Have Numa Klinik’s clinical lead and pharmacist approve and exercise the paper-to-RME reconciliation procedure.
- **Pharmacy:** Confirm applicability and current status of Permenkes 34/2021, the clinic’s pharmacy service scope, recall/cold-chain procedures, and any special-drug obligations with its responsible pharmacist.
- **STR/SIP:** Verify current registration and facility-specific practice-authorization regimes, including transitional cases.
- **Patient safety:** Verify reportable incident categories, responsible parties, recipients, deadlines, and investigation duties. Do not equate “external report required” solely with severe harm.
- **Medical waste:** Confirm the minimum records the clinic must retain and which external register or authorized contractor provides them.
- **Security:** Obtain actual document and test evidence before concluding that health-data controls are sufficient.

## Positive Signals From Available Background

These are prior conversation statements, **not independently verified file findings**:

- Tenant/brand separation and branch-level operational context are explicitly intended.
- The kit recognizes incident categories, clinician credential alerts, and traceable clinical workflows.
- Production use of simulated payments is prohibited.
- Privacy-review fixes are reported complete and were not reopened here.

**Parent integration guidance:** Do not count this response as a completed independent regulatory review or turn these conditional checks into confirmed findings. The required file inspection remains outstanding.

---

# Part 2 retry (direct pi run, read tool only, cx/gpt-6-astra:high) — completed

## Verdict: BLOCK

**Block production-readiness approval, not continued planning.** The reviewed contracts leave safety-critical behavior undefined for SATUSEHAT retries and identity changes, clinical downtime reconciliation, and facility-specific clinical authorization.

Scope: the four requested files; IAM findings use only the requirements rows, not the role matrix. These are **planning-contract gaps**, not proven implementation defects. Referenced documents were not inspected, so “absent” means absent from these files. Previously resolved privacy topics are excluded.

## Findings

| ID | Severity | Evidence file + ID | Problem | Smallest fix |
|---|---|---|---|---|
| R3E-10 | P1 | `18-INTEGRATION-CONTRACTS.md` TD-30–TD-31; `07-IAM-RBAC-ABAC.md` IAM-5, IAM-9 | Per-branch credentials, Organization IDs, room Locations and Practitioner lookup are present. No explicit send-time invariant binds the encounter’s branch, credentials/environment, Organization, Location and practitioner’s facility authorization. General branch access does not establish valid outbound facility context. | Require a server-derived facility context from the source visit; validate every reference against it before sending. Scope cached tokens and remote mappings by environment and facility where applicable. Add negative tests for another branch’s Location, credentials and unauthorized practitioner. |
| R3E-11 | P1 | `18-INTEGRATION-CONTRACTS.md` TD-31 | No-NIK patients can receive care, but `identity_review` has no resolution workflow. Minors, foreigners, ambiguous/duplicate matches and corrected identities are not explicitly covered. No rule prevents an uncertain match or reassignment of an IHS ID from silently affecting previously linked records. | Add identity states, permitted identifiers, match evidence, accountable reviewer and release criteria. Define duplicate handling and identity-correction reconciliation, including already-submitted resources. Keep care unblocked and prohibit automatic selection of ambiguous matches. **Verify** supported SATUSEHAT identity pathways. |
| R3E-12 | P1 | `18-INTEGRATION-CONTRACTS.md` TD-32–TD-33 | Resource links are required, but per-resource outcomes and dependency ordering are not. A visit can partly succeed without a specified representation of which resources remain unsent or failed. The acceptance test covers only successful Encounter, Condition and Procedure submissions. | Persist a ledger per source resource/version with environment/facility, FHIR type, remote ID, status, attempts and error. Define the dependency graph and gate dependent sends on confirmed references. Test partial success and retry only unresolved work. |
| R3E-13 | P1 | `18-INTEGRATION-CONTRACTS.md` TD-33 | Timeouts and 5xx trigger backoff retries, with no explicit distinction between definite failure and an unknown remote outcome. Repeating a create after SATUSEHAT committed it but the response was lost can duplicate resources. | Add an `outcome_unknown` state and reconcile against a stable source identifier before another create. Specify a manual exception path where remote existence cannot be resolved. **Verify** supported lookup/conditional-create mechanisms; test “remote commit, response lost.” |
| R3E-14 | P1 | `18-INTEGRATION-CONTRACTS.md` TD-32–TD-33, TD-50 | Updating the same resource and emitting `RecordAmended` are good foundations, but send-time body construction is not bound to a source version. Amendment ordering, stale retries, changed dependencies, removed findings and identity corrections are undefined. An older job could overwrite a newer remote state. | Bind each synchronization intent to a signed source version or define explicit version-aware coalescing. Serialize updates per resource, reject stale work, and define correction/withdrawal propagation with auditable remote outcomes. Test an amendment while initial delivery is pending. |
| R3E-15 | P2 | `18-INTEGRATION-CONTRACTS.md` TD-32, TD-34 | ICD-10, ICD-9-CM and KFA mappings are named, and a SNOMED CT affiliate licence is a gate. Terminology releases, mapping provenance, effective dates, deprecated-code handling and licence scope are not specified. | Add a terminology register with system URI, release/version, mapping owner, provenance, effective dates and licence evidence. Preserve the terminology version used by signed records and validate changes before rollout. **Verify** accepted releases and applicable usage/distribution rights. |
| R3E-16 | P1 | `14-SLA-DRP.md` DR-1, DR-3 | Paper fallback and later entry with original timestamps are specified, but not a clinical continuity or reconciliation procedure. Missing details include safe patient identification, access to essential medication/allergy information, paper prescribing/dispensing traceability, reconciliation ownership and duplicate prevention. “Within 24 h” also has no clear starting point if the outage persists. | Attach a minimal SOP covering activation, safe-care limits/escalation, uniquely numbered branch-specific forms, original author/time plus actual entry time, assigned reconciliation and clinical sign-off. Reconcile paper care against restored records and stock/dispensing events before closing the outage. Define the deadline relative to service restoration and drill it. |
| R3E-17 | P1 | `18-INTEGRATION-CONTRACTS.md` TD-32, TD-50, TD-51; `07-IAM-RBAC-ABAC.md` IAM-4 | These files name MedicationRequest/MedicationDispense, prescription/dispensing events and `ERR_STOCK_UNFIT` for expired/recalled stock. They do **not** define dispensing verification, counselling, recall execution, quarantine/release, cold-chain excursions or special-drug controls. An error code alone does not establish these workflows. | Link an authoritative dispensing contract and acceptance tests, or add a scoped one: patient/prescription/product/dose checks, pharmacist sign-off, counselling record, batch-to-patient traceability, recall/quarantine gates and cold-chain disposition. Explicitly exclude unsupported special-drug categories until their controls are approved. **Verify** applicable requirements. |
| R3E-18 | P1 | `07-IAM-RBAC-ABAC.md` IAM-4–IAM-5, IAM-9; `18-INTEGRATION-CONTRACTS.md` TD-31 | IAM-4 groups STR, SIP/SIPP/SIPA and competence under “expired credentials block clinical actions.” It does not distinguish registration from facility-specific practice permission, model non-expiring credentials, or explicitly tie practice permission to the acting branch. An IHS Practitioner ID is not specified as distinct from authorization evidence. | Model credential type, issuer, status, nullable expiry, profession/scope and licensed facility separately. Gate clinical acts on the relevant facility permission and competence, including suspension/revocation. **Verify** applicable non-expiring STR and profession-specific SIP regimes before finalizing rules. |
| R3E-19 | P1 | `12-SECURITY-ARCHITECTURE.md` SEC-7, SEC-20; `07-IAM-RBAC-ABAC.md` IAM-1, IAM-10 | Privileged TOTP and named infrastructure accounts are required, but lost-factor recovery, privileged account recovery and the authorization/expiry of infrastructure break-glass are unspecified. Recovery could become a weaker route around the normal controls. | Define identity verification, independent approval, recovery-secret custody, notifications, short-lived recovery grants, factor re-enrolment and post-use review. Test recovery without silently bypassing separation of duties or creating an unlogged permanent account. |
| R3E-20 | P1 | `12-SECURITY-ARCHITECTURE.md` SEC-7, SEC-16; `07-IAM-RBAC-ABAC.md` IAM-6–IAM-7, IAM-9–IAM-11 | Idle locking, session limits and a 60-minute doctor break-glass grant exist. No explicit revocation contract covers staff suspension, role/branch removal, compromised credentials, factor reset or revoked support access. Existing sessions could retain obsolete authority unless re-evaluation is guaranteed. | Define server-enforced revocation triggers and a maximum propagation delay across active sessions, cached permissions and temporary grants. Test permission removal against an already-open session and expiry/revocation of privileged access. |
| R3E-21 | P2 | `12-SECURITY-ARCHITECTURE.md` SEC-2, SEC-5, SEC-16, SEC-20 | Clinical read auditing is explicitly present; it is not missing. However, “append-only” does not explain protection from privileged modification, and audit-event fields/coverage are unspecified. Statement-level pgaudit also needs a boundary preventing clinical values from entering logs contrary to SEC-2. | Define content-free audit metadata, coverage for reads/media/downloads/exports, and audit-pipeline failure behavior. Protect evidence outside the application/DB administrator’s ordinary write path or use independently checked tamper evidence. Test privileged alteration detection and pgaudit payload redaction. |
| R3E-22 | P2 | `12-SECURITY-ARCHITECTURE.md` SEC-6, SEC-11; `14-SLA-DRP.md` DR-1–DR-2, DR-4 | KEK escrow, backup-key escrow and quarterly restore drills are present. The contract does not require recovery when the live KEK service, normal administrators or Coolify are unavailable, nor verification that historical encrypted data remains decryptable after key rotation. | Extend the drill to a clean-room recovery using escrowed backup keys, KEK versions and wrapped data keys. Name custodians and approval controls; prove database and object decryption without live production dependencies, including an older backup after rotation. |

## Verify Before Approval

New verification items only; no external facts were independently checked in this review:

- **SATUSEHAT facility rules:** Organization/Location relationships, practitioner participation/authorization, and sandbox-versus-production identifier handling.
- **Patient identity pathways:** current procedures for missing NIK, minors/newborns, foreigners, duplicate IHS records and demographic/identity corrections.
- **FHIR synchronization behavior:** supported stable identifiers, search consistency, conditional operations, version/concurrency controls, resource dependencies and correction/withdrawal semantics.
- **Terminology:** accepted ICD-10, ICD-9-CM, KFA and any SNOMED CT releases, plus applicable licence scope and redistribution rights.
- **Professional credentials:** current STR registration rules, treatment of non-expiring STR, and facility/profession-specific practice-permission requirements.
- **Numa pharmacy scope:** actual dispensing services and drug categories, with applicable verification, counselling, recall, storage/cold-chain and special-drug obligations.
- **Operational evidence:** approved clinical downtime SOP and a witnessed paper reconciliation exercise; privileged recovery/revocation tests; audit tamper-detection and escrow-only restore evidence. All cited controls remain marked **Proposal**.

## Good

- TD-30 correctly anchors credentials and Organization identity to each licensed branch rather than the tenant.
- TD-31 preserves local care when patient identity is unresolved.
- TD-32 excludes BC intake from clinician findings and explicitly retains resource links for amendments.
- SEC-5 and SEC-16 explicitly audit clinical reads and vendor record access; IAM-6 bounds doctor break-glass access.
- DR-1–DR-4 establish measurable recovery objectives, encrypted backups, key escrow, isolated restore drills and rebuild independence from Coolify.
