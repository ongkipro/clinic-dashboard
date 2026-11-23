// Gudang & Depot (19 §2.9, UX-11 ▸ Depot, PR-89, T-061; HYG-NAV-2): the depots of one branch (gudang, ruang tindakan, apotek) with the
// stock each holds per batch (expiry, quantity, unfit marker) and, for pharmacist and purchasing, Tambah Depot and Pindah Antar Depot.
// Inter-branch transfers stay in Pembelian ▸ Transfer. No money (cost readers see values in Stok ▸ Item).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { BranchChips, NotOkState, segments } from "../frame";
import { UNFIT_LABEL } from "../labels";
import { loadDepots } from "./data";
import { MoveForm, NewDepot } from "./forms";
import { fitHoldings, KIND_LABEL, summary } from "./model";

export const metadata: Metadata = { title: "Gudang & Depot — Stok — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const qf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadDepots(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Gudang & Depot" />;
  const wide = !["manager", "pharmacist"].includes(d.role);
  const active = d.details;
  const batches = active.flatMap((x) => fitHoldings(x.holdings).map((h) => ({ depotId: x.id, batchId: h.batch_id, label: `${h.name} · ${h.batch_no} · sisa ${qf.format(h.quantity)} ${h.unit}` })));
  return (
    <ListPage as="section" title="Gudang & Depot" filters={[...segments("depot", d.branch.id, wide), { label: "Depot", href: `/stok/depot${wide ? `?cabang=${d.branch.id}` : ""}`, active: true }]}
      state={d.depots.length === 0 ? { kind: "empty", message: d.write ? "Belum ada depot. Tambah depot gudang terlebih dahulu." : "Belum ada depot di cabang ini." } : { kind: "rows" }}>
      {wide && <BranchChips path="/stok/depot" branches={d.stock.branches} active={d.branch.id} />}
      {d.write && <NewDepot ctx={d.ctx} branch={d.branch.id} />}
      {d.write && active.length >= 2 && <MoveForm ctx={d.ctx} depots={active.map((x) => ({ id: x.id, name: x.name }))} batches={batches} />}
      <ul aria-label="Depot" className="m-0 grid min-w-0 list-none gap-3 p-0 min-[1180px]:grid-cols-2">
        {d.depots.map((row) => {
          const det = active.find((x) => x.id === row.id);
          const sm = det ? summary(det.holdings) : null;
          return (
            <li key={row.id} data-depot={row.id} className="grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="m-0 text-[1.18rem] font-semibold [overflow-wrap:anywhere]">{row.name}</h2>
                <StatusBadge tone="neutral">{KIND_LABEL[row.kind] ?? row.kind}</StatusBadge>
                {row.is_default && <StatusBadge tone="success">Utama</StatusBadge>}
                {!row.active && <StatusBadge tone="locked">Nonaktif</StatusBadge>}
              </div>
              {sm && <p className={muted}>{sm.items} item · {sm.batches} batch{sm.unfit ? ` · ${sm.unfit} tidak layak` : ""}{row.open_vials ? ` · ${row.open_vials} vial terbuka` : ""}</p>}
              {det && (det.holdings.filter((h) => h.quantity > 0).length === 0 ? <p className={muted}>Depot kosong.</p> : (
                <ul aria-label={`Stok ${row.name}`} className="m-0 grid list-none gap-1 p-0">
                  {det.holdings.filter((h) => h.quantity > 0).map((h) => (
                    <li key={h.batch_id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-[var(--separator)] py-1 [border-bottom-width:0.5px]">
                      <Link href={`/stok/item/${h.item_id}${wide ? `?cabang=${d.branch.id}` : ""}`} className="inline-flex min-h-[var(--target)] items-center min-w-0 font-semibold text-[var(--label)] [overflow-wrap:anywhere]">{h.name}</Link>
                      <span className={muted}>{h.batch_no} · ED {h.expiry} · {qf.format(h.quantity)} {h.unit}{h.unfit ? ` · ${UNFIT_LABEL[h.unfit] ?? h.unfit}` : ""}</span>
                    </li>
                  ))}
                </ul>
              ))}
            </li>
          );
        })}
      </ul>
    </ListPage>
  );
}

export default function DepotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat depot" />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
