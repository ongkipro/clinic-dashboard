// Jadwal Saya (Saya › Jadwal Saya, 19:229; HYG-NAV-1): the caller's own shifts and leave for the next 14 days and, for performers, their
// own appointments at the active branch. Read only; schedules are set in Jadwal Praktik (UX-33).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadJadwalSaya } from "./data";
import { LEAVE } from "./model";

export const metadata: Metadata = { title: "Jadwal Saya — Clinic Dashboard" };
const TITLE = "Jadwal Saya";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const dayLabel = (d: string) => new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const time = (d: Date) => new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).format(d);

async function Body() {
  const r = await loadJadwalSaya();
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "jadwal" }} />;
  const busy = r.days.filter((d) => d.shifts.length || d.leave || d.appointments.length);
  if (busy.length === 0) return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Belum ada jadwal untuk 14 hari ke depan." }} />;
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <p className={muted}>{`14 hari ke depan · WIB${r.appointmentsShown ? " · janji di cabang aktif" : ""}`}</p>
      <ol aria-label="Jadwal per hari" className="m-0 grid min-w-0 list-none gap-3 p-0 min-[900px]:grid-cols-2">
        {busy.map((d) => (
          <li key={d.date} className="grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-[1.05rem] font-semibold">{dayLabel(d.date)}</h2>
              {d.leave && <StatusBadge tone="warning">{`${LEAVE[d.leave.kind] ?? d.leave.kind} · ${d.leave.branch}`}</StatusBadge>}
            </div>
            {d.shifts.map((s) => <p key={`${s.branch}${s.starts}`} className="m-0 tabular-nums">{`${s.starts}–${s.ends} · ${s.branch}`}</p>)}
            {d.appointments.length > 0 && (
              <ul aria-label={`Janji ${dayLabel(d.date)}`} className="m-0 grid list-none gap-1 border-t border-[var(--separator)] p-0 pt-2 [border-top-width:0.5px]">
                {d.appointments.map((a) => (
                  <li key={a.startsAt.toISOString() + a.patient} className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="tabular-nums">{`${time(a.startsAt)}–${time(a.endsAt)}`}</span>{` · ${a.service} · ${a.patient}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </ListPage>
  );
}

export default function JadwalSayaPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat jadwal" />}><Body /></Suspense>
    </main>
  );
}
