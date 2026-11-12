// Payment port schema (PR-68, TD-40, TD-41, TD-43, DATA-51, BILL-29; T-073, migration 0088, DEC-084). Written only by the
// 0088 definers.
//
// - payment_port_configs (config): one active port per tenant: provider (`mock` in Release 1; Q-14 adds one adapter per
//   tenant), provider account, environment, channels, the globally unique order prefix that routes webhooks to the
//   tenant (TD-40's payment_routes mapping), and the KEK version the mock's webhook secret is derived from (HKDF; no
//   secret is stored).
// - payment_charges (tenant-ledger, personal): a QRIS/VA/link charge on an issued invoice: created → pending → paid |
//   expired | failed | cancelled (TD-41); a review flag and the amount waiting for the patient balance (T-075) when the
//   money cannot go to its lines (paid after expiry, after failure, beyond what the lines still owe).
// - payment_charge_lines: the charge's split over the invoice lines (proportional, kasir_allocate).
// - payment_mock_states: the mock gateway's own view of a charge (the simulator writes it; status() reads it); kept
//   apart from the clinic's charge state, which only the settle path changes.
// - payment_webhook_events: every webhook received for a routed tenant with its outcome; provider event ids are unique
//   among verified outcomes only, so a forged request never claims a real event id.
// - payment_refunds: the port-level refund of a paid charge (idempotent by key; Σ ≤ the charge). The patient-facing
//   refund flow is T-078.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invoiceLines, invoices, PAYMENT_ENVIRONMENTS, receipts } from "../cashier/schema";
import { branches, staff, tenants } from "../org/schema";

export const PORT_PROVIDERS = ["mock"] as const;
export const PORT_CHANNELS = ["qris", "va", "payment_link"] as const;
export const CHARGE_STATES = ["created", "pending", "paid", "expired", "failed", "cancelled"] as const;
export const CHARGE_FLAGS = ["paid_after_expiry", "paid_after_failed", "paid_after_cash", "amount_mismatch"] as const;
export const MOCK_STATES = ["pending", "paid", "expired", "failed", "cancelled"] as const;
// `received`: a verified event while it is being applied (the row is written first so the payment can name it, then
// its outcome is set once).
export const WEBHOOK_OUTCOMES = [
  "received", "applied", "duplicate", "flagged", "rejected_signature", "rejected_window", "rejected_amount", "dropped_tenant_mismatch", "dropped_unknown_charge",
] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const MONEY = "1000000000000";
const WRITERS = sql.raw(`'owner','manager','fo_cashier','finance'`);

export const paymentPortConfigs = pgTable(
  "payment_port_configs",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    provider: text("provider", { enum: PORT_PROVIDERS }).notNull(),
    providerAccount: text("provider_account").notNull(),
    environment: text("environment", { enum: PAYMENT_ENVIRONMENTS }).notNull(),
    channels: text("channels").array().notNull(),
    orderPrefix: text("order_prefix").notNull(),
    kekVersion: integer("kek_version").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_port_configs_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("payment_port_configs_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payment_port_configs_prefix_key").on(t.orderPrefix),
    uniqueIndex("payment_port_configs_one_active").on(t.tenantId).where(sql`${t.active}`),
    check("payment_port_configs_check", sql`${t.provider} in (${inList(PORT_PROVIDERS)}) and ${t.environment} in (${inList(PAYMENT_ENVIRONMENTS)})
      and ${t.providerAccount} ~ '^[a-z0-9][a-z0-9_.-]{2,79}$' and ${t.orderPrefix} ~ '^[A-Z0-9]{6,12}$' and ${t.kekVersion} >= 1
      and cardinality(${t.channels}) between 1 and 3 and ${t.channels} <@ array[${inList(PORT_CHANNELS)}]::text[]
      and ${t.createdAs} in ('owner','manager')`),
  ],
);

export const paymentCharges = pgTable(
  "payment_charges",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    configId: uuid("config_id").notNull(),
    provider: text("provider", { enum: PORT_PROVIDERS }).notNull(),
    providerAccount: text("provider_account").notNull(),
    environment: text("environment", { enum: PAYMENT_ENVIRONMENTS }).notNull(),
    channel: text("channel", { enum: PORT_CHANNELS }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    description: text("description").notNull(),
    orderRef: text("order_ref").notNull(),
    externalId: text("external_id").notNull(),
    state: text("state", { enum: CHARGE_STATES }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    isSimulated: boolean("is_simulated").notNull(),
    reviewFlag: text("review_flag", { enum: CHARGE_FLAGS }),
    balancePending: bigint("balance_pending", { mode: "number" }).notNull().default(0),
    receiptId: uuid("receipt_id"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_charges_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_charges_invoice_fk", columns: [t.tenantId, t.branchId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.branchId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_charges_config_fk", columns: [t.tenantId, t.configId], foreignColumns: [paymentPortConfigs.tenantId, paymentPortConfigs.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_charges_receipt_fk", columns: [t.tenantId, t.receiptId], foreignColumns: [receipts.tenantId, receipts.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_charges_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("payment_charges_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payment_charges_tenant_branch_id_key").on(t.tenantId, t.branchId, t.id),
    unique("payment_charges_order_ref_key").on(t.orderRef),
    unique("payment_charges_external_key").on(t.tenantId, t.provider, t.providerAccount, t.environment, t.externalId),
    unique("payment_charges_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("payment_charges_one_pending").on(t.tenantId, t.invoiceId).where(sql`${t.state} = 'pending'`),
    index("payment_charges_invoice_idx").on(t.tenantId, t.invoiceId),
    check("payment_charges_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${t.state} in (${inList(CHARGE_STATES)})
      and ${t.channel} in (${inList(PORT_CHANNELS)}) and ${t.environment} in (${inList(PAYMENT_ENVIRONMENTS)}) and ${t.provider} in (${inList(PORT_PROVIDERS)})
      and (${t.reviewFlag} is null or ${t.reviewFlag} in (${inList(CHARGE_FLAGS)}))
      and ${t.balancePending} between 0 and ${t.amount} and ${KEY(t.commandKey)} and ${t.createdAs} in (${WRITERS})
      and ${t.description} in ('Layanan klinik','Produk','Layanan dan produk klinik')
      and ${t.orderRef} ~ '^[A-Z0-9]{6,12}-[0-9a-f]{32}$' and length(${t.externalId}) between 1 and 80
      and ((${t.state} = 'paid') = (${t.settledAt} is not null)) and (${t.receiptId} is null or ${t.state} = 'paid')
      and (${t.isSimulated} = (${t.provider} = 'mock'))`),
  ],
);

export const paymentChargeLines = pgTable(
  "payment_charge_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    chargeId: uuid("charge_id").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_charge_lines_charge_fk", columns: [t.tenantId, t.branchId, t.chargeId], foreignColumns: [paymentCharges.tenantId, paymentCharges.branchId, paymentCharges.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_charge_lines_line_fk", columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }).onDelete("restrict"),
    unique("payment_charge_lines_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payment_charge_lines_charge_line_key").on(t.tenantId, t.chargeId, t.invoiceLineId),
    check("payment_charge_lines_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)}`),
  ],
);

export const paymentMockStates = pgTable(
  "payment_mock_states",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    chargeId: uuid("charge_id").notNull(),
    state: text("state", { enum: MOCK_STATES }).notNull().default("pending"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    lastEventId: text("last_event_id"),
    eventSeq: integer("event_seq").notNull().default(0),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_mock_states_charge_fk", columns: [t.tenantId, t.branchId, t.chargeId], foreignColumns: [paymentCharges.tenantId, paymentCharges.branchId, paymentCharges.id] }).onDelete("restrict"),
    unique("payment_mock_states_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payment_mock_states_charge_key").on(t.tenantId, t.chargeId),
    check("payment_mock_states_check", sql`${t.state} in (${inList(MOCK_STATES)}) and ${t.amount} between 1 and ${sql.raw(MONEY)} and ${t.eventSeq} >= 0
      and (${t.lastEventId} is null or ${t.lastEventId} ~ '^[A-Za-z0-9_.:-]{8,80}$')`),
  ],
);

export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    provider: text("provider", { enum: PORT_PROVIDERS }).notNull(),
    providerAccount: text("provider_account").notNull(),
    environment: text("environment", { enum: PAYMENT_ENVIRONMENTS }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    orderRef: text("order_ref").notNull(),
    chargeId: uuid("charge_id"),
    observedState: text("observed_state"),
    amount: bigint("amount", { mode: "number" }),
    signatureOk: boolean("signature_ok").notNull(),
    timestampOk: boolean("timestamp_ok").notNull(),
    outcome: text("outcome", { enum: WEBHOOK_OUTCOMES }).notNull(),
    bodySha256: text("body_sha256").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_webhook_events_charge_fk", columns: [t.tenantId, t.chargeId], foreignColumns: [paymentCharges.tenantId, paymentCharges.id] }).onDelete("restrict"),
    unique("payment_webhook_events_tenant_id_id_key").on(t.tenantId, t.id),
    // Idempotency on the provider event id among verified outcomes only (SEC-8; plan r1 P1-2, r2 F-1).
    uniqueIndex("payment_webhook_events_verified_key").on(t.provider, t.providerAccount, t.environment, t.providerEventId)
      .where(sql`${t.outcome} in ('applied','flagged','rejected_amount')`),
    index("payment_webhook_events_charge_idx").on(t.tenantId, t.chargeId),
    check("payment_webhook_events_check", sql`${t.outcome} in (${inList(WEBHOOK_OUTCOMES)}) and ${t.provider} in (${inList(PORT_PROVIDERS)})
      and ${t.environment} in (${inList(PAYMENT_ENVIRONMENTS)}) and length(${t.providerEventId}) between 1 and 80 and length(${t.orderRef}) between 1 and 60
      and ${t.bodySha256} ~ '^[0-9a-f]{64}$' and (${t.amount} is null or ${t.amount} between 0 and ${sql.raw(MONEY)})
      and (${t.observedState} is null or ${t.observedState} in (${inList(MOCK_STATES)}))
      and (${t.outcome} not in ('received','applied','flagged','rejected_amount','duplicate') or (${t.signatureOk} and ${t.timestampOk}))`),
  ],
);

export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    chargeId: uuid("charge_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    providerRefundId: text("provider_refund_id").notNull(),
    state: text("state", { enum: ["succeeded"] }).notNull(),
    commandKey: text("command_key").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAs: text("created_as").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_refunds_charge_fk", columns: [t.tenantId, t.branchId, t.chargeId], foreignColumns: [paymentCharges.tenantId, paymentCharges.branchId, paymentCharges.id] }).onDelete("restrict"),
    foreignKey({ name: "payment_refunds_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("payment_refunds_tenant_id_id_key").on(t.tenantId, t.id),
    unique("payment_refunds_command_key").on(t.tenantId, t.commandKey),
    check("payment_refunds_check", sql`${t.amount} between 1 and ${sql.raw(MONEY)} and ${t.state} = 'succeeded' and ${KEY(t.commandKey)}
      and length(${t.providerRefundId}) between 1 and 80 and ${t.createdAs} in ('owner','manager')`),
  ],
);
