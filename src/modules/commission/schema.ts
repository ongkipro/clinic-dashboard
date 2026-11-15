// Commission engine (PR-23, BILL-15/16/23, DATA-36; T-087, migration 0102, DEC-099). Staff identity earns (B-19). Rules: role defaults and
// individual overrides (an override replaces the defaults), percent (basis points) or fixed rupiah, versioned (draft → active → superseded
// or cancelled; finance prepares, the owner activates). Attribution: the closing and guiding BC of each sale (seeded from the visit's
// selection at issue, set by command for non-visit invoices, corrected only through `attribution_correction`), and the guiding BC of a care
// plan. Accrual (synchronous triggers on the money facts): contributions (one per staff, type and source), entitlements (cumulative,
// rounded to the rupiah), adjustments (refunds, moves to balance, write-offs; net of VAT; before or after payout). Monthly payout batches
// (draft → pending_approval → approved → paid) with per-recipient lines, carry-forward (B-13) and staff receivables at exit (B-21).
// Amounts are integer rupiah. Rows are insert-only except the documented state columns.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { invoiceLines, invoices } from "../cashier/schema";
import { catalogItems, SERVICE_CATEGORIES } from "../catalog/schema";
import { carePlans } from "../clinical/schema";
import { branches, staff, tenants } from "../org/schema";

export const CONTRIBUTION_TYPES = ["closing_bc", "guiding_bc", "new_patient", "performer"] as const;
export const RULE_KINDS = ["percent", "fixed"] as const;
export const RULE_VERSION_STATES = ["draft", "active", "superseded", "cancelled"] as const;
export const ATTRIBUTION_STATES = ["pending_approval", "active", "superseded", "rejected"] as const;
export const SOURCE_KINDS = ["invoice_line", "treatment_execution", "examination"] as const;
export const ADJUSTMENT_CAUSES = ["refund", "interrupted", "package_close", "substitution", "write_off", "attribution"] as const;
export const PAYOUT_BATCH_STATES = ["draft", "pending_approval", "approved", "paid"] as const;
export const STAFF_RECEIVABLE_STATES = ["open", "settled", "waived"] as const;
// Roles that may hold a commission rule (no owner: the owner's bonus is separate, BILL-15).
export const RULE_ROLES = ["manager", "fo_cashier", "central_cs", "bc", "doctor", "nurse", "therapist", "pharmacist", "finance", "admin_pusat", "purchasing", "marketing"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const MONEY = "1000000000000";

// A rule: the scope it applies to. A role default (`staff_id` null; `role` null = every role) or an individual override (`staff_id`).
// Item before category before rule-wide; `priority` breaks ties.
export const commissionRules = pgTable(
  "commission_rules",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    contributionType: text("contribution_type", { enum: CONTRIBUTION_TYPES }).notNull(),
    role: text("role", { enum: RULE_ROLES }),
    staffId: uuid("staff_id"),
    catalogItemId: uuid("catalog_item_id"),
    category: text("category", { enum: SERVICE_CATEGORIES }),
    priority: smallint("priority").notNull().default(0),
    name: text("name").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_rules_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_rules_item_fk", columns: [t.tenantId, t.catalogItemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_rules_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("commission_rules_tenant_id_id_key").on(t.tenantId, t.id),
    unique("commission_rules_command_key").on(t.tenantId, t.commandKey),
    check("commission_rules_check", sql`${KEY(t.commandKey)} and ${t.priority} between -100 and 100 and length(btrim(${t.name})) between 2 and 80
      and (${t.catalogItemId} is null or ${t.category} is null) and ${t.createdAs} in ('owner','finance')
      and (${t.staffId} is null or ${t.role} is null)`),
  ],
);

// A version of a rule: kind and value, effective from (an instant); draft → active (the owner) → superseded/cancelled. Append-only values.
export const commissionRuleVersions = pgTable(
  "commission_rule_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    ruleId: uuid("rule_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind", { enum: RULE_KINDS }).notNull(),
    basisPoints: integer("basis_points"),
    fixedAmount: bigint("fixed_amount", { mode: "number" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    state: text("state", { enum: RULE_VERSION_STATES }).notNull().default("draft"),
    preparedBy: uuid("prepared_by").notNull(),
    preparedAs: text("prepared_as").notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    activatedBy: uuid("activated_by"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_rule_versions_rule_fk", columns: [t.tenantId, t.ruleId], foreignColumns: [commissionRules.tenantId, commissionRules.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_rule_versions_prepared_by_fk", columns: [t.tenantId, t.preparedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_rule_versions_activated_by_fk", columns: [t.tenantId, t.activatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("commission_rule_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("commission_rule_versions_version_key").on(t.tenantId, t.ruleId, t.version),
    unique("commission_rule_versions_command_key").on(t.tenantId, t.commandKey),
    check("commission_rule_versions_check", sql`${KEY(t.commandKey)} and ${t.version} >= 1 and ${t.state} in (${inList(RULE_VERSION_STATES)})
      and ((${t.kind} = 'percent') = (${t.basisPoints} is not null)) and ((${t.kind} = 'fixed') = (${t.fixedAmount} is not null))
      and (${t.basisPoints} is null or ${t.basisPoints} between 1 and 10000) and (${t.fixedAmount} is null or ${t.fixedAmount} between 1 and ${sql.raw(MONEY)})
      and ${t.preparedAs} in ('owner','finance') and ((${t.state} in ('active','superseded')) = (${t.activatedAt} is not null))
      and ((${t.state} in ('superseded','cancelled')) = (${t.endedAt} is not null))`),
  ],
);

// The closing and guiding BC of a sale (one active row per invoice; a correction is a pending row that an approval activates).
export const commissionSaleAttributions = pgTable(
  "commission_sale_attributions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    closingBcStaffId: uuid("closing_bc_staff_id"),
    guidingBcStaffId: uuid("guiding_bc_staff_id"),
    state: text("state", { enum: ATTRIBUTION_STATES }).notNull(),
    source: text("source").notNull(),
    approvalId: uuid("approval_id"),
    reason: text("reason"),
    attributedBy: uuid("attributed_by"),
    attributedAs: text("attributed_as"),
    attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    commandKey: text("command_key"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_sale_attributions_invoice_fk", columns: [t.tenantId, t.branchId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.branchId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_sale_attributions_closing_fk", columns: [t.tenantId, t.closingBcStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_sale_attributions_guiding_fk", columns: [t.tenantId, t.guidingBcStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_sale_attributions_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_sale_attributions_by_fk", columns: [t.tenantId, t.attributedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("commission_sale_attributions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("commission_sale_attributions_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("commission_sale_attributions_one_active").on(t.tenantId, t.invoiceId).where(sql`${t.state} = 'active'`),
    uniqueIndex("commission_sale_attributions_one_pending").on(t.tenantId, t.invoiceId).where(sql`${t.state} = 'pending_approval'`),
    check("commission_sale_attributions_check", sql`${t.state} in (${inList(ATTRIBUTION_STATES)}) and ${t.source} in ('selection','command','correction')
      and (${t.commandKey} is null or ${KEY(t.commandKey)}) and (${t.reason} is null or length(btrim(${t.reason})) between 3 and 500)
      and (${t.state} <> 'pending_approval' or ${t.approvalId} is not null) and (${t.source} <> 'correction' or ${t.approvalId} is not null)
      and ((${t.state} in ('superseded','rejected')) = (${t.endedAt} is not null))
      and (${t.source} = 'selection' or ${t.attributedBy} is not null)`),
  ],
);

// The guiding BC of a care plan (BILL-15: all transactions under the plan until completed or replaced; reassignment recorded).
export const guidingBcAssignments = pgTable(
  "guiding_bc_assignments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    carePlanId: uuid("care_plan_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    state: text("state", { enum: ATTRIBUTION_STATES }).notNull(),
    source: text("source").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    approvalId: uuid("approval_id"),
    reason: text("reason"),
    assignedBy: uuid("assigned_by"),
    assignedAs: text("assigned_as"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "guiding_bc_assignments_plan_fk", columns: [t.tenantId, t.carePlanId], foreignColumns: [carePlans.tenantId, carePlans.id] }).onDelete("restrict"),
    foreignKey({ name: "guiding_bc_assignments_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "guiding_bc_assignments_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "guiding_bc_assignments_by_fk", columns: [t.tenantId, t.assignedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("guiding_bc_assignments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("guiding_bc_assignments_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("guiding_bc_assignments_one_active").on(t.tenantId, t.carePlanId).where(sql`${t.state} = 'active'`),
    uniqueIndex("guiding_bc_assignments_one_pending").on(t.tenantId, t.carePlanId).where(sql`${t.state} = 'pending_approval'`),
    check("guiding_bc_assignments_check", sql`${t.state} in (${inList(ATTRIBUTION_STATES)}) and ${t.source} in ('selection','command','correction')
      and (${t.commandKey} is null or ${KEY(t.commandKey)}) and (${t.reason} is null or length(btrim(${t.reason})) between 3 and 500)
      and (${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}) and (${t.source} = 'selection' or ${t.assignedBy} is not null)
      and (${t.state} <> 'pending_approval' or ${t.approvalId} is not null) and (${t.source} <> 'correction' or ${t.approvalId} is not null)`),
  ],
);

// One contribution per (staff, type, source): the source is an invoice line (closing, guiding, new patient), a treatment execution or an
// examination (performer). The rule version is resolved at the originating invoice's issue (DATA-6).
export const commissionContributions = pgTable(
  "commission_contributions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    contributionType: text("contribution_type", { enum: CONTRIBUTION_TYPES }).notNull(),
    sourceKind: text("source_kind", { enum: SOURCE_KINDS }).notNull(),
    sourceId: uuid("source_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    ruleVersionId: uuid("rule_version_id").notNull(),
    saleAt: timestamp("sale_at", { withTimezone: true }).notNull(),
    blocked: boolean("blocked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_contributions_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_contributions_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_contributions_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_contributions_rule_fk", columns: [t.tenantId, t.ruleVersionId], foreignColumns: [commissionRuleVersions.tenantId, commissionRuleVersions.id] }).onDelete("restrict"),
    unique("commission_contributions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("commission_contributions_one").on(t.tenantId, t.staffId, t.contributionType, t.sourceKind, t.sourceId),
    index("commission_contributions_line_idx").on(t.tenantId, t.invoiceLineId),
    check("commission_contributions_check", sql`${t.contributionType} in (${inList(CONTRIBUTION_TYPES)}) and ${t.sourceKind} in (${inList(SOURCE_KINDS)})
      and ((${t.contributionType} = 'performer') = (${t.sourceKind} <> 'invoice_line'))
      and (${t.sourceKind} <> 'invoice_line' or ${t.sourceId} = ${t.invoiceLineId})`),
  ],
);

// An accrued amount of a contribution: percent entitlements are cumulative steps (the rounded cumulative amount minus what was accrued
// before); a fixed entitlement is one row. `basis` is the net basis that produced the step (0 for fixed).
export const commissionEntitlements = pgTable(
  "commission_entitlements",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    contributionId: uuid("contribution_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    basis: bigint("basis", { mode: "number" }).notNull(),
    factKind: text("fact_kind").notNull(),
    factId: uuid("fact_id").notNull(),
    accruedAt: timestamp("accrued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_entitlements_contribution_fk", columns: [t.tenantId, t.contributionId], foreignColumns: [commissionContributions.tenantId, commissionContributions.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_entitlements_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("commission_entitlements_tenant_id_id_key").on(t.tenantId, t.id),
    unique("commission_entitlements_fact_key").on(t.tenantId, t.contributionId, t.factKind, t.factId),
    index("commission_entitlements_staff_idx").on(t.tenantId, t.staffId),
    check("commission_entitlements_check", sql`${t.amount} between 0 and ${sql.raw(MONEY)} and ${t.basis} >= 0
      and ${t.factKind} in ('allocation','deposit','collection','execution','session','examination','attribution')`),
  ],
);

// A negative adjustment of one entitlement (LIFO over a contribution's entitlements). `after_payout`: the entitlement was in a sealed
// batch when the adjustment arose; it lands in the next open batch (PR-23).
export const commissionAdjustments = pgTable(
  "commission_adjustments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    entitlementId: uuid("entitlement_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    cause: text("cause", { enum: ADJUSTMENT_CAUSES }).notNull(),
    factKind: text("fact_kind").notNull(),
    factId: uuid("fact_id").notNull(),
    afterPayout: boolean("after_payout").notNull(),
    adjustedAt: timestamp("adjusted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_adjustments_entitlement_fk", columns: [t.tenantId, t.entitlementId], foreignColumns: [commissionEntitlements.tenantId, commissionEntitlements.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_adjustments_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("commission_adjustments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("commission_adjustments_fact_key").on(t.tenantId, t.entitlementId, t.factKind, t.factId),
    index("commission_adjustments_staff_idx").on(t.tenantId, t.staffId),
    check("commission_adjustments_check", sql`${t.amount} between ${sql.raw("-" + MONEY)} and -1 and ${t.cause} in (${inList(ADJUSTMENT_CAUSES)})
      and ${t.factKind} in ('refund','invoice_line','package','package_session','write_off','attribution')`),
  ],
);

// A monthly batch (per SET-44 closing day). Items and lines are materialized at submit; a rejected/cancelled batch returns to draft.
export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    periodKey: text("period_key").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    closingDay: text("closing_day").notNull(),
    state: text("state", { enum: PAYOUT_BATCH_STATES }).notNull().default("draft"),
    approvalId: uuid("approval_id"),
    submittedBy: uuid("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    paidBy: uuid("paid_by"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidMethod: text("paid_method"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batches_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batches_submitted_by_fk", columns: [t.tenantId, t.submittedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batches_paid_by_fk", columns: [t.tenantId, t.paidBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batches_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("payout_batches_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payout_batches_period_key").on(t.tenantId, t.periodKey),
    unique("payout_batches_command_key").on(t.tenantId, t.commandKey),
    check("payout_batches_check", sql`${KEY(t.commandKey)} and ${t.periodKey} ~ '^\\d{4}-\\d{2}$' and ${t.periodEnd} > ${t.periodStart}
      and ${t.state} in (${inList(PAYOUT_BATCH_STATES)}) and ((${t.state} = 'draft') = (${t.submittedAt} is null))
      and ((${t.state} = 'paid') = (${t.paidAt} is not null)) and (${t.paidMethod} is null or ${t.paidMethod} in ('cash','transfer'))
      and (${t.state} = 'draft' or ${t.approvalId} is not null)`),
  ],
);

// What a submitted batch pays: each entitlement or adjustment at most once across batches.
export const payoutBatchItems = pgTable(
  "payout_batch_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    entitlementId: uuid("entitlement_id"),
    adjustmentId: uuid("adjustment_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batch_items_batch_fk", columns: [t.tenantId, t.batchId], foreignColumns: [payoutBatches.tenantId, payoutBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batch_items_entitlement_fk", columns: [t.tenantId, t.entitlementId], foreignColumns: [commissionEntitlements.tenantId, commissionEntitlements.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batch_items_adjustment_fk", columns: [t.tenantId, t.adjustmentId], foreignColumns: [commissionAdjustments.tenantId, commissionAdjustments.id] }).onDelete("restrict"),
    unique("payout_batch_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payout_batch_items_entitlement_key").on(t.tenantId, t.entitlementId),
    unique("payout_batch_items_adjustment_key").on(t.tenantId, t.adjustmentId),
    index("payout_batch_items_batch_idx").on(t.tenantId, t.batchId, t.staffId),
    check("payout_batch_items_check", sql`num_nonnulls(${t.entitlementId}, ${t.adjustmentId}) = 1`),
  ],
);

// Per recipient: gross, adjustments, carry-forward in, net payable, carry-forward out (B-13: raw = gross + adjustments − cf_in).
export const payoutBatchLines = pgTable(
  "payout_batch_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    gross: bigint("gross", { mode: "number" }).notNull(),
    adjustments: bigint("adjustments", { mode: "number" }).notNull(),
    carryForwardIn: bigint("carry_forward_in", { mode: "number" }).notNull(),
    netPayable: bigint("net_payable", { mode: "number" }).notNull(),
    carryForwardOut: bigint("carry_forward_out", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batch_lines_batch_fk", columns: [t.tenantId, t.batchId], foreignColumns: [payoutBatches.tenantId, payoutBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_batch_lines_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("payout_batch_lines_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payout_batch_lines_staff_key").on(t.tenantId, t.batchId, t.staffId),
    check("payout_batch_lines_check", sql`${t.gross} >= 0 and ${t.adjustments} <= 0 and ${t.carryForwardIn} >= 0 and ${t.netPayable} >= 0 and ${t.carryForwardOut} >= 0
      and ${t.netPayable} - ${t.carryForwardOut} = ${t.gross} + ${t.adjustments} - ${t.carryForwardIn}
      and (${t.netPayable} = 0 or ${t.carryForwardOut} = 0)`),
  ],
);

// B-21: an exited staff member's unrecovered deduction, for the owner's decision.
export const staffCommissionReceivables = pgTable(
  "staff_commission_receivables",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    sourceBatchLineId: uuid("source_batch_line_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    state: text("state", { enum: STAFF_RECEIVABLE_STATES }).notNull().default("open"),
    decisionReason: text("decision_reason"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_commission_receivables_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_commission_receivables_line_fk", columns: [t.tenantId, t.sourceBatchLineId], foreignColumns: [payoutBatchLines.tenantId, payoutBatchLines.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_commission_receivables_decided_by_fk", columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("staff_commission_receivables_tenant_id_id_key").on(t.tenantId, t.id),
    unique("staff_commission_receivables_line_key").on(t.tenantId, t.sourceBatchLineId),
    check("staff_commission_receivables_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${t.state} in (${inList(STAFF_RECEIVABLE_STATES)})
      and ((${t.state} = 'open') = (${t.decidedAt} is null)) and (${t.state} = 'open' or length(btrim(${t.decisionReason})) between 3 and 500)`),
  ],
);

// ── T-088 (PR-47, DATA-36, D-07, SET-25; migration 0103, DEC-100): BC targets. One active target per staff member and period (bulanan
// `YYYY-MM` or triwulan `YYYY-Qn`, Asia/Jakarta); a new value supersedes the active one (history kept). Set by the owner only; the staff
// member is a BC. Closing value and plans fully selected are computed from the settlement facts (no column here).
export const TARGET_PERIOD_KINDS = ["bulanan", "triwulan"] as const;
export const TARGET_STATES = ["active", "superseded"] as const;
export const staffTargets = pgTable(
  "staff_targets",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    periodKind: text("period_kind", { enum: TARGET_PERIOD_KINDS }).notNull(),
    periodKey: text("period_key").notNull(),
    closingValueTarget: bigint("closing_value_target", { mode: "number" }).notNull(),
    plansTarget: integer("plans_target"),
    state: text("state", { enum: TARGET_STATES }).notNull().default("active"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    setBy: uuid("set_by").notNull(),
    setAs: text("set_as").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_targets_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_targets_set_by_fk", columns: [t.tenantId, t.setBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("staff_targets_tenant_id_id_key").on(t.tenantId, t.id),
    unique("staff_targets_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("staff_targets_one_active").on(t.tenantId, t.staffId, t.periodKey).where(sql`${t.state} = 'active'`),
    check("staff_targets_check", sql`${KEY(t.commandKey)} and ${t.closingValueTarget} between 0 and ${sql.raw(MONEY)}
      and (${t.plansTarget} is null or ${t.plansTarget} between 0 and 100000) and ${t.setAs} = 'owner'
      and ${t.state} in (${inList(TARGET_STATES)}) and ((${t.state} = 'superseded') = (${t.supersededAt} is not null))
      and (${t.periodKind} = 'bulanan' and ${t.periodKey} ~ '^\\d{4}-(0[1-9]|1[0-2])$' or ${t.periodKind} = 'triwulan' and ${t.periodKey} ~ '^\\d{4}-Q[1-4]$')`),
  ],
);
