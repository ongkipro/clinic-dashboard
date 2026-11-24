// HYG-026 (PR-3, IAM-1; T-122 D1 = (a); R3 review r1 and r2 fixes): the step-up proof.
// Issuance (factory): stepUp(headers, code) only for the exact original, live, enrolled, unlocked clinic session, with the
// stamp of that exact row as the final gate (and the only source of TOTP provenance); freshStepUp only within 10
// minutes of that session's last gated step-up, for its current authenticator, with no future stamp. Use (consumers):
// verifyStepUp(db, proof) binds the proof alone to the auth session the tenant transaction is bound to, the account it
// acts for, the deadline (before and after its reads) and a still-live session.
// Real PostgreSQL: the auth factory as clinic_auth and the tenant transaction as clinic_app on one throwaway database.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_LOCK_MS, type Role } from "../../src/auth/policy";
import { createAuth, STEP_UP_MAX_AGE_MS, type StepUp, verifyStepUp } from "../../src/auth/server";
import { APP_GROUP_ROLE, AUTH_GROUP_ROLE, type SessionBinding, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { testPool } from "../rls/harness";
import { stepUpForTests } from "../support/step-up";
import { type AuthEnv, BASE_URL, Client, createAuthEnv, PASSWORD, secretFromUri, totp } from "./helpers";

let env: AuthEnv;
let app: pg.Pool; // clinic_app
let owner: pg.Pool; // migration owner (fixtures)
let tenantId: string;
let branchId: string;
let n = 0;
const MIN = 60_000;

type Person = { id: string; email: string; staffId?: string; role: Role };
// An account; with a tenant role it also gets a membership in the fixture tenant (so verifyStepUp can bind to it).
async function staff(role: Role = "doctor", opts: { member?: boolean } = {}): Promise<Person> {
  const email = `stepup${++n}@klinik-sintetis.test`;
  const user = await env.auth.createStaffAccount({ email, name: `Staf ${n}`, password: PASSWORD });
  env.roles.set(user.id, [role]);
  if (opts.member === false) return { id: user.id, email, role };
  const { staffId } = await createMembership(owner, { tenantId, accountId: user.id, displayName: `Staf ${n}` });
  const rid = await assignRole(env.h.admin, { tenantId, staffId, role });
  if (role !== "owner") await assignBranch(env.h.admin, { tenantId, staffRoleId: rid, branchId });
  return { id: user.id, email, staffId, role };
}
async function enrolled(email: string, auth = env.auth): Promise<{ c: Client; secret: string }> {
  const c = new Client(auth);
  expect((await c.signIn(email)).status).toBe(200);
  const enable = await c.post("/two-factor/enable", { password: PASSWORD });
  expect(enable.status).toBe(200);
  const secret = secretFromUri(String(enable.json.totpURI));
  expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  return { c, secret };
}
// A second browser of the same enrolled account: password, then the TOTP challenge.
async function another(email: string, secret: string, auth = env.auth): Promise<Client> {
  const d = new Client(auth);
  const r = await d.signIn(email);
  expect(r.json.twoFactorRedirect).toBe(true);
  expect((await d.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  return d;
}
const wrong = (secret: string) => {
  const now = Date.now();
  const valid = new Set([-2, -1, 0, 1, 2].map((p) => totp(secret, now + p * 30_000)));
  for (const c of ["000000", "111111", "222222", "333333", "444444", "555555"]) if (!valid.has(c)) return c;
  throw new Error("no wrong code found");
};
const budget = async (userId: string) =>
  (await env.h.admin.query<{ n: number; locked: Date | null }>(
    `select failed_verification_count as n, locked_until as locked from auth_two_factor where user_id = $1`,
    [userId],
  )).rows[0];
const token = (c: Client) => decodeURIComponent([...c.cookies].find(([k]) => k.endsWith("session_token"))![1]).split(".")[0];
const sessionOf = async (c: Client) =>
  (await env.h.admin.query<{ id: string; second_factor_at: Date | null; last_active_at: Date }>(
    `select id, second_factor_at, last_active_at from auth_session where token = $1`,
    [token(c)],
  )).rows[0];
// The binding requestContext() puts into the acting context for browser c's request: the factory's checkSession
// (activity off, so the tests' clocks are not disturbed). Its session id is held in the factory's registry.
const bindingOf = async (c: Client, auth = env.auth): Promise<SessionBinding | undefined> => {
  const g = await auth.checkSession(c.headers(), { activity: false });
  return g.gate === "anonymous" ? undefined : g.binding;
};
// verifyStepUp inside the tenant transaction acting as p, bound as given (a browser: its request's binding; a binding;
// or none). The proof is passed alone.
const use = async (p: Person, proof: StepUp | null, at: Client | SessionBinding | null) => {
  const session = at === null ? undefined : at instanceof Client ? await bindingOf(at) : at;
  const ctx = await resolveContext(app, p.id, { tenantId, actingRole: p.role, activeBranchId: p.role === "owner" ? undefined : branchId });
  return withTenantContext(app, { ...ctx, session }, (db) => verifyStepUp(db, proof));
};
// The tenant owner revokes one session of p's membership (Pengguna & Akses › Cabut Sesi, PR-91): membership-only, the
// auth session itself stays live.
let tenantOwner: Person | undefined;
// The same revocation, left open: it holds the tenant's staff_access lock until commit() (another request mid-write).
const revokeOpen = async (p: Person, sessionId: string) => {
  tenantOwner ??= await staff("owner");
  const ctx = await resolveContext(app, tenantOwner.id, { tenantId, actingRole: "owner" });
  const c = await app.connect();
  await c.query("begin");
  await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.allowed_branch_ids', '*', true), set_config('app.active_branch_id', '', true), set_config('app.staff_id', $2, true), set_config('app.roles', 'owner', true)`, [ctx.tenantId, ctx.staffId]);
  await c.query(`select staff_session_revoke($1, $2)`, [p.staffId, sessionId]);
  return { commit: async () => { try { await c.query("commit"); } finally { c.release(); } } };
};
const revokeAsOwner = async (p: Person, sessionId: string) => {
  tenantOwner ??= await staff("owner");
  const ctx = await resolveContext(app, tenantOwner.id, { tenantId, actingRole: "owner" });
  // Another request's transaction: its own app-role connection with the owner's context settings (as withTenantContext
  // binds them), so it can run while the caller is inside its own withTenantContext.
  const c = await app.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.allowed_branch_ids', '*', true), set_config('app.active_branch_id', '', true), set_config('app.staff_id', $2, true), set_config('app.roles', 'owner', true)`, [ctx.tenantId, ctx.staffId]);
    await c.query(`select staff_session_revoke($1, $2)`, [p.staffId, sessionId]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
};
beforeAll(async () => {
  env = await createAuthEnv();
  app = await openAppPool({ connectionString: env.h.urlAs(await env.h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = testPool({ connectionString: env.h.ownerUrl(), max: 2 });
  tenantId = (await env.h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id;
  await env.h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Langkah Sintetis', 'emkm')`, [tenantId]);
  branchId = (await env.h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'S1', 'S1', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id;
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await env?.close();
});
let clockAtStart: Date;
beforeEach(() => {
  clockAtStart = env.clock.now;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  env.clock.now = clockAtStart;
});

describe("stepUp: a current TOTP for the exact signed-in session", () => {
  it("a correct code gives a proof bound to this session; second_factor_at stamped; the consumer check accepts it", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    env.clock.now = new Date(env.clock.now.getTime() + 60_000);
    const proof = await env.auth.stepUp(c.headers(), totp(secret));
    expect(proof).not.toBeNull();
    expect((await sessionOf(c)).second_factor_at).toEqual(env.clock.now);
    expect((await budget(u.id)).n).toBe(0);
    expect(await use(u, proof, c)).toBe(true);
    // A typed code with spaces is tolerated (as the possession check). The current-code contract: the same code is
    // accepted again within its acceptance period (no one-use-per-period replay protection is claimed).
    expect(await env.auth.stepUp(c.headers(), totp(secret).replace(/^(\d{3})/, "$1 "))).not.toBeNull();
  });

  it("a wrong code is null, counted, leaves second_factor_at; 5 lock; after 15 minutes a proof again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const at = (await sessionOf(c)).second_factor_at;
    env.clock.now = new Date(env.clock.now.getTime() + 30_000);
    expect(await env.auth.stepUp(c.headers(), wrong(secret))).toBeNull();
    expect((await budget(u.id)).n).toBe(1);
    expect((await sessionOf(c)).second_factor_at).toEqual(at);
    for (let i = 0; i < 4; i++) expect(await env.auth.stepUp(c.headers(), wrong(secret))).toBeNull();
    expect((await budget(u.id)).locked).not.toBeNull();
    expect(await env.auth.stepUp(c.headers(), totp(secret))).toBeNull();
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(429);
    vi.setSystemTime(new Date(Date.now() + 15 * MIN + 1_000));
    expect(await env.auth.stepUp(c.headers(), totp(secret))).not.toBeNull();
    expect((await budget(u.id)).n).toBe(0);
  });

  it("a malformed code is null and not counted", async () => {
    const u = await staff();
    const { c } = await enrolled(u.email);
    for (const bad of ["", "12345", "1234567", "abcdef"]) expect(await env.auth.stepUp(c.headers(), bad)).toBeNull();
    expect((await budget(u.id)).n).toBe(0);
  });

  it("anonymous, unenrolled and mid-enrolment are null; the enrolment is not completed by it", async () => {
    expect(await env.auth.stepUp(new Client(env.auth).headers(), "123456")).toBeNull();
    const u = await staff("fo_cashier");
    const c = new Client(env.auth);
    expect((await c.signIn(u.email)).status).toBe(200);
    expect(await env.auth.stepUp(c.headers(), "123456")).toBeNull();
    const enable = await c.post("/two-factor/enable", { password: PASSWORD });
    const secret = secretFromUri(String(enable.json.totpURI));
    expect(await env.auth.stepUp(c.headers(), totp(secret))).toBeNull();
    expect((await env.h.admin.query(`select two_factor_enabled from auth_user where id = $1`, [u.id])).rows[0].two_factor_enabled).toBe(false);
  });

  it("locked and idle-locked sessions are null", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    await env.h.admin.query(`update auth_session set locked_at = now() where token = $1`, [token(c)]);
    expect(await env.auth.stepUp(c.headers(), totp(secret))).toBeNull();
    // Idle lock (fo_cashier, 2 minutes) for an enrolled front-desk account.
    const f = await staff("fo_cashier");
    const { c: fc, secret: fs } = await enrolled(f.email);
    env.clock.now = new Date(env.clock.now.getTime() + 3 * MIN);
    expect(await env.auth.stepUp(fc.headers(), totp(fs))).toBeNull();
  });

  it("a pending sign-in challenge beside a revoked session never yields a proof (no challenge fallback)", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    // A sign-in challenge in the same browser, then the original session is revoked.
    const d = new Client(env.auth);
    expect((await d.signIn(u.email)).json.twoFactorRedirect).toBe(true);
    const challenge = [...d.cookies].find(([k]) => k.endsWith("two_factor"))!;
    c.cookies.set(challenge[0], challenge[1]);
    const before = (await env.h.admin.query(`select count(*)::int n from auth_session where user_id = $1`, [u.id])).rows[0].n;
    let revoked = false;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: (await env.auth.auth.$context).secret, roles: async (id) => env.roles.get(id) ?? [],
      now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { beforeVerify: async () => { await env.h.admin.query(`delete from auth_session where token = $1`, [token(c)]); revoked = true; } },
    });
    expect(await auth.stepUp(c.headers(), totp(secret))).toBeNull();
    expect(revoked).toBe(true);
    // The challenge was not completed into a new session by the wrapper.
    expect((await env.h.admin.query(`select count(*)::int n from auth_session where user_id = $1`, [u.id])).rows[0].n).toBe(before - 1);
  });

  it("a revocation or a lock while the code is being checked: the stamp affects 0 rows, so no proof", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    const mk = (afterVerify: () => Promise<void>) =>
      createAuth({ pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {}, stepUpHooks: { afterVerify } });
    const tok = token(c);
    // The plugin accepted the code (its after hook stamps second_factor_at as for any verify-totp); the session is locked
    // before issuance, so the wrapper's own conditional stamp of that exact row (the final gate) updates 0 rows.
    expect(await mk(async () => { await env.h.admin.query(`update auth_session set locked_at = now() where token = $1`, [tok]); }).stepUp(c.headers(), totp(secret))).toBeNull();
    await env.h.admin.query(`update auth_session set locked_at = null where token = $1`, [tok]);
    expect(await mk(async () => { await env.h.admin.query(`delete from auth_session where token = $1`, [tok]); }).stepUp(c.headers(), totp(secret))).toBeNull();
  });

  it("a factor replaced while the code is being checked: 0 rows stamped, no proof", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { afterVerify: async () => { await env.h.admin.query(`update auth_two_factor set secret = secret || 'x' where user_id = $1`, [u.id]); } },
    });
    expect(await auth.stepUp(c.headers(), totp(secret))).toBeNull();
  });
});

describe("stepUp: the final gate locks the row and decides after the wait", () => {
  // A second connection holds the session row lock after the plugin accepted the code; the gate's FOR UPDATE waits on
  // it while (injected) time passes; the role lookup returns normally.
  async function gateAfterWait(role: Role, prepare: (c: Client) => Promise<void>, advanceMs: number, whileBlocked?: (u: Person) => Promise<void>) {
    const ctx = await env.auth.auth.$context;
    const holder = await owner.connect();
    let tok = "";
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { afterVerify: async () => { await holder.query("begin"); await holder.query(`select 1 from auth_session where token = $1 for update`, [tok]); } },
    });
    const u = await staff(role);
    const { c, secret } = await enrolled(u.email, auth);
    tok = token(c);
    await prepare(c);
    const t0 = env.clock.now.getTime();
    const pending = auth.stepUp(c.headers(), totp(secret));
    // Wait until the gate's FOR UPDATE is blocked on the holder's row lock.
    for (let i = 0; i < 200; i++) {
      const w = await env.h.admin.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%from auth_session where id = $1 for update%'`);
      if (w.rows[0].n > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const blocked = (await env.h.admin.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%from auth_session where id = $1 for update%'`)).rows[0].n;
    env.clock.now = new Date(t0 + advanceMs); // time passes while the gate waits
    if (whileBlocked) await whileBlocked(u); // committed by another connection while the gate is blocked
    await holder.query("commit"); // the holder releases the session row without changing it
    holder.release();
    return { u, c, proof: await pending, blocked, t0, auth };
  }

  it("idle cutoff crossed while the gate waits on the row lock: no proof; the same wait inside the window: a proof", async () => {
    const crossed = await gateAfterWait("fo_cashier", async () => {}, IDLE_LOCK_MS + 1_000);
    expect(crossed.blocked).toBe(1);
    expect(crossed.proof).toBeNull();
    const inside = await gateAfterWait("fo_cashier", async () => {}, IDLE_LOCK_MS - 10_000);
    expect(inside.blocked).toBe(1);
    expect(inside.proof).not.toBeNull();
  });

  it("session expiry crossed while the gate waits on the row lock: no proof", async () => {
    // Better Auth checks expiry with the real clock before the gate, so expires_at is anchored to real time (30 s ahead)
    // and the injected clock starts 2 s before it; the gate's wait then moves it 5 s, past expires_at.
    const r = await gateAfterWait("doctor", async (c) => {
      const real = Date.now();
      await env.h.admin.query(`update auth_session set expires_at = $2 where token = $1`, [token(c), new Date(real + 30_000)]);
      env.clock.now = new Date(real + 28_000);
    }, 5_000);
    expect(r.blocked).toBe(1);
    expect(r.proof).toBeNull();
  });

  it("a factor change committed while the gate is blocked on the row lock: no proof (the factor is read after the lock)", async () => {
    const r = await gateAfterWait("doctor", async () => {}, 1_000, async (u) => {
      await env.h.admin.query(`update auth_two_factor set secret = secret || 'x' where user_id = $1`, [u.id]);
    });
    expect(r.blocked).toBe(1);
    expect(r.proof).toBeNull();
    // Control: the same blocked wait with no change gives a proof.
    const ok = await gateAfterWait("doctor", async () => {}, 1_000);
    expect(ok.blocked).toBe(1);
    expect(ok.proof).not.toBeNull();
  });

  it("a gate wait beyond the 10-minute proof window, the session still valid: no proof", async () => {
    const r = await gateAfterWait("doctor", async () => {}, STEP_UP_MAX_AGE_MS + 1_000);
    expect(r.blocked).toBe(1);
    expect(r.proof).toBeNull();
    expect((await r.auth.checkSession(r.c.headers(), { activity: false })).gate).toBe("ok"); // the session is valid
  });

  it("the gate itself refuses a TOTP past its deadline, independently of the publish recheck (clock stepped back after)", async () => {
    // The gate waits past the 10-minute window; if it did not judge the deadline, a clock correction back into the window
    // before publishing would let the proof out. afterGate runs only for a gate that passed.
    let afterGateRan = false;
    const ctx = await env.auth.auth.$context;
    const holder = await owner.connect();
    let tok = "";
    let t0 = 0;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: {
        afterVerify: async () => { t0 = env.clock.now.getTime(); await holder.query("begin"); await holder.query(`select 1 from auth_session where token = $1 for update`, [tok]); },
        afterGate: async () => { afterGateRan = true; env.clock.now = new Date(t0 + 1_000); },
      },
    });
    const u = await staff();
    const { c, secret } = await enrolled(u.email, auth);
    tok = token(c);
    const pending = auth.stepUp(c.headers(), totp(secret));
    for (let i = 0; i < 200 && t0 === 0; i++) await new Promise((r) => setTimeout(r, 25));
    for (let i = 0; i < 200; i++) {
      const w = await env.h.admin.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%from auth_session where id = $1 for update%'`);
      if (w.rows[0].n > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    env.clock.now = new Date(t0 + STEP_UP_MAX_AGE_MS + 1_000);
    await holder.query("commit");
    holder.release();
    expect(await pending).toBeNull();
    expect(afterGateRan).toBe(false);
  });

  it("a clock stepped back before the TOTP time: no proof, at the gate or before publishing", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    let t0 = 0;
    const mk = (hooks: { beforeLock?: () => Promise<void>; afterGate?: () => Promise<void> }) => createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { afterVerify: async () => { t0 = env.clock.now.getTime(); }, ...hooks },
    });
    // At the gate: the clock steps back 1 s before the TOTP time while the gate is starting.
    let gateRan = false;
    const a = mk({ beforeLock: async () => { env.clock.now = new Date(t0 - 1_000); }, afterGate: async () => { gateRan = true; } });
    expect(await a.stepUp(c.headers(), totp(secret))).toBeNull();
    expect(gateRan).toBe(false); // refused by the gate itself
    env.clock.now = clockAtStart;
    // Before publishing: the gate passed, then the clock steps back.
    const b = mk({ afterGate: async () => { env.clock.now = new Date(t0 - 1_000); } });
    expect(await b.stepUp(c.headers(), totp(secret))).toBeNull();
    env.clock.now = new Date(t0 + 1_000);
    expect(await b.freshStepUp(c.headers())).toBeNull(); // nothing published
  });

  it("the TOTP deadline is checked again right before the proof is published", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    let t0 = 0;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { afterVerify: async () => { t0 = env.clock.now.getTime(); }, afterGate: async () => { env.clock.now = new Date(t0 + STEP_UP_MAX_AGE_MS + 1); } },
    });
    expect(await auth.stepUp(c.headers(), totp(secret))).toBeNull();
    expect(await auth.freshStepUp(c.headers())).toBeNull(); // nothing published
  });

  it("a wait never extends freshness: the proof and the fresh path count from the TOTP time, not the gate time", async () => {
    const r = await gateAfterWait("doctor", async () => {}, 9 * MIN); // the gate waits 9 minutes (no idle lock for doctors)
    expect(r.blocked).toBe(1);
    expect(r.proof).not.toBeNull();
    const b = await bindingOf(r.c, r.auth);
    expect(await use(r.u, r.proof, b!)).toBe(true);
    expect(await r.auth.freshStepUp(r.c.headers())).not.toBeNull();
    env.clock.now = new Date(r.t0 + STEP_UP_MAX_AGE_MS + 1); // 10 min after the TOTP, 1 min after the gate
    expect(await use(r.u, r.proof, b!)).toBe(false);
    expect(await r.auth.freshStepUp(r.c.headers())).toBeNull();
  });
});

describe("the final reads check the session's token and account", () => {
  it("stepUp: a session row whose token changed after the code was accepted is refused at the locked gate", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    const tok = token(c);
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { afterVerify: async () => { await env.h.admin.query(`update auth_session set token = token || 'x' where token = $1`, [tok]); } },
    });
    expect(await auth.stepUp(c.headers(), totp(secret))).toBeNull();
  });

  it("verifyStepUp and freshStepUp: a session row now belonging to another account is refused", async () => {
    const u = await staff();
    const other = await staff();
    const { c, secret } = await enrolled(u.email);
    await enrolled(other.email); // the other account has a verified authenticator too
    const proof = await env.auth.stepUp(c.headers(), totp(secret));
    const b = await bindingOf(c);
    expect(await use(u, proof, b!)).toBe(true);
    expect(await env.auth.freshStepUp(c.headers())).not.toBeNull();
    // Re-point the proof's session row to the other account (same surface, live, enrolled): only the account differs.
    await env.h.admin.query(`update auth_session set user_id = $2 where token = $1`, [token(c), other.id]);
    expect(await use(u, proof, b!)).toBe(false);
  });
});

describe("verifyStepUp: bound to the session, the acting account, the deadline and a live session", () => {
  it("two sessions of one account: B's authenticated context refuses A's unchanged proof and accepts B's own", async () => {
    const u = await staff();
    const { c: a, secret } = await enrolled(u.email);
    const b = await another(u.email, secret);
    const proofA = await env.auth.stepUp(a.headers(), totp(secret));
    expect(await use(u, proofA, a)).toBe(true);
    expect(await use(u, proofA, b)).toBe(false); // the same object, during B's request
    expect(await use(u, proofA, null)).toBe(false); // a transaction bound to no session
    const proofB = await env.auth.stepUp(b.headers(), totp(secret));
    expect(await use(u, proofB, b)).toBe(true);
    expect(await use(u, proofB, a)).toBe(false);
  });

  it("only the factory's binding binds: a hand-built context with A's session UUID cannot make A's proof verify", async () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/modules/org/context/store.ts"), "utf8");
    expect(src).toMatch(/context: \{ \.\.\.active\.context, session: gate\.binding \}/);
    const u = await staff();
    const { c: a, secret } = await enrolled(u.email);
    const proofA = await env.auth.stepUp(a.headers(), totp(secret));
    const sidA = (await sessionOf(a)).id;
    const ctx = await resolveContext(app, u.id, { tenantId, actingRole: u.role, activeBranchId: branchId });
    // The authentic path (the factory's checkSession binding for A's request) works.
    expect(await use(u, proofA, a)).toBe(true);
    // A plain context carrying A's session UUID (in any field) binds nothing.
    const forged = [{ sessionId: sidA }, { session: sidA }, { session: { sessionId: sidA } }, { session: Object.freeze({}) }];
    for (const extra of forged) {
      expect(await withTenantContext(app, { ...ctx, ...(extra as object) } as typeof ctx, (db) => verifyStepUp(db, proofA))).toBe(false);
    }
    // A copy of an authentic binding is not the binding.
    const real = await bindingOf(a);
    expect(await use(u, proofA, { ...real } as SessionBinding)).toBe(false);
    expect(await use(u, proofA, real!)).toBe(true);
  });

  it("another account's tenant context refuses the proof", async () => {
    const u = await staff();
    const v = await staff();
    const { c, secret } = await enrolled(u.email);
    const s = await env.auth.stepUp(c.headers(), totp(secret));
    expect(await use(u, s, c)).toBe(true);
    expect(await use(v, s, c)).toBe(false);
  });

  it("expires 10 minutes after verification (edge inside), from the issuing factory's clock", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const s = await env.auth.stepUp(c.headers(), totp(secret));
    const b = await bindingOf(c);
    const t0 = env.clock.now.getTime();
    env.clock.now = new Date(t0 + STEP_UP_MAX_AGE_MS);
    expect(await use(u, s, b!)).toBe(true);
    env.clock.now = new Date(t0 + STEP_UP_MAX_AGE_MS + 1);
    expect(await use(u, s, b!)).toBe(false);
    env.clock.now = new Date(t0 - 1); // before verifiedAt (a clock step back)
    expect(await use(u, s, b!)).toBe(false);
  });

  it("the deadline is checked again after the asynchronous reads (just in time at the start is not enough)", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    // A factory whose role lookup (used by the liveness re-read) moves the clock past the deadline mid-check.
    let crossDeadline = false;
    let t0 = 0;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      roles: async (id) => {
        if (crossDeadline) env.clock.now = new Date(t0 + STEP_UP_MAX_AGE_MS + 1);
        return env.roles.get(id) ?? [];
      },
    });
    const s = await auth.stepUp(c.headers(), totp(secret));
    t0 = env.clock.now.getTime();
    const b = await bindingOf(c);
    env.clock.now = new Date(t0 + STEP_UP_MAX_AGE_MS); // the edge: valid at the first check
    expect(await use(u, s, b!)).toBe(true);
    crossDeadline = true;
    env.clock.now = new Date(t0 + STEP_UP_MAX_AGE_MS);
    expect(await use(u, s, b!)).toBe(false);
  });

  it("session idle / expiry crossed during the role lookup (proof still fresh): liveSession judges at the later clock", async () => {
    // A factory whose role lookup moves the clock (as a slow lookup would) by `jump` ms once armed.
    const ctx = await env.auth.auth.$context;
    let jump = 0;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      roles: async (id) => {
        if (jump) { env.clock.now = new Date(env.clock.now.getTime() + jump); jump = 0; }
        return env.roles.get(id) ?? [];
      },
    });
    // Idle: an enrolled front-desk account (idle lock 2 minutes). The proof is fresh (10 minutes) throughout.
    const f = await staff("fo_cashier");
    const { c: fc, secret: fs } = await enrolled(f.email, auth);
    const proof = await auth.stepUp(fc.headers(), totp(fs));
    expect(proof).not.toBeNull();
    const b = await bindingOf(fc, auth);
    const lastActive = (await sessionOf(fc)).last_active_at.getTime();
    env.clock.now = new Date(lastActive + IDLE_LOCK_MS - 1_000); // 1 s before the idle cutoff when the check starts
    expect(await use(f, proof, b!)).toBe(true);
    jump = 2_000; // the role lookup crosses the idle cutoff
    expect(await use(f, proof, b!)).toBe(false);
    env.clock.now = new Date(lastActive + IDLE_LOCK_MS - 1_000);
    jump = 2_000;
    expect(await auth.freshStepUp(fc.headers())).toBeNull();

    // Expiry: a doctor's session whose expires_at is 1 s ahead when the check starts.
    const u = await staff();
    const { c, secret } = await enrolled(u.email, auth);
    const p2 = await auth.stepUp(c.headers(), totp(secret));
    const b2 = await bindingOf(c, auth);
    await env.h.admin.query(`update auth_session set expires_at = $2 where token = $1`, [token(c), new Date(env.clock.now.getTime() + 1_000)]);
    expect(await use(u, p2, b2!)).toBe(true);
    jump = 2_000; // the role lookup crosses the session expiry
    expect(await use(u, p2, b2!)).toBe(false);
  });

  it("stepUp: the exact-row gate judges idle / expiry after the role lookup, not with a time taken before it", async () => {
    const ctx = await env.auth.auth.$context;
    let jump = 0;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      roles: async (id) => {
        if (jump) { env.clock.now = new Date(env.clock.now.getTime() + jump); jump = 0; }
        return env.roles.get(id) ?? [];
      },
      // Arm the jump for the role lookup that precedes the gate (after the plugin accepted the code).
      stepUpHooks: { afterVerify: async () => { jump = armed; } },
    });
    let armed = 0;
    // Idle: the session is 1 s from its idle cutoff when the gate's role lookup starts; the lookup takes 2 s.
    const f = await staff("fo_cashier");
    const { c: fc, secret: fs } = await enrolled(f.email, auth);
    const lastActive = (await sessionOf(fc)).last_active_at.getTime();
    env.clock.now = new Date(lastActive + IDLE_LOCK_MS - 1_000);
    armed = 2_000;
    expect(await auth.stepUp(fc.headers(), totp(fs))).toBeNull();
    // Control: the same timing without the crossing gives a proof.
    env.clock.now = new Date(lastActive + IDLE_LOCK_MS - 3_000);
    armed = 1_000;
    expect(await auth.stepUp(fc.headers(), totp(fs))).not.toBeNull();

    // Expiry: the session expires 1 s after the gate's role lookup starts; the lookup takes 2 s.
    const u = await staff();
    const { c, secret } = await enrolled(u.email, auth);
    await env.h.admin.query(`update auth_session set expires_at = $2 where token = $1`, [token(c), new Date(env.clock.now.getTime() + 1_000)]);
    armed = 2_000;
    expect(await auth.stepUp(c.headers(), totp(secret))).toBeNull();
  });

  it("a lock, sign-out, server-side end or factor change committed during the role lookup: refused (state read after it)", async () => {
    // The proof deadline stays in the future throughout; only the session / factor change during the lookup.
    const ctx = await env.auth.auth.$context;
    let during: (() => Promise<void>) | null = null;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      roles: async (id) => {
        const f = during;
        during = null;
        if (f) await f();
        return env.roles.get(id) ?? [];
      },
    });
    const cases: [string, (u: Person, c: Client) => Promise<void>][] = [
      ["lock", async (_u, c) => { await env.h.admin.query(`update auth_session set locked_at = now() where token = $1`, [token(c)]); }],
      ["sign-out", async (_u, c) => { await c.post("/sign-out", {}); }],
      ["endSession", async (_u, c) => { await env.auth.endSession((await sessionOf(c)).id); }],
      ["factor change", async (u) => { await env.h.admin.query(`update auth_two_factor set secret = secret || 'x' where user_id = $1`, [u.id]); }],
    ];
    for (const [name, change] of cases) {
      const u = await staff();
      const { c, secret } = await enrolled(u.email, auth);
      const proof = await auth.stepUp(c.headers(), totp(secret));
      expect(proof, name).not.toBeNull();
      const b = await bindingOf(c, auth);
      expect(await use(u, proof, b!), name).toBe(true); // control
      during = () => change(u, c);
      expect(await use(u, proof, b!), name).toBe(false);
      // The fresh path, armed the same way on a new session of a new account.
      const v = await staff();
      const { c: d, secret: ds } = await enrolled(v.email, auth);
      expect(await auth.stepUp(d.headers(), totp(ds))).not.toBeNull();
      expect(await auth.freshStepUp(d.headers()), name).not.toBeNull(); // control
      // freshStepUp looks roles up twice: in its checkSession (#1), then in liveSession (#2). The change is committed
      // during #2, i.e. after the gate check and before the final session / factor read.
      let n = 0;
      const armed = async () => { n++; if (n === 2) await change(v, d); else during = armed; };
      during = armed;
      expect(await auth.freshStepUp(d.headers()), name).toBeNull();
      expect(n, name).toBe(2);
    }
  });

  it("a membership-only revocation (PR-91) committed while the verifier waits on the tenant lock: refused; auth session live", async () => {
    // The owner's staff_session_revoke runs in its own transaction and holds the tenant's staff_access lock (as it does);
    // the verifier blocks on that lock before any decision read; the revocation commits; the verifier then reads it.
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const proof = await env.auth.stepUp(c.headers(), totp(secret));
    const b = await bindingOf(c);
    const sid = (await sessionOf(c)).id;
    expect(await use(u, proof, b!)).toBe(true); // control: fresh proof, live session
    const revoker = await revokeOpen(u, sid); // revoked, not yet committed; holds the tenant lock
    const verifying = use(u, proof, b!);
    let waiting = 0;
    try {
      for (let i = 0; i < 200 && waiting === 0; i++) {
        waiting = (await env.h.admin.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`)).rows[0].n;
        if (waiting === 0) await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      await revoker.commit(); // always release, so a failure cannot leave the transaction open
    }
    expect(waiting).toBe(1);
    expect(await verifying).toBe(false);
    expect((await env.auth.checkSession(c.headers(), { activity: false })).gate).toBe("ok"); // the auth session is still live
  });

  it("the verifier waits on the tenant lock first, then reads: sign-out or the idle cutoff during that wait → refused", async () => {
    // Another connection holds the tenant's staff_access lock (as any staff-access writer or signer does); the verifier
    // blocks on it; meanwhile the auth session signs out, or crosses its idle cutoff; the membership is unchanged and
    // the proof still fresh.
    const tenantLockKey = `select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`;
    const blockedOnTenantLock = async (run: Promise<boolean>, during: () => Promise<void>, holder: pg.PoolClient) => {
      for (let i = 0; i < 200; i++) {
        const w = await env.h.admin.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`);
        if (w.rows[0].n > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const waiting = (await env.h.admin.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`)).rows[0].n;
      await during();
      await holder.query("commit");
      holder.release();
      return { waiting, result: await run };
    };
    const hold = async () => { const h = await owner.connect(); await h.query("begin"); await h.query(tenantLockKey, [tenantId]); return h; };

    // Control: an unchanged session passes after the same wait.
    {
      const u = await staff();
      const { c, secret } = await enrolled(u.email);
      const proof = await env.auth.stepUp(c.headers(), totp(secret));
      const b = await bindingOf(c);
      const h = await hold();
      const r = await blockedOnTenantLock(use(u, proof, b!), async () => {}, h);
      expect(r.waiting).toBe(1);
      expect(r.result).toBe(true);
    }
    // Sign-out during the wait.
    {
      const u = await staff();
      const { c, secret } = await enrolled(u.email);
      const proof = await env.auth.stepUp(c.headers(), totp(secret));
      const b = await bindingOf(c);
      const h = await hold();
      const r = await blockedOnTenantLock(use(u, proof, b!), async () => { expect((await c.post("/sign-out", {})).status).toBe(200); }, h);
      expect(r.waiting).toBe(1);
      expect(r.result).toBe(false);
    }
    // Idle cutoff crossed during the wait (fo_cashier; the proof's 10 minutes are far from over).
    {
      const f = await staff("fo_cashier");
      const { c, secret } = await enrolled(f.email);
      const proof = await env.auth.stepUp(c.headers(), totp(secret));
      const b = await bindingOf(c);
      const lastActive = (await sessionOf(c)).last_active_at.getTime();
      const h = await hold();
      const r = await blockedOnTenantLock(use(f, proof, b!), async () => { env.clock.now = new Date(lastActive + IDLE_LOCK_MS + 1_000); }, h);
      expect(r.waiting).toBe(1);
      expect(r.result).toBe(false);
    }
  });

  it("a revocation started after the check waits for the caller's transaction (the staff_access lock is held to its end)", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const proof = await env.auth.stepUp(c.headers(), totp(secret));
    const b = await bindingOf(c);
    const sid = (await sessionOf(c)).id;
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let verified: (v: boolean) => void;
    const done = new Promise<boolean>((r) => { verified = r; });
    const ctx = await resolveContext(app, u.id, { tenantId, actingRole: u.role, activeBranchId: branchId });
    const tx = withTenantContext(app, { ...ctx, session: b }, async (db) => { verified(await verifyStepUp(db, proof)); await held; });
    expect(await done).toBe(true);
    let revoked = false;
    const revoking = revokeAsOwner(u, sid).then(() => { revoked = true; });
    let waiting = 0;
    let revokedWhileHeld = true;
    try {
      for (let i = 0; i < 200 && waiting === 0; i++) {
        waiting = (await env.h.admin.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`)).rows[0].n;
        if (waiting === 0) await new Promise((r) => setTimeout(r, 25));
      }
      revokedWhileHeld = revoked;
    } finally {
      release(); // always end the caller's transaction, so a failure cannot leave it open
    }
    await tx;
    await revoking;
    expect(waiting).toBe(1);
    expect(revokedWhileHeld).toBe(false); // blocked while the protected effect could still run
    expect(revoked).toBe(true);
    expect(await use(u, proof, b!)).toBe(false); // and refused afterwards
  });

  it("refused after the session is revoked (sign-out, server-side end, PR-91 membership revocation)", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const s1 = await env.auth.stepUp(c.headers(), totp(secret));
    const b1 = await bindingOf(c); // bound while the request was authenticated
    expect((await c.post("/sign-out", {})).status).toBe(200);
    expect(await use(u, s1, b1!)).toBe(false);

    const d = await another(u.email, secret);
    const s2 = await env.auth.stepUp(d.headers(), totp(secret));
    const sid2 = (await sessionOf(d)).id;
    const b2 = await bindingOf(d);
    expect(await use(u, s2, b2!)).toBe(true);
    await env.auth.endSession(sid2);
    expect(await use(u, s2, b2!)).toBe(false);

    const e = await another(u.email, secret);
    const s3 = await env.auth.stepUp(e.headers(), totp(secret));
    const sid3 = (await sessionOf(e)).id;
    const b3 = await bindingOf(e);
    expect(await use(u, s3, b3!)).toBe(true);
    const membership = (await env.h.admin.query(`select membership_id from staff where id = $1`, [u.staffId])).rows[0].membership_id;
    await env.h.admin.query(`insert into membership_revocations (tenant_id, membership_id, session_ids, reason) values ($1, $2, $3, 'session_revoked')`, [tenantId, membership, [sid3]]);
    expect(await use(u, s3, b3!)).toBe(false);
  });

  it("refused when the session becomes locked, or the authenticator is replaced", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const s = await env.auth.stepUp(c.headers(), totp(secret));
    const sid = (await sessionOf(c)).id;
    const b = await bindingOf(c);
    await env.h.admin.query(`update auth_session set locked_at = now() where id = $1`, [sid]);
    expect(await use(u, s, b!)).toBe(false);
    await env.h.admin.query(`update auth_session set locked_at = null where id = $1`, [sid]);
    expect(await use(u, s, b!)).toBe(true);
    await env.h.admin.query(`update auth_two_factor set secret = secret || 'x' where user_id = $1`, [u.id]);
    expect(await use(u, s, b!)).toBe(false);
  });

  it("a forged, cast, copied or test proof is refused outside Vitest; a literal does not type-check", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const real = await env.auth.stepUp(c.headers(), totp(secret));
    // @ts-expect-error HYG-026: an object literal cannot satisfy the branded StepUp.
    const literal: StepUp = { verified: true };
    expect(await use(u, literal, c)).toBe(false);
    expect(await use(u, { ...real! } as StepUp, c)).toBe(false);
    expect(await use(u, { verified: true } as unknown as StepUp, c)).toBe(false);
    expect(await use(u, undefined as unknown as StepUp, c)).toBe(false);
    expect(Object.isFrozen(real)).toBe(true);
    expect(Object.keys(real!)).toEqual(["verified"]); // nothing readable to tamper with
    const t = stepUpForTests();
    expect(await use(u, t, null)).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(await use(u, t, null)).toBe(false);
    expect(() => stepUpForTests()).toThrow(/tests only/);
    vi.stubEnv("NODE_ENV", "development");
    expect(() => stepUpForTests()).toThrow(/tests only/);
  });
});

describe("freshStepUp: the session's last gated step-up within the window", () => {
  // Provenance comes only from stepUp's exact-row gate: a sign-in or enrolment TOTP alone gives no fresh proof.
  const proved = async (c: Client, secret: string) => {
    expect(await env.auth.stepUp(c.headers(), totp(secret))).not.toBeNull();
    return env.clock.now.getTime();
  };

  it("sign-in / enrolment TOTP alone: no fresh proof (the shared after hook records no provenance)", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    expect((await sessionOf(c)).second_factor_at).not.toBeNull();
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
    const d = await another(u.email, secret);
    expect(await env.auth.freshStepUp(d.headers())).toBeNull();
    await proved(c, secret);
    expect(await env.auth.freshStepUp(c.headers())).not.toBeNull();
  });

  it("fresh within 10 minutes of the step-up (edge inside); narrower honoured; stale null; a step-up renews it", async () => {
    expect(STEP_UP_MAX_AGE_MS).toBe(10 * MIN);
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const at = await proved(c, secret);
    expect(await use(u, await env.auth.freshStepUp(c.headers()), c)).toBe(true);
    env.clock.now = new Date(at + STEP_UP_MAX_AGE_MS);
    expect(await env.auth.freshStepUp(c.headers())).not.toBeNull();
    expect(await env.auth.freshStepUp(c.headers(), 5 * MIN)).toBeNull();
    env.clock.now = new Date(at + STEP_UP_MAX_AGE_MS + 1);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
    expect(await env.auth.freshStepUp(c.headers(), 60 * MIN)).toBeNull();
    await proved(c, secret);
    expect(await env.auth.freshStepUp(c.headers())).not.toBeNull();
  });

  it("a fresh proof expires at the step-up time + window, not at issue time", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const at = await proved(c, secret);
    env.clock.now = new Date(at + 9 * MIN);
    const s = await env.auth.freshStepUp(c.headers());
    const b = await bindingOf(c);
    expect(await use(u, s, b!)).toBe(true);
    env.clock.now = new Date(at + STEP_UP_MAX_AGE_MS + 1);
    expect(await use(u, s, b!)).toBe(false);
  });

  it("a backup code never gives or extends a fresh proof; backup-code sign-in still works", async () => {
    const u = await staff();
    const c = new Client(env.auth);
    expect((await c.signIn(u.email)).status).toBe(200);
    const enable = await c.post("/two-factor/enable", { password: PASSWORD });
    const secret = secretFromUri(String(enable.json.totpURI));
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    const backup = enable.json.backupCodes as string[];
    const d = new Client(env.auth);
    expect((await d.signIn(u.email)).json.twoFactorRedirect).toBe(true);
    expect((await d.post("/two-factor/verify-backup-code", { code: backup[0] })).status).toBe(200);
    expect((await sessionOf(d)).second_factor_at).not.toBeNull();
    expect(await env.auth.freshStepUp(d.headers())).toBeNull();
    const at = await proved(c, secret);
    env.clock.now = new Date(at + STEP_UP_MAX_AGE_MS + 1);
    expect((await c.post("/two-factor/verify-backup-code", { code: backup[1] })).status).toBe(200);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
  });

  it("the authenticator turned off in another session (a role without required TOTP): no proof in this one", async () => {
    const u = await staff("fo_cashier");
    const { c: a, secret } = await enrolled(u.email);
    const b = await another(u.email, secret);
    await proved(b, secret);
    expect(await env.auth.freshStepUp(b.headers())).not.toBeNull();
    expect((await a.post("/two-factor/disable", { password: PASSWORD, code: totp(secret) })).status).toBe(200);
    expect(await env.auth.freshStepUp(b.headers())).toBeNull();
    const a2 = new Client(env.auth);
    expect((await a2.signIn(u.email)).status).toBe(200);
    const enable = await a2.post("/two-factor/enable", { password: PASSWORD });
    expect((await a2.post("/two-factor/verify-totp", { code: totp(secretFromUri(String(enable.json.totpURI))) })).status).toBe(200);
    expect(await env.auth.freshStepUp(b.headers())).toBeNull();
  });

  it("a factor replaced between the plugin's success and provenance: no provenance, so no fresh proof", async () => {
    // The interval the r2 review named: the code is accepted for the old authenticator, then the factor is replaced
    // before anything is recorded. The gate refuses the stamp, so stepUp records nothing and freshStepUp asks for a code.
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { afterVerify: async () => { await env.h.admin.query(`update auth_two_factor set secret = secret || 'x' where user_id = $1`, [u.id]); } },
    });
    expect(await auth.stepUp(c.headers(), totp(secret))).toBeNull();
    expect(await auth.freshStepUp(c.headers())).toBeNull();
  });

  it("a lock while the code is being checked: the gate refuses, nothing is recorded, so no fresh proof after unlock", async () => {
    // The provenance is published only after the exact-row gate; here the gate updates 0 rows (the session was locked
    // after the plugin's success), so after unlocking there is still no fresh proof (no TOTP time was recorded).
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const ctx = await env.auth.auth.$context;
    const tok = token(c);
    const auth = createAuth({
      pool: env.pool, baseURL: BASE_URL, secret: ctx.secret, roles: async (id) => env.roles.get(id) ?? [], now: () => env.clock.now, rateLimit: false, sleep: async () => {},
      stepUpHooks: { afterVerify: async () => { await env.h.admin.query(`update auth_session set locked_at = now() where token = $1`, [tok]); } },
    });
    expect(await auth.stepUp(c.headers(), totp(secret))).toBeNull();
    await env.h.admin.query(`update auth_session set locked_at = null where token = $1`, [tok]);
    expect(await auth.freshStepUp(c.headers())).toBeNull();
  });

  it("a successful verify-totp over HTTP (the shared after hook) records no provenance, in the same factory", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
  });

  it("locked and idle-locked sessions give no fresh proof; the check records no activity", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    await proved(c, secret);
    const row = await sessionOf(c);
    await env.h.admin.query(`update auth_session set locked_at = now() where id = $1`, [row.id]);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
    await env.h.admin.query(`update auth_session set locked_at = null where id = $1`, [row.id]);
    expect(await env.auth.freshStepUp(c.headers())).not.toBeNull();
    const f = await staff("fo_cashier");
    const { c: fc, secret: fs } = await enrolled(f.email);
    await proved(fc, fs);
    const before = (await sessionOf(fc)).last_active_at;
    env.clock.now = new Date(env.clock.now.getTime() + 3 * MIN);
    expect(await env.auth.freshStepUp(fc.headers())).toBeNull();
    expect((await sessionOf(fc)).last_active_at).toEqual(before);
  });

  it("future: the clock behind the recorded step-up time is refused", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const at = await proved(c, secret);
    env.clock.now = new Date(at - 1);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
  });

  it("future: a persisted second_factor_at ahead of this clock beyond 1 minute is refused, and never extends the window", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const at = await proved(c, secret);
    const sid = (await sessionOf(c)).id;
    // Within the skew: still a proof.
    await env.h.admin.query(`update auth_session set second_factor_at = $2 where id = $1`, [sid, new Date(at + 60_000)]);
    expect(await env.auth.freshStepUp(c.headers())).not.toBeNull();
    // Beyond the skew (another process with a clock ahead): refused although the local step-up is valid.
    await env.h.admin.query(`update auth_session set second_factor_at = $2 where id = $1`, [sid, new Date(at + 60_001)]);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
    // A later persisted stamp does not extend the window: the age is from the recorded step-up.
    await env.h.admin.query(`update auth_session set second_factor_at = $2 where id = $1`, [sid, new Date(at + STEP_UP_MAX_AGE_MS)]);
    env.clock.now = new Date(at + STEP_UP_MAX_AGE_MS + 1);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
  });

  it("the recorded step-up must be covered by the session row's second_factor_at (cleared or older: no proof)", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const at = await proved(c, secret);
    const sid = (await sessionOf(c)).id;
    expect(await env.auth.freshStepUp(c.headers())).not.toBeNull();
    await env.h.admin.query(`update auth_session set second_factor_at = null where id = $1`, [sid]);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
    await env.h.admin.query(`update auth_session set second_factor_at = $2 where id = $1`, [sid, new Date(at - 1)]);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
  });

  it("a session that never proved TOTP, and anonymous, are null", async () => {
    const u = await staff("fo_cashier");
    const c = new Client(env.auth);
    expect((await c.signIn(u.email)).status).toBe(200);
    expect(await env.auth.freshStepUp(c.headers())).toBeNull();
    expect(await env.auth.freshStepUp(new Client(env.auth).headers())).toBeNull();
  });
});

describe("other surface", () => {
  const SECRET = randomBytes(32).toString("base64");
  const VENDOR_URL = "https://vendor.test";
  let pool: Awaited<ReturnType<typeof openAppPool>>;
  let clinic: ReturnType<typeof createAuth>;
  let vendor: ReturnType<typeof createAuth>;
  beforeAll(async () => {
    pool = await openAppPool({ connectionString: env.h.urlAs(await env.h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 4 }, AUTH_GROUP_ROLE);
    const common = { pool, secret: SECRET, rateLimit: false, sleep: async () => {} };
    clinic = createAuth({ ...common, baseURL: BASE_URL, roles: async () => ["doctor"] });
    vendor = createAuth({ ...common, baseURL: VENDOR_URL, surface: "vendor", roles: async () => [], allowAddress: async () => true });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("the vendor factory never mints; tokens moved across surfaces are null and uncounted", async () => {
    const email = `stepup-surface${++n}@klinik-sintetis.test`;
    const user = await clinic.createStaffAccount({ email, name: "Lintas", password: PASSWORD });
    const { c, secret } = await enrolled(email, clinic);
    expect(await clinic.stepUp(c.headers(), totp(secret))).not.toBeNull();
    const clinicToken = [...c.cookies].find(([k]) => k.endsWith("session_token"))![1];
    const renamed = new Headers({ origin: VENDOR_URL, "x-real-ip": "198.51.100.7", cookie: `__Host-vendor.session_token=${clinicToken}` });
    expect(await vendor.stepUp(renamed, totp(secret))).toBeNull();
    expect(await vendor.freshStepUp(renamed)).toBeNull();

    const v = await vendor.auth.handler(new Request(`${VENDOR_URL}/vendor/api/auth/sign-in/email`, {
      method: "POST", headers: { origin: VENDOR_URL, "x-real-ip": "198.51.100.7", "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
    }));
    expect(((await v.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    const challenge = v.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
    const done = await vendor.auth.handler(new Request(`${VENDOR_URL}/vendor/api/auth/two-factor/verify-totp`, {
      method: "POST", headers: { origin: VENDOR_URL, "x-real-ip": "198.51.100.7", "content-type": "application/json", cookie: challenge }, body: JSON.stringify({ code: totp(secret) }),
    }));
    expect(done.status).toBe(200);
    const vendorToken = done.headers.getSetCookie().map((s) => s.split(";")[0]).find((p) => p.startsWith("__Host-vendor.session_token="))!.split("=").slice(1).join("=");
    const control = new Headers({ origin: BASE_URL, "x-real-ip": "203.0.113.10", cookie: `better-auth.session_token=${clinicToken}` });
    expect(await clinic.freshStepUp(control)).not.toBeNull();
    const onApp = new Headers({ origin: BASE_URL, "x-real-ip": "203.0.113.10", cookie: `better-auth.session_token=${vendorToken}` });
    expect(await clinic.stepUp(onApp, totp(secret))).toBeNull();
    expect(await clinic.freshStepUp(onApp)).toBeNull();
    const vendorHeaders = new Headers({ origin: VENDOR_URL, "x-real-ip": "198.51.100.7", cookie: `__Host-vendor.session_token=${vendorToken}` });
    expect((await vendor.checkSession(vendorHeaders, { activity: false })).gate).toBe("ok");
    expect(await vendor.stepUp(vendorHeaders, totp(secret))).toBeNull();
    expect(await vendor.freshStepUp(vendorHeaders)).toBeNull();
    expect((await budget(user.id)).n).toBe(0);
  });
});

describe("the issuing authority stays private", () => {
  it("src/ exports no minter; only tests/support names the test seam; client modules do not import the auth factory", () => {
    const root = join(import.meta.dirname, "../../src");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const files = walk(root).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
    const text = (f: string) => readFileSync(f, "utf8");
    const rel = (f: string) => f.slice(root.length + 1);
    // The mint and the registry are module-private in server.ts (no export of either).
    const server = text(join(root, "auth/server.ts"));
    expect(server).not.toMatch(/export\s+(const|function|let)\s+(mint|proofs)\b/);
    expect(server).not.toMatch(/export\s*\{[^}]*\b(mint|proofs)\b/);
    // The seam is named only where it is defined.
    expect(files.filter((f) => /\bstepUpTestSeam\b|\bstepUpForTests\b/.test(text(f))).map(rel)).toEqual(["auth/server.ts"]);
    // No client component imports the auth factory or a consumer module (they import it).
    const consumers = /from\s+"[^"]*(auth\/server|clinical\/records\/records|documents\/documents|pharmacy\/pharmacy)"/;
    const clients = files.filter((f) => /^\s*["']use client["']/.test(text(f)));
    expect(clients.filter((f) => text(f).split("\n").some((l) => consumers.test(l) && !/^\s*import\s+type\b/.test(l))).map(rel)).toEqual([]);
  });
});
