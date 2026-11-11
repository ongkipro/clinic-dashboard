// Ruang (UX-9, 19:102; T-064): today's visits at the active branch with treatment items, grouped by room (an
// execution's room, else the appointment's treatment room, else "Belum ditentukan"); each row: patient, treatment,
// time, VisitTrack and the item state. Blocked visits stay listed with their blocker. Doctor, nurse, therapist.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { VisitTrack } from "../../../components/visit-track/visit-track";
import type { RoomVisit } from "../../../modules/treatment/treatment";
import { track } from "./track";
import { loadList } from "./data";
import { STAGE_LABEL, STATE_LABEL } from "./labels";

export const metadata: Metadata = { title: "Ruang Tindakan — Clinic Dashboard" };

const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const muted = "text-[0.88rem] text-[var(--label-2)]";

async function Body() {
  const d = await loadList();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="ruang tindakan" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Ruang Tindakan" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const groups = new Map<string, { name: string; visits: RoomVisit[] }>();
  for (const v of d.list.visits) {
    const k = v.room?.id ?? "";
    const g = groups.get(k) ?? { name: v.room?.name ?? "Belum ditentukan", visits: [] };
    g.visits.push(v);
    groups.set(k, g);
  }
  const ordered = [...groups.entries()].sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : x.name.localeCompare(y.name, "id")));
  return (
    <ListPage as="section" title="Ruang Tindakan"
      state={d.list.visits.length === 0 ? { kind: "empty", message: `Belum ada pasien dengan tindakan hari ini di ${d.list.branch_name}.` } : { kind: "rows" }}>
      <div className="grid min-w-0 gap-6">
        {ordered.map(([k, g]) => (
          <section key={k || "none"} aria-label={g.name} className="grid min-w-0 gap-3">
            <h2 className="m-0 text-[1.25rem] font-semibold">{g.name}</h2>
            <ul className="m-0 grid min-w-0 list-none gap-3 p-0">
              {g.visits.map((v) => {
                const t = track(v);
                return (
                  <li key={v.visit_id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
                    <Link href={`/ruang/${v.visit_id}`} className="grid min-h-[52px] min-w-0 gap-1 text-[var(--label)] no-underline">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-semibold [overflow-wrap:anywhere]">{v.patient_name}</span>
                        <span className={muted}>{`${v.patient_mrn} · datang ${time(v.checked_in_at)}`}</span>
                        {v.closed && <StatusBadge tone="locked">Kunjungan selesai</StatusBadge>}
                      </span>
                      {v.items.map((i) => (
                        <span key={i.plan_item_id} className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="[overflow-wrap:anywhere]">{i.name}</span>
                          {i.execution
                            ? <StatusBadge tone={i.execution.state === "finished" ? "success" : "warning"}>
                                {i.execution.state === "finished" ? STATE_LABEL.finished : `${STATE_LABEL[i.execution.state]} · ${STAGE_LABEL[i.execution.stage]}`}
                              </StatusBadge>
                            : <StatusBadge tone="neutral">Belum dimulai</StatusBadge>}
                        </span>
                      ))}
                    </Link>
                    {t.blocker ? <VisitTrack states={t.states} blocker={t.blocker} summary /> : <VisitTrack states={t.states} summary />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </ListPage>
  );
}

export default function RuangPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
