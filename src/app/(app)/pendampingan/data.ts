// Pendampingan data (UX-7, 19:86, PR-9; T-051): the BC's queue at the active branch and one visit's flow
// page. The BC role only (07:44, nav "BC"); the database decides (pendampingan_visits / pendampingan_visit).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { type Queue, queue, type VisitIntake, visitIntake } from "../../../modules/clinical/intake/intake";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { CommandError } from "../../../lib/command";

export type QueueData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; queue: Queue; staffId: string };

export async function loadQueue(): Promise<QueueData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || c.actingRole !== "bc") return { kind: "forbidden" };
  if (!c.activeBranchId) return { kind: "no-branch" };
  return withTenantContext(await appPool(), c, async (db) => ({
    kind: "ok" as const, ctx: renderedContext(c), queue: await queue(db, c.activeBranchId!), staffId: c.staffId,
  }));
}

export type VisitData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; ctx: RenderedContext; page: VisitIntake; staffId: string; isBc: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function loadVisit(visitId: string): Promise<VisitData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || c.actingRole !== "bc") return { kind: "forbidden" };
  if (!UUID.test(visitId)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({
      kind: "ok" as const, ctx: renderedContext(c), page: await visitIntake(db, visitId), staffId: c.staffId, isBc: true,
    }));
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "not-found" };
    throw e;
  }
}
