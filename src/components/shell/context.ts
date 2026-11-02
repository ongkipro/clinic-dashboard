// Shell view model (NAV-3): the acting context for an authenticated account. Pure
// server code without Next.js imports, so tests exercise exactly what the shell renders.
// Until T-030 stores the chosen context, the shell acts in the account's first
// membership (tenant order of account_memberships) with its first role in 07 order;
// branch roles see only their branches.
import type pg from "pg";
import { ROLES, type Role } from "../../auth/policy";
import { withTenantContext } from "../../db/rls/context";
import { accountMemberships, IdentityError, resolveContext } from "../../modules/org/identity";
import { ROLE_LABEL } from "./nav";

export type Branch = { id: string; name: string };

export type ShellContext = {
  staffId: string; // scopes device-local pinned/recent pages to this membership
  role: Role;
  roleLabel: string;
  name: string;
  clinic: string;
  branches: Branch[]; // branches the acting role may switch to
  activeBranchId: string | null; // null = Semua Cabang (tenant-wide roles)
  tenantWide: boolean;
};

export type ShellData =
  | { kind: "ok"; context: ShellContext }
  | { kind: "redirect"; to: string }
  | { kind: "blocked" };

export async function shellFor(app: pg.Pool, accountId: string): Promise<ShellData> {
  const c = await app.connect();
  let memberships;
  try {
    memberships = await accountMemberships(c, accountId);
  } finally {
    c.release();
  }
  const first = memberships[0];
  if (!first) return { kind: "blocked" };
  const role = ROLES.find((r) => memberships.some((m) => m.tenantId === first.tenantId && m.role === r))!;
  let ctx;
  try {
    ctx = await resolveContext(app, accountId, { tenantId: first.tenantId, actingRole: role });
  } catch (e) {
    if (e instanceof IdentityError) return { kind: "blocked" }; // e.g. a branch role with no branch yet
    throw e; // infrastructure errors reach the error state, never "no role"
  }
  return withTenantContext(app, ctx, async (db) => {
    const t = await db.query<{ legal_name: string }>(`select legal_name from tenants`);
    const s = await db.query<{ display_name: string }>(`select display_name from staff where id = $1`, [ctx.staffId]);
    const b = await db.query<Branch>(`select id, name from branches order by name`);
    const branches =
      ctx.allowedBranchIds === "*" ? b.rows : b.rows.filter((x) => (ctx.allowedBranchIds as readonly string[]).includes(x.id));
    return {
      kind: "ok",
      context: {
        staffId: ctx.staffId,
        role,
        roleLabel: ROLE_LABEL[role],
        name: s.rows[0]?.display_name ?? "",
        clinic: t.rows[0]?.legal_name ?? "",
        branches,
        activeBranchId: ctx.activeBranchId ?? null,
        tenantWide: ctx.allowedBranchIds === "*",
      },
    };
  });
}
