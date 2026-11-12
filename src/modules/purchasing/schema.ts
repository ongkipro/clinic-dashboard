// Purchasing module schemas (PR-75, DATA-54, DATA-61, BILL-30; T-066, migration 0083, DEC-076). Written only by the
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
import { depots, stockBatches, stockMovements } from "../inventory/schema";
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
