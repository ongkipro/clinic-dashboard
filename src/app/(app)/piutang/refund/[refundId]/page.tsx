// Refund detail (UX-14): state, the approval link; when approved, Bayar Refund (Tunai or Transfer).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingList } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadRefund } from "../../data";
import { PayRefundForm } from "../../forms";
import { card, date, Main, muted, NotOkState, REFUND_STATE, rp, who } from "../../frame";

export const metadata: Metadata = { title: "Refund — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ refundId: string }> }) {
  const { refundId } = await params;
  const d = await loadRefund(refundId);
  if (d.kind !== "ok") return <NotOkState d={d} title="Refund" />;
  const { f } = d;
  return (
    <>
      <Link href="/piutang?lihat=refund" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">‹ Refund</Link>
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <h1 className="m-0 min-w-0 text-[2rem] font-bold leading-tight [overflow-wrap:anywhere]">{`Refund ${rp(f.amount)}`}</h1>
        <StatusBadge tone={REFUND_STATE[f.state][1]}>{REFUND_STATE[f.state][0]}</StatusBadge>
      </header>
      <section className={card} aria-label="Ringkasan">
        <p className="m-0">{who(f.patient)}</p>
        <p className={muted}>{`${f.destination === "balance" ? "Ke saldo pasien" : "Tunai"} · diajukan ${date(f.requested_at)}${f.paid_at ? ` · dibayar ${date(f.paid_at)}` : ""}`}</p>
        {f.reason && <p className={muted}>{`Alasan: ${f.reason}`}</p>}
      </section>
      {f.state === "requested" && f.approval_id && (
        <section className={card} aria-label="Persetujuan"><p className="m-0">Refund tunai perlu persetujuan. <Link href={`/persetujuan/${f.approval_id}`} className="font-semibold text-[var(--tint)]">Buka Persetujuan</Link></p></section>
      )}
      {f.state === "approved" && d.role !== "auditor" && (
        <section className={card} aria-label="Bayar refund"><h2 className="m-0 text-[1.1rem] font-semibold">Bayar Refund</h2><PayRefundForm ctx={d.ctx} refund={f.id} /></section>
      )}
      {f.state === "failed" && <section className={card}><p className="m-0">Refund tunai ditolak atau ditarik. Ajukan ulang sebagai <Link href="/piutang/refund/baru" className="font-semibold text-[var(--tint)]">Refund ke Saldo</Link>.</p></section>}
    </>
  );
}

export default function RefundPage({ params }: { params: Promise<{ refundId: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={3} />}><Body params={params} /></Suspense></Main>;
}
