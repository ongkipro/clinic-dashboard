// Ringkasan Cabang (UX-21, PR-33b; T-110): the route. The body, the role gate and the states are body.tsx / data.ts / load.ts; this file names the page, its metadata and the
// loading shell. A page.tsx is a route surface the isolation gate counts: its DEL-2 case is tests/isolation/cases/ringkasan-cabang.cases.ts. BranchSummaryView renders the page's <main>.
import type { Metadata } from "next";
import { Suspense } from "react";
import { cabangBody, type SearchParams } from "./body";
import { BranchSummaryView } from "./view";

export const metadata: Metadata = { title: "Ringkasan Cabang — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return cabangBody(searchParams);
}

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<BranchSummaryView state={{ kind: "loading" }} />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
