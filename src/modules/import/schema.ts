// Opening-data import schema (PR-85, DATA-58, MIG-3, DEC-133; T-128).
// - Every table has .enableRLS(), composite (tenant_id, id) FKs, TEN-19 'never'.
// - Zero plaintext filenames, external IDs, NIKs, or raw cell strings outside AEAD payload_enc.
// - Immutable purge_after stamped at batch creation (never extended by revalidation).
// - Immutable applied_by/applied_at preserved across applied -> rolled_back (D7).
// - Option 1A: immutable state='reversed' tombstone on source_id_map with partial unique index WHERE state='active'.
// - Immutable import_opening_facts consumed identically by 0121 sub-ledgers and 0123 OpeningImportApplied/Reversed.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

export const IMPORT_BATCH_STATES = [
  "staged",
  "validated",
  "approved",
  "applying",
  "applied",
  "apply_failed",
  "rolled_back",
  "rejected",
] as const;

export const IMPORT_ROW_ENTITIES = [
  "patients",
  "packages",
  "balances",
  "receivables",
  "booking_dps",
] as const;

export const OPENING_FACT_KINDS = [
  "balance",
  "package",
  "booking_dp",
  "receivable",
] as const;

export const IMPORT_ROLLBACK_REASONS = [
  "cutover_correction",
  "duplicate_batch",
  "mapping_error",
  "owner_cancelled",
] as const;
export type ImportRollbackReason = (typeof IMPORT_ROLLBACK_REASONS)[number];

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    sourceSystem: text("source_system").notNull(),
    cutoverDate: date("cutover_date", { mode: "string" }).notNull(),
    state: text("state", { enum: IMPORT_BATCH_STATES }).notNull().default("staged"),
    rowCount: integer("row_count").notNull().default(0),
    validationRevision: integer("validation_revision").notNull().default(0),
    validatedManifestSha256: text("validated_manifest_sha256"),
    summaryJson: jsonb("summary_json"),
    errorCode: text("error_code"),
    stagedBy: uuid("staged_by").notNull(),
    stagedAt: timestamp("staged_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedRevision: integer("approved_revision"),
    approvedManifestSha256: text("approved_manifest_sha256"),
    appliedBy: uuid("applied_by"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    rolledBackBy: uuid("rolled_back_by"),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rollbackReason: text("rollback_reason"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
    payloadPurgedAt: timestamp("payload_purged_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.stagedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.approvedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.appliedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.rolledBackBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("import_batches_tenant_id_id_key").on(t.tenantId, t.id),
    check("import_batches_source_check", sql`${t.sourceSystem} ~ '^[a-z0-9][a-z0-9_-]{1,39}$'`),
    check(
      "import_batches_state_check",
      sql`${t.state} in ('staged','validated','approved','applying','applied','apply_failed','rolled_back','rejected')`,
    ),
    check("import_batches_row_count_check", sql`${t.rowCount} between 0 and 2000`),
    check(
      "import_batches_sha_check",
      sql`(${t.validatedManifestSha256} is null or ${t.validatedManifestSha256} ~ '^[0-9a-f]{64}$')
        and (${t.approvedManifestSha256} is null or ${t.approvedManifestSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "import_batches_error_code_check",
      sql`${t.errorCode} is null or ${t.errorCode} ~ '^[a-z][a-z0-9_]{1,48}$'`,
    ),
    check(
      "import_batches_approval_check",
      sql`(${t.state} not in ('approved','applying','applied','rolled_back'))
        or (${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.approvedRevision} is not null and ${t.approvedManifestSha256} is not null)`,
    ),
    check(
      "import_batches_rollback_check",
      sql`(${t.state} <> 'rolled_back')
        or (${t.appliedBy} is not null and ${t.appliedAt} is not null and ${t.rolledBackBy} is not null and ${t.rolledBackAt} is not null and ${t.rollbackReason} in ('cutover_correction','duplicate_batch','mapping_error','owner_cancelled'))`,
    ),
    index("import_batches_tenant_state_idx").on(t.tenantId, t.state),
    index("import_batches_purge_idx").on(t.purgeAfter).where(sql`${t.payloadPurgedAt} is null`),
  ],
).enableRLS();

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    entity: text("entity", { enum: IMPORT_ROW_ENTITIES }).notNull(),
    rowNo: integer("row_no").notNull(),
    sourceKeyHash: text("source_key_hash").notNull(),
    canonicalPayloadSha256: text("canonical_payload_sha256").notNull(),
    applyDigest: text("apply_digest").notNull(),
    branchId: uuid("branch_id"),
    amountIdr: bigint("amount_idr", { mode: "number" }).notNull().default(0),
    payloadEnc: text("payload_enc"),
    dekVersion: integer("dek_version"),
    localId: uuid("local_id"),
    appliedState: text("applied_state", { enum: ["pending", "applied", "replayed", "reversed"] })
      .notNull()
      .default("pending"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [importBatches.tenantId, importBatches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("import_rows_tenant_id_id_key").on(t.tenantId, t.id),
    unique("import_rows_batch_entity_row_key").on(t.tenantId, t.batchId, t.entity, t.rowNo),
    check("import_rows_entity_check", sql`${t.entity} in ('patients','packages','balances','receivables','booking_dps')`),
    check("import_rows_row_no_check", sql`${t.rowNo} between 1 and 2000`),
    check("import_rows_hash_check", sql`${t.sourceKeyHash} ~ '^[0-9a-f]{64}$' and ${t.canonicalPayloadSha256} ~ '^[0-9a-f]{64}$' and ${t.applyDigest} ~ '^[0-9a-f]{64}$'`),
    check("import_rows_payload_enc_check", sql`${t.payloadEnc} is null or ${t.payloadEnc} ~ '^v1\\.[1-9][0-9]{0,8}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]+$'`),
    check("import_rows_amount_check", sql`${t.amountIdr} between 0 and 1000000000000`),
    check("import_rows_applied_state_check", sql`${t.appliedState} in ('pending','applied','replayed','reversed')`),
    index("import_rows_batch_idx").on(t.tenantId, t.batchId, t.entity, t.rowNo),
  ],
).enableRLS();

export const sourceIdMap = pgTable(
  "source_id_map",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    sourceSystem: text("source_system").notNull(),
    entity: text("entity", { enum: IMPORT_ROW_ENTITIES }).notNull(),
    sourceKeyHash: text("source_key_hash").notNull(),
    canonicalPayloadSha256: text("canonical_payload_sha256").notNull(),
    localId: uuid("local_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    state: text("state", { enum: ["active", "reversed"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [importBatches.tenantId, importBatches.id] }).onDelete("restrict"),
    unique("source_id_map_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("source_id_map_active_key")
      .on(t.tenantId, t.sourceSystem, t.entity, t.sourceKeyHash)
      .where(sql`${t.state} = 'active'`),
    check("source_id_map_entity_check", sql`${t.entity} in ('patients','packages','balances','receivables','booking_dps')`),
    check("source_id_map_hash_check", sql`${t.sourceKeyHash} ~ '^[0-9a-f]{64}$' and ${t.canonicalPayloadSha256} ~ '^[0-9a-f]{64}$'`),
    check("source_id_map_state_check", sql`${t.state} in ('active','reversed') and ((${t.state} = 'reversed') = (${t.reversedAt} is not null))`),
    index("source_id_map_batch_idx").on(t.tenantId, t.batchId),
  ],
).enableRLS();

export const importOpeningFacts = pgTable(
  "import_opening_facts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    factKind: text("fact_kind", { enum: OPENING_FACT_KINDS }).notNull(),
    entityId: uuid("entity_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    amountIdr: bigint("amount_idr", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [importBatches.tenantId, importBatches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("import_opening_facts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("import_opening_facts_entity_key").on(t.tenantId, t.batchId, t.factKind, t.entityId),
    check("import_opening_facts_kind_check", sql`${t.factKind} in ('balance','package','booking_dp','receivable')`),
    check("import_opening_facts_amount_check", sql`${t.amountIdr} between 1 and 1000000000000`),
    index("import_opening_facts_batch_idx").on(t.tenantId, t.batchId),
    index("import_opening_facts_date_idx").on(t.tenantId, t.effectiveDate),
  ],
).enableRLS();
