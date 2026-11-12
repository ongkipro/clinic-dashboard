// The mock payment adapter's webhook (TD-43, PR-68, SEC-8; T-073). Served only on the booking host (hosts.ts). POST
// only; the raw body is read once and verified against the routed tenant's derived secret (constant-time), within
// ±5 minutes. Answers: 401 bad signature or out of window, 413 above 16 KB, 400 not JSON or a bad payload, 404 when
// the port is unusable here (production with the mock, or no key ring), 200 otherwise (applied, duplicate, dropped:
// a provider stops retrying). The body is never echoed; nothing is cached.
import { receiveMockWebhook } from "../../../../../../modules/payments/payments";
import { workerPool } from "../../../../../../modules/payments/worker-pool";
import { MAX_BODY_BYTES, SIGNATURE_HEADER } from "../../../../../../modules/payments/mock";

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: HEADERS });
  const raw = await req.text();
  const a = await receiveMockWebhook(await workerPool(), raw, req.headers.get(SIGNATURE_HEADER));
  return new Response(null, { status: a.status, headers: HEADERS });
}
