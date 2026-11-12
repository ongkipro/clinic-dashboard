// Kasir ▸ Tagihan (UX-12): lines with the frozen price and tax badge, totals, the remaining amount, the tender sheet
// (Terima Rp…), receipts, and the void request (secondary; unpaid tagihan only).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadInvoice } from "../data";
import { PortPanel, TenderSheet, VoidForm } from "../forms";
import { card, Main, muted, NotOkState } from "../frame";
import { FLAG, PAYERS, patientLabel, payState, rp, TAX_BADGE, TENDER, VOIDERS, when } from "../labels";

export const metadata: Metadata = { title: "Tagihan — Kasir — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const d = await loadInvoice(invoiceId);
  if (d.kind !== "ok") return <NotOkState d={d} title="Tagihan" />;
  const i = d.inv;
  const st = payState(i.total, i.outstanding, i.state);
  const paid = i.total - i.outstanding;
  const vat = i.lines.reduce((t, l) => t + Number(l.vat_amount), 0);
  return (
    <>
      <PageTitle title={i.number ?? "Tagihan draf"} />
      <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        <span className={muted}>{`${patientLabel(i.patient)} · ${i.branch.name}${i.issued_at ? ` · ${when(i.issued_at)}` : ""}`}</span>
      </p>
      <section aria-label="Item" className={card}>
        <h2 className="m-0 text-[1.25rem] font-semibold">Item</h2>
        <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
          {i.lines.map((l) => (
            <li key={l.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-[var(--separator)] pb-2 last:border-b-0">
              <span className="font-semibold [overflow-wrap:anywhere]">{l.name}</span>
              <span className="text-right font-semibold">{rp(l.line_total)}</span>
              <span className={muted}>{`${rp(l.unit_price)} × ${l.quantity}${Number(l.discount) ? ` − diskon ${rp(l.discount)}` : ""}`}</span>
              <span className="justify-self-end"><StatusBadge tone="neutral">{TAX_BADGE[l.tax_category]}</StatusBadge></span>
              {l.dispensing && <span className={`${muted} col-span-2`}>{l.dispensing.state === "handed" ? "Sudah diserahkan apoteker" : l.dispensing.state === "cancelled" ? "Penyerahan dibatalkan" : "Menunggu penyerahan apoteker"}</span>}
            </li>
          ))}
        </ul>
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
          <dt>Total</dt><dd className="m-0 text-right font-semibold">{rp(i.total)}</dd>
          {vat > 0 && <><dt className={muted}>Termasuk PPN</dt><dd className={`${muted} text-right`}>{rp(vat)}</dd></>}
          <dt>Dibayar</dt><dd className="m-0 text-right">{rp(paid)}</dd>
        </dl>
        <p className="m-0 text-[1.75rem] font-bold leading-tight">{`Sisa ${rp(i.outstanding)}`}</p>
      </section>
      {i.state === "void" ? <BlockedState reason="Tagihan dibatalkan" unblock="Buat tagihan baru bila perlu" />
        : i.void?.state === "pending" ? <BlockedState reason="Void sedang diajukan" unblock="Manajer (hari yang sama) atau owner memutuskan di Persetujuan" />
        // A pending port charge first (one prominent action): pay another way only after Batalkan (no double payment).
        : i.state === "issued" && i.can_pay && PAYERS.has(d.role) && !i.charges.some((c) => c.state === "pending")
          ? <TenderSheet ctx={d.ctx} invoice={i.id} outstanding={i.outstanding} tenders={i.tenders} />
        : null}
      {i.state === "issued" && i.can_pay && PAYERS.has(d.role) && !i.void_pending && i.port && (i.outstanding > 0 || i.charges.some((c) => c.state === "pending")) && (
        <PortPanel ctx={d.ctx} invoice={i.id} outstanding={i.outstanding} simulated={i.port.simulated}
          channels={i.tenders.filter((t) => ["qris", "va", "payment_link"].includes(t.method) && t.available).map((t) => t.method as "qris" | "va" | "payment_link")}
          pending={i.charges.find((c) => c.state === "pending") ?? null} />
      )}
      {i.charges.filter((c) => c.review_flag).map((c) => (
        <p key={c.id} className={muted}>{`${c.channel.toUpperCase()} ${rp(c.amount)}: perlu ditinjau (${FLAG[c.review_flag!] ?? c.review_flag})${c.balance_pending ? ` · ${rp(c.balance_pending)} menunggu saldo pasien` : ""}.`}</p>
      ))}
      {i.receipts.length > 0 && (
        <section aria-label="Struk" className={card}>
          <h2 className="m-0 text-[1.25rem] font-semibold">Struk</h2>
          <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
            {i.receipts.map((r) => (
              <li key={r.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <Link href={`/kasir/struk/${r.id}`} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">{r.number}</Link>
                <span className={muted}>{`${r.is_simulated ? "SIMULASI · " : ""}${r.payments.map((p) => `${TENDER[p.method]} ${rp(p.amount)}`).join(" + ")} · ${when(r.issued_at)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {i.state === "issued" && paid === 0 && !i.void_pending && VOIDERS.has(d.role) && <VoidForm ctx={d.ctx} invoice={i.id} />}
      {i.void && i.void.state !== "pending" && i.state !== "void" && <p className={muted}>{`Pengajuan void ${i.void.state === "rejected" ? "ditolak" : "dibatalkan"}.`}</p>}
    </>
  );
}

export default function TagihanPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body params={params} /></Suspense></Main>;
}
