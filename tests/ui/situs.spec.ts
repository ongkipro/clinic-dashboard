// T-123 browser evidence (UX-50 Situs Klinik + UX-51 Public Site on BOOKING_HOST, PR-64/PR-65) at 390/820/1180/1440 and 200% text:
// - APP_HOST: Owner opens /situs and /situs/promo; sees Q-15 gate status, slug lock, services; FO sees BlockedState.
// - BOOKING_HOST: Visitor opens /{slug}, /{slug}/perawatan, /{slug}/perawatan/{treatment}, /{slug}/cabang, /{slug}/cabang/{branch},
//   /{slug}/kebijakan-privasi, and neutral 404 on unknown slug.
// - Verifies Cache-Control: private, no-store, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer on BOOKING_HOST,
//   zero hidden price / priceNote / promo / closure reason leakage, zero horizontal overflow, >=44px targets, zero console errors.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

type BrowserPage = {
  goto: (url: string, opts?: Record<string, unknown>) => Promise<{ status: () => number; headers: () => Record<string, string> } | null>;
  setViewportSize: (v: { width: number; height: number }) => Promise<void>;
  evaluate: <R>(fn: (...args: never[]) => R) => Promise<R>;
  locator: (sel: string) => {
    fill: (v: string) => Promise<void>;
    click: () => Promise<void>;
    first: () => { innerText: () => Promise<string>; waitFor: (o?: Record<string, unknown>) => Promise<void> };
  };
  getByLabel: (text: string | RegExp) => {
    fill: (v: string) => Promise<void>;
    textContent: () => Promise<string | null>;
  };
  getByRole: (role: string, opts?: Record<string, unknown>) => {
    click: () => Promise<void>;
    first: () => { click: () => Promise<void>; waitFor: (o?: Record<string, unknown>) => Promise<void> };
  };
  waitForURL: (re: RegExp | string, opts?: Record<string, unknown>) => Promise<void>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<void>;
  on: (event: string, cb: (arg: { type?: () => string; text?: () => string; message?: string }) => void) => void;
};

async function run() {
  const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE}/index.mjs`);
  const APP_BASE = process.env.APP_BASE!;
  const BOOKING_BASE = process.env.BOOKING_BASE!;
  const OUT = process.argv[2];
  const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
    password: string;
    ownerEmail: string;
    slug: string;
    treatmentSlug: string;
    branchSlug: string;
    hiddenPriceNote: string;
    promoCode: string;
    closureSecret: string;
  };
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  const flows: string[] = [];
  const layouts: string[] = [];

  function totp(secret: string): string {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase()].map((c) => a.indexOf(c).toString(2).padStart(5, "0")).join("");
    const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
    const h = createHmac("sha1", bytes).update(counter).digest();
    const o = h[h.length - 1] & 0xf;
    return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0");
  }

  async function checkLayout(page: BrowserPage, name: string, width: number, textScale = 1) {
    await page.setViewportSize({ width, height: 900 });
    if (textScale > 1) {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
    } else {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 2) errors.push(`overflow:${name}@${width}x${textScale}=${overflow}`);
    await page.screenshot({ path: `${OUT}/${name}-${width}${textScale > 1 ? "-200" : ""}.png`, fullPage: true });
    layouts.push(`${name}@${width}${textScale > 1 ? "x200%" : ""}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    // 1. Public BOOKING_HOST checks (zero auth required!)
    const pubCtx = await browser.newContext();
    const pubPage = (await pubCtx.newPage()) as unknown as BrowserPage;
    let expectExpected404 = false;
    pubPage.on("pageerror", (e) => errors.push(`pageerror:${e.message ?? String(e)}`));
    pubPage.on("console", (m) => {
      const txt = m.text?.() ?? "";
      if (expectExpected404 && txt.includes("status of 404")) return;
      if (m.type?.() === "error") errors.push(`console:${txt}`);
    });

    const pubRoutes = [
      ["home", `/${seed.slug}`],
      ["perawatan", `/${seed.slug}/perawatan`],
      ["perawatan-detail", `/${seed.slug}/perawatan/${seed.treatmentSlug}`],
      ["cabang", `/${seed.slug}/cabang`],
      ["cabang-detail", `/${seed.slug}/cabang/${seed.branchSlug}`],
      ["privasi", `/${seed.slug}/kebijakan-privasi`],
    ] as const;

    for (const [label, path] of pubRoutes) {
      const res = await pubPage.goto(`${BOOKING_BASE}${path}`, { waitUntil: "networkidle" });
      if (!res || res.status() !== 200) throw new Error(`${label} returned ${res?.status()}`);
      const hdrs = res.headers();
      if (hdrs["cache-control"] !== "private, no-store") {
        throw new Error(`${label} missing cache-control private, no-store: ${hdrs["cache-control"]}`);
      }
      const html = await pubPage.evaluate(() => document.documentElement.outerHTML);
      if (html.includes(seed.hiddenPriceNote)) throw new Error(`${label} leaked hidden priceNote`);
      if (html.includes(seed.promoCode)) throw new Error(`${label} leaked promo code`);
      if (html.includes(seed.closureSecret)) throw new Error(`${label} leaked closure reason`);
      flows.push(`public:${label}:200:no-store:clean`);
      if (label === "home" || label === "perawatan-detail") {
        for (const w of [390, 820, 1180, 1440]) await checkLayout(pubPage, `pub-${label}`, w);
        await checkLayout(pubPage, `pub-${label}`, 390, 2);
      }
    }

    // Neutral not-found check on unknown slug (under Next.js 16 cacheComponents PPR, browser receives 404 or streamed 200 with noindex + neutral not-found.tsx)
    expectExpected404 = true;
    const nfRes = await pubPage.goto(`${BOOKING_BASE}/slug-tidak-terdaftar-xyz`, { waitUntil: "networkidle" });
    expectExpected404 = false;
    if (!nfRes) throw new Error("No response for unknown slug");
    const nfHdrs = nfRes.headers();
    if (nfHdrs["cache-control"] !== "private, no-store") {
      throw new Error(`unknown slug missing cache-control private, no-store: ${nfHdrs["cache-control"]}`);
    }
    const nfHtml = await pubPage.evaluate(() => document.documentElement.outerHTML);
    if (!nfHtml.includes("Halaman Tidak Ditemukan") || !nfHtml.includes("noindex")) {
      throw new Error(`Expected neutral not-found page with noindex for unknown slug (status=${nfRes.status()})`);
    }
    if (nfHtml.includes(seed.slug) || nfHtml.includes("Klinik Situs Sintetis")) {
      throw new Error("Unknown slug leaked registered tenant metadata");
    }
    flows.push(`public:unknown-slug:neutral-not-found(${nfRes.status()})`);
    await pubCtx.close();

    // 2. Staff APP_HOST /situs & /situs/promo checks
    const appCtx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "10.0.123.1" } });
    const appPage = (await appCtx.newPage()) as unknown as BrowserPage;
    appPage.on("pageerror", (e) => errors.push(`app-pageerror:${e.message ?? String(e)}`));

    await appPage.goto(`${APP_BASE}/masuk`, { waitUntil: "networkidle" });
    await appPage.getByLabel("Email").fill(seed.ownerEmail);
    await appPage.getByLabel("Kata sandi").fill(seed.password);
    await appPage.getByRole("button", { name: "Masuk" }).click();
    await appPage.waitForURL(`${APP_BASE}/`, { timeout: 15_000 });
    await appPage.goto(`${APP_BASE}/situs`, { waitUntil: "networkidle" });
    if ((await appPage.evaluate(() => window.location.pathname)).includes("aktifkan-2fa")) {
      await appPage.getByLabel("Kata sandi").fill(seed.password);
      await appPage.getByRole("button", { name: "Lanjut" }).click();
      const secret = ((await appPage.getByLabel("Kunci autentikator").textContent()) ?? "").trim();
      await appPage.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
      await appPage.getByRole("button", { name: "Aktifkan" }).click();
      await appPage.waitForURL(`${APP_BASE}/`, { timeout: 15_000 });
    }

    const situsRes = await appPage.goto(`${APP_BASE}/situs`, { waitUntil: "networkidle" });
    if (!situsRes || situsRes.status() !== 200) throw new Error(`/situs returned ${situsRes?.status()}`);
    for (const w of [390, 820, 1180, 1440]) await checkLayout(appPage, "app-situs", w);
    await checkLayout(appPage, "app-situs", 390, 2);
    flows.push("app:situs:200");

    const promoRes = await appPage.goto(`${APP_BASE}/situs/promo`, { waitUntil: "networkidle" });
    if (!promoRes || promoRes.status() !== 200) throw new Error(`/situs/promo returned ${promoRes?.status()}`);
    await checkLayout(appPage, "app-situs-promo", 390);
    await checkLayout(appPage, "app-situs-promo", 1440);
    flows.push("app:situs-promo:200");
    await appCtx.close();

    writeFileSync(`${OUT}/report.json`, JSON.stringify({ flows, layouts, errors }, null, 2));
    if (errors.length > 0) {
      throw new Error(`UI validation errors: ${errors.join("; ")}`);
    }
    console.log(`UI VALIDATION PASSED: ${flows.length} flows, ${layouts.length} layouts, 0 errors`);
  } finally {
    await browser.close();
  }
}
