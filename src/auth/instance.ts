// The process-wide auth instance for the Next.js server. Configuration (ARCH-9):
//   AUTH_DATABASE_URL  login that is a member of clinic_auth only
//   BETTER_AUTH_SECRET ≥ 32 characters
//   APP_URL            public origin of the staff host, e.g. https://app.example.id
//                      (must match APP_HOST, where the proxy serves the auth API)
// Roles come from memberships once T-007 exists; until then nobody holds a role, so no
// account is TOTP-gated by role yet (enforced by tests through an injected RoleSource).
import "server-only";
import { AUTH_GROUP_ROLE } from "../db/rls/context";
import { openAppPool } from "../db/rls/pool";
import type { RoleSource } from "./policy";
import { type Auth, createAuth } from "./server";

const noRolesYet: RoleSource = async () => []; // replaced by T-007

let instance: Promise<Auth> | undefined;

export function getAuth(): Promise<Auth> {
  instance ??= (async () => {
    const env = process.env;
    const url = env.AUTH_DATABASE_URL;
    const secret = env.BETTER_AUTH_SECRET;
    const appUrl = env.APP_URL;
    if (!url || !secret || !appUrl) {
      throw new Error("AUTH_DATABASE_URL, BETTER_AUTH_SECRET and APP_URL are required");
    }
    const origin = new URL(appUrl);
    if (origin.origin !== appUrl.replace(/\/$/, "")) throw new Error("APP_URL must be an origin only");
    // http only for a loopback host, and in production only with an explicit local opt-in
    // (browser checks against the standalone build).
    const loopback = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
    const insecureOk = loopback && (env.NODE_ENV !== "production" || env.ALLOW_INSECURE_APP_URL === "1");
    if (origin.protocol !== "https:" && !insecureOk) throw new Error("APP_URL must use https");
    if (env.APP_HOST && env.APP_HOST !== origin.host) throw new Error("APP_URL host must equal APP_HOST");
    const pool = await openAppPool({ connectionString: url, max: 5 }, AUTH_GROUP_ROLE);
    return createAuth({ pool, baseURL: origin.origin, secret, roles: noRolesYet });
  })().catch((error) => {
    instance = undefined;
    throw error;
  });
  return instance;
}
