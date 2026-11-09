// Antrean (UX-6 ▸ Antrean, 19:54, PR-71, T-048): today's numbers of one branch, shown under the title
// (PR-84). Menunggu first (number large, Panggil with a room, Lewati), then Dipanggil, Dilewati, Selesai.
// "Pasien Datang tanpa janji" opens a walk-in visit with the next number; Pendaftaran Pasien for a new
// patient. Manager, Owner and Admin Pusat pair and revoke the branch's TV displays (numbers only).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../components/templates/templates";
import { EmptyState, LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import type { Ticket } from "../../../modules/visits/queue/queue";
import { DISPLAY, loadAntrean } from "./data";
import { PairDisplay, RevokeDisplay, TicketActions, WalkIn } from "./forms";
import { STATE, time, ZONE } from "./labels";

export const metadata: Metadata = { title: "Antrean — Clinic Dashboard" };
type Q = { cabang?: string; aksi?: string };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const link = "inline-flex min-h-[var(--target)] items-center rounded-[var(--radius-field)] px-3 text-[var(--primary)] hover:bg-[var(--accent)]";
const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] bg-white p-3";

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid min-w-0 gap-2 scroll-mt-24">
      <h2 id={`${id}-h`} className="m-0 text-[1.18rem] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadAntrean(q);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Shell><PageTitle title="Antrean" /><PermissionState object="antrean" /></Shell>;
  if (p.kind === "no-branch") return <Shell><PageTitle title="Antrean" /><EmptyState message="Pilih cabang aktif di Saya › Ganti Cabang untuk membuka antreannya." /></Shell>;
  const tz = p.board.timezone;
  const zone = ZONE[tz] ?? "";
  const named = p.pickBranch ? p.branch.id : null;
  const by = (s: Ticket["state"]) => p.board.tickets.filter((t) => t.state === s);
  const row = (t: Ticket) => (
    <li key={t.id} className={card}>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="text-[2rem] font-bold leading-none tabular-nums">{t.number}</span>
        <StatusBadge tone={STATE[t.state].tone}>{STATE[t.state].label}</StatusBadge>
        {t.roomName && <span className={muted}>{t.roomName}{t.calledAt ? ` · ${time(t.calledAt, tz)} ${zone}` : ""}</span>}
      </div>
      <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{t.patientName}</strong> <span className={muted}>· {t.patientMrn} · {t.kind === "walk_in" ? "tanpa janji" : "dengan janji"}</span></span>
      <TicketActions ctx={p.ctx} ticket={t.id} label={`${t.number} ${t.patientName}`} rooms={p.board.rooms} state={t.state} />
    </li>
  );
  const groups: [string, string, Ticket[]][] = [["menunggu", "Menunggu", by("waiting")], ["dipanggil", "Dipanggil", by("called")], ["dilewati", "Dilewati", by("skipped")], ["selesai", "Selesai", by("done")]];
  return (
    <Shell>
      <PageTitle title="Antrean" />
      <p className="m-0 font-semibold">{p.branch.name} · {zone}</p>
      {p.pickBranch && p.branches.length > 1 && (
        <ul aria-label="Cabang" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
          {p.branches.map((b) => <li key={b.id}><Link className={link} aria-current={b.id === p.branch.id ? "page" : undefined} href={`/antrean?cabang=${b.id}`}>{b.name}</Link></li>)}
        </ul>
      )}
      <Section id="datang" title="Pasien Datang tanpa janji">
        <div className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <WalkIn ctx={p.ctx} branch={named} />
          <p className={muted}>Pasien baru? Daftarkan dulu di Pendaftaran Pasien. Pasien dengan janji dicatat datang di Hari Ini dan langsung mendapat nomor.</p>
          <div className="flex min-w-0 flex-wrap gap-1">
            <Link className={link} href="/pasien/baru">Pendaftaran Pasien</Link>
            <Link className={link} href="/hari-ini">Hari Ini</Link>
          </div>
        </div>
      </Section>
      {p.board.tickets.length === 0
        ? <EmptyState message="Belum ada nomor antrean hari ini." />
        : groups.filter(([, , xs]) => xs.length > 0).map(([id, title, xs]) => (
            <Section key={id} id={id} title={`${title} (${xs.length})`}>
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">{xs.map(row)}</ul>
            </Section>
          ))}
      {DISPLAY.includes(p.role) && (
        <Section id="layar" title="Layar TV">
          <div className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <p className={muted}>Layar menampilkan nomor dan ruang saja, tanpa nama pasien.</p>
            {p.board.displays.length > 0 && (
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {p.board.displays.map((d) => (
                  <li key={d.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span>{d.label} <span className={muted}>· dipasangkan {time(d.createdAt, tz)} {zone}</span></span>
                    <RevokeDisplay ctx={p.ctx} display={d.id} label={d.label} />
                  </li>
                ))}
              </ul>
            )}
            <PairDisplay ctx={p.ctx} branch={named} />
          </div>
        </Section>
      )}
    </Shell>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <Suspense fallback={<Shell><PageTitle title="Antrean" /><LoadingList label="Memuat antrean" /></Shell>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
