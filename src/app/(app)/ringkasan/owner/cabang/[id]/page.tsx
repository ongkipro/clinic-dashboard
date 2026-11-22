// Detail cabang (UX-37, PR-33a; T-109): the same cards as Ringkasan Owner for ONE branch, from the consolidated readers' per-branch answers. Owner only. A branch id that
// is not one of this clinic's branches — another tenant's included — is not-found (TEN-1), never forbidden and never data.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../../../components/templates/templates";
import { LoadingList } from "../../../../../../components/ui/states";
import { leagueHref } from "../../compose";
import { loadDetail } from "../../data";
import { BranchDetail } from "../../view";

export const metadata: Metadata = { title: "Detail Cabang — Clinic Dashboard" };
type SP = Record<string, string | string[] | undefined>;

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const r = await loadDetail(id, { periode: typeof sp.periode === "string" ? sp.periode : undefined });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "not-found") notFound();
  if (r.kind !== "ok") return <ListPage as="section" title="Cabang" state={{ kind: "permission", object: "cabang" }} />;
  return <BranchDetail as="section" branch={r.branch.name} backHref={leagueHref(r.periods.kind)} period={{ label: r.periods.label, basis: r.periods.basis, previousLabel: r.periods.previousLabel }} state={{ kind: "ready", data: r.data }} />;
}

export default function CabangDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={6} label="Memuat cabang" />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
