// HYG-008b (DEC-043, DEC-042; IAM-16, TEN-17, TEN-19): vendor and operator authority on the wall
// clock after every wait. Each case runs real transactions on separate connections, orders them
// with pg_locks observations and never sleeps to "let the other one win".
// Plan: docs/tasks/HYG-008.md (HYG-008b tests 2.5-2.8, 2.16 vendor, 2.17, 2.18, structural).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPERATOR_GROUP_ROLE, VENDOR_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { advanceTenant, approveOwnerInvite, cancelOwnerInvite, requestOwnerInvite } from "../../src/modules/vendor/tenants/tenants";
import { inviteMember, listTeam, setMemberState } from "../../src/modules/vendor/team/team";
import { openSession, SupportBindError, withSupportSession } from "../../src/modules/vendor/support/support";
import { CommandError } from "../../src/lib/command";
import { bootstrapVendor, createVendorStaff, updateVendorStaff, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testClient, testPool } from "./harness";

let h: Harness;
let ownerPool: pg.Pool;
let consoleDb: pg.Pool;
let opDb: pg.Pool;
let vendorUrl: string;
let n = 0;
const IP = "203.0.113.10";
const opened: pg.Client[] = [];
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

async function account(totp = true): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [`va${++n}@vendor-sintetis.test`, totp])).rows[0].id as string;
}
async function session(acc: string, mfaAgo = "0 minutes"): Promise<string> {
  const tok = `tok${++n}${randomBytes(12).toString("hex")}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`, [acc, tok, mfaAgo]);
  return tok;
}
async function clinic(): Promise<string> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT Klinik Sintetis ${++n}`]);
  await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang Satu', 'Asia/Jakarta')`, [tenantId]);
  return tenantId;
}
// A fresh connection (any role URL) with its pid; closed at the end of the file.
async function conn(url: string, name: string): Promise<{ c: pg.Client; pid: number }> {
  const c = testClient({ connectionString: url, application_name: name });
  await c.connect();
  opened.push(c);
  return { c, pid: (await c.query("select pg_backend_pid() as pid")).rows[0].pid as number };
}
async function until<V>(what: string, f: () => Promise<V>, pred: (v: V) => boolean): Promise<V> {
  const end = performance.now() + 10_000;
  for (;;) {
    const v = await f();
    if (pred(v)) return v;
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const waitingOnLock = (pid: number) =>
  until(`pid ${pid} waiting on a lock`, () => h.admin.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]).then((r) => r.rows[0]?.wait_event_type as string | undefined), (w) => w === "Lock");
const signOut = (tok: string) => h.admin.query(`update auth_session set expires_at = now() - interval '1 second' where token = $1`, [tok]);
const lastAction = async () => (await h.admin.query(`select action, outcome, reason_code from vendor_actions order by seq desc limit 1`)).rows[0];

let PO: string; let PO2: string; let SUP: string; let ONB: string;

beforeAll(async () => {
  h = await createHarness();
  ownerPool = testPool({ connectionString: h.ownerUrl(), max: 3 });
  vendorUrl = h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE]));
  consoleDb = await openAppPool({ connectionString: vendorUrl, max: 3 }, VENDOR_GROUP_ROLE);
  opDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 3 }, OPERATOR_GROUP_ROLE);
  const c = await ownerPool.connect();
  try {
    PO = await account();
    await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    PO2 = await account();
    SUP = await account();
    ONB = await account();
    await createVendorStaff(c, caller(PO), PO2, "Pemilik Dua", ["platform_owner"]);
    await createVendorStaff(c, caller(PO), SUP, "Dukungan", ["support"]);
    await createVendorStaff(c, caller(PO), ONB, "Onboarding", ["onboarding"]);
  } finally {
    c.release();
  }
}, 300_000); // HYG-016: setup gets the suite's hook limit (an explicit 120 s here overrode it and timed out in close run 1)

afterAll(async () => {
  for (const c of opened) await c.end().catch(() => {});
  await opDb?.end();
  await consoleDb?.end();
  await ownerPool?.end();
  await h?.close();
});

describe("2.17 a console write that waited is refused when its authority ended during the wait", () => {
  // vendor_console_owner_invite_approve waits on tenants_registry FOR UPDATE held by another
  // transaction; the approver signs out, or its second factor ages past 10 minutes, or TOTP is
  // turned off, while it waits. The re-check after the wait refuses; nothing is approved; the
  // refusal is logged in its own transaction (the console helper).
  async function pendingInvitation(): Promise<{ tenantId: string; invitationId: string }> {
    const tenantId = await clinic();
    const reqTok = await session(ONB);
    const r = await requestOwnerInvite(consoleDb, { token: reqTok, ip: IP }, tenantId, "Pemilik Klinik", `pemilik${++n}@klinik-sintetis.test`);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return { tenantId, invitationId: r.data.invitation_id };
  }
  for (const what of ["signed out", "second factor aged", "TOTP turned off"] as const) {
    it(`owner_invite_approve: ${what} while waiting on tenants_registry -> refused, nothing approved, refusal logged`, async () => {
      const { tenantId, invitationId } = await pendingInvitation();
      const tok = await session(PO2);
      const holder = await conn(h.ownerUrl(), "hyg008b:holder");
      await holder.c.query("begin");
      await holder.c.query("select 1 from tenants_registry where id = $1 for update", [tenantId]);
      const pool = testPool({ connectionString: vendorUrl, max: 1 });
      const p = approveOwnerInvite(pool, { token: tok, ip: IP }, invitationId).catch((e: unknown) => e);
      const pid = await until("approver waiting", () => h.admin.query(
        `select pid from pg_stat_activity where query like '%vendor_console_owner_invite_approve%' and wait_event_type = 'Lock' and pid <> pg_backend_pid()`).then((r) => r.rows[0]?.pid as number | undefined), (x) => x !== undefined);
      expect(pid).toBeTruthy();
      if (what === "signed out") await signOut(tok);
      if (what === "second factor aged") await h.admin.query(`update auth_session set second_factor_at = now() - interval '11 minutes' where token = $1`, [tok]);
      if (what === "TOTP turned off") await h.admin.query(`update auth_user set two_factor_enabled = false where id = $1`, [PO2]);
      await holder.c.query("commit");
      const r = (await p) as { ok: boolean; reason?: string };
      const want = { "signed out": "no_session", "second factor aged": "totp_not_verified", "TOTP turned off": "totp_required" }[what];
      expect(r).toMatchObject({ ok: false, code: "ERR_FORBIDDEN", reason: want });
      expect((await h.admin.query(`select state from tenant_owner_invitations where id = $1`, [invitationId])).rows[0].state).toBe("pending");
      expect(await lastAction()).toMatchObject({ action: "vendor_console_owner_invite_approve", outcome: "denied", reason_code: `authority_${want}` });
      // Attribution (review): the invitation's tenant and the invitation itself, resolved in the
      // database from the invitation id the command named.
      expect((await h.admin.query(`select tenant_id, object_id from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ tenant_id: tenantId, object_id: invitationId });
      if (what === "TOTP turned off") await h.admin.query(`update auth_user set two_factor_enabled = true where id = $1`, [PO2]);
      await pool.end();
    });
  }

  it("the same schedule with the authority unchanged approves (positive control)", async () => {
    const { tenantId, invitationId } = await pendingInvitation();
    const tok = await session(PO2);
    const holder = await conn(h.ownerUrl(), "hyg008b:holder");
    await holder.c.query("begin");
    await holder.c.query("select 1 from tenants_registry where id = $1 for update", [tenantId]);
    const pool = testPool({ connectionString: vendorUrl, max: 1 });
    const p = approveOwnerInvite(pool, { token: tok, ip: IP }, invitationId);
    await until("approver waiting", () => h.admin.query(
      `select pid from pg_stat_activity where query like '%vendor_console_owner_invite_approve%' and wait_event_type = 'Lock' and pid <> pg_backend_pid()`).then((r) => r.rows[0]?.pid as number | undefined), (x) => x !== undefined);
    await holder.c.query("commit");
    expect(await p).toMatchObject({ ok: true });
    await pool.end();
  });
});

describe("2.17 support_open waits on staff_access; a sign-out during the wait refuses it", () => {
  it("no session is created and the refusal is logged", async () => {
    const tenantId = await clinic();
    const tok = await session(SUP);
    const holder = await conn(h.ownerUrl(), "hyg008b:staff-access");
    await holder.c.query("begin");
    await holder.c.query("select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))", [tenantId]);
    const pool = testPool({ connectionString: vendorUrl, max: 1 });
    const p = openSession(pool, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
    await until("open waiting", () => h.admin.query(
      `select pid from pg_stat_activity where query like '%vendor_console_support_open%' and wait_event_type = 'Lock' and pid <> pg_backend_pid()`).then((r) => r.rows[0]?.pid as number | undefined), (x) => x !== undefined);
    await signOut(tok);
    await holder.c.query("commit");
    expect(await p).toMatchObject({ ok: false, code: "ERR_FORBIDDEN", reason: "no_session" });
    expect((await h.admin.query(`select count(*)::int n from support_sessions where tenant_id = $1`, [tenantId])).rows[0].n).toBe(0);
    expect(await lastAction()).toMatchObject({ action: "vendor_console_support_open", outcome: "denied", reason_code: "authority_no_session" });
    expect((await h.admin.query(`select tenant_id, object_id from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ tenant_id: tenantId, object_id: tenantId });
    await pool.end();
  });
});

describe("2.17 support ticket: a sign-out while the ticket's log waits on the tenant audit lock (review)", () => {
  it("withSupportSession: SupportBindError(no_session), no ticket, no binding, exactly one durable refusal", async () => {
    const tenantId = await clinic();
    const tok = await session(SUP);
    const s = await openSession(consoleDb, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
    if (!s.ok) throw new Error(JSON.stringify(s));
    const before = (await h.admin.query(`select count(*)::int n from vendor_actions where action = 'vendor_console_support_ticket' and outcome = 'denied'`)).rows[0].n as number;
    // The holder takes the tenant's audit lock (as any audited writer of that tenant would).
    const holder = await conn(h.ownerUrl(), "hyg008b:audit-holder");
    await holder.c.query("begin");
    await holder.c.query("select pg_advisory_xact_lock(hashtextextended('audit:' || $1::text, 0))", [tenantId]);
    let fnRan = false;
    const p = withSupportSession(consoleDb, opDb, { token: tok, ip: IP }, s.data.id, async () => { fnRan = true; return 0; })
      .then(() => "ok", (e: unknown) => (e instanceof SupportBindError ? `bind:${e.reason}` : e instanceof CommandError ? `cmd:${e.code}` : `raw:${(e as { code?: string; message?: string }).code ?? ""}:${(e as Error).message}`));
    // The ticket's success log waits on the audit lock (inside vendor_console_support_ticket).
    await until("ticket waiting on the audit lock", () => h.admin.query(
      `select a.pid from pg_stat_activity a join pg_locks l on l.pid = a.pid and not l.granted and l.locktype = 'advisory'
        where a.query like '%vendor_console_support_ticket%'`).then((r) => r.rows[0]?.pid as number | undefined), (x) => x !== undefined);
    await signOut(tok);
    await holder.c.query("commit");
    expect(await p).toBe("bind:no_session");
    expect(fnRan).toBe(false);
    expect((await h.admin.query(`select count(*)::int n from support_bind_tickets where session_id = $1`, [s.data.id])).rows[0].n).toBe(0);
    expect((await h.admin.query(`select count(*)::int n from support_session_bindings where session_id = $1`, [s.data.id])).rows[0].n).toBe(0);
    const after = (await h.admin.query(`select count(*)::int n from vendor_actions where action = 'vendor_console_support_ticket' and outcome = 'denied' and reason_code = 'authority_no_session'`)).rows[0].n as number;
    expect(after - before).toBe(1);
    // The refusal names the session's tenant and the session (attribution).
    expect((await h.admin.query(`select tenant_id, object_id from vendor_actions where action = 'vendor_console_support_ticket' and reason_code = 'authority_no_session' order by seq desc limit 1`)).rows[0])
      .toEqual({ tenant_id: tenantId, object_id: s.data.id });
  });
});

// Fixture: pending vendor-staff invitations made already expired (table owner, guard trigger off
// inside its own transaction).
async function expireInvitations(like: string) {
  const g = await ownerPool.connect();
  try {
    await g.query("begin");
    try {
      await g.query("alter table vendor_staff_invitations disable trigger vendor_staff_invitations_guard");
      await g.query("update vendor_staff_invitations set invited_at = now() - interval '8 days', expires_at = now() - interval '1 second' where email like $1 and state = 'pending'", [like]);
      await g.query("alter table vendor_staff_invitations enable trigger vendor_staff_invitations_guard");
      await g.query("commit");
    } catch (e) {
      await g.query("rollback");
      throw e;
    }
  } finally {
    g.release();
  }
}

// One schedule per kind of wait: the call is observed waiting (by its query text, on a lock), the
// caller signs out, the holder releases; the call is refused with no_session, its effect is absent,
// and exactly one refusal row is committed with its attribution.
async function waitedRefusal(o: {
  fn: string; tok: string; hold: (c: pg.Client) => Promise<void>; call: (pool: pg.Pool) => Promise<unknown>;
  effectAbsent: () => Promise<boolean>; tenant: string | null; object: string | null;
}) {
  const before = (await h.admin.query(`select count(*)::int n from vendor_actions where action = $1 and reason_code = 'authority_no_session'`, [o.fn])).rows[0].n as number;
  const holder = await conn(h.ownerUrl(), `hyg008b:hold:${o.fn}`);
  await holder.c.query("begin");
  await o.hold(holder.c);
  const pool = testPool({ connectionString: vendorUrl, max: 1 });
  try {
    const p = o.call(pool).catch((e: unknown) => e);
    await until(`${o.fn} waiting`, () => h.admin.query(
      `select pid from pg_stat_activity where query like $1 and wait_event_type = 'Lock' and pid <> pg_backend_pid()`, [`%${o.fn}(%`]).then((r) => r.rows[0]?.pid as number | undefined), (x) => x !== undefined);
    await signOut(o.tok);
    await holder.c.query("commit");
    expect(await p).toMatchObject({ ok: false, code: "ERR_FORBIDDEN", reason: "no_session" });
    expect(await o.effectAbsent(), `${o.fn}: effect absent`).toBe(true);
    const after = (await h.admin.query(`select count(*)::int n from vendor_actions where action = $1 and reason_code = 'authority_no_session'`, [o.fn])).rows[0].n as number;
    expect(after - before, `${o.fn}: one refusal row`).toBe(1);
    expect((await h.admin.query(`select tenant_id, object_id from vendor_actions where action = $1 and reason_code = 'authority_no_session' order by seq desc limit 1`, [o.fn])).rows[0])
      .toEqual({ tenant_id: o.tenant, object_id: o.object });
  } finally {
    await pool.end();
  }
}

describe("2.17 the planned wait schedules (one per kind of wait)", () => {
  it("(c) staff_state waits on the target staff row: refused, state unchanged", async () => {
    const acc = await account();
    const oc = await ownerPool.connect();
    let target: string;
    try {
      target = await createVendorStaff(oc, caller(PO), acc, "Sasaran", ["support"]);
    } finally {
      oc.release();
    }
    const tok = await session(PO2);
    await waitedRefusal({
      fn: "vendor_console_staff_state", tok,
      hold: async (c) => { await c.query("select 1 from vendor_staff where id = $1 for update", [target]); },
      call: (pool) => setMemberState(pool, { token: tok, ip: IP }, target, "suspended"),
      effectAbsent: async () => (await h.admin.query(`select state from vendor_staff where id = $1`, [target])).rows[0].state === "active",
      tenant: null, object: target,
    });
  });

  it("(d) staff_list waits on a pending invitation row (its expiry UPDATE): refused, no directory", async () => {
    const tok = await session(PO2);
    const invTok = await session(PO);
    const inv = await inviteMember(consoleDb, { token: invTok, ip: IP }, `calon${++n}@vendor-sintetis.test`, "Calon Staf", ["support"]);
    if (!inv.ok) throw new Error(JSON.stringify(inv));
    // Expire it (table owner, no guard on this column path) so the list's expiry UPDATE targets it.
    await expireInvitations("calon%");
    await waitedRefusal({
      fn: "vendor_console_staff_list", tok,
      hold: async (c) => { await c.query("select 1 from vendor_staff_invitations where state = 'pending' and expires_at <= now() for update"); },
      call: (pool) => listTeam(pool, { token: tok, ip: IP }),
      effectAbsent: async () => true, // a reader: the refusal itself is the absence of the directory
      tenant: null, object: null,
    });
  });

  it("(g) owner_invite_cancel waits on the invitation row: refused, invitation unchanged", async () => {
    const tenantId = await clinic();
    const reqTok = await session(ONB);
    const r = await requestOwnerInvite(consoleDb, { token: reqTok, ip: IP }, tenantId, "Pemilik Klinik", `pemilik${++n}@klinik-sintetis.test`);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const tok = await session(ONB);
    await waitedRefusal({
      fn: "vendor_console_owner_invite_cancel", tok,
      hold: async (c) => { await c.query("select 1 from tenant_owner_invitations where id = $1 for update", [r.data.invitation_id]); },
      call: (pool) => cancelOwnerInvite(pool, { token: tok, ip: IP }, r.data.invitation_id),
      effectAbsent: async () => (await h.admin.query(`select state from tenant_owner_invitations where id = $1`, [r.data.invitation_id])).rows[0].state === "pending",
      tenant: tenantId, object: r.data.invitation_id,
    });
  });

  it("(f) tenant_advance waits on tenants_registry inside the transition, then exits through its handler: refused, lifecycle unchanged", async () => {
    // Its staff_access wait comes BEFORE the guard (the guard then sees a sign-out itself and
    // answers no_session unlogged, T-021); the wait after the guard is the transition's row lock.
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('provisioning') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Baru', 'emkm')`, [tenantId]);
    // No approved processor agreement: the transition raises 42501 inside the protected section and
    // the function exits through its EXCEPTION handler. That handler exit is re-checked (it comes
    // after the protected section's row wait), so the sign-out still refuses it.
    const tok = await session(PO2);
    await waitedRefusal({
      fn: "vendor_console_tenant_advance", tok,
      hold: async (c) => { await c.query("select 1 from tenants_registry where id = $1 for update", [tenantId]); },
      call: (pool) => advanceTenant(pool, { token: tok, ip: IP }, tenantId, "onboarding", "Mulai onboarding klinik uji"),
      effectAbsent: async () => (await h.admin.query(`select lifecycle_state from tenants_registry where id = $1`, [tenantId])).rows[0].lifecycle_state === "provisioning",
      tenant: tenantId, object: tenantId,
    });
  });

  it("(k) support_open: the session insert waits on its foreign-key share of tenants_registry: refused, no session", async () => {
    const tenantId = await clinic();
    const tok = await session(SUP);
    await waitedRefusal({
      fn: "vendor_console_support_open", tok,
      hold: async (c) => { await c.query("select 1 from tenants_registry where id = $1 for update", [tenantId]); },
      call: (pool) => openSession(pool, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 }),
      effectAbsent: async () => (await h.admin.query(`select count(*)::int n from support_sessions where tenant_id = $1`, [tenantId])).rows[0].n === 0,
      tenant: tenantId, object: tenantId,
    });
  });

  it("(e) staff_invite waits on an expired invitation row (its expiry UPDATE): refused, no invitation", async () => {
    const invTok = await session(PO);
    const old = await inviteMember(consoleDb, { token: invTok, ip: IP }, `lama${++n}@vendor-sintetis.test`, "Calon Lama", ["support"]);
    if (!old.ok) throw new Error(JSON.stringify(old));
    await expireInvitations("lama%");
    const tok = await session(PO2);
    const email = `baru${++n}@vendor-sintetis.test`;
    await waitedRefusal({
      fn: "vendor_console_staff_invite", tok,
      hold: async (c) => { await c.query("select 1 from vendor_staff_invitations where state = 'pending' and expires_at <= now() for update"); },
      call: (pool) => inviteMember(pool, { token: tok, ip: IP }, email, "Calon Baru", ["support"]),
      effectAbsent: async () => (await h.admin.query(`select count(*)::int n from vendor_staff_invitations where email = $1`, [email])).rows[0].n === 0,
      tenant: null, object: null,
    });
  });
});

describe("handler exit: support_ticket's ticket_exists (a unique-key wait inside its protected section)", () => {
  it("a second ticket for the same transaction waits on the first's uncommitted insert; sign-out; first commits: refused no_session, not ticket_exists", async () => {
    const tenantId = await clinic();
    const tok = await session(SUP);
    const s = await openSession(consoleDb, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
    if (!s.ok) throw new Error(JSON.stringify(s));
    // The reader's transaction (an operator login) names itself; two console calls ask for its ticket.
    const reader = await conn(h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), "hyg008b:reader");
    await reader.c.query("begin");
    const tx = (await reader.c.query("select pg_backend_pid() pid, txid_current()::text txid")).rows[0] as { pid: number; txid: string };
    const first = await conn(vendorUrl, "hyg008b:ticket1");
    await first.c.query("begin");
    const r1 = (await first.c.query(`select vendor_console_support_ticket($1, $2, $3, $4, $5) as r`, [tok, IP, s.data.id, tx.pid, tx.txid])).rows[0].r;
    expect(r1).toMatchObject({ ok: true });
    const tok2Pool = testPool({ connectionString: vendorUrl, max: 1 });
    try {
      // The raw entry point (the wrapper's behaviour on this error is the first ticket test).
      const p = tok2Pool.query(`select vendor_console_support_ticket($1, $2, $3, $4, $5) as r`, [tok, IP, s.data.id, tx.pid, tx.txid]).then((r) => r.rows[0].r, (e: unknown) => e);
      await until("second ticket waiting on the first's insert", () => h.admin.query(
        `select pid from pg_stat_activity where query like '%vendor_console_support_ticket%' and wait_event_type = 'Lock' and pid <> $1`, [first.pid]).then((r) => r.rows[0]?.pid as number | undefined), (x) => x !== undefined);
      await signOut(tok);
      await first.c.query("commit");
      const e = (await p) as { code?: string; message?: string };
      // The handler caught unique_violation, then its exit's re-check raised (not caught): 42501.
      expect(e.code).toBe("42501");
      expect(e.message).toBe("ERR_FORBIDDEN: vendor_authority: no_session");
      expect((await h.admin.query(`select count(*)::int n from vendor_actions where action = 'vendor_console_support_ticket' and reason_code = 'ticket_exists'`)).rows[0].n).toBe(0);
    } finally {
      await tok2Pool.end();
      await reader.c.query("rollback").catch(() => {});
    }
  });
});

describe("2.5 A-01: removing the operator's last support role stops reads in a bound transaction", () => {
  it("the next SELECT returns no rows; removing one of two support roles keeps reads", async () => {
    const tenantId = await clinic();
    const acc = await account();
    const oc = await ownerPool.connect();
    let staffId: string;
    try {
      staffId = await createVendorStaff(oc, caller(PO), acc, "Dukungan Ganda", ["support", "onboarding"]);
    } finally {
      oc.release();
    }
    const tok = await session(acc);
    const s = await openSession(consoleDb, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
    if (!s.ok) throw new Error(JSON.stringify(s));
    const counts: number[] = [];
    await withSupportSession(consoleDb, opDb, { token: tok, ip: IP }, s.data.id, async (db) => {
      counts.push((await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n);
      const c = await ownerPool.connect();
      try {
        await updateVendorStaff(c, caller(PO), staffId, ["support"], "active"); // one of two removed
      } finally {
        c.release();
      }
      counts.push((await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n);
      const c2 = await ownerPool.connect();
      try {
        await updateVendorStaff(c2, caller(PO), staffId, ["vendor_finance"], "active"); // the last support-capable role removed
      } finally {
        c2.release();
      }
      counts.push((await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n);
    });
    expect(counts).toEqual([1, 1, 0]);
  });
});

describe("7b the operator predicate re-checks TOTP and the second-factor age per row", () => {
  for (const what of ["TOTP turned off", "second factor older than 12 h"] as const) {
    it(`${what}: reads stop in the bound transaction`, async () => {
      const tenantId = await clinic();
      const acc = await account();
      const oc = await ownerPool.connect();
      try {
        await createVendorStaff(oc, caller(PO), acc, "Dukungan T", ["support"]);
      } finally {
        oc.release();
      }
      const tok = await session(acc);
      const s = await openSession(consoleDb, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
      if (!s.ok) throw new Error(JSON.stringify(s));
      const counts: number[] = [];
      await withSupportSession(consoleDb, opDb, { token: tok, ip: IP }, s.data.id, async (db) => {
        counts.push((await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n);
        if (what === "TOTP turned off") await h.admin.query(`update auth_user set two_factor_enabled = false where id = $1`, [acc]);
        else await h.admin.query(`update auth_session set second_factor_at = now() - interval '13 hours' where token = $1`, [tok]);
        counts.push((await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n);
      });
      expect(counts).toEqual([1, 0]);
    });
  }

  it("9f: an allowlist entry removed while bound stops reads (the binding's address is re-checked)", async () => {
    const tenantId = await clinic();
    const acc = await account();
    const oc = await ownerPool.connect();
    try {
      await createVendorStaff(oc, caller(PO), acc, "Dukungan IP", ["support"]);
    } finally {
      oc.release();
    }
    const tok = await session(acc);
    const ip = "198.51.100.7";
    // Fixture: a second allowlist entry for this address (table owner), removed during the read.
    const entry = (await h.admin.query(`insert into vendor_ip_allowlist (cidr, label) values ('198.51.100.0/24', 'Rumah') returning id`)).rows[0].id as string;
    const s = await openSession(consoleDb, { token: tok, ip }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
    if (!s.ok) throw new Error(JSON.stringify(s));
    const counts: number[] = [];
    await withSupportSession(consoleDb, opDb, { token: tok, ip }, s.data.id, async (db) => {
      counts.push((await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n);
      await h.admin.query(`delete from vendor_ip_allowlist where id = $1`, [entry]);
      counts.push((await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n);
    });
    expect(counts).toEqual([1, 0]);
  });
});

describe("2.18 operator_row_read: a revocation during the read-record wait is seen", () => {
  it("reader B waits on reader A's uncommitted record of the same row; the session ends; B returns nothing", async () => {
    const tenantId = await clinic();
    const tok = await session(SUP);
    const s = await openSession(consoleDb, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
    if (!s.ok) throw new Error(JSON.stringify(s));
    let releaseA!: () => void;
    const aHeld = new Promise<void>((r) => (releaseA = r));
    let aRead!: () => void;
    const aDidRead = new Promise<void>((r) => (aRead = r));
    const pA = withSupportSession(consoleDb, opDb, { token: tok, ip: IP }, s.data.id, async (db) => {
      const n1 = (await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n; // A's record, uncommitted
      aRead();
      await aHeld;
      return n1;
    });
    await aDidRead;
    let bPid = 0;
    const pB = withSupportSession(consoleDb, opDb, { token: tok, ip: IP }, s.data.id, async (db) => {
      bPid = (await db.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      return (await db.query<{ n: number }>("select count(*)::int n from branches")).rows[0].n;
    });
    await until("reader B bound", async () => bPid, (x) => x > 0);
    await waitingOnLock(bPid);
    await h.admin.query(`select support_session_end($1, 'operator', null, null, null, 'support.expiry', null)`, [s.data.id]);
    releaseA();
    expect(await pA).toBe(1);
    expect(await pB).toBe(0);
  });
});

describe("2.6 A-03: the expiry sweep leaves a session extended while it waited", () => {
  it("extension commits during the sweep's staff_access wait -> still active; a really expired one is ended", async () => {
    const tenantId = await clinic();
    const tok = await session(SUP);
    const keep = await openSession(consoleDb, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang atas permintaan klinik", scope: ["public.branches"], minutes: 30 });
    const end = await openSession(consoleDb, { token: tok, ip: IP }, { tenantId, purpose: "Memeriksa pengaturan cabang kedua klinik ini", scope: ["public.branches"], minutes: 30 });
    if (!keep.ok || !end.ok) throw new Error("open");
    // Fixture (table owner, guard disabled in its own transaction): both past their end.
    const g = await ownerPool.connect();
    try {
      await g.query("begin");
      await g.query("alter table support_sessions disable trigger support_sessions_guard");
      await g.query("update support_sessions set ends_at = now() - interval '1 minute' where id = any($1)", [[keep.data.id, end.data.id]]);
      await g.query("alter table support_sessions enable trigger support_sessions_guard");
      await g.query("commit");
    } finally {
      g.release();
    }
    // The "extension": holds staff_access and sets a future end for one session, uncommitted.
    const ext = await conn(h.ownerUrl(), "hyg008b:extension");
    await ext.c.query("begin");
    await ext.c.query("select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))", [tenantId]);
    await ext.c.query("alter table support_sessions disable trigger support_sessions_guard");
    await ext.c.query("update support_sessions set ends_at = now() + interval '30 minutes' where id = $1", [keep.data.id]);
    await ext.c.query("alter table support_sessions enable trigger support_sessions_guard");
    const sw = await conn(h.ownerUrl(), "hyg008b:sweep");
    const p = sw.c.query("select support_session_expire() as n");
    await waitingOnLock(sw.pid);
    await ext.c.query("commit");
    await p;
    const st = (await h.admin.query(`select id, state from support_sessions where id = any($1)`, [[keep.data.id, end.data.id]])).rows as { id: string; state: string }[];
    expect(st.find((x) => x.id === keep.data.id)?.state).toBe("active");
    expect(st.find((x) => x.id === end.data.id)?.state).toBe("ended");
  });
});

describe("2.8 B-01/B-03: the operator's columns are within the app's", () => {
  it("every column clinic_operator can select is selectable by clinic_app; the three secret columns are denied", async () => {
    const wider = (await h.admin.query(
      `select c.relname || '.' || a.attname as col
         from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
         join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.relkind = 'r'
          and has_column_privilege('clinic_operator', c.oid, a.attnum, 'SELECT')
          and not has_column_privilege('clinic_app', c.oid, a.attnum, 'SELECT')`)).rows.map((r) => r.col as string);
    expect(wider).toEqual([]);
    const denied = (await h.admin.query(
      `select has_column_privilege('clinic_operator', 'public.evidence_files', 'content', 'SELECT') a,
              has_column_privilege('clinic_operator', 'public.staff_invitations', 'token_hash', 'SELECT') b,
              has_column_privilege('clinic_operator', 'public.evidence_approvals', 'seq', 'SELECT') c`)).rows[0];
    expect(denied).toEqual({ a: false, b: false, c: false });
  });
});

describe("the six actor-id vendor writers stay unreachable from the console", () => {
  it("clinic_vendor has no EXECUTE on any of them", async () => {
    const r = (await h.admin.query(
      `select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
        where p.proname in ('vendor_staff_create','vendor_staff_update','vendor_ip_allowlist_set','vendor_request','vendor_request_decide','vendor_request_cancel','vendor_staff_update_checked')
          and has_function_privilege('clinic_vendor', p.oid, 'EXECUTE')`)).rows;
    expect(r).toEqual([]);
  });
});

describe("structural: every vendor console entry point re-checks before each exit after its guard", () => {
  it("re-check placement and readers that return a built variable", async () => {
    const fns = (await h.admin.query(
      `select p.proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
        where p.proname like 'vendor_console\\_%' order by 1`)).rows as { proname: string; d: string }[];
    const helpers = new Set(["vendor_console_guard", "vendor_console_writer", "vendor_console_ip_allowed"]);
    const listed = fns.map((f) => f.proname).filter((x) => !helpers.has(x));
    // The inventory in 0049's header plus T-027's two (0051) (fails when an entry point is added without a decision).
    expect(listed).toEqual([
      "vendor_console_checklist", "vendor_console_checklist_set", "vendor_console_me", "vendor_console_onboarding_access", "vendor_console_onboarding_invite", "vendor_console_owner_invite",
      "vendor_console_owner_invite_approve", "vendor_console_owner_invite_cancel", "vendor_console_staff_invite", "vendor_console_staff_invite_cancel",
      "vendor_console_staff_list", "vendor_console_staff_state", "vendor_console_support_end", "vendor_console_support_extend",
      "vendor_console_support_list", "vendor_console_support_open", "vendor_console_support_ticket", "vendor_console_tenant_advance",
      "vendor_console_tenant_create", "vendor_console_tenant_detail", "vendor_console_tenants",
    ]);
    for (const { proname, d } of fns) {
      if (helpers.has(proname)) continue;
      if (proname === "vendor_console_staff_state") {
        expect(d, proname).toContain("vendor_staff_update_checked(p_token,");
        continue;
      }
      // Lines after the guard's refusal exit: EVERY RETURN, including an EXCEPTION handler's (a
      // RAISE there propagates out; only a protected section is caught by its handler), is
      // preceded by a re-check; no RETURN sits inside a protected section (between a nested BEGIN
      // and its EXCEPTION), where the handler could catch the re-check; and no data-reading
      // RETURN (SELECT ...) follows a re-check.
      const lines = d.split("\n");
      const guard = lines.findIndex((l) => /^\s*IF (g|w|c)\.refusal IS NOT NULL THEN/.test(l));
      expect(guard, `${proname}: guard exit`).toBeGreaterThan(0);
      let protectedSection = false;
      for (let i = guard + 3; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === "BEGIN") protectedSection = true;
        if (t.startsWith("EXCEPTION")) protectedSection = false;
        if (/^PERFORM public\.vendor_authority_recheck\(/.test(t)) expect(protectedSection, `${proname} line ${i}: re-check inside a protected section`).toBe(false);
        if (/^RETURN\b/.test(t)) {
          expect(lines[i - 1].trim(), `${proname} line ${i}: re-check before "${t.slice(0, 60)}"`).toMatch(/^PERFORM public\.vendor_authority_recheck\(p_token, p_ip,/);
          expect(t, `${proname}: reads after its re-check`).not.toMatch(/\(SELECT /);
        }
      }
    }
  });
});
