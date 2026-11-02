// Audit log (SEC-5, DATA-60, PR-51). Append-only, content-free: every column is an id,
// a code or a timestamp, except `reason`, which only break-glass access carries (PR-51
// scenario shows it) and which is a procedural justification, never clinical content.
// Rows are chained per tenant (seq, prev_hash, hash) by audit_append(); clinic_app has
// no direct INSERT/UPDATE/DELETE, and a trigger refuses UPDATE/DELETE for everyone.
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { authUser } from "../../auth/schema";
import { branches, memberships, staff, tenants } from "../org/schema";

export const AUDIT_ACTIONS = [
  "clinical_read",
  "media_view",
  "media_download",
  "export",
  "access_denied",
  "break_glass",
  "sign",
  "approval",
  "money_correction",
  "settings_change",
  "operator_session",
  "context_selected",
] as const;

export const AUDIT_OUTCOMES = ["success", "denied", "error"] as const;

const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    accountId: uuid("account_id"),
    membershipId: uuid("membership_id"),
    staffId: uuid("staff_id"),
    actingRole: text("acting_role"),
    branchId: uuid("branch_id"),
    vendorSessionId: uuid("vendor_session_id"),
    vendorStaffId: uuid("vendor_staff_id"),
    serviceIdentity: text("service_identity"), // async workers (DATA-60)
    correlationId: uuid("correlation_id"),
    action: text("action").notNull(),
    objectKind: text("object_kind").notNull(),
    objectId: uuid("object_id"),
    outcome: text("outcome").notNull(),
    reasonCode: text("reason_code"),
    reason: text("reason"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.accountId], foreignColumns: [authUser.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("audit_events_tenant_id_id_key").on(t.tenantId, t.id),
    unique("audit_events_tenant_seq_key").on(t.tenantId, t.seq),
    index("audit_events_tenant_at_idx").on(t.tenantId, t.at),
    check("audit_events_action_check", sql`${t.action} in (${inList(AUDIT_ACTIONS)})`),
    check("audit_events_outcome_check", sql`${t.outcome} in (${inList(AUDIT_OUTCOMES)})`),
    check("audit_events_object_kind_check", sql`${t.objectKind} ~ '^[a-z][a-z_]{1,40}$'`),
    check("audit_events_reason_code_check", sql`${t.reasonCode} is null or ${t.reasonCode} ~ '^[a-z][a-z_]{1,40}$'`),
    check("audit_events_service_check", sql`${t.serviceIdentity} is null or ${t.serviceIdentity} ~ '^[a-z][a-z_.-]{1,60}$'`),
    // Free text only for break-glass, and then mandatory (IAM-6: ≥ 15 characters).
    check(
      "audit_events_reason_check",
      sql`(${t.action} = 'break_glass') = (${t.reason} is not null)
          and (${t.reason} is null or char_length(${t.reason}) between 15 and 500)`,
    ),
    // Someone is always accountable: a staff member, a vendor operator or a service.
    check(
      "audit_events_actor_check",
      sql`num_nonnulls(${t.staffId}, ${t.vendorStaffId}, ${t.serviceIdentity}) >= 1`,
    ),
    check("audit_events_hash_check", sql`${t.hash} ~ '^[0-9a-f]{64}$' and ${t.prevHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
