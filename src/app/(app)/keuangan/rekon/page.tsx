// Rekonsiliasi (UX-22 ▸ Rekon, 17 :187, 19 :180, PR-34; T-108): the page. PARKED until the DEL-2 case tests/isolation/cases/rekon.cases.ts is
// approved (a new page.tsx is a route surface the isolation gate counts). Target path: src/app/(app)/keuangan/rekon/page.tsx.
// data.ts gates the role (owner, finance, auditor) before the tenant transaction; load.ts is the core the isolation case runs; view.tsx renders.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { loadRekon } from "./data";
import { Rekon } from "./view";

export const metadata: Metadata = { title: "Rekonsiliasi — Clinic Dashboard" };
type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const TITLE = "Rekonsiliasi";

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const sp = await searchParams;
  const r = await loadRekon({ dari: one(sp.dari), sampai: one(sp.sampai), cabang: one(sp.cabang) });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "not-found") notFound(); // another tenant's branch id (TEN-1)
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "rekonsiliasi" }} />;
  return <Rekon as="section" {...r.props} />;
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<ListPage as="section" title={TITLE} state={{ kind: "loading" }} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
