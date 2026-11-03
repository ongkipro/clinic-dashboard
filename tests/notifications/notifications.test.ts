// T-016 Done-when: scenario PR-54 passes with a test alert type; acknowledgement records
// who and when.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, type TenantContext, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { claim, consume, emit } from "../../src/modules/events/events";
import { ack, list, openCount, raise } from "../../src/modules/notifications/notifications";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("B1"), b2: await br("B2") };
}

async function person(t: T, role: Role, branch?: string, name = `Staf ${n + 1}`): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`n${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: name });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (branch) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch });
  return { acc, staffId, tenantId: t.tenantId, role, branch };
}

const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const service = (t: T): TenantContext => ({ tenantId: t.tenantId, allowedBranchIds: "*", roles: [] });
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code}`));
const subject = () => crypto.randomUUID();

let T1: T;
let T2: T;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  T1 = await tenant();
  T2 = await tenant();
  await h.admin.query(`insert into event_consumers (name, event_types) values ('notifications.test', '{AdditionalTreatmentApproved}')`);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-54 notification", () => {
  it("an FO acknowledges an alert: it shows who acknowledged and when, for every recipient", async () => {
    const fo1 = await person(T1, "fo_cashier", T1.b1, "Rina FO");
    const fo2 = await person(T1, "fo_cashier", T1.b1, "Dewi FO");
    const id = await withTenantContext(app, service(T1), (db) =>
      raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "visit", subjectId: subject() }),
    );
    expect(await as(fo2, openCount)).toBe(1);
    const before = Date.now();
    const at = await as(fo1, (db) => ack(db, id));
    expect(at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    for (const p of [fo1, fo2]) {
      const [nt] = await as(p, (db) => list(db));
      expect(nt).toMatchObject({ id, label: "Peringatan uji", acknowledged: { staffId: fo1.staffId, role: "fo_cashier", name: "Rina FO" } });
      expect(nt.acknowledged!.at.getTime()).toBe(at.getTime());
    }
    expect(await as(fo2, openCount)).toBe(0);
  });

  it("a second acknowledgement keeps the first (who and when do not change)", async () => {
    const fo1 = await person(T1, "fo_cashier", T1.b1);
    const fo2 = await person(T1, "fo_cashier", T1.b1);
    const id = await withTenantContext(app, service(T1), (db) => raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "visit", subjectId: subject() }));
    const first = await as(fo1, (db) => ack(db, id));
    const second = await as(fo2, (db) => ack(db, id));
    expect(second.getTime()).toBe(first.getTime());
    const row = (await h.admin.query(`select acknowledged_by from notifications where id = $1`, [id])).rows[0];
    expect(row.acknowledged_by).toBe(fo1.staffId);
    await expect(h.admin.query(`update notifications set acknowledged_by = $2 where id = $1`, [id, fo2.staffId])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`delete from notifications where id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
  });
});

describe("recipients and scope", () => {
  it("a role alert at a branch reaches that role at that branch only", async () => {
    const foB1 = await person(T1, "fo_cashier", T1.b1);
    const foB2 = await person(T1, "fo_cashier", T1.b2);
    const mgrB1 = await person(T1, "manager", T1.b1);
    const id = await withTenantContext(app, service(T1), (db) => raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "visit", subjectId: subject() }));
    expect((await as(foB1, (db) => list(db))).map((x) => x.id)).toContain(id);
    expect((await as(foB2, (db) => list(db))).map((x) => x.id)).not.toContain(id);
    expect((await as(mgrB1, (db) => list(db))).map((x) => x.id)).not.toContain(id);
    expect(await code(as(foB2, (db) => ack(db, id)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(mgrB1, (db) => ack(db, id)))).toBe("ERR_NOT_FOUND");
  });

  it("a personal alert reaches only that person; a tenant-wide role alert reaches the role everywhere", async () => {
    const doc = await person(T1, "doctor", T1.b1);
    const doc2 = await person(T1, "doctor", T1.b1);
    const mine = await withTenantContext(app, service(T1), (db) => raise(db, { type: "test_alert", to: { staffId: doc.staffId }, subjectKind: "clinical_request", subjectId: subject() }));
    expect((await as(doc, (db) => list(db))).map((x) => x.id)).toContain(mine);
    expect((await as(doc2, (db) => list(db))).map((x) => x.id)).not.toContain(mine);
    const own = await person(T1, "owner");
    const wide = await withTenantContext(app, service(T1), (db) => raise(db, { type: "test_alert", to: { role: "owner" }, subjectKind: "approval", subjectId: subject() }));
    expect((await as(own, (db) => list(db))).map((x) => x.id)).toContain(wide);
  });

  it("a role outside the type's recipients, an unknown type, a foreign branch or staff are refused", async () => {
    await withTenantContext(app, service(T1), async (db) => {
      expect(await code(raise(db, { type: "test_alert", to: { role: "nurse" }, subjectKind: "visit", subjectId: subject() }))).toBe("ERR_FORBIDDEN");
    });
    await withTenantContext(app, service(T1), async (db) => {
      expect(await code(raise(db, { type: "nope", to: { role: "owner" }, subjectKind: "visit", subjectId: subject() }))).toBe("ERR_NOT_FOUND");
    });
    await withTenantContext(app, service(T1), async (db) => {
      expect(await code(raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T2.b1 }, subjectKind: "visit", subjectId: subject() }))).toBe("ERR_NOT_FOUND");
    });
    const other = await person(T2, "fo_cashier", T2.b1);
    await withTenantContext(app, service(T1), async (db) => {
      expect(await code(raise(db, { type: "test_alert", to: { staffId: other.staffId }, subjectKind: "visit", subjectId: subject() }))).toBe("ERR_NOT_FOUND");
    });
  });

  it("staff raise only opt-in types, at a branch in scope (never tenant-wide), and are recorded", async () => {
    const doc = await person(T1, "doctor", T1.b1);
    const r = (input: Parameters<typeof raise>[1]) => code(as(doc, (db) => raise(db, input)));
    // System-only type: refused for staff (no forged "approval waiting").
    expect(await r({ type: "test_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "visit", subjectId: subject() })).toBe("ERR_FORBIDDEN");
    // Opt-in type: another branch, or no branch (tenant-wide), refused.
    expect(await r({ type: "test_staff_alert", to: { role: "fo_cashier", branchId: T1.b2 }, subjectKind: "visit", subjectId: subject() })).toBe("ERR_FORBIDDEN");
    expect(await r({ type: "test_staff_alert", to: { role: "fo_cashier" }, subjectKind: "visit", subjectId: subject() })).toBe("ERR_FORBIDDEN");
    // A subject kind the type does not allow is refused.
    expect(await r({ type: "test_staff_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "approval", subjectId: subject() })).toBe("ERR_FORBIDDEN");
    const id = await as(doc, (db) => raise(db, { type: "test_staff_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "visit", subjectId: subject() }));
    expect((await h.admin.query(`select raised_by from notifications where id = $1`, [id])).rows[0].raised_by).toBe(doc.staffId);
  });

  it("a staff raiser addresses a person only if that person works at the branch", async () => {
    const doc = await person(T1, "doctor", T1.b1);
    const foB1 = await person(T1, "fo_cashier", T1.b1);
    const foB2 = await person(T1, "fo_cashier", T1.b2);
    expect(await code(as(doc, (db) => raise(db, { type: "test_staff_alert", to: { staffId: foB2.staffId }, subjectKind: "visit", subjectId: subject() })))).toBe("ERR_FORBIDDEN");
    // A personal staff alert carries the branch the raiser acts at (raise passes it only
    // for role targets today, so a staff-raised personal alert is refused until the
    // producing task needs one).
    expect(await code(as(doc, (db) => raise(db, { type: "test_staff_alert", to: { staffId: foB1.staffId }, subjectKind: "visit", subjectId: subject() })))).toBe("ERR_FORBIDDEN");
  });

  it("another tenant sees and acknowledges nothing", async () => {
    const id = await withTenantContext(app, service(T1), (db) => raise(db, { type: "test_alert", to: { role: "owner" }, subjectKind: "visit", subjectId: subject() }));
    const own2 = await person(T2, "owner");
    expect((await as(own2, (db) => list(db))).map((x) => x.id)).not.toContain(id);
    expect(await code(as(own2, (db) => ack(db, id)))).toBe("ERR_NOT_FOUND");
  });

  it("clinic_app cannot write notifications or types directly", async () => {
    const own = await person(T1, "owner");
    for (const sql of [
      `insert into notifications (tenant_id, type, recipient_role, subject_kind, subject_id) values ('${T1.tenantId}', 'test_alert', 'owner', 'x', '${subject()}')`,
      `update notifications set acknowledged_at = now()`,
      `delete from notifications`,
      `insert into notification_types (key, label, recipient_roles) values ('x_alert', 'x', '{owner}')`,
    ]) {
      await expect(as(own, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("checks never fail open on NULL", () => {
  it("app_branch_allowed and notification_visible are false (not NULL) without a branch list or staff", async () => {
    const r = await withTenantContext(app, { tenantId: T1.tenantId, allowedBranchIds: [], roles: ["fo_cashier"] }, (db) =>
      db.query(`select app_branch_allowed($1) as a, notification_visible('fo_cashier', null, $1) as v, notification_visible(null, null, null) as w`, [T1.b1]),
    );
    expect(r.rows[0]).toEqual({ a: false, v: false, w: false });
  });

  it("acknowledging needs visibility even when the bound context has no branch list", async () => {
    const id = await withTenantContext(app, service(T1), (db) => raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "visit", subjectId: subject() }));
    const fo = await person(T1, "fo_cashier", T1.b2);
    const ctx = { tenantId: T1.tenantId, allowedBranchIds: [] as string[], roles: ["fo_cashier"], staffId: fo.staffId };
    expect(await code(withTenantContext(app, ctx, (db) => ack(db, id)))).toBe("ERR_NOT_FOUND");
  });
});

describe("raised from domain events by an outbox consumer", () => {
  it("one event raised to the same role at two branches gives one alert per branch", async () => {
    const ev = subject();
    const [a, b] = await withTenantContext(app, service(T1), async (db) => [
      await raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T1.b1 }, subjectKind: "visit", subjectId: subject(), sourceEventId: ev }),
      await raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T1.b2 }, subjectKind: "visit", subjectId: subject(), sourceEventId: ev }),
    ]);
    expect(a).not.toBe(b);
    const again = await withTenantContext(app, service(T1), (db) =>
      raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: T1.b2 }, subjectKind: "visit", subjectId: subject(), sourceEventId: ev }),
    );
    expect(again).toBe(b);
  });

  it("an event redelivered to the consumer raises the alert once", async () => {
    const fo = await person(T1, "fo_cashier", T1.b1);
    const visit = subject();
    const eventId = await withTenantContext(app, service(T1), (db) =>
      emit(db, { type: "AdditionalTreatmentApproved", aggregateKind: "visit", aggregateId: visit, branchId: T1.b1 }),
    );
    const handle = async (db: pg.PoolClient, e: { id: string; aggregateId: string; branchId: string | null }) => {
      await raise(db, { type: "test_alert", to: { role: "fo_cashier", branchId: e.branchId ?? undefined }, subjectKind: "visit", subjectId: e.aggregateId, sourceEventId: e.id });
    };
    const c = (await claim(app, { consumer: "notifications.test", worker: "w1", limit: 500 })).find((x) => x.eventId === eventId)!;
    await consume(app, "notifications.test", c, handle);
    // A redelivery (e.g. after a crash between raise and receipt) raises nothing new.
    await withTenantContext(app, service(T1), (db) => handle(db, { id: eventId, aggregateId: visit, branchId: T1.b1 }));
    const rows = (await h.admin.query(`select id from notifications where source_event_id = $1`, [eventId])).rows;
    expect(rows).toHaveLength(1);
    expect((await as(fo, (db) => list(db))).filter((x) => x.subjectId === visit)).toHaveLength(1);
  });
});
