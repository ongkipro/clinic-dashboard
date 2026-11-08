// Branch prices (PR-42, B-08, SET-5; T-035). Every call runs inside withTenantContext; the database
// (migration 0056) enforces Owner-only writes, effective dating (never backdated, at most a year
// ahead, a write "now" follows the row in force), immutability and the materials exclusion.
// catalog_branch_price() is the one reader of the effective price (cashier, packages, public site).
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../../lib/command";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_INVALID_INPUT"]);

export class PriceError extends CommandError {
  constructor(code: ErrorCode, readonly detail?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new PriceError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

// The effective price at a branch (now, or at `at`); null when the item, branch or active version is
// not the caller's, or the item is a material.
export async function effectivePrice(db: pg.ClientBase, itemId: string, branchId: string, at?: Date): Promise<number | null> {
  const r = at
    ? await db.query(`select catalog_branch_price($1, $2, $3) as p`, [itemId, branchId, at])
    : await db.query(`select catalog_branch_price($1, $2) as p`, [itemId, branchId]);
  return r.rows[0].p === null ? null : Number(r.rows[0].p);
}

// An override (price in whole rupiah) or "back to the normal price" (price null), from `effectiveFrom`
// (null = now). Owner only.
export async function setBranchPrice(
  db: pg.ClientBase,
  i: { itemId: string; branchId: string; price: number | null; effectiveFrom: Date | null; reason: string },
): Promise<{ id: string; effectiveFrom: Date }> {
  const r = await call(() => db.query(`select branch_price_set($1, $2, $3, $4, $5) as r`, [i.itemId, i.branchId, i.price, i.effectiveFrom, i.reason]));
  const j = r.rows[0].r;
  return { id: j.id, effectiveFrom: new Date(j.effective_from) };
}

// Withdraw a scheduled override before it takes effect. Owner only.
export async function cancelBranchPrice(db: pg.ClientBase, id: string): Promise<void> {
  await call(() => db.query(`select branch_price_cancel($1)`, [id]));
}

export type PriceRow = {
  id: string; branchId: string; itemId: string; price: number | null; effectiveFrom: Date; state: "active" | "cancelled";
  reason: string; createdBy: string; createdAt: Date; cancelledAt: Date | null;
};
const row = (r: Record<string, unknown>): PriceRow => ({
  id: r.id as string, branchId: r.branch_id as string, itemId: r.item_id as string, price: r.price === null ? null : Number(r.price),
  effectiveFrom: r.effective_from as Date, state: r.state as PriceRow["state"], reason: r.reason as string, createdBy: r.created_by as string,
  createdAt: r.created_at as Date, cancelledAt: (r.cancelled_at as Date | null) ?? null,
});

// Every override row of an item (newest first), or of every item when itemId is omitted.
export async function priceRows(db: pg.ClientBase, itemId?: string): Promise<PriceRow[]> {
  const r = itemId
    ? await db.query(`select * from branch_prices where item_id = $1 order by effective_from desc, created_at desc`, [itemId])
    : await db.query(`select * from branch_prices order by effective_from desc, created_at desc`);
  return r.rows.map(row);
}

// The branch summary for one item: the price now and the next scheduled change (the earliest active
// row after now; plan r1 P2-2), computed from the rows and the normal price.
export type BranchSummary = { branchId: string; now: number; overridden: boolean; next: { id: string; price: number | null; effectiveFrom: Date } | null };
export function summarise(rows: PriceRow[], branchIds: string[], normalPrice: number, now = new Date()): BranchSummary[] {
  return branchIds.map((b) => {
    const active = rows.filter((r) => r.branchId === b && r.state === "active");
    const current = active.filter((r) => r.effectiveFrom <= now).sort((x, y) => +y.effectiveFrom - +x.effectiveFrom)[0];
    const upcoming = active.filter((r) => r.effectiveFrom > now).sort((x, y) => +x.effectiveFrom - +y.effectiveFrom)[0];
    return {
      branchId: b,
      now: current?.price ?? normalPrice,
      overridden: current !== undefined && current.price !== null,
      next: upcoming ? { id: upcoming.id, price: upcoming.price, effectiveFrom: upcoming.effectiveFrom } : null,
    };
  });
}

// A form date (YYYY-MM-DD) in the branch's timezone (DATA-7; plan r1 P1-3): today there = now (null);
// a later date = 00:00 there; an earlier date is backdated (refused).
export async function effectiveFromDate(db: pg.ClientBase, branchId: string, date: string): Promise<Date | null | "backdated" | "invalid" | "no-branch"> {
  // A real calendar date only: a bad one sent to the database would abort the caller's transaction.
  const d = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(+d) || d.toISOString().slice(0, 10) !== date) return "invalid";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) return "no-branch";
  // Dates compared as text in the branch's timezone (a pg date read as a JS Date would depend on the
  // server's own timezone).
  const r = await db.query(
    `select to_char(clock_timestamp() at time zone b.timezone, 'YYYY-MM-DD') as today,
            case when $2::date > (clock_timestamp() at time zone b.timezone)::date then ($2::date::timestamp at time zone b.timezone) end as at
       from branches b where b.id = $1`,
    [branchId, date],
  );
  const x = r.rows[0];
  if (!x) return "no-branch";
  if (date === x.today) return null;
  return x.at ? (x.at as Date) : "backdated";
}

// The tenant's branches with their timezone (every member reads branches), for the price pages.
export type PriceBranch = { id: string; code: string; name: string; timezone: string };
export async function priceBranches(db: pg.ClientBase): Promise<PriceBranch[]> {
  return (await db.query(`select id, code, name, timezone from branches order by name, code`)).rows;
}
