// Better Auth HTTP API for the vendor console (SEC-21): /vendor/api/auth/* on the vendor
// host only (src/lib/hosts.ts). Separate `__Host-vendor.*` cookies (SameSite=Strict);
// sessions are marked surface = vendor and the clinic app's /api/auth refuses them (and
// this handler refuses clinic sessions). Sign-up is disabled; vendor accounts are created
// by a platform owner (T-020 vendor_staff_create) or the one-time bootstrap.
import { vendorAuth } from "../../../_lib/server";

async function handle(request: Request): Promise<Response> {
  const { auth } = await vendorAuth();
  const response = await auth.handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export { handle as GET, handle as POST };
