// Insiden Keselamatan Pasien (UX-28 ▸ Insiden, 17:188, 19:96, PR-82; T-068): the register of a branch for the facility
// head (owner and auditor read, picking the branch); other clinical roles and the manager see the incidents they
// reported and their state. Open first, newest first. Catat Insiden for reporters at their active branch.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadIncidents } from "./data";
import { ReportForm } from "./forms";
import { CLASS_LABEL, STATE, when } from "./labels";

export const metadata: Metadata = { title: "Insiden Keselamatan Pasien — Clinic Dashboard" };
const TITLE = "Insiden Keselamatan Pasien";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadIncidents(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden" || d.kind === "not-found") return <PermissionState object="insiden keselamatan pasien" />;
  if (d.kind === "no-branch") return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const l = d.list;
  const rows = l.incidents;
  return (
    <ListPage as="section" title={`${TITLE} · ${d.branch.name}`}
      state={rows.length === 0 && !l.can_report ? { kind: "empty", message: "Belum ada insiden di cabang ini." } : { kind: "rows" }}>
      <div className="grid min-w-0 gap-4">
        {l.can_report && <ReportForm ctx={d.ctx} branch={d.branch.id} patients={d.patients} />}
        {!l.register && <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Insiden yang Anda laporkan dan statusnya. Investigasi hanya terlihat oleh Penanggung Jawab Klinik.</p>}
        {rows.length === 0 ? (
          <p className="m-0 text-[var(--label-2)]">{l.register ? "Belum ada insiden di cabang ini." : "Anda belum melaporkan insiden."}</p>
        ) : (
          <RowList label={l.register ? "Register insiden" : "Laporan saya"}>
            {rows.map((i) => (
              <Row key={i.id} href={`/keluhan/insiden/${i.id}`} title={`${CLASS_LABEL[i.classification].short} · ${when(i.occurred_at)}`}
                subtitle={[i.patient_name && `${i.patient_name} · ${i.patient_mrn}`, i.summary, l.register && `dilaporkan ${i.reported_name}`].filter(Boolean).join(" · ")}>
                <span className="flex min-w-0 flex-wrap justify-end gap-1">
                  {i.state === "investigating" && !i.investigated_at && l.register && <StatusBadge tone="warning">Investigasi belum selesai</StatusBadge>}
                  <StatusBadge tone={STATE[i.state].tone}>{STATE[i.state].label}</StatusBadge>
                </span>
              </Row>
            ))}
          </RowList>
        )}
        {d.wide && d.branches.length > 1 && (
          <div role="group" aria-label="Cabang" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
            {d.branches.map((b) => (
              <Link key={b.id} href={`/keluhan/insiden?cabang=${b.id}`} aria-current={b.id === d.branch.id ? "true" : undefined}
                className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline ${b.id === d.branch.id ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : ""}`}>
                {b.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </ListPage>
  );
}

export default function InsidenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
