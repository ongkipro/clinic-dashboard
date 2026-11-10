// Templat Dokumen (UX-54, 17:182, SET-32; T-058): the templates of the kinds the role edits, by kind (Struk ·
// Persetujuan · Surat · Halaman Legal; the facility head sees the clinical ones), with the current version and
// whether it was used. Owner, admin pusat, facility head.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { TemplateKind } from "../../../../modules/documents/documents";
import { loadTemplates } from "../data";
import { KIND_LABEL, kindsFor, LETTER_TYPE_LABEL } from "../labels";

export const metadata: Metadata = { title: "Templat Dokumen — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadTemplates(null);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind !== "ok") return <PermissionState object="templat dokumen" />;
  const kinds = kindsFor(d.role);
  const kind = typeof q.jenis === "string" && kinds.includes(q.jenis) ? q.jenis : kinds[0];
  const rows = d.templates.filter((t) => t.kind === (kind as TemplateKind));
  return (
    <ListPage as="section" title="Templat Dokumen" primaryAction={{ label: "Buat Templat", href: `/templat/dokumen/baru?jenis=${kind}` }}
      filters={kinds.map((k) => ({ label: KIND_LABEL[k], href: `/templat/dokumen?jenis=${k}`, active: k === kind }))}
      state={rows.length === 0 ? { kind: "empty", message: `Belum ada templat ${KIND_LABEL[kind].toLowerCase()}.`, action: "Buat Templat", actionHref: `/templat/dokumen/baru?jenis=${kind}` } : { kind: "rows" }}>
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Setiap perubahan disimpan sebagai versi baru. Versi yang sudah dipakai tidak diubah.</p>
      <RowList label={`Templat ${KIND_LABEL[kind]}`}>
        {rows.map((t) => (
          <Row key={t.id} href={`/templat/dokumen/${t.id}`} title={t.name}
            subtitle={`${t.letter_type ? `${LETTER_TYPE_LABEL[t.letter_type]} · ` : ""}versi ${t.version ?? "-"}${t.used ? " · sudah dipakai" : ""}`}>
            <StatusBadge tone={t.state === "active" ? "success" : "locked"}>{t.state === "active" ? "Aktif" : "Pensiun"}</StatusBadge>
          </Row>
        ))}
      </RowList>
    </ListPage>
  );
}

export default function TemplatDokumenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
