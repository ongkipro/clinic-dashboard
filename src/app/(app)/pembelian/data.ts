// Pembelian data (UX-52, PR-17, PR-75, PR-90; T-067). The database decides what each role reads; a branch role reads
// its active branch, a tenant-wide role picks one (?cabang=). Money appears only for cost readers (the readers mask it).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { getDepot, listDepots, listTransfers, type DepotDetail, type DepotRow, type TransferRow } from "../../../modules/inventory/depots/depots";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import {
  getPurchaseOrder, listPurchaseOrders, listReceipts, payableOverview, purchasingContext, type PayableOverview, type PoDetail, type PoRow, type PurchasingContext,
  type ReceiptRow,
} from "../../../modules/purchasing/payables/payables";
import { getSupplier, listReturns, listSuppliers, returnableBatches, type ReturnableBatch, type Supplier, type SupplierDetail, type SupplierReturn } from "../../../modules/purchasing/suppliers/suppliers";
import { READERS } from "./labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type Frame = { ctx: RenderedContext; p: PurchasingContext; branch: { id: string; name: string } };
type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" };
const notFound = (e: unknown) => e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN");

async function frame<T>(cabang: string | undefined, fn: (db: Db, f: Frame) => Promise<T>): Promise<NotOk | ({ kind: "ok" } & Frame & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if ((c.actingRole === "manager" || c.actingRole === "pharmacist") && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const p = await purchasingContext(db);
      const pick = p.branches.find((b) => b.id === cabang) ?? p.branches.find((b) => b.id === p.active_branch_id) ?? p.branches[0];
      if (!pick) return { kind: "no-branch" as const };
      const f: Frame = { ctx: renderedContext(c), p, branch: pick };
      return { kind: "ok" as const, ...f, ...(await fn(db, f)) };
    });
  } catch (e) {
    if (notFound(e)) return { kind: "not-found" };
    throw e;
  }
}

export const homeRole = async () => {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  return { kind: "ok" as const, role: rc.kind === "ok" ? rc.active.context.actingRole : null };
};
export const loadSuppliers = (cabang?: string) => frame(cabang, async (db) => ({ suppliers: (await listSuppliers(db)) as Supplier[] }));
export async function loadSupplier(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(undefined, async (db) => ({ supplier: (await getSupplier(db, id)) as SupplierDetail }));
}
export const loadPos = (cabang?: string) => frame(cabang, async (db, f) => ({ pos: (await listPurchaseOrders(db, f.branch.id)) as PoRow[] }));
export async function loadPo(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(undefined, async (db) => ({ po: (await getPurchaseOrder(db, id)) as PoDetail }));
}
export const loadReceipts = (cabang?: string) => frame(cabang, async (db, f) => ({ receipts: (await listReceipts(db, f.branch.id, 50)) as ReceiptRow[] }));
export const loadReturns = (cabang?: string) => frame(cabang, async (db, f) => {
  const returnable: (ReturnableBatch & { supplier_id: string })[] = [];
  if (f.p.can_return) for (const s of f.p.suppliers.filter((x) => x.active)) {
    for (const b of (await returnableBatches(db, s.id, f.branch.id)) as ReturnableBatch[]) if (Number(b.open) > 0) returnable.push({ ...b, supplier_id: s.id });
  }
  return { returns: (await listReturns(db, f.branch.id)) as SupplierReturn[], returnable };
});
export const loadTransfers = (cabang?: string) => frame(cabang, async (db, f) => {
  const depots = ((await listDepots(db, f.branch.id)) as DepotRow[]).filter((d) => d.active);
  const holdings: DepotDetail["holdings"][number] extends infer H ? (H & { depot_id: string })[] : never = [];
  if (f.p.can_transfer) for (const d of depots.filter((x) => x.kind !== "ruang")) {
    for (const h of ((await getDepot(db, d.id)) as DepotDetail).holdings) if (!h.unfit && h.quantity > 0) holdings.push({ ...h, depot_id: d.id });
  }
  return { transfers: (await listTransfers(db, f.branch.id)) as TransferRow[], depots, holdings };
});
export const loadPayables = (cabang?: string) => frame(cabang, async (db, f) => ({ ov: f.p.money ? ((await payableOverview(db, f.branch.id)) as PayableOverview) : null }));
