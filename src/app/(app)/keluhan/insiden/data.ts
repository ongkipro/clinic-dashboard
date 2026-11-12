// Insiden data (UX-28 ▸ Insiden, PR-82; T-068). The database decides what each role sees: the facility head, owner and
// auditor the register; other reporters their own reports (state, not the investigation). A branch role reads its
// active branch; the owner and auditor pick one (?cabang=).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { listBranches } from "../../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { incidentGet, incidentList, incidentPatientOptions, type IncidentDetail, type IncidentList, type PatientOption } from "../../../../modules/safety/safety";
import { READERS, REPORTERS } from "./labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Base = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" };
const notFound = (e: unknown) => e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN");

async function context() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" as const };
  return { kind: "ok" as const, c };
}

export type ListData = Base | { kind: "ok"; ctx: RenderedContext; branch: { id: string; name: string }; branches: { id: string; name: string }[]; wide: boolean;
  list: IncidentList; patients: PatientOption[] };
export async function loadIncidents(cabang: string | undefined): Promise<ListData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  const wide = x.c.actingRole === "owner" || x.c.actingRole === "auditor";
  if (!wide && !x.c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => {
      const all = (await listBranches(db)).map((b) => ({ id: b.id, name: b.name }));
      const branches = wide ? all : all.filter((b) => b.id === x.c.activeBranchId);
      const branch = branches.find((b) => b.id === cabang) ?? branches[0];
      if (!branch) return { kind: "no-branch" as const };
      const list = await incidentList(db, branch.id);
      const patients = list.can_report && REPORTERS.has(x.c.actingRole) && x.c.actingRole !== "manager" ? await incidentPatientOptions(db, branch.id) : [];
      return { kind: "ok" as const, ctx: renderedContext(x.c), branch, branches, wide, list, patients };
    });
  } catch (e) {
    if (notFound(e)) return { kind: "forbidden" };
    throw e;
  }
}

export type DetailData = Base | { kind: "ok"; ctx: RenderedContext; incident: IncidentDetail };
export async function loadIncident(id: string): Promise<DetailData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  if (!UUID.test(id)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), incident: await incidentGet(db, id) }));
  } catch (e) {
    if (notFound(e)) return { kind: "not-found" };
    throw e;
  }
}
