// One template (UX-54, 17:182; T-058): the current version's editor (Simpan Versi), its preview from sample data
// (Pratinjau; vendor fields still placeholders marked "contoh, belum diisi"), the version history, and Pensiunkan.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadTemplate } from "../../data";
import { RetireForm, TemplateForm } from "../../forms";
import { KIND_LABEL, LETTER_TYPE_LABEL, PAPER_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Templat Dokumen — Clinic Dashboard" };

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const card = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadTemplate(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden" || d.kind === "no-branch") return <PermissionState object="templat dokumen" />;
  if (d.kind === "not-found") notFound();
  const t = d.template;
  const cur = t.versions[0];
  return (
    <>
      <PageTitle title={t.name} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold">{KIND_LABEL[t.kind]}{t.letter_type ? ` · ${LETTER_TYPE_LABEL[t.letter_type]}` : ""}</span>
        <StatusBadge tone={t.state === "active" ? "success" : "locked"}>{t.state === "active" ? "Aktif" : "Pensiun"}</StatusBadge>
      </div>
      {cur && (
        <section aria-label="Pratinjau" className={card}>
          <h2 className="m-0 text-[1.06rem] font-semibold">Pratinjau versi {cur.version}</h2>
          <p className={muted}>Dengan data contoh; tidak memuat data pasien.</p>
          <pre className="m-0 min-w-0 whitespace-pre-wrap rounded-[var(--radius-field)] bg-white p-3 font-sans [overflow-wrap:anywhere]">{cur.preview}</pre>
        </section>
      )}
      {t.writable && t.state === "active" && (
        <section aria-label="Ubah templat" className={card}>
          <h2 className="m-0 text-[1.06rem] font-semibold">Ubah sebagai versi baru</h2>
          <TemplateForm ctx={d.ctx} template={t.id} kinds={[t.kind]} body={cur?.body ?? ""} paper={cur?.paper ?? "a4"} kind={t.kind} required={t.required} allowed={t.allowed} used={!!cur?.used} />
        </section>
      )}
      <section aria-label="Riwayat versi" className={card}>
        <h2 className="m-0 text-[1.06rem] font-semibold">Riwayat versi</h2>
        <ol className="m-0 grid min-w-0 list-none gap-2 p-0">
          {t.versions.map((v) => (
            <li key={v.id} className="grid min-w-0 gap-1">
              <span className="font-semibold">{`Versi ${v.version} · ${v.state === "active" ? "dipakai sekarang" : "lama"}${v.used ? " · sudah dipakai" : ""}`}</span>
              <span className={muted}>{`${when(v.created_at)} · ${v.created_by_name} · ${PAPER_LABEL[v.paper]}`}</span>
            </li>
          ))}
        </ol>
      </section>
      {t.writable && <RetireForm ctx={d.ctx} template={t.id} active={t.state === "active"} />}
      <Link href={`/templat/dokumen?jenis=${t.kind}`} className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Kembali ke Templat Dokumen</Link>
    </>
  );
}

export default function TemplatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[900px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
