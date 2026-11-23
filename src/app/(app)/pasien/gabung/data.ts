// Gabung Data Ganda data (19 §2.4, PR-85, T-042; HYG-NAV-2). Records officer only (patient_merge_actor refuses every other role; the page
// mirrors it so others see the permission state). Two patients are picked by search (patient_search, minimal projection, masked phone);
// their merges (patient_merges under RLS) show what is active and can be undone.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type Merge, mergesOf } from "../../../../modules/patients/merge/merge";
import { getPatient } from "../../../../modules/patients/patients";

export const MERGERS = ["records_officer"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Side = { id: string; mrn: string; fullName: string; birthDate: string; phone: string | null; mergedInto: string | null; merges: Merge[] };
export type GabungData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "ok"; ctx: RenderedContext; a: Side | null; b: Side | null };

const mask = (p: string | null) => (p ? `${p.slice(0, 3)}${"•".repeat(Math.max(p.length - 7, 0))}${p.slice(-4)}` : null);

export async function loadGabung(q: { a?: string; b?: string }): Promise<GabungData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !MERGERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, async (db) => {
    const side = async (id: string | undefined): Promise<Side | null> => {
      if (!id || !UUID.test(id)) return null;
      const p = await getPatient(db, id); // null for another tenant's id (RLS), audited as not-found
      if (!p) return null;
      // patient_get opens a merged duplicate's survivor (T-042): keep the asked id so the history and the pair stay the duplicate's,
      // and say it is already merged (the merge form is then not offered).
      return { id, mrn: p.mrn, fullName: p.fullName, birthDate: p.birthDate, phone: mask(p.phone), mergedInto: p.id === id ? null : p.id,
        merges: await mergesOf(db, id) };
    };
    return { kind: "ok", ctx: renderedContext(c), a: await side(q.a), b: await side(q.b) };
  });
}
