// Keluhan detail (UX-28, PR-43; T-057): one task. A handler of the kind sees the summary, the resolution and the
// notes, and acts: Tangani, Ubah Triase (klinis), Catatan, Selesaikan, Buka Kembali. A flagger outside the
// handlers sees the status and the history without notes.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadDetail } from "../data";
import { NoteForm, ReopenForm, ResolveForm, TakeForm, TriageForm } from "../forms";
import { CATEGORY_LABEL, EVENT_LABEL, KIND_LABEL, OUTCOME_LABEL, ROLE_LABEL, SOURCE_LABEL, STATE, TRIAGE } from "../labels";

export const metadata: Metadata = { title: "Keluhan — Clinic Dashboard" };

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const card = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadDetail(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="keluhan" />;
  if (d.kind === "not-found" || d.kind === "no-branch") notFound();
  const t = d.task;
  const st = STATE[t.state];
  return (
    <>
      <PageTitle title={t.patient_name} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold">{t.patient_mrn} · Keluhan {KIND_LABEL[t.kind]}</span>
        {t.triage && <StatusBadge tone={TRIAGE[t.triage].tone}>{`Triase ${TRIAGE[t.triage].label}`}</StatusBadge>}
        {t.category && <StatusBadge tone="neutral">{CATEGORY_LABEL[t.category]}</StatusBadge>}
        {t.overdue && <StatusBadge tone="danger">Lewat target</StatusBadge>}
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
      </div>
      <section aria-label="Ringkasan" className={card}>
        <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 [&>dd]:mb-2">
          <dt className={muted}>Cabang</dt><dd className="m-0">{t.branch_name}</dd>
          <dt className={muted}>Dilaporkan</dt><dd className="m-0">{`${when(t.created_at)} · ${t.flagged_by_name} (${ROLE_LABEL[t.flagged_as] ?? t.flagged_as}) · ${SOURCE_LABEL[t.source]}`}</dd>
          <dt className={muted}>Target respons</dt><dd className="m-0">{when(t.due_at)}</dd>
          <dt className={muted}>Ditangani oleh</dt><dd className="m-0">{t.assigned_to_name ?? "Belum ada"}</dd>
          {t.resolved_at && <><dt className={muted}>Selesai</dt><dd className="m-0">{when(t.resolved_at)}</dd></>}
          {t.content && <><dt className={muted}>Keluhan</dt><dd className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{t.summary}</dd></>}
          {t.content && t.resolution_outcome && <><dt className={muted}>Hasil</dt><dd className="m-0 [overflow-wrap:anywhere]">{`${OUTCOME_LABEL[t.resolution_outcome]}: ${t.resolution_note}`}</dd></>}
        </dl>
        {!t.content && <p className={muted}>Isi keluhan dan penanganannya hanya terlihat oleh tim yang menangani.</p>}
      </section>
      {t.handler && (
        <section aria-label="Penanganan" className={card}>
          <h2 className="m-0 text-[1.06rem] font-semibold">Penanganan</h2>
          {/* Forms stay mounted across state changes so each result shows (T-054 lesson). */}
          <TakeForm ctx={d.ctx} task={t.id} open={t.state === "open"} />
          {t.kind === "klinis" && <TriageForm ctx={d.ctx} task={t.id} current={t.triage!} open={t.state !== "resolved"} />}
          <NoteForm ctx={d.ctx} task={t.id} />
          <ResolveForm ctx={d.ctx} task={t.id} kind={t.kind} done={t.state === "resolved"} />
          <ReopenForm ctx={d.ctx} task={t.id} open={t.state === "resolved"} />
        </section>
      )}
      <section aria-label="Riwayat" className={card}>
        <h2 className="m-0 text-[1.06rem] font-semibold">Riwayat</h2>
        <ol className="m-0 grid min-w-0 list-none gap-3 p-0">
          {t.events.map((e) => (
            <li key={e.id} className="grid min-w-0 gap-1">
              <span className="font-semibold">{EVENT_LABEL[e.kind]}</span>
              <span className={muted}>{`${when(e.created_at)}${e.actor_name ? ` · ${e.actor_name}` : " · sistem"}`}</span>
              {e.note && <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{e.note}</span>}
            </li>
          ))}
        </ol>
      </section>
      <Link href="/keluhan" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Kembali ke Keluhan</Link>
    </>
  );
}

export default function KeluhanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[900px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
