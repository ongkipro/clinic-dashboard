// Laporan › Kamus KPI (UX-59, PR-95, 19 §2.13; T-116): the route. Static dictionary (K1–K27) behind the role gate of its nav row; the entries carry the anchors `#k<n>` that every
// report's "Definisi Kn" link opens (Scenario PR-95); `?laporan=<id>` filters by report. It reads no tenant data, so there is no tenant transaction (data.ts is the gate only).
// The body is body.tsx (a page file may export only its default and metadata).
import type { Metadata } from "next";
import { Suspense } from "react";
import { kamusBody, type SearchParams } from "./body";
import { KamusKpiView } from "./view";

export const metadata: Metadata = { title: "Kamus KPI — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return kamusBody(searchParams);
}

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<KamusKpiView state={{ kind: "loading" }} />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
