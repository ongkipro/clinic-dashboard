// Piutang detail (UX-14): amounts, source visit, collector, lines, collection history; Terima Pembayaran, Kirim Tagihan
// (disabled until the messaging module), Ajukan Hapus Buku (FO/finance) or Hapus Buku (owner).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadReceivable } from "../data";
import { CollectForm, WriteOffForm } from "../forms";
import { card, date, Main, METHOD, muted, NotOkState, RECEIVABLE_STATE, rp, who } from "../frame";

export const metadata: Metadata = { title: "Piutang — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ receivableId: string }> }) {
  const { receivableId } = await params;
  const d = await loadReceivable(receivableId);
  if (d.kind !== "ok") return <NotOkState d={d} title="Piutang" />;
  const { r } = d;
  const writer = d.role !== "auditor";
  return (
    <>
      <Link href="/piutang" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">‹ Piutang &amp; Refund</Link>
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <h1 className="m-0 min-w-0 text-[2rem] font-bold leading-tight [overflow-wrap:anywhere]">{`Piutang ${who(r.patient)}`}</h1>
        <StatusBadge tone={RECEIVABLE_STATE[r.state][1]}>{RECEIVABLE_STATE[r.state][0]}</StatusBadge>
      </header>
      <section className={card} aria-label="Ringkasan">
        <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 tabular-nums">
          <dt>Total</dt><dd className="m-0 text-right">{rp(r.amount)}</dd>
          <dt>Terbayar</dt><dd className="m-0 text-right">{rp(r.collected)}</dd>
          <dt>Dihapus buku</dt><dd className="m-0 text-right">{rp(r.written_off)}</dd>
          <dt className="font-semibold">Sisa</dt><dd className="m-0 text-right font-semibold">{rp(r.open)}</dd>
        </dl>
        <p className={muted}>{`Dibuat ${date(r.created_at)} · ${r.age_days} hari · umur ${r.bucket} hari${r.collector ? ` · Penanggung tagih: ${r.collector}` : ""}`}</p>
      </section>
      {d.lines.length > 0 && (
        <section className={card} aria-label="Asal tagihan">
          <h2 className="m-0 text-[1.1rem] font-semibold">Asal tagihan</h2>
          <ul className="m-0 grid gap-1 p-0 [list-style:none]">{d.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 tabular-nums"><span className="[overflow-wrap:anywhere]">{l.name}</span><span>{rp(l.amount)}</span></li>)}</ul>
        </section>
      )}
      {d.collections.length > 0 && (
        <section className={card} aria-label="Riwayat pembayaran">
          <h2 className="m-0 text-[1.1rem] font-semibold">Riwayat pembayaran</h2>
          <ul className="m-0 grid gap-1 p-0 [list-style:none]">{d.collections.map((c) => <li key={c.number} className="flex justify-between gap-3 tabular-nums"><span>{`${c.number} · ${METHOD[c.method]} · ${date(c.at)}`}</span><span>{rp(c.amount)}</span></li>)}</ul>
        </section>
      )}
      {writer && r.state === "open" && (
        <>
          <section className={card} aria-label="Terima pembayaran"><h2 className="m-0 text-[1.1rem] font-semibold">Terima Pembayaran</h2><CollectForm ctx={d.ctx} receivable={r.id} open={r.open} /></section>
          <section className={card} aria-label="Kirim tagihan"><h2 className="m-0 text-[1.1rem] font-semibold">Kirim Tagihan</h2><p className={muted}>Kirim tagihan WhatsApp tersedia setelah modul pesan aktif.</p></section>
          {(d.role === "owner" || d.role === "fo_cashier" || d.role === "finance") && (
            <section className={card} aria-label="Hapus buku">
              <h2 className="m-0 text-[1.1rem] font-semibold">{d.role === "owner" ? "Hapus Buku" : "Ajukan Hapus Buku"}</h2>
              {r.write_off_pending ? <p className={muted}>Hapus buku sudah diajukan. Owner memutuskannya di <Link href="/persetujuan" className="font-semibold text-[var(--tint)]">Persetujuan</Link>.</p>
                : <WriteOffForm ctx={d.ctx} receivable={r.id} open={r.open} owner={d.role === "owner"} />}
            </section>
          )}
        </>
      )}
    </>
  );
}

export default function ReceivablePage({ params }: { params: Promise<{ receivableId: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body params={params} /></Suspense></Main>;
}
