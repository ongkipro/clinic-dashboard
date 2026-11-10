// Lembar Pemeriksaan (UX-8, 19:87–90, PR-10, CLIN-004, CLIN-012; T-052): one visit on one screen. Header with
// the patient, allergy cautions and active plans; at ≥ 1180 px three panes (Riwayat timeline · examination ·
// plans), below that a "Riwayat" disclosure (the forms stay mounted). The examination: today's intake with
// Benar / Koreksi per fact, SOAP with a template, vitals and ICD-10, the face & body map with a dose per
// point; plans in parallel with live prices. Later parts are shown with their state, not dead buttons:
// Foto & Bandingkan (T-055), consent (T-054), Tanda Tangani (T-053), Resep / Buat Surat / Kirim ke Kasir.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { Button } from "../../../../components/ui/button";
import type { Sheet } from "../../../../modules/clinical/exam/exam";
import { loadSheet } from "../data";
import { FaceMap, NewPlan, OpenExam, PlanCard, SoapForm, VerifyFact } from "../forms";
import { FACT_LABEL, formatDose, ICD10, SECTION_LABEL, TEMPLATE_FIELDS, TEMPLATE_LABEL, UNIT_LABEL, VITALS } from "../labels";

export const metadata: Metadata = { title: "Lembar Pemeriksaan — Clinic Dashboard" };

const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const h2 = "m-0 text-[1.18rem] font-semibold";
const card = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";

function Timeline({ earlier }: { earlier: Sheet["earlier"] }) {
  if (earlier.length === 0) return <p className={muted}>Belum ada kunjungan sebelumnya.</p>;
  return (
    <ol className="m-0 grid min-w-0 list-none gap-3 p-0" aria-label="Kunjungan sebelumnya">
      {earlier.map((x) => (
        <li key={x.visit_id} className="grid min-w-0 gap-0.5 border-l-2 border-[var(--separator)] pl-3">
          <span className="font-semibold">{date(x.checked_in_at)} <span className={muted}>· {x.branch_name}</span></span>
          {x.complaint && <span className="[overflow-wrap:anywhere]">Keluhan: {x.complaint}</span>}
          {x.assessment && <span className="[overflow-wrap:anywhere]">Asesmen: {x.assessment}</span>}
          {x.icd10_codes && x.icd10_codes.length > 0 && <span className={muted}>{x.icd10_codes.join(", ")}</span>}
          {x.author_name && <span className={muted}>Dokter {x.author_name}</span>}
        </li>
      ))}
    </ol>
  );
}

function ReadOnlyExam({ exam }: { exam: NonNullable<Sheet["examination"]> }) {
  const tpl = exam.template_key;
  return (
    <div className="grid min-w-0 gap-2">
      {tpl && <p className="m-0"><strong>Templat:</strong> {TEMPLATE_LABEL[tpl]} · {TEMPLATE_FIELDS[tpl].filter((f) => exam.template_values[f.key]).map((f) => `${f.label} ${exam.template_values[f.key]}`).join(", ")}</p>}
      {(Object.keys(SECTION_LABEL) as (keyof typeof SECTION_LABEL)[]).filter((k) => exam[k]).map((k) => (
        <p key={k} className="m-0 [overflow-wrap:anywhere]"><strong>{SECTION_LABEL[k]}:</strong> {exam[k]}</p>
      ))}
      {Object.keys(exam.vitals).length > 0 && <p className="m-0"><strong>Tanda vital:</strong> {VITALS.filter((v) => exam.vitals[v.key] != null).map((v) => `${v.label} ${exam.vitals[v.key]} ${v.unit}`).join(" · ")}</p>}
      {exam.icd10_codes.length > 0 && <p className="m-0"><strong>ICD-10:</strong> {exam.icd10_codes.map((c) => `${c} ${ICD10.find((x) => x[0] === c)?.[1] ?? ""}`).join(", ")}</p>}
      {exam.marks.length > 0 && <p className="m-0"><strong>Peta:</strong> {exam.marks.length} titik{exam.marks.some((m) => m.dose_micro != null) ? ` (${exam.marks.filter((m) => m.dose_micro != null).map((m) => `${formatDose(m.dose_micro!)} ${UNIT_LABEL[m.dose_unit!]}`).join(", ")})` : ""}</p>}
    </div>
  );
}

async function Body({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const d = await loadSheet(visitId);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="lembar pemeriksaan" />;
  if (d.kind === "not-found") notFound();
  const { visit, patient, cautions, intake, examination: exam, earlier, plans } = d.sheet;
  const editable = !!exam && d.isDoctor && exam.author_id === d.staffId && exam.state === "draft" && !visit.closed;
  const ids = exam ? { ctx: d.ctx, visit: visit.id, exam: exam.id } : null;
  const timeline = <Timeline earlier={earlier} />;
  return (
    <>
      <PageTitle title={patient.name} />
      <div className="grid min-w-0 gap-2">
        <p className="m-0 font-semibold">{patient.mrn}{exam ? ` · Dokter ${exam.author_name}` : ""}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Peringatan dan rencana aktif">
          {cautions.length === 0 ? <StatusBadge tone="neutral">Tidak ada alergi tercatat</StatusBadge>
            : cautions.map((c) => <StatusBadge key={c.fact_id} tone="danger">{`Alergi: ${c.value}${c.provenance === "clinician_verified" ? " (diverifikasi)" : " (belum diverifikasi)"}`}</StatusBadge>)}
          {plans.map((p) => <StatusBadge key={p.id} tone="success">{`Rencana aktif: ${p.title}`}</StatusBadge>)}
        </div>
      </div>
      <div className="grid min-w-0 gap-5 min-[1180px]:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside aria-labelledby="riwayat-h" className={`hidden content-start ${card} min-[1180px]:grid`}>
          <h2 id="riwayat-h" className="m-0 text-[1.06rem] font-semibold">Riwayat</h2>
          {timeline}
        </aside>
        <div className="grid min-w-0 content-start gap-5">
          <details className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)] p-3 min-[1180px]:hidden">
            <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">Riwayat ({earlier.length} kunjungan)</summary>
            <div className="pt-2">{timeline}</div>
          </details>
          <section aria-labelledby="intake-h" className="grid min-w-0 gap-3">
            <h2 id="intake-h" className={h2}>Intake dari BC</h2>
            {!intake || intake.state !== "sent" ? <p className={muted}>Intake belum dikirim BC.</p> : (
              <div className={card}>
                <p className="m-0 [overflow-wrap:anywhere]"><strong>Keluhan:</strong> {intake.complaint}</p>
                <p className={muted}>Dicatat oleh BC {intake.author_name} · belum diverifikasi sampai ditandai dokter</p>
                {intake.observation && intake.observation.chips.length > 0 && <p className="m-0"><strong>Observasi Kulit:</strong> {intake.observation.chips.join(", ").replaceAll("_", " ")}{intake.observation.note ? ` · ${intake.observation.note}` : ""}</p>}
                {intake.facts.length === 0 ? <p className={muted}>Tidak ada fakta baru.</p> : (
                  <ul className="m-0 grid min-w-0 list-none gap-3 p-0" aria-label="Fakta intake">
                    {intake.facts.map((f) => (
                      <li key={f.id} className="grid min-w-0 gap-2 border-t border-[var(--separator)] pt-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="min-w-0 grow basis-[12rem] [overflow-wrap:anywhere]"><strong>{FACT_LABEL[f.kind]}:</strong> {f.value}{f.prior ? " (kunjungan lalu)" : ""}</span>
                          {f.verification ? (
                            <StatusBadge tone="success">{f.verification.decision === "confirmed" ? "Benar" : `Dikoreksi: ${f.verification.corrected_value}`}</StatusBadge>
                          ) : <StatusBadge tone="warning">Belum diverifikasi</StatusBadge>}
                        </div>
                        {ids && editable && <VerifyFact ids={ids} fact={f} label={FACT_LABEL[f.kind]} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          <section aria-labelledby="foto-h" className="grid min-w-0 gap-2">
            <h2 id="foto-h" className={h2}>Foto & Bandingkan</h2>
            <BlockedState reason="Foto klinis belum tersedia" unblock="Pengambilan dan perbandingan foto aktif bersama penyimpanan foto klinis yang aman" />
          </section>
          <section aria-labelledby="periksa-h" className="grid min-w-0 gap-3">
            <h2 id="periksa-h" className={h2}>Pemeriksaan</h2>
            {!exam && (visit.closed ? <p className={muted}>Kunjungan sudah selesai tanpa pemeriksaan.</p>
              : d.isDoctor ? <OpenExam ctx={d.ctx} visit={visit.id} label={patient.name} />
              : <p className={muted}>Pemeriksaan belum dimulai dokter.</p>)}
            {exam && ids && editable && <div className={card}><SoapForm ids={ids} exam={exam} /></div>}
            {exam && !editable && <div className={card}>
              <StatusBadge tone="locked">{d.isDoctor && exam.author_id !== d.staffId ? `Diperiksa ${exam.author_name}` : "Draf pemeriksaan"}</StatusBadge>
              <ReadOnlyExam exam={exam} />
            </div>}
          </section>
          {exam && ids && (
            <section aria-labelledby="peta-h" className="grid min-w-0 gap-3">
              <h2 id="peta-h" className={h2}>Peta Wajah & Tubuh</h2>
              <FaceMap ids={ids} marks={exam.marks} catalog={d.catalog} editable={editable} />
            </section>
          )}
          {exam && (
            <section aria-labelledby="lanjut-h" className={card}>
              <h2 id="lanjut-h" className="m-0 text-[1.06rem] font-semibold">Langkah berikutnya</h2>
              <p className={muted}>Persetujuan tindakan: tampil di sini setelah formulir persetujuan aktif.</p>
              <p className={muted}>Resep, Buat Surat dan Kirim ke Kasir tersedia di tahap berikutnya.</p>
              <Button type="button" size="lg" aria-disabled="true" aria-describedby="ttd-why">Tanda Tangani</Button>
              <p id="ttd-why" className={muted}>Penandatanganan rekam medis (PIN/OTP) belum aktif. Draf tersimpan dan tetap bisa diubah dokter pemeriksanya.</p>
            </section>
          )}
          <Link href="/pemeriksaan" className="inline-flex min-h-[44px] items-center text-[var(--tint)]">Kembali ke antrean</Link>
        </div>
        <aside aria-labelledby="rencana-h" className="grid min-w-0 content-start gap-3">
          <h2 id="rencana-h" className={h2}>Rencana Perawatan</h2>
          {plans.length === 0 && <p className={muted}>Belum ada rencana aktif.</p>}
          {plans.map((p) => ids ? <PlanCard key={p.id} ids={ids} plan={p} catalog={d.catalog} editable={editable} />
            : <PlanCard key={p.id} ids={{ ctx: d.ctx, visit: visit.id, exam: visit.id }} plan={p} catalog={d.catalog} editable={false} />)}
          {ids && editable && <NewPlan ids={ids} />}
        </aside>
      </div>
    </>
  );
}

export default function LembarPemeriksaanPage({ params }: { params: Promise<{ visitId: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1440px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
