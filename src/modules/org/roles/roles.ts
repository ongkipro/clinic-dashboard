// Role administration (IAM-11, PR-63) over the SECURITY DEFINER functions in
// src/db/rls/readers.sql. Runs inside withTenantContext; the actor and acting role come
// from the bound context, never from the caller.
import type pg from "pg";
import type { Role } from "../../../auth/policy";

// pending: waits for an Owner (Admin Pusat asked); awaiting_confirmation: an Owner grant
// the assigned person must confirm (DEC-031 D7).
export type AssignResult =
  | { state: "active"; staffRoleId: string }
  | { state: "pending" | "awaiting_confirmation"; requestId: string };

export async function assignRole(db: pg.ClientBase, staffId: string, role: Role): Promise<AssignResult> {
  const { rows } = await db.query<{ r: { state: string; staff_role_id?: string; request_id?: string } }>(
    `select role_assign($1, $2) as r`,
    [staffId, role],
  );
  const r = rows[0].r;
  return r.state === "pending" || r.state === "awaiting_confirmation"
    ? { state: r.state, requestId: r.request_id! }
    : { state: "active", staffRoleId: r.staff_role_id! };
}

export async function decideRoleRequest(
  db: pg.ClientBase,
  requestId: string,
  approve: boolean,
): Promise<"approved" | "rejected" | "awaiting_confirmation"> {
  const { rows } = await db.query<{ r: { state: "approved" | "rejected" | "awaiting_confirmation" } }>(
    `select role_request_decide($1, $2) as r`,
    [requestId, approve],
  );
  return rows[0].r.state;
}

// The assigned person confirms or declines an Owner grant from their own session. A grant
// past 14 days or whose granter is no longer an Owner answers "lapsed" (closed, audited).
export async function answerOwnerGrant(db: pg.ClientBase, requestId: string, accept: boolean): Promise<"approved" | "rejected" | "lapsed"> {
  const { rows } = await db.query<{ r: { state: "approved" | "rejected" | "lapsed" } }>(`select role_owner_confirm($1, $2) as r`, [requestId, accept]);
  return rows[0].r.state;
}

// An Owner withdraws an Owner grant that is still waiting.
export async function withdrawOwnerGrant(db: pg.ClientBase, requestId: string): Promise<void> {
  await db.query(`select role_owner_grant_withdraw($1)`, [requestId]);
}

// Owner grants waiting for the acting staff member (newest first).
export async function myOwnerGrants(db: pg.ClientBase): Promise<{ requestId: string; grantedBy: string; at: Date }[]> {
  const { rows } = await db.query<{ request_id: string; granted_by: string; granted_at: Date }>(`select * from role_owner_grants_mine()`);
  return rows.map((r) => ({ requestId: r.request_id, grantedBy: r.granted_by, at: r.granted_at }));
}
