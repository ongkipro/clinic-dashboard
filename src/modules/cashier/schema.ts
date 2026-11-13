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
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { clinicalRequests, planItems, procedureConsents } from "../clinical/schema";
import { documentTemplateVersions } from "../documents/schema";
import { catalogItems, catalogVersions, TAX_CATEGORIES } from "../catalog/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
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
    invoiceId: uuid("invoice_id").notNull(),
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
    invoiceId: uuid("invoice_id").notNull(),
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
    check("payment_allocations_check", sql`num_nonnulls(${t.invoiceLineId}) = 1 and ${t.amount} between 1 and ${sql.raw(MONEY)}
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

