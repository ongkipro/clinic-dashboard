// Ringkasan CS (UX-36, PR-33e; T-113): the route. The body, the role gate and the states are body.tsx / data.ts / load.ts; this file names the page, its metadata and the loading shell. Central CS only
// (the nav row "/ringkasan/cs"); a new page.tsx is a route surface the isolation gate counts: its DEL-2 case is tests/isolation/cases/ringkasan-cs.cases.ts.
import type { Metadata } from "next";
import { Suspense } from "react";
import { Main } from "../../kasir/frame";
import { csBody, type SearchParams } from "./body";
import { CsSummary } from "./view";

export const metadata: Metadata = { title: "Ringkasan CS — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return csBody(searchParams);
}

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Main>
      <Suspense fallback={<CsSummary as="section" scope="" state={{ kind: "loading" }} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Main>
  );
}
