// Pendampingan flow (UX-7, 17:115, PR-9, CLIN-001; T-051): one visit. Step header Intake & Foto → Dokter →
// Diskusi Pilihan → Konfirmasi from the visit's own step columns (steps 2–4 show their state; they are built by
// later tasks). Step 1: the intake form (draft, BC Pembimbing only) or the locked view once sent; the Foto
// panel is blocked until private clinical media (T-055). History: a column at ≥ 1180 px, "Riwayat Singkat"
// disclosure below that (the form stays mounted, so edits are kept).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { Fact } from "../../../../modules/clinical/intake/intake";
import { loadVisit } from "../data";
import { IntakeForm, OpenIntake } from "../forms";
import { CHIP_LABEL, FACT_LABEL, FACT_ORDER, STEP_STATE } from "../labels";

export const metadata: Metadata = { title: "Pendampingan — Clinic Dashboard" };

const date = (d: Date) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(d);
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

function History({ facts, visits }: { facts: Fact[]; visits: { visitId: string; sentAt: Date; complaint: string | null }[] }) {
  if (facts.length === 0 && visits.length === 0) return <p className={muted}>Belum ada kunjungan sebelumnya.</p>;
  return (
    <div className="grid min-w-0 gap-3">
      {facts.length > 0 && (
        <dl className="m-0 grid min-w-0 gap-2">
          {FACT_ORDER.filter((k) => facts.some((f) => f.kind === k)).map((k) => {
            const f = facts.find((x) => x.kind === k)!;
            return (
              <div key={k} className="grid min-w-0 gap-0.5">
                <dt className="font-semibold">{FACT_LABEL[k]}</dt>
                <dd className="m-0 [overflow-wrap:anywhere]">{f.value} <span className={muted}>· {f.sentAt ? date(f.sentAt) : ""} · belum diverifikasi dokter</span></dd>
              </div>
            );
          })}
        </dl>
      )}
      {visits.length > 0 && (
        <ul className="m-0 grid min-w-0 list-none gap-1 p-0" aria-label="Kunjungan sebelumnya">
          {visits.map((v) => <li key={v.visitId} className="[overflow-wrap:anywhere]"><span className={muted}>{date(v.sentAt)}</span> · {v.complaint}</li>)}
        </ul>
      )}
    </div>
  );
}

async function Body({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const d = await loadVisit(visitId);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="pendampingan" />;
  if (d.kind === "not-found") notFound();
  const { visit, patient, intake, history, visitsBefore } = d.page;
  const steps: [string, string][] = [
    ["Intake & Foto", STEP_STATE[visit.intake] ?? visit.intake],
    ["Dokter", visit.intake === "done" && visit.doctor === "not_started" ? "Menunggu pemeriksaan dokter" : STEP_STATE[visit.doctor] ?? visit.doctor],
    ["Diskusi Pilihan", STEP_STATE[visit.selection] ?? visit.selection],
    ["Konfirmasi", STEP_STATE[visit.payment] ?? visit.payment],
  ];
  const mine = intake?.authorId === d.staffId;
  const history_ = <History facts={history} visits={visitsBefore} />;
  return (
    <>
      <PageTitle title={patient.name} />
      <p className="m-0 font-semibold">{patient.mrn}{intake ? ` · BC Pembimbing ${intake.authorName}` : ""}</p>
      <ol aria-label="Langkah pendampingan" className="m-0 grid min-w-0 list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([label, state], i) => (
          <li key={label} aria-current={i === 0 ? "step" : undefined} className={`grid min-h-[52px] min-w-0 content-center gap-0.5 rounded-[var(--radius-field)] px-3 py-2 ${i === 0 ? "bg-[var(--accent)]" : "bg-[var(--surface-2)]"}`}>
            <span className="font-semibold">{i + 1}. {label}</span>
            <span className={muted}>{state}</span>
          </li>
        ))}
      </ol>
      <div className="grid min-w-0 gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-5">
          <details className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)] p-3 min-[1180px]:hidden">
            <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">Riwayat Singkat</summary>
            <div className="pt-2">{history_}</div>
          </details>
          <section aria-labelledby="foto-h" className="grid min-w-0 gap-2">
            <h2 id="foto-h" className="m-0 text-[1.18rem] font-semibold">Foto</h2>
            <BlockedState reason="Foto klinis belum tersedia" unblock="Pengambilan dan perbandingan foto aktif bersama penyimpanan foto klinis yang aman" />
          </section>
          <section aria-labelledby="intake-h" className="grid min-w-0 gap-3">
            <h2 id="intake-h" className="m-0 text-[1.18rem] font-semibold">Intake</h2>
            {visit.closed && !intake && <p className={muted}>Kunjungan sudah selesai.</p>}
            {!visit.closed && !intake && <OpenIntake ctx={d.ctx} visit={visit.id} label={patient.name} />}
            {intake && intake.state === "draft" && mine && !visit.closed && (
              <IntakeForm ctx={d.ctx} visit={visit.id} intake={intake.id} history={history}
                draft={{ complaint: intake.complaint, facts: intake.facts, reviewedPrior: intake.reviewedPrior, chips: intake.observation?.chips ?? [], note: intake.observation?.note ?? null }} />
            )}
            {intake && intake.state === "draft" && !mine && <p className={muted}>Intake ini sedang diisi {intake.authorName}. Hanya BC pembimbingnya yang mengubah.</p>}
            {intake && intake.state === "sent" && (
              <div className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
                <StatusBadge tone="locked">Terkirim ke dokter · terkunci</StatusBadge>
                <p className="m-0 [overflow-wrap:anywhere]"><strong>Keluhan:</strong> {intake.complaint}</p>
                {intake.facts.length > 0 && (
                  <ul className="m-0 grid list-none gap-1 p-0" aria-label="Fakta baru atau berubah">
                    {intake.facts.map((f) => <li key={f.id} className="[overflow-wrap:anywhere]"><strong>{FACT_LABEL[f.kind]}:</strong> {f.value} <span className={muted}>· belum diverifikasi</span></li>)}
                  </ul>
                )}
                {intake.reviewedPrior.length > 0 && <p className={muted}>{intake.reviewedPrior.length} riwayat dikonfirmasi sama seperti kunjungan lalu.</p>}
                {intake.observation && <p className="m-0"><strong>Observasi Kulit:</strong> {intake.observation.chips.map((c) => CHIP_LABEL[c]).join(", ")}{intake.observation.note ? ` · ${intake.observation.note}` : ""}</p>}
              </div>
            )}
          </section>
          <Link href="/pendampingan" className="inline-flex min-h-[44px] items-center text-[var(--tint)]">Kembali ke daftar pasien</Link>
        </div>
        <aside aria-labelledby="riwayat-h" className="hidden min-w-0 content-start gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4 min-[1180px]:grid">
          <h2 id="riwayat-h" className="m-0 text-[1.06rem] font-semibold">Riwayat</h2>
          {history_}
        </aside>
      </div>
    </>
  );
}

export default function PendampinganVisitPage({ params }: { params: Promise<{ visitId: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1180px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
