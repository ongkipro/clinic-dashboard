// Database readiness probe helper (OBS-3, TEN-2, OBSERVABILITY.md).
// Checks connectivity through the least-privilege clinic_app pool (which enforces assertAppRole
// at pool startup) with a strict bounded timeout and never exposes database errors or secrets.
import type pg from "pg";

export type DbHealthResult = { ok: true } | { ok: false };

const DEFAULT_TIMEOUT_MS = 2_500;

export async function probeDatabase(
  getPool: () => Promise<pg.Pool>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DbHealthResult> {
  const limit = Math.max(100, Math.min(10_000, Math.floor(timeoutMs)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let client: pg.PoolClient | undefined;
  let broken: Error | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("health_db_timeout"));
    }, limit);
  });

  try {
    const poolPromise = getPool();
    poolPromise.catch(() => {});
    const pool = await Promise.race([poolPromise, timeoutPromise]);

    const connectPromise = pool.connect().then((c) => {
      if (timedOut) {
        c.release(new Error("health_db_timeout"));
        throw new Error("health_db_timeout");
      }
      client = c;
      return c;
    });
    connectPromise.catch(() => {});
    const c = await Promise.race([connectPromise, timeoutPromise]);

    const onError = (err: Error) => {
      broken ??= err;
    };
    c.on("error", onError);
    try {
      const queryPromise = (async () => {
        await c.query("BEGIN READ ONLY");
        await c.query(`SET LOCAL statement_timeout = ${limit}`);
        const res = await c.query<{ ok: number }>("SELECT 1 AS ok");
        await c.query("COMMIT");
        if (res.rows[0]?.ok !== 1) throw new Error("health_db_unexpected");
      })();
      queryPromise.catch(() => {});
      await Promise.race([queryPromise, timeoutPromise]);
      return { ok: true };
    } catch (err) {
      // Discard the failed/suspect connection immediately via client.release(broken) in finally
      // instead of awaiting an unbounded ROLLBACK over a potentially wedged socket.
      broken = err instanceof Error ? err : new Error("health_db_error");
      return { ok: false };
    } finally {
      c.removeListener("error", onError);
    }
  } catch {
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
    if (client) {
      client.release(timedOut ? new Error("health_db_timeout") : broken);
    }
  }
}
