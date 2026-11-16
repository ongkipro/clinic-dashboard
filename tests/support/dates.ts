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

// HYG-021: a reschedule target inside the fixture branch's hours (deposits.test.ts: open and rostered 00:00–23:45, a 30-minute service).
// `t` is moved back by whole quarter hours so the slot ends by `closes` (HH:MM, Asia/Jakarta) on the same local date; unchanged when it
// already fits. quarter(72 h) lands on 23:30 or 23:45 for now in 23:15:01–23:45:00 WIB and quarter(80 h) for now in 15:15:01–15:45:00 WIB;
// the writer refuses such a slot (ERR_VERSION_CONFLICT: slot_taken).
export function withinHours(t: Date, closes = "23:45", minutes = 30): Date {
  const close = new Date(`${wibDay(0, t.getTime())}T${closes}:00+07:00`).getTime();
  const over = t.getTime() + minutes * 60_000 - close;
  return over > 0 ? new Date(t.getTime() - Math.ceil(over / 900_000) * 900_000) : t;
}
