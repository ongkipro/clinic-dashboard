// Test helpers: a Better Auth instance on a throwaway database, a cookie-carrying HTTP
// client over auth.handler, and an RFC 6238 TOTP generator built on node:crypto (an
// implementation independent of the library under test).
import { createHmac, randomBytes } from "node:crypto";
import type pg from "pg";
import { AUTH_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { createAuth, type Auth } from "../../src/auth/server";
import type { Role } from "../../src/auth/policy";
import { createHarness, type Harness } from "../rls/harness";

export const BASE_URL = "http://app.test";
export const PASSWORD = "kuda-laut berenang 2026"; // synthetic, policy-compliant

export type AuthEnv = {
  h: Harness;
  pool: pg.Pool;
  auth: Auth;
  roles: Map<string, Role[]>;
  clock: { now: Date };
  delays: number[]; // progressive delays requested, in order (no real waiting)
  close(): Promise<void>;
};

export async function createAuthEnv(opts: { rateLimit?: boolean } = {}): Promise<AuthEnv> {
  const h = await createHarness();
  const login = await h.createLoginRole("", [AUTH_GROUP_ROLE]);
  const pool = await openAppPool({ connectionString: h.urlAs(login), max: 4 }, AUTH_GROUP_ROLE);
  const roles = new Map<string, Role[]>();
  const clock = { now: new Date() };
  const delays: number[] = [];
  const auth = createAuth({
    pool,
    baseURL: BASE_URL,
    secret: randomBytes(32).toString("base64"),
    roles: async (userId) => roles.get(userId) ?? [],
    now: () => clock.now,
    rateLimit: opts.rateLimit ?? false,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return {
    h,
    pool,
    auth,
    roles,
    clock,
    delays,
    async close() {
      await pool.end();
      await h.close();
    },
  };
}

// Minimal browser: keeps cookies between requests to the auth handler.
export class Client {
  cookies = new Map<string, string>();
  constructor(private readonly auth: Auth, private readonly ip = "203.0.113.10") {}

  headers(): Headers {
    const h = new Headers({ origin: BASE_URL, "x-real-ip": this.ip });
    if (this.cookies.size) h.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    return h;
  }

  async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers = this.headers();
    headers.set("content-type", "application/json");
    const res = await this.auth.auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }),
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  }

  signIn(email: string, password = PASSWORD) {
    return this.post("/sign-in/email", { email, password });
  }
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) over the raw secret bytes from the otpauth URI.
export function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export function secretFromUri(uri: string): string {
  const s = new URL(uri).searchParams.get("secret");
  if (!s) throw new Error("no secret in otpauth URI");
  return s;
}
