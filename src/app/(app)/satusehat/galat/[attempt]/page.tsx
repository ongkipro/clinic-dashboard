// SATUSEHAT error answer (UX-23 "Lihat Kode", DATA-40; T-102 increment 3): the provider's full answer to one rejected send. Clinical class:
// the facility head only; each opening is audited as a clinical read. Shown as text, never interpreted as HTML.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { loadErrorBody } from "../../data";

export const metadata: Metadata = { title: "Jawaban SATUSEHAT — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ attempt: string }> }) {
  const { attempt } = await params;
  const d = await loadErrorBody(attempt);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="jawaban SATUSEHAT" />;
  return (
    <>
      <Link href="/satusehat" className="inline-flex min-h-[var(--target)] items-center justify-self-start text-[var(--tint)] no-underline">‹ SATUSEHAT</Link>
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Jawaban SATUSEHAT</h1>
      {d.kind === "missing" ? <p className="m-0">Jawaban tidak ditemukan.</p> : (
        <section aria-labelledby="jawaban" className="grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <h2 id="jawaban" className="m-0 text-[1.25rem] font-semibold">Isi jawaban</h2>
          <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Data klinis. Jangan disalin ke pesan atau catatan lain.</p>
          <pre tabIndex={0} className="m-0 max-h-[60vh] min-w-0 overflow-auto whitespace-pre-wrap rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3 text-[0.88rem] [overflow-wrap:anywhere]">{JSON.stringify(d.body, null, 2)}</pre>
        </section>
      )}
    </>
  );
}

export default function SatusehatErrorPage({ params }: { params: Promise<{ attempt: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
