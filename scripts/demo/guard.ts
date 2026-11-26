// HYG-DEMO-1 double-guarded staging-only preconditions, per-connection same-database proof,
// & atomic out-of-repo credential writer.
// DEC-034 / MIG-2: refuses to run unless BOTH DEPLOY_ENV === "staging" AND
// public.platform_environment.deploy_env === "staging" AND public.residency_attestations
// exists with zero production rows (never on production, local, demo, or any database ever
// marked production). Demo passwords are generated at runtime and written exclusively outside
// the repository with mode 0600.
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import type pg from "pg";
import { passwordProblem } from "../../src/auth/policy";

// Match tests/rls/harness.ts advisory lock keys (7202611030 / 7202611040) and add dedicated
// seed-serialization (7202611050) and full-reset-operation (7202611060) lock keys.
export const DDL_LOCK_KEY = "7202611030";
export const MIGRATE_LOCK_KEY = "7202611040";
export const SEED_LOCK_KEY = "7202611050";
export const RESET_OP_LOCK_KEY = "7202611060";

export type DemoGuardCode =
  | "NON_STAGING_ENV"
  | "MISSING_DB_ENV_MARKER"
  | "NON_STAGING_DB"
  | "PRODUCTION_HISTORY_DB"
  | "DB_TARGET_MISMATCH"
  | "FENCE_LOST"
  | "UNSAFE_CREDENTIALS_PATH"
  | "INVALID_DB_IDENTIFIER"
  | "INVALID_AUTH_CONFIG";

export class DemoGuardError extends Error {
  constructor(
    readonly code: DemoGuardCode,
    message: string,
  ) {
    super(message);
    this.name = "DemoGuardError";
  }
}

export class DemoAlreadySeededError extends Error {
  constructor(message = "database already contains seeded tenant or account records; reset staging first") {
    super(message);
    this.name = "DemoAlreadySeededError";
  }
}

export type DemoEnv = Record<string, string | undefined>;

// Fail closed: exact match "staging" only.
export function assertStagingEnv(env: DemoEnv = process.env): void {
  if (env.DEPLOY_ENV !== "staging") {
    throw new DemoGuardError(
      "NON_STAGING_ENV",
      `REFUSED: DEPLOY_ENV must be "staging" (got ${JSON.stringify(env.DEPLOY_ENV ?? null)})`,
    );
  }
}

// Checks BOTH platform_environment (singleton id = 1) AND residency_attestations (required
// table — fails closed if missing) so a database that is unmigrated, non-staging, or has
// ever been attested as production is always refused.
export async function assertStagingDatabase(db: pg.ClientBase): Promise<void> {
  const tableCheck = await db.query<{ env_t: string | null; attest_t: string | null }>(
    `select to_regclass('public.platform_environment')::text as env_t,
            to_regclass('public.residency_attestations')::text as attest_t`,
  );
  if (!tableCheck.rows[0]?.env_t) {
    throw new DemoGuardError(
      "MISSING_DB_ENV_MARKER",
      "REFUSED: public.platform_environment table does not exist (unmigrated or wrong database)",
    );
  }
  if (!tableCheck.rows[0]?.attest_t) {
    throw new DemoGuardError(
      "MISSING_DB_ENV_MARKER",
      "REFUSED: public.residency_attestations table does not exist (unmigrated or incomplete database)",
    );
  }

  const marker = await db.query<{ deploy_env: string }>(
    `select deploy_env from public.platform_environment where id = 1`,
  );
  if (marker.rowCount !== 1) {
    throw new DemoGuardError(
      "MISSING_DB_ENV_MARKER",
      "REFUSED: public.platform_environment has no row for id = 1",
    );
  }
  const dbEnv = marker.rows[0].deploy_env;
  if (dbEnv !== "staging") {
    throw new DemoGuardError(
      "NON_STAGING_DB",
      `REFUSED: database platform_environment is ${JSON.stringify(dbEnv)}, expected "staging"`,
    );
  }

  const prodAttest = await db.query<{ n: number }>(
    `select count(*)::int as n from public.residency_attestations where deploy_env = 'production'`,
  );
  if ((prodAttest.rows[0]?.n ?? 0) > 0) {
    throw new DemoGuardError(
      "PRODUCTION_HISTORY_DB",
      "REFUSED: database carries a production residency attestation and may never be seeded or reset",
    );
  }
}

export async function assertStagingOnly(db: pg.ClientBase, env: DemoEnv = process.env): Promise<void> {
  assertStagingEnv(env);
  await assertStagingDatabase(db);
}

// Generates a positive 62-bit random advisory lock key (distinct from fixed lock keys) for
// proving live that every physical connection targets the exact same verified PostgreSQL
// cluster and database as the fence session.
export function randomAdvisoryLockKey(): string {
  const buf = randomBytes(8);
  // Clear sign/top bits (0xc0) and set bit 60 (0x10 in MSB) so the value is always a
  // positive signed int64 in [2^60, 2^62 - 1], well above fixed lock keys (~7.2e9).
  buf[0] = (buf[0] & 0x3f) | 0x10;
  return buf.readBigInt64BE(0).toString();
}

export type DbIdentity = {
  dbName: string;
  dbOid: string;
  postmasterStartedAt: string;
};

export async function readDbIdentity(db: pg.ClientBase): Promise<DbIdentity> {
  const r = await db.query<{ db_name: string; db_oid: string; started_at: string }>(
    `select current_database() as db_name,
            (select oid::text from pg_database where datname = current_database()) as db_oid,
            pg_postmaster_start_time()::text as started_at`,
  );
  return {
    dbName: r.rows[0].db_name,
    dbOid: r.rows[0].db_oid,
    postmasterStartedAt: r.rows[0].started_at,
  };
}

// Proves that `candidate` is connected to the exact same PostgreSQL cluster AND database
// as the fence session (which holds `runProbeKey` via pg_advisory_xact_lock on a separate
// session). PostgreSQL advisory locks are scoped to (database_oid, key), so any connection
// targeting another server or another database in the same cluster will acquire `runProbeKey`
// (returning true) and fail immediately.
export async function assertSameClusterAndDatabase(
  leaderIdentity: DbIdentity,
  candidate: pg.ClientBase,
  label: string,
  runProbeKey: string,
): Promise<void> {
  const r = await candidate.query<{
    db_name: string;
    db_oid: string;
    started_at: string;
    acquired: boolean;
  }>(
    `select current_database() as db_name,
            (select oid::text from pg_database where datname = current_database()) as db_oid,
            pg_postmaster_start_time()::text as started_at,
            pg_try_advisory_lock($1) as acquired`,
    [runProbeKey],
  );
  const row = r.rows[0];
  if (row.acquired) {
    await candidate.query(`select pg_advisory_unlock($1)`, [runProbeKey]).catch(() => {});
    throw new DemoGuardError(
      "DB_TARGET_MISMATCH",
      `REFUSED: ${label} connection does not target the same verified staging database as ownerDatabaseUrl (got ${row.db_name})`,
    );
  }
  if (
    row.db_name !== leaderIdentity.dbName ||
    row.db_oid !== leaderIdentity.dbOid ||
    row.started_at !== leaderIdentity.postmasterStartedAt
  ) {
    throw new DemoGuardError(
      "DB_TARGET_MISMATCH",
      `REFUSED: ${label} connection database identity (${row.db_name}/${row.db_oid}) differs from verified staging database (${leaderIdentity.dbName}/${leaderIdentity.dbOid})`,
    );
  }
}

function extractSqlText(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "text" in first && typeof (first as { text?: unknown }).text === "string") {
    return (first as { text: string }).text;
  }
  return "";
}

// Wraps a pg.Pool so EVERY physical client checked out via pool.connect() OR pool.query()
// (including brand-new or replacement connections opened after disconnects/DNS changes)
// is proven to hit the exact verified staging database BEFORE running any SQL, AND enforces
// database-side fence verification on THAT exact backend:
// - Before every explicit COMMIT, verifies `pg_try_advisory_xact_lock(runProbeKey)` returns
//   false on the same transaction backend; if the fence disappeared on PostgreSQL (even before
//   JS socket events fire), automatically ROLLBACKs the transaction and throws FENCE_LOST.
// - Before every idle autocommit statement (e.g. Better Auth or single-call writers), verifies
//   `pg_try_advisory_lock(runProbeKey)` returns false on the backend before running the query.
export function guardVerifiedPool(
  pool: pg.Pool,
  opts: {
    leaderIdentity: DbIdentity;
    label: string;
    runProbeKey: string;
    assertFenceAlive: () => void;
    bypassClients?: WeakSet<pg.PoolClient>;
  },
): pg.Pool {
  const verifiedClients = new WeakSet<pg.PoolClient>();
  const wrappedQueryClients = new WeakSet<pg.PoolClient>();
  const rawConnect = pool.connect.bind(pool) as {
    (): Promise<pg.PoolClient>;
    (cb: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void): void;
  };

  const verifyClient = async (client: pg.PoolClient): Promise<pg.PoolClient> => {
    opts.assertFenceAlive();
    if (!opts.bypassClients?.has(client) && !verifiedClients.has(client)) {
      await assertSameClusterAndDatabase(opts.leaderIdentity, client, opts.label, opts.runProbeKey);
      opts.assertFenceAlive();
      verifiedClients.add(client);
    }
    if (!opts.bypassClients?.has(client) && !wrappedQueryClients.has(client)) {
      const rawQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
      const clientWithTx = client as pg.PoolClient & { getTransactionStatus?: () => string };

      const verifyBackendFence = async (inTransaction: boolean): Promise<void> => {
        opts.assertFenceAlive();
        if (inTransaction) {
          const chk = (await rawQuery(`select pg_try_advisory_xact_lock($1) as acquired`, [opts.runProbeKey])) as {
            rows: { acquired: boolean }[];
          };
          if (chk.rows[0]?.acquired) {
            await (rawQuery(`rollback`) as Promise<unknown>).catch(() => {});
            throw new DemoGuardError(
              "FENCE_LOST",
              "REFUSED: database-side seed fence lost before transaction commit; rolled back",
            );
          }
          return;
        }
        const chk = (await rawQuery(`select pg_try_advisory_lock($1) as acquired`, [opts.runProbeKey])) as {
          rows: { acquired: boolean }[];
        };
        if (chk.rows[0]?.acquired) {
          await (rawQuery(`select pg_advisory_unlock($1)`, [opts.runProbeKey]) as Promise<unknown>).catch(() => {});
          throw new DemoGuardError(
            "FENCE_LOST",
            "REFUSED: database-side seed fence lost before statement execution",
          );
        }
      };

      (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
        opts.assertFenceAlive();
        const sql = extractSqlText(args).trim();
        const isCommit = /^commit\b/i.test(sql);
        const isTxControl = /^(begin|start\s+transaction|rollback|savepoint|release\s+savepoint|set\s|reset\s|show\s)/i.test(
          sql,
        );
        const hasCallback =
          typeof args[args.length - 1] === "function" ||
          Boolean(args[0] && typeof (args[0] as { callback?: unknown }).callback === "function");

        if (hasCallback) {
          if (isCommit) {
            const cb =
              typeof args[args.length - 1] === "function"
                ? (args[args.length - 1] as (err?: Error) => void)
                : ((args[0] as { callback: (err?: Error) => void }).callback);
            verifyBackendFence(true).then(
              () => rawQuery(...args),
              (err: Error) => cb(err),
            );
            return;
          }
          return rawQuery(...args);
        }

        if (isCommit) {
          return (async () => {
            await verifyBackendFence(true);
            return rawQuery(...args);
          })();
        }

        if (!isTxControl && clientWithTx.getTransactionStatus?.() === "I") {
          return (async () => {
            await verifyBackendFence(false);
            return rawQuery(...args);
          })();
        }

        return rawQuery(...args);
      };
      wrappedQueryClients.add(client);
    }
    return client;
  };

  const guardedConnect = (
    cb?: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void,
  ): Promise<pg.PoolClient> | void => {
    if (typeof cb === "function") {
      try {
        opts.assertFenceAlive();
      } catch (e) {
        cb(e as Error, undefined, () => {});
        return;
      }
      rawConnect((err, client, done) => {
        if (err || !client) {
          cb(err, client, done);
          return;
        }
        verifyClient(client).then(
          (verified) => cb(undefined, verified, done),
          (verifyErr: Error) => {
            done(verifyErr);
            cb(verifyErr, undefined, () => {});
          },
        );
      });
      return;
    }

    return (async () => {
      opts.assertFenceAlive();
      const client = await rawConnect();
      try {
        return await verifyClient(client);
      } catch (e) {
        client.release(e as Error);
        throw e;
      }
    })();
  };

  (pool as unknown as { connect: typeof guardedConnect }).connect = guardedConnect;
  return pool;
}

// Idempotency guard: refuses to seed twice into a non-empty database.
export async function assertNotSeeded(db: pg.ClientBase): Promise<void> {
  const tenants = await db.query<{ n: number }>(`select count(*)::int as n from public.tenants_registry`);
  if ((tenants.rows[0]?.n ?? 0) > 0) {
    throw new DemoAlreadySeededError(
      `REFUSED: tenants_registry already has ${tenants.rows[0].n} row(s); run reset before re-seeding`,
    );
  }
  const users = await db.query<{ n: number }>(`select count(*)::int as n from public.auth_user`);
  if ((users.rows[0]?.n ?? 0) > 0) {
    throw new DemoAlreadySeededError(
      `REFUSED: auth_user already has ${users.rows[0].n} row(s); run reset before re-seeding`,
    );
  }
  const vendors = await db.query<{ n: number }>(`select count(*)::int as n from public.vendor_staff`);
  if ((vendors.rows[0]?.n ?? 0) > 0) {
    throw new DemoAlreadySeededError(
      `REFUSED: vendor_staff already has ${vendors.rows[0].n} row(s); run reset before re-seeding`,
    );
  }
}

// Exact directory containment check: rejects only an exact ".." or "../" prefix so
// sibling-like child names inside the repository (e.g. `..demo`) are never misclassified
// as outside the repository.
export function isInsideDir(candidateReal: string, baseReal: string): boolean {
  const rel = relative(baseReal, candidateReal);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Resolves the real ancestor path of a file that may not exist yet so symlink escapes into
// the repository are caught before creating parent directories or writing.
function resolveNearestReal(p: string): string {
  const abs = resolve(p);
  const tail: string[] = [];
  let cur = abs;
  while (true) {
    try {
      const real = realpathSync(cur);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      tail.push(cur.slice(parent.length).replace(/^[/\\]+/, ""));
      cur = parent;
    }
  }
}

export function assertOutsideRepo(filePath: string, repoRoot: string): string {
  if (!filePath || !filePath.trim()) {
    throw new DemoGuardError("UNSAFE_CREDENTIALS_PATH", "REFUSED: credentials output path is required");
  }
  const realRepo = realpathSync(resolve(repoRoot));
  const targetReal = resolveNearestReal(filePath);
  if (isInsideDir(targetReal, realRepo)) {
    throw new DemoGuardError(
      "UNSAFE_CREDENTIALS_PATH",
      `REFUSED: credentials file must live outside the repository (got ${filePath})`,
    );
  }
  return targetReal;
}

// Walks every segment of `dirPath` from root down, refusing any symlink, non-directory, or
// mutable ancestor directory (owned by another non-root user, or group/world-writable without
// root-owned sticky bit like `/tmp`), and creating missing leaf segments one-by-one with 0700.
function ensureTrustedParentChain(dirPath: string, uid: number): void {
  const abs = resolve(dirPath);
  const { root } = parse(abs);
  const segments = abs.slice(root.length).split(sep).filter(Boolean);

  const checkAncestorSafety = (p: string, st: Stats, isLeafParent: boolean) => {
    if (st.isSymbolicLink()) {
      throw new DemoGuardError(
        "UNSAFE_CREDENTIALS_PATH",
        `REFUSED: credentials parent directory traverses a symbolic link (${p})`,
      );
    }
    if (!st.isDirectory()) {
      throw new DemoGuardError(
        "UNSAFE_CREDENTIALS_PATH",
        `REFUSED: credentials parent path component is not a directory (${p})`,
      );
    }
    if (isLeafParent) {
      if (st.uid !== uid || (st.mode & 0o022) !== 0) {
        throw new DemoGuardError(
          "UNSAFE_CREDENTIALS_PATH",
          `REFUSED: credentials parent directory must be owned by current user and non-group/world-writable (${p})`,
        );
      }
      return;
    }
    // Intermediate ancestors: must be root-owned or current-user-owned; if writable by
    // group/other, ONLY a root-owned sticky directory (e.g. /tmp 1777) is permitted so
    // unprivileged users cannot rename or replace child directories along the path.
    const ownerOk = st.uid === 0 || st.uid === uid;
    const stickyRootTmp = st.uid === 0 && (st.mode & 0o1000) !== 0;
    const writableByOthers = (st.mode & 0o022) !== 0;
    if (!ownerOk || (writableByOthers && !stickyRootTmp)) {
      throw new DemoGuardError(
        "UNSAFE_CREDENTIALS_PATH",
        `REFUSED: credentials ancestor directory is mutable by other users (${p})`,
      );
    }
  };

  // Validate root itself
  checkAncestorSafety(root, lstatSync(root), segments.length === 0);

  let cur = root;
  for (let i = 0; i < segments.length; i++) {
    const isLeafParent = i === segments.length - 1;
    cur = resolve(cur, segments[i]);
    try {
      const st = lstatSync(cur);
      checkAncestorSafety(cur, st, isLeafParent);
    } catch (e) {
      if (e instanceof DemoGuardError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      mkdirSync(cur, { mode: 0o700 });
      const created = lstatSync(cur);
      checkAncestorSafety(cur, created, isLeafParent);
    }
  }
}

// Atomic, symlink-safe, ancestor-verified 0600 credentials writer (Linux POSIX; fails closed
// on unsupported platforms where /proc/self/fd or UID checks are unavailable):
// - Verifies every ancestor directory from `/` down is non-symlink and immutable by other users;
// - Pins the parent directory descriptor (O_DIRECTORY | O_NOFOLLOW) and verifies its realpath;
// - Rejects any existing non-regular destination file (symlink, directory, FIFO, socket, device);
// - Creates a fresh sibling temp file with O_CREAT | O_EXCL | O_NOFOLLOW at mode 0600,
//   verifies fstat + fchmod on the open fd and /proc/self/fd/<fd> + /proc/self/fd/<dirFd>
//   before writing secret bytes and again before atomic rename + parent fsync.
export function writeCredentialsFile(filePath: string, payload: unknown, opts: { repoRoot: string }): string {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    throw new DemoGuardError(
      "UNSAFE_CREDENTIALS_PATH",
      "REFUSED: atomic Linux credential path verification is required on this platform",
    );
  }
  const uid = process.getuid();
  const realRepo = realpathSync(resolve(opts.repoRoot));
  assertOutsideRepo(filePath, opts.repoRoot);
  const absTarget = resolve(filePath);
  const absDir = dirname(absTarget);
  const leafName = absTarget.slice(absDir.length).replace(/^[/\\]+/, "");
  if (!leafName || leafName === "." || leafName === "..") {
    throw new DemoGuardError("UNSAFE_CREDENTIALS_PATH", `REFUSED: invalid credentials file name (${filePath})`);
  }

  // Verify the entire ancestor chain before pinning or creating anything.
  ensureTrustedParentChain(absDir, uid);

  const realDir = realpathSync(absDir);
  if (isInsideDir(realDir, realRepo)) {
    throw new DemoGuardError(
      "UNSAFE_CREDENTIALS_PATH",
      `REFUSED: credentials parent directory resolves inside the repository (${filePath})`,
    );
  }

  const dirFd = openSync(realDir, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
  try {
    const dirStat = fstatSync(dirFd);
    if (!dirStat.isDirectory() || dirStat.uid !== uid || (dirStat.mode & 0o022) !== 0) {
      throw new DemoGuardError(
        "UNSAFE_CREDENTIALS_PATH",
        "REFUSED: pinned credentials parent directory failed ownership or permission check",
      );
    }
    const assertPinnedDirUnchanged = () => {
      const curDirReal = realpathSync(`/proc/self/fd/${dirFd}`);
      if (curDirReal !== realDir || isInsideDir(curDirReal, realRepo)) {
        throw new DemoGuardError(
          "UNSAFE_CREDENTIALS_PATH",
          "REFUSED: credentials parent directory moved or resolved inside the repository",
        );
      }
    };
    assertPinnedDirUnchanged();

    const verified = resolve(realDir, leafName);
    if (isInsideDir(verified, realRepo)) {
      throw new DemoGuardError(
        "UNSAFE_CREDENTIALS_PATH",
        `REFUSED: credentials file must live outside the repository (${filePath})`,
      );
    }

    const assertLeafSafe = () => {
      try {
        const st = lstatSync(verified);
        if (!st.isFile() || st.isSymbolicLink()) {
          throw new DemoGuardError(
            "UNSAFE_CREDENTIALS_PATH",
            "REFUSED: credentials target must be a regular file, not a symlink, directory, or special file",
          );
        }
      } catch (e) {
        if (e instanceof DemoGuardError) throw e;
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    };
    assertLeafSafe();

    const tmpName = `${leafName}.tmp.${randomBytes(8).toString("hex")}`;
    const tmpPath = resolve(realDir, tmpName);
    const fd = openSync(
      tmpPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    let closed = false;
    try {
      const fdStat = fstatSync(fd);
      if (!fdStat.isFile() || fdStat.nlink !== 1 || fdStat.uid !== uid) {
        throw new DemoGuardError(
          "UNSAFE_CREDENTIALS_PATH",
          "REFUSED: opened credentials file descriptor failed regular-file ownership check",
        );
      }
      fchmodSync(fd, 0o600);
      assertPinnedDirUnchanged();
      const fdReal = realpathSync(`/proc/self/fd/${fd}`);
      if (fdReal !== tmpPath || isInsideDir(fdReal, realRepo)) {
        throw new DemoGuardError(
          "UNSAFE_CREDENTIALS_PATH",
          "REFUSED: open credentials file descriptor resolved to an unexpected path",
        );
      }
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8" });
      fsyncSync(fd);
      closeSync(fd);
      closed = true;

      assertPinnedDirUnchanged();
      assertLeafSafe();
      renameSync(tmpPath, verified);
      fsyncSync(dirFd);
      return verified;
    } catch (e) {
      if (!closed) {
        try {
          closeSync(fd);
        } catch {
          // ignore close error on failure path
        }
      }
      try {
        if (realpathSync(`/proc/self/fd/${dirFd}`) === realDir) {
          unlinkSync(tmpPath);
        }
      } catch {
        // ignore cleanup error
      }
      throw e;
    }
  } finally {
    closeSync(dirFd);
  }
}

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_";

export function generateDemoPassword(email?: string): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = randomBytes(24);
    let out = "";
    for (let i = 0; i < 20; i++) {
      out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
    }
    if (!passwordProblem(out, email)) return out;
  }
  throw new Error("failed to generate policy-compliant demo password");
}
