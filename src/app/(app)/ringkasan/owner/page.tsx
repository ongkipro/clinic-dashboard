// Ringkasan Owner (UX-20, 19 §2.1, PR-33a; T-109): the owner's consolidated summary, or one branch with ?cabang=. Owner only (nav "O"); the loader checks the
// role before the tenant transaction and every figure comes from an existing reader in the request's own context (data.ts). A figure no reader can prove
// shows "Belum tersedia" with its reason, never Rp0; a link exists only where a built page explains the value (HREFS).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { leagueHref } from "./compose";
import { loadSummary } from "./data";
import { OwnerSummary } from "./view";

export const metadata: Metadata = { title: "Ringkasan Owner — Clinic Dashboard" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function Body({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = { periode: one(sp.periode), cabang: one(sp.cabang) };
  const r = await loadSummary(q);
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "not-found") notFound();
  if (r.kind !== "ok") return <ListPage as="section" title="Ringkasan" state={{ kind: "permission", object: "ringkasan owner" }} />;
  const bulan = r.periods.kind === "bulan";
  const keep = r.scope.filtered && q.cabang ? `&cabang=${q.cabang}` : "";
  return (
    <>
      <nav aria-label="Periode" className="flex min-w-0 flex-wrap gap-4">
        {([["minggu", "Minggu ini"], ["bulan", "Bulan ini"]] as const).map(([k, label]) => (
          <Link key={k} href={`/ringkasan/owner?periode=${k}${keep}`} prefetch={false} aria-current={(k === "bulan") === bulan ? "true" : undefined}
            className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)] no-underline aria-[current=true]:text-[var(--label)]">{label}</Link>
        ))}
      </nav>
      <OwnerSummary as="section" scope={r.scope} period={{ label: r.periods.label, basis: r.periods.basis, previousLabel: r.periods.previousLabel }}
        leagueHref={leagueHref(r.periods.kind)} league={r.league} state={{ kind: "ready", data: r.data }} />
    </>
  );
}

export default function RingkasanOwnerPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={6} label="Memuat ringkasan" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
