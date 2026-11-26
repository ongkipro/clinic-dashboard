// HYG-DEMO-1 automated verification on real PostgreSQL (DEC-034, MIG-2):
// 1. Guards: refuses non-staging DEPLOY_ENV, missing/non-staging platform_environment,
//    missing residency_attestations table, production attestation history, in-repo (including
//    `..demo`), symlink, non-regular, and mutable-ancestor credential paths, multi-DB split,
//    replacement-connection drift, in-flight writer transaction rollback on fence loss +
//    blocking concurrent production transitions, mid-seed fence loss, marker transition while
//    reset waits, inspection-session loss & blocked competing writer after quiesce (restoring
//    ALLOW_CONNECTIONS), routed migration DB refusal leaving other DB untouched, missing
//    grantConnectRoles, and invalid migrations.
// 2. Clean seed on an empty migrated staging DB: writes 0600 out-of-repo credentials,
//    provisions the tenant through real vendor console + PR-59 go-live writers, creates
//    2 vendor staff + all 16 clinic roles, 30 synthetic patients, clinical/cashier/package/
//    stock/commission/CRM flows + event-driven outbox completeness + real auth/TOTP sign-in
//    & DB rate-limit verification + real read-back decode of stored PNG signature & PDF evidence.
// 3. Every one of the 16 clinic roles resolves context and its role home returns real data.
// 4. Full M8 accounting reconciliation: sub-ledgers == GL per tenant & per branch (BOTH net
//    AND gross), inter-branch clearing nets to 0, every journal entry balanced, trial balance 0,
//    zero handover exceptions, zero recon discrepancies.
// 5. Idempotency: a second seedStagingDemo() call is refused (DemoAlreadySeededError).
// 6. Reset: resetStagingDatabase refuses app reconnects continuously during drop/recreate/
//    migrate/stamp, succeeds cleanly without FORCE, and re-seed produces identical counts
//    with newly generated passwords.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, TOTP_ROLES, type Role } from "../../src/auth/policy";
import { createAuth, VENDOR_AUTH_BASE_PATH } from "../../src/auth/server";
import { APP_GROUP_ROLE, AUTH_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { handoverExceptions, report } from "../../src/modules/accounting/ledger/ledger";
import { readRecon } from "../../src/modules/accounting/recon/report";
import { rollforward, type Ledger } from "../../src/modules/accounting/subledgers/subledgers";
import { consentSignature } from "../../src/modules/clinical/consent/consent";
import { examQueue } from "../../src/modules/clinical/exam/exam";
import { myTarget } from "../../src/modules/commission/targets/targets";
import { downloadEvidence } from "../../src/modules/compliance/compliance";
import { resolveContext, roleSource } from "../../src/modules/org/identity";
import { searchPatients } from "../../src/modules/patients/search/search";
import { kpi, roleHome } from "../../src/modules/reporting/dashboards/dashboards";
import { roomList } from "../../src/modules/treatment/treatment";
import { today as visitsToday } from "../../src/modules/visits/visits";
import { readFinanceSummary } from "../../src/app/(app)/keuangan/ringkasan/reader";
import { summaryIn as pasienkuIn } from "../../src/app/(app)/pasienku/load";
import { readAdminHome } from "../../src/app/(app)/ringkasan/admin-pusat/load";
import { readBranchSummary } from "../../src/app/(app)/ringkasan/cabang/reader";
import { readCsSummary } from "../../src/app/(app)/ringkasan/cs/reader";
import { createHarness, testClient, testPool, type Harness } from "../rls/harness";
import {
  assertNotSeeded,
  assertOutsideRepo,
  assertStagingDatabase,
  assertStagingEnv,
  DemoAlreadySeededError,
  DemoGuardError,
  guardVerifiedPool,
  isInsideDir,
  randomAdvisoryLockKey,
  readDbIdentity,
  SEED_LOCK_KEY,
  writeCredentialsFile,
} from "../../scripts/demo/guard";
import { resetStagingDatabase } from "../../scripts/demo/reset";
import { AuthSessionClient, seedStagingDemo, totp, type SeedSummary } from "../../scripts/demo/seed";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TEST_APP_URL = "http://127.0.0.1:3000";
const TEST_VENDOR_URL = "https://vendor.staging.test";
const TEST_AUTH_SECRET = randomBytes(32).toString("base64");
const TEST_VENDOR_CIDR = "203.0.113.0/24";

const PAIRS: { sub: Ledger; accounts: string[]; side: "debit" | "credit" }[] = [
  { sub: "cash_bank", accounts: ["cash_shift", "petty_cash", "bank"], side: "debit" },
  { sub: "gateway_clearing", accounts: ["gateway_clearing"], side: "debit" },
  { sub: "receivables", accounts: ["patient_receivable"], side: "debit" },
  { sub: "paid_not_delivered", accounts: ["liability_paid_not_delivered"], side: "credit" },
  { sub: "package_liability", accounts: ["liability_packages"], side: "credit" },
  { sub: "patient_balance", accounts: ["liability_patient_balance"], side: "credit" },
  { sub: "booking_dp", accounts: ["liability_booking_dp"], side: "credit" },
];

function safeInt(s: string): number {
  const n = Number(s);
  if (!Number.isSafeInteger(n) || String(n) !== String(BigInt(s))) {
    throw new Error(`amount outside safe integer range: ${s}`);
  }
  return n;
}

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function assertValidPng(buf: Buffer, expectedWidth: number, expectedHeight: number): void {
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idatParts: Buffer[] = [];
  let sawIend = false;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const expectedCrc = buf.readUInt32BE(pos + 8 + len);
    expect(crc32(buf.subarray(pos + 4, pos + 8 + len)), `CRC mismatch on ${type}`).toBe(expectedCrc);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      sawIend = true;
    }
    pos += 12 + len;
  }
  expect(width).toBe(expectedWidth);
  expect(height).toBe(expectedHeight);
  expect(sawIend).toBe(true);
  expect(idatParts.length).toBeGreaterThan(0);
  const raw = inflateSync(Buffer.concat(idatParts));
  expect(raw.length).toBe(expectedHeight * (1 + expectedWidth));
}

function assertValidPdf(buf: Buffer): void {
  const text = buf.toString("latin1");
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text).toContain("/Type /Catalog");
  expect(text).toContain("/Type /Page ");
  expect(text).toContain("trailer\n");
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  const m = /startxref\n(\d+)\n%%EOF/.exec(text);
  expect(m).toBeTruthy();
  const xrefPos = Number(m![1]);
  expect(text.slice(xrefPos, xrefPos + 5)).toBe("xref\n");
  const entryRe = /^(\d{10}) 00000 n $/gm;
  const xrefSlice = text.slice(xrefPos);
  const offsets: number[] = [];
  for (let hit = entryRe.exec(xrefSlice); hit; hit = entryRe.exec(xrefSlice)) {
    offsets.push(Number(hit[1]));
  }
  expect(offsets.length).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < offsets.length; i++) {
    expect(text.slice(offsets[i], offsets[i] + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`));
  }
}

let h: Harness;
let otherDb: Harness;
let appLogin: string;
let authLogin: string;
let vendorLogin: string;
let otherAppLogin: string;
let appPool: pg.Pool;
let tempDir: string;
let firstSummary: SeedSummary;
let savedDeployEnv: string | undefined;

const baseSeedOpts = (credentialsOutputPath: string) => ({
  ownerDatabaseUrl: h.ownerUrl(),
  appDatabaseUrl: h.urlAs(appLogin),
  authDatabaseUrl: h.urlAs(authLogin),
  vendorDatabaseUrl: h.urlAs(vendorLogin),
  credentialsOutputPath,
  appUrl: TEST_APP_URL,
  vendorUrl: TEST_VENDOR_URL,
  authSecret: TEST_AUTH_SECRET,
  vendorAllowlistCidr: TEST_VENDOR_CIDR,
  env: { DEPLOY_ENV: "staging" },
});

beforeAll(async () => {
  savedDeployEnv = process.env.DEPLOY_ENV;
  process.env.DEPLOY_ENV = "staging";
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) });
  tempDir = mkdtempSync(join(tmpdir(), "hyg-demo-test-"));
  h = await createHarness();
  otherDb = await createHarness();
  appLogin = await h.createLoginRole("", [APP_GROUP_ROLE]);
  authLogin = await h.createLoginRole("", [AUTH_GROUP_ROLE]);
  vendorLogin = await h.createLoginRole("", [VENDOR_GROUP_ROLE]);
  otherAppLogin = await otherDb.createLoginRole("", [APP_GROUP_ROLE]);
  appPool = await openAppPool({ connectionString: h.urlAs(appLogin), max: 6 }, APP_GROUP_ROLE);
}, 300_000);

afterAll(async () => {
  if (savedDeployEnv === undefined) delete process.env.DEPLOY_ENV;
  else process.env.DEPLOY_ENV = savedDeployEnv;
  setKekRingForTests(undefined);
  await appPool?.end().catch(() => {});
  await otherDb?.close().catch(() => {});
  await h?.close().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("HYG-DEMO-1 staging demo seed & reset", () => {
  it("enforces fail-closed staging guards, path/ancestor invariants, database-side transaction fence, quiesce-before-drop, and routed-migration refusal", async () => {
    // 1. DEPLOY_ENV checks
    expect(() => assertStagingEnv({})).toThrow(DemoGuardError);
    expect(() => assertStagingEnv({ DEPLOY_ENV: "local" })).toThrow(DemoGuardError);
    expect(() => assertStagingEnv({ DEPLOY_ENV: "demo" })).toThrow(DemoGuardError);
    expect(() => assertStagingEnv({ DEPLOY_ENV: "production" })).toThrow(DemoGuardError);

    // 2. Missing platform_environment row & non-staging platform_environment
    await expect(assertStagingDatabase(h.admin)).rejects.toMatchObject({ code: "NON_STAGING_DB" });
    await h.admin.query(`delete from public.platform_environment where id = 1`);
    await expect(assertStagingDatabase(h.admin)).rejects.toMatchObject({ code: "MISSING_DB_ENV_MARKER" });

    await h.admin.query(`insert into public.platform_environment (id, deploy_env) values (1, 'production')`);
    await expect(assertStagingDatabase(h.admin)).rejects.toMatchObject({ code: "NON_STAGING_DB" });
    await expect(
      resetStagingDatabase({ databaseUrl: h.ownerUrl(), env: { DEPLOY_ENV: "staging" } }),
    ).rejects.toMatchObject({ code: "NON_STAGING_DB" });

    await h.admin.query(`update public.platform_environment set deploy_env = 'staging' where id = 1`);

    // 3. Missing residency_attestations table fails closed (never treated as 0 production rows)
    const txCheck = testClient({ connectionString: otherDb.ownerUrl() });
    await txCheck.connect();
    try {
      await txCheck.query(`begin`);
      await txCheck.query(`update public.platform_environment set deploy_env = 'staging' where id = 1`);
      await txCheck.query(`alter table public.residency_attestations rename to residency_attestations_hidden`);
      await expect(assertStagingDatabase(txCheck)).rejects.toMatchObject({ code: "MISSING_DB_ENV_MARKER" });
      await txCheck.query(`rollback`);
    } finally {
      await txCheck.end();
    }

    // 4. Production residency attestation history refused even if platform_environment = 'staging'
    await h.admin.query(
      `insert into public.residency_attestations (id, release_digest, deployed_locations, deployed_locations_digest, config_version, matched, mismatches, deploy_env)
       values (1, $1, '[]'::jsonb, $2, $2, true, '[]'::jsonb, 'production')`,
      ["a".repeat(32), "b".repeat(64)],
    );
    await expect(assertStagingDatabase(h.admin)).rejects.toMatchObject({ code: "PRODUCTION_HISTORY_DB" });
    await h.admin.query(`delete from public.residency_attestations where id = 1`);

    // 5. Path containment (`..demo` inside repo!), symlink parent, mutable intermediate ancestor, non-regular leaf
    expect(isInsideDir(join(REPO_ROOT, "..demo"), REPO_ROOT)).toBe(true);
    expect(() => assertOutsideRepo(join(REPO_ROOT, "..demo"), REPO_ROOT)).toThrow(DemoGuardError);
    expect(() => assertOutsideRepo(join(REPO_ROOT, "demo-creds.json"), REPO_ROOT)).toThrow(DemoGuardError);
    expect(() => assertOutsideRepo(join(REPO_ROOT, "scripts/demo/creds.json"), REPO_ROOT)).toThrow(DemoGuardError);

    const symlinkParent = join(tempDir, "link-parent");
    symlinkSync(tempDir, symlinkParent);
    expect(() =>
      writeCredentialsFile(join(symlinkParent, "creds.json"), { ok: true }, { repoRoot: REPO_ROOT }),
    ).toThrow(DemoGuardError);

    const worldAncestor = join(tempDir, "world-ancestor");
    const nestedChild = join(worldAncestor, "child");
    mkdirSync(nestedChild, { recursive: true, mode: 0o700 });
    chmodSync(worldAncestor, 0o777);
    chmodSync(nestedChild, 0o700);
    expect(() =>
      writeCredentialsFile(join(nestedChild, "creds.json"), { ok: true }, { repoRoot: REPO_ROOT }),
    ).toThrow(DemoGuardError);

    const dirTarget = join(tempDir, "existing-dir");
    mkdirSync(dirTarget, { mode: 0o700 });
    expect(() => writeCredentialsFile(dirTarget, { ok: true }, { repoRoot: REPO_ROOT })).toThrow(DemoGuardError);

    // 6. Missing explicit auth config or non-staging DEPLOY_ENV refused
    await expect(
      seedStagingDemo({ ...baseSeedOpts(join(tempDir, "bad-secret.json")), authSecret: "too-short" }),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_CONFIG" });
    await expect(
      seedStagingDemo({ ...baseSeedOpts(join(tempDir, "refused.json")), env: { DEPLOY_ENV: "production" } }),
    ).rejects.toMatchObject({ code: "NON_STAGING_ENV" });

    // 7. Multi-DB split refused + replacement physical connection drift caught by guardVerifiedPool
    await expect(
      seedStagingDemo({
        ...baseSeedOpts(join(tempDir, "split-db.json")),
        appDatabaseUrl: otherDb.urlAs(otherAppLogin),
      }),
    ).rejects.toMatchObject({ code: "DB_TARGET_MISMATCH" });

    const leaderId = await readDbIdentity(h.admin);
    const probeKey = randomAdvisoryLockKey();
    await h.admin.query(`select pg_advisory_lock($1)`, [probeKey]);
    const driftPool = testPool({ connectionString: h.urlAs(appLogin), max: 2 });
    const otherPool = testPool({ connectionString: otherDb.urlAs(otherAppLogin), max: 1 });
    try {
      let connectCount = 0;
      const origConnect = driftPool.connect.bind(driftPool);
      (driftPool as unknown as { connect: () => Promise<pg.PoolClient> }).connect = async () => {
        connectCount++;
        return connectCount === 1 ? origConnect() : otherPool.connect();
      };
      guardVerifiedPool(driftPool, {
        leaderIdentity: leaderId,
        label: "replacementPool",
        runProbeKey: probeKey,
        assertFenceAlive: () => {},
      });
      const c1 = await driftPool.connect();
      expect((await c1.query(`select 1 as n`)).rows[0].n).toBe(1);
      await expect(driftPool.connect()).rejects.toMatchObject({ code: "DB_TARGET_MISMATCH" });
      c1.release();
    } finally {
      await driftPool.end().catch(() => {});
      await otherPool.end().catch(() => {});
      await h.admin.query(`select pg_advisory_unlock($1)`, [probeKey]);
    }

    // 8. Database-side transaction fence:
    //    (a) While SHARE fence is live, competing production marker transition BLOCKS (55P03);
    //    (b) When fence dies while an in-flight writer transaction is ALREADY OPEN, the pre-commit
    //        backend check intercepts COMMIT, ROLLS BACK the uncommitted write, throws FENCE_LOST,
    //        and refuses subsequent autocommit writes (even when JS flag is NOT flipped!).
    const fenceClient = testClient({ connectionString: h.ownerUrl() });
    const writerPool = testPool({ connectionString: h.ownerUrl(), max: 2 });
    const rivalClient = testClient({ connectionString: h.ownerUrl() });
    await fenceClient.connect();
    await rivalClient.connect();
    try {
      const txProbeKey = randomAdvisoryLockKey();
      await fenceClient.query(`begin isolation level read committed`);
      await fenceClient.query(`select pg_advisory_xact_lock($1)`, [txProbeKey]);
      await fenceClient.query(`lock table public.platform_environment, public.residency_attestations in share mode`);
      const fencePid = (await fenceClient.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0].pid;

      // (a) Competing production transition cannot pass the active SHARE fence
      await rivalClient.query(`begin`);
      await rivalClient.query(`set local lock_timeout = '120ms'`);
      await expect(
        rivalClient.query(`update public.platform_environment set deploy_env = 'production' where id = 1`),
      ).rejects.toMatchObject({ code: "55P03" });
      await rivalClient.query(`rollback`);

      // (b) Open an in-flight writer transaction with an uncommitted INSERT, then kill the fence
      //     with a no-op JS assertFenceAlive() so ONLY the PostgreSQL-side check can catch it!
      guardVerifiedPool(writerPool, {
        leaderIdentity: leaderId,
        label: "inFlightWriter",
        runProbeKey: txProbeKey,
        assertFenceAlive: () => {},
      });
      const w = await writerPool.connect();
      try {
        await w.query(`begin`);
        await w.query(
          `insert into public.auth_user (name, email) values ('Uncommitted Writer', 'uncommitted.fence@klinik-estetika.test')`,
        );
        // Synchronously terminate the fence backend (timeout=5000ms waits until PG releases its locks)
        // WHILE the writer transaction is open
        await h.admin.query(`select pg_terminate_backend($1, 5000)`, [fencePid]);
        await expect(w.query(`commit`)).rejects.toMatchObject({ code: "FENCE_LOST" });
        // Subsequent autocommit statement on the same backend is ALSO refused database-side
        await expect(
          w.query(`insert into public.auth_user (name, email) values ('After Fence', 'after.fence@klinik-estetika.test')`),
        ).rejects.toMatchObject({ code: "FENCE_LOST" });
      } finally {
        w.release();
      }
      // Verify neither row was committed!
      const leaked = (
        await h.admin.query<{ n: number }>(
          `select count(*)::int as n from public.auth_user where email in ('uncommitted.fence@klinik-estetika.test', 'after.fence@klinik-estetika.test')`,
        )
      ).rows[0].n;
      expect(leaked).toBe(0);
    } finally {
      await rivalClient.end().catch(() => {});
      await writerPool.end().catch(() => {});
      await fenceClient.end().catch(() => {});
    }

    // 9. Concurrent seed run refused immediately when SEED_LOCK_KEY is held
    await h.admin.query(`select pg_advisory_lock($1)`, [SEED_LOCK_KEY]);
    try {
      await expect(seedStagingDemo(baseSeedOpts(join(tempDir, "concurrent.json")))).rejects.toThrow(DemoAlreadySeededError);
    } finally {
      await h.admin.query(`select pg_advisory_unlock($1)`, [SEED_LOCK_KEY]);
    }

    // 10. Mid-seed fence loss aborts immediately and leaves NO credentials file written
    const abortedCreds = join(tempDir, "aborted-fence.json");
    await expect(
      seedStagingDemo({
        ...baseSeedOpts(abortedCreds),
        hooks: {
          onFenceAcquired: async ({ fencePid }) => {
            await h.admin.query(`select pg_terminate_backend($1, 5000)`, [fencePid]);
            await new Promise((r) => setTimeout(r, 50));
          },
        },
      }),
    ).rejects.toMatchObject({ code: "FENCE_LOST" });
    expect(existsSync(abortedCreds)).toBe(false);

    // 11. Reset pre-DDL validation: bad role spelling, unknown role, empty migrationsFolder
    await expect(
      resetStagingDatabase({ databaseUrl: h.ownerUrl(), env: { DEPLOY_ENV: "local" } }),
    ).rejects.toMatchObject({ code: "NON_STAGING_ENV" });

    await expect(
      resetStagingDatabase({
        databaseUrl: h.ownerUrl(),
        env: { DEPLOY_ENV: "staging" },
        grantConnectRoles: ["bad-role-name;invalid"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_DB_IDENTIFIER" });

    await expect(
      resetStagingDatabase({
        databaseUrl: h.ownerUrl(),
        env: { DEPLOY_ENV: "staging" },
        grantConnectRoles: ["nonexistent_demo_role_xyz"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_DB_IDENTIFIER" });

    const emptyMigDir = join(tempDir, "empty-migs");
    mkdirSync(emptyMigDir, { mode: 0o700 });
    await expect(
      resetStagingDatabase({
        databaseUrl: h.ownerUrl(),
        env: { DEPLOY_ENV: "staging" },
        migrationsFolder: emptyMigDir,
      }),
    ).rejects.toMatchObject({ code: "INVALID_DB_IDENTIFIER" });

    // 12. Reset refuses if a production transition commits while reset waits on marker locks!
    const waiter = testClient({ connectionString: h.ownerUrl() });
    await waiter.connect();
    try {
      await waiter.query(`begin`);
      await waiter.query(`lock table public.platform_environment in access exclusive mode`);
      const resetPromise = resetStagingDatabase({
        databaseUrl: h.ownerUrl(),
        env: { DEPLOY_ENV: "staging" },
      });
      await new Promise((r) => setTimeout(r, 100));
      await waiter.query(`update public.platform_environment set deploy_env = 'production' where id = 1`);
      await waiter.query(`commit`);
      await expect(resetPromise).rejects.toMatchObject({ code: "NON_STAGING_DB" });
      await h.admin.query(`update public.platform_environment set deploy_env = 'staging' where id = 1`);
    } finally {
      await waiter.end();
    }

    // 13 & 14. Quiesce verification & routed-migration regression on a dedicated throwaway DB
    //          (so draining all backends on thirdDb never disconnects h.admin):
    //          - Competing marker writer trying to connect AFTER quiesce is refused (ALLOW_CONNECTIONS false);
    //          - Inspector loss AFTER quiesce aborts WITHOUT dropping AND restores ALLOW_CONNECTIONS true;
    //          - Routed migration connection to `otherDb` is refused BEFORE running any DDL or
    //            altering otherDb's __drizzle_migrations.
    const thirdDb = await createHarness();
    try {
      await thirdDb.admin.query(`update public.platform_environment set deploy_env = 'staging' where id = 1`);

      let competingWriterRefused = false;
      await expect(
        resetStagingDatabase({
          databaseUrl: thirdDb.ownerUrl(),
          env: { DEPLOY_ENV: "staging" },
          hooks: {
            afterQuiesceBeforeDrop: async ({ inspectPid }) => {
              const lateWriter = testClient({ connectionString: thirdDb.ownerUrl() });
              try {
                await lateWriter.connect();
              } catch {
                competingWriterRefused = true;
              } finally {
                await lateWriter.end().catch(() => {});
              }
              // Terminate inspector synchronously from a separate maintenance DB connection (thirdDb.admin was drained by quiesce)
              await otherDb.admin.query(`select pg_terminate_backend($1, 5000)`, [inspectPid]);
              await new Promise((r) => setTimeout(r, 50));
            },
          },
        }),
      ).rejects.toMatchObject({ code: "DB_TARGET_MISMATCH" });
      expect(competingWriterRefused).toBe(true);

      // Reconnect works because ALLOW_CONNECTIONS was restored on abort and thirdDb was NOT dropped!
      const verifyRestored = testClient({ connectionString: thirdDb.ownerUrl() });
      await verifyRestored.connect();
      try {
        const envRow = await verifyRestored.query<{ deploy_env: string }>(
          `select deploy_env from public.platform_environment where id = 1`,
        );
        expect(envRow.rows[0]?.deploy_env).toBe("staging");
      } finally {
        await verifyRestored.end();
      }

      const otherBeforeMigs = (
        await otherDb.admin.query<{ n: number }>(`select count(*)::int as n from drizzle.__drizzle_migrations`)
      ).rows[0].n;
      const otherBeforeTables = (
        await otherDb.admin.query<{ n: number }>(
          `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
        )
      ).rows[0].n;

      await expect(
        resetStagingDatabase({
          databaseUrl: thirdDb.ownerUrl(),
          migrateDatabaseUrl: otherDb.ownerUrl(),
          env: { DEPLOY_ENV: "staging" },
        }),
      ).rejects.toMatchObject({ code: "DB_TARGET_MISMATCH" });

      const otherAfterMigs = (
        await otherDb.admin.query<{ n: number }>(`select count(*)::int as n from drizzle.__drizzle_migrations`)
      ).rows[0].n;
      const otherAfterTables = (
        await otherDb.admin.query<{ n: number }>(
          `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
        )
      ).rows[0].n;
      expect(otherAfterMigs).toBe(otherBeforeMigs);
      expect(otherAfterTables).toBe(otherBeforeTables);
    } finally {
      await thirdDb.close();
    }
  }, 120_000);

  it("seeds an empty migrated staging database completely, verifies credentials & valid PNG/PDF read-backs, and writes 0600 file", async () => {
    const credsPath = join(tempDir, "staging-credentials-1.json");
    firstSummary = await seedStagingDemo(baseSeedOpts(credsPath));

    expect(firstSummary.branches).toHaveLength(2);
    expect(firstSummary.counts.staff).toBe(16);
    expect(firstSummary.counts.services).toBe(12);
    expect(firstSummary.counts.products).toBe(10);
    expect(firstSummary.counts.packages).toBe(3);
    expect(firstSummary.counts.patients).toBe(30);
    expect(firstSummary.counts.visits).toBeGreaterThanOrEqual(8);
    expect(firstSummary.counts.appointments).toBeGreaterThanOrEqual(6);
    expect(firstSummary.counts.expenses).toBe(2);
    expect(firstSummary.counts.leads).toBe(5);
    expect(firstSummary.counts.complaints).toBe(1);
    expect(firstSummary.counts.incidents).toBe(1);

    // Event-driven outbox completeness: every eligible event has a done receipt & journals exist
    expect(firstSummary.outboxDrained.eligible).toBeGreaterThan(0);
    expect(firstSummary.outboxDrained.missingReceipt).toBe(0);
    expect(firstSummary.outboxDrained.done).toBe(firstSummary.outboxDrained.eligible);
    expect(firstSummary.outboxDrained.pending).toBe(0);
    expect(firstSummary.outboxDrained.leased).toBe(0);
    expect(firstSummary.outboxDrained.deadLetter).toBe(0);
    expect(firstSummary.outboxDrained.failed).toBe(0);
    expect(firstSummary.outboxDrained.journalEntries).toBeGreaterThan(0);

    // Real tenant lifecycle trail: provisioning -> onboarding -> live through vendor console writers
    const lifecycle = (
      await h.admin.query<{ from_state: string; to_state: string }>(
        `select from_state, to_state from public.tenant_lifecycle_events where tenant_id = $1 order by seq`,
        [firstSummary.tenantId],
      )
    ).rows;
    expect(lifecycle).toEqual([
      { from_state: "provisioning", to_state: "onboarding" },
      { from_state: "onboarding", to_state: "live" },
    ]);

    // Verify stored consent PNG signature & compliance PDF evidence decode validly via real read paths
    const [b1] = firstSummary.branches.map((b) => b.id);
    const docAcc = firstSummary.accounts.find((a) => a.role === "doctor")!;
    const ownAcc = firstSummary.accounts.find((a) => a.role === "owner")!;
    const consentRow = (
      await h.admin.query<{ id: string }>(
        `select id from public.procedure_consents where tenant_id = $1 limit 1`,
        [firstSummary.tenantId],
      )
    ).rows[0];
    expect(consentRow?.id).toBeTruthy();
    const docCtx = await resolveContext(appPool, docAcc.accountId, {
      tenantId: firstSummary.tenantId,
      actingRole: "doctor",
      activeBranchId: b1,
    });
    const storedPng = await withTenantContext(appPool, docCtx, (db) => consentSignature(db, consentRow.id));
    assertValidPng(storedPng, 640, 240);

    const evidenceRow = (
      await h.admin.query<{ id: string }>(
        `select id from public.evidence_files where tenant_id = $1 limit 1`,
        [firstSummary.tenantId],
      )
    ).rows[0];
    expect(evidenceRow?.id).toBeTruthy();
    const ownCtx = await resolveContext(appPool, ownAcc.accountId, {
      tenantId: firstSummary.tenantId,
      actingRole: "owner",
    });
    const storedPdf = await withTenantContext(appPool, ownCtx, (db) => downloadEvidence(db, evidenceRow.id));
    expect(storedPdf.mediaType).toBe("application/pdf");
    assertValidPdf(storedPdf.content);

    // Credentials file exists outside repo with strict 0600 permissions and all 18 accounts (2 vendor + 16 clinic)
    const st = statSync(firstSummary.credentialsFile);
    expect(st.mode & 0o777).toBe(0o600);
    const creds = JSON.parse(readFileSync(firstSummary.credentialsFile, "utf8")) as {
      accounts: { role: string; email: string; password: string; totpSecret: string | null }[];
    };
    expect(creds.accounts).toHaveLength(18);
    const passwords = new Set(creds.accounts.map((a) => a.password));
    expect(passwords.size).toBe(18);
    for (const acc of creds.accounts) {
      expect(acc.password.length).toBeGreaterThanOrEqual(15);
      if (acc.role === "platform_owner" || acc.role === "vendor_onboarding" || TOTP_ROLES.has(acc.role as Role)) {
        expect(acc.totpSecret).toBeTruthy();
      } else {
        expect(acc.totpSecret).toBeNull();
      }
    }

    // Verify real sign-in + TOTP with written credentials on BOTH clinic & vendor surfaces + DB rate limit active
    const authVerifyPool = await openAppPool({ connectionString: h.urlAs(authLogin), max: 3 }, AUTH_GROUP_ROLE);
    const vendorVerifyPool = await openAppPool({ connectionString: h.urlAs(vendorLogin), max: 2 }, VENDOR_GROUP_ROLE);
    try {
      const rateRows = (await h.admin.query<{ n: number }>(`select count(*)::int as n from public.auth_rate_limit`)).rows[0].n;
      expect(rateRows).toBeGreaterThan(0);

      const appAuth = createAuth({
        pool: authVerifyPool,
        baseURL: TEST_APP_URL,
        secret: TEST_AUTH_SECRET,
        roles: roleSource(appPool),
      });
      const ownerCred = creds.accounts.find((a) => a.role === "owner")!;
      const clinicClient = new AuthSessionClient(appAuth, TEST_APP_URL, "/api/auth", "203.0.113.200");
      const s1 = await clinicClient.post("/sign-in/email", { email: ownerCred.email, password: ownerCred.password });
      expect(s1.status).toBe(200);
      const v1 = await clinicClient.post("/two-factor/verify-totp", { code: totp(ownerCred.totpSecret!) });
      expect(v1.status).toBe(200);
      expect((await appAuth.checkSession(clinicClient.headers(), { activity: false })).gate).toBe("ok");

      const vendorAuth = createAuth({
        pool: authVerifyPool,
        baseURL: TEST_VENDOR_URL,
        surface: "vendor",
        secret: TEST_AUTH_SECRET,
        roles: async () => [],
        allowAddress: async (ip) =>
          (await vendorVerifyPool.query<{ ok: boolean }>(`select public.vendor_console_ip_allowed($1) as ok`, [ip])).rows[0].ok,
      });
      const poCred = creds.accounts.find((a) => a.role === "platform_owner")!;
      const vendorClient = new AuthSessionClient(vendorAuth, TEST_VENDOR_URL, VENDOR_AUTH_BASE_PATH, "203.0.113.10");
      const vs1 = await vendorClient.post("/sign-in/email", { email: poCred.email, password: poCred.password });
      expect(vs1.status).toBe(200);
      const vv1 = await vendorClient.post("/two-factor/verify-totp", { code: totp(poCred.totpSecret!) });
      expect(vv1.status).toBe(200);
      expect((await vendorAuth.checkSession(vendorClient.headers(), { activity: false })).gate).toBe("ok");
    } finally {
      await vendorVerifyPool.end().catch(() => {});
      await authVerifyPool.end().catch(() => {});
    }
  }, 180_000);

  it("resolves context and returns non-empty role home data for EVERY one of the 16 clinic roles", async () => {
    const [b1, b2] = firstSummary.branches.map((b) => b.id);
    const dbToday = (
      await h.admin.query<{ d: string }>(`select to_char(clock_timestamp() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as d`)
    ).rows[0].d;
    const monthStart = `${dbToday.slice(0, 7)}-01`;
    const monthKey = dbToday.slice(0, 7);

    const byRole = new Map(
      firstSummary.accounts
        .filter((a) => a.role !== "platform_owner" && a.role !== "vendor_onboarding")
        .map((a) => [a.role as Role, a]),
    );
    expect(byRole.size).toBe(16);

    const asRole = async <R>(role: Role, fn: (db: pg.PoolClient) => Promise<R>, branchId?: string) => {
      const acc = byRole.get(role)!;
      const ctx = await resolveContext(appPool, acc.accountId, {
        tenantId: firstSummary.tenantId,
        actingRole: role,
        activeBranchId: branchId ?? acc.branches[0],
      });
      expect(ctx.actingRole).toBe(role);
      return withTenantContext(appPool, ctx, fn);
    };

    for (const r of ROLES) {
      expect(byRole.has(r), `missing account for role ${r}`).toBe(true);
    }

    const ownK1 = await asRole("owner", (db) => kpi(db, { kpi: "k1", from: monthStart, to: dbToday }));
    expect(ownK1.total).toBeGreaterThan(0);

    const apHome = await asRole("admin_pusat", (db) => readAdminHome(db));
    expect(apHome.branches).toHaveLength(2);

    const mgrHome = await asRole("manager", (db) => readBranchSummary(db, b1), b1);
    expect(Object.keys(mgrHome).length).toBeGreaterThan(0);

    const fhHome = await asRole("facility_head", (db) => roleHome(db), b1);
    expect(fhHome.home).toBe("klinis");
    if (fhHome.home === "klinis") {
      expect(fhHome.complaints_open).toBeGreaterThanOrEqual(1);
      expect(fhHome.incidents_open).toBeGreaterThanOrEqual(1);
    }

    const roPatients = await asRole("records_officer", (db) => searchPatients(db, ""), b1);
    expect(roPatients.ok).toBe(true);
    if (roPatients.ok) expect(roPatients.rows.length).toBeGreaterThanOrEqual(20);
    const roQueue = await asRole("records_officer", (db) => examQueue(db, b1), b1);
    expect(roQueue.visits.length).toBeGreaterThan(0);

    const foToday = await asRole("fo_cashier", (db) => visitsToday(db, b1), b1);
    expect(foToday.visits.length).toBeGreaterThan(0);

    const csHome = await asRole("central_cs", (db) =>
      readCsSummary(db, { from: monthStart, to: dbToday, today: dbToday, label: "Bulan ini" }),
    );
    expect(csHome.newToday.state).toBe("value");
    if (csHome.newToday.state === "value") expect(csHome.newToday.n).toBeGreaterThanOrEqual(1);

    const bcAcc = byRole.get("bc")!;
    const bcHome = await asRole("bc", (db) => pasienkuIn(db, "bc", b1, bcAcc.staffId, bcAcc.displayName), b1);
    expect(bcHome.kind).toBe("ok");
    if (bcHome.kind === "ok") {
      expect(bcHome.props.state.kind).toBe("ready");
      if (bcHome.props.state.kind === "ready") {
        expect(bcHome.props.state.data.target.target?.state).toBe("value");
      }
    }

    const docQueue = await asRole("doctor", (db) => examQueue(db, b1), b1);
    expect(docQueue.visits.some((v) => !v.closed && v.intake_state === "sent")).toBe(true);

    const nurRooms = await asRole("nurse", (db) => roomList(db), b1);
    expect(nurRooms.visits.some((v) => !v.closed)).toBe(true);
    const nurTarget = await asRole("nurse", (db) => myTarget(db, monthKey), b1);
    expect(nurTarget.scorecard.commission_net).toBeGreaterThan(0);

    const thrRooms = await asRole("therapist", (db) => roomList(db), b1);
    expect(thrRooms.visits.some((v) => !v.closed)).toBe(true);
    const thrTarget = await asRole("therapist", (db) => myTarget(db, monthKey), b1);
    expect(thrTarget.scorecard.commission_net).toBeGreaterThan(0);

    const phHome = await asRole("pharmacist", (db) => roleHome(db), b1);
    expect(phHome.home).toBe("apotek");
    if (phHome.home === "apotek") {
      expect(phHome.to_prepare).toBeGreaterThanOrEqual(1);
      expect(phHome.po_received_today).toBeGreaterThanOrEqual(1);
      expect(phHome.near_expiry).toBeGreaterThanOrEqual(1);
    }

    const finHome = await asRole("finance", (db) => readFinanceSummary(db, { from: monthStart, to: dbToday }));
    expect(finHome.k1.methods.length).toBeGreaterThan(0);
    expect(finHome.k2.amount.state).toBe("value");
    if (finHome.k2.amount.state === "value") expect(finHome.k2.amount.rp).toBeGreaterThan(0);

    const mktHome = await asRole("marketing", (db) => roleHome(db));
    expect(mktHome.home).toBe("marketing");
    if (mktHome.home === "marketing") {
      expect(Object.values(mktHome.leads_by_stage).reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(5);
      expect(mktHome.surveys_this_month.count).toBeGreaterThanOrEqual(3);
      expect(mktHome.promo_this_month.length).toBeGreaterThanOrEqual(1);
    }

    const purHome = await asRole("purchasing", (db) => roleHome(db));
    expect(purHome.home).toBe("pembelian");
    if (purHome.home === "pembelian") {
      expect(purHome.po_open).toBeGreaterThanOrEqual(1);
      expect(purHome.payables_due.count).toBeGreaterThanOrEqual(1);
      expect(Object.keys(purHome.below_min_by_branch).length).toBeGreaterThanOrEqual(1);
    }

    const auHome = await asRole("auditor", (db) => roleHome(db));
    expect(auHome.home).toBe("audit");
    if (auHome.home === "audit") expect(auHome.stock_variance.counts).toBeGreaterThanOrEqual(1);

    const mgrB2 = await asRole("manager", (db) => readBranchSummary(db, b2), b2);
    expect(Object.keys(mgrB2).length).toBeGreaterThan(0);
  });

  it("satisfies the full M8 accounting reconciliation (sub-ledgers == GL per tenant & per branch net + gross, trial balance 0, inter-branch clearing 0)", async () => {
    const [b1, b2] = firstSummary.branches.map((b) => b.id);
    const tenantId = firstSummary.tenantId;
    const dbToday = (
      await h.admin.query<{ d: string }>(`select to_char(clock_timestamp() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as d`)
    ).rows[0].d;
    const monthStart = `${dbToday.slice(0, 7)}-01`;

    const finAcc = firstSummary.accounts.find((a) => a.role === "finance")!;
    const finCtx = await resolveContext(appPool, finAcc.accountId, { tenantId, actingRole: "finance" });
    const auAcc = firstSummary.accounts.find((a) => a.role === "auditor")!;
    const auCtx = await resolveContext(appPool, auAcc.accountId, { tenantId, actingRole: "auditor" });

    const unbalanced = (
      await h.admin.query(
        `select e.id from journal_entries e left join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
          where e.tenant_id = $1 group by e.id
         having coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0) or count(l.entry_id) < 2`,
        [tenantId],
      )
    ).rows;
    expect(unbalanced).toEqual([]);

    const rep = await withTenantContext(appPool, finCtx, (db) => report(db, { from: monthStart, to: dbToday }));
    expect(rep.balanced).toBe(true);
    expect(rep.trial_balance.reduce((s, r) => s + r.closing, 0)).toBe(0);
    expect(rep.trial_balance.length).toBeGreaterThan(0);

    const hx = await withTenantContext(appPool, auCtx, (db) => handoverExceptions(db, { from: monthStart, to: dbToday }));
    expect(hx.unlinked + hx.fractional).toBe(0);

    const recon = await withTenantContext(appPool, finCtx, (db) => readRecon(db, { from: monthStart, to: dbToday }));
    expect(recon.items).toEqual([]);

    const rf = await withTenantContext(appPool, finCtx, (db) => rollforward(db, { from: monthStart, to: dbToday }));
    const rfByBranch = new Map([
      [b1, await withTenantContext(appPool, finCtx, (db) => rollforward(db, { from: monthStart, to: dbToday, branchId: b1 }))],
      [b2, await withTenantContext(appPool, finCtx, (db) => rollforward(db, { from: monthStart, to: dbToday, branchId: b2 }))],
    ]);
    expect(rf.ledgers.inter_branch.closing).toBe(0);
    expect(rf.ledgers.cash_bank.closing - rf.ledgers.cash_bank.opening).toBeGreaterThan(0);
    expect(rf.ledgers.receivables.closing).toBeGreaterThan(0);

    const ledgerMovement = async (accounts: string[], side: "debit" | "credit", from: string, to: string, branch?: string) => {
      const r = await h.admin.query(
        `select coalesce(sum(case when $5 = 'debit' then l.debit - l.credit else l.credit - l.debit end), 0)::bigint s
           from journal_lines l join journal_entries e on e.id = l.entry_id join ledger_accounts a on a.id = l.account_id
          where a.tenant_id = $1 and a.key = any($2) and e.business_date between $3::date and $4::date and ($6::uuid is null or l.branch_id = $6)`,
        [tenantId, accounts, from, to, side, branch ?? null],
      );
      return safeInt(r.rows[0].s);
    };
    const ledgerSides = async (accounts: string[], from: string, to: string, branch?: string) => {
      const r = await h.admin.query(
        `select coalesce(sum(l.debit), 0)::bigint dr, coalesce(sum(l.credit), 0)::bigint cr
           from journal_lines l join journal_entries e on e.id = l.entry_id join ledger_accounts a on a.id = l.account_id
          where a.tenant_id = $1 and a.key = any($2) and e.business_date between $3::date and $4::date and ($5::uuid is null or l.branch_id = $5)`,
        [tenantId, accounts, from, to, branch ?? null],
      );
      return { dr: safeInt(r.rows[0].dr), cr: safeInt(r.rows[0].cr) };
    };

    const mismatches: string[] = [];
    for (const p of PAIRS) {
      const sub = rf.ledgers[p.sub];
      expect(sub.opening_complete && sub.closing_complete, `${p.sub} complete`).toBe(true);
      const gl = await ledgerMovement(p.accounts, p.side, monthStart, dbToday);
      if (sub.closing - sub.opening !== gl) mismatches.push(`${p.sub}: sub ${sub.closing - sub.opening} != gl ${gl}`);

      const terms = Object.values(sub.terms);
      const up = terms.filter((t) => t > 0).reduce((s, t) => s + t, 0);
      const down = -terms.filter((t) => t < 0).reduce((s, t) => s + t, 0);
      const g = await ledgerSides(p.accounts, monthStart, dbToday);
      const [gUp, gDown] = p.side === "debit" ? [g.dr, g.cr] : [g.cr, g.dr];
      if (up !== gUp || down !== gDown) mismatches.push(`${p.sub} gross: +${up}/-${down} != +${gUp}/-${gDown}`);

      for (const b of [b1, b2]) {
        const subB = sub.by_branch[b] ?? 0;
        const glB = await ledgerMovement(p.accounts, p.side, "2000-01-01", dbToday, b);
        if (subB !== glB) mismatches.push(`${p.sub}@${b}: sub ${subB} != gl ${glB}`);

        const branchSub = rfByBranch.get(b)!.ledgers[p.sub];
        const bTerms = Object.values(branchSub.terms);
        const bUp = bTerms.filter((t) => t > 0).reduce((s, t) => s + t, 0);
        const bDown = -bTerms.filter((t) => t < 0).reduce((s, t) => s + t, 0);
        const bg = await ledgerSides(p.accounts, monthStart, dbToday, b);
        const [bgUp, bgDown] = p.side === "debit" ? [bg.dr, bg.cr] : [bg.cr, bg.dr];
        if (bUp !== bgUp || bDown !== bgDown) {
          mismatches.push(`${p.sub}@${b} gross: +${bUp}/-${bDown} != +${bgUp}/-${bgDown}`);
        }
      }
    }
    expect(mismatches).toEqual([]);

    expect(await ledgerMovement(["inter_branch_clearing"], "debit", monthStart, dbToday)).toBe(0);
    expect(await ledgerMovement(["inter_branch_clearing"], "debit", monthStart, dbToday, b2)).toBeGreaterThan(0);
  });

  it("refuses a second seed run (idempotency)", async () => {
    await expect(assertNotSeeded(h.admin)).rejects.toThrow(DemoAlreadySeededError);
    await expect(seedStagingDemo(baseSeedOpts(join(tempDir, "staging-credentials-dup.json")))).rejects.toThrow(
      DemoAlreadySeededError,
    );
  });

  it("blocks runtime app reconnects during reset, resets cleanly without FORCE, and re-seeds with identical counts", async () => {
    const oldDbOid = (
      await h.admin.query<{ oid: string }>(`select oid::text as oid from pg_database where datname = current_database()`)
    ).rows[0].oid;

    // Keep probing connections as appLogin continuously DURING reset to prove CREATE DATABASE
    // WITH ALLOW_CONNECTIONS false + REVOKE PUBLIC prevents any runtime login to the recreated
    // database until migrations AND platform_environment = 'staging' verification complete!
    let resetFinished = false;
    let grantsOpen = false;
    let prematureNewDbConnections = 0;
    let refusedAttempts = 0;
    const probeLoop = (async () => {
      while (!resetFinished) {
        const c = testClient({ connectionString: h.urlAs(appLogin) });
        try {
          await c.connect();
          const oid = (
            await c.query<{ oid: string }>(`select oid::text as oid from pg_database where datname = current_database()`)
          ).rows[0].oid;
          if (oid !== oldDbOid && !grantsOpen) {
            prematureNewDbConnections++;
          }
        } catch {
          refusedAttempts++;
        } finally {
          await c.end().catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 15));
      }
    })();

    // Leave existing appPool open to also prove reset quiesces live app backends cleanly!
    const res = await resetStagingDatabase({
      databaseUrl: h.ownerUrl(),
      env: { DEPLOY_ENV: "staging" },
      grantConnectRoles: [appLogin, authLogin, vendorLogin],
      hooks: {
        beforeGrantConnect: () => {
          grantsOpen = true;
        },
      },
    });
    resetFinished = true;
    await probeLoop;

    expect(res.dbName).toBe(h.dbName);
    expect(refusedAttempts).toBeGreaterThan(0);
    expect(prematureNewDbConnections).toBe(0);

    await appPool.end().catch(() => {});

    const credsPath2 = join(tempDir, "staging-credentials-2.json");
    const secondSummary = await seedStagingDemo(baseSeedOpts(credsPath2));

    expect(secondSummary.counts).toEqual(firstSummary.counts);
    expect(secondSummary.tenantId).not.toBe(firstSummary.tenantId);

    const creds1 = JSON.parse(readFileSync(firstSummary.credentialsFile, "utf8")) as { accounts: { password: string }[] };
    const creds2 = JSON.parse(readFileSync(secondSummary.credentialsFile, "utf8")) as { accounts: { password: string }[] };
    expect(creds2.accounts).toHaveLength(18);
    expect(creds2.accounts[0].password).not.toBe(creds1.accounts[0].password);

    appPool = await openAppPool({ connectionString: h.urlAs(appLogin), max: 4 }, APP_GROUP_ROLE);
  }, 180_000);
});
