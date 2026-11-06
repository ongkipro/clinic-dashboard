// T-021 browser evidence (SEC-21, UX-40 shell, UI-17) at 390/820/1180/1440 and 200% text:
// a platform owner enrols TOTP and signs in on the vendor host; the Tenant table shows a
// hostile tenant name as text; no CSP violation occurs on any vendor page; a clinic
// session (app host) does not open the console and the vendor session does not open the
// clinic app; an IP outside the allowlist sees the refused screen. Runs on request:
//   RUN_UI=1 APP_URL=... VENDOR_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/vendor.spec.ts out-dir
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
  type Locator = { first(): Locator; getByText(t: string | RegExp): Locator; waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; count(): Promise<number> };
  type Page = {
    goto(u: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; waitForURL(u: string | RegExp): Promise<void>; url(): string; setViewportSize(s: { width: number; height: number }): Promise<void>;
    getByLabel(t: string | RegExp): Locator; getByRole(r: string, o?: object): Locator; locator(s: string): Locator;
    evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
    on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  };
  type Context = {
    newPage(): Promise<Page>; close(): Promise<void>; addInitScript(s: string): Promise<void>;
    cookies(): Promise<{ name: string; domain: string; secure: boolean; sameSite: string; httpOnly: boolean; path: string; value: string }[]>;
    addCookies(c: object[]): Promise<void>;
  };
  const APP = process.env.APP_URL ?? "http://localhost:3911";
  const VENDOR = process.env.VENDOR_URL ?? "http://vendor.localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t021ui";
  const seed = JSON.parse(readFileSync(process.env.SEED ?? `${OUT}/seed.json`, "utf8")) as { ownerEmail: string; clinicEmail: string; hostile: string };
  const PASSWORD = "kuda-laut berenang 2026"; // synthetic
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [], csp: [] };
  const flow = report.flow as [string, unknown][];
  const csp = report.csp as string[];

  function totp(secret: string, at = Date.now()): string {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase()].map((c) => a.indexOf(c).toString(2).padStart(5, "0")).join("");
    const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    const ctr = Buffer.alloc(8);
    ctr.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
    const m = createHmac("sha1", key).update(ctr).digest();
    const o = m[m.length - 1] & 15;
    return String((((m[o] & 0x7f) << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) % 1e6).padStart(6, "0");
  }
  const watchCsp = `document.addEventListener("securitypolicyviolation", (e) => { (window.__csp ??= []).push(e.violatedDirective + " " + (e.blockedURI || "inline")); });`;
  async function cspOf(page: Page, where: string) {
    const v = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    for (const x of v) csp.push(`${where}: ${x}`);
  }
  // 200% text through the CSSOM (a <style> tag would be refused by the console CSP, which
  // is the point; CSSOM property writes are not subject to style-src).
  async function zoom200(page: Page) {
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  }
  async function measure(page: Page, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ctl = [...document.querySelectorAll("a, button, input:not([type=hidden]), select, textarea")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  }
  async function layouts(page: Page, paths: [string, string, string][]) {
    for (const [path, wait, name] of paths) {
      for (const w of [390, 820, 1180, 1440]) {
        for (const zoom of [1, 2]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${VENDOR}${path}`);
          await page.locator("main").first().waitFor();
          await page.getByRole("heading", { name: wait }).first().waitFor();
          if (zoom === 2) await zoom200(page);
          const shoot = (zoom === 1 && (w === 390 || w === 1180 || w === 1440)) || (zoom === 2 && w === 390);
          await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
          await cspOf(page, `${name}-${w}`);
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  // React #441 (a server render error) is expected only while the error hook is applied.
  let expectingRenderError = false;
  const onConsole = (m: { type(): string; text(): string }) =>
    m.type() === "error" && !m.text().includes("status of 401") && !m.text().includes("status of 404") &&
    !(expectingRenderError && (m.text().includes("React error #441") || m.text().includes("status of 500"))) &&
    (report.console as string[]).push(m.text().slice(0, 200));

  const browser = await chromium.launch();
  try {
    const ctx = (await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": "203.0.113.10" } })) as Context;
    await ctx.addInitScript(watchCsp);
    const page = await ctx.newPage();
    page.on("console", onConsole);
    (page as unknown as { on(e: "pageerror", f: (e: Error) => void): void }).on("pageerror", (e) => (report.console as string[]).push(`pageerror: ${String(e).slice(0, 300)}`));

    // Sign-in screens (no session yet).
    await layouts(page, [["/vendor/masuk", "Masuk", "masuk"]]);

    // Sign in; enrol TOTP (every vendor account must).
    await page.goto(`${VENDOR}/vendor/masuk`);
    await page.getByLabel("Email").fill(seed.ownerEmail);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${VENDOR}/vendor/tenant`);
    await page.waitForURL(`${VENDOR}/vendor/aktifkan-2fa`);
    flow.push(["vendor account without TOTP is sent to enrolment", page.url().endsWith("/vendor/aktifkan-2fa")]);
    await measure(page, "enrol-1440", "enrol-1440");
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    const secret = (await page.getByLabel("Kunci autentikator").innerText()).trim();
    await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
    await page.getByRole("button", { name: "Aktifkan" }).click();
    await page.waitForURL(`${VENDOR}/vendor/tenant`);
    await page.getByRole("heading", { name: "Tenant" }).waitFor();
    await cspOf(page, "after-enrol");

    // Cookies: host-only __Host-vendor.*, Secure, SameSite=Strict, HttpOnly.
    const cookies = (await ctx.cookies()).filter((c) => c.domain.includes("vendor"));
    report.cookies = cookies.map((c) => ({ name: c.name, secure: c.secure, sameSite: c.sameSite, httpOnly: c.httpOnly, path: c.path, domain: c.domain }));
    flow.push(["vendor cookies are __Host- Secure SameSite=Strict HttpOnly", cookies.length > 0 && cookies.every((c) => c.name.startsWith("__Host-vendor.") && c.secure && c.sameSite === "Strict" && c.httpOnly && c.path === "/" && !c.domain.startsWith("."))]);

    // Tenant table: hostile name shown as text.
    await layouts(page, [["/vendor/tenant", "Tenant", "tenant"]]);
    await page.goto(`${VENDOR}/vendor/tenant`);
    const main = await page.locator("main").innerText();
    const injected = await page.evaluate(() => document.querySelectorAll("main img, main script, main iframe").length);
    flow.push(["hostile tenant name renders as text", main.includes(seed.hostile) && injected === 0]);
    flow.push(["platform page shows no patient or staff data", !/pasien|nomor hp|telepon/i.test(main)]);

    // Error state: the tenant read fails; Coba Lagi recovers once it works again.
    if (process.env.ERROR_HOOK) {
      const { execSync } = await import("node:child_process");
      execSync(`${process.env.ERROR_HOOK} break`);
      expectingRenderError = true;
      try {
        for (const w of [390, 1440]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${VENDOR}/vendor/tenant`);
          await page.getByRole("button", { name: "Coba Lagi" }).waitFor();
          await measure(page, `error-${w}`, `error-${w}`);
          await cspOf(page, `error-${w}`);
        }
      } finally {
        execSync(`${process.env.ERROR_HOOK} fix`);
      }
      await page.getByRole("button", { name: "Coba Lagi" }).click();
      await page.locator("main").getByText(seed.hostile).first().waitFor();
      expectingRenderError = false;
      flow.push(["error state recovers with Coba Lagi", true]);
    }

    // The clinic app does not accept the vendor session.
    await page.goto(`${APP}/persetujuan`);
    await page.waitForURL(/\/masuk$/);
    flow.push(["vendor session does not open the clinic app", page.url().endsWith("/masuk")]);

    // A clinic session does not open the vendor console, even with its token moved to the vendor cookie name.
    const ctxC = (await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": "203.0.113.10" } })) as Context;
    await ctxC.addInitScript(watchCsp);
    const pc = await ctxC.newPage();
    pc.on("console", onConsole);
    await pc.goto(`${APP}/masuk`);
    await pc.getByLabel("Email").fill(seed.clinicEmail);
    await pc.getByLabel("Kata sandi").fill(PASSWORD);
    await pc.getByRole("button", { name: "Masuk" }).click();
    await pc.waitForURL(`${APP}/`);
    const appCookie = (await ctxC.cookies()).find((c) => c.name.endsWith("session_token"));
    await pc.goto(`${VENDOR}/vendor/tenant`);
    await pc.waitForURL(/\/vendor\/masuk$/);
    const plain = pc.url().endsWith("/vendor/masuk");
    // __Host- needs Secure; on this http loopback run Chromium still sends Secure cookies to *.localhost.
    await ctxC.addCookies([{ name: "__Host-vendor.session_token", value: appCookie!.value, domain: new URL(VENDOR).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Strict" }]);
    await pc.goto(`${VENDOR}/vendor/tenant`);
    await pc.waitForURL(/\/vendor\/masuk$/);
    flow.push(["clinic session does not open the vendor console (also under the vendor cookie name)", plain && pc.url().endsWith("/vendor/masuk")]);
    await ctxC.close();

    // Outside the allowlist: sign-in itself is refused, with a message, and no session.
    const ctxX = (await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-real-ip": "198.51.100.7" } })) as Context;
    await ctxX.addInitScript(watchCsp);
    const px = await ctxX.newPage();
    px.on("console", (m) => { if (!m.text().includes("status of 403")) onConsole(m); });
    await px.goto(`${VENDOR}/vendor/masuk`);
    await px.getByLabel("Email").fill(seed.ownerEmail);
    await px.getByLabel("Kata sandi").fill(PASSWORD);
    await px.getByRole("button", { name: "Masuk" }).click();
    await px.locator("main").getByText("Masuk hanya dari jaringan kantor yang diizinkan").waitFor();
    const refused = await px.locator("main").innerText();
    const xCookies = (await ctxX.cookies()).map((c) => c.name);
    flow.push(["sign-in from outside the allowlist is refused", refused.includes("Masuk hanya dari jaringan kantor yang diizinkan") && xCookies.every((c) => !c.includes("session_token") && !c.includes("two_factor"))]);
    await measure(px, "refused-390", "refused-390");
    await zoom200(px);
    await measure(px, "refused-390@200%", "refused-390-200");
    await cspOf(px, "refused");
    await ctxX.close();

    // Unknown vendor page: the vendor not-found, no CSP violation.
    await page.goto(`${VENDOR}/vendor/tidak-ada`);
    await page.getByRole("heading", { name: "Halaman tidak ditemukan" }).waitFor();
    await cspOf(page, "not-found");
    flow.push(["unknown vendor page shows the vendor not-found", true]);

    // Sign out ends only the vendor session.
    await page.goto(`${VENDOR}/vendor/tenant`);
    await page.getByRole("button", { name: "Keluar" }).click();
    await page.waitForURL(`${VENDOR}/vendor/masuk`);
    flow.push(["Keluar returns to the vendor sign-in", true]);
    // Sign in again: the second-factor screen.
    await page.getByLabel("Email").fill(seed.ownerEmail);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${VENDOR}/vendor/verifikasi`);
    await page.setViewportSize({ width: 390, height: 844 });
    await measure(page, "verify-390", "verify-390");
    await cspOf(page, "verify");
    await ctx.close();
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
    process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
  } finally {
    await browser.close();
    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  }
}
