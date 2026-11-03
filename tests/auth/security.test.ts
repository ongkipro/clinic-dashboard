// T-023 / DEC-033: Saya › Profil & Keamanan for every invited staff member and owner.
// Change password (IAM-1 policy, RATE-2, other sessions ended), authenticator replace
// (password + current code), backup codes, active sessions. Over HTTP-shaped requests on
// a real PostgreSQL as clinic_auth.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceLabel, type Role } from "../../src/auth/policy";
import { PASSWORD_POLICY_CODE } from "../../src/auth/server";
import { type AuthEnv, Client, createAuthEnv, PASSWORD, secretFromUri, totp } from "./helpers";

let env: AuthEnv;
let n = 0;
const NEW_PASSWORD = "perahu layar menepi 2027";

async function staff(roles: Role[]): Promise<{ id: string; email: string }> {
  const email = `keamanan${++n}@klinik-sintetis.test`;
  const user = await env.auth.createStaffAccount({ email, name: `Staf ${n}`, password: PASSWORD });
  env.roles.set(user.id, roles);
  return { id: user.id, email };
}
async function enrol(c: Client, password = PASSWORD): Promise<string> {
  const enable = await c.post("/two-factor/enable", { password });
  expect(enable.status).toBe(200);
  const secret = secretFromUri(String(enable.json.totpURI));
  expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  return secret;
}
async function signedIn(email: string, secret?: string, password = PASSWORD): Promise<Client> {
  const c = new Client(env.auth);
  const r = await c.signIn(email, password);
  expect(r.status).toBe(200);
  if (secret) expect((await c.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  return c;
}

beforeAll(async () => {
  env = await createAuthEnv();
});
afterAll(async () => {
  await env?.close();
});

describe("change password", () => {
  it("needs the current password, follows IAM-1, and ends every other session", async () => {
    const u = await staff(["nurse"]);
    const a = await signedIn(u.email);
    const b = await signedIn(u.email);
    // Weak or email-derived new passwords are refused before the current one is checked.
    for (const weak of ["pendek", "password12345678", `${u.email}xx`]) {
      const r = await a.post("/change-password", { currentPassword: PASSWORD, newPassword: weak });
      expect(r.status, weak).toBe(400);
      expect(r.json.code).toBe(PASSWORD_POLICY_CODE);
    }
    expect((await a.post("/change-password", { currentPassword: "salah sekali kata sandinya", newPassword: NEW_PASSWORD })).status).toBe(400);
    // revokeOtherSessions: false from the client is overridden.
    const ok = await a.post("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: false });
    expect(ok.status).toBe(200);
    expect((await env.auth.checkSession(a.headers())).gate).toBe("ok");
    expect(await env.auth.checkSession(b.headers())).toEqual({ gate: "anonymous" });
    expect((await new Client(env.auth).signIn(u.email, PASSWORD)).status).toBe(401);
    expect((await new Client(env.auth).signIn(u.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("wrong current passwords count toward the RATE-2 lockout", async () => {
    const u = await staff(["nurse"]);
    const a = await signedIn(u.email);
    for (let i = 0; i < 5; i++) await a.post("/change-password", { currentPassword: `salah ${i} kata sandinya`, newPassword: NEW_PASSWORD });
    expect((await a.post("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(429);
  });
});

describe("authenticator", () => {
  it("a role without the TOTP rule can set one up, and turn it off only with password and a current code", async () => {
    const u = await staff(["nurse"]);
    const c = await signedIn(u.email);
    const secret = await enrol(c);
    expect((await c.post("/two-factor/disable", { password: PASSWORD })).status).toBe(401);
    expect((await c.post("/two-factor/disable", { password: PASSWORD, code: "000000" })).status).toBe(401);
    expect((await c.post("/two-factor/disable", { password: "salah sekali kata sandinya", code: totp(secret) })).status).toBe(400);
    expect((await c.post("/two-factor/disable", { password: PASSWORD, code: totp(secret) })).status).toBe(200);
    expect((await new Client(env.auth).signIn(u.email)).json.twoFactorRedirect).toBeUndefined();
  });

  it("a role that requires TOTP replacing its authenticator must enrol a new one before anything else", async () => {
    const u = await staff(["owner"]);
    const first = await signedIn(u.email);
    const old = await enrol(first);
    const c = await signedIn(u.email, old);
    expect((await c.post("/two-factor/disable", { password: PASSWORD, code: totp(old) })).status).toBe(200);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("enrol_totp");
    expect((await c.post("/update-user", { name: "Nama Baru" })).status).toBe(403);
    const fresh = await enrol(c);
    expect((await env.auth.checkSession(c.headers())).gate).toBe("ok");
    // The old authenticator no longer signs in.
    const d = new Client(env.auth);
    await d.signIn(u.email);
    expect((await d.post("/two-factor/verify-totp", { code: totp(old, Date.now() + 90_000) })).status).toBe(401);
    expect((await d.post("/two-factor/verify-totp", { code: totp(fresh) })).status).toBe(200);
  });

  it("an enrolled authenticator cannot be replaced through setup (only through turn-off with a current code)", async () => {
    const u = await staff(["nurse"]);
    const c = await signedIn(u.email);
    const secret = await enrol(c);
    const again = await c.post("/two-factor/enable", { password: PASSWORD });
    expect(again.status).toBe(400);
    expect(again.json.totpURI).toBeUndefined();
    // The old authenticator still signs in.
    const d = new Client(env.auth);
    await d.signIn(u.email);
    expect((await d.post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);
  });

  it("new backup codes need the password and replace the old ones; each works once", async () => {
    const u = await staff(["finance"]);
    const c = await signedIn(u.email);
    const enable = await c.post("/two-factor/enable", { password: PASSWORD });
    const oldCodes = enable.json.backupCodes as string[];
    expect((await c.post("/two-factor/verify-totp", { code: totp(secretFromUri(String(enable.json.totpURI))) })).status).toBe(200);
    expect((await c.post("/two-factor/generate-backup-codes", {})).status).toBe(400);
    expect((await c.post("/two-factor/generate-backup-codes", { password: "salah sekali kata sandinya" })).status).toBe(400);
    const r = await c.post("/two-factor/generate-backup-codes", { password: PASSWORD });
    expect(r.status).toBe(200);
    const fresh = r.json.backupCodes as string[];
    expect(fresh).toHaveLength(10);
    const viaBackup = async (code: string) => {
      const d = new Client(env.auth);
      await d.signIn(u.email);
      return (await d.post("/two-factor/verify-backup-code", { code })).status;
    };
    expect(await viaBackup(oldCodes[0])).toBe(401);
    expect(await viaBackup(fresh[0])).toBe(200);
    expect(await viaBackup(fresh[0])).toBe(401);
  });
});

describe("active sessions", () => {
  it("lists this account's sessions without tokens and ends another one, never the current or a foreign one", async () => {
    const u = await staff(["nurse"]);
    const other = await staff(["nurse"]);
    const a = await signedIn(u.email);
    const b = await signedIn(u.email);
    const x = await signedIn(other.email);
    const list = await env.auth.ownSessions(a.headers());
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/token/i);
    const current = list.find((s) => s.current)!.id;
    const otherSession = list.find((s) => !s.current)!.id;
    const foreign = (await env.auth.ownSessions(x.headers()))[0].id;
    expect(await env.auth.endOwnSession(a.headers(), current)).toBe(false);
    expect(await env.auth.endOwnSession(a.headers(), foreign)).toBe(false);
    expect((await env.auth.checkSession(x.headers())).gate).toBe("ok");
    expect(await env.auth.endOwnSession(a.headers(), otherSession)).toBe(true);
    expect(await env.auth.checkSession(b.headers())).toEqual({ gate: "anonymous" });
    expect((await env.auth.checkSession(a.headers())).gate).toBe("ok");
    expect(await env.auth.ownSessions(new Headers())).toEqual([]);
  });
});

describe("device label", () => {
  it("names browser and system from the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("Chrome di Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari di iPhone/iPad");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 Edg/140.0")).toBe("Edge di Android");
    expect(deviceLabel(null)).toBe("Perangkat tidak dikenal");
  });
});
