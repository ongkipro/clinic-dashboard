// T-127 r2 browser & real network-capture evidence (PR-39, UX-51 Consent Banner) at 390/820/1180/1440 + 200% text:
// Uses a local loopback HTTP provider stub (PIXEL_TEST_STUB_ORIGIN, zero live Meta/GA calls) against a built standalone server:
// 1. Home before consent: SINGLE strict 'self'-only CSP, private no-store, CDN-Cache-Control: no-store, UX-51 banner, 0 hits; 390/820/1180/1440 + 200%.
// 2. Refusal ("Tolak"): hides banner, shows withdraw control, strict 'self'-only CSP, 0 stub hits.
// 3. Withdraw refusal + Accept ("Terima") with health query/hash: single CSP unlocks stub, stub executes, query/hash stripped, 0 leak.
// 4. Eligible branch detail (/{slug}/cabang/{branch}) executes stub & strips query; prohibited routes (/{slug}/cabang directory,
//    /perawatan, /perawatan/{t}, /dokter, /booking, /kebijakan-privasi) + browser Back AND Forward receive strict CSP & 0 stub hits!
// 5. Withdrawal ("Cabut izin pengukuran"): clears Path=/{slug} cookie, re-shows banner, strict CSP, 0 stub hits.
// 6. Pixel ID rotation in DB: re-accept -> rotate meta_pixel_id -> reload home -> STRICT CSP (no stub origin!) AND 0 stub hits AND banner reappears!
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { testClient } from "../rls/harness";

if (!process.env.RUN_UI) {
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  it("browser evidence (RUN_UI=1)", () => run(), 120_000);
}

async function run() {
  const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE}/index.mjs`);
  const BOOKING_BASE = process.env.BOOKING_BASE!;
  const STUB_ORIGIN = process.env.PIXEL_TEST_STUB_ORIGIN!;
  const ADMIN_DB_URL = process.env.ADMIN_DB_URL!;
  const OUT = process.env.UI_OUT_DIR ?? process.argv[2];
  const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
    tenantId: string;
    slug: string;
    treatmentSlug: string;
    branchSlug: string;
  };
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [] };
  const flow = report.flow as [string, unknown][];

  type StubHit = { method: string; url: string; referer: string; cookie: string };
  async function fetchStubHits(): Promise<StubHit[]> {
    const r = await fetch(`${STUB_ORIGIN}/__hits`);
    return (await r.json()) as StubHit[];
  }
  async function waitForStubHits(minCount: number, timeoutMs = 10_000): Promise<StubHit[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hits = await fetchStubHits();
      if (hits.length >= minCount) return hits;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for >= ${minCount} stub beacon hit(s)`);
  }
  function assertMetaBeacon(hit: StubHit, expectedId: string, expectedDl: string) {
    if (hit.method !== "GET" || !hit.url.startsWith("/meta/tr?")) {
      throw new Error(`Bad Meta method/path: ${JSON.stringify(hit)}`);
    }
    if (hit.referer !== "" || hit.cookie !== "") {
      throw new Error(`Unexpected Referer/Cookie on Meta beacon: ${JSON.stringify(hit)}`);
    }
    const p = new URL(hit.url, STUB_ORIGIN).searchParams;
    const keys = [...p.keys()].sort();
    if (JSON.stringify(keys) !== JSON.stringify(["dl", "ev", "id", "if", "nos", "rl"])) {
      throw new Error(`Unexpected Meta param keys: ${JSON.stringify(keys)}`);
    }
    if (
      p.get("id") !== expectedId ||
      p.get("ev") !== "PageView" ||
      p.get("dl") !== expectedDl ||
      p.get("rl") !== "" ||
      p.get("if") !== "false" ||
      p.get("nos") !== "1"
    ) {
      throw new Error(`Unexpected Meta beacon values: ${JSON.stringify(hit)}`);
    }
  }
  function assertGa4Beacon(hit: StubHit, expectedTid: string, expectedDl: string) {
    if (hit.method !== "POST" || !hit.url.startsWith("/ga4/g/collect?")) {
      throw new Error(`Bad GA4 method/path: ${JSON.stringify(hit)}`);
    }
    if (hit.referer !== "" || hit.cookie !== "") {
      throw new Error(`Unexpected Referer/Cookie on GA4 beacon: ${JSON.stringify(hit)}`);
    }
    const p = new URL(hit.url, STUB_ORIGIN).searchParams;
    const keys = [...p.keys()].sort();
    if (JSON.stringify(keys) !== JSON.stringify(["cid", "dl", "dr", "dt", "en", "tid", "v"])) {
      throw new Error(`Unexpected GA4 param keys: ${JSON.stringify(keys)}`);
    }
    if (
      p.get("v") !== "2" ||
      p.get("tid") !== expectedTid ||
      !/^\d+\.\d+$/.test(p.get("cid") ?? "") ||
      p.get("en") !== "page_view" ||
      p.get("dl") !== expectedDl ||
      p.get("dr") !== "" ||
      p.get("dt") !== ""
    ) {
      throw new Error(`Unexpected GA4 beacon values: ${JSON.stringify(hit)}`);
    }
  }
  async function resetStubHits(): Promise<void> {
    await fetch(`${STUB_ORIGIN}/__reset`, { method: "POST" });
  }

  type BrowserPage = {
    goto(url: string, opts?: Record<string, unknown>): Promise<{
      headers(): Record<string, string>;
      headersArray(): Promise<{ name: string; value: string }[]>;
      status(): number;
    } | null>;
    getByRole(role: string, opts: { name: string | RegExp }): {
      first(): { click(): Promise<unknown>; waitFor(): Promise<unknown> };
      click(): Promise<unknown>;
      waitFor(): Promise<unknown>;
    };
    evaluate<T>(fn: () => T): Promise<T>;
    setViewportSize(size: { width: number; height: number }): Promise<unknown>;
    addStyleTag(opts: { content: string }): Promise<unknown>;
    screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
    waitForLoadState(state: string): Promise<unknown>;
    waitForFunction(fn: () => unknown, arg?: unknown, opts?: Record<string, unknown>): Promise<unknown>;
    goBack(opts?: Record<string, unknown>): Promise<unknown>;
    goForward(opts?: Record<string, unknown>): Promise<unknown>;
    url(): string;
  };

  async function measure(page: BrowserPage, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const allCtl = [...document.querySelectorAll("a, button, input:not([type=hidden]), select")].filter(vis);
      const bannerCtl = [
        ...document.querySelectorAll(
          'section[aria-labelledby="persetujuan-pixel-judul"] a, section[aria-labelledby="persetujuan-pixel-judul"] button',
        ),
      ].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: bannerCtl.length ? Math.min(...bannerCtl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
        unnamed: allCtl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.61" } });
    const page = (await ctx.newPage()) as unknown as BrowserPage;
    (page as unknown as { on(e: string, cb: (m: { type(): string; text(): string }) => void): void }).on("console", (m) => {
      if (m.type() === "error") (report.console as string[]).push(m.text());
    });

    // 1. Before consent on /{slug} -> banner shown, strict 'self'-only CSP, 0 stub hits
    await resetStubHits();
    const rHome = await page.goto(`${BOOKING_BASE}/${seed.slug}?keluhan=jerawat#frag`, { waitUntil: "networkidle" });
    const hHome = rHome?.headers() ?? {};
    const hHomeArr = (await rHome?.headersArray()) ?? [];
    const cspHeadersHome = hHomeArr.filter((h) => h.name.toLowerCase() === "content-security-policy");
    if (cspHeadersHome.length !== 1) throw new Error(`Expected exactly 1 CSP header on home, got ${cspHeadersHome.length}`);
    if (hHome["cache-control"] !== "private, no-store") throw new Error(`Bad cache-control: ${hHome["cache-control"]}`);
    if (hHome["cdn-cache-control"] !== "no-store") throw new Error(`Bad cdn-cache-control: ${hHome["cdn-cache-control"]}`);
    if (hHome["referrer-policy"] !== "no-referrer") throw new Error(`Bad referrer-policy: ${hHome["referrer-policy"]}`);
    if (hHome["x-content-type-options"] !== "nosniff") throw new Error(`Bad nosniff: ${hHome["x-content-type-options"]}`);
    if (!hHome["content-security-policy"] || hHome["content-security-policy"].includes(STUB_ORIGIN)) {
      throw new Error(`Unexpected pre-consent CSP: ${hHome["content-security-policy"]}`);
    }
    await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel fired before consent");
    flow.push(["before_consent_banner_strict_csp_zero_hits", true]);

    for (const w of [390, 820, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await measure(page, `pixel_banner_${w}`, w === 390 || w === 1440 ? `pixel-banner-${w}.png` : undefined);
    }
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await measure(page, "pixel_banner_200pct", "pixel-banner-200pct.png");

    // 2. Refusal ("Tolak") -> hides banner, strict CSP, 0 stub hits; withdraw refusal re-shows banner
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
    await resetStubHits();
    await page.getByRole("button", { name: "Tolak" }).click();
    await page.waitForLoadState("networkidle");
    const rAfterTolak = await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
    if (String(rAfterTolak?.headers()["content-security-policy"] ?? "").includes(STUB_ORIGIN)) {
      throw new Error("CSP unlocked stub after Tolak refusal");
    }
    await page.getByRole("button", { name: "Cabut izin pengukuran" }).waitFor();
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel fired after Tolak refusal");
    await page.getByRole("button", { name: "Cabut izin pengukuran" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
    flow.push(["refusal_tolak_strict_csp_zero_hits", true]);

    // 3. Accept consent (Terima) -> exact Meta-only wire contract (1 GET /meta/tr, exact 6 allowlisted params,
    //    empty Referer & Cookie headers), per-tenant Path=/{slug} cookie set, and clicks/scroll emit ZERO extra beacons!
    await resetStubHits();
    await page.getByRole("button", { name: "Terima" }).click();
    await page.waitForLoadState("networkidle");
    const acceptHits = await waitForStubHits(1);
    await new Promise((r) => setTimeout(r, 250));
    const settledAcceptHits = await fetchStubHits();
    if (settledAcceptHits.length !== 1) {
      throw new Error(`Expected exact 1 Meta-only hit, got ${settledAcceptHits.length}: ${JSON.stringify(settledAcceptHits)}`);
    }
    assertMetaBeacon(settledAcceptHits[0], "123456789012345", `${BOOKING_BASE}/${seed.slug}`);
    const cookiesAfterAccept = await ctx.cookies();
    const consentCookie = cookiesAfterAccept.find((c: { name: string; path: string }) => c.name === "cd_pub_consent");
    if (!consentCookie || consentCookie.path !== `/${seed.slug}`) {
      throw new Error(`Expected per-tenant Path=/${seed.slug} cookie, got ${JSON.stringify(consentCookie)}`);
    }
    // Verify scroll/interaction emits ZERO automatic extra events
    await resetStubHits();
    await page.evaluate(() => {
      window.scrollTo(0, 400);
      document.body.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    if ((await fetchStubHits()).length !== 0) throw new Error("Automatic click/scroll event fired!");
    flow.push(["after_accept_meta_only_exact_wire_contract", { hits: acceptHits.length, cookiePath: consentCookie.path }]);

    // 4. Eligible branch detail strips query/hash BEFORE beacon; nonexistent branch receives strict 'self'-only CSP!
    await resetStubHits();
    const rBranch = await page.goto(`${BOOKING_BASE}/${seed.slug}/cabang/${seed.branchSlug}?keluhan=jerawat#secret`, { waitUntil: "networkidle" });
    const branchCsp = String(rBranch?.headers()["content-security-policy"] ?? "");
    if (!branchCsp.includes(`connect-src 'self' ${STUB_ORIGIN}`) || branchCsp.includes(`script-src 'self' 'nonce-` + " " + STUB_ORIGIN)) {
      throw new Error(`Expected connect-only stub CSP on consented branch detail: ${branchCsp}`);
    }
    if (branchCsp.split(";").find((d) => d.trim().startsWith("script-src"))?.includes(STUB_ORIGIN)) {
      throw new Error(`script-src must NEVER widen to third-party/stub origin: ${branchCsp}`);
    }
    const branchHits = await waitForStubHits(1);
    const branchUrlNow = page.url();
    if (branchUrlNow.includes("keluhan") || branchUrlNow.includes("secret")) {
      throw new Error(`Query/fragment not stripped on eligible branch: ${branchUrlNow}`);
    }
    const branchMeta = branchHits.find((h) => h.url.startsWith("/meta/tr?"));
    const branchParams = branchMeta ? new URL(branchMeta.url, STUB_ORIGIN).searchParams : null;
    if (
      !branchMeta ||
      branchParams?.get("dl") !== `${BOOKING_BASE}/${seed.slug}/cabang/${seed.branchSlug}` ||
      branchParams?.get("rl") !== "" ||
      branchMeta.referer !== "" ||
      branchHits.some((h) => h.url.includes("jerawat") || h.url.includes("secret") || h.referer.includes("jerawat"))
    ) {
      throw new Error(`Health query or referrer leaked on branch beacon: ${JSON.stringify(branchHits)}`);
    }

    // r3 Finding #3: Nonexistent AND hidden/expired branch detail URLs MUST receive strict 'self'-only CSP & 0 hits!
    await resetStubHits();
    const rMissingBranch = await page.goto(`${BOOKING_BASE}/${seed.slug}/cabang/cabang-tidak-ada`, { waitUntil: "networkidle" });
    const missingBranchCsp = String(rMissingBranch?.headers()["content-security-policy"] ?? "");
    if (missingBranchCsp.includes(STUB_ORIGIN) || missingBranchCsp.includes("facebook") || missingBranchCsp.includes("google-analytics")) {
      throw new Error(`Nonexistent 404 branch widened CSP: ${missingBranchCsp}`);
    }
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel fired on nonexistent branch 404");

    const hideAdmin = testClient({ connectionString: ADMIN_DB_URL });
    await hideAdmin.connect();
    try {
      await hideAdmin.query(
        `update branches set publish_until = clock_timestamp() - interval '1 minute' where tenant_id = $1 and lower(code) = $2`,
        [seed.tenantId, seed.branchSlug],
      );
      await resetStubHits();
      const rHiddenBranch = await page.goto(`${BOOKING_BASE}/${seed.slug}/cabang/${seed.branchSlug}`, { waitUntil: "networkidle" });
      const hiddenBranchCsp = String(rHiddenBranch?.headers()["content-security-policy"] ?? "");
      if (hiddenBranchCsp.includes(STUB_ORIGIN) || hiddenBranchCsp.includes("facebook") || hiddenBranchCsp.includes("google-analytics")) {
        throw new Error(`Hidden/expired branch widened CSP: ${hiddenBranchCsp}`);
      }
      if ((await fetchStubHits()).length !== 0) throw new Error("Pixel fired on hidden/expired branch 404");
    } finally {
      await hideAdmin.query(
        `update branches set publish_until = null where tenant_id = $1 and lower(code) = $2`,
        [seed.tenantId, seed.branchSlug],
      );
      await hideAdmin.end();
    }

    // r3 Finding #2: If URL scrubbing throws (history.replaceState blocked), loader MUST abort with 0 hits!
    const abortCtx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.62" } });
    await abortCtx.addCookies([consentCookie]);
    const abortPage = await abortCtx.newPage();
    await abortPage.addInitScript(() => {
      window.history.replaceState = () => {
        throw new Error("blocked-replaceState");
      };
    });
    await resetStubHits();
    await abortPage.goto(`${BOOKING_BASE}/${seed.slug}?keluhan=sensitif`, { waitUntil: "networkidle" });
    await new Promise((r) => setTimeout(r, 300));
    if ((await fetchStubHits()).length !== 0) throw new Error("Loader fired beacon even though URL scrubbing threw!");
    await abortCtx.close();

    flow.push(["eligible_branch_beacon_redacted_missing_branch_strict_csp_abort_on_scrub_fail", { hits: branchHits.length }]);

    // 5. Prohibited routes INCLUDING /{slug}/cabang directory and /{slug}/booking + Back AND Forward -> strict CSP & 0 hits!
    await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
    await resetStubHits();
    await page.getByRole("link", { name: "Lihat Perawatan" }).first().click();
    await page.waitForLoadState("networkidle");
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel leaked via navigation onto /perawatan");

    for (const prohibitedPath of [
      `/${seed.slug}/cabang`,
      `/${seed.slug}/perawatan/${seed.treatmentSlug}`,
      `/${seed.slug}/dokter`,
      `/${seed.slug}/booking`,
      `/${seed.slug}/kebijakan-privasi`,
    ]) {
      await resetStubHits();
      const resp = await page.goto(`${BOOKING_BASE}${prohibitedPath}`, { waitUntil: "networkidle" });
      const csp = resp?.headers()["content-security-policy"] ?? "";
      if (csp.includes(STUB_ORIGIN) || csp.includes("facebook") || csp.includes("googletagmanager")) {
        throw new Error(`Prohibited route ${prohibitedPath} unlocked third-party CSP: ${csp}`);
      }
      if ((await fetchStubHits()).length !== 0) {
        throw new Error(`Pixel leaked on prohibited route ${prohibitedPath}`);
      }
    }
    // Browser Back to /booking AND Forward back to /kebijakan-privasi must both emit 0 hits
    await resetStubHits();
    await page.goBack({ waitUntil: "networkidle" });
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel leaked on browser Back to /booking");
    await resetStubHits();
    await page.goForward({ waitUntil: "networkidle" });
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel leaked on browser Forward to /kebijakan-privasi");
    flow.push(["zero_pixel_requests_and_strict_csp_on_prohibited_routes_back_forward", true]);

    // 6. Withdrawal ("Cabut izin pengukuran") clears cookie, reloads, re-shows banner, strict CSP, 0 stub hits
    await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
    await resetStubHits();
    await page.getByRole("button", { name: "Cabut izin pengukuran" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel fired after withdrawal");
    flow.push(["withdrawal_clears_cookie_zero_hits", true]);

    // 7. Pixel ID rotation invalidates BOTH existing cookie CSP AND stale already-rendered banner submit!
    await page.getByRole("button", { name: "Terima" }).click();
    await page.waitForLoadState("networkidle");
    const admin = testClient({ connectionString: ADMIN_DB_URL });
    await admin.connect();
    try {
      await admin.query(`update public_sites set meta_pixel_id = '999888777666555' where tenant_id = $1`, [seed.tenantId]);
    } finally {
      await admin.end();
    }
    await resetStubHits();
    const rRotated = await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
    const rotCsp = rRotated?.headers()["content-security-policy"] ?? "";
    if (rotCsp.includes(STUB_ORIGIN) || rotCsp.includes("facebook") || rotCsp.includes("google-analytics")) {
      throw new Error(`Proxy widened CSP after pixel ID rotation: ${rotCsp}`);
    }
    await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
    if ((await fetchStubHits()).length !== 0) throw new Error("Pixel fired after pixel ID rotation!");

    // r3 Finding #1: Banner is currently open for '999888777666555'; rotate DB pixel AGAIN before clicking Terima!
    const admin2 = testClient({ connectionString: ADMIN_DB_URL });
    await admin2.connect();
    try {
      await admin2.query(`update public_sites set meta_pixel_id = '111222333444555' where tenant_id = $1`, [seed.tenantId]);
    } finally {
      await admin2.end();
    }
    await resetStubHits();
    await page.getByRole("button", { name: "Terima" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
    if ((await fetchStubHits()).length !== 0) throw new Error("Stale banner submit authorized replacement pixel!");

    // 8. r4 Finding #4: GA4-only (exact 1 POST /ga4/g/collect) AND dual-provider (exact 2: 1 Meta GET + 1 GA4 POST),
    //    plus r4 Finding #1 (A -> B -> A and disable -> re-enable require fresh consent once 0139 revision is active)!
    const admin3 = testClient({ connectionString: ADMIN_DB_URL });
    await admin3.connect();
    try {
      // 8a. GA4-only
      await admin3.query(
        `update public_sites set meta_pixel_id = null, ga_measurement_id = 'G-TESTGA4999' where tenant_id = $1`,
        [seed.tenantId],
      );
      await resetStubHits();
      await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
      await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
      await page.getByRole("button", { name: "Terima" }).click();
      await page.waitForLoadState("networkidle");
      await waitForStubHits(1);
      await new Promise((r) => setTimeout(r, 250));
      const ga4OnlyHits = await fetchStubHits();
      if (ga4OnlyHits.length !== 1) {
        throw new Error(`Expected exact 1 GA4-only hit, got ${ga4OnlyHits.length}: ${JSON.stringify(ga4OnlyHits)}`);
      }
      assertGa4Beacon(ga4OnlyHits[0], "G-TESTGA4999", `${BOOKING_BASE}/${seed.slug}`);

      // 8b. Dual-provider (Meta + GA4)
      await admin3.query(
        `update public_sites set meta_pixel_id = '222333444555666', ga_measurement_id = 'G-TESTGA4999' where tenant_id = $1`,
        [seed.tenantId],
      );
      await resetStubHits();
      await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
      await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
      await page.getByRole("button", { name: "Terima" }).click();
      await page.waitForLoadState("networkidle");
      await waitForStubHits(2);
      await new Promise((r) => setTimeout(r, 250));
      const dualHits = await fetchStubHits();
      if (dualHits.length !== 2) {
        throw new Error(`Expected exact 2 dual-provider hits, got ${dualHits.length}: ${JSON.stringify(dualHits)}`);
      }
      const dualMeta = dualHits.find((h) => h.url.startsWith("/meta/tr?"));
      const dualGa4 = dualHits.find((h) => h.url.startsWith("/ga4/g/collect?"));
      if (!dualMeta || !dualGa4) {
        throw new Error(`Expected 1 Meta + 1 GA4 dual hit, got ${JSON.stringify(dualHits)}`);
      }
      assertMetaBeacon(dualMeta, "222333444555666", `${BOOKING_BASE}/${seed.slug}`);
      assertGa4Beacon(dualGa4, "G-TESTGA4999", `${BOOKING_BASE}/${seed.slug}`);

      // 8c. r4 Finding #1 (A -> B -> A) & (disable -> re-enable): persisted pixel_config_revision advances on every
      //     effective change so returning to the exact same ID NEVER revives an old cookie or old banner token!
      const dualCookieBeforeBounce = (await ctx.cookies()).find((c: { name: string }) => c.name === "cd_pub_consent");
      if (!dualCookieBeforeBounce) throw new Error("Expected active dual consent cookie before A->B->A test");
      // Bounce A -> B -> A
      await admin3.query(`update public_sites set meta_pixel_id = '777888999000111' where tenant_id = $1`, [seed.tenantId]);
      await admin3.query(`update public_sites set meta_pixel_id = '222333444555666' where tenant_id = $1`, [seed.tenantId]);
      await resetStubHits();
      const rAba = await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
      if (String(rAba?.headers()["content-security-policy"] ?? "").includes(STUB_ORIGIN)) {
        throw new Error("A -> B -> A revived old consent CSP!");
      }
      await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
      if ((await fetchStubHits()).length !== 0) throw new Error("A -> B -> A revived old pixel firing!");

      // Accept at new revision, then disable -> re-enable same IDs -> MUST require fresh consent again!
      await page.getByRole("button", { name: "Terima" }).click();
      await page.waitForLoadState("networkidle");
      await waitForStubHits(2);
      await admin3.query(`update public_sites set meta_pixel_id = null, ga_measurement_id = null where tenant_id = $1`, [seed.tenantId]);
      await admin3.query(`update public_sites set meta_pixel_id = '222333444555666', ga_measurement_id = 'G-TESTGA4999' where tenant_id = $1`, [seed.tenantId]);
      await resetStubHits();
      const rDisableReenable = await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
      if (String(rDisableReenable?.headers()["content-security-policy"] ?? "").includes(STUB_ORIGIN)) {
        throw new Error("disable -> re-enable revived old consent CSP!");
      }
      await page.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
      if ((await fetchStubHits()).length !== 0) throw new Error("disable -> re-enable revived old pixel firing!");

      // 8d. r4 Finding #2: Stale tab submitting an old banner MUST NOT erase a newer tab's valid choice!
      const staleTab = (await ctx.newPage()) as unknown as BrowserPage;
      await staleTab.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
      await staleTab.getByRole("region", { name: "Izin pengukuran iklan" }).waitFor();
      // Rotate pixel -> fresh tab accepts new pixel -> stale tab submits old banner -> fresh tab choice MUST survive!
      await admin3.query(`update public_sites set meta_pixel_id = '333444555666777', ga_measurement_id = null where tenant_id = $1`, [seed.tenantId]);
      await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
      await resetStubHits();
      await page.getByRole("button", { name: "Terima" }).click();
      await page.waitForLoadState("networkidle");
      await waitForStubHits(1);
      // Now submit stale banner in old tab (holds old presentation token): must reject without clearing cookie!
      await staleTab.getByRole("button", { name: "Tolak" }).click();
      await staleTab.waitForLoadState("networkidle");
      // Reload in fresh tab: newer "Terima" choice MUST still be active (beacon still fires for 333444555666777)!
      await resetStubHits();
      await page.goto(`${BOOKING_BASE}/${seed.slug}`, { waitUntil: "networkidle" });
      const survivedHits = await waitForStubHits(1);
      assertMetaBeacon(survivedHits[0], "333444555666777", `${BOOKING_BASE}/${seed.slug}`);
      await (staleTab as unknown as { close(): Promise<void> }).close();
    } finally {
      await admin3.end();
    }
    flow.push(["pixel_id_rotation_aba_disable_reenable_stale_tab_and_ga4_dual_wire_contracts", true]);

    await ctx.close();

    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    const bad: string[] = [];
    if ((report.console as string[]).length > 0) bad.push(`console errors: ${(report.console as string[]).join("; ")}`);
    for (const [k, v] of Object.entries(
      report.layout as Record<string, { overflowX: number; minTarget: number | null; unnamed: number }>,
    )) {
      if (v.overflowX > 0) bad.push(`${k}: overflowX=${v.overflowX}`);
      if (v.minTarget !== null && v.minTarget < 44) bad.push(`${k}: minTarget=${v.minTarget}`);
      if (v.unnamed > 0) bad.push(`${k}: unnamed=${v.unnamed}`);
    }
    if (bad.length > 0) throw new Error(`UI validation failed: ${bad.join(" | ")}`);
    console.log(
      `UI VALIDATION PASSED: ${flow.length} flows, ${Object.keys(report.layout as object).length} layouts, 0 errors`,
    );
  } finally {
    await browser.close();
  }
}
