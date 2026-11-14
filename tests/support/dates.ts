// HYG-018: test dates in the fixtures' branch timezone. Every fixture tenant's first branch is Asia/Jakarta, and the writers compare a
// date with the branch-local day (`(clock_timestamp() AT TIME ZONE b.timezone)::date`), so a UTC calendar date is yesterday between 00:00
// and 07:00 WIB (T-085 close run 3: consultation.test.ts `day(0)` refused as a past control date).
const WIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });

// The Asia/Jakarta calendar date `d` days from now (YYYY-MM-DD).
export const wibDay = (d: number, now = Date.now()) => WIB.format(new Date(now + d * 86_400_000));

// The `i`-th 30-minute arrival slot of today in Asia/Jakarta (T-085 close run 2: deposits.test.ts clamped every slot to the last half hour
// before midnight, so two slots overlapped for one doctor near midnight). Slots start at the next quarter hour and step 30 minutes; when
// fewer than `i + 1` slots fit before midnight, the slots are counted back from the last one before midnight, so they stay distinct
// (`count` is how many slots the caller may ask for, at most 4). A slot may then start before now: callers that need a future start must
// not run in the last two hours of the day, which check-in's own window (two hours ahead, same day) already implies.
export function arrivalSlot(i: number, count = 3, now = Date.now()): Date {
  if (!Number.isInteger(i) || i < 0 || i >= count || count > 4) throw new Error(`arrivalSlot(${i}, ${count})`);
  const midnight = new Date(`${wibDay(1, now)}T00:00:00+07:00`).getTime();
  const first = Math.ceil(now / 900_000) * 900_000;
  const last = midnight - 30 * 60_000; // the last slot that ends by midnight
  const start = Math.min(first, last - (count - 1) * 30 * 60_000);
  return new Date(start + i * 30 * 60_000);
}
