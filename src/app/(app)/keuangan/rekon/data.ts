// Rekonsiliasi data (UX-22 ▸ Rekon, PR-34; T-108): the server wrapper of the loader. The role is checked HERE, before the tenant transaction
// opens, so a role the page does not serve never reaches the reader (owner, finance, auditor: recon_report's own actor set); everything
// else — the reader, the decode, the not-found for a branch that is not the caller's — is load.ts, the core the isolation case runs.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type Query, READERS, type Rekon, rekonIn } from "./load";

export async function loadRekon(q: Query, now?: Date): Promise<{ kind: "redirect"; to: string } | Rekon> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !(READERS as readonly string[]).includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, (db) => rekonIn(db, q, now));
}
