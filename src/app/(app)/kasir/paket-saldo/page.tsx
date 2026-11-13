// Kasir ▸ Paket & Saldo (UX-13, 19:111; T-076): find a patient (name or MRN) → their packages and balance. Admin pusat
// sees only Isi Paket (the package templates).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { Main, NotOkState } from "../frame";
import { rp } from "../labels";
import { EDITORS, loadSearch } from "./data";

export const metadata: Metadata = { title: "Paket & Saldo — Kasir — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const cari = typeof sp.cari === "string" ? sp.cari : undefined;
  const d = await loadSearch(cari);
  if (d.kind === "forbidden") {
    return (
      <ListPage as="section" title="Paket & Saldo" state={{ kind: "empty", message: "Kelola isi paket di Isi Paket." }}
        primaryAction={{ label: "Isi Paket", href: "/kasir/paket-saldo/isi-paket" }} />
    );
  }
  if (d.kind !== "ok") return <NotOkState d={d} title="Paket & Saldo" />;
  const q = (cari ?? "").trim();
  return (
    <ListPage as="section" title="Paket & Saldo" search={{ name: "cari", label: "Cari pasien (nama atau No. RM)", value: cari, action: "/kasir/paket-saldo" }}
      primaryAction={EDITORS.has(d.role) ? { label: "Isi Paket", href: "/kasir/paket-saldo/isi-paket" } : undefined}
      state={q.length < 2 ? { kind: "empty", message: "Cari pasien dengan nama atau No. RM (minimal 2 huruf)." }
        : d.hits.length === 0 ? { kind: "filtered-empty", message: "Tidak ada pasien yang cocok.", clearHref: "/kasir/paket-saldo" } : { kind: "rows" }}>
      <RowList label="Pasien">
        {d.hits.map((x) => (
          <Row key={x.id} href={`/kasir/paket-saldo/${x.id}`} title={`${x.name ?? "Pasien"} · ${x.mrn}`}
            subtitle={`Saldo ${rp(x.balance)} · ${x.active_packages} paket aktif`} />
        ))}
      </RowList>
      <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Membeli paket: terbitkan tagihan paket di <Link href="/kasir" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Kasir</Link>.</p>
    </ListPage>
  );
}

export default function PaketSaldoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={3} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
