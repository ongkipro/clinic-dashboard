// Pajak ▸ Coretax data (UX-22 ▸ Pajak, PR-98; T-106). The database decides who reads (owner, finance, auditor) and what each month's documents
// would hold; no document is built for the page beyond its counts and totals.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { coretaxStatus, type CoretaxStatus, isPeriod } from "../../../../modules/accounting/coretax/coretax";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const READERS = new Set(["owner", "finance", "auditor"]);
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "bad-period" };

export const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);
// The default month is the previous one (a tax month is reported after it ends); an invalid or future month falls back to it.
export function prevMonth(m = thisMonth()) {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
export function period(sp: Record<string, string | string[] | undefined>) {
  const v = typeof sp.masa === "string" ? sp.masa : "";
  return isPeriod(v) && v <= thisMonth() ? v : prevMonth();
}

export async function loadPajak(p: string): Promise<NotOk | { kind: "ok"; role: string; s: CoretaxStatus }> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, role: c.actingRole, s: await coretaxStatus(db, p) }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return { kind: "bad-period" };
    throw e;
  }
}
