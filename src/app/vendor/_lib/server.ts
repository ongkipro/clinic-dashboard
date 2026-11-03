// Vendor console server side (SEC-21, PR-57, T-020 DEC-028). Configuration (ARCH-9):
//   VENDOR_URL            public origin of the vendor host, e.g. https://vendor.example.id
//                         (must match VENDOR_HOST)
//   AUTH_DATABASE_URL     login in clinic_auth (the shared account store)
//   VENDOR_DATABASE_URL   login in clinic_vendor only (EXECUTE on vendor_* functions)
//   BETTER_AUTH_SECRET    same secret as the clinic app (one account store)
//   TRUSTED_IP_HEADER     header the origin proxy sets to the client address (default
//                         x-real-ip); a client-sent header of that name is overwritten by
//                         the proxy, so it is never taken from the browser
//
// Every database call names the caller by its vendor-surface session token only; the
// database resolves the account and the time the session last passed TOTP from
// auth_session (vendor_session, 0034). Neither this process nor the request names an actor.
// The client IP comes from TRUSTED_IP_HEADER, which the origin proxy (Traefik) must set
// and overwrite; the vendor host must not be reachable except through that proxy.
import "server-only";
import { headers } from "next/headers";
import type pg from "pg";
import { AUTH_GROUP_ROLE, VENDOR_GROUP_ROLE } from "../../../db/rls/context";
import { openAppPool } from "../../../db/rls/pool";
import { type Auth, createAuth } from "../../../auth/server";

let auth: Promise<Auth> | undefined;
let pool: Promise<pg.Pool> | undefined;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the vendor console`);
  return v;
}

export function ipHeader(): string {
  const h = (process.env.TRUSTED_IP_HEADER ?? "x-real-ip").toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(h)) throw new Error("TRUSTED_IP_HEADER must be a header name");
  return h;
}

export function vendorOrigin(): string {
  const url = new URL(env("VENDOR_URL"));
  const e = process.env;
  const loopback = url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1";
  const insecureOk = loopback && (e.NODE_ENV !== "production" || e.ALLOW_INSECURE_APP_URL === "1");
  if (url.protocol !== "https:" && !insecureOk) throw new Error("VENDOR_URL must use https");
  if (url.origin !== env("VENDOR_URL").replace(/\/$/, "")) throw new Error("VENDOR_URL must be an origin only");
  if (e.VENDOR_HOST && e.VENDOR_HOST !== url.host) throw new Error("VENDOR_URL host must equal VENDOR_HOST");
  return url.origin;
}

export function vendorAuth(): Promise<Auth> {
  auth ??= (async () => {
    const authPool = await openAppPool({ connectionString: env("AUTH_DATABASE_URL"), max: 3 }, AUTH_GROUP_ROLE);
    return createAuth({
      pool: authPool,
      baseURL: vendorOrigin(),
      secret: env("BETTER_AUTH_SECRET"),
      surface: "vendor",
      // Vendor accounts hold no clinic roles here: TOTP is required for all (IAM-10).
      roles: async () => [],
      ipAddressHeaders: [ipHeader()],
      allowAddress: async (ip) =>
        (await (await vendorPool()).query<{ ok: boolean }>(`select public.vendor_console_ip_allowed($1) as ok`, [ip])).rows[0].ok,
    });
  })().catch((e) => {
    auth = undefined;
    throw e;
  });
  return auth;
}

export function vendorPool(): Promise<pg.Pool> {
  pool ??= openAppPool({ connectionString: env("VENDOR_DATABASE_URL"), max: 3 }, VENDOR_GROUP_ROLE).catch((e) => {
    pool = undefined;
    throw e;
  });
  return pool;
}

export type VendorRole = "platform_owner" | "onboarding" | "support" | "vendor_finance" | "vendor_auditor";
export type ConsoleUser = { staffId: string; name: string; roles: VendorRole[] };
export type Caller = { token: string; ip: string };

export type ConsoleGate =
  | { kind: "signed-out" }
  | { kind: "enrol-totp" }
  | { kind: "refused"; reason: string } // not vendor staff, inactive, IP, TOTP not verified
  | { kind: "ok"; caller: Caller; user: ConsoleUser };

// Every vendor page and action starts here: a vendor-surface session (a clinic session is
// never accepted, SEC-21), a verified TOTP, then vendor_guard in the database.
export async function consoleGate(): Promise<ConsoleGate> {
  const h = await headers();
  const s = await (await vendorAuth()).checkSession(h);
  if (s.gate === "anonymous") return { kind: "signed-out" };
  if (s.gate === "enrol_totp") return { kind: "enrol-totp" };
  if (s.gate !== "ok") return { kind: "signed-out" };
  const caller: Caller = { token: s.token, ip: h.get(ipHeader()) ?? "" };
  const r = await call<{ staff_id: string; name: string; roles: VendorRole[] }>("vendor_console_me", caller);
  if (!r.ok) return r.reason === "no_session" ? { kind: "signed-out" } : { kind: "refused", reason: r.reason ?? "forbidden" };
  return { kind: "ok", caller, user: { staffId: r.data.staff_id, name: r.data.name, roles: r.data.roles } };
}

type Result<T> = { ok: true; data: T } | { ok: false; code: string; reason?: string };

// One function call, committed on its own (a refusal's log row must survive).
export async function call<T>(fn: "vendor_console_me" | "vendor_console_tenants", c: Caller): Promise<Result<T>> {
  const db = await vendorPool();
  const r = (await db.query<{ r: { ok: boolean; code?: string; reason?: string } & T }>(
    `select public.${fn}($1, $2) as r`,
    [c.token, c.ip],
  )).rows[0].r;
  if (!r.ok) return { ok: false, code: r.code ?? "ERR_FORBIDDEN", reason: r.reason };
  return { ok: true, data: r };
}
