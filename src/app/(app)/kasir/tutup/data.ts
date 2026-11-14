// Tutup Kasir data (UX-15; T-085). The database decides what each role reads: an FO/cashier its own shifts at the active branch, a
// manager its branch, owner/finance/auditor any branch (the auditor masked); the count reasons only through cash_shift_get.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { getShift, listShifts, myShift, type ShiftDetail, type ShiftList, type ShiftState } from "../../../../modules/cashier/shifts/shifts";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const READERS = new Set(["owner", "manager", "fo_cashier", "finance", "auditor"]);
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" };

async function frame<T>(fn: (db: Db, role: string) => Promise<T>): Promise<NotOk | ({ kind: "ok"; ctx: RenderedContext; role: string } & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if ((c.actingRole === "manager" || c.actingRole === "fo_cashier") && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, ...(await fn(db, c.actingRole)) }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" };
    throw e;
  }
}
const STATES = ["open", "pending_approval", "recount", "closed"] as const;
export const loadShifts = (o: { branch?: string; state?: string }) =>
  frame(async (db, role) => {
    const branch = role === "manager" || role === "fo_cashier" ? null : o.branch && UUID.test(o.branch) ? o.branch : null;
    const state = (STATES as readonly string[]).includes(o.state ?? "") ? (o.state as ShiftState) : null;
    return { l: (await listShifts(db, { branchId: branch, state })) as ShiftList, mine: role === "auditor" ? null : await myShift(db, branch), branch, state };
  });
export async function loadShift(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(async (db) => ({ d: (await getShift(db, id)) as ShiftDetail }));
}
