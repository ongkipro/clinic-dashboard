// Pendampingan (UX-7 list, 19:86, PR-9; T-051): the BC's patients of today at the active branch, with the
// intake state and the BC Pembimbing. Status filter chips (Semua · Belum Dimulai · Draf · Terkirim) with a
// filtered-empty reset. BC only.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadQueue } from "./data";
import { INTAKE_STATE } from "./labels";

export const metadata: Metadata = { title: "Pendampingan — Clinic Dashboard" };

const FILTERS = [
  { key: "semua", label: "Semua" },
  { key: "belum", label: "Belum Dimulai" },
  { key: "draf", label: "Draf" },
  { key: "terkirim", label: "Terkirim" },
] as const;
const time = (d: Date) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(d);

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const filter = typeof q.status === "string" && FILTERS.some((f) => f.key === q.status) ? q.status : "semua";
  const d = await loadQueue();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="pendampingan" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Pendampingan" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const open = d.queue.visits.filter((v) => !v.closed);
  const state = (v: (typeof open)[number]) => (v.intakeState ?? "none") as keyof typeof INTAKE_STATE;
  const shown = open.filter((v) => filter === "semua" || (filter === "belum" && !v.intakeState) || (filter === "draf" && v.intakeState === "draft") || (filter === "terkirim" && v.intakeState === "sent"));
  return (
    <ListPage
      as="section"
      title="Pendampingan"
      sort={FILTERS.map((f) => ({ label: f.label, href: `/pendampingan?status=${f.key}`, active: f.key === filter }))}
      state={
        open.length === 0 ? { kind: "empty", message: `Belum ada pasien yang check-in hari ini di ${d.queue.branchName}.` }
        : shown.length === 0 ? { kind: "filtered-empty", message: "Tidak ada pasien dengan status ini.", clearHref: "/pendampingan" }
        : { kind: "rows" }
      }
    >
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{d.queue.branchName} · pasien yang check-in hari ini</p>
      <RowList label="Pasien hari ini">
        {shown.map((v) => {
          const st = INTAKE_STATE[state(v)];
          return (
            <Row key={v.id} href={`/pendampingan/${v.id}`} title={v.patientName} subtitle={`${v.patientMrn} · datang ${time(v.checkedInAt)}${v.authorName ? ` · BC Pembimbing ${v.authorName}` : ""}`}>
              {/* One link per row (Mulai Pendampingan is on the visit page): no action nested in the row link. */}
              <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            </Row>
          );
        })}
      </RowList>
      <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Pasien masuk ke daftar ini setelah check-in di front office.</p>
    </ListPage>
  );
}

export default function PendampinganPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
