// Page templates (NAV-4, NAV-5, NAV-7; 10 State Copy Patterns). Pages pass data and
// copy; the templates fix the shape. Server components, except where a slot is client.
// - ListPage (NAV-4): large title, one prominent action, search, filters and saved
//   views, sort, column chooser (regular width), bulk actions, export (role-gated), and
//   exactly one state at a time: loading / empty / filtered-empty / error / blocked /
//   permission / rows.
// - DetailPage (NAV-5): header (identity + status), sections or tabs, timeline, related
//   records, one primary action, audit trail link (role-gated).
// - ReportTable (NAV-7): KPI header first; a table at regular width, cards on compact.
import { cn } from "cn";
import { ChevronRight, Download, History, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { BlockedState, LoadingList, PermissionState } from "../ui/states";
import { StatusBadge, type StatusTone } from "../ui/status-badge";

export type ListState =
  | { kind: "loading" }
  | { kind: "empty"; message: string; action?: string; actionHref?: string }
  | { kind: "filtered-empty"; message: string; clearHref: string }
  | { kind: "error"; message: string; retryHref: string }
  | { kind: "blocked"; reason: string; unblock: string }
  | { kind: "permission"; object: string }
  | { kind: "rows" };

export type ListPageProps = {
  title: string;
  primaryAction?: { label: string; href: string };
  search?: { name: string; label: string; value?: string; action: string; keep?: Record<string, string> }; // keep: active filter/sort params
  filters?: { label: string; href: string; active?: boolean }[]; // saved views as segments
  sort?: { label: string; href: string; active?: boolean }[];
  columns?: { id: string; label: string; visible: boolean }[]; // column chooser (regular)
  columnsAction?: string; // GET target of the column chooser (defaults to this page)
  bulkActions?: { label: string; href: string }[]; // shown only while rows are selected
  selectedCount?: number;
  exportHref?: string; // role-gated by the page: omit when the role may not export
  state: ListState;
  children?: React.ReactNode; // rows, rendered only in the "rows" state
  as?: "main" | "section"; // a page owns one <main>; galleries nest templates as sections
};

export function PageTitle({ title, action }: { title: string; action?: { label: string; href: string } }) {
  return (
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
      <h1 className="m-0 min-w-0 text-[2rem] font-bold leading-tight [overflow-wrap:anywhere]">{title}</h1>
      {action && (
        <Link
          href={action.href}
          className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-5 font-semibold text-[var(--on-tint)] no-underline hover:bg-[var(--tint-pressed)]"
        >
          {action.label}
        </Link>
      )}
    </header>
  );
}

// Segmented choices (saved views, sort, bulk actions): a labelled group of links; the
// selected one is a white thumb on the grey track, so the tint fill stays reserved for
// the one prominent action.
function Chips({ label, items }: { label: string; items: { label: string; href: string; active?: boolean }[] }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
      {items.map((f) => (
        <Link
          key={f.label}
          href={f.href}
          aria-current={f.active ? "true" : undefined}
          className={cn(
            "inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline",
            f.active ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "bg-transparent",
          )}
        >
          {f.label}
        </Link>
      ))}
    </div>
  );
}

function StateView({ state }: { state: Exclude<ListState, { kind: "rows" }> }) {
  switch (state.kind) {
    case "loading":
      return <LoadingList />;
    case "empty":
      return (
        <div className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4" role="status">
          <p className="m-0 text-[var(--label-2)]">{state.message}</p>
          {state.action && state.actionHref && (
            <Link href={state.actionHref} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">
              {state.action}
            </Link>
          )}
        </div>
      );
    case "filtered-empty":
      return (
        <div className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4" role="status">
          <p className="m-0 text-[var(--label-2)]">{state.message}</p>
          <Link href={state.clearHref} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">
            Hapus Filter
          </Link>
        </div>
      );
    case "error":
      return (
        <div className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4" role="alert">
          <p className="m-0 text-[var(--danger)]">{state.message}</p>
          <Link href={state.retryHref} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">
            Coba Lagi
          </Link>
        </div>
      );
    case "blocked":
      return <BlockedState reason={state.reason} unblock={state.unblock} />;
    case "permission":
      return <PermissionState object={state.object} />;
  }
}

export function ListPage(p: ListPageProps) {
  const Root = p.as ?? "main";
  // No access: only the title and the message; no action, search, filter or export
  // is offered (NAV-1: pages and controls a role cannot use are absent).
  if (p.state.kind === "permission") {
    return (
      <Root className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <PageTitle title={p.title} />
        <StateView state={p.state} />
      </Root>
    );
  }
  return (
    <Root className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <PageTitle title={p.title} action={p.primaryAction} />
      {(p.search || p.exportHref || p.columns) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {p.search && (
            <form role="search" action={p.search.action} className="flex min-w-0 flex-[1_1_16rem]">
              {Object.entries(p.search.keep ?? {}).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <label className="flex min-h-[var(--target)] min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-field)] bg-[var(--surface-2)] px-3 text-[var(--label-2)] focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--tint)]">
                <Search aria-hidden="true" className="size-[1.1rem] shrink-0" />
                <input
                  type="search"
                  name={p.search.name}
                  defaultValue={p.search.value}
                  aria-label={p.search.label}
                  placeholder={p.search.label}
                  className="min-h-[var(--target)] min-w-0 flex-1 border-0 bg-transparent text-[var(--label)] outline-none"
                />
              </label>
            </form>
          )}
          {p.columns && (
            <details className="relative hidden min-[700px]:block">
              <summary className="inline-flex min-h-[var(--target)] cursor-pointer list-none items-center gap-2 rounded-full bg-[var(--surface)] px-4 text-[var(--tint)]">
                <SlidersHorizontal aria-hidden="true" className="size-[1.1rem]" />
                Kolom
              </summary>
              <form method="get" action={p.columnsAction ?? ""} className="absolute right-0 z-10 mt-2 grid min-w-56 gap-1 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-3">
                <fieldset className="m-0 grid gap-1 border-0 p-0">
                  <legend className="sr-only">Pilih kolom</legend>
                  {p.columns.map((c) => (
                    <label key={c.id} className="flex min-h-[var(--target)] items-center gap-2">
                      <input type="checkbox" name="kolom" value={c.id} defaultChecked={c.visible} className="size-5" />
                      {c.label}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-4 font-semibold text-[var(--label)]">
                  Terapkan
                </button>
              </form>
            </details>
          )}
          {p.exportHref && (
            <Link href={p.exportHref} className="inline-flex min-h-[var(--target)] items-center gap-2 rounded-full bg-[var(--surface)] px-4 text-[var(--tint)] no-underline">
              <Download aria-hidden="true" className="size-[1.1rem]" />
              Ekspor
            </Link>
          )}
        </div>
      )}
      {p.filters && p.filters.length > 0 && <Chips label="Tampilan tersimpan" items={p.filters} />}
      {p.sort && p.sort.length > 0 && <Chips label="Urutkan" items={p.sort} />}
      {p.state.kind === "rows" ? (
        <>
          {p.bulkActions && p.bulkActions.length > 0 && (p.selectedCount ?? 0) > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[0.94rem] text-[var(--label-2)]">{p.selectedCount} dipilih</span>
              <Chips label="Aksi untuk yang dipilih" items={p.bulkActions} />
            </div>
          )}
          {p.children}
        </>
      ) : (
        <StateView state={p.state} />
      )}
    </Root>
  );
}

// Inset grouped list with drill-in rows (10: InsetGroupedList / Cell).
export function RowList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul aria-label={label} className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
      {children}
    </ul>
  );
}

// A row is one link (title + subtitle); extra content such as a VisitTrack sits outside
// the link so the link's accessible name stays short.
export function Row({ href, title, subtitle, trailing, children }: { href: string; title: string; subtitle?: string; trailing?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="relative border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px] hover:bg-[var(--surface-2)]">
      <Link href={href} className="flex min-h-[var(--target)] min-w-0 items-center gap-3 px-4 pt-[11px] text-[var(--label)] no-underline after:absolute after:inset-0 after:content-['']">
        <div className="grid min-w-0 flex-1 gap-1">
          <span className="font-semibold [overflow-wrap:anywhere]">{title}</span>
          {subtitle && <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{subtitle}</span>}
        </div>
        {trailing}
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-[var(--label-3)]" />
      </Link>
      <div className={cn("min-w-0 px-4 pb-[11px] pr-12", children ? "pt-2" : "pt-0")}>{children}</div>
    </li>
  );
}

export type DetailPageProps = {
  title: string; // identity
  subtitle?: string;
  status?: { tone: StatusTone; label: string };
  primaryAction?: { label: string; href: string };
  sections: { id: string; label: string; content: React.ReactNode }[];
  timeline?: { at: string; label: string; detail?: string }[];
  related?: { label: string; href: string }[];
  auditHref?: string; // role-gated by the page
  children?: React.ReactNode; // e.g. a VisitTrack under the header
  as?: "main" | "section";
};

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

function safeDate(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : fmt.format(d);
}

export function DetailPage(p: DetailPageProps) {
  const Root = p.as ?? "main";
  const uid = useId();
  return (
    <Root className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <header className="grid min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <h1 className="m-0 text-[2rem] font-bold leading-tight [overflow-wrap:anywhere]">{p.title}</h1>
            {p.subtitle && <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">{p.subtitle}</p>}
          </div>
          {p.primaryAction && (
            <Link
              href={p.primaryAction.href}
              className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-5 font-semibold text-[var(--on-tint)] no-underline hover:bg-[var(--tint-pressed)]"
            >
              {p.primaryAction.label}
            </Link>
          )}
        </div>
        {p.status && <StatusBadge tone={p.status.tone} className="justify-self-start">{p.status.label}</StatusBadge>}
        {p.children}
      </header>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-5">
          {/* Sections as a list on compact, tab anchors on regular (NAV-7). */}
          {p.sections.length > 1 && (
            <nav aria-label="Bagian" className="hidden flex-wrap items-start gap-2 min-[700px]:flex">
              {p.sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-[var(--target)] items-center self-start rounded-full bg-[var(--surface)] px-4 text-[var(--tint)] no-underline">
                  {s.label}
                </a>
              ))}
            </nav>
          )}
          {p.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${uid}-${s.id}`} className="grid min-w-0 gap-2 scroll-mt-24">
              <h2 id={`${uid}-${s.id}`} className="m-0 text-[1.18rem] font-semibold">{s.label}</h2>
              <div className="min-w-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">{s.content}</div>
            </section>
          ))}
        </div>
        <aside className="grid min-w-0 content-start gap-5" aria-label="Riwayat dan data terkait">
          {p.timeline && (
            <section aria-labelledby={`${uid}-riwayat`} className="grid gap-2">
              <h2 id={`${uid}-riwayat`} className="m-0 flex items-center gap-2 text-[1.18rem] font-semibold">
                <History aria-hidden="true" className="size-5 text-[var(--tint)]" /> Riwayat
              </h2>
              {p.timeline.length === 0 ? (
                <p className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">Belum ada riwayat.</p>
              ) : (
                <ol className="m-0 grid list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
                  {p.timeline.map((t, i) => (
                    <li key={i} className="grid gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
                      <time dateTime={t.at} className="text-[0.82rem] text-[var(--label-2)]">{safeDate(t.at)}</time>
                      <span className="[overflow-wrap:anywhere]">{t.label}</span>
                      {t.detail && <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{t.detail}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
          {p.related && p.related.length > 0 && (
            <section aria-labelledby={`${uid}-terkait`} className="grid gap-2">
              <h2 id={`${uid}-terkait`} className="m-0 text-[1.18rem] font-semibold">Data terkait</h2>
              <RowList label="Data terkait">
                {p.related.map((r) => <Row key={`${r.href}|${r.label}`} href={r.href} title={r.label} />)}
              </RowList>
            </section>
          )}
          {p.auditHref && (
            <Link href={p.auditHref} className="inline-flex min-h-[var(--target)] items-center gap-2 font-semibold text-[var(--tint)]">
              <History aria-hidden="true" className="size-[1.1rem]" /> Lihat jejak audit
            </Link>
          )}
        </aside>
      </div>
    </Root>
  );
}

// Reports (NAV-7, 19 §2.13): KPI header first; table at ≥ 700 px, one card per row below.
export type Kpi = { label: string; value: string; delta?: { direction: "naik" | "turun" | "tetap"; text: string }; basis: string };
export type ReportColumn = { id: string; label: string; numeric?: boolean };

export function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <dl className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
      {items.map((k) => (
        <div key={k.label} className="grid min-w-0 gap-1 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <dt className="text-[0.88rem] text-[var(--label-2)]">{k.label}</dt>
          <dd className="tabular m-0 text-[1.65rem] font-bold leading-tight [overflow-wrap:anywhere]">{k.value}</dd>
          {k.delta && (
            <dd className="m-0 text-[0.88rem] text-[var(--label-2)]">
              <span aria-hidden="true">{k.delta.direction === "naik" ? "▲ " : k.delta.direction === "turun" ? "▼ " : "■ "}</span>
              <span className="sr-only">{k.delta.direction === "tetap" ? "Tetap" : k.delta.direction === "naik" ? "Naik" : "Turun"} </span>
              {k.delta.text}
            </dd>
          )}
          <dd className="m-0 text-[0.82rem] text-[var(--label-2)]">{k.basis}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportTable({
  caption,
  columns,
  rows,
  kpis,
  empty = "Tidak ada data untuk periode ini.",
}: {
  caption: string;
  columns: [ReportColumn, ...ReportColumn[]];
  rows: Record<string, string>[];
  kpis?: Kpi[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <section aria-label={caption} className="grid min-w-0 gap-4">
        {kpis && <KpiRow items={kpis} />}
        <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">{empty}</p>
      </section>
    );
  }
  return (
    <section aria-label={caption} className="grid min-w-0 gap-4">
      {kpis && <KpiRow items={kpis} />}
      {/* Focusable so a keyboard can scroll a wide table. */}
      <div tabIndex={0} role="region" aria-label={caption} className="hidden min-w-0 overflow-x-auto rounded-[var(--radius-group)] bg-[var(--surface)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-[var(--tint)] min-[700px]:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col" className={cn("border-b border-[var(--separator)] px-4 py-3 text-[0.88rem] font-semibold text-[var(--label-2)]", c.numeric && "text-right")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]">
                {columns.map((c, j) =>
                  j === 0 ? (
                    <th key={c.id} scope="row" className="px-4 py-3 text-left font-semibold">{r[c.id]}</th>
                  ) : (
                    <td key={c.id} className={cn("px-4 py-3", c.numeric && "tabular text-right")}>{r[c.id]}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="m-0 grid list-none gap-3 p-0 min-[700px]:hidden">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <p className="m-0 font-semibold [overflow-wrap:anywhere]">{r[columns[0].id]}</p>
            {/* Label and value wrap onto their own lines at large text, never overlap. */}
            <dl className="m-0 grid gap-y-1">
              {columns.slice(1).map((c) => (
                <div key={c.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="min-w-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{c.label}</dt>
                  <dd className={cn("m-0 min-w-0 text-right [overflow-wrap:anywhere]", c.numeric && "tabular")}>{r[c.id]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
