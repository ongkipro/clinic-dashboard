// DEL-2 cross-tenant negative case for T-127 /api/v1/public/pixel-consent#route (PR-39, R3 r3 Finding #4).
// Exercises the REAL handlePixelConsentPost() handler against real PostgreSQL with both tenants, asserting EACH
// invariant independently so any single regression (cookie reuse, wrong-path clear, missing actor path, or redirect escape)
// fails immediately, and the victim positive control is explicitly asserted.
import { NextRequest } from "next/server";
import {
  PIXEL_CONSENT_COOKIE,
  signBannerPresentationToken,
  verifyPixelConsentCookieForSite,
} from "../../../src/app/(public)/_pixel-policy";
import { handlePixelConsentPost } from "../../../src/app/api/v1/public/pixel-consent/handler";
import type { Json } from "../../../src/lib/command";
import { defineCases } from "../case";
import { ensurePublishedSiteSeed } from "./situs.cases";

const SECRET = "isolation-pixel-consent-secret-key-32b";
const PIXEL_CFG = { metaPixelId: "123456789012345", gaMeasurementId: null };
const TEST_ENV = { DEPLOY_ENV: "local", PIXEL_CONSENT_SECRET: SECRET };

export default defineCases({
  kind: "route",
  id: "/api/v1/public/pixel-consent#route",
  expect: "not-found",
  marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
  async run(env) {
    const v = await ensurePublishedSiteSeed(env, env.victim.tenantId, env.victim.branchId);
    const a = await ensurePublishedSiteSeed(env, env.actor.tenantId, env.actor.branchId);
    env.victimSecret(v.brandMarker);

    await env.owner.query(`update public_sites set meta_pixel_id = $2 where tenant_id in ($1, $3)`, [
      env.victim.tenantId,
      PIXEL_CFG.metaPixelId,
      env.actor.tenantId,
    ]);
    const revRows = (
      await env.owner.query<{ tenant_id: string; pixel_config_revision: number }>(
        `select tenant_id, pixel_config_revision from public_sites where tenant_id in ($1, $2)`,
        [env.victim.tenantId, env.actor.tenantId],
      )
    ).rows;
    const revByTenant = new Map(revRows.map((r) => [r.tenant_id, r.pixel_config_revision]));
    const vCfg = { ...PIXEL_CFG, revision: revByTenant.get(env.victim.tenantId) ?? 1 };
    const aCfg = { ...PIXEL_CFG, revision: revByTenant.get(env.actor.tenantId) ?? 1 };

    // 1. Positive control: issue real consent cookie for victim via real POST handler & verify independently
    const vFd = new FormData();
    vFd.set("slug", v.slug);
    vFd.set("pilihan", "terima");
    vFd.set("kembali", `/${v.slug}`);
    vFd.set("t", signBannerPresentationToken(SECRET, { slug: v.slug, config: vCfg }));
    const vPost = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: vFd,
      }),
      { db: env.app, env: TEST_ENV },
    );
    const victimSetCookie = vPost.headers.get("set-cookie") ?? "";
    const victimCookiePair = victimSetCookie.split(";", 1)[0] ?? "";
    const victimVerified =
      vPost.status === 303 &&
      victimSetCookie.includes(`Path=/${v.slug};`) &&
      victimCookiePair.startsWith(`${PIXEL_CONSENT_COOKIE}=`) &&
      verifyPixelConsentCookieForSite(SECRET, victimCookiePair, { slug: v.slug, config: vCfg }) === "terima";
    if (!victimVerified) {
      throw new Error(`Victim positive control failed: status=${vPost.status} set-cookie=${victimSetCookie}`);
    }

    // 2. Actor sends real withdrawal POST naming actor.slug while carrying victim's cookie and targeting victim's path:
    //    Set-Cookie MUST be scoped strictly to Path=/{actor.slug} and redirect MUST stay within /{actor.slug}.
    const wFd = new FormData();
    wFd.set("slug", a.slug);
    wFd.set("pilihan", "cabut");
    wFd.set("kembali", `/${v.slug}`);
    const wPost = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: {
          host: "booking.test.local",
          origin: "http://booking.test.local",
          cookie: victimCookiePair,
        },
        body: wFd,
      }),
      { db: env.app, env: TEST_ENV },
    );
    const clearLocation = wPost.headers.get("location") ?? "";
    const clearUrl = new URL(clearLocation);

    // 3. Actor sends real accept POST naming actor.slug; verify status, exact actor path, redirect origin+path,
    //    actor validity, AND that the resulting cookie NEVER authorizes victim's site or overwrites victim's path.
    const aFd = new FormData();
    aFd.set("slug", a.slug);
    aFd.set("pilihan", "terima");
    aFd.set("kembali", `/${v.slug}`);
    aFd.set("t", signBannerPresentationToken(SECRET, { slug: a.slug, config: aCfg }));
    const aPost = await handlePixelConsentPost(
      new NextRequest("http://booking.test.local/api/v1/public/pixel-consent", {
        method: "POST",
        headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        body: aFd,
      }),
      { db: env.app, env: TEST_ENV },
    );
    const actorSetCookie = aPost.headers.get("set-cookie") ?? "";
    const actorCookiePair = actorSetCookie.split(";", 1)[0] ?? "";
    const actorLocation = aPost.headers.get("location") ?? "";
    const actorUrl = new URL(actorLocation);
    const actorCookieValidOnActor =
      verifyPixelConsentCookieForSite(SECRET, actorCookiePair, { slug: a.slug, config: aCfg }) === "terima";
    const actorCookieValidOnVictim =
      verifyPixelConsentCookieForSite(SECRET, actorCookiePair, { slug: v.slug, config: vCfg }) === "terima";

    const exactSingleCookiePath = (resp: Response, expectedPath: string): boolean => {
      const headers = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
      const list = headers.length > 0 ? headers : [resp.headers.get("set-cookie") ?? ""].filter(Boolean);
      if (list.length !== 1) return false;
      const pathValues: string[] = [];
      for (const rawAttr of list[0].split(";").slice(1)) {
        const eq = rawAttr.indexOf("=");
        const name = (eq === -1 ? rawAttr : rawAttr.slice(0, eq)).trim().toLowerCase();
        if (name === "path") {
          pathValues.push(eq === -1 ? "" : rawAttr.slice(eq + 1).trim());
        }
      }
      return pathValues.length === 1 && pathValues[0] === expectedPath;
    };

    const sameTenantControl = env.actor.tenantId === env.victim.tenantId;
    if (sameTenantControl) {
      const ok =
        aPost.status === 303 &&
        wPost.status === 303 &&
        actorCookieValidOnVictim &&
        exactSingleCookiePath(aPost, `/${v.slug}`) &&
        exactSingleCookiePath(wPost, `/${v.slug}`) &&
        clearUrl.origin === "http://booking.test.local" &&
        clearUrl.pathname === `/${v.slug}` &&
        actorUrl.origin === "http://booking.test.local" &&
        actorUrl.pathname === `/${v.slug}`;
      return {
        status: ok ? 200 : 500,
        body: {
          actorSlug: a.slug,
          postStatus: aPost.status,
          sameTenantControl: true,
          brand: ok ? v.brandMarker : null,
        } as Json,
      };
    }

    // Cross-tenant: ANY SINGLE isolation breach fails immediately (independent OR checks, never AND)!
    const actorAcceptInvalid = aPost.status !== 303 || !actorCookieValidOnActor;
    const actorAcceptBadCookiePath = !exactSingleCookiePath(aPost, `/${a.slug}`);
    const actorAcceptRedirectEscaped =
      actorUrl.origin !== "http://booking.test.local" || actorUrl.pathname !== `/${a.slug}`;
    const withdrawBadCookiePath = !exactSingleCookiePath(wPost, `/${a.slug}`);
    const escapedToVictimRedirect =
      clearUrl.origin !== "http://booking.test.local" || clearUrl.pathname !== `/${a.slug}`;
    const breached =
      actorAcceptInvalid ||
      actorAcceptBadCookiePath ||
      actorAcceptRedirectEscaped ||
      actorCookieValidOnVictim ||
      withdrawBadCookiePath ||
      escapedToVictimRedirect;

    return {
      status: breached ? 200 : 404,
      body: {
        actorSlug: a.slug,
        postStatus: aPost.status,
        sameTenantControl: false,
        actorAcceptInvalid,
        actorAcceptBadCookiePath,
        actorAcceptRedirectEscaped,
        actorCookieValidOnVictim,
        withdrawBadCookiePath,
        escapedToVictimRedirect,
        brand: breached ? v.brandMarker : null,
      } as Json,
    };
  },
});
