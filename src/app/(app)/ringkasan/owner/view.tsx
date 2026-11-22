// Ringkasan Owner (UX-20) and Cabang league / branch detail (UX-37), PR-33a (T-109). Presentational server components:
// props in, markup out; no data access (the T-107 readers are wired by page.tsx at integration). One state per screen via
// the ListPage template (loading / empty / filtered-empty / error / blocked / permission); every figure links to the
// records behind it through a caller-supplied href (PR-33); an unavailable figure reads "Belum tersedia", never Rp0.
// Compact (< 700 px): single column. Regular: KPI grid. The league is one card per branch at every width (ten KPI columns never fit a row). No animation (DESIGN.md).
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import {
  type Amount, amountShown, ATTENTION_LABEL, type BranchDetailProps, type Contribution, count, delta, K7_NOTE, K9_WINDOWS, LEAGUE_KEYS, LEAGUE_LABEL,
  type LeagueKey, type LeagueProps, type LeagueRow, money, moneyWithReason, NO_RECOMMENDATION, NO_RECOMMENDED_VALUE, openAttention, type OwnerSummaryData, type OwnerSummaryProps,
  type Period, type Ratio, ratioShown, type Shown, rp, sortLeague, TREND_H, trendDomain, trendFinding, trendY, UNAVAILABLE,
} from "./model";

const panel = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const h2 = "m-0 text-[1.2rem] font-semibold";
const link = "inline-flex min-h-[var(--target)] items-center gap-1 self-start font-semibold text-[var(--tint)] no-underline";

function Value({ a, big }: { a: Amount; big?: boolean }) {
  if (a.state !== "value") {
    return <span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]" title={a.reason}>{UNAVAILABLE}</span>;
  }
  return <span data-kpi="value" className={cn("tabular font-bold leading-tight [overflow-wrap:anywhere]", big ? "text-[1.65rem]" : "text-[1.3rem]")}>{rp(a.rp)}</span>;
}

function Reason({ a }: { a: Amount }) {
  return a.state === "unavailable" ? <p className={muted}>{a.reason}</p> : null;
}

function KpiCard({ id, label, a, href, sub, children, big }: { id: string; label: string; a: Amount; href?: string; sub?: string; children?: React.ReactNode; big?: boolean }) {
  return (
    <section aria-labelledby={`kpi-${id}`} className={panel}>
      <h3 id={`kpi-${id}`} className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">{label}</h3>
      <Value a={a} big={big} />
      <Reason a={a} />
      {children}
      {sub && <p className={muted}>{sub}</p>}
      {href && <Link href={href} className={link}>Lihat rincian<span className="sr-only"> {label}</span><ChevronRight aria-hidden="true" className="size-4" /></Link>}
    </section>
  );
}

function DeltaLine({ cur, prev, period }: { cur: Amount; prev: Amount; period: Period }) {
  const d = delta(cur, prev, period.previousLabel);
  if (!d) return <p className={muted}>{`Pembanding ${period.previousLabel} belum tersedia`}</p>;
  return (
    <p data-delta={d.direction} className={muted}>
      <span aria-hidden="true">{d.direction === "naik" ? "▲ " : d.direction === "turun" ? "▼ " : "■ "}</span>
      {d.text}
    </p>
  );
}

function contribution(c: Contribution) {
  return c.note && c.amount.state === "value" ? `${money(c.amount)} · ${K7_NOTE[c.note]}` : c.note ? K7_NOTE[c.note] : money(c.amount);
}

// Weekly K1 vs K2 line chart. Series differ by colour AND stroke (solid vs dashed) and the legend names them; the data
// table below carries every value (charts: never colour alone; data table available).
function Trend({ weeks }: { weeks: OwnerSummaryData["trend"] }) {
  const finding = trendFinding(weeks);
  const known = weeks.flatMap((w) => [w.k1, w.k2]).filter((a): a is { state: "value"; rp: number } => a.state === "value").map((a) => a.rp);
  const dom = trendDomain(known); // contains Rp0 and every known SIGNED value: K1 is net of cash refunds, so a week can be negative and must stay in the plot
  const negative = known.some((v) => v < 0);
  const W = 320;
  const H = TREND_H;
  const x = (i: number) => (weeks.length < 2 ? W / 2 : 8 + (i * (W - 16)) / (weeks.length - 1));
  const y = (v: number) => trendY(v, dom);
  const base = y(0); // the Rp0 baseline: the bottom edge for non-negative data, the top edge for all-negative, in between for mixed
  // a gap in the data breaks the line instead of drawing to zero
  const path = (k: "k1" | "k2") => weeks.reduce((acc, w, i) => {
    const a = w[k];
    if (a.state !== "value") return `${acc} `;
    const prevKnown = i > 0 && weeks[i - 1][k].state === "value";
    return `${acc}${prevKnown ? "L" : "M"}${x(i).toFixed(1)},${y(a.rp).toFixed(1)}`;
  }, "").trim();
  return (
    <section aria-labelledby="tren" className={panel}>
      <h2 id="tren" className={h2}>{finding}</h2>
      {known.length > 0 && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Grafik mingguan uang masuk dan layanan selesai. ${finding}.${negative ? " Garis dasar grafik adalah Rp0; ada minggu di bawah garis dasar." : ""}`} className="h-auto w-full max-w-[640px]">
            <line data-baseline="rp0" x1="0" x2={W} y1={base} y2={base} stroke="var(--separator)" strokeWidth="1" />
            <path d={path("k1")} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" />
            <path d={path("k2")} fill="none" stroke="var(--chart-2)" strokeWidth="2.5" strokeDasharray="6 4" />
          </svg>
          <ul aria-label="Keterangan grafik" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[0.88rem]">
            <li className="flex items-center gap-2"><svg aria-hidden="true" width="24" height="6"><line x1="0" x2="24" y1="3" y2="3" stroke="var(--chart-1)" strokeWidth="2.5" /></svg>Uang masuk (K1)</li>
            <li className="flex items-center gap-2"><svg aria-hidden="true" width="24" height="6"><line x1="0" x2="24" y1="3" y2="3" stroke="var(--chart-2)" strokeWidth="2.5" strokeDasharray="6 4" /></svg>Layanan selesai (K2)</li>
          </ul>
          {negative && <p data-trend-note="negative" className={muted}>Garis dasar grafik adalah Rp0. Minggu di bawah garis dasar berarti pengembalian melebihi uang yang masuk pada minggu itu.</p>}
        </>
      )}
      <details>
        <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center font-semibold text-[var(--tint)]">Tabel data</summary>
        {/* WCAG 1.4.10: the table only when the container holds 24 em of its own text; enlarged text or a narrow container gets one block per week, never a two-dimensional scroll
            (Panel 2, 2026-11-19). em in a container query follows the container's font. */}
        <div className="@container min-w-0">
          <table className="hidden w-full border-collapse text-left @min-[24em]:table">
            <caption className="sr-only">Uang masuk dan layanan selesai per minggu</caption>
            <thead><tr>
              <th scope="col" className="py-2 text-[0.88rem] font-semibold text-[var(--label-2)]">Minggu</th>
              <th scope="col" className="py-2 text-right text-[0.88rem] font-semibold text-[var(--label-2)]">Uang masuk</th>
              <th scope="col" className="py-2 text-right text-[0.88rem] font-semibold text-[var(--label-2)]">Layanan selesai</th>
            </tr></thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.label} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
                  <th scope="row" className="py-2 font-normal">{w.label}</th>
                  <td className="tabular py-2 text-right">{money(w.k1)}</td>
                  <td className="tabular py-2 text-right">{money(w.k2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul aria-label="Uang masuk dan layanan selesai per minggu" className="m-0 grid list-none p-0 @min-[24em]:hidden">
            {weeks.map((w) => (
              <li key={w.label} className="grid min-w-0 gap-0.5 border-t border-[var(--separator)] py-2 [border-top-width:0.5px]">
                <span className="font-semibold">{w.label}</span>
                <span className="tabular">{`Uang masuk ${money(w.k1)}`}</span>
                <span className="tabular">{`Layanan selesai ${money(w.k2)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

// K4 aging as one sequential hue (UX-20 §4): darker = older; each bucket is also labelled in words.
function Aging({ aging }: { aging: OwnerSummaryData["k4"]["aging"] }) {
  const rows: [string, Amount, string][] = [
    ["0–30 hari", aging.d0_30, "color-mix(in srgb, var(--tint) 30%, white)"],
    ["31–60 hari", aging.d31_60, "color-mix(in srgb, var(--tint) 55%, white)"],
    ["61–90 hari", aging.d61_90, "color-mix(in srgb, var(--tint) 80%, white)"],
    ["Lebih dari 90 hari", aging.d90, "var(--tint)"],
  ];
  return (
    <dl className="m-0 grid min-w-0 gap-1">
      {rows.map(([k, a, fill]) => (
        <div key={k} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3">
          <dt className="flex items-center gap-2"><span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ background: fill }} />{k}</dt>
          <dd className="tabular m-0">{money(a)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SummaryBody({ d, period, league, leagueHref }: { d: OwnerSummaryData; period: Period; league?: LeagueRow[]; leagueHref?: string }) {
  const attention = openAttention(d.attention);
  const mixRows = d.mix.state === "rows" ? d.mix.rows : [];
  const mixMax = Math.max(1, ...mixRows.map((m) => (m.k2.state === "value" ? m.k2.rp : 0)));
  return (
    <>
      {attention.length > 0 && (
        <section aria-labelledby="perlu" className="grid min-w-0 gap-2">
          <h2 id="perlu" className={h2}>Perlu ditangani</h2>
          <RowList label="Perlu ditangani">
            {attention.map((a) => ("state" in a
              ? <li key={a.key} data-attention="unavailable" className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
                  <span className="font-semibold">{`${ATTENTION_LABEL[a.key]}: ${UNAVAILABLE}`}</span><span className={muted}>{a.reason}</span></li>
              : a.href ? <Row key={a.key} href={a.href} title={`${count(a.count)} ${ATTENTION_LABEL[a.key]}`} />
                : <li key={a.key} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]"><span className="font-semibold">{`${count(a.count)} ${ATTENTION_LABEL[a.key]}`}</span></li>))}
          </RowList>
        </section>
      )}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2 min-[1180px]:grid-cols-3">
        <div className="min-w-0 min-[700px]:col-span-2 min-[1180px]:col-span-1">
          <KpiCard id="k1" big label={`Uang masuk ${period.label.toLowerCase()} (K1)`} a={d.k1.amount} href={d.k1.href} sub={period.basis}>
            <DeltaLine cur={d.k1.amount} prev={d.k1.previous} period={period} />
          </KpiCard>
        </div>
        <KpiCard id="k2" label="Layanan selesai (K2)" a={d.k2.amount} href={d.k2.href} sub="Cabang pelaksana, tanpa PPN">
          <DeltaLine cur={d.k2.amount} prev={d.k2.previous} period={period} />
        </KpiCard>
        <KpiCard id="k3" label="Penjualan (K3)" a={d.k3.amount} href={d.k3.href} sub="Cabang penjual, tanpa PPN">
          <DeltaLine cur={d.k3.amount} prev={d.k3.previous} period={period} />
        </KpiCard>
        <KpiCard id="k4" label="Piutang (K4)" a={d.k4.amount} href={d.k4.href}><Aging aging={d.k4.aging} /></KpiCard>
        <KpiCard id="k5" label="Kewajiban prabayar (K5)" a={d.k5.amount} href={d.k5.href}>
          <p className={muted}>{`Paket kedaluwarsa ≤ 30 hari: ${money(d.k5.packageExpiry30)}`}</p>
        </KpiCard>
        <KpiCard id="k6" label="Paket kedaluwarsa ke saldo (K6)" a={d.k6.amount} href={d.k6.href} />
        <KpiCard id="k17" label="Komisi terutang bulan ini (K17)" a={d.k17.amount} href={d.k17.href} />
        <section aria-labelledby="kpi-k18" className={panel}>
          <h3 id="kpi-k18" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">Risiko stok (K18)</h3>
          {"state" in d.k18 ? (
            <><span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]">{UNAVAILABLE}</span><p className={muted}>{d.k18.reason}</p></>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0">
              <li className="tabular">{`${count(d.k18.belowMin)} item di bawah minimum`}</li>
              <li className="tabular">{`${count(d.k18.expiring30)} batch kedaluwarsa ≤ 30 hari`}</li>
              <li className="tabular">{`${count(d.k18.countVariance)} selisih hitung stok`}</li>
            </ul>
          )}
          {d.k18.href && <Link href={d.k18.href} className={link}>Lihat rincian<span className="sr-only"> Risiko stok</span><ChevronRight aria-hidden="true" className="size-4" /></Link>}
        </section>
      </div>

      <Trend weeks={d.trend} />

      {league && leagueHref && (
        <section aria-labelledby="liga" className="grid min-w-0 gap-2">
          <h2 id="liga" className={h2}>Cabang</h2>
          {league.length === 0 ? (
            <p role="status" className={cn(panel, "text-[var(--label-2)]")}>Belum ada cabang aktif.</p>
          ) : (
            <RowList label="Cabang menurut uang masuk">
              {sortLeague(league, "k1").map((r) => <Row key={r.branchId} href={r.href} title={r.name} subtitle={`Uang masuk ${moneyWithReason(r.k1)} · Layanan selesai ${moneyWithReason(r.k2)}`} />)}
            </RowList>
          )}
          <Link href={leagueHref} className={link}>Buka Cabang<ChevronRight aria-hidden="true" className="size-4" /></Link>
        </section>
      )}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        <section aria-labelledby="mix" className={panel}>
          <h2 id="mix" className={h2}>Mix perawatan</h2>
          {d.mix.state === "unavailable" ? (
            <><span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]">{UNAVAILABLE}</span><p className={muted}>{d.mix.reason}</p></>
          ) : mixRows.length === 0 ? <p role="status" className={muted}>Belum ada layanan selesai pada periode ini.</p> : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {mixRows.map((m) => (
                <li key={m.category} className="grid min-w-0 gap-1">
                  {m.href ? (
                    <Link href={m.href} className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3 text-[var(--label)] no-underline">
                      <span className="font-semibold [overflow-wrap:anywhere]">{m.category}</span>
                      <span className="tabular">{money(m.k2)}</span>
                    </Link>
                  ) : (
                    <div className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3">
                      <span className="font-semibold [overflow-wrap:anywhere]">{m.category}</span>
                      <span className="tabular">{money(m.k2)}</span>
                    </div>
                  )}
                  <span aria-hidden="true" className="block h-2 rounded-full bg-[var(--chart-1)]" style={{ width: `${m.k2.state === "value" ? Math.max(2, (m.k2.rp * 100) / mixMax) : 0}%` }} />
                  <span className={muted}>{`Kontribusi (K7): ${contribution(m.k7)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="funnel" className={panel}>
          <h2 id="funnel" className={h2}>Funnel lead (K13)</h2>
          {d.funnel.state === "unavailable" ? (
            <><span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]">{UNAVAILABLE}</span><p className={muted}>{d.funnel.reason}</p></>
          ) : (
            <>
              <ol className="m-0 grid list-none gap-1 p-0">
                {([["Lead", d.funnel.lead], ["Booking", d.funnel.booked], ["Datang", d.funnel.arrived], ["Bayar", d.funnel.paid]] as const).map(([k, v]) => (
                  <li key={k} className="flex min-w-0 flex-wrap justify-between gap-x-3"><span>{k}</span><span className="tabular">{count(v)}</span></li>
                ))}
              </ol>
              <FunnelSources s={d.funnel.sources} />
            </>
          )}
          {d.funnel.href && <Link href={d.funnel.href} className={link}>Lihat lead<ChevronRight aria-hidden="true" className="size-4" /></Link>}
        </section>
      </div>
    </>
  );
}

// K13 by source (PR-33a "channel funnel"): one block per lead source with its own four counts. The sources are those of the SAME scope as the funnel above them (clinic, or this branch).
function FunnelSources({ s }: { s: Extract<OwnerSummaryData["funnel"], { state: "value" }>["sources"] }) {
  if (s.state === "unavailable") return <p data-funnel-sources="unavailable" className={muted}>{`Per sumber: ${UNAVAILABLE}. ${s.reason}`}</p>;
  if (s.rows.length === 0) return <p role="status" data-funnel-sources="empty" className={muted}>Belum ada lead pada periode ini.</p>;
  return (
    <section aria-labelledby="funnel-sumber" data-funnel-sources="rows" className="grid min-w-0 gap-1">
      <h3 id="funnel-sumber" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">Per sumber</h3>
      <ul aria-label="Funnel lead per sumber" className="m-0 grid list-none gap-2 p-0">
        {s.rows.map((r) => (
          <li key={r.source} data-source={r.source} className="grid min-w-0 gap-0.5 border-t border-[var(--separator)] pt-2 [border-top-width:0.5px]">
            <span className="font-semibold [overflow-wrap:anywhere]">{r.label}</span>
            <span className="tabular text-[0.94rem] [overflow-wrap:anywhere]">{`Lead ${count(r.lead)} · Booking ${count(r.booked)} · Datang ${count(r.arrived)} · Bayar ${count(r.paid)}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Context({ scope, period }: { scope: string; period: Period }) {
  return <p className={muted}>{`${scope} · ${period.label} · ${period.basis}`}</p>;
}

// UX-20: consolidated or one-branch owner summary.
export function OwnerSummary(p: OwnerSummaryProps) {
  const title = p.title ?? "Ringkasan";
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} state={p.state} />;
  return (
    <ListPage as={p.as} title={title} state={{ kind: "rows" }}>
      <Context scope={p.scope.label} period={p.period} />
      <SummaryBody d={p.state.data} period={p.period} league={p.league} leagueHref={p.leagueHref} />
    </ListPage>
  );
}

// One league figure as text plus, when it is not a number, the reason AS TEXT: a tooltip is never the only place a reason lives (keyboard, touch, zoom).
function leagueShown(r: LeagueRow, k: LeagueKey): Shown {
  switch (k) {
    case "k1": case "k2": case "k17": return amountShown(r[k]);
    case "k7": return r.k7.amount.state === "value" ? { text: contribution(r.k7), reason: null } : amountShown(r.k7.amount);
    case "k10": return r.k10.state === "value" ? { text: `${count(r.k10.newPatients)} baru / ${count(r.k10.returning)} kembali`, reason: null } : { text: UNAVAILABLE, reason: r.k10.reason };
    case "k9": return ratioShown(r.k9, NO_RECOMMENDATION);
    default: return ratioShown(r[k]);
  }
}
// The card's headline figure (the sorted KPI) with its reason, when it has one, under it.
function LeagueFigure({ s }: { s: Shown }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <p className="tabular m-0 text-[1.3rem] font-bold [overflow-wrap:anywhere]">{s.text}</p>
      {s.reason && <p data-reason="" className={muted}>{s.reason}</p>}
    </div>
  );
}

// "x dari y (p %)" for one K9 window, as a count and as a value; a zero denominator has no share and says so.
const share = (r: Ratio, fmt: (n: number) => string, noData: string): Shown => {
  const t = ratioShown(r, noData);
  return r.state === "value" && r.den > 0 ? { text: `${fmt(r.num)} dari ${fmt(r.den)} (${t.text})`, reason: null } : t;
};

// K9 Rencana dipilih (Appendix A): the whole result — selected ÷ recommended within 30 / 60 / 90 days, as a count AND as a value — in an expansion a keyboard can open
// (a native <details>: Enter / Space on the summary). The league cell above it is the 30-day COUNT and is labelled so.
function K9Expansion({ d, branch }: { d: LeagueRow["k9Detail"]; branch: string }) {
  return (
    <details data-k9="" className="min-w-0">
      <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center font-semibold text-[var(--tint)]">Rencana dipilih: 30, 60, 90 hari<span className="sr-only">{` ${branch}`}</span></summary>
      {d.state === "unavailable" ? (
        <p className={muted}>{`${UNAVAILABLE}. ${d.reason}`}</p>
      ) : (
        <ul aria-label="Rencana dipilih menurut jangka waktu" className="m-0 grid list-none gap-2 p-0">
          {K9_WINDOWS.map((n) => {
            const c = share(d.windows[n].count, count, NO_RECOMMENDATION);
            const v = share(d.windows[n].value, rp, NO_RECOMMENDED_VALUE); // recommended items can exist with no value (Rp0 items): that is a different reason from "no plan"
            return (
              <li key={n} data-k9-window={n} className="grid min-w-0 gap-0.5 border-t border-[var(--separator)] pt-2 [border-top-width:0.5px]">
                <span className="font-semibold">{`${n} hari`}</span>
                <span className="tabular [overflow-wrap:anywhere]">{`Jumlah: ${c.text}${c.reason ? `. ${c.reason}` : ""}`}</span>
                <span className="tabular [overflow-wrap:anywhere]">{`Nilai: ${v.text}${v.reason ? `. ${v.reason}` : ""}`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

// UX-37 Cabang: league sortable by every PR-33a branch KPI; sort links are supplied by the caller (server-side sort state).
export function BranchLeague(p: LeagueProps) {
  const title = "Cabang";
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} state={p.state} />;
  const rows = sortLeague(p.state.data, p.sort);
  const sort = LEAGUE_KEYS.map((k) => ({ label: LEAGUE_LABEL[k], href: p.sortHrefs[k], active: k === p.sort }));
  return (
    <ListPage as={p.as} title={title} sort={sort} state={rows.length === 0 ? { kind: "empty", message: "Belum ada cabang aktif." } : { kind: "rows" }}>
      <Context scope={p.scope.label} period={p.period} />
      {/* Ten KPI columns never fit one row (≈ 1470 px at 100 %, wider with enlarged text; the last column was cut off at 1440): one card per branch at every width, the sorted KPI first
          and the rest listed, so nothing needs a horizontal scroll (WCAG 1.4.10; Panel 2, 2026-11-19). The columns follow the container's own text size, not the viewport. */}
      <div className="@container min-w-0">
        <ul aria-label={`Liga cabang, urut menurut ${LEAGUE_LABEL[p.sort]}`} className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0 @min-[40em]:grid-cols-2 @min-[62em]:grid-cols-3">
          {rows.map((r) => (
            <li key={r.branchId} className="grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
              <Link href={r.href} className="flex min-h-[var(--target)] items-center justify-between gap-2 font-semibold text-[var(--label)] no-underline">
                <span className="[overflow-wrap:anywhere]">{r.name}</span><ChevronRight aria-hidden="true" className="size-5 shrink-0 text-[var(--label-3)]" />
              </Link>
              <p className="m-0 text-[0.88rem] text-[var(--label-2)]">{LEAGUE_LABEL[p.sort]}</p>
              <LeagueFigure s={leagueShown(r, p.sort)} />
              <dl className="m-0 grid gap-y-1">
                {LEAGUE_KEYS.filter((k) => k !== p.sort).map((k) => {
                  const shown = leagueShown(r, k);
                  return (
                    <div key={k} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                      <dt className="min-w-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{LEAGUE_LABEL[k]}</dt>
                      <dd className="tabular m-0 min-w-0 text-right [overflow-wrap:anywhere]">{shown.text}</dd>
                      {/* the reason is its own row of the same group (a <dt> may have several <dd>): left-aligned, full width, plain text — not a tooltip */}
                      {shown.reason && <dd data-reason="" className="m-0 w-full basis-full text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{shown.reason}</dd>}
                    </div>
                  );
                })}
              </dl>
              <K9Expansion d={r.k9Detail} branch={r.name} />
            </li>
          ))}
        </ul>
      </div>
    </ListPage>
  );
}

// UX-37 branch detail: the same cards as UX-20, for one branch (no league).
export function BranchDetail(p: BranchDetailProps) {
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={p.branch} state={p.state} />;
  return (
    <ListPage as={p.as} title={p.branch} state={{ kind: "rows" }}>
      <Link href={p.backHref} className={link}>Semua cabang</Link>
      <Context scope={p.branch} period={p.period} />
      <SummaryBody d={p.state.data} period={p.period} />
    </ListPage>
  );
}
