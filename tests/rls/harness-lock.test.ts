// HYG-006: the database DDL lock of the test harness. Every lock test uses its own advisory key
// (above 2^31, never the real one), so no other test file running at the same time can hold or
// queue on it; participants are matched by application_name, never by "any waiter".
import { randomInt, randomUUID } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import pg from "pg";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_DATABASE_URL, MIGRATION_LOCK_KEY } from "../../src/db/migrate";
import {
  createHarness,
  createTestDatabase,
  DDL_LOCK_KEY,
  dropTestDatabase,
  MIGRATE_LOCK_KEY,
  STALE_PATTERN,
  sweepStaleDatabases,
  withDatabaseDdlLock,
  testClient,
} from "./harness";

const adminUrl = process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL;
const used = new Set<bigint>([DDL_LOCK_KEY, BigInt(MIGRATION_LOCK_KEY)]);
const freshKey = () => {
  for (;;) {
    const k = BigInt("3000000000") + BigInt(randomInt(0, 2 ** 31));
    if (!used.has(k)) return used.add(k), k;
  }
};

const opened: pg.Client[] = [];
async function client(name: string): Promise<pg.Client> {
  const c = testClient({ connectionString: adminUrl, application_name: name });
  await c.connect();
  opened.push(c);
  return c;
}
let probe: pg.Client;
const created: string[] = [];
const dbName = (prefix = "hyg006lk") => {
  const n = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  created.push(n);
  return n;
};

beforeAll(async () => {
  probe = await client("hyg006:probe");
});
afterAll(async () => {
  for (const n of created) await probe.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`).catch(() => {}); // ddl-test-cleanup
  for (const c of opened) await c.end().catch(() => {});
});

type LockRow = { pid: number; app: string; mode: string; granted: boolean };
async function locks(key: bigint): Promise<LockRow[]> {
  const { rows } = await probe.query<LockRow>(
    `select l.pid, a.application_name as app, l.mode, l.granted
       from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.objsubid = 1
        and ((l.classid::bigint << 32) | l.objid::bigint) = $1`,
    [key.toString()],
  );
  return rows;
}
// Polls until `pred` holds; the bound only decides failure, never success.
async function until<T>(what: string, f: () => Promise<T>, pred: (v: T) => boolean): Promise<T> {
  const end = Date.now() + 10_000;
  for (;;) {
    const v = await f();
    if (pred(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const waiting = (key: bigint, app: string, mode: string) =>
  until(`${app} waiting ${mode}`, () => locks(key), (rows) => rows.some((r) => r.app === app && r.mode === mode && !r.granted));
const holderOf = (c: pg.Client) => c.query<{ pid: number }>("select pg_backend_pid() as pid").then((r) => r.rows[0].pid);
const backendGone = (pid: number) =>
  until(`backend ${pid} gone`, () => probe.query("select 1 from pg_stat_activity where pid = $1", [pid]).then((r) => r.rowCount), (n) => n === 0);
const exists = (n: string) => probe.query("select 1 from pg_database where datname = $1", [n]).then((r) => r.rowCount === 1);
const barrier = () => {
  let open!: () => void;
  let reached!: () => void;
  const atBarrier = new Promise<void>((r) => (reached = r));
  const released = new Promise<void>((r) => (open = r));
  return { hook: async () => { reached(); await released; }, atBarrier, open };
};

// Line numbers of database DDL in `text` outside comments, matched over the whole text so a
// statement split over lines is found (the structural test, 12). For TS/JS the comments are
// located by the TypeScript parser itself: a hand-written scanner cannot tell a regex literal
// from division (GPT review 2026-11-06), and a misread there could hide a real statement.
// String, template and regex contents stay visible, since SQL lives in strings. A file the
// parser reports as malformed fails the scan rather than being read partly. Shell files are
// matched as plain text (`sh: true`): a `#` comment mentioning DDL is reported, never hidden.
function ddlOutsideComments(text: string, opts: { sh?: boolean } = {}): string[] {
  let code = text;
  if (!opts.sh) {
    const sf = ts.createSourceFile("scan.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diagnostics = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
    if (diagnostics.length) throw new Error(`scan: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ")}`);
    const blank: [number, number][] = [];
    const visit = (node: ts.Node) => {
      for (const r of [...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? [])]) blank.push([r.pos, r.end]);
      node.getChildren(sf).forEach(visit);
    };
    visit(sf);
    // UTF-16 code units, the unit of the parser's offsets (not code points: GPT review r2).
    const chars = text.split("");
    for (const [a, b] of blank) for (let k = a; k < b; k++) if (chars[k] !== "\n") chars[k] = " ";
    code = chars.join("");
  }
  const at: string[] = [];
  for (const m of code.matchAll(/\b(create|drop)\s+database\b/gi)) at.push(String(code.slice(0, m.index).split("\n").length));
  return at;
}

describe("HYG-006 database DDL lock", () => {
  it("1. a held exclusive lock blocks createHarness's create; release lets it proceed", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const holder = await client("hyg006:holder");
    await holder.query("select pg_advisory_lock($1)", [key.toString()]);
    let h: Awaited<ReturnType<typeof createHarness>> | undefined;
    const p = createHarness({ ddlLockKey: key, stalePattern: "^hyg006_never$" }).then((x) => (h = x));
    const rows = await until("harness waiting", () => locks(key), (r) => r.some((x) => x.app.startsWith("harness:rls_") && x.mode === "ExclusiveLock" && !x.granted));
    expect(h).toBeUndefined();
    expect(await exists(rows.find((x) => x.app.startsWith("harness:"))!.app.slice("harness:".length))).toBe(false);
    await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
    await p;
    expect(await exists(h!.dbName)).toBe(true);
    await h!.close();
    expect(await exists(h!.dbName)).toBe(false);
  });

  it("2. a held exclusive lock blocks close()'s drop", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const h = await createHarness({ ddlLockKey: key, stalePattern: "^hyg006_never$" });
    const holder = await client("hyg006:holder");
    await holder.query("select pg_advisory_lock($1)", [key.toString()]);
    let closed = false;
    const p = h.close().then(() => (closed = true));
    await waiting(key, `harness:${h.dbName}`, "ShareLock");
    expect(closed).toBe(false);
    expect(await exists(h.dbName)).toBe(true);
    await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
    await p;
    expect(await exists(h.dbName)).toBe(false);
  });

  it("3. a drop takes the lock shared: it is granted beside a shared holder", { timeout: 60_000 }, async () => {
    const key = freshKey();
    const name = dbName();
    const setup = await client("hyg006:setup");
    await createTestDatabase(setup, name, { ddlLockKey: key });
    const holder = await client("hyg006:holder");
    await holder.query("select pg_advisory_lock_shared($1)", [key.toString()]);
    const me = await client("hyg006:drop3");
    const b = barrier();
    const p = dropTestDatabase(me, name, { ddlLockKey: key, afterAcquire: b.hook });
    // Either the drop reaches the barrier (granted) or its own row shows it waiting: one loop
    // decides on that observation, never on a timeout, and stops as soon as it has decided.
    let reached = false;
    void b.atBarrier.then(() => (reached = true));
    const outcome = await until(
      "drop granted or waiting",
      async () => (reached ? "granted" : (await locks(key)).some((x) => x.app === "hyg006:drop3" && !x.granted) ? "waiting" : null),
      (v) => v !== null,
    );
    const rows = await locks(key);
    if (outcome === "waiting") {
      await holder.query("select pg_advisory_unlock_shared($1)", [key.toString()]);
      b.open();
      await p.catch(() => {});
    }
    expect(outcome).toBe("granted");
    expect(rows.filter((r) => r.app === "hyg006:drop3")).toEqual([expect.objectContaining({ mode: "ShareLock", granted: true })]);
    b.open();
    await p;
    expect(await exists(name)).toBe(false);
    await holder.query("select pg_advisory_unlock_shared($1)", [key.toString()]);
  });

  it("4. the lock is not held while migrations run", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const b = barrier();
    const { runMigrations } = await import("../../src/db/migrate");
    const p = createHarness({
      ddlLockKey: key,
      stalePattern: "^hyg006_never$",
      migrate: async (url) => { await b.hook(); await runMigrations(url); },
    });
    await b.atBarrier;
    expect((await locks(key)).filter((r) => r.app.startsWith("harness:rls_"))).toEqual([]);
    const other = await client("hyg006:other4");
    const got = await other.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [key.toString()]);
    expect(got.rows[0].ok).toBe(true);
    await other.query("select pg_advisory_unlock($1)", [key.toString()]);
    b.open();
    const h = await p;
    await h.close();
  });

  it("5. a failing create releases the lock", async () => {
    const key = freshKey();
    const me = await client("hyg006:fail5");
    await expect(createTestDatabase(me, "bad name", { ddlLockKey: key })).rejects.toThrow();
    expect((await locks(key)).filter((r) => r.app === "hyg006:fail5")).toEqual([]);
    const other = await client("hyg006:other5");
    expect((await other.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [key.toString()])).rows[0].ok).toBe(true);
    await other.query("select pg_advisory_unlock($1)", [key.toString()]);
  });

  it("6. (PostgreSQL behaviour) a session ended without unlock releases its advisory lock", async () => {
    const key = freshKey();
    const a = await client("hyg006:a6");
    await a.query("select pg_advisory_lock($1)", [key.toString()]);
    const pid = await holderOf(a);
    await a.end();
    await backendGone(pid);
    const b = await client("hyg006:b6");
    expect((await b.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [key.toString()])).rows[0].ok).toBe(true);
    await b.query("select pg_advisory_unlock($1)", [key.toString()]);
  });

  it("7. a throw in createHarness after connect leaves no backend behind", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const boom = new Error("migration failed (test)");
    let name = "";
    await expect(
      createHarness({ ddlLockKey: key, stalePattern: "^hyg006_never$", migrate: async (url) => { name = new URL(url).pathname.slice(1); throw boom; } }),
    ).rejects.toBe(boom);
    await until("harness backend gone", () => probe.query("select 1 from pg_stat_activity where application_name = $1", [`harness:${name}`]).then((r) => r.rowCount), (n) => n === 0);
    expect(await exists(name)).toBe(false);
  });

  it("8a. the stale sweep's drop goes through the lock (shared)", { timeout: 60_000 }, async () => {
    const key = freshKey();
    const name = dbName("hyg006st");
    const setup = await client("hyg006:setup8");
    await createTestDatabase(setup, name, { ddlLockKey: key });
    const holder = await client("hyg006:holder8");
    await holder.query("select pg_advisory_lock($1)", [key.toString()]);
    const sweeper = await client("hyg006:sweep8");
    const p = sweepStaleDatabases(sweeper, { ddlLockKey: key, pattern: `^${name}$` });
    await waiting(key, "hyg006:sweep8", "ShareLock");
    expect(await exists(name)).toBe(true);
    await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
    await p;
    expect(await exists(name)).toBe(false);
  });

  it("8b. the drop after a failed migration goes through the lock (shared)", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const holder = await client("hyg006:holder8b");
    const b = barrier();
    let name = "";
    const p = createHarness({
      ddlLockKey: key,
      stalePattern: "^hyg006_never$",
      migrate: async (url) => {
        name = new URL(url).pathname.slice(1);
        await holder.query("select pg_advisory_lock($1)", [key.toString()]);
        await b.hook();
        throw new Error("migration failed (test)");
      },
    });
    const settled = p.catch((e: unknown) => e);
    await b.atBarrier;
    b.open();
    await waiting(key, `harness:${name}`, "ShareLock");
    expect(await exists(name)).toBe(true);
    await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
    expect(String(await settled)).toContain("migration failed (test)");
    expect(await exists(name)).toBe(false);
  });

  it("8c. a sweep whose drop fails reports the drop's error, not the per-database unlock's", { timeout: 60_000 }, async () => {
    const key = freshKey();
    const name = dbName("hyg006sc");
    const setup = await client("hyg006:setup8c");
    await createTestDatabase(setup, name, { ddlLockKey: key });
    const sweeper = await client("hyg006:sweep8c");
    // The DDL unlock fails, so the helper ends the sweeper's connection; the sweep's own
    // per-database unlock then fails on the ended client and must not replace that error.
    const run = async (sql: string, values?: unknown[]) => {
      if (sql.includes("unlock")) throw new Error("ddl unlock failed (test)");
      return sweeper.query(sql, values);
    };
    const thrown = await sweepStaleDatabases(sweeper, { ddlLockKey: key, pattern: `^${name}$`, run }).catch((e: unknown) => e);
    expect(String((thrown as Error).message)).toBe("ddl unlock failed (test)");
  });

  describe("9. unlock failure while the owning session is alive and holds the lock", () => {
    const failingUnlock = (c: pg.Client) => async (sql: string, values?: unknown[]) => {
      if (sql.includes("unlock")) throw new Error("unlock failed (test)");
      return c.query(sql, values);
    };
    it("a: fn throws, unlock fails: fn's error is thrown with the unlock error as cause; the session ends", async () => {
      const key = freshKey();
      const me = await client("hyg006:u9a");
      const pid = await holderOf(me);
      const boom = new Error("operation failed (test)");
      const thrown = await withDatabaseDdlLock(me, "exclusive", async () => { throw boom; }, { ddlLockKey: key, run: failingUnlock(me) }).catch((e: unknown) => e);
      expect(thrown).toBe(boom);
      expect(String((boom.cause as Error).message)).toBe("unlock failed (test)");
      await backendGone(pid);
      const other = await client("hyg006:o9a");
      expect((await other.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [key.toString()])).rows[0].ok).toBe(true);
      await other.query("select pg_advisory_unlock($1)", [key.toString()]);
    });
    it("a2: a frozen error from fn is still thrown as itself when unlock fails; an existing cause is kept", async () => {
      const key = freshKey();
      const me = await client("hyg006:u9a2");
      const pid = await holderOf(me);
      const frozen = Object.freeze(new Error("operation failed (frozen, test)"));
      const thrown = await withDatabaseDdlLock(me, "exclusive", async () => { throw frozen; }, { ddlLockKey: key, run: failingUnlock(me) }).catch((e: unknown) => e);
      expect(thrown).toBe(frozen);
      await backendGone(pid);
      const me2 = await client("hyg006:u9a3");
      const first = new Error("first cause (test)");
      const withCause = new Error("operation failed (with cause, test)", { cause: first });
      const thrown2 = await withDatabaseDdlLock(me2, "exclusive", async () => { throw withCause; }, { ddlLockKey: key, run: failingUnlock(me2) }).catch((e: unknown) => e);
      expect(thrown2).toBe(withCause);
      expect(withCause.cause).toBe(first);
    });
    it("b: fn succeeds, unlock fails: the unlock error is thrown; the session ends", async () => {
      const key = freshKey();
      const me = await client("hyg006:u9b");
      const pid = await holderOf(me);
      const thrown = await withDatabaseDdlLock(me, "shared", async () => "ran", { ddlLockKey: key, run: failingUnlock(me) }).catch((e: unknown) => e);
      expect(String((thrown as Error).message)).toBe("unlock failed (test)");
      await backendGone(pid);
      const other = await client("hyg006:o9b");
      expect((await other.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [key.toString()])).rows[0].ok).toBe(true);
      await other.query("select pg_advisory_unlock($1)", [key.toString()]);
    });
    it("broken connection: the backend is killed mid-statement; fn's error is thrown, not a cleanup error", async () => {
      const key = freshKey();
      const me = await client("hyg006:u9c");
      const pid = await holderOf(me);
      const killer = await client("hyg006:k9c");
      const thrown = await withDatabaseDdlLock(
        me,
        "exclusive",
        async () => {
          const q = me.query("select pg_sleep(30)");
          // The kill can reject q before it is awaited below (the client reads the FATAL while the
          // killer's query is still returning); a handler now keeps that from being an unhandled
          // rejection, and `await q` still throws it.
          q.catch(() => {});
          await until("sleep running", () => probe.query("select 1 from pg_stat_activity where pid = $1 and query like 'select pg_sleep%'", [pid]).then((r) => r.rowCount), (n) => n === 1);
          await killer.query("select pg_terminate_backend($1)", [pid]);
          await q;
        },
        { ddlLockKey: key },
      ).catch((e: unknown) => e);
      expect(String((thrown as Error).message)).toMatch(/terminat/i);
      await backendGone(pid);
    });
  });

  it("10. acquisition failure: neither fn nor unlock runs; the caller's connection stays open", async () => {
    const key = freshKey();
    const me = await client("hyg006:a10");
    const calls: string[] = [];
    let fnRan = false;
    const run = async (sql: string) => {
      calls.push(sql);
      throw new Error("lock failed (test)");
    };
    await expect(withDatabaseDdlLock(me, "exclusive", async () => { fnRan = true; }, { ddlLockKey: key, run })).rejects.toThrow("lock failed (test)");
    expect(fnRan).toBe(false);
    expect(calls).toEqual([expect.stringContaining("pg_advisory_lock(")]);
    expect((await me.query("select 1 as ok")).rows[0].ok).toBe(1);
  });

  it("11. a slow wait prints the holder's pid before the holder releases", { timeout: 60_000 }, async () => {
    const key = freshKey();
    const holder = await client("hyg006:holder11");
    await holder.query("select pg_advisory_lock($1)", [key.toString()]);
    const holderPid = await holderOf(holder);
    const lines: string[] = [];
    let seen!: () => void;
    const reported = new Promise<void>((r) => (seen = r));
    const orig = console.error;
    console.error = (...a: unknown[]) => {
      const s = a.map(String).join(" ");
      lines.push(s);
      // Any report line resolves the barrier, so a failed report fails at once on the
      // assertion below instead of at the test timeout.
      if (s.includes("DDL lock wait over")) seen();
    };
    const observerName = `hyg006:observer:${randomUUID().slice(0, 8)}`;
    let p: Promise<string> | undefined;
    let released = false;
    try {
      const me = await client("hyg006:w11");
      p = withDatabaseDdlLock(me, "exclusive", async () => "ok", { ddlLockKey: key, slowMs: 200, observerName });
      p.catch(() => {}); // observed below; never an unhandled rejection while waiting
      // The barrier: the holder releases only after the report is printed. It is bounded
      // (failure-only deadline, measured with performance.now) and raced against the
      // operation settling early, so a missing report or a failed acquisition fails at once.
      const t0 = performance.now();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        reported.then(() => "reported" as const),
        p.then(() => "settled" as const, () => "rejected" as const),
        new Promise<"deadline">((r) => (deadline = setTimeout(() => r("deadline"), 10_000))),
      ]).finally(() => clearTimeout(deadline));
      expect(outcome, `report barrier after ${Math.round(performance.now() - t0)} ms`).toBe("reported");
      expect(lines.find((l) => l.includes("DDL lock wait over"))).toContain(`pid ${holderPid}`);
      await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
      released = true;
      expect(await p).toBe("ok");
    } finally {
      if (!released) await holder.query("select pg_advisory_unlock($1)", [key.toString()]).catch(() => {});
      await p?.catch(() => {});
      console.error = orig;
    }
    expect(lines.some((l) => l.includes("DDL lock wait over 200 ms") && l.includes(`pid ${holderPid}`))).toBe(true);
    await until("this call's observer closed", () => probe.query("select count(*)::int n from pg_stat_activity where application_name = $1", [observerName]).then((r) => r.rows[0].n), (n) => n === 0);
  });

  it("11b. a stalled holder report never delays the operation, and its observer is ended when the lock settles", { timeout: 60_000 }, async () => {
    const key = freshKey();
    const holder = await client("hyg006:holder11b");
    await holder.query("select pg_advisory_lock($1)", [key.toString()]);
    const me = await client("hyg006:w11b");
    // A fake observer whose connect never settles until it is ended; it records the calls.
    let started!: () => void;
    const reportStarted = new Promise<void>((r) => (started = r));
    let ended = false;
    let release!: (e: Error) => void;
    const fake = {
      on: () => fake,
      connect: () => { started(); return new Promise<void>((_, reject) => (release = reject)); },
      query: () => Promise.reject(new Error("not connected")),
      end: async () => { ended = true; release?.(new Error("ended")); },
    } as unknown as pg.Client;
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      const p = withDatabaseDdlLock(me, "exclusive", async () => "ran", { ddlLockKey: key, slowMs: 50, observer: () => fake });
      await reportStarted; // the slow-wait timer fired and the report is stuck connecting
      expect(ended).toBe(false);
      await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
      // Settles although the observer's connect never would on its own: decided by observing
      // the operation, with a bound only for failure (a version that waited on the report
      // would never settle, because nothing else ends the fake observer).
      const settled = await until("operation settled", async () => Promise.race([p.then(() => true), new Promise<boolean>((r) => setImmediate(() => r(false)))]), (v) => v);
      expect(settled).toBe(true);
      expect(await p).toBe("ran");
      expect(ended).toBe(true);
      await new Promise((r) => setImmediate(r));
    } finally {
      console.error = orig;
    }
    // No report line after the lock settled.
    expect(lines.filter((l) => l.includes("DDL lock wait over 50 ms"))).toEqual([]);
  });

  it("12. every database create and drop under tests/ goes through the two wrappers (structural)", () => {
    const root = new URL("../../", import.meta.url).pathname;
    const files = globSync("tests/**/*.{ts,mts,js,mjs,sh}", { cwd: root });
    const exempt = new Map([
      // This file: its patterns, and the afterAll safety net for databases a failing test left.
      ["tests/rls/harness-lock.test.ts", "the structural test itself and its cleanup safety net"],
      // A shell script cannot call the wrappers; it uses the `postgres` admin database (CI
      // ADMIN_URL), which the lock would not cover anyway, and CI runs it after `pnpm test`.
      ["tests/platform/image-migrate.sh", "runs after pnpm test in CI, on a different admin database"],
    ]);
    expect(files.length).toBeGreaterThan(40);
    const offenders: string[] = [];
    for (const f of files) {
      if (exempt.has(f)) continue;
      const text = readFileSync(root + f, "utf8");
      const outside = f === "tests/rls/harness.ts" ? text.replace(/\/\/ ddl-wrapper:begin[\s\S]*?\/\/ ddl-wrapper:end/, "") : text;
      offenders.push(...ddlOutsideComments(outside, { sh: f.endsWith(".sh") }).map((at) => `${f}:${at}`));
    }
    expect(offenders).toEqual([]);
    // The scan sees statements split over lines and ignores comments.
    expect(ddlOutsideComments("await server.query(`CREATE\n  DATABASE ${name}`);")).toEqual(["1"]);
    expect(ddlOutsideComments("x;\n// a DROP DATABASE in a comment\n/* create\n database */ y;")).toEqual([]);
    // A comment marker inside a string does not hide code after it.
    expect(ddlOutsideComments('const g = "src/**/*.ts";\nawait q(`DROP DATABASE x`);')).toEqual(["2"]);
    expect(ddlOutsideComments('const u = "a//b"; await q(`CREATE DATABASE x`);')).toEqual(["1"]);
    // A quote inside a regex literal does not open a string (tests/platform/hosts.spec.ts has one).
    expect(ddlOutsideComments('expect(b).not.toMatch(/<[a-z][^>]*\\sstyle="/);\nconst u = "https://x"; await q(`DROP DATABASE x`);')).toEqual(["2"]);
    // Division is not a regex.
    expect(ddlOutsideComments('const r = a / b; const s = c / d; // CREATE DATABASE in a comment')).toEqual([]);
    // GPT review 2026-11-06: a regex after `)` must not hide a later statement, and division
    // after `++` must not turn a comment into code.
    expect(ddlOutsideComments('if (ok) /"/.test("https://x"); await q(`CREATE DATABASE x`);')).toEqual(["1"]);
    expect(ddlOutsideComments("let x = 1; const n = x++ / 2; // CREATE DATABASE example")).toEqual([]);
    // A malformed file fails the scan instead of being read partly.
    expect(() => ddlOutsideComments("const s = `unterminated")).toThrow(/scan:/);
    // Characters outside the BMP before a comment do not shift the blanked range (GPT review r2).
    expect(ddlOutsideComments('const s = "😀😀"; await q(/* ignored */`CREATE DATABASE x`);')).toEqual(["1"]);
    expect(ddlOutsideComments('const s = "😀😀"; /* CREATE DATABASE in a comment */ f();')).toEqual([]);
    const harness = readFileSync(root + "tests/rls/harness.ts", "utf8");
    const wrappers = harness.match(/\/\/ ddl-wrapper:begin([\s\S]*?)\/\/ ddl-wrapper:end/)![1];
    expect(wrappers).toMatch(/createTestDatabase[\s\S]*?withDatabaseDdlLock\(server, "exclusive"[\s\S]*?CREATE DATABASE/);
    expect(wrappers).toMatch(/dropTestDatabase[\s\S]*?withDatabaseDdlLock\(server, "shared"[\s\S]*?DROP DATABASE/);
    // The test-only key is passed only by this file, and the default is the real key.
    const keyUsers = files.filter((f) => f !== "tests/rls/harness.ts" && f !== "tests/rls/harness-lock.test.ts" && /ddlLockKey/.test(readFileSync(root + f, "utf8")));
    expect(keyUsers).toEqual([]);
    expect(harness).toMatch(/const key = opts\.ddlLockKey \?\? DDL_LOCK_KEY;/);
    expect(DDL_LOCK_KEY > BigInt(2 ** 31) && DDL_LOCK_KEY !== BigInt(MIGRATION_LOCK_KEY)).toBe(true);
  });

  it("13. CREATE takes the lock exclusively: it waits for a shared holder (direct and through createHarness)", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const holder = await client("hyg006:holder13");
    await holder.query("select pg_advisory_lock_shared($1)", [key.toString()]);
    const me = await client("hyg006:c13");
    const name = dbName();
    const direct = createTestDatabase(me, name, { ddlLockKey: key });
    await waiting(key, "hyg006:c13", "ExclusiveLock");
    let h: Awaited<ReturnType<typeof createHarness>> | undefined;
    const viaHarness = createHarness({ ddlLockKey: key, stalePattern: "^hyg006_never$" }).then((x) => (h = x));
    await until("harness create waiting", () => locks(key), (r) => r.some((x) => x.app.startsWith("harness:rls_") && x.mode === "ExclusiveLock" && !x.granted));
    expect(await exists(name)).toBe(false);
    await holder.query("select pg_advisory_unlock_shared($1)", [key.toString()]);
    await direct;
    await viaHarness;
    expect(await exists(name)).toBe(true);
    await h!.close();
  });

  it("14. slow setup and slow close name the DDL-lock wait (lock_wait)", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const holder = await client("hyg006:holder14");
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      // Setup: the create waits behind a held exclusive lock past the (shortened) threshold.
      await holder.query("select pg_advisory_lock($1)", [key.toString()]);
      const p = createHarness({ ddlLockKey: key, stalePattern: "^hyg006_never$", slowMs: 200, observerName: "hyg006:obs14" });
      await until("harness create waiting", () => locks(key), (r) => r.some((x) => x.app.startsWith("harness:rls_") && x.mode === "ExclusiveLock" && !x.granted));
      await until("report printed", async () => lines.join("\n"), (t) => t.includes("DDL lock wait over 200 ms"));
      await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
      const h = await p;
      expect(lines.some((l) => l.includes(`slow setup of ${h.dbName}`) && /lock_wait [1-9]\d*/.test(l))).toBe(true);
      // Close: the drop waits behind the held lock past the threshold.
      await holder.query("select pg_advisory_lock($1)", [key.toString()]);
      const closing = h.close();
      await waiting(key, `harness:${h.dbName}`, "ShareLock");
      await until("drop report printed", async () => lines.filter((l) => l.includes("shared DDL lock wait over 200 ms")).length, (n) => n >= 1);
      await holder.query("select pg_advisory_unlock($1)", [key.toString()]);
      await closing;
      expect(lines.some((l) => l.includes(`slow close of ${h.dbName}`) && /lock_wait [1-9]\d*/.test(l))).toBe(true);
    } finally {
      console.error = orig;
    }
  });

  it("15. (T-060) harness migrations run one at a time; the key is released after a failed migration", { timeout: 120_000 }, async () => {
    const key = freshKey();
    const mkey = freshKey();
    const b = barrier();
    let firstName = "";
    const first = createHarness({
      ddlLockKey: key, migrateLockKey: mkey, stalePattern: "^hyg006_never$",
      migrate: async (url) => { firstName = new URL(url).pathname.slice(1); await b.hook(); throw new Error("migration failed (test)"); },
    }).catch((e: unknown) => e);
    await b.atBarrier;
    let second: Awaited<ReturnType<typeof createHarness>> | undefined;
    const p2 = createHarness({ ddlLockKey: key, migrateLockKey: mkey, stalePattern: "^hyg006_never$" }).then((x) => (second = x));
    await until("second harness waits for the migrate key", () => locks(mkey), (r) => r.some((x) => x.app.startsWith("harness:rls_") && x.app !== `harness:${firstName}` && !x.granted));
    expect(second).toBeUndefined();
    // The waiter holds no DDL key while it waits.
    expect((await locks(key)).filter((r) => r.granted)).toEqual([]);
    b.open();
    expect(String((await first as Error).message)).toBe("migration failed (test)");
    await p2;
    expect((await locks(mkey)).filter((r) => r.granted)).toEqual([]);
    await second!.close();
    expect(MIGRATE_LOCK_KEY).not.toBe(DDL_LOCK_KEY);
    expect(MIGRATE_LOCK_KEY.toString()).not.toBe(String(MIGRATION_LOCK_KEY));
  });

  it("the stale pattern the harness sweeps is unchanged", () => {
    expect(STALE_PATTERN).toBe("^rls_[0-9a-f]{12}$");
  });
});
