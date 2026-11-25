// Aftercare (PR-70; T-096, migration 0111, DEC-108). A closed visit with aftercare texts gets a notice and a neutral care message (queued
// by the visits_aftercare trigger, sent by the T-094 dispatch with a link token minted at claim time). The patient opens
// /aftercare/<token> on the booking host, asks for a WhatsApp OTP (TD-26: 5 min, 5 attempts; RATE-1), and after it reads each treatment's
// aftercare text. Everything here runs on an unbound pool: the page has no staff session. Hashes only reach SQL; the plain link token
// lives in the patient's WhatsApp message and URL, the session token in an httpOnly cookie.
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type pg from "pg";
import { decryptField, type KekRing, type TenantKeys, type WrappedDek } from "../../../lib/keys/envelope";
import { EncryptionUnavailableError, kekRing } from "../../../lib/keys/runtime";
import { mockInboxPort } from "../../messaging/inbox/mock";
import type { InboxPort } from "../../messaging/inbox/port";

export const hashOf = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
// DEC-117 Row 7 P2: 6-digit OTPs are bound to the link token and keyed with HMAC-SHA256 so an
// exposed otp_hash cannot be brute-forced offline across the 10^6 code space.
function otpSecret(): string {
  const k = process.env.AFTERCARE_OTP_SECRET || process.env.BETTER_AUTH_SECRET;
  if (k && k.length >= 16) return k;
  if (process.env.DEPLOY_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error("AFTERCARE_OTP_SECRET or BETTER_AUTH_SECRET is required");
  }
  return "clinic-dashboard-local-aftercare-otp-key";
}
export const otpHashOf = (token: string, code: string) =>
  createHmac("sha256", otpSecret()).update(`${token}:${code}`, "utf8").digest("hex");
// A link token is 43 base64url characters (32 random bytes); anything else is not looked up.
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type AftercareItem = { name: string; aftercare: string };
export type AftercarePage =
  | { state: "not_found" }
  | { state: "link_expired" | "ready" | "otp_sent" | "otp_locked"; clinic_name: string; branch_name: string; accent: string | null; masked_phone: string | null }
  | { state: "verified"; clinic_name: string; branch_name: string; accent: string | null; masked_phone: string | null; visit_date: string; items: AftercareItem[] };

export async function aftercarePage(pool: pg.Pool | pg.ClientBase, token: string, sessionToken: string | null, now?: Date): Promise<AftercarePage> {
  if (!TOKEN.test(token)) return { state: "not_found" };
  const r = await pool.query<{ r: AftercarePage }>(`select aftercare_link_lookup($1, $2, $3) r`,
    [hashOf(token), sessionToken ? hashOf(sessionToken) : null, now ?? null]);
  return r.rows[0].r;
}

// the same minimal key opening as the outbound dispatcher (src/modules/messaging/outbound/outbound.ts keysOf / ring, not exported)
function keysOf(tenantId: string, rows: { version: number; wrapped: string; is_current?: boolean }[]): TenantKeys | null {
  if (!rows.length) return null;
  const deks: WrappedDek[] = rows.map((x) => ({ tenantId, version: x.version, wrapped: x.wrapped }));
  const cur = rows.find((x) => x.is_current !== false) ?? rows[rows.length - 1];
  return { tenantId, current: deks.find((d) => d.version === cur.version)!, byVersion: (v) => deks.find((d) => d.version === v) };
}
function ring(): KekRing {
  const k = kekRing();
  if (!k) throw new EncryptionUnavailableError();
  return k;
}

export type OtpRefusal = "not_found" | "link_expired" | "otp_locked" | "rate_limited" | "number_not_sending" | "send_failed";
type Route = { ok: true; tenant_id: string; meta_waba_id: string; phone_number_id: string; to: string; template_name: string; template_language: string;
  encrypted_token: string | null; keys: { version: number; wrapped: string; is_current: boolean }[] } | { ok: false; reason: OtpRefusal };

// Send a 6-digit OTP for a link through the approved authentication template `kode_otp`, synchronously (the mock port, DEC-082). The code
// is never stored or logged; only its hash reaches SQL. A failed send leaves the code unusable to nobody: the patient asks again.
export async function sendAftercareOtp(pool: pg.Pool | pg.ClientBase, token: string, ip: string, o: { now?: Date; port?: InboxPort } = {}):
  Promise<{ ok: true } | { ok: false; reason: OtpRefusal }> {
  if (!TOKEN.test(token)) return { ok: false, reason: "not_found" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const r = (await pool.query<{ r: Route }>(`select aftercare_otp_send($1, $2, $3, $4) r`, [hashOf(token), otpHashOf(token, code), hashOf(ip), o.now ?? null])).rows[0].r;
  if (!r.ok) return r;
  try {
    const keys = keysOf(r.tenant_id, r.keys);
    if (!keys || !r.encrypted_token) return { ok: false, reason: "number_not_sending" };
    const accessToken = decryptField(ring(), keys, "waba.token", r.encrypted_token);
    await (o.port ?? mockInboxPort()).sendMessage({ kind: "template", metaWabaId: r.meta_waba_id, phoneNumberId: r.phone_number_id, to: r.to,
      templateName: r.template_name, language: r.template_language, params: [code], accessToken });
  } catch (e) {
    console.error("aftercare_otp_send_failed", e instanceof Error ? e.name : "unknown");
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true };
}

export type VerifyResult = { ok: true; sessionToken: string } | { ok: false; reason: "not_found" | "link_expired" | "otp_locked" | "otp_expired" | "otp_invalid";
  attempts_remaining?: number };
// Verify the code; on success a fresh session token (its hash stored, 30 minutes, never past the link's expiry) for the httpOnly cookie.
export async function verifyAftercareOtp(pool: pg.Pool | pg.ClientBase, token: string, code: string, now?: Date): Promise<VerifyResult> {
  if (!TOKEN.test(token)) return { ok: false, reason: "not_found" };
  if (!/^[0-9]{6}$/.test(code)) return { ok: false, reason: "otp_invalid" };
  const session = randomBytes(32).toString("base64url");
  const r = (await pool.query<{ r: { ok: boolean; reason?: string; attempts_remaining?: number } }>(`select aftercare_otp_verify($1, $2, $3, $4) r`,
    [hashOf(token), otpHashOf(token, code), hashOf(session), now ?? null])).rows[0].r;
  return r.ok ? { ok: true, sessionToken: session } : (r as VerifyResult);
}
