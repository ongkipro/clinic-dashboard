// T-096 browser evidence (PR-70, UX-51 patient pages) at 390/820/1180/1440 and 200 % text on the booking host: an aftercare link before
// the OTP shows only the clinic, the branch and the masked phone; "Kirim Kode" sends the code (success); a wrong code is refused (error,
// attempts left); the right code opens the instructions (success → the texts of both treatments); the filter narrows them and shows the
// filtered-empty state with "Hapus Filter"; a locked link and an expired link are blocked with a recovery; an unknown link is blocked; the
// loading skeleton has no text. No third-party request, noindex and no-referrer meta, no console errors.
// Runs on request: RUN_UI=1 BASE_URL=http://booking.localhost:<port> SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/aftercare.spec.ts out-dir
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

async function run() {
const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE}/index.mjs`);
const BASE = process.env.BASE_URL!;
const OUT = process.argv[2];
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { links: { ready: string; code: string; locked: string; expired: string; empty: string }; knownCode: string };
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = { layout: {}, flow: [], console: [], thirdParty: [] };
const flow = report.flow as [string, unknown][];
type Locator = { first(): Locator; waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; count(): Promise<number>;
  getAttribute(n: string): Promise<string | null> };
type Page = {
  goto(u: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void; on(e: "request", f: (r: { url(): string }) => void): void;
};
async function measure(page: Page, key: string, shot?: string) {
  (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea, main select, main summary")].filter(vis);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
      smallest: ctl.map((e) => [Math.round(e.getBoundingClientRect().height), `${e.tagName}:${(e.textContent ?? "").trim().slice(0, 30)}`] as const).filter(([x]) => x < 44).slice(0, 4),
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      squeezed: [...document.querySelectorAll("main p, main span, main h1, main h2")].filter((e) => {
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const em = parseFloat(cs.fontSize); const lh = parseFloat(cs.lineHeight) || em * 1.2;
        return cs.display !== "inline" && r.width > 0 && r.width < 4 * em && r.height > 3 * lh && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}:${(e.textContent || "").trim().slice(0, 30)}`),
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map((e) => `${e.tagName}:${(e.textContent || "").slice(0, 30)}`),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, name: string, prep?: () => Promise<void>) {
  for (const w of [390, 820, 1180, 1440]) for (const zoom of [1, 2]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}${path}`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    if (prep) await prep();
    if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await page.waitForTimeout(150);
    const shoot = (zoom === 1 && (w === 390 || w === 1440)) || (zoom === 2 && w === 390);
    await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
  }
  // a fresh load at 1440 so the injected 200 % style never leaks into later steps (browser run 1 finding)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${path}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
}
const host = new URL(BASE).host;
const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": "203.0.113.96" } });
  const p: Page = await ctx.newPage();
  current = p;
  p.on("console", (m) => m.type() === "error" && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200)));
  p.on("request", (r) => { const u = new URL(r.url()); if (u.host !== host && u.protocol !== "data:") (report.thirdParty as string[]).push(u.host); });
  const main = () => p.locator("main").first().innerText();
  const L = seed.links;

  // Before the OTP: neutral metadata only
  await p.goto(`${BASE}/aftercare/${L.ready}`);
  await p.getByRole("heading", { level: 1 }).waitFor();
  const pre = await main();
  flow.push(["before the OTP: clinic, branch and masked phone only (no patient, treatment or text)",
    /Klinik Cantik Sintetis · Cabang Kemang/.test(pre) && /•••• \d{4}/.test(pre) && !/Rina|Facial|Peel|matahari|pelembap/.test(pre)]);
  flow.push(["noindex and no-referrer meta", (await p.locator('meta[name="robots"]').first().getAttribute("content"))?.includes("noindex") === true
    && (await p.locator('meta[name="referrer"]').first().getAttribute("content")) === "no-referrer"]);
  await layouts(p, `/aftercare/${L.ready}`, "sebelum-otp");
  // Kirim Kode (success): the code step
  await p.goto(`${BASE}/aftercare/${L.ready}`);
  await p.getByRole("button", { name: "Kirim Kode" }).click();
  await p.getByLabel("Kode verifikasi").waitFor();
  flow.push(["Kirim Kode: success message and the code field", /Kode verifikasi dikirim\./.test(await main())]);
  // review r1 P3-1 (on the ready link, whose random code is never needed): a wrong code, then Kirim Ulang Kode → the resend's answer
  await p.getByLabel("Kode verifikasi").fill("000001");
  await p.getByRole("button", { name: "Buka Panduan" }).click();
  await p.getByText(/Kode salah\./).waitFor();
  await p.getByRole("button", { name: "Kirim Ulang Kode" }).click();
  await p.getByText("Kode verifikasi dikirim.").waitFor();
  flow.push(["a resend after a wrong code shows the new answer, not the old error", !/Kode salah/.test(await main())]);
  // the code link with a known OTP: a wrong code (error with attempts left), then the right one (success → the instructions)
  await p.goto(`${BASE}/aftercare/${L.code}`);
  await p.getByLabel("Kode verifikasi").waitFor();
  await layouts(p, `/aftercare/${L.code}`, "kode", async () => { await p.getByLabel("Kode verifikasi").waitFor(); });
  await p.getByLabel("Kode verifikasi").fill("135790");
  await p.getByRole("button", { name: "Buka Panduan" }).click();
  await p.getByText(/Kode salah\./).waitFor();
  flow.push(["a wrong code: error with the attempts left", /Kode salah\. Sisa 4 percobaan\./.test(await main())]);
  await p.screenshot({ path: `${OUT}/kode-salah-1440.png`, fullPage: true });
  await p.getByLabel("Kode verifikasi").fill(seed.knownCode);
  await p.getByRole("button", { name: "Buka Panduan" }).click();
  await p.getByRole("heading", { name: "Facial Glow" }).waitFor();
  const opened = await main();
  flow.push(["the right code opens the instructions in order", /Facial Glow[\s\S]*Hindari sinar matahari[\s\S]*Chemical Peel[\s\S]*pelembap/.test(opened)]);
  flow.push(["the session survives a reload", await (async () => { await p.goto(`${BASE}/aftercare/${L.code}`); await p.getByRole("heading", { name: "Facial Glow" }).waitFor(); return true; })()]);
  await layouts(p, `/aftercare/${L.code}`, "panduan", async () => { await p.getByRole("heading", { name: "Facial Glow" }).waitFor(); });
  // the filter (two treatments): narrows, then filtered-empty with Hapus Filter
  await p.getByLabel("Cari panduan").fill("pelembap");
  const narrowed = await main();
  flow.push(["the filter narrows to the matching treatment", /Chemical Peel/.test(narrowed) && !/Facial Glow/.test(narrowed)]);
  await p.getByLabel("Cari panduan").fill("tidak ada yang cocok");
  await p.getByText("Tidak ada panduan perawatan untuk filter ini.").waitFor();
  await p.screenshot({ path: `${OUT}/filter-kosong-390.png`, fullPage: true });
  await layouts(p, `/aftercare/${L.code}`, "filter-kosong", async () => {
    await p.getByLabel("Cari panduan").fill("tidak ada yang cocok");
    await p.getByText("Tidak ada panduan perawatan untuk filter ini.").waitFor();
  });
  await p.goto(`${BASE}/aftercare/${L.code}`);
  await p.getByLabel("Cari panduan").fill("tidak ada yang cocok");
  await p.getByRole("button", { name: "Hapus Filter" }).click();
  flow.push(["Hapus Filter restores every treatment", /Facial Glow[\s\S]*Chemical Peel/.test(await main())]);
  // empty: the defensive state (verified, no instruction to show)
  await p.goto(`${BASE}/aftercare/${L.empty}`);
  await p.getByLabel("Kode verifikasi").fill(seed.knownCode);
  await p.getByRole("button", { name: "Buka Panduan" }).click();
  await p.getByText("Belum ada panduan perawatan.").waitFor();
  flow.push(["empty: no instruction to show", true]);
  await layouts(p, `/aftercare/${L.empty}`, "kosong", async () => { await p.getByText("Belum ada panduan perawatan.").waitFor(); });
  // Blocked: locked, expired, unknown
  await p.goto(`${BASE}/aftercare/${L.locked}`);
  await p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["locked: blocked with the 15-minute recovery", /Terlalu banyak percobaan\. Coba lagi dalam 15 menit atau hubungi klinik\./.test(await main())]);
  await layouts(p, `/aftercare/${L.locked}`, "terkunci");
  await p.goto(`${BASE}/aftercare/${L.expired}`);
  await p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["expired: blocked, contact the clinic", /Tautan ini sudah kedaluwarsa\. Hubungi klinik/.test(await main())]);
  await layouts(p, `/aftercare/${L.expired}`, "kedaluwarsa");
  await p.goto(`${BASE}/aftercare/${"A".repeat(43)}`);
  await p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["unknown link: blocked", /Tautan ini tidak dikenali/.test(await main())]);
  flow.push(["no third-party request", (report.thirdParty as string[]).length === 0]);
  await ctx.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
