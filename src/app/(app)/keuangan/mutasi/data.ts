// Mutasi Pembayaran core reader (UX-22 ▸ Mutasi, 19 §2.11, PR-33f).
// Uses dashboard_kpi('k1', from, to, branch, detail=true) as single source of truth so
// Σ rows === total and Σ rows per dim === by_dim by construction, matching Ringkasan Keuangan K1.
// No `server-only` so DB unit tests and DEL-2 isolation cases run the exact same reader.
import type pg from "pg";
import { isCalendarDate } from "../../../../modules/accounting/subledgers/subledgers";
import { kpi, type KpiResult } from "../../../../modules/reporting/dashboards/dashboards";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MutasiFilters = {
  from: string;
  to: string;
  branchId: string | null;
};

export type MutasiFilterResult =
  | { ok: true; filters: MutasiFilters }
  | { ok: false; reason: "bad-branch" | "bad-date" };

export type MutasiMethodRow = {
  dim: string;
  amount: number;
};

export type MutasiBranchRow = {
  branchId: string;
  branchName: string;
  amount: number;
};

export type MutasiDetailRow = {
  day: string;
  branchId: string;
  branchName: string;
  dim: string;
  amount: number;
  sourceKind: string;
  sourceRef: string;
};

export type MutasiData = {
  from: string;
  to: string;
  branchId: string | null;
  total: number;
  byMethod: MutasiMethodRow[];
  byBranch: MutasiBranchRow[];
  rows: MutasiDetailRow[];
  branches: { id: string; name: string }[];
  raw: KpiResult;
};

export const todayJakarta = (now: Date = new Date()) =>
  now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export function parseMutasiFilters(
  sp: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): MutasiFilterResult {
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
  return {
    ok: true,
    filters: { from, to, branchId: rawBranch || null },
  };
}

export async function loadMutasiIn(db: pg.ClientBase, filters: MutasiFilters): Promise<MutasiData> {
  const branches = (
    await db.query<{ id: string; name: string }>(
      `select id, name from branches order by created_at asc, id asc`,
    )
  ).rows;
  const branchNames = new Map(branches.map((b) => [b.id, b.name]));

  const res = await kpi(db, {
    kpi: "k1",
    from: filters.from,
    to: filters.to,
    branchId: filters.branchId,
    detail: true,
  });

  const byMethod: MutasiMethodRow[] = Object.entries(res.by_dim ?? {})
    .filter(([, amount]) => amount !== 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dim, amount]) => ({ dim, amount }));

  const byBranch: MutasiBranchRow[] = Object.entries(res.by_branch ?? {})
    .map(([branchId, dims]) => ({
      branchId,
      branchName: branchNames.get(branchId) ?? "Cabang",
      amount: Object.values(dims).reduce((sum, v) => sum + v, 0),
    }))
    .filter((b) => b.amount !== 0)
    .sort((a, b) => a.branchName.localeCompare(b.branchName));

  const rows: MutasiDetailRow[] = (res.rows ?? [])
    .map((r) => ({
      day: r.day,
      branchId: r.branch_id ?? "",
      branchName: r.branch_id ? (branchNames.get(r.branch_id) ?? "Cabang") : "—",
      dim: r.dim,
      amount: r.amount,
      sourceKind: r.source_kind,
      sourceRef: r.source_id.slice(0, 8).toUpperCase(),
    }))
    .sort((a, b) => (a.day === b.day ? a.sourceRef.localeCompare(b.sourceRef) : b.day.localeCompare(a.day)));

  return {
    from: filters.from,
    to: filters.to,
    branchId: filters.branchId,
    total: res.total ?? 0,
    byMethod,
    byBranch,
    rows,
    branches,
    raw: res,
  };
}
