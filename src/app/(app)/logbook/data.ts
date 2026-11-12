// Logbook data (UX-9 ▸ Logbook, PR-82; T-068). The database decides what each role reads; a branch role reads its active
// branch, a tenant-wide reader (owner, admin pusat, auditor) picks one (?cabang=).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { listBranches } from "../../../modules/org/branches/branches";
import { logbookOverview, type LogbookKind, type LogbookOverview } from "../../../modules/safety/safety";
import { READERS, WIDE } from "./labels";

export type LogbookPage =
  | { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; branch: { id: string; name: string }; branches: { id: string; name: string }[]; wide: boolean; ov: LogbookOverview };

export async function loadLogbook(cabang: string | undefined, kind: LogbookKind): Promise<LogbookPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  const wide = WIDE.has(c.actingRole);
  if (!wide && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const all = (await listBranches(db)).map((b) => ({ id: b.id, name: b.name }));
      const branches = wide ? all : all.filter((b) => b.id === c.activeBranchId);
      const branch = branches.find((b) => b.id === cabang) ?? branches[0];
      if (!branch) return { kind: "no-branch" as const };
      const ov = await logbookOverview(db, branch.id, kind);
      return { kind: "ok" as const, ctx: renderedContext(c), branch, branches, wide, ov };
    });
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_NOT_FOUND")) return { kind: "forbidden" };
    throw e;
  }
}
