// T-025 Done-when (PR-53, TEN-6, TEN-14, TEN-17, TEN-19): scenario PR-53 (a session opened
// with a reason ends at its time limit and the owner sees it in the audit log); RLS for the
// operator role per policy kind in use (tenant-shared, tenant-ledger): in scope, out of
// scope, other tenant, expired, ended, unbound, forged settings; scope rules (TTL ≤ 2 h, one
// extension with a new reason, personal/clinical scope waits for the owner); roles, step-up,
// logging; owner ends a session; every tenant table has an operator class and policy.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, OPERATOR_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { bootstrapVendor, createVendorStaff, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import {
  endSession, endSessionAsOwner, expireSessions, extendSession, listSessions, openSession, SupportBindError, withSupportSession,
} from "../../src/modules/vendor/support/support";
import { createHarness, type Harness } from "../rls/harness";

const ROOT = join(import.meta.dirname, "../..");
let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let consoleDb: pg.Pool;
let opDb: pg.Pool;
let exec: pg.Pool;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

async function account(totp = true): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [`sup${++n}@vendor-sintetis.test`, totp])).rows[0].id as string;
}
async function session(acc: string, mfaAgo = "0 minutes"): Promise<string> {
  const tok = `tok${++n}${randomBytes(12).toString("hex")}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`, [acc, tok, mfaAgo]);
  return tok;
}
const as = (token: string, ip = IP) => ({ token, ip });
const lastAction = async () => (await h.admin.query(`select action, outcome, reason_code, tenant_id from vendor_actions order by seq desc limit 1`)).rows[0];
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof CommandError ? e.code : e instanceof SupportBindError ? e.reason : (e as { code?: string }).code ?? String(e)));

type Clinic = { tenantId: string; branchId: string; ownerAcc: string; adminAcc: string };
async function clinic(state = "live"): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT Klinik Sintetis ${++n}`]);
  const branchId = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang Satu', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  const member = async (role: "owner" | "admin_pusat") => {
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('C', $1) returning id`, [`klinik${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${n}` });
    await assignRole(h.admin, { tenantId, staffId, role });
    return acc;
  };
  const ownerAcc = await member("owner");
  const adminAcc = await member("admin_pusat");
  return { tenantId, branchId, ownerAcc, adminAcc };
}
const asOwner = async <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, c.ownerAcc, { tenantId: c.tenantId, actingRole: "owner" }), fn);
const asAdmin = async <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, c.adminAcc, { tenantId: c.tenantId, actingRole: "admin_pusat" }), fn);
async function open(tok: string, c: Clinic, scope: string[], minutes = 60, purpose = "Memeriksa pengaturan cabang atas permintaan klinik") {
  const r = await openSession(consoleDb, as(tok), { tenantId: c.tenantId, purpose, scope, minutes });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.data;
}
// Count rows visible through the session (one bound transaction).
const read = (tok: string, sessionId: string, table: string) =>
  withSupportSession(consoleDb, opDb, as(tok), sessionId, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n);
// The reader's transaction, as it names itself to the console (pid, txid).
async function txOf(c: pg.PoolClient): Promise<[number, string]> {
  const r = (await c.query(`select pg_backend_pid() pid, txid_current()::text txid`)).rows[0];
  return [r.pid, r.txid];
}
// A bind ticket from the console for the reader's open transaction (committed on its own).
async function ticketRaw(tok: string, sessionId: string, tx: [number, string]) {
  return (await consoleDb.query(`select vendor_console_support_ticket($1, $2, $3, $4, $5) as r`, [tok, IP, sessionId, tx[0], tx[1]])).rows[0].r;
}
async function ticket(c: pg.PoolClient, tok: string, sessionId: string): Promise<string> {
  const r = await ticketRaw(tok, sessionId, await txOf(c));
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.ticket as string;
}
async function setEnds(sessionId: string, sql: string) {
  await h.admin.query(`alter table support_sessions disable trigger support_sessions_guard`);
  await h.admin.query(`update support_sessions set ${sql} where id = $1`, [sessionId]);
  await h.admin.query(`alter table support_sessions enable trigger support_sessions_guard`);
}

let PO: string; let SUP: string; let SUP2: string; let FIN: string;
let poTok: string; let supTok: string; let sup2Tok: string; let finTok: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 3 });
  consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
  opDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 3 }, OPERATOR_GROUP_ROLE);
  exec = new pg.Pool({ connectionString: h.urlAs(await h.createLoginRole("", ["clinic_executor"])), max: 1 });
  const c = await owner.connect();
  try {
    PO = await account();
    await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    SUP = await account();
    SUP2 = await account();
    FIN = await account();
    await createVendorStaff(c, caller(PO), SUP, "Dukungan Satu", ["support"]);
    await createVendorStaff(c, caller(PO), SUP2, "Dukungan Dua", ["support"]);
    await createVendorStaff(c, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  } finally {
    c.release();
  }
  poTok = await session(PO); supTok = await session(SUP); sup2Tok = await session(SUP2); finTok = await session(FIN);
});
afterAll(async () => {
  await exec?.end();
  await opDb?.end();
  await consoleDb?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-53 support session", () => {
  it("opened with a reason for tenant A, it ends at its time limit and A's owner sees it in the audit log", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches", "public.evidence_items"], 30);
    expect(s.state).toBe("active");
    expect(await read(supTok, s.id, "branches")).toBe(1);
    // The time limit passes; reads stop at once (the predicate uses the wall clock) …
    await setEnds(s.id, `activated_at = activated_at - interval '31 minutes', ends_at = ends_at - interval '31 minutes'`);
    expect(await code(read(supTok, s.id, "branches"))).toBe("not_active");
    // … and the expiry sweep ends it in the record.
    const worker = await exec.connect();
    try {
      expect(await expireSessions(worker)).toBeGreaterThanOrEqual(1);
    } finally {
      worker.release();
    }
    expect((await h.admin.query(`select state, end_reason from support_sessions where id = $1`, [s.id])).rows[0]).toEqual({ state: "ended", end_reason: "expired" });
    // A's owner reads the audit log (RLS as the owner): opened, the read (its bind ticket), the
    // refused read after the time limit, ended by expiry.
    const rows = await asOwner(a, async (db) => (await db.query(`select object_kind, reason_code, outcome from audit_events where object_id = $1 order by seq`, [s.id])).rows);
    expect(rows.map((r) => [r.reason_code, r.outcome])).toEqual([["active", "success"], ["ticket_issued", "success"], ["not_active", "denied"], ["ended_expired", "success"]]);
  });
});

describe("operator RLS (TEN-17): in scope, out of scope, other tenant, expired, ended, unbound, forged", () => {
  it("tenant-shared: only the declared tables of the session's tenant are visible", async () => {
    const a = await clinic();
    const b = await clinic();
    const s = await open(supTok, a, ["public.branches", "public.evidence_items"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      expect((await db.query(`select tenant_id from branches`)).rows.map((r) => r.tenant_id)).toEqual([a.tenantId]);
      expect((await db.query(`select count(*)::int n from tenants`)).rows[0].n).toBe(0); // not in scope
      expect((await db.query(`select count(*)::int n from branches where tenant_id = $1`, [b.tenantId])).rows[0].n).toBe(0);
      // Forging the settings to the other tenant inside the bound transaction reads nothing.
      await db.query(`select set_config('app.tenant_id', $1, true)`, [b.tenantId]);
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
    });
    // A personal table is refused at open time unless the owner approves (pending, unbindable).
    const p = await open(supTok, a, ["public.staff"]);
    expect(p.state).toBe("pending_approval");
    expect(await code(read(supTok, p.id, "staff"))).toBe("awaiting_owner");
  });

  it("a session that expires inside a bound transaction stops reading at once (the predicate judges the wall clock)", { timeout: 30_000 }, async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"], 30);
    await setEnds(s.id, `ends_at = clock_timestamp() + interval '2 seconds'`);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(1);
      await new Promise((r) => setTimeout(r, 2_500));
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
    });
  });

  it("a forged session id or settings without a bind read nothing; nothing is writable; never-class and platform tables are not readable", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const c = await opDb.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.operator_session_id', $2, true), set_config('app.session_scope', 'public.branches', true)`, [a.tenantId, s.id]);
      expect((await c.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
      await c.query("rollback");
      // Bound in one transaction, the next transaction on the same connection sees nothing.
      await c.query("begin");
      const t1 = await ticket(c, supTok, s.id);
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t1])).rows[0].r).toMatchObject({ ok: true });
      expect((await c.query(`select count(*)::int n from branches`)).rows[0].n).toBe(1);
      await c.query("commit");
      await c.query("begin");
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.operator_session_id', $2, true)`, [a.tenantId, s.id]);
      expect((await c.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
      await c.query("rollback");
      await c.query("begin");
      const t2 = await ticket(c, supTok, s.id);
      await c.query(`select support_session_bind($1, $2, $3, $4)`, [supTok, IP, s.id, t2]);
      for (const q of [`update branches set name = 'X'`, `insert into branches (tenant_id, code, name, timezone) values ('${a.tenantId}', 'Z', 'Z', 'Asia/Jakarta')`, `delete from branches`]) {
        await c.query("savepoint w");
        await expect(c.query(q), q).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback to savepoint w");
      }
      for (const q of [`select 1 from idempotency_records limit 1`, `select 1 from support_sessions limit 1`, `select 1 from vendor_staff limit 1`, `select 1 from auth_user limit 1`]) {
        await c.query("savepoint w");
        await expect(c.query(q), q).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback to savepoint w");
      }
      await c.query("rollback");
    } finally {
      c.release();
    }
  });

  it("tenant-ledger (domain_events) is class never: not in any scope; ended sessions read nothing; only the opener can bind", async () => {
    const a = await clinic();
    expect(await openSession(consoleDb, as(supTok), { tenantId: a.tenantId, purpose: "Memeriksa antrean peristiwa klinik", scope: ["public.domain_events"], minutes: 30 }))
      .toMatchObject({ ok: false, reason: "not_supportable" });
    const s = await open(supTok, a, ["public.branches"]);
    expect(await code(read(sup2Tok, s.id, "branches"))).toBe("not_opener");
    expect(await lastAction()).toMatchObject({ action: "support_bind", outcome: "denied", reason_code: "not_opener" });
    expect(await endSession(consoleDb, as(supTok), s.id)).toMatchObject({ ok: true });
    expect(await code(read(supTok, s.id, "branches"))).toBe("not_active");
  });
});

describe("review round 1: revocation, reads recorded, pool safety, pending and closed", () => {
  it("the Owner ends a session while a bound read transaction is open: the end returns at once and the next read sees nothing", { timeout: 30_000 }, async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(1);
      const t0 = Date.now();
      await asOwner(a, (o) => endSessionAsOwner(o, s.id));
      expect(Date.now() - t0).toBeLessThan(3_000);
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
    });
  });

  it("an operator deactivated or signed out mid-transaction stops reading at once", { timeout: 30_000 }, async () => {
    const a = await clinic();
    const opAcc = await account();
    const c = await owner.connect();
    let staffId: string;
    try {
      staffId = await createVendorStaff(c, caller(PO), opAcc, "Dukungan Sementara", ["support"]);
    } finally {
      c.release();
    }
    const tok = await session(opAcc);
    const s = await open(tok, a, ["public.branches"]);
    await withSupportSession(consoleDb, opDb, as(tok), s.id, async (db) => {
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(1);
      await h.admin.query(`update vendor_staff set state = 'suspended' where id = $1`, [staffId]);
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
    });
    // Signed out (session row gone), locked, or expired: each stops reads at once.
    for (const revoke of [
      (t: string) => h.admin.query(`delete from auth_session where token = $1`, [t]),
      (t: string) => h.admin.query(`update auth_session set locked_at = now() where token = $1`, [t]),
      (t: string) => h.admin.query(`update auth_session set expires_at = now() - interval '1 second' where token = $1`, [t]),
    ]) {
      const tok2 = await session(SUP);
      const s2 = await open(tok2, a, ["public.branches"]);
      await withSupportSession(consoleDb, opDb, as(tok2), s2.id, async (db) => {
        expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(1);
        await revoke(tok2);
        expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
      });
    }
  });

  it("a tenant closed mid-session stops reads at once; the sweep ends its open sessions (tenant_closed)", { timeout: 30_000 }, async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const p = await open(supTok, a, ["public.staff"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(1);
      await h.admin.query(`update tenants_registry set lifecycle_state = 'closed' where id = $1`, [a.tenantId]);
      expect((await db.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
    });
    const worker = await exec.connect();
    try {
      await expireSessions(worker);
    } finally {
      worker.release();
    }
    expect((await h.admin.query(`select id, end_reason from support_sessions where id in ($1, $2) order by id`, [s.id, p.id])).rows.map((r) => r.end_reason)).toEqual(["tenant_closed", "tenant_closed"]);
  });

  it("a bound transaction cannot be held open: statement and idle time are capped", { timeout: 90_000 }, async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      const t = (await db.query(`select current_setting('statement_timeout') st, current_setting('idle_in_transaction_session_timeout') it`)).rows[0];
      expect(t).toEqual({ st: "30s", it: "1min" });
    });
    // The settings are transaction-local: the next transaction on the pool has the defaults.
    const c = await opDb.connect();
    try {
      expect((await c.query(`select current_setting('statement_timeout') st`)).rows[0].st).toBe("0");
    } finally {
      c.release();
    }
  });

  it("rows the operator's queries touch are recorded once per session; rows a leakproof filter removes first are not", async () => {
    const a = await clinic();
    await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B2', 'Cabang Dua', 'Asia/Jakarta')`, [a.tenantId]);
    const s = await open(supTok, a, ["public.branches"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      expect((await db.query(`select id from branches where code = 'B1'`)).rows).toHaveLength(1);
    });
    // Only the row the query returned is listed: text = is leakproof, so the filter runs before
    // the policy. A non-leakproof filter, LIMIT or an aggregate records more (DEC-038).
    expect((await h.admin.query(`select table_name, count(*)::int n from support_session_reads where session_id = $1 group by 1`, [s.id])).rows).toEqual([{ table_name: "public.branches", n: 1 }]);
    // Read everything twice: each record listed once.
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => db.query(`select * from branches`));
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => db.query(`select * from branches`));
    expect((await h.admin.query(`select count(*)::int n from support_session_reads where session_id = $1`, [s.id])).rows[0].n).toBe(2);
    // An unbound transaction records nothing.
    const c = await opDb.connect();
    try {
      await c.query(`select count(*) from branches`);
    } finally {
      c.release();
    }
    expect((await h.admin.query(`select count(*)::int n from support_session_reads where session_id = $1`, [s.id])).rows[0].n).toBe(2);
    // Each read's bind ticket is in the vendor log.
    expect((await h.admin.query(`select count(*)::int n from vendor_actions where action = 'support_bind' and outcome = 'success' and object_id = $1`, [s.id])).rows[0].n).toBe(3);
  });

  it("an error thrown by fn after a bind never returns a bound connection to the pool", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const single = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 1 }, OPERATOR_GROUP_ROLE);
    try {
      await expect(withSupportSession(consoleDb, single, as(supTok), s.id, async () => {
        throw new SupportBindError("thrown_by_fn");
      })).rejects.toThrow(/thrown_by_fn/);
      const c = await single.connect();
      try {
        expect((await c.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
        expect((await c.query(`select coalesce(current_setting('app.operator_session_id', true), '') v`)).rows[0].v).toBe("");
      } finally {
        c.release();
      }
    } finally {
      await single.end();
    }
  });

  it("approvals and setting_versions are personal (owner approval first); a pending session can be ended by its opener and the Owner", async () => {
    const a = await clinic();
    for (const t of ["public.approvals", "public.setting_versions"]) {
      expect((await open(supTok, a, [t])).state, t).toBe("pending_approval");
    }
    const p1 = await open(supTok, a, ["public.staff"]);
    expect(await endSession(consoleDb, as(supTok), p1.id)).toMatchObject({ ok: true });
    const p2 = await open(supTok, a, ["public.staff"]);
    await asOwner(a, (db) => endSessionAsOwner(db, p2.id));
    expect((await h.admin.query(`select state, activated_at, end_reason from support_sessions where id in ($1, $2) order by id`, [p1.id, p2.id])).rows)
      .toEqual([{ state: "ended", activated_at: null, end_reason: "operator" }, { state: "ended", activated_at: null, end_reason: "owner" }]);
    expect(await code(read(supTok, p2.id, "staff"))).toBe("not_active");
  });
});

describe("review round 2: isolation level, durable bind ticket, tenant-leading policies", () => {
  it("a bind outside READ COMMITTED is refused and logged (a snapshot would miss a revocation)", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const c = await opDb.connect();
    try {
      for (const level of ["repeatable read", "serializable"]) {
        await c.query(`begin isolation level ${level}`);
        const t = await ticket(c, supTok, s.id);
        expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r, level)
          .toMatchObject({ ok: false, reason: "isolation_not_read_committed" });
        expect((await c.query(`select count(*)::int n from branches`)).rows[0].n, level).toBe(0);
        await c.query("commit");
        // The ticket named that (finished) transaction: it binds no later one.
        await c.query("begin isolation level read committed");
        expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r).toMatchObject({ ok: false, reason: "no_ticket" });
        await c.query("rollback");
      }
      // Through SET default_transaction_isolation as well.
      await c.query(`set default_transaction_isolation = 'repeatable read'`);
      await c.query("begin");
      const t = await ticket(c, supTok, s.id);
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r).toMatchObject({ ok: false, reason: "isolation_not_read_committed" });
      await c.query("commit");
      await c.query(`reset default_transaction_isolation`);
    } finally {
      c.release();
    }
    // Logged to the vendor log only (never the tenant chain from a read transaction); each
    // attempt's ticket is in the tenant chain.
    expect((await h.admin.query(`select count(*)::int n from vendor_actions where object_id = $1 and reason_code = 'isolation_not_read_committed' and tenant_id is null`, [s.id])).rows[0].n).toBe(3);
    expect((await h.admin.query(`select count(*)::int n from audit_events where object_id = $1 and reason_code = 'ticket_issued'`, [s.id])).rows[0].n).toBe(3);
  });

  it("every read transaction leaves a committed trace: a reader's rollback keeps the ticket in the vendor log and the tenant chain", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const c = await opDb.connect();
    try {
      await c.query("begin");
      const t = await ticket(c, supTok, s.id);
      await c.query(`select support_session_bind($1, $2, $3, $4)`, [supTok, IP, s.id, t]);
      await c.query("savepoint x");
      expect((await c.query(`select count(*)::int n from branches`)).rows[0].n).toBe(1);
      await c.query("rollback to savepoint x");
      await c.query("rollback");
      // Replay after the reader's rollback (round 3): the ticket named the dead transaction.
      await c.query("begin");
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r).toMatchObject({ ok: false, reason: "no_ticket" });
      expect((await c.query(`select count(*)::int n from branches`)).rows[0].n).toBe(0);
      await c.query("commit");
      // Bind rolled back to a savepoint taken before it: the ticket is consumable again, but only
      // in the same transaction (the one its trace names).
      await c.query("begin");
      const t2 = await ticket(c, supTok, s.id);
      await c.query("savepoint before_bind");
      await c.query(`select support_session_bind($1, $2, $3, $4)`, [supTok, IP, s.id, t2]);
      await c.query("rollback to savepoint before_bind");
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t2])).rows[0].r).toMatchObject({ ok: true });
      await c.query("rollback");
    } finally {
      c.release();
    }
    // The touched rows went with the rollback (accepted residual risk, DEC-038) …
    expect((await h.admin.query(`select count(*)::int n from support_session_reads where session_id = $1`, [s.id])).rows[0].n).toBe(0);
    // … the bind tickets did not: one committed trace per read transaction, visible to the Owner.
    const rows = await asOwner(a, async (db) => (await db.query(`select reason_code from audit_events where object_id = $1 order by seq`, [s.id])).rows);
    expect(rows.map((r) => r.reason_code)).toEqual(["active", "ticket_issued", "ticket_issued"]);
  });

  it("a ticket names one in-progress transaction: not a finished, future, foreign-backend or already-ticketed one", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const c = await opDb.connect();
    const d = await opDb.connect();
    try {
      await c.query("begin");
      const tx = await txOf(c);
      await c.query("commit");
      expect(await ticketRaw(supTok, s.id, tx)).toMatchObject({ ok: false, reason: "invalid_input" }); // finished
      expect(await ticketRaw(supTok, s.id, [tx[0], String(BigInt(tx[1]) + BigInt(1_000_000))])).toMatchObject({ ok: false, reason: "invalid_input" }); // future
      await c.query("begin");
      const live = await txOf(c);
      expect(await ticketRaw(supTok, s.id, live)).toMatchObject({ ok: true });
      expect(await ticketRaw(supTok, s.id, live)).toMatchObject({ ok: false, reason: "ticket_exists" }); // one per transaction
      // The pair must be a live transaction of that backend, on a support-reader login.
      await d.query("begin");
      const other = await txOf(d);
      expect(await ticketRaw(supTok, s.id, [live[0], other[1]])).toMatchObject({ ok: false, reason: "invalid_input" }); // d's txid, c's pid
      await d.query("rollback");
      const ac = await app.connect();
      try {
        await ac.query("begin");
        const appTx = (await ac.query(`select pg_backend_pid() pid, txid_current()::text txid`)).rows[0];
        expect(await ticketRaw(supTok, s.id, [appTx.pid, appTx.txid])).toMatchObject({ ok: false, reason: "invalid_input" }); // not an operator login
        await ac.query("rollback");
      } finally {
        ac.release();
      }
      // A ticket for c's transaction cannot be used from another backend's transaction.
      const t = (await h.admin.query(`select id from support_bind_tickets where txid = $1`, [live[1]])).rows[0].id;
      await d.query("begin");
      expect((await d.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r).toMatchObject({ ok: false, reason: "no_ticket" });
      await d.query("commit");
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r).toMatchObject({ ok: true });
      await c.query("rollback");
    } finally {
      c.release();
      d.release();
    }
  });

  it("a ticket binds once, only for its session, operator and login session, and only before it expires", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const s2 = await open(supTok, a, ["public.evidence_items"]);
    const c = await opDb.connect();
    // Each attempt in its own transaction with a ticket for it (refusals are committed).
    const attempt = async (tok: string, sid: string, pick: (own: string) => string, issuer = supTok, issueFor = s.id) => {
      await c.query("begin");
      try {
        const own = await ticket(c, issuer, issueFor);
        return (await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [tok, IP, sid, pick(own)])).rows[0].r;
      } finally {
        await c.query("commit");
      }
    };
    try {
      expect(await attempt(supTok, s.id, () => crypto.randomUUID())).toMatchObject({ ok: false, reason: "no_ticket" });
      expect(await attempt(supTok, s2.id, (own) => own)).toMatchObject({ ok: false, reason: "no_ticket" }); // another session's ticket
      const otherLogin = await session(SUP);
      expect(await attempt(otherLogin, s.id, (own) => own)).toMatchObject({ ok: false, reason: "no_ticket" }); // same operator, other login
      // Used: a ticket consumed in this transaction does not bind again in it.
      await c.query("begin");
      const t = await ticket(c, supTok, s.id);
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r).toMatchObject({ ok: true });
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, t])).rows[0].r).toMatchObject({ ok: false, reason: "no_ticket" });
      await c.query("commit");
      // Expired.
      await c.query("begin");
      const old = await ticket(c, supTok, s.id);
      await h.admin.query(`alter table support_bind_tickets disable trigger support_bind_tickets_guard`);
      await h.admin.query(`update support_bind_tickets set issued_at = issued_at - interval '3 minutes', expires_at = expires_at - interval '3 minutes' where id = $1`, [old]);
      await h.admin.query(`alter table support_bind_tickets enable trigger support_bind_tickets_guard`);
      expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [supTok, IP, s.id, old])).rows[0].r).toMatchObject({ ok: false, reason: "no_ticket" });
      await c.query("commit");
    } finally {
      c.release();
    }
    expect(await lastAction()).toMatchObject({ action: "support_bind", outcome: "denied", reason_code: "no_ticket" });
    // Another operator gets no ticket for the session (not the opener), and tickets are never rewritten or deleted.
    const c2 = await opDb.connect();
    try {
      await c2.query("begin");
      expect(await ticketRaw(sup2Tok, s.id, await txOf(c2))).toMatchObject({ ok: false, reason: "not_opener" });
      await c2.query("rollback");
    } finally {
      c2.release();
    }
    for (const q of [`update support_bind_tickets set used_at = null where session_id = '${s.id}' and used_at is not null`, `delete from support_bind_tickets where session_id = '${s.id}'`,
      `update support_bind_tickets set expires_at = expires_at + interval '1 minute' where session_id = '${s.id}' and used_at is null`,
      `update support_bind_tickets set used_at = now(), txid = txid + 1 where session_id = '${s.id}' and used_at is null`,
      `update support_bind_tickets set used_at = now(), backend_pid = backend_pid + 1 where session_id = '${s.id}' and used_at is null`]) {
      await expect(h.admin.query(q), q).rejects.toMatchObject({ code: "42501" });
    }
    await expect(opDb.query(`select vendor_console_support_ticket($1, $2, $3, 1, 1)`, [supTok, IP, s.id])).rejects.toMatchObject({ code: "42501" });
  });

  it("a bind refused after its ticket was issued (session ended in between): the ticket is in the tenant chain, the refusal in the vendor log", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    // The session ends between the ticket (console) and the bind (operator connection).
    const racing = { query: async (q: string, v: unknown[]) => {
      const r = await consoleDb.query(q, v);
      await endSession(consoleDb, as(supTok), s.id);
      return r;
    } } as unknown as pg.Pool;
    expect(await code(withSupportSession(racing, opDb, as(supTok), s.id, async () => 1))).toBe("not_active");
    expect((await h.admin.query(`select reason_code, outcome from audit_events where object_id = $1 order by seq`, [s.id])).rows.map((r) => r.reason_code))
      .toEqual(["active", "ticket_issued", "ended_operator"]);
    expect(await lastAction()).toMatchObject({ action: "support_bind", outcome: "denied", reason_code: "not_active", tenant_id: null });
  });

  it("operator_row_read called directly admits nothing for another tenant or an unbound transaction", async () => {
    const a = await clinic();
    const b = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      expect((await db.query(`select operator_row_read('public.branches', $1, $2) as r`, [b.tenantId, b.branchId])).rows[0].r).toBe(false);
      expect((await db.query(`select operator_row_read('public.branches', $1, $2) as r`, [a.tenantId, a.branchId])).rows[0].r).toBe(true);
    });
    expect((await h.admin.query(`select row_id from support_session_reads where session_id = $1`, [s.id])).rows.map((r) => r.row_id)).toEqual([a.branchId]);
  });

  it("the bind re-checks the opener and a pending scope even with a ticket on record (defence in depth)", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    const p = await open(supTok, a, ["public.staff"]);
    const sup2Staff = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [SUP2])).rows[0].id;
    const supStaff = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [SUP])).rows[0].id;
    // Tickets written directly (as if issued before a change): another operator's, and one for a pending session.
    const c = await opDb.connect();
    const forge = async (sid: string, staff: string, tok: string) => {
      const [pid, txid] = await txOf(c);
      return (await h.admin.query(
        `insert into support_bind_tickets (session_id, staff_id, auth_session_id, backend_pid, txid, issued_at, expires_at)
         select $1, $2, a.id, $4, $5, clock_timestamp(), clock_timestamp() + interval '1 minute' from auth_session a where a.token = $3 returning id`, [sid, staff, tok, pid, txid])).rows[0].id as string;
    };
    try {
      for (const [tok, sid, staff, reason] of [[sup2Tok, s.id, sup2Staff, "not_opener"], [supTok, p.id, supStaff, "awaiting_owner"]]) {
        await c.query("begin");
        const tid = await forge(sid, staff, tok);
        expect((await c.query(`select support_session_bind($1, $2, $3, $4) as r`, [tok, IP, sid, tid])).rows[0].r).toMatchObject({ ok: false, reason });
        await c.query("commit");
      }
    } finally {
      c.release();
    }
  });

  it("no role is both a support reader and a console, app or auth role (review round 3, LOW-5)", async () => {
    const both = (await h.admin.query(`
      select r.rolname from pg_roles r
       where pg_has_role(r.oid, 'clinic_operator', 'member')
         and (pg_has_role(r.oid, 'clinic_vendor', 'member') or pg_has_role(r.oid, 'clinic_app', 'member') or pg_has_role(r.oid, 'clinic_auth', 'member'))
         and not r.rolsuper`)).rows;
    expect(both).toEqual([]);
    const opRole = (await h.admin.query(`select rolinherit, rolcanlogin, rolbypassrls from pg_roles where rolname = 'clinic_operator'`)).rows[0];
    expect(opRole).toMatchObject({ rolcanlogin: false, rolbypassrls: false });
  });

  it("every operator policy compares the tenant before calling the per-row function", async () => {
    const quals = (await h.admin.query(`select tablename, qual from pg_policies where 'clinic_operator' = any (roles)`)).rows;
    expect(quals.length).toBeGreaterThan(0);
    for (const q of quals) {
      expect(q.qual, q.tablename).toMatch(new RegExp(`^\\(\\(${q.tablename === "tenants" ? "id" : "tenant_id"} = app_tenant_id\\(\\)\\) AND operator_row_read\\(`));
    }
  });
});

describe("scope rules (TEN-14)", () => {
  it("TTL 5–120 minutes; purpose 10–500; known supportable tables only; a closed tenant refused; every refusal logged", async () => {
    const a = await clinic();
    for (const [scope, minutes, purpose] of [[["public.branches"], 121, "Memeriksa pengaturan"], [["public.branches"], 4, "Memeriksa pengaturan"], [["public.branches"], 30, "pendek"], [[], 30, "Memeriksa pengaturan"]] as [string[], number, string][]) {
      expect(await openSession(consoleDb, as(supTok), { tenantId: a.tenantId, purpose, scope, minutes }), JSON.stringify([scope, minutes])).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    }
    expect(await lastAction()).toMatchObject({ action: "support_open", outcome: "denied", reason_code: "invalid_input", tenant_id: a.tenantId });
    for (const t of ["public.patients", "public.vendor_staff", "public.support_sessions", "public.auth_user"]) {
      expect(await openSession(consoleDb, as(supTok), { tenantId: a.tenantId, purpose: "Memeriksa tabel yang tidak boleh", scope: [t], minutes: 30 }), t).toMatchObject({ ok: false, reason: "not_supportable" });
    }
    const closed = await clinic("closed");
    expect(await openSession(consoleDb, as(supTok), { tenantId: closed.tenantId, purpose: "Memeriksa klinik yang sudah tutup", scope: ["public.branches"], minutes: 30 })).toMatchObject({ ok: false, reason: "tenant_closed" });
    expect(await openSession(consoleDb, as(supTok), { tenantId: crypto.randomUUID(), purpose: "Memeriksa klinik yang tidak ada", scope: ["public.branches"], minutes: 30 })).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
  });

  it("one extension, by the opener, with a new reason, up to 120 minutes; not for a personal scope (owner approval, T-026)", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"], 30);
    expect(await extendSession(consoleDb, as(sup2Tok), s.id, "Masih memeriksa jam operasional", 30)).toMatchObject({ ok: false, reason: "not_opener" });
    expect(await extendSession(consoleDb, as(supTok), s.id, "Memeriksa pengaturan cabang atas permintaan klinik", 30)).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await extendSession(consoleDb, as(supTok), s.id, "Masih memeriksa jam operasional", 121)).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await extendSession(consoleDb, as(supTok), s.id, "Masih memeriksa jam operasional", 60)).toMatchObject({ ok: true });
    const ends = (await h.admin.query(`select ends_at - clock_timestamp() as left from support_sessions where id = $1`, [s.id])).rows[0].left;
    expect(ends.minutes ?? 0).toBeGreaterThanOrEqual(58);
    expect(await extendSession(consoleDb, as(supTok), s.id, "Perpanjangan kedua tidak boleh", 30)).toMatchObject({ ok: false, reason: "already_extended" });
    // An expired session is not extended.
    const e = await open(supTok, a, ["public.branches"], 30);
    await setEnds(e.id, `activated_at = activated_at - interval '31 minutes', ends_at = ends_at - interval '31 minutes'`);
    expect(await extendSession(consoleDb, as(supTok), e.id, "Terlambat diperpanjang", 30)).toMatchObject({ ok: false, reason: "not_active" });
  });
});

describe("roles, step-up, owner, privileges", () => {
  it("only support, onboarding or a platform owner opens; writes need the step-up; the IP allowlist applies", async () => {
    const a = await clinic();
    const base = { tenantId: a.tenantId, purpose: "Memeriksa pengaturan cabang", scope: ["public.branches"], minutes: 30 };
    expect(await openSession(consoleDb, as(finTok), base)).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await lastAction()).toMatchObject({ action: "support_open", outcome: "denied", reason_code: "role_not_held" });
    expect(await openSession(consoleDb, as(await session(SUP, "30 minutes")), base)).toMatchObject({ ok: false, reason: "totp_not_verified" });
    expect(await openSession(consoleDb, as(supTok, "198.51.100.7"), base)).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    expect(await openSession(consoleDb, as("x".repeat(40)), base)).toMatchObject({ ok: false, reason: "no_session" });
    expect(await openSession(consoleDb, as(poTok), base)).toMatchObject({ ok: true });
    expect(await listSessions(consoleDb, as(finTok), a.tenantId)).toMatchObject({ ok: true }); // every vendor role reads the list (metadata)
  });

  it("the Owner ends a session at once (audited); Admin Pusat cannot; another tenant's Owner cannot", async () => {
    const a = await clinic();
    const b = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    expect(await code(asAdmin(a, (db) => endSessionAsOwner(db, s.id)))).toBe("ERR_FORBIDDEN");
    expect(await code(asOwner(b, (db) => endSessionAsOwner(db, s.id)))).toBe("ERR_NOT_FOUND");
    await asOwner(a, (db) => endSessionAsOwner(db, s.id));
    expect(await code(read(supTok, s.id, "branches"))).toBe("not_active");
    expect((await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and object_id = $2 order by seq`, [a.tenantId, s.id])).rows.map((r) => r.reason_code))
      .toEqual(["active", "ended_by_owner", "not_active"]);
    expect((await h.admin.query(`select end_reason from support_sessions where id = $1`, [s.id])).rows[0].end_reason).toBe("owner");
  });

  it("history only moves forward; clinic_app and clinic_vendor cannot bind or read operator tables; the operator role holds no write", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    for (const q of [`update support_sessions set scope = '{public.staff}' where id = '${s.id}'`, `update support_sessions set ends_at = ends_at + interval '5 hours' where id = '${s.id}'`,
      `delete from support_sessions where id = '${s.id}'`, `update support_object_kinds set support_class = 'config' where table_name = 'public.staff'`]) {
      await expect(h.admin.query(q), q).rejects.toMatchObject({ code: expect.stringMatching(/42501|23514/) });
    }
    // An ended session is final: even a constraint-valid change (another end reason) is refused.
    expect(await endSession(consoleDb, as(supTok), s.id)).toMatchObject({ ok: true });
    await expect(h.admin.query(`update support_sessions set end_reason = 'expired' where id = $1`, [s.id])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query(`select support_session_bind('a','b',$1,null)`, [s.id])).rejects.toMatchObject({ code: "42501" });
    await expect(consoleDb.query(`select support_session_bind('a','b',$1,null)`, [s.id])).rejects.toMatchObject({ code: "42501" });
    await expect(consoleDb.query(`select 1 from branches limit 1`)).rejects.toMatchObject({ code: "42501" });
    const writes = (await h.admin.query(`select count(*)::int n from information_schema.role_table_grants where grantee = 'clinic_operator' and privilege_type <> 'SELECT'`)).rows[0].n;
    expect(writes).toBe(0);
  });
});

describe("coverage (TEN-19)", () => {
  it("every tenant table has an operator class; every non-never class has exactly one operator policy and nothing else does", async () => {
    const missing = (await h.admin.query(`select s.table_name from scope_map s where s.policy_kind <> 'platform'
                                            and not exists (select 1 from support_object_kinds k where k.table_name = s.table_name)`)).rows;
    expect(missing).toEqual([]);
    // Sorted the same way in JS (T-035: pg_policies names sort in collation "C", table_name in the
    // default collation, so "branch_prices" and "branches" came out in different orders).
    const byCode = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    const policies = (await h.admin.query(`select schemaname || '.' || tablename t from pg_policies where 'clinic_operator' = any (roles)`)).rows.map((r) => r.t as string).sort(byCode);
    const readable = (await h.admin.query(`select table_name t from support_object_kinds where support_class <> 'never'`)).rows.map((r) => r.t as string).sort(byCode);
    expect(policies).toEqual(readable);
  });

  it("operator.sql is the tail of the migration that applies it", () => {
    const op = readFileSync(join(ROOT, "src/db/rls/operator.sql"), "utf8");
    const mig = readFileSync(join(ROOT, "drizzle/0046_support_session_rules.sql"), "utf8");
    expect(mig.endsWith(op)).toBe(true);
  });
});
