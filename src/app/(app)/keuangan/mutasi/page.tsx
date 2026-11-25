// Mutasi Pembayaran page (UX-22 ▸ Mutasi, 19 §2.11, PR-33f).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { todayJakarta } from "./data";
import { MUTASI_TITLE } from "./labels";
import { loadMutasiPage } from "./server";
import { MutasiView } from "./view";

export const metadata: Metadata = { title: `${MUTASI_TITLE} — Clinic Dashboard` };

async function Body({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const res = await loadMutasiPage(await searchParams);
  if (res.kind === "redirect") redirect(res.to);
  if (res.kind === "not-found") notFound();
  if (res.kind === "forbidden") {
    return <ListPage as="section" title={MUTASI_TITLE} state={{ kind: "permission", object: "mutasi pembayaran" }} />;
  }
  return <MutasiView data={res.data} today={todayJakarta()} />;
}

export default function MutasiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={6} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
