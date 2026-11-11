// Ceklis Tindakan (UX-9, 19:103-104; T-064): header (room, timer, patient, treatment, VisitTrack); per item either
// "Sebelum mulai" (identity, consent/payment/exam readiness from the database, materials, performer → Mulai), or the
// running execution (stage stepper, Jeda/Lanjut, Bahan Tambahan, Usul Tindakan Tambahan, Selesai Tindakan with four
// outcomes and material deviations only), or the recorded outcome. The timer end never completes anything.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { VisitTrack } from "../../../../components/visit-track/visit-track";
import { STAGES, type TreatmentView } from "../../../../modules/treatment/treatment";
import { loadDetail } from "../data";
import { ExtraMaterialForm, FinishForm, StageTimer, StartForm, TimerControls } from "../forms";
import { BLOCKER_LABEL, OUTCOME_LABEL, STAGE_LABEL, STATE_LABEL } from "../labels";
import { track } from "../track";

export const metadata: Metadata = { title: "Ceklis Tindakan — Clinic Dashboard" };

const card = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

// The materials of an item for the finish sheet: per request line still open on the item (T-062 ledger).
function linesOf(view: TreatmentView, planItem: string, linked: string | null) {
  return view.material_requests
    .filter((r) => r.state === "issued" && (r.id === linked || r.plan_item_id === planItem))
    .flatMap((r) => r.lines.map((l) => ({
      request: r.id, item: l.item_id, name: l.name, unit: l.unit,
      issued: l.batches.reduce((t, b) => t + b.issued, 0), open: l.batches.reduce((t, b) => t + b.free, 0),
    })));
}

// The issued, unconsumed requests an item may link at Mulai: its own first, then visit-level ones, never one already
// linked to another item's execution (impl review 8f69b344 note).
function startable(view: TreatmentView, planItem: string) {
  const linked = new Set(view.items.map((x) => x.execution?.material_request_id).filter(Boolean));
  return view.material_requests
    .filter((r) => r.state === "issued" && !r.consumed_at && !linked.has(r.id) && (r.plan_item_id === planItem || r.plan_item_id === null))
    .sort((a, b) => Number(b.plan_item_id === planItem) - Number(a.plan_item_id === planItem))
    .map((r) => ({ id: r.id, name: r.room_depot }));
}

async function Body({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const d = await loadDetail(visitId);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden" || d.kind === "no-branch") return <PermissionState object="ruang tindakan" />;
  if (d.kind === "not-found") notFound();
  const v = d.view;
  const t = track({ steps: v.visit.steps, closed: v.visit.closed, blocker: v.visit.blocker });
  const running = v.items.find((i) => i.execution && i.execution.state !== "finished");
  const roomName = (id: string | null | undefined) => v.rooms.find((r) => r.id === id)?.name;
  return (
    <>
      <PageTitle title={v.patient.name} />
      <header aria-label="Ringkasan tindakan" className="grid min-w-0 gap-2">
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold">{v.patient.mrn}</span>
          {running && <span className={muted}>{roomName(running.execution!.room_id) ?? "Ruang belum ditentukan"}</span>}
          {running && <span className={muted}>{`${running.name} · ${STAGE_LABEL[running.execution!.stage]}`}</span>}
        </p>
        {running && <StageTimer stageStartedAt={running.execution!.stage_started_at} pausedAt={running.execution!.paused_at} serverNow={v.now} />}
        {t.blocker ? <VisitTrack states={t.states} blocker={t.blocker} /> : <VisitTrack states={t.states} />}
      </header>
      {v.visit.closed && <BlockedState reason="Kunjungan sudah ditutup" unblock="Tindakan baru dicatat pada kunjungan berikutnya" />}
      {v.items.length === 0 && <p className={muted}>Belum ada item rencana tindakan untuk pasien ini.</p>}
      {v.items.map((i) => {
        const e = i.execution;
        return (
          <section key={i.plan_item_id} aria-label={i.name} className={card}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="m-0 text-[1.25rem] font-semibold [overflow-wrap:anywhere]">{i.name}</h2>
              {!e && <StatusBadge tone={i.blockers.length ? "blocked" : "neutral"}>{i.blockers.length ? "Belum siap" : "Siap dimulai"}</StatusBadge>}
              {e && e.state !== "finished" && <StatusBadge tone="warning">{`${STATE_LABEL[e.state]} · ${STAGE_LABEL[e.stage]}`}</StatusBadge>}
              {e?.state === "finished" && e.outcome && <StatusBadge tone={e.counted ? "success" : "locked"}>{OUTCOME_LABEL[e.outcome]}</StatusBadge>}
            </div>
            {!e && i.blockers.length > 0 && (
              // long words ("ditandatangani") at 200 % text must wrap inside the card (overflow-wrap is inherited)
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <BlockedState reason={i.blockers.map((b) => BLOCKER_LABEL[b] ?? b).join("; ")} unblock="Dokter, kasir, atau front office menyelesaikannya lebih dulu" />
              </div>
            )}
            {!e && !v.visit.closed && (
              <StartForm ctx={d.ctx} visit={v.visit.id} item={{ id: i.plan_item_id, name: i.name }} performers={i.performers} supervisors={v.supervisors}
                assistants={v.assistants} rooms={v.rooms} blockers={i.blockers} me={d.staffId}
                requests={startable(v, i.plan_item_id)} />
            )}
            {e && e.state !== "finished" && (
              <>
                <p className={muted}>{`Mulai ${when(e.started_at)}${e.state === "paused" ? " · dijeda" : ""}`}</p>
                <ol aria-label="Tahap" className="m-0 flex min-w-0 list-none flex-wrap gap-2 p-0">
                  {STAGES.map((s) => (
                    <li key={s} aria-current={s === e.stage ? "step" : undefined}
                      className={`rounded-full px-3 py-1 text-[0.88rem] ${s === e.stage ? "bg-[var(--tint)] text-[var(--on-tint)]" : STAGES.indexOf(s) < STAGES.indexOf(e.stage) ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--neutral-soft)] text-[var(--label-2)]"}`}>
                      {STAGE_LABEL[s]}
                    </li>
                  ))}
                </ol>
                <TimerControls ctx={d.ctx} execution={e.id} stage={e.stage} paused={e.state === "paused"} stages={STAGES} />
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  <ExtraMaterialForm ctx={d.ctx} visit={v.visit.id} item={i.plan_item_id} depots={v.room_depots} stock={v.stock_items} />
                  <Link href={`/permintaan/baru?visit=${v.visit.id}`} className="inline-flex min-h-[var(--target)] items-center px-5 font-semibold text-[var(--tint)]">Usul Tindakan Tambahan</Link>
                </div>
                <FinishForm ctx={d.ctx} execution={e.id} lines={linesOf(v, i.plan_item_id, e.material_request_id)} />
              </>
            )}
            {e?.state === "finished" && (
              <p className={muted}>{`Selesai ${when(e.finished_at!)}${e.stop_reason ? ` · ${e.stop_reason}` : ""}`}</p>
            )}
          </section>
        );
      })}
      {v.open_vials.length > 0 && (
        <section aria-label="Vial terbuka di ruang" className={card}>
          <h2 className="m-0 text-[1.25rem] font-semibold">Sisa vial di ruang</h2>
          <ul className="m-0 grid gap-1 pl-5">
            {v.open_vials.map((o) => <li key={`${o.batch_id}:${o.depot_id}`}>{`${o.remaining} tersisa · pakai sebelum ${when(o.use_by)}${o.lapsed ? " · lewat batas pakai" : ""}`}</li>)}
          </ul>
        </section>
      )}
      <Link href="/ruang" className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Kembali ke Ruang Tindakan</Link>
    </>
  );
}

export default function CeklisPage({ params }: { params: Promise<{ visitId: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[900px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
