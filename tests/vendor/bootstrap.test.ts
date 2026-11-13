// HYG-003 / DEC-036: `pnpm vendor:bootstrap` creates the first platform owner once. Runs the
// real command as a child process against a throwaway database (piped password), then
// signs in with Better Auth on the vendor surface.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { type Auth, createAuth, VENDOR_AUTH_BASE_PATH } from "../../src/auth/server";
import { createHarness, type Harness } from "../rls/harness";

const ROOT = join(import.meta.dirname, "../..");
const PASSWORD = "lentera pagi menyala 2026"; // synthetic
let h: Harness;
let authPool: pg.Pool;
let vendor: Auth;

function run(args: string[], stdin: string, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "src/db/vendor-bootstrap.ts", ...args], {
    cwd: ROOT, input: stdin, encoding: "utf8" as const, env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DATABASE_URL: h.ownerUrl(), ...env }, timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const argv = (email: string, cidr = "203.0.113.0/24") => ["--email", email, "--nama", "Rani Pemilik Platform", "--cidr", cidr, "--label", "Kantor vendor"];
const count = async (sql: string) => (await h.admin.query<{ n: number }>(`select count(*)::int n from ${sql}`)).rows[0].n;

beforeAll(async () => {
  h = await createHarness();
  authPool = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 2 }, AUTH_GROUP_ROLE);
  vendor = createAuth({
    pool: authPool, baseURL: "https://vendor.test", surface: "vendor", secret: randomBytes(32).toString("base64"),
    roles: async () => [], rateLimit: false, sleep: async () => {}, allowAddress: async () => true,
  });
}, 300_000); // HYG-016: setup gets the suite's hook limit
afterAll(async () => {
  await authPool?.end();
  await h?.close();
});

// Each case spawns Node and hashes a password (scrypt): allow time under a busy full suite.
describe("vendor:bootstrap (DEC-036)", { timeout: 60_000 }, () => {
  it("refuses a weak password, a mismatched confirmation, a too-wide range or bad input, leaving nothing behind", async () => {
    const cases: [string[], string, RegExp][] = [
      [argv("rani@vendor-sintetis.test"), "pendek\npendek\n", /minimal 15 karakter/],
      [argv("rani@vendor-sintetis.test"), `${PASSWORD}\nlain sekali kata sandinya\n`, /tidak sama/],
      [argv("rani@vendor-sintetis.test", "10.0.0.0/8"), `${PASSWORD}\n${PASSWORD}\n`, /CIDR/],
      [argv("bukan-email"), `${PASSWORD}\n${PASSWORD}\n`, /Email tidak valid/],
      [["--email", "rani@vendor-sintetis.test"], "", /Pakai:/],
    ];
    for (const [args, stdin, msg] of cases) {
      const r = run(args, stdin);
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toMatch(msg);
      expect(r.out).not.toContain(PASSWORD);
    }
    expect(await count("auth_user")).toBe(0);
    expect(await count("vendor_staff")).toBe(0);
    // The range refusal reached the database and was logged; nothing else stayed.
    expect((await h.admin.query(`select action, outcome, reason_code from vendor_actions`)).rows).toEqual([
      { action: "vendor_bootstrap", outcome: "denied", reason_code: "invalid_input" },
    ]);
  });

  it("refuses an email that already has an account (no takeover of a clinic account)", async () => {
    await h.admin.query(`insert into auth_user (name, email) values ('Staf Klinik', 'staf@klinik-sintetis.test')`);
    const r = run(argv("Staf@Klinik-Sintetis.test"), `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/sudah punya akun/);
    expect(await count("vendor_staff")).toBe(0);
    expect(await count("auth_account")).toBe(0);
  });

  it("creates the first platform owner once; the password signs in on the vendor surface and TOTP enrolment is required", async () => {
    const r = run(argv("Rani@Vendor-Sintetis.test"), `${PASSWORD}\n${PASSWORD}\n`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).not.toMatch(/[0-9a-f]{32}:/); // no hash printed
    expect((await h.admin.query(`select u.email, u.email_verified, u.two_factor_enabled, s.display_name, s.state, array_agg(x.role) roles
                                  from vendor_staff s join auth_user u on u.id = s.account_id join vendor_staff_roles x on x.staff_id = s.id
                                 group by 1, 2, 3, 4, 5`)).rows)
      .toEqual([{ email: "rani@vendor-sintetis.test", email_verified: false, two_factor_enabled: false, display_name: "Rani Pemilik Platform", state: "active", roles: ["platform_owner"] }]);
    expect((await h.admin.query(`select cidr, label from vendor_ip_allowlist`)).rows).toEqual([{ cidr: "203.0.113.0/24", label: "Kantor vendor" }]);
    expect((await h.admin.query(`select outcome from vendor_actions where action = 'vendor_bootstrap' order by seq desc limit 1`)).rows[0].outcome).toBe("success");
    // The stored hash is Better Auth's: sign-in works on the vendor surface, then TOTP is required.
    const res = await vendor.auth.handler(new Request(`https://vendor.test${VENDOR_AUTH_BASE_PATH}/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://vendor.test", "x-real-ip": "203.0.113.10" },
      body: JSON.stringify({ email: "rani@vendor-sintetis.test", password: PASSWORD }),
    }));
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await vendor.checkSession(new Headers({ cookie, "x-real-ip": "203.0.113.10" }))).gate).toBe("enrol_totp");
    // A second run is refused, logged, and creates no account.
    const again = run(argv("lain@vendor-sintetis.test"), `${PASSWORD}\n${PASSWORD}\n`);
    expect(again.code).not.toBe(0);
    expect(again.out).toMatch(/Tim Vendor sudah ada/);
    expect(await count("auth_user where email = 'lain@vendor-sintetis.test'")).toBe(0);
    expect((await h.admin.query(`select reason_code from vendor_actions order by seq desc limit 1`)).rows[0].reason_code).toBe("already_bootstrapped");
  });

  it("without DATABASE_URL it refuses before touching anything", async () => {
    const r = run(argv("x@vendor-sintetis.test"), `${PASSWORD}\n${PASSWORD}\n`, { DATABASE_URL: "" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/Bootstrap gagal/);
  });
});
