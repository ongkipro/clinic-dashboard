// Buat Templat (UX-54; T-058): the first version of a new template of a kind the role edits.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { loadNewTemplate } from "../../data";
import { TemplateForm } from "../../forms";
import { kindsFor } from "../../labels";

export const metadata: Metadata = { title: "Buat Templat — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadNewTemplate();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind !== "ok") return <PermissionState object="templat dokumen" />;
  const kinds = kindsFor(d.role);
  const first = typeof q.jenis === "string" && kinds.includes(q.jenis) ? q.jenis : kinds[0];
  return (
    <>
      <PageTitle title="Buat Templat" />
      <section aria-label="Templat baru" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <TemplateForm ctx={d.ctx} template={null} kinds={[first, ...kinds.filter((k) => k !== first)]} body="" paper="a4" kind={first} required={[]} allowed={[]} used={false} />
      </section>
      <Link href="/templat/dokumen" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Kembali ke Templat Dokumen</Link>
    </>
  );
}

export default function BuatTemplatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[900px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
