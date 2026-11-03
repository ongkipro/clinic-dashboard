// Approvals engine (PR-37, DATA-41, BILL-23, B-14, TD-51). Policy kinds: approval_types
// is a platform registry (rows from migrations: who may request, who may approve, and
// whether an owner may act alone with a reason); approvals are tenant-shared.
// Requests and decisions go only through approval_request() / approval_decide() /
// approval_owner_self() (security definer, attributed from the bound context, audited,
// emitting ApprovalRequested / ApprovalDecided events). Requester ≠ approver always,
// except the whitelisted owner self-action, which needs a reason.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

export const approvalTypes = pgTable(
  "approval_types",
  {
    key: text("key").primaryKey(),
    label: text("label").notNull(), // Indonesian, shown in Persetujuan (UX-26)
    requesterRoles: text("requester_roles").array().notNull(),
    approverRoles: text("approver_roles").array().notNull(),
    ownerSelf: boolean("owner_self").notNull().default(false), // B-14: owner acts alone with a reason
  },
  (t) => [
    check("approval_types_key_check", sql`${t.key} ~ '^[a-z][a-z_]{2,40}$'`),
    check("approval_types_roles_check", sql`cardinality(${t.requesterRoles}) >= 1 and cardinality(${t.approverRoles}) >= 1`),
    check("approval_types_owner_self_check", sql`not ${t.ownerSelf} or 'owner' = any(${t.approverRoles})`),
  ],
);

export const APPROVAL_STATES = ["pending", "approved", "rejected", "cancelled"] as const;

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id"),
    type: text("type")
      .notNull()
      .references(() => approvalTypes.key, { onDelete: "restrict" }),
    subjectKind: text("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    requestedAs: text("requested_as").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestReason: text("request_reason"),
    state: text("state", { enum: APPROVAL_STATES }).notNull().default("pending"),
    decidedBy: uuid("decided_by"),
    decidedAs: text("decided_as"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    ownerSelf: boolean("owner_self").notNull().default(false),
    // Integer rupiah the approval covers (SET-43 thresholds), when the type has one.
    amountRupiah: bigint("amount_rupiah", { mode: "number" }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    // One open or granted approval per subject and type: a retry or double submit cannot
    // create a second one for the same receivable, refund or batch.
    uniqueIndex("approvals_one_per_subject").on(t.tenantId, t.type, t.subjectKind, t.subjectId).where(sql`${t.state} in ('pending','approved')`),
    check("approvals_amount_check", sql`${t.amountRupiah} is null or ${t.amountRupiah} >= 0`),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("approvals_tenant_id_id_key").on(t.tenantId, t.id),
    index("approvals_pending_idx").on(t.tenantId, t.type).where(sql`${t.state} = 'pending'`),
    check("approvals_subject_kind_check", sql`${t.subjectKind} ~ '^[a-z][a-z_]{1,40}$'`),
    check("approvals_state_check", sql`${t.state} in ('pending','approved','rejected','cancelled')`),
    check(
      "approvals_decision_check",
      sql`(${t.state} = 'pending') = (${t.decidedBy} is null and ${t.decidedAt} is null and ${t.decidedAs} is null)`,
    ),
    // Maker-checker in the data itself: only a whitelisted owner self-action may have the
    // same person on both sides, and it always carries a reason; a requester withdrawing
    // their own request is a cancellation, not a decision.
    check(
      "approvals_maker_checker_check",
      sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy} or ${t.state} = 'cancelled'
          or (${t.ownerSelf} and ${t.requestedAs} = 'owner' and ${t.decidedAs} = 'owner' and length(btrim(${t.decisionReason})) >= 10)`,
    ),
    check("approvals_reason_length_check", sql`coalesce(length(${t.requestReason}), 0) <= 500 and coalesce(length(${t.decisionReason}), 0) <= 500`),
  ],
);
