// Server loader for /audit/internal (auditor & owner only per 19 §2.14 & nav.ts).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { loadAuditInternalIn, parseAuditFilters, type AuditInternalData } from "./data";

export const AUDIT_INTERNAL_ROLES = new Set(["auditor", "owner"]);

export type AuditInternalPageResult =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; data: AuditInternalData };

export async function loadAuditInternalPage(
  sp: Record<string, string | string[] | undefined>,
): Promise<AuditInternalPageResult> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const ctx = rc.kind === "ok" ? rc.active.context : null;
  if (!ctx || !AUDIT_INTERNAL_ROLES.has(ctx.actingRole)) return { kind: "forbidden" };

  const parsed = parseAuditFilters(sp);
  if (!parsed.ok) return { kind: "not-found" };

  try {
    const data = await withTenantContext(await appPool(), ctx, (db) =>
      loadAuditInternalIn(db, parsed.filters),
    );
    return { kind: "ok", data };
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" };
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return { kind: "not-found" };
    throw e;
  }
}
