// The mock Meta messaging adapter and the mock webhook secret (T-090; DEC-082: no live Meta call, no network). The app secret that signs
// Meta webhooks (`X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, SEC-8) is derived from the server's KEK ring, so no secret
// is stored; without a ring, or in production, the mock is unusable (DEL-3).
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { kekRing } from "../../../lib/keys/runtime";
import { deployEnv } from "../../vendor/profile/profile";
import { RECORDED_TEMPLATES } from "./fixtures";
import type { InboxPort } from "./port";

export const META_SIGNATURE_HEADER = "x-hub-signature-256";
export const MAX_WEBHOOK_BYTES = 64 * 1024;

export class MockInboxUnavailableError extends Error {
  constructor() {
    super("the mock Meta messaging adapter is not available here");
  }
}

// The mock app secret, or null without a KEK ring or in production.
export function mockMetaAppSecret(): Buffer | null {
  if (deployEnv() === "production") return null;
  const ring = kekRing();
  const kek = ring?.keys.get(ring.current);
  if (!kek) return null;
  return Buffer.from(hkdfSync("sha256", kek, Buffer.alloc(0), `meta-webhook-app-secret|v${ring!.current}`, 32));
}

export const signMeta = (secret: Buffer, rawBody: string) => `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;

// Constant time; a malformed header is a bad signature (never a thrown error).
export function verifyMeta(secret: Buffer, rawBody: string, header: string | null): boolean {
  const m = /^sha256=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function mockInboxPort(): InboxPort & { sent: { kind: string; to: string }[] } {
  const sent: { kind: string; to: string }[] = [];
  const guard = () => {
    if (deployEnv() === "production") throw new MockInboxUnavailableError();
  };
  return {
    sent,
    async sendMessage(i) {
      guard();
      sent.push({ kind: i.kind, to: i.to });
      return { providerMessageId: `wamid.MOCK${randomBytes(12).toString("hex").toUpperCase()}` };
    },
    async fetchTemplates() {
      guard();
      return RECORDED_TEMPLATES.map((t) => ({ ...t }));
    },
  };
}
