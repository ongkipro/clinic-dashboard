// Ringkasan Shift on Hari Ini (UX-6, PR-33c; T-111). Presentational server component: props in, markup out; no data
// access (page.tsx wires the loader). One state per screen via ListPage; "Belum dibayar" first when non-empty or unreadable
// (a missing answer is not an empty queue); totals per tender with balance shown apart (not new money); every figure links to the
// records behind it through a caller-supplied href (PR-33); unavailable reads "Belum tersedia" with its reason, never Rp0.
// Compact (< 700 px): one column, tenders as a list. Regular: two columns, tenders as a table. No clinical content.
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { StatusBadge, type StatusTone } from "../../../../components/ui/status-badge";
import { type Amount, count, money, net, qty, SHIFT_STATE, type ShiftState, type ShiftSummaryData, type ShiftSummaryProps, sortTenders, type TenderBlock, tenderLabel, UNAVAILABLE } from "./model";

const panel = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const h2 = "m-0 text-[1.2rem] font-semibold";
const link = "inline-flex min-h-[var(--target)] items-center gap-1 self-start font-semibold text-[var(--tint)] no-underline";
const TONE: Record<ShiftState, StatusTone> = { open: "neutral", pending_approval: "warning", recount: "danger", closed: "success" };

function Value({ a, big }: { a: Amount; big?: boolean }) {
  if (a.state !== "value") return <span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]">{UNAVAILABLE}</span>;
  // A money figure is one word: it never breaks inside its digits ("Rp1.650.00 / 0"); it shrinks with the container's width instead (a seven-digit amount fits 15 em at the large size).
  return <span data-kpi="value" className={cn("tabular whitespace-nowrap font-bold leading-tight", big ? "text-[1.65rem] @max-[22em]:text-[1.3rem]" : "text-[1.3rem] @max-[22em]:text-[1.1rem]")}>{money(a)}</span>;
}

function Detail({ href, label }: { href: string; label: string }) {
  return <Link href={href} className={link}>Lihat rincian<span className="sr-only"> {label}</span><ChevronRight aria-hidden="true" className="size-4" /></Link>;
}

// The table's five columns need about 34 em of text (measured with Rp1.200.000-sized amounts); it is shown from 44 em of the CONTAINER and the list below that, so it never scrolls sideways at any
// viewport or text size (WCAG 1.4.10). lazy: amounts of more than ~12 digits would outgrow 44 em; no clinic shift has them, and the upgrade path is a wider threshold, never a scroll region.
function Tenders({ t: block }: { t: TenderBlock }) {
  if (block.state !== "value") return <p role="status" data-tenders="unavailable" className={muted}>{`${UNAVAILABLE}. ${block.reason}`}</p>;
  const rows = sortTenders(block.rows);
  if (rows.length === 0) return <p role="status" className={muted}>Belum ada pembayaran pada shift ini.</p>;
  const cell = (a: Amount) => money(a);
  return (
    <>
      <div className="hidden min-w-0 @min-[44em]:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Total per metode pembayaran pada shift ini</caption>
          <thead><tr>
            {["Metode", "Pembayaran", "Diterima", "Dikembalikan", "Bersih"].map((c, i) => (
              <th key={c} scope="col" className={cn("py-2 text-[0.88rem] font-semibold text-[var(--label-2)]", i > 0 && "text-right")}>{c}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.method} data-tender={t.method} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
                <th scope="row" className="py-1"><Link href={t.href} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)] no-underline">{tenderLabel(t.method)}</Link>
                  {t.method === "balance" && <span className="block text-[0.82rem] font-normal text-[var(--label-2)]">Bukan uang masuk</span>}</th>
                <td className="tabular py-2 text-right">{count(t.payments)}</td>
                <td className="tabular py-2 text-right">{cell(t.received)}</td>
                <td className="tabular py-2 text-right">{cell(t.paidOut)}</td>
                <td className="tabular py-2 text-right font-semibold">{cell(net(t))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label="Total per metode" className="m-0 grid list-none gap-0 p-0 @min-[44em]:hidden">
        {rows.map((t) => (
          <li key={t.method} data-tender={t.method} className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]">
            <Link href={t.href} className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3 py-2 text-[var(--label)] no-underline">
              <span className="grid min-w-0">
                <span className="font-semibold">{tenderLabel(t.method)}</span>
                <span className="text-[0.82rem] text-[var(--label-2)]">{`${count(t.payments)} pembayaran${t.method === "balance" ? " · Bukan uang masuk" : ""}`}</span>
              </span>
              <span className="tabular font-semibold">{cell(net(t))}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function CountCard({ id, label, c, href }: { id: string; label: string; c: ShiftSummaryData["arrivals"]; href: string }) {
  return (
    <section aria-labelledby={`kpi-${id}`} className={panel}>
      <h3 id={`kpi-${id}`} className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">{label}</h3>
      <span data-kpi={c.count.state === "value" ? "value" : "unavailable"} className={cn("tabular font-bold", c.count.state === "value" ? "text-[1.3rem]" : "text-[1.05rem] text-[var(--label-2)]")}>{qty(c.count)}</span>
      {c.count.state === "unavailable" && <p className={muted}>{c.count.reason}</p>}
      <Detail href={href} label={label} />
    </section>
  );
}

export function ShiftSummary(p: ShiftSummaryProps) {
  const title = "Ringkasan Shift";
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} state={p.state} />;
  const d = p.state.data;
  const cashIn = d.moneyIn;
  return (
    <ListPage as={p.as} title={title} state={{ kind: "rows" }}>
      <div className="@container grid min-w-0 gap-4">
      <p className={muted}>{`${p.branch} · ${p.day} · ${p.zone}`}</p>

      {(d.unpaid.count.state === "unavailable" || d.unpaid.count.n > 0) && (
        <section aria-labelledby="belum-bayar" className="grid min-w-0 gap-2">
          <h2 id="belum-bayar" className={h2}>Belum dibayar</h2>
          {d.unpaid.count.state === "unavailable" ? (
            <p role="status" data-unpaid="unavailable" className={muted}>{`${UNAVAILABLE}. ${d.unpaid.count.reason}`}</p>
          ) : (
            <RowList label="Belum dibayar">
              <Row href={d.unpaid.href} title={`${qty(d.unpaid.count)} tagihan terbuka`} subtitle={`Sisa ${money(d.unpaid.total)}`} />
            </RowList>
          )}
        </section>
      )}

      <section aria-labelledby="shift" className={panel}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="shift" className={h2}>{d.shift.label}</h2>
          <StatusBadge tone={TONE[d.shift.state]}>{SHIFT_STATE[d.shift.state]}</StatusBadge>
        </div>
        <p className={muted}>{`${d.shift.cashier} · dibuka ${d.shift.openedAt}`}</p>
        <Link href={d.shift.href} className={link}>Buka shift<ChevronRight aria-hidden="true" className="size-4" /></Link>
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[36em]:grid-cols-2">
        <section aria-labelledby="kpi-uang" className={panel}>
          <h3 id="kpi-uang" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">Uang masuk shift ini</h3>
          <Value a={cashIn} big />
          {cashIn.state === "unavailable" && <p className={muted}>{cashIn.reason}</p>}
          <p className={muted}>Semua metode kecuali saldo pasien, dikurangi pengembalian tunai</p>
          <Detail href={cashIn.href} label="Uang masuk shift ini" />
        </section>
        <section aria-labelledby="kpi-jual" className={panel}>
          <h3 id="kpi-jual" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">Penjualan shift ini</h3>
          <Value a={d.sales} />
          {d.sales.state === "unavailable" && <p className={muted}>{d.sales.reason}</p>}
          <p className={muted}>Tagihan terbit pada shift ini, tanpa PPN</p>
          {d.sales.href && <Detail href={d.sales.href} label="Penjualan shift ini" />}
        </section>
      </div>

      <section aria-labelledby="tender" className={panel}>
        <h2 id="tender" className={h2}>Total per metode</h2>
        <Tenders t={d.tenders} />
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[44em]:grid-cols-3">
        <CountCard id="datang" label="Pasien datang" c={d.arrivals} href={d.arrivals.href} />
        <CountCard id="tidak-datang" label="Tidak datang" c={d.noShows} href={d.noShows.href} />
        <CountCard id="terbuka" label="Kunjungan belum ditutup" c={d.openVisits} href={d.openVisits.href} />
      </div>

      {d.others.length > 0 && (
        <section aria-labelledby="shift-lain" className="grid min-w-0 gap-2">
          <h2 id="shift-lain" className={h2}>Shift lain yang terbuka</h2>
          <RowList label="Shift lain yang terbuka">
            {d.others.map((o) => <Row key={o.href} href={o.href} title={o.label} />)}
          </RowList>
        </section>
      )}
      </div>
    </ListPage>
  );
}
