// Master Layanan data (UX-25, PR-88, T-034): one request in the active context. The 19 row's roles
// open it: Admin Pusat, Owner, Facility head, Pharmacist; Manager edits the catalog too (DEC-046), so
// it opens it as well. The list is the commercial projection's services (category, durations,
// online-bookable). The detail reads the versions and their rows as RLS allows: clinical-content roles
// see active and superseded versions; editors and facility heads also unpublished ones; a pharmacist
// never unpublished clinical text (DEC-047 (2)) and sees pending recipes only in Persetujuan.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { catalogItem, commercialCatalog, type CommercialRow, itemVersions, openReview, serviceRows, type ServiceRows, unpublishedItems, type UnpublishedRow, type VersionRow } from "../../../modules/catalog/catalog";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { priceBranches, priceRows, summarise } from "../../../modules/catalog/prices/prices";
import { listStaff } from "../../../modules/org/staff/staff";
import type { BranchPrices } from "../katalog/harga-cabang/summary";

export const READERS = ["owner", "admin_pusat", "manager", "facility_head", "pharmacist"] as const;
export const EDITORS = ["owner", "admin_pusat", "manager"] as const;
const UNPUBLISHED_READERS = ["owner", "admin_pusat", "manager", "facility_head"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Base = { canEdit: boolean; role: string; staffId: string; ctx: RenderedContext };
export type ListData = { kind: "redirect"; to: string } | { kind: "forbidden" } | ({ kind: "ok"; rows: CommercialRow[]; unpublished: UnpublishedRow[] } & Base);
export type Version = VersionRow & { rows: ServiceRows };
export type DetailData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | ({ kind: "ok"; item: { id: string; kind: string; code: string }; commercial: CommercialRow | null; versions: Version[]; openReview: string | null; staffNames: Record<string, string>; prices: BranchPrices | null } & Base);
export type StaffOption = { id: string; name: string; roles: string[] };

async function context() {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  if (rc.kind === "blocked") return { kind: "forbidden" as const };
  const c = rc.active.context;
  if (!(READERS as readonly string[]).includes(c.actingRole)) return { kind: "forbidden" as const };
  const base: Base = { canEdit: (EDITORS as readonly string[]).includes(c.actingRole), role: c.actingRole, staffId: c.staffId, ctx: renderedContext(c) };
  return { kind: "ok" as const, c, base };
}

export async function loadServices(): Promise<ListData> {
  const x = await context();
  if (x.kind !== "ok") return x;
  const { rows, unpublished } = await withTenantContext(await appPool(), x.c, async (db) => ({
    rows: (await commercialCatalog(db)).filter((r) => r.kind === "service"),
    unpublished: UNPUBLISHED_READERS.includes(x.c.actingRole) ? (await unpublishedItems(db)).filter((r) => r.kind === "service") : [],
  }));
  return { kind: "ok", rows, unpublished, ...x.base };
}

// Active clinical staff for the eligibility picker (editors read staff; T-029).
const CLINICAL = ["doctor", "nurse", "therapist"];
async function clinicalStaff(db: Parameters<typeof listStaff>[0]): Promise<StaffOption[]> {
  return (await listStaff(db))
    .filter((s) => s.active && s.roles.some((r) => CLINICAL.includes(r.role)))
    .map((s) => ({ id: s.staffId, name: s.name, roles: s.roles.map((r) => r.role).filter((r) => CLINICAL.includes(r)) }));
}

export async function loadService(id: string, opts: { staff?: boolean } = {}): Promise<DetailData & { staff?: StaffOption[] }> {
  if (!UUID.test(id)) return { kind: "not-found" };
  const x = await context();
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => {
    const item = await catalogItem(db, id);
    if (!item || item.kind !== "service") return { kind: "not-found" as const };
    const commercial = (await commercialCatalog(db)).find((r) => r.itemId === id) ?? null;
    const versions: Version[] = [];
    for (const v of await itemVersions(db, id)) versions.push({ ...v, rows: await serviceRows(db, v.id) });
    const pending = versions.find((v) => v.state === "pending_review");
    // Staff names for eligibility rows (only roles that read staff get names; others see "Staf").
    const named = new Set(versions.flatMap((v) => v.rows.eligibility.map((e) => e.staffId).filter((s): s is string => !!s)));
    const staffNames: Record<string, string> = {};
    if (named.size && UNPUBLISHED_READERS.includes(x.c.actingRole)) {
      for (const r of (await db.query(`select id, display_name from staff where id = any($1::uuid[])`, [[...named]])).rows) staffNames[r.id] = r.display_name;
    }
    return {
      kind: "ok" as const, item, commercial, versions, staffNames,
      openReview: pending ? await openReview(db, pending) : null,
      // T-035: branch prices once the service has an active version (plan r1 P2-2).
      prices: commercial ? await (async () => {
        const branches = await priceBranches(db);
        return { branches, summary: summarise(await priceRows(db, id), branches.map((b) => b.id), commercial.normalPrice) };
      })() : null,
      staff: opts.staff && x.base.canEdit ? await clinicalStaff(db) : undefined,
      ...x.base,
    };
  });
}

export async function loadNew(): Promise<{ kind: "redirect"; to: string } | { kind: "forbidden" } | ({ kind: "ok"; staff: StaffOption[] } & Base)> {
  const x = await context();
  if (x.kind !== "ok") return x;
  if (!x.base.canEdit) return { kind: "forbidden" };
  return { kind: "ok", staff: await withTenantContext(await appPool(), x.c, clinicalStaff), ...x.base };
}
