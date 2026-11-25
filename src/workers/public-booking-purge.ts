// Scheduled retention purge worker for abandoned/expired public_booking_intents (PR-67, DATA-56; T-126).
// DEL-2 auto-discovered `job` surface (`src/workers/**`).
// Runs on an unbound clinic_app pool, completely independent of public traffic, tenant publication, or suspension state.
import type pg from "pg";

export type PublicBookingPurgeResult = {
  purgedCount: number;
};

export async function runPublicBookingPurge(
  pool: pg.Pool,
  opts: { graceMinutes?: number } = {},
): Promise<PublicBookingPurgeResult> {
  const graceMinutes = Math.max(0, Math.floor(opts.graceMinutes ?? 15));
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ count: number }>(
      `SELECT public.public_booking_purge_expired($1::integer) AS count`,
      [graceMinutes],
    );
    return { purgedCount: Number(rows[0]?.count ?? 0) };
  } finally {
    client.release();
  }
}
