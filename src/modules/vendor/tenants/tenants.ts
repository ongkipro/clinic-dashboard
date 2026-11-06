// Tenant provisioning from the vendor console (PR-1, PR-53, TEN-12, DEC-033). Console calls
// name the caller by its vendor session token (T-021); the database runs vendor_guard with a
// 10-minute TOTP step-up and logs every outcome. The first-owner invitation token is made
// here when a second platform owner approves it: only its SHA-256 is stored; the link is
// returned once to the approver's screen.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { hashToken } from "../../org/staff/staff";
import { type RefusalSubject, withAuthorityRecheck } from "../authority";

export type ConsoleCall = { token: string; ip: string };
export type Result<T> = { ok: true; data: T } | { ok: false; code: string; reason?: string };

async function call<T>(db: pg.Pool | pg.ClientBase, sql: string, args: unknown[], subject: RefusalSubject = { object: null }): Promise<Result<T>> {
  // HYG-008b: the entry point re-reads its caller's authority after its last wait; a refusal
  // there rolls the statement back and is logged in its own transaction, attributed to `subject`
  // (withAuthorityRecheck). Calls that are not console entry points never raise it.
  const fn = /select (vendor_console_[a-z_]+)\(/.exec(sql)?.[1];
  const once = async () => {
    const r = (await db.query<{ r: { ok: boolean; code?: string; reason?: string } & T }>(sql, args)).rows[0].r;
    return r.ok ? ({ ok: true, data: r } as const) : ({ ok: false, code: r.code ?? "ERR_FORBIDDEN", reason: r.reason } as const);
  };
  if (!fn) return once();
  return withAuthorityRecheck(db, { token: String(args[0]), ip: String(args[1]) }, fn, subject, once);
}

export type NewTenant = {
  legalName: string; sak: "emkm" | "ep"; branchCode: string; branchName: string;
  timezone: "Asia/Jakarta" | "Asia/Makassar" | "Asia/Jayapura"; ownerName: string; ownerEmail: string;
};

export function createTenant(db: pg.Pool, c: ConsoleCall, t: NewTenant) {
  return call<{ tenant_id: string; branch_id: string; invitation_id: string }>(db,
    `select vendor_console_tenant_create($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`,
    [c.token, c.ip, t.legalName, t.sak, t.branchCode, t.branchName, t.timezone, t.ownerName, t.ownerEmail], { tenant: null });
}

export function requestOwnerInvite(db: pg.Pool, c: ConsoleCall, tenantId: string | null, name: string, email: string) {
  return call<{ invitation_id: string }>(db, `select vendor_console_owner_invite($1, $2, $3, $4, $5) as r`, [c.token, c.ip, tenantId, name, email], { tenant: tenantId });
}

// The checker approves; returns the one-time token (to build the link) only on success.
export async function approveOwnerInvite(db: pg.Pool, c: ConsoleCall, invitationId: string | null): Promise<Result<{ token: string }>> {
  const token = randomBytes(32).toString("base64url");
  const r = await call<object>(db, `select vendor_console_owner_invite_approve($1, $2, $3, $4) as r`, [c.token, c.ip, invitationId, hashToken(token)], { ownerInvitation: invitationId });
  return r.ok ? { ok: true, data: { token } } : r;
}

export function cancelOwnerInvite(db: pg.Pool, c: ConsoleCall, invitationId: string | null) {
  return call<object>(db, `select vendor_console_owner_invite_cancel($1, $2, $3) as r`, [c.token, c.ip, invitationId], { ownerInvitation: invitationId });
}

// The database maps every refusal (guard, invalid target, lifecycle rules) to a logged result.
export function advanceTenant(db: pg.Pool, c: ConsoleCall, tenantId: string | null, to: string, reason: string) {
  return call<{ state: string }>(db, `select vendor_console_tenant_advance($1, $2, $3, $4, $5) as r`, [c.token, c.ip, tenantId, to, reason], { tenant: tenantId });
}

export type Invitation = {
  id: string; email: string; name: string; state: "pending" | "issued" | "accepted" | "cancelled" | "expired";
  requested_by: string; requested_by_id: string; requested_at: string; approved_by: string | null; expires_at: string | null;
};
export type TenantDetail = {
  id: string; state: string; name: string | null; sak: string | null;
  branches: { code: string; name: string; timezone: string }[];
  has_owner: boolean; processor_agreement: boolean; invitations: Invitation[];
  history: { from: string; to: string; reason: string; at: string }[];
  me: string; my_roles: string[];
};

export function tenantDetail(db: pg.Pool, c: ConsoleCall, tenantId: string) {
  return call<TenantDetail>(db, `select vendor_console_tenant_detail($1, $2, $3) as r`, [c.token, c.ip, tenantId], { tenant: tenantId });
}
