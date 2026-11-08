// Harga Cabang (UX-25 branch price tab, PR-42, T-035): every sellable item with its normal price and,
// per branch, the price today and the next scheduled change. Every member reads; the Owner opens an
// item to change it. Filter by branch.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { KIND_LABEL, rupiah } from "../labels";
import { loadPrices } from "./data";

export const metadata: Metadata = { title: "Harga Cabang — Clinic Dashboard" };

const day = (d: Date, tz: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: tz }).format(d);

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const p = await loadPrices();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="harga cabang" />;
  const branch = p.branches.find((b) => b.id === q.cabang) ?? null;
  const shown = branch ? [branch] : p.branches;
  const filters = [{ label: "Semua cabang", href: "/katalog/harga-cabang", active: !branch }, ...p.branches.map((b) => ({ label: b.name, href: `/katalog/harga-cabang?cabang=${b.id}`, active: branch?.id === b.id }))];
  return (
    <ListPage
      title="Harga Cabang"
      filters={p.branches.length > 1 ? filters : undefined}
      state={p.rows.length === 0 ? { kind: "empty", message: "Belum ada item aktif di katalog. Harga cabang diatur setelah item punya versi aktif." } : { kind: "rows" }}
    >
      <p className="m-0 text-[var(--label-2)]">{p.canEdit ? "Pilih item untuk mengatur harga per cabang." : "Harga cabang hanya dapat diubah oleh Owner."}</p>
      <RowList label="Harga per item">
        {p.rows.map(({ item, branches }) => {
          const lines = branches.filter((s) => shown.some((b) => b.id === s.branchId));
          const overridden = lines.filter((s) => s.overridden).length;
          const next = lines.filter((s) => s.next).length;
          return (
            <Row
              key={item.itemId}
              href={`/katalog/harga-cabang/${item.itemId}`}
              title={item.name}
              subtitle={`${KIND_LABEL[item.kind]} · ${item.code} · harga normal ${rupiah(item.normalPrice)}${branch
                ? ` · ${branch.name}: ${rupiah(lines[0].now)}${lines[0].next ? ` · mulai ${day(lines[0].next.effectiveFrom, branch.timezone)}: ${lines[0].next.price === null ? "harga normal" : rupiah(lines[0].next.price)}` : ""}`
                : ""}`}
            >
              <div className="flex flex-wrap gap-2">
                {overridden > 0 && <StatusBadge tone="neutral">{branch ? "Harga khusus" : `Harga khusus di ${overridden} cabang`}</StatusBadge>}
                {next > 0 && <StatusBadge tone="warning">{branch ? "Ada perubahan terjadwal" : `${next} perubahan terjadwal`}</StatusBadge>}
              </div>
            </Row>
          );
        })}
      </RowList>
    </ListPage>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat harga cabang" />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
