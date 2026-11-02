// Idempotency records (DATA-45, TD-51). One row per (tenant, command, key), written by the
// command wrapper (src/lib/command.ts) inside the command's own transaction, so a
// record exists exactly when the command's effects were committed. The fingerprint is
// the SHA-256 of the normalized request body; a different body under the same key is
// refused (ERR_IDEMPOTENCY_CONFLICT). The record belongs to the staff member (or the
// service, staff_id null) that ran the command; nobody else reads or replays it.
// Platform-namespace commands (vendor console) get their own table with the vendor
// console tasks; this one is tenant-shared.
import { sql } from "drizzle-orm";
import { check, foreignKey, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { staff, tenants } from "../org/schema";

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().default(sql`app_tenant_id()`),
    command: text("command").notNull(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    staffId: uuid("staff_id").default(sql`app_staff_id()`),
    status: text("status", { enum: ["in_progress", "succeeded", "failed"] }).notNull().default("in_progress"),
    // Result reference: ids and codes the command returns, never clinical content.
    result: jsonb("result"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("idempotency_records_tenant_id_id_key").on(t.tenantId, t.id),
    unique("idempotency_records_command_key").on(t.tenantId, t.command, t.key),
    check("idempotency_records_command_check", sql`${t.command} ~ '^[a-z][a-z0-9_.]{2,80}$'`),
    check("idempotency_records_key_check", sql`${t.key} ~ '^[A-Za-z0-9_.:-]{8,128}$'`),
    check("idempotency_records_fingerprint_check", sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
    // Result references are ids and codes: small by construction.
    check("idempotency_records_result_size_check", sql`${t.result} is null or octet_length(${t.result}::text) <= 8192`),
    check("idempotency_records_status_check", sql`${t.status} in ('in_progress','succeeded','failed')`),
    check("idempotency_records_error_code_check", sql`${t.errorCode} is null or ${t.errorCode} ~ '^ERR_[A-Z_]{2,60}$'`),
    check(
      "idempotency_records_outcome_check",
      sql`(${t.status} = 'in_progress' and ${t.completedAt} is null and ${t.result} is null and ${t.errorCode} is null)
       or (${t.status} = 'succeeded' and ${t.completedAt} is not null and ${t.errorCode} is null)
       or (${t.status} = 'failed' and ${t.completedAt} is not null and ${t.result} is null and ${t.errorCode} is not null)`,
    ),
  ],
);
