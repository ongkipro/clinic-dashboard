// Saya › Tagihan Server data (UX-49; T-103 increment 2; 07 :67: owner and finance pay, Admin Pusat and the auditor read). The database decides
// the projection (vendor_billing_tenant_view); the page learns whether payment is available from the port (local mock only) and the policy.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { tenantView, type TenantView } from "../../../../modules/vendor/billing/billing";
import { billingPort } from "../../../../modules/vendor/billing/server-port";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const PAGE_ROLES = new Set(["owner", "finance", "admin_pusat", "auditor"]);
export type TagihanServer = TenantView & { ctx: RenderedContext; portAvailable: boolean };

export async function loadTagihanServer() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !PAGE_ROLES.has(c.actingRole)) return { kind: "forbidden" as const };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const,
      d: { ...(await tenantView(db)), ctx: renderedContext(c), portAvailable: billingPort() !== null } satisfies TagihanServer }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" as const };
    throw e;
  }
}
