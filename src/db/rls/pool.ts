// Application pool startup (TEN-2): the pool is returned only after the connection role
// passes assertAppRole; otherwise it is closed and startup fails.
import pg from "pg";
import { assertAppRole } from "./context";

export async function openAppPool(config: pg.PoolConfig): Promise<pg.Pool> {
  const pool = new pg.Pool(config);
  // pg-pool discards an idle client whose backend died and re-emits the error on the
  // pool; without a listener that crashes the process.
  pool.on("error", (error) => {
    console.error("database pool: idle client error", { code: (error as { code?: string }).code });
  });
  try {
    const client = await pool.connect();
    let broken: Error | undefined;
    const onError = (error: Error) => {
      broken ??= error;
    };
    client.on("error", onError);
    try {
      await assertAppRole(client);
    } finally {
      client.removeListener("error", onError);
      client.release(broken);
    }
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
