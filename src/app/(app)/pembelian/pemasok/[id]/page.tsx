// Pemasok detail: contact, terms, the receipts (unit cost for cost readers) and returns at the branches the reader sees.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { LoadingList } from "../../../../../components/ui/states";
import { loadSupplier } from "../../data";
import { SupplierForm } from "../../forms";
import { card, Main, muted, NotOkState } from "../../frame";
import { canSee, date, qty, RETURN_REASON, rp } from "../../labels";

export const metadata: Metadata = { title: "Pemasok — Pembelian — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadSupplier(id);
  if (d.kind !== "ok") return <NotOkState d={d} title="Pemasok" />;
  if (!canSee(d.p.role, "pemasok")) return <NotOkState d={{ kind: "forbidden" }} title="Pemasok" />;
  const s = d.supplier;
  return (
    <>
      <PageTitle title={s.name} />
      <p className={muted}>{[`Syarat bayar ${s.payment_terms_days} hari`, s.npwp && `NPWP ${s.npwp}`, s.contact_name, s.phone, s.email, s.address, !s.active && "Nonaktif"].filter(Boolean).join(" · ")}</p>
      {d.p.can_supplier && <SupplierForm ctx={d.ctx} s0={s} />}
      <section aria-label="Penerimaan" className={card}>
        <h2 className="m-0 text-[1.25rem] font-semibold">Penerimaan</h2>
        {s.receipts.length === 0 ? <p className={muted}>Belum ada penerimaan.</p> : (
          <ul className="m-0 grid gap-1 pl-5">
            {s.receipts.slice(0, 30).map((r) => <li key={r.id} className="[overflow-wrap:anywhere]">{`${date(r.received_at)} · ${r.item} · ${r.batch_no} · ${qty(r.quantity)} ${r.unit}${r.unit_cost != null ? ` · ${rp(r.unit_cost)}/${r.unit}` : ""}`}</li>)}
          </ul>
        )}
      </section>
      <section aria-label="Retur" className={card}>
        <h2 className="m-0 text-[1.25rem] font-semibold">Retur</h2>
        {s.returns.length === 0 ? <p className={muted}>Belum ada retur.</p> : (
          <ul className="m-0 grid gap-1 pl-5">
            {s.returns.slice(0, 30).map((r) => <li key={r.id} className="[overflow-wrap:anywhere]">{`${date(r.returned_at)} · ${r.item} · ${r.batch_no} · ${qty(r.quantity)} ${r.unit} · ${RETURN_REASON[r.reason]}`}</li>)}
          </ul>
        )}
      </section>
      <Link href="/pembelian/pemasok" className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Kembali ke Pemasok</Link>
    </>
  );
}

export default function PemasokDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body params={params} /></Suspense></Main>;
}
