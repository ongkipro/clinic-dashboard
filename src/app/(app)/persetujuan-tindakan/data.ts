// Persetujuan Tindakan data (UX-39, PR-11; T-054): the consents needed today at the active branch and one visit's
// page. Doctor or nurse of the branch (DEC-065); the database decides.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type ConsentPage, consentPage, type ConsentQueue, consentQueue, type ConsentText, consentText } from "../../../modules/clinical/consent/consent";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

const READERS = new Set(["doctor", "nurse"]);

export type QueueData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; queue: ConsentQueue };

export async function loadQueue(): Promise<QueueData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if (!c.activeBranchId) return { kind: "no-branch" };
  return withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), queue: await consentQueue(db, c.activeBranchId!) }));
}

export type PageData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; ctx: RenderedContext; page: ConsentPage; texts: Record<string, ConsentText>; staffId: string; isDoctor: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function loadPage(visitId: string): Promise<PageData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if (!UUID.test(visitId)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const page = await consentPage(db, visitId);
      const texts: Record<string, ConsentText> = {};
      // The text to sign for each plan that has items and an open visit (the same text the database checks).
      if (!page.visit.closed && page.examination) {
        for (const p of page.plans) if (p.items.length > 0) texts[p.plan_id] = await consentText(db, visitId, p.plan_id);
      }
      return { kind: "ok" as const, ctx: renderedContext(c), page, texts, staffId: c.staffId, isDoctor: c.actingRole === "doctor" };
    });
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "not-found" };
    throw e;
  }
}
