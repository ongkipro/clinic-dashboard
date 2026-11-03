// HYG-002 browser evidence (DEC-031 D1, D7) at 390/820/1180/1440 and 200% text: the person
// an Owner granted Owner sees the grant on Saya › Ganti Peran with who granted it, accepts
// it, and Owner appears in the role list (the role did not exist before); the owner's
// invitation drawer shows the copied-link guidance in production. Runs on request:
//   RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/owner-grant.spec.ts out-dir
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
  type Locator = { first(): Locator; getByLabel(t: string | RegExp, o?: object): Locator; getByRole(r: string, o?: object): Locator; waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; count(): Promise<number>; getByText(t: string | RegExp): Locator; check(): Promise<void> };
  type Page = {
    goto(u: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; waitForURL(u: string | RegExp): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
    getByLabel(t: string | RegExp, o?: object): Locator; getByRole(r: string, o?: object): Locator; locator(s: string): Locator;
    addStyleTag(o: { content: string }): Promise<unknown>; evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
    on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  };
  const BASE = process.env.BASE_URL ?? "http://localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/hyg2ui";
  const seed = JSON.parse(readFileSync(process.env.SEED ?? `${OUT}/seed.json`, "utf8")) as { ownerEmail: string; financeEmail: string };
  const PASSWORD = "kuda-laut berenang 2026"; // synthetic
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [] };
  const flow = report.flow as [string, unknown][];

  function totp(secret: string): string {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase()].map((c) => a.indexOf(c).toString(2).padStart(5, "0")).join("");
    const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    const ctr = Buffer.alloc(8);
    ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const m = createHmac("sha1", key).update(ctr).digest();
    const o = m[m.length - 1] & 15;
    return String((((m[o] & 0x7f) << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) % 1e6).padStart(6, "0");
  }
  // Sign in and enrol TOTP (owner and finance both need it).
  async function signIn(page: Page, email: string) {
    await page.goto(`${BASE}/masuk`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/saya/peran`);
    await page.waitForURL(`${BASE}/aktifkan-2fa`);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    const secret = (await page.getByLabel("Kunci autentikator").innerText()).trim();
    await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
    await page.getByRole("button", { name: "Aktifkan" }).click();
    await page.waitForURL(`${BASE}/`);
  }
  async function measure(page: Page, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden])")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  }
  const onConsole = (m: { type(): string; text(): string }) =>
    m.type() === "error" && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));

  const browser = await chromium.launch();
  try {
    // The grantee: the grant waits on Ganti Peran.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = (await ctx.newPage()) as Page;
    page.on("console", onConsole);
    await signIn(page, seed.financeEmail);
    for (const w of [390, 820, 1180, 1440]) {
      for (const zoom of [1, 2]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(`${BASE}/saya/peran`);
        await page.getByRole("button", { name: "Terima Peran Owner" }).waitFor();
        if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        const shoot = (zoom === 1 && (w === 390 || w === 1180)) || (zoom === 2 && w === 390);
        await measure(page, `grant-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `grant-${w}${zoom === 2 ? "-200" : ""}` : undefined);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/saya/peran`);
    await page.getByRole("button", { name: "Terima Peran Owner" }).waitFor();
    await page.locator("main").getByText("Anda hanya punya satu peran").waitFor();
    const before = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    report.before = before.slice(0, 400);
    flow.push(["grant shows who granted it; Owner not yet a role", before.includes("Ibu Ratna Pemilik Klinik") && before.includes("menunjuk Anda sebagai Owner") && before.includes("Anda hanya punya satu peran")]);
    await page.getByRole("button", { name: "Terima Peran Owner" }).click();
    // The page re-renders with Owner in the role list and no grant left.
    await page.locator("main").getByText("Keuangan").first().waitFor();
    await page.getByRole("button", { name: /^Owner/ }).first().waitFor();
    const after = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    flow.push(["after Terima, Owner is a role to switch to and the grant is gone", after.includes("Owner") && after.includes("Keuangan") && !after.includes("Terima Peran Owner") && !after.includes("Anda hanya punya satu peran")]);
    await measure(page, "accepted-390", "accepted-390");
    await ctx.close();

    // The owner's invitation drawer: link guidance (invitations open in production).
    const ctxO = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const po = (await ctxO.newPage()) as Page;
    po.on("console", onConsole);
    await signIn(po, seed.ownerEmail);
    await po.goto(`${BASE}/staf`);
    await po.getByRole("button", { name: "Undang" }).click();
    const sheet = po.getByRole("dialog", { name: "Undang Staf" });
    await sheet.getByLabel("Nama").fill("Staf Baru Sintetis");
    await sheet.getByLabel("Email").fill(`baru.${Date.now()}@klinik-sintetis.test`);
    await sheet.getByLabel("Keuangan", { exact: true }).check();
    await sheet.getByRole("button", { name: "Buat Undangan" }).click();
    await sheet.getByLabel("Tautan undangan").waitFor();
    const drawer = (await sheet.innerText()).replace(/\s+/g, " ");
    flow.push(["invitation link with send-it-personally guidance", drawer.includes("Kirim tautan ini langsung ke orangnya") && drawer.includes("hanya bisa dipakai sekali")]);
    await po.screenshot({ path: `${OUT}/invite-390.png`, fullPage: true });
    await ctxO.close();
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
  } finally {
    await browser.close();
    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  }
}
