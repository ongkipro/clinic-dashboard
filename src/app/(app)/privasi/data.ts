// Privasi & Persetujuan data (UX-30 ▸ Privasi, PR-92, T-039): the privacy officers only (the Owner, or Admin
// Pusat with the data-protection duty); the database decides (privacy_overview).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { type Overview, overview } from "../../../modules/privacy/privacy";

export type PrivasiData = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; ctx: RenderedContext; o: Overview; owner: boolean };

export async function loadPrivasi(): Promise<PrivasiData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !["owner", "admin_pusat"].includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  try {
    return { kind: "ok", ctx: renderedContext(c), owner: c.actingRole === "owner", o: await withTenantContext(await appPool(), c, (db) => overview(db)) };
  } catch (e) {
    // Admin Pusat without the duty: the database refuses.
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    throw e;
  }
}
