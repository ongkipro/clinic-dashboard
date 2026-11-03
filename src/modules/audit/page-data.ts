// Data access for the Log Audit page (UX-31). Server only. The tenant and acting role
// come from the active context (T-030, PR-84: the clinic and role the staff member chose
// in Saya, re-validated against the account's memberships every request); every gate of
// T-006 applies: no session → sign in, TOTP not enrolled → enrol, idle lock → lock.
import "server-only";
import { requestContext } from "../org/context/store";
import { appPool } from "../org/context/store";
import type { AuditFilter } from "./audit";
import { type AuditPage, auditPageFor } from "./log-view";

export type { AuditPage };

export async function loadAuditPage(sel: { filter: AuditFilter }): Promise<AuditPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const c = rc.active.context;
  return auditPageFor(await appPool(), rc.accountId, {
    tenantId: c.tenantId,
    role: c.actingRole,
    branchId: c.activeBranchId,
    filter: sel.filter,
  });
}
