// Konsol Vendor › Tim Vendor (HYG-003, DEC-036, UX-46). Console calls name the caller by
// its vendor session token; the database runs vendor_guard (platform owner; writes need the
// 10-minute TOTP step-up) and logs every outcome. The invitation token is made here; only
// its SHA-256 is stored, and the link is shown once to the inviter.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { AccountExistsError } from "../../../auth/server";
import { hashToken } from "../../org/staff/staff";
import type { ConsoleCall, Result } from "../tenants/tenants";
import type { VendorRole } from "../staff/staff";

async function call<T>(db: pg.Pool, sql: string, args: unknown[]): Promise<Result<T>> {
  const r = (await db.query<{ r: { ok: boolean; code?: string; reason?: string } & T }>(sql, args)).rows[0].r;
  return r.ok ? { ok: true, data: r } : { ok: false, code: r.code ?? "ERR_FORBIDDEN", reason: r.reason };
}

export type TeamMember = { id: string; name: string; email: string; state: "active" | "suspended" | "exited"; totp: boolean; roles: VendorRole[] };
export type TeamInvitation = { id: string; name: string; email: string; roles: VendorRole[]; invited_by: string; expires_at: string };
export type Team = { me: string; staff: TeamMember[]; invitations: TeamInvitation[] };

export function listTeam(db: pg.Pool, c: ConsoleCall) {
  return call<Team>(db, `select vendor_console_staff_list($1, $2) as r`, [c.token, c.ip]);
}

export async function inviteMember(db: pg.Pool, c: ConsoleCall, email: string, name: string, roles: string[]): Promise<Result<{ token: string }>> {
  const token = randomBytes(32).toString("base64url");
  const r = await call<object>(db, `select vendor_console_staff_invite($1, $2, $3, $4, $5, $6) as r`, [c.token, c.ip, email, name, roles, hashToken(token)]);
  return r.ok ? { ok: true, data: { token } } : r;
}

export function cancelMemberInvite(db: pg.Pool, c: ConsoleCall, invitationId: string | null) {
  return call<object>(db, `select vendor_console_staff_invite_cancel($1, $2, $3) as r`, [c.token, c.ip, invitationId]);
}

export function setMemberState(db: pg.Pool, c: ConsoleCall, staffId: string | null, state: string) {
  return call<object>(db, `select vendor_console_staff_state($1, $2, $3, $4) as r`, [c.token, c.ip, staffId, state]);
}

// ── accepting (no session) ──────────────────────────────────────────────────────────────
export type MemberInviteInfo = { email: string; name: string; roles: VendorRole[] };

export async function lookupMemberInvite(db: pg.Pool, token: string): Promise<MemberInviteInfo | null> {
  const { rows } = await db.query(`select * from vendor_staff_invite_lookup($1)`, [hashToken(token)]);
  return rows[0] ? { email: rows[0].email, name: rows[0].display_name, roles: rows[0].roles } : null;
}

export type AccountMaker = {
  createStaffAccount(input: { email: string; name: string; password: string }): Promise<{ id: string }>;
  discardNewAccount(userId: string): Promise<void>;
};

// The invite-link flow: a new account for the invited email (IAM-1 policy), then vendor
// staff. A refused accept removes the new account again, so the email is not blocked.
export async function acceptMemberWithNewAccount(db: pg.Pool, auth: AccountMaker, token: string, password: string): Promise<Result<{ staff_id: string }>> {
  const refused = (reason: "not_open" | "account_exists") => db.query(`select vendor_staff_invite_refused($1, $2)`, [hashToken(token), reason]);
  const info = await lookupMemberInvite(db, token);
  if (!info) {
    await refused("not_open");
    return { ok: false, code: "ERR_NOT_FOUND" };
  }
  let id: string;
  try {
    ({ id } = await auth.createStaffAccount({ email: info.email, name: info.name, password }));
  } catch (e) {
    if (e instanceof AccountExistsError) await refused("account_exists");
    throw e;
  }
  let r: Result<{ staff_id: string }>;
  try {
    r = await call<{ staff_id: string }>(db, `select vendor_staff_invite_accept($1, $2) as r`, [hashToken(token), id]);
  } catch (e) {
    await auth.discardNewAccount(id).catch((cleanup) => console.error("vendor invitation: could not remove the new account", { userId: id, cleanup }));
    throw e;
  }
  if (!r.ok) await auth.discardNewAccount(id).catch((cleanup) => console.error("vendor invitation: could not remove the new account", { userId: id, cleanup }));
  return r;
}
