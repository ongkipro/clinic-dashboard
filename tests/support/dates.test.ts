// HYG-018: the fixture date helpers at the night times that failed T-085's close runs (22:30 and 00:05 WIB) and at the window edges.
import { describe, expect, it } from "vitest";
import { arrivalSlot, wibDay, withinHours } from "./dates";

const at = (wib: string) => new Date(`${wib}+07:00`).getTime();

describe("wibDay: the Asia/Jakarta calendar date", () => {
  it("is today in Jakarta at 00:05 and 06:55 WIB (the UTC date is still yesterday), and at 23:50 WIB", () => {
    expect(wibDay(0, at("2026-11-15T00:05:00"))).toBe("2026-11-15");
    expect(new Date(at("2026-11-15T00:05:00")).toISOString().slice(0, 10)).toBe("2026-11-14"); // the old UTC helper
    expect(wibDay(0, at("2026-11-15T06:55:00"))).toBe("2026-11-15");
    expect(wibDay(0, at("2026-11-14T23:50:00"))).toBe("2026-11-14");
    expect([wibDay(-1, at("2026-11-15T00:05:00")), wibDay(2, at("2026-11-15T00:05:00"))]).toEqual(["2026-11-14", "2026-11-17"]);
  });
});

describe("arrivalSlot: distinct 30-minute slots of today", () => {
  const slots = (wib: string) => [0, 1, 2].map((i) => arrivalSlot(i, 3, at(wib)));
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(d);
  it("daytime: from the next quarter hour, 30 minutes apart", () => {
    expect(slots("2026-11-14T10:07:00").map(fmt)).toEqual(["10:15", "10:45", "11:15"]);
  });
  it("22:30 and 23:50 WIB: still three distinct slots, each ending by midnight (the old clamp made two of them the same)", () => {
    for (const t of ["2026-11-14T22:30:37", "2026-11-14T23:50:00"]) {
      const s = slots(t);
      expect(new Set(s.map((d) => d.getTime())).size).toBe(3);
      for (let k = 1; k < 3; k++) expect(s[k].getTime() - s[k - 1].getTime()).toBe(30 * 60_000);
      expect(s[2].getTime() + 30 * 60_000).toBeLessThanOrEqual(at("2026-11-15T00:00:00"));
      expect(wibDay(0, s[0].getTime())).toBe("2026-11-14");
    }
    expect(slots("2026-11-14T22:30:37").map(fmt)).toEqual(["22:30", "23:00", "23:30"]);
  });
  it("refuses an index outside the declared count", () => {
    expect(() => arrivalSlot(3, 3)).toThrow();
    expect(() => arrivalSlot(0, 5)).toThrow();
  });
});

describe("withinHours: the deposits reschedule target ends by the fixture's 23:45 closing (HYG-021)", () => {
  const H = 3_600_000;
  const quarter = (ms: number, now: number) => new Date(Math.ceil((now + ms) / 900_000) * 900_000);
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(d);
  it("inside the windows: 72 h at 23:15:01, 23:30 and 23:45:00 WIB and 80 h at 15:15:01 and 15:40 WIB move to 23:15 the same day", () => {
    for (const [ms, t] of [[72 * H, "2026-11-16T23:15:01"], [72 * H, "2026-11-16T23:30:00"], [72 * H, "2026-11-16T23:45:00"],
                           [80 * H, "2026-11-16T15:15:01"], [80 * H, "2026-11-16T15:40:00"]] as const) {
      const q = quarter(ms, at(t));
      const w = withinHours(q);
      expect(fmt(w), t).toBe("23:15");
      expect(wibDay(0, w.getTime()), t).toBe(wibDay(0, q.getTime())); // same local day
    }
  });
  it("outside the windows (the edges 23:15:00 and 23:45:01, 15:45:01, daytime): unchanged", () => {
    for (const [ms, t] of [[72 * H, "2026-11-16T23:15:00"], [72 * H, "2026-11-16T23:45:01"], [80 * H, "2026-11-16T15:45:01"], [72 * H, "2026-11-16T10:07:00"]] as const) {
      const q = quarter(ms, at(t));
      expect(withinHours(q), t).toEqual(q);
    }
  });
  it("every minute of a day: quarter-aligned, never later than the input, ends by 23:45 on the input's local day", () => {
    for (let m = 0; m < 24 * 60; m++) {
      const now = at("2026-11-16T00:00:00") + m * 60_000;
      for (const ms of [72 * H, 80 * H]) {
        const q = quarter(ms, now);
        const w = withinHours(q);
        expect(w.getTime() % 900_000).toBe(0);
        expect(w.getTime()).toBeLessThanOrEqual(q.getTime());
        expect(wibDay(0, w.getTime())).toBe(wibDay(0, q.getTime()));
        expect(w.getTime() + 30 * 60_000).toBeLessThanOrEqual(new Date(`${wibDay(0, q.getTime())}T23:45:00+07:00`).getTime());
      }
    }
  });
});
