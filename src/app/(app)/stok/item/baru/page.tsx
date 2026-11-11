// Stok ▸ Tambah Item (19 §2.9 Master Item): a catalog material or product becomes a stock item with its use unit,
// vial size and opened use-by, storage and registration. Pharmacist, purchasing, admin pusat.
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { loadNewItem } from "../../data";
import { NotOkState } from "../../frame";
import { ItemForm } from "../../forms";

export const metadata: Metadata = { title: "Tambah Item — Stok — Clinic Dashboard" };

async function Body() {
  const d = await loadNewItem();
  if (d.kind !== "ok") return <NotOkState d={d} title="Tambah Item" />;
  if (!d.stock.can_edit_items) return <PermissionState object="Master Item" />;
  // The form stays mounted when the last option is taken, so its result stays on screen (T-054 lesson).
  return (
    <section className="grid min-w-0 gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Tambah Item</h1>
      {d.options.length === 0 && (
        <p className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">Semua bahan dan produk katalog sudah ada di Master Item. Tambahkan item baru di Katalog dulu.</p>
      )}
      <div className="min-w-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4"><ItemForm ctx={d.ctx} options={d.options} /></div>
    </section>
  );
}

export default function NewItemPage() {
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}><Body /></Suspense>
    </main>
  );
}
