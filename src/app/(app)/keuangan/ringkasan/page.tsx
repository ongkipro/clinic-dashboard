// Ringkasan Keuangan (UX-22 ▸ Ringkasan, PR-33f; T-114): the route. The body, the role gate and the states are body.tsx / data.ts / load.ts; this file names the page,
// its metadata and the loading shell. Finance and owner only (the nav row "/keuangan/ringkasan"); a new page.tsx is a route surface the isolation gate counts: its
// DEL-2 case is tests/isolation/cases/ringkasan-keuangan.cases.ts. Settlement from the payment provider stays "Belum tersedia" (no settlement fact exists).
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { financeBody, type SearchParams, TITLE } from "./body";

export const metadata: Metadata = { title: "Ringkasan Keuangan — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return financeBody(searchParams);
}

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<ListPage as="section" title={TITLE} state={{ kind: "loading" }} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
