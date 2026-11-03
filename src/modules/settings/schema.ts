// Settings registry (PR-38, DATA-44, B-24). Policy kinds: setting_defs is a platform
// registry seeded by migrations from src/modules/settings/registry.ts (key, group, scope,
// value spec with bounds, researched default, changers, drafters); setting_versions is
// tenant-shared and append-only: every change, restore and draft is a new row with its
// effective time, who, acting role and reason. The value in force for (tenant, branch,
// key) at time t is the newest active version with effective_from <= t, else the branch's
// tenant value (branch-scoped rows), else the default. A later change supersedes versions
// still scheduled after it (the latest decision wins). Writes go only through the
// setting_* functions (migration 0028), which enforce bounds, scope and changers and
// audit; drafts wait in Persetujuan (approval types setting_change_owner / _fh).
import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { approvals } from "../approvals/schema";
import { branches, staff, tenants } from "../org/schema";

export const settingDefs = pgTable(
  "setting_defs",
  {
    key: text("key").primaryKey(), // "SET-8"
    groupSlug: text("group_slug").notNull(),
    label: text("label").notNull(),
    kind: text("kind", { enum: ["value", "ref"] }).notNull(),
    scope: text("scope", { enum: ["tenant", "branch"] }).notNull(),
    spec: jsonb("spec"), // value rows: the value spec with bounds (src/modules/settings/spec.ts)
    defaultValue: jsonb("default_value"), // value rows: the researched default
    changers: text("changers").array().notNull(),
    drafts: jsonb("drafts").notNull(), // [{by, approver}]
  },
  (t) => [
    check("setting_defs_key_check", sql`${t.key} ~ '^SET-[0-9]{1,2}(\\.[a-z]+)?$'`),
    check("setting_defs_kind_check", sql`${t.kind} in ('value','ref') and (${t.kind} = 'value') = (${t.spec} is not null)`),
    check("setting_defs_scope_check", sql`${t.scope} in ('tenant','branch')`),
  ],
);

export const SETTING_VERSION_STATES = ["active", "draft", "rejected", "cancelled", "superseded"] as const;

export const settingVersions = pgTable(
  "setting_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id"), // branch-scoped rows: the branch; null = tenant value
    key: text("key")
      .notNull()
      .references(() => settingDefs.key, { onDelete: "restrict" }),
    value: jsonb("value").notNull(), // the value from effective_from (JSON null where the spec allows "off"/"empty")
    restoredDefault: text("restored_default", { enum: ["no", "yes"] }).notNull().default("no"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    state: text("state", { enum: SETTING_VERSION_STATES }).notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAs: text("changed_as").notNull(),
    // Display-name snapshot: every reader of the history sees who changed it, including
    // roles that may not read the staff list (T-029 readers).
    changedName: text("changed_name").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvalId: uuid("approval_id"), // drafts: the approval that decides them
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.changedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.approvalId], foreignColumns: [approvals.tenantId, approvals.id] }).onDelete("restrict"),
    unique("setting_versions_tenant_id_id_key").on(t.tenantId, t.id),
    // Migration 0028 adds two partial unique indexes Drizzle cannot express here (an
    // expression over branch_id): one waiting draft per (tenant, key, branch) and one
    // version per approval.
    index("setting_versions_lookup_idx").on(t.tenantId, t.key, t.branchId, t.effectiveFrom).where(sql`${t.state} = 'active'`),
    check("setting_versions_state_check", sql`${t.state} in ('active','draft','rejected','cancelled','superseded')`),
    check("setting_versions_reason_check", sql`length(btrim(${t.reason})) between 3 and 500`),
    check("setting_versions_draft_check", sql`${t.state} not in ('draft','rejected','cancelled') or ${t.approvalId} is not null`),
    check("setting_versions_decided_check", sql`${t.decidedAt} is null or ${t.decidedAt} >= ${t.createdAt}`),
    check("setting_versions_restored_check", sql`${t.restoredDefault} in ('no','yes')`),
  ],
);
