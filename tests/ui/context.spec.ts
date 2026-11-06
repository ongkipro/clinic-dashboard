// T-030 browser evidence (PR-84): Saya › Ganti Cabang / Ganti Peran / Ganti Klinik at
// 390/820/1180/1440 and 200% text; the active clinic, branch and role show under the
// title; each switch changes the shell and is recorded. Runs only on request (needs a
// running server and a seed):
//   RUN_UI=1 BASE_URL=... CONTEXT_SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/context.spec.ts out-dir
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
  const BASE = process.env.BASE_URL ?? "http://localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t030ui";
  const seed = JSON.parse(readFileSync(process.env.CONTEXT_SEED ?? `${OUT}/seed.json`, "utf8")) as { email: string };
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [] };
  const flow = report.flow as [string, unknown][];
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200)));
    await page.goto(`${BASE}/masuk`);
    await page.getByLabel("Email").fill(seed.email);
    await page.getByLabel("Kata sandi").fill("kuda-laut berenang 2026"); // synthetic
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${BASE}/`);
    const activeLine = async () => (await page.locator("main [data-slot=active-context]").innerText()).trim();
    const shellLine = async () => (await page.locator("header [data-slot=active-context]").innerText()).trim();

    for (const path of ["/saya/cabang", "/saya/peran", "/saya/klinik"]) {
      for (const w of [390, 820, 1180, 1440]) {
        for (const zoom of [1, 2]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${BASE}${path}`);
          await page.locator("main [data-slot=active-context]").waitFor();
          if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          (report.layout as Record<string, unknown>)[`${path}-${w}${zoom === 2 ? "@200%" : ""}`] = await page.evaluate(() => {
            const ctl = [...document.querySelectorAll("main button, main a")].filter((e) => e.getBoundingClientRect().height > 0);
            return {
              overflowX: document.documentElement.scrollWidth - innerWidth,
              minTarget: Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))),
              options: document.querySelectorAll("main form li").length,
              current: [...document.querySelectorAll('main form button[aria-current="true"]')].map((e) => e.textContent?.trim()),
            };
          });
          // Scrolled to the end, the last option is fully above the tab bar (compact).
          const last = page.locator("main form li").last();
          await last.scrollIntoViewIfNeeded();
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const covered = await page.evaluate(() => {
            const el = [...document.querySelectorAll("main form li")].at(-1)!.getBoundingClientRect();
            const bar = document.querySelector('nav[aria-label="Tab"]')!.getBoundingClientRect();
            return bar.height > 0 && el.bottom > bar.top + 0.5;
          });
          ((report.layout as Record<string, Record<string, unknown>>)[`${path}-${w}${zoom === 2 ? "@200%" : ""}`]).lastCovered = covered;
          if ((zoom === 1 && (w === 390 || w === 1180)) || (zoom === 2 && w === 390)) {
            await page.screenshot({ path: `${OUT}${path.replace("/saya", "")}-${w}${zoom === 2 ? "-200" : ""}.png`, fullPage: true });
          }
        }
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/saya/cabang`);
    flow.push(["start", await activeLine()]);
    await page.getByRole("button", { name: /^Cabang Senopati/ }).click();
    await page.waitForURL(`${BASE}/saya`);
    await page.goto(`${BASE}/saya/cabang`);
    flow.push(["after Ganti Cabang", await activeLine()]);
    flow.push(["shell shows branch", (await page.locator("header").innerText()).includes("Cabang Senopati")]);
    await page.goto(`${BASE}/saya/peran`);
    await page.getByRole("button", { name: /^Terapis/ }).click();
    await page.waitForURL(`${BASE}/saya`);
    await page.goto(`${BASE}/saya/peran`);
    flow.push(["after Ganti Peran", await activeLine()]);
    flow.push(["shell line", await shellLine()]);
    flow.push(["tabs follow the role", (await page.locator('nav[aria-label="Tab"]').innerText()).replace(/\s+/g, " ").trim()]);
    await page.goto(`${BASE}/saya/klinik`);
    await page.getByRole("button", { name: /^PT Klinik Bening Sintetis/ }).click();
    await page.waitForURL(`${BASE}/saya`);
    await page.goto(`${BASE}/saya/klinik`);
    flow.push(["after Ganti Klinik", await activeLine()]);
    await page.goto(`${BASE}/saya/peran`);
    await page.locator("main [data-slot=active-context]").waitFor();
    flow.push(["single role in the new clinic", await page.getByText("Anda hanya punya satu peran.").isVisible()]);
    // A forged selection cookie is replaced by a valid context, never trusted.
    await ctx.addCookies([{ name: "clinic_context", value: JSON.stringify({ t: "00000000-0000-7000-8000-000000000000", r: "owner", b: null }), url: BASE }]);
    await page.goto(`${BASE}/saya/cabang`);
    flow.push(["forged cookie falls back", await activeLine()]);
    await ctx.close();
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
    process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
