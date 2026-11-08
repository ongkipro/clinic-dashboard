// The Harga Cabang tab shown on Katalog and Master Layanan item pages (UX-25, PR-42, T-035): the price
// today per branch and the next scheduled change, with a link to the editor (Owner) or the read view.
import Link from "next/link";
import type { BranchSummary, PriceBranch } from "../../../../modules/catalog/prices/prices";
import { rupiah } from "../labels";

export type BranchPrices = { branches: PriceBranch[]; summary: BranchSummary[] };

export function BranchPriceTab({ itemId, prices, canEdit }: { itemId: string; prices: BranchPrices; canEdit: boolean }) {
  const day = (d: Date, tz: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: tz }).format(d);
  return (
    <div className="@container grid min-w-0 gap-3">
      <dl className="m-0 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 @[30rem]:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] @[30rem]:gap-y-2">
        {prices.branches.map((b) => {
          const s = prices.summary.find((x) => x.branchId === b.id)!;
          return (
            <div key={b.id} className="contents">
              <dt className="text-[var(--label-2)]">{b.name}</dt>
              <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">
                {rupiah(s.now)}{s.overridden ? " (harga khusus)" : ""}
                {s.next ? ` · mulai ${day(s.next.effectiveFrom, b.timezone)}: ${s.next.price === null ? "harga normal" : rupiah(s.next.price)}` : ""}
              </dd>
            </div>
          );
        })}
      </dl>
      <Link href={`/katalog/harga-cabang/${itemId}`} className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">
        {canEdit ? "Atur harga cabang" : "Lihat harga cabang"}
      </Link>
    </div>
  );
}
