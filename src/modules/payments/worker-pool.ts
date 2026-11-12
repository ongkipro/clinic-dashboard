// The unbound pool the payment webhook uses (no tenant context is ever set on it; the ingest definers refuse a bound
// connection). The same clinic_app login as the app pool, opened separately so a webhook never shares a client with a
// request's tenant transaction.
import type pg from "pg";
import { openAppPool } from "../../db/rls/pool";

let pool: Promise<pg.Pool> | undefined;
export function workerPool(): Promise<pg.Pool> {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is required");
  pool ??= openAppPool({ connectionString: url, max: 3 }).catch((e) => {
    pool = undefined;
    throw e;
  });
  return pool;
}
