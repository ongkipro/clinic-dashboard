// Better Auth for staff (IAM-1, PR-3, RATE-2, SEC-7). Built per process by createAuth;
// the Next.js route handler and the tests share this one configuration.
//
// - Email + password only; staff accounts are created by invitation (T-022), so public
//   sign-up is disabled and `createStaffAccount` is the only way an account appears.
// - TOTP via the two-factor plugin; whether a TOTP is *required* depends on the roles the
//   account holds (policy.ts), enforced by `checkSession` on every tenant request.
// - Database rate limiting (shared by every app container) plus a per-account failed
//   sign-in lockout (RATE-2) that is independent of IP.
// - No telemetry (H-08).
import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { TWO_FACTOR_ERROR_CODES, twoFactor } from "better-auth/plugins/two-factor";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { boundSession, type SessionBinding } from "../db/rls/context";
import * as schema from "./schema";
import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
  requiresTotp,
  type Role,
  type RoleSource,
  type SessionGate,
  sessionGate,
} from "./policy";

// SEC-21: the clinic app and the vendor console are two surfaces of one account store.
// Each surface signs its own sessions in (auth_session.surface) and accepts only those,
// whatever cookie name a token arrives under. The vendor console's cookies are
// host-only `__Host-vendor.*` (Secure, SameSite=Strict), its auth API lives under
// /vendor/api/auth on the vendor host, and every vendor account needs TOTP.
export type AuthSurface = "app" | "vendor";
export const VENDOR_AUTH_BASE_PATH = "/vendor/api/auth";
export const VENDOR_COOKIE_PREFIX = "__Host-vendor";

export type AuthConfig = {
  pool: pg.Pool; // clinic_auth login, opened with openAppPool(..., AUTH_GROUP_ROLE)
  baseURL: string; // https://<APP_HOST> (vendor surface: https://<VENDOR_HOST>)
  surface?: AuthSurface; // defaults to "app"
  secret: string; // BETTER_AUTH_SECRET (≥ 32 chars, from configuration)
  roles: RoleSource;
  now?: () => Date; // injectable clock for tests (DATA §6)
  rateLimit?: boolean; // defaults to on; tests that sign in repeatedly turn it off
  // Vendor surface: refuses sign-in and TOTP from an address outside the console allowlist
  // before any password or code is checked (owner decision 2026-11-03).
  allowAddress?: (ip: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>; // progressive delay; tests inject a recorder
  // Client IP header set by the trusted origin proxy (Traefik). Never read from a
  // header the client controls directly.
  ipAddressHeaders?: string[];
  // Test-only (tests/auth/security.test.ts): called inside the step-up counting transaction,
  // with that transaction's backend pid before the row is locked, and after it is read.
  twoFactorCountHooks?: { onBackend?: (pid: number) => Promise<void> | void; afterRead?: () => Promise<void> };
  // Test-only (tests/auth/step-up.test.ts): called inside stepUp after the session was read and before the code is
  // checked, after the code was accepted and before the gate, inside the gate's transaction just before the row lock,
  // and after the gate committed (controlled concurrent changes and waits).
  stepUpHooks?: { beforeVerify?: () => Promise<void>; afterVerify?: () => Promise<void>; beforeLock?: () => Promise<void>; afterGate?: () => Promise<void> };
};

export const LOGIN_LOCKED_CODE = "LOGIN_TEMPORARILY_LOCKED";
export const SESSION_LOCKED_CODE = "SESSION_LOCKED";
export const PASSWORD_POLICY_CODE = "PASSWORD_POLICY";
export const TOTP_URI_UNAVAILABLE_CODE = "TOTP_URI_UNAVAILABLE";
// Better Auth's own code for an account whose second factor is locked (DEC-010).
export const TWO_FACTOR_LOCKED_CODE = "ACCOUNT_TEMPORARILY_LOCKED";
const TWO_FACTOR_MAX_FAILURES = 5;
const TWO_FACTOR_LOCK_MS = 15 * 60_000;
export type OwnSecurity = { email: string; totpEnabled: boolean; totpRequired: boolean; sessions: OwnSession[] };
export type OwnSession = { id: string; createdAt: Date; ipAddress: string | null; userAgent: string | null; current: boolean };

// Endpoints that check a password for an account; each counts toward RATE-2.
const PASSWORD_PATHS = new Set([
  "/sign-in/email",
  "/change-password",
  "/verify-password",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
]);
// Session endpoints that stay usable while the session is locked or gated: reading it
// (the UI needs the gate) and ending it.
const LOCK_EXEMPT_PATHS = new Set(["/get-session", "/sign-out", "/ok", "/error"]);
// Endpoints a session needing TOTP enrolment may still call.
const ENROL_PATHS = new Set(["/two-factor/enable", "/two-factor/verify-totp"]);
// Code checks that the plugin counts per account only at sign-in; from an open session (a
// step-up, or completing enrolment) this file counts them (HYG-007, DEC-041 (1)).
const CODE_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);
// Endpoints that change the second factor: they need the password and a current code.
const POSSESSION_PATHS = new Set(["/two-factor/disable", "/two-factor/generate-backup-codes"]);
// A successful call proves the second factor for the session it creates or continues.
const SECOND_FACTOR_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

// RATE-2 progressive delay before checking a password: 0, 250, 500, 1000, 2000 ms for
// the 1st..5th attempt in the window (attempts already failed or still in flight).
export function progressiveDelayMs(priorAttempts: number): number {
  return priorAttempts <= 0 ? 0 : Math.min(250 * 2 ** (priorAttempts - 1), 4_000);
}

// ── HYG-026 step-up proof (PR-3, IAM-1; T-122 D1 = (a)) ─────────────────────────────────────────────────────────────
// The proof clinical signing (signRecord, signLetter, signPrescription) and the tenant export accept. Only a clinic-surface
// factory mints one (stepUp, freshStepUp below); the registry and the mint are module-private, never exported.
// - type: the brand is a declared, never-exported unique symbol, so no object literal satisfies StepUp;
// - run time: the proof is an opaque frozen object; what it attests (account, auth session, factor "totp", verifiedAt,
//   expiresAt, the issuing factory's clock and liveness check) is held in a private WeakMap, so it can be neither forged
//   by a cast or copy nor read and altered;
// - use: verifyStepUp checks it against the trusted current context (see there) and the deadline.
declare const brand: unique symbol;
export type StepUp = { readonly verified: true; readonly [brand]: true };
// Same window as vendor_guard's second-factor freshness (drizzle/0032_vendor_staff_rules.sql).
export const STEP_UP_MAX_AGE_MS = 10 * 60_000;
// Clock skew tolerated for a persisted second_factor_at ahead of this process (vendor_guard's 1 minute).
const STEP_UP_SKEW_MS = 60_000;
type ProofRecord =
  | { kind: "test" }
  | {
      kind: "session";
      accountId: string;
      sessionId: string;
      factor: "totp";
      verifiedAt: Date;
      expiresAt: Date;
      clock: () => Date;
      live: () => Promise<boolean>;
    };
const proofs = new WeakMap<object, ProofRecord>();
// Session bindings: minted only by checkSession from the authenticated session it resolved (requestContext passes the
// object on in the TenantContext); the session id lives here, not on the object, so a UUID or a copy never binds.
const bindings = new WeakMap<object, string>();
function bindSession(sessionId: string): SessionBinding {
  const b = Object.freeze({}) as SessionBinding;
  bindings.set(b, sessionId);
  return b;
}
function mint(record: ProofRecord): StepUp {
  const proof = Object.freeze({ verified: true }) as StepUp;
  proofs.set(proof, record);
  return proof;
}

// The consumer check, inside the caller's withTenantContext transaction (db). The consumer passes the proof alone. A
// proof is accepted only if all hold:
// - this module minted it, and the auth session the transaction is bound to is the session the proof was issued for:
//   the binding withTenantContext holds (boundSession()) must be one checkSession minted (requestContext() puts it in
//   the TenantContext), resolved here through the private registry; a session id string or a hand-built object binds
//   nothing;
// - the issuing factory's clock is within [verifiedAt, expiresAt] (expiresAt ≤ verifiedAt + STEP_UP_MAX_AGE_MS),
//   checked last, after the asynchronous reads below, so a proof presented just in time is not accepted late;
// - first the tenant's staff_access lock, taken in the caller's transaction and held to its end (the lock every signer's
//   tenant_actor_lock takes first, 0048, and that staff_session_revoke / staff_revoke take, 0026; none of those holders
//   touches auth_session rows, and the auth writers take no tenant lock, so tenant lock → auth read cannot deadlock);
//   then, after that wait, every decision read:
// - the proof's session is still live: on the clinic surface, unexpired, passing the gate (enrolled, not locked, not
//   idle-locked) and holding the same verified authenticator it was issued with (roles, then the auth read, then the
//   time; through the auth pool);
// - the transaction acts (app.staff_id) as a staff member of the proof's account, and that membership has not revoked
//   the session (PR-91, staff_session_revoked). A sign-out, idle cutoff or revocation therefore either happened before
//   these reads, or (a revocation) waits until the caller's protected effect has committed.
// A test proof (tests/support/step-up.ts) is accepted only under Vitest.
export async function verifyStepUp(db: pg.ClientBase, proof: unknown): Promise<boolean> {
  const record = typeof proof === "object" && proof !== null ? proofs.get(proof) : undefined;
  if (!record) return false;
  if (record.kind === "test") return process.env.NODE_ENV === "test";
  const bound = boundSession();
  if (!bound || bindings.get(bound) !== record.sessionId) return false;
  const inTime = () => {
    const t = record.clock().getTime();
    return t >= record.verifiedAt.getTime() && t <= record.expiresAt.getTime();
  };
  // The tenant's staff_access lock first (held to the end of the caller's transaction), then every decision read.
  await db.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || public.app_tenant_id()::text, 0))`);
  if (!(await record.live())) return false;
  const { rows } = await db.query<{ account_id: string; revoked: boolean }>(
    `select m.account_id, public.staff_session_revoked(m.id, $1::uuid) as revoked
       from public.staff s join public.memberships m on m.tenant_id = s.tenant_id and m.id = s.membership_id
      where s.id = public.app_staff_id() and s.tenant_id = public.app_tenant_id()`,
    [record.sessionId],
  );
  if (rows.length !== 1 || rows[0].account_id !== record.accountId || rows[0].revoked) return false;
  return inTime();
}

// Test seam for tests/support/step-up.ts only (a source guard refuses any other caller in src/): a proof without an
// account or session, which verifyStepUp accepts under Vitest only. Refused outside Vitest (NODE_ENV is "production"
// in the built app and "development" under `next dev`).
export function stepUpTestSeam(): StepUp {
  if (process.env.NODE_ENV !== "test") throw new Error("the step-up test seam is available in tests only");
  return mint({ kind: "test" });
}

// The authenticator a proof is bound to: its row id and a digest of its stored (encrypted) secret, so a replacement
// (disable, then enrol again) or a re-keyed row no longer matches.
const factorKey = (id: string, secret: string) => `${id}:${createHash("sha256").update(secret).digest("hex")}`;
// The two-factor challenge cookie; stepUp never forwards it, so the plugin cannot complete a pending sign-in instead.
const CHALLENGE_COOKIE = /(^|\.)two_factor$/;

export function createAuth(config: AuthConfig) {
  if (config.secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  const now = config.now ?? (() => new Date());
  const surface: AuthSurface = config.surface ?? "app";
  const vendor = surface === "vendor";
  if (vendor && !config.allowAddress) throw new Error("the vendor surface needs allowAddress (console IP allowlist)");
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const db = drizzle(config.pool, { schema });

  // RATE-2, atomic per account: under an advisory lock on the email, count attempts in
  // the window and, if below the limit, insert one for this request. The row counts as
  // a failure until the password is proven right (settleAttempt), so concurrent requests
  // cannot all pass the check. Returns the attempt id, or undefined when locked.
  const claimAttempt = async (email: string): Promise<{ id: string; prior: number } | undefined> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"auth-login:" + email}))`);
      const since = new Date(now().getTime() - LOGIN_FAILURE_WINDOW_MS);
      const [row] = await tx
        .select({ n: count() })
        .from(schema.authLoginFailure)
        .where(and(eq(schema.authLoginFailure.email, email), gte(schema.authLoginFailure.failedAt, since)));
      if (row.n >= LOGIN_FAILURE_LIMIT) return undefined;
      const [ins] = await tx
        .insert(schema.authLoginFailure)
        .values({ email, failedAt: now() })
        .returning({ id: schema.authLoginFailure.id });
      return { id: ins.id, prior: row.n };
    });

  // Password proven: clear the account's failures (including this attempt).
  const passwordAccepted = async (email: string) => {
    await db.delete(schema.authLoginFailure).where(eq(schema.authLoginFailure.email, email));
  };
  const pruneOld = async () => {
    await db
      .delete(schema.authLoginFailure)
      .where(lt(schema.authLoginFailure.failedAt, new Date(now().getTime() - 24 * 60 * 60_000)));
  };
  const lockedOut = () =>
    APIError.from("TOO_MANY_REQUESTS", {
      code: LOGIN_LOCKED_CODE,
      message: "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.",
    });

  // Second-factor codes from an open session (HYG-007). The plugin counts code failures per
  // account only at sign-in; here a step-up or an enrolment completion counts the same way
  // (DEC-010: 5 failures lock 15 minutes) on the plugin's own row and clock (Date.now()),
  // so sign-in and step-up share one budget. The user's row lock serializes concurrent
  // counts; the count is a pending attempt until the after hook clears it on success.
  // The plugin's own error (code and message), so sign-in and step-up answer the same way.
  const twoFactorLocked = () => APIError.from("TOO_MANY_REQUESTS", TWO_FACTOR_ERROR_CODES.ACCOUNT_TEMPORARILY_LOCKED);
  const countSecondFactorAttempt = async (userId: string): Promise<void> =>
    db.transaction(async (tx) => {
      const hooks = config.twoFactorCountHooks;
      if (hooks?.onBackend) {
        const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
        await hooks.onBackend(Number((pid.rows[0] as { pid: number }).pid));
      }
      const [row] = await tx
        .select({ id: schema.authTwoFactor.id, failed: schema.authTwoFactor.failedVerificationCount, lockedUntil: schema.authTwoFactor.lockedUntil })
        .from(schema.authTwoFactor)
        .where(eq(schema.authTwoFactor.userId, userId))
        .for("update");
      if (!row) return; // no second factor: the plugin answers TOTP_NOT_ENABLED itself
      if (hooks?.afterRead) await hooks.afterRead();
      const at = Date.now();
      let failed = row.failed;
      if (row.lockedUntil && row.lockedUntil.getTime() > at) throw twoFactorLocked();
      if (row.lockedUntil) failed = 0; // an expired lock starts a fresh budget (as the plugin does)
      // The attempt counts before the code is checked (it is a pending attempt, as RATE-2):
      // a correct 5th code sets locked_until until the after hook clears it moments later, so
      // a concurrent sign-in in that gap is refused once. Accepted: it never lets a guess through.
      failed += 1;
      await tx
        .update(schema.authTwoFactor)
        .set({ failedVerificationCount: failed, lockedUntil: failed >= TWO_FACTOR_MAX_FAILURES ? new Date(at + TWO_FACTOR_LOCK_MS) : null })
        .where(eq(schema.authTwoFactor.id, row.id));
    });
  const clearSecondFactorAttempts = async (userId: string) => {
    await db
      .update(schema.authTwoFactor)
      .set({ failedVerificationCount: 0, lockedUntil: null })
      .where(eq(schema.authTwoFactor.userId, userId));
  };
  // Which user a counted code check is about, decided once in the before hook and read in
  // the after hook: a successful enrolment replaces the session, so it is never re-derived.
  // Keyed on the request's headers object, which both hooks of one request share.
  const countedFor = new WeakMap<Headers, string>();
  // HYG-026: TOTP provenance for freshStepUp, written only by stepUp after its exact-row gate, from the values that gate
  // checked (the session and the authenticator the stamp required). A sign-in or enrolment TOTP is not recorded: the
  // shared after hook cannot attest which authenticator the plugin checked, so freshStepUp asks for a code there.
  // Backup codes never qualify. A session verified in another app process has no entry (fails closed). Entries older
  // than the proof window are pruned on each write.
  // lazy: per-process; a `step_up_totp_at` column on auth_session would share it across containers (needs a migration).
  const totpAt = new Map<string, { at: Date; factor: string }>();
  const rememberTotp = (sessionId: string, at: Date, factor: string) => {
    for (const [k, v] of totpAt) if (at.getTime() - v.at.getTime() > STEP_UP_MAX_AGE_MS) totpAt.delete(k);
    totpAt.set(sessionId, { at, factor });
  };

  // Which account a password endpoint is about: the body email on sign-in, the session
  // user elsewhere.
  const sessionRow = async (headers: Headers | undefined) => {
    if (!headers) return undefined;
    const s = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!s) return undefined;
    const row = await db.query.authSession.findFirst({ where: eq(schema.authSession.id, s.session.id) });
    return row && row.surface === surface ? { s, row } : undefined;
  };
  const foreignSession = () =>
    APIError.from("UNAUTHORIZED", { code: "SESSION_WRONG_SURFACE", message: "Sesi tidak berlaku di sini. Masuk kembali." });

  const auth = betterAuth({
    appName: "Clinic Dashboard",
    baseURL: config.baseURL,
    secret: config.secret,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.authUser,
        session: schema.authSession,
        account: schema.authAccount,
        verification: schema.authVerification,
        twoFactor: schema.authTwoFactor,
        rateLimit: schema.authRateLimit,
      },
    }),
    ...(vendor ? { basePath: VENDOR_AUTH_BASE_PATH } : {}),
    advanced: {
      database: { generateId: false }, // UUIDv7 from the database (DATA-7)
      ipAddress: { ipAddressHeaders: config.ipAddressHeaders ?? ["x-real-ip"] },
      ...(vendor
        ? {
            // Names are `__Host-vendor.<cookie>` (no __Secure- prefix in front of it);
            // the browser then enforces Secure, Path=/ and no Domain.
            useSecureCookies: false,
            cookiePrefix: VENDOR_COOKIE_PREFIX,
            defaultCookieAttributes: { secure: true, sameSite: "strict" as const, path: "/", httpOnly: true },
          }
        : { useSecureCookies: config.baseURL.startsWith("https://") }),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      revokeSessionsOnPasswordReset: true,
    },
    databaseHooks: {
      // Activity starts at sign-in, on the same clock the idle lock reads.
      session: {
        create: {
          before: async (session) => ({ data: { ...session, lastActiveAt: now(), lockedAt: null, surface, secondFactorAt: null } }),
        },
      },
    },
    session: {
      // No cookie cache and no bearer plugin: the surface check (before hook) reads the
      // signed session-token cookie and the database row; a cached session_data cookie or
      // a bearer token would bypass it. tests/vendor/host.test.ts asserts both stay off.
      // Absolute, no refresh: one working day for staff; 8 hours for the vendor console
      // (the TOTP window in vendor_guard is 12 h, so a vendor session always ends first).
      expiresIn: (vendor ? 8 : 12) * 60 * 60,
      disableSessionRefresh: true,
      freshAge: 10 * 60, // sensitive actions (2FA changes) need a recent sign-in
      additionalFields: {
        lastActiveAt: { type: "date", required: false, input: false },
        lockedAt: { type: "date", required: false, input: false },
        surface: { type: "string", required: false, input: false },
        secondFactorAt: { type: "date", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: config.rateLimit ?? true,
      storage: "database",
      window: 60,
      max: 100,
    },
    plugins: [
      twoFactor({
        issuer: "Clinic Dashboard",
        // No email/SMS OTP: the second factor is an authenticator app (IAM-1).
        accountLockout: { enabled: true, maxFailedAttempts: TWO_FACTOR_MAX_FAILURES, durationSeconds: TWO_FACTOR_LOCK_MS / 1000 },
        // Backup codes are stored encrypted (the library default, pinned; tests assert no
        // issued code is stored in plain text).
        backupCodeOptions: { storeBackupCodes: "encrypted" },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // SEC-21: a session token signed in on the other surface is refused on every
        // endpoint (read straight from the cookie, so get-session is covered too).
        const token = ctx.headers ? await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret) : null;
        if (token) {
          const row = await db.query.authSession.findFirst({ where: eq(schema.authSession.token, token) });
          if (row && row.surface !== surface) throw foreignSession();
        }

        // Vendor console: every auth endpoint except reading or ending the session only
        // from the allowlist (default deny; DEC-030).
        if (vendor && config.allowAddress && !LOCK_EXEMPT_PATHS.has(ctx.path)) {
          const ip = ctx.headers?.get((config.ipAddressHeaders ?? ["x-real-ip"])[0]) ?? "";
          if (!(await config.allowAddress(ip))) {
            throw APIError.from("FORBIDDEN", { code: "ADDRESS_NOT_ALLOWED", message: "Alamat jaringan ini tidak diizinkan." });
          }
        }

        // HYG-007 (DEC-041 (1)): the authenticator secret is shown once, at enrolment
        // (/two-factor/enable returns the URI). Reading it again would give anyone with a
        // session and the password a working copy of the device.
        if (ctx.path === "/two-factor/get-totp-uri") {
          throw APIError.from("FORBIDDEN", { code: TOTP_URI_UNAVAILABLE_CODE, message: "Authenticator setup is shown only once." });
        }

        // IAM-1: a trusted-device cookie would skip TOTP on later sign-ins; never issue one.
        if (ctx.path.startsWith("/two-factor/verify-")) {
          if (ctx.body && typeof ctx.body === "object") delete (ctx.body as { trustDevice?: unknown }).trustDevice;
        }

        // IAM-7 / PR-3: a locked or not-yet-enrolled session cannot use account endpoints.
        if (!LOCK_EXEMPT_PATHS.has(ctx.path) && ctx.path !== "/sign-in/email") {
          const current = await sessionRow(ctx.headers);
          if (current) {
            const gate = sessionGate({
              roles: await config.roles(current.s.user.id),
              twoFactorEnabled: Boolean((current.s.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
              lastActiveAt: current.row.lastActiveAt,
              lockedAt: current.row.lockedAt,
              now: now(),
              totpAlways: vendor,
            });
            if (gate === "locked" || (gate === "enrol_totp" && !ENROL_PATHS.has(ctx.path))) {
              throw APIError.from("FORBIDDEN", {
                code: SESSION_LOCKED_CODE,
                message: "Sesi terkunci. Masukkan kata sandi untuk melanjutkan.",
              });
            }
          }
        }

        // HYG-007: a code checked from an open session of this surface is counted per account.
        // A sign-in (no valid session; the plugin's isSignIn) is counted by the plugin.
        if (CODE_PATHS.has(ctx.path) && ctx.headers) {
          const current = await sessionRow(ctx.headers);
          if (current) {
            await countSecondFactorAttempt(current.s.user.id);
            countedFor.set(ctx.headers, current.s.user.id);
          }
        }

        // Profil & Keamanan (DEC-033): a new password follows the IAM-1 policy (checked
        // before the current password, so a weak choice does not count toward RATE-2), and
        // changing it always ends every other session.
        if (ctx.path === "/change-password") {
          const body = (ctx.body ?? {}) as { newPassword?: unknown; revokeOtherSessions?: unknown };
          const problem = passwordProblem(String(body.newPassword ?? ""), (await sessionRow(ctx.headers))?.s.user.email);
          if (problem) throw APIError.from("BAD_REQUEST", { code: PASSWORD_POLICY_CODE, message: problem });
          body.revokeOtherSessions = true;
        }

        // RATE-2: claim an attempt before any password is checked.
        if (PASSWORD_PATHS.has(ctx.path)) {
          const email =
            ctx.path === "/sign-in/email"
              ? String(ctx.body?.email ?? "").trim().toLowerCase()
              : (await sessionRow(ctx.headers))?.s.user.email.toLowerCase();
          if (!email) return;
          const attempt = await claimAttempt(email);
          if (!attempt) throw lockedOut();
          await sleep(progressiveDelayMs(attempt.prior));
        }

        // Turning the authenticator off (to replace it, or for a role that does not require
        // it) and making new backup codes (DEC-041 (1)) need the password and a current code:
        // possession of the device, not only of the session. A wrong code keeps the RATE-2
        // claim above and counts once as a second-factor failure (the nested verify-totp).
        // Roles that require TOTP are sent straight back to enrolment by the session gate (PR-3).
        if (POSSESSION_PATHS.has(ctx.path)) {
          const code = String((ctx.body as { code?: unknown } | undefined)?.code ?? "").replace(/\s/g, "");
          if (!/^[0-9]{6}$/.test(code)) throw APIError.from("UNAUTHORIZED", { code: "INVALID_CODE", message: "Invalid code" });
          await auth.api.verifyTOTP({ headers: ctx.headers ?? new Headers(), body: { code } });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned as { statusCode?: number; body?: { code?: string } } | undefined;
        const failed = Boolean(returned && typeof returned.statusCode === "number" && returned.statusCode >= 400);
        // The second factor was proven for the session this call created (sign-in,
        // enrolment) or continued (step-up).
        if (SECOND_FACTOR_PATHS.has(ctx.path) && !failed && !(returned instanceof Error)) {
          const id = ctx.context.newSession?.session.id ?? (await sessionRow(ctx.headers))?.row.id;
          if (id) await db.update(schema.authSession).set({ secondFactorAt: now() }).where(eq(schema.authSession.id, id));
        }
        // HYG-007: a counted code check that succeeded clears that account's budget.
        const counted = ctx.headers ? countedFor.get(ctx.headers) : undefined;
        if (counted && CODE_PATHS.has(ctx.path) && !failed && !(returned instanceof Error)) {
          await clearSecondFactorAttempts(counted);
        }
        if (!PASSWORD_PATHS.has(ctx.path)) return;
        const email =
          ctx.path === "/sign-in/email"
            ? String(ctx.body?.email ?? "").trim().toLowerCase()
            : ctx.context.session?.user.email.toLowerCase();
        if (!email) return;
        // A failure keeps its claimed attempt row; success clears the account's rows.
        // Only a wrong password counts: other 4xx (validation) still keep the claim, so
        // they cannot be used to probe without cost.
        if (!failed) await passwordAccepted(email);
        await pruneOld();
      }),
    },
  });

  // Invitation flow (T-031) is the only caller. Enforces the IAM-1 password policy,
  // which Better Auth's length checks do not cover. Throws AccountExistsError when the
  // email has an account already (that person signs in and accepts from it instead).
  // emailVerified stays false: holding the invite link does not prove the mailbox.
  async function createStaffAccount(input: { email: string; name: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const problem = passwordProblem(input.password, email);
    if (problem) throw new PasswordPolicyError(problem);
    const ctx = await auth.$context;
    if (await ctx.internalAdapter.findUserByEmail(email)) throw new AccountExistsError();
    const hash = await ctx.password.hash(input.password);
    let user;
    try {
      user = await ctx.internalAdapter.createUser({ email, name: input.name, emailVerified: false }, { method: "admin" });
    } catch (e) {
      // A concurrent create for the same email (auth_user_email_key) is the same case.
      if ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") throw new AccountExistsError();
      throw e;
    }
    try {
      await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
    } catch (e) {
      // Never leave a user without a credential: it would block this email for good.
      await discardNewAccount(user.id).catch((cleanup) =>
        console.error("auth: could not remove a user whose credential failed to link", { userId: user.id, cleanup }),
      );
      throw e;
    }
    return user;
  }

  // Gate for every tenant page and API. Also records activity and applies the idle
  // lock server-side, so a locked front-desk session cannot be used from another tab.
  async function checkSession(headers: Headers, opts: { activity?: boolean } = {}): Promise<
    | { gate: "anonymous" }
    | { gate: SessionGate; userId: string; sessionId: string; token: string; binding: SessionBinding }
  > {
    // A session of the other surface is refused by the before hook (SEC-21): anonymous here.
    const s = await auth.api.getSession({ headers, query: { disableCookieCache: true } }).catch((e: unknown) => {
      if (e instanceof APIError && (e.body as { code?: string } | undefined)?.code === "SESSION_WRONG_SURFACE") return null;
      throw e;
    });
    if (!s) return { gate: "anonymous" };
    const row = await db.query.authSession.findFirst({ where: eq(schema.authSession.id, s.session.id) });
    if (!row) return { gate: "anonymous" };
    const roles = await config.roles(s.user.id);
    const t = now();
    const gate = sessionGate({
      roles,
      twoFactorEnabled: Boolean((s.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
      lastActiveAt: row.lastActiveAt,
      lockedAt: row.lockedAt,
      now: t,
      totpAlways: vendor,
    });
    if (gate === "locked" && !row.lockedAt) {
      await db.update(schema.authSession).set({ lockedAt: t }).where(eq(schema.authSession.id, row.id));
    }
    if (gate === "ok" && opts.activity !== false) {
      await db.update(schema.authSession).set({ lastActiveAt: t }).where(eq(schema.authSession.id, row.id));
    }
    return { gate, userId: s.user.id, sessionId: s.session.id, token: row.token, binding: bindSession(s.session.id) };
  }

  // IAM-7: unlock by password re-check. Counts toward RATE-2 like a sign-in, with the
  // same atomic claim and delay; at the limit the session is ended.
  async function unlock(headers: Headers, password: string): Promise<boolean> {
    const s = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!s) return false;
    const email = s.user.email.toLowerCase();
    const attempt = await claimAttempt(email);
    if (!attempt) {
      // Server-side revoke (the HTTP endpoint is closed to a locked session).
      await (await auth.$context).internalAdapter.deleteSession(s.session.token);
      return false;
    }
    await sleep(progressiveDelayMs(attempt.prior));
    const ctx = await auth.$context;
    const account = (await ctx.internalAdapter.findAccounts(s.user.id)).find(
      (a) => a.providerId === "credential",
    );
    const ok = Boolean(account?.password) && (await ctx.password.verify({ hash: account!.password!, password }));
    if (!ok) return false;
    await passwordAccepted(email);
    await db
      .update(schema.authSession)
      .set({ lockedAt: null, lastActiveAt: now() })
      .where(eq(schema.authSession.id, s.session.id));
    return true;
  }

  // PR-91 / IAM-16: ends one session server-side (a membership revocation covered every
  // membership the session could act in).
  async function endSession(sessionId: string): Promise<void> {
    const row = await db.query.authSession.findFirst({ where: eq(schema.authSession.id, sessionId) });
    if (row) await (await auth.$context).internalAdapter.deleteSession(row.token);
  }

  // Profil & Keamanan › Sesi aktif: this account's sessions on this surface (never their
  // tokens), newest first; and ending one of them other than the current one.
  async function ownSecurity(headers: Headers): Promise<OwnSecurity | null> {
    const current = await sessionRow(headers);
    if (!current) return null;
    return {
      email: current.s.user.email,
      totpEnabled: Boolean((current.s.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
      totpRequired: vendor || requiresTotp(await config.roles(current.s.user.id)),
      sessions: await ownSessions(headers),
    };
  }
  async function ownSessions(headers: Headers): Promise<OwnSession[]> {
    const current = await sessionRow(headers);
    if (!current) return [];
    const rows = await db.query.authSession.findMany({
      where: and(eq(schema.authSession.userId, current.s.user.id), eq(schema.authSession.surface, surface), gte(schema.authSession.expiresAt, now())),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, ipAddress: r.ipAddress, userAgent: r.userAgent, current: r.id === current.row.id }));
  }
  async function endOwnSession(headers: Headers, sessionId: string): Promise<boolean> {
    const current = await sessionRow(headers);
    if (!current || current.row.id === sessionId) return false;
    const row = await db.query.authSession.findFirst({
      where: and(eq(schema.authSession.id, sessionId), eq(schema.authSession.userId, current.s.user.id), eq(schema.authSession.surface, surface)),
    });
    if (!row) return false;
    await (await auth.$context).internalAdapter.deleteSession(row.token);
    return true;
  }

  // HYG-026 (PR-3; T-122 D1): issuing the step-up proof, clinic surface only.
  // Every decision about a session is made on state read after the last wait: the roles are resolved first (from the
  // verified account), then one read of the session and its authenticator, then the decision time is sampled. The
  // factory clock is used because it is the clock that writes last_active_at (and, in production, the app clock that
  // writes expires_at); tests inject it.
  type SessionRow = {
    user_id: string; token: string; surface: string; expires_at: Date; locked_at: Date | null; last_active_at: Date;
    second_factor_at: Date | null; two_factor_enabled: boolean; factor_id: string | null; secret: string | null; verified: boolean | null;
  };
  type LiveSession = { userId: string; token: string; factor: string; factorId: string; secret: string; secondFactorAt: Date | null };
  const SESSION_READ = `select s.user_id, s.token, s.surface, s.expires_at, s.locked_at, s.last_active_at, s.second_factor_at,
              u.two_factor_enabled, f.id as factor_id, f.secret, f.verified
         from auth_session s join auth_user u on u.id = s.user_id left join auth_two_factor f on f.user_id = s.user_id
        where s.id = $1`;
  // The decision on a row read after the last wait, at time t sampled after that read: the expected account, this
  // surface, unexpired, enrolled with a verified authenticator, and the session gate (not locked, not idle-locked).
  const judge = (r: SessionRow | undefined, accountId: string, roles: readonly Role[], t: Date): LiveSession | null => {
    if (!r || r.user_id !== accountId || r.surface !== surface) return null;
    if (!r.two_factor_enabled || !r.factor_id || !r.secret || r.verified !== true) return null;
    if (r.expires_at.getTime() <= t.getTime()) return null;
    const gate = sessionGate({ roles, twoFactorEnabled: r.two_factor_enabled, lastActiveAt: r.last_active_at, lockedAt: r.locked_at, now: t, totpAlways: vendor });
    if (gate !== "ok") return null;
    return { userId: r.user_id, token: r.token, factor: factorKey(r.factor_id, r.secret), factorId: r.factor_id, secret: r.secret, secondFactorAt: r.second_factor_at };
  };
  async function liveSession(sessionId: string, accountId: string): Promise<LiveSession | null> {
    const roles = await config.roles(accountId); // first: the last wait before the read
    const { rows } = await config.pool.query<SessionRow>(SESSION_READ, [sessionId]);
    return judge(rows[0], accountId, roles, now());
  }
  const issue = (sessionId: string, live: LiveSession, verifiedAt: Date, maxAgeMs: number) =>
    mint({
      kind: "session",
      accountId: live.userId,
      sessionId,
      factor: "totp",
      verifiedAt,
      expiresAt: new Date(verifiedAt.getTime() + Math.min(maxAgeMs, STEP_UP_MAX_AGE_MS)),
      clock: now,
      // At each use: the same session is still live with the same authenticator.
      live: async () => (await liveSession(sessionId, live.userId))?.factor === live.factor,
    });

  // stepUp checks a current authenticator code (the current-code contract: the verifier accepts a valid code again
  // within its acceptance period; no one-use-per-period replay protection) for the exact signed-in session, through
  // the plugin's own verify-totp endpoint, so this file's hooks apply as over HTTP: the surface and session-gate
  // checks, the per-account counted attempt (HYG-007, DEC-010: one budget with sign-in, 5 failures lock 15 minutes)
  // and second_factor_at. Issuance then requires:
  // - the request carries no two-factor challenge cookie to the plugin (stripped), so verify-totp can only continue
  //   the session it finds, never complete a pending sign-in for a new session; and the plugin's answer names the
  //   original session's token;
  // - an enrolled account (a step-up never completes an enrolment);
  // - the final gate, in one short transaction on a checked-out client: the exact session row locked FOR UPDATE alone,
  //   then the session and its authenticator read in a new statement and judged at a time sampled after both (the same
  //   account, token and authenticator as before the code check; live, this surface, unexpired, not locked or
  //   idle-locked; the TOTP still within STEP_UP_MAX_AGE_MS); only then second_factor_at is stamped, and the proof is
  //   minted after COMMIT, after the TOTP deadline is checked once more;
  // - the TOTP time (the stamp, the provenance and the proof's verifiedAt) is taken when the plugin accepted the code,
  //   before any gate wait, so waiting never extends freshness.
  // Any refusal (anonymous, other surface, locked session, malformed or wrong code, lockout) is null.
  async function stepUp(headers: Headers, code: string): Promise<StepUp | null> {
    if (vendor) return null;
    const c = code.replace(/\s/g, "");
    if (!/^[0-9]{6}$/.test(c)) return null; // never reaches the plugin, so not counted
    // A copy (the hooks key the counted attempt on this request's headers object) without the challenge cookie.
    const h = new Headers(headers);
    const cookie = h.get("cookie");
    if (cookie) {
      const kept = cookie.split(";").map((p) => p.trim()).filter((p) => p && !CHALLENGE_COOKIE.test(p.slice(0, Math.max(p.indexOf("="), 0))));
      if (kept.length) h.set("cookie", kept.join("; "));
      else h.delete("cookie");
    }
    try {
      const current = await sessionRow(h);
      if (!current) return null;
      const before = await liveSession(current.row.id, current.s.user.id);
      if (!before || before.userId !== current.s.user.id) return null;
      await config.stepUpHooks?.beforeVerify?.();
      const res = (await auth.api.verifyTOTP({ headers: h, body: { code: c } })) as { token?: unknown } | null;
      if (res?.token !== before.token) return null;
      const verifiedAt = now(); // the TOTP time: never moved by the gate's waits
      const fresh = (t: Date) => { // the proof's own window: 0 <= TOTP age <= STEP_UP_MAX_AGE_MS (as the consumer)
        const age = t.getTime() - verifiedAt.getTime();
        return age >= 0 && age <= STEP_UP_MAX_AGE_MS;
      };
      await config.stepUpHooks?.afterVerify?.();
      const roles = await config.roles(before.userId); // first: the last wait before the gate
      const client = await config.pool.connect();
      let gated: LiveSession | null = null;
      try {
        await client.query("begin");
        await config.stepUpHooks?.beforeLock?.();
        // The exact session row locked alone, then read with its authenticator in a new statement (a fresh snapshot, so
        // a factor change committed during the lock wait is seen), judged at a time sampled after both.
        await client.query(`select 1 from auth_session where id = $1 for update`, [current.row.id]);
        const { rows } = await client.query<SessionRow>(SESSION_READ, [current.row.id]);
        const t = now(); // after the lock: no wait can follow before the decision
        const r = judge(rows[0], before.userId, roles, t);
        if (r && r.token === before.token && r.factor === before.factor && fresh(t)) {
          // The row is locked and present, so this updates exactly it.
          await client.query(`update auth_session set second_factor_at = $2 where id = $1`, [current.row.id, verifiedAt]);
          gated = r;
        }
        await client.query(gated ? "commit" : "rollback");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      if (!gated) return null;
      await config.stepUpHooks?.afterGate?.();
      if (!fresh(now())) return null; // the TOTP deadline again, right before publishing
      rememberTotp(current.row.id, verifiedAt, gated.factor);
      return issue(current.row.id, gated, verifiedAt, STEP_UP_MAX_AGE_MS);
    } catch (e) {
      if (e instanceof APIError) return null;
      throw e;
    }
  }

  // A proof without a new code while this clinic session's last gated stepUp (a TOTP; never a backup code, sign-in or
  // enrolment) is at most maxAgeMs old; the window can only be narrowed below STEP_UP_MAX_AGE_MS. That TOTP must be for
  // the session's current authenticator (a replacement voids it) and not in the future; the session's second_factor_at,
  // from the same authoritative read as the gate (lock, idle lock, enrolment), must cover it and not be ahead of this
  // clock beyond STEP_UP_SKEW_MS. Records no activity.
  async function freshStepUp(headers: Headers, maxAgeMs: number = STEP_UP_MAX_AGE_MS): Promise<StepUp | null> {
    if (vendor) return null;
    const s = await checkSession(headers, { activity: false });
    if (s.gate !== "ok") return null;
    const live = await liveSession(s.sessionId, s.userId);
    const proved = totpAt.get(s.sessionId);
    if (!live || !proved || proved.factor !== live.factor) return null;
    if (!live.secondFactorAt || live.secondFactorAt.getTime() < proved.at.getTime()) return null;
    // A persisted stamp ahead of this clock (beyond the skew) is refused; it never extends the window (the age below
    // is from the TOTP time this factory recorded).
    if (live.secondFactorAt.getTime() > now().getTime() + STEP_UP_SKEW_MS) return null;
    const age = now().getTime() - proved.at.getTime();
    if (age < 0 || age > Math.min(maxAgeMs, STEP_UP_MAX_AGE_MS)) return null;
    return issue(s.sessionId, live, proved.at, maxAgeMs);
  }

  // Undo createStaffAccount when the invitation could not be accepted in the same request
  // (cancelled or expired meanwhile), so the email is not left with an orphan account.
  // One transaction: if the accept did commit after all (a lost response), the membership
  // FK (ON DELETE RESTRICT) refuses the user delete and nothing — credential, sessions —
  // is removed. (Better Auth's deleteUser deletes rows one by one, not atomically.)
  async function discardNewAccount(userId: string): Promise<void> {
    const c = await config.pool.connect();
    try {
      await c.query("begin");
      for (const t of ["auth_session", "auth_two_factor", "auth_account"]) await c.query(`delete from ${t} where user_id = $1`, [userId]);
      await c.query(`delete from auth_user where id = $1`, [userId]);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  return { auth, createStaffAccount, discardNewAccount, checkSession, unlock, endSession, ownSecurity, ownSessions, endOwnSession, stepUp, freshStepUp };
}

export class AccountExistsError extends Error {
  constructor() {
    super("an account for this email exists");
  }
}

export class PasswordPolicyError extends Error {}

export type Auth = ReturnType<typeof createAuth>;
