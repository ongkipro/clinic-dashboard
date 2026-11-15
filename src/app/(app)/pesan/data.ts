// Pesan data (UX-17; T-090). The database decides who reads (DEC-102): threads for the inbox roles (owner read-only), templates for the
// configuration roles and the inbox, the WABA status from T-089. Message bodies are opened on the server for the inbox roles only (W-10).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type InboxList, inboxList, inboxThread, type TemplateList, templateList, type Thread } from "../../../modules/messaging/inbox/inbox";
import { type WabaStatus, wabaStatus } from "../../../modules/messaging/waba/waba";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INBOX_READERS = new Set(["owner", "central_cs", "manager", "fo_cashier", "bc"]);
export const TEMPLATE_READERS = new Set(["owner", "admin_pusat", "marketing", "central_cs", "manager", "fo_cashier", "bc", "auditor"]);
export const NUMBER_READERS = TEMPLATE_READERS;
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden"; role?: string } | { kind: "not-found"; role?: string };
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];

async function frame<T>(readers: Set<string>, fn: (db: Db) => Promise<T>): Promise<NotOk | ({ kind: "ok"; ctx: RenderedContext; role: string; staffId: string | null;
    allowed: readonly string[] | "*" } & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !readers.has(c.actingRole)) return { kind: "forbidden", role: c?.actingRole };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole,
      staffId: c.staffId ?? null, allowed: c.allowedBranchIds, ...(await fn(db)) }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden", role: c.actingRole };
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_INVALID_INPUT")) return { kind: "not-found", role: c.actingRole };
    throw e;
  }
}
export const loadInbox = (filter: string) => frame(INBOX_READERS, async (db) => ({ d: (await inboxList(db, filter)) as InboxList }));
export async function loadThread(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(INBOX_READERS, async (db) => ({ t: (await inboxThread(db, id)) as Thread, d: (await inboxList(db, "all")) as InboxList,
    // routing targets: the caller's allowed branches (every branch for central_cs, which routes tenant-wide)
    branches: (await db.query(`select id, name from branches order by name`)).rows as { id: string; name: string }[] }));
}
export const loadTemplates = () => frame(TEMPLATE_READERS, async (db) => ({ d: (await templateList(db)) as TemplateList }));
export const loadNumbers = () => frame(NUMBER_READERS, async (db) => ({ d: (await wabaStatus(db)) as WabaStatus }));
