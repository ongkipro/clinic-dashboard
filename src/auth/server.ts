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
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "./schema";
import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
  requiresTotp,
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
};

export const LOGIN_LOCKED_CODE = "LOGIN_TEMPORARILY_LOCKED";
export const SESSION_LOCKED_CODE = "SESSION_LOCKED";
export const PASSWORD_POLICY_CODE = "PASSWORD_POLICY";
export type OwnSecurity = { email: string; totpEnabled: boolean; totpRequired: boolean; sessions: OwnSession[] };
export type OwnSession = { id: string; createdAt: Date; ipAddress: string | null; userAgent: string | null; current: boolean };

// Endpoints that check a password for an account; each counts toward RATE-2.
const PASSWORD_PATHS = new Set([
  "/sign-in/email",
  "/change-password",
  "/verify-password",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes",
]);
// Session endpoints that stay usable while the session is locked or gated: reading it
// (the UI needs the gate) and ending it.
const LOCK_EXEMPT_PATHS = new Set(["/get-session", "/sign-out", "/ok", "/error"]);
// Endpoints a session needing TOTP enrolment may still call.
const ENROL_PATHS = new Set(["/two-factor/enable", "/two-factor/verify-totp", "/two-factor/get-totp-uri"]);
// A successful call proves the second factor for the session it creates or continues.
const SECOND_FACTOR_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

// RATE-2 progressive delay before checking a password: 0, 250, 500, 1000, 2000 ms for
// the 1st..5th attempt in the window (attempts already failed or still in flight).
export function progressiveDelayMs(priorAttempts: number): number {
  return priorAttempts <= 0 ? 0 : Math.min(250 * 2 ** (priorAttempts - 1), 4_000);
}

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
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
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
        // it) needs the password and a current code: possession of the device, not only of
        // the session. A wrong code keeps the RATE-2 claim above. Roles that require TOTP
        // are sent straight back to enrolment by the session gate (PR-3).
        if (ctx.path === "/two-factor/disable") {
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
    | { gate: SessionGate; userId: string; sessionId: string; token: string }
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
    return { gate, userId: s.user.id, sessionId: s.session.id, token: row.token };
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

  return { auth, createStaffAccount, discardNewAccount, checkSession, unlock, endSession, ownSecurity, ownSessions, endOwnSession };
}

export class AccountExistsError extends Error {
  constructor() {
    super("an account for this email exists");
  }
}

export class PasswordPolicyError extends Error {}

export type Auth = ReturnType<typeof createAuth>;
