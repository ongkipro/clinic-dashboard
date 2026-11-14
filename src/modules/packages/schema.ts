// Packages (PR-20, BILL-7..11, BILL-16, BILL-24, BILL-25, DATA-29; T-076, migration 0091, DEC-087). A package is sold
// as the one line of a patient's Kasir invoice with no visit; its paid value is the real money allocated to that line
// minus what moved to balance. Sessions split the price by BILL-7 and unlock by paid value (BILL-8); a session is
// reserved on an open visit, bound to the execution that starts it, and redeemed only on a counted outcome (B-15).
// Expiry or cancellation moves the paid-unused value to the patient balance; the unpaid remainder is cancelled.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invoiceLines, invoices, receipts, receivables } from "../cashier/schema";
import { catalogItems, catalogVersions, TAX_CATEGORIES } from "../catalog/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { treatmentExecutions } from "../treatment/schema";
import { visits } from "../visits/schema";

export const PACKAGE_STATES = ["active", "expired", "cancelled"] as const;
export const SESSION_STATES = ["available", "reserved", "redeemed", "closed"] as const;
export const SUBSTITUTION_STATES = ["pending", "approved", "declined"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const MONEY = "1000000000000";

// Templat Paket (spec 19 §2.8): the services of a package version, in order, with their count. Editable while the
// version is unreferenced; frozen once sold (CLIN-011); copied to a new version of the same item.
export const packageContents = pgTable(
  "package_contents",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    packageVersionId: uuid("package_version_id").notNull(),
    seq: smallint("seq").notNull(),
    serviceItemId: uuid("service_item_id").notNull(),
    count: smallint("count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "package_contents_version_fk", columns: [t.tenantId, t.packageVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "package_contents_service_fk", columns: [t.tenantId, t.serviceItemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    unique("package_contents_tenant_id_id_key").on(t.tenantId, t.id),
    unique("package_contents_seq_key").on(t.tenantId, t.packageVersionId, t.seq),
    unique("package_contents_service_key").on(t.tenantId, t.packageVersionId, t.serviceItemId),
    check("package_contents_check", sql`${t.seq} between 1 and 20 and ${t.count} between 1 and 50`),
  ],
);

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    soldBranchId: uuid("sold_branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    itemId: uuid("item_id").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    price: bigint("price", { mode: "number" }).notNull(),
    minDp: bigint("min_dp", { mode: "number" }).notNull(),
    validityEnd: timestamp("validity_end", { withTimezone: true }).notNull(),
    // Value that left the package to the balance before close (a cheaper substitution's difference).
    movedToBalance: bigint("moved_to_balance", { mode: "number" }).notNull().default(0),
    state: text("state", { enum: PACKAGE_STATES }).notNull().default("active"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    closedAs: text("closed_as"),
    closeReason: text("close_reason"),
    paidUnusedMoved: bigint("paid_unused_moved", { mode: "number" }),
    remainderCancelled: bigint("remainder_cancelled", { mode: "number" }),
    vatReversedAmount: bigint("vat_reversed_amount", { mode: "number" }).notNull().default(0),
    vatReversedAt: timestamp("vat_reversed_at", { withTimezone: true }),
    // T-082 (PR-93, DATA-67): family sharing, snapshotted from the template (package_sharing) at the sale instant.
    sharingAllowed: boolean("sharing_allowed").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "packages_branch_fk", columns: [t.tenantId, t.soldBranchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "packages_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "packages_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "packages_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    foreignKey({ name: "packages_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "packages_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "packages_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("packages_tenant_id_id_key").on(t.tenantId, t.id),
    unique("packages_line_key").on(t.tenantId, t.invoiceLineId),
    index("packages_patient_idx").on(t.tenantId, t.patientId),
    index("packages_expiry_idx").on(t.state, t.validityEnd),
    check("packages_check", sql`${t.state} in (${inList(PACKAGE_STATES)}) and ${t.price} between 1 and ${sql.raw(MONEY)}
      and ${t.minDp} between 1 and ${t.price} and ${t.movedToBalance} between 0 and ${t.price}
      and ((${t.state} = 'active') = (${t.closedAt} is null))
      and (${t.state} = 'active' or ${t.closeReason} is not null and ${t.paidUnusedMoved} >= 0 and ${t.remainderCancelled} >= 0)
      and ${t.vatReversedAmount} >= 0 and ((${t.vatReversedAmount} > 0) = (${t.vatReversedAt} is not null))`),
  ],
);

export const packageSessions = pgTable(
  "package_sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    packageId: uuid("package_id").notNull(),
    seq: smallint("seq").notNull(),
    serviceItemId: uuid("service_item_id").notNull(),
    allocatedValue: bigint("allocated_value", { mode: "number" }).notNull(),
    taxCategory: text("tax_category", { enum: TAX_CATEGORIES }).notNull(),
    taxBasis: text("tax_basis").notNull(),
    vatBase: bigint("vat_base", { mode: "number" }).notNull(),
    vatAmount: bigint("vat_amount", { mode: "number" }).notNull(),
    vatRecognisedAmount: bigint("vat_recognised_amount", { mode: "number" }).notNull().default(0),
    vatRecognisedAt: timestamp("vat_recognised_at", { withTimezone: true }),
    state: text("state", { enum: SESSION_STATES }).notNull().default("available"),
    reservedVisitId: uuid("reserved_visit_id"),
    reservedExecutionId: uuid("reserved_execution_id"),
    // T-082 (DATA-67): the treated patient (canonical) of a reserved or redeemed session — the owner or a beneficiary.
    beneficiaryPatientId: uuid("beneficiary_patient_id"),
    returnedExecutionIds: uuid("returned_execution_ids").array().notNull().default(sql`'{}'::uuid[]`),
    redeemedBranchId: uuid("redeemed_branch_id"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "package_sessions_package_fk", columns: [t.tenantId, t.packageId], foreignColumns: [packages.tenantId, packages.id] }).onDelete("restrict"),
    foreignKey({ name: "package_sessions_service_fk", columns: [t.tenantId, t.serviceItemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "package_sessions_visit_fk", columns: [t.tenantId, t.reservedVisitId], foreignColumns: [visits.tenantId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "package_sessions_execution_fk", columns: [t.tenantId, t.reservedExecutionId], foreignColumns: [treatmentExecutions.tenantId, treatmentExecutions.id] }).onDelete("restrict"),
    foreignKey({ name: "package_sessions_redeemed_branch_fk", columns: [t.tenantId, t.redeemedBranchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("package_sessions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("package_sessions_seq_key").on(t.tenantId, t.packageId, t.seq),
    unique("package_sessions_execution_key").on(t.tenantId, t.reservedExecutionId),
    foreignKey({ name: "package_sessions_beneficiary_fk", columns: [t.tenantId, t.beneficiaryPatientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    index("package_sessions_beneficiary_idx").on(t.tenantId, t.beneficiaryPatientId).where(sql`${t.beneficiaryPatientId} is not null`),
    index("package_sessions_visit_idx").on(t.tenantId, t.reservedVisitId),
    check("package_sessions_check", sql`${t.state} in (${inList(SESSION_STATES)}) and ${t.seq} between 1 and 1000
      and ${t.allocatedValue} >= 0 and ${t.taxCategory} in (${inList(TAX_CATEGORIES)})
      and ${t.vatBase} >= 0 and ${t.vatAmount} >= 0 and ${t.vatBase} + ${t.vatAmount} = ${t.allocatedValue}
      and ${t.vatRecognisedAmount} between 0 and ${t.vatAmount} and ((${t.vatRecognisedAmount} > 0) = (${t.vatRecognisedAt} is not null))
      and (${t.state} <> 'reserved' or ${t.reservedVisitId} is not null) and (${t.state} not in ('available','closed') or ${t.reservedVisitId} is null) and (${t.reservedExecutionId} is null or ${t.state} in ('reserved','redeemed'))
      and ((${t.state} = 'redeemed') = (${t.redeemedAt} is not null)) and ((${t.state} = 'redeemed') = (${t.redeemedBranchId} is not null))
      and (${t.state} <> 'redeemed' or ${t.reservedExecutionId} is not null) and ${t.version} >= 0`),
    check("package_sessions_beneficiary_check", sql`(${t.state} in ('reserved','redeemed')) = (${t.beneficiaryPatientId} is not null)`),
  ],
);

// Tukar Sesi (BILL-11): requested by FO/cashier, a manager or a BC; decided by a doctor or facility head of the
// branch (≠ requester). Cheaper → the difference to balance; dearer → a difference line to pay; equal → the service only.
export const packageSubstitutions = pgTable(
  "package_substitutions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    packageId: uuid("package_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    oldServiceItemId: uuid("old_service_item_id").notNull(),
    newServiceItemId: uuid("new_service_item_id").notNull(),
    oldValue: bigint("old_value", { mode: "number" }).notNull(),
    newPrice: bigint("new_price", { mode: "number" }).notNull(),
    difference: bigint("difference", { mode: "number" }).notNull(), // new − old: > 0 paid, < 0 to balance
    reason: text("reason").notNull(),
    state: text("state", { enum: SUBSTITUTION_STATES }).notNull().default("pending"),
    requestedBy: uuid("requested_by").notNull(),
    requestedAs: text("requested_as").notNull(),
    decidedBy: uuid("decided_by"),
    decidedAs: text("decided_as"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    commandKey: text("command_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "package_substitutions_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "package_substitutions_package_fk", columns: [t.tenantId, t.packageId], foreignColumns: [packages.tenantId, packages.id] }).onDelete("restrict"),
    foreignKey({ name: "package_substitutions_session_fk", columns: [t.tenantId, t.sessionId], foreignColumns: [packageSessions.tenantId, packageSessions.id] }).onDelete("restrict"),
    foreignKey({ name: "package_substitutions_old_fk", columns: [t.tenantId, t.oldServiceItemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "package_substitutions_new_fk", columns: [t.tenantId, t.newServiceItemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "package_substitutions_requested_by_fk", columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "package_substitutions_decided_by_fk", columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("package_substitutions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("package_substitutions_command_key").on(t.tenantId, t.commandKey),
    index("package_substitutions_session_idx").on(t.tenantId, t.sessionId),
    check("package_substitutions_check", sql`${t.state} in (${inList(SUBSTITUTION_STATES)}) and ${t.oldValue} >= 0 and ${t.newPrice} >= 1
      and ${t.difference} = ${t.newPrice} - ${t.oldValue} and ${t.oldServiceItemId} <> ${t.newServiceItemId}
      and length(btrim(${t.reason})) between 3 and 500 and ${KEY(t.commandKey)}
      and ${t.requestedAs} in ('fo_cashier','manager','bc')
      and ((${t.state} = 'pending') = (${t.decidedAt} is null)) and num_nonnulls(${t.decidedAt}, ${t.decidedBy}, ${t.decidedAs}) in (0, 3)
      and (${t.decidedAs} is null or ${t.decidedAs} in ('doctor','facility_head'))
      and (${t.state} <> 'declined' or length(btrim(${t.decisionReason})) between 3 and 500)`),
  ],
);

// Isi Saldo (UX-13 Top Up Saldo; DEC-086 (7)): the money received for the balance, with its Kasir receipt and payment
// (no invoice); credits `top_up` through balance_post. Not turnover (no invoice line). Insert-only.
export const balanceTopUps = pgTable(
  "balance_top_ups",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    commandKey: text("command_key").notNull(),
    receivedBy: uuid("received_by").notNull(),
    receivedAs: text("received_as").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_top_ups_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_top_ups_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_top_ups_receipt_fk", columns: [t.tenantId, t.receiptId], foreignColumns: [receipts.tenantId, receipts.id] }).onDelete("restrict"),
    foreignKey({ name: "balance_top_ups_by_fk", columns: [t.tenantId, t.receivedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("balance_top_ups_tenant_id_id_key").on(t.tenantId, t.id),
    unique("balance_top_ups_receipt_key").on(t.tenantId, t.receiptId),
    unique("balance_top_ups_command_key").on(t.tenantId, t.commandKey),
    check("balance_top_ups_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${KEY(t.commandKey)}
      and ${t.receivedAs} in ('owner','manager','fo_cashier','finance')`),
  ],
);

// Family sharing (PR-93, P-24, DATA-67; T-082, migration 0098). The switch per package template (catalog item of kind package) is
// versioned and insert-only: the state at an instant is the latest version changed at or before it (no row = off, the default).
// Only the owner changes it, with a reason.
export const packageSharing = pgTable(
  "package_sharing",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull(),
    enabled: boolean("enabled").notNull(),
    reason: text("reason").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAs: text("changed_as").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "package_sharing_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "package_sharing_changed_by_fk", columns: [t.tenantId, t.changedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("package_sharing_tenant_id_id_key").on(t.tenantId, t.id),
    unique("package_sharing_version_key").on(t.tenantId, t.itemId, t.version),
    check("package_sharing_check", sql`${t.version} >= 1 and length(btrim(${t.reason})) between 3 and 500 and ${t.changedAs} = 'owner'`),
  ],
);

// Named beneficiaries of a sharing package (PR-93, BILL-11): the patient (canonical at grant) may redeem sessions; the package owner
// keeps ownership, refunds and the balance. Granted and removed with a reason; never deleted; one active row per canonical patient.
export const packageBeneficiaries = pgTable(
  "package_beneficiaries",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    packageId: uuid("package_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    grantedBy: uuid("granted_by").notNull(),
    grantedAs: text("granted_as").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    grantReason: text("grant_reason").notNull(),
    removedBy: uuid("removed_by"),
    removedAs: text("removed_as"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removeReason: text("remove_reason"),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "package_beneficiaries_package_fk", columns: [t.tenantId, t.packageId], foreignColumns: [packages.tenantId, packages.id] }).onDelete("restrict"),
    foreignKey({ name: "package_beneficiaries_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "package_beneficiaries_granted_by_fk", columns: [t.tenantId, t.grantedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "package_beneficiaries_removed_by_fk", columns: [t.tenantId, t.removedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("package_beneficiaries_tenant_id_id_key").on(t.tenantId, t.id),
    unique("package_beneficiaries_command_key").on(t.tenantId, t.commandKey),
    index("package_beneficiaries_package_idx").on(t.tenantId, t.packageId),
    check("package_beneficiaries_check", sql`${KEY(t.commandKey)} and length(btrim(${t.grantReason})) between 3 and 500
      and ${t.grantedAs} in ('owner','manager','fo_cashier')
      and num_nonnulls(${t.removedBy}, ${t.removedAs}, ${t.removedAt}, ${t.removeReason}) in (0, 4)
      and (${t.removeReason} is null or length(btrim(${t.removeReason})) between 3 and 500)
      and (${t.removedAs} is null or ${t.removedAs} in ('owner','manager','fo_cashier'))`),
  ],
);

// Reminder-only instalment schedules (PR-96, BILL-9, DATA-67; T-083, migration 0099, DEC-096). A schedule targets exactly one package or
// receivable; versions replace each other (one active per target); base_paid is the target's paid amount when the version was set, so a
// row k is covered when paid − base_paid ≥ its cumulative amount. A schedule creates no debt, journal, interest or entitlement: nothing
// on the unlock or payment path reads it. Cancelled automatically when the target closes or is fully paid.
export const INSTALMENT_STATES = ["active", "cancelled"] as const;
export const INSTALMENT_CANCEL_REASONS = ["replaced", "target_closed", "paid", "manual"] as const;
export const instalmentSchedules = pgTable(
  "instalment_schedules",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(), // the target's branch (the package's sold branch, the receivable's branch)
    patientId: uuid("patient_id").notNull(),
    packageId: uuid("package_id"),
    receivableId: uuid("receivable_id"),
    version: integer("version").notNull(),
    basePaid: bigint("base_paid", { mode: "number" }).notNull(),
    state: text("state", { enum: INSTALMENT_STATES }).notNull().default("active"),
    cancelReason: text("cancel_reason", { enum: INSTALMENT_CANCEL_REASONS }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancelledAs: text("cancelled_as"),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "instalment_schedules_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "instalment_schedules_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "instalment_schedules_package_fk", columns: [t.tenantId, t.packageId], foreignColumns: [packages.tenantId, packages.id] }).onDelete("restrict"),
    foreignKey({ name: "instalment_schedules_receivable_fk", columns: [t.tenantId, t.receivableId], foreignColumns: [receivables.tenantId, receivables.id] }).onDelete("restrict"),
    foreignKey({ name: "instalment_schedules_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "instalment_schedules_cancelled_by_fk", columns: [t.tenantId, t.cancelledBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("instalment_schedules_tenant_id_id_key").on(t.tenantId, t.id),
    unique("instalment_schedules_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("instalment_schedules_command_key").on(t.tenantId, t.commandKey),
    unique("instalment_schedules_package_version_key").on(t.tenantId, t.packageId, t.version),
    unique("instalment_schedules_receivable_version_key").on(t.tenantId, t.receivableId, t.version),
    uniqueIndex("instalment_schedules_package_active_key").on(t.tenantId, t.packageId).where(sql`${t.state} = 'active' and ${t.packageId} is not null`),
    uniqueIndex("instalment_schedules_receivable_active_key").on(t.tenantId, t.receivableId).where(sql`${t.state} = 'active' and ${t.receivableId} is not null`),
    check("instalment_schedules_check", sql`num_nonnulls(${t.packageId}, ${t.receivableId}) = 1 and ${t.version} >= 1 and ${t.basePaid} >= 0
      and ${KEY(t.commandKey)} and ${t.createdAs} in ('owner','manager','fo_cashier','finance')
      and ${t.state} in (${inList(INSTALMENT_STATES)})
      and ((${t.state} = 'cancelled') = (${t.cancelReason} is not null)) and ((${t.state} = 'cancelled') = (${t.cancelledAt} is not null))
      and (${t.cancelReason} is null or ${t.cancelReason} in (${inList(INSTALMENT_CANCEL_REASONS)}))
      and (${t.cancelReason} is null or ${t.cancelReason} not in ('manual','replaced') or ${t.cancelledBy} is not null and ${t.cancelledAs} is not null)
      and ((${t.cancelledBy} is null) = (${t.cancelledAs} is null))`),
  ],
);
export const instalmentRows = pgTable(
  "instalment_rows",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    seq: smallint("seq").notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    remindedOn: date("reminded_on", { mode: "string" }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "instalment_rows_schedule_fk", columns: [t.tenantId, t.branchId, t.scheduleId],
      foreignColumns: [instalmentSchedules.tenantId, instalmentSchedules.branchId, instalmentSchedules.id] }).onDelete("restrict"),
    unique("instalment_rows_tenant_id_id_key").on(t.tenantId, t.id),
    unique("instalment_rows_seq_key").on(t.tenantId, t.scheduleId, t.seq),
    check("instalment_rows_check", sql`${t.seq} between 1 and 24 and ${t.amount} between 1 and ${sql.raw(MONEY)}`),
  ],
);

