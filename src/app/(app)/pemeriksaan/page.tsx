// Antrean Dokter (UX-8 list, 19:85, PR-10; T-052): today's patients at the active branch with their state —
// waiting for the intake, ready, being examined — the examining doctor and the allergy count. Status chips
// (Semua · Siap Diperiksa · Sedang Diperiksa · Menunggu Intake) with a filtered-empty reset. Clinical readers.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import type { QueueVisit } from "../../../modules/clinical/exam/exam";
import { loadQueue } from "./data";
import { QUEUE_STATE } from "./labels";

export const metadata: Metadata = { title: "Antrean Dokter — Clinic Dashboard" };

const FILTERS = [
  { key: "semua", label: "Semua" },
  { key: "siap", label: "Siap Diperiksa" },
  { key: "diperiksa", label: "Sedang Diperiksa" },
  { key: "menunggu", label: "Menunggu Intake" },
] as const;
const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const stateOf = (v: QueueVisit): keyof typeof QUEUE_STATE => (v.exam_id ? "draft" : v.intake_state === "sent" ? "ready" : "waiting");

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const filter = typeof q.status === "string" && FILTERS.some((f) => f.key === q.status) ? q.status : "semua";
  const d = await loadQueue();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="antrean dokter" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Antrean Dokter" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const open = d.queue.visits.filter((v) => !v.closed);
  const want = { siap: "ready", diperiksa: "draft", menunggu: "waiting" } as const;
  const shown = open.filter((v) => filter === "semua" || stateOf(v) === want[filter as keyof typeof want]);
  return (
    <ListPage
      as="section"
      title="Antrean Dokter"
      sort={FILTERS.map((f) => ({ label: f.label, href: `/pemeriksaan?status=${f.key}`, active: f.key === filter }))}
      state={
        open.length === 0 ? { kind: "empty", message: `Belum ada pasien yang check-in hari ini di ${d.queue.branch_name}.` }
        : shown.length === 0 ? { kind: "filtered-empty", message: "Tidak ada pasien dengan status ini.", clearHref: "/pemeriksaan" }
        : { kind: "rows" }
      }
    >
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{d.queue.branch_name} · pasien yang check-in hari ini</p>
      <RowList label="Pasien hari ini">
        {shown.map((v) => {
          const st = QUEUE_STATE[stateOf(v)];
          const parts = [v.patient_mrn, `datang ${time(v.checked_in_at)}`, v.cautions > 0 ? `${v.cautions} alergi` : "", v.author_name ? `Dokter ${v.author_name}` : ""];
          return (
            <Row key={v.id} href={`/pemeriksaan/${v.id}`} title={v.patient_name} subtitle={parts.filter(Boolean).join(" · ")}>
              {/* One link per row (Mulai Pemeriksaan is on the sheet): no action nested in the row link. */}
              <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            </Row>
          );
        })}
      </RowList>
      <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Pasien siap diperiksa setelah BC mengirim intake.</p>
    </ListPage>
  );
}

export default function PemeriksaanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
