// Ringkasan Shift data (UX-6 shift summary, PR-33c; T-111): the server wrapper of the loader. The role is checked HERE, before the tenant transaction opens, so a role the page does
// not serve never reaches a reader (owner, manager, FO/cashier: kasir_reader ∩ visits_today, PANEL2-DECISION); everything else — the readers, the savepoints, the not-found for a
// shift or branch that is not the caller's — is load.ts, the core the isolation case runs as another tenant's owner.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { READERS, type Summary, summaryIn } from "./load";

export type NotOk = { kind: "redirect"; to: string } | Exclude<Summary, { kind: "ok" }>;

export async function loadShiftSummary(q: { cabang?: string; shift?: string }, now?: Date): Promise<NotOk | Extract<Summary, { kind: "ok" }>> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !(READERS as readonly string[]).includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, (db) => summaryIn(db, c.actingRole, c.activeBranchId ?? null, q, now));
}
