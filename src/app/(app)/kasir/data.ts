// Kasir data (UX-12; T-072). The database decides what each role reads: the cashier roles at their active branch, owner,
// finance and auditor tenant-wide (a branch picked with ?cabang=, else the first by name); the auditor reads masked.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  getReceipt, kasirCounterItems, kasirInvoice, kasirQueue, kasirVisitLines, type CounterItem, type KasirInvoice, type KasirQueue, type Receipt, type VisitLines,
} from "../../../modules/cashier/kasir/kasir";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { READERS } from "./labels";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" };
type Base = { ctx: RenderedContext; role: string; branches: { id: string; name: string }[] };
const missing = (e: unknown) => e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN");

async function frame<T>(fn: (db: Db, role: string) => Promise<T>): Promise<NotOk | ({ kind: "ok" } & Base & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if ((c.actingRole === "manager" || c.actingRole === "fo_cashier") && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const branches = (await db.query(`select id, name from branches order by name, id`)).rows as { id: string; name: string }[];
      return { kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, branches, ...(await fn(db, c.actingRole)) };
    });
  } catch (e) {
    if (missing(e)) return { kind: "not-found" };
    throw e;
  }
}
const pick = (cabang: string | undefined) => (cabang && UUID.test(cabang) ? cabang : null);
export const loadQueue = (cabang?: string) => frame(async (db) => ({ q: (await kasirQueue(db, pick(cabang))) as KasirQueue }));
export async function loadInvoice(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(async (db) => ({ inv: (await kasirInvoice(db, id)) as KasirInvoice }));
}
export async function loadVisit(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(async (db) => ({ v: (await kasirVisitLines(db, id)) as VisitLines }));
}
export const loadCounter = (cabang: string | undefined, query: string | undefined) => frame(async (db) => {
  const q = (await kasirQueue(db, pick(cabang))) as KasirQueue;
  return { branch: q.branch, items: (await kasirCounterItems(db, q.branch.id, query?.slice(0, 80) || null)) as CounterItem[] };
});
export async function loadReceipt(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(async (db) => ({ r: (await getReceipt(db, id)) as Receipt }));
}
