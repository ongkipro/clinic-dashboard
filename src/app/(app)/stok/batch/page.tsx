// Stok ▸ Batch & Kedaluwarsa (19 §2.9): batches holding stock that are unfit (expired, recalled, quarantined), or
// expire within the SET-27 days, and the open vials with their use-by (CLIN-019).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadWatch } from "../data";
import { BranchChips, NotOkState, segments } from "../frame";
import { BATCH_STATE, date, qty, UNFIT_LABEL, when } from "../labels";

export const metadata: Metadata = { title: "Batch & Kedaluwarsa — Stok — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadWatch(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Batch & Kedaluwarsa" />;
  const wide = !["manager", "pharmacist"].includes(d.stock.role);
  const w = d.watch;
  const link = (item: string) => `/stok/item/${item}${wide ? `?cabang=${d.branch.id}` : ""}`;
  return (
    <>
      <ListPage as="section" title={`Batch & Kedaluwarsa · ${d.branch.name}`} filters={segments("batch", d.branch.id, wide)}
        state={w.batches.length === 0 && w.vials.length === 0 ? { kind: "empty", message: `Tidak ada batch tak layak, ditahan, atau kedaluwarsa dalam ${w.near_expiry_days} hari, dan tidak ada vial terbuka.` } : { kind: "rows" }}>
        <div className="grid min-w-0 gap-5">
          {w.vials.length > 0 && (
            <section aria-labelledby="vial-h" className="grid min-w-0 gap-2">
              <h2 id="vial-h" className="m-0 text-[1.18rem] font-semibold">Vial Terbuka (Batas Pakai)</h2>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {w.vials.map((v) => (
                  <li key={v.id} className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)]">
                    <Link href={link(v.item_id)} className="grid min-h-[52px] min-w-0 gap-1 p-4 text-[var(--label)] no-underline">
                      <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{v.name}</span>
                        {v.lapsed ? <StatusBadge tone="danger">Lewat batas pakai</StatusBadge> : <StatusBadge tone="warning">Terbuka</StatusBadge>}</span>
                      <span className="text-[0.94rem] tabular-nums">{`Batch ${v.batch_no} · sisa ${qty(v.remaining, v.unit)} · batas ${when(v.use_by)}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {w.batches.length > 0 && (
            <section aria-labelledby="batch-h" className="grid min-w-0 gap-2">
              <h2 id="batch-h" className="m-0 text-[1.18rem] font-semibold">{`Batch perlu perhatian (≤ ${w.near_expiry_days} hari)`}</h2>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {w.batches.map((b) => (
                  <li key={b.id} className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)]">
                    <Link href={link(b.item_id)} className="grid min-h-[52px] min-w-0 gap-1 p-4 text-[var(--label)] no-underline">
                      <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{b.name}</span>
                        {b.unfit ? <StatusBadge tone="danger">{UNFIT_LABEL[b.unfit]}</StatusBadge> : <StatusBadge tone={b.state === "active" ? "warning" : BATCH_STATE[b.state].tone}>{b.state === "active" ? `${b.days_left} hari lagi` : BATCH_STATE[b.state].label}</StatusBadge>}</span>
                      <span className="text-[0.94rem] tabular-nums">{`Batch ${b.batch_no} · ED ${date(b.expiry)} · ${qty(b.quantity, b.unit)}`}</span>
                      {b.hold_reason && <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{b.hold_reason}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ListPage>
      {wide && <BranchChips path="/stok/batch" branches={d.stock.branches} active={d.branch.id} />}
    </>
  );
}

export default function BatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
