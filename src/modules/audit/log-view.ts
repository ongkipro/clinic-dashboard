// Log Audit view model (UX-31): what an authenticated account may see for a selected
// tenant and acting role. Pure server code without Next.js imports, so tests and the
// isolation gate exercise exactly what the page renders.
import type pg from "pg";
import { withTenantContext } from "../../db/rls/context";
import { IdentityError, resolveContext } from "../org/identity";
import { type AuditFilter, type AuditRow, list, verifyChain } from "./audit";

export const LOG_READERS = ["owner", "facility_head", "records_officer", "auditor"] as const;

export type AuditPage =
  | { kind: "redirect"; to: "/masuk" | "/aktifkan-2fa" | "/terkunci" }
  | { kind: "forbidden" }
  | { kind: "ok"; rows: AuditRow[]; chainBrokenAt: number | null; actingRole: string };

// The page's data for an authenticated account (also the isolation-gate case target).
export async function auditPageFor(
  p: pg.Pool,
  accountId: string,
  sel: { tenantId?: string; role?: string; branchId?: string; filter: AuditFilter },
): Promise<Exclude<AuditPage, { kind: "redirect" }>> {
  if (!sel.tenantId || !sel.role || !(LOG_READERS as readonly string[]).includes(sel.role)) {
    return { kind: "forbidden" };
  }
  let ctx;
  try {
    ctx = await resolveContext(p, accountId, { tenantId: sel.tenantId, actingRole: sel.role, activeBranchId: sel.branchId });
  } catch (e) {
    if (e instanceof IdentityError) return { kind: "forbidden" };
    throw e;
  }
  return withTenantContext(p, ctx, async (db) => ({
    kind: "ok" as const,
    rows: await list(db, ctx.actingRole, sel.filter),
    chainBrokenAt: await verifyChain(db, ctx.tenantId),
    actingRole: ctx.actingRole,
  }));
}
