// Cashier module schema (TD-7, DATA-27). T-071 lays the invoice foundation: the header and its lines with the frozen
// price and the tax snapshot (migration 0086). Payments, allocations, receipts and voids are T-072.
//
// - invoices (tenant-ledger, personal): one per sale at a branch; draft → issued → void (void is T-072). The tax state
//   at issue (`is_pkp_at_issue`) is recorded once. A visit's invoice is that visit's patient's; a merged patient is
//   refused (DEC-061).
// - invoice_lines (tenant-ledger, personal): the frozen VAT-inclusive unit price (the branch price at issue), the
//   quantity and discount, the line total, the tax category and basis snapshot, and the VAT split of the line total
//   after discount (BILL-6, BILL-28): vat_base + vat_amount = line_total. `vat_recognised_*` and the tax-document
//   reference are filled by the tax point (payment or delivery; T-072 onwards).
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
    number: text("number"),
    state: text("state", { enum: PATIENT_INVOICE_STATES }).notNull().default("draft"),
    isPkpAtIssue: boolean("is_pkp_at_issue"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedBy: uuid("issued_by"),
    issuedAs: text("issued_as"),
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
    index("invoices_branch_idx").on(t.tenantId, t.branchId, t.state, t.issuedAt),
    check("invoices_check", sql`${t.state} in (${inList(PATIENT_INVOICE_STATES)}) and ${KEY(t.commandKey)}
      and ${t.soldBranchId} = ${t.branchId}
      and (${t.visitId} is null or ${t.patientId} is not null)
      and ((${t.state} = 'draft') = (${t.issuedAt} is null))
      and num_nonnulls(${t.issuedAt}, ${t.issuedBy}, ${t.issuedAs}, ${t.isPkpAtIssue}) in (0, 4)
      and (${t.number} is null or length(${t.number}) between 1 and 40)`),
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
