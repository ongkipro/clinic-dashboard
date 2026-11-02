// T-012 browser evidence: the component gallery at 390/820/1180/1440 and 200% text on the
// DESIGN.md tokens; the sheet opens and closes by keyboard; accent validation shows the
// failing ratios and a suggestion. Runs only on request (needs `next dev`):
//   RUN_UI=1 BASE_URL=http://localhost:3912 PLAYWRIGHT_CORE=... node tests/ui/gallery.spec.ts out-dir
import { mkdirSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
  const BASE = process.env.BASE_URL ?? "http://localhost:3912";
  const OUT = process.argv[2] ?? "/tmp/t012ui";
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [] };
  const flow = report.flow as unknown[];
  const browser = await chromium.launch();
  try {
    for (const w of [390, 820, 1180, 1440]) {
      for (const zoom of [1, 2]) {
        const page = await browser.newPage({ viewport: { width: w, height: 900 } });
        // Playwright's screenshot injects caret-color on inputs, which React reports as a
        // hydration mismatch; only errors before any screenshot count.
        page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && !m.text().includes("caret-color") && (report.console as string[]).push(m.text().slice(0, 200)));
        await page.goto(`${BASE}/dev/galeri`);
        await page.getByRole("heading", { name: "Galeri Komponen" }).waitFor();
        if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        (report.layout as Record<string, unknown>)[`${w}${zoom === 2 ? "@200%" : ""}`] = await page.evaluate(() => {
          const ctl = [...document.querySelectorAll("main button, main input")];
          const cs = getComputedStyle(document.querySelector("main button")!);
          return {
            overflowX: document.documentElement.scrollWidth - innerWidth,
            minTarget: Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))),
            primaryHeight: Math.round(
              [...document.querySelectorAll("main button")].find((b) => b.textContent === "Terima Pembayaran")!.getBoundingClientRect().height,
            ),
            buttonBg: cs.backgroundColor,
            capsule: parseFloat(cs.borderRadius) >= 999,
            font: getComputedStyle(document.documentElement).fontFamily.split(",")[0],
            bodyPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
            lang: document.documentElement.lang,
            badgesWithIcon: [...document.querySelectorAll("[data-slot=status-badge]")].every((b) => b.querySelector("svg") && b.textContent!.trim()),
          };
        });
        if (zoom === 1 || w === 390) await page.screenshot({ path: `${OUT}/galeri-${w}${zoom === 2 ? "-200" : ""}.png`, fullPage: true });
        await page.close();
      }
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE}/dev/galeri`);
    await page.getByRole("button", { name: "Buka Lembar" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Ubah Jadwal" }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/galeri-sheet-390.png` });
    flow.push(["sheet opens by keyboard", true]);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    flow.push(["sheet closes with Escape, focus returns", await page.evaluate(() => document.activeElement?.textContent)]);
    flow.push(["accent failure shown", await page.getByRole("alert").filter({ hasText: "Kontras kurang" }).textContent()]);
    await page.getByLabel("Kode warna").fill("#0A6E86");
    flow.push(["accent ok", await page.getByText("Warna dapat dipakai.").isVisible()]);
    // Hover darkens the tint (never lighter).
    const btn = page.getByRole("button", { name: "Simpan" }).first();
    const before = await btn.evaluate((b: Element) => getComputedStyle(b).backgroundColor);
    await btn.hover();
    await page.waitForTimeout(250);
    const after = await btn.evaluate((b: Element) => getComputedStyle(b).backgroundColor);
    const lum = (c: string) => c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).reduce((a, v) => a + v, 0);
    flow.push(["hover darker", lum(after) < lum(before), before, after]);
    // Overlay has no blur.
    await page.getByRole("button", { name: "Buka Lembar" }).click();
    await page.getByRole("dialog").waitFor();
    flow.push(["overlay blur", await page.evaluate(() => getComputedStyle(document.querySelector("[data-vaul-overlay]")!).backdropFilter)]);
    flow.push(["sheet open animation", await page.evaluate(() => {
      const d = document.querySelector("[data-vaul-drawer]")!;
      const cs = getComputedStyle(d);
      return { name: cs.animationName, duration: cs.animationDuration, timing: cs.animationTimingFunction };
    })]);
    // Measure the real close time from the running animation.
    await page.keyboard.press("Escape");
    flow.push(["sheet close duration ms", await page.evaluate(() => {
      const a = document.querySelector("[data-vaul-drawer]")?.getAnimations()[0];
      return a ? Number((a.effect as KeyframeEffect).getComputedTiming().duration) : null;
    })]);
    await page.close();
    const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await reduced.goto(`${BASE}/dev/galeri`);
    await reduced.getByRole("button", { name: "Buka Lembar" }).click();
    await reduced.getByRole("dialog").waitFor();
    flow.push(["reduced motion", await reduced.evaluate(() => {
      const d = getComputedStyle(document.querySelector("[data-vaul-drawer]")!);
      return { transform: d.transform, animation: d.animationName, duration: d.animationDuration };
    })]);
    await reduced.close();
  } catch (e) {
    report.error = String(e).split("\n")[0];
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
