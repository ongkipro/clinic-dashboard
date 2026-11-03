// Host isolation (ARCH-3, SEC-21): every request is checked against the host resolver
// before any route renders. Refusals are a plain 404 with no body, the same for every
// reason, so a host never reveals routes that belong to another host.
//
// Vendor console (SEC-21): every response on the vendor host carries a strict CSP with a
// fresh nonce (no inline script or style runs without it; Next.js reads the nonce from the
// request's CSP header and stamps its own scripts), no framing, no plugins, and same-origin
// forms only. Server Actions resolve by action id regardless of path — as a Next-Action
// fetch or as a progressive-enhancement multipart/urlencoded form POST — so the vendor
// host accepts no state-changing request except to its own auth API, and never a
// Next-Action or form-encoded body there either. Console writes (T-023) go to the JSON
// routes under /vendor/api/console/: POST with application/json only (a cross-site form
// cannot send it without a CORS preflight, which is never answered), and the route
// checks Origin again.
import { NextResponse, type NextRequest } from "next/server";
import { type HostConfig, hostConfigFromEnv, resolveRequest } from "./lib/hosts";

// Read once per process. Outside production the three hosts default to loopback names
// (browsers resolve *.localhost to 127.0.0.1); production must configure all three
// (ARCH-9) and a bad configuration fails every request closed (500) until fixed.
let cached: HostConfig | undefined;
function config(): HostConfig {
  if (cached) return cached;
  const env = process.env;
  if (env.NODE_ENV !== "production" && !env.APP_HOST && !env.BOOKING_HOST && !env.VENDOR_HOST) {
    const port = env.PORT ?? "3000";
    cached = {
      app: `localhost:${port}`,
      booking: `booking.localhost:${port}`,
      vendor: `vendor.localhost:${port}`,
    };
  } else {
    cached = hostConfigFromEnv(env);
  }
  return cached;
}

export function vendorCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function refused() {
  return new NextResponse(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-host-policy": "refused" },
  });
}

export function proxy(request: NextRequest) {
  const decision = resolveRequest(config(), request.headers.get("host"), request.nextUrl.pathname);
  if (!decision.allow) return refused();
  if (decision.host !== "vendor") return NextResponse.next();
  const method = request.method.toUpperCase();
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const authApi = request.nextUrl.pathname.startsWith("/vendor/api/auth/");
  const consoleApi = request.nextUrl.pathname.startsWith("/vendor/api/console/");
  if (request.headers.has("next-action")) return refused();
  if (method !== "GET" && method !== "HEAD" && !authApi && !(consoleApi && method === "POST")) return refused();
  if (authApi && (contentType.startsWith("multipart/form-data") || contentType.startsWith("application/x-www-form-urlencoded"))) return refused();
  if (consoleApi && !contentType.startsWith("application/json")) return refused();
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const csp = vendorCsp(nonce);
  const forwarded = new Headers(request.headers);
  forwarded.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.headers.set("cache-control", "no-store");
  return response;
}
