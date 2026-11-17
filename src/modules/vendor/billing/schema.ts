// Vendor server-fee billing (PR-61, BILL-20, BILL-31–BILL-33, TD-42, DATA-49; T-103 increment 1, migration 0119, DEC-114). A platform domain:
// the vendor bills each live tenant a monthly server fee through its own AutoLaris account. Every table is denied to the clinic and vendor
// logins (definers only). Fail-closed gates (Panel 2, plan r4 addendum a1): nothing settles while the AutoLaris settlement rule is unconfirmed
// (Q-13); nothing is issued while the VAT treatment or the vendor's tax status is unknown (BILL-33); Bayar is refused while the channel-fee
// bearer is undecided (Q-16). Mock HTTP with guide-shaped fixtures only; no live provider call.
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { staff } from "../../org/schema";
import { tenantsRegistry, vendorRequests } from "../schema";

const MONTH = (c: unknown) => sql`${c} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`;
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;

// One fee version per approved server_fee_change request (BILL-20); the default Rp1,000,000 applies while a tenant has none.
export const serverFeeVersions = pgTable(
  "server_fee_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    amountRupiah: integer("amount_rupiah").notNull(),
    effectiveMonth: text("effective_month").notNull(),
    reason: text("reason").notNull(),
    requestId: uuid("request_id").notNull().references(() => vendorRequests.id, { onDelete: "restrict" }),
    proposedBy: uuid("proposed_by").notNull(),
    approvedBy: uuid("approved_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("server_fee_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("server_fee_versions_tenant_month_key").on(t.tenantId, t.effectiveMonth),
    unique("server_fee_versions_request_key").on(t.requestId),
    check("server_fee_versions_check", sql`${t.amountRupiah} > 0 and ${MONTH(t.effectiveMonth)} and length(btrim(${t.reason})) between 10 and 500
      and ${t.proposedBy} <> ${t.approvedBy}`),
  ],
);

// Invoices (BILL-31): amounts and the proration snapshot are frozen at issue; a correction is a credit note.
export const vendorInvoices = pgTable(
  "vendor_invoices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    kind: text("kind").notNull(),
    period: text("period").notNull(),
    serviceFrom: date("service_from").notNull(),
    serviceTo: date("service_to").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    feeVersionId: uuid("fee_version_id"),
    feeSource: text("fee_source").notNull(),
    feeAmount: integer("fee_amount").notNull(),
    proration: jsonb("proration").notNull(),
    amountRupiah: integer("amount_rupiah").notNull(),
    vatRupiah: integer("vat_rupiah").notNull(),
    totalRupiah: integer("total_rupiah").notNull(),
    taxBasis: jsonb("tax_basis").notNull(),
    state: text("state").notNull().default("issued"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("vendor_invoices_tenant_id_id_key").on(t.tenantId, t.id),
    unique("vendor_invoices_tenant_period_key").on(t.tenantId, t.period),
    unique("vendor_invoices_number_key").on(t.number),
    foreignKey({ name: "vendor_invoices_fee_version_fk", columns: [t.tenantId, t.feeVersionId], foreignColumns: [serverFeeVersions.tenantId, serverFeeVersions.id] }).onDelete("restrict"),
    check("vendor_invoices_check", sql`${t.number} ~ '^VND-[0-9]{6}-[0-9]{4,}$' and ${t.kind} in ('first','monthly') and ${MONTH(t.period)}
      and ${t.serviceFrom} <= ${t.serviceTo} and ${t.dueDate} >= ${t.issueDate} and ${t.feeSource} in ('version','default')
      and (${t.feeSource} = 'version') = (${t.feeVersionId} is not null) and ${t.feeAmount} > 0 and ${t.amountRupiah} >= 0 and ${t.vatRupiah} >= 0
      and ${t.totalRupiah} = ${t.amountRupiah} + ${t.vatRupiah} and jsonb_typeof(${t.proration}) = 'object' and jsonb_typeof(${t.taxBasis}) = 'object'
      and ${t.state} in ('issued','paid','waived','credited') and (${t.state} = 'issued') = (${t.closedAt} is null)`),
  ],
);

// Payment attempts (BILL-32, TD-42): the reff_id is committed before the provider call; one open attempt per invoice; the provider id is
// learnt once; every post-call write is fenced by (state, generation).
export const vendorPaymentAttempts = pgTable(
  "vendor_payment_attempts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    seq: integer("seq").notNull(),
    reffId: text("reff_id").notNull(),
    commandKey: text("command_key").notNull(),
    channelCode: text("channel_code").notNull(),
    amountRupiah: integer("amount_rupiah").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("creating"),
    generation: integer("generation").notNull().default(1),
    providerTrxId: text("provider_trx_id"),
    providerAdmin: integer("provider_admin"),
    providerTotal: integer("provider_total"),
    instruction: jsonb("instruction"),
    rc: text("rc"),
    ket: text("ket"),
    adviceNextAt: timestamp("advice_next_at", { withTimezone: true }),
    adviceCount: integer("advice_count").notNull().default(0),
    creatingSince: timestamp("creating_since", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    closedBy: text("closed_by"),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("vendor_payment_attempts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("vendor_payment_attempts_reff_key").on(t.reffId),
    unique("vendor_payment_attempts_invoice_seq_key").on(t.invoiceId, t.seq),
    unique("vendor_payment_attempts_key").on(t.tenantId, t.commandKey),
    uniqueIndex("vendor_payment_attempts_trx_key").on(t.providerTrxId).where(sql`${t.providerTrxId} is not null`),
    uniqueIndex("vendor_payment_attempts_one_open").on(t.invoiceId).where(sql`${t.state} in ('creating','pending','unknown')`),
    index("vendor_payment_attempts_advice_idx").on(t.adviceNextAt).where(sql`${t.providerTrxId} is not null and ${t.state} in ('pending','unknown','expired')`),
    foreignKey({ name: "vendor_payment_attempts_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [vendorInvoices.tenantId, vendorInvoices.id] }).onDelete("restrict"),
    foreignKey({ name: "vendor_payment_attempts_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("vendor_payment_attempts_check", sql`${t.reffId} ~ '^SF[0-9]{10,}A[0-9]{1,}$' and length(${t.reffId}) <= 30 and ${KEY(t.commandKey)} and ${t.channelCode} ~ '^[A-Z0-9_]{2,20}$'
      and ${t.amountRupiah} > 0 and ${t.state} in ('creating','pending','unknown','paid','expired','failed') and ${t.generation} >= 1
      and (${t.providerTrxId} is null or ${t.providerTrxId} ~ '^[A-Za-z0-9_-]{1,64}$') and (${t.rc} is null or ${t.rc} ~ '^[0-9A-Za-z]{1,8}$')
      and (${t.ket} is null or length(${t.ket}) <= 200) and (${t.providerAdmin} is null or ${t.providerAdmin} >= 0)
      and (${t.providerTotal} is null or ${t.providerTotal} >= ${t.amountRupiah}) and (${t.instruction} is null or jsonb_typeof(${t.instruction}) = 'object')
      and ${t.createdAs} in ('owner','finance') and ${t.adviceCount} >= 0
      and (${t.state} <> 'pending' or ${t.providerTrxId} is not null) and (${t.state} <> 'paid' or ${t.providerTrxId} is not null)
      and (${t.closedBy} is null or ${t.closedBy} in ('advice','create_rc'))`),
  ],
);

// Every Advice read, append-only (BILL-32 "Advice snapshots"); the raw response is sanitized and bounded.
export const vendorAdviceObservations = pgTable(
  "vendor_advice_observations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    source: text("source").notNull(),
    httpStatus: integer("http_status"),
    rc: text("rc"),
    status: text("status"),
    amountRupiah: integer("amount_rupiah"),
    interpreted: text("interpreted").notNull(),
    ruleId: uuid("rule_id"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [
    unique("vendor_advice_observations_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({ name: "vendor_advice_observations_attempt_fk", columns: [t.tenantId, t.attemptId], foreignColumns: [vendorPaymentAttempts.tenantId, vendorPaymentAttempts.id] }).onDelete("restrict"),
    check("vendor_advice_observations_check", sql`${t.source} in ('advice','create_late') and ${t.interpreted} in ('pending','settled','settled_unconfirmed',
      'expired','failed','expired_unconfirmed','failed_unconfirmed','amount_mismatch','envelope_error','unrecognized','transport_error')
      and (${t.rc} is null or length(${t.rc}) <= 8) and (${t.status} is null or length(${t.status}) <= 40) and jsonb_typeof(${t.raw}) = 'object'
      and length(${t.raw}::text) <= 4000`),
  ],
);

// The AutoLaris settlement / expiry / failure rules (Q-13). Seeded with one unconfirmed placeholder; this task has no writer that confirms a
// rule (owner-gated with the sanitized Advice evidence).
export const autolarisSettlementRules = pgTable(
  "autolaris_settlement_rules",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    meaning: text("meaning").notNull(),
    status: text("status").notNull(),
    confirmed: boolean("confirmed").notNull().default(false),
    flag: text("flag"),
    evidenceRef: text("evidence_ref"),
    confirmedBy: uuid("confirmed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("autolaris_settlement_rules_key").on(t.meaning, t.status),
    check("autolaris_settlement_rules_check", sql`${t.meaning} in ('settled','expired','failed') and ${t.status} ~ '^[A-Z0-9_]{2,40}$'
      and (not ${t.confirmed} or ${t.evidenceRef} is not null) and (${t.flag} is null or ${t.flag} = 'pending_q13')`),
  ],
);

// A verified settlement of one attempt (once per attempt), and the part of it applied to its invoice (never beyond the payable).
export const vendorPayments = pgTable(
  "vendor_payments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    settledRupiah: integer("settled_rupiah").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    observationId: uuid("observation_id").notNull(),
  },
  (t) => [
    unique("vendor_payments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("vendor_payments_attempt_key").on(t.attemptId),
    foreignKey({ name: "vendor_payments_attempt_fk", columns: [t.tenantId, t.attemptId], foreignColumns: [vendorPaymentAttempts.tenantId, vendorPaymentAttempts.id] }).onDelete("restrict"),
    foreignKey({ name: "vendor_payments_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [vendorInvoices.tenantId, vendorInvoices.id] }).onDelete("restrict"),
    foreignKey({ name: "vendor_payments_observation_fk", columns: [t.tenantId, t.observationId], foreignColumns: [vendorAdviceObservations.tenantId, vendorAdviceObservations.id] }).onDelete("restrict"),
    check("vendor_payments_check", sql`${t.settledRupiah} > 0`),
  ],
);

export const vendorPaymentAllocations = pgTable(
  "vendor_payment_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    amountRupiah: integer("amount_rupiah").notNull(),
  },
  (t) => [
    unique("vendor_payment_allocations_key").on(t.paymentId, t.invoiceId),
    foreignKey({ name: "vendor_payment_allocations_payment_fk", columns: [t.tenantId, t.paymentId], foreignColumns: [vendorPayments.tenantId, vendorPayments.id] }).onDelete("restrict"),
    foreignKey({ name: "vendor_payment_allocations_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [vendorInvoices.tenantId, vendorInvoices.id] }).onDelete("restrict"),
    check("vendor_payment_allocations_check", sql`${t.amountRupiah} > 0`),
  ],
);

// Credit notes (BILL-31): waiver (full), credit (partial, approved), overpayment (a settlement beyond the payable), exit_remainder. A credit
// is a tenant balance (remaining_rupiah) allocated to invoices, oldest first; never spent twice.
export const vendorCreditNotes = pgTable(
  "vendor_credit_notes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    sourceInvoiceId: uuid("source_invoice_id").notNull(),
    kind: text("kind").notNull(),
    amountRupiah: integer("amount_rupiah").notNull(),
    remainingRupiah: integer("remaining_rupiah").notNull(),
    reason: text("reason").notNull(),
    requestId: uuid("request_id").references(() => vendorRequests.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id"),
    requestedBy: uuid("requested_by"),
    approvedBy: uuid("approved_by"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("vendor_credit_notes_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("vendor_credit_notes_request_key").on(t.requestId).where(sql`${t.requestId} is not null`),
    uniqueIndex("vendor_credit_notes_payment_key").on(t.paymentId).where(sql`${t.paymentId} is not null`),
    uniqueIndex("vendor_credit_notes_exit_key").on(t.sourceInvoiceId).where(sql`${t.kind} = 'exit_remainder'`),
    foreignKey({ name: "vendor_credit_notes_invoice_fk", columns: [t.tenantId, t.sourceInvoiceId], foreignColumns: [vendorInvoices.tenantId, vendorInvoices.id] }).onDelete("restrict"),
    foreignKey({ name: "vendor_credit_notes_payment_fk", columns: [t.tenantId, t.paymentId], foreignColumns: [vendorPayments.tenantId, vendorPayments.id] }).onDelete("restrict"),
    check("vendor_credit_notes_check", sql`${t.kind} in ('waiver','credit','overpayment','exit_remainder') and ${t.amountRupiah} > 0
      and ${t.remainingRupiah} between 0 and ${t.amountRupiah} and length(btrim(${t.reason})) between 3 and 500
      and (${t.kind} in ('waiver','credit')) = (${t.requestId} is not null and ${t.requestedBy} is not null and ${t.approvedBy} is not null)
      and (${t.kind} = 'overpayment') = (${t.paymentId} is not null) and (${t.requestedBy} is null or ${t.requestedBy} <> ${t.approvedBy})`),
  ],
);

export const vendorCreditAllocations = pgTable(
  "vendor_credit_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    creditId: uuid("credit_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    amountRupiah: integer("amount_rupiah").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("vendor_credit_allocations_key").on(t.creditId, t.invoiceId),
    foreignKey({ name: "vendor_credit_allocations_credit_fk", columns: [t.tenantId, t.creditId], foreignColumns: [vendorCreditNotes.tenantId, vendorCreditNotes.id] }).onDelete("restrict"),
    foreignKey({ name: "vendor_credit_allocations_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [vendorInvoices.tenantId, vendorInvoices.id] }).onDelete("restrict"),
    check("vendor_credit_allocations_check", sql`${t.amountRupiah} > 0`),
  ],
);

// A support note on an attempt (addendum a1-1): evidence for the owner's later decision; it never changes the attempt and never unlocks.
export const vendorAttemptNotes = pgTable(
  "vendor_attempt_notes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    reason: text("reason").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ name: "vendor_attempt_notes_attempt_fk", columns: [t.tenantId, t.attemptId], foreignColumns: [vendorPaymentAttempts.tenantId, vendorPaymentAttempts.id] }).onDelete("restrict"),
    check("vendor_attempt_notes_check", sql`length(btrim(${t.evidenceRef})) between 3 and 120 and length(btrim(${t.reason})) between 10 and 500
      and ${t.recordedAs} = 'vendor_finance'`),
  ],
);

// The two undecided money policies (addendum a1-3, a1-4), one platform row, no writer in this task: NULL keeps Bayar and issuance closed.
export const vendorBillingPolicy = pgTable(
  "vendor_billing_policy",
  {
    id: integer("id").primaryKey(),
    channelFeeBearer: text("channel_fee_bearer"),
    feeBearerRef: text("fee_bearer_ref"),
    taxTreatmentRef: text("tax_treatment_ref"),
  },
  (t) => [
    check("vendor_billing_policy_check", sql`${t.id} = 1 and (${t.channelFeeBearer} is null or ${t.channelFeeBearer} in ('tenant','vendor'))
      and (${t.channelFeeBearer} is null) = (${t.feeBearerRef} is null) and (${t.taxTreatmentRef} is null or length(btrim(${t.taxTreatmentRef})) between 3 and 200)`),
  ],
);

// Reminders (PR-61: at due, +7, +14): once per invoice and kind.
export const vendorReminders = pgTable(
  "vendor_reminders",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    kind: text("kind").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("vendor_reminders_key").on(t.invoiceId, t.kind),
    foreignKey({ name: "vendor_reminders_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [vendorInvoices.tenantId, vendorInvoices.id] }).onDelete("restrict"),
    check("vendor_reminders_check", sql`${t.kind} in ('due','plus7','plus14')`),
  ],
);

// Review items for vendor finance: an unconfirmed Advice settlement / expiry, an amount mismatch, an unknown attempt, an undetermined vendor
// tax status blocking issuance. Once per subject and kind while open.
export const vendorBillingReviews = pgTable(
  "vendor_billing_reviews",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    subjectId: uuid("subject_id"),
    period: text("period"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex("vendor_billing_reviews_key").on(t.tenantId, t.kind, sql`coalesce(${t.subjectId}::text, ${t.period})`),
    check("vendor_billing_reviews_check", sql`${t.kind} in ('advice_unconfirmed','amount_mismatch','attempt_unknown','tax_status_unknown')
      and (${t.subjectId} is not null) <> (${t.period} is not null) and (${t.period} is null or ${MONTH(t.period)})`),
  ],
);
