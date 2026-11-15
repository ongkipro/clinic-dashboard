// Lead data (UX-18; T-092). The database decides who reads and what is masked (DEC-104): leads for central CS, BC (own), manager, owner,
// marketing (consent-masked) and the auditor (masked); campaigns for those and Admin Pusat.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type CampaignList, campaignList, type LeadList, leadGet, leadList, type LeadView } from "../../../modules/crm/leads/leads";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { type Page as SearchPage, searchPatients } from "../../../modules/patients/search/search";
import { appPool, requestContext } from "../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEAD_READERS = new Set(["owner", "central_cs", "marketing", "auditor", "manager", "bc"]);
export const CAMPAIGN_READERS = new Set(["owner", "admin_pusat", "marketing", "central_cs", "manager", "bc", "auditor"]);
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden"; role?: string } | { kind: "not-found" };
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];

async function frame<T>(readers: Set<string>, fn: (db: Db) => Promise<T>): Promise<NotOk | ({ kind: "ok"; ctx: RenderedContext; role: string;
    staffId: string | null; branchId: string | null } & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !readers.has(c.actingRole)) return { kind: "forbidden", role: c?.actingRole };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole,
      staffId: c.staffId ?? null, branchId: c.activeBranchId ?? null, ...(await fn(db)) }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden", role: c.actingRole };
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_INVALID_INPUT")) return { kind: "not-found" };
    throw e;
  }
}
export const loadLeads = (stage: string, scope: string) => frame(LEAD_READERS, async (db) => ({ d: (await leadList(db, stage, scope)) as LeadList,
  campaigns: (await campaignList(db).catch(() => null)) as CampaignList | null }));
// q: a patient search for Cocokkan Pasien (the existing reader, its roles and its rate limit), only for a lead writer on an unmatched lead.
export async function loadLead(id: string, q: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(LEAD_READERS, async (db) => {
    const v = (await leadGet(db, id)) as LeadView;
    const search = v.can_write && !v.lead.patient_id && q.length >= 2 && q.length <= 80 ? ((await searchPatients(db, q)) as SearchPage) : null;
    return { v, search, campaigns: (await campaignList(db).catch(() => null)) as CampaignList | null,
      branches: (await db.query(`select id, name from branches order by name`)).rows as { id: string; name: string }[] };
  });
}
export const loadCampaigns = () => frame(CAMPAIGN_READERS, async (db) => ({ d: (await campaignList(db)) as CampaignList }));
