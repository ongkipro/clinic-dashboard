// Better Auth HTTP API (sign-in, TOTP enrol/verify, sign-out). Served on the app host
// only (src/lib/hosts.ts). Responses are per-user and never cached (TEN-4).
import { getAuth } from "../../../../auth/instance";

async function handle(request: Request): Promise<Response> {
  const { auth } = await getAuth();
  const response = await auth.handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export { handle as GET, handle as POST };
