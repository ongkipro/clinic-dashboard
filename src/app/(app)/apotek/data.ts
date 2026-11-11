// Siapkan & Serahkan data (UX-10, PR-18; T-065). The database decides what the pharmacist reads: the active
// branch's prep list, handover list and one dispensing. Other roles get the permission state (the front office sees
// the dispensing step on VisitTrack only).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { type DispensingDetail, getDispensing, handoverList, type HandoverList, prepList, type PrepList } from "../../../modules/pharmacy/pharmacy";
import { READERS } from "./labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Base = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" };

async function context() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" as const };
  if (!c.activeBranchId) return { kind: "no-branch" as const };
  return { kind: "ok" as const, c };
}

export type PrepData = Base | { kind: "ok"; ctx: RenderedContext; list: PrepList };
export async function loadPrep(): Promise<PrepData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), list: await prepList(db) }));
}

export type HandoverData = Base | { kind: "ok"; ctx: RenderedContext; list: HandoverList };
export async function loadHandover(): Promise<HandoverData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), list: await handoverList(db) }));
}

export type DetailData = Base | { kind: "not-found" } | { kind: "ok"; ctx: RenderedContext; d: DispensingDetail };
export async function loadDispensing(id: string): Promise<DetailData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  if (!UUID.test(id)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), d: await getDispensing(db, id) }));
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "not-found" };
    throw e;
  }
}
