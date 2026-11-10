// Usul Permintaan (UX-27, 17:122, 17:137, PR-45; T-056): a clinical request for one of today's open visits at the
// branch that has an examination and an active plan (`?visit=` preselects it; the room and exam-sheet entries link
// here later). BC, doctor, nurse, therapist; a BC never sets a dose.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadNew } from "../data";
import { NewRequestForm } from "../forms";

export const metadata: Metadata = { title: "Usul Permintaan — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const visit = typeof q.visit === "string" ? q.visit : null;
  const d = await loadNew(visit);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="permintaan klinis" />;
  if (d.kind === "no-branch") return <><PageTitle title="Usul Permintaan" /><p role="status" className="m-0 text-[var(--label-2)]">Pilih cabang aktif di Saya › Ganti Cabang.</p></>;
  const plans = d.options.visits.flatMap((v) => v.plans.map((p) => ({ visit_id: v.visit_id, plan_id: p.plan_id, label: `${v.patient_name} · ${v.patient_mrn} · ${p.title}`, items: p.items })));
  return (
    <>
      <PageTitle title="Usul Permintaan" />
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{d.options.branch_name} · pasien hari ini dengan rencana tindakan</p>
      {plans.length === 0 && <p role="status" className="m-0 text-[var(--label-2)]">Belum ada pasien hari ini dengan pemeriksaan dan rencana tindakan aktif.</p>}
      <section aria-label="Permintaan baru" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <NewRequestForm ctx={d.ctx} plans={plans} catalog={d.options.catalog} preset={visit ? plans.find((p) => p.visit_id === visit)?.plan_id ?? null : null} canDose={d.options.role !== "bc"} />
      </section>
      <Link href="/permintaan" className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Kembali ke Permintaan Klinis</Link>
    </>
  );
}

export default function UsulPermintaanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
