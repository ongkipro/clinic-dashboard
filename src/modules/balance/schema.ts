// Patient balance (PR-21, BILL-12, DATA-30; T-075, migration 0090, DEC-086). One account per tenant and canonical
// patient (tenant-shared: every branch of the tenant spends it); insert-only entries with the running balance after
// each (never negative; never expires). The account's balance changes only by its newest entry (the 0077 stock
// pattern: guard before, apply after). Writers are definers only (balance_post); the Kasir tender is `balance`.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { payments } from "../cashier/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { paymentCharges } from "../payments/schema";

export const BALANCE_KINDS = [
  "top_up", "use", "from_expiry", "from_cancel", "from_interrupted_treatment", "from_substitution", "from_refund", "dp_transfer", "cash_refund",
  "opening_balance",
] as const;
const DEBITS = ["use", "cash_refund"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;

export const balanceAccounts = pgTable(
  "balance_accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    patientId: uuid("patient_id").notNull(), // the canonical patient at creation (a merge never moves money, DEC-061)
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_accounts_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    unique("balance_accounts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("balance_accounts_patient_key").on(t.tenantId, t.patientId),
    check("balance_accounts_check", sql`${t.balance} >= 0 and ${t.version} >= 0`),
  ],
);

export const balanceEntries = pgTable(
  "balance_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    // Order of entries (uuid v7 does not order within one millisecond); per account the writer holds the account row.
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id").notNull(),
    accountId: uuid("account_id").notNull(),
    branchId: uuid("branch_id").notNull(), // where it happened
    kind: text("kind", { enum: BALANCE_KINDS }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(), // signed: credits > 0, use and cash_refund < 0
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    vatSettled: boolean("vat_settled").notNull().default(false), // Q-05: off until specified and signed
    paymentId: uuid("payment_id"), // a use: the balance payment
    chargeId: uuid("charge_id"), // money from a port charge (real adapters only, BILL-29)
    sourceKind: text("source_kind"),
    sourceId: uuid("source_id"),
    reason: text("reason"),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_entries_account_fk", columns: [t.tenantId, t.accountId], foreignColumns: [balanceAccounts.tenantId, balanceAccounts.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_entries_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_entries_payment_fk", columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_entries_charge_fk", columns: [t.tenantId, t.chargeId], foreignColumns: [paymentCharges.tenantId, paymentCharges.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_entries_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("balance_entries_tenant_id_id_key").on(t.tenantId, t.id),
    unique("balance_entries_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("balance_entries_payment_key").on(t.tenantId, t.paymentId).where(sql`${t.paymentId} is not null`),
    index("balance_entries_account_idx").on(t.tenantId, t.accountId, t.seq),
    check("balance_entries_check", sql`${t.kind} in (${inList(BALANCE_KINDS)}) and ${t.amount} <> 0 and ${t.balanceAfter} >= 0
      and (${t.kind} in (${inList(DEBITS)})) = (${t.amount} < 0)
      and not ${t.vatSettled}
      and num_nonnulls(${t.paymentId}, ${t.chargeId}, ${t.sourceId}) = 1
      and (${t.sourceKind} is null) = (${t.sourceId} is null) and (${t.sourceKind} is null or ${t.sourceKind} ~ '^[a-z][a-z_]{1,40}$')
      and (${t.kind} = 'use') = (${t.paymentId} is not null)
      and (${t.reason} is null or length(btrim(${t.reason})) between 3 and 500)
      and ${KEY(t.commandKey)}`),
  ],
);
