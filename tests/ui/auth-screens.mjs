// T-006 browser evidence: sign-in, TOTP and idle-lock screens at 390/820/1180/1440 and
// 200% text, plus the sign-in → enrol → verify flow and the idle lock in a real browser.
// Usage: BASE_URL=http://localhost:3911 node tests/ui/auth-screens.mjs <out-dir>
// Needs Playwright and the seeded synthetic account below.
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
// T-011 adds Playwright to the project; until then PLAYWRIGHT_CORE points at an
// installed playwright-core directory (never an npx cache).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");

const BASE = process.env.BASE_URL ?? "http://localhost:3911";
const OUT = process.argv[2] ?? "/tmp/t006ui";
const EMAIL = process.env.UI_EMAIL ?? "dokter.ui@klinik-sintetis.test";
const PASSWORD = "kuda-laut berenang 2026"; // synthetic
mkdirSync(OUT, { recursive: true });

function totp(secret) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase()].map((c) => a.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const m = createHmac("sha1", key).update(ctr).digest();
  const o = m[m.length - 1] & 15;
  return String((((m[o] & 0x7f) << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) % 1e6).padStart(6, "0");
}

const report = { layout: {}, flow: [], console: [] };
// Better Auth allows 3 sign-in requests per 10 s per client IP; a local run has no proxy
// IP header, so every request shares one bucket. Space sign-in submits accordingly.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Next.js renders its own route-announcer alert; error messages live inside <main>.
const alertIn = (page, text) => page.locator("main").getByRole("alert").filter({ hasText: text });
const SIGN_IN_GAP = 4_000;
const browser = await chromium.launch();
try {
  // Layout at each width and at 200% text.
  for (const path of ["/masuk", "/verifikasi", "/aktifkan-2fa", "/terkunci"]) {
    for (const w of [390, 820, 1180, 1440]) {
      for (const zoom of [1, 2]) {
        const page = await browser.newPage({ viewport: { width: w, height: 900 } });
        page.on("console", (m) => m.type() === "error" && report.console.push(`${path} ${m.text()}`));
        await page.goto(BASE + path);
        if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        const m = await page.evaluate(() => {
          const r = (el) => el?.getBoundingClientRect();
          const controls = [...document.querySelectorAll("main input:not([type=hidden]), main button, main a")].map((el) => ({
            tag: el.tagName,
            h: Math.round(r(el).height),
            w: Math.round(r(el).width),
            named: Boolean(el.labels?.length || el.getAttribute("aria-label") || el.textContent.trim()),
          }));
          return {
            overflowX: document.documentElement.scrollWidth - innerWidth,
            h1: document.querySelector("h1")?.textContent,
            lang: document.documentElement.getAttribute("lang"),
            minTarget: Math.min(...controls.map((c) => c.h)),
            unnamed: controls.filter((c) => !c.named).length,
          };
        });
        report.layout[`${path}@${w}${zoom === 2 ? "@200%" : ""}`] = m;
        if (zoom === 1 || w === 390) await page.screenshot({ path: `${OUT}${path.replace("/", "/")}-${w}${zoom === 2 ? "-200" : ""}.png`, fullPage: true });
        await page.close();
      }
    }
  }

  // Flow: sign in (no TOTP enrolled, role gate is T-007) → enrol → sign out → sign in → verify.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && report.console.push(`flow ${m.text()}`));
  await page.goto(BASE + "/masuk");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Kata sandi").fill("salah salah salah 1");
  await page.getByRole("button", { name: "Masuk" }).click();
  await alertIn(page, "Email atau kata sandi salah.").waitFor();
  report.flow.push(["wrong password", await page.locator("main").getByRole("alert").textContent()]);
  await page.screenshot({ path: `${OUT}/masuk-error-390.png` });

  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await pause(SIGN_IN_GAP);
  await page.keyboard.press("Enter"); // keyboard submit
  await page.waitForURL(BASE + "/");
  report.flow.push(["signed in", page.url()]);

  await page.goto(BASE + "/aktifkan-2fa");
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Lanjut" }).click();
  const secret = (await page.getByLabel("Kunci autentikator").textContent()).trim();
  report.flow.push(["enrol secret shown", secret.length >= 16]);
  report.flow.push(["backup codes", await page.getByRole("list", { name: "Kode cadangan" }).locator("li").count()]);
  await page.screenshot({ path: `${OUT}/aktifkan-2fa-step2-390.png`, fullPage: true });
  await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await page.waitForURL(BASE + "/");
  report.flow.push(["enrolled", page.url()]);

  await ctx.clearCookies();
  await pause(SIGN_IN_GAP);
  await page.goto(BASE + "/masuk");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(BASE + "/verifikasi");
  report.flow.push(["second sign-in asks for code", page.url()]);
  await page.getByLabel("Kode 6 digit").fill("000000");
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await alertIn(page, "Kode tidak cocok").waitFor();
  report.flow.push(["wrong code", await page.locator("main").getByRole("alert").textContent()]);
  await page.getByLabel("Kode 6 digit").fill(totp(secret));
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await page.waitForURL(BASE + "/");
  report.flow.push(["verified", page.url()]);

  // Keyboard: focus order on /masuk.
  await page.goto(BASE + "/masuk");
  const order = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent));
  }
  report.flow.push(["tab order", order]);

  // Unlock screen: wrong password message, then server redirect.
  await page.goto(BASE + "/terkunci");
  await page.getByLabel("Kata sandi").fill("salah salah salah 1");
  await page.getByRole("button", { name: "Buka Kunci" }).click();
  await alertIn(page, "Kata sandi salah.").waitFor();
  report.flow.push(["unlock wrong", await page.locator("main").getByRole("alert").textContent()]);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Buka Kunci" }).click();
  await page.getByText("Hello world!").waitFor(); // placeholder home page until T-013
  report.flow.push(["unlock ok", page.url()]);
  await ctx.close();
} catch (e) {
  report.error = String(e).split("\n")[0];
  process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
