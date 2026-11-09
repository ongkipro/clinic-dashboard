// Daftar Pasien data (PR-76, 19:75, T-041): who sees what on the first render. The 13 identity readers get
// the search (POST only, never a URL), the filters and their own saved segments; marketing gets its
// consented contacts (phone masked here, never a profile link); purchasing and auditor nothing.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { type Branch, listBranches } from "../../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { marketingContacts } from "../../../../modules/patients/consents/consents";
import { maskPhone, mySegments, type Segment } from "../../../../modules/patients/search/search";

export const READERS = ["owner", "admin_pusat", "manager", "facility_head", "records_officer", "fo_cashier", "central_cs", "bc", "doctor", "nurse", "therapist", "pharmacist", "finance"];
export const CLINICAL = ["doctor", "nurse", "therapist", "facility_head", "records_officer", "pharmacist", "bc"];

export type DaftarData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "marketing"; contacts: { id: string; fullName: string; phone: string | null }[] }
  | { kind: "ok"; ctx: RenderedContext; role: string; branches: Branch[]; segments: Segment[] };

export async function loadDaftar(): Promise<DaftarData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const c = rc.active.context;
  if (c.actingRole === "marketing") {
    const rows = await withTenantContext(await appPool(), c, (db) => marketingContacts(db));
    return { kind: "marketing", contacts: rows.map((r) => ({ id: r.patientId, fullName: r.fullName, phone: maskPhone(r.phone) })) };
  }
  if (!READERS.includes(c.actingRole)) return { kind: "forbidden" };
  return withTenantContext(await appPool(), c, async (db) => ({
    kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, branches: await listBranches(db), segments: await mySegments(db),
  }));
}
