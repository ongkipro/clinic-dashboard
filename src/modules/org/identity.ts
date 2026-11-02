// Identity chain service (DATA-55, IAM-3, IAM-9, TEN-1, TEN-11).
//
// Writes (createMembership, assignRole, assignBranch) run as the migration/owner role
// until the invitation and access tasks (T-022, T-031) add audited org commands; they
// are the only way rows appear, and they enforce the 1:1 membership ↔ staff rule in
// one transaction.
//
// Reads used before any tenant context exists go through account_memberships(), a
// SECURITY DEFINER function that returns ids and role keys for one account only.
import type pg from "pg";
import type { Role } from "../../auth/policy";
import { type TenantContext, withTenantContext } from "../../db/rls/context";
import { LEVEL2_ROLES, LEVEL3_ROLES } from "./schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVEL2 = new Set<string>(LEVEL2_ROLES);
const LEVEL3 = new Set<string>(LEVEL3_ROLES);

export function isLevel2(role: string): boolean {
  return LEVEL2.has(role);
}

export class IdentityError extends Error {}

// Takes the pool and checks out a dedicated client, so the membership and its staff row
// commit together and never share a transaction with another caller.
export async function createMembership(
  pool: pg.Pool,
  input: { tenantId: string; accountId: string; displayName: string },
): Promise<{ membershipId: string; staffId: string }> {
  const db = await pool.connect();
  let broken: Error | undefined;
  try {
    await db.query("begin");
    try {
      const m = await db.query<{ id: string }>(
        `insert into memberships (tenant_id, account_id) values ($1, $2) returning id`,
        [input.tenantId, input.accountId],
      );
      const st = await db.query<{ id: string }>(
        `insert into staff (tenant_id, membership_id, display_name) values ($1, $2, $3) returning id`,
        [input.tenantId, m.rows[0].id, input.displayName],
      );
      await db.query("commit");
      return { membershipId: m.rows[0].id, staffId: st.rows[0].id };
    } catch (error) {
      // Keep the original error; a client whose rollback failed is destroyed.
      await db.query("rollback").catch((e: Error) => {
        broken = e;
      });
      throw error;
    }
  } finally {
    db.release(broken);
  }
}

export async function assignRole(
  db: pg.ClientBase,
  input: { tenantId: string; staffId: string; role: Role },
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into staff_roles (tenant_id, staff_id, role) values ($1, $2, $3) returning id`,
    [input.tenantId, input.staffId, input.role],
  );
  return r.rows[0].id;
}

// Level 3 only (Level 2 roles hold every branch by definition; the CHECK refuses them).
export async function assignBranch(
  db: pg.ClientBase,
  input: { tenantId: string; staffRoleId: string; branchId: string },
): Promise<void> {
  const r = await db.query(
    `insert into staff_branches (tenant_id, staff_role_id, staff_id, role, branch_id)
     select r.tenant_id, r.id, r.staff_id, r.role, $3
       from staff_roles r where r.tenant_id = $1 and r.id = $2`,
    [input.tenantId, input.staffRoleId, input.branchId],
  );
  if (r.rowCount !== 1) throw new IdentityError("role not found in this tenant");
}

export type MembershipRole = {
  tenantId: string;
  membershipId: string;
  staffId: string;
  role: Role;
  branchIds: string[] | null; // null = Level 2 wildcard
};

export async function accountMemberships(db: pg.ClientBase, accountId: string): Promise<MembershipRole[]> {
  const { rows } = await db.query<{
    tenant_id: string;
    membership_id: string;
    staff_id: string;
    role: Role;
    branch_ids: string[] | null;
  }>(`select * from account_memberships($1)`, [accountId]);
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    membershipId: r.membership_id,
    staffId: r.staff_id,
    role: r.role,
    branchIds: r.branch_ids,
  }));
}

// RoleSource for the T-006 gate: every role the account holds in any active membership,
// so the strictest rule applies (a doctor anywhere needs TOTP everywhere).
export function roleSource(pool: pg.Pool) {
  return async (accountId: string): Promise<Role[]> => {
    const c = await pool.connect();
    try {
      return [...new Set((await accountMemberships(c, accountId)).map((m) => m.role))];
    } finally {
      c.release();
    }
  };
}

// The selection a client may send: which tenant, which acting role, which active
// branch. It is validated against the account's memberships (TEN-1); nothing else
// from the client reaches the tenant context.
export type ContextSelection = { tenantId: string; actingRole: string; activeBranchId?: string };

export type ActingContext = TenantContext & {
  membershipId: string;
  staffId: string;
  actingRole: Role;
};

export async function resolveContext(
  pool: pg.Pool,
  accountId: string,
  selection: ContextSelection,
): Promise<ActingContext> {
  const c = await pool.connect();
  let all: MembershipRole[];
  try {
    all = await accountMemberships(c, accountId);
  } finally {
    c.release();
  }
  if (selection.activeBranchId !== undefined && !UUID.test(selection.activeBranchId)) {
    throw new IdentityError("branch is outside the acting role's scope");
  }
  const match = all.find((m) => m.tenantId === selection.tenantId && m.role === selection.actingRole);
  // Same answer for "no such tenant" and "not your role": nothing about other tenants leaks.
  if (!match) throw new IdentityError("no active membership with that role in that tenant");

  let allowedBranchIds: readonly string[] | "*";
  if (isLevel2(match.role)) {
    allowedBranchIds = "*"; // IAM-9: all current and future branches, never a stored list
  } else if (LEVEL3.has(match.role) && match.branchIds && match.branchIds.length > 0) {
    allowedBranchIds = match.branchIds;
  } else {
    throw new IdentityError("role has no branch assigned");
  }

  const context: ActingContext = {
    tenantId: match.tenantId,
    membershipId: match.membershipId,
    staffId: match.staffId,
    actingRole: match.role,
    roles: [match.role], // app.roles carries the acting role only (scope per acting role)
    allowedBranchIds,
    activeBranchId:
      selection.activeBranchId ??
      (allowedBranchIds !== "*" && allowedBranchIds.length === 1 ? allowedBranchIds[0] : undefined),
  };

  if (context.activeBranchId !== undefined) {
    if (allowedBranchIds !== "*" && !allowedBranchIds.includes(context.activeBranchId)) {
      throw new IdentityError("branch is outside the acting role's scope");
    }
    // Level 2: the branch must exist in this tenant; read it under the tenant's RLS.
    if (allowedBranchIds === "*") {
      const found = await withTenantContext(pool, { ...context, activeBranchId: undefined }, async (db) =>
        (await db.query(`select 1 from branches where id = $1`, [context.activeBranchId])).rowCount,
      );
      if (!found) throw new IdentityError("branch is outside the acting role's scope");
    }
  }
  return context;
}

// Records that the account acted in this tenant with this role and branch. Runs in the
// bound context; tenant, staff and acting role come from it (column defaults + RLS).
export async function recordContextSelected(pool: pg.Pool, context: ActingContext): Promise<void> {
  await withTenantContext(pool, context, async (db) => {
    await db.query(`insert into org_actions (action, active_branch_id) values ('context_selected', $1)`, [
      context.activeBranchId ?? null,
    ]);
  });
}
