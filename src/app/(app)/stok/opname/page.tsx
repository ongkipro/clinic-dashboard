// Stok ▸ Hitung (UX-11, 17:294–296, 19 §2.9 Hitung Stok): counts at a branch (open ones and the last 60 days);
// "Hitung Stok" (pharmacist, manager) starts one, blind by default.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadCounts } from "../data";
import { BranchChips, NotOkState, segments } from "../frame";
import { StartCountForm } from "../forms";
import { COUNT_STATE, ROLE_LABEL, when } from "../labels";

export const metadata: Metadata = { title: "Hitung Stok — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadCounts(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Hitung Stok" />;
  const wide = !["manager", "pharmacist"].includes(d.stock.role);
  const stocked = d.items.filter((i) => i.quantity > 0);
  return (
    <>
      <ListPage as="section" title={`Hitung Stok · ${d.branch.name}`} filters={segments("opname", d.branch.id, wide)}
        state={d.counts.length === 0 ? { kind: "empty", message: d.stock.can_count ? "Belum ada hitungan. Mulai dengan Hitung Stok." : "Belum ada hitungan di cabang ini." } : { kind: "rows" }}>
        <ul aria-label="Hitungan" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {d.counts.map((c) => (
            <li key={c.id} className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)]">
              <Link href={`/stok/opname/${c.id}`} className="grid min-h-[52px] min-w-0 gap-1 p-4 text-[var(--label)] no-underline">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold">{`Hitung ${when(c.started_at)}`}</span>
                  <StatusBadge tone={COUNT_STATE[c.state].tone}>{COUNT_STATE[c.state].label}</StatusBadge>
                  {c.blind && <StatusBadge tone="neutral">Buta</StatusBadge>}
                </span>
                <span className="text-[0.94rem] tabular-nums">{`${c.counted}/${c.lines} batch terhitung · ${c.started_by_name ?? "—"} (${ROLE_LABEL[c.started_as] ?? c.started_as})`}</span>
              </Link>
            </li>
          ))}
        </ul>
      </ListPage>
      {d.stock.can_count && stocked.length > 0 && <StartCountForm ctx={d.ctx} items={stocked.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))} />}
      {wide && <BranchChips path="/stok/opname" branches={d.stock.branches} active={d.branch.id} />}
    </>
  );
}

export default function OpnamePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
