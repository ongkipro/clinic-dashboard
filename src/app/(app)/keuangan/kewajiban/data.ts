// Piutang & Kewajiban Layanan data (UX-22 ▸ Kewajiban; T-104). The database decides who reads (owner, finance, auditor) and what they see.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate, rollforward, type Rollforward } from "../../../../modules/accounting/subledgers/subledgers";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const READERS = new Set(["owner", "finance", "auditor"]);
export type Filters = { from: string; to: string; branch: string | null };
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "bad-period" } | { kind: "not-found" };

export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// dari/sampai when both are valid (from ≤ to, at most 366 days), else this month up to today (WIB).
export function filters(sp: Record<string, string | string[] | undefined>): Filters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const t = today();
  let from = isCalendarDate(s("dari")) ? s("dari") : `${t.slice(0, 8)}01`;
  let to = isCalendarDate(s("sampai")) ? s("sampai") : t;
  if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) [from, to] = [`${t.slice(0, 8)}01`, t];
  return { from, to, branch: UUID.test(s("cabang")) ? s("cabang") : null };
}

export async function loadKewajiban(f: Filters): Promise<NotOk | { kind: "ok"; ctx: RenderedContext; d: Rollforward }> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), d: await rollforward(db, { from: f.from, to: f.to, branchId: f.branch }) }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" };
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return { kind: "bad-period" };
    throw e;
  }
}
