// Cabang (UX-37, 17:247, PR-33a; T-109): the owner's branch league, sortable by K1, K2, K7, K8, K9, K10, K11, K12, K16 and K17 (?urut=), every branch of the clinic from the
// consolidated readers' per-branch answers. Owner only. A figure no reader can prove for a branch (K17 while a commission payment is unallocated) is "Belum tersedia" with
// its reason and sorts after the known ones — never Rp0 and never a prorated share. The nav's Owner "Cabang" tab still points at /ringkasan/cabang (T-110 hosts this
// league there for the owner at integration), so this route is linked from the Ringkasan Owner card.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingList } from "../../../../../components/ui/states";
import { sortHrefs } from "../compose";
import { loadLeague } from "../data";
import { LEAGUE_KEYS, type LeagueKey } from "../model";
import { BranchLeague } from "../view";

export const metadata: Metadata = { title: "Cabang — Clinic Dashboard" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function Body({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const r = await loadLeague({ periode: one(sp.periode) });
  if (r.kind === "redirect") redirect(r.to);
  const view = { label: r.kind === "ok" ? r.periods.label : "", basis: r.kind === "ok" ? r.periods.basis : "", previousLabel: "" };
  if (r.kind !== "ok") return <BranchLeague as="section" scope={{ label: "Semua Cabang", filtered: false }} period={view} sort="k1" sortHrefs={sortHrefs("minggu")} state={{ kind: "permission", object: "cabang" }} />;
  const sort: LeagueKey = LEAGUE_KEYS.find((k) => k === one(sp.urut)) ?? "k1";
  return <BranchLeague as="section" scope={{ label: "Semua Cabang", filtered: false }} period={view} sort={sort} sortHrefs={sortHrefs(r.periods.kind)} state={{ kind: "ready", data: r.rows }} />;
}

export default function CabangPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} label="Memuat cabang" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
