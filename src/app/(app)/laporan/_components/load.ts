// Laporan (UX-38, PR-95; T-116): the page-data core shared by /laporan/{penjualan,perawatan,pasien,staf,operasional,stok,marketing}.
// It reads the period through loadReport (the integrated readers decide role, tenant and branch scope per KPI) and composes the props and
// state of the presentational ReportView. No `server-only`: data.ts gates the role first; this core is what the isolation cases run.
// Who may open a report is the nav's role list for its page (NAV-1, 19 §2); inside it, a KPI the role may not read is "Tidak tersedia untuk
// peran ini" (07 Dashboards), and a report where nothing is readable is the permission state. Periods are local days, ≤ 366 days.
import type pg from "pg";
import type { Role } from "../../../../auth/policy";
import { NAV } from "../../../../components/shell/nav";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate } from "../../../../modules/accounting/ledger/ledger";
import { REPORTS, type ReportId } from "../../../../modules/reporting/reports/dictionary";
import { loadReport } from "../../../../modules/reporting/reports/live";
import type { Chip, ReportProps, ReportState, ReportTableData } from "./report-view";
import { reportState } from "./report-view";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REPORT_IDS = Object.keys(REPORTS) as ReportId[];
// The page roles come from the nav row of the report's href (one source; no new authority).
export function readersOf(report: ReportId): readonly Role[] {
  const page = NAV.flatMap((g) => g.pages).find((p) => p.href === REPORTS[report].href);
  return page?.roles ?? [];
}
export const TENANT_WIDE: readonly Role[] = ["owner", "admin_pusat", "finance", "auditor", "marketing", "central_cs", "purchasing"];

export type Query = { periode?: string; dari?: string; sampai?: string; cabang?: string };
export type Filters = { from: string; to: string; branch: string | null; preset: "bulan-ini" | "bulan-lalu" | "rentang" };
export type Page = { kind: "not-found" } | { kind: "ok"; props: ReportProps; state: ReportState };

const today = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const prevMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
// ?periode=bulan-lalu → last calendar month; ?dari/?sampai (calendar days, ordered, ≤ 366 days) → that range; else this month to today.
// A malformed ?cabang is ignored (all the role may see); a well-formed one is asked of the readers, which answer not-found when it is not
// the caller's.
export function filters(q: Query, now: Date = new Date()): Filters {
  const t = today(now), ym = t.slice(0, 7);
  const branch = q.cabang && UUID.test(q.cabang) ? q.cabang : null;
  if (q.periode === "bulan-lalu") { const p = prevMonth(ym); return { from: `${p}-01`, to: lastDay(p), branch, preset: "bulan-lalu" }; }
  if (q.dari && q.sampai && isCalendarDate(q.dari) && isCalendarDate(q.sampai) && q.sampai >= q.dari && (Date.parse(q.sampai) - Date.parse(q.dari)) / 86_400_000 <= 366) {
    return { from: q.dari, to: q.sampai, branch, preset: "rentang" };
  }
  return { from: `${ym}-01`, to: t, branch, preset: "bulan-ini" };
}
const fmt = (iso: string) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
export const periodLabel = (f: Pick<Filters, "from" | "to">) => (f.from === f.to ? fmt(f.from) : `${fmt(f.from)} – ${fmt(f.to)}`);
const href = (path: string, p: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  return s.size ? `${path}?${s}` : path;
};

export async function reportIn(db: pg.ClientBase, report: ReportId, role: Role, q: Query, now: Date = new Date()): Promise<Page> {
  const path = REPORTS[report].href;
  const f = filters(q, now);
  const keep = f.preset === "rentang" ? { dari: f.from, sampai: f.to } : f.preset === "bulan-lalu" ? { periode: "bulan-lalu" } : {};
  const chips: Chip[] = [
    { label: "Bulan ini", href: href(path, { cabang: f.branch }), active: f.preset === "bulan-ini" },
    { label: "Bulan lalu", href: href(path, { periode: "bulan-lalu", cabang: f.branch }), active: f.preset === "bulan-lalu" },
  ];
  // branch-independent props first, so a failure of ANY read below (the branch lookup included — R3 7ea04efd) still has an error page
  const base: ReportProps = { title: REPORTS[report].title, period: { label: periodLabel(f), chips }, kpis: [], clearHref: path };
  const retryHref = href(path, { ...keep, cabang: f.branch });
  await db.query("savepoint report_page");
  try {
    const all = (await db.query<{ id: string; name: string }>(`select id, name from branches order by created_at, id`)).rows;
    // branch chips for tenant-wide roles; a branch role sees its own branch only (the readers bind it)
    base.branches = TENANT_WIDE.includes(role)
      ? [{ label: "Semua Cabang", href: href(path, keep), active: f.branch === null }, ...all.map((b) => ({ label: b.name, href: href(path, { ...keep, cabang: b.id }), active: f.branch === b.id }))]
      : undefined;
    const r = await loadReport(db, report, { from: f.from, to: f.to, branchId: f.branch });
    await db.query("release savepoint report_page");
    const table: ReportTableData | undefined = r.tables[0] ? { caption: r.tables[0].caption, columns: r.tables[0].columns, rows: r.tables[0].rows } : undefined;
    const props: ReportProps = { ...base, kpis: r.kpis, table, generatedAt: now.toISOString() };
    const state = reportState({ allowed: !r.allForbidden, ok: true, filtered: f.branch !== null, kpis: r.kpis, rows: r.tables.reduce((s, t) => s + t.rows.length, 0),
      retryHref, object: REPORTS[report].title.toLowerCase() });
    return { kind: "ok", props, state };
  } catch (e) {
    await db.query("rollback to savepoint report_page");
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" }; // another tenant's / another branch (TEN-1)
    // a reader or decoder fault: the error state, never an empty or zero report; logged by name only
    console.error("laporan: reader failed", { report, error: e instanceof Error ? e.name : "unknown" });
    return { kind: "ok", props: base, state: { kind: "error", retryHref } };
  }
}
