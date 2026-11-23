// Jadwal Saya data (Saya › Jadwal Saya, 19:229; HYG-NAV-1): the acting staff member's own shifts and leave for 14 days, every branch
// (queries.ts, RLS self rows), plus — for performer
// roles at their active branch — their own appointments through the existing calendar reader (appointments_window, filtered to the
// performer). No other staff member's rows; no new reader.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { calendar } from "../../../../modules/scheduling/appointments/appointments";
import { type MyDay, mySchedule } from "./model";
import { myLeave, myShifts } from "./queries";

const PERFORMERS = ["doctor", "nurse", "therapist"];
export type JadwalSaya = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; from: string; to: string; days: MyDay[]; appointmentsShown: boolean };

const jakartaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const plus = (day: string, n: number) => {
  const x = new Date(`${day}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export async function loadJadwalSaya(): Promise<JadwalSaya> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const c = rc.active.context;
  const from = jakartaDay(new Date());
  const to = plus(from, 13);
  return withTenantContext(await appPool(), c, async (db) => {
    const shifts = await myShifts(db, from, to);
    const leave = await myLeave(db, from, to);
    let appointments: { startsAt: Date; endsAt: Date; service: string; patient: string; state: string }[] = [];
    const showAppts = PERFORMERS.includes(c.actingRole) && !!c.activeBranchId;
    if (showAppts) {
      try {
        const cal = await calendar(db, c.activeBranchId!, from, to);
        appointments = cal.appointments.filter((a) => a.performerId === c.staffId && !["cancelled", "rescheduled"].includes(a.state))
          .map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, service: a.serviceName, patient: a.patientName, state: a.state }));
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
      }
    }
    return { kind: "ok" as const, from, to, appointmentsShown: showAppts, days: mySchedule({ from, to, shifts, leave, appointments }) };
  });
}
