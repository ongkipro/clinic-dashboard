// Otomasi data (UX-55; T-097). The database decides what each role reads: the delivery log by role and consent (DEC-109), the pending
// draft for owner / Admin Pusat / marketing, SET-19 and SET-18 through the settings reader, the services' aftercare state from
// catalog_versions for owner / Admin Pusat / manager / facility head and catalog_commercial() for the others (DEC-046 (2)).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { automationDraft, automationLog, type Draft, type LogFilter, type LogRow } from "../../../modules/crm/automation/automation";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { settingValue } from "../../../modules/settings/settings";

export const PAGE_ROLES = new Set(["owner", "admin_pusat", "marketing", "facility_head", "manager", "central_cs"]);
const LOG_ROLES = new Set(["owner", "admin_pusat", "central_cs", "marketing", "auditor", "manager", "facility_head"]);
const DRAFT_ROLES = new Set(["owner", "admin_pusat", "marketing"]);
const CATALOG_ROLES = new Set(["owner", "admin_pusat", "manager", "facility_head"]);
export type Service = { item_id: string; name: string; has_text: boolean; pending: boolean };
export type Otomasi = { role: string; set19: Record<string, unknown>; set18: { branch: string; branch_id: string; value: { h1: string; sebelum: number } }[];
  draft: Draft | null; services: Service[]; log: LogRow[] | null; canChange: boolean; canPropose: boolean; ctx: RenderedContext };

export async function loadOtomasi(scenario: string | null, state: LogFilter) {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !PAGE_ROLES.has(c.actingRole)) return { kind: "forbidden" as const };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const role = c.actingRole;
      const set19 = (await settingValue(db, "SET-19")) as Record<string, unknown>;
      const branches = (await db.query<{ id: string; name: string }>(`select id, name from branches order by name`)).rows;
      const set18 = [];
      for (const b of branches) set18.push({ branch: b.name, branch_id: b.id, value: (await settingValue(db, "SET-18", b.id)) as { h1: string; sebelum: number } });
      const services: Service[] = CATALOG_ROLES.has(role)
        // the clinical-authorized readers (catalog_versions RLS shows them pending versions, 0054:86-89): a service with an active version,
        // or a never-approved one with only a pending version (named from it), so "belum direview klinis" is reachable for a new service
        // too (T-097 browser run 2, supervisor decision 2026-11-16); no text is read, only whether the active one is blank
        ? (await db.query<Service>(`select i.id item_id, coalesce(a.name, p.name) as name,
              coalesce(length(btrim(coalesce(a.aftercare_text, ''))) > 0, false) has_text, p.id is not null pending
              from catalog_items i
              left join catalog_versions a on a.tenant_id = i.tenant_id and a.item_id = i.id and a.state = 'active'
              left join lateral (select x.id, x.name from catalog_versions x where x.tenant_id = i.tenant_id and x.item_id = i.id
                                   and x.state = 'pending_review' order by x.version desc limit 1) p on true
             where i.kind = 'service' and (a.id is not null or p.id is not null) order by coalesce(a.name, p.name), i.id`)).rows
        : (await db.query<Service>(`select item_id, name, null::boolean has_text, pending_review pending from catalog_commercial() where kind = 'service'`)).rows;
      return {
        kind: "ok" as const,
        d: {
          role, set19, set18, services,
          draft: DRAFT_ROLES.has(role) ? await automationDraft(db) : null,
          log: LOG_ROLES.has(role) ? (await automationLog(db, (scenario as never) ?? null, state)).rows : null,
          canChange: role === "owner" || role === "admin_pusat",
          canPropose: role === "marketing",
          ctx: renderedContext(c),
        } satisfies Otomasi,
      };
    });
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" as const };
    throw e;
  }
}
