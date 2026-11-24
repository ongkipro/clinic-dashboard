// T-119 option A: the M8 fixture's WIB anchor and its fail-closed rollover guard, deterministically (fixed instants; no wall clock). The SQL
// is the anchor's own expression on the real PostgreSQL, read-only (a SELECT of literals, no database or role created), under several
// session time zones: the WIB day of an instant never depends on the session or host time zone, and it turns at 17:00 UTC.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_DATABASE_URL } from "../../../src/db/migrate";
import { wibToday } from "../../../src/app/(app)/ringkasan/owner/period";
import { testClient } from "../../../tests/rls/harness";
import { dbWibDay, wibAnchor } from "./wib-anchor";

let c: pg.Client;
beforeAll(async () => {
  c = testClient({ connectionString: process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL });
  await c.connect();
});
afterAll(async () => {
  await c?.end();
});

// [instant, its WIB day]: one second either side of WIB midnight, and of the WIB month and year turn
const ROLL: [string, string][] = [
  ["2026-11-22T16:59:59Z", "2026-11-22"], ["2026-11-22T17:00:00Z", "2026-11-23"],
  ["2026-11-30T16:59:59Z", "2026-11-30"], ["2026-11-30T17:00:00Z", "2026-12-01"],
  ["2026-12-31T16:59:59Z", "2026-12-31"], ["2026-12-31T17:00:00Z", "2027-01-01"],
];

describe("M8 WIB anchor (T-119)", () => {
  it("the database WIB day of an instant is the same under every session time zone, and turns at 17:00 UTC", async () => {
    for (const tz of ["UTC", "Asia/Jakarta", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      await c.query(`select set_config('TimeZone', $1, false)`, [tz]);
      for (const [at, day] of ROLL) expect(await dbWibDay(c, new Date(at)), `${tz} ${at}`).toBe(day);
    }
  });

  it("the anchor's month and loader instant stay on the anchor day wherever the host clock is", () => {
    for (const [, day] of ROLL) {
      const a = wibAnchor(day);
      expect(a.monthStart).toBe(`${day.slice(0, 8)}01`);
      expect(wibToday(a.noon)).toBe(day);
    }
    expect(() => wibAnchor("2026-02-30")).toThrow(/not a calendar day/);
  });

  it("fails closed when the database WIB day moves past the anchor (midnight, month turn), and passes on the same day", async () => {
    for (let i = 0; i < ROLL.length; i += 2) {
      const a = wibAnchor(await dbWibDay(c, new Date(ROLL[i][0])));
      expect(() => a.assertSameDay(a.day)).not.toThrow();
      expect(() => a.assertSameDay(ROLL[i + 1][1])).toThrow(/WIB date changed during the M8 fixture/);
    }
  });
});
