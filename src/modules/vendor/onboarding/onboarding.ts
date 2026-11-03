// Onboarding grant (T-024, PR-58, TEN-13). The vendor side names the caller by its vendor
// session token; the database runs vendor_guard and the grant check (active, configuration
// kind) and logs every outcome in the vendor log and the tenant's audit chain. The clinic
// Owner side runs in the Owner's tenant context (withTenantContext).
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { call as orgCall } from "../../org/access/access";
import { hashToken } from "../../org/staff/staff";
import type { ConsoleCall, Result } from "../tenants/tenants";

export const GRANT_KINDS = ["branches", "catalog", "staff_invitations", "imports", "branding", "templates"] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

async function call<T>(db: pg.Pool, sql: string, args: unknown[]): Promise<Result<T>> {
  const r = (await db.query<{ r: { ok: boolean; code?: string; reason?: string } & T }>(sql, args)).rows[0].r;
  return r.ok ? { ok: true, data: r } : { ok: false, code: r.code ?? "ERR_FORBIDDEN", reason: r.reason };
}

// May this vendor caller open <kind> in this tenant now? Any kind outside the grant —
// patient records, clinical notes, photos, consents, messages — is refused and audited.
export function onboardingAccess(db: pg.Pool, c: ConsoleCall, tenantId: string | null, kind: string) {
  return call<{ expires_at: string }>(db, `select vendor_console_onboarding_access($1, $2, $3, $4) as r`, [c.token, c.ip, tenantId, kind]);
}

export type DraftInput = { email: string; name: string; roles: string[]; branchIds: string[] };
export function draftInvitation(db: pg.Pool, c: ConsoleCall, tenantId: string | null, d: DraftInput) {
  return call<{ id: string }>(db, `select vendor_console_onboarding_invite($1, $2, $3, $4, $5, $6, $7) as r`,
    [c.token, c.ip, tenantId, d.email, d.name, d.roles, d.branchIds]);
}

// ── the clinic Owner (inside withTenantContext) ─────────────────────────────────────────
export type GrantStatus = {
  grant: { granted_at: string; expires_at: string; renewed: boolean; ended_at: string | null; end_reason: string | null; active: boolean } | null;
  drafts: { id: string; email: string; name: string; roles: string[]; branch_ids: string[]; drafted_by: string; drafted_at: string }[];
};

export async function grantStatus(db: pg.ClientBase): Promise<GrantStatus> {
  return orgCall(async () => (await db.query<{ r: GrantStatus }>(`select onboarding_grant_status() as r`)).rows[0].r);
}

// Confirming makes a normal invitation from the Owner; the one-time token is for the Owner
// to send (DEC-031 D1).
export async function confirmDraft(db: pg.ClientBase, draftId: string): Promise<{ invitationId: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const invitationId = await orgCall(async () =>
    (await db.query<{ id: string }>(`select onboarding_draft_confirm($1, $2) as id`, [draftId, hashToken(token)])).rows[0].id);
  return { invitationId, token };
}

export async function declineDraft(db: pg.ClientBase, draftId: string): Promise<void> {
  await orgCall(async () => db.query(`select onboarding_draft_decline($1)`, [draftId]));
}

export async function renewGrant(db: pg.ClientBase): Promise<Date> {
  return orgCall(async () => (await db.query<{ t: Date }>(`select onboarding_grant_renew() as t`)).rows[0].t);
}
