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

// A close slower than this is reported with its per-step timings (HYG-004).
const SLOW_CLOSE_MS = 5_000;

export async function createHarness(): Promise<Harness> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const dbName = `rls_${suffix}`;
  const server = new pg.Client({ connectionString: adminUrl });
  await server.connect();
  // Each run holds a session advisory lock keyed on its database name for its whole
  // lifetime; leftovers of crashed runs are dropped only when their lock is free, so a
  // concurrent run (parallel files, CI shards) is never swept.
  const lockKey = (name: string) => `hashtext('${name}')`;
  await server.query(`select pg_advisory_lock(${lockKey(dbName)})`);
  const stale = await server.query<{ d: string }>(
    `select datname as d from pg_database where datname ~ '^rls_[0-9a-f]{12}$'`,
  );
  for (const { d } of stale.rows) {
    const free = await server.query<{ ok: boolean }>(
      `select pg_try_advisory_lock(${lockKey(d)}) as ok`,
    );
    if (!free.rows[0].ok) continue;
    try {
      await server.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
      const leftover = await server.query<{ r: string }>(
        `select rolname as r from pg_roles where rolname ~ $1`,
        [`^${d}_[0-9]+$`],
      );
      for (const { r } of leftover.rows) await server.query(`DROP ROLE IF EXISTS ${r}`);
    } finally {
      await server.query(`select pg_advisory_unlock(${lockKey(d)})`);
    }
  }
  const orphans = await server.query<{ r: string; d: string }>(
    `select rolname as r, substring(rolname from '^(rls_[0-9a-f]{12})_') as d from pg_roles
     where rolname ~ '^rls_[0-9a-f]{12}_[0-9]+$'
       and substring(rolname from '^(rls_[0-9a-f]{12})_') not in (select datname from pg_database)`,
  );
  for (const { r, d } of orphans.rows) {
    const free = await server.query<{ ok: boolean }>(
      `select pg_try_advisory_lock(${lockKey(d)}) as ok`,
    );
    if (!free.rows[0].ok) continue;
    try {
      await server.query(`DROP ROLE IF EXISTS ${r}`);
    } finally {
      await server.query(`select pg_advisory_unlock(${lockKey(d)})`);
    }
  }
  await server.query(`CREATE DATABASE ${dbName}`);
  const urlFor = (user?: string, password?: string) => {
    const u = new URL(adminUrl);
    u.pathname = `/${dbName}`;
    if (user) {
      u.username = user;
      u.password = password ?? "";
    }
    return u.toString();
  };
  const admin = new pg.Client({ connectionString: urlFor() });
  try {
    await runMigrations(urlFor());
    await admin.connect();
  } catch (error) {
    await server.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await server.end();
    throw error;
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
      const pool = new pg.Pool({ connectionString: urlFor(role, password), max: 4 });
      pools.push(pool);
      return pool;
    },
    async connectAs(role) {
      const c = new pg.Client({ connectionString: urlFor(role, password) });
      await c.connect();
      clients.push(c);
      return c;
    },
    async close() {
      // Best effort per step so one failure never leaves the database or roles behind.
      // Each step is timed; a close slower than SLOW_CLOSE_MS names its steps on stderr
      // (HYG-004), so a hook timeout under a busy suite shows which step was slow.
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
        await step("drop_database", () => server.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
        await step("drop_roles", async () => { for (const r of roles) await server.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {}); });
      } finally {
        await server.end();
        const total = Math.round(performance.now() - t0);
        if (total >= SLOW_CLOSE_MS) {
          console.error(`[harness] slow close of ${dbName}: ${total} ms (${steps.map(([n, ms]) => `${n} ${ms}`).join(", ")})`);
        }
      }
    },
  };
}
