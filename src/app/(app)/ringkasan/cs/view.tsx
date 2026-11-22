// Ringkasan CS (UX-36, PR-33e; T-113). Presentational server component: props in, markup out; no data access (page.tsx
// wires the readers at integration). Perlu ditangani first (leads past the SET-20 target, unassigned, unconfirmed
// appointments, open service complaints, low surveys — each hidden at zero), then K14 with its weekly trend (title states
// the finding, data table available) and K13 by source. Drill-down via caller hrefs (UX-17 Pesan, Lead, Jadwal). One state
// per screen via ListPage; unavailable reads "Belum tersedia", never 0. Compact: one column, funnel as cards; regular:
// two columns, funnel as a table. No clinical content: complaints are counts only.
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { conversion, count, type Count, type CsSummaryData, type CsSummaryProps, inbox, minutes, mixText, qty, rate, sortFunnel, sourceLabel, UNAVAILABLE } from "./model";

const panel = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const h2 = "m-0 text-[1.2rem] font-semibold";
const link = "inline-flex min-h-[var(--target)] items-center gap-1 self-start font-semibold text-[var(--tint)] no-underline";

const LinkOrText = ({ href, className, children }: { href?: string; className: string; children: React.ReactNode }) =>
  href ? <Link href={href} className={className}>{children}</Link> : <div className={className}>{children}</div>;

// A "Perlu ditangani" item whose destination is not built: the same row, as text (no link, no chevron), so the count is still read.
function Plain({ title }: { title: string }) {
  return (
    <li data-plain className="flex min-h-[var(--target)] min-w-0 items-center border-b border-[var(--separator)] px-4 py-[11px] last:border-b-0 [border-bottom-width:0.5px]">
      <span className="font-semibold [overflow-wrap:anywhere]">{title}</span>
    </li>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <><span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]">{UNAVAILABLE}</span><p className={muted}>{reason}</p></>;
}

function Attention({ d }: { d: CsSummaryData }) {
  const { overdue, unassigned } = inbox(d);
  const extra: { key: string; c: Count; label: string; href?: string }[] = [
    { key: "janji", c: d.unconfirmed.count, label: "janji belum dikonfirmasi", href: d.unconfirmed.href },
    { key: "keluhan", c: d.complaints.count, label: "keluhan layanan terbuka", href: d.complaints.href },
    { key: "survei", c: d.lowSurveys.count, label: "survei bernilai rendah", href: d.lowSurveys.href },
  ];
  const items = [
    ...(d.waitingUnavailable ? [{ key: "lewat", title: `Lead lewat ${count(d.slaMinutes)} menit: ${UNAVAILABLE} — ${d.waitingUnavailable}`, href: d.inboxHref.overdue }]
      : overdue.length > 0 ? [{ key: "lewat", title: `${count(overdue.length)} lead lewat ${count(d.slaMinutes)} menit`, href: d.inboxHref.overdue }] : []),
    ...(unassigned.state === "unavailable" || unassigned.n > 0 ? [{ key: "belum", title: `${qty(unassigned)} lead belum ditugaskan`, href: d.inboxHref.unassigned }] : []),
    ...extra.filter((x) => x.c.state === "unavailable" || x.c.n > 0).map((x) => ({ key: x.key, title: `${qty(x.c)} ${x.label}`, href: x.href })),
  ];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="perlu" className="grid min-w-0 gap-2">
      <h2 id="perlu" className={h2}>Perlu ditangani</h2>
      <RowList label="Perlu ditangani">
        {items.map((i) => (i.href ? <Row key={i.key} href={i.href} title={i.title} /> : <Plain key={i.key} title={i.title} />))}
      </RowList>
      {overdue.length > 0 && (
        <RowList label={`Lead lewat ${d.slaMinutes} menit`}>
          {overdue.map((l) => (
            <Row key={l.id} href={l.href} title={l.contact}
              subtitle={[sourceLabel(l.source), l.branch ?? "Belum diarahkan ke cabang", l.assigned ? null : "Belum ditugaskan"].filter(Boolean).join(" · ")}>
              <StatusBadge tone="warning">{`Menunggu ${minutes(l.waitingMinutes)}`}</StatusBadge>
            </Row>
          ))}
        </RowList>
      )}
    </section>
  );
}

function K14({ d }: { d: CsSummaryData }) {
  const k = d.k14;
  if ("state" in k) {
    return (
      <section aria-labelledby="kpi-k14" className={panel}>
        <h2 id="kpi-k14" className={h2}>Respons lead (K14)</h2>
        <Unavailable reason={k.reason} />
        <Link href={k.href} className={link}>Lihat lead<ChevronRight aria-hidden="true" className="size-4" /></Link>
      </section>
    );
  }
  const known = k.trend.filter((w) => w.within.state === "value" && w.within.den > 0);
  const meeting = known.filter((w) => w.within.state === "value" && w.within.num * 100 >= 90 * w.within.den).length; // PRD target ≥ 90%
  const finding = known.length === 0 ? "Tren respons belum tersedia" : `Target 90% tercapai di ${meeting} dari ${known.length} minggu`;
  return (
    <section aria-labelledby="kpi-k14" className={panel}>
      <h2 id="kpi-k14" className={h2}>Respons lead (K14)</h2>
      <span data-kpi={k.within.state === "value" && k.within.den > 0 ? "value" : "unavailable"} className="tabular text-[1.65rem] font-bold leading-tight">{rate(k.within)}</span>
      <p className={muted}>dibalas sesuai SLA yang berlaku saat lead masuk, pada jam buka</p>
      {k.slaMix.length > 0 && <p className={muted} data-sla-mix>{mixText(k.slaMix)}</p>}
      <p className={muted}>{`Dibalas ≤ 15 menit: ${rate(k.within15)}`}</p>
      <p className={muted}>{k.median === null ? `Median respons: ${UNAVAILABLE}` : `Median respons: ${minutes(k.median)}`}</p>
      <h3 className="m-0 text-[1rem] font-semibold">{finding}</h3>
      <details>
        <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center font-semibold text-[var(--tint)]">Tabel data</summary>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Persentase lead dibalas sesuai SLA saat masuk, per minggu</caption>
          <thead><tr>
            <th scope="col" className="py-2 text-[0.88rem] font-semibold text-[var(--label-2)]">Minggu</th>
            <th scope="col" className="py-2 text-right text-[0.88rem] font-semibold text-[var(--label-2)]">Tepat waktu</th>
          </tr></thead>
          <tbody>
            {k.trend.map((w) => (
              <tr key={w.label} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
                <th scope="row" className="py-2 font-normal">{w.label}</th>
                <td className="tabular py-2 text-right">{rate(w.within)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <Link href={k.href} className={link}>Lihat lead<ChevronRight aria-hidden="true" className="size-4" /></Link>
    </section>
  );
}

function K13({ d }: { d: CsSummaryData }) {
  const k = d.k13;
  if ("state" in k) {
    return <section aria-labelledby="kpi-k13" className={panel}><h2 id="kpi-k13" className={h2}>Konversi lead per sumber (K13)</h2><Unavailable reason={k.reason} /></section>;
  }
  const rows = sortFunnel(k.rows);
  const cols = ["Lead", "Booking", "Datang", "Bayar", "Konversi"];
  const cells = (r: (typeof rows)[number]) => [count(r.lead), count(r.booked), count(r.arrived), count(r.paid), rate(conversion(r))];
  return (
    <section aria-labelledby="kpi-k13" className={panel}>
      <h2 id="kpi-k13" className={h2}>Konversi lead per sumber (K13)</h2>
      <p className={muted}>{k.period}</p>
      {rows.length === 0 ? <p role="status" className={muted}>Belum ada lead pada periode ini.</p> : (
        <>
          <div tabIndex={0} role="region" aria-label="Konversi per sumber" className="hidden min-w-0 overflow-x-auto focus-visible:outline focus-visible:outline-3 focus-visible:outline-[var(--tint)] @min-[48em]:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Lead, booking, datang dan bayar per sumber</caption>
              <thead><tr>
                <th scope="col" className="py-2 text-[0.88rem] font-semibold text-[var(--label-2)]">Sumber</th>
                {cols.map((c) => <th key={c} scope="col" className="py-2 text-right text-[0.88rem] font-semibold text-[var(--label-2)]">{c}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.source} data-source={r.source} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
                    <th scope="row" className="py-1">{r.href
                      ? <Link href={r.href} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)] no-underline">{sourceLabel(r.source)}</Link>
                      : <span className="inline-flex min-h-[var(--target)] items-center font-semibold">{sourceLabel(r.source)}</span>}</th>
                    {cells(r).map((c, i) => <td key={cols[i]} className={cn("tabular py-2 text-right", i === 4 && "font-semibold")}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul aria-label="Konversi per sumber" className="m-0 grid list-none gap-0 p-0 @min-[48em]:hidden">
            {rows.map((r) => (
              <li key={r.source} className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]">
                <LinkOrText href={r.href} className="grid min-h-[var(--target)] min-w-0 gap-1 py-2 text-[var(--label)] no-underline">
                  <span className="flex min-w-0 flex-wrap justify-between gap-x-3"><span className="font-semibold">{sourceLabel(r.source)}</span><span className="tabular font-semibold">{rate(conversion(r))}</span></span>
                  <span className="tabular text-[0.82rem] text-[var(--label-2)]">{`${count(r.lead)} lead · ${count(r.booked)} booking · ${count(r.arrived)} datang · ${count(r.paid)} bayar`}</span>
                </LinkOrText>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function CsSummary(p: CsSummaryProps) {
  const title = "Ringkasan CS";
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} state={p.state} />;
  const d = p.state.data;
  return (
    <ListPage as={p.as} title={title} state={{ kind: "rows" }}>
      <p className={muted}>{`${p.scope} · Lead baru hari ini: ${qty(d.newToday)}`}</p>
      <Attention d={d} />
      <div className="@container grid min-w-0 gap-3"><div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[64em]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <K14 d={d} />
        <K13 d={d} />
      </div></div>
    </ListPage>
  );
}
