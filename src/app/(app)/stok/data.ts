// Stok data (UX-11, PR-17; T-060). The database decides what each role reads (DEC-070): owner, admin pusat,
// finance, purchasing and auditor name a branch (tenant-wide); manager and pharmacist read their active branch.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  batchWatch, getCount, getItem, itemOptions, listCounts, listItems, stockCard, stockContext, type CardRow, type CountDetail, type CountRow,
  type ItemDetail, type ItemOption, type ItemRow, type StockContext, type Watch,
} from "../../../modules/inventory/stock";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { READERS } from "./labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Base = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" };
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type Frame = { ctx: RenderedContext; stock: StockContext; branch: { id: string; name: string } };

const notFound = (e: unknown) => e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN");

// The frame of every Stok page: the reader's context and the branch looked at (a branch role: its active branch;
// a tenant-wide role: ?cabang= or the first branch).
async function frame<T>(cabang: string | undefined, fn: (db: Db, f: Frame) => Promise<T>): Promise<Base | ({ kind: "ok" } & Frame & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if ((c.actingRole === "manager" || c.actingRole === "pharmacist") && !c.activeBranchId) return { kind: "no-branch" };
  return withTenantContext(await appPool(), c, async (db) => {
    const stock = await stockContext(db);
    const pick = stock.branches.find((b) => b.id === cabang) ?? stock.branches.find((b) => b.id === stock.active_branch_id) ?? stock.branches[0];
    if (!pick) return { kind: "no-branch" as const };
    const f: Frame = { ctx: renderedContext(c), stock, branch: pick };
    return { kind: "ok" as const, ...f, ...(await fn(db, f)) };
  });
}

export const homeRole = async () => {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  return { kind: "ok" as const, role: rc.kind === "ok" ? rc.active.context.actingRole : null };
};

export const loadItems = (cabang?: string) => frame(cabang, async (db, f) => ({ items: (await listItems(db, f.branch.id)) as ItemRow[] }));

export async function loadItem(id: string, cabang?: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  try {
    return await frame(cabang, async (db, f) => ({ item: (await getItem(db, id, f.branch.id)) as ItemDetail, card: (await stockCard(db, id, f.branch.id, 20)) as CardRow[] }));
  } catch (e) {
    if (notFound(e)) return { kind: "not-found" as const };
    throw e;
  }
}

export const loadNewItem = () => frame(undefined, async (db, f) => ({ options: f.stock.can_edit_items ? ((await itemOptions(db)) as ItemOption[]) : [] }));

export async function loadCard(itemId: string | undefined, cabang?: string) {
  return frame(cabang, async (db, f) => {
    const items = (await listItems(db, f.branch.id)) as ItemRow[];
    const pick = items.find((i) => i.id === itemId) ?? items[0] ?? null;
    return { items, pick, rows: pick ? ((await stockCard(db, pick.id, f.branch.id, 200)) as CardRow[]) : [] };
  });
}

export const loadWatch = (cabang?: string) => frame(cabang, async (db, f) => ({ watch: (await batchWatch(db, f.branch.id)) as Watch }));

export const loadCounts = (cabang?: string) =>
  frame(cabang, async (db, f) => ({ counts: (await listCounts(db, f.branch.id)) as CountRow[], items: (await listItems(db, f.branch.id)) as ItemRow[] }));

export async function loadCount(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  try {
    return await frame(undefined, async (db) => ({ count: (await getCount(db, id)) as CountDetail }));
  } catch (e) {
    if (notFound(e)) return { kind: "not-found" as const };
    throw e;
  }
}
