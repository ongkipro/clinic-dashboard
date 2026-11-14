// Piutang & Refund data (UX-14; T-078). The database decides who reads (kasir readers: owner, finance and the auditor
// tenant-wide, the auditor masked; manager and FO/cashier at their active branch). Admin pusat has no access (PR-63).
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { piutang, refundOptions, refundPicks, type Piutang, type RefundOptions, type RefundPick } from "../../../modules/cashier/receivables/receivables";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const READERS = new Set(["owner", "manager", "fo_cashier", "finance", "auditor"]);
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" };
const missing = (e: unknown) => e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN");

async function frame<T>(fn: (db: Db, role: string) => Promise<T>): Promise<NotOk | ({ kind: "ok"; ctx: RenderedContext; role: string } & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if ((c.actingRole === "manager" || c.actingRole === "fo_cashier") && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, ...(await fn(db, c.actingRole)) }));
  } catch (e) {
    if (missing(e)) return { kind: "not-found" };
    throw e;
  }
}
export const loadPiutang = () => frame(async (db) => ({ d: (await piutang(db, null)) as Piutang }));
export async function loadReceivable(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(async (db) => {
    const d = (await piutang(db, null)) as Piutang;
    const r = d.receivables.find((x) => x.id === id);
    if (!r) throw new CommandError("ERR_NOT_FOUND");
    const collections = (await db.query(`select c.amount::bigint amount, c.method, c.received_at, rc.number from receivable_collections c
                                          join receipts rc on rc.tenant_id = c.tenant_id and rc.id = c.receipt_id where c.receivable_id = $1 order by c.received_at`, [id])).rows
      .map((x) => ({ amount: Number(x.amount), method: x.method as string, at: new Date(x.received_at).toISOString(), number: x.number as string }));
    return { r, lines: r.lines, collections };
  });
}
export async function loadRefund(id: string) {
  if (!UUID.test(id)) return { kind: "not-found" as const };
  return frame(async (db) => {
    const d = (await piutang(db, null)) as Piutang;
    const f = d.refunds.find((x) => x.id === id && x.kind === "line");
    if (!f) throw new CommandError("ERR_NOT_FOUND");
    return { f };
  });
}
// Who approves a cash refund here (SET-11): the owner, or the owner or a manager.
async function cashApprover(db: Db) {
  const v = (await db.query(`select setting_value_at('SET-11', null, clock_timestamp()) #>> '{}' as s`)).rows[0];
  return v?.s === "owner_manager" ? "Owner atau Manajer" : "Owner";
}
export async function loadRefundOptions(invoice: string | undefined) {
  return frame(async (db) => {
    const approver = await cashApprover(db);
    if (invoice && UUID.test(invoice)) return { opts: (await refundOptions(db, invoice)) as RefundOptions, picks: [] as RefundPick[], cashApprover: approver };
    // The branch's issued, paid patient invoices with refundable room, newest first (the picker).
    return { opts: null as RefundOptions | null, picks: await refundPicks(db), cashApprover: approver };
  });
}
