// Kampanye data (UX-19; T-100). The database decides what each role reads: campaign_workspace_list for owner, Admin Pusat, marketing and the
// auditor (counts only — never a member; the gate's missing evidence only for owner / Admin Pusat, DEC-112).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { campaignWorkspace, type Workspace } from "../../../modules/crm/campaigns/campaigns";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export const PAGE_ROLES = new Set(["owner", "admin_pusat", "marketing", "auditor"]);
export type Kampanye = Workspace & { ctx: RenderedContext };

export async function loadKampanye() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !PAGE_ROLES.has(c.actingRole)) return { kind: "forbidden" as const };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, d: { ...(await campaignWorkspace(db)), ctx: renderedContext(c) } satisfies Kampanye }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" as const };
    throw e;
  }
}
