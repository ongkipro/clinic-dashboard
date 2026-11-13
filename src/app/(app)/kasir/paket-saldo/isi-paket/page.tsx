// Paket & Saldo ▸ Isi Paket (spec 19 §2.8 Templat Paket; T-076): the services and session counts of a package version;
// editable while the version is unsold (CLIN-011), else read only. Owner and admin pusat.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage } from "../../../../../components/templates/templates";
import { LoadingList } from "../../../../../components/ui/states";
import { card, Main, muted, NotOkState } from "../../frame";
import { loadContents } from "../data";
import { ContentsForm } from "../forms";
import Link from "next/link";

export const metadata: Metadata = { title: "Isi Paket — Kasir — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const d = await loadContents(typeof sp.versi === "string" ? sp.versi : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Isi Paket" />;
  const c = d.contents;
  return (
    <ListPage as="section" title="Isi Paket"
      filters={d.packages.map((x) => ({ label: x.name, href: `/kasir/paket-saldo/isi-paket?versi=${x.id}`, active: x.id === c?.version_id }))}
      state={d.packages.length === 0 ? { kind: "empty", message: "Belum ada paket di Katalog. Buat paket di Katalog terlebih dahulu." } : { kind: "rows" }}>
      {c && (c.sold || !c.can_edit ? (
        <div className={card}>
          {c.sold && <p className={muted}>Paket ini sudah terjual: isinya tidak dapat diubah. Terbitkan versi baru di Katalog untuk mengubah isi.</p>}
          {c.rows.length === 0 ? <p className={muted}>Belum ada isi.</p> : (
            <ol className="m-0 grid min-w-0 list-none gap-1 p-0">
              {c.rows.map((r) => <li key={r.seq} className="border-b border-[var(--separator)] py-1">{`${r.seq}. ${r.service ?? "Layanan"} × ${r.count} sesi`}</li>)}
            </ol>
          )}
        </div>
      ) : d.services.length === 0 ? <p className={muted}>Belum ada layanan aktif di Katalog.</p> : (
        <ContentsForm ctx={d.ctx} version={c.version_id} rows={c.rows} services={d.services} />
      ))}
      <Link href="/kasir/paket-saldo" className="inline-flex min-h-[44px] items-center self-start font-semibold text-[var(--tint)]">Kembali ke Paket & Saldo</Link>
    </ListPage>
  );
}

export default function IsiPaketPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={3} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
