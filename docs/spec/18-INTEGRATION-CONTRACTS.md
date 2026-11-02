# Integration Contracts — WhatsApp (Tech Provider), SATUSEHAT, Payment Gateways

## Document Control

| Field | Value |
|---|---|
| Accountable owner | Engineering owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Sources | Meta developer docs (pricing, messaging limits, Tech Provider, phone numbers) read 2026-11-02; SATUSEHAT platform docs (vendor/facility registration, outpatient guide, production credentials); `CLINIC-SYSTEM-NEEDS-AND-ARCHITECTURE-RESEARCH.md` §5; `COMPLIANCE-…` §4 |
| Recheck | Meta pricing and limits change quarterly (1 Jan/Apr/Jul/Oct); SATUSEHAT guides change without notice — recheck before implementation |

This document is a pack extension (integration contracts). Requirement IDs reuse `TD-*` (technical design) because each item defines component behavior.

## 1. WhatsApp Business Platform — own Tech Provider

### TD-20 — Onboarding state machine
- Status: Proposal
- Owner: Engineering owner
- Statement: Each tenant WABA moves `not_connected → signup_started → token_exchanged → app_subscribed → number_pending_registration → number_registered → display_name_pending → active`, with side states `verification_required` (more than 2 numbers before Meta business verification), `quality_restricted`, `revoked`. Each number has its own state and a branch link or "brand-wide".
- Acceptance: Given a completed Embedded Signup, When the code is exchanged, Then the business token is stored encrypted, the app is subscribed to the WABA webhooks, and the number register call is made with a generated two-step PIN stored encrypted.
- Constraints: TEN-7, TEN-9, SEC-6

### TD-21 — Token vault
- Status: Proposal
- Owner: Engineering owner
- Statement: `token_vault(tenant_id, waba_id, token_kind, granted_scopes, encrypted_token, dek_ref, created_at, revoked_at)`; tokens never leave the server; revocation and account-update webhooks mark tokens revoked and move the WABA to `revoked`.
- Acceptance: Given a partner-removed webhook, When processed, Then sending stops for that WABA and the owner is notified.
- Constraints: TEN-7

### TD-22 — Webhook intake and routing
- Status: Proposal
- Owner: Engineering owner
- Statement: One app-level callback on the DNS-only app host (`/api/v1/webhooks/meta`, so message content never transits the Cloudflare proxy) verifies the `X-Hub-Signature-256` HMAC with the app secret, stores the raw event idempotently by message/status id, resolves tenant and branch through `waba_routes(phone_number_id)`, and drops-and-audits unknown ids. Processing is asynchronous.
- Acceptance: Given the same webhook delivered twice, When processed, Then one message row exists.
- Constraints: SEC-8, TEN-9

### TD-23 — Inbound media
- Status: Proposal
- Owner: Engineering owner
- Statement: Inbound media is downloaded from the temporary Meta media URL by the worker into the tenant's private production bucket, with type and size validation; messages reference the stored object.
- Acceptance: Given an inbound image, When processed, Then the stored object lives under `tenants/{tenant}/wa-media/` and the Meta URL is not kept.
- Constraints: SEC-14, ARCH-9

### TD-24 — Coexistence
- Status: Proposal
- Owner: Engineering owner
- Statement: For numbers onboarded with Coexistence, echoes of messages sent from the WhatsApp Business app are stored as outbound messages with `sent_via = business_app`; they count as a first response for SLA; history sync, if enabled by the clinic, imports into the same conversation model with the same storage and access rules.
- Acceptance: Given a reply sent from the WhatsApp Business app, When the echo arrives, Then the lead's first-response time is set.
- Constraints: W-04, PR-29

### TD-25 — Sending and budget
- Status: Proposal
- Owner: Engineering owner
- Statement: Free-form replies only inside the 24-hour customer service window; otherwise approved templates. Template categories recorded per message for cost (OBS-5). A tenant-level daily budget of 80% of the portfolio messaging limit (read from Meta's messaging-limit field) caps business-initiated templates; overflow is queued to the next window.
- Acceptance: Given a reached daily budget, When more reminders are due, Then they are queued and the CS dashboard shows the backlog.
- Constraints: RATE-6, PR-31

### TD-26 — Booking OTP sender
- Status: Proposal
- Owner: Engineering owner
- Statement: OTP is an authentication template sent from the tenant's WABA when active, otherwise from the vendor's own WABA; the code is stored hashed with TTL 5 minutes and 5 attempts.
- Acceptance: Given a tenant without an active WABA, When a patient books, Then the OTP arrives from the vendor number and booking continues.
- Constraints: IAM-2, RATE-1

### TD-27 — BSP fallback
- Status: Proposal
- Owner: Engineering owner
- Statement: While our Tech Provider approval is pending, the pilot tenant connects through a Meta-approved BSP behind the same messaging adapter interface; migration to our Tech Provider keeps conversation history.
- Acceptance: Given the adapter switched from BSP to Cloud API direct, When messages flow, Then conversation ids and history are unchanged.
- Constraints: W-09

## 2. SATUSEHAT

### TD-30 — Credentials per branch
- Status: Proposal
- Owner: Engineering owner
- Statement: `satusehat_credentials(branch_id, environment (sandbox|production), organization_id, client_id, secret_ref, rotated_at)`; one licensed facility = one branch = one Organization ID; tokens cached per (environment, branch) with expiry; **facility-context invariant**: every send derives branch, environment, credentials, Organization, Location (room of the visit's branch) and practitioner from the source visit on the server and refuses to send when any reference belongs to another branch or the practitioner lacks a valid SIP for that branch (IAM-4).
- Acceptance: Given two branches with their own credentials, When each sends an Encounter, Then each uses its own token and Organization ID; Given a visit at B1 referencing a room Location of B2, When sending, Then the send is refused and audited.
- Constraints: TEN-7, S-01

### TD-31 — Identity resolution
- Status: Proposal
- Owner: Engineering owner
- Statement: Patient: NIK (decrypted at send time) → SATUSEHAT patient lookup → `ihs_patient_id`; patients without NIK follow the official no-NIK identity types and stay in `identity_review` without blocking care (CD-28). Practitioner: staff NIK → practitioner lookup → `ihs_practitioner_id`. Location: each room (DATA-46) registered as a SATUSEHAT Location; the branch holds the Organization ID.
- Identity states: `matched` (one IHS match on NIK), `review` (no NIK, ambiguous or conflicting demographics), `resolved_manual` (records officer chose a match with evidence), `unresolvable` (sent without patient link only if the guide allows, otherwise held); minors and newborns use their own identity type, never the guardian's NIK; foreigners use passport/KITAS per the guide (verify); ambiguous matches are never auto-selected; an IHS ID change after submission triggers a reconciliation task listing affected remote resources; care is never blocked.
- Acceptance: Given a patient without NIK, When a record is signed, Then local care completes and the outbox item waits in identity review.
- Constraints: DATA-8, DATA-13

### TD-32 — Resource mapping
- Status: Proposal
- Owner: Clinical lead
- Statement: Encounter (arrived → in-progress → finished from visit states, period, location, practitioner); Condition (doctor diagnosis ICD-10; BC intake never sent as a clinician finding); Observation (vitals, structured assessments); Procedure (treatment counted, ICD-9-CM from catalog); MedicationRequest/MedicationDispense (KFA from catalog). Amendments update the same resource via stored resource links.
- Sync ledger per source resource and version (`integration_resource_links`: environment, branch, FHIR type, local id, local version, remote id, remote version, status queued/sent/confirmed/failed/outcome_unknown, attempts, last error code); dependency order Patient/Practitioner → Encounter → Condition/Observation/Procedure/MedicationRequest → MedicationDispense; a dependent resource is sent only after its reference is confirmed; partial success retries only unresolved items.
- Terminology register: system URI, release/version, mapping owner, provenance, effective dates, licence evidence (SNOMED CT affiliate licence, ICD-10/ICD-9-CM, KFA); signed records keep the code and version used; mapping changes are validated in sandbox before rollout.
- Acceptance: Given a signed visit with one diagnosis and one counted procedure, When sent to sandbox, Then Encounter, Condition and Procedure return 200/201 and resource links are stored.
- Constraints: S-06, DATA-40

### TD-33 — Outbox, retries and errors
- Status: Proposal
- Owner: Engineering owner
- Statement: Outbox payload is reference-only and bound to a signed source version; the worker builds FHIR bodies from that version (never from a newer or older one) and serializes updates per remote resource, dropping stale work; retries with backoff for 5xx; a timeout or lost response becomes `outcome_unknown` and is reconciled by searching for the resource by its stable local identifier before any new create (manual exception queue if unresolved); amendments (RecordAmended) send an update or withdrawal for each linked remote resource with the outcome audited; 4xx go to an error list with code and path (full provider body stored only in a clinical-class table); per-branch monitor (UX-23).
- Acceptance: Given SATUSEHAT unreachable, When a record is signed, Then the record is saved and the item retries; the monitor shows it pending. Given a create whose response was lost but which committed remotely, When reconciliation runs, Then no duplicate resource is created. Given an amendment while the first send is pending, When both are processed, Then the remote resource ends at the amended version.
- Constraints: ARCH-5, PR-35

### TD-34 — Vendor registration evidence
- Status: Proposal
- Owner: Product owner (Paduka Ongki)
- Statement: Before the first production tenant: PSE number, SNOMED CT affiliate licence, sandbox evidence (Encounter + Condition 200/201 with real mapped data), system documentation, variables/metadata statement, facility list or "belum bermitra" statement, security survey — all stored in the repository's compliance folder.
- Acceptance: Given the Phase 0 gate, When reviewed, Then each item has an evidence file.
- Constraints: S-03

## 3. Payment gateways

### TD-40 — Merchant of record and routing
- Status: Proposal
- Owner: Engineering owner
- Statement: Each clinic uses its own gateway account through the payment port (provider OPEN, Q-14; mock adapter in Release 1); keys stored in the tenant vault; `payment_routes(merchant_ref/order prefix → tenant_id)` routes webhooks; item descriptions are generic ("Layanan klinik", "Produk").
- Acceptance: Given a webhook with an unknown order prefix, When received, Then it is dropped and audited.
- Constraints: H-09, SEC-15, TEN-9

### TD-41 — Payment lifecycle
- Status: Proposal
- Owner: Engineering owner
- Statement: Payment link/VA/QRIS states `created → pending → paid | expired | failed`; a payment is recorded only on verified paid webhook or verified status query; duplicate or late webhooks are idempotent; a paid notification after expiry is credited to the patient's balance and flagged for review.
- Acceptance: Given a paid webhook received twice, When processed, Then one payment and one allocation exist.
- Constraints: SEC-8, DATA-28

### TD-42 — Vendor server-fee billing via AutoLaris
- Status: Proposal
- Owner: Engineering owner
- Statement: Vendor-only adapter on the vendor's AutoLaris account (server side). Per payment attempt persist a new attempt-scoped `reff_id` (BILL-32), then `POST /api/h2h/create_payment` (or `/submit` with the non-physical profile only after AutoLaris approves it, Q-13); channels and fees from `GET /api/h2h/list_payment` at runtime; reconcile with `POST /api/h2h/advice` using the provider `transaction_id`, bounded and idempotent; check `rc === "00"`; mark paid only under the settlement status confirmed for the account (Q-13); payment attempts per BILL-32; Advice polling at 1, 5, 15 and 60 minutes, then hourly until the attempt's expiry + 24 h; `callback_url` is never proof of payment; an Advice amount different from the attempt amount stays unpaid and is audited. Shipping endpoints are never called. API key in the vendor secret store, never a tenant vault.
- Acceptance: Given an Advice response still pending, When reconciliation runs, Then the invoice stays unpaid and no second payment is created.
- Constraints: P-14, SEC-6, PR-61

### TD-43 — Mock payment adapter
- Status: Proposal
- Owner: Engineering owner
- Statement: Implements the payment port: creates simulated QRIS/VA/link charges, exposes UX-56 to mark paid, expired or failed, sends HMAC-signed webhooks to `/api/v1/webhooks/payment/mock`, and can replay duplicate and late webhooks; every artifact is flagged simulated (BILL-29). Every future real adapter must pass the same contract suite: duplicate webhook → one payment; paid after expiry → recorded and flagged; amount mismatch → rejected and audited; bad signature → 401 and audited; lost webhook → status query settles once; out-of-order events (paid after failed/cancelled) → flagged for review; refund idempotent including partial refund; webhook outside the timestamp window → rejected; `payment_routes` tenant mismatch → dropped and audited; gateway paid after the line was settled in cash → value to patient balance and flagged. PLAN scenario 20 (gateway clearing and fee) is verified in M8 with a synthetic settlement fixture posted directly to the ledger (not through simulated payments, which never enter real ledgers); a real-provider run waits for the Q-14 partner and its adapter task.
- Acceptance: Given the mock adapter and a paid webhook replayed twice, When processed, Then one payment exists marked simulated and K1 is unchanged.
- Constraints: H-10, PR-68, TD-41

## 4. Event Catalog (domain events, reference-only payloads)

### TD-50 — Event catalog
- Status: Proposal
- Owner: Engineering owner
- Statement: Events are written to `domain_events` (DATA-59) in the same transaction as the fact; consumers record `event_receipts` so each event is applied once per consumer; the envelope also carries `origin_command_id` and origin attribution (DATA-60); envelope `{event_id, type, version, tenant_id, branch_id, aggregate_id, aggregate_version, occurred_at, correlation_id}`; payload carries IDs only.
- Acceptance: Given any event, When inspected, Then it contains no names, phone numbers, clinical text or amounts beyond IDs.
- Constraints: ARCH-5

Posting eligibility, companion suppression and reversal ownership are defined exclusively by the canonical posting-trigger matrix in `11-BILLING-PAYMENTS.md`; a consumer labelled Posting below is conditional on that matrix, not permission for every event in the row to post.

| Event | Producer | Consumers |
|---|---|---|
| PatientRegistered | TD-2 | CRM |
| AppointmentBooked / Cancelled / NoShow | TD-3 | CRM, booking DP |
| VisitCheckedIn / VisitClosed | TD-3 | Dashboards, CRM |
| IntakeSaved / IntakeVerified | TD-4 | Workspace |
| PlanAuthorized / PlanChanged | TD-4 | Selection, pharmacy prep |
| ItemsSelected | TD-4 | Invoice draft, prep list |
| ConsentRecorded | TD-4 | Execution readiness |
| AdditionalTreatmentApproved / ReleasedBeforePayment | TD-5 | Notifications, cashier |
| TreatmentStarted / TreatmentFinished(outcome) | TD-5 | Sessions, stock, commission, posting, SATUSEHAT |
| StockIssued / StockConsumed / StockReturned / StockWasted / StockTransferred | TD-6 | Posting, dashboards |
| PrescriptionSigned / MedicationDispensed | TD-6 | SATUSEHAT, posting |
| InvoiceIssued / PaymentReceived / PaymentAllocated | TD-7 | Posting, commission, sessions unlock |
| SessionReserved / SessionRedeemed / SessionReleased | TD-7 | Posting, dashboards |
| PackageExpired / PackageCancelled / BalanceMoved | TD-7 | Posting, commission adjustment |
| RefundApproved / RefundPaid / ReceivableCreated / ReceivableWrittenOff | TD-7 | Posting, commission |
| CommissionAccrued / CommissionAdjusted / PayoutBatchApproved | TD-8 | Posting |
| MessageReceived / MessageSent / LeadStatusChanged | TD-9 | CRM dashboards |
| ComplaintFlagged / ComplaintResolved | TD-4 | Notifications |
| RecordSigned / RecordAmended | TD-4 | SATUSEHAT |
| BalanceToppedUp / BalanceUsed | TD-7 | Posting |
| BookingDepositReceived / BookingDepositApplied / BookingDepositForfeited / BookingDepositMovedToBalance | TD-7 | Posting per `11` matrix (MovedToBalance is notification-only) |
| CommissionPaid | TD-8 | Posting |
| SupplierReturned | TD-6 | Posting, supplier credit expectation |
| ExpenseRecorded | TD-7 | Posting |
| InvoiceVoided / DiscountApproved | TD-7 | Posting, suspicious-activity report |
| OpeningImportApplied | TD-13 | Posting (opening journal, same event name in `11`), reconciliation |
| TenantLifecycleChanged / ServerFeeInvoiced / ServerFeePaid | TD-13 | Vendor console, notifications (platform events, no tenant data) |
| ConsultationFeeCharged / ConsultationFeeRecharged | TD-7 | Posting per `11` matrix (Recharged is notification-only), commission |
| ProductHandedOver / ProductReturned | TD-6 | Posting (COGS), revenue |
| SubstitutionApproved | TD-4 | Posting, commission adjustment |
| GoodsReceived | TD-6 | Posting (GRNI), moving average |
| SupplierInvoiceRecorded / SupplierPaymentAllocated / SupplierCreditApplied | TD-6 | Posting (AP), supplier roll-forward |
| ReceivableCollected | TD-7 | Posting (no revenue or VAT) |
| SupplierInvoiceReversed / SupplierPaymentReversed / SupplierCreditReversed | TD-6 | Posting (mirror of original journal per `11`) |
| ExpenseReversed | TD-7 | Posting (mirror of expense recognition per `11`) |
| JournalReversed | TD-10 | Notification only, emitted after reversal journal; never a posting trigger |
| BookingDepositRefunded | TD-7 | Posting |
| GatewaySettlementReceived | TD-7 | Posting (clearing, fees) |
| ShiftClosed | TD-7 | Approvals (variance) |
| TaxProfileChanged | TD-7 | Posting (PKP boundary) |

## 5. Error Catalog

### TD-51 — Error contract
- Status: Proposal
- Owner: Engineering owner
- Statement: Errors return `{code, message_id, http}` with stable codes and Indonesian messages; 403/404 without existence leakage, 409 conflict/idempotency, 422 domain gate.
- Acceptance: Given any blocked domain action, When it fails, Then the response carries a code from this table and the UI shows its message.
- Constraints: API-3

| Code | HTTP | Pesan (UI) |
|---|---|---|
| ERR_NOT_FOUND | 404 | Data tidak ditemukan. |
| ERR_FORBIDDEN | 403 | Anda tidak punya akses untuk tindakan ini. |
| ERR_IDEMPOTENCY_CONFLICT | 409 | Permintaan ini sudah diproses. |
| ERR_VERSION_CONFLICT | 409 | Data sudah diubah orang lain. Muat ulang lalu coba lagi. |
| ERR_UNPAID_INITIAL_ITEMS | 422 | Tindakan belum bisa dimulai: pembayaran awal belum diterima. |
| ERR_CONSENT_MISSING | 422 | Persetujuan tindakan belum ada atau tidak sesuai rencana. |
| ERR_CREDENTIAL_INVALID | 422 | Izin praktik tenaga kesehatan tidak berlaku. |
| ERR_VISIT_HAS_BLOCKER | 422 | Kunjungan belum bisa ditutup: masih ada tagihan, penyerahan, atau tindakan terbuka. |
| ERR_SESSION_NOT_UNLOCKED | 422 | Sesi belum bisa dipakai: pembayaran belum mencukupi nilai sesi. |
| ERR_PACKAGE_EXPIRED | 422 | Paket sudah tidak berlaku. |
| ERR_BALANCE_INSUFFICIENT | 422 | Saldo pasien tidak cukup. |
| ERR_MIN_DP_NOT_MET | 422 | Pembayaran belum memenuhi DP minimum paket. |
| ERR_APPROVER_IS_REQUESTER | 422 | Persetujuan harus oleh orang lain. |
| ERR_STOCK_UNFIT | 422 | Stok kedaluwarsa, ditarik, atau melewati batas pakai. |
| ERR_STOCK_INSUFFICIENT | 422 | Stok tidak cukup. |
| ERR_RECORD_LOCKED | 422 | Catatan sudah ditandatangani. Buat koreksi. |
| ERR_CORRECTION_NEEDS_APPROVAL | 422 | Koreksi lewat 2×24 jam perlu persetujuan. |
| ERR_WA_WINDOW_CLOSED | 422 | Percakapan lewat 24 jam. Kirim template. |
| ERR_WA_BUDGET_REACHED | 422 | Batas kirim harian tercapai. Pesan dijadwalkan ulang. |
| ERR_PERIOD_LOCKED | 422 | Periode akuntansi sudah dikunci. |
| ERR_SETTING_NOT_ALLOWED | 422 | Pengaturan ini tidak tersedia. |
| ERR_OTP_INVALID | 422 | Kode OTP salah atau kedaluwarsa. |
| ERR_RATE_LIMITED | 429 | Terlalu banyak percobaan. Coba lagi sebentar. |
