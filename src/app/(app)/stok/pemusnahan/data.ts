// Pemusnahan data (19 §2.9 "Pemusnahan dengan saksi & persetujuan", UX-11 action; HYG-NAV-2). Pharmacist and owner (nav row). The pharmacy
// disposal writer does not exist on main (T-062 "pharmacy disposal (pemusnahan, CD-21, SET-43 thresholds …) stays a flagged gap"; the
// `disposal` approval type exists, 0022): this page reads what is real — the unfit or near-expiry batches of the branch (stock_batch_watch,
// the disposal candidates) and the SET-43 approval thresholds — and shows the recording step as blocked. No migration (HYG-NAV-2 scope).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { batchWatch, stockContext, type StockContext, type Watch } from "../../../../modules/inventory/stock";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { settingValue } from "../../../../modules/settings/settings";
import type { Thresholds } from "./model";

export const DISPOSAL_ROLES = ["pharmacist", "owner"];
export type PemusnahanData =
  | { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; role: string; stock: StockContext; branch: { id: string; name: string }; watch: Watch; thresholds: Thresholds | null };

export async function loadPemusnahan(cabang?: string): Promise<PemusnahanData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !DISPOSAL_ROLES.includes(c.actingRole)) return { kind: "forbidden" };
  if (c.actingRole === "pharmacist" && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const stock = await stockContext(db);
      const branch = stock.branches.find((b) => b.id === cabang) ?? stock.branches.find((b) => b.id === stock.active_branch_id) ?? stock.branches[0];
      if (!branch) return { kind: "no-branch" as const };
      const v = (await settingValue(db, "SET-43").catch(() => null)) as Record<string, unknown> | null;
      const n = (k: string) => (typeof v?.[k] === "number" ? (v[k] as number) : null);
      const t = [n("musnah_kedua_kejadian"), n("musnah_kedua_bulan"), n("musnah_owner")];
      return {
        kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, stock, branch, watch: (await batchWatch(db, branch.id)) as Watch,
        thresholds: t.every((x) => x !== null) ? { musnah_kedua_kejadian: t[0]!, musnah_kedua_bulan: t[1]!, musnah_owner: t[2]! } : null,
      };
    });
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_NOT_FOUND")) return { kind: "forbidden" };
    throw e;
  }
}
