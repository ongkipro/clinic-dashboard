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
import type pg from "pg";
import { NextResponse, type NextRequest } from "next/server";
import {
  eligibleTargetFromPath,
  normalizeActivePixelConfig,
  publicBaseCsp,
  resolveBookingHostCsp,
} from "./app/(public)/_pixel-policy";
import { openAppPool } from "./db/rls/pool";
import { type HostConfig, hostConfigFromEnv, resolveRequest } from "./lib/hosts";
import { resolvePublicSiteBySlug } from "./modules/public-site";

let cachedProxyPoolUrl: string | undefined;
let cachedProxyPool: Promise<pg.Pool> | undefined;
function proxyAppPool(url: string): Promise<pg.Pool> {
  if (cachedProxyPool && cachedProxyPoolUrl === url) return cachedProxyPool;
  const previous = cachedProxyPool;
  cachedProxyPoolUrl = url;
  const next = openAppPool({ connectionString: url, max: 2 }).catch((err) => {
    if (cachedProxyPool === next) {
      cachedProxyPool = undefined;
      cachedProxyPoolUrl = undefined;
    }
    throw err;
  });
  cachedProxyPool = next;
  if (previous) void previous.then((p) => p.end()).catch(() => {});
  return next;
}

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

export async function proxy(request: NextRequest) {
  const decision = resolveRequest(config(), request.headers.get("host"), request.nextUrl.pathname);
  if (!decision.allow) return refused();
  if (decision.host === "booking") {
    // H-02c / SEC-4 / ARCH-3 / PR-39 (T-123 Finding #3, T-127 r2 Finding #3):
    // Single final CSP + strict no-store + security headers on every BOOKING_HOST response.
    // Non-eligible routes (/{slug}/cabang directory, /perawatan, /dokter, /booking, /aftercare, /kebijakan-*)
    // ALWAYS receive strict 'self'-only CSP with zero DB lookup.
    // Eligible routes (/{slug} home and /{slug}/cabang/{branch} detail) with a valid signed "terima" cookie
    // re-verify the live pixelConfigFingerprint before unlocking provider origins — failing closed to strict CSP
    // on pixel ID rotation, unpublish, suspension, or missing DB.
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
    const cookieHeader = request.headers.get("cookie");
    const pre = resolveBookingHostCsp({
      pathname: request.nextUrl.pathname,
      cookieHeader,
      nonce,
    });
    let csp = pre.csp;
    if (pre.consentedProviders) {
      const target = eligibleTargetFromPath(request.nextUrl.pathname);
      if (!target || !process.env.APP_DATABASE_URL) {
        csp = publicBaseCsp(nonce);
      } else {
        try {
          const site = await resolvePublicSiteBySlug(
            target.slug,
            await proxyAppPool(process.env.APP_DATABASE_URL),
          );
          const routeVisible =
            site.state === "published" &&
            (target.kind === "home" ||
              (site.dto.sections.branches && site.dto.branches.some((b) => b.slug === target.branchSlug)));
          const liveConfig = routeVisible
            ? normalizeActivePixelConfig({
                metaPixelId: site.metaPixelId,
                gaMeasurementId: site.gaMeasurementId,
                revision: site.pixelConfigRevision,
              })
            : null;
          csp = resolveBookingHostCsp({
            pathname: request.nextUrl.pathname,
            cookieHeader,
            nonce,
            liveConfig,
          }).csp;
        } catch {
          csp = publicBaseCsp(nonce);
        }
      }
    }
    const forwarded = new Headers(request.headers);
    forwarded.set("content-security-policy", csp);
    forwarded.set("x-nonce", nonce);
    const response = NextResponse.next({ request: { headers: forwarded } });
    response.headers.set("content-security-policy", csp);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("cdn-cache-control", "no-store");
    response.headers.set("vary", "Cookie");
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  }
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
