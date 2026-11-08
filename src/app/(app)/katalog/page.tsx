// Katalog & Harga (UX-25, PR-41): every item's active version with price and tax; items with a
// clinical change waiting for review are marked. Every member reads it (commercial projection);
// Owner, Admin Pusat and Manager add items.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadCatalog } from "./data";
import { KIND_LABEL, rupiah, STATE_LABEL, TAX_LABEL } from "./labels";

export const metadata: Metadata = { title: "Katalog — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const p = await loadCatalog();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="katalog" />;
  const kind = typeof q.jenis === "string" && KIND_LABEL[q.jenis] ? q.jenis : null;
  const rows = kind ? p.rows.filter((r) => r.kind === kind) : p.rows;
  const unpublished = kind ? p.unpublished.filter((r) => r.kind === kind) : p.unpublished;
  const filters = [{ label: "Semua", href: "/katalog", active: !kind }, ...Object.entries(KIND_LABEL).map(([k, l]) => ({ label: l, href: `/katalog?jenis=${k}`, active: kind === k }))];
  return (
    <ListPage
      title="Katalog & Harga"
      primaryAction={p.canEdit ? { label: "Tambah Item", href: "/katalog/baru" } : undefined}
      filters={filters}
      state={
        p.rows.length === 0 && p.unpublished.length === 0
          ? { kind: "empty", message: p.canEdit ? "Belum ada item di katalog. Tambahkan layanan atau produk pertama." : "Belum ada item di katalog." }
          : rows.length === 0 && unpublished.length === 0
            ? { kind: "filtered-empty", message: `Tidak ada item jenis ${KIND_LABEL[kind!]}.`, clearHref: "/katalog" }
            : { kind: "rows" }
      }
    >
      {/* T-035: branch prices for every member; the Owner changes them there (PR-42). */}
      <Link href="/katalog/harga-cabang" className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">Harga Cabang</Link>
      {unpublished.length > 0 && (
        <RowList label="Belum aktif">
          {unpublished.map((r) => (
            <Row key={r.itemId} href={`/katalog/${r.itemId}`} title={r.name} subtitle={`${KIND_LABEL[r.kind]} · ${r.code} · belum bisa dijual`}>
              <StatusBadge tone={r.state === "pending_review" ? "warning" : "neutral"}>{STATE_LABEL[r.state] ?? r.state}</StatusBadge>
            </Row>
          ))}
        </RowList>
      )}
      <RowList label="Item katalog">
        {rows.map((r) => (
          <Row
            key={r.itemId}
            href={`/katalog/${r.itemId}`}
            title={r.name}
            subtitle={`${KIND_LABEL[r.kind]} · ${r.code} · ${TAX_LABEL[r.taxCategory]}`}
            trailing={<span className="font-semibold tabular-nums">{rupiah(r.normalPrice)}</span>}
          >
            {r.pendingReview && <StatusBadge tone="warning">Menunggu review</StatusBadge>}
          </Row>
        ))}
      </RowList>
    </ListPage>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat katalog" />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
