// Paket & Saldo data (UX-13; T-076). The database decides who reads: owner, finance and the auditor tenant-wide (masked
// for the auditor), manager and FO/cashier at their active branch; admin pusat only Isi Paket.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { patientBalance, type PatientBalance } from "../../../../modules/balance/balance";
import { packageContents, patientPackages, searchPatients, type PackageContents, type PatientHit, type PatientPackages } from "../../../../modules/packages/packages";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const READERS = new Set(["owner", "manager", "fo_cashier", "finance", "auditor"]);
export const EDITORS = new Set(["owner", "admin_pusat"]);
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" };
const missing = (e: unknown) => e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN");

async function frame<T>(allowed: Set<string>, fn: (db: Db, role: string) => Promise<T>): Promise<NotOk | ({ kind: "ok"; ctx: RenderedContext; role: string } & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !allowed.has(c.actingRole)) return { kind: "forbidden" };
  if ((c.actingRole === "manager" || c.actingRole === "fo_cashier") && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, ...(await fn(db, c.actingRole)) }));
  } catch (e) {
    if (missing(e)) return { kind: "not-found" };
    throw e;
  }
}
export const loadSearch = (q: string | undefined) =>
  frame(READERS, async (db) => ({ hits: (q && q.trim().length >= 2 ? await searchPatients(db, q.slice(0, 80)) : []) as PatientHit[] }));
export async function loadPatient(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(READERS, async (db) => ({ p: (await patientPackages(db, id)) as PatientPackages, b: (await patientBalance(db, id)) as PatientBalance }));
}
// The package items of the tenant with their active version (Isi Paket picks one) and the services to put in.
export async function loadContents(version: string | undefined) {
  return frame(EDITORS, async (db) => {
    const packages = (await db.query(`select v.id, v.name, v.referenced_at is not null sold from catalog_versions v join catalog_items i on i.tenant_id = v.tenant_id and i.id = v.item_id
                                       where i.kind = 'package' and v.state = 'active' order by v.name, v.id`)).rows as { id: string; name: string; sold: boolean }[];
    const services = (await db.query(`select i.id, v.name from catalog_items i join catalog_versions v on v.tenant_id = i.tenant_id and v.item_id = i.id and v.state = 'active'
                                       where i.kind = 'service' order by v.name, i.id`)).rows as { id: string; name: string }[];
    const pick = version && UUID.test(version) ? version : packages[0]?.id;
    return { packages, services, contents: pick ? ((await packageContents(db, pick)) as PackageContents) : null };
  });
}
