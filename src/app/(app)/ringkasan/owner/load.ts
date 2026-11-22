// Ringkasan Owner (UX-20) and Cabang league / detail (UX-37), PR-33a (T-109): the loaders' core. They take an OPEN tenant-bound connection, the acting role and the
// branches the context lists, and fetch ONLY through existing readers — the T-107 `dashboard_kpi` and the authorized readers behind "Perlu ditangani" — then hand the
// answers to the pure composition (compose.ts). No `server-only`, no request context: data.ts is the thin wrapper that gates the role and opens the connection, and the
// isolation case (tests/isolation/cases/ringkasan-owner.cases.ts) runs this SAME core as another tenant's owner. Nothing here computes a figure or invents a value or link.
//   - One reader call = one SAVEPOINT (guard.ts): a refused or failing reader makes that figure `unavailable`, never the whole screen, never a 0.
//   - A branch that is not one the context lists is not-found BEFORE any reader runs (TEN-1: another tenant's branch id is never forbidden and never data).
import type pg from "pg";
import type { Role } from "../../../../auth/policy";
import { type Kpi, kpi, type KpiResult } from "../../../../modules/reporting/dashboards/dashboards";
import { loadAttention } from "./attention";
import { branchHref, hrefsFor, type LeagueInputs, leagueRow, ownerSummary, summaryLeagueRow } from "./compose";
import { guarded } from "./guard";
import type { Attention, LeagueRow, OwnerSummaryData } from "./model";
import { type Periods, periods, WEEKS, wibToday } from "./period";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Branch = { id: string; name: string };
type Win = { from: string; to: string };

// KPI reader calls per screen (asserted by the tests; measured on the real loader — System Map delta). Summary: K1/K2/K3 now and previous (6) + K4/K5/K6/K13/K17/K18
// (6) + the K1/K2 trend (2 per week); the attention readers are separate (approvals, leads, SATUSEHAT per branch, compliance). League page: the 10 league KPIs, once
// for the whole clinic. A branch detail reads the summary's KPIs once for the whole clinic and picks the branch from `by_branch` — except K13, whose source groups exist only in the
// reader's own branch-scoped answer: there it asks the reader for that branch (same count of calls, one replaces the other).
export const READS = { summary: 6 + 6 + 2 * WEEKS, league: 10 } as const;

const read = (db: pg.ClientBase, o: { kpi: Kpi; from: string; to: string; branchId?: string }): Promise<KpiResult | null> => guarded(db, o.kpi, () => kpi(db, o));
const kind = (periode: string | undefined) => (periode === "bulan" ? "bulan" : "minggu");

export type SummaryOk = { kind: "ok"; data: OwnerSummaryData; periods: Periods; league: LeagueRow[]; scope: { label: string; filtered: boolean }; branch: Branch | null };
export type NotFound = { kind: "not-found" };

// UX-20: consolidated, or one branch (?cabang=). The branch must be one the context lists.
export async function summaryIn(db: pg.ClientBase, role: Role, branches: Branch[], q: { periode?: string; cabang?: string }, now = new Date()): Promise<SummaryOk | NotFound> {
  const wanted = q.cabang === undefined || q.cabang === "" ? null : UUID.test(q.cabang) ? (branches.find((b) => b.id === q.cabang) ?? "missing") : "missing";
  if (wanted === "missing") return { kind: "not-found" };
  const p = periods(kind(q.periode), wibToday(now));
  const r = (k: Kpi, w: Win) => read(db, { kpi: k, ...w });
  const [k1, k1Prev, k2, k2Prev, k3, k3Prev] = [await r("k1", p.cur), await r("k1", p.prev), await r("k2", p.cur), await r("k2", p.prev), await r("k3", p.cur), await r("k3", p.prev)];
  // K13 is read for the SCOPE on screen: the whole clinic, or — for a branch — the reader's OWN branch selector (`p_branch`), which `wanted` has already been validated against
  // (a branch the context lists; anything else was not-found above, before any reader ran). A branch's source groups are never the clinic's groups cut for one branch: the reader
  // filters by branch before it groups, so `by_grp1` of this answer is that branch's. Still one call (it replaces the clinic-wide K13 on a branch page).
  const k13Scope = wanted ? { branchId: wanted.id } : {};
  const [k4, k5, k6, k13, k17, k18] = [await r("k4", p.cur), await r("k5", p.cur), await r("k6", p.cur), await read(db, { kpi: "k13", ...p.cur, ...k13Scope }), await r("k17", p.cur), await r("k18", p.cur)];
  const weeks: { k1: KpiResult | null; k2: KpiResult | null }[] = [];
  for (const w of p.weeks) weeks.push({ k1: await r("k1", w), k2: await r("k2", w) });
  // "Perlu ditangani" is the clinic-level queue: the consolidated summary only. A branch page shows that branch's cards (UX-37 "the same cards"); a tenant-wide count
  // there would be the wrong population, and an empty list would read as "nothing to handle".
  const attention: Attention[] = wanted === null ? await loadAttention(db, role, branches.map((b) => b.id), k18) : [];
  const league = wanted === null ? branches.map((b) => summaryLeagueRow(b, k1, k2, branchHref(b.id, p.kind))) : [];
  const data = ownerSummary({ periods: p, k1, k1Prev, k2, k2Prev, k3, k3Prev, k4, k5, k6, k17, k18, k13, weeks, hrefs: hrefsFor(wanted?.id ?? null, p.cur), attention, branchId: wanted?.id ?? null });
  return { kind: "ok", data, periods: p, league, branch: wanted, scope: wanted ? { label: wanted.name, filtered: true } : { label: "Semua Cabang", filtered: false } };
}

// UX-37 league: every branch of the clinic, from the CONSOLIDATED answers' `by_branch` (K17: unavailable for a branch while a payment is unallocated).
export async function leagueIn(db: pg.ClientBase, branches: Branch[], q: { periode?: string }, now = new Date()): Promise<{ kind: "ok"; rows: LeagueRow[]; periods: Periods }> {
  const p = periods(kind(q.periode), wibToday(now));
  const r = (k: Kpi, w: Win) => read(db, { kpi: k, ...w });
  const i: LeagueInputs = { k1: await r("k1", p.cur), k2: await r("k2", p.cur), k7: await r("k7", p.cur), k8: await r("k8", p.cur), k9: await r("k9", p.cur), k10: await r("k10", p.cur),
    k11: await r("k11", p.cur), k12: await r("k12", p.cur), k16: await r("k16", p.cur), k17: await r("k17", p.cur) };
  return { kind: "ok", periods: p, rows: branches.map((b) => leagueRow(b, i, branchHref(b.id, p.kind))) };
}

// UX-37 detail: the same cards as UX-20 for one branch. A branch id that is not one of the clinic's branches is not-found.
export async function detailIn(db: pg.ClientBase, role: Role, branches: Branch[], id: string, q: { periode?: string }, now = new Date()): Promise<{ kind: "ok"; data: OwnerSummaryData; periods: Periods; branch: Branch } | NotFound> {
  const s = await summaryIn(db, role, branches, { periode: q.periode, cabang: id }, now);
  return s.kind === "ok" && s.branch ? { kind: "ok", data: s.data, periods: s.periods, branch: s.branch } : { kind: "not-found" };
}
