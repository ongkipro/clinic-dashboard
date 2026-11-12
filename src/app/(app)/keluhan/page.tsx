// Keluhan (UX-28, 19:93, PR-43; T-057): the complaint tasks of the acting role. Segments by role: the facility
// head Klinis · Layanan · Insiden; clinicians Klinis · Insiden; the manager Layanan; FO, central CS and BC
// "Laporan Saya" (status only). Unresolved first, most urgent due time first; overdue shown in words.
// The Insiden segment links to the incident register (/keluhan/insiden, T-068).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadList } from "./data";
import { CATEGORY_LABEL, HANDLES, KIND_LABEL, STATE, TRIAGE } from "./labels";

export const metadata: Metadata = { title: "Keluhan — Clinic Dashboard" };

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

type Seg = "klinis" | "layanan" | "insiden" | "saya";
function segments(role: string): Seg[] {
  const h = HANDLES[role] ?? [];
  if (h.length === 0) return ["saya"];
  return [...h, ...(h.includes("klinis") ? (["insiden"] as const) : [])];
}
const SEG_LABEL: Record<Seg, string> = { klinis: "Klinis", layanan: "Layanan", insiden: "Insiden", saya: "Laporan Saya" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const rc = await loadList(null);
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "forbidden") return <PermissionState object="keluhan" />;
  if (rc.kind === "no-branch") return <ListPage as="section" title="Keluhan" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const segs = segments(rc.role);
  const seg: Seg = typeof q.tab === "string" && (segs as string[]).includes(q.tab) ? (q.tab as Seg) : segs[0];
  const tabs = segs.length > 1 ? segs.map((s) => ({ label: SEG_LABEL[s], href: `/keluhan?tab=${s}`, active: s === seg })) : undefined;
  const flag = { label: "Laporkan Keluhan", href: "/keluhan/baru" };
  if (seg === "insiden") {
    return (
      <ListPage as="section" title="Keluhan" primaryAction={flag} filters={tabs} state={{ kind: "rows" }}>
        <div className="grid min-w-0 gap-2">
          <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Insiden keselamatan pasien (KTD, KNC, KTC, KPC, sentinel) dicatat dan ditangani di register insiden.</p>
          <Link href="/keluhan/insiden" className="inline-flex min-h-[var(--target)] items-center justify-self-start rounded-full bg-[var(--surface)] px-4 text-[var(--tint)] no-underline">Buka Register Insiden</Link>
        </div>
      </ListPage>
    );
  }
  const rows = rc.list.tasks.filter((t) => seg === "saya" || t.kind === seg);
  return (
    <ListPage as="section" title="Keluhan" primaryAction={flag} filters={tabs}
      state={rows.length === 0 ? { kind: "empty", message: seg === "saya" ? "Belum ada keluhan yang Anda laporkan." : `Tidak ada keluhan ${KIND_LABEL[seg].toLowerCase()} yang terbuka.` } : { kind: "rows" }}>
      {seg === "saya" && <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Status keluhan yang Anda laporkan. Isi penanganan hanya terlihat oleh tim yang menangani.</p>}
      <RowList label={seg === "saya" ? "Laporan saya" : `Keluhan ${KIND_LABEL[seg]}`}>
        {rows.map((t) => {
          const st = STATE[t.state];
          const level = t.kind === "klinis" ? `Triase ${TRIAGE[t.triage!].label}` : CATEGORY_LABEL[t.category!];
          const due = t.state === "resolved" ? `selesai ${when(t.resolved_at!)}` : t.overdue ? `lewat target ${when(t.due_at)}` : `target ${when(t.due_at)}`;
          return (
            <Row key={t.id} href={`/keluhan/${t.id}`} title={t.patient_name}
              subtitle={`${t.patient_mrn} · ${KIND_LABEL[t.kind]} · ${level} · ${due}${t.assigned_to_name ? ` · ${t.assigned_to_name}` : ""}${t.content && t.summary ? ` · ${t.summary}` : ""}`}>
              <span className="flex min-w-0 flex-wrap justify-end gap-1">
                {t.overdue && <StatusBadge tone="danger">Lewat target</StatusBadge>}
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
              </span>
            </Row>
          );
        })}
      </RowList>
    </ListPage>
  );
}

export default function KeluhanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
