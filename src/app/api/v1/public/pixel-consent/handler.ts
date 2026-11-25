// Public pixel consent & withdrawal POST handler (PR-39, UX-51; T-127 r4).
// Extracted into a sibling module so Next.js App Router route.ts exports ONLY HTTP POST.
// BOOKING_HOST only; verifies full Origin (scheme + host) & Fetch Metadata, resolves live published pixel config
// + persisted pixelConfigRevision strictly on the server, verifies banner presentation token without mutating
// newer choices on stale-tab submit, signs HMAC-SHA256 HttpOnly cookie scoped strictly to Path=/{slug}, and handles
// explicit withdrawal ("cabut") without ever mutating another tenant's consent cookie.
import type { Pool, PoolClient } from "pg";
import { NextResponse, type NextRequest } from "next/server";
import { envOf } from "../../../../../modules/platform/residency";
import { resolvePublicSiteBySlug } from "../../../../../modules/public-site";
import {
  buildClearConsentCookieHeader,
  buildSetConsentCookieHeader,
  hasActivePixel,
  normalizeActivePixelConfig,
  pixelConsentSecret,
  redactedPublicPath,
  signPixelConsentCookie,
  verifyBannerPresentationToken,
} from "../../../../(public)/_pixel-policy";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const SEC_HEADERS = {
  "cache-control": "private, no-store",
  "cdn-cache-control": "no-store",
  vary: "Cookie",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

function requestProtocol(req: NextRequest, env: Partial<Record<string, string>>): "https:" | "http:" {
  if (envOf(env.DEPLOY_ENV) === "production") return "https:";
  const xfProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (xfProto === "https") return "https:";
  if (xfProto === "http") return "http:";
  return req.nextUrl.protocol === "https:" ? "https:" : "http:";
}

export function isSamePixelOrigin(
  req: NextRequest,
  env: Partial<Record<string, string>> = process.env,
): boolean {
  const host = req.headers.get("host")?.trim().toLowerCase();
  if (!host) return false;
  const fetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;

  const expectedProto = requestProtocol(req, env);
  const expectedOrigin = `${expectedProto}//${host}`;
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).origin.toLowerCase() === expectedOrigin;
    } catch {
      return false;
    }
  }
  // Under Referrer-Policy: no-referrer, browsers send `Origin: null` on same-origin HTML form POSTs
  // while stamping browser-controlled `Sec-Fetch-Site: same-origin`.
  return fetchSite === "same-origin";
}

export async function handlePixelConsentPost(
  request: NextRequest,
  deps?: { db?: Db; env?: Partial<Record<string, string>> },
) {
  const env = deps?.env ?? process.env;
  if (!isSamePixelOrigin(request, env)) {
    return new NextResponse(null, { status: 403, headers: SEC_HEADERS });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return new NextResponse(null, { status: 400, headers: SEC_HEADERS });
  }

  const slug = String(form.get("slug") ?? request.nextUrl.searchParams.get("slug") ?? "")
    .trim()
    .toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return new NextResponse(null, { status: 404, headers: SEC_HEADERS });
  }

  const rawReturn = String(form.get("kembali") ?? `/${slug}`).trim();
  const safeReturn = redactedPublicPath(rawReturn, slug) ?? `/${slug}`;
  const choice = String(form.get("pilihan") ?? "").trim().toLowerCase();
  const proto = requestProtocol(request, env);
  const secure = proto === "https:";
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const redirectTarget = new URL(safeReturn, `${proto}//${host}`);

  if (choice === "cabut") {
    const resp = NextResponse.redirect(redirectTarget, {
      status: 303,
      headers: SEC_HEADERS,
    });
    // Per-tenant cookie path (Path=/{slug}) ensures Tenant A withdrawal never clears Tenant B's cookie.
    resp.headers.append("set-cookie", buildClearConsentCookieHeader(slug, secure));
    return resp;
  }

  if (choice !== "terima" && choice !== "tolak") {
    return new NextResponse(null, { status: 400, headers: SEC_HEADERS });
  }

  const secret = pixelConsentSecret(env);
  if (!secret) {
    // Missing secret must neither sign nor clear a cookie (no stale/misconfig response may erase a choice).
    return NextResponse.redirect(redirectTarget, {
      status: 303,
      headers: SEC_HEADERS,
    });
  }

  const db = deps?.db ?? (await (await import("../../../../../modules/org/context/store")).appPool());
  const resolved = await resolvePublicSiteBySlug(slug, db);
  if (resolved.state !== "published") {
    // Unpublished/unknown site must not emit a clearing Set-Cookie (prevents delayed stale response erasing a republished choice).
    return new NextResponse(null, { status: 404, headers: SEC_HEADERS });
  }

  const activeConfig = normalizeActivePixelConfig({
    metaPixelId: resolved.metaPixelId,
    gaMeasurementId: resolved.gaMeasurementId,
    revision: resolved.pixelConfigRevision,
  });
  if (!hasActivePixel(activeConfig)) {
    // Disabled pixels must not emit a clearing Set-Cookie (0139 revision invalidates old cookies; delayed response cannot erase a later re-enabled choice).
    return NextResponse.redirect(redirectTarget, {
      status: 303,
      headers: SEC_HEADERS,
    });
  }

  // Finding #1 (T-127 r3) + Finding #2 (T-127 r4): verify server-signed banner presentation token against live config
  // so a stale banner opened before pixel ID rotation cannot authorize the replacement pixel — AND reject without
  // mutating the cookie so a stale tab never erases a newer valid choice made in another tab!
  const presentationToken = String(form.get("t") ?? "").trim();
  if (
    !verifyBannerPresentationToken(secret, presentationToken, {
      slug: resolved.slug,
      config: activeConfig,
    })
  ) {
    return NextResponse.redirect(redirectTarget, {
      status: 303,
      headers: SEC_HEADERS,
    });
  }

  const signed = signPixelConsentCookie(secret, {
    slug: resolved.slug,
    config: activeConfig,
    choice,
  });

  const resp = NextResponse.redirect(redirectTarget, {
    status: 303,
    headers: SEC_HEADERS,
  });
  resp.headers.append("set-cookie", buildSetConsentCookieHeader(resolved.slug, signed, secure));
  return resp;
}
