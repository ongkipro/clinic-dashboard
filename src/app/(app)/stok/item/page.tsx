// Stok ▸ Item (UX-11, 19 §2.9 Master Item): the items at a branch with total and fit quantity, the min/target level
// and low, near-expiry and unfit flags. "Tambah Item" is the prominent action for item writers.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadItems } from "../data";
import { BranchChips, NotOkState, segments } from "../frame";
import { KIND_LABEL, qty } from "../labels";

export const metadata: Metadata = { title: "Master Item — Stok — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadItems(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Stok" />;
  const wide = !["manager", "pharmacist"].includes(d.stock.role);
  const filter = q.tampil === "rendah" ? "low" : q.tampil === "perhatian" ? "watch" : "all";
  const rows = d.items.filter((i) => filter === "all" || (filter === "low" ? i.low : i.near_expiry > 0 || i.unfit > 0));
  const extra = wide ? `&cabang=${d.branch.id}` : "";
  return (
    <>
      <ListPage as="section" title={`Stok · ${d.branch.name}`} primaryAction={d.stock.can_edit_items ? { label: "Tambah Item", href: "/stok/item/baru" } : undefined}
        filters={[...segments("item", d.branch.id, wide)]}
        state={d.items.length === 0 ? { kind: "empty", message: d.stock.can_edit_items ? "Belum ada item di Master Item. Tambahkan dari katalog bahan atau produk." : "Belum ada item di Master Item." }
          : rows.length === 0 ? { kind: "filtered-empty", message: "Tidak ada item dengan tanda ini.", clearHref: `/stok/item${wide ? `?cabang=${d.branch.id}` : ""}` } : { kind: "rows" }}>
        <div className="grid min-w-0 gap-3">
          <div role="group" aria-label="Saring" className="flex min-w-0 flex-wrap gap-2">
            {[["all", "Semua", ""], ["low", "Di bawah minimum", "rendah"], ["watch", "Perlu perhatian", "perhatian"]].map(([k, l, v]) => (
              <Link key={k} href={`/stok/item?${v ? `tampil=${v}` : ""}${extra}`} aria-current={filter === k ? "true" : undefined}
                className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] no-underline ${filter === k ? "bg-[var(--surface)] font-semibold text-[var(--label)]" : "text-[var(--tint)]"}`}>{l}</Link>
            ))}
          </div>
          <ul aria-label="Item stok" className="m-0 grid min-w-0 list-none gap-2 p-0">
            {rows.map((i) => (
              <li key={i.id} className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)]">
                <Link href={`/stok/item/${i.id}${wide ? `?cabang=${d.branch.id}` : ""}`} className="grid min-h-[52px] min-w-0 gap-1 p-4 text-[var(--label)] no-underline">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{i.name}</span>
                    {!i.active && <StatusBadge tone="locked">Nonaktif</StatusBadge>}
                    {i.low && <StatusBadge tone="warning">Rendah</StatusBadge>}
                    {i.unfit > 0 && <StatusBadge tone="danger">Tak layak</StatusBadge>}
                    {i.near_expiry > 0 && <StatusBadge tone="warning">Hampir ED</StatusBadge>}
                  </span>
                  <span className="text-[0.94rem] tabular-nums [overflow-wrap:anywhere]">
                    {`Layak pakai ${qty(i.fit_quantity, i.unit)} · Total ${qty(i.quantity, i.unit)}${i.min_qty !== null ? ` · Min ${qty(i.min_qty)}` : ""}`}
                  </span>
                  <span className="text-[0.88rem] text-[var(--label-2)]">{`${KIND_LABEL[i.kind]} · ${i.code}${i.vial_size ? ` · Vial ${qty(i.vial_size, i.unit)}` : ""}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </ListPage>
      {wide && <BranchChips path="/stok/item" branches={d.stock.branches} active={d.branch.id} />}
    </>
  );
}

export default function ItemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
