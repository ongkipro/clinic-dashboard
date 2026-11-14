// Biaya Operasional & Kas Kecil data (UX-22 ▸ Biaya; T-084). The database decides who reads (owner, finance and the auditor
// tenant-wide; a manager at the active branch; no Admin Pusat or purchasing: DEC-097) and never returns the receipt bytes here.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { type ExpenseFunding, type ExpenseList, listExpenses } from "../../../../modules/expenses/expenses";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const READERS = new Set(["owner", "finance", "auditor", "manager"]);
export type NotOk = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" } | { kind: "not-found" } | { kind: "bad-period" };
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
export type Supplier = { id: string; name: string; active: boolean };
export type Filters = { from: string; to: string; branch: string | null; category: string | null; funding: ExpenseFunding | null };

export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// The period of the list: dari/sampai when both are valid dates (at most 366 days, from ≤ to), else this month (WIB).
export function filters(sp: Record<string, string | string[] | undefined>): Filters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const t = today();
  let from = DAY.test(s("dari")) ? s("dari") : `${t.slice(0, 8)}01`;
  let to = DAY.test(s("sampai")) ? s("sampai") : t;
  if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) [from, to] = [`${t.slice(0, 8)}01`, t];
  const f = s("dana");
  return {
    from, to, branch: UUID.test(s("cabang")) ? s("cabang") : null, category: UUID.test(s("kategori")) ? s("kategori") : null,
    funding: (["petty_cash", "cash", "bank", "unpaid"] as const).find((x) => x === f) ?? null,
  };
}

async function frame<T>(fn: (db: Db, role: string) => Promise<T>): Promise<NotOk | ({ kind: "ok"; ctx: RenderedContext; role: string } & T)> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !READERS.has(c.actingRole)) return { kind: "forbidden" };
  if (c.actingRole === "manager" && !c.activeBranchId) return { kind: "no-branch" };
  try {
    return await withTenantContext(await appPool(), c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, ...(await fn(db, c.actingRole)) }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" };
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return { kind: "bad-period" };
    throw e;
  }
}
// Suppliers for "Belum Dibayar" (the purchasing supplier list; recorders only — an auditor never sees the form).
async function suppliers(db: Db, role: string): Promise<Supplier[]> {
  if (!["owner", "finance", "manager"].includes(role)) return [];
  const rows = (await db.query(`select supplier_list() as r`)).rows[0].r as Supplier[];
  return rows.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, active: s.active }));
}
export const loadBiaya = (f: Filters) =>
  frame(async (db, role) => ({ f, d: (await listExpenses(db, { branchId: role === "manager" ? null : f.branch, from: f.from, to: f.to, categoryId: f.category, funding: f.funding })) as ExpenseList,
    suppliers: await suppliers(db, role) }));
// One expense: the list of its business date (the row carries its date in the link), then the row by id.
export async function loadExpense(id: string, date: string) {
  if (!UUID.test(id) || !DAY.test(date)) return { kind: "not-found" as const };
  return frame(async (db) => {
    const d = (await listExpenses(db, { from: date, to: date })) as ExpenseList;
    const e = d.rows.find((x) => x.id === id);
    if (!e) throw new CommandError("ERR_NOT_FOUND");
    return { e, d };
  });
}
