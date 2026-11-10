// Laporkan Keluhan (UX-28, PR-43, CLIN-024; T-057): a complaint from today's visit at the branch. `?visit=`
// preselects the patient (from the visit pages); the central CS chooses the branch (`?cabang=`). Handlers and
// other flaggers alike; the therapist and others get the permission state.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadFlag } from "../data";
import { FlagForm } from "../forms";

export const metadata: Metadata = { title: "Laporkan Keluhan — Clinic Dashboard" };

const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadFlag(typeof q.cabang === "string" ? q.cabang : null);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="keluhan" />;
  if (d.kind === "no-branch") return <><PageTitle title="Laporkan Keluhan" /><p role="status" className="m-0 text-[var(--label-2)]">Pilih cabang aktif di Saya › Ganti Cabang.</p></>;
  const kinds: ("klinis" | "layanan")[] = d.role === "manager" ? ["layanan"] : ["klinis", "layanan"];
  const visits = d.options.visits.map((v) => ({ ...v, time: time(v.checked_in_at) }));
  return (
    <>
      <PageTitle title="Laporkan Keluhan" />
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{d.options.branch_name} · pasien kunjungan hari ini</p>
      {d.branches.length > 1 && (
        <nav aria-label="Cabang" className="flex min-w-0 flex-wrap gap-2">
          {d.branches.map((b) => (
            <Link key={b.id} href={`/keluhan/baru?cabang=${b.id}`} aria-current={b.id === d.options.branch_id ? "true" : undefined}
              className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-2)] px-4 text-[var(--label)] no-underline aria-[current=true]:font-semibold">{b.name}</Link>
          ))}
        </nav>
      )}
      {visits.length === 0 && <p role="status" className="m-0 text-[var(--label-2)]">Belum ada kunjungan hari ini di cabang ini.</p>}
      <section aria-label="Formulir keluhan" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <FlagForm ctx={d.ctx} visits={visits} preset={typeof q.visit === "string" ? q.visit : null} kinds={kinds}
          pharmacist={d.role === "pharmacist"} branch={d.branches.length ? d.options.branch_id : null} />
      </section>
      <Link href="/keluhan" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Kembali ke Keluhan</Link>
    </>
  );
}

export default function BaruPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
