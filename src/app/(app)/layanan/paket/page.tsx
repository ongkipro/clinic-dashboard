// Templat Paket (19 §2.8, UX-25 ▸ Paket; HYG-NAV-2): every active package template — price, validity, minimum DP, instalments, contents
// (service × sessions), family sharing — for Admin Pusat and Owner. A new version is made in Katalog, contents in Isi Paket; the owner
// switches family sharing here. Compact: one card per template; regular: two columns.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadPaket } from "./data";
import { SharingForm } from "./forms";
import { minDp, rupiah, sessions, sharingLabel, validity } from "./model";

export const metadata: Metadata = { title: "Templat Paket — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const link = "inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]";
const Main = ({ children }: { children: React.ReactNode }) => <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</main>;

async function Body() {
  const p = await loadPaket();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Templat Paket" /><PermissionState object="templat paket" /></Main>;
  return (
    <Main>
      <PageTitle title="Templat Paket" action={{ label: "Buat Paket", href: "/katalog/baru" }} />
      {p.templates.length === 0 ? (
        <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--label-2)]">Belum ada paket aktif.</p>
          <Link href="/katalog/baru" className={link}>Buat Paket</Link>
        </div>
      ) : (
        <ul aria-label="Templat paket" className="m-0 grid min-w-0 list-none gap-3 p-0 min-[1180px]:grid-cols-2">
          {p.templates.map((t) => {
            const dp = minDp(t.row.normalPrice, t.row.minDpPct);
            const rows = t.contents?.rows ?? [];
            return (
              <li key={t.row.itemId} data-package={t.row.itemId} className="@container grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 text-[1.18rem] font-semibold [overflow-wrap:anywhere]">{t.row.name}</h2>
                  <span className="tabular font-semibold">{rupiah(t.row.normalPrice)}</span>
                </div>
                <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 @min-[24em]:grid-cols-[9em_minmax(0,1fr)]">
                  <dt className={muted}>Kode · versi</dt><dd className="m-0">{t.row.code} · v{t.row.version}</dd>
                  <dt className={muted}>Masa berlaku</dt><dd className="m-0">{validity(t.row.validityDays)}</dd>
                  <dt className={muted}>DP minimum</dt><dd className="m-0">{dp === null ? "—" : `${rupiah(dp)} (${t.row.minDpPct}%)`}</dd>
                  <dt className={muted}>Cicilan</dt><dd className="m-0">{t.row.installmentsAllowed ? "Boleh" : "Tidak"}</dd>
                  <dt className={muted}>Berbagi keluarga</dt><dd className="m-0">{sharingLabel(t.sharing)}</dd>
                </dl>
                {t.contents === null ? <p className={muted}>Isi paket tidak dapat dibaca.</p> : rows.length === 0
                  ? <StatusBadge tone="warning" className="justify-self-start">Isi paket belum diatur</StatusBadge>
                  : (
                    <ol aria-label={`Isi ${t.row.name}`} className="m-0 grid list-none gap-1 p-0">
                      {rows.map((r) => <li key={r.seq} className="flex justify-between gap-2 border-b border-[var(--separator)] py-1 [border-bottom-width:0.5px]"><span className="[overflow-wrap:anywhere]">{r.service ?? "Layanan"}</span><span className="tabular">× {r.count}</span></li>)}
                      <li className={`${muted} pt-1`}>Total {sessions(rows)} sesi{t.contents.sold ? " · sudah terjual (isi terkunci)" : ""}</li>
                    </ol>
                  )}
                <div className="flex min-w-0 flex-wrap gap-x-4">
                  <Link href={`/katalog/${t.row.itemId}`} className={link}>Ubah di Katalog</Link>
                  <Link href={`/kasir/paket-saldo/isi-paket?versi=${t.row.versionId}`} className={link}>Isi Paket</Link>
                </div>
                {p.role === "owner" && t.sharing?.can_change && <SharingForm ctx={p.ctx} item={t.row.itemId} enabled={t.sharing.enabled} name={t.row.name} />}
              </li>
            );
          })}
        </ul>
      )}
    </Main>
  );
}

export default function TemplatPaketPage() {
  return <Suspense fallback={<Main><LoadingList rows={4} label="Memuat templat paket" /></Main>}><Body /></Suspense>;
}
