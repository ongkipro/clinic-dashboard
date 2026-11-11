// Ruang Tindakan data (UX-9, PR-14; T-064). The database decides what the room roles read: today's visits at the
// active branch and one visit's treatment view (items, blockers, eligible staff, executions, materials).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { getTreatment, roomList, type RoomList, type TreatmentView } from "../../../modules/treatment/treatment";
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

export type ListData = Base | { kind: "ok"; list: RoomList };
export async function loadList(): Promise<ListData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, list: await roomList(db) }));
}

export type DetailData = Base | { kind: "not-found" } | { kind: "ok"; ctx: RenderedContext; role: string; staffId: string; view: TreatmentView };
export async function loadDetail(visitId: string): Promise<DetailData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  if (!UUID.test(visitId)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => ({
      kind: "ok" as const, ctx: renderedContext(x.c), role: x.c.actingRole, staffId: x.c.staffId, view: await getTreatment(db, visitId),
    }));
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "not-found" };
    throw e;
  }
}
