// T-127 r2 Public Pixel Policy unit & HTTP/proxy tests (PR-39, UX-51, R3 Findings #1–#5).
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  PIXEL_CONSENT_COOKIE,
  buildClearConsentCookieHeader,
  buildPixelInitScript,
  buildSetConsentCookieHeader,
  eligibleSlugFromPath,
  eligibleTargetFromPath,
  isPixelEligiblePath,
  pixelConfigFingerprint,
  pixelConsentSecret,
  redactedPublicPath,
  resolveBookingHostCsp,
  safeTestStubOrigin,
  signBannerPresentationToken,
  signPixelConsentCookie,
  verifyBannerPresentationToken,
  verifyPixelConsentCookieForProxy,
  verifyPixelConsentCookieForSite,
} from "../../src/app/(public)/_pixel-policy";
import { handlePixelConsentPost } from "../../src/app/api/v1/public/pixel-consent/handler";
import { proxy } from "../../src/proxy";

const SECRET = "test-pixel-hmac-secret-32-bytes-minimum";
const META_ONLY = { metaPixelId: "123456789012345", gaMeasurementId: null };
const ROTATED_META = { metaPixelId: "999888777666555", gaMeasurementId: null };
const BOTH_PIXELS = { metaPixelId: "123456789012345", gaMeasurementId: "G-ABCDEF1234" };

describe("T-127 r2 public pixel policy (PR-39, R3 Findings #1–#5)", () => {
  it("Finding #1: allows pixels ONLY on home and branch detail — NEVER on /{slug}/cabang directory, health-intent, booking, or reserved routes", () => {
    expect(isPixelEligiblePath("/klinik-a", "klinik-a")).toBe(true);
    expect(isPixelEligiblePath("/klinik-a/", "klinik-a")).toBe(true);
    expect(isPixelEligiblePath("/klinik-a/cabang/senopati", "klinik-a")).toBe(true);
    expect(eligibleSlugFromPath("/klinik-a/cabang/senopati")).toBe("klinik-a");
    expect(redactedPublicPath("/klinik-a/cabang/senopati?keluhan=jerawat#top", "klinik-a")).toBe("/klinik-a/cabang/senopati");

    for (const forbidden of [
      "/klinik-a/cabang",
      "/klinik-a/cabang/",
      "/klinik-a/perawatan",
      "/klinik-a/perawatan/facial-oksigen",
      "/klinik-a/dokter",
      "/klinik-a/dokter/dr-sari",
      "/klinik-a/booking",
      "/klinik-a/kebijakan-privasi",
      "/klinik-a/syarat-ketentuan",
      "/klinik-a/kebijakan-pembatalan",
      "/aftercare/tok123",
      "/api/v1/public/pixel-consent",
      "/klinik-b/cabang/senopati",
    ]) {
      expect(isPixelEligiblePath(forbidden, "klinik-a"), forbidden).toBe(false);
      expect(redactedPublicPath(forbidden, "klinik-a"), forbidden).toBeNull();
    }
    expect(eligibleSlugFromPath("/klinik-a/cabang")).toBeNull();
    expect(eligibleSlugFromPath("/aftercare")).toBeNull();
    expect(eligibleSlugFromPath("/saya")).toBeNull();

    // Loader script scrubs query/fragment, ABORTS on failure, never loads third-party JS SDKs,
    // and sends ONLY explicit allowlisted PageView/page_view beacons with empty referrer!
    const script = buildPixelInitScript(BOTH_PIXELS, "/klinik-a/cabang/senopati");
    expect(script).toContain("window.history.replaceState(null,'',p)");
    expect(script).toContain("catch(_e){return;}");
    expect(script).toContain("if(window.location.pathname!==p||window.location.search||window.location.hash){return;}");
    expect(script).toContain("referrerPolicy:'no-referrer'");
    expect(script).toContain("credentials:'omit'");
    expect(script).toContain("ev:'PageView'");
    expect(script).toContain("en:'page_view'");
    expect(script).toContain("rl:''");
    expect(script).toContain("dr:''");
    expect(script).not.toContain("fbevents.js");
    expect(script).not.toContain("gtag/js");
    expect(script).not.toContain("document.referrer");
    expect(eligibleTargetFromPath("/klinik-a/cabang/senopati")).toEqual({
      kind: "branch",
      slug: "klinik-a",
      branchSlug: "senopati",
    });
    expect(eligibleTargetFromPath("/klinik-a")).toEqual({ kind: "home", slug: "klinik-a" });
    expect(eligibleTargetFromPath("/klinik-a/cabang")).toBeNull();
  });

  it("Finding #2: HMAC cookie binds slug, policy version, providers, and fingerprint; fails closed with zero hardcoded secret in ALL environments", () => {
    const now = Date.parse("2026-11-25T00:00:00Z");
    const signed = signPixelConsentCookie(SECRET, {
      slug: "klinik-a",
      config: META_ONLY,
      choice: "terima",
      nowMs: now,
    });
    const header = `${PIXEL_CONSENT_COOKIE}=${signed}`;

    expect(verifyPixelConsentCookieForSite(SECRET, header, { slug: "klinik-a", config: META_ONLY, nowMs: now + 60_000 })).toBe("terima");
    expect(verifyPixelConsentCookieForProxy(SECRET, header, "klinik-a", now + 60_000)).toEqual({
      meta: true,
      ga4: false,
      slug: "klinik-a",
    });

    // Cross-tenant, rotated ID, added provider, duplicate cookie, and expiry all fail closed
    expect(verifyPixelConsentCookieForSite(SECRET, header, { slug: "klinik-b", config: META_ONLY, nowMs: now + 60_000 })).toBe("unset");
    expect(verifyPixelConsentCookieForProxy(SECRET, header, "klinik-b", now + 60_000)).toBeNull();
    expect(verifyPixelConsentCookieForSite(SECRET, header, { slug: "klinik-a", config: ROTATED_META, nowMs: now + 60_000 })).toBe("unset");
    expect(pixelConfigFingerprint(META_ONLY)).not.toBe(pixelConfigFingerprint(BOTH_PIXELS));
    expect(verifyPixelConsentCookieForSite(SECRET, header, { slug: "klinik-a", config: BOTH_PIXELS, nowMs: now + 60_000 })).toBe("unset");
    expect(verifyPixelConsentCookieForSite(SECRET, `${header}; ${header}`, { slug: "klinik-a", config: META_ONLY, nowMs: now + 60_000 })).toBe("unset");
    expect(verifyPixelConsentCookieForSite(SECRET, header, { slug: "klinik-a", config: META_ONLY, nowMs: now + 200 * 24 * 3600 * 1000 })).toBe("unset");

    // Finding #2 & r3 Finding #5: Missing dedicated PIXEL_CONSENT_SECRET fails closed across ALL environments,
    // NEVER falling back to BETTER_AUTH_SECRET!
    for (const envName of ["production", "staging", "demo", "local", undefined]) {
      expect(pixelConsentSecret(envName ? { DEPLOY_ENV: envName } : {}), String(envName)).toBeNull();
      expect(
        pixelConsentSecret({
          ...(envName ? { DEPLOY_ENV: envName } : {}),
          BETTER_AUTH_SECRET: "auth-only-secret-that-must-not-sign-pixels-32b",
        }),
        `auth-only-${String(envName)}`,
      ).toBeNull();
    }
    expect(pixelConsentSecret({ DEPLOY_ENV: "staging", PIXEL_CONSENT_SECRET: "short" })).toBeNull();
    expect(pixelConsentSecret({ DEPLOY_ENV: "staging", PIXEL_CONSENT_SECRET: SECRET })).toBe(SECRET);

    // r4 Finding #1: A -> B -> A and disable -> re-enable advance pixelConfigRevision so old cookies & old banner tokens NEVER revive!
    const cfgRev1 = { ...META_ONLY, revision: 1 };
    const cfgRev3SameId = { ...META_ONLY, revision: 3 };
    expect(pixelConfigFingerprint(cfgRev1)).not.toBe(pixelConfigFingerprint(cfgRev3SameId));
    const cookieRev1 = `${PIXEL_CONSENT_COOKIE}=${signPixelConsentCookie(SECRET, { slug: "klinik-a", config: cfgRev1, choice: "terima", nowMs: now })}`;
    const bannerRev1 = signBannerPresentationToken(SECRET, { slug: "klinik-a", config: cfgRev1, nowMs: now });
    expect(verifyPixelConsentCookieForSite(SECRET, cookieRev1, { slug: "klinik-a", config: cfgRev1, nowMs: now + 60_000 })).toBe("terima");
    expect(verifyPixelConsentCookieForSite(SECRET, cookieRev1, { slug: "klinik-a", config: cfgRev3SameId, nowMs: now + 60_000 })).toBe("unset");
    expect(verifyBannerPresentationToken(SECRET, bannerRev1, { slug: "klinik-a", config: cfgRev3SameId, nowMs: now + 60_000 })).toBe(false);
    expect(
      resolveBookingHostCsp({
        pathname: "/klinik-a",
        cookieHeader: cookieRev1,
        nonce: "n123",
        env: { DEPLOY_ENV: "local", PIXEL_CONSENT_SECRET: SECRET },
        liveConfig: cfgRev3SameId,
        nowMs: now + 60_000,
      }).consentedProviders,
    ).toBeNull();

    // r3 Finding #1: Banner presentation token binds slug + policyVersion + fingerprint & rejects cross-purpose cookie reuse
    const bannerTok = signBannerPresentationToken(SECRET, { slug: "klinik-a", config: META_ONLY, nowMs: now });
    expect(verifyBannerPresentationToken(SECRET, bannerTok, { slug: "klinik-a", config: META_ONLY, nowMs: now + 60_000 })).toBe(true);
    expect(verifyBannerPresentationToken(SECRET, bannerTok, { slug: "klinik-a", config: ROTATED_META, nowMs: now + 60_000 })).toBe(false);
    expect(verifyBannerPresentationToken(SECRET, bannerTok, { slug: "klinik-b", config: META_ONLY, nowMs: now + 60_000 })).toBe(false);
    expect(verifyBannerPresentationToken(SECRET, signed, { slug: "klinik-a", config: META_ONLY, nowMs: now + 60_000 })).toBe(false);
    expect(verifyBannerPresentationToken(SECRET, bannerTok, { slug: "klinik-a", config: META_ONLY, nowMs: now + 4000_000 })).toBe(false);

    // Per-tenant cookie Path=/{slug}
    expect(buildSetConsentCookieHeader("klinik-a", signed, true)).toContain("Path=/klinik-a;");
    expect(buildClearConsentCookieHeader("klinik-a", true)).toContain("Path=/klinik-a;");

    expect(safeTestStubOrigin({ DEPLOY_ENV: "production", PIXEL_TEST_STUB_ORIGIN: "http://127.0.0.1:4555" })).toBeNull();
    expect(safeTestStubOrigin({ DEPLOY_ENV: "local", PIXEL_TEST_STUB_ORIGIN: "https://evil.example" })).toBeNull();
    expect(safeTestStubOrigin({ DEPLOY_ENV: "local", PIXEL_TEST_STUB_ORIGIN: "http://127.0.0.1:4555" })).toBe("http://127.0.0.1:4555");
  });

  it("Finding #3: single CSP authority restricts CSP on /{slug}/cabang, health routes, pixel ID rotation, and missing DB", async () => {
    const env = { DEPLOY_ENV: "local", PIXEL_CONSENT_SECRET: SECRET };
    const signedTerima = signPixelConsentCookie(SECRET, { slug: "klinik-a", config: META_ONLY, choice: "terima" });
    const signedTolak = signPixelConsentCookie(SECRET, { slug: "klinik-a", config: META_ONLY, choice: "tolak" });

    // Eligible home + verified terima + matching liveConfig -> unlocks connect-src Meta ONLY (never script-src!)
    const okHome = resolveBookingHostCsp({
      pathname: "/klinik-a",
      cookieHeader: `${PIXEL_CONSENT_COOKIE}=${signedTerima}`,
      nonce: "n123",
      env,
      liveConfig: META_ONLY,
    });
    expect(okHome.consentedProviders).toEqual({ meta: true, ga4: false, slug: "klinik-a" });
    expect(okHome.csp).toContain("connect-src 'self' https://www.facebook.com");
    expect(okHome.csp).toContain("script-src 'self' 'nonce-n123';");
    expect(okHome.csp).not.toContain("connect.facebook.net");
    expect(okHome.csp).not.toContain("googletagmanager.com");
    expect(okHome.csp).not.toContain("google-analytics.com");

    // Finding #3: Rotated liveConfig -> CSP fails closed to strict 'self'-only!
    const rotatedHome = resolveBookingHostCsp({
      pathname: "/klinik-a",
      cookieHeader: `${PIXEL_CONSENT_COOKIE}=${signedTerima}`,
      nonce: "n123",
      env,
      liveConfig: ROTATED_META,
    });
    expect(rotatedHome.consentedProviders).toBeNull();
    expect(rotatedHome.csp).not.toContain("facebook");

    // Unpublished/null liveConfig -> strict 'self'-only CSP!
    const unpubHome = resolveBookingHostCsp({
      pathname: "/klinik-a",
      cookieHeader: `${PIXEL_CONSENT_COOKIE}=${signedTerima}`,
      nonce: "n123",
      env,
      liveConfig: null,
    });
    expect(unpubHome.consentedProviders).toBeNull();
    expect(unpubHome.csp).not.toContain("facebook");

    // Branch directory + health routes EVEN WITH verified terima -> strict 'self'-only CSP!
    for (const forbidden of [
      "/klinik-a/cabang",
      "/klinik-a/perawatan/facial",
      "/klinik-a/dokter",
      "/klinik-a/booking",
      "/klinik-a/kebijakan-privasi",
      "/aftercare/tok",
    ]) {
      const res = resolveBookingHostCsp({
        pathname: forbidden,
        cookieHeader: `${PIXEL_CONSENT_COOKIE}=${signedTerima}`,
        nonce: "n123",
        env,
        liveConfig: META_ONLY,
      });
      expect(res.consentedProviders, forbidden).toBeNull();
      expect(res.csp, forbidden).not.toContain("facebook");
      expect(res.csp, forbidden).not.toContain("googletagmanager");
    }

    // Tolak or missing cookie on home -> strict 'self'-only CSP!
    for (const hdr of [null, `${PIXEL_CONSENT_COOKIE}=${signedTolak}`]) {
      const res = resolveBookingHostCsp({ pathname: "/klinik-a", cookieHeader: hdr, nonce: "n123", env, liveConfig: META_ONLY });
      expect(res.consentedProviders).toBeNull();
      expect(res.csp).not.toContain("facebook");
    }

    // Direct proxy() without APP_DATABASE_URL fails closed to strict 'self'-only CSP even with valid cookie!
    const prevEnv = {
      APP_HOST: process.env.APP_HOST,
      BOOKING_HOST: process.env.BOOKING_HOST,
      VENDOR_HOST: process.env.VENDOR_HOST,
      DEPLOY_ENV: process.env.DEPLOY_ENV,
      PIXEL_CONSENT_SECRET: process.env.PIXEL_CONSENT_SECRET,
      APP_DATABASE_URL: process.env.APP_DATABASE_URL,
    };
    try {
      process.env.APP_HOST = "app.test.local";
      process.env.BOOKING_HOST = "booking.test.local";
      process.env.VENDOR_HOST = "vendor.test.local";
      process.env.DEPLOY_ENV = "local";
      process.env.PIXEL_CONSENT_SECRET = SECRET;
      delete process.env.APP_DATABASE_URL;

      const rHomeNoDb = await proxy(
        new NextRequest("http://booking.test.local/klinik-a", {
          headers: { host: "booking.test.local", cookie: `${PIXEL_CONSENT_COOKIE}=${signedTerima}` },
        }),
      );
      expect(rHomeNoDb.headers.get("cache-control")).toBe("private, no-store");
      expect(rHomeNoDb.headers.get("cdn-cache-control")).toBe("no-store");
      expect(rHomeNoDb.headers.get("vary")).toBe("Cookie");
      expect(rHomeNoDb.headers.get("content-security-policy")).not.toContain("facebook");
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("Finding #4 & #5: POST enforces full Origin scheme+host equality (403 on http->https mismatch), Fetch Metadata, and per-tenant Path=/{slug} cookies", async () => {
    const localEnv = { DEPLOY_ENV: "local", PIXEL_CONSENT_SECRET: SECRET };
    const prodEnv = { DEPLOY_ENV: "production", PIXEL_CONSENT_SECRET: SECRET };

    // Cross-origin host -> 403
    const cross = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "https://evil.example" },
      }),
      { env: localEnv },
    );
    expect(cross.status).toBe(403);

    // Finding #4: Same host but http:// origin hitting https:// endpoint -> 403!
    const schemeMismatch = await handlePixelConsentPost(
      new NextRequest("https://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
      }),
      { env: prodEnv },
    );
    expect(schemeMismatch.status).toBe(403);

    // Finding #4: Matching origin header but Sec-Fetch-Site: cross-site -> 403!
    const fetchSiteCross = await handlePixelConsentPost(
      new NextRequest("https://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "https://booking.test.local", "sec-fetch-site": "cross-site" },
      }),
      { env: prodEnv },
    );
    expect(fetchSiteCross.status).toBe(403);

    // Origin: null with cross-site or absent Sec-Fetch-Site -> 403
    const nullMissing = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "null" },
      }),
      { env: localEnv },
    );
    expect(nullMissing.status).toBe(403);

    // Same-origin HTML form POST under Referrer-Policy: no-referrer (Origin: null + Sec-Fetch-Site: same-origin) -> 303
    const fdSameSite = new FormData();
    fdSameSite.set("slug", "klinik-a");
    fdSameSite.set("pilihan", "cabut");
    const nullSame = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "null", "sec-fetch-site": "same-origin" },
        body: fdSameSite,
      }),
      { env: localEnv },
    );
    expect(nullSame.status).toBe(303);

    // Finding #5: Withdrawal for klinik-a clears ONLY Path=/klinik-a (cannot touch klinik-b's Path=/klinik-b cookie!)
    const fd = new FormData();
    fd.set("slug", "klinik-a");
    fd.set("pilihan", "cabut");
    fd.set("kembali", "/klinik-lain/cabang/senopati?keluhan=jerawat");
    const withdraw = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: fd,
      }),
      { env: localEnv },
    );
    expect(withdraw.status).toBe(303);
    expect(new URL(withdraw.headers.get("location")!).pathname).toBe("/klinik-a");
    expect(new URL(withdraw.headers.get("location")!).search).toBe("");
    expect(withdraw.headers.get("set-cookie")).toContain(`${PIXEL_CONSENT_COOKIE}=; Path=/klinik-a; Max-Age=0`);
    expect(withdraw.headers.get("set-cookie")).not.toContain("Path=/;");
    expect(withdraw.headers.get("vary")).toBe("Cookie");
    expect(withdraw.headers.get("cdn-cache-control")).toBe("no-store");

    // Invalid choice -> 400
    const badFd = new FormData();
    badFd.set("slug", "klinik-a");
    badFd.set("pilihan", "sembarang");
    const badRes = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: badFd,
      }),
      { env: localEnv },
    );
    expect(badRes.status).toBe(400);

    // r3 Finding #1: Stale banner presentation token after pixel rotation issues NO consent cookie!
    const fakeDb = {
      query: async () => ({
        rows: [
          {
            res: {
              state: "published",
              slug: "klinik-a",
              version: 1,
              snapshot: {
                brand: "Klinik A",
                slug: "klinik-a",
                accent: null,
                heroPhoto: null,
                oneLine: null,
                sections: { treatments: true, branches: true, doctors: false },
                treatments: [],
                branches: [
                  {
                    slug: "senopati",
                    name: "Senopati",
                    address: "Jl. Senopati 1",
                    whatsapp: null,
                    hours: [],
                    closures: [],
                  },
                ],
                legalPages: { "kebijakan-privasi": "", "syarat-ketentuan": "", "kebijakan-pembatalan": "" },
                builtAt: "2026-11-25T00:00:00Z",
              },
              liveBranchSlugs: ["senopati"],
              liveClosures: [],
              metaPixelId: ROTATED_META.metaPixelId,
              gaMeasurementId: null,
            },
          },
        ],
      }),
    };
    const staleToken = signBannerPresentationToken(SECRET, { slug: "klinik-a", config: META_ONLY });
    const staleFd = new FormData();
    staleFd.set("slug", "klinik-a");
    staleFd.set("pilihan", "terima");
    staleFd.set("kembali", "/klinik-a");
    staleFd.set("t", staleToken);
    const staleRes = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: staleFd,
      }),
      { db: fakeDb as never, env: localEnv },
    );
    expect(staleRes.status).toBe(303);
    // r4 Finding #2: rejecting a stale banner MUST NOT mutate/clear an existing cookie from another fresh tab!
    expect(staleRes.headers.get("set-cookie")).toBeNull();

    // Fresh presentation token matching ROTATED_META signs consent cookie cleanly!
    const freshToken = signBannerPresentationToken(SECRET, { slug: "klinik-a", config: ROTATED_META });
    const freshFd = new FormData();
    freshFd.set("slug", "klinik-a");
    freshFd.set("pilihan", "terima");
    freshFd.set("kembali", "/klinik-a");
    freshFd.set("t", freshToken);
    const freshRes = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: freshFd,
      }),
      { db: fakeDb as never, env: localEnv },
    );
    expect(freshRes.status).toBe(303);
    const freshSetCookie = freshRes.headers.get("set-cookie") ?? "";
    expect(freshSetCookie).toContain("Path=/klinik-a;");
    expect(freshSetCookie).not.toContain("Max-Age=0");
    expect(
      verifyPixelConsentCookieForSite(SECRET, freshSetCookie.split(";", 1)[0], { slug: "klinik-a", config: ROTATED_META }),
    ).toBe("terima");

    // r3 Finding #5 + r5 Finding #2: BETTER_AUTH_SECRET alone without PIXEL_CONSENT_SECRET refuses to sign AND emits no Set-Cookie!
    const authOnlyRes = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: freshFd,
      }),
      {
        db: fakeDb as never,
        env: { DEPLOY_ENV: "local", BETTER_AUTH_SECRET: "auth-only-secret-that-must-not-sign-pixels-32b" },
      },
    );
    expect(authOnlyRes.status).toBe(303);
    expect(authOnlyRes.headers.get("set-cookie")).toBeNull();

    // r5 Finding #2: submitting an old banner while pixels are disabled OR site is unpublished MUST NOT emit a clearing Set-Cookie!
    const disabledDb = {
      query: async () => {
        const base = (await fakeDb.query()).rows[0].res;
        return {
          rows: [
            {
              res: {
                ...base,
                metaPixelId: null,
                gaMeasurementId: null,
                pixelConfigRevision: 3,
              },
            },
          ],
        };
      },
    };
    const disabledRes = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: freshFd,
      }),
      { db: disabledDb as never, env: localEnv },
    );
    expect(disabledRes.status).toBe(303);
    expect(disabledRes.headers.get("set-cookie")).toBeNull();

    const unpublishedDb = {
      query: async () => ({ rows: [{ res: { state: "unpublished" } }] }),
    };
    const unpublishedRes = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: freshFd,
      }),
      { db: unpublishedDb as never, env: localEnv },
    );
    expect(unpublishedRes.status).toBe(404);
    expect(unpublishedRes.headers.get("set-cookie")).toBeNull();
  });
});
