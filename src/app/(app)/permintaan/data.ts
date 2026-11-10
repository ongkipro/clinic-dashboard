// Permintaan Klinis data (UX-27, PR-45; T-056). The database decides what each role reads (DEC-068): clinical
// roles the branch's requests with doses and reasons, a BC its own requests without doses; others nothing.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { getRequest, listRequests, requestOptions, type RequestOptions, type RequestRow } from "../../../modules/clinical/requests/requests";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { PROPOSERS, READERS } from "./labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Base = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" };

async function context(roles: Set<string>) {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !roles.has(c.actingRole)) return { kind: "forbidden" as const };
  if (!c.activeBranchId) return { kind: "no-branch" as const };
  return { kind: "ok" as const, c };
}

export type ListData = Base | { kind: "ok"; ctx: RenderedContext; role: string; requests: RequestRow[] };
export async function loadList(state: "pending" | "decided"): Promise<ListData> {
  const x = await context(READERS);
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), ...(await listRequests(db, state)) }));
}

export type DetailData = Base | { kind: "not-found" } | { kind: "ok"; ctx: RenderedContext; role: string; staffId: string; request: RequestRow };
export async function loadDetail(id: string): Promise<DetailData> {
  const x = await context(READERS);
  if (x.kind !== "ok") return x;
  if (!UUID.test(id)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), role: x.c.actingRole, staffId: x.c.staffId, request: await getRequest(db, id) }));
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "not-found" };
    throw e;
  }
}

export type NewData = Base | { kind: "ok"; ctx: RenderedContext; options: RequestOptions };
export async function loadNew(visit: string | null): Promise<NewData> {
  const x = await context(PROPOSERS);
  if (x.kind !== "ok") return x;
  const v = visit && UUID.test(visit) ? visit : null;
  return withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), options: await requestOptions(db, v) }));
}
