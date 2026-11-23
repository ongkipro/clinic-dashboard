// Gudang & Depot data (19 §2.9 "Depot per cabang (gudang, ruang tindakan, apotek), stok per depot, transfer antar depot", UX-11 ▸ Depot,
// PR-89, T-061; HYG-NAV-2). Stock readers (stock_reader, 0077): a branch role reads its active branch, tenant-wide roles pick one
// (?cabang=). depot_list + depot_get per depot (holdings with batch, expiry, quantity, vial state). Writers: pharmacist and purchasing.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { type DepotDetail, type DepotRow, getDepot, listDepots } from "../../../../modules/inventory/depots/depots";
import { stockContext, type StockContext } from "../../../../modules/inventory/stock";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { READERS } from "../labels";

export const DEPOT_WRITERS = ["pharmacist", "purchasing"]; // depot_create / depot_transfer (0078)
export type DepotData =
  | { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; role: string; stock: StockContext; branch: { id: string; name: string }; depots: DepotRow[]; details: DepotDetail[]; write: boolean };

export async function loadDepots(cabang?: string): Promise<DepotData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if ((c.actingRole === "manager" || c.actingRole === "pharmacist") && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const stock = await stockContext(db);
      const branch = stock.branches.find((b) => b.id === cabang) ?? stock.branches.find((b) => b.id === stock.active_branch_id) ?? stock.branches[0];
      if (!branch) return { kind: "no-branch" as const };
      const depots = (await listDepots(db, branch.id)) as DepotRow[];
      const details: DepotDetail[] = [];
      for (const d of depots.filter((x) => x.active)) details.push((await getDepot(db, d.id)) as DepotDetail);
      return { kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, stock, branch, depots, details, write: DEPOT_WRITERS.includes(c.actingRole) };
    });
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_NOT_FOUND")) return { kind: "forbidden" };
    throw e;
  }
}
