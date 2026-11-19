// Ruang Saya data (UX-60, 19 §2.1; T-107 UI slice 2, Panel 2 decision 2026-11-19). Existing readers only, in the
// active context: treatment_room_list() for today's room visits (UX-9), appointments_window() for the next arriving
// patient, target_mine() for the own commission of this month (Panel 2 slice 4: the 0103 scorecard's commission_net =
// gross + adjustments in the period; nurse and therapist are own-target roles). Each widget reads in its own transaction,
// so one refused or failed reader leaves the others standing.
import "server-only";
import { withTenantContext } from "../../../../../db/rls/context";
import { CommandError } from "../../../../../lib/command";
import { getBranch } from "../../../../../modules/org/branches/branches";
import type { ActingContext } from "../../../../../modules/org/identity";
import { appPool } from "../../../../../modules/org/context/store";
import { myTarget, type MyTarget } from "../../../../../modules/commission/targets/targets";
import { calendar, type CalendarRow } from "../../../../../modules/scheduling/appointments/appointments";
import { roomList, type RoomList } from "../../../../../modules/treatment/treatment";

export type Read<T> = { kind: "ok"; data: T } | { kind: "error" } | { kind: "permission" };
export type RuangSayaData =
  | { kind: "no-branch" }
  | {
      kind: "ok"; branchId: string; branchName: string; timeZone: string; today: string;
      rooms: Read<RoomList>; next: Read<CalendarRow | null>; commission: Read<MyTarget>;
    };

async function read<T>(widget: string, fn: () => Promise<T>): Promise<Read<T>> {
  try {
    return { kind: "ok", data: await fn() };
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "permission" };
    console.error("ruang-saya: reader failed", { widget, error: e instanceof Error ? e.name : "unknown" });
    return { kind: "error" };
  }
}

// c: the request's resolved acting context; ../page.tsx dispatches here for nurse and therapist (each reader re-checks the role in SQL).
export async function loadRuangSaya(c: ActingContext): Promise<RuangSayaData> {
  if (!c.activeBranchId) return { kind: "no-branch" };
  const branchId = c.activeBranchId;
  const pool = await appPool();

  // Header: the active branch and its local day, on the database clock (never Date.now in render).
  const base = await withTenantContext(pool, c, async (db) => {
    const b = await getBranch(db, branchId);
    if (!b) return null;
    const d = (await db.query(`select to_char(clock_timestamp() at time zone $1, 'YYYY-MM-DD') as d`, [b.timezone])).rows[0].d as string;
    return { name: b.name, timeZone: b.timezone, today: d };
  });
  if (!base) return { kind: "no-branch" };

  const rooms = await read("jadwal-ruang", () => withTenantContext(pool, c, (db) => roomList(db)));
  // Pasien berikutnya datang: the earliest appointment at the active branch today, booked or confirmed, starting at or
  // after the reader's current time (the same transaction's clock).
  const next = await read("pasien-berikutnya", () =>
    withTenantContext(pool, c, async (db) => {
      const r = (await db.query(
        `select to_char(clock_timestamp() at time zone $1, 'YYYY-MM-DD') as d, extract(epoch from clock_timestamp()) * 1000 as ms`,
        [base.timeZone],
      )).rows[0];
      const nowMs = Number(r.ms);
      const cal = await calendar(db, branchId, r.d as string, r.d as string);
      return cal.appointments
        .filter((a) => (a.state === "booked" || a.state === "confirmed") && a.startsAt.getTime() >= nowMs)
        .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.id.localeCompare(y.id))[0] ?? null;
    }),
  );

  // the month of the branch's local day (target_period takes a month key; SET-25 may make the default a quarter, so the month is explicit)
  const commission = await read("komisi-saya", () => withTenantContext(pool, c, (db) => myTarget(db, base.today.slice(0, 7))));
  return { kind: "ok", branchId, branchName: base.name, timeZone: base.timeZone, today: base.today, rooms, next, commission };
}
