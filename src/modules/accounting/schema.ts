// Accounting step 1 (PR-25, A-01, A-14; T-104, migration 0121, DEC-115). Sub-ledgers are derived read models over the immutable money
// facts (readers in src/modules/accounting/subledgers); this schema holds only what no existing fact records:
// - vat_input_credits / vat_payments (owner D-A1): input VAT credited and VAT paid per tax period, entered by finance, append-only
//   (a correction is a negative row with a reason);
// - vat_events (owner D-C1, Panel 2 C-7): the signed VAT-position delta of a canonical VAT object at the six writer seams that keep only
//   cumulative columns (S1 session delivery, S2 receivable conversion, S3 interrupted, S4 package close, S5 package sync reversal, S6 DP
//   application) and the attribution of a PKP-at-issue package's VAT to a delivered session (S1b / S5b: a balanced package − / session +
//   pair, net zero);
// - vat_cutovers / vat_cutover_openings (D-C1): the instant from which vat_events exist, and per object the VAT change before it that no
//   dated fact explains (computed once, never recomputed).
import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const PERIOD = (c: unknown) => sql`${c} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`;
const MONEY = "1000000000000";
export const VAT_OBJECT_KINDS = ["line", "package", "session", "deposit"] as const;
export const VAT_EVENT_CAUSES = [
  "session_delivery", "receivable_convert", "interrupted", "package_close_line", "package_close_package", "package_sync_reversal", "deposit_apply",
  "session_attribution", "line_delivery", "line_void",
] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

export const vatInputCredits = pgTable(
  "vat_input_credits",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    taxPeriod: text("tax_period").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    effectiveOn: date("effective_on", { mode: "string" }).notNull(),
    evidenceRef: text("evidence_ref").notNull(),
    reason: text("reason"),
    commandKey: text("command_key").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "vat_input_credits_recorded_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("vat_input_credits_tenant_id_id_key").on(t.tenantId, t.id),
    unique("vat_input_credits_command_key").on(t.tenantId, t.commandKey),
    index("vat_input_credits_period_idx").on(t.tenantId, t.taxPeriod),
    check("vat_input_credits_check", sql`${PERIOD(t.taxPeriod)} and ${t.amount} <> 0 and ${t.amount} between -${sql.raw(MONEY)} and ${sql.raw(MONEY)}
      and length(btrim(${t.evidenceRef})) between 1 and 80 and ((${t.amount} < 0) = (${t.reason} is not null))
      and (${t.reason} is null or length(btrim(${t.reason})) between 10 and 500) and ${KEY(t.commandKey)} and ${t.recordedAs} = 'finance'`),
  ],
);

export const vatPayments = pgTable(
  "vat_payments",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    taxPeriod: text("tax_period").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    ntpn: text("ntpn").notNull(),
    reason: text("reason"),
    commandKey: text("command_key").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAs: text("recorded_as").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "vat_payments_recorded_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("vat_payments_tenant_id_id_key").on(t.tenantId, t.id),
    unique("vat_payments_command_key").on(t.tenantId, t.commandKey),
    index("vat_payments_period_idx").on(t.tenantId, t.taxPeriod),
    check("vat_payments_check", sql`${PERIOD(t.taxPeriod)} and ${t.amount} <> 0 and ${t.amount} between -${sql.raw(MONEY)} and ${sql.raw(MONEY)}
      and length(btrim(${t.ntpn})) between 1 and 40 and ((${t.amount} < 0) = (${t.reason} is not null))
      and (${t.reason} is null or length(btrim(${t.reason})) between 10 and 500) and ${KEY(t.commandKey)} and ${t.recordedAs} = 'finance'`),
  ],
);

export const vatCutovers = pgTable(
  "vat_cutovers",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    cutoverAt: timestamp("cutover_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    unique("vat_cutovers_tenant_id_id_key").on(t.tenantId, t.id),
    unique("vat_cutovers_tenant_key").on(t.tenantId),
  ],
);

export const vatEvents = pgTable(
  "vat_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    objectKind: text("object_kind", { enum: VAT_OBJECT_KINDS }).notNull(),
    objectId: uuid("object_id").notNull(),
    delta: bigint("delta", { mode: "number" }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    cause: text("cause", { enum: VAT_EVENT_CAUSES }).notNull(),
    sourceId: uuid("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "vat_events_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("vat_events_tenant_id_id_key").on(t.tenantId, t.id),
    index("vat_events_tenant_at_idx").on(t.tenantId, t.effectiveAt),
    index("vat_events_object_idx").on(t.tenantId, t.objectKind, t.objectId),
    check("vat_events_check", sql`${t.delta} <> 0 and ${t.objectKind} in (${inList(VAT_OBJECT_KINDS)}) and ${t.cause} in (${inList(VAT_EVENT_CAUSES)})`),
  ],
);

export const vatCutoverOpenings = pgTable(
  "vat_cutover_openings",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    objectKind: text("object_kind", { enum: VAT_OBJECT_KINDS }).notNull(),
    objectId: uuid("object_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    cutoverAt: timestamp("cutover_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "vat_cutover_openings_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("vat_cutover_openings_tenant_id_id_key").on(t.tenantId, t.id),
    unique("vat_cutover_openings_object_key").on(t.tenantId, t.objectKind, t.objectId),
    check("vat_cutover_openings_check", sql`${t.amount} <> 0 and ${t.objectKind} in (${inList(VAT_OBJECT_KINDS)})`),
  ],
);
