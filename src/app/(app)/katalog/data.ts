// Katalog & Harga data (UX-25, PR-41, T-033): one request in the active context. Every member reads
// the commercial projection; the clinical-content roles (DEC-046 (2)) also read versions with their
// clinical fields; editors and facility heads see unpublished ones (RLS decides). Owner, Admin
// Pusat and Manager publish.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { catalogItem, commercialCatalog, type CommercialRow, itemVersions, unpublishedItems, type UnpublishedRow, type VersionRow } from "../../../modules/catalog/catalog";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export const EDITORS = ["owner", "admin_pusat", "manager"] as const;
export const CLINICAL_READERS = ["owner", "admin_pusat", "manager", "facility_head", "doctor", "nurse", "therapist", "pharmacist"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Base = { canEdit: boolean; seesClinical: boolean; role: string; staffId: string; ctx: RenderedContext };
export type ListData = { kind: "redirect"; to: string } | { kind: "forbidden" } | ({ kind: "ok"; rows: CommercialRow[]; unpublished: UnpublishedRow[] } & Base);
export type DetailData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | ({ kind: "ok"; item: { id: string; kind: string; code: string }; commercial: CommercialRow | null; versions: VersionRow[] } & Base);

async function context() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  if (rc.kind === "blocked") return { kind: "forbidden" as const };
  const c = rc.active.context;
  const base: Base = {
    canEdit: (EDITORS as readonly string[]).includes(c.actingRole),
    seesClinical: (CLINICAL_READERS as readonly string[]).includes(c.actingRole),
    role: c.actingRole,
    staffId: c.staffId,
    ctx: renderedContext(c),
  };
  return { kind: "ok" as const, c, base };
}

export async function loadCatalog(): Promise<ListData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  const UNPUBLISHED_READERS = ["owner", "admin_pusat", "manager", "facility_head"];
  const { rows, unpublished } = await withTenantContext(await appPool(), x.c, async (db) => ({
    rows: await commercialCatalog(db),
    // Items without an active version (first version waiting, rejected or withdrawn): editors and
    // facility heads only (review round 1, P2); not sellable.
    unpublished: UNPUBLISHED_READERS.includes(x.c.actingRole) ? await unpublishedItems(db) : [],
  }));
  return { kind: "ok", rows, unpublished, ...x.base };
}

export async function loadItem(id: string): Promise<DetailData> {
  if (!UUID.test(id)) return { kind: "not-found" };
  const x = await context();
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => {
    const item = await catalogItem(db, id);
    if (!item) return { kind: "not-found" as const };
    const commercial = (await commercialCatalog(db)).find((r) => r.itemId === id) ?? null;
    const versions = x.base.seesClinical ? await itemVersions(db, id) : [];
    return { kind: "ok" as const, item, commercial, versions, ...x.base };
  });
}
