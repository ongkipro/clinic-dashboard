// HYG-008a (DEC-043, IAM-16): an actor's validity is judged on the wall clock after the tenant's
// staff_access lock. Each case runs real transactions on separate connections and orders them
// with barriers and pg_locks observations; nothing sleeps to "let the other one win".
// Plan: docs/tasks/HYG-008.md (HYG-008a test list 2.0-2.4b, 2.9-2.16).
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole, createMembership } from "../../src/modules/org/identity";
import { createHarness, type Harness } from "./harness";

let h: Harness;
let appUrl: string;
let ownerPool: pg.Pool;
let n = 0;
const opened: pg.Client[] = [];

type T = { tenantId: string; branch: string };
type P = { acc: string; staffId: string; membershipId: string; tenantId: string; role: Role; branch?: string };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT Sintetis ${++n}`]);
  const branch = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  return { tenantId, branch };
}

async function person(t: T, roles: Role[], branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`a${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId, membershipId } = await createMembership(ownerPool, { tenantId: t.tenantId, accountId: acc, displayName: `Staf ${n}` });
  for (const role of roles) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (branch && !["owner", "admin_pusat", "finance"].includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch });
  }
  return { acc, staffId, membershipId, tenantId: t.tenantId, role: roles[0], branch };
}

// A connection as clinic_app with an open transaction bound to p's context. Statements run on
// it until the test commits or rolls back. Its backend pid is known for pg_locks observations.
type Tx = { c: pg.Client; pid: number; q: (sql: string, v?: unknown[]) => Promise<pg.QueryResult>; done: () => Promise<void> };
async function bound(p: P, role: Role = p.role): Promise<Tx> {
  const c = new pg.Client({ connectionString: appUrl, application_name: `hyg008a:${p.staffId.slice(0, 8)}` });
  c.on("error", () => {});
  await c.connect();
  opened.push(c);
  const pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid as number;
  await c.query("begin");
  const branchScoped = !["owner", "admin_pusat", "finance"].includes(role);
  await c.query(
    `select set_config('app.tenant_id', $1, true), set_config('app.allowed_branch_ids', $2, true),
            set_config('app.active_branch_id', $3, true), set_config('app.staff_id', $4, true), set_config('app.roles', $5, true)`,
    [p.tenantId, branchScoped && p.branch ? p.branch : "*", branchScoped && p.branch ? p.branch : "", p.staffId, role],
  );
  // Pin the transaction's snapshot and now() before anything else happens.
  await c.query("select now()");
  const q = async (sql: string, v?: unknown[]) => {
    const r = await c.query(sql, v);
    if (/^\s*(commit|rollback)\s*$/i.test(sql)) await c.end().catch(() => {});
    return r;
  };
  return { c, pid, q, done: async () => { await c.query("rollback").catch(() => {}); await c.end().catch(() => {}); } };
}

// The ending owner's transaction: ends `who` and commits (or stays open when asked).
async function endMembership(by: P, who: P, opts: { commit?: boolean } = {}): Promise<Tx> {
  const t = await bound(by);
  await t.q("select staff_end_membership($1)", [who.staffId]);
  if (opts.commit !== false) await t.q("commit");
  return t;
}

const errOf = (p: Promise<unknown>) => p.then(() => ({ code: "ok", message: "" }), (e: { code?: string; message?: string }) => ({ code: e.code ?? "?", message: e.message ?? "" }));

async function until<V>(what: string, f: () => Promise<V>, pred: (v: V) => boolean): Promise<V> {
  const end = performance.now() + 10_000;
  for (;;) {
    const v = await f();
    if (pred(v)) return v;
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
// Is the backend `pid` waiting on a lock (any kind)?
const waitingOnLock = (pid: number) =>
  until(`pid ${pid} waiting on a lock`, () => h.admin.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]).then((r) => r.rows[0]?.wait_event_type as string | undefined), (w) => w === "Lock");

const TAL = "tenant_actor_lock: bound context is not an active membership";

beforeAll(async () => {
  h = await createHarness();
  appUrl = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  ownerPool = new pg.Pool({ connectionString: h.ownerUrl(), max: 3 });
  // A pool login, only to prove the role is a plain clinic_app login (openAppPool checks it).
  await (await openAppPool({ connectionString: appUrl, max: 1 })).end();
});

afterAll(async () => {
  for (const c of opened) await c.end().catch(() => {});
  await ownerPool?.end();
  await h?.close();
});

describe("2.0 tenant_actor_lock itself", () => {
  it("is VOLATILE, SECURITY DEFINER and not executable by clinic_app", async () => {
    const r = (await h.admin.query(
      `select p.provolatile, p.prosecdef, has_function_privilege('clinic_app', p.oid, 'EXECUTE') as app_exec
         from pg_proc p where p.proname = 'tenant_actor_lock'`,
    )).rows[0];
    expect(r).toEqual({ provolatile: "v", prosecdef: true, app_exec: false });
  });

  it("refuses with its own message when the actor was ended after the transaction started", async () => {
    const t = await tenant();
    const a = await person(t, ["owner"]);
    const b = await person(t, ["owner"]);
    const tb = await bound(b);
    await endMembership(a, b);
    // Called through a writer (the only path); the message names tenant_actor_lock.
    const e = await errOf(tb.q(`select approval_cancel($1)`, ["00000000-0000-7000-8000-000000000000"]));
    expect(e).toMatchObject({ code: "42501" });
    expect(e.message).toContain(TAL);
    await tb.done();
  });
});

describe("2.1 an actor ended after its transaction started is refused by every clinic writer", () => {
  // Each writer is called with arguments that would otherwise pass the actor check: a refusal
  // must come from tenant_actor_lock (its message), not from a later domain check.
  const cases: [string, (t: T, me: P) => Promise<[string, unknown[]]>, Role[]][] = [
    ["role_assign", async (t) => ["select role_assign($1, 'finance')", [(await person(t, ["fo_cashier"], t.branch)).staffId]], ["owner"]],
    ["role_request_decide", async () => ["select role_request_decide($1, true)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["approval_request", async (t) => ["select approval_request('refund_exception', 'sale', gen_random_uuid(), 'alasan', $1, 1000)", [t.branch]], ["finance"]],
    ["approval_decide", async () => ["select approval_decide($1, true, null)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["approval_owner_self", async (t) => ["select approval_owner_self('refund_exception', 'sale', gen_random_uuid(), 'alasan pemilik', $1, 1000)", [t.branch]], ["owner"]],
    ["approval_cancel", async () => ["select approval_cancel($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["setting_set", async () => ["select setting_set('SET-17', null, '29'::jsonb, now(), 'kembali default', true)", []], ["owner"]],
    ["setting_draft_decide", async () => ["select setting_draft_decide($1, true, null)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["setting_draft_cancel", async () => ["select setting_draft_cancel($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["evidence_decide", async () => ["select evidence_decide($1, $1, 'approved', null, null)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["evidence_upload", async () => ["select evidence_upload('tax_advice', 'a.pdf', 'application/pdf', '\\x25504446'::bytea, encode(sha256('\\x25504446'::bytea), 'hex'), 'Ahli', current_date)", []], ["finance"]],
    ["role_owner_confirm", async () => ["select role_owner_confirm($1, true)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["role_owner_grant_withdraw", async () => ["select role_owner_grant_withdraw($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["vendor_dual_identity_clinic_decide", async () => ["select vendor_dual_identity_clinic_decide($1, true)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["vendor_dual_identity_clinic_revoke", async () => ["select vendor_dual_identity_clinic_revoke($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["catalog_publish", async () => ["select catalog_publish(null, 'product', 'TAL-1', '{}'::jsonb, 'alasan uji')", []], ["owner"]],
    ["patient_register", async () => ["select patient_register('{}'::jsonb, null, null, null)", []], ["fo_cashier"]],
    ["branch_create", async () => ["select branch_create('TAL-1', 'Cabang Uji', 'Asia/Jakarta')", []], ["owner"]],
    ["branch_update_profile", async (t) => ["select branch_update_profile($1, '{}'::jsonb)", [t.branch]], ["owner"]],
    ["branch_set_hours", async (t) => ["select branch_set_hours($1, '[]'::jsonb)", [t.branch]], ["owner"]],
    ["branch_closure_add", async (t) => ["select branch_closure_add($1, current_date + 1, null, null, 'alasan uji')", [t.branch]], ["owner"]],
    ["branch_closure_remove", async () => ["select branch_closure_remove($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["room_upsert", async (t) => ["select room_upsert($1, null, 'Ruang Uji', 'treatment', null)", [t.branch]], ["owner"]],
    ["room_set_active", async () => ["select room_set_active($1, false)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["device_upsert", async (t) => ["select device_upsert($1, null, 'ipl', 'Alat Uji')", [t.branch]], ["owner"]],
    ["device_set_active", async () => ["select device_set_active($1, false)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["branch_set_services", async (t) => ["select branch_set_services($1, '{}'::uuid[])", [t.branch]], ["owner"]],
    ["tenant_data_key_ensure", async () => ["select * from tenant_data_key_ensure('k1.1.AAAA.BBBB.CCCC')", []], ["fo_cashier"]],
    ["patient_get", async () => ["select patient_get($1)", ["00000000-0000-7000-8000-000000000000"]], ["doctor"]],
    ["branch_price_set", async (t) => ["select branch_price_set(gen_random_uuid(), $1, 1000, null, 'alasan uji')", [t.branch]], ["owner"]],
    ["branch_price_cancel", async () => ["select branch_price_cancel($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["consent_text_publish", async () => ["select consent_text_publish('marketing_wa', 'Teks uji', null)", []], ["owner"]],
    ["consent_grant", async () => ["select consent_grant(gen_random_uuid(), 'marketing_wa', gen_random_uuid(), 'in_person')", []], ["fo_cashier"]],
    ["consent_withdraw", async () => ["select consent_withdraw($1, 'in_person', 'alasan uji')", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["roster_set_week", async (t) => ["select roster_set_week($1, date_trunc('week', current_date + 14)::date, '{}'::uuid[], '[]'::jsonb)", [t.branch]], ["owner"]],
    ["leave_add", async (t, me) => ["select leave_add($1, $2, 'leave', current_date + 14, current_date + 14, 'alasan uji')", [t.branch, me.staffId]], ["owner"]],
    ["leave_cancel", async () => ["select leave_cancel($1, 'alasan uji')", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["booking_create", async (t) => ["select booking_create($1, gen_random_uuid(), gen_random_uuid(), now() + interval '1 day', null, 'phone', null, null, null, false)", [t.branch]], ["fo_cashier"]],
    ["booking_confirm", async () => ["select booking_confirm($1)", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["appointment_confirm", async () => ["select appointment_confirm($1)", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["appointment_cancel", async () => ["select appointment_cancel($1, 'alasan uji')", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["appointment_no_show", async () => ["select appointment_no_show($1)", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["appointment_reschedule", async () => ["select appointment_reschedule($1, now() + interval '1 day', null)", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["visit_check_in", async () => ["select visit_check_in($1)", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["visit_close", async () => ["select visit_close($1)", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["visit_walk_in", async () => ["select visit_walk_in(gen_random_uuid(), null)", []], ["fo_cashier"]],
    ["queue_call", async () => ["select queue_call($1, gen_random_uuid())", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["queue_skip", async () => ["select queue_skip($1)", ["00000000-0000-7000-8000-000000000000"]], ["fo_cashier"]],
    ["queue_display_pair", async (t) => ["select queue_display_pair($1, 'TV uji', repeat('a', 64))", [t.branch]], ["manager"]],
    ["queue_display_revoke", async () => ["select queue_display_revoke($1)", ["00000000-0000-7000-8000-000000000000"]], ["manager"]],
    ["processor_upsert", async () => ["select processor_upsert(null, '{}'::jsonb)", []], ["owner"]],
    ["processor_set_active", async () => ["select processor_set_active($1, false)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["breach_record", async () => ["select breach_record(now(), 'Uji pengguna berakhir', 1, 'Nama')", []], ["owner"]],
    ["breach_assess", async () => ["select breach_assess($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["breach_conclude", async () => ["select breach_conclude($1, false, 'alasan uji yang cukup')", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["breach_close", async () => ["select breach_close($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["breach_notice_add", async () => ["select breach_notice_add($1, '{}'::jsonb, 'a.pdf', 'application/pdf', '\\x25504446'::bytea, repeat('a', 64))", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
    ["breach_notice_file", async () => ["select * from breach_notice_file($1)", ["00000000-0000-7000-8000-000000000000"]], ["owner"]],
  ];
  for (const [name, call, roles] of cases) {
    it(name, async () => {
      const t = await tenant();
      const ender = await person(t, ["owner"]);
      const me = await person(t, roles, t.branch);
      const [sql, args] = await call(t, me);
      const tx = await bound(me);
      await endMembership(ender, me);
      const e = await errOf(tx.q(sql, args));
      await tx.done();
      if (name === "setting_draft_decide" || name === "setting_draft_cancel") {
        // These take staff_access then the approval row; the actor check is in approval_decide /
        // approval_cancel (tenant_actor_lock), reached only when the draft exists. With no draft
        // they answer not-found; the lock order is tested in 2.12.
        expect(e.code).toMatch(/^(42501|P0002)$/);
        return;
      }
      expect(e).toMatchObject({ code: "42501" });
      expect(e.message).toContain(TAL);
    });
  }

  it("a data-protection duty ended after the transaction started no longer lets Admin Pusat publish consent texts (T-038)", async () => {
    const t = await tenant();
    const own = await person(t, ["owner"]);
    const me = await person(t, ["admin_pusat"]);
    const by0 = await bound(own);
    await by0.q("select staff_duty_set($1, 'data_protection', true)", [me.staffId]);
    await by0.q("commit");
    const tx = await bound(me);
    const by = await bound(own);
    await by.q("select staff_duty_set($1, 'data_protection', false)", [me.staffId]);
    await by.q("commit");
    const e = await errOf(tx.q("select consent_text_publish('marketing_wa', 'Teks uji', null)"));
    expect(e).toMatchObject({ code: "42501" });
    expect(e.message).toContain("may not publish consent texts");
    await tx.done();
  });

  it("a data-protection duty ended after the transaction started no longer lets Admin Pusat record a breach (T-039)", async () => {
    const t = await tenant();
    const own = await person(t, ["owner"]);
    const me = await person(t, ["admin_pusat"]);
    const by0 = await bound(own);
    await by0.q("select staff_duty_set($1, 'data_protection', true)", [me.staffId]);
    await by0.q("commit");
    const tx = await bound(me);
    const by = await bound(own);
    await by.q("select staff_duty_set($1, 'data_protection', false)", [me.staffId]);
    await by.q("commit");
    const e = await errOf(tx.q("select breach_record(now(), 'Uji tugas berakhir', 1, 'Nama')"));
    expect(e).toMatchObject({ code: "42501" });
    expect(e.message).toContain("only the privacy officers");
    await tx.done();
  });

  it("the acting role removed (not the membership) also refuses approval_decide and setting_set", async () => {
    const t = await tenant();
    const own = await person(t, ["owner"]);
    const me = await person(t, ["owner", "admin_pusat"]);
    const tx = await bound(me, "admin_pusat");
    const by = await bound(own);
    await by.q("select staff_role_remove($1, 'admin_pusat')", [me.staffId]);
    await by.q("commit");
    const e = await errOf(tx.q("select setting_set('SET-17', null, '29'::jsonb, now(), 'kembali default', true)"));
    expect(e).toMatchObject({ code: "42501" });
    expect(e.message).toContain(TAL);
    await tx.done();
  });
});

describe("2.2 a writer that waited on staff_access while the actor was ended is refused", () => {
  it("role_assign: waits, then 42501 from tenant_actor_lock, no role row", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const me = await person(t, ["owner"]);
    const target = await person(t, ["fo_cashier"], t.branch);
    const holder = await endMembership(ender, me, { commit: false }); // holds staff_access, end uncommitted
    const tx = await bound(me);
    const p = errOf(tx.q("select role_assign($1, 'finance')", [target.staffId]));
    await waitingOnLock(tx.pid);
    await holder.q("commit");
    const e = await p;
    expect(e).toMatchObject({ code: "42501" });
    expect(e.message).toContain(TAL);
    await tx.done();
    expect((await h.admin.query(`select count(*)::int n from staff_roles where staff_id = $1 and role = 'finance'`, [target.staffId])).rows[0].n).toBe(0);
  });

  it("approval_decide: waits, then 42501 from tenant_actor_lock", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const me = await person(t, ["owner"]);
    const fin = await person(t, ["finance"]);
    const rq = await bound(fin);
    const id = (await rq.q("select approval_request('refund_exception', 'sale', gen_random_uuid(), 'alasan', $1, 1000) as id", [t.branch])).rows[0].id as string;
    await rq.q("commit");
    const holder = await endMembership(ender, me, { commit: false });
    const tx = await bound(me);
    const p = errOf(tx.q("select approval_decide($1, true, null)", [id]));
    await waitingOnLock(tx.pid);
    await holder.q("commit");
    const e = await p;
    expect(e).toMatchObject({ code: "42501" });
    expect(e.message).toContain(TAL);
    await tx.done();
    expect((await h.admin.query(`select state from approvals where id = $1`, [id])).rows[0].state).toBe("pending");
  });
});

describe("2.3 a target ended while role_assign waits is not found", () => {
  it("P0002, no role row", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const me = await person(t, ["owner"]);
    const target = await person(t, ["fo_cashier"], t.branch);
    // The assigner's transaction starts (its now() is pinned) BEFORE the end is written, so a
    // target check on now() would still see the membership as active after the end commits.
    const tx = await bound(me);
    const holder = await endMembership(ender, target, { commit: false });
    const p = errOf(tx.q("select role_assign($1, 'finance')", [target.staffId]));
    await waitingOnLock(tx.pid);
    await holder.q("commit");
    expect((await p).code).toBe("P0002");
    await tx.done();
  });
});

describe("2.4 audit_append and notification_ack judge the actor on the wall clock", () => {
  it("audit_append in a transaction bound before the end, called after it commits: refused", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const me = await person(t, ["owner"]);
    const tx = await bound(me);
    await endMembership(ender, me);
    // Refused by the FIRST check (no wait involved), so its message is the first check's, not the
    // post-lock re-check's: a first check on now() would pass and leave only the re-check.
    const e = await errOf(tx.q("select audit_append('settings_change', 'staff', $1, 'success', 'x')", [me.staffId]));
    expect(e.code).toBe("42501");
    expect(e.message).toBe("bound context is not an active membership with that role and branch");
    await tx.done();
  });

  it("notification_ack: refused after the end", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const me = await person(t, ["fo_cashier"], t.branch);
    // A notification addressed to me (raised in a committed service transaction), so the ack
    // reaches its actor check instead of not-found.
    const svc = await bound(ender);
    const id = (await svc.q("select notification_raise('test_staff_alert', null, $1, $2, 'visit', gen_random_uuid(), null) as id", [me.staffId, t.branch])).rows[0].id as string;
    await svc.q("commit");
    const tx = await bound(me);
    await endMembership(ender, me);
    const e = await errOf(tx.q("select notification_ack($1)", [id]));
    expect(e.code, e.message).toBe("42501");
    await tx.done();
  });

  it("4b. a caller that waited on the audit lock while its membership was ended is refused", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const me = await person(t, ["owner"]);
    const holder = await endMembership(ender, me, { commit: false }); // holds staff_access and the audit lock
    const tx = await bound(me);
    // The membership is still active in me's snapshot and on the wall clock (uncommitted end):
    // the first check passes, then audit_append waits on the audit lock.
    const p = errOf(tx.q("select audit_append('settings_change', 'staff', $1, 'success', 'x')", [me.staffId]));
    await waitingOnLock(tx.pid);
    await holder.q("commit");
    const e = await p;
    expect(e.code).toBe("42501");
    expect(e.message).toBe("bound context ended while waiting for the audit lock");
    await tx.done();
  });

  for (const what of ["role", "branch"] as const) {
    it(`4c. the acting ${what} removed while audit_append waits on the audit lock: refused (review r1)`, async () => {
      const t = await tenant();
      const own = await person(t, ["owner"]);
      const me = await person(t, ["manager"], t.branch);
      const other = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B2', 'Cabang 2', 'Asia/Jakarta') returning id`, [t.tenantId])).rows[0].id as string;
      const chg = await bound(own); // holds staff_access, then the audit lock through its own audit
      if (what === "role") await chg.q("select staff_role_remove($1, 'manager')", [me.staffId]);
      else {
        await chg.q("select staff_branch_set($1, 'manager', $2, true)", [me.staffId, other]);
        await chg.q("select staff_branch_set($1, 'manager', $2, false)", [me.staffId, t.branch]);
      }
      const tx = await bound(me);
      const p = errOf(tx.q("select audit_append('settings_change', 'staff', $1, 'success', 'x')", [me.staffId]));
      await waitingOnLock(tx.pid);
      await chg.q("commit");
      const e = await p;
      expect(e.code).toBe("42501");
      expect(e.message).toBe("bound context ended while waiting for the audit lock");
      await tx.done();
    });
  }
});

describe("2.9 B-02: ending a membership is always allowed by memberships_vendor_guard", () => {
  it("vendor staff without an approved dual identity: the end succeeds, a non-ending change is refused", async () => {
    const t = await tenant();
    const own = await person(t, ["owner"]);
    const vs = await person(t, ["fo_cashier"], t.branch);
    // The clinic member then becomes active vendor staff with no approved dual identity: the
    // guard refuses any membership change of that account except the end.
    await h.admin.query(`insert into vendor_staff (account_id, display_name) values ($1, 'Staf Vendor')`, [vs.acc]);
    const bad = await errOf(h.admin.query(`update memberships set effective_from = effective_from - interval '1 day' where id = $1`, [vs.membershipId]));
    expect(bad.code).toBe("42501");
    const end = await bound(own);
    const e = await errOf(end.q("select staff_end_membership($1)", [vs.staffId]));
    expect(e.code, e.message).toBe("ok");
    await end.q("commit");
    expect((await h.admin.query(`select effective_to is not null as ended from memberships where id = $1`, [vs.membershipId])).rows[0].ended).toBe(true);
  });
});

describe("2.10 B-03: clinic_app cannot read evidence_approvals.seq", () => {
  it("column privilege denied; every other column allowed", async () => {
    const r = (await h.admin.query(
      `select a.attname, has_column_privilege('clinic_app', 'public.evidence_approvals', a.attname, 'SELECT') as ok
         from pg_attribute a where a.attrelid = 'public.evidence_approvals'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    )).rows as { attname: string; ok: boolean }[];
    expect(r.filter((x) => !x.ok).map((x) => x.attname)).toEqual(["seq"]);
  });
});

describe("2.11 B-04: membership_revocations refuses TRUNCATE", () => {
  it("as the table owner", async () => {
    expect((await errOf(h.admin.query("truncate public.membership_revocations"))).code).not.toBe("ok");
  });
});

describe("2.12 lock order: staff_access before the approval row", () => {
  // Pair a: setting_draft_decide beside approval_decide (Owner). Pair b: setting_draft_cancel
  // beside approval_cancel (the requesting Admin Pusat). Same shape, the same approval X.
  for (const pair of ["decide", "cancel"] as const) {
    it(`setting_draft_${pair} waits on staff_access without holding the approval row; no deadlock`, async () => {
      const t = await tenant();
      const own = await person(t, ["owner"]);
      const ap = await person(t, ["admin_pusat"]);
      // An Owner-approved draft by Admin Pusat (SET-6, setting_change_owner), then its approval id.
      const dr = await bound(ap);
      const draft = await errOf(dr.q("select setting_set('SET-6', null, '50000'::jsonb, now(), 'usul batas', false) as r"));
      expect(draft.code, draft.message).toBe("ok");
      await dr.q("commit");
      const approval = (await h.admin.query(`select approval_id from setting_versions where tenant_id = $1 and state = 'draft' and approval_id is not null limit 1`, [t.tenantId])).rows[0].approval_id as string;
      const actor = pair === "decide" ? own : ap;
      const plain = pair === "decide" ? "select approval_decide($1, true, null)" : "select approval_cancel($1)";
      const wrapped = pair === "decide" ? "select setting_draft_decide($1, true, null)" : "select setting_draft_cancel($1)";

      const holder = await bound(own); // T0 holds staff_access
      await holder.q("select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))", [t.tenantId]);
      const t2 = await bound(actor);
      // Each transaction commits as soon as its call returns: T2 holds staff_access until then, and
      // T1 waits behind it (the order under test), so awaiting both before committing would hang.
      const p2 = errOf(t2.q(plain, [approval])).then(async (e) => (await t2.q(e.code === "ok" ? "commit" : "rollback"), e));
      await waitingOnLock(t2.pid);
      const t1 = await bound(actor);
      const p1 = errOf(t1.q(wrapped, [approval])).then(async (e) => (await t1.q(e.code === "ok" ? "commit" : "rollback"), e));
      await waitingOnLock(t1.pid);
      // T1 waits on staff_access and does not hold the approval row.
      expect((await h.admin.query(`select count(*)::int n from pg_locks l where l.pid = $1 and l.relation = 'public.approvals'::regclass`, [t1.pid])).rows[0].n).toBe(0);
      const probe = await h.admin.query("begin").then(() => errOf(h.admin.query(`select 1 from approvals where id = $1 for update nowait`, [approval])));
      await h.admin.query("rollback");
      expect(probe.code).toBe("ok");
      await holder.q("commit");
      const [e1, e2] = await Promise.all([p1, p2]);
      for (const e of [e1, e2]) expect(e.code).not.toBe("40P01");
      // One succeeds; the other sees it already decided or cancelled (a domain error), never a deadlock.
      expect([e1.code, e2.code].filter((c) => c === "ok")).toHaveLength(1);
    });
  }
});

describe("2.13 R1-M3: staff_invite_accept waits on staff_access and sees the inviter ended", () => {
  it("the inviter is ended while the accept waits: refused, no membership created", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const inviter = await person(t, ["admin_pusat"]);
    const email = `undangan${++n}@klinik-sintetis.test`;
    const hash = createHash("sha256").update(`hyg008a-${n}-${t.tenantId}`).digest("hex"); // the column holds a sha256 hex
    const iv = await bound(inviter);
    const inv = await errOf(iv.q("select staff_invite($1, 'Calon', array['fo_cashier'], array[$2::uuid], $3, 7)", [email, t.branch, hash]));
    expect(inv.code, inv.message).toBe("ok");
    await iv.q("commit");
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('Calon', $1) returning id`, [email])).rows[0].id as string;
    const holder = await endMembership(ender, inviter, { commit: false }); // holds staff_access
    const ac = new pg.Client({ connectionString: appUrl, application_name: "hyg008a:accept" });
    ac.on("error", () => {});
    await ac.connect();
    opened.push(ac);
    const pid = (await ac.query("select pg_backend_pid() as pid")).rows[0].pid as number;
    const p = errOf(ac.query("select * from staff_invite_accept($1, $2)", [hash, acc]));
    await waitingOnLock(pid);
    // It waits on staff_access (advisory), holding no invitation row: the order is
    // staff_access -> invitation, as staff_end_membership -> staff_invitations_recheck.
    const held = (await h.admin.query(`select l.locktype, l.granted from pg_locks l where l.pid = $1`, [pid])).rows as { locktype: string; granted: boolean }[];
    expect(held.find((l) => !l.granted)?.locktype).toBe("advisory");
    // Resolving the tenant from the token reads the table (AccessShareLock); a FOR UPDATE row lock
    // would also take RowShareLock on it. That one must not be held while it waits.
    const modes = (await h.admin.query(`select mode from pg_locks where pid = $1 and relation = 'public.staff_invitations'::regclass and granted`, [pid])).rows.map((x) => x.mode as string);
    expect(modes).not.toContain("RowShareLock");
    await holder.q("commit");
    const e = await p;
    expect(e.code).toBe("P0002");
    expect((await h.admin.query(`select count(*)::int n from memberships where account_id = $1`, [acc])).rows[0].n).toBe(0);
  });
});

describe("2.16 R1-L1: an owner invitation that expires while its accept waits on staff_access", () => {
  it("is refused (the expiry is judged again after the wait, on the wall clock)", async () => {
    const t = await tenant();
    const blockerOwner = await person(t, ["admin_pusat"]); // only to hold staff_access; no Owner yet
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('Pemilik', $1) returning id`, [`pemilik${++n}@klinik-sintetis.test`])).rows[0];
    const email = (await h.admin.query(`select email from auth_user where id = $1`, [acc.id])).rows[0].email as string;
    const vs1 = (await h.admin.query(`insert into auth_user (name, email) values ('V1', $1) returning id`, [`v1.${n}@vendor-sintetis.test`])).rows[0].id as string;
    const vs2 = (await h.admin.query(`insert into auth_user (name, email) values ('V2', $1) returning id`, [`v2.${n}@vendor-sintetis.test`])).rows[0].id as string;
    const req = (await h.admin.query(`insert into vendor_staff (account_id, display_name) values ($1, 'Onboarding') returning id`, [vs1])).rows[0].id as string;
    const appr = (await h.admin.query(`insert into vendor_staff (account_id, display_name) values ($1, 'Pemilik Platform') returning id`, [vs2])).rows[0].id as string;
    const hash = createHash("sha256").update(`owner-${n}-${t.tenantId}`).digest("hex");
    // The accepter starts first: its now() (T_start) is pinned before the invitation exists.
    const ac = new pg.Client({ connectionString: appUrl, application_name: "hyg008a:owner-accept" });
    ac.on("error", () => {});
    await ac.connect();
    opened.push(ac);
    const pid = (await ac.query("select pg_backend_pid() as pid")).rows[0].pid as number;
    await ac.query("begin");
    const tStart = (await ac.query("select now() as t")).rows[0].t as Date;
    // Fixture (table owner, a direct insert, guard not involved): issued, expiring 300 ms after T_start.
    await h.admin.query(
      `insert into tenant_owner_invitations (tenant_id, email, display_name, requested_by, state, approved_by, approved_at, token_hash, expires_at)
       values ($1, $2, 'Pemilik Sintetis', $3, 'issued', $4, now(), $5, $6::timestamptz + interval '300 milliseconds')`,
      [t.tenantId, email, req, appr, hash, tStart]);
    const blocker = await bound(blockerOwner);
    await blocker.q("select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))", [t.tenantId]);
    const p = errOf(ac.query("select * from tenant_owner_invite_accept($1, $2)", [hash, acc.id]));
    await waitingOnLock(pid);
    // Release only after the wall clock is past the expiry (bounded; failure only).
    await until("wall clock past the expiry", () => h.admin.query(`select clock_timestamp() > $1::timestamptz + interval '300 milliseconds' as past`, [tStart]).then((r) => r.rows[0].past as boolean), (x) => x);
    await blocker.q("commit");
    const e = await p;
    expect(e).toMatchObject({ code: "P0002", message: "ERR_NOT_FOUND: invitation not valid" });
    await ac.query("rollback");
    expect((await h.admin.query(`select count(*)::int n from memberships where account_id = $1`, [acc.id])).rows[0].n).toBe(0);
  });
});

describe("2.13b staff_invite_accept with an unknown token (review r1)", () => {
  it("is refused at once with the generic not-found and takes no staff_access", async () => {
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`tak${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const c = new pg.Client({ connectionString: appUrl });
    c.on("error", () => {});
    await c.connect();
    opened.push(c);
    await c.query("begin");
    const e = await errOf(c.query("select * from staff_invite_accept($1, $2)", ["0".repeat(64), acc]));
    expect(e).toMatchObject({ code: "P0002", message: "ERR_NOT_FOUND: invitation not valid" });
    await c.query("rollback");
    const body = (await h.admin.query(`select pg_get_functiondef('public.staff_invite_accept(text, uuid)'::regprocedure) as d`)).rows[0].d as string;
    expect(body).toContain("WHERE i.token_hash = p_token_hash AND i.tenant_id = v_role_id FOR UPDATE");
  });
});

describe("2.14 read-only approval_actor callers judge on the wall clock", () => {
  it("role_owner_grants_mine after the end commits: refused", async () => {
    const t = await tenant();
    const ender = await person(t, ["owner"]);
    const me = await person(t, ["owner"]);
    const tx = await bound(me);
    await endMembership(ender, me);
    expect((await errOf(tx.q("select * from role_owner_grants_mine()"))).code).toBe("42501");
    await tx.done();
  });
});

describe("2.15 evidence_decisions: the app's read of decisions", () => {
  it("is executable by clinic_app only and returns no seq", async () => {
    const r = (await h.admin.query(
      `select has_function_privilege('clinic_app', 'public.evidence_decisions(uuid)', 'EXECUTE') as app,
              has_function_privilege('clinic_operator', 'public.evidence_decisions(uuid)', 'EXECUTE') as op`,
    )).rows[0];
    expect(r).toEqual({ app: true, op: false });
    const cols = (await h.admin.query(`select unnest(proargnames) a from pg_proc where proname = 'evidence_decisions'`)).rows.map((x) => x.a as string);
    expect(cols).not.toContain("seq");
  });

  it("returns another tenant's decisions to nobody; its own tenant reads them newest first", async () => {
    // Tenant B has a real decision (written by the table owner: the fixture, not the path under
    // test). A's owner asks for B's item: nothing. B's owner gets it.
    const tb = await tenant();
    const ownB = await person(tb, ["owner"]);
    const item = (await h.admin.query(`select id from evidence_items where tenant_id = $1 and obligation_key = 'tax_advice'`, [tb.tenantId])).rows[0]?.id as string | undefined
      ?? (await h.admin.query(`insert into evidence_items (tenant_id, obligation_key, state) values ($1, 'tax_advice', 'submitted') returning id`, [tb.tenantId])).rows[0].id as string;
    const file = (await h.admin.query(
      `insert into evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_name, uploaded_as)
       values ($1, $2, 1, 'b.pdf', 'application/pdf', 4, encode(sha256('\\x25504446'::bytea), 'hex'), '\\x25504446', 'Ahli B', current_date, $3, 'Pemilik B', 'owner') returning id`,
      [tb.tenantId, item, ownB.staffId])).rows[0].id as string;
    await h.admin.query(
      `insert into evidence_approvals (item_id, tenant_id, file_id, decision, reason, decided_by, decided_as, decided_name)
       values ($1, $2, $3, 'rejected', 'alasan rahasia B', $4, 'owner', 'Pemilik B')`, [item, tb.tenantId, file, ownB.staffId]);
    const ta = await tenant();
    const ownA = await person(ta, ["owner"]);
    const tx = await bound(ownA);
    expect((await tx.q("select * from evidence_decisions($1)", [item])).rows).toEqual([]);
    await tx.done();
    const txb = await bound(ownB);
    expect((await txb.q("select reason from evidence_decisions($1)", [item])).rows.map((x) => x.reason)).toEqual(["alasan rahasia B"]);
    await txb.done();
  });
});

describe("2.15b evidence_decisions: order and area (review r2)", () => {
  // A finance upload of tax_advice in tenant T (fixture by the table owner), decided by two owners.
  async function evidence(t: T, uploader: P) {
    const item = (await h.admin.query(`select id from evidence_items where tenant_id = $1 and obligation_key = 'tax_advice'`, [t.tenantId])).rows[0]?.id as string | undefined
      ?? (await h.admin.query(`insert into evidence_items (tenant_id, obligation_key, state) values ($1, 'tax_advice', 'submitted') returning id`, [t.tenantId])).rows[0].id as string;
    const file = (await h.admin.query(
      `insert into evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_name, uploaded_as)
       values ($1, $2, 1, 't.pdf', 'application/pdf', 4, encode(sha256('\\x25504446'::bytea), 'hex'), '\\x25504446', 'Ahli', current_date, $3, 'Keuangan', 'finance') returning id`,
      [t.tenantId, item, uploader.staffId])).rows[0].id as string;
    await h.admin.query(`update evidence_items set state = 'submitted' where id = $1`, [item]);
    return { item, file };
  }

  it("a decider that started first but waited on staff_access is listed as the latest; the list agrees with the gate", async () => {
    const t = await tenant();
    const fin = await person(t, ["finance"]);
    const o1 = await person(t, ["owner"]);
    const o2 = await person(t, ["owner"]);
    const { item, file } = await evidence(t, fin);
    // D2 starts first (its now() is earlier), then waits behind D1 on staff_access.
    const d2 = await bound(o2);
    const d1 = await bound(o1);
    await d1.q("select evidence_decide($1, $2, 'approved', null, null)", [item, file]); // D1 holds staff_access
    const p2 = errOf(d2.q("select evidence_decide($1, $2, 'revoked', 'dicabut', null)", [item, file]));
    await waitingOnLock(d2.pid);
    // D2 waits on staff_access (advisory), not on the item row.
    const waits = (await h.admin.query(`select locktype from pg_locks where pid = $1 and not granted`, [d2.pid])).rows.map((x) => x.locktype as string);
    expect(waits).toEqual(["advisory"]);
    await d1.q("commit");
    const e2 = await p2;
    expect(e2.code, e2.message).toBe("ok");
    await d2.q("commit");
    const r = await bound(o1);
    const rows = (await r.q("select decision, decided_at from evidence_decisions($1)", [item])).rows as { decision: string; decided_at: Date }[];
    expect(rows.map((x) => x.decision)).toEqual(["revoked", "approved"]); // newest first: the waited decider
    expect(rows[0].decided_at.getTime()).toBeGreaterThan(rows[1].decided_at.getTime()); // its time is after the wait
    // The gate (evidence_item_open) reads the newest by seq too: revoked, so closed.
    await r.done();
    // evidence_item_open is internal (not granted to clinic_app): read as the table owner.
    expect((await h.admin.query("select evidence_item_open($1) as open", [item])).rows[0].open).toBe(false);
  });

  it("a same-tenant role that cannot read the area gets nothing", async () => {
    const t = await tenant();
    const fin = await person(t, ["finance"]);
    const own = await person(t, ["owner"]);
    const fh = await person(t, ["facility_head"], t.branch); // clinical area only, not tax
    const { item, file } = await evidence(t, fin);
    const d = await bound(own);
    await d.q("select evidence_decide($1, $2, 'rejected', 'kurang', null)", [item, file]);
    await d.q("commit");
    const r = await bound(fh);
    expect((await r.q("select * from evidence_decisions($1)", [item])).rows).toEqual([]);
    await r.done();
    const ok = await bound(own);
    expect((await ok.q("select decision from evidence_decisions($1)", [item])).rows.map((x) => x.decision)).toEqual(["rejected"]);
    await ok.done();
  });
});

describe("2.16b the 14-day Owner-grant lapse is judged after the staff_access wait", () => {
  it("a grant that crosses 14 days while role_owner_confirm waits on staff_access lapses instead of confirming", async () => {
    const t = await tenant();
    const own = await person(t, ["owner"]);
    const subject = await person(t, ["admin_pusat"]);
    // The subject's transaction starts first (T_start pinned).
    const tx = await bound(subject);
    const tStart = (await tx.q("select now() as t")).rows[0].t as Date;
    // Fixture (table owner; role_requests has no guard trigger): an Owner grant decided so that
    // its 14-day limit falls 300 ms after T_start.
    const g = await ownerPool.connect();
    try {
      await g.query("begin");
      const req = (await g.query(
        `insert into role_requests (tenant_id, staff_id, role, change, requested_by, requested_as, state, decided_by, decided_at)
         values ($1, $2, 'owner', 'grant', $3, 'owner', 'awaiting_confirmation', $3, $4::timestamptz - interval '14 days' + interval '300 milliseconds') returning id`,
        [t.tenantId, subject.staffId, own.staffId, tStart])).rows[0].id as string;
      await g.query("commit");
      const blocker = await bound(own);
      await blocker.q("select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))", [t.tenantId]);
      const p = tx.q("select role_owner_confirm($1, true) as r", [req]);
      await waitingOnLock(tx.pid);
      await until("wall clock past the 14-day limit", () => h.admin.query(`select clock_timestamp() > $1::timestamptz + interval '300 milliseconds' as past`, [tStart]).then((r) => r.rows[0].past as boolean), (x) => x);
      await blocker.q("commit");
      // A lapse is recorded (not raised): the grant becomes rejected and no Owner role is created.
      expect((await p).rows[0].r).toEqual({ state: "lapsed" });
      await tx.q("commit");
      expect((await h.admin.query(`select state from role_requests where id = $1`, [req])).rows[0].state).toBe("rejected");
      expect((await h.admin.query(`select count(*)::int n from staff_roles where staff_id = $1 and role = 'owner'`, [subject.staffId])).rows[0].n).toBe(0);
    } finally {
      g.release();
    }
  });
});

