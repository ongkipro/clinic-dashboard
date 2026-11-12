// Insiden detail (UX-28 ▸ Insiden, 17:188, PR-82; T-068): what was reported, the officer, investigation and root cause,
// the reporting determination (recipient and deadline as the clinic verified them) and submission evidence, the
// corrective action and closure, and the history. The facility head handles in order: Tangani → Investigasi →
// Keputusan Pelaporan (→ Bukti Kirim) → Tutup ("Investigasi belum selesai" until it is). A reporter sees the state only.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadIncident } from "../data";
import { CloseForm, DetermineForm, InvestigateForm, SubmitForm, TakeForm } from "../forms";
import { CLASS_LABEL, day, EVENT, ROLE_LABEL, STATE, when } from "../labels";

export const metadata: Metadata = { title: "Insiden — Clinic Dashboard" };
const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[0.88rem] text-[var(--label-2)]">{label}</dt>
      <dd className="m-0 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadIncident(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="insiden keselamatan pasien" />;
  if (d.kind !== "ok") return <p className="m-0">Insiden tidak ditemukan.</p>;
  const i = d.incident;
  const full = i.officer_name !== undefined || i.investigation !== undefined || i.state === "reported" && i.can_handle;
  const blocked = i.can_handle && i.state === "investigating" && (!i.investigated_at || i.report_required === undefined || (i.report_required && !i.submitted_at));
  return (
    <>
      <Link href="/keluhan/insiden" className="inline-flex min-h-[var(--target)] items-center justify-self-start text-[var(--tint)] no-underline">‹ Insiden</Link>
      <header className="grid min-w-0 gap-2">
        <h1 className="m-0 text-[2rem] font-bold leading-tight [overflow-wrap:anywhere]">{`${CLASS_LABEL[i.classification].long}`}</h1>
        <span className="flex min-w-0 flex-wrap gap-1">
          <StatusBadge tone={STATE[i.state].tone}>{STATE[i.state].label}</StatusBadge>
          {i.can_handle && i.state === "investigating" && !i.investigated_at && <StatusBadge tone="warning">Investigasi belum selesai</StatusBadge>}
        </span>
      </header>
      <section aria-label="Laporan" className={card}>
        <h2 className="m-0 text-[1.25rem] font-semibold">Laporan</h2>
        <dl className="m-0 grid min-w-0 gap-3">
          <Field label="Waktu kejadian" value={when(i.occurred_at)} />
          {i.patient_name && <Field label="Pasien" value={i.patient_id ? <Link href={`/pasien/${i.patient_id}`} className="inline-flex min-h-[var(--target)] items-center text-[var(--tint)]">{`${i.patient_name} · ${i.patient_mrn}`}</Link> : i.patient_name} />}
          {!i.patient_name && i.has_patient && <Field label="Pasien" value="Tercatat (tidak ditampilkan untuk peran ini)" />}
          <Field label="Ringkasan" value={i.summary} />
          <Field label="Tindakan segera" value={i.immediate_response} />
          <Field label="Pelapor" value={`${i.reported_name} (${ROLE_LABEL[i.reported_as] ?? i.reported_as}), ${when(i.reported_at)}`} />
        </dl>
      </section>
      {full && (
        <section aria-label="Penanganan" className={card}>
          <h2 className="m-0 text-[1.25rem] font-semibold">Penanganan</h2>
          <dl className="m-0 grid min-w-0 gap-3">
            <Field label="Petugas penanggung jawab" value={i.officer_name ?? "Belum ditangani"} />
            {i.investigation && <Field label="Hasil investigasi" value={i.investigation} />}
            {i.root_cause && <Field label="Akar masalah" value={i.root_cause} />}
            {i.report_required !== undefined && (
              <Field label="Keputusan pelaporan" value={i.report_required ? `Dilaporkan ke ${i.report_recipient}, paling lambat ${day(i.report_due_on!)}` : "Tidak perlu dilaporkan ke pihak luar"} />
            )}
            {i.submitted_at && <Field label="Bukti kirim" value={`${i.submission_ref}, ${when(i.submitted_at)}`} />}
            {i.corrective_action && <Field label="Tindakan korektif" value={i.corrective_action} />}
            {i.closed_at && <Field label="Ditutup" value={when(i.closed_at)} />}
          </dl>
          {blocked && <p className={muted}>{!i.investigated_at ? "Investigasi belum selesai." : i.report_required === undefined ? "Keputusan pelaporan belum dicatat." : "Bukti kirim laporan belum dicatat."} Insiden ditutup setelah langkah ini.</p>}
        </section>
      )}
      {i.can_handle && (
        <div className="flex min-w-0 flex-wrap gap-2">
          {i.state === "reported" && <TakeForm ctx={d.ctx} incident={i.id} />}
          {i.state === "investigating" && !i.investigated_at && <InvestigateForm ctx={d.ctx} incident={i.id} />}
          {i.state === "investigating" && i.report_required === undefined && <DetermineForm ctx={d.ctx} incident={i.id} />}
          {i.state === "investigating" && i.report_required && !i.submitted_at && <SubmitForm ctx={d.ctx} incident={i.id} />}
          {i.state === "investigating" && !blocked && <CloseForm ctx={d.ctx} incident={i.id} />}
        </div>
      )}
      <section aria-label="Riwayat" className={card}>
        <h2 className="m-0 text-[1.25rem] font-semibold">Riwayat</h2>
        <ol className="m-0 grid gap-1 pl-5">
          {i.events.map((e, k) => <li key={k} className="[overflow-wrap:anywhere]">{`${EVENT[e.kind]} · ${e.actor_name} (${ROLE_LABEL[e.actor_as] ?? e.actor_as}) · ${when(e.at)}`}</li>)}
        </ol>
      </section>
    </>
  );
}

export default function InsidenDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
