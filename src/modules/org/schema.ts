import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUser } from "../../auth/schema";
import { tenantsRegistry } from "../vendor/schema";

// Tenant = one brand = one legal entity (PR-1, DATA-10). Its id is the registry id.
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey(),
    legalName: text("legal_name").notNull(),
    npwp: text("npwp"),
    isPkp: boolean("is_pkp").notNull().default(false),
    pkpEffectiveFrom: date("pkp_effective_from"),
    sakFramework: text("sak_framework", { enum: ["emkm", "ep"] }).notNull(),
    accentHex: text("accent_hex"),
    logoRef: text("logo_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.id], foreignColumns: [tenantsRegistry.id] }).onDelete("restrict"),
    check("tenants_sak_framework_check", sql`${t.sakFramework} in ('emkm','ep')`),
    check("tenants_accent_hex_check", sql`${t.accentHex} ~ '^#[0-9a-fA-F]{6}$'`),
    check("tenants_pkp_check", sql`not ${t.isPkp} or ${t.pkpEffectiveFrom} is not null`),
  ],
);

// Branch of a tenant (DATA-11). Later columns (hours, closures, SATUSEHAT ids) arrive with their tasks.
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    unique("branches_tenant_id_id_key").on(t.tenantId, t.id),
    unique("branches_tenant_id_code_key").on(t.tenantId, t.code),
    check(
      "branches_timezone_check",
      sql`${t.timezone} in ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura')`,
    ),
  ],
);

// Identity chain (DATA-55, IAM-3, IAM-9, TEN-11). A login account (auth_user) holds at
// most one membership per tenant; each membership has exactly one staff row, created in
// the same transaction (src/modules/org/identity.ts). Ending a membership sets
// effective_to; history is never deleted.
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    accountId: uuid("account_id").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.accountId], foreignColumns: [authUser.id] }).onDelete("restrict"),
    unique("memberships_tenant_id_id_key").on(t.tenantId, t.id),
    unique("memberships_tenant_id_account_id_key").on(t.tenantId, t.accountId),
    check(
      "memberships_effective_check",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // staff.tenant_id = membership tenant (DATA-55).
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete("restrict"),
    unique("staff_membership_id_key").on(t.membershipId),
    unique("staff_tenant_id_id_key").on(t.tenantId, t.id),
  ],
);

// The 16 roles of the 07 matrix. Level 2 roles hold every current and future branch of
// the tenant (wildcard, never a stored list); Level 3 roles hold the branches listed
// in staff_branches for that role (IAM-9). Facility head and records officer are branch
// scoped (IAM-8).
export const LEVEL2_ROLES = [
  "owner",
  "admin_pusat",
  "finance",
  "central_cs",
  "marketing",
  "purchasing",
  "auditor",
] as const;
export const LEVEL3_ROLES = [
  "manager",
  "facility_head",
  "records_officer",
  "fo_cashier",
  "bc",
  "doctor",
  "nurse",
  "therapist",
  "pharmacist",
] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

export const staffRoles = pgTable(
  "staff_roles",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete(
      "restrict",
    ),
    unique("staff_roles_tenant_id_id_key").on(t.tenantId, t.id),
    unique("staff_roles_staff_role_key").on(t.tenantId, t.staffId, t.role),
    // Target for staff_branches: the branch row repeats staff and role so its CHECK can
    // see the role, and the FK keeps them equal to the role row's.
    unique("staff_roles_tenant_id_id_staff_role_key").on(t.tenantId, t.id, t.staffId, t.role),
    check(
      "staff_roles_role_check",
      sql`${t.role} in (${inList([...LEVEL2_ROLES, ...LEVEL3_ROLES])})`,
    ),
  ],
);

// Branch scope of one Level 3 role of one staff member. The composite FK to branches
// makes it impossible to assign a branch of another tenant.
export const staffBranches = pgTable(
  "staff_branches",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    staffRoleId: uuid("staff_role_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    role: text("role").notNull(),
    branchId: uuid("branch_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.staffRoleId, t.staffId, t.role],
      foreignColumns: [staffRoles.tenantId, staffRoles.id, staffRoles.staffId, staffRoles.role],
    }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete(
      "restrict",
    ),
    unique("staff_branches_tenant_id_id_key").on(t.tenantId, t.id),
    unique("staff_branches_role_branch_key").on(t.tenantId, t.staffRoleId, t.branchId),
    // Level 2 roles never store branches (IAM-9 wildcard).
    check("staff_branches_level3_check", sql`${t.role} in (${inList(LEVEL3_ROLES)})`),
  ],
);

// IAM-3 / B-19: every action records the staff and acting role, taken from the bound
// transaction context (app_staff_id(), app_acting_role()), never from the client. This
// org log records identity actions (context selection); T-008's audit_events applies
// the same rule to every command.
export const orgActions = pgTable(
  "org_actions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().default(sql`app_tenant_id()`),
    staffId: uuid("staff_id").notNull().default(sql`app_staff_id()`),
    actingRole: text("acting_role").notNull().default(sql`app_acting_role()`),
    activeBranchId: uuid("active_branch_id"),
    action: text("action").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete(
      "restrict",
    ),
    foreignKey({
      columns: [t.tenantId, t.activeBranchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete("restrict"),
    unique("org_actions_tenant_id_id_key").on(t.tenantId, t.id),
    check("org_actions_action_check", sql`${t.action} in ('context_selected')`),
  ],
);

// IAM-11 / PR-63: when Admin Pusat asks for any role other than the Level 3 roles it may
// assign (so every Level 2 role, plus Facility head and Records officer), the change is a
// request until an owner other than the requester approves it; only then does the
// staff_roles row exist.
export const roleRequests = pgTable(
  "role_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().default(sql`app_tenant_id()`),
    staffId: uuid("staff_id").notNull(), // whose role set changes
    role: text("role").notNull(),
    change: text("change").notNull(), // grant | revoke
    requestedBy: uuid("requested_by").notNull().default(sql`app_staff_id()`),
    requestedAs: text("requested_as").notNull().default(sql`app_acting_role()`),
    state: text("state").notNull().default("pending"), // pending | approved | rejected
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.requestedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("role_requests_tenant_id_id_key").on(t.tenantId, t.id),
    check("role_requests_change_check", sql`${t.change} in ('grant','revoke')`),
    check("role_requests_state_check", sql`${t.state} in ('pending','approved','rejected')`),
    // Any role except the Level 3 roles Admin Pusat assigns directly.
    check(
      "role_requests_role_check",
      sql`${t.role} in ('owner','admin_pusat','finance','facility_head','records_officer','auditor','central_cs','marketing','purchasing')`,
    ),
    check(
      "role_requests_decision_check",
      sql`(${t.state} = 'pending') = (${t.decidedBy} is null and ${t.decidedAt} is null)`,
    ),
    check("role_requests_not_self_check", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
    // One open request per staff, role and change (concurrent requests cannot both land).
    uniqueIndex("role_requests_one_pending")
      .on(t.tenantId, t.staffId, t.role, t.change)
      .where(sql`${t.state} = 'pending'`),
  ],
);
