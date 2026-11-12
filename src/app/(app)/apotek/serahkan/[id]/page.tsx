// Rincian Penyerahan (UX-10 row → prescription detail; T-065): patient (name, MRN, birth date, allergy cautions),
// the item and quantity, the prescription (prescriber, signed, valid until, signa, KFA), the FEFO batches, the label
// (etiket biru for external use) and Serahkan with the seven checks, or the recorded handover. "Tandai Keluhan
// Klinis" opens T-057's report preset to this visit (CLIN-024). Printing shows the label only.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadDispensing } from "../../data";
import { CancelForm, HandOverForm, LabelForm } from "../../forms";
import { BLOCKER_LABEL, CHECK_LABEL, STATE_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Rincian Penyerahan — Clinic Dashboard" };

const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadDispensing(id);
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden" || r.kind === "no-branch") return <PermissionState object="apotek" />;
  if (r.kind === "not-found") notFound();
  const d = r.d;
  const open = d.state === "queued" || d.state === "prepared";
  const batches = d.state === "handed" ? d.batches : d.suggestion ?? [];
  return (
    <>
      <PageTitle title={d.patient.name} />
      <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
        {d.patient.mrn && <span className="font-semibold">{d.patient.mrn}</span>}
        {d.birth_date && <span className={muted}>{`Lahir ${date(d.birth_date)}`}</span>}
        {d.source === "counter" && <span className={muted}>Penjualan langsung</span>}
        <StatusBadge tone={d.state === "handed" ? "success" : d.state === "cancelled" ? "locked" : "warning"}>{STATE_LABEL[d.state]}</StatusBadge>
      </p>
      {d.cautions.length > 0 && (
        <section aria-label="Alergi" className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--danger-soft)] p-4 text-[var(--danger)] print:hidden">
          <h2 className="m-0 text-[1.06rem] font-semibold">Alergi tercatat</h2>
          <ul className="m-0 grid gap-1 pl-5">{d.cautions.map((c) => <li key={c.fact_id} className="[overflow-wrap:anywhere]">{c.value}</li>)}</ul>
        </section>
      )}
      {open && d.blocker && <BlockedState reason={BLOCKER_LABEL[d.blocker]} unblock={d.blocker === "payment_unpaid" ? "Kasir menyelesaikan pembayaran" : d.blocker === "stock_unavailable" ? "Pilih depot lain atau lepaskan batch yang ditahan di Stok" : "Hubungi dokter penulis resep"} />}
      <section aria-label="Etiket" className={card}>
        <h2 className="m-0 text-[1.25rem] font-semibold [overflow-wrap:anywhere]">{`${d.item.name} · ${Number(d.quantity)} ${d.item.unit}`}</h2>
        {d.external_use && <p className="m-0 font-semibold text-[var(--tint)]">Etiket biru — obat luar, tidak untuk diminum</p>}
        {d.prescription && <p className="m-0 [overflow-wrap:anywhere]">{d.prescription.signa}</p>}
        <p className={muted}>{d.patient.mrn ? `Untuk ${d.patient.name} (${d.patient.mrn})` : `Untuk ${d.patient.name}`}</p>
        {batches.length > 0 && (
          <p className={muted}>{`${d.state === "handed" ? "Batch" : "Batch disarankan (FEFO)"}: ${batches.map((b) => `${b.batch_no}, kedaluwarsa ${date(b.expiry)} × ${Number(b.quantity)}`).join("; ")}`}</p>
        )}
      </section>
      {d.prescription && (
        <section aria-label="Resep" className={`${card} print:hidden`}>
          <h2 className="m-0 text-[1.25rem] font-semibold">Resep</h2>
          <p className="m-0 [overflow-wrap:anywhere]">{`Penulis resep: ${d.prescription.prescriber}${d.prescription.is_acute ? " · resep akut" : ""}`}</p>
          <p className={muted}>{d.prescription.signed_at ? `Ditandatangani ${when(d.prescription.signed_at)} · berlaku sampai ${when(d.prescription.valid_until!)}` : "Belum ditandatangani"}</p>
          {d.prescription.kfa_code && <p className={muted}>{`Kode KFA ${d.prescription.kfa_code}`}</p>}
        </section>
      )}
      {d.state === "queued" && <p className={`${muted} print:hidden`}>Belum disiapkan: pilih depot dan siapkan dari daftar Siapkan.</p>}
      {open && <LabelForm ctx={r.ctx} dispensing={d.id} external={d.external_use} printed={d.label?.print_count ?? 0} />}
      {d.label && <p className={`${muted} print:hidden`}>{`Etiket dicetak ${d.label.print_count}× · terakhir ${when(d.label.last_printed_at)}`}</p>}
      {d.state === "prepared" && <section aria-label="Penyerahan" className={`${card} print:hidden`}><HandOverForm ctx={r.ctx} dispensing={d.id} blocked={!!d.blocker} /></section>}
      {d.state === "handed" && d.checks && (
        <section aria-label="Penyerahan tercatat" className={`${card} print:hidden`}>
          <h2 className="m-0 text-[1.25rem] font-semibold">Penyerahan tercatat</h2>
          <p className={muted}>{`Diserahkan ${when(d.handed_at!)} oleh ${d.handed_by ?? "apoteker"}`}</p>
          <ul className="m-0 grid gap-1 pl-5">
            {(Object.keys(CHECK_LABEL) as (keyof typeof CHECK_LABEL)[]).map((c) => <li key={c}>{`${d.checks![c] ? "✓" : "✗"} ${CHECK_LABEL[c]}`}</li>)}
          </ul>
          {d.exception_note && <p className="m-0 [overflow-wrap:anywhere]">{`Pengecualian: ${d.exception_note}`}</p>}
        </section>
      )}
      {d.state === "cancelled" && <p className={muted}>{`Dibatalkan: ${d.cancel_reason}`}</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-2 print:hidden">
        {d.source !== "counter" && <Link href={`/keluhan/baru?visit=${d.patient.visit_id}`} className="inline-flex min-h-[var(--target)] items-center px-1 font-semibold text-[var(--tint)]">Tandai Keluhan Klinis</Link>}
        {open && <CancelForm ctx={r.ctx} dispensing={d.id} />}
      </div>
      <Link href={d.state === "queued" ? "/apotek/siapkan" : "/apotek/serahkan"} className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)] print:hidden">Kembali</Link>
    </>
  );
}

export default function RincianPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[900px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
