// Shared same-origin check for public BOOKING_HOST route handlers (DEC-117 Rows 1/7/10).
// Enforces configured BOOKING_HOST (when set) and HTTPS scheme in production.
import type { NextRequest } from "next/server";
import { envOf } from "../modules/platform/residency";

export function isSameBookingOrigin(
  req: NextRequest,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const isProd = envOf(env.DEPLOY_ENV) === "production";
  const configuredBookingHost = env.BOOKING_HOST?.trim().toLowerCase() ?? "";
  // DEC-117 Rows 1/7/10: fail closed in production when BOOKING_HOST is unset/blank.
  const host = isProd ? configuredBookingHost : configuredBookingHost || (req.headers.get("host")?.trim().toLowerCase() ?? "");
  const origin = req.headers.get("origin");
  if (!host || !origin) return false;
  try {
    const u = new URL(origin);
    const schemeOk = isProd ? u.protocol === "https:" : u.protocol === "https:" || u.protocol === "http:";
    return schemeOk && u.host.toLowerCase() === host;
  } catch {
    return false;
  }
}
