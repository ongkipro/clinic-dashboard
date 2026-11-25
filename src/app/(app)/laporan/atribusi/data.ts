// Atribusi & Sumber Rujukan core reader (19 §2.10, UX-38 report, K13).
// Uses dashboard_kpi('k13', from, to, branch) — zero migration, zero patient identity.
import type pg from "pg";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate } from "../../../../modules/accounting/subledgers/subledgers";
import { kpi, type KpiResult } from "../../../../modules/reporting/dashboards/dashboards";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AtribusiFilters = { from: string; to: string; branchId: string | null };
export type AtribusiFilterResult =
  | { ok: true; filters: AtribusiFilters }
  | { ok: false; reason: "bad-branch" | "bad-date" };

export type FunnelCounts = { lead: number; booked: number; arrived: number; paid: number };
export type NamedFunnel = FunnelCounts & { key: string; label: string };

export type AtribusiData = {
  from: string;
  to: string;
  branchId: string | null;
  branches: { id: string; name: string }[];
  totals: FunnelCounts;
  bySource: NamedFunnel[];
  byBranch: NamedFunnel[];
  byAssignee: NamedFunnel[];
  raw: KpiResult;
};

export const todayJakarta = (now: Date = new Date()) =>
  now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export function parseAtribusiFilters(
  sp: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): AtribusiFilterResult {
  if (Array.isArray(sp.cabang)) return { ok: false, reason: "bad-branch" };
  if (Array.isArray(sp.dari) || Array.isArray(sp.sampai)) return { ok: false, reason: "bad-date" };
  const rawFrom = typeof sp.dari === "string" ? sp.dari.trim() : "";
  const rawTo = typeof sp.sampai === "string" ? sp.sampai.trim() : "";
  const rawBranch = typeof sp.cabang === "string" ? sp.cabang.trim() : "";

  if (rawBranch !== "" && !UUID.test(rawBranch)) return { ok: false, reason: "bad-branch" };
  if (rawFrom !== "" && !isCalendarDate(rawFrom)) return { ok: false, reason: "bad-date" };
  if (rawTo !== "" && !isCalendarDate(rawTo)) return { ok: false, reason: "bad-date" };

  const today = todayJakarta(now);
  const from = rawFrom || `${today.slice(0, 8)}01`;
  const to = rawTo || today;
  if (from > today || to > today || to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) {
    return { ok: false, reason: "bad-date" };
  }
  return { ok: true, filters: { from, to, branchId: rawBranch || null } };
}

const countsOf = (m: Record<string, number> | undefined): FunnelCounts => ({
  lead: Number(m?.lead ?? 0),
  booked: Number(m?.booked ?? 0),
  arrived: Number(m?.arrived ?? 0),
  paid: Number(m?.paid ?? 0),
});

export async function loadAtribusiIn(
  db: pg.ClientBase,
  filters: AtribusiFilters,
): Promise<AtribusiData> {
  const branches = (
    await db.query<{ id: string; name: string }>(
      `select id, name from branches order by created_at asc, id asc`,
    )
  ).rows;
  const branchNames = new Map(branches.map((b) => [b.id, b.name]));
  if (filters.branchId && !branchNames.has(filters.branchId)) {
    throw new CommandError("ERR_NOT_FOUND");
  }

  const res = await kpi(db, {
    kpi: "k13",
    from: filters.from,
    to: filters.to,
    branchId: filters.branchId,
    detail: false,
  });

  const totals = countsOf(res.by_dim);
  const bySource: NamedFunnel[] = Object.entries(res.by_grp1 ?? {})
    .map(([key, c]) => ({ key, label: key === "-" ? "Tanpa sumber" : key, ...countsOf(c) }))
    .sort((a, b) => b.lead - a.lead || a.label.localeCompare(b.label));
  const byBranch: NamedFunnel[] = Object.entries(res.by_branch ?? {})
    .map(([key, c]) => ({ key, label: branchNames.get(key) ?? "Cabang", ...countsOf(c) }))
    .sort((a, b) => b.lead - a.lead || a.label.localeCompare(b.label));
  const byAssignee: NamedFunnel[] = Object.entries(res.by_grp2 ?? {})
    .map(([key, c]) => ({
      key,
      label: key === "-" ? "Belum ditugaskan" : `Petugas ${key.slice(0, 8).toUpperCase()}`,
      ...countsOf(c),
    }))
    .sort((a, b) => b.lead - a.lead || a.label.localeCompare(b.label));

  return {
    from: filters.from,
    to: filters.to,
    branchId: filters.branchId,
    branches,
    totals,
    bySource,
    byBranch,
    byAssignee,
    raw: res,
  };
}
