// Jurnal & Buku Besar data (UX-22 ▸ Buku Besar; T-105). The database decides who reads (owner, finance, auditor) and what they see; every
// view carries the books' status (a preview until an activation decision exists: open gate G-ACT).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { handoverExceptions, type HandoverExceptions, isCalendarDate, journal, type Journal, report, type Report } from "../../../../modules/accounting/ledger/ledger";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const READERS = new Set(["owner", "finance", "auditor"]);
export type Filters = { from: string; to: string; branch: string | null };
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "bad-period" } | { kind: "not-found" };

export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
export function filters(sp: Record<string, string | string[] | undefined>): Filters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const t = today();
  let from = isCalendarDate(s("dari")) ? s("dari") : `${t.slice(0, 8)}01`;
  let to = isCalendarDate(s("sampai")) ? s("sampai") : t;
  if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) [from, to] = [`${t.slice(0, 8)}01`, t];
  return { from, to, branch: UUID.test(s("cabang")) ? s("cabang") : null };
}

export async function loadBukuBesar(f: Filters): Promise<NotOk | { kind: "ok"; ctx: RenderedContext; role: string; r: Report; j: Journal; hx: HandoverExceptions; branches: { id: string; name: string }[] }> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => {
      const r = await report(db, { from: f.from, to: f.to, branchId: f.branch });
      const j = await journal(db, { from: f.from, to: f.to, branchId: f.branch });
      const hx = await handoverExceptions(db, { from: f.from, to: f.to, branchId: f.branch });
      const branches = (await db.query<{ id: string; name: string }>(`select id, name from branches order by code`)).rows;
      return { kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, r, j, hx, branches };
    });
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" };
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return { kind: "bad-period" };
    throw e;
  }
}
