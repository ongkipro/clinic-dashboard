// Jadwal Staf (UX-33, PR-48, T-043): the week of one branch for Owner, Admin Pusat and the manager.
// Sections: branch and week navigation with a role filter; the branch's hours and closures for the week;
// the week grid (Simpan Jadwal); Cuti & Izin (add, cancel). Other roles see the permission state.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../components/templates/templates";
import { EmptyState, LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { mondayOf, loadJadwal, ROSTER_ROLES } from "./data";
import { AddLeaveForm, CancelLeave, WeekForm } from "./forms";
import { DAY_SHORT, dayLabel, LEAVE_LABEL, ROLE_LABEL } from "./labels";

export const metadata: Metadata = { title: "Jadwal Staf — Clinic Dashboard" };
type Q = { cabang?: string; minggu?: string; peran?: string };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const link = "inline-flex min-h-[var(--target)] items-center rounded-[var(--radius-field)] px-3 text-[var(--primary)] hover:bg-[var(--accent)]";
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1280px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadJadwal(q);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Shell><PageTitle title="Jadwal Staf" /><PermissionState object="jadwal staf" /></Shell>;
  if (p.kind === "no-branch") return <Shell><PageTitle title="Jadwal Staf" /><EmptyState message="Belum ada cabang yang dapat Anda atur." /></Shell>;
  const role = (ROSTER_ROLES as readonly string[]).includes(q.peran ?? "") ? q.peran! : "";
  const staff = role ? p.staff.filter((s) => s.roles.includes(role as never)) : p.staff;
  const href = (o: Partial<Q>) => {
    const u = new URLSearchParams({ cabang: p.branch.id, minggu: p.week, ...(role ? { peran: role } : {}), ...o });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    return `/jadwal-staf?${u}`;
  };
  const hours = DAY_SHORT.map((d, i) => [d, p.hours.filter((h) => h.weekday === i).map((h) => `${h.opens}–${h.closes}`).join(", ") || "Tutup"]);
  const active = p.leave.filter((l) => !l.cancelledAt);
  const name = (id: string) => p.staff.find((s) => s.id === id)?.name ?? "Staf";
  return (
    <Shell>
      <PageTitle title="Jadwal Staf" />
      <nav aria-label="Pilih cabang, minggu dan peran" className="grid min-w-0 gap-3">
        {p.branches.length > 1 && (
          <ul aria-label="Cabang" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
            {p.branches.map((b) => (
              <li key={b.id}><Link className={link} aria-current={b.id === p.branch.id ? "page" : undefined} href={href({ cabang: b.id })}>{b.name}</Link></li>
            ))}
          </ul>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Link className={link} href={href({ minggu: shift(p.week, -7) })}>‹ Minggu sebelumnya</Link>
          <span className="font-semibold">{dayLabel(p.days[0])} – {dayLabel(p.days[6])}</span>
          <Link className={link} href={href({ minggu: shift(p.week, 7) })}>Minggu berikutnya ›</Link>
          {p.week !== mondayOf(p.today) && <Link className={link} href={href({ minggu: "" })}>Minggu ini</Link>}
        </div>
        <ul aria-label="Peran" className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
          <li><Link className={link} aria-current={!role ? "page" : undefined} href={href({ peran: "" })}>Semua peran</Link></li>
          {ROSTER_ROLES.map((r) => <li key={r}><Link className={link} aria-current={role === r ? "page" : undefined} href={href({ peran: r })}>{ROLE_LABEL[r]}</Link></li>)}
        </ul>
      </nav>

      <section aria-labelledby="jam-cabang" className="grid min-w-0 gap-2">
        <h2 id="jam-cabang" className="m-0 text-[1.18rem] font-semibold">Jam buka & libur {p.branch.name}</h2>
        <dl className="m-0 grid min-w-0 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
          {hours.map(([d, h]) => (
            <div key={d} className="rounded-[var(--radius-field)] bg-[var(--surface)] p-2">
              <dt className={muted}>{d}</dt>
              <dd className="m-0 [overflow-wrap:anywhere]">{h}</dd>
            </div>
          ))}
        </dl>
        {p.closures.length > 0 && (
          <ul aria-label="Libur minggu ini" className="m-0 grid list-none gap-1 p-0">
            {p.closures.map((c) => <li key={c.id}><StatusBadge tone="warning">{`${dayLabel(c.date)}${c.from ? ` ${c.from}–${c.until}` : ""}: ${c.reason}`}</StatusBadge></li>)}
          </ul>
        )}
        <div><Link className={link} href={`/pengaturan/cabang/${p.branch.id}#jam`}>Ubah jam buka dan libur cabang</Link></div>
      </section>

      <section aria-labelledby="kisi" className="grid min-w-0 gap-2">
        <h2 id="kisi" className="m-0 text-[1.18rem] font-semibold">Jadwal kerja</h2>
        {p.staff.length === 0
          ? <EmptyState message="Belum ada staf yang ditugaskan di cabang ini." />
          : staff.length === 0
            ? <EmptyState message={`Tidak ada staf dengan peran ${ROLE_LABEL[role]} di cabang ini.`} />
            : <WeekForm key={`${p.branch.id}-${p.week}-${role}`} ctx={p.ctx} branch={p.branch.id} week={p.week} days={p.days} today={p.today} staff={staff} shifts={p.shifts} leave={p.leave} />}
      </section>

      <section aria-labelledby="cuti" className="grid min-w-0 gap-3">
        <h2 id="cuti" className="m-0 text-[1.18rem] font-semibold">Cuti & izin</h2>
        {active.length === 0
          ? <p className="m-0">Tidak ada staf yang cuti atau izin minggu ini.</p>
          : (
            <ul aria-label="Cuti dan izin minggu ini" className="m-0 grid list-none gap-3 p-0">
              {active.map((l) => {
                const label = `${LEAVE_LABEL[l.kind]} ${name(l.staffId)} ${dayLabel(l.from)}${l.to !== l.from ? ` – ${dayLabel(l.to)}` : ""}`;
                return (
                  <li key={l.id} className="@container grid min-w-0 gap-1 rounded-[var(--radius-group)] bg-[var(--surface)] p-3">
                    <span className="font-semibold [overflow-wrap:anywhere]">{label}</span>
                    <p className={`${muted} [overflow-wrap:anywhere]`}>{l.reason}</p>
                    {l.from >= p.today && <CancelLeave ctx={p.ctx} id={l.id} label={label} />}
                  </li>
                );
              })}
            </ul>
          )}
        <div className="rounded-[var(--radius-group)] bg-[var(--surface)] p-4"><AddLeaveForm ctx={p.ctx} branch={p.branch.id} staff={p.staff} today={p.today} /></div>
      </section>
    </Shell>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat jadwal staf" />}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
