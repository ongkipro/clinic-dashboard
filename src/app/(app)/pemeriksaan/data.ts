// Pemeriksaan data (UX-8, 19:85–90, PR-10; T-052): the doctor's queue at the active branch and one visit's
// sheet. The clinical readers (doctor, facility head, records officer) only; the database decides.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { examQueue, examSheet, type Queue, type Sheet } from "../../../modules/clinical/exam/exam";
import { commercialCatalog } from "../../../modules/catalog/catalog";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

const READERS = new Set(["doctor", "facility_head", "records_officer"]);

export type QueueData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | { kind: "ok"; ctx: RenderedContext; queue: Queue; staffId: string; isDoctor: boolean };

export async function loadQueue(): Promise<QueueData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if (!c.activeBranchId) return { kind: "no-branch" };
  return withTenantContext(await appPool(), c, async (db) => ({
    kind: "ok" as const, ctx: renderedContext(c), queue: await examQueue(db, c.activeBranchId!), staffId: c.staffId, isDoctor: c.actingRole === "doctor",
  }));
}

export type CatalogOption = { versionId: string; name: string; kind: string };
export type SheetData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; ctx: RenderedContext; sheet: Sheet; staffId: string; isDoctor: boolean; catalog: CatalogOption[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function loadSheet(visitId: string): Promise<SheetData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if (!UUID.test(visitId)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const sheet = await examSheet(db, visitId);
      const isDoctor = c.actingRole === "doctor";
      // The plan and map pickers: active catalog versions (no clinical fields; the database checks the kind).
      const catalog = isDoctor
        ? (await commercialCatalog(db)).map((r) => ({ versionId: r.versionId, name: r.name, kind: r.kind }))
        : [];
      return { kind: "ok" as const, ctx: renderedContext(c), sheet, staffId: c.staffId, isDoctor, catalog };
    });
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN")) return { kind: "not-found" };
    throw e;
  }
}
