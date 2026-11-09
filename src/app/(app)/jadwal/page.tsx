// Jadwal (UX-5, PR-83, T-045): Hari Ini · Minggu for one branch, filtered by performer, room or device.
// Compact widths read as a phone agenda (the week as stacked days); regular widths show the week as a
// grid of day columns. Each appointment shows its state as a word (UI-3) and the branch zone; writers get
// Konfirmasi, Ubah Jadwal, Batalkan and Tandai Tidak Datang, and Buat Janji (the one prominent action).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../components/templates/templates";
import { EmptyState, LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import type { CalendarRow } from "../../../modules/scheduling/appointments/appointments";
import { loadJadwal } from "./data";
import { NewAppointment, RowActions } from "./forms";
import { dayLabel, localDate, STATE, time, ZONE } from "./labels";

export const metadata: Metadata = { title: "Jadwal — Clinic Dashboard" };
type Q = { cabang?: string; tampilan?: string; tanggal?: string; pasien?: string; aksi?: string; dokter?: string; ruang?: string; alat?: string };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const link = "inline-flex min-h-[var(--target)] items-center rounded-[var(--radius-field)] px-3 text-[var(--primary)] hover:bg-[var(--accent)]";
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

type Ready = Extract<Awaited<ReturnType<typeof loadJadwal>>, { kind: "ok" }>;

// In the week view the row is compact (time, state, patient, service) with a link to that day, where the
// actions are: seven narrow columns cannot hold four action buttons without wrapping them word by word.
function Row({ p, a, now, compact }: { p: Ready; a: CalendarRow; now: number; compact?: boolean }) {
  const tz = p.branch.timezone;
  const zone = ZONE[tz] ?? "";
  const st = STATE[a.state] ?? { label: a.state, tone: "neutral" as const };
  const label = `${a.patientName} ${time(a.startsAt, tz)}`;
  return (
    <li className="@container grid min-w-0 gap-1 rounded-[var(--radius-field)] border border-[var(--separator)] bg-white p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold tabular-nums">{time(a.startsAt, tz)}–{time(a.endsAt, tz)} {zone}</span>
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
      </div>
      <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{a.patientName}</strong> <span className={muted}>· {a.patientMrn}</span></span>
      <span className={`${muted} [overflow-wrap:anywhere]`}>{a.serviceName} · {a.performerName}{a.rooms.length ? ` · ${a.rooms.map((r) => r.name).join(", ")}` : ""}{a.devices.length ? ` · ${a.devices.map((d) => d.name).join(", ")}` : ""}</span>
      {compact && p.write && ["booked", "confirmed"].includes(a.state) && (
        <a className="inline-flex min-h-[var(--target)] items-center text-[var(--primary)]" href={`/jadwal?cabang=${p.branch.id}&tampilan=hari&tanggal=${localDate(a.startsAt, tz)}`}>Kelola</a>
      )}
      {!compact && p.write && (
        <RowActions ctx={p.ctx} branch={p.branch.id} tz={tz} id={a.id} versionId={a.versionId} state={a.state} label={label}
          noShowReady={now >= a.noShowFrom.getTime()} noShowLabel={`${time(a.noShowFrom, tz)} ${zone}`} date={localDate(a.startsAt, tz)} />
      )}
    </li>
  );
}

function Day({ p, d, rows, now, compact }: { p: Ready; d: string; rows: CalendarRow[]; now: number; compact?: boolean }) {
  return (
    <section aria-label={dayLabel(d)} className="grid min-w-0 content-start gap-2">
      <h3 className="m-0 text-[1.05rem] font-semibold">{dayLabel(d)}{d === p.today ? " · Hari ini" : ""}</h3>
      {rows.length === 0 ? <p className={muted}>Tidak ada janji.</p> : <ul className="m-0 grid min-w-0 list-none gap-2 p-0">{rows.map((a) => <Row key={a.id} p={p} a={a} now={now} compact={compact} />)}</ul>}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1280px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadJadwal(q);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Shell><PageTitle title="Jadwal" /><PermissionState object="jadwal" /></Shell>;
  if (p.kind === "no-branch") return <Shell><PageTitle title="Jadwal" /><EmptyState message="Belum ada cabang yang dapat Anda buka." /></Shell>;
  const tz = p.branch.timezone;
  const href = (o: Partial<Q>) => {
    const u = new URLSearchParams({ cabang: p.branch.id, tampilan: p.view, tanggal: p.day, ...(q.dokter ? { dokter: q.dokter } : {}), ...(q.ruang ? { ruang: q.ruang } : {}), ...(q.alat ? { alat: q.alat } : {}), ...o });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    return `/jadwal?${u}`;
  };
  const rooms = new Map<string, string>();
  const devices = new Map<string, string>();
  for (const a of p.cal.appointments) {
    for (const r of a.rooms) rooms.set(r.id, r.name);
    for (const d of a.devices) devices.set(d.id, d.name);
  }
  const filtered = p.cal.appointments.filter((a) =>
    (!q.dokter || a.performerId === q.dokter) && (!q.ruang || a.rooms.some((r) => r.id === q.ruang)) && (!q.alat || a.devices.some((d) => d.id === q.alat)));
  const anyFilter = Boolean(q.dokter || q.ruang || q.alat);
  const byDay = (d: string) => filtered.filter((a) => localDate(a.startsAt, tz) === d);
  const now = p.nowMs;
  const step = p.view === "minggu" ? 7 : 1;
  return (
    <Shell>
      <PageTitle title="Jadwal" action={p.write && !p.openNew ? { label: "Buat Janji", href: href({ aksi: "baru" }) } : undefined} />
      <nav aria-label="Cabang, tampilan dan tanggal" className="grid min-w-0 gap-2">
        {p.branches.length > 1 && (
          <ul aria-label="Cabang" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
            {p.branches.map((b) => <li key={b.id}><Link className={link} aria-current={b.id === p.branch.id ? "page" : undefined} href={href({ cabang: b.id, dokter: "", ruang: "", alat: "" })}>{b.name}</Link></li>)}
          </ul>
        )}
        <div role="group" aria-label="Tampilan" className="flex min-w-0 flex-wrap items-center gap-1">
          <Link className={link} aria-current={p.view === "hari" ? "page" : undefined} href={href({ tampilan: "hari" })}>Hari Ini</Link>
          <Link className={link} aria-current={p.view === "minggu" ? "page" : undefined} href={href({ tampilan: "minggu" })}>Minggu</Link>
          <Link className={link} href={href({ tanggal: shift(p.day, -step) })}>‹ Sebelumnya</Link>
          <span className="font-semibold">{p.view === "minggu" ? `${dayLabel(p.days[0])} – ${dayLabel(p.days[6])}` : dayLabel(p.day)}</span>
          <Link className={link} href={href({ tanggal: shift(p.day, step) })}>Berikutnya ›</Link>
          {p.day !== p.today && <Link className={link} href={href({ tanggal: p.today })}>Hari ini</Link>}
        </div>
      </nav>
      <section aria-labelledby="saring" className="grid min-w-0 gap-2">
        <h2 id="saring" className="sr-only">Saring</h2>
        <ul aria-label="Saring dokter" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
          <li><Link className={link} aria-current={!q.dokter ? "page" : undefined} href={href({ dokter: "" })}>Semua tenaga</Link></li>
          {p.cal.performers.map((x) => <li key={x.id}><Link className={link} aria-current={q.dokter === x.id ? "page" : undefined} href={href({ dokter: x.id })}>{x.name}</Link></li>)}
        </ul>
        {(rooms.size > 0 || devices.size > 0) && (
          <ul aria-label="Saring ruang dan alat" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
            {[...rooms].map(([id, name]) => <li key={id}><Link className={link} aria-current={q.ruang === id ? "page" : undefined} href={href({ ruang: q.ruang === id ? "" : id })}>{name}</Link></li>)}
            {[...devices].map(([id, name]) => <li key={id}><Link className={link} aria-current={q.alat === id ? "page" : undefined} href={href({ alat: q.alat === id ? "" : id })}>{name}</Link></li>)}
          </ul>
        )}
      </section>
      {p.openNew && (
        <NewAppointment ctx={p.ctx} branch={p.branch.id} tz={tz} date={p.day} services={p.services} search={p.search}
          patient={p.patient && { id: p.patient.id, mrn: p.patient.mrn, fullName: p.patient.fullName, birthYear: p.patient.birthYear, maskedPhone: p.patient.maskedPhone }} />
      )}
      {p.cal.appointments.length === 0
        ? <EmptyState message={p.view === "minggu" ? "Belum ada janji minggu ini." : "Belum ada janji pada tanggal ini."} />
        : filtered.length === 0
          ? (
            <div className="grid min-w-0 gap-2">
              <EmptyState message="Tidak ada janji untuk filter ini." />
              <div><Link className={link} href={href({ dokter: "", ruang: "", alat: "" })}>Hapus Filter</Link></div>
            </div>
          )
          : p.view === "minggu"
            ? <div className="@container min-w-0"><div className="grid min-w-0 gap-4 @[60rem]:grid-cols-7 @[60rem]:gap-2">{p.days.map((d) => <Day key={d} p={p} d={d} rows={byDay(d)} now={now} compact />)}</div></div>
            : <Day p={p} d={p.day} rows={byDay(p.day)} now={now} />}
      {anyFilter && filtered.length > 0 && <div><Link className={link} href={href({ dokter: "", ruang: "", alat: "" })}>Hapus Filter</Link></div>}
    </Shell>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat jadwal" />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
