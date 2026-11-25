// Tenant export (PR-52, UX-32, TEN-18, RATE-5, SEC-5; T-122).
// Policy kind: tenant-shared; RLS enabled with zero direct grants to clinic_app, clinic_vendor,
// or clinic_operator; TEN-19 support_object_kinds = 'never' for both tables.
// All reads and writes go strictly through SECURITY DEFINER functions (owner-only bound calls or
// unbound worker calls verified by generation + unexpired DB wall-clock lease).
import { sql } from "drizzle-orm";
import { bigint, check, customType, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { staff, tenants } from "../org/schema";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const EXPORT_STATES = ["queued", "running", "ready", "failed", "expired"] as const;
export const EXPORT_FILE_KINDS = ["fhir", "pdf", "csv", "media"] as const;

export const tenantExports = pgTable(
  "tenant_exports",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    state: text("state", { enum: EXPORT_STATES }).notNull().default("queued"),
    generation: integer("generation").notNull().default(0),
    publishedGeneration: integer("published_generation"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    fileCount: integer("file_count"),
    manifestJson: text("manifest_json"),
    manifestSha256: text("manifest_sha256"),
    errorCode: text("error_code"),
    downloadCount: integer("download_count").notNull().default(0),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "tenant_exports_by_fk", columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("tenant_exports_tenant_id_id_key").on(t.tenantId, t.id),
    unique("tenant_exports_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("tenant_exports_one_in_flight").on(t.tenantId).where(sql`${t.state} in ('queued','running')`),
    index("tenant_exports_requester_recent").on(t.tenantId, t.requestedBy, t.requestedAt),
    index("tenant_exports_purge_due").on(t.state, t.expiresAt, t.requestedAt).where(sql`${t.purgedAt} is null`),
    check(
      "tenant_exports_check",
      sql`${t.state} in ('queued','running','ready','failed','expired')
        and ${t.commandKey} ~ '^[A-Za-z0-9_.:-]{8,128}$'
        and ${t.generation} >= 0 and ${t.attempts} >= 0 and ${t.attempts} <= 3
        and ((${t.state} = 'running') = (${t.leaseUntil} is not null))
        and (${t.state} <> 'running' or (${t.generation} >= 1 and ${t.attempts} >= 1 and ${t.startedAt} is not null))
        and ((${t.completedAt} is null) = (${t.expiresAt} is null))
        and (${t.expiresAt} is null or ${t.expiresAt} = ${t.completedAt} + interval '24 hours')
        and ((${t.state} in ('ready','expired')) = (${t.completedAt} is not null and ${t.manifestSha256} is not null and ${t.manifestJson} is not null and ${t.publishedGeneration} is not null))
        and (${t.publishedGeneration} is null or (${t.publishedGeneration} >= 1 and ${t.publishedGeneration} <= ${t.generation}))
        and (${t.manifestSha256} is null or ${t.manifestSha256} ~ '^[0-9a-f]{64}$')
        and ((${t.state} = 'failed') = (${t.errorCode} is not null))
        and (${t.errorCode} is null or ${t.errorCode} ~ '^[a-z][a-z0-9_]{1,48}$')
        and (${t.state} <> 'expired' or ${t.purgedAt} is not null)
        and (${t.purgedAt} is null or ${t.state} in ('expired','failed'))
        and ${t.downloadCount} >= 0
        and (${t.sizeBytes} is null or ${t.sizeBytes} >= 0)
        and (${t.fileCount} is null or ${t.fileCount} >= 0)`,
    ),
  ],
).enableRLS();

export const tenantExportFiles = pgTable(
  "tenant_export_files",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    exportId: uuid("export_id").notNull(),
    generation: integer("generation").notNull(),
    path: text("path").notNull(),
    kind: text("kind", { enum: EXPORT_FILE_KINDS }).notNull(),
    sha256: text("sha256").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    bytes: bytea("bytes"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "tenant_export_files_export_fk", columns: [t.tenantId, t.exportId], foreignColumns: [tenantExports.tenantId, tenantExports.id] }).onDelete("restrict"),
    unique("tenant_export_files_tenant_id_id_key").on(t.tenantId, t.id),
    unique("tenant_export_files_gen_path_key").on(t.tenantId, t.exportId, t.generation, t.path),
    index("tenant_export_files_export_gen_idx").on(t.tenantId, t.exportId, t.generation),
    check(
      "tenant_export_files_check",
      sql`${t.generation} >= 1
        and ${t.kind} in ('fhir','pdf','csv','media')
        and ${t.sha256} ~ '^[0-9a-f]{64}$'
        and ${t.size} >= 0 and ${t.size} <= 20971520
        and ${t.path} ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$'
        and length(${t.path}) <= 200 and ${t.path} <> 'manifest.json'
        and ${t.path} !~ '(^|/)\\.\\.?(/|$)'
        and (${t.bytes} is null or octet_length(${t.bytes}) = ${t.size})`,
    ),
  ],
).enableRLS();
