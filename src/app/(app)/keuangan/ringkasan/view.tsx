// Ringkasan Keuangan (UX-22 ▸ Ringkasan, PR-33f; T-114). Presentational server component: props in, markup out; no data
// access (body.tsx wires the readers through data.ts and load.ts). Cues first (open shifts, shift variance, reconciliation differences,
// gateway settlements pending — hidden at zero), then K1 per method, K2/K3/K6, K4 aging, the K5 roll-forwards with the
// package-expiry slice (each checked opening + movements = closing), refunds and write-offs, commission batches (K17) and
// supplier payables. Branch / consolidated filter as segments built from caller props; every figure links through a
// caller-supplied href. One state per screen via ListPage; unavailable reads "Belum tersedia", never Rp0. Compact: one
// column; regular: two columns when the page's own container is wide (48 em), never by the viewport (a sidebar and the text size take width
// from it). No clinical content.
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { StatusBadge } from "../../../../components/ui/status-badge";
import {
  type Amount, BATCH, count, type FinanceSummaryData, type FinanceSummaryProps, k1Total, k5Total, ledgerLabel, methodLabel, money, PREPAID, rollCheck,
  type Roll, rp, scopeHref, sum, termLabel, UNAVAILABLE,
} from "./model";

const panel = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const h2 = "m-0 text-[1.2rem] font-semibold";
const link = "inline-flex min-h-[var(--target)] items-center gap-1 self-start font-semibold text-[var(--tint)] no-underline";
const line = "flex min-w-0 flex-wrap items-baseline justify-between gap-x-3";

function Value({ a, big }: { a: Amount; big?: boolean }) {
  if (a.state !== "value") return <><span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]">{UNAVAILABLE}</span><p className={muted}>{a.reason}</p></>;
  return <span data-kpi="value" className={cn("tabular font-bold leading-tight [overflow-wrap:anywhere]", big ? "text-[1.65rem]" : "text-[1.3rem]")}>{rp(a.rp)}</span>;
}

function Card({ id, label, a, href, linkLabel = "Lihat rincian", big, children }: { id: string; label: string; a?: Amount; href?: string; linkLabel?: string; big?: boolean; children?: React.ReactNode }) {
  return (
    <section aria-labelledby={`kpi-${id}`} className={panel}>
      <h2 id={`kpi-${id}`} className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">{label}</h2>
      {a && <Value a={a} big={big} />}
      {children}
      {href && <Link href={href} className={link}>{linkLabel}<span className="sr-only"> {label}</span><ChevronRight aria-hidden="true" className="size-4" /></Link>}
    </section>
  );
}

function Cues({ d }: { d: FinanceSummaryData }) {
  const c = d.cues;
  const items = [
    c.openShifts !== null && c.openShifts > 0 && { key: "shift", title: `${count(c.openShifts)} shift kasir belum ditutup`, href: c.shiftHref },
    c.shiftVariance !== null && c.shiftVariance > 0 && { key: "selisih", title: `${count(c.shiftVariance)} selisih kas menunggu persetujuan`, href: c.shiftHref },
    c.reconDiffs !== null && c.reconDiffs > 0 && c.reconHref && { key: "rekon", title: `${count(c.reconDiffs)} selisih rekonsiliasi`, href: c.reconHref },
    // a gateway figure has no built destination yet: listed only with a page to open (Panel 2), else shown in the K1 card
    d.gatewayPending.href && ((d.gatewayPending.count ?? 0) > 0 || d.gatewayPending.amount.state === "unavailable"
      || (d.gatewayPending.amount.state === "value" && d.gatewayPending.amount.rp !== 0)) &&
      { key: "gateway", title: `Settlement gateway tertunda ${money(d.gatewayPending.amount)}`,
        subtitle: d.gatewayPending.count === null ? undefined : `${count(d.gatewayPending.count)} transaksi`, href: d.gatewayPending.href },
  ].filter((x): x is { key: string; title: string; subtitle?: string; href: string } => Boolean(x));
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="perlu" className="grid min-w-0 gap-2">
      <h2 id="perlu" className={h2}>Perlu ditangani</h2>
      <RowList label="Perlu ditangani">{items.map((i) => <Row key={i.key} href={i.href} title={i.title} subtitle={i.subtitle} />)}</RowList>
    </section>
  );
}

function RollCard({ r }: { r: Roll }) {
  const c = rollCheck(r);
  const badge = c.state === "balanced" ? <StatusBadge tone="success">Cocok</StatusBadge>
    : c.state === "mismatch" ? <StatusBadge tone="danger">{`Tidak cocok ${c.diff < 0 ? "−" : "+"}${rp(Math.abs(c.diff))}`}</StatusBadge>
    : <StatusBadge tone="neutral">Belum dapat dicocokkan</StatusBadge>;
  return (
    <section aria-labelledby={`roll-${r.ledger}`} data-roll={r.ledger} data-check={c.state} className={panel}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h3 id={`roll-${r.ledger}`} className="m-0 min-w-0 text-[1.05rem] font-semibold [overflow-wrap:anywhere]">{ledgerLabel(r.ledger)}</h3>
        {badge}
      </div>
      <dl className="m-0 grid min-w-0 gap-1">
        <div className={line}><dt className="text-[var(--label-2)]">Saldo awal</dt><dd className="tabular m-0">{money(r.opening)}</dd></div>
        {r.movements.filter((m) => m.rp !== 0).map((m) => (
          <div key={m.term} className={line}><dt className="min-w-0 [overflow-wrap:anywhere]">{termLabel(m.term)}</dt><dd className="tabular m-0">{rp(m.rp)}</dd></div>
        ))}
        <div className={cn(line, "border-t border-[var(--separator)] pt-1 font-semibold")}><dt>Saldo akhir</dt><dd className="tabular m-0">{money(r.closing)}</dd></div>
      </dl>
      {c.state === "unchecked" && <p className={muted}>{c.reason}</p>}
      <Link href={r.href} className={link}>Lihat mutasi<span className="sr-only"> {ledgerLabel(r.ledger)}</span><ChevronRight aria-hidden="true" className="size-4" /></Link>
    </section>
  );
}

export function FinanceSummary(p: FinanceSummaryProps) {
  const title = "Ringkasan Keuangan";
  const s = p.scope;
  const filters = [{ label: "Semua Cabang", href: scopeHref(s, null), active: s.branch === null },
    ...s.branches.map((b) => ({ label: b.name, href: scopeHref(s, b.id), active: s.branch === b.id }))];
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} filters={p.state.kind === "permission" ? undefined : filters} state={p.state} />;
  const d = p.state.data;
  const prepaid = PREPAID.map((l) => d.rolls.find((r) => r.ledger === l)).filter((r): r is Roll => Boolean(r));
  const others = d.rolls.filter((r) => !PREPAID.includes(r.ledger));
  const aging: [string, Amount][] = [["0–30 hari", d.k4.aging.d0_30], ["31–60 hari", d.k4.aging.d31_60], ["61–90 hari", d.k4.aging.d61_90], ["Lebih dari 90 hari", d.k4.aging.d90]];
  const scopeName = s.branch ? s.branches.find((b) => b.id === s.branch)?.name ?? "Cabang" : "Semua Cabang";
  return (
    <ListPage as={p.as} title={title} filters={filters} state={{ kind: "rows" }}>
      <p className={muted}>{`${scopeName} · ${s.period}`}</p>
      <Cues d={d} />

      <div className="@container grid min-w-0 gap-3"><div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[48em]:grid-cols-2">
        <Card id="k1" big label="Uang masuk (K1)" a={k1Total(d.k1)} href={d.k1.href} linkLabel="Mutasi Pembayaran">
          <ul aria-label="Uang masuk per metode" className="m-0 grid list-none gap-1 p-0">
            {d.k1.methods.map((m) => (
              <li key={m.method} data-method={m.method}>
                {m.href ? (
                  <Link href={m.href} className={cn(line, "min-h-[var(--target)] items-center text-[var(--label)] no-underline")}>
                    <span>{methodLabel(m.method)}</span><span className="tabular">{money(m.amount)}</span>
                  </Link>
                ) : <span className={line}><span>{methodLabel(m.method)}</span><span className="tabular">{money(m.amount)}</span></span>}
              </li>
            ))}
            <li className={cn(line, "text-[var(--label-2)]")}><span>Refund tunai</span><span className="tabular">{d.k1.refundsCash.state !== "value" ? UNAVAILABLE : d.k1.refundsCash.rp === 0 ? rp(0) : `−${rp(d.k1.refundsCash.rp)}`}</span></li>
          </ul>
          <p className={muted}>Pemakaian saldo pasien bukan uang masuk</p>
          {!d.gatewayPending.href && d.gatewayPending.amount.state === "value" && d.gatewayPending.amount.rp !== 0 &&
            <p className={muted} data-gateway>{`Kliring gateway belum diselesaikan: ${rp(d.gatewayPending.amount.rp)}`}</p>}
          {/* slice 3: no settlement fact → said so, never a clearing figure or Rp0 */}
          {!d.gatewayPending.href && d.gatewayPending.amount.state === "unavailable" &&
            <p className={muted} data-gateway="unavailable">{`Settlement gateway tertunda: ${UNAVAILABLE} — ${d.gatewayPending.amount.reason}`}</p>}
        </Card>
        <div className="grid min-w-0 content-start gap-3">
          <Card id="k2" label="Layanan selesai (K2)" a={d.k2.amount} href={d.k2.href}><p className={muted}>Cabang pelaksana, tanpa PPN</p></Card>
          <Card id="k3" label="Penjualan (K3)" a={d.k3.amount} href={d.k3.href}><p className={muted}>Cabang penjual, tanpa PPN</p></Card>
        </div>
        <Card id="k4" label="Piutang (K4)" a={sum(aging.map(([, a]) => a))} href={d.k4.href} linkLabel="Buka Piutang">
          <dl className="m-0 grid min-w-0 gap-1">
            {aging.map(([k, a]) => <div key={k} className={line}><dt>{k}</dt><dd className="tabular m-0">{money(a)}</dd></div>)}
          </dl>
        </Card>
        <Card id="k5" label="Kewajiban prabayar (K5)" a={k5Total(d.rolls)} href={d.k5.href} linkLabel="Piutang & Kewajiban Layanan">
          <p className={muted}>{`Paket kedaluwarsa ≤ 30 hari: ${money(d.k5.packageExpiry30)}`}</p>
        </Card>
        <Card id="k6" label="Paket kedaluwarsa ke saldo (K6)" a={d.k6.amount} href={d.k6.href} />
        <Card id="refund" label="Refund & hapus buku" href={d.refundsWriteOffs.href}>
          <dl className="m-0 grid min-w-0 gap-1">
            <div className={line}><dt>Refund</dt><dd className="tabular m-0">{money(d.refundsWriteOffs.refunds)}</dd></div>
            <div className={line}><dt>Dihapusbukukan</dt><dd className="tabular m-0">{money(d.refundsWriteOffs.writeOffs)}</dd></div>
          </dl>
        </Card>
        <Card id="k17" label="Komisi terutang (K17)" a={d.commission.owed} href={d.commission.href} linkLabel="Buka Komisi">
          {d.commission.batchesUnavailable ? <p className={muted} data-batches="unavailable">{`Batch komisi: ${UNAVAILABLE} — ${d.commission.batchesUnavailable}`}</p>
            : d.commission.batches.length === 0 ? <p className={muted}>Belum ada batch komisi.</p> : (
            <ul aria-label="Batch komisi" className="m-0 grid list-none gap-1 p-0">
              {d.commission.batches.map((b) => (
                <li key={b.state} data-batch={b.state} className={line}><span>{`${BATCH[b.state]} (${count(b.count)})`}</span><span className="tabular">{money(b.amount)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card id="utang" label="Utang pemasok" href={d.payables.href} linkLabel="Buka Utang Pemasok">
          <dl className="m-0 grid min-w-0 gap-1">
            <div className={line}><dt>Jatuh tempo 7 hari</dt><dd className="tabular m-0">{money(d.payables.due7)}</dd></div>
            <div className={line}><dt>Lewat jatuh tempo</dt><dd className="tabular m-0">{money(d.payables.overdue)}</dd></div>
          </dl>
        </Card>
      </div></div>

      <section aria-labelledby="roll" className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="roll" className={h2}>Roll-forward</h2>
          <Link href={p.ledgerHref} className={link}>Jurnal & Buku Besar<ChevronRight aria-hidden="true" className="size-4" /></Link>
        </div>
        {d.rolls.length === 0 ? <p role="status" className={cn(panel, "text-[var(--label-2)]")}>Belum ada transaksi pada periode ini.</p> : (
          <div className="@container grid min-w-0 gap-3"><div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[48em]:grid-cols-2">
            {[...prepaid, ...others].map((r) => <RollCard key={r.ledger} r={r} />)}
          </div></div>
        )}
      </section>
    </ListPage>
  );
}
