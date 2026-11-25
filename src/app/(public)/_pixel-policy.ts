// Public pixel policy, HMAC-bound consent cookie, single-authority CSP, and safe loader helpers (PR-39, UX-51; T-127 r2).
// Closes all 5 R3 review findings (t127/R3-REVIEW-r1-pi-sol.md):
// 1. Eligible ONLY on /{slug} (home) and /{slug}/cabang/{branch} (branch detail) — NEVER on /{slug}/cabang directory,
//    /perawatan, /dokter, /booking, /aftercare, or policy routes.
// 2. Fail-closed signing secret across ALL environments (zero hardcoded fallback secret anywhere).
// 3. Per-tenant cookie path scoping (Path=/{slug}) so Tenant A withdrawal or consent never affects Tenant B.
// 4. Single final Content-Security-Policy header in src/proxy.ts verified against live pixelConfigFingerprint when a
//    valid "terima" cookie is present (failing closed to strict 'self'-only CSP on rotation/unpublish/suspension).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { RESERVED_SEGMENTS } from "../../lib/hosts";
import { envOf } from "../../modules/platform/residency";

export const PIXEL_CONSENT_COOKIE = "cd_pub_consent";
export const PIXEL_POLICY_VERSION = "2026-11-v1";
export const PIXEL_CONSENT_TTL_SEC = 180 * 24 * 3600; // 180 days
export const PIXEL_BANNER_TOKEN_TTL_SEC = 3600; // 1 hour presentation token window

export type ConsentChoice = "terima" | "tolak";
export type VerifiedConsentState = "terima" | "tolak" | "unset";

export type ActivePixelConfig = {
  metaPixelId: string | null;
  gaMeasurementId: string | null;
  revision?: number;
};

export type EligiblePixelTarget =
  | { kind: "home"; slug: string }
  | { kind: "branch"; slug: string; branchSlug: string };

export type ProxyConsentedProviders = {
  meta: boolean;
  ga4: boolean;
  slug: string;
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DETAIL_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const META_ID_RE = /^[0-9]{8,20}$/;
const GA4_ID_RE = /^G-[A-Z0-9]{6,16}$/;
const LOOPBACK_ORIGIN_RE = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/;

export function normalizeActivePixelConfig(raw: {
  metaPixelId?: string | null;
  gaMeasurementId?: string | null;
  revision?: number | null;
}): ActivePixelConfig {
  const m = typeof raw.metaPixelId === "string" ? raw.metaPixelId.trim() : "";
  const g = typeof raw.gaMeasurementId === "string" ? raw.gaMeasurementId.trim() : "";
  const rev = typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 1 ? raw.revision : 1;
  return {
    metaPixelId: META_ID_RE.test(m) ? m : null,
    gaMeasurementId: GA4_ID_RE.test(g) ? g : null,
    revision: rev,
  };
}

export function hasActivePixel(cfg: ActivePixelConfig | null | undefined): cfg is ActivePixelConfig {
  return Boolean(cfg && (cfg.metaPixelId || cfg.gaMeasurementId));
}

export function pixelConfigFingerprint(cfg: ActivePixelConfig): string {
  const norm = normalizeActivePixelConfig(cfg);
  return createHash("sha256")
    .update(`rev:${norm.revision ?? 1}|meta:${norm.metaPixelId ?? ""}|ga4:${norm.gaMeasurementId ?? ""}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

// Fail closed in EVERY environment unless dedicated PIXEL_CONSENT_SECRET (>= 16 chars) is explicitly configured.
// Never falls back to BETTER_AUTH_SECRET or any hardcoded default (T-127 r3 Finding #5).
export function pixelConsentSecret(env: Partial<Record<string, string>> = process.env): string | null {
  const configured = (env.PIXEL_CONSENT_SECRET ?? "").trim();
  return configured.length >= 16 ? configured : null;
}

// Local HTTP stub origin allowed ONLY outside production for deterministic Playwright network-capture proof (zero live calls).
export function safeTestStubOrigin(env: Partial<Record<string, string>> = process.env): string | null {
  if (envOf(env.DEPLOY_ENV) === "production") return null;
  const raw = (env.PIXEL_TEST_STUB_ORIGIN ?? "").trim();
  return LOOPBACK_ORIGIN_RE.test(raw) ? raw : null;
}

function isPublicSlug(seg: string): boolean {
  return SLUG_RE.test(seg) && !RESERVED_SEGMENTS.has(seg);
}

// PR-39 strict allowlist: ONLY /{slug} (home) and /{slug}/cabang/{branch} (branch detail).
// Branch directory (/{slug}/cabang) and all health/booking/legal routes are excluded.
export function eligibleTargetFromPath(rawPath: string): EligiblePixelTarget | null {
  const pathOnly = rawPath.split(/[?#]/, 1)[0] ?? "";
  if (!pathOnly.startsWith("/")) return null;
  const seg = pathOnly.split("/").slice(1);
  if (seg.at(-1) === "") seg.pop();
  const slug = seg[0] ?? "";
  if (!isPublicSlug(slug)) return null;
  if (seg.length === 1) return { kind: "home", slug };
  if (seg.length === 3 && seg[1] === "cabang" && DETAIL_RE.test(seg[2])) {
    return { kind: "branch", slug, branchSlug: seg[2] };
  }
  return null;
}

export function eligibleSlugFromPath(rawPath: string): string | null {
  return eligibleTargetFromPath(rawPath)?.slug ?? null;
}

export function isPixelEligiblePath(rawPath: string, slug: string): boolean {
  return isPublicSlug(slug) && eligibleSlugFromPath(rawPath) === slug;
}

export function redactedPublicPath(rawPath: string, slug: string): string | null {
  if (!isPixelEligiblePath(rawPath, slug)) return null;
  const pathOnly = rawPath.split(/[?#]/, 1)[0] ?? "";
  const seg = pathOnly.split("/").slice(1);
  if (seg.at(-1) === "") seg.pop();
  return `/${seg.join("/")}`;
}

type ConsentClaims = {
  s: string; // tenant public slug (immutable post-first-publish per DEC-128)
  v: string; // policy version
  m: boolean; // meta enabled
  g: boolean; // ga4 enabled
  h: string; // pixelConfigFingerprint
  c: ConsentChoice;
  e: number; // unix epoch seconds expiry
};

function signB64(secret: string, bodyB64: string): string {
  return createHmac("sha256", secret).update(bodyB64, "utf8").digest("base64url");
}

export function signPixelConsentCookie(
  secret: string,
  input: {
    slug: string;
    config: ActivePixelConfig;
    choice: ConsentChoice;
    policyVersion?: string;
    nowMs?: number;
  },
): string {
  const norm = normalizeActivePixelConfig(input.config);
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const claims: ConsentClaims = {
    s: input.slug,
    v: input.policyVersion ?? PIXEL_POLICY_VERSION,
    m: Boolean(norm.metaPixelId),
    g: Boolean(norm.gaMeasurementId),
    h: pixelConfigFingerprint(norm),
    c: input.choice,
    e: nowSec + PIXEL_CONSENT_TTL_SEC,
  };
  const bodyB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = signB64(secret, bodyB64);
  return `${bodyB64}.${sig}`;
}

// Parse raw Cookie header manually so duplicate cookie names are explicitly detected and failed closed.
export function extractSingleCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const matches: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      matches.push(part.slice(idx + 1).trim());
    }
  }
  if (matches.length !== 1) return null;
  return matches[0] || null;
}

function parseVerifiedClaims(
  secret: string | null,
  cookieHeader: string | null | undefined,
  expectedSlug: string,
  policyVersion: string,
  nowMs: number,
): ConsentClaims | null {
  if (!secret) return null;
  const raw = extractSingleCookieValue(cookieHeader, PIXEL_CONSENT_COOKIE);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [bodyB64, sig] = parts;
  if (!bodyB64 || !sig) return null;

  const expectedSig = signB64(secret, bodyB64);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) return null;

  let claims: ConsentClaims;
  try {
    claims = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as ConsentClaims;
  } catch {
    return null;
  }

  const nowSec = Math.floor(nowMs / 1000);
  if (
    claims.s !== expectedSlug ||
    claims.v !== policyVersion ||
    typeof claims.m !== "boolean" ||
    typeof claims.g !== "boolean" ||
    typeof claims.h !== "string" ||
    (claims.c !== "terima" && claims.c !== "tolak") ||
    typeof claims.e !== "number" ||
    claims.e <= nowSec
  ) {
    return null;
  }
  return claims;
}

// Fast-path cookie verifier for src/proxy.ts: returns candidate consented providers ONLY when server-signed cookie
// verifies "terima" for this exact slug; src/proxy.ts then verifies live pixelConfigFingerprint before widening CSP.
export function verifyPixelConsentCookieForProxy(
  secret: string | null,
  cookieHeader: string | null | undefined,
  slug: string,
  nowMs = Date.now(),
): ProxyConsentedProviders | null {
  const claims = parseVerifiedClaims(secret, cookieHeader, slug, PIXEL_POLICY_VERSION, nowMs);
  if (!claims || claims.c !== "terima") return null;
  if (!claims.m && !claims.g) return null;
  return { meta: claims.m, ga4: claims.g, slug };
}

// Live-DB verifier for Server Components & src/proxy.ts: verifies signature, slug, policyVersion, expiry, AND live fingerprint.
export function verifyPixelConsentCookieForSite(
  secret: string | null,
  cookieHeader: string | null | undefined,
  expected: {
    slug: string;
    config: ActivePixelConfig;
    policyVersion?: string;
    nowMs?: number;
  },
): VerifiedConsentState {
  const norm = normalizeActivePixelConfig(expected.config);
  if (!hasActivePixel(norm)) return "unset";
  const claims = parseVerifiedClaims(
    secret,
    cookieHeader,
    expected.slug,
    expected.policyVersion ?? PIXEL_POLICY_VERSION,
    expected.nowMs ?? Date.now(),
  );
  if (!claims) return "unset";
  if (
    claims.m !== Boolean(norm.metaPixelId) ||
    claims.g !== Boolean(norm.gaMeasurementId) ||
    claims.h !== pixelConfigFingerprint(norm)
  ) {
    return "unset";
  }
  return claims.c;
}

type BannerPresentationClaims = {
  k: "banner";
  s: string;
  v: string;
  h: string;
  e: number;
};

// Domain-separated banner presentation token binding the rendered banner to exact (slug, policyVersion, pixelConfigFingerprint)
// so a stale banner opened before pixel ID rotation cannot authorize the replacement pixel (T-127 r3 Finding #1).
export function signBannerPresentationToken(
  secret: string,
  input: {
    slug: string;
    config: ActivePixelConfig;
    policyVersion?: string;
    nowMs?: number;
  },
): string {
  const norm = normalizeActivePixelConfig(input.config);
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const claims: BannerPresentationClaims = {
    k: "banner",
    s: input.slug,
    v: input.policyVersion ?? PIXEL_POLICY_VERSION,
    h: pixelConfigFingerprint(norm),
    e: nowSec + PIXEL_BANNER_TOKEN_TTL_SEC,
  };
  const bodyB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = signB64(secret, `banner:${bodyB64}`);
  return `${bodyB64}.${sig}`;
}

export function verifyBannerPresentationToken(
  secret: string | null,
  token: string | null | undefined,
  expected: {
    slug: string;
    config: ActivePixelConfig;
    policyVersion?: string;
    nowMs?: number;
  },
): boolean {
  if (!secret || !token) return false;
  const norm = normalizeActivePixelConfig(expected.config);
  if (!hasActivePixel(norm)) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [bodyB64, sig] = parts;
  if (!bodyB64 || !sig) return false;

  const expectedSig = signB64(secret, `banner:${bodyB64}`);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) return false;

  let claims: BannerPresentationClaims;
  try {
    claims = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as BannerPresentationClaims;
  } catch {
    return false;
  }
  const nowSec = Math.floor((expected.nowMs ?? Date.now()) / 1000);
  return (
    claims.k === "banner" &&
    claims.s === expected.slug &&
    claims.v === (expected.policyVersion ?? PIXEL_POLICY_VERSION) &&
    claims.h === pixelConfigFingerprint(norm) &&
    typeof claims.e === "number" &&
    claims.e > nowSec
  );
}

// Per-tenant cookie path scoping (Path=/{slug}) so Tenant A's cookie or withdrawal never crosses into Tenant B.
export function buildSetConsentCookieHeader(slug: string, value: string, secure = true): string {
  return [
    `${PIXEL_CONSENT_COOKIE}=${value}`,
    `Path=/${encodeURIComponent(slug)}`,
    `Max-Age=${PIXEL_CONSENT_TTL_SEC}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function buildClearConsentCookieHeader(slug: string, secure = true): string {
  return [
    `${PIXEL_CONSENT_COOKIE}=`,
    `Path=/${encodeURIComponent(slug)}`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

// Single final Content-Security-Policy authority for BOOKING_HOST.
export function publicBaseCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Strict connect-only widening: script-src NEVER allows any third-party host (zero third-party JS execution,
// zero Enhanced Measurement / click / scroll / SPA tracking, zero document.referrer read; T-127 r3 Finding #2).
export function publicConsentedPixelCsp(
  nonce: string,
  providers: Pick<ProxyConsentedProviders, "meta" | "ga4">,
  testStubOrigin?: string | null,
): string {
  const extraConnect = new Set<string>();

  if (testStubOrigin && LOOPBACK_ORIGIN_RE.test(testStubOrigin)) {
    extraConnect.add(testStubOrigin);
  } else {
    if (providers.meta) {
      extraConnect.add("https://www.facebook.com");
    }
    if (providers.ga4) {
      extraConnect.add("https://www.google-analytics.com");
    }
  }

  const join = (base: string, extra: Set<string>) =>
    extra.size > 0 ? `${base} ${[...extra].join(" ")}` : base;

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    join("connect-src 'self'", extraConnect),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Single CSP resolver called by src/proxy.ts for every BOOKING_HOST request.
// When liveConfig is supplied (or required by proxy), verifies pixelConfigFingerprint against live DB config;
// missing/rotated/unpublished configs fail closed to strict publicBaseCsp(nonce).
export function resolveBookingHostCsp(opts: {
  pathname: string;
  cookieHeader: string | null | undefined;
  nonce: string;
  env?: Partial<Record<string, string>>;
  nowMs?: number;
  liveConfig?: ActivePixelConfig | null;
}): { csp: string; consentedProviders: ProxyConsentedProviders | null } {
  const env = opts.env ?? process.env;
  const slug = eligibleSlugFromPath(opts.pathname);
  if (!slug) {
    return { csp: publicBaseCsp(opts.nonce), consentedProviders: null };
  }
  const secret = pixelConsentSecret(env);
  const providers = verifyPixelConsentCookieForProxy(secret, opts.cookieHeader, slug, opts.nowMs);
  if (!providers) {
    return { csp: publicBaseCsp(opts.nonce), consentedProviders: null };
  }
  if (opts.liveConfig !== undefined) {
    if (!opts.liveConfig) {
      return { csp: publicBaseCsp(opts.nonce), consentedProviders: null };
    }
    const verified = verifyPixelConsentCookieForSite(secret, opts.cookieHeader, {
      slug,
      config: opts.liveConfig,
      nowMs: opts.nowMs,
    });
    if (verified !== "terima") {
      return { csp: publicBaseCsp(opts.nonce), consentedProviders: null };
    }
  }
  return {
    csp: publicConsentedPixelCsp(opts.nonce, providers, safeTestStubOrigin(env)),
    consentedProviders: providers,
  };
}

// Build first-party allowlisted page-view beacon script (T-127 r3 Finding #2):
// 1. Scrubs query/fragment via history.replaceState; ABORTS with zero network calls if scrubbing throws or cannot be verified.
// 2. Never loads third-party JS (no fbevents.js / gtag.js -> Enhanced Measurement, click/scroll/SPA hooks, and document.referrer reads are impossible).
// 3. Emits ONLY explicit allowlisted PageView / page_view fetch beacons with credentials:"omit", referrerPolicy:"no-referrer", and empty rl=/dr=.
export function buildPixelInitScript(
  config: ActivePixelConfig,
  redactedPath: string,
  testStubOrigin?: string | null,
): string {
  const norm = normalizeActivePixelConfig(config);
  const safePath = JSON.stringify(redactedPath).replace(/</g, "\\u003c");
  const stub = testStubOrigin && LOOPBACK_ORIGIN_RE.test(testStubOrigin) ? testStubOrigin : null;
  const parts: string[] = [
    "(function(){",
    `var p=${safePath};`,
    "try{if(window.location.search||window.location.hash){window.history.replaceState(null,'',p);}}catch(_e){return;}",
    "if(window.location.pathname!==p||window.location.search||window.location.hash){return;}",
    "var dl=window.location.origin+p;",
    "var opts={mode:'no-cors',credentials:'omit',referrerPolicy:'no-referrer',keepalive:true};",
  ];

  if (norm.metaPixelId) {
    const base = JSON.stringify(stub ? `${stub}/meta/tr` : "https://www.facebook.com/tr");
    const id = JSON.stringify(norm.metaPixelId);
    parts.push(
      `var mq=new URLSearchParams({id:${id},ev:'PageView',dl:dl,rl:'',if:'false',nos:'1'});`,
      `window.fetch(${base}+'?'+mq.toString(),Object.assign({method:'GET'},opts)).catch(function(){});`,
    );
  }

  if (norm.gaMeasurementId) {
    const base = JSON.stringify(stub ? `${stub}/ga4/g/collect` : "https://www.google-analytics.com/g/collect");
    const id = JSON.stringify(norm.gaMeasurementId);
    parts.push(
      "var b=new Uint32Array(2);window.crypto.getRandomValues(b);var cid=String(b[0])+'.'+String(b[1]);",
      `var gq=new URLSearchParams({v:'2',tid:${id},cid:cid,en:'page_view',dl:dl,dr:'',dt:''});`,
      `window.fetch(${base}+'?'+gq.toString(),Object.assign({method:'POST'},opts)).catch(function(){});`,
    );
  }

  parts.push("})();");
  return parts.join("");
}
