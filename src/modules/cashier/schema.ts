// Cashier module schema (TD-7, DATA-27). T-071 lays the invoice foundation: the header and its lines with the frozen
// price and the tax snapshot (migration 0086). Payments, allocations, receipts and voids are T-072.
//
// - invoices (tenant-ledger, personal): one per sale at a branch; draft → issued → void (void is T-072). The tax state
//   at issue (`is_pkp_at_issue`) is recorded once. A visit's invoice is that visit's patient's; a merged patient is
//   refused (DEC-061).
// - T-072 (Kasir, PR-19, DATA-27, DATA-28; migration 0087): `invoices.number` (INV-<branch code>-YYYYMM-NNNN, set at
//   issue), `void_approval_id` and `voided_at`; receipts (one per Terima, KW-<branch code>-YYYYMM-NNNN, immutable,
//   the rendered body from the tenant's receipt template), payments (one per tender of a Terima, append-only) and
//   payment_allocations (proportional, largest remainder, target an invoice line; append-only). Method, provider,
//   provider account, environment and is_simulated are copied onto every allocation (DATA-28).
// - invoice_lines (tenant-ledger, personal): the frozen VAT-inclusive unit price (the branch price at issue), the
//   quantity and discount, the line total, the tax category and basis snapshot, and the VAT split of the line total
//   after discount (BILL-6, BILL-28): vat_base + vat_amount = line_total. `vat_recognised_*` and the tax-document
//   reference are filled by the tax point (payment or delivery; T-072 onwards).
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { clinicalRequests, planItems, procedureConsents } from "../clinical/schema";
import { documentTemplateVersions } from "../documents/schema";
import { catalogItems, catalogVersions, TAX_CATEGORIES } from "../catalog/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { appointments } from "../scheduling/schema";
import { visits } from "../visits/schema";

export const PATIENT_INVOICE_STATES = ["draft", "issued", "void"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const MONEY = "1000000000000";

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    soldBranchId: uuid("sold_branch_id").notNull(),
    patientId: uuid("patient_id"),
    visitId: uuid("visit_id"),
    // A Jual Cepat sale (T-072): no visit, products only, each handed over by the pharmacist.
    counter: boolean("counter").notNull().default(false),
    // A consultation fee invoice (T-079, PR-12): one fee line, issued only by the consultation definers; never "ordinary".
    consultation: boolean("consultation").notNull().default(false),
    number: text("number"),
    state: text("state", { enum: PATIENT_INVOICE_STATES }).notNull().default("draft"),
    isPkpAtIssue: boolean("is_pkp_at_issue"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedBy: uuid("issued_by"),
    issuedAs: text("issued_as"),
    voidApprovalId: uuid("void_approval_id"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "invoices_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "invoices_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "invoices_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "invoices_issued_by_fk", columns: [t.tenantId, t.issuedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "invoices_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("invoices_tenant_id_id_key").on(t.tenantId, t.id),
    unique("invoices_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("invoices_command_key").on(t.tenantId, t.commandKey),
    unique("invoices_number_key").on(t.tenantId, t.number),
    foreignKey({ name: "invoices_void_approval_fk", columns: [t.tenantId, t.voidApprovalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    index("invoices_branch_idx").on(t.tenantId, t.branchId, t.state, t.issuedAt),
    check("invoices_check", sql`${t.state} in (${inList(PATIENT_INVOICE_STATES)}) and ${KEY(t.commandKey)}
      and ${t.soldBranchId} = ${t.branchId}
      and (${t.visitId} is null or ${t.patientId} is not null) and (not ${t.counter} or ${t.visitId} is null)
      and ((${t.state} = 'draft') = (${t.issuedAt} is null))
      and num_nonnulls(${t.issuedAt}, ${t.issuedBy}, ${t.issuedAs}, ${t.isPkpAtIssue}) in (0, 4)
      and (${t.number} is null or length(${t.number}) between 1 and 40)
      and ((${t.state} = 'void') = (${t.voidedAt} is not null)) and (${t.voidedAt} is null or ${t.voidApprovalId} is not null)`),
    check("invoices_consultation_check", sql`not ${t.consultation} or (${t.visitId} is not null and not ${t.counter})`),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    itemId: uuid("item_id").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    discount: bigint("discount", { mode: "number" }).notNull().default(0),
    lineTotal: bigint("line_total", { mode: "number" }).notNull(),
    taxCategory: text("tax_category", { enum: TAX_CATEGORIES }).notNull(),
    taxBasis: text("tax_basis").notNull(),
    vatBase: bigint("vat_base", { mode: "number" }).notNull(),
    vatAmount: bigint("vat_amount", { mode: "number" }).notNull(),
    // T-074 (PR-15): an addition line names its approved addition plan item (one issued invoice per addition).
    planItemId: uuid("plan_item_id"),
    vatRecognisedAmount: bigint("vat_recognised_amount", { mode: "number" }).notNull().default(0),
    vatRecognisedAt: timestamp("vat_recognised_at", { withTimezone: true }),
    // T-076 (DEC-087): the unpaid remainder cancelled when its package closes (or a stopped addition), the paid value
    // moved to the balance (interrupted treatment; shared ceiling with T-078's refunds), the VAT reversed with it, and
    // the substitution a difference line pays for (FK in migration 0091; the table is in the packages module).
    cancelledAmount: bigint("cancelled_amount", { mode: "number" }).notNull().default(0),
    movedToBalance: bigint("moved_to_balance", { mode: "number" }).notNull().default(0),
    receivableAmount: bigint("receivable_amount", { mode: "number" }).notNull().default(0), // T-078: the delivered remainder converted to a receivable
    vatReversedAmount: bigint("vat_reversed_amount", { mode: "number" }).notNull().default(0),
    vatReversedAt: timestamp("vat_reversed_at", { withTimezone: true }),
    substitutionId: uuid("substitution_id"),
    taxDocumentRef: text("tax_document_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "invoice_lines_invoice_fk", columns: [t.tenantId, t.branchId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.branchId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "invoice_lines_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "invoice_lines_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    unique("invoice_lines_tenant_id_id_key").on(t.tenantId, t.id),
    unique("invoice_lines_plan_item_key").on(t.tenantId, t.invoiceId, t.planItemId),
    foreignKey({ name: "invoice_lines_plan_item_fk", columns: [t.tenantId, t.planItemId], foreignColumns: [planItems.tenantId, planItems.id] }).onDelete("restrict"),
    index("invoice_lines_plan_item_idx").on(t.tenantId, t.planItemId),
    index("invoice_lines_invoice_idx").on(t.tenantId, t.invoiceId),
    unique("invoice_lines_substitution_key").on(t.tenantId, t.invoiceId, t.substitutionId),
    check("invoice_lines_t076_check", sql`${t.cancelledAmount} between 0 and ${t.lineTotal} and ${t.movedToBalance} between 0 and ${t.lineTotal}
      and ${t.cancelledAmount} + ${t.movedToBalance} <= ${t.lineTotal} and ${t.vatReversedAmount} between 0 and ${t.vatRecognisedAmount}
      and ${t.receivableAmount} between 0 and ${t.lineTotal} and ${t.cancelledAmount} + ${t.movedToBalance} + ${t.receivableAmount} <= ${t.lineTotal}
      and ((${t.vatReversedAmount} > 0) = (${t.vatReversedAt} is not null))`),
    check("invoice_lines_amounts_check", sql`${t.quantity} between 1 and 10000
      and ${t.unitPrice} between 0 and ${sql.raw(MONEY)}
      and ${t.discount} between 0 and ${t.unitPrice} * ${t.quantity}
      and ${t.lineTotal} = ${t.unitPrice} * ${t.quantity} - ${t.discount}
      and ${t.vatBase} >= 0 and ${t.vatAmount} >= 0 and ${t.vatBase} + ${t.vatAmount} = ${t.lineTotal}`),
    check("invoice_lines_tax_check", sql`${t.taxCategory} in (${inList(TAX_CATEGORIES)})
      and (${t.taxCategory} not in ('exempt_medical','non_object') or ${t.vatAmount} = 0)
      and length(btrim(${t.taxBasis})) between 1 and 500
      and ${t.vatRecognisedAmount} between 0 and ${t.vatAmount}
      and (${t.vatRecognisedAmount} > 0) = (${t.vatRecognisedAt} is not null)
      and (${t.taxDocumentRef} is null or length(${t.taxDocumentRef}) between 1 and 80)`),
  ],
);

// T-072. A Terima: one receipt, its 1–6 tenders (payments, seq), their allocations to invoice lines.
export const PATIENT_PAYMENT_METHODS = ["cash", "edc", "transfer", "qris", "va", "payment_link", "balance"] as const;
export const PAYMENT_ENVIRONMENTS = ["production", "staging", "demo", "local"] as const;

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    invoiceId: uuid("invoice_id"), // T-076: null for an Isi Saldo receipt (balance_top_ups)
    number: text("number").notNull(),
    total: bigint("total", { mode: "number" }).notNull(),
    body: text("body").notNull(),
    paper: text("paper").notNull(),
    templateVersionId: uuid("template_version_id"),
    isSimulated: boolean("is_simulated").notNull().default(false),
    commandKey: text("command_key").notNull(),
    issuedBy: uuid("issued_by").notNull(),
    issuedAs: text("issued_as").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "receipts_invoice_fk", columns: [t.tenantId, t.branchId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.branchId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "receipts_template_fk", columns: [t.tenantId, t.templateVersionId], foreignColumns: [documentTemplateVersions.tenantId, documentTemplateVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "receipts_issued_by_fk", columns: [t.tenantId, t.issuedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("receipts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("receipts_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("receipts_number_key").on(t.tenantId, t.number),
    unique("receipts_command_key").on(t.tenantId, t.commandKey),
    index("receipts_invoice_idx").on(t.tenantId, t.invoiceId),
    check("receipts_check", sql`${KEY(t.commandKey)} and length(${t.number}) between 1 and 40 and ${t.total} between 1 and ${sql.raw(MONEY)}
      and length(${t.body}) between 10 and 40000 and ${t.paper} in ('a4','80mm','58mm') and ${t.issuedAs} in ('owner','manager','fo_cashier','finance')`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    seq: smallint("seq").notNull(),
    invoiceId: uuid("invoice_id"), // T-076: null for an Isi Saldo payment (balance_top_ups)
    patientId: uuid("patient_id"),
    method: text("method", { enum: PATIENT_PAYMENT_METHODS }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    cashTendered: bigint("cash_tendered", { mode: "number" }),
    changeGiven: bigint("change_given", { mode: "number" }),
    details: jsonb("details"),
    provider: text("provider"),
    providerAccount: text("provider_account"),
    environment: text("environment", { enum: PAYMENT_ENVIRONMENTS }).notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    // T-073 (DATA-51 chain charge → webhook event → payment): a port payment names its charge and the event that
    // settled it (a status poll has no event). Composite FKs are added in migration 0088 (the tables are later).
    chargeId: uuid("charge_id"),
    webhookEventId: uuid("webhook_event_id"),
    receivedBy: uuid("received_by").notNull(),
    receivedAs: text("received_as").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payments_receipt_fk", columns: [t.tenantId, t.branchId, t.receiptId], foreignColumns: [receipts.tenantId, receipts.branchId, receipts.id] }).onDelete("restrict"),
    foreignKey({ name: "payments_invoice_fk", columns: [t.tenantId, t.branchId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.branchId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "payments_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "payments_received_by_fk", columns: [t.tenantId, t.receivedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("payments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payments_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("payments_receipt_seq_key").on(t.tenantId, t.receiptId, t.seq),
    index("payments_invoice_idx").on(t.tenantId, t.invoiceId),
    check("payments_check", sql`${t.seq} between 1 and 6 and ${t.method} in (${inList(PATIENT_PAYMENT_METHODS)}) and ${t.environment} in (${inList(PAYMENT_ENVIRONMENTS)})
      and ${t.amount} between 1 and ${sql.raw(MONEY)}
      and ((${t.method} = 'cash') = (${t.cashTendered} is not null)) and num_nonnulls(${t.cashTendered}, ${t.changeGiven}) in (0, 2)
      and (${t.cashTendered} is null or ${t.cashTendered} between ${t.amount} and ${sql.raw(MONEY)} and ${t.changeGiven} = ${t.cashTendered} - ${t.amount})
      and (${t.details} is null or jsonb_typeof(${t.details}) = 'object')
      and (${t.provider} is null or length(${t.provider}) between 1 and 40) and (${t.providerAccount} is null or length(${t.providerAccount}) between 1 and 80)
      and ${t.receivedAs} in ('owner','manager','fo_cashier','finance')`),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    invoiceLineId: uuid("invoice_line_id"),
    topUpId: uuid("top_up_id"), // T-076: the balance top-up target (DATA-28); FK in migration 0091
    bookingDepositId: uuid("booking_deposit_id"), // T-077: the booking deposit target (DATA-28); FK in migration 0093
    receivableId: uuid("receivable_id"), // T-078: the receivable target (DATA-28 complete); FK in migration 0094
    amount: bigint("amount", { mode: "number" }).notNull(),
    vatPortion: bigint("vat_portion", { mode: "number" }).notNull().default(0),
    method: text("method", { enum: PATIENT_PAYMENT_METHODS }).notNull(),
    provider: text("provider"),
    providerAccount: text("provider_account"),
    environment: text("environment", { enum: PAYMENT_ENVIRONMENTS }).notNull(),
    isSimulated: boolean("is_simulated").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_allocations_payment_fk", columns: [t.tenantId, t.branchId, t.paymentId], foreignColumns: [payments.tenantId, payments.branchId, payments.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_allocations_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    unique("payment_allocations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payment_allocations_payment_line_key").on(t.tenantId, t.paymentId, t.invoiceLineId),
    index("payment_allocations_line_idx").on(t.tenantId, t.invoiceLineId),
    // Exactly one target (DATA-28): the invoice line now; package, booking deposit, balance top-up and receivable
    // targets arrive with their tasks (T-076, T-077, T-075, T-078) and join this count.
    check("payment_allocations_check", sql`num_nonnulls(${t.invoiceLineId}, ${t.topUpId}, ${t.bookingDepositId}, ${t.receivableId}) = 1 and ${t.amount} between 1 and ${sql.raw(MONEY)}
      and ${t.vatPortion} between 0 and ${t.amount} and ${t.method} in (${inList(PATIENT_PAYMENT_METHODS)}) and ${t.environment} in (${inList(PAYMENT_ENVIRONMENTS)})`),
  ],
);

// T-074 (PR-15, BILL-22, B-18; migration 0089): the release of an approved addition before payment by FO/cashier or a
// manager, with the staff accountable for collecting, the authorizing clinician and the patient agreement in force at
// release (so the cashier's record needs no clinical read). One per addition; insert-only.
export const additionReleases = pgTable(
  "addition_releases",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    planItemId: uuid("plan_item_id").notNull(),
    requestId: uuid("request_id").notNull(),
    authorizedBy: uuid("authorized_by").notNull(),
    consentId: uuid("consent_id").notNull(),
    collectorStaffId: uuid("collector_staff_id").notNull(),
    releasedBy: uuid("released_by").notNull(),
    releasedAs: text("released_as").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "addition_releases_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "addition_releases_plan_item_fk", columns: [t.tenantId, t.planItemId], foreignColumns: [planItems.tenantId, planItems.id] }).onDelete("restrict"),
    foreignKey({ name: "addition_releases_request_fk", columns: [t.tenantId, t.requestId], foreignColumns: [clinicalRequests.tenantId, clinicalRequests.id] }).onDelete("restrict"),
    foreignKey({ name: "addition_releases_consent_fk", columns: [t.tenantId, t.consentId], foreignColumns: [procedureConsents.tenantId, procedureConsents.id] }).onDelete("restrict"),
    foreignKey({ name: "addition_releases_authorized_by_fk", columns: [t.tenantId, t.authorizedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "addition_releases_collector_fk", columns: [t.tenantId, t.collectorStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "addition_releases_released_by_fk", columns: [t.tenantId, t.releasedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("addition_releases_tenant_id_id_key").on(t.tenantId, t.id),
    unique("addition_releases_plan_item_key").on(t.tenantId, t.planItemId),
    unique("addition_releases_command_key").on(t.tenantId, t.commandKey),
    index("addition_releases_visit_idx").on(t.tenantId, t.visitId),
    check("addition_releases_check", sql`${t.releasedAs} in ('fo_cashier','manager') and ${KEY(t.commandKey)}`),
  ],
);

// T-077 (PR-22, BILL-13, B-05, DATA-31; migration 0093; DEC-089): the booking DP. Received at the Kasir as a KW receipt and
// one payment with no invoice (the T-076 top-up pattern), allocated to the deposit. One per appointment. Decided once:
// applied to the visit's line on arrival, moved to balance (a patient change at or before the cutoff, or a clinic
// cancellation), forfeited (a later patient change or a no-show) or refunded in cash (a clinic cancellation, scenario 17).
// The cutoff is SET-10 batas_ubah, snapshotted at receipt. VAT (PKP, taxable item) is recognised at receipt and reversed
// on a move or a refund; on apply it moves to the line.
export const DEPOSIT_STATES = ["held", "applied", "moved_to_balance", "forfeited", "refunded"] as const;
export const DEPOSIT_METHODS = ["cash", "edc", "transfer"] as const;
export const bookingDeposits = pgTable(
  "booking_deposits",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    method: text("method", { enum: DEPOSIT_METHODS }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    taxCategory: text("tax_category", { enum: TAX_CATEGORIES }).notNull(),
    isPkpAtReceipt: boolean("is_pkp_at_receipt").notNull(),
    vatBase: bigint("vat_base", { mode: "number" }).notNull(),
    vatAmount: bigint("vat_amount", { mode: "number" }).notNull(),
    vatRecognisedAmount: bigint("vat_recognised_amount", { mode: "number" }).notNull().default(0),
    cutoffHours: smallint("cutoff_hours").notNull(),
    state: text("state", { enum: DEPOSIT_STATES }).notNull().default("held"),
    appliedLineId: uuid("applied_line_id"),
    decisionCode: text("decision_code"),
    refundMethod: text("refund_method"),
    refundDetails: jsonb("refund_details"),
    decidedBy: uuid("decided_by"),
    decidedAs: text("decided_as"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
    receivedBy: uuid("received_by").notNull(),
    receivedAs: text("received_as").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_appointment_fk", columns: [t.tenantId, t.branchId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.branchId, appointments.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_receipt_fk", columns: [t.tenantId, t.receiptId], foreignColumns: [receipts.tenantId, receipts.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_line_fk", columns: [t.tenantId, t.appliedLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_received_by_fk", columns: [t.tenantId, t.receivedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "booking_deposits_decided_by_fk", columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("booking_deposits_tenant_id_id_key").on(t.tenantId, t.id),
    unique("booking_deposits_appointment_key").on(t.tenantId, t.appointmentId),
    unique("booking_deposits_receipt_key").on(t.tenantId, t.receiptId),
    unique("booking_deposits_line_key").on(t.tenantId, t.appliedLineId),
    unique("booking_deposits_command_key").on(t.tenantId, t.commandKey),
    index("booking_deposits_patient_idx").on(t.tenantId, t.patientId),
    check("booking_deposits_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${KEY(t.commandKey)}
      and ${t.method} in (${inList(DEPOSIT_METHODS)}) and ${t.state} in (${inList(DEPOSIT_STATES)}) and ${t.taxCategory} in (${inList(TAX_CATEGORIES)})
      and ${t.vatBase} >= 0 and ${t.vatAmount} >= 0 and ${t.vatBase} + ${t.vatAmount} = ${t.amount} and (${t.isPkpAtReceipt} or ${t.vatAmount} = 0)
      and ${t.vatRecognisedAmount} between 0 and ${t.vatAmount} and ${t.cutoffHours} between 0 and 72
      and ${t.receivedAs} in ('owner','manager','fo_cashier','finance')
      and ((${t.state} = 'held') = (${t.decidedAt} is null)) and ((${t.state} = 'held') = (${t.decidedBy} is null))
      and ((${t.state} = 'applied') = (${t.appliedLineId} is not null))
      and ((${t.state} = 'refunded') = (${t.refundMethod} is not null)) and (${t.refundMethod} is null or ${t.refundMethod} in ('cash','edc','transfer'))
      and (${t.refundDetails} is null or ${t.refundMethod} in ('edc','transfer') and jsonb_typeof(${t.refundDetails}) = 'object')
      and (${t.state} = 'held' or ${t.decisionCode} ~ '^[a-z][a-z_]{2,40}$')
      and (${t.decidedAs} is null or ${t.decidedAs} in ('owner','admin_pusat','manager','fo_cashier','central_cs','finance'))`),
  ],
);

// T-078 (PR-21, PR-37, PR-15, BILL-12, BILL-22, BILL-23, B-04, B-14, B-18, DATA-32/33/61; migration 0094; DEC-090).
// Refunds take invoice-line sources only (DEC-090 (1)): to balance by default (paid at once), or in cash as the approved
// exception (requested → approved → paid). Receivables hold a visit's delivered unpaid remainder; collections are KW receipts
// with a payment and no invoice; a write-off closes the open amount (owner alone, or requested and owner-approved).
export const REFUND_STATES = ["requested", "approved", "paid", "failed"] as const;
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    destination: text("destination", { enum: ["balance", "cash"] }).notNull(),
    state: text("state", { enum: REFUND_STATES }).notNull(),
    delivered: boolean("delivered").notNull(),
    vatReversed: bigint("vat_reversed", { mode: "number" }).notNull().default(0),
    returnedQuantity: integer("returned_quantity"),
    reason: text("reason").notNull(),
    approvalId: uuid("approval_id"),
    balanceEntryId: uuid("balance_entry_id"),
    cashEntryId: uuid("cash_entry_id"),
    paidMethod: text("paid_method"),
    paidDetails: jsonb("paid_details"),
    failureCode: text("failure_code"),
    requestedBy: uuid("requested_by").notNull(),
    requestedAs: text("requested_as").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    paidBy: uuid("paid_by"),
    paidAs: text("paid_as"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
    payKey: text("pay_key"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "refunds_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "refunds_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "refunds_invoice_fk", columns: [t.tenantId, t.branchId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.branchId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "refunds_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    foreignKey({ name: "refunds_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "refunds_requested_by_fk", columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "refunds_paid_by_fk", columns: [t.tenantId, t.paidBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("refunds_tenant_id_id_key").on(t.tenantId, t.id),
    unique("refunds_command_key").on(t.tenantId, t.commandKey),
    unique("refunds_pay_key").on(t.tenantId, t.payKey),
    unique("refunds_approval_key").on(t.tenantId, t.approvalId),
    index("refunds_line_idx").on(t.tenantId, t.invoiceLineId),
    index("refunds_patient_idx").on(t.tenantId, t.patientId),
    check("refunds_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${KEY(t.commandKey)} and (${t.payKey} is null or ${KEY(t.payKey)})
      and ${t.destination} in ('balance','cash') and ${t.state} in (${inList(REFUND_STATES)}) and ${t.vatReversed} between 0 and ${t.amount}
      and (${t.returnedQuantity} is null or ${t.returnedQuantity} between 1 and 10000)
      and length(btrim(${t.reason})) between 3 and 500 and ${t.requestedAs} in ('owner','manager','fo_cashier','finance')
      and (${t.destination} = 'cash') = (${t.approvalId} is not null)
      and (${t.destination} = 'cash' or ${t.state} = 'paid')
      and ((${t.state} = 'paid') = (${t.paidAt} is not null)) and ((${t.state} = 'paid') = (${t.balanceEntryId} is not null))
      and ((${t.state} = 'paid' and ${t.destination} = 'cash') = (${t.cashEntryId} is not null))
      and ((${t.state} = 'paid' and ${t.destination} = 'cash') = (${t.paidMethod} is not null))
      and (${t.paidMethod} is null or ${t.paidMethod} in ('cash','transfer'))
      and (${t.paidDetails} is null or ${t.paidMethod} = 'transfer' and jsonb_typeof(${t.paidDetails}) = 'object')
      and ((${t.state} = 'failed') = (${t.failureCode} is not null)) and (${t.failureCode} is null or ${t.failureCode} ~ '^[a-z_]{3,40}$')
      and (${t.paidAs} is null or ${t.paidAs} in ('owner','manager','fo_cashier','finance'))`),
  ],
);

export const RECEIVABLE_STATES = ["open", "collected", "written_off"] as const;
export const receivables = pgTable(
  "receivables",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    collectedAmount: bigint("collected_amount", { mode: "number" }).notNull().default(0),
    writtenOffAmount: bigint("written_off_amount", { mode: "number" }).notNull().default(0),
    state: text("state", { enum: RECEIVABLE_STATES }).notNull().default("open"),
    writeOffApprovalId: uuid("write_off_approval_id"),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "receivables_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "receivables_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "receivables_visit_fk", columns: [t.tenantId, t.visitId], foreignColumns: [visits.tenantId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "receivables_write_off_approval_fk", columns: [t.tenantId, t.writeOffApprovalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "receivables_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("receivables_tenant_id_id_key").on(t.tenantId, t.id),
    unique("receivables_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("receivables_command_key").on(t.tenantId, t.commandKey),
    index("receivables_patient_idx").on(t.tenantId, t.patientId),
    check("receivables_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${KEY(t.commandKey)} and ${t.state} in (${inList(RECEIVABLE_STATES)})
      and ${t.collectedAmount} >= 0 and ${t.writtenOffAmount} >= 0 and ${t.collectedAmount} + ${t.writtenOffAmount} <= ${t.amount}
      and ((${t.state} = 'collected') = (${t.collectedAmount} = ${t.amount}))
      and ((${t.state} = 'written_off') = (${t.writtenOffAmount} > 0)) and (${t.state} <> 'written_off' or ${t.collectedAmount} + ${t.writtenOffAmount} = ${t.amount})
      and (${t.state} = 'open' or ${t.writeOffApprovalId} is null or ${t.state} = 'written_off')
      and ${t.createdAs} in ('owner','manager','fo_cashier')`),
  ],
);
export const receivableLines = pgTable(
  "receivable_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    receivableId: uuid("receivable_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "receivable_lines_receivable_fk", columns: [t.tenantId, t.branchId, t.receivableId], foreignColumns: [receivables.tenantId, receivables.branchId, receivables.id] }).onDelete("restrict"),
    foreignKey({ name: "receivable_lines_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    unique("receivable_lines_tenant_id_id_key").on(t.tenantId, t.id),
    unique("receivable_lines_line_key").on(t.tenantId, t.invoiceLineId),
    index("receivable_lines_receivable_idx").on(t.tenantId, t.receivableId),
    check("receivable_lines_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)}`),
  ],
);
export const receivableCollections = pgTable(
  "receivable_collections",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    receivableId: uuid("receivable_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    method: text("method").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    commandKey: text("command_key").notNull(),
    receivedBy: uuid("received_by").notNull(),
    receivedAs: text("received_as").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "receivable_collections_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "receivable_collections_receivable_fk", columns: [t.tenantId, t.receivableId], foreignColumns: [receivables.tenantId, receivables.id] }).onDelete("restrict"),
    foreignKey({ name: "receivable_collections_receipt_fk", columns: [t.tenantId, t.receiptId], foreignColumns: [receipts.tenantId, receipts.id] }).onDelete("restrict"),
    foreignKey({ name: "receivable_collections_by_fk", columns: [t.tenantId, t.receivedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("receivable_collections_tenant_id_id_key").on(t.tenantId, t.id),
    unique("receivable_collections_receipt_key").on(t.tenantId, t.receiptId),
    unique("receivable_collections_command_key").on(t.tenantId, t.commandKey),
    index("receivable_collections_receivable_idx").on(t.tenantId, t.receivableId),
    check("receivable_collections_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${KEY(t.commandKey)}
      and ${t.method} in ('cash','edc','transfer','balance') and ${t.receivedAs} in ('owner','manager','fo_cashier','finance')`),
  ],
);
export const writeOffs = pgTable(
  "write_offs",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    receivableId: uuid("receivable_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    approvalId: uuid("approval_id").notNull(),
    ownerSelf: boolean("owner_self").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    approvedBy: uuid("approved_by").notNull(),
    commandKey: text("command_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "write_offs_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "write_offs_receivable_fk", columns: [t.tenantId, t.receivableId], foreignColumns: [receivables.tenantId, receivables.id] }).onDelete("restrict"),
    foreignKey({ name: "write_offs_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "write_offs_requested_by_fk", columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "write_offs_approved_by_fk", columns: [t.tenantId, t.approvedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("write_offs_tenant_id_id_key").on(t.tenantId, t.id),
    unique("write_offs_receivable_key").on(t.tenantId, t.receivableId),
    unique("write_offs_approval_key").on(t.tenantId, t.approvalId),
    unique("write_offs_command_key").on(t.tenantId, t.commandKey),
    check("write_offs_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${KEY(t.commandKey)} and length(btrim(${t.reason})) between 3 and 500
      and (not ${t.ownerSelf} or ${t.requestedBy} = ${t.approvedBy})`),
  ],
);

// ── T-079: consultation fee (BILL-4, PR-12) and free controls (BILL-5), DATA-34 ──
export const CONSULTATION_FEE_STATES = ["charged", "waived", "recharged"] as const;
export const CONSULTATION_WAIVERS = ["purchase", "package_session", "control", "complaint"] as const;
export const CONSULTATION_CONTROL_STATES = ["scheduled", "used", "cancelled"] as const;
// One decision per consultation visit (an examination was opened): charged, waived (purchase, package session, control,
// complaint), or a purchase waiver re-charged once from the refund that took the last qualifying purchase. FKs to packages,
// complaint tasks, refunds (deferred) and controls are declared in the migration's parts SQL (import cycles, DEFERRABLE).
export const consultationFees = pgTable(
  "consultation_fees",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    state: text("state", { enum: CONSULTATION_FEE_STATES }).notNull(),
    waiver: text("waiver", { enum: CONSULTATION_WAIVERS }),
    feeAmount: bigint("fee_amount", { mode: "number" }),
    feeLineId: uuid("fee_line_id"),
    controlId: uuid("control_id"),
    complaintTaskId: uuid("complaint_task_id"),
    rechargeRefundId: uuid("recharge_refund_id"),
    rechargePackageId: uuid("recharge_package_id"),
    deducted: bigint("deducted", { mode: "number" }),
    decidedBy: uuid("decided_by").notNull(),
    decidedAs: text("decided_as").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    rechargedAt: timestamp("recharged_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_fees_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_fees_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_fees_line_fk", columns: [t.tenantId, t.feeLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_fees_decided_by_fk", columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("consultation_fees_tenant_id_id_key").on(t.tenantId, t.id),
    unique("consultation_fees_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("consultation_fees_visit_key").on(t.tenantId, t.visitId),
    unique("consultation_fees_command_key").on(t.tenantId, t.commandKey),
    unique("consultation_fees_control_key").on(t.tenantId, t.controlId),
    unique("consultation_fees_complaint_key").on(t.tenantId, t.complaintTaskId),
    unique("consultation_fees_refund_key").on(t.tenantId, t.rechargeRefundId),
    index("consultation_fees_patient_idx").on(t.tenantId, t.patientId),
    check("consultation_fees_check", sql`${t.state} in (${inList(CONSULTATION_FEE_STATES)}) and ${KEY(t.commandKey)}
      and (${t.waiver} is null or ${t.waiver} in (${inList(CONSULTATION_WAIVERS)}))
      and ((${t.state} = 'charged') = (${t.waiver} is null))
      and (${t.state} <> 'charged' or ${t.feeLineId} is not null)
      and (${t.state} <> 'waived' or ${t.feeLineId} is null)
      and ((${t.state} = 'charged' or ${t.waiver} = 'purchase') = (${t.feeAmount} is not null))
      and (${t.feeAmount} is null or ${t.feeAmount} between 1 and ${sql.raw(MONEY)})
      and ((${t.waiver} = 'control') = (${t.controlId} is not null))
      and ((${t.waiver} = 'complaint') = (${t.complaintTaskId} is not null))
      and ((${t.state} = 'recharged') = (${t.rechargedAt} is not null))
      and (${t.state} <> 'recharged' or (${t.waiver} = 'purchase' and ${t.feeLineId} is not null
           and num_nonnulls(${t.rechargeRefundId}, ${t.rechargePackageId}) = 1 and ${t.deducted} between 0 and ${t.feeAmount}))
      and (${t.state} = 'recharged' or num_nonnulls(${t.rechargeRefundId}, ${t.rechargePackageId}, ${t.deducted}) = 0)
      and ${t.decidedAs} in ('owner','admin_pusat','manager','fo_cashier','finance')`),
  ],
);
// The qualifying purchases frozen at a purchase waiver: a later purchase never decides an earlier fee (4b); the re-charge test
// reads exactly these lines.
export const consultationFeePurchases = pgTable(
  "consultation_fee_purchases",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    feeId: uuid("fee_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_fee_purchases_fee_fk", columns: [t.tenantId, t.branchId, t.feeId], foreignColumns: [consultationFees.tenantId, consultationFees.branchId, consultationFees.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_fee_purchases_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    unique("consultation_fee_purchases_tenant_id_id_key").on(t.tenantId, t.id),
    unique("consultation_fee_purchases_line_key").on(t.tenantId, t.feeId, t.invoiceLineId),
    index("consultation_fee_purchases_line_idx").on(t.tenantId, t.invoiceLineId),
  ],
);
// A free control (BILL-5) of a purchased line: per catalog control_count, dated within control_validity_days of the purchase,
// valid to the control date + SET-7 hari (snapshotted); used once by a visit, or cancelled when the source is fully refunded.
export const consultationControls = pgTable(
  "consultation_controls",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    seq: smallint("seq").notNull(),
    controlDate: date("control_date").notNull(),
    validUntil: date("valid_until").notNull(),
    state: text("state", { enum: CONSULTATION_CONTROL_STATES }).notNull().default("scheduled"),
    usedVisitId: uuid("used_visit_id"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    cancelCode: text("cancel_code"),
    scheduledBy: uuid("scheduled_by").notNull(),
    scheduledAs: text("scheduled_as").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_controls_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_controls_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_controls_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_controls_visit_fk", columns: [t.tenantId, t.usedVisitId], foreignColumns: [visits.tenantId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "consultation_controls_by_fk", columns: [t.tenantId, t.scheduledBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("consultation_controls_tenant_id_id_key").on(t.tenantId, t.id),
    unique("consultation_controls_seq_key").on(t.tenantId, t.invoiceLineId, t.seq),
    unique("consultation_controls_command_key").on(t.tenantId, t.commandKey),
    index("consultation_controls_patient_idx").on(t.tenantId, t.patientId, t.state),
    check("consultation_controls_check", sql`${t.state} in (${inList(CONSULTATION_CONTROL_STATES)}) and ${KEY(t.commandKey)}
      and ${t.seq} between 1 and 20
      and ${t.validUntil} >= ${t.controlDate}
      and ((${t.state} = 'used') = (${t.usedVisitId} is not null)) and ((${t.state} = 'used') = (${t.usedAt} is not null))
      and ((${t.state} = 'cancelled') = (${t.cancelCode} is not null))
      and (${t.cancelCode} is null or ${t.cancelCode} in ('source_refunded'))
      and ${t.scheduledAs} in ('owner','manager','fo_cashier','doctor')`),
  ],
);
