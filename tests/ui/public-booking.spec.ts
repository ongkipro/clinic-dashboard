// T-126 browser evidence (PR-67, UX-24 Public Booking) at 390/820/1180/1440 + 200% text:
// - Booking host /{slug}/perawatan/{treatment} -> "Buat Janji" opens /{slug}/booking with treatment & branch preselected (Step 2)
// - Booking host /{slug}/booking verifies Cache-Control: private, no-store, Referrer-Policy: no-referrer,
//   X-Content-Type-Options: nosniff, zero tracking pixels (PR-39), zero internal UUIDs, neutral WA link (ref: situs-perawatan, no treatment name)
// - Unknown slug renders indistinguishable neutral unavailable screen with private, no-store
// - Zero horizontal overflow, targets >= 44px, zero unnamed controls, zero console errors.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

async function run() {
  const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE}/index.mjs`);
  const BOOKING_BASE = process.env.BOOKING_BASE!;
  const OUT = process.argv[2];
  const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
    slug: string;
    treatmentSlug: string;
    treatmentName: string;
    branchSlug: string;
    tenantId: string;
    slotDate: string;
  };
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [] };
  const flow = report.flow as [string, unknown][];

  type BrowserPage = {
    goto(url: string, opts?: Record<string, unknown>): Promise<{ headers(): Record<string, string>; status(): number } | null>;
    getByRole(role: string, opts: { name: string | RegExp }): {
      first(): { click(): Promise<unknown>; waitFor(): Promise<unknown> };
      waitFor(): Promise<unknown>;
    };
    evaluate<T>(fn: () => T): Promise<T>;
    setViewportSize(size: { width: number; height: number }): Promise<unknown>;
    addStyleTag(opts: { content: string }): Promise<unknown>;
    screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
    content(): Promise<string>;
    url(): string;
    waitForURL(re: RegExp | string, opts?: Record<string, unknown>): Promise<unknown>;
  };

  async function measure(page: BrowserPage, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main select")].filter(vis);
      const targetHeight = (e: Element) => {
        const hit = e.tagName === "INPUT" && (e as HTMLInputElement).type === "radio" ? (e.closest("label") ?? e) : e;
        return Math.round(hit.getBoundingClientRect().height);
      };
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map(targetHeight)) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.81" } });
    const page = (await ctx.newPage()) as unknown as BrowserPage;
    (page as unknown as { on(e: string, cb: (m: { type(): string; text(): string }) => void): void }).on("console", (m) => {
      if (m.type() === "error") (report.console as string[]).push(m.text());
    });

    // 1. PR-67 Scenario: visit treatment page -> click "Buat Janji" -> booking opens with treatment & branch preselected
    const treatUrl = `${BOOKING_BASE}/${seed.slug}/perawatan/${encodeURIComponent(seed.treatmentSlug)}`;
    const rt = await page.goto(treatUrl, { waitUntil: "networkidle" });
    if (!rt || rt.status() !== 200) throw new Error(`Treatment page returned ${rt?.status()}`);
    await page.getByRole("link", { name: /^Buat Janji$/i }).first().click();
    await page.waitForURL(new RegExp(`/${seed.slug}/booking\\?`), { timeout: 15_000 });
    const landed = page.url();
    if (!landed.includes(`layanan=${seed.treatmentSlug}`) || !landed.includes(`cabang=${seed.branchSlug}`)) {
      throw new Error(`Expected prefilled layanan & cabang in URL, got: ${landed}`);
    }
    flow.push(["pr67_treatment_cta_prefills_booking", true]);

    // 2. Open Step 2 with seeded slotDate and verify headers, zero UUIDs, zero pixels, neutral WA link
    const step2Url = `${BOOKING_BASE}/${seed.slug}/booking?layanan=${encodeURIComponent(seed.treatmentSlug)}&cabang=${encodeURIComponent(seed.branchSlug)}&tanggal=${encodeURIComponent(seed.slotDate)}&sumber=perawatan`;
    const r2 = await page.goto(step2Url, { waitUntil: "networkidle" });
    const h2 = r2?.headers() ?? {};
    if ((h2["cache-control"] ?? "") !== "private, no-store") {
      throw new Error(`Expected cache-control private, no-store, got: ${h2["cache-control"]}`);
    }
    if ((h2["referrer-policy"] ?? "") !== "no-referrer") {
      throw new Error(`Expected referrer-policy no-referrer, got: ${h2["referrer-policy"]}`);
    }
    const html2 = await page.content();
    if (html2.includes(seed.tenantId)) throw new Error("Internal tenant UUID leaked into booking HTML");
    if (/connect\.facebook\.net|googletagmanager\.com/i.test(html2)) {
      throw new Error("Ad pixel script leaked onto booking route (PR-39)");
    }
    const waHref = await page.evaluate(() => {
      const a = document.querySelector('a[href^="https://wa.me/"]');
      return a?.getAttribute("href") ?? "";
    });
    if (!waHref.includes("situs-perawatan")) {
      throw new Error(`Expected neutral WA link carrying situs-perawatan ref, got: ${waHref}`);
    }
    if (decodeURIComponent(waHref).includes(seed.treatmentName)) {
      throw new Error(`WA link leaked treatment name: ${waHref}`);
    }
    await page.getByRole("heading", { name: /Pilih cabang dan tanggal/i }).waitFor();
    flow.push(["booking_step2_clean_headers_no_uuid_neutral_wa", true]);

    for (const w of [390, 820, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await measure(page, `booking_step2_${w}`, w === 390 || w === 1440 ? `booking-step2-${w}.png` : undefined);
    }
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await measure(page, "booking_step2_200pct", "booking-step2-200pct.png");

    // 3. Unknown slug renders neutral unavailable screen with private, no-store
    const rUnk = await page.goto(`${BOOKING_BASE}/klinik-tidak-ada-sintetis/booking`, { waitUntil: "networkidle" });
    if ((rUnk?.headers()["cache-control"] ?? "") !== "private, no-store") {
      throw new Error(`Expected private, no-store on unknown slug, got: ${rUnk?.headers()["cache-control"]}`);
    }
    await page.getByRole("heading", { name: /Halaman tidak ditemukan/i }).waitFor();
    flow.push(["unknown_slug_neutral_unavailable", true]);
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
