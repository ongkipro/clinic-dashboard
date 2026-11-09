// Hari Ini (UX-6, PR-7, T-047; 19:52): one branch's day. "Belum dibayar" first when non-empty, then
// "Belum datang" (today's appointments not yet arrived, with Pasien Datang) and "Kunjungan" (open visits
// and today's closed ones) with VisitTrack and the one blocker; Tutup Kunjungan is disabled with the
// blocker named (PR-15). Filters Semua · Menunggu · Belum Bayar. Names and MRNs only: no diagnosis or
// photos. Panggil arrives with the queue (T-048) and Tagih with the cashier (M4).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../components/templates/templates";
import { EmptyState, LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { VisitTrack } from "../../../components/visit-track/visit-track";
import { BLOCKER_COPY, closeBlocker, trackStates, unpaid, type Visit } from "../../../modules/visits/visits";
import { loadHariIni } from "./data";
import { CheckIn, CloseVisit } from "./forms";
import { dayLabel, time, type View, VIEWS, ZONE } from "./labels";

export const metadata: Metadata = { title: "Hari Ini — Clinic Dashboard" };
type Q = { cabang?: string; tampilan?: string };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const link = "inline-flex min-h-[var(--target)] items-center rounded-[var(--radius-field)] px-3 text-[var(--primary)] hover:bg-[var(--accent)]";
const card = "@container grid min-w-0 gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] bg-white p-3";

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}
function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid min-w-0 gap-2 scroll-mt-24">
      <h2 id={`${id}-h`} className="m-0 text-[1.18rem] font-semibold">{title} <span className="font-normal text-[var(--label-2)]">({count})</span></h2>
      {children}
    </section>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadHariIni(q);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Shell><PageTitle title="Hari Ini" /><PermissionState object="papan Hari Ini" /></Shell>;
  if (p.kind === "no-branch") return <Shell><PageTitle title="Hari Ini" /><EmptyState message="Belum ada cabang yang dapat Anda buka." /></Shell>;
  const tz = p.board.timezone;
  const zone = ZONE[tz] ?? "";
  const view: View = q.tampilan === "menunggu" || q.tampilan === "belum-bayar" ? q.tampilan : "semua";
  const href = (v: View) => `/hari-ini?${new URLSearchParams({ cabang: p.branch.id, ...(v === "semua" ? {} : { tampilan: v }) })}`;
  const now = p.board.now.getTime();
  const { visits, arrivals } = p.board;
  const open = visits.filter((v) => v.closedAt === null);
  const owed = visits.filter(unpaid);
  const shownArrivals = view === "belum-bayar" ? [] : arrivals;
  const shownVisits = view === "belum-bayar" ? [] : view === "menunggu" ? open : visits;
  const nothingToday = visits.length === 0 && arrivals.length === 0;
  const filteredEmpty = !nothingToday && owed.length === 0 && shownArrivals.length === 0 && shownVisits.length === 0;
  const label = (v: Visit) => `${v.patientName} ${time(v.startsAt ?? v.checkedInAt, tz)}`;

  const visitRow = (v: Visit) => {
    const t = trackStates(v);
    const cb = v.closedAt ? null : closeBlocker(v);
    return (
      <li key={v.id} className={card}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold tabular-nums">{time(v.startsAt ?? v.checkedInAt, tz)} {zone}</span>
          {v.closedAt ? <StatusBadge tone="locked">Selesai</StatusBadge> : <StatusBadge tone="success">{`Datang ${time(v.checkedInAt, tz)}`}</StatusBadge>}
        </div>
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <Link href={`/pasien/${v.patientId}`} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--label)] underline-offset-2 hover:underline">{v.patientName}</Link>
          <span className={muted}> · {v.patientMrn}</span>
        </span>
        {t.blocker ? <VisitTrack states={t.states} blocker={t.blocker} /> : <VisitTrack states={t.states} />}
        {!v.closedAt && <CloseVisit ctx={p.ctx} id={v.id} label={label(v)} blocker={cb ? BLOCKER_COPY[cb] : null} />}
      </li>
    );
  };

  return (
    <Shell>
      <PageTitle title="Hari Ini" />
      <nav aria-label="Cabang dan tampilan" className="grid min-w-0 gap-2">
        <p className="m-0 font-semibold">{p.branch.name} · {dayLabel(p.board.today)} · {zone}</p>
        {p.branches.length > 1 && (
          <ul aria-label="Cabang" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
            {p.branches.map((b) => <li key={b.id}><Link className={link} aria-current={b.id === p.branch.id ? "page" : undefined} href={`/hari-ini?cabang=${b.id}`}>{b.name}</Link></li>)}
          </ul>
        )}
        <ul aria-label="Tampilan" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
          {(Object.keys(VIEWS) as View[]).map((v) => <li key={v}><Link className={link} aria-current={view === v ? "page" : undefined} href={href(v)}>{VIEWS[v]}</Link></li>)}
        </ul>
      </nav>
      {nothingToday ? (
        <EmptyState message="Belum ada janji atau kunjungan hari ini." />
      ) : filteredEmpty ? (
        <div className="grid min-w-0 gap-2">
          <EmptyState message={view === "belum-bayar" ? "Tidak ada kunjungan yang belum dibayar." : "Tidak ada pasien yang sedang menunggu."} />
          <div><Link className={link} href={href("semua")}>Hapus Filter</Link></div>
        </div>
      ) : (
        <>
          {owed.length > 0 && (
            <Section id="belum-dibayar" title="Belum dibayar" count={owed.length}>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {owed.map((v) => (
                  <li key={v.id} className={card}>
                    <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{v.patientName}</strong> <span className={muted}>· {v.patientMrn} · datang {time(v.checkedInAt, tz)} {zone}</span></span>
                    <p className={muted}>Tagihan dibuka di Kasir (segera tersedia).</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {shownArrivals.length > 0 && (
            <Section id="belum-datang" title="Belum datang" count={shownArrivals.length}>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {shownArrivals.map((a) => (
                  <li key={a.id} className={card}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{time(a.startsAt, tz)} {zone}</span>
                      <StatusBadge tone={a.state === "confirmed" ? "success" : "neutral"}>{a.state === "confirmed" ? "Dikonfirmasi" : "Terjadwal"}</StatusBadge>
                    </div>
                    <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{a.patientName}</strong> <span className={muted}>· {a.patientMrn} · {a.serviceName}</span></span>
                    <CheckIn ctx={p.ctx} id={a.id} label={`${a.patientName} ${time(a.startsAt, tz)}`} ready={now >= a.checkInFrom.getTime()} from={`${time(a.checkInFrom, tz)} ${zone}`} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {shownVisits.length > 0 && (
            <Section id="kunjungan" title="Kunjungan" count={shownVisits.length}>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">{shownVisits.map(visitRow)}</ul>
            </Section>
          )}
        </>
      )}
    </Shell>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <Suspense fallback={<Shell><PageTitle title="Hari Ini" /><LoadingList label="Memuat papan Hari Ini" /></Shell>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
