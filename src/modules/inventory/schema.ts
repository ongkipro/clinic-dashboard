// Inventory module schemas (DATA-25, PR-17; T-060, migration 0077). Policy kind: branch-scoped (batches, vials,
// movements, levels, counts) and tenant-shared (items); read through the policies of 0077 and written only by its
// definers. Quantities are numeric in the item's use unit (DATA-4): never summed across items; every numeric column is
// bounded (rejects NaN and Infinity) with at most 4 decimals.
//
// `stock_batches.quantity` is the branch quantity of a batch; T-061 (DATA-63) adds depots and batch holdings and
// moves each batch's quantity into the branch's gudang. Every quantity change is one `stock_movements` row in the
// same transaction (checked both ways at commit); movements are never updated or deleted.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { catalogItems } from "../catalog/schema";
import { rooms } from "../org/branches/schema";
import { branches, staff, tenants } from "../org/schema";

export const STOCK_STORAGE_KINDS = ["ruang", "sejuk", "dingin"] as const;
export const BATCH_STATES = ["active", "quarantined", "recalled"] as const;
export const VIAL_STATES = ["open", "finished", "lapsed"] as const;
// T-060 writes receive and adjust; the later kinds are declared now so T-061/T-062/T-065/T-066 add no CHECK change.
export const MOVEMENT_KINDS = ["receive", "adjust", "issue", "consume", "return", "waste", "transfer_out", "transfer_in", "supplier_return", "dispense"] as const;
export const RECEIVE_REASONS = ["stok_awal", "penerimaan"] as const;
export const COUNT_STATES = ["draft", "pending_approval", "applied", "rejected", "cancelled"] as const;
export const STOCK_WRITER_ROLES = ["pharmacist", "purchasing", "admin_pusat"] as const;
// T-061 (PR-89, DATA-63; migration 0078).
export const DEPOT_KINDS = ["gudang", "ruang", "apotek"] as const;
export const TRANSFER_KINDS = ["intra", "inter"] as const;
export const TRANSFER_STATES = ["posted", "sent", "received", "cancelled"] as const;
export const LEGS = ["out", "in"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
// Bounded numeric: rejects NaN/Infinity (they pass `>= 0` in PostgreSQL), at most 4 decimals.
const qty = (c: unknown, min: string, max = "1000000000") => sql`${c} between ${sql.raw(min)} and ${sql.raw(max)} and scale(${c}) <= 4`;

export const stockItems = pgTable(
  "stock_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    catalogItemId: uuid("catalog_item_id").notNull(),
    unit: text("unit").notNull(),
    vialSize: numeric("vial_size"),
    openedUseHours: integer("opened_use_hours"),
    storage: text("storage", { enum: STOCK_STORAGE_KINDS }).notNull().default("ruang"),
    registrationNo: text("registration_no"),
    highValue: boolean("high_value").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_items_catalog_fk", columns: [t.tenantId, t.catalogItemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_items_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_items_updated_by_fk", columns: [t.tenantId, t.updatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("stock_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("stock_items_tenant_catalog_key").on(t.tenantId, t.catalogItemId),
    check("stock_items_unit_check", sql`${t.unit} ~ '^[a-zA-Z][a-zA-Z0-9.]{0,11}$'`),
    check("stock_items_vial_check", sql`((${t.vialSize} is null) = (${t.openedUseHours} is null))
      and (${t.vialSize} is null or ${qty(t.vialSize, "0.0001", "100000")} and ${t.vialSize} > 0)
      and (${t.openedUseHours} is null or ${t.openedUseHours} between 1 and 8760)`),
    check("stock_items_storage_check", sql`${t.storage} in (${inList(STOCK_STORAGE_KINDS)})`),
    check("stock_items_registration_check", sql`${t.registrationNo} is null or ${t.registrationNo} ~ '^[A-Za-z0-9./ -]{3,40}$'`),
  ],
);

export const stockBatches = pgTable(
  "stock_batches",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    batchNo: text("batch_no").notNull(),
    expiry: date("expiry").notNull(),
    quantity: numeric("quantity").notNull(),
    state: text("state", { enum: BATCH_STATES }).notNull().default("active"),
    holdReason: text("hold_reason"),
    heldBy: uuid("held_by"),
    heldAt: timestamp("held_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_batches_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_batches_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [stockItems.tenantId, stockItems.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_batches_held_by_fk", columns: [t.tenantId, t.heldBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("stock_batches_tenant_id_id_key").on(t.tenantId, t.id),
    unique("stock_batches_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("stock_batches_tenant_branch_item_id_key").on(t.tenantId, t.branchId, t.itemId, t.id),
    unique("stock_batches_identity_key").on(t.tenantId, t.branchId, t.itemId, t.batchNo, t.expiry),
    index("stock_batches_fefo_idx").on(t.tenantId, t.branchId, t.itemId, t.expiry, t.receivedAt),
    check("stock_batches_no_check", sql`${t.batchNo} ~ '^[A-Za-z0-9][A-Za-z0-9./-]{0,39}$'`),
    check("stock_batches_quantity_check", qty(t.quantity, "0")),
    check("stock_batches_state_check", sql`${t.state} in (${inList(BATCH_STATES)})
      and ((${t.state} = 'active') = (${t.holdReason} is null)) and num_nonnulls(${t.holdReason}, ${t.heldBy}, ${t.heldAt}) in (0, 3)
      and (${t.holdReason} is null or length(btrim(${t.holdReason})) between 3 and 300)`),
  ],
);

// Depots of a branch (PR-89, DATA-63; T-061). One active default gudang per branch (seeded when the branch is
// created); a ruang depot may name a treatment room of the same branch. Never deleted; created_by null when seeded.
export const depots = pgTable(
  "depots",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: DEPOT_KINDS }).notNull(),
    roomId: uuid("room_id"),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "depots_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "depots_room_fk", columns: [t.tenantId, t.branchId, t.roomId], foreignColumns: [rooms.tenantId, rooms.branchId, rooms.id] }).onDelete("restrict"),
    foreignKey({ name: "depots_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("depots_tenant_id_id_key").on(t.tenantId, t.id),
    unique("depots_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("depots_branch_name_key").on(t.tenantId, t.branchId, t.name),
    uniqueIndex("depots_one_default").on(t.tenantId, t.branchId).where(sql`is_default`),
    check("depots_check", sql`${t.kind} in (${inList(DEPOT_KINDS)}) and length(btrim(${t.name})) between 2 and 60
      and (not ${t.isDefault} or (${t.kind} = 'gudang' and ${t.active})) and (${t.roomId} is null or ${t.kind} = 'ruang')`),
  ],
);

export const openedVials = pgTable(
  "opened_vials",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    depotId: uuid("depot_id").notNull(),
    openedBy: uuid("opened_by").notNull(),
    openedAs: text("opened_as").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    useBy: timestamp("use_by", { withTimezone: true }).notNull(),
    remaining: numeric("remaining").notNull(),
    state: text("state", { enum: VIAL_STATES }).notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "opened_vials_batch_fk", columns: [t.tenantId, t.branchId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "opened_vials_by_fk", columns: [t.tenantId, t.openedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "opened_vials_depot_fk", columns: [t.tenantId, t.branchId, t.depotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    unique("opened_vials_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("opened_vials_one_open").on(t.tenantId, t.batchId, t.depotId).where(sql`state = 'open'`),
    check("opened_vials_check", sql`${qty(t.remaining, "0", "100000")} and ${t.useBy} > ${t.openedAt}
      and ${t.state} in (${inList(VIAL_STATES)}) and ((${t.state} = 'open') = (${t.closedAt} is null))
      and ${t.openedAs} in ('pharmacist')`),
  ],
);

export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    blind: boolean("blind").notNull(),
    state: text("state", { enum: COUNT_STATES }).notNull().default("draft"),
    reason: text("reason"),
    thresholdPct: numeric("threshold_pct"),
    exceeds: boolean("exceeds"),
    approvalId: uuid("approval_id"),
    startedBy: uuid("started_by").notNull(),
    startedAs: text("started_as").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_counts_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_counts_by_fk", columns: [t.tenantId, t.startedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_counts_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    unique("stock_counts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("stock_counts_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("stock_counts_approval_key").on(t.tenantId, t.approvalId),
    index("stock_counts_branch_idx").on(t.tenantId, t.branchId, t.state, t.startedAt),
    check("stock_counts_check", sql`${t.state} in (${inList(COUNT_STATES)}) and ${t.startedAs} in ('pharmacist','manager')
      and (${t.state} <> 'draft' or ${t.submittedAt} is null) and (${t.state} not in ('pending_approval','applied','rejected') or ${t.submittedAt} is not null)
      and ((${t.state} in ('draft','pending_approval')) = (${t.closedAt} is null))
      and ((${t.submittedAt} is null) = (${t.reason} is null)) and (${t.reason} is null or length(btrim(${t.reason})) between 3 and 500)
      and num_nonnulls(${t.thresholdPct}, ${t.exceeds}, ${t.submittedAt}) in (0, 3)
      and (${t.thresholdPct} is null or ${qty(t.thresholdPct, "0", "100")})
      and ((${t.approvalId} is not null) = coalesce(${t.exceeds}, false))
      and (${t.state} <> 'pending_approval' or ${t.approvalId} is not null)
      and (${t.state} <> 'rejected' or ${t.approvalId} is not null)`),
  ],
);

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    countId: uuid("count_id").notNull(),
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    depotId: uuid("depot_id").notNull(),
    systemQty: numeric("system_qty").notNull(),
    countedQty: numeric("counted_qty"),
    countedAt: timestamp("counted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_count_lines_count_fk", columns: [t.tenantId, t.branchId, t.countId], foreignColumns: [stockCounts.tenantId, stockCounts.branchId, stockCounts.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_count_lines_batch_fk", columns: [t.tenantId, t.branchId, t.itemId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.itemId, stockBatches.id] }).onDelete("restrict"),
    unique("stock_count_lines_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({ name: "stock_count_lines_depot_fk", columns: [t.tenantId, t.branchId, t.depotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    unique("stock_count_lines_batch_key").on(t.tenantId, t.countId, t.batchId, t.depotId),
    check("stock_count_lines_check", sql`${qty(t.systemQty, "0")} and (${t.countedQty} is null or ${qty(t.countedQty, "0")})
      and ((${t.countedQty} is null) = (${t.countedAt} is null))`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    // Order of movements (uuid v7 does not order within one millisecond); per batch the writers hold the batch row.
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    // T-061: the depot the movement moves stock in or out of, its holding balance after, and the transfer leg.
    depotId: uuid("depot_id").notNull(),
    kind: text("kind", { enum: MOVEMENT_KINDS }).notNull(),
    quantity: numeric("quantity").notNull(),
    balanceAfter: numeric("balance_after").notNull(),
    depotBalanceAfter: numeric("depot_balance_after").notNull(),
    leg: text("leg", { enum: LEGS }),
    reason: text("reason"),
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_movements_batch_fk", columns: [t.tenantId, t.branchId, t.itemId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.itemId, stockBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_movements_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("stock_movements_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({ name: "stock_movements_depot_fk", columns: [t.tenantId, t.branchId, t.depotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    unique("stock_movements_source_key").on(t.tenantId, t.sourceKind, t.sourceId, t.batchId, t.depotId, t.leg).nullsNotDistinct(),
    index("stock_movements_depot_idx").on(t.tenantId, t.batchId, t.depotId, t.seq),
    index("stock_movements_card_idx").on(t.tenantId, t.branchId, t.itemId, t.createdAt),
    index("stock_movements_batch_idx").on(t.tenantId, t.batchId, t.seq),
    check("stock_movements_check", sql`${t.kind} in (${inList(MOVEMENT_KINDS)}) and ${qty(t.quantity, "-1000000000")} and ${t.quantity} <> 0
      and ${qty(t.balanceAfter, "0")} and ${t.sourceKind} ~ '^[a-z][a-z_]{1,40}$'
      and (${t.reason} is null or length(btrim(${t.reason})) between 3 and 500)
      and (${t.kind} <> 'receive' or ${t.quantity} > 0) and ${qty(t.depotBalanceAfter, "0")}
      and (${t.kind} = 'transfer_out' and ${t.leg} is not distinct from 'out' and ${t.quantity} < 0
           or ${t.kind} = 'transfer_in' and ${t.leg} is not distinct from 'in' and ${t.quantity} > 0
           or ${t.kind} not in ('transfer_out','transfer_in') and ${t.leg} is null)`),
  ],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    minQty: numeric("min_qty").notNull(),
    targetQty: numeric("target_qty").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    updatedAs: text("updated_as").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_levels_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_levels_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [stockItems.tenantId, stockItems.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_levels_by_fk", columns: [t.tenantId, t.updatedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("stock_levels_tenant_id_id_key").on(t.tenantId, t.id),
    unique("stock_levels_branch_item_key").on(t.tenantId, t.branchId, t.itemId),
    check("stock_levels_check", sql`${qty(t.minQty, "0")} and ${qty(t.targetQty, "0")} and ${t.targetQty} >= ${t.minQty}
      and ${t.updatedAs} in ('pharmacist','purchasing')`),
  ],
);

// The quantity of a batch held in a depot (DATA-63). Σ holdings of a batch = the batch quantity: every movement moves
// both by the same amount (its insert trigger sets both; the holding guard accepts only that).
export const batchHoldings = pgTable(
  "batch_holdings",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    depotId: uuid("depot_id").notNull(),
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    quantity: numeric("quantity").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "batch_holdings_depot_fk", columns: [t.tenantId, t.branchId, t.depotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    foreignKey({ name: "batch_holdings_batch_fk", columns: [t.tenantId, t.branchId, t.itemId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.itemId, stockBatches.id] }).onDelete("restrict"),
    unique("batch_holdings_tenant_id_id_key").on(t.tenantId, t.id),
    unique("batch_holdings_depot_batch_key").on(t.tenantId, t.depotId, t.batchId),
    index("batch_holdings_batch_idx").on(t.tenantId, t.batchId),
    check("batch_holdings_quantity_check", qty(t.quantity, "0")),
  ],
);

// One transfer record (DATA-63): intra-branch posts at once (two linked legs per line); inter-branch is sent (out
// legs) then received (in legs on the destination batch of the same item, number and expiry) or cancelled (in legs
// back on the source). Never deleted.
export const depotTransfers = pgTable(
  "depot_transfers",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind", { enum: TRANSFER_KINDS }).notNull(),
    fromBranchId: uuid("from_branch_id").notNull(),
    fromDepotId: uuid("from_depot_id").notNull(),
    toBranchId: uuid("to_branch_id").notNull(),
    toDepotId: uuid("to_depot_id"),
    state: text("state", { enum: TRANSFER_STATES }).notNull(),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    closedBy: uuid("closed_by"),
    closedAs: text("closed_as"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfers_from_fk", columns: [t.tenantId, t.fromBranchId, t.fromDepotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfers_to_branch_fk", columns: [t.tenantId, t.toBranchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfers_to_fk", columns: [t.tenantId, t.toBranchId, t.toDepotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfers_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfers_closed_by_fk", columns: [t.tenantId, t.closedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("depot_transfers_tenant_id_id_key").on(t.tenantId, t.id),
    unique("depot_transfers_branches_key").on(t.tenantId, t.id, t.fromBranchId, t.toBranchId),
    unique("depot_transfers_command_key").on(t.tenantId, t.commandKey),
    index("depot_transfers_from_idx").on(t.tenantId, t.fromBranchId, t.state, t.createdAt),
    index("depot_transfers_to_idx").on(t.tenantId, t.toBranchId, t.state, t.createdAt),
    check("depot_transfers_check", sql`${t.kind} in (${inList(TRANSFER_KINDS)}) and ${t.state} in (${inList(TRANSFER_STATES)})
      and ${t.commandKey} ~ '^[A-Za-z0-9_.:-]{8,128}$' and ${t.createdAs} in ('pharmacist','purchasing')
      and (${t.kind} = 'intra' and ${t.fromBranchId} = ${t.toBranchId} and ${t.state} = 'posted' and ${t.toDepotId} is not null and ${t.toDepotId} <> ${t.fromDepotId}
           or ${t.kind} = 'inter' and ${t.fromBranchId} <> ${t.toBranchId} and ${t.state} in ('sent','received','cancelled')
              and ((${t.state} = 'received') = (${t.toDepotId} is not null)))
      and ((${t.state} in ('received','cancelled')) = (${t.closedAt} is not null)) and num_nonnulls(${t.closedBy}, ${t.closedAs}, ${t.closedAt}) in (0, 3)
      and (${t.closedAs} is null or ${t.closedAs} in ('pharmacist','purchasing'))`),
  ],
);

export const depotTransferLines = pgTable(
  "depot_transfer_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    transferId: uuid("transfer_id").notNull(),
    fromBranchId: uuid("from_branch_id").notNull(),
    toBranchId: uuid("to_branch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    sourceBatchId: uuid("source_batch_id").notNull(),
    destinationBatchId: uuid("destination_batch_id"),
    quantity: numeric("quantity").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfer_lines_transfer_fk", columns: [t.tenantId, t.transferId, t.fromBranchId, t.toBranchId],
      foreignColumns: [depotTransfers.tenantId, depotTransfers.id, depotTransfers.fromBranchId, depotTransfers.toBranchId] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfer_lines_source_fk", columns: [t.tenantId, t.fromBranchId, t.itemId, t.sourceBatchId],
      foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.itemId, stockBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "depot_transfer_lines_destination_fk", columns: [t.tenantId, t.toBranchId, t.itemId, t.destinationBatchId],
      foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.itemId, stockBatches.id] }).onDelete("restrict"),
    unique("depot_transfer_lines_tenant_id_id_key").on(t.tenantId, t.id),
    unique("depot_transfer_lines_batch_key").on(t.tenantId, t.transferId, t.sourceBatchId),
    check("depot_transfer_lines_check", sql`${qty(t.quantity, "0.0001")} and ${t.quantity} > 0`),
  ],
);
