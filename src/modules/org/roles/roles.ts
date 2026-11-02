// Role administration (IAM-11, PR-63) over the SECURITY DEFINER functions in
// src/db/rls/readers.sql. Runs inside withTenantContext; the actor and acting role come
// from the bound context, never from the caller.
import type pg from "pg";
import type { Role } from "../../../auth/policy";

export type AssignResult = { state: "active"; staffRoleId: string } | { state: "pending"; requestId: string };

export async function assignRole(db: pg.ClientBase, staffId: string, role: Role): Promise<AssignResult> {
  const { rows } = await db.query<{ r: { state: string; staff_role_id?: string; request_id?: string } }>(
    `select role_assign($1, $2) as r`,
    [staffId, role],
  );
  const r = rows[0].r;
  return r.state === "pending"
    ? { state: "pending", requestId: r.request_id! }
    : { state: "active", staffRoleId: r.staff_role_id! };
}

export async function decideRoleRequest(
  db: pg.ClientBase,
  requestId: string,
  approve: boolean,
): Promise<"approved" | "rejected"> {
  const { rows } = await db.query<{ r: { state: "approved" | "rejected" } }>(
    `select role_request_decide($1, $2) as r`,
    [requestId, approve],
  );
  return rows[0].r.state;
}
