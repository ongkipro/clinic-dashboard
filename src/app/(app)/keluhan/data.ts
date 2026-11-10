// Keluhan data (UX-28, PR-43; T-057): the list for the acting role, one task, and the flag form's visits. The
// database decides what each role sees (DEC-066): handlers see content, other flaggers see the status of their own
// reports; the therapist and others get the permission state.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  type ComplaintDetail, type ComplaintKind, type ComplaintList, type FlagOptions, flagOptions, getComplaint, listComplaints,
} from "../../../modules/clinical/complaints/complaints";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { FLAGGERS } from "./labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Base = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" };

async function context() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !FLAGGERS.has(c.actingRole)) return { kind: "forbidden" as const };
  return { kind: "ok" as const, c };
}

export type ListData = Base | { kind: "ok"; ctx: RenderedContext; role: string; list: ComplaintList };
export async function loadList(kind: ComplaintKind | null): Promise<ListData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  // The central CS works without an active branch: its own reports at every allowed branch.
  return withTenantContext(await appPool(), x.c, async (db) => ({
    kind: "ok" as const, ctx: renderedContext(x.c), role: x.c.actingRole, list: await listComplaints(db, null, kind),
  }));
}

export type DetailData = Base | { kind: "not-found" } | { kind: "ok"; ctx: RenderedContext; role: string; staffId: string; task: ComplaintDetail };
export async function loadDetail(id: string): Promise<DetailData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  if (!UUID.test(id)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => ({
      kind: "ok" as const, ctx: renderedContext(x.c), role: x.c.actingRole, staffId: x.c.staffId, task: await getComplaint(db, id),
    }));
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "not-found" };
    throw e;
  }
}

export type FlagData = Base | { kind: "ok"; ctx: RenderedContext; role: string; options: FlagOptions; branches: { id: string; name: string }[] };
// The central CS names a branch (`?cabang=`); everyone else flags at the active branch.
export async function loadFlag(branch: string | null): Promise<FlagData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  const c = x.c;
  return withTenantContext(await appPool(), c, async (db) => {
    const branches = c.activeBranchId ? [] : (await db.query(`select id, name from branches order by name, id`)).rows as { id: string; name: string }[];
    const pick = c.activeBranchId ?? (branch && UUID.test(branch) ? branch : branches[0]?.id ?? null);
    if (!pick) return { kind: "no-branch" as const };
    try {
      return { kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, options: await flagOptions(db, pick), branches };
    } catch (e) {
      if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "no-branch" as const };
      throw e;
    }
  });
}
