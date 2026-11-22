// Pasienku data (UX-35 BC home, PR-33d; T-112): the server wrapper of the loader. The BC only (07 "Dashboards" ◐; nav `pasienku` "BC"): the role is checked HERE, before the tenant
// transaction opens, so a role the page does not serve never reaches a reader; everything else — the readers, the savepoints, the figures that no reader a BC may call carries — is load.ts,
// the core the PostgreSQL tests and the isolation case run as another tenant's BC. The staff member and the branch come from the request's own context, never from the URL.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { type Pasienku, READERS, summaryIn } from "./load";

export type NotOk = { kind: "redirect"; to: string } | Exclude<Pasienku, { kind: "ok" }>;

export async function loadPasienku(now?: Date): Promise<NotOk | Extract<Pasienku, { kind: "ok" }>> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !(READERS as readonly string[]).includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, (db) => summaryIn(db, c.actingRole, c.activeBranchId ?? null, c.staffId, rc.active.staffName, now));
}
