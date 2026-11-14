// Ajukan Refund (UX-14): pick a paid patient invoice (or open one by link), then a line, amount, Tujuan and reason.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../../components/templates/templates";
import { LoadingList } from "../../../../../components/ui/states";
import { loadRefundOptions } from "../../data";
import { RefundForm } from "../../forms";
import { card, Main, muted, NotOkState, rp, who } from "../../frame";

export const metadata: Metadata = { title: "Ajukan Refund — Clinic Dashboard" };
const BLOCKED: Record<string, string> = {
  package_line: "Paket: batalkan di Paket & Saldo", line_on_receivable: "Sudah menjadi piutang", line_unpaid: "Masih ada sisa tagihan",
  nothing_to_refund: "Sudah direfund seluruhnya", invoice_not_issued: "Tagihan tidak aktif", invoice_without_patient: "Tanpa nama pasien",
};

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const d = await loadRefundOptions(typeof sp.tagihan === "string" ? sp.tagihan : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Ajukan Refund" />;
  if (d.role === "auditor") return <NotOkState d={{ kind: "forbidden" }} title="Ajukan Refund" />;
  if (!d.opts) {
    return (
      <ListPage as="section" title="Ajukan Refund"
        state={d.picks.length === 0 ? { kind: "empty", message: "Tidak ada tagihan lunas yang dapat direfund di cabang ini." } : { kind: "rows" }}>
        <p className={muted}>Pilih tagihan pasien yang sudah dibayar.</p>
        <RowList label="Tagihan">
          {d.picks.map((x) => <Row key={x.id} href={`/piutang/refund/baru?tagihan=${x.id}`} title={`${x.number} · ${who(x.patient)}`} subtitle={rp(x.total)} />)}
        </RowList>
      </ListPage>
    );
  }
  const o = d.opts;
  return (
    <>
      <Link href="/piutang/refund/baru" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">‹ Pilih tagihan lain</Link>
      <h1 className="m-0 text-[2rem] font-bold leading-tight [overflow-wrap:anywhere]">{`Ajukan Refund ${o.number ?? ""}`}</h1>
      <section className={card} aria-label="Baris tagihan">
        <p className={muted}>{who(o.patient)}</p>
        <ul className="m-0 grid gap-1 p-0 [list-style:none]">
          {o.lines.map((l) => <li key={l.id} className="flex flex-wrap justify-between gap-2 tabular-nums"><span className="[overflow-wrap:anywhere]">{l.name}</span><span>{l.blocked ? BLOCKED[l.blocked] ?? "Tidak dapat direfund" : `dapat direfund ${rp(l.room)}`}</span></li>)}
        </ul>
      </section>
      <section className={card} aria-label="Refund"><RefundForm ctx={d.ctx} lines={o.lines} cashApprover={d.cashApprover} /></section>
    </>
  );
}

export default function NewRefundPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={3} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
