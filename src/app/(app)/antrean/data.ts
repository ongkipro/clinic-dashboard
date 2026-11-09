// Antrean data (UX-6 ▸ Antrean, PR-71, T-048): the queue of the branch acted on (the active branch; Owner
// and Admin Pusat pick one). Owner, Admin Pusat, manager and FO; the database decides (queue_board).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { type Branch, listBranches } from "../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { type Board, queueBoard } from "../../../modules/visits/queue/queue";

export const BOARD = ["owner", "admin_pusat", "manager", "fo_cashier"];
export const DISPLAY = ["owner", "admin_pusat", "manager"];

export type AntreanData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; role: string; branches: Branch[]; branch: Branch; board: Board; pickBranch: boolean };

export async function loadAntrean(q: { cabang?: string }): Promise<AntreanData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !BOARD.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  // Owner and Admin Pusat on "Semua Cabang" pick a branch; the others act on their active branch only.
  const pickBranch = ["owner", "admin_pusat"].includes(c.actingRole) && !c.activeBranchId;
  return withTenantContext(await appPool(), c, async (db) => {
    const branches = await listBranches(db);
    const branch = pickBranch ? branches.find((b) => b.id === q.cabang) ?? branches[0] : branches.find((b) => b.id === c.activeBranchId);
    if (!branch) return { kind: "no-branch" as const };
    return { kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, branches: pickBranch ? branches : [branch], branch, pickBranch,
      board: await queueBoard(db, pickBranch ? branch.id : null) };
  });
}
