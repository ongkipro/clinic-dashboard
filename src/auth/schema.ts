// Better Auth tables (IAM-1, DATA-12, DATA-55). Login accounts are global, not tenant
// rows: policy kind `platform`, reachable only through the `clinic_auth` database role
// (migration 0005). T-007 links an account to tenant memberships.
//
// Column names are snake_case; Better Auth field names stay camelCase through the
// Drizzle column mapping. Ids are UUIDv7 from the database default (DATA-7); Better Auth
// runs with `advanced.database.generateId = false`.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`uuid_generate_v7()`);

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const authUser = pgTable(
  "auth_user",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("auth_user_email_key").on(t.email),
    check("auth_user_email_lower_check", sql`${t.email} = lower(${t.email})`),
  ],
);

export const authSession = pgTable(
  "auth_session",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "restrict" }),
    token: text("token").notNull(),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // IAM-7 idle lock: server-side, so a locked session cannot be used by another tab.
    lastActiveAt: ts("last_active_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("auth_session_token_key").on(t.token), index("auth_session_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "restrict" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("auth_account_provider_key").on(t.providerId, t.accountId),
    index("auth_account_user_idx").on(t.userId),
  ],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

export const authTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "restrict" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
  },
  (t) => [unique("auth_two_factor_user_key").on(t.userId)],
);

// Better Auth's per-IP request limiter (database storage, shared by every app container).
export const authRateLimit = pgTable("auth_rate_limit", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// RATE-2: failed password sign-ins per account (email), counted by our own hook so the
// lockout holds across IPs and containers.
export const authLoginFailure = pgTable(
  "auth_login_failure",
  {
    id: id(),
    email: text("email").notNull(),
    failedAt: ts("failed_at").notNull().defaultNow(),
  },
  (t) => [index("auth_login_failure_email_idx").on(t.email, t.failedAt)],
);
