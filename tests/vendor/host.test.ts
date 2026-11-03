// T-021 Done-when (SEC-21): a clinic session cookie is rejected on the vendor host and
// vice versa; the CSP header is present; tenant strings are escaped in vendor tables.
// Runs the shared auth factory as two surfaces over one real account store, the console
// functions under a clinic_vendor login, the proxy in-process and the tenant table with
// a hostile tenant name. HTTP-level header checks over the production build live in
// tests/platform/hosts.spec.ts.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_GROUP_ROLE, VENDOR_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { type Auth, createAuth, VENDOR_AUTH_BASE_PATH } from "../../src/auth/server";
import { bootstrapVendor, createVendorStaff } from "../../src/modules/vendor/staff/staff";
import { createHarness, type Harness } from "../rls/harness";
import { PASSWORD, secretFromUri, totp } from "../auth/helpers";

const APP = "http://app.test";
const VENDOR = "https://vendor.test";
const IP = "203.0.113.10";

let h: Harness;
let authPool: pg.Pool;
let vendorDb: pg.Pool;
let ownerPool: pg.Pool; // platform operator (database owner) for setup only
let app: Auth;
let vendor: Auth;
let n = 0;
const SECRET = randomBytes(32).toString("base64");

// A cookie jar per browser and per surface: the browser keeps host-only cookies apart,
// so each client talks to one surface; tests then move tokens across on purpose.
class Browser {
  cookies = new Map<string, string>();
  constructor(private readonly auth: Auth, private readonly origin: string, private readonly base: string, private readonly ip = IP) {}
  headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers({ origin: this.origin, "x-real-ip": this.ip, ...extra });
    if (this.cookies.size) h.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    return h;
  }
  setCookies: string[] = [];
  async post(path: string, body: unknown) {
    const headers = this.headers({ "content-type": "application/json" });
    const res = await this.auth.auth.handler(new Request(`${this.origin}${this.base}${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
    for (const c of res.headers.getSetCookie()) {
      this.setCookies.push(c);
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || pair.slice(i + 1) === "";
      if (expired) this.cookies.delete(pair.slice(0, i));
      else this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }
  async get(path: string) {
    const res = await this.auth.auth.handler(new Request(`${this.origin}${this.base}${path}`, { headers: this.headers() }));
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown> | null) : null };
  }
}
const appBrowser = () => new Browser(app, APP, "/api/auth");
const vendorBrowser = () => new Browser(vendor, VENDOR, VENDOR_AUTH_BASE_PATH);

async function account(): Promise<{ id: string; email: string }> {
  const email = `vendor${++n}@vendor-sintetis.test`;
  const user = await app.createStaffAccount({ email, name: `Akun ${n}`, password: PASSWORD });
  return { id: user.id, email };
}

// Enrol TOTP through the given surface and return the secret.
async function enrol(b: Browser): Promise<string> {
  const e = await b.post("/two-factor/enable", { password: PASSWORD });
  expect(e.status).toBe(200);
  const secret = secretFromUri(String(e.json.totpURI));
  expect((await b.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  return secret;
}

// Sign in on the vendor surface with TOTP; returns the browser.
async function vendorSignIn(email: string, secret: string): Promise<Browser> {
  const b = vendorBrowser();
  const r = await b.post("/sign-in/email", { email, password: PASSWORD });
  expect(r.status).toBe(200);
  expect(r.json.twoFactorRedirect).toBe(true);
  expect((await b.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  return b;
}

const sessionCookie = (b: Browser) => [...b.cookies].find(([k]) => k.endsWith("session_token"))!;
const surfaceOf = async (b: Browser) =>
  (await h.admin.query(`select surface, second_factor_at from auth_session where token = $1`, [decodeURIComponent(sessionCookie(b)[1]).split(".")[0]])).rows[0];

beforeAll(async () => {
  h = await createHarness();
  authPool = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 4 }, AUTH_GROUP_ROLE);
  vendorDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 2 }, VENDOR_GROUP_ROLE);
  ownerPool = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  const common = { pool: authPool, secret: SECRET, rateLimit: false, sleep: async () => {} };
  app = createAuth({ ...common, baseURL: APP, roles: async () => [] });
  vendor = createAuth({ ...common, baseURL: VENDOR, surface: "vendor", roles: async () => [], allowAddress: async () => true });
});

afterAll(async () => {
  await vendorDb?.end();
  await ownerPool?.end();
  await authPool?.end();
  await h?.close();
});

describe("separate sessions per surface (SEC-21)", () => {
  it("vendor cookies are __Host-, Secure, SameSite=Strict, HttpOnly, host-only, Path=/", async () => {
    const a = await account();
    const b = vendorBrowser();
    expect((await b.post("/sign-in/email", { email: a.email, password: PASSWORD })).status).toBe(200);
    expect(b.setCookies.length).toBeGreaterThan(0);
    for (const c of b.setCookies) {
      expect(c, c).toMatch(/^__Host-vendor\./);
      expect(c, c).toMatch(/;\s*Secure/i);
      expect(c, c).toMatch(/;\s*SameSite=Strict/i);
      expect(c, c).toMatch(/;\s*HttpOnly/i);
      expect(c, c).toMatch(/;\s*Path=\/(;|$)/i);
      expect(c, c).not.toMatch(/;\s*Domain=/i);
    }
    // The clinic app's cookies never share a name with the vendor's.
    const c = appBrowser();
    await c.post("/sign-in/email", { email: a.email, password: PASSWORD });
    expect([...c.cookies.keys()].every((k) => !k.startsWith("__Host-vendor"))).toBe(true);
  });

  it("every vendor account must enrol TOTP, whatever clinic roles it holds; the second factor time is recorded", async () => {
    const a = await account();
    const b = vendorBrowser();
    await b.post("/sign-in/email", { email: a.email, password: PASSWORD });
    expect((await vendor.checkSession(b.headers())).gate).toBe("enrol_totp");
    // The same account on the clinic app (no TOTP role) is not asked.
    const c = appBrowser();
    await c.post("/sign-in/email", { email: a.email, password: PASSWORD });
    expect((await app.checkSession(c.headers())).gate).toBe("ok");
    const secret = await enrol(b);
    const after = await vendor.checkSession(b.headers());
    expect(after).toMatchObject({ gate: "ok" });
    // Enrolment replaced the session; the new one carries the second-factor time.
    expect(await surfaceOf(b)).toMatchObject({ surface: "vendor", second_factor_at: expect.any(Date) });
    // A fresh sign-in: no session until the code; then second_factor_at is set.
    const b2 = await vendorSignIn(a.email, secret);
    expect(await vendor.checkSession(b2.headers())).toMatchObject({ gate: "ok" });
    expect(await surfaceOf(b2)).toMatchObject({ surface: "vendor", second_factor_at: expect.any(Date) });
    // Vendor sessions last 8 hours, not refreshed (clinic sessions: 12 hours).
    const life = async (x: Browser) =>
      (await h.admin.query(`select extract(epoch from expires_at - created_at)::int s from auth_session where token = $1`, [decodeURIComponent(sessionCookie(x)[1]).split(".")[0]])).rows[0].s;
    expect(Math.abs((await life(b2)) - 8 * 3600)).toBeLessThan(5);
    expect(Math.abs((await life(c)) - 12 * 3600)).toBeLessThan(5);
  });

  it("a clinic session is rejected on the vendor host, whatever name its cookie is sent under", async () => {
    const a = await account();
    const c = appBrowser();
    await c.post("/sign-in/email", { email: a.email, password: PASSWORD });
    expect((await app.checkSession(c.headers())).gate).toBe("ok");
    const [, token] = sessionCookie(c);
    // As-is (the clinic cookie name): the vendor surface does not read it.
    const v = vendorBrowser();
    v.cookies = new Map(c.cookies);
    expect(await vendor.checkSession(v.headers())).toEqual({ gate: "anonymous" });
    // Renamed to the vendor cookie name (same signed token): refused because the session is a clinic one.
    v.cookies = new Map([["__Host-vendor.session_token", token]]);
    expect(await vendor.checkSession(v.headers())).toEqual({ gate: "anonymous" });
    expect((await v.get("/get-session")).status).toBe(401);
    expect((await v.post("/two-factor/enable", { password: PASSWORD })).status).toBe(401);
  });

  it("a vendor session is rejected on the clinic app, whatever name its cookie is sent under", async () => {
    const a = await account();
    const b = vendorBrowser();
    await b.post("/sign-in/email", { email: a.email, password: PASSWORD });
    const sec = await enrol(b);
    const v = await vendorSignIn(a.email, sec);
    expect((await vendor.checkSession(v.headers())).gate).toBe("ok");
    const [, token] = sessionCookie(v);
    const c = appBrowser();
    c.cookies = new Map(v.cookies);
    expect(await app.checkSession(c.headers())).toEqual({ gate: "anonymous" });
    for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token"]) {
      c.cookies = new Map([[name, token]]);
      expect(await app.checkSession(c.headers()), name).toEqual({ gate: "anonymous" });
      // No session is returned: refused (401) under the name this surface reads, ignored otherwise.
      const gs = await c.get("/get-session");
      expect(gs.status === 401 || (gs.status === 200 && gs.json === null), `${name}: ${gs.status}`).toBe(true);
      expect((await c.post("/update-user", { name: "Ganti" })).status, name).toBe(401);
    }
  });

  it("guards that keep the surface check sound: no cookie cache, no bearer plugin, no direct getSession outside the auth factory", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const a of [app, vendor]) {
      const o = (await a.auth.$context).options as { session?: { cookieCache?: { enabled?: boolean } }; plugins?: { id: string }[] };
      expect(o.session?.cookieCache?.enabled ?? false).toBe(false);
      expect((o.plugins ?? []).map((p: { id: string }) => p.id)).not.toContain("bearer");
    }
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    // Any use of the raw Better Auth API object outside the factory (property, destructuring
    // or bracket access) would bypass checkSession's surface handling.
    const direct = walk(join(import.meta.dirname, "../../src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("src/auth/server.ts"))
      .filter((f) => /\.api\b|\{\s*api\b|\[["']api["']\]|\.auth\.api|\bapi\s*\}\s*=/.test(readFileSync(f, "utf8")));
    expect(direct).toEqual([]);
  });

  it("signing out of one surface leaves the other signed in", async () => {
    const a = await account();
    const b = vendorBrowser();
    await b.post("/sign-in/email", { email: a.email, password: PASSWORD });
    const sec = await enrol(b);
    const v = await vendorSignIn(a.email, sec);
    const c = appBrowser();
    await c.post("/sign-in/email", { email: a.email, password: PASSWORD });
    await c.post("/two-factor/verify-totp", { code: totp(sec, Date.now() + 30_000) });
    expect((await app.checkSession(c.headers())).gate).toBe("ok");
    expect((await v.post("/sign-out", {})).status).toBe(200);
    expect(await vendor.checkSession(v.headers())).toEqual({ gate: "anonymous" });
    expect((await app.checkSession(c.headers())).gate).toBe("ok");
  });
});

describe("console functions under clinic_vendor: the caller is its session token", () => {
  let PO: string;
  let poEmail: string;
  let secret: string;
  let token: string;
  const tokenOf = (b: Browser) => decodeURIComponent(sessionCookie(b)[1]).split(".")[0];
  beforeAll(async () => {
    const a = await account();
    PO = a.id;
    poEmail = a.email;
    const op = await ownerPool.connect();
    try {
      await bootstrapVendor(op, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    } finally {
      op.release();
    }
    const b = vendorBrowser();
    await b.post("/sign-in/email", { email: poEmail, password: PASSWORD });
    secret = await enrol(b);
    token = tokenOf(b);
  });
  const me = (tok: string | null, ip = IP) => vendorDb.query(`select vendor_console_me($1, $2) as r`, [tok, ip]).then((r) => r.rows[0].r);
  const tenants = (tok: string | null, ip = IP) => vendorDb.query(`select vendor_console_tenants($1, $2) as r`, [tok, ip]).then((r) => r.rows[0].r);
  const last = async () => (await h.admin.query(`select action, outcome, reason_code, account_id from vendor_actions order by seq desc limit 1`)).rows[0];
  const denials = async (account: string) =>
    (await h.admin.query(`select count(*)::int n from vendor_actions where account_id = $1 and outcome = 'denied'`, [account])).rows[0].n;

  it("the signed-in vendor staff member and roles, resolved from the session", async () => {
    expect(await me(token)).toMatchObject({ ok: true, name: "Pemilik Platform", roles: ["platform_owner"] });
  });

  it("no session, a clinic session, an expired or locked session: no_session, nothing logged", async () => {
    const before = (await h.admin.query(`select count(*)::int n from vendor_actions`)).rows[0].n;
    expect(await me(null)).toMatchObject({ ok: false, reason: "no_session" });
    expect(await me("x".repeat(32))).toMatchObject({ ok: false, reason: "no_session" });
    const c = appBrowser();
    await c.post("/sign-in/email", { email: poEmail, password: PASSWORD });
    await c.post("/two-factor/verify-totp", { code: totp(secret) });
    expect(await me(tokenOf(c))).toMatchObject({ ok: false, reason: "no_session" });
    const v = await vendorSignIn(poEmail, secret);
    await h.admin.query(`update auth_session set expires_at = now() - interval '1 second' where token = $1`, [tokenOf(v)]);
    expect(await me(tokenOf(v))).toMatchObject({ ok: false, reason: "no_session" });
    const v2 = await vendorSignIn(poEmail, secret);
    await h.admin.query(`update auth_session set locked_at = now() where token = $1`, [tokenOf(v2)]);
    expect(await me(tokenOf(v2))).toMatchObject({ ok: false, reason: "no_session" });
    expect((await h.admin.query(`select count(*)::int n from vendor_actions`)).rows[0].n).toBe(before);
  });

  it("refusals for a valid session are logged once per account, IP and reason in 10 minutes", async () => {
    expect(await me(token, "198.51.100.7")).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    expect(await last()).toMatchObject({ action: "console_open", outcome: "denied", reason_code: "ip_not_allowed", account_id: PO });
    const n = await denials(PO);
    for (let i = 0; i < 3; i++) expect(await me(token, "198.51.100.7")).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    expect(await denials(PO)).toBe(n);
    // A non-vendor account signed in on the vendor surface: refused, logged once.
    const stranger = await account();
    await h.admin.query(`update auth_user set two_factor_enabled = true where id = $1`, [stranger.id]);
    await h.admin.query(
      `insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '1 hour', 'vendor', now())`,
      [stranger.id, "s".repeat(40)],
    );
    for (let i = 0; i < 3; i++) expect(await me("s".repeat(40))).toMatchObject({ ok: false, reason: "not_vendor_staff" });
    expect(await denials(stranger.id)).toBe(1);
  });

  it("the TOTP time comes from the session row: a session without a recent second factor is refused", async () => {
    await h.admin.query(`update auth_session set second_factor_at = null where token = $1`, [token]);
    expect(await me(token)).toMatchObject({ ok: false, reason: "totp_not_verified" });
    await h.admin.query(`update auth_session set second_factor_at = now() - interval '13 hours' where token = $1`, [token]);
    expect(await me(token)).toMatchObject({ ok: false, reason: "totp_not_verified" });
    await h.admin.query(`update auth_session set second_factor_at = now() where token = $1`, [token]);
    expect(await me(token)).toMatchObject({ ok: true });
  });

  it("the tenant list shows state, legal name and branch count only, to every vendor role", async () => {
    const t = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Sintetis', 'emkm')`, [t]);
    await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'A', 'Cabang A', 'Asia/Jakarta'), ($1, 'B', 'Cabang B', 'Asia/Jakarta')`, [t]);
    const aud = await account();
    const op = await ownerPool.connect();
    try {
      await createVendorStaff(op, { accountId: PO, ip: IP, mfaAt: new Date() }, aud.id, "Auditor Vendor", ["vendor_auditor"]);
    } finally {
      op.release();
    }
    const b = vendorBrowser();
    await b.post("/sign-in/email", { email: aud.email, password: PASSWORD });
    await enrol(b);
    for (const tok of [token, tokenOf(b)]) {
      const r = await tenants(tok);
      expect(r.ok).toBe(true);
      expect(r.rows.find((x: { id: string }) => x.id === t)).toEqual({ id: t, state: "live", name: "PT Klinik Sintetis", branches: 2 });
    }
    expect(await tenants(token, "198.51.100.7")).toMatchObject({ ok: false, reason: "ip_not_allowed" });
  });

  it("the console role reads no table and cannot name an actor in any vendor command", async () => {
    for (const t of ["tenants", "tenants_registry", "branches", "auth_user", "auth_session", "vendor_staff", "vendor_actions", "audit_events"]) {
      await expect(vendorDb.query(`select 1 from ${t} limit 1`), t).rejects.toMatchObject({ code: "42501" });
    }
    for (const q of [
      `select vendor_guard('${PO}', '${IP}', '{platform_owner}', 'x', null, null, now(), interval '1 hour')`,
      `select vendor_session('${token}')`,
      `select vendor_console_guard('${token}', '${IP}', 'x')`,
      `select vendor_request('${PO}', '${IP}', now(), 'exit', gen_random_uuid(), '{}', 'Mengaku sebagai orang lain')`,
      `select vendor_request_decide('${PO}', '${IP}', now(), gen_random_uuid(), true, null)`,
      `select vendor_staff_create('${PO}', '${IP}', now(), gen_random_uuid(), 'x', '{support}')`,
      `select vendor_staff_update('${PO}', '${IP}', now(), gen_random_uuid(), '{support}', 'active')`,
      `select vendor_ip_allowlist_set('${PO}', '${IP}', now(), '10.0.0.0/16', 'x', true)`,
      `select vendor_request_cancel('${PO}', '${IP}', now(), gen_random_uuid())`,
      `select vendor_identity()`,
    ]) {
      await expect(vendorDb.query(q), q).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("a vendor-surface auth instance cannot be built without the IP gate", () => {
    expect(() => createAuth({ pool: authPool, secret: SECRET, baseURL: VENDOR, surface: "vendor", roles: async () => [] })).toThrow(/allowAddress/);
  });

  it("refusals precomputed for dedupe match vendor_guard's, for every refusal state", async () => {
    const cases: [string, () => Promise<void>, () => Promise<void>][] = [
      ["totp_not_verified", () => h.admin.query(`update auth_session set second_factor_at = null where token = $1`, [token]).then(() => {}), () => h.admin.query(`update auth_session set second_factor_at = now() where token = $1`, [token]).then(() => {})],
      ["totp_required", () => h.admin.query(`update auth_user set two_factor_enabled = false where id = $1`, [PO]).then(() => {}), () => h.admin.query(`update auth_user set two_factor_enabled = true where id = $1`, [PO]).then(() => {})],
      ["vendor_staff_inactive", () => h.admin.query(`alter table vendor_staff disable trigger all; update vendor_staff set state = 'suspended' where account_id = '${PO}'`).then(() => {}), () => h.admin.query(`update vendor_staff set state = 'active' where account_id = '${PO}'; alter table vendor_staff enable trigger all`).then(() => {})],
    ];
    for (const [reason, br, fix] of cases) {
      await br();
      try {
        // Logged at most once in the window (an earlier test may already have logged it).
        expect(await me(token), reason).toMatchObject({ ok: false, reason });
        const n = await denials(PO);
        expect((await h.admin.query(`select count(*)::int n from vendor_actions where account_id = $1 and reason_code = $2 and at > now() - interval '10 minutes'`, [PO, reason])).rows[0].n, reason).toBe(1);
        for (let i = 0; i < 2; i++) expect(await me(token), reason).toMatchObject({ ok: false, reason });
        expect(await denials(PO), `${reason} deduplicated`).toBe(n);
      } finally {
        await fix();
      }
    }
    expect(await me(token)).toMatchObject({ ok: true });
  });

  it("a missing or malformed client address fails closed with the refusal, never an error", async () => {
    for (const ip of ["", "203.0.113.10, 1.2.3.4", "fe80::1%eth0", "localhost"]) {
      expect(await tenants(token, ip), ip).toMatchObject({ ok: false, reason: "ip_not_allowed" });
      expect((await vendorDb.query(`select vendor_console_ip_allowed($1) as ok`, [ip])).rows[0].ok, ip).toBe(false);
    }
  });

  it("sign-in and second factor on the vendor surface only from the allowlist", async () => {
    const guarded = createAuth({
      pool: authPool, secret: SECRET, rateLimit: false, sleep: async () => {}, baseURL: VENDOR, surface: "vendor", roles: async () => [],
      allowAddress: async (ip) => (await vendorDb.query(`select vendor_console_ip_allowed($1) as ok`, [ip])).rows[0].ok,
    });
    const outside = new Browser(guarded, VENDOR, VENDOR_AUTH_BASE_PATH, "198.51.100.7");
    const r = await outside.post("/sign-in/email", { email: poEmail, password: PASSWORD });
    expect(r).toMatchObject({ status: 403, json: { code: "ADDRESS_NOT_ALLOWED" } });
    expect(outside.cookies.size).toBe(0);
    expect((await outside.post("/two-factor/verify-totp", { code: "000000" })).status).toBe(403);
    // Default deny: every other endpoint from outside too (password reset, change, sign-up …),
    // and from an empty address; only reading or ending a session is exempt.
    for (const path of ["/request-password-reset", "/reset-password", "/change-password", "/sign-up/email", "/sign-in/social", "/update-user", "/two-factor/enable"]) {
      expect((await outside.post(path, {})).status, path).toBe(403);
    }
    // Endpoints that do not exist answer 404 before any hook.
    expect((await outside.post("/forget-password", {})).status).toBe(404);
    expect((await new Browser(guarded, VENDOR, VENDOR_AUTH_BASE_PATH, "").post("/sign-in/email", { email: poEmail, password: PASSWORD })).status).toBe(403);
    expect((await outside.get("/get-session")).status).toBe(200);
    const inside = new Browser(guarded, VENDOR, VENDOR_AUTH_BASE_PATH);
    expect((await inside.post("/sign-in/email", { email: poEmail, password: PASSWORD })).json.twoFactorRedirect).toBe(true);
    // The clinic app does not apply the vendor allowlist.
    const c = new Browser(app, APP, "/api/auth", "198.51.100.7");
    expect((await c.post("/sign-in/email", { email: poEmail, password: PASSWORD })).status).toBe(200);
  });
});

describe("tenant strings are escaped in vendor tables", () => {
  it("a hostile tenant name renders as text in the table and the cards", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { TenantList } = await import("../../src/app/vendor/tenant/tenant-list");
    const hostile = `PT <img src=x onerror="alert(1)"><script>alert(2)</script> & "Klinik"`;
    const html = renderToStaticMarkup(TenantList({ rows: [{ id: "x", state: "live", name: hostile, branches: 1 }] }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('onerror="');
    expect(html.split("PT &lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;Klinik&quot;").length - 1).toBe(2);
  });
});

describe("proxy on the vendor host (SEC-21)", () => {
  const cfg = { APP_HOST: "app.test", BOOKING_HOST: "booking.test", VENDOR_HOST: "vendor.test" };
  let proxy: (r: import("next/server").NextRequest) => Response;
  let NextRequest: typeof import("next/server").NextRequest;
  beforeAll(async () => {
    Object.assign(process.env, cfg);
    ({ proxy } = await import("../../src/proxy"));
    ({ NextRequest } = await import("next/server"));
  });
  const req = (host: string, path: string, headers: Record<string, string> = {}) =>
    new NextRequest(new URL(`http://${host}${path}`), { headers: { host, ...headers } });

  it("every vendor response carries a strict CSP with a fresh nonce, also forwarded to the render", async () => {
    const a = proxy(req("vendor.test", "/vendor/tenant"));
    const b = proxy(req("vendor.test", "/vendor/tenant"));
    const csp = a.headers.get("content-security-policy") ?? "";
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"]) expect(csp).toContain(d);
    const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]{24})'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(b.headers.get("content-security-policy")).not.toBe(csp);
    // Next.js reads the nonce from the request CSP header (x-middleware-request-*).
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    expect(a.headers.get("cache-control")).toBe("no-store");
    expect(a.headers.get("strict-transport-security")).toContain("max-age=");
    expect(a.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("the app and booking hosts are unchanged; vendor routes stay refused there", () => {
    const r = proxy(req("app.test", "/persetujuan"));
    expect(r.headers.get("content-security-policy")).toBeNull();
    expect(r.headers.get("x-host-policy")).toBeNull();
    expect(proxy(req("app.test", "/vendor/tenant")).headers.get("x-host-policy")).toBe("refused");
    expect(proxy(req("booking.test", "/vendor/api/auth/get-session")).headers.get("x-host-policy")).toBe("refused");
  });

  it("the clinic auth API and Server Actions are refused on the vendor host", () => {
    for (const p of ["/api/auth/sign-in/email", "/api/auth/get-session", "/masuk"]) {
      expect(proxy(req("vendor.test", p)).headers.get("x-host-policy"), p).toBe("refused");
    }
    expect(proxy(req("vendor.test", "/vendor/tenant", { "next-action": "abc" })).headers.get("x-host-policy")).toBe("refused");
  });

  it("no Server Action reaches the vendor host: form POSTs and every non-GET outside its auth API are refused", () => {
    const post = (path: string, contentType: string) =>
      proxy(new NextRequest(new URL(`http://vendor.test${path}`), { method: "POST", headers: { host: "vendor.test", "content-type": contentType }, body: "x" }));
    for (const ct of ["multipart/form-data; boundary=x", "application/x-www-form-urlencoded", "text/plain"]) {
      expect(post("/vendor/tenant", ct).headers.get("x-host-policy"), ct).toBe("refused");
      expect(post("/vendor/masuk", ct).headers.get("x-host-policy"), ct).toBe("refused");
    }
    for (const ct of ["multipart/form-data; boundary=x", "application/x-www-form-urlencoded"]) {
      expect(post("/vendor/api/auth/sign-in/email", ct).headers.get("x-host-policy"), ct).toBe("refused");
    }
    expect(post("/vendor/api/auth/sign-in/email", "application/json").headers.get("x-host-policy")).toBeNull();
    const put = proxy(new NextRequest(new URL("http://vendor.test/vendor/tenant"), { method: "PUT", headers: { host: "vendor.test" } }));
    expect(put.headers.get("x-host-policy")).toBe("refused");
  });
});
