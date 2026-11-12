// The mock payment adapter (PR-68, TD-43; T-073). In-process: nothing leaves the server and no provider is called
// (AGENTS: no live calls). Its webhook secret is derived from the server's KEK ring (HKDF-SHA256 over the KEK of the
// version the port config recorded; plan r1 P1-1, r2 F-4), so no secret is stored; without a KEK ring the mock is
// unusable. Webhooks are signed `x-mock-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` and are
// accepted within ±5 minutes (SEC-8).
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { kekRing } from "../../lib/keys/runtime";

export const SIGNATURE_HEADER = "x-mock-signature";
export const WINDOW_SECONDS = 300;
export const MAX_BODY_BYTES = 16 * 1024;

export class MockUnavailableError extends Error {
  constructor() {
    super("the mock payment port needs the server key ring");
  }
}

// The secret of one tenant's mock account under the KEK of `kekVersion`; null when that KEK is not loaded.
export function mockSecret(tenantId: string, providerAccount: string, kekVersion: number): Buffer | null {
  const ring = kekRing();
  const kek = ring?.keys.get(kekVersion);
  if (!kek) return null;
  return Buffer.from(hkdfSync("sha256", kek, Buffer.alloc(0), `payment-mock|${tenantId}|${providerAccount}|v${kekVersion}`, 32));
}

// The KEK version a new port records (the current one), or null without a ring.
export const currentKekVersion = (): number | null => kekRing()?.current ?? null;

export function sign(secret: Buffer, rawBody: string, at: number = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${at}.${rawBody}`, "utf8").digest("hex");
  return `t=${at},v1=${mac}`;
}

export type Verdict = { signatureOk: boolean; timestampOk: boolean };
// Constant-time check of the header against the body; a malformed header or a digest of the wrong length is a bad
// signature (never a thrown RangeError). The timestamp is judged separately so the event can say which failed.
export function verify(secret: Buffer, rawBody: string, header: string | null, now: number = Math.floor(Date.now() / 1000)): Verdict {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return { signatureOk: false, timestampOk: false };
  const at = Number(m[1]);
  const expected = createHmac("sha256", secret).update(`${at}.${rawBody}`, "utf8").digest();
  const given = Buffer.from(m[2], "hex");
  const signatureOk = given.length === expected.length && timingSafeEqual(given, expected);
  return { signatureOk, timestampOk: Math.abs(now - at) <= WINDOW_SECONDS };
}
