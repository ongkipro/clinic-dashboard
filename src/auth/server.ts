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
  type RoleSource,
  type SessionGate,
  sessionGate,
} from "./policy";

export type AuthConfig = {
  pool: pg.Pool; // clinic_auth login, opened with openAppPool(..., AUTH_GROUP_ROLE)
  baseURL: string; // https://<APP_HOST>
  secret: string; // BETTER_AUTH_SECRET (≥ 32 chars, from configuration)
  roles: RoleSource;
  now?: () => Date; // injectable clock for tests (DATA §6)
  rateLimit?: boolean; // defaults to on; tests that sign in repeatedly turn it off
  sleep?: (ms: number) => Promise<void>; // progressive delay; tests inject a recorder
  // Client IP header set by the trusted origin proxy (Traefik). Never read from a
  // header the client controls directly.
  ipAddressHeaders?: string[];
};

export const LOGIN_LOCKED_CODE = "LOGIN_TEMPORARILY_LOCKED";
export const SESSION_LOCKED_CODE = "SESSION_LOCKED";

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

// RATE-2 progressive delay before checking a password: 0, 250, 500, 1000, 2000 ms for
// the 1st..5th attempt in the window (attempts already failed or still in flight).
export function progressiveDelayMs(priorAttempts: number): number {
  return priorAttempts <= 0 ? 0 : Math.min(250 * 2 ** (priorAttempts - 1), 4_000);
}

export function createAuth(config: AuthConfig) {
  if (config.secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  const now = config.now ?? (() => new Date());
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
    return row ? { s, row } : undefined;
  };

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
    advanced: {
      database: { generateId: false }, // UUIDv7 from the database (DATA-7)
      useSecureCookies: config.baseURL.startsWith("https://"),
      ipAddress: { ipAddressHeaders: config.ipAddressHeaders ?? ["x-real-ip"] },
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
      session: { create: { before: async (session) => ({ data: { ...session, lastActiveAt: now(), lockedAt: null } }) } },
    },
    session: {
      expiresIn: 12 * 60 * 60, // absolute: one working day, staff sign in each day
      disableSessionRefresh: true,
      freshAge: 10 * 60, // sensitive actions (2FA changes) need a recent sign-in
      additionalFields: {
        lastActiveAt: { type: "date", required: false, input: false },
        lockedAt: { type: "date", required: false, input: false },
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
            });
            if (gate === "locked" || (gate === "enrol_totp" && !ENROL_PATHS.has(ctx.path))) {
              throw APIError.from("FORBIDDEN", {
                code: SESSION_LOCKED_CODE,
                message: "Sesi terkunci. Masukkan kata sandi untuk melanjutkan.",
              });
            }
          }
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
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!PASSWORD_PATHS.has(ctx.path)) return;
        const returned = ctx.context.returned as { statusCode?: number; body?: { code?: string } } | undefined;
        const failed = Boolean(returned && typeof returned.statusCode === "number" && returned.statusCode >= 400);
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
    | { gate: SessionGate; userId: string; sessionId: string }
  > {
    const s = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!s) return { gate: "anonymous" };
    const roles = await config.roles(s.user.id);
    const row = await db.query.authSession.findFirst({ where: eq(schema.authSession.id, s.session.id) });
    if (!row) return { gate: "anonymous" };
    const t = now();
    const gate = sessionGate({
      roles,
      twoFactorEnabled: Boolean((s.user as { twoFactorEnabled?: boolean }).twoFactorEnabled),
      lastActiveAt: row.lastActiveAt,
      lockedAt: row.lockedAt,
      now: t,
    });
    if (gate === "locked" && !row.lockedAt) {
      await db.update(schema.authSession).set({ lockedAt: t }).where(eq(schema.authSession.id, row.id));
    }
    if (gate === "ok" && opts.activity !== false) {
      await db.update(schema.authSession).set({ lastActiveAt: t }).where(eq(schema.authSession.id, row.id));
    }
    return { gate, userId: s.user.id, sessionId: s.session.id };
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

  return { auth, createStaffAccount, discardNewAccount, checkSession, unlock, endSession };
}

export class AccountExistsError extends Error {
  constructor() {
    super("an account for this email exists");
  }
}

export class PasswordPolicyError extends Error {}

export type Auth = ReturnType<typeof createAuth>;
