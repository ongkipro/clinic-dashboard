// SATUSEHAT page data (UX-23; T-102 increment 3). The database decides each role's projection (satusehat_page, 07 :63). The branch is the
// active context's branch for branch roles; owner and Admin Pusat (tenant-wide) pick one of the tenant's branches (?cabang=). Admin Pusat
// and the owner also read the credential status (never a secret).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { credentialStatus, type CredentialStatus, errorBody, type LookupStatusRow, practitionerLookupStatus, satusehatPage, type SatusehatPage }
  from "../../../modules/integrations/satusehat/satusehat";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export const PAGE_ROLES = new Set(["owner", "admin_pusat", "manager", "facility_head", "records_officer", "doctor"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type SatusehatData = { page: SatusehatPage; ctx: RenderedContext; branches: { id: string; name: string }[]; branchId: string;
  credentials: CredentialStatus[] | null; lookups: LookupStatusRow[] | null };

export async function loadSatusehat(cabang: string | undefined) {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !PAGE_ROLES.has(c.actingRole)) return { kind: "forbidden" as const };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const branches = (await db.query(`select id, name from branches order by name, id`)).rows as { id: string; name: string }[];
      const pick = c.activeBranchId ?? (cabang && UUID.test(cabang) && branches.some((b) => b.id === cabang) ? cabang : branches[0]?.id);
      if (!pick) return { kind: "empty" as const };
      const page = await satusehatPage(db, pick);
      const credentials = c.actingRole === "owner" || c.actingRole === "admin_pusat" ? (await credentialStatus(db)).filter((x) => x.branch_id === pick) : null;
      // TD-31 (increment 4): the latest NIK lookup per staff member (state and reason code only) for those who may request one
      const lookups = page.practitioners ? await practitionerLookupStatus(db, pick) : null;
      return { kind: "ok" as const, d: { page, ctx: renderedContext(c), branches: c.activeBranchId ? [] : branches, branchId: pick, credentials, lookups } satisfies SatusehatData };
    });
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_NOT_FOUND")) return { kind: "forbidden" as const };
    throw e;
  }
}

// The provider's error body of one attempt (clinical class, DATA-40): the facility head only; the database refuses every other role and
// audits each read as a clinical read. Opened on its own page, so the list never reads (or audits) bodies nobody looked at.
export async function loadErrorBody(attempt: string) {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || c.actingRole !== "facility_head") return { kind: "forbidden" as const };
  if (!UUID.test(attempt)) return { kind: "missing" as const };
  try {
    return { kind: "ok" as const, body: await withTenantContext(await appPool(), c, (db) => errorBody(db, attempt)) };
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "missing" as const };
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" as const };
    throw e;
  }
}
