// Persetujuan Tindakan (UX-39 list, 19:89, PR-11; T-054): today's patients at the active branch with an
// examination and an active plan, with the consent state of each plan. Chips: Semua · Perlu Persetujuan ·
// Disetujui, with a filtered-empty reset. Doctor or nurse.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadQueue } from "./data";
import { CONSENT_STATE } from "./labels";

export const metadata: Metadata = { title: "Persetujuan Tindakan — Clinic Dashboard" };

const FILTERS = [
  { key: "semua", label: "Semua" },
  { key: "perlu", label: "Perlu Persetujuan" },
  { key: "disetujui", label: "Disetujui" },
] as const;
const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const filter = typeof q.status === "string" && FILTERS.some((f) => f.key === q.status) ? q.status : "semua";
  const d = await loadQueue();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="persetujuan tindakan" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Persetujuan Tindakan" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const open = d.queue.visits.filter((v) => !v.closed && v.plans.length > 0);
  const needs = (v: (typeof open)[number]) => v.plans.some((p) => p.consent !== "active");
  const shown = open.filter((v) => filter === "semua" || (filter === "perlu" ? needs(v) : !needs(v)));
  return (
    <ListPage
      as="section"
      title="Persetujuan Tindakan"
      sort={FILTERS.map((f) => ({ label: f.label, href: `/persetujuan-tindakan?status=${f.key}`, active: f.key === filter }))}
      state={
        open.length === 0 ? { kind: "empty", message: `Belum ada rencana tindakan hari ini di ${d.queue.branch_name}.` }
        : shown.length === 0 ? { kind: "filtered-empty", message: "Tidak ada pasien dengan status ini.", clearHref: "/persetujuan-tindakan" }
        : { kind: "rows" }
      }
    >
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{d.queue.branch_name} · rencana tindakan pasien hari ini</p>
      <RowList label="Pasien hari ini">
        {shown.map((v) => {
          const worst = v.plans.find((p) => p.consent === "outdated") ?? v.plans.find((p) => p.consent === "none") ?? v.plans[0];
          const st = CONSENT_STATE[worst.consent];
          return (
            <Row key={v.visit_id} href={`/persetujuan-tindakan/${v.visit_id}`} title={v.patient_name}
              subtitle={`${v.patient_mrn} · datang ${time(v.checked_in_at)} · ${v.plans.map((p) => p.title).join(", ")}`}>
              <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            </Row>
          );
        })}
      </RowList>
      <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Pasien tampil di sini setelah dokter membuat rencana tindakan.</p>
    </ListPage>
  );
}

export default function PersetujuanTindakanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
