// Hari Ini data (UX-6, PR-7, T-047): one request in the active context. FO/cashier, manager, Owner and
// Admin Pusat read a branch's board (the database decides: visits_today); the same four check patients
// in and close visits. Owner and Admin Pusat may pick any branch, the others their own.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { type Branch, listBranches } from "../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { type Today, today } from "../../../modules/visits/visits";

export const BOARD = ["owner", "admin_pusat", "manager", "fo_cashier"];

export type HariIniData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; branches: Branch[]; branch: Branch; board: Today };

export async function loadHariIni(q: { cabang?: string }): Promise<HariIniData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !BOARD.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  const wide = ["owner", "admin_pusat"].includes(c.actingRole);
  const allowed = rc.active.branches.map((b) => b.id);
  return withTenantContext(await appPool(), c, async (db) => {
    const all = await listBranches(db);
    const branches = wide ? all : all.filter((b) => allowed.includes(b.id));
    const branch = branches.find((b) => b.id === q.cabang) ?? branches.find((b) => b.id === c.activeBranchId) ?? branches[0];
    if (!branch) return { kind: "no-branch" as const };
    return { kind: "ok" as const, ctx: renderedContext(c), branches, branch, board: await today(db, branch.id) };
  });
}
