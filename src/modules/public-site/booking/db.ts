// Narrow public booking seam DB adapter (PR-67, UX-24, OD-1 Option B; T-126).
// Wraps SECURITY DEFINER functions from migration 0137; executes unbound (server resolves tenant from slug);
// binds residency context in-transaction for writes; hashes phone/IP with keyed HMAC-SHA256;
// checks OTP delivery port availability BEFORE any PII write (fail-closed in production without wired sender);
// dispatches 6-digit OTP via a mockable WhatsApp port (matching aftercare.ts DEC-108/DEC-082;
// zero live Meta calls in Release 1, zero plaintext OTP persisted or logged);
// returns ONLY opaque public slugs, timestamps, and neutral not_found (zero internal UUIDs).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PublishedBookingCatalog } from "../../../app/(public)/[slug]/booking/model";
import { MockInboxUnavailableError, mockInboxPort } from "../../messaging/inbox/mock";
import type { InboxPort } from "../../messaging/inbox/port";
import { bindResidencyContext, envOf } from "../../platform/residency";

type Db = Pool | PoolClient;

function isPool(db: Db): db is Pool {
  return typeof (db as Pool).connect === "function";
}

async function withResidencyTx<T>(
  db: Db,
  env: Partial<Record<string, string>>,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  if (!isPool(db)) {
    await bindResidencyContext(db, env);
    return fn(db);
  }
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await bindResidencyContext(c, env);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Keyed HMAC-SHA256 for rate-limit hashes (phone_hash, ip_hash) and short-lived confirmation cookies.
// Fails closed in production if no secret is configured.
export function publicBookingHmacKey(env: Partial<Record<string, string>> = process.env): string {
  const configured = (env.PUBLIC_BOOKING_HMAC_SECRET ?? env.BETTER_AUTH_SECRET ?? "").trim();
  if (configured.length >= 16) return configured;
  if (envOf(env.DEPLOY_ENV) === "production") {
    throw new Error("ERR_CONFIG: PUBLIC_BOOKING_HMAC_SECRET or BETTER_AUTH_SECRET required in production");
  }
  return "synthetic-public-booking-hmac-key-nonprod";
}

export const hmacHex = (s: string, env: Partial<Record<string, string>> = process.env) =>
  createHmac("sha256", publicBookingHmacKey(env)).update(s, "utf8").digest("hex");

// HMAC-signed short-lived HttpOnly cookie token (format: base64url(json).hexmac) so confirmation & masked phone
// never live in spoofable URL query parameters (S1).
export function signBookingCookiePayload(
  payload: Record<string, string | number>,
  env: Partial<Record<string, string>> = process.env,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = hmacHex(`cookie:${body}`, env);
  return `${body}.${sig}`;
}

export function verifyBookingCookiePayload<T extends Record<string, unknown>>(
  raw: string | undefined | null,
  env: Partial<Record<string, string>> = process.env,
): T | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  let expected: string;
  try {
    expected = hmacHex(`cookie:${body}`, env);
  } catch {
    return null;
  }
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof parsed.exp === "number" && parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type PublicBookingOtpPort = {
  isAvailable?: (env: Partial<Record<string, string>>) => boolean;
  sendOtp(input: { slug: string; phoneE164: string; otpCode: string; templateName: "kode_otp" }): Promise<void>;
};

export function createMockPublicBookingOtpPort(
  env: Partial<Record<string, string>> = process.env,
  inbox?: InboxPort,
): PublicBookingOtpPort {
  return {
    // Fail closed in production BEFORE any DB write until a live Meta sender is wired (DEL-3, B1).
    isAvailable: (checkEnv) => envOf(checkEnv.DEPLOY_ENV) !== "production",
    async sendOtp({ slug, phoneE164, otpCode, templateName }) {
      if (envOf(env.DEPLOY_ENV) === "production") {
        throw new MockInboxUnavailableError();
      }
      if (inbox) {
        await inbox.sendMessage({
          kind: "template",
          metaWabaId: `public-booking:${slug}`,
          phoneNumberId: `public-booking-sender:${slug}`,
          to: phoneE164,
          templateName,
          language: "id",
          params: [otpCode],
          accessToken: "mock-public-booking-token",
        });
        return;
      }
      if (envOf(process.env.DEPLOY_ENV) !== "production") {
        await mockInboxPort().sendMessage({
          kind: "template",
          metaWabaId: `public-booking:${slug}`,
          phoneNumberId: `public-booking-sender:${slug}`,
          to: phoneE164,
          templateName,
          language: "id",
          params: [otpCode],
          accessToken: "mock-public-booking-token",
        });
      }
    },
  };
}

export type PublicBookingCatalogResult =
  | { state: "not_found" }
  | ({ state: "open"; slug: string; brand: string } & PublishedBookingCatalog);

export type PublicBookingSlotsResult =
  | { state: "not_found"; slots: [] }
  | { state: "open"; date: string; timezone: string; slots: { startsAt: string; localTime: string }[] };

export type PublicOtpRequestResult =
  | { state: "not_found" }
  | { state: "send_failed" }
  | { state: "otp_sent"; expiresAt: string; dpRequired: boolean };

export type PublicOtpResendResult =
  | { state: "not_found" }
  | { state: "otp_locked" }
  | { state: "otp_expired" }
  | { state: "send_failed" }
  | { state: "otp_sent"; expiresAt: string; resendCount: number };

export type PublicVerifyAndBookResult =
  | { state: "not_found" }
  | { state: "otp_expired" }
  | { state: "otp_locked" }
  | { state: "otp_mismatch"; attemptsRemaining: number }
  | {
      state: "confirmed" | "held" | "inactive";
      replayed: boolean;
      sourceTag: string;
      startsAt: string;
      endsAt: string;
      holdUntil: string | null;
    };

export async function getPublicBookingCatalog(db: Db, slug: string): Promise<PublicBookingCatalogResult> {
  const { rows } = await db.query<{ res: PublicBookingCatalogResult }>(
    `SELECT public.public_booking_catalog($1::text) AS res`,
    [slug],
  );
  return rows[0]?.res ?? { state: "not_found" };
}

export async function getPublicBookingSlots(
  db: Db,
  params: { slug: string; treatmentSlug: string; branchSlug: string; date: string; doctorSlug?: string | null },
): Promise<PublicBookingSlotsResult> {
  const { rows } = await db.query<{ res: PublicBookingSlotsResult }>(
    `SELECT public.public_booking_slots($1::text, $2::text, $3::text, $4::date, $5::text) AS res`,
    [params.slug, params.treatmentSlug, params.branchSlug, params.date, params.doctorSlug ?? null],
  );
  return rows[0]?.res ?? { state: "not_found", slots: [] };
}

export async function requestPublicBookingOtp(
  db: Db,
  params: {
    slug: string;
    treatmentSlug: string;
    branchSlug: string;
    slotStartIso: string;
    doctorSlug?: string | null;
    sourceTag: string;
    phoneE164: string;
    patientName: string;
    birthDate: string;
    sex: "female" | "male";
    otpCode: string;
    intentToken: string;
    clientIp: string;
  },
  env: Partial<Record<string, string>> = process.env,
  otpPort: PublicBookingOtpPort = createMockPublicBookingOtpPort(env),
): Promise<PublicOtpRequestResult> {
  // B1: Refuse BEFORE any DB write, PII persistence, or quota consumption when no live sender is available.
  if (otpPort.isAvailable && !otpPort.isAvailable(env)) {
    return { state: "send_failed" };
  }

  const intentHash = sha256Hex(`intent:${params.intentToken}`);
  const dbRes = await withResidencyTx(db, env, async (c) => {
    const { rows } = await c.query<{ res: Exclude<PublicOtpRequestResult, { state: "send_failed" }> }>(
      `SELECT public.public_booking_otp_request($1::text,$2::text,$3::text,$4::timestamptz,$5::text,$6::text,$7::text,$8::text,$9::text,$10::date,$11::text,$12::text,$13::text,$14::text) AS res`,
      [
        params.slug,
        params.treatmentSlug,
        params.branchSlug,
        params.slotStartIso,
        params.doctorSlug ?? null,
        params.sourceTag,
        params.phoneE164,
        hmacHex(`phone:${params.slug.toLowerCase()}:${params.phoneE164}`, env),
        params.patientName,
        params.birthDate,
        params.sex,
        sha256Hex(`otp:${params.intentToken}:${params.otpCode}`),
        intentHash,
        hmacHex(`ip:${params.clientIp}`, env),
      ],
    );
    return rows[0]?.res ?? { state: "not_found" as const };
  });

  if (dbRes.state !== "otp_sent") return dbRes;
  try {
    await otpPort.sendOtp({
      slug: params.slug.toLowerCase(),
      phoneE164: params.phoneE164,
      otpCode: params.otpCode,
      templateName: "kode_otp",
    });
    return dbRes;
  } catch (e) {
    // Purge PII immediately if runtime OTP delivery failed so no PII is stranded in DB.
    await db
      .query(`SELECT public.public_booking_otp_abort($1::text, $2::text)`, [params.slug, intentHash])
      .catch(() => {});
    console.error("public_booking_otp_send_failed", e instanceof Error ? e.name : "unknown");
    return { state: "send_failed" };
  }
}

type ResendPrepareSqlResult =
  | { state: "not_found" }
  | { state: "otp_locked" }
  | { state: "otp_expired" }
  | { state: "ready"; deliveryPhone: string };

type ResendCommitSqlResult =
  | { state: "not_found" }
  | { state: "otp_locked" }
  | { state: "otp_expired" }
  | { state: "otp_sent"; expiresAt: string; resendCount: number };

export async function resendPublicBookingOtp(
  db: Db,
  params: { slug: string; intentToken: string; newOtpCode: string; clientIp: string },
  env: Partial<Record<string, string>> = process.env,
  otpPort: PublicBookingOtpPort = createMockPublicBookingOtpPort(env),
): Promise<PublicOtpResendResult> {
  // B1: Fail closed BEFORE touching DB or rotating otp_hash when no live sender is available.
  if (otpPort.isAvailable && !otpPort.isAvailable(env)) {
    return { state: "send_failed" };
  }

  const intentHash = sha256Hex(`intent:${params.intentToken}`);
  const prep = await withResidencyTx(db, env, async (c) => {
    const { rows } = await c.query<{ res: ResendPrepareSqlResult }>(
      `SELECT public.public_booking_otp_resend_prepare($1::text,$2::text) AS res`,
      [params.slug, intentHash],
    );
    return rows[0]?.res ?? { state: "not_found" as const };
  });

  if (prep.state !== "ready") return prep;

  // Dispatch BEFORE committing the replacement otp_hash so a delivery failure never invalidates the prior code (B1/S6).
  try {
    await otpPort.sendOtp({
      slug: params.slug.toLowerCase(),
      phoneE164: prep.deliveryPhone,
      otpCode: params.newOtpCode,
      templateName: "kode_otp",
    });
  } catch (e) {
    console.error("public_booking_otp_resend_failed", e instanceof Error ? e.name : "unknown");
    return { state: "send_failed" };
  }

  return withResidencyTx(db, env, async (c) => {
    const { rows } = await c.query<{ res: ResendCommitSqlResult }>(
      `SELECT public.public_booking_otp_resend_commit($1::text,$2::text,$3::text) AS res`,
      [params.slug, intentHash, sha256Hex(`otp:${params.intentToken}:${params.newOtpCode}`)],
    );
    return rows[0]?.res ?? { state: "not_found" as const };
  });
}

export async function verifyPublicBookingOtpAndBook(
  db: Db,
  params: { slug: string; intentToken: string; otpCode: string; commandKey: string },
  env: Partial<Record<string, string>> = process.env,
): Promise<PublicVerifyAndBookResult> {
  return withResidencyTx(db, env, async (c) => {
    const { rows } = await c.query<{ res: PublicVerifyAndBookResult }>(
      `SELECT public.public_booking_otp_verify_and_book($1::text,$2::text,$3::text,$4::text) AS res`,
      [
        params.slug,
        sha256Hex(`intent:${params.intentToken}`),
        sha256Hex(`otp:${params.intentToken}:${params.otpCode}`),
        params.commandKey,
      ],
    );
    return rows[0]?.res ?? { state: "not_found" };
  });
}
