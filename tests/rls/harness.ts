// Throwaway database + roles for RLS tests. Roles are cluster-wide, so every role name
// carries a random suffix and is dropped in teardown. The migrations create the shared
// `clinic_app` group role if missing and never alter it, so running this against the
// local cluster does not change roles used by other databases.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { LOCAL_DATABASE_URL, runMigrations } from "../../src/db/migrate";

const adminUrl = process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL;
const host = new URL(adminUrl).hostname;
if (!process.env.CI && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  throw new Error(`refusing to create test databases on non-loopback host ${host}`);
}

// HYG-015: every test pool and client is built here, never with `new pg.Pool`/`new pg.Client`
// (tests/rls/pg-listener.test.ts enforces it). A backend terminated while a connection sits idle,
// or while a test holds a checked-out client (DROP DATABASE … WITH (FORCE) at close, a deliberate
// pg_terminate_backend), is emitted as an `error` event; with no listener Node throws it and vitest
// fails the run as an unhandled error although every test passed (CI 42615137831, 42753612376).
// The listeners only stop that process-level throw: pg rejects every active and queued query of
// the connection before it emits, and a later query on a dead client rejects, so no test can pass
// on a swallowed error. A pool also listens on each client it creates ("connect", once per
// client): pg-pool removes its own idle listener while a client is checked out.
const ignore = () => {};
export function testPool(config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(config);
  pool.on("error", ignore);
  pool.on("connect", (client) => client.on("error", ignore));
  return pool;
}
export function testClient(config: pg.ClientConfig): pg.Client {
  const client = new pg.Client(config);
  client.on("error", ignore);
  return client;
}

export type Harness = {
  dbName: string;
  admin: pg.Client; // superuser on the throwaway database (migration owner)
  connectAs(role: string): Promise<pg.Client>;
  urlAs(role: string): string;
  poolAs(role: string): pg.Pool;
  ownerUrl(): string; // superuser (migration owner) on the throwaway database
  createLoginRole(attrs: string, memberOf?: string[]): Promise<string>;
  createGroupRole(attrs: string): Promise<string>;
  close(): Promise<void>;
};

// A close or a DDL-lock wait slower than this is reported on stderr (HYG-004, HYG-006).
const SLOW_MS = 5_000;

// HYG-006: database creates and drops by test files. In PostgreSQL every CREATE DATABASE
// writes and fsyncs a relation map under one cluster-wide lock that every new backend also
// reads at start, and every DROP DATABASE forces an immediate checkpoint; parallel test files
// doing both at once stalled new connections for seconds on a slow disk. So a create takes
// this advisory key exclusively and a drop takes it shared: drops still run together (one
// forced checkpoint serves several) but never beside a create, and creates never overlap.
// - Advisory locks are per database: every participant takes the key on a connection to the
//   same admin database (TEST_DATABASE_URL, or the local default). CI uses one URL per job.
// - The key is above 2^31, so it cannot equal a hashtext() per-database key (int32), and it is
//   not MIGRATION_LOCK_KEY (7_202_611_020).
// - Lock order: a harness takes its own per-database lifetime lock first and this key only
//   around one statement; while holding it, it never blocks on another harness advisory lock.
// - The helper is not reentrant and never upgrades shared to exclusive (PostgreSQL would allow
//   a nested acquisition; the contract forbids it). PostgreSQL's lock queue keeps newly arriving
//   shared requests from passing a queued exclusive one, so drops cannot starve a create.
export const DDL_LOCK_KEY = BigInt("7202611030");

// T-060: harness migrations run one at a time cluster-wide. drizzle applies every migration in one
// transaction, which holds a lock per object it creates (2717 after 0077, measured with pg_locks; 2545
// after 0076). The shared lock table holds max_locks_per_transaction × max_connections (64 × 100 by
// default, also in CI), so three overlapping harness migrations overflowed it ("53200 out of shared
// memory"). Taken on the admin connection after the database's lifetime lock and released right after
// the migration; never while holding DDL_LOCK_KEY (no new lock-order edge). Distinct from DDL_LOCK_KEY
// and MIGRATION_LOCK_KEY (that one is per database, so it never serialized different test databases).
export const MIGRATE_LOCK_KEY = BigInt("7202611040");

type Query = (sql: string, values?: unknown[]) => Promise<unknown>;

// Test-only knobs (tests/rls/harness-lock.test.ts): a private key so no other file queues on
// it, a hook after acquisition, a replaceable SQL runner and a shorter slow-wait threshold.
export type DdlLockOptions = {
  ddlLockKey?: bigint;
  afterAcquire?: () => Promise<void>;
  run?: Query;
  slowMs?: number;
  // The time spent waiting for the lock, reported whether or not the acquisition succeeded.
  onLockWait?: (ms: number) => void;
  observerName?: string;
  // Builds the observer connection (test-only: a test injects one that never connects).
  observer?: (name: string) => pg.Client;
};

// The slow-wait report runs beside the waiting acquisition, on its own connection: a query
// queued on the waiting client could not run until the lock is granted. It never delays the
// operation: when the acquisition settles, a report still in flight is cut off by ending its
// connection (its line is then not printed), and the observer connects and queries with
// short timeouts. `observerName` and `observer` are test-only: a test finds this call's
// observer by name, or injects one that never connects to prove it cannot block.
const defaultObserver = (name: string) =>
  testClient({ connectionString: adminUrl, application_name: name, connectionTimeoutMillis: 2_000, statement_timeout: 2_000 });
function startHolderReport(key: bigint, mode: string, slowMs: number, observerName: string, make: (name: string) => pg.Client) {
  const observer = make(observerName);
  observer.on("error", () => {});
  let stopped = false;
  const done = (async () => {
    try {
      await observer.connect();
      const { rows } = await observer.query<{ pid: number; mode: string; state: string; q: string }>(
        `select l.pid, l.mode, a.state, left(a.query, 60) as q
           from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where l.locktype = 'advisory' and l.granted and l.objsubid = 1
            and ((l.classid::bigint << 32) | l.objid::bigint) = $1`,
        [key.toString()],
      );
      if (!stopped) {
        console.error(
          `[harness] ${mode} DDL lock wait over ${slowMs} ms; holders: ${rows.map((r) => `pid ${r.pid} ${r.mode} ${r.state} "${r.q}"`).join("; ") || "none visible"}`,
        );
      }
    } catch (e) {
      if (!stopped) console.error(`[harness] ${mode} DDL lock wait over ${slowMs} ms; holder report failed: ${String(e).slice(0, 80)}`);
    } finally {
      await observer.end().catch(() => {});
    }
  })();
  // Fire and forget: ends the observer's connection; never awaited by the operation.
  const stop = () => {
    stopped = true;
    void observer.end().catch(() => {});
  };
  return { stop, done };
}

// Runs `fn` holding the DDL key in `mode` on `server`'s session. Error precedence:
// - acquisition fails: neither fn nor the unlock runs; the acquisition error is thrown and
//   the caller still owns (and ends) its connection;
// - fn throws, unlock succeeds: fn's error;
// - fn throws, unlock fails: the connection is ended (that releases the session lock) and
//   fn's error is thrown, with the unlock error as its cause when it has none;
// - fn succeeds, unlock fails: the connection is ended and the unlock error is thrown, so a
//   statement that ran is never hidden behind a success on a connection in an unknown state.
// Ending the connection is best effort and never replaces the error being thrown.
export async function withDatabaseDdlLock<T>(
  server: pg.Client,
  mode: "exclusive" | "shared",
  fn: () => Promise<T>,
  opts: DdlLockOptions = {},
): Promise<T> {
  const key = opts.ddlLockKey ?? DDL_LOCK_KEY;
  const run: Query = opts.run ?? ((sql, values) => server.query(sql, values));
  const slowMs = opts.slowMs ?? SLOW_MS;
  const suffix = mode === "shared" ? "_shared" : "";
  let report: ReturnType<typeof startHolderReport> | undefined;
  const timer = setTimeout(() => {
    report = startHolderReport(key, mode, slowMs, opts.observerName ?? "harness:lock-observer", opts.observer ?? defaultObserver);
  }, slowMs);
  const t0 = performance.now();
  try {
    await run(`select pg_advisory_lock${suffix}($1)`, [key.toString()]);
  } finally {
    clearTimeout(timer);
    report?.stop();
    // Reporting the wait is diagnostics: it never replaces an acquisition error and never
    // leaves an acquired lock without its unlock handling.
    try {
      opts.onLockWait?.(Math.round(performance.now() - t0));
    } catch {
      // ignored
    }
  }
  let result: T;
  try {
    if (opts.afterAcquire) await opts.afterAcquire();
    result = await fn();
  } catch (error) {
    try {
      await run(`select pg_advisory_unlock${suffix}($1)`, [key.toString()]);
    } catch (unlockError) {
      await server.end().catch(() => {});
      // Best effort: a frozen or exotic error must still be rethrown as itself (GPT review
      // 2026-11-06), so attaching the cause can never replace it.
      try {
        if (error instanceof Error && error.cause === undefined) error.cause = unlockError;
      } catch {
        // the original error stays as thrown
      }
    }
    throw error;
  }
  try {
    await run(`select pg_advisory_unlock${suffix}($1)`, [key.toString()]);
  } catch (unlockError) {
    await server.end().catch(() => {});
    throw unlockError;
  }
  return result;
}

// The only two places a test creates or drops a database (a structural test enforces it).
// ddl-wrapper:begin
export function createTestDatabase(server: pg.Client, name: string, opts: DdlLockOptions = {}): Promise<unknown> {
  return withDatabaseDdlLock(server, "exclusive", () => server.query(`CREATE DATABASE ${name}`), opts);
}
export function dropTestDatabase(server: pg.Client, name: string, opts: DdlLockOptions = {}): Promise<unknown> {
  return withDatabaseDdlLock(server, "shared", () => server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`), opts);
}
// ddl-wrapper:end

const lockKey = (name: string) => `hashtext('${name}')`;
export const STALE_PATTERN = "^rls_[0-9a-f]{12}$";

// Leftovers of crashed runs are dropped only when their lifetime lock is free, so a concurrent
// run (parallel files, CI shards) is never swept. `pattern` is a test-only knob.
export async function sweepStaleDatabases(
  server: pg.Client,
  opts: DdlLockOptions & { pattern?: string } = {},
): Promise<void> {
  const pattern = opts.pattern ?? STALE_PATTERN;
  const stale = await server.query<{ d: string }>(`select datname as d from pg_database where datname ~ $1`, [pattern]);
  for (const { d } of stale.rows) {
    const free = await server.query<{ ok: boolean }>(`select pg_try_advisory_lock(${lockKey(d)}) as ok`);
    if (!free.rows[0].ok) continue;
    let failed = false;
    try {
      await dropTestDatabase(server, d, opts);
      const leftover = await server.query<{ r: string }>(`select rolname as r from pg_roles where rolname ~ $1`, [`^${d}_[0-9]+$`]);
      for (const { r } of leftover.rows) await server.query(`DROP ROLE IF EXISTS ${r}`);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // After a failure the connection may be ended (an unlock failure ends it, which also
      // releases this lock); an unlock error then must not replace the real one.
      const unlock = server.query(`select pg_advisory_unlock(${lockKey(d)})`);
      await (failed ? unlock.catch(() => {}) : unlock);
    }
  }
  const orphans = await server.query<{ r: string; d: string }>(
    `select rolname as r, substring(rolname from '^(rls_[0-9a-f]{12})_') as d from pg_roles
     where rolname ~ '^rls_[0-9a-f]{12}_[0-9]+$'
       and substring(rolname from '^(rls_[0-9a-f]{12})_') not in (select datname from pg_database)`,
  );
  for (const { r, d } of orphans.rows) {
    const free = await server.query<{ ok: boolean }>(`select pg_try_advisory_lock(${lockKey(d)}) as ok`);
    if (!free.rows[0].ok) continue;
    try {
      await server.query(`DROP ROLE IF EXISTS ${r}`);
    } finally {
      await server.query(`select pg_advisory_unlock(${lockKey(d)})`);
    }
  }
}

// Test-only knobs for createHarness (tests/rls/harness-lock.test.ts).
export type HarnessOptions = Omit<DdlLockOptions, "onLockWait"> & {
  migrate?: (url: string) => Promise<void>;
  stalePattern?: string;
  migrateLockKey?: bigint;
};

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const dbName = `rls_${suffix}`;
  const server = testClient({ connectionString: adminUrl, application_name: `harness:${dbName}` });
  const ddl: DdlLockOptions = {
    ddlLockKey: opts.ddlLockKey, afterAcquire: opts.afterAcquire, run: opts.run, slowMs: opts.slowMs,
    observerName: opts.observerName, observer: opts.observer,
  };
  const t0 = performance.now();
  let createLockWait = 0;
  await server.connect();
  const urlFor = (user?: string, password?: string) => {
    const u = new URL(adminUrl);
    u.pathname = `/${dbName}`;
    if (user) {
      u.username = user;
      u.password = password ?? "";
    }
    return u.toString();
  };
  const admin = testClient({ connectionString: urlFor() });
  let created = false;
  try {
    // Each run holds a session advisory lock keyed on its database name for its whole lifetime.
    await server.query(`select pg_advisory_lock(${lockKey(dbName)})`);
    await sweepStaleDatabases(server, { ...ddl, pattern: opts.stalePattern });
    await createTestDatabase(server, dbName, { ...ddl, onLockWait: (ms) => (createLockWait = ms) });
    created = true;
    const mk = (opts.migrateLockKey ?? MIGRATE_LOCK_KEY).toString();
    await server.query("select pg_advisory_lock($1)", [mk]);
    try {
      await (opts.migrate ?? runMigrations)(urlFor());
    } finally {
      await server.query("select pg_advisory_unlock($1)", [mk]).catch(() => {}); // an ended connection released it
    }
    await admin.connect();
  } catch (error) {
    // Best effort: an ended connection (an unlock failure) cannot drop; a later sweep does,
    // because ending the session released this database's lifetime lock.
    if (created) await dropTestDatabase(server, dbName, ddl).catch(() => {});
    await admin.end().catch(() => {});
    await server.end().catch(() => {});
    throw error;
  } finally {
    // A slow setup names its DDL-lock wait (HYG-006), like close() names its slow steps.
    const total = Math.round(performance.now() - t0);
    if (total >= (opts.slowMs ?? SLOW_MS)) {
      console.error(`[harness] slow setup of ${dbName}: ${total} ms (lock_wait ${createLockWait})`);
    }
  }

  const roles: string[] = [];
  const clients: pg.Client[] = [];
  const pools: pg.Pool[] = [];
  const password = `test_${suffix}`; // throwaway, loopback-only test credential

  return {
    dbName,
    admin,
    async createLoginRole(attrs, memberOf = []) {
      const role = `rls_${suffix}_${roles.length}`;
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' ${attrs}`);
      roles.push(role);
      // The migration revokes CONNECT from PUBLIC; each login is granted it explicitly.
      await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${role}`);
      for (const group of memberOf) await admin.query(`GRANT ${group} TO ${role}`);
      return role;
    },
    async createGroupRole(attrs) {
      const role = `rls_${suffix}_${roles.length}`;
      await admin.query(`CREATE ROLE ${role} NOLOGIN ${attrs}`);
      roles.push(role);
      return role;
    },
    urlAs(role) {
      return urlFor(role, password);
    },
    ownerUrl() {
      return urlFor();
    },
    poolAs(role) {
      const pool = testPool({ connectionString: urlFor(role, password), max: 4 });
      pools.push(pool);
      return pool;
    },
    async connectAs(role) {
      const c = testClient({ connectionString: urlFor(role, password) });
      await c.connect();
      clients.push(c);
      return c;
    },
    async close() {
      // Best effort per step so one failure never leaves the database or roles behind.
      // Each step is timed; a close slower than SLOW_MS names its steps on stderr (HYG-004),
      // so a hook timeout under a busy suite shows which step was slow. drop_database includes
      // the wait for the DDL lock, which is also reported as lock_wait (even when the drop fails).
      const t0 = performance.now();
      const steps: [string, number][] = [];
      const step = async (name: string, fn: () => Promise<unknown>) => {
        const s = performance.now();
        try {
          await fn();
        } finally {
          steps.push([name, Math.round(performance.now() - s)]);
        }
      };
      await step("clients", async () => { for (const c of clients) await c.end().catch(() => {}); });
      await step("pools", async () => { for (const p of pools) await p.end().catch(() => {}); });
      await step("admin", () => admin.end().catch(() => {}));
      try {
        await step("drop_database", () => dropTestDatabase(server, dbName, { ...ddl, onLockWait: (ms) => steps.push(["lock_wait", ms]) }));
        await step("drop_roles", async () => { for (const r of roles) await server.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {}); });
      } finally {
        await server.end().catch(() => {});
        const total = Math.round(performance.now() - t0);
        if (total >= (opts.slowMs ?? SLOW_MS)) {
          console.error(`[harness] slow close of ${dbName}: ${total} ms (${steps.map(([n, ms]) => `${n} ${ms}`).join(", ")})`);
        }
      }
    },
  };
}
