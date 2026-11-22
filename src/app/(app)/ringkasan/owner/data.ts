// Ringkasan Owner (UX-20) and Cabang league / detail (UX-37), PR-33a (T-109): the server wrappers of the loaders. Owner only (07 Dashboards; nav `ringkasan-owner` "O"):
// the role is checked HERE, before the tenant transaction opens, so a role the page does not serve never reaches a reader; everything else — the readers, the savepoints,
// the not-found for a branch that is not the clinic's — is load.ts, the core the isolation case runs as another tenant's owner.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import type { ActingContext } from "../../../../modules/org/identity";
import { type Branch, detailIn, leagueIn, type NotFound, summaryIn } from "./load";

export const OWNER_ONLY = ["owner"] as const;
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | NotFound;

async function gate(): Promise<NotOk | { kind: "ok"; context: ActingContext; branches: Branch[] }> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !(OWNER_ONLY as readonly string[]).includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  return { kind: "ok", context: rc.active.context, branches: rc.active.branches };
}

export async function loadSummary(q: { periode?: string; cabang?: string }, now?: Date) {
  const g = await gate();
  if (g.kind !== "ok") return g;
  return withTenantContext(await appPool(), g.context, (db) => summaryIn(db, g.context.actingRole, g.branches, q, now));
}
export async function loadLeague(q: { periode?: string }, now?: Date) {
  const g = await gate();
  if (g.kind !== "ok") return g;
  return withTenantContext(await appPool(), g.context, (db) => leagueIn(db, g.branches, q, now));
}
export async function loadDetail(id: string, q: { periode?: string }, now?: Date) {
  const g = await gate();
  if (g.kind !== "ok") return g;
  return withTenantContext(await appPool(), g.context, (db) => detailIn(db, g.context.actingRole, g.branches, id, q, now));
}
