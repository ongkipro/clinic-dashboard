// Harga Cabang item (UX-25, PR-42, T-035): per branch, the price today, the next scheduled change and
// the history; the Owner sets a price (or back to normal) from a date in the branch's timezone and
// cancels a scheduled change. Other roles read only. Not found for a material, another tenant's item
// or an item without an active version.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DetailPage } from "../../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { KIND_LABEL, rupiah } from "../../labels";
import { loadItemPrices } from "../data";
import { CancelScheduled, PriceForm } from "../forms";

export const metadata: Metadata = { title: "Harga Cabang — Clinic Dashboard" };
const when = (d: Date, tz: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(d);
const today = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

async function Body({ params }: { params: Promise<{ item: string }> }) {
  const { item: id } = await params;
  const p = await loadItemPrices(id);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="harga cabang" />;
  if (p.kind === "not-found") notFound();
  const now = new Date();
  const sections = p.branches.map((b) => {
    const s = p.summary.find((x) => x.branchId === b.id)!;
    const rows = p.rows.filter((r) => r.branchId === b.id);
    const tz = b.timezone.replace("Asia/", "");
    return {
      id: `cabang-${b.code.toLowerCase()}`,
      label: b.name,
      content: (
        <div className="@container grid min-w-0 gap-3">
          <dl className="m-0 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 @[30rem]:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] @[30rem]:gap-y-2">
            <dt className="text-[var(--label-2)]">Harga hari ini</dt>
            <dd className="m-0 min-w-0 font-semibold tabular-nums [overflow-wrap:anywhere]">{rupiah(s.now)}{s.overridden ? " (harga khusus)" : " (harga normal)"}</dd>
            <dt className="text-[var(--label-2)]">Berikutnya</dt>
            <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{s.next ? `Mulai ${when(s.next.effectiveFrom, b.timezone)} ${tz}: ${s.next.price === null ? "kembali ke harga normal" : rupiah(s.next.price)}` : "Tidak ada perubahan terjadwal"}</dd>
          </dl>
          {rows.length > 0 && (
            <ol className="m-0 grid list-none gap-3 p-0" aria-label={`Riwayat harga ${b.name}`}>
              {rows.map((r) => {
                const scheduled = r.state === "active" && r.effectiveFrom > now;
                const label = `${r.price === null ? "harga normal" : rupiah(r.price)} mulai ${when(r.effectiveFrom, b.timezone)}`;
                return (
                  <li key={r.id} className="grid min-w-0 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{r.price === null ? "Kembali ke harga normal" : rupiah(r.price)}</span>
                      <StatusBadge tone={r.state === "cancelled" ? "neutral" : scheduled ? "warning" : "success"}>{r.state === "cancelled" ? "Dibatalkan" : scheduled ? "Terjadwal" : "Berlaku"}</StatusBadge>
                    </div>
                    <p className={`${muted} [overflow-wrap:anywhere]`}>Mulai {when(r.effectiveFrom, b.timezone)} {tz} · {r.reason}{r.cancelledAt ? ` · dibatalkan ${when(r.cancelledAt, b.timezone)}` : ""}</p>
                    {p.canEdit && scheduled && <CancelScheduled ctx={p.ctx} itemId={p.item.itemId} id={r.id} label={label} />}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ),
    };
  });
  if (p.canEdit && p.branches.length > 0) {
    sections.unshift({
      id: "atur",
      label: "Atur harga cabang",
      content: <PriceForm ctx={p.ctx} itemId={p.item.itemId} branches={p.branches} today={Object.fromEntries(p.branches.map((b) => [b.id, today(b.timezone)]))} />,
    });
  }
  return (
    <DetailPage
      title={p.item.name}
      subtitle={`${KIND_LABEL[p.item.kind]} · ${p.item.code} · harga normal ${rupiah(p.item.normalPrice)}`}
      sections={sections.length ? sections : [{ id: "kosong", label: "Cabang", content: <p className="m-0">Belum ada cabang.</p> }]}
    >
      {!p.canEdit && <p className="m-0 text-[var(--label-2)]">Harga cabang hanya dapat diubah oleh Owner.</p>}
      {/* Review r1 (Argon, P3): Master Layanan only for the roles that open it; everyone else goes to Katalog. */}
      <Link href={p.item.kind === "service" && p.opensServices ? `/layanan/${p.item.itemId}` : `/katalog/${p.item.itemId}`} className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">
        {p.item.kind === "service" && p.opensServices ? "Buka di Master Layanan" : "Buka item di Katalog"}
      </Link>
    </DetailPage>
  );
}

export default function Page({ params }: { params: Promise<{ item: string }> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat harga cabang" />}>
      <Body params={params} />
    </Suspense>
  );
}
