// Buat Surat (19:92, PR-74; T-058): a draft from a letter template for one of today's visits at the branch (`?visit=`
// preselects it; the "Buat Surat" entries on UX-8 and UX-29 link here later). When a visit has an examination, only
// its doctor writes the letter. Lists the letters already written for the preselected visit.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { loadNewLetter } from "../../data";
import { NewLetterForm } from "../../forms";
import { LETTER_TYPE_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Buat Surat — Clinic Dashboard" };

const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const visit = typeof q.visit === "string" ? q.visit : null;
  const d = await loadNewLetter(visit);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="pembuatan surat" />;
  if (d.kind === "no-branch") return <><PageTitle title="Buat Surat" /><p role="status" className="m-0 text-[var(--label-2)]">Pilih cabang aktif di Saya › Ganti Cabang.</p></>;
  const visits = d.options.visits.map((v) => ({ visit_id: v.visit_id, disabled: v.examined_by_other,
    label: `${v.patient_name} · ${v.patient_mrn} · datang ${time(v.checked_in_at)}${v.examined_by_other ? " · diperiksa dokter lain" : ""}` }));
  const templates = d.options.templates.map((t) => ({ version_id: t.version_id, label: `${t.name} (${LETTER_TYPE_LABEL[t.letter_type]})` }));
  return (
    <>
      <PageTitle title="Buat Surat" />
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{d.options.branch_name} · pasien kunjungan hari ini</p>
      {visits.length === 0 && <p role="status" className="m-0 text-[var(--label-2)]">Belum ada kunjungan hari ini di cabang ini.</p>}
      {templates.length === 0 && <p role="status" className="m-0 text-[var(--label-2)]">Belum ada templat surat aktif. Minta Admin Pusat atau Penanggung Jawab Klinik membuatnya.</p>}
      <section aria-label="Surat baru" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <NewLetterForm ctx={d.ctx} visits={visits} templates={templates} preset={visit && visits.some((v) => v.visit_id === visit) ? visit : null} />
      </section>
      {d.letters.length > 0 && (
        <section aria-label="Surat kunjungan ini" className="grid min-w-0 gap-2">
          <h2 className="m-0 text-[1.06rem] font-semibold">Surat kunjungan ini</h2>
          <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
            {d.letters.map((l) => (
              <li key={l.id}><Link href={`/templat/surat/${l.id}`} className="inline-flex min-h-[44px] items-center text-[var(--tint)]">{`${LETTER_TYPE_LABEL[l.letter_type]} · ${l.state === "signed" ? "ditandatangani" : "draf"}`}</Link></li>
            ))}
          </ul>
        </section>
      )}
      <Link href="/templat/surat" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Kembali ke Surat</Link>
    </>
  );
}

export default function BuatSuratPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
