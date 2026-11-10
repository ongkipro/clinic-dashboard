// One letter (19:92, PR-74; T-058). Draft: the author edits it; "Tanda Tangani" waits for the second-factor
// step-up (the producer arrives with the clinical signing UI, T-053) and shows the blocked state. Signed: locked,
// the current version, the version history and reasons, the correction form for the author (a new version within
// 48 h, later through the record-correction approval), and the PDF.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadLetter } from "../../data";
import { LetterBodyForm } from "../../forms";
import { LETTER_TYPE_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Surat — Clinic Dashboard" };

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const card = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadLetter(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden" || d.kind === "no-branch") return <PermissionState object="surat" />;
  if (d.kind === "not-found") notFound();
  const l = d.letter;
  const signed = l.state === "signed";
  return (
    <>
      <PageTitle title={l.patient_name} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold">{`${l.patient_mrn} · ${LETTER_TYPE_LABEL[l.letter_type]}`}</span>
        <StatusBadge tone={signed ? "locked" : "neutral"}>{signed ? `Ditandatangani · versi ${l.versions[0]?.version ?? 1}` : "Draf"}</StatusBadge>
        {l.pending_correction && <StatusBadge tone="warning">Koreksi menunggu persetujuan</StatusBadge>}
      </div>
      <p className={muted}>{`${l.branch_name} · ${l.author_name} · ${l.template_name}${l.signed_at ? ` · ditandatangani ${when(l.signed_at)}` : ""}`}</p>
      {(signed || !l.own) && (
        <section aria-label="Isi surat" className={card}>
          <pre className="m-0 min-w-0 whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">{l.body}</pre>
          {signed && <a href={`/templat/surat/${l.id}/pdf`} className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Unduh PDF</a>}
        </section>
      )}
      {!signed && l.own && (
        <section aria-label="Draf surat" className={card}>
          <LetterBodyForm ctx={d.ctx} letter={l.id} body={l.body} mode="draft" />
          <BlockedState reason="Tanda tangan surat memerlukan verifikasi kode autentikator" unblock="Tanda Tangani tersedia bersama penandatanganan rekam medis" />
        </section>
      )}
      {signed && l.own && !l.pending_correction && (
        <section aria-label="Koreksi" className={card}>
          <h2 className="m-0 text-[1.06rem] font-semibold">Koreksi</h2>
          <p className={muted}>{l.correctable_direct ? "Koreksi disimpan sebagai versi baru; versi lama tetap tersimpan." : "Lewat 48 jam: koreksi menunggu persetujuan petugas rekam medis atau penanggung jawab klinik."}</p>
          <LetterBodyForm ctx={d.ctx} letter={l.id} body={l.body} mode="correct" />
        </section>
      )}
      {l.versions.length > 0 && (
        <section aria-label="Riwayat versi" className={card}>
          <h2 className="m-0 text-[1.06rem] font-semibold">Riwayat versi</h2>
          <ol className="m-0 grid min-w-0 list-none gap-2 p-0">
            {l.versions.map((v) => (
              <li key={v.id} className="grid min-w-0 gap-1">
                <span className="font-semibold">{`Versi ${v.version} · ${v.kind === "original" ? "asli" : `koreksi${v.approved ? " (disetujui)" : ""}`}`}</span>
                <span className={muted}>{when(v.created_at)}</span>
                {v.reason && <span className="[overflow-wrap:anywhere]">{`Alasan: ${v.reason}`}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <Link href="/templat/surat" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Kembali ke Surat</Link>
    </>
  );
}

export default function SuratDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[900px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
