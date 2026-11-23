// Pembayaran (port) data (19 §2.7 "Provider (mock/penyedia), lingkungan, kanal aktif, biaya per metode", UX-12 ▸ Pengaturan Bayar, PR-68,
// T-073; HYG-NAV-2). Owner (nav row). Reads the tenant's payment_port_configs under RLS (payment_config_readable: owner, manager, FO,
// finance, auditor) — provider, environment, channels, order prefix, active, created — never the KEK version or a secret. The only
// provider on main is the mock (CHECK provider in ('mock')): a real provider needs its own task; the deployment environment decides
// whether the mock may be enabled (never in production, BILL-29).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type DeployEnv, deployEnv } from "../../../../modules/vendor/profile/profile";

export const PORT_VIEWERS = ["owner"];
export type PortRow = { id: string; provider: string; environment: string; channels: string[]; orderPrefix: string; active: boolean; createdAt: string; createdAs: string };
export type PortData = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; ctx: RenderedContext; env: DeployEnv; ports: PortRow[] };

export async function loadPorts(): Promise<PortData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !PORT_VIEWERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, async (db) => {
    const r = await db.query(`select id, provider, environment, channels, order_prefix, active, created_at, created_as from payment_port_configs
                               order by active desc, created_at desc, id desc`);
    const ports = r.rows.map((x) => ({ id: x.id, provider: x.provider, environment: x.environment, channels: x.channels, orderPrefix: x.order_prefix,
      active: x.active, createdAt: new Date(x.created_at).toISOString(), createdAs: x.created_as }));
    return { kind: "ok" as const, ctx: renderedContext(c), env: deployEnv(), ports };
  });
}
