// HYG-007 (DEC-041 (1), DEC-010): the second factor needs the device.
// - /two-factor/get-totp-uri is refused (the secret is shown once, at enrolment);
// - new backup codes need the password and a current authenticator code;
// - codes checked from an open session (step-up, enrolment completion) count per account
//   exactly like at sign-in: 5 failures lock 15 minutes, one budget shared with sign-in.
// Over HTTP-shaped requests on a real PostgreSQL as clinic_auth. Time is moved with
// vi.setSystemTime (only Date is faked), which moves Better Auth's clock and this code's.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { callAuth, MESSAGES } from "../../src/app/(auth)/client";
import type { Role } from "../../src/auth/policy";
import { createAuth, TOTP_URI_UNAVAILABLE_CODE, TWO_FACTOR_LOCKED_CODE } from "../../src/auth/server";
import { AUTH_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { type AuthEnv, BASE_URL, Client, createAuthEnv, PASSWORD, secretFromUri, totp } from "./helpers";

let env: AuthEnv;
let n = 0;
const MIN = 60_000;

async function staff(roles: Role[] = ["finance"]): Promise<{ id: string; email: string }> {
  const email = `faktor${++n}@klinik-sintetis.test`;
  const user = await env.auth.createStaffAccount({ email, name: `Staf ${n}`, password: PASSWORD });
  env.roles.set(user.id, roles);
  return { id: user.id, email };
}
// Enrols TOTP from a signed-in session; returns the secret and the backup codes.
async function enrolled(email: string): Promise<{ c: Client; secret: string; backup: string[] }> {
  const c = new Client(env.auth);
  expect((await c.signIn(email)).status).toBe(200);
  const enable = await c.post("/two-factor/enable", { password: PASSWORD });
  expect(enable.status).toBe(200);
  const secret = secretFromUri(String(enable.json.totpURI));
  expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  return { c, secret, backup: enable.json.backupCodes as string[] };
}
// A fresh password sign-in that stops at the two-factor challenge (no session yet).
async function challenge(email: string): Promise<Client> {
  const d = new Client(env.auth);
  const r = await d.signIn(email);
  expect(r.status).toBe(200);
  expect(r.json.twoFactorRedirect).toBe(true);
  return d;
}
// A code that is wrong in every period the verifier accepts (previous, current, next;
// @better-auth/utils otp.mjs verifyTOTP window = 1), with a margin for a test's own duration.
const wrong = (secret: string) => {
  const now = Date.now();
  const valid = new Set([-2, -1, 0, 1, 2].map((p) => totp(secret, now + p * 30_000)));
  for (const c of ["000000", "111111", "222222", "333333", "444444", "555555"]) if (!valid.has(c)) return c;
  throw new Error("no wrong code found");
};
const row = async (userId: string) =>
  (await env.h.admin.query<{ n: number; locked: Date | null }>(
    `select failed_verification_count as n, locked_until as locked from auth_two_factor where user_id = $1`,
    [userId],
  )).rows[0];
const secondFactorAt = async (c: Client) => {
  const token = decodeURIComponent([...c.cookies].find(([k]) => k.endsWith("session_token"))![1]).split(".")[0];
  return (await env.h.admin.query(`select second_factor_at from auth_session where token = $1`, [token])).rows[0]?.second_factor_at as Date | null;
};
const rate2Rows = async (email: string) =>
  (await env.h.admin.query<{ n: number }>(`select count(*)::int n from auth_login_failure where email = $1`, [email])).rows[0].n;
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

beforeAll(async () => {
  env = await createAuthEnv();
});
afterAll(async () => {
  await env?.close();
});
let clockAtStart: Date;
beforeEach(() => {
  clockAtStart = env.clock.now;
});
afterEach(() => {
  vi.useRealTimers();
  env.clock.now = clockAtStart;
});

describe("F1: the authenticator secret is shown once", () => {
  it("get-totp-uri is refused for an enrolled account with the right password, and claims no attempt", async () => {
    const u = await staff();
    const { c } = await enrolled(u.email);
    const before = await rate2Rows(u.email);
    const r = await c.post("/two-factor/get-totp-uri", { password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe(TOTP_URI_UNAVAILABLE_CODE);
    expect(r.json.totpURI).toBeUndefined();
    expect(await rate2Rows(u.email)).toBe(before);
  });

  it("a session still enrolling gets the same refusal, not the session gate's", async () => {
    const u = await staff(["nurse"]); // a role that must enrol
    const c = new Client(env.auth);
    await c.signIn(u.email);
    expect((await c.post("/two-factor/enable", { password: PASSWORD })).status).toBe(200);
    const r = await c.post("/two-factor/get-totp-uri", { password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe(TOTP_URI_UNAVAILABLE_CODE);
  });
});

describe("F1b: new backup codes need the device", () => {
  it("password without a code, or with a wrong code, makes no codes; a current code does", async () => {
    const u = await staff();
    const { c, secret, backup } = await enrolled(u.email);
    const none = await c.post("/two-factor/generate-backup-codes", { password: PASSWORD });
    expect(none.status).toBe(401);
    expect(none.json.backupCodes).toBeUndefined();
    const rateBefore = await rate2Rows(u.email);
    const bad = await c.post("/two-factor/generate-backup-codes", { password: PASSWORD, code: wrong(secret) });
    expect(bad.status).toBe(401);
    expect(bad.json.backupCodes).toBeUndefined();
    // Exactly one RATE-2 claim and one second-factor failure for the wrong code.
    expect(await rate2Rows(u.email)).toBe(rateBefore + 1);
    expect((await row(u.id)).n).toBe(1);
    // The old codes still work.
    const d = await challenge(u.email);
    expect((await d.post("/two-factor/verify-backup-code", { code: backup[0] })).status).toBe(200);
    const ok = await c.post("/two-factor/generate-backup-codes", { password: PASSWORD, code: totp(secret) });
    expect(ok.status).toBe(200);
    expect(ok.json.backupCodes as string[]).toHaveLength(10);
  });
});

describe("F2: one per-account budget for codes, at sign-in and from an open session", () => {
  it("sign-in: 5 wrong codes lock the account; a correct code is refused; after 15 minutes it works", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const u = await staff();
    const { secret } = await enrolled(u.email);
    for (let i = 0; i < 5; i++) {
      const d = await challenge(u.email); // a fresh challenge each time: it has its own 5-try budget
      expect((await d.post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    }
    expect((await row(u.id)).n).toBe(5);
    const locked = await (await challenge(u.email)).post("/two-factor/verify-totp", { code: totp(secret) });
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe(TWO_FACTOR_LOCKED_CODE);
    advance(15 * MIN + 1_000);
    const after = await (await challenge(u.email)).post("/two-factor/verify-totp", { code: totp(secret) });
    expect(after.status).toBe(200);
    expect((await row(u.id)).n).toBe(0);
  });

  it("step-up TOTP: 5 wrong codes lock; second_factor_at stays; after expiry one wrong code leaves count 1", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const at = await secondFactorAt(c);
    // Move the app clock (what second_factor_at is stamped with) so a refresh would show.
    env.clock.now = new Date(env.clock.now.getTime() + 30_000);
    for (let i = 0; i < 5; i++) expect((await c.post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    expect(await secondFactorAt(c)).toEqual(at);
    const locked = await c.post("/two-factor/verify-totp", { code: totp(secret) });
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe(TWO_FACTOR_LOCKED_CODE);
    expect(await secondFactorAt(c)).toEqual(at);
    advance(15 * MIN + 1_000);
    expect((await c.post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    const r = await row(u.id);
    expect(r.n).toBe(1);
    expect(r.locked).toBeNull();
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    expect((await row(u.id)).n).toBe(0);
  });

  it("step-up backup codes: wrong codes lock; a valid code is refused while locked and works after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const u = await staff();
    const { c, backup } = await enrolled(u.email);
    for (let i = 0; i < 5; i++) expect((await c.post("/two-factor/verify-backup-code", { code: `salah-${i}` })).status).toBe(401);
    const locked = await c.post("/two-factor/verify-backup-code", { code: backup[0] });
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe(TWO_FACTOR_LOCKED_CODE);
    advance(15 * MIN + 1_000);
    expect((await c.post("/two-factor/verify-backup-code", { code: backup[0] })).status).toBe(200);
    expect((await row(u.id)).n).toBe(0);
  });

  it("one shared budget: step-up failures lock sign-in, sign-in failures lock step-up, TOTP and backup codes add up", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    for (let i = 0; i < 3; i++) expect((await c.post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    expect((await c.post("/two-factor/verify-backup-code", { code: "salah-1" })).status).toBe(401);
    expect((await (await challenge(u.email)).post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    expect((await row(u.id)).n).toBe(5);
    expect((await (await challenge(u.email)).post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(429);
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(429);
  });

  it("a success clears a partial budget", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    for (let i = 0; i < 3; i++) await c.post("/two-factor/verify-totp", { code: wrong(secret) });
    expect((await row(u.id)).n).toBe(3);
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    expect((await row(u.id)).n).toBe(0);
  });

  it("enrolment: wrong codes count and lock; after expiry a correct code completes enrolment and clears the count", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const u = await staff();
    const c = new Client(env.auth);
    await c.signIn(u.email);
    const enable = await c.post("/two-factor/enable", { password: PASSWORD });
    const secret = secretFromUri(String(enable.json.totpURI));
    for (let i = 0; i < 5; i++) expect((await c.post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(429);
    advance(15 * MIN + 1_000);
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    expect((await env.h.admin.query(`select verified from auth_two_factor where user_id = $1`, [u.id])).rows[0].verified).toBe(true);
    expect((await row(u.id)).n).toBe(0);
  });

  it("enrolment: two wrong codes then a correct one complete it with count 0 (the session is replaced)", async () => {
    const u = await staff();
    const c = new Client(env.auth);
    await c.signIn(u.email);
    const enable = await c.post("/two-factor/enable", { password: PASSWORD });
    const secret = secretFromUri(String(enable.json.totpURI));
    for (let i = 0; i < 2; i++) await c.post("/two-factor/verify-totp", { code: wrong(secret) });
    expect((await row(u.id)).n).toBe(2);
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    expect((await row(u.id)).n).toBe(0);
  });

  it("a revoked session's cookie beside a sign-in challenge counts once (the plugin counts it as a sign-in)", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    const d = await challenge(u.email);
    // Carry the revoked session's cookie into the challenge browser.
    const sessionCookie = [...c.cookies].find(([k]) => k.endsWith("session_token"))!;
    await env.h.admin.query(`delete from auth_session where user_id = $1`, [u.id]);
    d.cookies.set(sessionCookie[0], sessionCookie[1]);
    expect((await d.post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    expect((await row(u.id)).n).toBe(1);
  });

  it("turning off and making backup codes are refused while locked; a wrong code to turn off counts once", async () => {
    const u = await staff();
    const { c, secret } = await enrolled(u.email);
    expect((await c.post("/two-factor/disable", { password: PASSWORD, code: wrong(secret) })).status).toBe(401);
    expect((await row(u.id)).n).toBe(1);
    for (let i = 0; i < 4; i++) await c.post("/two-factor/verify-totp", { code: wrong(secret) });
    const off = await c.post("/two-factor/disable", { password: PASSWORD, code: totp(secret) });
    expect(off.status).toBe(429);
    expect(off.json.code).toBe(TWO_FACTOR_LOCKED_CODE);
    const regen = await c.post("/two-factor/generate-backup-codes", { password: PASSWORD, code: totp(secret) });
    expect(regen.status).toBe(429);
    expect(regen.json.backupCodes).toBeUndefined();
  });

  it("a session without a second factor gets the plugin's answer and no row is created", async () => {
    const u = await staff();
    const c = new Client(env.auth);
    expect((await c.signIn(u.email)).status).toBe(200);
    const r = await c.post("/two-factor/verify-totp", { code: "000000" });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("TOTP_NOT_ENABLED");
    expect((await env.h.admin.query(`select count(*)::int n from auth_two_factor where user_id = $1`, [u.id])).rows[0].n).toBe(0);
  });

  it("a 429 with the second-factor lockout code is shown with the clinic copy (callAuth)", async () => {
    expect(MESSAGES[TWO_FACTOR_LOCKED_CODE]).toBe("Akun dikunci sementara. Coba lagi dalam 15 menit.");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: TWO_FACTOR_LOCKED_CODE, message: "x" }), { status: 429 })) as typeof fetch;
    try {
      expect(await callAuth("/two-factor/verify-totp", { code: "000000" })).toEqual({ ok: false, message: "Akun dikunci sementara. Coba lagi dalam 15 menit." });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("F2 on the vendor surface", () => {
  // Both surfaces over one account store and one signing secret, as in production
  // (tests/vendor/host.test.ts does the same), so a clinic token can be presented to the
  // vendor surface with a valid signature and be refused for its surface.
  const SECRET = randomBytes(32).toString("base64");
  const VENDOR_URL = "https://vendor.test";
  let app: ReturnType<typeof createAuth>;
  let vendor: ReturnType<typeof createAuth>;
  let pool: Awaited<ReturnType<typeof openAppPool>>;
  let allow = true;
  beforeAll(async () => {
    pool = await openAppPool({ connectionString: env.h.urlAs(await env.h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 4 }, AUTH_GROUP_ROLE);
    const common = { pool, secret: SECRET, rateLimit: false, sleep: async () => {} };
    app = createAuth({ ...common, baseURL: BASE_URL, roles: async () => [] });
    vendor = createAuth({ ...common, baseURL: VENDOR_URL, surface: "vendor", roles: async () => [], allowAddress: async () => allow });
  });
  afterAll(async () => {
    await pool?.end();
  });
  // A vendor-surface browser: the auth API under /vendor/api/auth, __Host-vendor cookies.
  class VendorClient extends Client {
    override async post(path: string, body: unknown) {
      const headers = this.headers();
      headers.set("origin", VENDOR_URL);
      headers.set("content-type", "application/json");
      const res = await vendor.auth.handler(new Request(`${VENDOR_URL}/vendor/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
      for (const ck of res.headers.getSetCookie()) {
        const [pair, ...attrs] = ck.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (attrs.some((a) => /max-age=0/i.test(a.trim())) || value === "") this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : {} };
    }
  }
  const snapshot = async (userId: string, v: Client) => ({ ...(await row(userId)), at: await secondFactorAt(v) });

  it("step-up lockout on the vendor surface; a foreign-surface session and a disallowed address are refused uncounted", async () => {
    const email = `vendor-faktor${++n}@vendor-sintetis.test`;
    // The clinic session is made before TOTP is enrolled, so sign-in gives a session, not a challenge.
    const clinic = new Client(app);
    const user = await app.createStaffAccount({ email, name: "Vendor", password: PASSWORD });
    expect((await clinic.signIn(email)).status).toBe(200);
    const clinicCookie = [...clinic.cookies].find(([k]) => k.endsWith("session_token"));
    expect(clinicCookie).toBeDefined();

    const v = new VendorClient(vendor as never, "198.51.100.7");
    expect((await v.signIn(email)).status).toBe(200);
    const enable = await v.post("/two-factor/enable", { password: PASSWORD });
    const secret = secretFromUri(String(enable.json.totpURI));
    expect((await v.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    const before = await snapshot(user.id, v);
    expect(before.n).toBe(0);

    // A disallowed address: refused before anything is counted.
    allow = false;
    const blocked = await v.post("/two-factor/verify-totp", { code: wrong(secret) });
    allow = true;
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe("ADDRESS_NOT_ALLOWED");
    // The clinic token renamed to the vendor cookie (valid signature): refused for its surface.
    const foreign = new VendorClient(vendor as never, "198.51.100.7");
    foreign.cookies.set("__Host-vendor.session_token", clinicCookie![1]);
    const wrongSurface = await foreign.post("/two-factor/verify-totp", { code: wrong(secret) });
    expect(wrongSurface.status).toBe(401);
    expect(wrongSurface.json.code).toBe("SESSION_WRONG_SURFACE");
    expect(await snapshot(user.id, v)).toEqual(before);

    for (let i = 0; i < 5; i++) expect((await v.post("/two-factor/verify-totp", { code: wrong(secret) })).status).toBe(401);
    const locked = await v.post("/two-factor/verify-totp", { code: totp(secret) });
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe(TWO_FACTOR_LOCKED_CODE);
    const after = await snapshot(user.id, v);
    expect(after.n).toBe(5);
    expect(after.at).toEqual(before.at);
  });
});

describe("F2 concurrency: the row lock serializes counts (deterministic)", () => {
  it("a second counted code waits on the first one's row lock; the count ends at 2", async () => {
    const u = await staff();
    // A dedicated auth instance with the test hooks, over its own pool. The user enrols through
    // it, so its TOTP secret is encrypted with this instance's BETTER_AUTH_SECRET.
    const pool = await openAppPool({ connectionString: env.h.urlAs(await env.h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 4 }, AUTH_GROUP_ROLE);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let reached = 0;
    let firstAtHook!: () => void;
    const firstHeld = new Promise<void>((r) => (firstAtHook = r));
    const pids: number[] = [];
    // Armed only for the two counted calls below: completing enrolment is itself a counted
    // code check, and an armed hook would hold it forever.
    let armed = false;
    const hooked = createAuth({
      pool,
      baseURL: BASE_URL,
      secret: randomBytes(32).toString("base64"),
      roles: async () => [],
      rateLimit: false,
      sleep: async () => {},
      twoFactorCountHooks: {
        onBackend: (pid) => {
          if (armed) pids.push(pid);
        },
        afterRead: async () => {
          if (!armed) return;
          reached += 1;
          if (reached === 1) {
            firstAtHook();
            await held;
          }
        },
      },
    });
    let first: Promise<{ status: number }> | undefined;
    let second: Promise<{ status: number }> | undefined;
    try {
      const c = new Client(hooked);
      expect((await c.signIn(u.email)).status).toBe(200);
      const enable = await c.post("/two-factor/enable", { password: PASSWORD });
      expect(enable.status).toBe(200);
      const secret = secretFromUri(String(enable.json.totpURI));
      expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
      reached = 0;
      pids.length = 0;
      armed = true;
      first = c.post("/two-factor/verify-totp", { code: wrong(secret) });
      // Bounded (real time): the first request must reach the hook, or fail the test at once.
      const reachedOrSettled = await Promise.race([
        firstHeld.then(() => "held" as const),
        first.then((r) => `settled ${r.status}` as const),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 10_000)),
      ]);
      if (reachedOrSettled !== "held") throw new Error(`the first count never reached the hook (${reachedOrSettled})`);
      second = c.post("/two-factor/verify-totp", { code: wrong(secret) });
      // The second request's counting transaction is waiting on the row lock, observed by its pid.
      const start = performance.now();
      for (;;) {
        if (reached >= 2) throw new Error("the second count read the row while the first held it (no row lock)");
        if (pids.length >= 2) {
          const w = await env.h.admin.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pids[1]]);
          if (w.rows[0]?.wait_event_type === "Lock") break;
        }
        if (performance.now() - start > 10_000) throw new Error(`second count never waited on the row lock (pids ${pids})`);
        await new Promise((r) => setTimeout(r, 20));
      }
      release();
      expect((await first).status).toBe(401);
      expect((await second!).status).toBe(401);
      expect((await row(u.id)).n).toBe(2);
    } finally {
      release();
      await Promise.allSettled([first, second].filter(Boolean));
      await pool.end();
    }
  });
});

describe("F3: backup codes are not stored in plain text", () => {
  it("no issued backup code appears in storage", async () => {
    const u = await staff();
    const { backup } = await enrolled(u.email);
    const stored = String((await env.h.admin.query(`select backup_codes from auth_two_factor where user_id = $1`, [u.id])).rows[0].backup_codes);
    expect(backup).toHaveLength(10);
    for (const code of backup) expect(stored).not.toContain(code);
  });
});
