// Laporan Audit page (19 §2.13, UX-53; Auditor & Owner).
// Reuses the exact Audit Internal core reader (zero duplication, zero patient identity).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { todayJakarta } from "../../audit/internal/data";
import {
  APPROVALS_UNAVAILABLE,
  EXPORT_UNAVAILABLE,
  rp,
  STOCK_COUNT_WINDOW_NOTE,
} from "../../audit/internal/labels";
import { loadAuditInternalPage } from "../../audit/internal/server";

export const metadata: Metadata = { title: "Laporan Audit — Clinic Dashboard" };
const TITLE = "Laporan Audit";

const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const res = await loadAuditInternalPage(await searchParams);
  if (res.kind === "redirect") redirect(res.to);
  if (res.kind === "not-found") notFound();
  if (res.kind === "forbidden") {
    return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "laporan audit" }} />;
  }

  const d = res.data;
  const today = todayJakarta();
  const discountSum = d.totals.manualDiscountTotal;
  const voidSum = d.totals.voidTotal;
  const refundSum = d.totals.paidRefundTotal;
  const writeOffSum = d.totals.writeOffTotal;
  const cashVarSum = d.totals.cashVarianceTotal;

  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <form
        method="get"
        action="/laporan/audit"
        aria-label="Filter periode laporan audit"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[44em]:grid-cols-[repeat(3,minmax(0,1fr))_auto] @min-[44em]:items-end"
      >
        <label className="grid min-w-0 gap-1">
          Dari
          <input name="dari" type="date" defaultValue={d.from} max={today} className={input} />
        </label>
        <label className="grid min-w-0 gap-1">
          Sampai
          <input name="sampai" type="date" defaultValue={d.to} max={today} className={input} />
        </label>
        <label className="grid min-w-0 gap-1">
          Cabang
          <select name="cabang" defaultValue={d.branchId ?? ""} className={input}>
            <option value="">Semua Cabang</option>
            {d.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]"
        >
          Terapkan
        </button>
      </form>

      <KpiRow
        items={[
          { label: "Diskon manual", value: String(d.manualDiscounts.length), basis: `Nilai ${rp(discountSum)}` },
          { label: "Void tagihan", value: String(d.voids.length), basis: `Nilai ${rp(voidSum)}` },
          { label: "Refund", value: String(d.refunds.length), basis: `Dampak ${rp(refundSum)}` },
          { label: "Hapus buku", value: String(d.writeOffs.length), basis: `Nilai ${rp(writeOffSum)}` },
        ]}
      />

      <section aria-labelledby="h-ringkasan-audit" className={panel}>
        <h2 id="h-ringkasan-audit" className="m-0 text-[1.15rem] font-semibold">
          Rekap sumber audit ({d.from} – {d.to})
        </h2>
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.9rem]">
            <thead>
              <tr className="border-b border-[var(--separator)] text-[var(--label-2)]">
                <th className="py-2 pr-3 font-medium">Kategori</th>
                <th className="py-2 pr-3 text-right font-medium">Jumlah</th>
                <th className="py-2 text-right font-medium">Nilai / Catatan</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--separator)]">
                <td className="py-2 pr-3">Diskon manual</td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.manualDiscounts.length}</td>
                <td className="py-2 text-right tabular-nums">{rp(discountSum)}</td>
              </tr>
              <tr className="border-b border-[var(--separator)]">
                <td className="py-2 pr-3">Tagihan batal (void)</td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.voids.length}</td>
                <td className="py-2 text-right tabular-nums">{rp(voidSum)}</td>
              </tr>
              <tr className="border-b border-[var(--separator)]">
                <td className="py-2 pr-3">Refund</td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.refunds.length}</td>
                <td className="py-2 text-right tabular-nums">{rp(refundSum)}</td>
              </tr>
              <tr className="border-b border-[var(--separator)]">
                <td className="py-2 pr-3">Hapus buku piutang</td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.writeOffs.length}</td>
                <td className="py-2 text-right tabular-nums">{rp(writeOffSum)}</td>
              </tr>
              <tr className="border-b border-[var(--separator)]">
                <td className="py-2 pr-3">Selisih hitung stok</td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.stockVariances.length}</td>
                <td className="py-2 text-right text-[var(--label-2)]">{STOCK_COUNT_WINDOW_NOTE}</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Selisih kas shift</td>
                <td className="py-2 pr-3 text-right tabular-nums">{d.cashVariances.length}</td>
                <td className="py-2 text-right tabular-nums">{rp(cashVarSum)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-4 pt-1">
          <Link href="/audit/internal" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">
            Lihat rincian di Audit Internal
          </Link>
          <Link href="/audit" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">
            Buka Log Audit
          </Link>
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[56em]:grid-cols-2">
        <section aria-labelledby="h-lap-persetujuan" className={panel}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 id="h-lap-persetujuan" className="m-0 text-[1.15rem] font-semibold">Persetujuan</h2>
            <StatusBadge tone="neutral">Belum tersedia</StatusBadge>
          </div>
          <p role="status" className={muted}>{APPROVALS_UNAVAILABLE}</p>
        </section>
        <section aria-labelledby="h-lap-ekspor" className={panel}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 id="h-lap-ekspor" className="m-0 text-[1.15rem] font-semibold">Ekspor</h2>
            <StatusBadge tone="neutral">Belum tersedia</StatusBadge>
          </div>
          <p role="status" className={muted}>{EXPORT_UNAVAILABLE}</p>
        </section>
      </div>
    </ListPage>
  );
}

export default function LaporanAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
