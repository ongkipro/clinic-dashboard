// Migration runner: `pnpm db:migrate`. Node runs this file with built-in type stripping,
// so it imports nothing local.
//
// - Direct PostgreSQL connection only: MIG-1 timeouts are sent as startup options,
//   which connection poolers may reject.
// - Drizzle applies every pending migration in one transaction; a session advisory lock
//   on the same single connection serialises concurrent runners.
// - DATABASE_URL is configuration (ARCH-9). Only an explicit non-production run may fall
//   back to the local Compose database.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
const LOCK_KEY = 7_202_611_020; // arbitrary, stable advisory-lock key for migrations
export const LOCAL_DATABASE_URL =
  "postgres://clinic:clinic_local_only@127.0.0.1:5432/clinic_dashboard";

export async function runMigrations(url: string): Promise<void> {
  const client = new pg.Client({
    connectionString: url,
    options: "-c lock_timeout=5s -c statement_timeout=30s",
  });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end(); // ends the session, releasing the advisory lock
  }
}

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.NODE_ENV !== "production" && env.DB_LOCAL === "1") return LOCAL_DATABASE_URL;
  throw new Error("DATABASE_URL is required (set DB_LOCAL=1 to use the local Compose database)");
}

if (import.meta.main) {
  await runMigrations(resolveDatabaseUrl(process.env));
  console.log("migrations applied");
}
