// One expense (UX-22 ▸ Biaya; T-084): the receipt preview, the payable when Belum Dibayar, and Batalkan Biaya for the owner and
// finance (an unpaid expense reverses with its payable; a paid one cannot be reversed).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DetailPage, ListPage } from "../../../../../components/templates/templates";
import { LoadingList, SuccessNotice } from "../../../../../components/ui/states";
import { loadExpense } from "../data";
import { ReverseForm } from "../forms";
import { day, FUNDING, PAYABLE, ROLE, rp } from "../labels";

export const metadata: Metadata = { title: "Biaya — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
// Label above value: a fixed label column squeezes the value at 200 % text inside the detail's two-column layout.
const dl = "m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-y-3";

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await loadExpense(id, typeof sp.tanggal === "string" ? sp.tanggal : "");
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title="Biaya" state={{ kind: "permission", object: "biaya operasional" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title="Biaya" state={{ kind: "empty", message: "Biaya tidak ditemukan.", action: "Kembali ke Biaya", actionHref: "/keuangan/biaya" }} />;
  const e = d.e;
  const image = e.receipt_media_type === "image/png" || e.receipt_media_type === "image/jpeg";
  const canReverse = d.d.can_reverse && e.state === "recorded" && (!e.payable || (e.payable.paid === 0 && e.payable.credited === 0));
  const facts: [string, string][] = [
    ["Tanggal", day(e.business_date)], ["Cabang", e.branch.name], ["Kategori", e.category.name], ["Jumlah", rp(Number(e.amount))],
    ["Sumber dana", FUNDING[e.funding]], ["Keterangan", e.description], ["Dicatat oleh", ROLE[e.recorded_as] ?? e.recorded_as],
  ];
  if (e.supplier) facts.splice(5, 0, ["Pemasok", e.supplier.name]);
  return (
    <DetailPage as="section" title={`${e.category.name} · ${rp(Number(e.amount))}`} subtitle={`${day(e.business_date)} · ${e.branch.name}`}
      status={e.state === "reversed" ? { tone: "neutral", label: "Dibatalkan" } : e.payable ? { tone: PAYABLE[e.payable.state][1], label: PAYABLE[e.payable.state][0] } : undefined}
      sections={[
        { id: "rincian", label: "Rincian", content: (
          <div className="grid min-w-0 gap-3">
            {sp.baru === "1" && <SuccessNotice message="Biaya dicatat." />}
            <dl className={dl}>{facts.map(([k, v]) => <div key={k} className="grid min-w-0 gap-0.5"><dt className="text-[0.88rem] text-[var(--label-2)]">{k}</dt><dd className="m-0 [overflow-wrap:anywhere]">{v}</dd></div>)}</dl>
          </div>
        ) },
        { id: "bukti", label: "Bukti", content: !e.has_receipt ? <p className={muted}>Tanpa bukti.</p> : (
          <div className="grid min-w-0 gap-2">
            {image && (
              // eslint-disable-next-line @next/next/no-img-element -- a private, per-request receipt; never optimized or cached
              <img src={`/keuangan/biaya/bukti/${e.id}`} alt={`Bukti biaya ${e.category.name} ${day(e.business_date)}`} className="max-h-[420px] w-auto max-w-full rounded-[var(--radius-field)] object-contain" />
            )}
            <a href={`/keuangan/biaya/bukti/${e.id}`} className="inline-flex min-h-[var(--target)] items-center self-start text-[var(--tint)] [overflow-wrap:anywhere]">{`Buka ${e.receipt_file_name ?? "bukti"}`}</a>
          </div>
        ) },
        ...(e.payable ? [{ id: "utang", label: "Utang pemasok", content: (
          <div className="grid min-w-0 gap-1">
            <p className="m-0 [overflow-wrap:anywhere]">{`Faktur ${e.payable.number} · jatuh tempo ${day(e.payable.due_date)}`}</p>
            <p className={muted}>{`Dibayar ${rp(Number(e.payable.paid))} dari ${rp(Number(e.amount))}`}</p>
            {d.role !== "auditor" && <Link href="/pembelian/utang" className="inline-flex min-h-[var(--target)] items-center self-start text-[var(--tint)]">Bayar di Pembelian › Utang</Link>}
          </div>
        ) }] : []),
        ...(canReverse ? [{ id: "batalkan", label: "Batalkan biaya", content: (
          <div className="grid min-w-0 gap-2">
            <p className={muted}>{e.payable ? "Biaya dan utang pemasoknya dibatalkan bersama. Catatan tetap tersimpan." : "Biaya tidak dihitung lagi. Catatan tetap tersimpan."}</p>
            <ReverseForm ctx={d.ctx} expense={e.id} amount={Number(e.amount)} />
          </div>
        ) }] : []),
        ...(d.d.can_reverse && e.state === "recorded" && !canReverse ? [{ id: "batalkan", label: "Batalkan biaya", content: (
          <p className={muted}>Utang biaya ini sudah dibayar sebagian atau lunas, jadi biaya tidak dapat dibatalkan.</p>
        ) }] : []),
      ]}
      related={[{ label: "Semua biaya", href: "/keuangan/biaya" }]} />
  );
}

export default function ExpensePage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4"><Suspense fallback={<LoadingList rows={4} />}><Body {...props} /></Suspense></main>;
}
