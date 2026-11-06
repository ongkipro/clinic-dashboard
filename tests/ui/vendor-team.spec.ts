// HYG-003 browser evidence (DEC-036, UX-46) at 390/820/1180/1440 and 200% text. The first
// platform owner exists only through `pnpm vendor:bootstrap` (run by the check script):
// they sign in, enrol TOTP, invite a second platform owner and an onboarding member from
// Tim Vendor; each accepts the link, sets a password and enrols TOTP; onboarding creates a
// tenant and the second platform owner approves the first-owner invitation (closing the
// DEC-033 loop); Nonaktifkan / Aktifkan Kembali; onboarding sees no Tim Vendor menu. No
// console error, no CSP violation. Runs on request:
//   RUN_UI=1 VENDOR_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/vendor-team.spec.ts out-dir
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
  type Locator = {
    first(): Locator; getByText(t: string | RegExp, o?: object): Locator; waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>;
    innerText(): Promise<string>; count(): Promise<number>; check(): Promise<void>;
  };
  type Page = {
    goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; url(): string; setViewportSize(s: { width: number; height: number }): Promise<void>;
    getByLabel(t: string | RegExp, o?: object): Locator; getByRole(r: string, o?: object): Locator; locator(s: string): Locator; getByText(t: string | RegExp, o?: object): Locator;
    evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
    on(e: string, f: (m: { type(): string; text(): string }) => void): void;
  };
  type Context = { newPage(): Promise<Page>; close(): Promise<void>; addInitScript(s: string): Promise<void> };
  const VENDOR = process.env.VENDOR_URL ?? "http://vendor.localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/hyg3ui";
  const seed = JSON.parse(readFileSync(process.env.SEED ?? `${OUT}/seed.json`, "utf8")) as { po: string; password: string; stamp: string };
  const PW2 = "jembatan merah sore hari 2026"; // synthetic
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
  async function measure(page: Page, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0; };
      const ctl = [...document.querySelectorAll("a, button, input:not([type=hidden]), select, textarea")].filter(vis);
      const box = (e: Element) => (e as HTMLInputElement).type === "checkbox" ? (e.closest("label") ?? e) : e;
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(box(e).getBoundingClientRect().height))) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
        smallest: ctl.map((e) => [Math.round(box(e).getBoundingClientRect().height), `${e.tagName}:${(e.textContent ?? "").slice(0, 30)}`] as const).sort((x, y) => x[0] - y[0])[0]?.[1],
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  }
  async function layouts(page: Page, path: string, heading: string, name: string) {
    for (const w of [390, 820, 1180, 1440]) {
      for (const zoom of [1, 2]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(`${VENDOR}${path}`);
        await page.getByRole("heading", { name: heading }).first().waitFor();
        if (zoom === 2) await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
        const shoot = (zoom === 1 && (w === 390 || w === 1180 || w === 1440)) || (zoom === 2 && w === 390);
        await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
        await cspOf(page, `${name}-${w}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  let expected = /status of (401|403|404|409)/;
  const onConsole = (m: { type(): string; text(): string }) => m.type() === "error" && !expected.test(m.text()) && (report.console as string[]).push(m.text().slice(0, 200));

  const browser = await chromium.launch();
  const open: Page[] = [];
  let ipN = 20;
  const newCtx = async () => {
    const c = (await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": `203.0.113.${ipN++}` } })) as Context;
    await c.addInitScript(watchCsp);
    const p = await c.newPage();
    open.push(p);
    p.on("console", onConsole);
    p.on("pageerror", (e) => (report.console as string[]).push(`pageerror: ${String(e).slice(0, 300)}`));
    return { c, p };
  };
  const secrets = new Map<string, string>();
  async function signIn(p: Page, email: string, password: string) {
    await p.goto(`${VENDOR}/vendor/masuk`);
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Kata sandi").fill(password);
    await p.getByRole("button", { name: "Masuk" }).click();
    // Not enrolled yet: /vendor/tenant redirects to enrolment; enrolled: /vendor/verifikasi.
    await p.waitForURL(/\/vendor\/(aktifkan-2fa|verifikasi)$/);
    if (p.url().endsWith("/aktifkan-2fa")) {
      await p.getByLabel("Kata sandi").fill(password);
      await p.getByRole("button", { name: "Lanjut" }).click();
      const secret = (await p.getByLabel("Kunci autentikator").innerText()).trim();
      secrets.set(email, secret);
      await p.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
      await p.getByRole("button", { name: "Aktifkan" }).click();
    } else {
      await p.getByLabel(/kode/i).first().fill(totp(secrets.get(email)!));
      await p.getByRole("button", { name: "Verifikasi" }).click();
    }
    await p.waitForURL(`${VENDOR}/vendor/tenant`);
  }
  async function invite(p: Page, name: string, email: string, role: string): Promise<string> {
    await p.goto(`${VENDOR}/vendor/tim`);
    await p.getByLabel("Nama lengkap").fill(name);
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel(role, { exact: true }).check();
    await p.getByRole("button", { name: "Buat Undangan" }).click();
    return (await p.getByLabel("Tautan undangan Tim Vendor").innerText()).trim();
  }
  async function accept(link: string, password: string) {
    const { c, p } = await newCtx();
    await p.goto(link);
    await p.getByRole("heading", { name: "Undangan Tim Vendor" }).waitFor();
    await p.getByLabel("Kata sandi baru").fill(password);
    await p.getByLabel("Ulangi kata sandi").fill(password);
    await p.getByRole("button", { name: "Terima Undangan" }).click();
    await p.waitForURL(/\/vendor\/masuk$/);
    await c.close();
  }

  try {
    const po2 = `bima.${seed.stamp}@vendor-sintetis.test`;
    const onbEmail = `sari.${seed.stamp}@vendor-sintetis.test`;
    // 1. The bootstrapped platform owner signs in: TOTP enrolment first.
    const a = await newCtx();
    await signIn(a.p, seed.po, seed.password);
    flow.push(["bootstrapped platform owner signs in and enrols TOTP", secrets.has(seed.po)]);
    await layouts(a.p, "/vendor/tim", "Tim Vendor", "tim");
    // 2. Invite the second platform owner and an onboarding member.
    const link2 = await invite(a.p, "Bima Pemilik Platform", po2, "Pemilik Platform");
    flow.push(["invitation link shown once", /^http:\/\/vendor\.localhost:3911\/vendor\/undangan\/[A-Za-z0-9_-]{40,}$/.test(link2)]);
    await a.p.setViewportSize({ width: 390, height: 900 });
    await measure(a.p, "tim-link-390", "tim-link-390");
    await a.p.setViewportSize({ width: 1440, height: 900 });
    const linkOnb = await invite(a.p, "Sari Onboarding", onbEmail, "Onboarding");
    await a.p.goto(`${VENDOR}/vendor/tim`);
    flow.push(["open invitations listed without links", (await a.p.locator("main:visible").innerText()).includes("Undangan Terbuka") && !(await a.p.locator("main:visible").innerText()).includes("/vendor/undangan/")]);
    // 3. Accept: weak password refused with the policy message; then accepted.
    const x = await newCtx();
    await x.p.setViewportSize({ width: 390, height: 900 });
    await x.p.goto(link2);
    await x.p.getByRole("heading", { name: "Undangan Tim Vendor" }).waitFor();
    await measure(x.p, "terima-390", "terima-390");
    await x.p.getByLabel("Kata sandi baru").fill("password12345678");
    await x.p.getByLabel("Ulangi kata sandi").fill("password12345678");
    await x.p.getByRole("button", { name: "Terima Undangan" }).click();
    expected = /status of (400|401|403|404|409)/; // the refused weak password
    await x.p.getByText(/terlalu umum|terlalu mudah/).waitFor();
    await measure(x.p, "terima-error-390", "terima-error-390");
    await x.c.close();
    expected = /status of (401|403|404|409)/;
    await accept(link2, PW2);
    await accept(linkOnb, PW2);
    const y = await newCtx();
    await y.p.goto(link2);
    await y.p.getByText("Undangan sudah tidak berlaku").waitFor();
    flow.push(["link works once", true]);
    await y.c.close();
    // 4. Both sign in and enrol TOTP; onboarding sees no Tim Vendor menu and gets the permission state.
    const b = await newCtx();
    await signIn(b.p, po2, PW2);
    const o = await newCtx();
    await signIn(o.p, onbEmail, PW2);
    flow.push(["onboarding sees no Tim Vendor menu", (await o.p.getByRole("link", { name: "Tim Vendor" }).count()) === 0]);
    await o.p.goto(`${VENDOR}/vendor/tim`);
    await o.p.getByText("Hanya Pemilik Platform yang mengelola Tim Vendor").waitFor();
    flow.push(["onboarding opening /vendor/tim gets the permission state", true]);
    // 5. DEC-033 loop: onboarding creates a tenant; the second platform owner approves.
    await o.p.goto(`${VENDOR}/vendor/tenant/baru`);
    await o.p.getByLabel("Nama badan usaha").fill("PT Klinik Uji Tim Sintetis");
    await o.p.getByLabel("Kode cabang").fill("PST");
    await o.p.getByLabel("Nama cabang").fill("Cabang Pusat");
    await o.p.getByLabel("Nama lengkap").fill("Ibu Owner Uji");
    await o.p.getByLabel("Email", { exact: true }).fill(`owner.${seed.stamp}@klinik-sintetis.test`);
    await o.p.getByRole("button", { name: "Buat Tenant" }).click();
    await o.p.waitForURL(/\/vendor\/tenant\/[0-9a-f-]{36}$/);
    const tenantPath = new URL(o.p.url()).pathname;
    await b.p.goto(`${VENDOR}${tenantPath}`);
    await b.p.getByRole("button", { name: "Setujui Undangan" }).click();
    await b.p.getByLabel("Tautan undangan Owner").waitFor();
    flow.push(["second platform owner (invited) approves a first-owner invitation", true]);
    // 6. Nonaktifkan / Aktifkan Kembali (step-up fresh: just signed in).
    await a.p.goto(`${VENDOR}/vendor/tim`);
    await a.p.locator("main:visible").getByText("Sari Onboarding").first().waitFor();
    await layouts(a.p, "/vendor/tim", "Tim Vendor", "tim-full");
    await a.p.goto(`${VENDOR}/vendor/tim`);
    await a.p.getByRole("button", { name: "Nonaktifkan" }).first().click();
    await a.p.getByRole("button", { name: "Aktifkan Kembali" }).first().waitFor();
    flow.push(["Nonaktifkan shows Aktifkan Kembali", true]);
    await a.p.getByRole("button", { name: "Aktifkan Kembali" }).first().click();
    await a.p.getByRole("button", { name: "Aktifkan Kembali" }).first().waitFor({ state: "detached" });
    flow.push(["Aktifkan Kembali restores the member", (await a.p.getByRole("button", { name: "Nonaktifkan" }).count()) >= 2]);
    await cspOf(a.p, "after");
    await a.c.close();
    await b.c.close();
    await o.c.close();
  } catch (e) {
    for (const [i, p] of open.entries()) await p.screenshot({ path: `${OUT}/fail-${i}.png` }).catch(() => {});
    report.error = `${flow.length} flows done: ` + String(e).split("\n").slice(0, 4).join(" ");
    process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
  } finally {
    await browser.close();
    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  }
}
