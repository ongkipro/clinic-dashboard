// Templat Paket data (19 §2.8 "Nama, masa berlaku, harga, baris tindakan × qty × nilai, min DP, cicilan, berbagi keluarga, aturan tukar",
// UX-25 ▸ Paket; HYG-NAV-2). Admin Pusat and Owner (nav row). Every active package version from the commercial projection (no clinical
// content), its contents (package_contents, T-076) and its family-sharing switch (package_sharing_get, T-082; readable by owner only in
// this page's roles — Admin Pusat sees "—"). Editing stays where it is built: Katalog (new version), Isi Paket (contents), and the
// sharing switch here (package_sharing_set: owner only, reason required).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { commercialCatalog, type CommercialRow } from "../../../../modules/catalog/catalog";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { packageContents, type PackageContents } from "../../../../modules/packages/packages";
import { packageSharing, type PackageSharingState } from "../../../../modules/packages/sharing/sharing";

export const TEMPLATE_READERS = ["owner", "admin_pusat"];
export type Template = { row: CommercialRow; contents: PackageContents | null; sharing: PackageSharingState | null };
export type PaketData = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; ctx: RenderedContext; role: string; templates: Template[] };

const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch((e) => (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_NOT_FOUND") ? null : Promise.reject(e)));

export async function loadPaket(): Promise<PaketData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !TEMPLATE_READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, async (db) => {
    const rows = (await commercialCatalog(db)).filter((r) => r.kind === "package").sort((a, b) => a.name.localeCompare(b.name, "id") || a.itemId.localeCompare(b.itemId));
    const templates: Template[] = [];
    for (const row of rows) {
      templates.push({ row, contents: await soft(packageContents(db, row.versionId)), sharing: c.actingRole === "owner" ? await soft(packageSharing(db, row.itemId)) : null });
    }
    return { kind: "ok", ctx: renderedContext(c), role: c.actingRole, templates };
  });
}
