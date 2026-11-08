// Master Layanan (UX-25, PR-88, T-034): every service's active version by category, with durations
// and online booking; services with a change waiting for review are marked. Owner, Admin Pusat and
// Manager add services; facility heads and pharmacists read.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { CATEGORY_LABEL } from "../../../modules/catalog/service/labels";
import { rupiah, STATE_LABEL } from "../katalog/labels";
import { loadServices } from "./data";

export const metadata: Metadata = { title: "Master Layanan — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const p = await loadServices();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="Master Layanan" />;
  const used = [...new Set(p.rows.map((r) => r.category ?? "none"))];
  const cat = typeof q.kategori === "string" && used.includes(q.kategori) ? q.kategori : null;
  const rows = cat ? p.rows.filter((r) => (r.category ?? "none") === cat) : p.rows;
  const filters = [
    { label: "Semua", href: "/layanan", active: !cat },
    ...used.map((c) => ({ label: c === "none" ? "Tanpa kategori" : CATEGORY_LABEL[c] ?? c, href: `/layanan?kategori=${c}`, active: cat === c })),
  ];
  return (
    <ListPage
      title="Master Layanan"
      primaryAction={p.canEdit ? { label: "Tambah Layanan", href: "/layanan/baru" } : undefined}
      filters={used.length > 1 ? filters : undefined}
      state={
        p.rows.length === 0 && p.unpublished.length === 0
          ? { kind: "empty", message: p.canEdit ? "Belum ada layanan. Tambahkan layanan pertama." : "Belum ada layanan." }
          : { kind: "rows" }
      }
    >
      {!cat && p.unpublished.length > 0 && (
        <RowList label="Belum aktif">
          {p.unpublished.map((r) => (
            <Row key={r.itemId} href={`/layanan/${r.itemId}`} title={r.name} subtitle={`${r.code} · belum bisa dibooking atau dijual`}>
              <StatusBadge tone={r.state === "pending_review" ? "warning" : "neutral"}>{r.state === "pending_review" ? "Menunggu review" : STATE_LABEL[r.state] ?? r.state}</StatusBadge>
            </Row>
          ))}
        </RowList>
      )}
      {rows.length > 0 && (
        <RowList label="Layanan aktif">
          {rows.map((r) => (
            <Row
              key={r.itemId}
              href={`/layanan/${r.itemId}`}
              title={r.name}
              subtitle={[r.category ? CATEGORY_LABEL[r.category] : "Tanpa kategori", r.code, `${(r.prepMin ?? 0) + (r.treatmentMin ?? 0) + (r.bufferMin ?? 0)} menit`, r.onlineBookable ? "booking online" : null].filter(Boolean).join(" · ")}
              trailing={<span className="font-semibold tabular-nums">{rupiah(r.normalPrice)}</span>}
            >
              {r.pendingReview && <StatusBadge tone="warning">Menunggu review</StatusBadge>}
            </Row>
          ))}
        </RowList>
      )}
    </ListPage>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat layanan" />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
