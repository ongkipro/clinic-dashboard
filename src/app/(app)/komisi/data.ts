// Komisi data (UX-16; T-087). The database decides who reads (DEC-099): Rekap Komisi & Batch for the owner, finance and the auditor
// (masked); Aturan Komisi for the owner, finance, the manager and the auditor; nobody else. No patient data in any commission reader.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type BatchDetail, type BatchList, getBatch, listBatches, listRules, type RuleList } from "../../../modules/commission/commission";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BATCH_READERS = new Set(["owner", "finance", "auditor"]);
export const RULE_READERS = new Set(["owner", "finance", "manager", "auditor"]);
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "not-found" };
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type Item = { id: string; name: string };

async function frame<T>(readers: Set<string>, fn: (db: Db) => Promise<T>): Promise<NotOk | ({ kind: "ok"; ctx: RenderedContext } & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !readers.has(c.actingRole)) return { kind: "forbidden" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), ...(await fn(db)) }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_INVALID_INPUT")) return { kind: "not-found" };
    throw e;
  }
}
export const loadBatches = () => frame(BATCH_READERS, async (db) => ({ d: (await listBatches(db)) as BatchList }));
export async function loadBatch(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(BATCH_READERS, async (db) => ({ d: (await getBatch(db, id)) as BatchDetail }));
}
// Rules with the catalog items in force (for an item-scoped rule and the simulator; the reader names them, since finance and the auditor
// do not read the catalog directly).
export const loadRules = () => frame(RULE_READERS, async (db) => {
  const d = (await listRules(db)) as RuleList;
  return { d, items: d.items as Item[] };
});
// The month (YYYY-MM, Asia/Jakarta) — the default batch period is the last closed month.
export const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);
export function lastMonth() {
  const [y, m] = thisMonth().split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
