// Audit Internal core reader (UX-53, PR-63, PR-72; 19 §2.14).
// Uses ONLY readers already granted to `auditor` and `owner` on main (zero migration).
// Never selects or returns any patient_id, patient name, or MRN.
import type pg from "pg";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate } from "../../../../modules/accounting/subledgers/subledgers";
import { listManualDiscounts, type ManualDiscountRow } from "../../../../modules/cashier/discounts/discounts";
import { listShifts } from "../../../../modules/cashier/shifts/shifts";
import { getCount, listCounts } from "../../../../modules/inventory/stock";
import { roleHome, type AuditHome } from "../../../../modules/reporting/dashboards/dashboards";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuditFilters = {
  from: string;
  to: string;
  branchId: string | null;
};

export type AuditFilterResult =
  | { ok: true; filters: AuditFilters }
  | { ok: false; reason: "bad-branch" | "bad-date" };

export type VoidRow = {
  id: string;
  number: string | null;
  branchId: string;
  branchName: string;
  voidedAt: string;
  issuedAs: string | null;
  total: number;
};

export type RefundRow = {
  id: string;
  branchId: string;
  branchName: string;
  amount: number; // signed negative for paid cash outflow; stored positive amount shown as negative refund impact
  destination: string;
  state: string;
  paidMethod: string | null;
  requestedAs: string | null;
  requestedAt: string;
  paidAs: string | null;
  paidAt: string | null;
};

export type WriteOffRow = {
  id: string;
  branchId: string;
  branchName: string;
  amount: number;
  ownerSelf: boolean;
  createdAt: string;
};

export type StockVarianceRow = {
  countId: string;
  branchId: string;
  branchName: string;
  countedAt: string;
  itemName: string;
  unit: string;
  batchNo: string;
  systemQty: number | null;
  countedQty: number | null;
  difference: number;
};

export type CashVarianceRow = {
  id: string;
  shiftId: string;
  branchId: string;
  branchName: string;
  seq: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  escalated: boolean;
  countedAs: string;
  countedAt: string;
};

export type AuditSummaryTotals = {
  manualDiscountTotal: number;
  voidTotal: number;
  paidRefundTotal: number;
  writeOffTotal: number;
  cashVarianceTotal: number;
};

export type AuditInternalData = {
  from: string;
  to: string;
  branchId: string | null;
  isCurrentMonth: boolean;
  branches: { id: string; name: string }[];
  monthCounts: AuditHome | null;
  manualDiscounts: ManualDiscountRow[];
  voids: VoidRow[];
  refunds: RefundRow[];
  writeOffs: WriteOffRow[];
  stockVariances: StockVarianceRow[];
  cashVariances: CashVarianceRow[];
  totals: AuditSummaryTotals;
};

export const todayJakarta = (now: Date = new Date()) =>
  now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const localDateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const inRange = (iso: string | null | undefined, from: string, to: string) => {
  if (!iso) return false;
  const d = localDateOf(iso);
  return d >= from && d <= to;
};

export function parseAuditFilters(
  sp: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): AuditFilterResult {
  if (Array.isArray(sp.cabang)) return { ok: false, reason: "bad-branch" };
  if (Array.isArray(sp.dari) || Array.isArray(sp.sampai)) return { ok: false, reason: "bad-date" };
  const rawFrom = typeof sp.dari === "string" ? sp.dari.trim() : "";
  const rawTo = typeof sp.sampai === "string" ? sp.sampai.trim() : "";
  const rawBranch = typeof sp.cabang === "string" ? sp.cabang.trim() : "";

  if (rawBranch !== "" && !UUID.test(rawBranch)) {
    return { ok: false, reason: "bad-branch" };
  }
  if (rawFrom !== "" && !isCalendarDate(rawFrom)) {
    return { ok: false, reason: "bad-date" };
  }
  if (rawTo !== "" && !isCalendarDate(rawTo)) {
    return { ok: false, reason: "bad-date" };
  }

  const today = todayJakarta(now);
  const from = rawFrom || `${today.slice(0, 8)}01`;
  const to = rawTo || today;
  if (from > today || to > today || to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) {
    return { ok: false, reason: "bad-date" };
  }
  return { ok: true, filters: { from, to, branchId: rawBranch || null } };
}

export async function loadAuditInternalIn(
  db: pg.ClientBase,
  filters: AuditFilters,
  now: Date = new Date(),
): Promise<AuditInternalData> {
  const branches = (
    await db.query<{ id: string; name: string }>(
      `select id, name from branches order by created_at asc, id asc`,
    )
  ).rows;
  const branchNames = new Map(branches.map((b) => [b.id, b.name]));

  if (filters.branchId && !branchNames.has(filters.branchId)) {
    throw new CommandError("ERR_NOT_FOUND");
  }

  const today = todayJakarta(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const isCurrentMonth = filters.from === monthStart && filters.to === today;

  // 1. Manual discounts (definer: owner + auditor only; excludes finance at SQL boundary).
  const allManualDiscounts = await listManualDiscounts(db, filters.branchId ?? undefined);
  const manualDiscounts = allManualDiscounts
    .filter((d) => inRange(d.issued_at, filters.from, filters.to))
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at));

  // 2. Header counts from dashboard_home() when current month (best effort if actingRole is auditor).
  let monthCounts: AuditHome | null = null;
  if (isCurrentMonth) {
    await db.query("savepoint audit_home_sp");
    try {
      const h = await roleHome(db, filters.branchId);
      if (h.home === "audit") monthCounts = h;
      await db.query("release savepoint audit_home_sp");
    } catch {
      await db.query("rollback to savepoint audit_home_sp");
    }
  }

  // 3. Voids (RLS invoice_readable; NEVER select patient_id!; filter Jakarta date range BEFORE LIMIT 200).
  const voidRows = (
    await db.query<{
      id: string;
      number: string | null;
      branch_id: string;
      voided_at: Date;
      issued_as: string | null;
      total: string;
    }>(
      `select i.id, i.number, i.branch_id, i.voided_at, i.issued_as,
              coalesce((select sum(l.line_total) from invoice_lines l where l.invoice_id = i.id), 0)::bigint as total
         from invoices i
        where i.state = 'void'
          and i.voided_at is not null
          and ($1::uuid is null or i.branch_id = $1::uuid)
          and (i.voided_at at time zone 'Asia/Jakarta')::date between $2::date and $3::date
        order by i.voided_at desc, i.id desc
        limit 200`,
      [filters.branchId, filters.from, filters.to],
    )
  ).rows;
  const voids: VoidRow[] = voidRows.map((r) => ({
    id: r.id,
    number: r.number,
    branchId: r.branch_id,
    branchName: branchNames.get(r.branch_id) ?? "Cabang",
    voidedAt: r.voided_at.toISOString(),
    issuedAs: r.issued_as,
    total: Number(r.total),
  }));

  // 4. Refunds (RLS receivable_readable; column-granted fields only; NEVER select patient_id!; filter date BEFORE LIMIT 200).
  const refundRows = (
    await db.query<{
      id: string;
      branch_id: string;
      amount: string;
      destination: string;
      state: string;
      paid_method: string | null;
      requested_as: string | null;
      requested_at: Date;
      paid_as: string | null;
      paid_at: Date | null;
    }>(
      `select r.id, r.branch_id, r.amount::bigint as amount, r.destination, r.state,
              r.paid_method, r.requested_as, r.requested_at, r.paid_as, r.paid_at
         from refunds r
        where ($1::uuid is null or r.branch_id = $1::uuid)
          and (coalesce(r.paid_at, r.requested_at) at time zone 'Asia/Jakarta')::date between $2::date and $3::date
        order by coalesce(r.paid_at, r.requested_at) desc, r.id desc
        limit 200`,
      [filters.branchId, filters.from, filters.to],
    )
  ).rows;
  const refunds: RefundRow[] = refundRows.map((r) => ({
    id: r.id,
    branchId: r.branch_id,
    branchName: branchNames.get(r.branch_id) ?? "Cabang",
    amount: -Math.abs(Number(r.amount)),
    destination: r.destination,
    state: r.state,
    paidMethod: r.paid_method,
    requestedAs: r.requested_as,
    requestedAt: r.requested_at.toISOString(),
    paidAs: r.paid_as,
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  }));

  // 5. Write-offs (RLS receivable_readable; column-granted fields only — no `reason`!; filter date BEFORE LIMIT 200).
  const woRows = (
    await db.query<{
      id: string;
      branch_id: string;
      amount: string;
      owner_self: boolean;
      created_at: Date;
    }>(
      `select w.id, w.branch_id, w.amount::bigint as amount, w.owner_self, w.created_at
         from write_offs w
        where ($1::uuid is null or w.branch_id = $1::uuid)
          and (w.created_at at time zone 'Asia/Jakarta')::date between $2::date and $3::date
        order by w.created_at desc, w.id desc
        limit 200`,
      [filters.branchId, filters.from, filters.to],
    )
  ).rows;
  const writeOffs: WriteOffRow[] = woRows.map((r) => ({
    id: r.id,
    branchId: r.branch_id,
    branchName: branchNames.get(r.branch_id) ?? "Cabang",
    amount: Number(r.amount),
    ownerSelf: r.owner_self,
    createdAt: r.created_at.toISOString(),
  }));

  // 6. Stock variance: stock_count_list requires a single branch; loop branches when consolidated!
  // Differences MUST come from stock_count_get (system_qty is not column-granted on raw table).
  const targetBranches = filters.branchId
    ? branches.filter((b) => b.id === filters.branchId)
    : branches;
  const stockVariances: StockVarianceRow[] = [];
  for (const b of targetBranches) {
    const counts = await listCounts(db, b.id);
    for (const c of counts) {
      if (c.state === "draft") continue;
      const at = c.submitted_at ?? c.started_at;
      if (!inRange(at, filters.from, filters.to)) continue;
      const detail = await getCount(db, c.id);
      for (const line of detail.lines) {
        if (line.difference === null || line.difference === 0) continue;
        stockVariances.push({
          countId: c.id,
          branchId: b.id,
          branchName: b.name,
          countedAt: at,
          itemName: line.name,
          unit: line.unit,
          batchNo: line.batch_no,
          systemQty: line.system_qty,
          countedQty: line.counted_qty,
          difference: line.difference,
        });
      }
    }
  }
  stockVariances.sort((a, b) => b.countedAt.localeCompare(a.countedAt));

  // 7. Cash variance: cash_shift_list + granted columns of cash_shift_counts.
  const shiftList = await listShifts(db, { branchId: filters.branchId });
  const escalatedByShift = new Map(shiftList.rows.map((s) => [s.id, Boolean(s.escalated)]));
  const countRows = (
    await db.query<{
      id: string;
      branch_id: string;
      shift_id: string;
      seq: number;
      counted_cash: string;
      expected_cash: string;
      threshold: string;
      counted_as: string;
      counted_at: Date;
    }>(
      `select c.id, c.branch_id, c.shift_id, c.seq,
              c.counted_cash::bigint as counted_cash,
              c.expected_cash::bigint as expected_cash,
              c.threshold::bigint as threshold,
              c.counted_as, c.counted_at
         from cash_shift_counts c
        where c.counted_cash <> c.expected_cash
          and ($1::uuid is null or c.branch_id = $1::uuid)
          and (c.counted_at at time zone 'Asia/Jakarta')::date between $2::date and $3::date
        order by c.counted_at desc, c.id desc
        limit 200`,
      [filters.branchId, filters.from, filters.to],
    )
  ).rows;
  const cashVariances: CashVarianceRow[] = countRows.map((r) => {
    const counted = Number(r.counted_cash);
    const expected = Number(r.expected_cash);
    const diff = counted - expected;
    const threshold = Number(r.threshold);
    return {
      id: r.id,
      shiftId: r.shift_id,
      branchId: r.branch_id,
      branchName: branchNames.get(r.branch_id) ?? "Cabang",
      seq: r.seq,
      expectedCash: expected,
      countedCash: counted,
      difference: diff,
      escalated: escalatedByShift.get(r.shift_id) ?? Math.abs(diff) > threshold,
      countedAs: r.counted_as,
      countedAt: r.counted_at.toISOString(),
    };
  });

  // 8. Uncapped SQL rupiah aggregates across the full selected scope (never truncated by LIMIT 200 detail lists).
  // Manual discounts impact includes ONLY applied manual discounts on issued invoices (`l.discount > 0`, never pending/rejected/void).
  // Refunds impact includes ONLY `paid` refunds (never pending/rejected/cancelled/failed requests).
  const manualDiscountTotalRow = await db.query<{ total: string }>(
    `select coalesce(sum(l.discount), 0)::bigint as total
       from invoice_lines l
       join invoices i on i.id = l.invoice_id
      where i.state = 'issued'
        and i.issued_at is not null
        and l.discount_kind = 'manual'
        and l.discount > 0
        and ($1::uuid is null or i.branch_id = $1::uuid)
        and (i.issued_at at time zone 'Asia/Jakarta')::date between $2::date and $3::date`,
    [filters.branchId, filters.from, filters.to],
  );
  const voidTotalRow = await db.query<{ total: string }>(
    `select coalesce(sum(l.line_total), 0)::bigint as total
       from invoices i
       join invoice_lines l on l.invoice_id = i.id
      where i.state = 'void'
        and i.voided_at is not null
        and ($1::uuid is null or i.branch_id = $1::uuid)
        and (i.voided_at at time zone 'Asia/Jakarta')::date between $2::date and $3::date`,
    [filters.branchId, filters.from, filters.to],
  );
  const paidRefundTotalRow = await db.query<{ total: string }>(
    `select coalesce(sum(-abs(r.amount)), 0)::bigint as total
       from refunds r
      where r.state = 'paid'
        and ($1::uuid is null or r.branch_id = $1::uuid)
        and (coalesce(r.paid_at, r.requested_at) at time zone 'Asia/Jakarta')::date between $2::date and $3::date`,
    [filters.branchId, filters.from, filters.to],
  );
  const writeOffTotalRow = await db.query<{ total: string }>(
    `select coalesce(sum(w.amount), 0)::bigint as total
       from write_offs w
      where ($1::uuid is null or w.branch_id = $1::uuid)
        and (w.created_at at time zone 'Asia/Jakarta')::date between $2::date and $3::date`,
    [filters.branchId, filters.from, filters.to],
  );
  const cashVarTotalRow = await db.query<{ total: string }>(
    `select coalesce(sum(c.counted_cash - c.expected_cash), 0)::bigint as total
       from cash_shift_counts c
      where c.counted_cash <> c.expected_cash
        and ($1::uuid is null or c.branch_id = $1::uuid)
        and (c.counted_at at time zone 'Asia/Jakarta')::date between $2::date and $3::date`,
    [filters.branchId, filters.from, filters.to],
  );

  const totals: AuditSummaryTotals = {
    manualDiscountTotal: Number(manualDiscountTotalRow.rows[0]?.total ?? 0),
    voidTotal: Number(voidTotalRow.rows[0]?.total ?? 0),
    paidRefundTotal: Number(paidRefundTotalRow.rows[0]?.total ?? 0),
    writeOffTotal: Number(writeOffTotalRow.rows[0]?.total ?? 0),
    cashVarianceTotal: Number(cashVarTotalRow.rows[0]?.total ?? 0),
  };

  return {
    from: filters.from,
    to: filters.to,
    branchId: filters.branchId,
    isCurrentMonth,
    branches,
    monthCounts,
    manualDiscounts,
    voids,
    refunds,
    writeOffs,
    stockVariances,
    cashVariances,
    totals,
  };
}
