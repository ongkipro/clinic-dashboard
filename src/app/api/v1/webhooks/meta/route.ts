// The Meta webhook (TD-22, SEC-8, W-10; T-090). Served on the DNS-only app host only (hosts.ts: not a booking prefix), so message content
// never transits the Cloudflare proxy. GET answers Meta's verification challenge only with the mock verify token derived from the KEK ring;
// POST reads the raw body once, verifies X-Hub-Signature-256 (constant time) and hands it to the module. Answers: 404 without the mock
// secret (no key ring, or production — DEC-082: no live Meta), 413 above 64 KB, 401 bad signature, 400 not a WABA webhook, 200 otherwise.
// The body is never echoed or logged; nothing is cached.
import { receiveMetaWebhook } from "../../../../../modules/messaging/inbox/inbox";
import { MAX_WEBHOOK_BYTES, META_SIGNATURE_HEADER, mockMetaAppSecret } from "../../../../../modules/messaging/inbox/mock";
import { workerPool } from "../../../../../modules/payments/worker-pool";
import { createHmac, timingSafeEqual } from "node:crypto";

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export async function GET(req: Request) {
  const secret = mockMetaAppSecret();
  if (!secret) return new Response(null, { status: 404, headers: HEADERS });
  const u = new URL(req.url);
  const token = u.searchParams.get("hub.verify_token") ?? "";
  const challenge = u.searchParams.get("hub.challenge") ?? "";
  const expected = createHmac("sha256", secret).update("verify-token").digest("hex");
  const given = Buffer.from(token);
  const ok = u.searchParams.get("hub.mode") === "subscribe" && given.length === expected.length && timingSafeEqual(given, Buffer.from(expected))
    && /^[0-9A-Za-z_-]{1,128}$/.test(challenge);
  return ok ? new Response(challenge, { status: 200, headers: { ...HEADERS, "content-type": "text/plain" } }) : new Response(null, { status: 403, headers: HEADERS });
}

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return new Response(null, { status: 413, headers: HEADERS });
  const raw = await req.text();
  const a = await receiveMetaWebhook(await workerPool(), raw, req.headers.get(META_SIGNATURE_HEADER));
  return new Response(null, { status: a.status, headers: HEADERS });
}
