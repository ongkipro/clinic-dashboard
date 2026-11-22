// Laporan › Kamus KPI (UX-59, PR-95, 19 §2.13): K1–K27 with definition, branch attribution, source records, version, draft / estimate
// markers, the setting that versions a definition, and the reports that use each KPI. Read only; every dashboard role (nav row
// "kamus-kpi"). Each entry has the anchor `#k<n>` the report definition links open (Scenario PR-95). Server component; no page.tsx
// yet (T-116 wiring adds it with its isolation-surface entry). Filter by report via `?laporan=<id>`; `#k21` jumps to churn.
import Link from "next/link";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { anchor, DICTIONARY, DICTIONARY_ROUTE, type KpiEntry, REPORTS, type ReportId, reportsOf } from "../../../../modules/reporting/reports/dictionary";

export type KamusState = { kind: "loading" } | { kind: "permission" } | { kind: "ok"; report?: ReportId };
export const parseReport = (v: unknown): ReportId | undefined => (typeof v === "string" && Object.hasOwn(REPORTS, v) ? (v as ReportId) : undefined);
export const MARKER_LABEL = { draf: "Draf definisi", estimasi: "Estimasi" } as const;

function Entry({ k }: { k: KpiEntry }) {
  const used = reportsOf(k.id);
  return (
    <article id={anchor(k.id)} aria-labelledby={`${anchor(k.id)}-h`} data-kpi={k.id} className="@container grid min-w-0 gap-2 scroll-mt-24 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${anchor(k.id)}-h`} className="m-0 text-[1.18rem] font-semibold [overflow-wrap:anywhere]">
          <span className="tabular text-[var(--label-2)]">{k.id}</span> {k.label}
        </h2>
        <span className="text-[0.82rem] text-[var(--label-2)]">Versi {k.version}</span>
      </header>
      {k.markers.length > 0 && (
        <ul aria-label={`Catatan ${k.id}`} className="m-0 grid list-none gap-1 p-0">
          {k.markers.map((m) => (
            <li key={m.kind + m.note} className="grid justify-items-start gap-1">
              <StatusBadge tone={m.kind === "draf" ? "warning" : "neutral"}>{MARKER_LABEL[m.kind]}</StatusBadge>
              <span className="text-[0.88rem] text-[var(--label-2)]">{m.note}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="m-0 grid min-w-0 gap-x-4 gap-y-1 @min-[30em]:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-[0.88rem] text-[var(--label-2)]">Rumus</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{k.definition}</dd>
        <dt className="text-[0.88rem] text-[var(--label-2)]">Atribusi cabang</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{k.attribution}</dd>
        <dt className="text-[0.88rem] text-[var(--label-2)]">Sumber data</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{k.sources}</dd>
        {k.versionedBy && (
          <>
            <dt className="text-[0.88rem] text-[var(--label-2)]">Mengikuti pengaturan</dt>
            <dd className="m-0">{k.versionedBy}: perubahan pengaturan membuat versi definisi baru; grafik tren ditandai &quot;definisi berubah&quot;.</dd>
          </>
        )}
        {used.length > 0 && (
          <>
            <dt className="text-[0.88rem] text-[var(--label-2)]">Dipakai di</dt>
            <dd className="m-0 flex flex-wrap gap-x-3">
              {used.map((r) => (
                <Link key={r} href={REPORTS[r].href} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">{REPORTS[r].title}</Link>
              ))}
            </dd>
          </>
        )}
      </dl>
    </article>
  );
}

export function KamusKpiView({ state }: { state: KamusState }) {
  const root = "mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4";
  if (state.kind === "loading") return <main className={root}><PageTitle title="Kamus KPI" /><LoadingList rows={6} label="Memuat Kamus KPI" /></main>;
  if (state.kind === "permission") return <main className={root}><PageTitle title="Kamus KPI" /><PermissionState object="Kamus KPI" /></main>;
  const shown = state.report ? DICTIONARY.filter((k) => REPORTS[state.report!].kpis.includes(k.id)) : DICTIONARY;
  return (
    <main className={root}>
      <PageTitle title="Kamus KPI" />
      <p className="m-0 text-[var(--label-2)]">Definisi setiap angka di Ringkasan dan Laporan. Uang dalam rupiah bulat; periode mengikuti hari lokal tiap cabang; angka gabungan = jumlah hari cabang.</p>
      <div role="group" aria-label="Filter laporan" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
        {[undefined, ...(Object.keys(REPORTS) as ReportId[])].map((r) => (
          <Link key={r ?? "semua"} href={r ? `${DICTIONARY_ROUTE}?laporan=${r}` : DICTIONARY_ROUTE} aria-current={state.report === r ? "true" : undefined}
            className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline ${state.report === r ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "bg-transparent"}`}>
            {r ? REPORTS[r].title.replace(/^Laporan /, "") : "Semua"}
          </Link>
        ))}
      </div>
      {/* One column; two when the page's own text column holds them (a container query: 200 % text at 1180 px must not squeeze two columns, WCAG 1.4.10). */}
      <div className="@container grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-3 @min-[48em]:grid-cols-2">
          {shown.map((k) => <Entry key={k.id} k={k} />)}
        </div>
      </div>
    </main>
  );
}
