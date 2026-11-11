// T-010 Done-when: an event is written in the same transaction as its fact (rollback
// leaves none); two workers never process one event; a consumer applies an event once
// (event_receipts). TEN-5: claims return ids only; the consumer binds the row's tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { claim, consume, type DomainEvent, emit, type EventPayload } from "../../src/modules/events/events";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { runOutboxBatch } from "../../src/workers/outbox";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; branchId: string; acc: string; staffId: string };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [tenantId]);
  const branchId = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'CAB', 'Cabang', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('K', $1) returning id`, [`e${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: "Kasir" });
  await assignRole(h.admin, { tenantId, staffId, role: "owner" });
  return { tenantId, branchId, acc, staffId };
}

const as = async <R>(t: T, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, t.acc, { tenantId: t.tenantId, actingRole: "owner", activeBranchId: t.branchId }), fn);

const uuid = () => crypto.randomUUID();
const fact = (db: pg.ClientBase, reason: string) =>
  db.query(`select audit_append('money_correction', 'invoice', null, 'success', $1)`, [reason]);

let A: T;
let B: T;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  // Consumers register through their task's migration; tests register their own.
  await h.admin.query(
    `insert into event_consumers (name, event_types, max_attempts) values
       ('test.ids', '{*}', 10), ('test.race', '{StockConsumed}', 10), ('test.bind', '{PaymentReceived}', 10),
       ('test.once', '{SessionRedeemed}', 10), ('test.other', '{*}', 10), ('test.expired', '{TreatmentFinished}', 10),
       ('test.retry', '{InvoiceIssued}', 2), ('test.batch', '{StockIssued}', 10), ('test.direct', '{VisitCheckedIn}', 10),
       ('test.stress', '{ShiftClosed}', 10)`,
  );
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

const eventsOf = async (t: T, aggregateId: string) =>
  (await h.admin.query(`select * from domain_events where tenant_id = $1 and aggregate_id = $2`, [t.tenantId, aggregateId])).rows;

describe("emit in the fact's transaction", () => {
  it("commits with the fact, attributed from the bound context", async () => {
    const inv = uuid();
    await as(A, async (db) => {
      await fact(db, "fact_commit");
      await emit(db, { type: "PaymentReceived", aggregateKind: "invoice", aggregateId: inv, branchId: A.branchId, payload: { method: "qris", invoice_id: inv } });
    });
    const rows = await eventsOf(A, inv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: A.tenantId, branch_id: A.branchId, staff_id: A.staffId, acting_role: "owner", type: "PaymentReceived" });
  });

  it("a rolled-back fact leaves no event", async () => {
    const inv = uuid();
    await expect(
      as(A, async (db) => {
        await fact(db, "fact_rollback");
        await emit(db, { type: "PaymentReceived", aggregateKind: "invoice", aggregateId: inv });
        throw new Error("fact failed after emit");
      }),
    ).rejects.toThrow("fact failed after emit");
    expect(await eventsOf(A, inv)).toHaveLength(0);
    expect((await h.admin.query(`select 1 from audit_events where reason_code = 'fact_rollback'`)).rows).toHaveLength(0);
  });

  it("payload carries IDs and codes only (TD-50): amounts, names and free text are refused", async () => {
    for (const payload of [
      { amount: 150000 }, { name: "Ibu Sari" }, { phone: "+628123" }, { note: "alergi penisilin" }, { x: null }, { nested: { amount: 1 } },
      { ids: [1] }, { x: [null] }, { x: [["Ibu Sari"]] }, { "Ibu Sari": true }, { "alergi penisilin": true }, { a: { "Nama Pasien": "x" } },
    ] as EventPayload[]) {
      const r = await as(A, (db) => emit(db, { type: "PaymentReceived", aggregateKind: "invoice", aggregateId: uuid(), payload })).then(
        () => "accepted",
        (e) => e.code,
      );
      expect(r, JSON.stringify(payload)).toBe("23514");
    }
    await expect(
      as(A, (db) => emit(db, { type: "PaymentReceived", aggregateKind: "invoice", aggregateId: uuid(), payload: { ids: [uuid()], ok: true, method: "edc" } })),
    ).resolves.toBeTypeOf("string");
  });

  it("a producer cannot write another tenant's event, forge attribution, or use a branch outside scope", async () => {
    const ctx = await resolveContext(app, A.acc, { tenantId: A.tenantId, actingRole: "owner" });
    for (const sql of [
      `insert into domain_events (tenant_id, type, aggregate_kind, aggregate_id) values ('${B.tenantId}', 'PaymentReceived', 'invoice', '${uuid()}')`,
      `insert into domain_events (type, aggregate_kind, aggregate_id, staff_id) values ('PaymentReceived', 'invoice', '${uuid()}', '${B.staffId}')`,
      `insert into domain_events (type, aggregate_kind, aggregate_id, acting_role) values ('PaymentReceived', 'invoice', '${uuid()}', 'auditor')`,
    ]) {
      await expect(withTenantContext(app, ctx, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      withTenantContext(app, ctx, (db) => db.query(`insert into domain_events (type, aggregate_kind, aggregate_id, branch_id) values ('PaymentReceived', 'invoice', $1, $2)`, [uuid(), B.branchId])),
    ).rejects.toThrow(); // branch of another tenant: FK (tenant_id, branch_id) refuses it
  });

  it("events are append-only and staff sessions cannot read the event stream", async () => {
    await expect(h.admin.query(`update domain_events set type = 'X'`)).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`delete from domain_events`)).rejects.toMatchObject({ code: "42501" });
    const seen = await as(A, (db) => db.query(`select count(*)::int as n from domain_events`));
    expect(seen.rows[0].n).toBe(0);
  });
});

describe("workers and consumers (TEN-5)", () => {
  it("only an unbound worker connection may claim, and only for a registered consumer", async () => {
    const staffCtx = await resolveContext(app, A.acc, { tenantId: A.tenantId, actingRole: "owner" });
    await expect(withTenantContext(app, staffCtx, (db) => db.query(`select * from events_claim('test.ids', 'x', 5, 60)`))).rejects.toMatchObject({ code: "42501" });
    const svc = { tenantId: A.tenantId, allowedBranchIds: "*" as const, roles: [] };
    await expect(withTenantContext(app, svc, (db) => db.query(`select * from events_claim('test.ids', 'x', 5, 60)`))).rejects.toMatchObject({ code: "42501" });
    await expect(claim(app, { consumer: "not.registered", worker: "w1" })).rejects.toMatchObject({ code: "22023" });
  });

  it("an event opens one receipt per subscribed consumer, in its own transaction", async () => {
    const id = await as(A, (db) => emit(db, { type: "StockConsumed", aggregateKind: "stock_move", aggregateId: uuid() }));
    const { rows } = await h.admin.query(`select consumer from event_receipts where event_id = $1 order by consumer`, [id]);
    expect(rows.map((r) => r.consumer)).toEqual(["test.ids", "test.other", "test.race"]);
  });

  it("a claim returns ids only, across tenants", async () => {
    const [ea, eb] = [uuid(), uuid()];
    await as(A, (db) => emit(db, { type: "VisitClosed", aggregateKind: "visit", aggregateId: ea, branchId: A.branchId }));
    await as(B, (db) => emit(db, { type: "VisitClosed", aggregateKind: "visit", aggregateId: eb, branchId: B.branchId }));
    const claims = await claim(app, { consumer: "test.ids", worker: "w1", limit: 500 });
    expect(Object.keys(claims[0]).sort()).toEqual(["branchId", "eventId", "tenantId"]);
    expect(new Set(claims.map((c) => c.tenantId))).toEqual(new Set([A.tenantId, B.tenantId]));
  });

  it("two workers never process one event", async () => {
    for (let i = 0; i < 40; i++) await as(A, (db) => emit(db, { type: "StockConsumed", aggregateKind: "stock_move", aggregateId: uuid() }));
    const [w1, w2, w3] = await Promise.all(
      ["w1", "w2", "w3"].map((worker) => claim(app, { consumer: "test.race", worker, limit: 500, leaseSeconds: 60 })),
    );
    const all = [...w1, ...w2, ...w3].map((c) => c.eventId);
    expect(new Set(all).size).toBe(all.length);
    // A second claim while the leases are live returns nothing already held.
    expect((await claim(app, { consumer: "test.race", worker: "w4", limit: 500 })).filter((c) => all.includes(c.eventId))).toEqual([]);
  });

  it("a claim never waits for rows another claim holds (SKIP LOCKED)", async () => {
    const id = await as(A, (db) => emit(db, { type: "StockConsumed", aggregateKind: "stock_move", aggregateId: uuid() }));
    const holder = await owner.connect();
    try {
      // Another worker's claim transaction holds the receipt row lock (not yet committed).
      await holder.query("begin");
      await holder.query(`select 1 from event_receipts where consumer = 'test.race' and event_id = $1 for update`, [id]);
      const started = Date.now();
      const got = await Promise.race([
        claim(app, { consumer: "test.race", worker: "w9", limit: 500 }),
        new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 2000)),
      ]);
      expect(got).not.toBe("blocked");
      expect((got as { eventId: string }[]).map((c) => c.eventId)).not.toContain(id);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });

  it("four workers draining 200 events apply each exactly once", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add(await as(A, (db) => emit(db, { type: "ShiftClosed", aggregateKind: "cash_shift", aggregateId: uuid() })));
    const applied = new Map<string, number>();
    const handle = async (db: pg.PoolClient, e: DomainEvent) => {
      await db.query(`select pg_sleep(0.002)`);
      applied.set(e.id, (applied.get(e.id) ?? 0) + 1);
    };
    await Promise.all(
      ["w1", "w2", "w3", "w4"].map(async (worker) => {
        for (;;) {
          const [r] = await runOutboxBatch(app, [{ name: "test.stress", handle }], { worker, limit: 5, leaseSeconds: 60 });
          if (r.done + r.skipped + r.failed === 0) break;
        }
      }),
    );
    expect([...ids].filter((id) => applied.get(id) !== 1)).toEqual([]);
    expect(applied.size).toBe(200);
  });

  it("the consumer binds the event's tenant: its writes land in that tenant only", async () => {
    const agg = uuid();
    await as(B, (db) => emit(db, { type: "PaymentReceived", aggregateKind: "invoice", aggregateId: agg, branchId: B.branchId }));
    const claims = (await claim(app, { consumer: "test.bind", worker: "w1", limit: 500 })).filter((c) => c.tenantId === B.tenantId);
    const seen: string[] = [];
    for (const c of claims) {
      await consume(app, "test.bind", c, async (db, e) => {
        seen.push(e.tenantId);
        const t = await db.query(`select id from tenants`);
        expect(t.rows.map((r) => r.id)).toEqual([B.tenantId]); // only the bound tenant is visible
        // The consumer's effect: a follow-up event (as a posting consumer would write).
        await emit(db, { type: "JournalReversed", aggregateKind: "consumer_effect", aggregateId: e.aggregateId, branchId: e.branchId ?? undefined, causedBy: e });
      });
    }
    expect(new Set(seen)).toEqual(new Set([B.tenantId]));
    const effects = (await h.admin.query(`select tenant_id, staff_id, acting_role, correlation_id from domain_events where aggregate_kind = 'consumer_effect' and aggregate_id = $1`, [agg])).rows;
    const cause = (await h.admin.query(`select correlation_id from domain_events where aggregate_kind = 'invoice' and aggregate_id = $1`, [agg])).rows[0];
    expect(effects).toEqual([{ tenant_id: B.tenantId, staff_id: null, acting_role: null, correlation_id: cause.correlation_id }]);
  });

  it("a consumer applies an event once: replay and a stale second worker are skipped", async () => {
    const agg = uuid();
    const id = await as(A, (db) => emit(db, { type: "SessionRedeemed", aggregateKind: "session", aggregateId: agg }));
    const mine = (await claim(app, { consumer: "test.once", worker: "w1", limit: 500 })).find((c) => c.eventId === id)!;
    let applied = 0;
    const handle = async () => void applied++;
    expect(await consume(app, "test.once", mine, handle)).toBe("done");
    expect(await consume(app, "test.once", mine, handle)).toBe("skipped"); // same claim again
    // Lease expiry does not reopen a done receipt.
    await h.admin.query(`update event_receipts set lease_until = now() - interval '1 minute' where event_id = $1`, [id]);
    expect((await claim(app, { consumer: "test.once", worker: "w2", limit: 500 })).map((c) => c.eventId)).not.toContain(id);
    expect(applied).toBe(1);
    // Another consumer receives the same event independently.
    expect((await claim(app, { consumer: "test.other", worker: "w1", limit: 500 })).map((c) => c.eventId)).toContain(id);
  });

  it("two workers racing on an expired lease apply the event once", async () => {
    const id = await as(A, (db) => emit(db, { type: "TreatmentFinished", aggregateKind: "execution", aggregateId: uuid() }));
    const c1 = (await claim(app, { consumer: "test.expired", worker: "w1", limit: 500, leaseSeconds: 5 })).find((c) => c.eventId === id)!;
    await h.admin.query(`update event_receipts set lease_until = now() - interval '1 second' where event_id = $1 and consumer = 'test.expired'`, [id]);
    const c2 = (await claim(app, { consumer: "test.expired", worker: "w2", limit: 500 })).find((c) => c.eventId === id)!;
    expect(c2).toBeDefined();
    let applied = 0;
    const slow = async (db: pg.PoolClient) => {
      await db.query(`select pg_sleep(0.2)`);
      applied++;
    };
    const results = await Promise.all([consume(app, "test.expired", c1, slow), consume(app, "test.expired", c2, slow)]);
    expect(results.sort()).toEqual(["done", "skipped"]);
    expect(applied).toBe(1);
    const r = (await h.admin.query(`select attempts from event_receipts where event_id = $1 and consumer = 'test.expired'`, [id])).rows[0];
    expect(r.attempts).toBe(2);
  });

  it("a failing handler rolls back its effects and leaves the event for a retry", async () => {
    const id = await as(A, (db) => emit(db, { type: "InvoiceIssued", aggregateKind: "invoice", aggregateId: uuid() }));
    const c = (await claim(app, { consumer: "test.retry", worker: "w1", limit: 500, leaseSeconds: 5 })).find((x) => x.eventId === id)!;
    await expect(
      consume(app, "test.retry", c, async (db, e) => {
        await emit(db, { type: "JournalReversed", aggregateKind: "failed_effect", aggregateId: e.aggregateId });
        throw new Error("posting failed");
      }),
    ).rejects.toThrow("posting failed");
    expect((await h.admin.query(`select 1 from domain_events where aggregate_kind = 'failed_effect'`)).rows).toHaveLength(0);
    expect((await claim(app, { consumer: "test.retry", worker: "w2", limit: 500 })).map((x) => x.eventId)).not.toContain(id); // lease live
    await h.admin.query(`update event_receipts set lease_until = now() - interval '1 second' where event_id = $1 and consumer = 'test.retry'`, [id]);
    const again = (await claim(app, { consumer: "test.retry", worker: "w2", limit: 500 })).find((x) => x.eventId === id)!;
    await expect(consume(app, "test.retry", again, async () => { throw new Error("still failing"); })).rejects.toThrow();
    // max_attempts (2) reached: it stays open as a dead letter and is not claimed again.
    await h.admin.query(`update event_receipts set lease_until = now() - interval '1 second' where event_id = $1 and consumer = 'test.retry'`, [id]);
    expect((await claim(app, { consumer: "test.retry", worker: "w3", limit: 500 })).map((x) => x.eventId)).not.toContain(id);
    const dl = (await h.admin.query(`select attempts, done_at from event_receipts where event_id = $1 and consumer = 'test.retry'`, [id])).rows[0];
    expect(dl).toEqual({ attempts: 2, done_at: null });
  });

  it("the outbox batch keeps going when one event fails", async () => {
    const ids = [] as string[];
    for (let i = 0; i < 3; i++) ids.push(await as(A, (db) => emit(db, { type: "StockIssued", aggregateKind: "stock_move", aggregateId: uuid() })));
    const handled: string[] = [];
    const [r] = await runOutboxBatch(
      app,
      [{ name: "test.batch", handle: async (_db, e: DomainEvent) => {
        if (e.id === ids[1]) throw Object.assign(new Error("boom"), { code: "X1" });
        handled.push(e.id);
      } }],
      { worker: "w1", limit: 500, leaseSeconds: 5 },
    );
    expect(handled).toEqual(expect.arrayContaining([ids[0], ids[2]]));
    expect(r.failed).toBe(1);
  });

  it("clinic_app cannot write receipts directly or reopen a done one", async () => {
    const id = await as(A, (db) => emit(db, { type: "VisitCheckedIn", aggregateKind: "visit", aggregateId: uuid() }));
    const c = (await claim(app, { consumer: "test.direct", worker: "w1", limit: 500 })).find((x) => x.eventId === id)!;
    await consume(app, "test.direct", c, async () => undefined);
    const svc = { tenantId: A.tenantId, allowedBranchIds: "*" as const, roles: [] };
    for (const sql of [
      `insert into event_receipts (tenant_id, consumer, event_id) values ('${A.tenantId}', 'test.other', '${id}')`,
      `insert into event_consumers (name, event_types) values ('test.forge', '{*}')`,
      `delete from event_receipts`,
      `update event_receipts set consumer = 'x'`,
    ]) {
      await expect(withTenantContext(app, svc, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
    // Reopening a done receipt: no row passes USING (done_at is null), so nothing changes.
    const reopen = await withTenantContext(app, svc, (db) =>
      db.query(`update event_receipts set done_at = null where event_id = $1 and consumer = 'test.direct'`, [id]),
    ).then((r) => r.rowCount, (e) => e.code);
    expect([0, "42501"]).toContain(reopen);
    const after = (await h.admin.query(`select done_at from event_receipts where event_id = $1 and consumer = 'test.direct'`, [id])).rows[0];
    expect(after.done_at).not.toBeNull();
    await expect(claim(app, { consumer: "test.direct", worker: "Bad Worker" })).rejects.toMatchObject({ code: "22023" });
  });
});
