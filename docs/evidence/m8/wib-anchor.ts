// T-119 option A (owner 2026-11-23): the M8 fixture month is anchored on ONE PostgreSQL reading of the WIB calendar day, the same basis the
// writers stamp (clock_timestamp() → tax_local_date / safety_today at the branch time zone, Asia/Jakarta for both fixture branches), not on
// the test host's clock. The fixture still runs on the real database clock: when the database's WIB day differs from the anchor, the run
// fails closed instead of reconciling facts split across two days or months. This does not make the fixture runnable at any hour; the
// gate's run-hour window stays.
import type pg from "pg";

// `$1` null = the database clock (the fixture); a fixed instant = the deterministic check of the same expression.
export const WIB_DAY_SQL = `select (coalesce($1::timestamptz, clock_timestamp()) at time zone 'Asia/Jakarta')::date::text as d`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type WibAnchor = { day: string; monthStart: string; noon: Date; assertSameDay(observed: string): void };

export function wibAnchor(day: string): WibAnchor {
  if (!DAY.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error(`WIB anchor: not a calendar day: ${day}`);
  return {
    day,
    monthStart: `${day.slice(0, 8)}01`,
    noon: new Date(`${day}T12:00:00+07:00`), // the loaders' `now`: the anchor day in WIB, wherever the host clock is
    assertSameDay(observed) {
      if (observed !== day) throw new Error(`WIB date changed during the M8 fixture (anchor ${day}, database now ${observed}): facts may span two days; rerun inside the window`);
    },
  };
}

export async function dbWibDay(db: pg.Pool | pg.ClientBase, at: Date | null = null): Promise<string> {
  return (await db.query(WIB_DAY_SQL, [at])).rows[0].d as string;
}
