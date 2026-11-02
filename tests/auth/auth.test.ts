// T-006 Done-when: scenario PR-3 second factor; TOTP required for owner, Admin Pusat,
// manager, doctor, finance, facility head, records officer, auditor and central CS;
// lockout after 5 failures in 15 minutes (RATE-2); front-desk idle lock at 120 s
// (IAM-7). Runs Better Auth over HTTP-shaped requests against a real PostgreSQL as the
// clinic_auth role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { passwordProblem, ROLES, type Role } from "../../src/auth/policy";

// Literal values from the spec, not the implementation's constants, so a change to the
// policy module cannot silently change what the test expects.
// PR-3 / IAM-1 / T-006 Done-when:
const SPEC_TOTP_ROLES: Role[] = [
  "owner", "admin_pusat", "manager", "doctor", "finance",
  "facility_head", "records_officer", "auditor", "central_cs",
];
// IAM-7 / CD-10:
const IDLE_LOCK_MS = 120_000;
import { LOGIN_LOCKED_CODE, PasswordPolicyError, SESSION_LOCKED_CODE } from "../../src/auth/server";
import { type AuthEnv, Client, createAuthEnv, PASSWORD, secretFromUri, totp } from "./helpers";

let env: AuthEnv;
let n = 0;

async function staff(roles: Role[]): Promise<{ id: string; email: string }> {
  const email = `staf${++n}@klinik-sintetis.test`;
  const user = await env.auth.createStaffAccount({ email, name: `Staf ${n}`, password: PASSWORD });
  env.roles.set(user.id, roles);
  return { id: user.id, email };
}

async function enrolTotp(c: Client): Promise<string> {
  const enable = await c.post("/two-factor/enable", { password: PASSWORD });
  expect(enable.status).toBe(200);
  const secret = secretFromUri(String(enable.json.totpURI));
  const verify = await c.post("/two-factor/verify-totp", { code: totp(secret) });
  expect(verify.status).toBe(200);
  return secret;
}

beforeAll(async () => {
  env = await createAuthEnv();
});

afterAll(async () => {
  await env?.close();
});

describe("password policy (IAM-1)", () => {
  it("requires 15 characters and refuses common or email-derived passwords", () => {
    expect(passwordProblem("pendek sekali")).toContain("minimal 15");
    expect(passwordProblem("passwordpassword")).toContain("terlalu umum");
    expect(passwordProblem("Password Password")).toContain("terlalu umum");
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).toContain("mudah ditebak");
    expect(passwordProblem("dewi.lestari-2026-ok", "dewi.lestari@x.test")).toContain("email");
    expect(passwordProblem(PASSWORD)).toBeUndefined();
  });

  it("is enforced when an account is created", async () => {
    await expect(
      env.auth.createStaffAccount({ email: "a@x.test", name: "A", password: "qwertyuiopasdfgh" }),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
  });

  it("public sign-up is disabled (accounts by invitation only)", async () => {
    const r = await new Client(env.auth).post("/sign-up/email", {
      email: "baru@x.test",
      name: "Baru",
      password: PASSWORD,
    });
    expect(r.status).toBe(400);
  });
});

describe("second factor (PR-3, IAM-1)", () => {
  it("scenario PR-3: a doctor without a second factor stays locked out of clinical pages", async () => {
    const doctor = await staff(["doctor"]);
    const c = new Client(env.auth);
    expect((await c.signIn(doctor.email)).status).toBe(200);
    // Signed in, but every tenant page/API gate answers "enrol TOTP".
    expect(await env.auth.checkSession(c.headers())).toMatchObject({ gate: "enrol_totp" });

    await enrolTotp(c);
    expect(await env.auth.checkSession(c.headers())).toMatchObject({ gate: "ok" });
  });

  it.each(SPEC_TOTP_ROLES)("role %s needs a verified TOTP", async (role) => {
    const u = await staff([role]);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("enrol_totp");
  });

  it.each(ROLES.filter((r) => !SPEC_TOTP_ROLES.includes(r)))("role %s does not need TOTP", async (role) => {
    const u = await staff([role]);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok");
  });

  it("the strictest role wins for a multi-role account", async () => {
    const u = await staff(["nurse", "finance"]);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("enrol_totp");
  });

  it("an unverified enrolment does not count", async () => {
    const u = await staff(["owner"]);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    expect((await c.post("/two-factor/enable", { password: PASSWORD })).status).toBe(200);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("enrol_totp");
  });

  it("never trusts a device: TOTP is asked again after trustDevice=true", async () => {
    const u = await staff(["finance"]);
    const first = new Client(env.auth);
    await first.signIn(u.email);
    const secret = await enrolTotp(first);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    const v = await c.post("/two-factor/verify-totp", { code: totp(secret), trustDevice: true });
    expect(v.status).toBe(200);
    expect([...c.cookies.keys()].some((k) => k.includes("trust_device"))).toBe(false);
    await c.post("/sign-out", {});
    const again = await c.signIn(u.email);
    expect(again.json.twoFactorRedirect).toBe(true);
  });

  it("a session that must enrol TOTP cannot use other account endpoints", async () => {
    const u = await staff(["doctor"]);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    const r = await c.post("/update-user", { name: "Ganti Nama" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe(SESSION_LOCKED_CODE);
    expect((await c.post("/two-factor/enable", { password: PASSWORD })).status).toBe(200);
  });

  it("after enrolment, sign-in issues no session until the TOTP code is given", async () => {
    const u = await staff(["manager"]);
    const first = new Client(env.auth);
    await first.signIn(u.email);
    const secret = await enrolTotp(first);

    const c = new Client(env.auth);
    const r = await c.signIn(u.email);
    expect(r.status).toBe(200);
    expect(r.json.twoFactorRedirect).toBe(true);
    expect(await env.auth.checkSession(c.headers())).toEqual({ gate: "anonymous" });

    expect((await c.post("/two-factor/verify-totp", { code: "000000" })).status).toBe(401);
    expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok");
  });

  it("without a session there is no access", async () => {
    expect(await env.auth.checkSession(new Headers())).toEqual({ gate: "anonymous" });
  });
});

describe("sign-in lockout (RATE-2)", () => {
  it("locks the account after 5 failures in 15 minutes, across IPs, then unlocks", async () => {
    const u = await staff(["nurse"]);
    for (let i = 0; i < 5; i++) {
      const r = await new Client(env.auth, `198.51.100.${i}`).signIn(u.email, "salah salah salah 1");
      expect(r.status).toBe(401);
    }
    // Sixth attempt from a new IP with the right password is still refused.
    const locked = await new Client(env.auth, "198.51.100.99").signIn(u.email);
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe(LOGIN_LOCKED_CODE);

    env.clock.now = new Date(env.clock.now.getTime() + 15 * 60_000 + 1_000);
    expect((await new Client(env.auth).signIn(u.email)).status).toBe(200);
  });

  it("gives the same answer for an unknown email, so lockout reveals nothing", async () => {
    const email = "tidak-ada@klinik-sintetis.test";
    for (let i = 0; i < 5; i++) await new Client(env.auth).signIn(email, "salah salah salah 1");
    const r = await new Client(env.auth).signIn(email);
    expect(r.status).toBe(429);
    expect(r.json.code).toBe(LOGIN_LOCKED_CODE);
  });

  it("a successful sign-in clears earlier failures", async () => {
    const u = await staff(["nurse"]);
    for (let i = 0; i < 4; i++) await new Client(env.auth).signIn(u.email, "salah salah salah 1");
    expect((await new Client(env.auth).signIn(u.email)).status).toBe(200);
    for (let i = 0; i < 4; i++) await new Client(env.auth).signIn(u.email, "salah salah salah 1");
    expect((await new Client(env.auth).signIn(u.email)).status).toBe(200);
  });

  it("concurrent wrong passwords cannot exceed 5 checks (atomic claim)", async () => {
    const u = await staff(["nurse"]);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        new Client(env.auth, `192.0.2.${i}`).signIn(u.email, "salah salah salah 1"),
      ),
    );
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(7);
  });

  it("applies a progressive delay per account (RATE-2): 0, 250, 500, 1000, 2000 ms", async () => {
    const u = await staff(["nurse"]);
    env.delays.length = 0;
    for (let i = 0; i < 5; i++) await new Client(env.auth).signIn(u.email, "salah salah salah 1");
    expect(env.delays).toEqual([0, 250, 500, 1000, 2000]);
  });

  it("other password-checking endpoints count toward the lockout", async () => {
    const u = await staff(["nurse"]);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    for (let i = 0; i < 5; i++) {
      const r = await c.post("/two-factor/enable", { password: "salah salah salah 1" });
      expect(r.status).toBe(400);
    }
    expect((await c.post("/two-factor/enable", { password: PASSWORD })).status).toBe(429);
    expect((await new Client(env.auth).signIn(u.email)).status).toBe(429);
  });

  it("failures older than 15 minutes do not count", async () => {
    const u = await staff(["nurse"]);
    for (let i = 0; i < 4; i++) await new Client(env.auth).signIn(u.email, "salah salah salah 1");
    env.clock.now = new Date(env.clock.now.getTime() + 16 * 60_000);
    await new Client(env.auth).signIn(u.email, "salah salah salah 1");
    expect((await new Client(env.auth).signIn(u.email)).status).toBe(200);
  });
});

describe("front-desk idle lock (IAM-7, CD-10)", () => {
  async function signedIn(roles: Role[]) {
    const u = await staff(roles);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    return { u, c };
  }
  const advance = (ms: number) => {
    env.clock.now = new Date(env.clock.now.getTime() + ms);
  };

  it("locks an FO/cashier session after 120 s without activity", async () => {
    const { c } = await signedIn(["fo_cashier"]);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok");
    advance(IDLE_LOCK_MS - 1_000);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok"); // activity resets
    advance(IDLE_LOCK_MS - 1_000);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok");
    advance(IDLE_LOCK_MS);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("locked");
  });

  it("is not locked one second before 120 s", async () => {
    const { c } = await signedIn(["fo_cashier"]);
    advance(IDLE_LOCK_MS - 1_000);
    expect((await env.auth.checkSession(c.headers(), { activity: false })).gate).toBe("ok");
    advance(1_000);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("locked");
  });

  it("stays locked (server-side) even after more activity, until the password is re-entered", async () => {
    const { c } = await signedIn(["fo_cashier"]);
    advance(IDLE_LOCK_MS);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("locked");
    expect((await env.auth.checkSession(c.headers())).gate).toBe("locked");
    expect(await env.auth.unlock(c.headers(), "salah salah salah 1")).toBe(false);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("locked");
    expect(await env.auth.unlock(c.headers(), PASSWORD)).toBe(true);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok");
  });

  it("wrong unlock passwords count toward the lockout and end the session at the limit", async () => {
    const { u, c } = await signedIn(["fo_cashier"]);
    advance(IDLE_LOCK_MS);
    await env.auth.checkSession(c.headers());
    for (let i = 0; i < 5; i++) expect(await env.auth.unlock(c.headers(), "salah salah salah 1")).toBe(false);
    expect(await env.auth.unlock(c.headers(), PASSWORD)).toBe(false);
    expect(await env.auth.checkSession(c.headers())).toEqual({ gate: "anonymous" });
    expect((await new Client(env.auth).signIn(u.email)).status).toBe(429);
  });

  it("a read that is not user activity does not keep the session alive", async () => {
    const { c } = await signedIn(["fo_cashier"]);
    advance(IDLE_LOCK_MS - 1_000);
    await env.auth.checkSession(c.headers(), { activity: false }); // e.g. background poll
    advance(2_000);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("locked");
  });

  it("a locked session cannot use account endpoints (password change, profile, sessions)", async () => {
    const { c } = await signedIn(["fo_cashier"]);
    advance(IDLE_LOCK_MS);
    for (const [path, body] of [
      ["/update-user", { name: "X" }],
      ["/change-password", { currentPassword: PASSWORD, newPassword: "ombak tenang pagi 2027" }],
      ["/revoke-other-sessions", {}],
      ["/two-factor/enable", { password: PASSWORD }],
    ] as const) {
      const r = await c.post(path, body);
      expect(r.status, path).toBe(403);
      expect(r.json.code, path).toBe(SESSION_LOCKED_CODE);
    }
    expect(await env.auth.unlock(c.headers(), PASSWORD)).toBe(true);
    expect((await c.post("/update-user", { name: "X" })).status).toBe(200);
  });

  it("roles without the rule are not idle-locked", async () => {
    const { c } = await signedIn(["nurse"]);
    advance(IDLE_LOCK_MS * 3);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok");
  });
});

describe("storage and secrets", () => {
  it("stores no plaintext password or TOTP secret, and ids are UUIDv7", async () => {
    const u = await staff(["owner"]);
    const c = new Client(env.auth);
    await c.signIn(u.email);
    const secret = await enrolTotp(c);
    const { rows } = await env.h.admin.query(
      `select u.id, a.password, t.secret, t.backup_codes from auth_user u
       join auth_account a on a.user_id = u.id join auth_two_factor t on t.user_id = u.id
       where u.email = $1`,
      [u.email],
    );
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(rows[0].password).not.toContain(PASSWORD);
    expect(rows[0].password.startsWith("$") || rows[0].password.includes(":")).toBe(true);
    expect(rows[0].secret).not.toContain(secret);
  });

  it("the clinic_app role cannot read any auth table", async () => {
    const login = await env.h.createLoginRole("", ["clinic_app"]);
    const c = await env.h.connectAs(login);
    for (const t of ["auth_user", "auth_session", "auth_account", "auth_two_factor"]) {
      await expect(c.query(`select 1 from ${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("the clinic_auth role cannot read tenant tables", async () => {
    const login = await env.h.createLoginRole("", ["clinic_auth"]);
    const c = await env.h.connectAs(login);
    for (const t of ["tenants", "branches", "tenants_registry", "scope_map"]) {
      await expect(c.query(`select 1 from ${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
    }
  });
});
