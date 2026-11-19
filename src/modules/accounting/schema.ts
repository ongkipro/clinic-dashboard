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

// ── Accounting step 2 (PR-26, A-01, A-02; T-105, DATA-37). Posting rules are code (the migration's posting definers, one per TD-50 event
// of the canonical matrix in docs/spec/11), versioned by LEDGER_MAP_VERSION. Every automatic entry records the map version it was posted
// under; an entry is official only while approved posting_map_signoff evidence covers that exact version (Panel 2 G4, T-105) — until
// then the books are a preview. Accounts carry stable keys and Indonesian labels, no numeric codes (G3); statements are generic by class,
// not labelled SAK-compliant (G2).
export const LEDGER_MAP_VERSION = "draft-11-2026-11-19";
export const ACCOUNT_CLASSES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export const ENTRY_KINDS = ["auto", "manual", "reversal"] as const;

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    class: text("class", { enum: ACCOUNT_CLASSES }).notNull(),
    system: text("system").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "ledger_accounts_created_by_fk", columns: [t.tenantId, t.createdBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("ledger_accounts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("ledger_accounts_key").on(t.tenantId, t.key),
    check("ledger_accounts_check", sql`${t.key} ~ '^[a-z][a-z0-9_]{2,40}$' and length(btrim(${t.label})) between 2 and 80
      and ${t.class} in (${inList(ACCOUNT_CLASSES)}) and ${t.system} in ('system','manual') and ((${t.system} = 'system') = (${t.createdBy} is null))`),
  ],
);

export const ledgerPeriods = pgTable(
  "ledger_periods",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    period: text("period").notNull(),
    lockedBy: uuid("locked_by").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "ledger_periods_locked_by_fk", columns: [t.tenantId, t.lockedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("ledger_periods_tenant_id_id_key").on(t.tenantId, t.id),
    unique("ledger_periods_key").on(t.tenantId, t.period),
    unique("ledger_periods_command_key").on(t.tenantId, t.commandKey),
    check("ledger_periods_check", sql`${PERIOD(t.period)} and ${KEY(t.commandKey)}`),
  ],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
    postingKey: text("posting_key").notNull(),
    event: text("event").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceEventId: uuid("source_event_id"),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    period: text("period").notNull(),
    originalPeriod: text("original_period").notNull(),
    mapVersion: text("map_version"),
    reversesEntryId: uuid("reverses_entry_id"),
    memo: text("memo"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "journal_entries_reverses_fk", columns: [t.tenantId, t.reversesEntryId], foreignColumns: [t.tenantId, t.id] }).onDelete("restrict"),
    foreignKey({ name: "journal_entries_posted_by_fk", columns: [t.tenantId, t.postedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("journal_entries_tenant_id_id_key").on(t.tenantId, t.id),
    unique("journal_entries_posting_key").on(t.tenantId, t.postingKey),
    index("journal_entries_period_idx").on(t.tenantId, t.period),
    index("journal_entries_source_idx").on(t.tenantId, t.sourceKind, t.sourceId),
    check("journal_entries_check", sql`${t.kind} in (${inList(ENTRY_KINDS)}) and length(${t.postingKey}) between 3 and 200
      and ${t.event} ~ '^[A-Z][A-Za-z]{2,60}$' and ${t.sourceKind} ~ '^[a-z][a-z_]{2,40}$' and ${PERIOD(t.period)} and ${PERIOD(t.originalPeriod)}
      and ${t.period} >= ${t.originalPeriod} and ((${t.kind} = 'auto') = (${t.mapVersion} is not null))
      and ((${t.kind} = 'manual') = (${t.postedBy} is not null)) and (${t.kind} <> 'manual' or length(btrim(${t.memo})) between 10 and 500)
      and (${t.memo} is null or length(${t.memo}) <= 500)`),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    accountId: uuid("account_id").notNull(),
    branchId: uuid("branch_id"),
    debit: bigint("debit", { mode: "number" }).notNull(),
    credit: bigint("credit", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ name: "journal_lines_entry_fk", columns: [t.tenantId, t.entryId], foreignColumns: [journalEntries.tenantId, journalEntries.id] }).onDelete("restrict"),
    foreignKey({ name: "journal_lines_account_fk", columns: [t.tenantId, t.accountId], foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id] }).onDelete("restrict"),
    foreignKey({ name: "journal_lines_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("journal_lines_tenant_id_id_key").on(t.tenantId, t.id),
    index("journal_lines_entry_idx").on(t.tenantId, t.entryId),
    index("journal_lines_account_idx").on(t.tenantId, t.accountId),
    check("journal_lines_check", sql`${t.debit} between 0 and ${sql.raw(MONEY)} and ${t.credit} between 0 and ${sql.raw(MONEY)}
      and (${t.debit} = 0) <> (${t.credit} = 0)`),
  ],
);

// The tenant's decision that automatic posting under one map version is its official books (Panel 2 E1/E2: authority and retroactivity are
// undecided). T-105 ships NO writer for this table (no definer, no grant, no page action): with no row every automatic entry is a preview,
// and journal export stays refused even when posting_map_signoff evidence is approved — evidence alone activates and promotes nothing.
export const ledgerActivations = pgTable(
  "ledger_activations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    mapVersion: text("map_version").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    unique("ledger_activations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("ledger_activations_tenant_key").on(t.tenantId),
    check("ledger_activations_check", sql`length(btrim(${t.mapVersion})) between 1 and 80`),
  ],
);

// Coretax XML export log (PR-98, A-08, A-15; T-106, migration 0125, Panel 2 decision 5). One append-only row per document a PKP tenant's
// owner or finance downloaded: the month, the document kind, the SHA-256 of the exact bytes served and their totals. The export itself is
// built in the database from frozen invoice and refund facts (drizzle/0125 coretax_export); nothing here writes invoice_lines.tax_document_ref
// (the NSFP is assigned by DJP after upload).
export const CORETAX_DOC_KINDS = ["retail", "faktur", "retur", "pembatalan"] as const;
export const coretaxExports = pgTable(
  "coretax_exports",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    period: text("period").notNull(),
    docKind: text("doc_kind", { enum: CORETAX_DOC_KINDS }).notNull(),
    sha256: text("sha256").notNull(),
    rowCount: bigint("row_count", { mode: "number" }).notNull(),
    taxBaseTotal: bigint("tax_base_total", { mode: "number" }).notNull(),
    vatTotal: bigint("vat_total", { mode: "number" }).notNull(),
    exportedBy: uuid("exported_by").notNull(),
    exportedAs: text("exported_as").notNull(),
    exportedAt: timestamp("exported_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "coretax_exports_exported_by_fk", columns: [t.tenantId, t.exportedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("coretax_exports_tenant_id_id_key").on(t.tenantId, t.id),
    index("coretax_exports_period_idx").on(t.tenantId, t.period, t.exportedAt),
    // supported ceiling (T-106 r2, Panel 2 P2): 10^6 rows and Rp10^15 totals — all within Number.MAX_SAFE_INTEGER; the export refuses above it
    // (bounds_exceeded) before this row is written. A zero-row row only for the structural named-buyer faktur (empty ListOfTaxInvoice, r2 P1).
    check("coretax_exports_check", sql`${PERIOD(t.period)} and ${t.docKind} in (${inList(CORETAX_DOC_KINDS)}) and ${t.sha256} ~ '^[0-9a-f]{64}$'
      and (${t.docKind} = 'faktur' and ${t.rowCount} = 0 and ${t.taxBaseTotal} = 0 and ${t.vatTotal} = 0 or ${t.rowCount} between 1 and 1000000)
      and ${t.taxBaseTotal} between 0 and 1000000000000000 and ${t.vatTotal} between 0 and 1000000000000000
      and ${t.exportedAs} in ('owner','finance')`),
  ],
);
