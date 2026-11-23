// Jadwal Saya model (HYG-NAV-1): groups the caller's own shifts, leave and appointments per day (pure; tested in tests/ui/hyg-nav-1.test.ts).
export type Shift = { date: string; starts: string; ends: string; kind: string; branch: string };
export type Leave = { from: string; to: string; kind: string; branch: string };
export type Appt = { startsAt: Date; endsAt: Date; service: string; patient: string; state: string };
export type MyDay = { date: string; shifts: Shift[]; leave: { kind: string; branch: string } | null; appointments: Appt[] };

export const LEAVE: Record<string, string> = { leave: "Cuti", sick: "Sakit", absent: "Tidak hadir" };
const jakartaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// Every day of the window, in order; a day with leave shows the leave (its shifts and appointments stay listed: the manager resolves them).
export function mySchedule(x: { from: string; to: string; shifts: Shift[]; leave: Leave[]; appointments: Appt[] }): MyDay[] {
  return days(x.from, x.to).map((date) => {
    const l = x.leave.find((v) => v.from <= date && v.to >= date);
    return {
      date,
      shifts: x.shifts.filter((s) => s.date === date && s.kind === "work"),
      leave: l ? { kind: l.kind, branch: l.branch } : null,
      appointments: x.appointments.filter((a) => jakartaDay(a.startsAt) === date).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    };
  });
}
