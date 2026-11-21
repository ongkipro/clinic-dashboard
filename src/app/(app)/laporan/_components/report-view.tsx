// Laporan report frame (UX-38, PR-95, 19 §2.13): filter bar (periode, cabang) → KPI header (each value with its basis and a link to its
// Kamus KPI definition) → table (cards on compact, table from 700 px) → Unduh (role-gated: omitted when the role may not export) and
// "Terakhir dibuat". Exactly one state at a time: loading / permission / blocked / error / empty / filtered-empty / ok. A metric the
// reader cannot give renders "Belum tersedia" / "Belum ada data", never 0 or Rp0. Server component; rows hold codes, counts, money and
// staff or item names only — never patient names or clinical text (pseudonymous patient keys only where a report ranks patients).
import { cn } from "cn";
import { BookOpen, Download } from "lucide-react";
import Link from "next/link";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { BY_ID, definitionHref, type KpiId } from "../../../../modules/reporting/reports/dictionary";
import { type Metric, show } from "../../../../modules/reporting/reports/metrics";

export type Chip = { label: string; href: string; active?: boolean };
export type ReportKpi = { id: KpiId; label?: string; metric: Metric; basis: string };
export type Cell = string | Metric;
export type ReportTableData = { caption: string; columns: { id: string; label: string; numeric?: boolean }[]; rows: Record<string, Cell>[] };
export type ReportProps = {
  title: string;
  period: { label: string; chips: Chip[] };
  branches?: Chip[]; // tenant-wide roles; a branch role sees its branch only
  generatedAt?: string; // ISO; "Terakhir dibuat"
  exportHref?: string; // role-gated by the page
  kpis: ReportKpi[];
  table?: ReportTableData;
  clearHref: string;
};
export type ReportState =
  | { kind: "loading" }
  | { kind: "permission"; object: string }
  | { kind: "blocked"; reason: string; unblock: string }
  | { kind: "error"; retryHref: string }
  | { kind: "empty" }
  | { kind: "filtered-empty" }
  | { kind: "ok" };

const at = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const cell = (c: Cell) => (typeof c === "string" ? c : show(c));
const off = (c: Cell) => typeof c !== "string" && c.kind === "unavailable";
const linkCls = "inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]";

function Chips({ label, items }: { label: string; items: Chip[] }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
      {items.map((c) => (
        <Link key={c.href} href={c.href} aria-current={c.active ? "true" : undefined}
          className={cn("inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline", c.active ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "bg-transparent")}>
          {c.label}
        </Link>
      ))}
    </div>
  );
}

// KPI header: value, basis, and "Definisi" → Kamus KPI anchor (Scenario PR-95: the definition of churn opens its dictionary entry).
export function KpiHeader({ items }: { items: ReportKpi[] }) {
  return (
    <ul aria-label="Angka utama" className="m-0 grid min-w-0 list-none grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 p-0">
      {items.map((k) => {
        const name = k.label ?? BY_ID.get(k.id)!.label;
        const u = k.metric.kind === "unavailable";
        return (
          <li key={k.id + name} data-kpi={k.id} data-state={u ? "unavailable" : "value"} className="grid min-w-0 content-start gap-1 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{name}</span>
            <span className={cn("[overflow-wrap:anywhere]", u ? "text-[1rem] font-semibold text-[var(--label-2)]" : "tabular text-[1.65rem] font-bold leading-tight")}>{show(k.metric)}</span>
            <span className="text-[0.82rem] text-[var(--label-2)]">{k.basis}</span>
            <Link href={definitionHref(k.id)} className="inline-flex min-h-[var(--target)] items-center gap-1 text-[0.88rem] font-semibold text-[var(--tint)]" aria-label={`Definisi ${name} (${k.id})`}>
              <BookOpen aria-hidden="true" className="size-4" /> Definisi {k.id}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Table({ t }: { t: ReportTableData }) {
  const [first, ...rest] = t.columns;
  return (
    <section aria-label={t.caption} className="grid min-w-0 gap-3">
      <div tabIndex={0} role="region" aria-label={t.caption} className="hidden min-w-0 overflow-x-auto rounded-[var(--radius-group)] bg-[var(--surface)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-[var(--tint)] min-[700px]:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr>{t.columns.map((c) => <th key={c.id} scope="col" className={cn("border-b border-[var(--separator)] px-4 py-3 text-[0.88rem] font-semibold text-[var(--label-2)]", c.numeric && "text-right")}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]">
                <th scope="row" className="px-4 py-3 text-left font-semibold [overflow-wrap:anywhere]">{cell(r[first.id])}</th>
                {rest.map((c) => (
                  <td key={c.id} data-state={off(r[c.id]) ? "unavailable" : undefined} className={cn("px-4 py-3", c.numeric && "tabular text-right", off(r[c.id]) && "text-[var(--label-2)]")}>{cell(r[c.id])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={t.caption} className="m-0 grid list-none gap-3 p-0 min-[700px]:hidden">
        {t.rows.map((r, i) => (
          <li key={i} className="grid gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <p className="m-0 font-semibold [overflow-wrap:anywhere]">{cell(r[first.id])}</p>
            <dl className="m-0 grid gap-y-1">
              {rest.map((c) => (
                <div key={c.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="min-w-0 text-[0.88rem] text-[var(--label-2)]">{c.label}</dt>
                  <dd className={cn("m-0 min-w-0 text-right [overflow-wrap:anywhere]", c.numeric && "tabular", off(r[c.id]) && "text-[var(--label-2)]")}>{cell(r[c.id])}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReportView({ props: p, state }: { props: ReportProps; state: ReportState }) {
  const root = "mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4";
  // No access: the title and the message only; no filter, export or data (NAV-1).
  if (state.kind === "permission") return <main className={root}><PageTitle title={p.title} /><PermissionState object={state.object} /></main>;
  return (
    <main className={root}>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <PageTitle title={p.title} />
        {state.kind === "ok" && p.exportHref && (
          <Link href={p.exportHref} className="inline-flex min-h-[var(--target)] items-center gap-2 rounded-full bg-[var(--surface)] px-4 text-[var(--tint)] no-underline">
            <Download aria-hidden="true" className="size-[1.1rem]" /> Unduh
          </Link>
        )}
      </div>
      <p className="m-0 text-[var(--label-2)]">
        Periode {p.period.label}
        {p.generatedAt && <> · Terakhir dibuat <time dateTime={p.generatedAt}>{at.format(new Date(p.generatedAt))}</time></>}
      </p>
      <Chips label="Periode" items={p.period.chips} />
      {p.branches && p.branches.length > 0 && <Chips label="Cabang" items={p.branches} />}
      {state.kind === "loading" && <LoadingList rows={4} label={`Memuat ${p.title}`} />}
      {state.kind === "blocked" && <BlockedState reason={state.reason} unblock={state.unblock} />}
      {state.kind === "error" && (
        <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--danger)]">Laporan belum bisa dimuat.</p>
          <Link href={state.retryHref} className={linkCls}>Coba Lagi</Link>
        </div>
      )}
      {state.kind === "empty" && (
        <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">Belum ada data untuk periode ini.</p>
      )}
      {state.kind === "filtered-empty" && (
        <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--label-2)]">Tidak ada data untuk filter ini.</p>
          <Link href={p.clearHref} className={linkCls}>Hapus Filter</Link>
        </div>
      )}
      {state.kind === "ok" && (
        <>
          <KpiHeader items={p.kpis} />
          {p.table && <Table t={p.table} />}
        </>
      )}
    </main>
  );
}

// State from the read result: an all-unavailable report is not "empty" (unknown is not nothing); empty means a successful read with
// no rows and every KPI a real zero or "no data".
export function reportState(i: { allowed: boolean; ok: boolean; filtered: boolean; kpis: ReportKpi[]; rows: number; retryHref: string; object: string }): ReportState {
  if (!i.allowed) return { kind: "permission", object: i.object };
  if (!i.ok) return { kind: "error", retryHref: i.retryHref };
  const nothing = i.rows === 0 && i.kpis.every((k) => (k.metric.kind === "unavailable" && k.metric.reason === "no_data")
    || (k.metric.kind === "count" && k.metric.value === 0) || (k.metric.kind === "money" && k.metric.rupiah === 0));
  if (nothing) return { kind: i.filtered ? "filtered-empty" : "empty" };
  return { kind: "ok" };
}
