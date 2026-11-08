// Harga Cabang data (UX-25 branch price tab, PR-42, T-035): one request in the active context. Every
// member reads branch prices (commercial data); only the Owner sets or cancels them (the database
// decides). Items: services, products and packages with an active version (materials have no price).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { catalogItem, commercialCatalog, type CommercialRow } from "../../../../modules/catalog/catalog";
import { type BranchSummary, priceBranches, type PriceBranch, type PriceRow, priceRows, summarise } from "../../../../modules/catalog/prices/prices";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The roles that open Master Layanan (src/app/(app)/layanan/data.ts READERS): only they get its link.
const SERVICE_READERS = ["owner", "admin_pusat", "manager", "facility_head", "pharmacist"];
type Base = { canEdit: boolean; ctx: RenderedContext; branches: PriceBranch[] };
export type ListRow = { item: CommercialRow; branches: BranchSummary[] };
export type ListData = { kind: "redirect"; to: string } | { kind: "forbidden" } | ({ kind: "ok"; rows: ListRow[] } & Base);
export type ItemData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | ({ kind: "ok"; item: CommercialRow; summary: BranchSummary[]; rows: PriceRow[]; opensServices: boolean } & Base);

async function context() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  if (rc.kind === "blocked") return { kind: "forbidden" as const };
  return { kind: "ok" as const, c: rc.active.context };
}

export async function loadPrices(): Promise<ListData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => {
    const branches = await priceBranches(db);
    const items = (await commercialCatalog(db)).filter((r) => r.kind !== "material");
    const all = await priceRows(db);
    const rows = items.map((item) => ({ item, branches: summarise(all.filter((r) => r.itemId === item.itemId), branches.map((b) => b.id), item.normalPrice) }));
    return { kind: "ok" as const, rows, branches, canEdit: x.c.actingRole === "owner", ctx: renderedContext(x.c) };
  });
}

// Not found for another tenant's item, a material, or an item without an active version (plan r1 P2-2).
export async function loadItemPrices(id: string): Promise<ItemData> {
  if (!UUID.test(id)) return { kind: "not-found" };
  const x = await context();
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => {
    const it = await catalogItem(db, id);
    if (!it || it.kind === "material") return { kind: "not-found" as const };
    const item = (await commercialCatalog(db)).find((r) => r.itemId === id);
    if (!item) return { kind: "not-found" as const };
    const branches = await priceBranches(db);
    const rows = await priceRows(db, id);
    return {
      kind: "ok" as const, item, rows, summary: summarise(rows, branches.map((b) => b.id), item.normalPrice), branches,
      canEdit: x.c.actingRole === "owner", opensServices: SERVICE_READERS.includes(x.c.actingRole), ctx: renderedContext(x.c),
    };
  });
}
