// Ringkasan Cabang (UX-21, PR-33b, 19:34): scroll summary for the manager's one branch, top → bottom: Perlu Ditangani (chase
// list), Hari Ini (counts and per hour), Besok (K15 gaps, leave conflicts), Risiko Stok (K18, with Buat PO), Staf (K19, K17,
// completions). Server component: data in, markup out; every value is a link to the records behind it (PR-33). Compact 390
// stacks tiles and shows cards; ≥ 700 px shows tables; ≥ 1180 px sets tiles four across. Names are React text only.
// An unavailable value reads "Belum tersedia" (never 0 or Rp0). No patient name, phone or clinical text exists in the model.
import { cn } from "cn";
import Link from "next/link";
import { PageTitle, ReportTable } from "../../../../components/templates/templates";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import {
  type BranchSummary, filterHref, type Filter, type GapRow, quantity, rupiah, type Rows, show, type StaffRow, type Tile, UNAVAILABLE_COPY,
  utilization, type ViewState, visibleChase, drill,
} from "./model";

const TITLE = "Ringkasan Cabang";
const linkCls = "inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "UTC" });
const dayLabel = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));

function Root({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-6">{children}</main>;
}

// T-110 mount defect (200 % text, 820 / 1180): the shared ReportTable switches table ↔ cards on the VIEWPORT (min-[700px]), so the five-column staff table
// scrolled sideways inside a narrow content box. This page's staff list switches on its CONTAINER instead (T-108 / T-113 lesson), with ReportTable's own markup;
// the shared template is unchanged (a separate hygiene task). 64em of the container ≈ the width five columns need at any text size.
type Col = { id: string; label: string; numeric?: boolean };
function StaffTable({ caption, empty, columns, rows }: { caption: string; empty: string; columns: [Col, ...Col[]]; rows: Record<string, string>[] }) {
  if (rows.length === 0) return <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">{empty}</p>;
  return (
    <div className="@container grid min-w-0">
      <div tabIndex={0} role="region" aria-label={caption} className="hidden min-w-0 overflow-x-auto rounded-[var(--radius-group)] bg-[var(--surface)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-[var(--tint)] @min-[64em]:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col" className={cn("border-b border-[var(--separator)] px-4 py-3 text-[0.88rem] font-semibold text-[var(--label-2)]", c.numeric && "text-right")}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]">
                {columns.map((c, j) => (j === 0
                  ? <th key={c.id} scope="row" className="px-4 py-3 text-left font-semibold">{r[c.id]}</th>
                  : <td key={c.id} className={cn("px-4 py-3", c.numeric && "tabular text-right")}>{r[c.id]}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="m-0 grid list-none gap-3 p-0 @min-[64em]:hidden">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <p className="m-0 font-semibold [overflow-wrap:anywhere]">{r[columns[0].id]}</p>
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
    </div>
  );
}

function Section({ id, title, children, action }: { id: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid min-w-0 gap-3 scroll-mt-24">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-h`} className="m-0 text-[1.18rem] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// One KPI tile = one link (PR-33 drill-down). Unavailable is a different shape, not a number.
export function TileLink({ t }: { t: Tile }) {
  const off = t.metric.kind === "unavailable";
  return (
    <li className="min-w-0">
      <Link
        href={t.href}
        data-metric={t.key}
        data-state={off ? "unavailable" : "value"}
        className="grid min-h-full min-w-0 gap-1 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label)] no-underline hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--tint)]"
      >
        <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{t.label}</span>
        <span className={cn("[overflow-wrap:anywhere]", off ? "text-[1rem] font-semibold text-[var(--label-2)]" : "tabular text-[1.65rem] font-bold leading-tight")}>
          {show(t.metric)}
        </span>
      </Link>
    </li>
  );
}

function Tiles({ label, items }: { label: string; items: Tile[] }) {
  return (
    <ul aria-label={label} className="m-0 grid min-w-0 list-none grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 p-0 min-[1180px]:grid-cols-4">
      {items.map((t) => <TileLink key={t.key} t={t} />)}
    </ul>
  );
}

function ListUnavailable<T>({ rows, children }: { rows: Rows<T>; children: (r: T[]) => React.ReactNode }) {
  if (rows.kind === "unavailable") {
    return <p role="status" data-state="unavailable" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">{UNAVAILABLE_COPY[rows.reason]}.</p>;
  }
  return <>{children(rows.rows)}</>;
}

const gapCells = (g: GapRow) => {
  const u = utilization(g);
  return u.kind === "ok"
    ? { util: `${u.percent}%`, open: `${quantity(u.openMin)} menit` }
    : { util: UNAVAILABLE_COPY[u.reason], open: UNAVAILABLE_COPY[u.reason] };
};

const k19Text = (s: StaffRow) => {
  if (s.k19 === null) return "—";
  if (s.k19.kind === "unavailable") return UNAVAILABLE_COPY[s.k19.reason];
  return `${rupiah(s.k19.closing)} dari ${rupiah(s.k19.target)}`;
};

function Summary({ s, filter }: { s: BranchSummary; filter: Filter }) {
  const chase = visibleChase(s);
  const d = drill(s.today);
  return (
    <>
      <div role="group" aria-label="Tampilan" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
        {(["semua", "perlu"] as const).map((f) => (
          <Link
            key={f}
            href={filterHref(f)}
            aria-current={filter === f ? "true" : undefined}
            className={cn("inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline", filter === f ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "bg-transparent")}
          >
            {f === "semua" ? "Semua" : "Perlu Ditangani"}
          </Link>
        ))}
      </div>
      {chase.length > 0 && (
        <Section id="perlu" title="Perlu Ditangani">
          <Tiles label="Perlu Ditangani" items={chase} />
        </Section>
      )}
      {filter === "semua" && (
        <>
          <Section id="hari-ini" title="Hari Ini" action={<Link className={linkCls} href={d.today}>Buka Hari Ini</Link>}>
            <Tiles label="Hari ini" items={s.todayTiles} />
            <ListUnavailable rows={s.hours}>
              {(r) => (
                <ReportTable
                  caption="Janji per jam hari ini"
                  empty="Belum ada janji hari ini."
                  columns={[{ id: "jam", label: "Jam" }, { id: "janji", label: "Janji", numeric: true }, { id: "datang", label: "Datang", numeric: true }]}
                  rows={r.map((h) => ({ jam: `${String(h.hour).padStart(2, "0")}.00`, janji: quantity(h.booked), datang: quantity(h.arrived) }))}
                />
              )}
            </ListUnavailable>
          </Section>
          <Section id="besok" title={`Besok · ${dayLabel(s.tomorrow)}`} action={<Link className={linkCls} href={d.tomorrow}>Buka Jadwal Besok</Link>}>
            <Tiles label="Besok" items={s.tomorrowTiles} />
            <ListUnavailable rows={s.gaps}>
              {(r) => (
                <ReportTable
                  caption="Celah jadwal besok per tenaga (K15)"
                  empty="Tidak ada celah jadwal besok."
                  columns={[{ id: "nama", label: "Tenaga" }, { id: "util", label: "Utilisasi (K15)", numeric: true }, { id: "open", label: "Belum terisi", numeric: true }]}
                  rows={r.map((g) => ({ nama: g.name, ...gapCells(g) }))}
                />
              )}
            </ListUnavailable>
          </Section>
          <Section id="stok" title="Risiko Stok (K18)" action={<Link className={linkCls} href={d.reorder}>Buat PO</Link>}>
            <Tiles label="Risiko stok" items={s.stockTiles} />
            <ListUnavailable rows={s.below}>
              {(r) =>
                r.length === 0 ? (
                  <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">Tidak ada item di bawah minimum.</p>
                ) : (
                  <ul aria-label="Di bawah minimum" className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
                    {r.map((i) => (
                      <li key={i.itemId} data-item={i.itemId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--separator)] px-4 py-2 last:border-b-0 [border-bottom-width:0.5px]">
                        <div className="grid min-w-0 gap-0.5">
                          <Link href={d.item(i.itemId)} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--label)] [overflow-wrap:anywhere]">{i.name}</Link>
                          <span className={muted}>Sisa {quantity(i.onHand)} {i.unit} · minimum {quantity(i.minQty)} {i.unit}</span>
                        </div>
                        <Link href={d.reorder} className={linkCls} aria-label={`Buat PO untuk ${i.name}`}>Buat PO</Link>
                      </li>
                    ))}
                  </ul>
                )
              }
            </ListUnavailable>
          </Section>
          <Section id="staf" title="Staf" action={d.staff ? <Link className={linkCls} href={d.staff}>Target & Scorecard</Link> : undefined}>
            <ListUnavailable rows={s.staff}>
              {(r) => (
                <StaffTable
                  caption="Staf cabang bulan ini"
                  empty="Belum ada staf bertugas bulan ini."
                  columns={[
                    { id: "nama", label: "Nama" }, { id: "peran", label: "Peran" }, { id: "selesai", label: "Layanan selesai", numeric: true },
                    { id: "k19", label: "Target BC (K19)", numeric: true }, { id: "k17", label: "Komisi terutang (K17)", numeric: true },
                  ]}
                  rows={r.map((x) => ({ nama: x.name, peran: ROLE_LABEL[x.role], selesai: show(x.completions), k19: k19Text(x), k17: show(x.k17) }))}
                />
              )}
            </ListUnavailable>
          </Section>
        </>
      )}
    </>
  );
}

function Header({ s }: { s?: BranchSummary }) {
  return (
    <div className="grid min-w-0 gap-1">
      <PageTitle title={TITLE} />
      {s && <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">{s.branch.name} · {dayLabel(s.today)}</p>}
    </div>
  );
}

export function BranchSummaryView({ state }: { state: ViewState }) {
  switch (state.kind) {
    case "loading":
      return <Root><Header /><LoadingList rows={4} label="Memuat Ringkasan Cabang" /></Root>;
    case "permission":
      return <Root><Header /><PermissionState object="Ringkasan Cabang" /></Root>;
    case "no-branch":
      return <Root><Header /><BlockedState reason="Belum ada cabang aktif" unblock="Pilih cabang di Saya › Ganti Cabang" /></Root>;
    case "error":
      return (
        <Root>
          <Header />
          <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <p className="m-0 text-[var(--danger)]">Ringkasan cabang belum bisa dimuat.</p>
            <Link href={filterHref("semua")} className={linkCls}>Coba Lagi</Link>
          </div>
        </Root>
      );
    case "empty":
      return (
        <Root>
          <Header s={state.summary} />
          <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <p className="m-0 text-[var(--label-2)]">Belum ada aktivitas di cabang ini.</p>
            <Link href={drill(state.summary.today).today} className={linkCls}>Buka Hari Ini</Link>
          </div>
        </Root>
      );
    case "filtered-empty":
      return (
        <Root>
          <Header s={state.summary} />
          <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <p className="m-0 text-[var(--label-2)]">Tidak ada yang perlu ditangani untuk filter ini.</p>
            <Link href={filterHref("semua")} className={linkCls}>Hapus Filter</Link>
          </div>
        </Root>
      );
    case "ok":
      return <Root><Header s={state.summary} /><Summary s={state.summary} filter={state.filter} /></Root>;
  }
}
