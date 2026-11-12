// Kasir ▸ Jual Cepat (19:112): products without a visit (patient optional); every product is then handed over by the
// pharmacist (Serahkan), paid first. Search narrows the product list (name or code).
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { loadCounter } from "../data";
import { IssueForm } from "../forms";
import { BranchChips, Main, muted, NotOkState, wide } from "../frame";
import { COUNTER, SEGMENTS } from "../labels";

export const metadata: Metadata = { title: "Jual Cepat — Kasir — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const cari = typeof sp.cari === "string" ? sp.cari : undefined;
  const d = await loadCounter(typeof sp.cabang === "string" ? sp.cabang : undefined, cari);
  if (d.kind !== "ok") return <NotOkState d={d} title="Jual Cepat" />;
  if (!COUNTER.has(d.role)) return <NotOkState d={{ kind: "forbidden" }} title="Jual Cepat" />;
  const keep = wide(d.role) ? `?cabang=${d.branch.id}` : "";
  return (
    <>
      <ListPage as="section" title={`Jual Cepat · ${d.branch.name}`} filters={SEGMENTS("jual-cepat", d.role, keep)}
        search={{ name: "cari", label: "Cari produk", value: cari, action: "/kasir/jual-cepat", keep: wide(d.role) ? { cabang: d.branch.id } : undefined }}
        state={d.items.length === 0 ? (cari ? { kind: "filtered-empty", message: "Tidak ada produk yang cocok.", clearHref: `/kasir/jual-cepat${keep}` }
          : { kind: "empty", message: "Belum ada produk yang dapat dijual. Produk perlu item stok aktif." }) : { kind: "rows" }}>
        <p className={muted}>Produk diserahkan apoteker setelah dibayar.</p>
      </ListPage>
      {d.items.length > 0 && <IssueForm ctx={d.ctx} branch={wide(d.role) ? d.branch.id : null} initial={[]} options={d.items} label="Jual cepat" />}
      {wide(d.role) && <BranchChips path="/kasir/jual-cepat" branches={d.branches} active={d.branch.id} />}
    </>
  );
}

export default function JualCepatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={3} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
