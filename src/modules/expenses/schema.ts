// Expenses and petty cash (PR-79, BILL-37, DATA-69; T-084, migration 0100, DEC-097). An expense of a branch: category, business date,
// amount, funding (petty cash, cash, bank, unpaid), description, an optional receipt (bytes read only through expense_receipt), a supplier
// for unpaid. An unpaid expense owns exactly one supplier invoice of kind expense (supplier_invoices.expense_id), paid through the supplier
// payment flow; corrections are reversals (both reversed together). Posting (ExpenseRecorded / ExpenseReversed) integrates in M8.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";
import { suppliers } from "../purchasing/schema";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const EXPENSE_FUNDINGS = ["petty_cash", "cash", "bank", "unpaid"] as const;
export const EXPENSE_STATES = ["recorded", "reversed"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "expense_categories_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "expense_categories_updated_by_fk", columns: [t.tenantId, t.updatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("expense_categories_tenant_id_id_key").on(t.tenantId, t.id),
    check("expense_categories_check", sql`length(btrim(${t.name})) between 2 and 60`),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    funding: text("funding", { enum: EXPENSE_FUNDINGS }).notNull(),
    description: text("description").notNull(),
    supplierId: uuid("supplier_id"),
    receiptFileName: text("receipt_file_name"),
    receiptMediaType: text("receipt_media_type"),
    receiptSize: integer("receipt_size"),
    receiptSha256: text("receipt_sha256"),
    receiptContent: bytea("receipt_content"),
    state: text("state", { enum: EXPENSE_STATES }).notNull().default("recorded"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reversedAs: text("reversed_as"),
    reverseReason: text("reverse_reason"),
    commandKey: text("command_key").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "expenses_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "expenses_category_fk", columns: [t.tenantId, t.categoryId], foreignColumns: [expenseCategories.tenantId, expenseCategories.id] }).onDelete("restrict"),
    foreignKey({ name: "expenses_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }).onDelete("restrict"),
    foreignKey({ name: "expenses_recorded_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "expenses_reversed_by_fk", columns: [t.tenantId, t.reversedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("expenses_tenant_id_id_key").on(t.tenantId, t.id),
    unique("expenses_command_key").on(t.tenantId, t.commandKey),
    index("expenses_branch_date_idx").on(t.tenantId, t.branchId, t.businessDate),
    check("expenses_check", sql`${t.amount} between 1 and 1000000000000 and ${t.funding} in (${inList(EXPENSE_FUNDINGS)})
      and length(btrim(${t.description})) between 3 and 200 and ${KEY(t.commandKey)} and ${t.recordedAs} in ('owner','finance','manager')
      and (${t.funding} <> 'unpaid' or ${t.supplierId} is not null)
      and num_nonnulls(${t.receiptFileName}, ${t.receiptMediaType}, ${t.receiptSize}, ${t.receiptSha256}, ${t.receiptContent}) in (0, 5)
      and (${t.receiptMediaType} is null or ${t.receiptMediaType} in ('application/pdf','image/png','image/jpeg'))
      and (${t.receiptSize} is null or ${t.receiptSize} between 1 and 5242880)
      and (${t.receiptSha256} is null or ${t.receiptSha256} ~ '^[0-9a-f]{64}$')
      and (${t.funding} not in ('petty_cash','cash') or ${t.receiptContent} is not null)
      and ${t.state} in (${inList(EXPENSE_STATES)}) and ((${t.state} = 'reversed') = (${t.reversedAt} is not null))
      and num_nonnulls(${t.reversedAt}, ${t.reversedBy}, ${t.reversedAs}, ${t.reverseReason}) in (0, 4)
      and (${t.reverseReason} is null or length(btrim(${t.reverseReason})) between 3 and 300)`),
  ],
);
