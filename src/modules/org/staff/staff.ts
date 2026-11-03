// Staf & Undangan (UX-3, IAM-11). Server code over the staff functions (migration 0026)
// and the T-029 role administration; runs on the caller's client inside withTenantContext.
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { Role } from "../../../auth/policy";
import { CommandError } from "../../../lib/command";
import { call } from "../access/access";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Delivery channel (DEC-031 D1): the inviter copies the one-time link and sends it to the
// person personally (e.g. their own WhatsApp). Only the token's hash is stored; the link
// works once, for the invited email, until it expires (7 days by default) or is cancelled.
export type InviteInput = { email: string; name: string; roles: Role[]; branchIds: string[]; days?: number };

// Returns the token once (shown to the inviter as a link); only its hash is stored.
export async function invite(db: pg.ClientBase, i: InviteInput): Promise<{ invitationId: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const id = await call(async () =>
    (await db.query<{ id: string }>(`select staff_invite($1, $2, $3, $4, $5, $6) as id`, [
      i.email, i.name, i.roles, i.branchIds, hashToken(token), i.days ?? 7,
    ])).rows[0].id,
  );
  return { invitationId: id, token };
}

export async function cancelInvite(db: pg.ClientBase, invitationId: string): Promise<void> {
  await call(() => db.query(`select staff_invite_cancel($1)`, [invitationId]));
}

export type InviteInfo = { email: string; displayName: string; clinic: string; roles: Role[] };

// Outside a tenant context (the invite link page).
export async function lookupInvite(app: pg.Pool, token: string): Promise<InviteInfo | null> {
  const { rows } = await app.query(`select * from staff_invite_lookup($1)`, [hashToken(token)]);
  return rows[0] ? { email: rows[0].email, displayName: rows[0].display_name, clinic: rows[0].clinic, roles: rows[0].roles } : null;
}

// Outside a tenant context: after the invitation flow created or signed in the account
// for that email (src/auth createStaffAccount), the membership is created.
export async function acceptInvite(app: pg.Pool, token: string, accountId: string): Promise<{ tenantId: string; staffId: string }> {
  return call(async () => {
    const { rows } = await app.query(`select * from staff_invite_accept($1, $2)`, [hashToken(token), accountId]);
    return { tenantId: rows[0].tenant_id, staffId: rows[0].staff_id };
  });
}

// The invite-link flow (IAM-1: staff accounts by invitation only): a new account for the
// invited email, then the membership. If accepting fails after the account was created
// (the invitation was cancelled or expired meanwhile, or the inviter lost authority), the
// new account is removed again, so the email is not left blocked. Another account for the
// email already existing is reported (that person signs in and accepts, T-024).
export type AccountMaker = {
  createStaffAccount(input: { email: string; name: string; password: string }): Promise<{ id: string }>;
  discardNewAccount(userId: string): Promise<void>;
};
export async function acceptWithNewAccount(
  app: pg.Pool, auth: AccountMaker, token: string, password: string,
): Promise<{ tenantId: string; staffId: string; accountId: string } | null> {
  const info = await lookupInvite(app, token);
  if (!info) return null;
  const { id } = await auth.createStaffAccount({ email: info.email, name: info.displayName, password });
  try {
    return { ...(await acceptInvite(app, token, id)), accountId: id };
  } catch (e) {
    try {
      await auth.discardNewAccount(id);
    } catch (cleanup) {
      console.error("invitation: could not remove the new account after a failed accept", { userId: id, cleanup });
    }
    if (e instanceof CommandError) return null;
    throw e;
  }
}

// The first-owner invitation of a new tenant (DEC-033), issued from the vendor console.
export type OwnerInviteInfo = { email: string; displayName: string; clinic: string };
export async function lookupOwnerInvite(app: pg.Pool, token: string): Promise<OwnerInviteInfo | null> {
  const { rows } = await app.query(`select * from tenant_owner_invite_lookup($1)`, [hashToken(token)]);
  return rows[0] ? { email: rows[0].email, displayName: rows[0].display_name, clinic: rows[0].clinic } : null;
}
export async function acceptOwnerInvite(app: pg.Pool, token: string, accountId: string): Promise<{ tenantId: string; staffId: string }> {
  return call(async () => {
    const { rows } = await app.query(`select * from tenant_owner_invite_accept($1, $2)`, [hashToken(token), accountId]);
    return { tenantId: rows[0].tenant_id, staffId: rows[0].staff_id };
  });
}
// As acceptWithNewAccount, for the first-owner link.
export async function acceptOwnerWithNewAccount(
  app: pg.Pool, auth: AccountMaker, token: string, password: string,
): Promise<{ tenantId: string; staffId: string; accountId: string } | null> {
  const info = await lookupOwnerInvite(app, token);
  if (!info) return null;
  const { id } = await auth.createStaffAccount({ email: info.email, name: info.displayName, password });
  try {
    return { ...(await acceptOwnerInvite(app, token, id)), accountId: id };
  } catch (e) {
    try {
      await auth.discardNewAccount(id);
    } catch (cleanup) {
      console.error("owner invitation: could not remove the new account after a failed accept", { userId: id, cleanup });
    }
    if (e instanceof CommandError) return null;
    throw e;
  }
}

export type StaffRow = {
  staffId: string;
  name: string;
  roles: { role: Role; branchIds: string[] }[];
  active: boolean;
  from: Date;
  to: Date | null;
};

// Data Staf: what the acting role may read (T-029 readers: owner, Admin Pusat, manager and
// facility head; branch roles see their branches' staff through staff_branches).
export async function listStaff(db: pg.ClientBase): Promise<StaffRow[]> {
  const { rows } = await db.query(
    `select s.id, s.display_name, m.effective_from, m.effective_to,
            coalesce(json_agg(json_build_object('role', r.role, 'branches',
              coalesce((select json_agg(b.branch_id) from staff_branches b where b.tenant_id = r.tenant_id and b.staff_role_id = r.id), '[]'::json)))
              filter (where r.id is not null), '[]') as roles
       from staff s join memberships m on m.tenant_id = s.tenant_id and m.id = s.membership_id
       left join staff_roles r on r.tenant_id = s.tenant_id and r.staff_id = s.id
      group by s.id, s.display_name, m.effective_from, m.effective_to
      order by (m.effective_to is not null and m.effective_to <= now()), s.display_name`,
  );
  return rows.map((r) => ({
    staffId: r.id,
    name: r.display_name,
    roles: (r.roles as { role: Role; branches: string[] }[]).map((x) => ({ role: x.role, branchIds: x.branches })),
    active: !r.effective_to || new Date(r.effective_to) > new Date(),
    from: r.effective_from,
    to: r.effective_to,
  }));
}

export type InvitationRow = { id: string; email: string; name: string; roles: Role[]; state: string; expiresAt: Date };

export async function listInvitations(db: pg.ClientBase): Promise<InvitationRow[]> {
  return (await db.query(`select id, email, display_name, roles, state, expires_at from staff_invitations order by invited_at desc limit 200`)).rows.map((r) => ({
    id: r.id, email: r.email, name: r.display_name, roles: r.roles, state: r.state === "pending" && r.expires_at <= new Date() ? "expired" : r.state, expiresAt: r.expires_at,
  }));
}
