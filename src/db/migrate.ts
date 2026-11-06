// Migration runner: `pnpm db:migrate`. Node runs this file with built-in type stripping,
// so it imports nothing local.
//
// - Direct PostgreSQL connection only: MIG-1 timeouts are sent as startup options,
//   which connection poolers may reject.
// - Drizzle applies every pending migration in one transaction; a session advisory lock
//   on the same single connection serialises concurrent runners.
// - Applied migrations are immutable: Drizzle only compares timestamps, so an edited
//   migration would silently leave existing databases on the old SQL. The runner
//   refuses to continue when an applied migration's hash differs from the file.
// - DATABASE_URL is configuration (ARCH-9). Only an explicit non-production run may fall
//   back to the local Compose database.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
export const MIGRATION_LOCK_KEY = 7_202_611_020; // arbitrary, stable advisory-lock key for migrations
export const LOCAL_DATABASE_URL =
  "postgres://clinic:clinic_local_only@127.0.0.1:5432/clinic_dashboard";

export class MigrationDriftError extends Error {}

async function assertNoDrift(client: pg.Client, folder: string): Promise<void> {
  const exists = await client.query(`select to_regclass('drizzle.__drizzle_migrations') as t`);
  if (!exists.rows[0].t) return;
  const applied = await client.query<{ hash: string; created_at: string }>(
    `select hash, created_at from drizzle.__drizzle_migrations order by created_at`,
  );
  const files = new Map(
    readMigrationFiles({ migrationsFolder: folder }).map((m) => [String(m.folderMillis), m.hash]),
  );
  // Drizzle runs only files newer than the newest applied one, so an unapplied file with
  // an older timestamp (e.g. merged from another branch) would be skipped silently.
  const newest = applied.rows.reduce((m, r) => Math.max(m, Number(r.created_at)), 0);
  const appliedAt = new Set(applied.rows.map((r) => String(r.created_at)));
  for (const at of files.keys()) {
    if (!appliedAt.has(at) && Number(at) < newest) {
      throw new MigrationDriftError(
        `migration ${at} is older than the newest applied migration and would be skipped; regenerate it`,
      );
    }
  }
  for (const row of applied.rows) {
    const hash = files.get(String(row.created_at));
    if (hash === undefined) {
      throw new MigrationDriftError(`applied migration ${row.created_at} has no file in drizzle/`);
    }
    if (hash !== row.hash) {
      throw new MigrationDriftError(
        `applied migration ${row.created_at} was edited after it ran; add a new migration instead`,
      );
    }
  }
}

// `folder`: the migrations to apply (default drizzle/). Tests pass a truncated copy to migrate a
// database to an earlier point (HYG-008a drift check).
export async function runMigrations(url: string, opts: { folder?: string } = {}): Promise<void> {
  const folder = opts.folder ?? MIGRATIONS_FOLDER;
  const client = new pg.Client({
    connectionString: url,
    options: "-c lock_timeout=5s -c statement_timeout=30s",
  });
  await client.connect();
  try {
    // lock_timeout also applies to advisory locks: wait for a concurrent runner (a long
    // migration on a slow server) without that limit, then restore the DDL limits.
    await client.query("set lock_timeout = 0");
    await client.query("set statement_timeout = '15min'");
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query("reset lock_timeout");
    await client.query("reset statement_timeout");
    await assertNoDrift(client, folder);
    await migrate(drizzle(client), { migrationsFolder: folder });
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
