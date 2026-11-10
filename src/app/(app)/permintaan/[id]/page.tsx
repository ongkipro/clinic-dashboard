// One clinical request (UX-27, PR-45; T-056): the card in full — type, patient, plan, the current and proposed item
// with dose (clinical readers), price impact, requester and reason, decision. The prominent Setujui and Tolak with a
// reason for an eligible decider; Batalkan for the requester while pending; the blocked reason otherwise; after an
// approval that opened the consent step, "Buka Persetujuan Tindakan".
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadDetail } from "../data";
import { CancelForm, DecideForm } from "../forms";
import { formatDose, KIND_LABEL, ROLE_LABEL, rupiah, STATE, UNIT_LABEL } from "../labels";

export const metadata: Metadata = { title: "Permintaan Klinis — Clinic Dashboard" };

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const card = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const dose = (m?: number | null, u?: string | null) => (m && u ? ` · ${formatDose(m)} ${UNIT_LABEL[u] ?? u}` : "");

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadDetail(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden" || d.kind === "no-branch") return <PermissionState object="permintaan klinis" />;
  if (d.kind === "not-found") notFound();
  const r = d.request;
  const st = STATE[r.state];
  const decider = d.role === "doctor" || d.role === "facility_head";
  return (
    <>
      <PageTitle title={r.patient_name} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold">{`${r.patient_mrn} · ${KIND_LABEL[r.kind]}`}</span>
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
      </div>
      <section aria-label="Rincian" className={card}>
        <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 [&>dd]:mb-2">
          <dt className={muted}>Rencana</dt><dd className="m-0 [overflow-wrap:anywhere]">{`${r.plan_title}${r.full && r.plan_condition ? ` · ${r.plan_condition}` : ""}`}</dd>
          {r.target_name && <><dt className={muted}>Item sekarang</dt><dd className="m-0">{`${r.target_name} × ${r.target_qty}${r.full ? dose(r.target_dose_micro, r.target_dose_unit) : ""}`}</dd></>}
          <dt className={muted}>{r.kind === "addition" ? "Item tambahan" : "Menjadi"}</dt>
          <dd className="m-0">{`Tahap ${r.stage} · ${r.item_name} × ${r.qty}${r.full ? dose(r.dose_micro, r.dose_unit) : ""}`}</dd>
          <dt className={muted}>Dampak harga</dt><dd className="m-0 tabular-nums">{rupiah(r.price_impact)} <span className={muted}>(perkiraan; pembayaran di kasir)</span></dd>
          <dt className={muted}>Diusulkan</dt><dd className="m-0">{`${r.requester_name} (${ROLE_LABEL[r.requested_as] ?? r.requested_as}) · ${when(r.requested_at)}`}</dd>
          {r.full && r.reason && <><dt className={muted}>Alasan</dt><dd className="m-0 [overflow-wrap:anywhere]">{r.reason}</dd></>}
          {r.decided_at && r.decider_name && <><dt className={muted}>Diputuskan</dt><dd className="m-0">{`${r.decider_name} · ${when(r.decided_at)}`}</dd></>}
          {r.full && r.decision_reason && <><dt className={muted}>Alasan penolakan</dt><dd className="m-0 [overflow-wrap:anywhere]">{r.decision_reason}</dd></>}
        </dl>
      </section>
      {r.state === "approved" && r.consent && r.consent !== "active" && (
        <Link href={`/persetujuan-tindakan/${r.visit_id}`} className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Buka Persetujuan Tindakan</Link>
      )}
      {/* Kept mounted after a decision or cancellation (the forms show their result; T-054 lesson). */}
      {(r.state === "pending" || decider || r.requested_by === d.staffId) && (
        <section aria-label="Keputusan" className={card}>
          {r.state === "pending" && !r.visit_open && <BlockedState reason="Kunjungan sudah ditutup" unblock="Permintaan baru dapat diusulkan pada kunjungan berikutnya" />}
          {r.state !== "pending" && <p className={muted}>{`Permintaan ${STATE[r.state].label.toLowerCase()}.`}</p>}
          {r.state === "pending" && r.visit_open && r.can_cancel && decider && <p className={muted}>Anda pengaju — tidak dapat memutuskan permintaan sendiri.</p>}
          {r.state === "pending" && r.visit_open && !decider && <p className={muted}>Hanya dokter atau penanggung jawab klinik cabang yang dapat memutuskan permintaan ini.</p>}
          <DecideForm ctx={d.ctx} request={r.id} visit={r.visit_id} prominent open={r.can_decide && r.visit_open} label={KIND_LABEL[r.kind]} />
          <CancelForm ctx={d.ctx} request={r.id} open={r.can_cancel} />
        </section>
      )}
      <Link href="/permintaan" className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Kembali ke Permintaan Klinis</Link>
    </>
  );
}

export default function PermintaanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[900px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
