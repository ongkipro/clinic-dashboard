// HYG-DEMO-1 staging database reset: quiesce, verify, drop, recreate, migrate, stamp, and
// restore grants for a dedicated staging database.
// History is never deleted row by row (DEC-034 / MIG-2). Must ONLY target a dedicated,
// disposable staging PostgreSQL instance whose admin endpoint cannot address production.
// Concurrency & TOCTOU safety:
// - All inputs (DEPLOY_ENV, database URL, admin URL, grantConnectRoles syntax & pg_roles
//   existence, migrationsFolder readability & Drizzle journal integrity) are validated BEFORE
//   any destructive DDL.
// - One canonical maintenance lock (`RESET_OP_LOCK_KEY`) is held on `admin` across the ENTIRE
//   reset lifecycle.
// - Before dropping, the inspector locks platform_environment & residency_attestations in
//   ACCESS EXCLUSIVE mode inside READ COMMITTED and passes assertStagingDatabase. Admin then
//   disables new connections (`ALLOW_CONNECTIONS false`), drains every OTHER backend until
//   the inspector is the sole remaining session, re-runs assertStagingDatabase on the sole
//   live inspector, closes the inspector cleanly, verifies 0 backends remain, and drops
//   WITHOUT FORCE. Any pre-drop abort restores the original ALLOW_CONNECTIONS policy.
// - Recreation uses `CREATE DATABASE ... WITH ALLOW_CONNECTIONS false`, revokes PUBLIC
//   CONNECT while closed, grants CONNECT to the migration owner only, re-enables connections,
//   verifies the ACTUAL migration pg.Client against `newDbOid` on `admin` BEFORE any DDL runs,
//   stamps & verifies `platform_environment = 'staging'`, and ONLY THEN restores runtime grants.
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";
import { MIGRATIONS_FOLDER, runMigrations } from "../../src/db/migrate";
import {
  assertStagingDatabase,
  assertStagingEnv,
  DDL_LOCK_KEY,
  DemoGuardError,
  RESET_OP_LOCK_KEY,
  SEED_LOCK_KEY,
  type DemoEnv,
} from "./guard";

const PROTECTED_DATABASES = new Set(["postgres", "template0", "template1"]);
const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;

function safeClient(connectionString: string, applicationName?: string): pg.Client {
  const c = new pg.Client({
    connectionString,
    ...(applicationName ? { application_name: applicationName } : {}),
  });
  c.on("error", () => {});
  return c;
}

export function parseStagingDbName(databaseUrl: string): string {
  let u: URL;
  try {
    u = new URL(databaseUrl);
  } catch {
    throw new DemoGuardError("INVALID_DB_IDENTIFIER", "REFUSED: invalid DATABASE_URL");
  }
  const name = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  if (!IDENT_RE.test(name) || PROTECTED_DATABASES.has(name)) {
    throw new DemoGuardError(
      "INVALID_DB_IDENTIFIER",
      `REFUSED: database name ${JSON.stringify(name)} is protected or invalid for reset`,
    );
  }
  return name;
}

function defaultAdminUrl(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  u.pathname = "/postgres";
  return u.toString();
}

function validateAdminUrl(adminUrl: string, targetDbName: string): void {
  let u: URL;
  try {
    u = new URL(adminUrl);
  } catch {
    throw new DemoGuardError("INVALID_DB_IDENTIFIER", "REFUSED: invalid ADMIN_DATABASE_URL");
  }
  const adminDb = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  if (!adminDb || adminDb === targetDbName) {
    throw new DemoGuardError(
      "INVALID_DB_IDENTIFIER",
      `REFUSED: adminDatabaseUrl must connect to a maintenance database different from ${JSON.stringify(targetDbName)}`,
    );
  }
}

function validateMigrationsFolder(folder: string): void {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new DemoGuardError(
      "INVALID_DB_IDENTIFIER",
      `REFUSED: migrationsFolder does not exist or is not a directory (${folder})`,
    );
  }
  let files: ReturnType<typeof readMigrationFiles>;
  try {
    files = readMigrationFiles({ migrationsFolder: folder });
  } catch (e) {
    throw new DemoGuardError(
      "INVALID_DB_IDENTIFIER",
      `REFUSED: migrationsFolder failed Drizzle manifest validation: ${(e as Error).message}`,
    );
  }
  if (files.length === 0) {
    throw new DemoGuardError("INVALID_DB_IDENTIFIER", `REFUSED: migrationsFolder contains zero migrations (${folder})`);
  }
  const seenMillis = new Set<string>();
  for (const m of files) {
    const k = String(m.folderMillis);
    if (seenMillis.has(k)) {
      throw new DemoGuardError(
        "INVALID_DB_IDENTIFIER",
        `REFUSED: migrationsFolder contains duplicate migration timestamp ${k}`,
      );
    }
    seenMillis.add(k);
  }
}

async function waitForBackendCount(admin: pg.Client, dbName: string, expected: number, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const n = (
      await admin.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = $1`, [dbName])
    ).rows[0].n;
    if (n === expected || Date.now() >= deadline) return n;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function verifyPhysicalClientMatchesTarget(
  admin: pg.Client,
  client: pg.Client,
  expectedDbName: string,
  expectedDbOid: string,
  expectedStartedAt: string,
  label: string,
): Promise<void> {
  const probeAppName = `hyg-reset-v-${randomBytes(8).toString("hex")}`;
  await client.query(`select set_config('application_name', $1, false)`, [probeAppName]);
  const cInfo = (
    await client.query<{ pid: number; db_name: string; db_oid: string; started_at: string }>(
      `select pg_backend_pid() as pid,
              current_database() as db_name,
              (select oid::text from pg_database where datname = current_database()) as db_oid,
              pg_postmaster_start_time()::text as started_at`,
    )
  ).rows[0];

  const aInfo = (
    await admin.query<{ seen: number; started_at: string }>(
      `select pg_postmaster_start_time()::text as started_at,
              (select count(*)::int
                 from pg_stat_activity
                where pid = $1
                  and datname = $2
                  and application_name = $3) as seen`,
      [cInfo.pid, expectedDbName, probeAppName],
    )
  ).rows[0];

  if (
    cInfo.db_name !== expectedDbName ||
    cInfo.db_oid !== expectedDbOid ||
    cInfo.started_at !== expectedStartedAt ||
    aInfo.started_at !== expectedStartedAt ||
    aInfo.seen !== 1
  ) {
    throw new DemoGuardError(
      "DB_TARGET_MISMATCH",
      `REFUSED: ${label} connection did not attach to the verified recreated staging database (${expectedDbName}/${expectedDbOid})`,
    );
  }
}

export type ResetStagingHooks = {
  // Test-only seam: invoked AFTER ALLOW_CONNECTIONS=false, draining other backends, and
  // final verification, right before closing the inspector and dropping without FORCE.
  afterQuiesceBeforeDrop?: (info: { inspectPid: number; dbOid: string; dbName: string }) => Promise<void>;
  // Test-only seam: invoked AFTER migrations and staging verification succeed, right before
  // GRANT CONNECT restores runtime access to `grantConnectRoles`.
  beforeGrantConnect?: () => Promise<void> | void;
};

export type ResetStagingOptions = {
  databaseUrl: string;
  adminDatabaseUrl?: string;
  // Test-only override for routing migration connection separately to verify pre-DDL guard.
  migrateDatabaseUrl?: string;
  env?: DemoEnv;
  grantConnectRoles?: readonly string[];
  migrationsFolder?: string;
  hooks?: ResetStagingHooks;
};

export async function resetStagingDatabase(opts: ResetStagingOptions): Promise<{ dbName: string }> {
  const env = opts.env ?? process.env;

  // 0. Validate ALL inputs and migration metadata BEFORE opening connections or running DDL.
  assertStagingEnv(env);
  const dbName = parseStagingDbName(opts.databaseUrl);
  const adminUrl = opts.adminDatabaseUrl ?? defaultAdminUrl(opts.databaseUrl);
  validateAdminUrl(adminUrl, dbName);

  const grantRoles = [...new Set(opts.grantConnectRoles ?? [])];
  for (const role of grantRoles) {
    if (!IDENT_RE.test(role)) {
      throw new DemoGuardError("INVALID_DB_IDENTIFIER", `REFUSED: invalid role name ${JSON.stringify(role)}`);
    }
  }

  const migrationsFolder = opts.migrationsFolder ?? MIGRATIONS_FOLDER;
  validateMigrationsFolder(migrationsFolder);

  // 1. Connect to maintenance DB and hold RESET_OP_LOCK_KEY through the ENTIRE reset lifecycle.
  const admin = safeClient(adminUrl);
  await admin.connect();
  let holdsResetLock = false;
  try {
    await admin.query(`select pg_advisory_lock($1)`, [RESET_OP_LOCK_KEY]);
    holdsResetLock = true;

    // Verify every requested grantConnectRole ACTUALLY exists in pg_roles BEFORE dropping anything.
    if (grantRoles.length > 0) {
      const existing = await admin.query<{ rolname: string }>(
        `select rolname from pg_roles where rolname = any($1::text[])`,
        [grantRoles],
      );
      const found = new Set(existing.rows.map((r) => r.rolname));
      const missing = grantRoles.filter((r) => !found.has(r));
      if (missing.length > 0) {
        throw new DemoGuardError(
          "INVALID_DB_IDENTIFIER",
          `REFUSED: grantConnectRoles contains unknown database role(s): ${missing.join(", ")}`,
        );
      }
    }

    let newDbOid: string;
    let adminPostmasterStartedAt: string;

    // 2. Acquire cluster DDL lock, inspect target DB under fresh READ COMMITTED ACCESS EXCLUSIVE
    //    locks, disable new connections, drain all other backends, re-verify on the sole live
    //    inspector, close cleanly, drop WITHOUT FORCE, and recreate closed to PUBLIC.
    await admin.query(`select pg_advisory_lock($1)`, [DDL_LOCK_KEY]);
    try {
      const origDbRow = (
        await admin.query<{ allow_conn: boolean; db_oid: string }>(
          `select datallowconn as allow_conn, oid::text as db_oid from pg_database where datname = $1`,
          [dbName],
        )
      ).rows[0];
      if (!origDbRow) {
        throw new DemoGuardError("MISSING_DB_ENV_MARKER", `REFUSED: database ${JSON.stringify(dbName)} does not exist`);
      }

      const probeAppName = `hyg-reset-${randomBytes(8).toString("hex")}`;
      const inspect = safeClient(opts.databaseUrl, probeAppName);
      const inspectState: { lost: Error | null } = { lost: null };
      let expectedInspectClose = false;
      let connectionsClosed = false;
      let dropped = false;
      inspect.on("error", (err) => {
        if (!expectedInspectClose) inspectState.lost ??= err;
      });
      inspect.on("end", () => {
        if (!expectedInspectClose) inspectState.lost ??= new Error("inspection session ended unexpectedly");
      });

      await inspect.connect();
      try {
        // READ COMMITTED: every query after locking marker tables sees the latest committed state.
        await inspect.query(`begin isolation level read committed`);
        await inspect.query(`select pg_advisory_xact_lock($1)`, [SEED_LOCK_KEY]);

        const tables = await inspect.query<{ env_t: string | null; attest_t: string | null }>(
          `select to_regclass('public.platform_environment')::text as env_t,
                  to_regclass('public.residency_attestations')::text as attest_t`,
        );
        if (!tables.rows[0]?.env_t || !tables.rows[0]?.attest_t) {
          throw new DemoGuardError(
            "MISSING_DB_ENV_MARKER",
            "REFUSED: platform_environment or residency_attestations table is missing (unmigrated or incomplete database)",
          );
        }

        await inspect.query(
          `lock table public.platform_environment, public.residency_attestations in access exclusive mode`,
        );

        // Initial post-lock staging verification BEFORE altering database connection policy.
        await assertStagingDatabase(inspect);

        const inspectId = (
          await inspect.query<{ pid: number; db_name: string; db_oid: string; started_at: string }>(
            `select pg_backend_pid() as pid,
                    current_database() as db_name,
                    (select oid::text from pg_database where datname = current_database()) as db_oid,
                    pg_postmaster_start_time()::text as started_at`,
          )
        ).rows[0];

        const initialAdminCheck = (
          await admin.query<{ db_oid: string | null; started_at: string; seen: number; held_locks: number }>(
            `select (select oid::text from pg_database where datname = $1) as db_oid,
                    pg_postmaster_start_time()::text as started_at,
                    (select count(*)::int
                       from pg_stat_activity
                      where pid = $2
                        and datname = $1
                        and application_name = $3
                        and state = 'idle in transaction') as seen,
                    (select count(*)::int
                       from pg_locks
                      where pid = $2
                        and database = $4::oid
                        and locktype = 'relation'
                        and mode = 'AccessExclusiveLock'
                        and granted = true) as held_locks`,
            [dbName, inspectId.pid, probeAppName, inspectId.db_oid],
          )
        ).rows[0];

        if (
          inspectId.db_name !== dbName ||
          initialAdminCheck.db_oid !== origDbRow.db_oid ||
          initialAdminCheck.db_oid !== inspectId.db_oid ||
          initialAdminCheck.started_at !== inspectId.started_at ||
          initialAdminCheck.seen !== 1 ||
          initialAdminCheck.held_locks < 2
        ) {
          throw new DemoGuardError(
            "DB_TARGET_MISMATCH",
            "REFUSED: admin and inspect do not target the exact same verified database",
          );
        }

        // Quiesce: block all new connections, then drain every OTHER backend on the verified DB.
        await admin.query(`alter database "${dbName}" with allow_connections false`);
        connectionsClosed = true;

        await admin.query(
          `select pg_terminate_backend(pid)
             from pg_stat_activity
            where datname = $1
              and pid <> $2`,
          [dbName, inspectId.pid],
        );
        const remainingWithInspect = await waitForBackendCount(admin, dbName, 1);
        if (remainingWithInspect !== 1) {
          throw new DemoGuardError(
            "DB_TARGET_MISMATCH",
            `REFUSED: expected only the locked inspector session on ${dbName}, found ${remainingWithInspect} backend(s)`,
          );
        }

        // Final verification with the inspector as the SOLE remaining session and ALLOW_CONNECTIONS=false.
        await assertStagingDatabase(inspect);

        if (opts.hooks?.afterQuiesceBeforeDrop) {
          await opts.hooks.afterQuiesceBeforeDrop({
            inspectPid: inspectId.pid,
            dbOid: inspectId.db_oid,
            dbName,
          });
        }

        if (inspectState.lost) {
          throw new DemoGuardError(
            "DB_TARGET_MISMATCH",
            `REFUSED: inspection session lost before drop (${inspectState.lost.message})`,
          );
        }
        try {
          await inspect.query(`select 1`);
        } catch (e) {
          throw new DemoGuardError(
            "DB_TARGET_MISMATCH",
            `REFUSED: inspection session failed final liveness check (${(e as Error).message})`,
          );
        }

        const finalAdminCheck = (
          await admin.query<{
            db_oid: string | null;
            allow_conn: boolean | null;
            total_backends: number;
            seen: number;
            held_locks: number;
          }>(
            `select (select oid::text from pg_database where datname = $1) as db_oid,
                    (select datallowconn from pg_database where datname = $1) as allow_conn,
                    (select count(*)::int from pg_stat_activity where datname = $1) as total_backends,
                    (select count(*)::int
                       from pg_stat_activity
                      where pid = $2
                        and datname = $1
                        and application_name = $3
                        and state = 'idle in transaction') as seen,
                    (select count(*)::int
                       from pg_locks
                      where pid = $2
                        and database = $4::oid
                        and locktype = 'relation'
                        and mode = 'AccessExclusiveLock'
                        and granted = true) as held_locks`,
            [dbName, inspectId.pid, probeAppName, inspectId.db_oid],
          )
        ).rows[0];

        if (
          finalAdminCheck.db_oid !== inspectId.db_oid ||
          finalAdminCheck.allow_conn !== false ||
          finalAdminCheck.total_backends !== 1 ||
          finalAdminCheck.seen !== 1 ||
          finalAdminCheck.held_locks < 2
        ) {
          throw new DemoGuardError(
            "DB_TARGET_MISMATCH",
            "REFUSED: final pre-drop quiesce verification failed; aborting without dropping",
          );
        }

        // Cleanly close the sole inspector while ALLOW_CONNECTIONS=false prevents any new session
        // from connecting before DROP DATABASE (no FORCE needed).
        expectedInspectClose = true;
        await inspect.query(`commit`);
        await inspect.end();

        const remainingAfterClose = await waitForBackendCount(admin, dbName, 0);
        if (remainingAfterClose !== 0) {
          throw new DemoGuardError(
            "DB_TARGET_MISMATCH",
            `REFUSED: unexpected backend(s) (${remainingAfterClose}) still attached after closing inspector`,
          );
        }

        await admin.query(`drop database "${dbName}"`);
        dropped = true;
      } finally {
        expectedInspectClose = true;
        await inspect.end().catch(() => {});
        if (connectionsClosed && !dropped) {
          // Restore original connection policy on any pre-drop abort so the DB is not stranded.
          await admin
            .query(`alter database "${dbName}" with allow_connections ${origDbRow.allow_conn ? "true" : "false"}`)
            .catch(() => {});
        }
      }

      // Recreate CLOSED (`ALLOW_CONNECTIONS false`), revoke PUBLIC CONNECT while closed, grant
      // CONNECT to the migration owner only, then re-enable connections so app/worker roles
      // stay blocked until migrations + staging stamp finish.
      await admin.query(`create database "${dbName}" with allow_connections false`);
      await admin.query(`revoke connect on database "${dbName}" from public`);
      await admin.query(`grant connect on database "${dbName}" to current_user`);
      await admin.query(`alter database "${dbName}" with allow_connections true`);

      const createdInfo = (
        await admin.query<{ db_oid: string; started_at: string }>(
          `select oid::text as db_oid, pg_postmaster_start_time()::text as started_at
             from pg_database where datname = $1`,
          [dbName],
        )
      ).rows[0];
      newDbOid = createdInfo.db_oid;
      adminPostmasterStartedAt = createdInfo.started_at;
    } finally {
      await admin.query(`select pg_advisory_unlock($1)`, [DDL_LOCK_KEY]).catch(() => {});
    }

    // 3. Apply migrations using `verifyClient` so the ACTUAL physical migration pg.Client is
    //    proven via admin to be connected to `newDbOid` BEFORE any migration DDL runs.
    await runMigrations(opts.migrateDatabaseUrl ?? opts.databaseUrl, {
      folder: migrationsFolder,
      verifyClient: async (migClient) => {
        await verifyPhysicalClientMatchesTarget(
          admin,
          migClient,
          dbName,
          newDbOid,
          adminPostmasterStartedAt,
          "migration",
        );
      },
    });

    // 4. Reconnect to the verified recreated DB, stamp platform_environment = 'staging', verify
    //    the final staging guard passes, and ONLY THEN restore CONNECT grants (all under RESET_OP_LOCK_KEY).
    const fresh = safeClient(opts.databaseUrl);
    await fresh.connect();
    try {
      await verifyPhysicalClientMatchesTarget(
        admin,
        fresh,
        dbName,
        newDbOid,
        adminPostmasterStartedAt,
        "post-migration stamp",
      );

      await fresh.query(
        `insert into public.platform_environment (id, deploy_env, set_at)
         values (1, 'staging', clock_timestamp())
         on conflict (id) do nothing`,
      );
      await assertStagingDatabase(fresh);

      if (opts.hooks?.beforeGrantConnect) {
        await opts.hooks.beforeGrantConnect();
      }
      for (const role of grantRoles) {
        await fresh.query(`grant connect on database "${dbName}" to "${role}"`);
      }
    } finally {
      await fresh.end().catch(() => {});
    }
  } finally {
    if (holdsResetLock) {
      await admin.query(`select pg_advisory_unlock($1)`, [RESET_OP_LOCK_KEY]).catch(() => {});
    }
    await admin.end().catch(() => {});
  }

  return { dbName };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const grantRoles = (process.env.DEMO_GRANT_CONNECT_ROLES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const res = await resetStagingDatabase({
    databaseUrl,
    adminDatabaseUrl: process.env.ADMIN_DATABASE_URL,
    grantConnectRoles: grantRoles,
  });
  console.log(JSON.stringify({ event: "staging_reset_done", dbName: res.dbName }));
}
