// T-009 Done-when: same key + same body returns the stored result; same key + different
// body -> ERR_IDEMPOTENCY_CONFLICT (TD-51); concurrent duplicates execute once.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { canonicalJson, CommandError, fingerprint, runCommand } from "../../src/lib/command";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;

type Actor = { acc: string; staffId: string; tenantId: string };

async function tenant(): Promise<string> {
  const id = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [id]);
  return id;
}

async function actor(tenantId: string, role: Role = "owner"): Promise<Actor> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ($1, $2) returning id`, [`A${++n}`, `i${n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `A${n}` });
  await assignRole(h.admin, { tenantId, staffId, role });
  return { acc, staffId, tenantId };
}

const as = async <T>(a: Actor, fn: (db: pg.PoolClient) => Promise<T>) =>
  withTenantContext(app, await resolveContext(app, a.acc, { tenantId: a.tenantId, actingRole: "owner" }), fn);

// The command under test writes one audit row per execution, so executions are countable.
const executions = async (t: string, reason: string) =>
  (await h.admin.query(`select count(*)::int as n from audit_events where tenant_id = $1 and reason_code = $2`, [t, reason])).rows[0].n as number;

const exec = (reason: string, result: pg.QueryResultRow = { ok: true }) => async (db: pg.ClientBase) => {
  await db.query(`select audit_append('money_correction', 'invoice', null, 'success', $1)`, [reason]);
  return result as { ok: boolean };
};

let seq = 0;
// Keys double as the audit reason code that marks an execution, so keep them [a-z_].
const key = () => `k_${"abcdefghij".split("").map(() => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}_${String.fromCharCode(97 + (seq++ % 26))}`;

let tA: string;
let tB: string;
let a1: Actor;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  tA = await tenant();
  tB = await tenant();
  a1 = await actor(tA);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("fingerprint", () => {
  it("is independent of key order and ignores undefined; arrays keep their order", () => {
    expect(fingerprint("pay.record", { a: 1, b: { y: 2, x: [1, 2] } })).toBe(
      fingerprint("pay.record", { b: { x: [1, 2], y: 2 }, a: 1, c: undefined }),
    );
    expect(fingerprint("pay.record", { x: [1, 2] })).not.toBe(fingerprint("pay.record", { x: [2, 1] }));
    expect(fingerprint("pay.record", { a: 1 })).not.toBe(fingerprint("pay.refund", { a: 1 }));
  });

  it("refuses values that do not round-trip (NaN, Infinity, bigint, Date, class instances)", () => {
    for (const bad of [NaN, Infinity, BigInt(10), new Date(0), new Map(), 2 ** 53, [, 1]]) {
      expect(() => canonicalJson({ v: bad })).toThrow(TypeError);
    }
  });
});

describe("runCommand", () => {
  it("same key + same body returns the stored result without running again", async () => {
    const k = key();
    const body = { invoiceId: "inv-1", amount: 150_000 };
    const first = await as(a1, (db) => runCommand(db, { command: "payment.record", key: k, body }, exec(k, { paymentId: "p-1" })));
    const again = await as(a1, (db) =>
      runCommand(db, { command: "payment.record", key: k, body: { amount: 150_000, invoiceId: "inv-1" } }, exec(k, { paymentId: "p-2" })),
    );
    expect(first).toEqual({ ok: true, result: { paymentId: "p-1" }, replayed: false });
    expect(again).toEqual({ ok: true, result: { paymentId: "p-1" }, replayed: true });
    expect(await executions(tA, k)).toBe(1);
  });

  it("same key + different body is refused with ERR_IDEMPOTENCY_CONFLICT (409) and does not run", async () => {
    const k = key();
    await as(a1, (db) => runCommand(db, { command: "payment.record", key: k, body: { amount: 100 } }, exec(k)));
    const err = await as(a1, (db) => runCommand(db, { command: "payment.record", key: k, body: { amount: 101 } }, exec(k))).catch((e) => e);
    expect(err).toBeInstanceOf(CommandError);
    expect(err).toMatchObject({ code: "ERR_IDEMPOTENCY_CONFLICT", http: 409 });
    expect(await executions(tA, k)).toBe(1);
  });

  it("concurrent duplicates execute once; both callers get the same result", async () => {
    const k = key();
    const slow = async (db: pg.ClientBase) => {
      await db.query(`select pg_sleep(0.4)`);
      return exec(k, { stockMoveId: "m-1" })(db);
    };
    const results = await Promise.all(
      [0, 1, 2].map(() => as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 2 } }, slow))),
    );
    expect(results.map((r) => r.ok && r.result)).toEqual([{ stockMoveId: "m-1" }, { stockMoveId: "m-1" }, { stockMoveId: "m-1" }]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await executions(tA, k)).toBe(1);
  });

  it("a domain refusal is stored: its writes roll back and a retry gets the same refusal without running", async () => {
    const k = key();
    const refuse = async (db: pg.ClientBase) => {
      await exec(k)(db);
      throw new CommandError("ERR_STOCK_INSUFFICIENT");
    };
    const first = await as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 9 } }, refuse));
    expect(first).toMatchObject({ ok: false, replayed: false, error: { code: "ERR_STOCK_INSUFFICIENT", http: 422 } });
    expect(await executions(tA, k)).toBe(0);
    const retry = await as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 9 } }, exec(k)));
    expect(retry).toMatchObject({ ok: false, replayed: true, error: { code: "ERR_STOCK_INSUFFICIENT" } });
    expect(await executions(tA, k)).toBe(0);
  });

  it("an unexpected error leaves no record, so the retry runs", async () => {
    const k = key();
    await expect(
      as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 1 } }, async () => {
        throw new Error("connection reset");
      })),
    ).rejects.toThrow("connection reset");
    const retry = await as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 1 } }, exec(k)));
    expect(retry.replayed).toBe(false);
    expect(await executions(tA, k)).toBe(1);
  });

  it("a caller that catches an unexpected error and commits leaves no claim and no partial writes", async () => {
    const k = key();
    await as(a1, async (db) => {
      const err = await runCommand(db, { command: "stock.deduct", key: k, body: { qty: 1 } }, async (d) => {
        await exec(k)(d);
        throw new Error("bug after a write");
      }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
    });
    expect(await executions(tA, k)).toBe(0);
    expect((await h.admin.query(`select 1 from idempotency_records where key = $1`, [k])).rows).toHaveLength(0);
    const retry = await as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 1 } }, exec(k)));
    expect(retry).toMatchObject({ ok: true, replayed: false });
  });

  it.each(["ERR_VERSION_CONFLICT", "ERR_RATE_LIMITED"] as const)("%s is retryable: not stored, and the retry runs", async (code) => {
    const k = key();
    const err = await as(a1, (db) => runCommand(db, { command: "invoice.edit", key: k, body: {} }, async (d) => {
      await exec(k)(d);
      throw new CommandError(code);
    })).catch((e) => e);
    expect(err).toMatchObject({ code });
    expect((await h.admin.query(`select 1 from idempotency_records where key = $1`, [k])).rows).toHaveLength(0);
    const retry = await as(a1, (db) => runCommand(db, { command: "invoice.edit", key: k, body: {} }, exec(k)));
    expect(retry).toMatchObject({ ok: true, replayed: false });
    expect(await executions(tA, k)).toBe(1);
  });

  it("a waiter whose first duplicate rolled back runs the command itself", async () => {
    const k = key();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = as(a1, async (db) => {
      await runCommand(db, { command: "stock.deduct", key: k, body: { qty: 3 } }, async (d) => {
        await exec(k)(d);
        await gate;
        return { ok: true };
      });
      throw new Error("caller rolls back");
    }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 150));
    const second = as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 3 } }, exec(k)));
    await new Promise((r) => setTimeout(r, 150));
    release();
    expect(await first).toBeInstanceOf(Error);
    expect(await second).toMatchObject({ ok: true, replayed: false });
    expect(await executions(tA, k)).toBe(1);
  });

  it("a concurrent duplicate with a different body gets a conflict", async () => {
    const k = key();
    const slow = async (db: pg.ClientBase) => {
      await db.query(`select pg_sleep(0.3)`);
      return exec(k)(db);
    };
    const [x, y] = await Promise.allSettled([
      as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 1 } }, slow)),
      new Promise((r) => setTimeout(r, 80)).then(() => as(a1, (db) => runCommand(db, { command: "stock.deduct", key: k, body: { qty: 2 } }, slow))),
    ]);
    expect(x).toMatchObject({ status: "fulfilled" });
    expect(y).toMatchObject({ status: "rejected", reason: { code: "ERR_IDEMPOTENCY_CONFLICT" } });
    expect(await executions(tA, k)).toBe(1);
  });

  it("the same key inside one transaction is a conflict, not a replay of uncommitted work", async () => {
    const k = key();
    const err = await as(a1, async (db) => {
      await runCommand(db, { command: "session.redeem", key: k, body: {} }, async () => {
        await runCommand(db, { command: "session.redeem", key: k, body: {} }, exec(k));
        return null;
      });
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "ERR_IDEMPOTENCY_CONFLICT" });
  });

  it("another staff member's key is a conflict and never replays their result", async () => {
    const k = key();
    await as(a1, (db) => runCommand(db, { command: "payment.record", key: k, body: { a: 1 } }, exec(k, { secret: "p-own" })));
    const other = await actor(tA);
    const err = await as(other, (db) => runCommand(db, { command: "payment.record", key: k, body: { a: 1 } }, exec(k))).catch((e) => e);
    expect(err).toMatchObject({ code: "ERR_IDEMPOTENCY_CONFLICT" });
    expect(JSON.stringify(err)).not.toContain("p-own");
    const seen = await as(other, (db) => db.query(`select * from idempotency_records`));
    expect(seen.rows).toEqual([]);
  });

  it("tenants are separate namespaces: tenant B never sees or replays tenant A's record", async () => {
    const k = key();
    await as(a1, (db) => runCommand(db, { command: "payment.record", key: k, body: { a: 1 } }, exec(k, { from: "tenant-a" })));
    const b = await actor(tB);
    const r = await as(b, (db) => runCommand(db, { command: "payment.record", key: k, body: { a: 1 } }, exec(k, { from: "tenant-b" })));
    expect(r).toEqual({ ok: true, result: { from: "tenant-b" }, replayed: false });
    const seen = await as(b, (db) => db.query(`select result from idempotency_records where key = $1`, [k]));
    expect(seen.rows).toEqual([{ result: { from: "tenant-b" } }]);
  });

  it("clinic_app cannot rewrite, reopen or delete a record, or insert one for someone else", async () => {
    const k = key();
    await as(a1, (db) => runCommand(db, { command: "payment.record", key: k, body: { a: 1 } }, exec(k)));
    const other = await actor(tA);
    for (const sql of [
      `update idempotency_records set fingerprint = repeat('0', 64) where key = '${k}'`,
      `delete from idempotency_records where key = '${k}'`,
      `insert into idempotency_records (command, key, fingerprint, staff_id) values ('payment.record', 'k-forged-0001', repeat('a', 64), '${other.staffId}')`,
      `insert into idempotency_records (tenant_id, command, key, fingerprint) values ('${tB}', 'payment.record', 'k-forged-0002', repeat('a', 64))`,
      `insert into idempotency_records (command, key, fingerprint, status, result, completed_at) values ('payment.record', 'k-forged-0003', repeat('a', 64), 'succeeded', '{"ok":true}', now())`,
    ]) {
      await expect(as(a1, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
    // A completed record cannot be completed again (no row passes the in_progress USING).
    const upd = await as(a1, (db) => db.query(`update idempotency_records set result = '{"x":1}' where key = $1`, [k]));
    expect(upd.rowCount).toBe(0);
    const { rows } = await h.admin.query(`select result from idempotency_records where key = $1`, [k]);
    expect(rows).toEqual([{ result: { ok: true } }]);
  });

  it("rejects malformed keys, commands and error codes", async () => {
    await expect(as(a1, (db) => runCommand(db, { command: "payment.record", key: "short", body: {} }, exec("x")))).rejects.toMatchObject({ code: "23514" });
    await expect(as(a1, (db) => runCommand(db, { command: "Bad Command", key: key(), body: {} }, exec("x")))).rejects.toMatchObject({ code: "23514" });
    expect(() => new CommandError("ERR_bad" as `ERR_${string}`)).toThrow(TypeError);
    const big = await as(a1, (db) =>
      runCommand(db, { command: "payment.record", key: key(), body: {} }, async () => ({ blob: "x".repeat(9_000) })),
    ).catch((e) => e);
    expect(big).toMatchObject({ code: "23514" });
  });
});
