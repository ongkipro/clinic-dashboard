// Jadwal segments, shared presentation (HYG-NAV-2): the segment bar (Kalender · Daftar · Online · Tunggu), branch chips and an appointment
// row. Server components; names and MRNs only, never clinical content. Compact widths stack the row; regular widths keep it on one card.
import Link from "next/link";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { CalendarRow } from "../../../../modules/scheduling/appointments/appointments";
import { CHANNEL, localDate, STATE, time, ZONE } from "../labels";
import { manageHref } from "./model";

export const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
export const chip = "inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline";
const on = "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]";

export function Main({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</main>;
}

export function Chips({ label, items }: { label: string; items: { label: string; href: string; active?: boolean }[] }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined} className={`${chip} ${i.active ? on : "bg-transparent"}`}>{i.label}</Link>
      ))}
    </div>
  );
}

export type Segment = "kalender" | "daftar" | "online" | "tunggu";
export function Segments({ active, cabang, waitlist }: { active: Segment; cabang: string; waitlist: boolean }) {
  const q = `?cabang=${cabang}`;
  const items = [
    { id: "kalender", label: "Kalender", href: `/jadwal${q}` },
    { id: "daftar", label: "Daftar", href: `/jadwal/daftar${q}` },
    { id: "online", label: "Online", href: `/jadwal/online${q}` },
    ...(waitlist ? [{ id: "tunggu", label: "Tunggu", href: `/jadwal/tunggu${q}` }] : []),
  ];
  return <Chips label="Bagian jadwal" items={items.map((i) => ({ label: i.label, href: i.href, active: i.id === active }))} />;
}

export function AppointmentRow({ a, tz, branchId, write }: { a: CalendarRow; tz: string; branchId: string; write: boolean }) {
  const st = STATE[a.state] ?? { label: a.state, tone: "neutral" as const };
  const day = localDate(a.startsAt, tz);
  return (
    <li data-appointment={a.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--surface)] p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold tabular-nums">{day} · {time(a.startsAt, tz)}–{time(a.endsAt, tz)} {ZONE[tz] ?? ""}</span>
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        <span className={muted}>{CHANNEL[a.channel] ?? (a.channel === "online" ? "Online" : a.channel)}</span>
      </div>
      <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{a.patientName}</strong> <span className={muted}>· {a.patientMrn}</span></span>
      <span className={`${muted} [overflow-wrap:anywhere]`}>{a.serviceName} · {a.performerName}</span>
      {write && ["held", "booked", "confirmed"].includes(a.state) && (
        <Link href={manageHref(branchId, day)} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Kelola di Kalender</Link>
      )}
    </li>
  );
}

export function Empty({ message, action }: { message: string; action?: { label: string; href: string } }) {
  return (
    <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      <p className="m-0 text-[var(--label-2)]">{message}</p>
      {action && <Link href={action.href} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">{action.label}</Link>}
    </div>
  );
}
