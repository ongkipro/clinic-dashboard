// Kasir ▸ Struk (BILL-19): the frozen receipt as rendered at payment (no clinical content), Cetak (PDF). The
// auditor's copy has the patient masked.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { LoadingList } from "../../../../../components/ui/states";
import { loadReceipt } from "../../data";
import { card, Main, muted, NotOkState } from "../../frame";

export const metadata: Metadata = { title: "Struk — Kasir — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const d = await loadReceipt(receiptId);
  if (d.kind !== "ok") return <NotOkState d={d} title="Struk" />;
  const r = d.r;
  return (
    <>
      <PageTitle title={`Struk ${r.number}`} />
      <section aria-label="Isi struk" className={card}>
        <pre className="m-0 whitespace-pre-wrap font-[inherit] [overflow-wrap:anywhere]">{r.body}</pre>
      </section>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <a href={`/kasir/struk/${r.id}/pdf`} className="inline-flex min-h-[52px] items-center rounded-full bg-[var(--tint)] px-5 font-semibold text-white no-underline">Cetak Struk</a>
        <Link href={`/kasir/${r.invoice_id}`} className="inline-flex min-h-[var(--target)] items-center px-1 font-semibold text-[var(--tint)]">Ke tagihan</Link>
      </div>
      <p className={muted}>Kirim WhatsApp belum tersedia: WhatsApp klinik belum terhubung.</p>
    </>
  );
}

export default function StrukPage({ params }: { params: Promise<{ receiptId: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={3} />}><Body params={params} /></Suspense></Main>;
}
