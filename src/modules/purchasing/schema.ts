// Purchasing module schemas (PR-75, DATA-54, DATA-61, BILL-30; T-066, migration 0083, DEC-076; T-067 below). Written only by the
// 0083 definers; quantities numeric in the stock item's unit (DATA-4), money in integer rupiah, every numeric bounded.
//
// - suppliers (tenant-shared, config): the supplier master; never deleted (deactivated).
// - supplier_receipts (branch-scoped, personal): which supplier delivered which batch to which branch, at what unit
//   cost (unit_cost is not granted to the app role: money readers go through the definers). T-066's receipt writes
//   source `supplier_receipt` with a command key; T-067's goods receipt lines write `goods_receipt` without one.
// - supplier_returns (branch-scoped, personal): a return of a batch to its supplier from a depot with a reason; one
//   `supplier_return` movement at the moving average (value not granted to the app role).
// - supplier_credit_expectations (tenant-ledger, money_total): one per return; expected → received | written_off
//   once (the transitions are T-067's).
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { depots, stockBatches, stockItems, stockMovements } from "../inventory/schema";
import { branches, staff, tenants } from "../org/schema";

export const RETURN_REASONS = ["expired", "near_expiry", "damaged", "recalled", "wrong_item", "quality", "other"] as const;
export const RECEIPT_SOURCES = ["supplier_receipt", "goods_receipt"] as const;
export const EXPECTATION_STATES = ["expected", "received", "written_off"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const qty = (c: unknown) => sql`${c} between 0.0001 and 1000000000 and scale(${c}) <= 4`;
const MONEY = "1000000000000000000";

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    npwp: text("npwp"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "suppliers_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "suppliers_updated_by_fk", columns: [t.tenantId, t.updatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("suppliers_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("suppliers_name_key").on(t.tenantId, sql`lower(btrim(${t.name}))`),
    check("suppliers_check", sql`length(btrim(${t.name})) between 2 and 120 and ${t.paymentTermsDays} between 0 and 180
      and (${t.npwp} is null or ${t.npwp} ~ '^[0-9]{15,16}$')
      and (${t.contactName} is null or length(btrim(${t.contactName})) between 2 and 120)
      and (${t.phone} is null or ${t.phone} ~ '^\\+?[0-9 -]{6,20}$')
      and (${t.email} is null or (${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' and length(${t.email}) <= 200))
      and (${t.address} is null or length(btrim(${t.address})) between 3 and 300)`),
  ],
);

export const supplierReceipts = pgTable(
  "supplier_receipts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    quantity: numeric("quantity").notNull(),
    unitCost: bigint("unit_cost", { mode: "number" }).notNull(),
    deliveryNote: text("delivery_note"),
    sourceKind: text("source_kind", { enum: RECEIPT_SOURCES }).notNull(),
    sourceId: uuid("source_id").notNull(),
    commandKey: text("command_key"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    receivedBy: uuid("received_by").notNull(),
    receivedAs: text("received_as").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_receipts_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_receipts_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_receipts_batch_fk", columns: [t.tenantId, t.branchId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_receipts_by_fk", columns: [t.tenantId, t.receivedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("supplier_receipts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_receipts_command_key").on(t.tenantId, t.commandKey),
    index("supplier_receipts_batch_idx").on(t.tenantId, t.branchId, t.supplierId, t.batchId),
    check("supplier_receipts_check", sql`${qty(t.quantity)} and ${t.unitCost} between 0 and 1000000000
      and ${t.sourceKind} in (${inList(RECEIPT_SOURCES)}) and ((${t.sourceKind} = 'supplier_receipt') = (${t.commandKey} is not null))
      and (${t.commandKey} is null or ${KEY(t.commandKey)}) and ${t.receivedAs} in ('pharmacist','purchasing')
      and (${t.deliveryNote} is null or ${t.deliveryNote} ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$')`),
  ],
);

export const supplierReturns = pgTable(
  "supplier_returns",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    depotId: uuid("depot_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    quantity: numeric("quantity").notNull(),
    reason: text("reason", { enum: RETURN_REASONS }).notNull(),
    note: text("note").notNull(),
    creditNoteRef: text("credit_note_ref"),
    movementId: uuid("movement_id").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    uncostedQty: numeric("uncosted_qty").notNull(),
    commandKey: text("command_key").notNull(),
    returnedAt: timestamp("returned_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    returnedBy: uuid("returned_by").notNull(),
    returnedAs: text("returned_as").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_returns_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_returns_depot_fk", columns: [t.tenantId, t.branchId, t.depotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_returns_batch_fk", columns: [t.tenantId, t.branchId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_returns_movement_fk", columns: [t.tenantId, t.movementId], foreignColumns: [stockMovements.tenantId, stockMovements.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_returns_by_fk", columns: [t.tenantId, t.returnedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("supplier_returns_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_returns_scope_key").on(t.tenantId, t.branchId, t.supplierId, t.id),
    unique("supplier_returns_movement_key").on(t.tenantId, t.movementId),
    unique("supplier_returns_command_key").on(t.tenantId, t.commandKey),
    index("supplier_returns_batch_idx").on(t.tenantId, t.branchId, t.supplierId, t.batchId),
    check("supplier_returns_check", sql`${qty(t.quantity)} and ${t.reason} in (${inList(RETURN_REASONS)})
      and length(btrim(${t.note})) between 3 and 300 and ${KEY(t.commandKey)}
      and ${t.value} between 0 and ${sql.raw(MONEY)} and ${t.uncostedQty} between 0 and ${t.quantity} and scale(${t.uncostedQty}) <= 4
      and ${t.returnedAs} in ('purchasing','pharmacist','manager','admin_pusat','owner')
      and (${t.creditNoteRef} is null or ${t.creditNoteRef} ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$')`),
  ],
);

export const supplierCreditExpectations = pgTable(
  "supplier_credit_expectations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    returnId: uuid("return_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    uncosted: boolean("uncosted").notNull(),
    state: text("state", { enum: EXPECTATION_STATES }).notNull().default("expected"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    // T-067 (PR-90): the credit note that settled it, or the write-off; set once.
    creditNoteId: uuid("credit_note_id"),
    closedReason: text("closed_reason"),
    closedBy: uuid("closed_by"),
    closedAs: text("closed_as"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_expectations_return_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.returnId],
      foreignColumns: [supplierReturns.tenantId, supplierReturns.branchId, supplierReturns.supplierId, supplierReturns.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_expectations_closed_by_fk", columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("supplier_credit_expectations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_credit_expectations_return_key").on(t.tenantId, t.returnId),
    index("supplier_credit_expectations_open_idx").on(t.tenantId, t.supplierId, t.state),
    check("supplier_credit_expectations_check", sql`${t.amount} between 0 and ${sql.raw(MONEY)} and ${t.state} in (${inList(EXPECTATION_STATES)})
      and ((${t.state} = 'expected') = (${t.closedAt} is null)) and num_nonnulls(${t.closedBy}, ${t.closedAs}, ${t.closedAt}) in (0, 3)
      and ((${t.state} = 'received') = (${t.creditNoteId} is not null))
      and ((${t.state} = 'written_off') = (${t.closedReason} is not null))
      and (${t.closedReason} is null or length(btrim(${t.closedReason})) between 3 and 300)
      and (${t.closedAs} is null or ${t.closedAs} in ('finance','purchasing','owner','admin_pusat'))`),
  ],
);

// ── T-067 (PR-90, DATA-25, DATA-64, BILL-34; migration 0084, DEC-077) ────────────────────────────────────────────
// - purchase_orders / purchase_order_lines (branch-scoped, personal): draft → sent → partially_received → received,
//   or cancelled before any receipt; lines unique per item, deactivated rather than deleted; unit_price is not granted to
//   the app role (money readers go through the definers).
// - goods_receipts (branch-scoped, personal): the header of supplier_receipts rows written with source `goods_receipt`.
// - supplier_invoices / _lines, supplier_payments / _allocations, supplier_credit_notes / _applications (tenant-ledger,
//   money_total, one branch each): stored counters (paid, credited, allocated, available) kept equal to the sum of live
//   children by the guards; nothing deleted; reversals mark rows reversed.
export const PO_STATES = ["draft", "sent", "partially_received", "received", "cancelled"] as const;
export const INVOICE_KINDS = ["purchase", "expense"] as const;
export const INVOICE_STATES = ["open", "paid", "reversed"] as const;
export const PAYMENT_METHODS = ["cash", "bank_transfer"] as const;
export const LEDGER_STATES = ["live", "reversed"] as const;
export const CREDIT_SOURCES = ["return", "invoice"] as const;
const REASON = (c: unknown) => sql`(${c} is null or length(btrim(${c})) between 3 and 300)`;
const DOCNO = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$'`;
const money = (c: unknown, min = "0") => sql`${c} between ${sql.raw(min)} and ${sql.raw(MONEY)}`;

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    number: text("number").notNull(),
    expectedDate: text("expected_date"),
    note: text("note"),
    state: text("state", { enum: PO_STATES }).notNull().default("draft"),
    commandKey: text("command_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: uuid("created_by").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "purchase_orders_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "purchase_orders_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "purchase_orders_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("purchase_orders_tenant_id_id_key").on(t.tenantId, t.id),
    unique("purchase_orders_scope_key").on(t.tenantId, t.branchId, t.supplierId, t.id),
    unique("purchase_orders_number_key").on(t.tenantId, t.number),
    unique("purchase_orders_command_key").on(t.tenantId, t.commandKey),
    index("purchase_orders_state_idx").on(t.tenantId, t.branchId, t.state, t.createdAt),
    check("purchase_orders_check", sql`${t.state} in (${inList(PO_STATES)}) and ${t.number} ~ '^PO-[0-9]{6}-[0-9]{4,6}$' and ${KEY(t.commandKey)}
      and (${t.expectedDate} is null or ${t.expectedDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') and (${t.note} is null or length(btrim(${t.note})) between 1 and 300)
      and ((${t.state} = 'draft') = (${t.sentAt} is null) or ${t.state} = 'cancelled')
      and ((${t.state} = 'cancelled') = (${t.cancelledAt} is not null)) and ((${t.cancelledAt} is null) = (${t.cancelReason} is null)) and ${REASON(t.cancelReason)}`),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    poId: uuid("po_id").notNull(),
    itemId: uuid("item_id").notNull(),
    orderedQty: numeric("ordered_qty").notNull(),
    receivedQty: numeric("received_qty").notNull().default("0"),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "purchase_order_lines_po_fk", columns: [t.tenantId, t.poId], foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id] }).onDelete("restrict"),
    foreignKey({ name: "purchase_order_lines_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [stockItems.tenantId, stockItems.id] }).onDelete("restrict"),
    unique("purchase_order_lines_tenant_id_id_key").on(t.tenantId, t.id),
    unique("purchase_order_lines_item_key").on(t.tenantId, t.poId, t.itemId),
    check("purchase_order_lines_check", sql`${qty(t.orderedQty)} and ${t.receivedQty} between 0 and ${t.orderedQty} and scale(${t.receivedQty}) <= 4
      and ${t.unitPrice} between 0 and 1000000000 and (${t.active} or ${t.receivedQty} = 0)`),
  ],
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    poId: uuid("po_id"),
    depotId: uuid("depot_id").notNull(),
    deliveryNote: text("delivery_note"),
    commandKey: text("command_key").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    receivedBy: uuid("received_by").notNull(),
    receivedAs: text("received_as").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "goods_receipts_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "goods_receipts_po_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.poId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.branchId, purchaseOrders.supplierId, purchaseOrders.id] }).onDelete("restrict"),
    foreignKey({ name: "goods_receipts_depot_fk", columns: [t.tenantId, t.branchId, t.depotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    foreignKey({ name: "goods_receipts_by_fk", columns: [t.tenantId, t.receivedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("goods_receipts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("goods_receipts_command_key").on(t.tenantId, t.commandKey),
    index("goods_receipts_branch_idx").on(t.tenantId, t.branchId, t.receivedAt),
    check("goods_receipts_check", sql`${KEY(t.commandKey)} and ${t.receivedAs} in ('pharmacist','purchasing') and (${t.deliveryNote} is null or ${DOCNO(t.deliveryNote)})`),
  ],
);

export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    kind: text("kind", { enum: INVOICE_KINDS }).notNull(),
    expenseId: uuid("expense_id"),
    number: text("number").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    dueDate: text("due_date").notNull(),
    total: bigint("total", { mode: "number" }).notNull(),
    paidAmount: bigint("paid_amount", { mode: "number" }).notNull().default(0),
    creditedAmount: bigint("credited_amount", { mode: "number" }).notNull().default(0),
    state: text("state", { enum: INVOICE_STATES }).notNull().default("open"),
    commandKey: text("command_key").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reverseReason: text("reverse_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_invoices_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_invoices_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_invoices_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_invoices_reversed_by_fk", columns: [t.tenantId, t.reversedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("supplier_invoices_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_invoices_scope_key").on(t.tenantId, t.branchId, t.supplierId, t.id),
    unique("supplier_invoices_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("supplier_invoices_number_key").on(t.tenantId, t.supplierId, sql`lower(btrim(${t.number}))`),
    uniqueIndex("supplier_invoices_expense_key").on(t.tenantId, t.expenseId).where(sql`expense_id is not null`),
    index("supplier_invoices_open_idx").on(t.tenantId, t.supplierId, t.state, t.dueDate),
    check("supplier_invoices_check", sql`${t.kind} in (${inList(INVOICE_KINDS)}) and ((${t.kind} = 'expense') = (${t.expenseId} is not null))
      and ${DOCNO(t.number)} and ${t.invoiceDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and ${t.dueDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and ${t.dueDate} >= ${t.invoiceDate}
      and ${money(t.total, "1")} and ${money(t.paidAmount)} and ${money(t.creditedAmount)} and ${t.paidAmount} + ${t.creditedAmount} <= ${t.total}
      and ${t.state} in (${inList(INVOICE_STATES)}) and ${KEY(t.commandKey)} and ${t.recordedAs} in ('purchasing','finance')
      and ((${t.state} = 'paid') = (${t.paidAmount} + ${t.creditedAmount} = ${t.total} and ${t.state} <> 'reversed'))
      and (${t.state} <> 'reversed' or (${t.paidAmount} = 0 and ${t.creditedAmount} = 0))
      and ((${t.state} = 'reversed') = (${t.reversedAt} is not null)) and num_nonnulls(${t.reversedAt}, ${t.reversedBy}, ${t.reverseReason}) in (0, 3) and ${REASON(t.reverseReason)}`),
  ],
);

export const supplierInvoiceLines = pgTable(
  "supplier_invoice_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    receiptId: uuid("receipt_id"),
    grniAmount: bigint("grni_amount", { mode: "number" }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reversed: boolean("reversed").notNull().default(false),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_invoice_lines_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [supplierInvoices.tenantId, supplierInvoices.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_invoice_lines_receipt_fk", columns: [t.tenantId, t.receiptId], foreignColumns: [supplierReceipts.tenantId, supplierReceipts.id] }).onDelete("restrict"),
    unique("supplier_invoice_lines_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("supplier_invoice_lines_receipt_open_key").on(t.tenantId, t.receiptId).where(sql`receipt_id is not null and not reversed`),
    check("supplier_invoice_lines_check", sql`${money(t.grniAmount)} and ${money(t.amount)}`),
  ],
);

export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    allocatedAmount: bigint("allocated_amount", { mode: "number" }).notNull().default(0),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    paidOn: text("paid_on").notNull(),
    reference: text("reference"),
    state: text("state", { enum: LEDGER_STATES }).notNull().default("live"),
    commandKey: text("command_key").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    recordedBy: uuid("recorded_by").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reverseReason: text("reverse_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_payments_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_payments_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_payments_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_payments_reversed_by_fk", columns: [t.tenantId, t.reversedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("supplier_payments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_payments_scope_key").on(t.tenantId, t.branchId, t.supplierId, t.id),
    unique("supplier_payments_command_key").on(t.tenantId, t.commandKey),
    check("supplier_payments_check", sql`${money(t.amount, "1")} and ${t.allocatedAmount} between 0 and ${t.amount} and ${t.method} in (${inList(PAYMENT_METHODS)})
      and ${t.paidOn} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (${t.reference} is null or ${DOCNO(t.reference)}) and ${t.state} in (${inList(LEDGER_STATES)})
      and ${KEY(t.commandKey)} and (${t.state} <> 'reversed' or ${t.allocatedAmount} = 0)
      and ((${t.state} = 'reversed') = (${t.reversedAt} is not null)) and num_nonnulls(${t.reversedAt}, ${t.reversedBy}, ${t.reverseReason}) in (0, 3) and ${REASON(t.reverseReason)}`),
  ],
);

export const supplierPaymentAllocations = pgTable(
  "supplier_payment_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reversed: boolean("reversed").notNull().default(false),
    commandKey: text("command_key").notNull(),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_payment_allocations_payment_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.paymentId],
      foreignColumns: [supplierPayments.tenantId, supplierPayments.branchId, supplierPayments.supplierId, supplierPayments.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_payment_allocations_invoice_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.invoiceId],
      foreignColumns: [supplierInvoices.tenantId, supplierInvoices.branchId, supplierInvoices.supplierId, supplierInvoices.id] }).onDelete("restrict"),
    unique("supplier_payment_allocations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_payment_allocations_command_key").on(t.tenantId, t.commandKey),
    index("supplier_payment_allocations_invoice_idx").on(t.tenantId, t.invoiceId),
    check("supplier_payment_allocations_check", sql`${money(t.amount, "1")} and ${KEY(t.commandKey)}`),
  ],
);

export const supplierCreditNotes = pgTable(
  "supplier_credit_notes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    number: text("number").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    taxAmount: bigint("tax_amount", { mode: "number" }).notNull().default(0),
    availableAmount: bigint("available_amount", { mode: "number" }).notNull(),
    sourceKind: text("source_kind", { enum: CREDIT_SOURCES }).notNull(),
    returnId: uuid("return_id"),
    invoiceId: uuid("invoice_id"),
    issuedOn: text("issued_on").notNull(),
    state: text("state", { enum: LEDGER_STATES }).notNull().default("live"),
    commandKey: text("command_key").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reverseReason: text("reverse_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_notes_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_notes_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_notes_return_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.returnId],
      foreignColumns: [supplierReturns.tenantId, supplierReturns.branchId, supplierReturns.supplierId, supplierReturns.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_notes_invoice_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.invoiceId],
      foreignColumns: [supplierInvoices.tenantId, supplierInvoices.branchId, supplierInvoices.supplierId, supplierInvoices.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_notes_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_notes_reversed_by_fk", columns: [t.tenantId, t.reversedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("supplier_credit_notes_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_credit_notes_scope_key").on(t.tenantId, t.branchId, t.supplierId, t.id),
    unique("supplier_credit_notes_command_key").on(t.tenantId, t.commandKey),
    unique("supplier_credit_notes_return_key").on(t.tenantId, t.returnId),
    uniqueIndex("supplier_credit_notes_number_key").on(t.tenantId, t.supplierId, sql`lower(btrim(${t.number}))`),
    check("supplier_credit_notes_check", sql`${DOCNO(t.number)} and ${money(t.amount, "1")} and ${t.taxAmount} between 0 and ${t.amount}
      and ${t.availableAmount} between 0 and ${t.amount} and ${t.sourceKind} in (${inList(CREDIT_SOURCES)})
      and ((${t.sourceKind} = 'return') = (${t.returnId} is not null)) and ((${t.sourceKind} = 'invoice') = (${t.invoiceId} is not null))
      and ${t.issuedOn} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and ${t.state} in (${inList(LEDGER_STATES)}) and ${KEY(t.commandKey)} and ${t.recordedAs} in ('purchasing','finance')
      and (${t.state} <> 'reversed' or ${t.availableAmount} = 0)
      and ((${t.state} = 'reversed') = (${t.reversedAt} is not null)) and num_nonnulls(${t.reversedAt}, ${t.reversedBy}, ${t.reverseReason}) in (0, 3) and ${REASON(t.reverseReason)}`),
  ],
);

export const supplierCreditApplications = pgTable(
  "supplier_credit_applications",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    creditNoteId: uuid("credit_note_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reversed: boolean("reversed").notNull().default(false),
    commandKey: text("command_key").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    appliedBy: uuid("applied_by").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_applications_credit_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.creditNoteId],
      foreignColumns: [supplierCreditNotes.tenantId, supplierCreditNotes.branchId, supplierCreditNotes.supplierId, supplierCreditNotes.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_applications_invoice_fk", columns: [t.tenantId, t.branchId, t.supplierId, t.invoiceId],
      foreignColumns: [supplierInvoices.tenantId, supplierInvoices.branchId, supplierInvoices.supplierId, supplierInvoices.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_credit_applications_by_fk", columns: [t.tenantId, t.appliedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("supplier_credit_applications_tenant_id_id_key").on(t.tenantId, t.id),
    unique("supplier_credit_applications_command_key").on(t.tenantId, t.commandKey),
    index("supplier_credit_applications_invoice_idx").on(t.tenantId, t.invoiceId),
    check("supplier_credit_applications_check", sql`${money(t.amount, "1")} and ${KEY(t.commandKey)}`),
  ],
);
