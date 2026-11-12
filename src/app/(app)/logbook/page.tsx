// Logbook Alat, Sterilisasi & Limbah (UX-9 ▸ Logbook, 17:189, 19:105, PR-82; T-068): segments Sterilisasi · Kalibrasi
// & Perawatan · Limbah B3. Devices past their calibration or maintenance due date come first ("Alat lewat jatuh tempo
// kalibrasi"); the manager sets each device's schedule. Writers: doctor, nurse, therapist, manager at their active
// branch; the facility head, owner, admin pusat and auditor read (a tenant-wide reader picks the branch).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import type { Entry } from "../../../modules/safety/safety";
import { loadLogbook } from "./data";
import { DeviceEntryForm, ScheduleForm, SterilizationForm, WasteForm } from "./forms";
import { date, DEVICE_TYPE, grams, KIND_LABEL, METHOD, RESULT, ROLE_LABEL, SEG, type Seg, WASTE } from "./labels";

export const metadata: Metadata = { title: "Logbook — Clinic Dashboard" };
const TITLE = "Logbook Alat, Sterilisasi & Limbah";
const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function detail(e: Entry): string {
  if (e.kind === "sterilization")
    return [METHOD[e.method!], e.cycle_no && `siklus ${e.cycle_no}`, e.items, e.device_label, e.room_name].filter(Boolean).join(" · ");
  if (e.kind === "b3_waste") return [WASTE[e.waste_category!], grams(e.quantity_grams!), e.handler_name, `manifes ${e.handover_ref}`].join(" · ");
  return [KIND_LABEL[e.kind], e.device_label, e.performer_name, e.certificate_no && `sertifikat ${e.certificate_no}`].filter(Boolean).join(" · ");
}
function badge(e: Entry) {
  if (e.kind === "sterilization") return <StatusBadge tone={e.passed ? "success" : "danger"}>{e.passed ? "Lulus" : "Gagal"}</StatusBadge>;
  if (e.kind === "calibration" || e.kind === "maintenance") return <StatusBadge tone={RESULT[e.result!].tone}>{RESULT[e.result!].label}</StatusBadge>;
  return null;
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const seg: Seg = SEG.some((s) => s.key === q.tab) ? (q.tab as Seg) : "sterilization";
  const cabang = typeof q.cabang === "string" ? q.cabang : undefined;
  const d = await loadLogbook(cabang, seg);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="logbook" />;
  if (d.kind === "no-branch") return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const o = d.ov;
  const bq = d.wide ? `&cabang=${d.branch.id}` : "";
  const tabs = SEG.map((s) => ({ label: s.label, href: `/logbook?tab=${s.key}${bq}`, active: s.key === seg }));
  const overdue = o.devices.filter((x) => x.schedules.some((s) => s.overdue));
  const active = o.devices.filter((x) => x.active).map((x) => ({ id: x.id, name: x.label }));
  const empty =
    seg === "sterilization" ? "Belum ada siklus sterilisasi yang dicatat." : seg === "b3_waste" ? "Belum ada serah limbah B3 yang dicatat." : "Belum ada kalibrasi atau perawatan yang dicatat.";
  return (
    <ListPage as="section" title={`${TITLE} · ${d.branch.name}`} filters={tabs} state={{ kind: "rows" }}>
      <div className="grid min-w-0 gap-4">
        {overdue.length > 0 && (
          <section aria-label="Alat lewat jatuh tempo" className={`${card} border border-[var(--danger)]`}>
            <h2 className="m-0 text-[1.25rem] font-semibold">Alat lewat jatuh tempo kalibrasi</h2>
            <ul className="m-0 grid gap-1 pl-5">
              {overdue.flatMap((x) => x.schedules.filter((s) => s.overdue).map((s) => (
                <li key={s.id} className="[overflow-wrap:anywhere]">{`${x.label} · ${KIND_LABEL[s.kind].toLowerCase()} jatuh tempo ${date(s.next_due_on)}`}</li>
              )))}
            </ul>
          </section>
        )}
        {o.can_write && seg === "sterilization" && <SterilizationForm ctx={d.ctx} branch={d.branch.id} today={o.today} devices={active} rooms={o.rooms} />}
        {o.can_write && seg === "b3_waste" && (
          <>
            <WasteForm ctx={d.ctx} branch={d.branch.id} today={o.today} />
            <p className={muted}>Register serah limbah medis ke pengangkut berizin; pengangkutan dan pengolahan di luar aplikasi.</p>
          </>
        )}
        {seg === "calibration" && (
          <section aria-label="Alat" className="grid min-w-0 gap-2">
            <h2 className="m-0 text-[1.25rem] font-semibold">Alat</h2>
            {o.can_write && active.length > 0 && <DeviceEntryForm ctx={d.ctx} branch={d.branch.id} today={o.today} devices={active} />}
            {o.devices.length === 0 ? (
              <p className={muted}>Belum ada alat di cabang ini. Tambahkan di Pengaturan › Ruang, Bed & Alat.</p>
            ) : (
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {o.devices.map((x) => (
                  <li key={x.id} className={card}>
                    <span className="font-semibold [overflow-wrap:anywhere]">{x.label}</span>
                    <span className="flex min-w-0 flex-wrap gap-1">
                      {x.schedules.some((s) => s.overdue) && <StatusBadge tone="danger">Lewat jatuh tempo</StatusBadge>}
                      {!x.active && <StatusBadge tone="neutral">Nonaktif</StatusBadge>}
                    </span>
                    <span className={muted}>
                      {[DEVICE_TYPE[x.type] ?? x.type, ...x.schedules.map((s) => `${KIND_LABEL[s.kind]} tiap ${s.interval_days} hari, berikutnya ${date(s.next_due_on)}${s.active ? "" : " (nonaktif)"}`),
                        x.schedules.length === 0 && "Belum ada jadwal"].filter(Boolean).join(" · ")}
                    </span>
                    {o.can_schedule && x.active && (
                      <div className="flex min-w-0 flex-wrap gap-2">
                        {(["calibration", "maintenance"] as const).map((k) => {
                          const s0 = x.schedules.find((s) => s.kind === k);
                          return <ScheduleForm key={k} ctx={d.ctx} branch={d.branch.id} device={x.id} label={x.label} kind={k} today={o.today} s0={s0} />;
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section aria-label="Catatan" className="grid min-w-0 gap-2">
          <h2 className="m-0 text-[1.25rem] font-semibold">Catatan</h2>
          {o.entries.length === 0 ? <p className={muted}>{empty}</p> : (
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
              {o.entries.map((e) => (
                <li key={e.id} className={card}>
                  <span className="font-semibold [overflow-wrap:anywhere]">{`${KIND_LABEL[e.kind]} · ${date(e.performed_on)}`}</span>
                  <span className="flex min-w-0 flex-wrap gap-1">
                    {badge(e)}
                    {e.corrected && <StatusBadge tone="warning">Dikoreksi</StatusBadge>}
                    {e.corrects && <StatusBadge tone="neutral">Koreksi</StatusBadge>}
                  </span>
                  <span className="[overflow-wrap:anywhere]">{detail(e)}</span>
                  {e.note && <span className={muted}>{e.note}</span>}
                  <span className={muted}>{`dicatat ${e.recorded_name} (${ROLE_LABEL[e.recorded_as] ?? e.recorded_as})`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {!o.can_write && <p className={muted}>Logbook hanya dapat dibaca oleh peran ini.</p>}
        {d.wide && d.branches.length > 1 && (
          <div role="group" aria-label="Cabang" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
            {d.branches.map((b) => (
              <Link key={b.id} href={`/logbook?tab=${seg}&cabang=${b.id}`} aria-current={b.id === d.branch.id ? "true" : undefined}
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

export default function LogbookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
