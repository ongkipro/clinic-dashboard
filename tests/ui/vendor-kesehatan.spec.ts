// T-118 browser evidence — Konsol Vendor › Kesehatan Platform (UX-45, PR-62, 19 §3) on the vendor host at 390 / 820 / 1180 / 1440 and 200 %
// text. Platform owner and support see the page (nav row present); vendor finance does not (nav row absent, direct URL → permission state).
// The seed (slice 2, after the migration) gives tenant A a queued WhatsApp message older than 15 minutes, queued SATUSEHAT work and a free-
// text error code, with sentinel patient names and message bodies in the source rows: the page shows counts, ages, "lainnya" and the
// OBS-4 alert, "Belum terpantau" for uptime / worker heartbeat / backup age / app error rate, and none of the sentinels. Filters by
// provider and "Hanya yang perlu dicek"; keyboard reaches every link. No CSP violation, no console error.
// Runs on request: RUN_UI=1 VENDOR_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/vendor-kesehatan.spec.ts out-dir
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

async function run() {
const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE}/index.mjs`);
const VENDOR = process.env.VENDOR_URL!;
const OUT = process.argv[2];
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
  password: string; vendor: { po: string; sup: string; fin: string }; tenantName: string; sentinels: string[];
};
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = { layout: {}, flow: [], console: [], csp: [] };
const flow = report.flow as [string, unknown][];
const csp = report.csp as string[];
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
const watchCsp = `document.addEventListener("securitypolicyviolation", (e) => { (window.__csp ??= []).push(e.violatedDirective + " " + (e.blockedURI || "inline")); });`;
type Locator = {
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp): Locator;
  getByText(t: string | RegExp): Locator; waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; focus(): Promise<void>;
  innerText(): Promise<string>; count(): Promise<number>; selectOption(v: string | object): Promise<unknown>; getAttribute(n: string): Promise<string | null>;
};
type Page = Locator & {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; content(): Promise<string>;
  keyboard: { press(k: string): Promise<void>; type(t: string): Promise<void> }; on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  addInitScript(s: string): Promise<void>;
};
async function cspOf(page: Page, where: string) {
  const v = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  for (const x of v) csp.push(`${where}: ${x}`);
}
async function measure(page: Page, key: string, shot?: string) {
  (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main select, main textarea")].filter(vis);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest("[role=region]")).slice(0, 3)
        .map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}`),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, heading: string | RegExp, name: string) {
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${VENDOR}${path}`);
      await page.getByRole("heading", { name: heading }).first().waitFor();
      if (zoom === 2) await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      const shoot = (zoom === 1 && (w === 390 || w === 1440)) || (zoom === 2 && w === 390);
      await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
      await cspOf(page, `${name}-${w}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
const secrets = new Map<string, string>();
async function signIn(page: Page, email: string) {
  await page.goto(`${VENDOR}/vendor/masuk`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(/\/vendor\/(aktifkan-2fa|verifikasi)$/);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Lanjut" }).click();
  const secret = (await page.getByLabel("Kunci autentikator").innerText()).trim();
  secrets.set(email, secret);
  await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await page.waitForURL(`${VENDOR}/vendor/tenant`);
}
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("status of 401") && !m.text().includes("status of 403") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));
const leak = (html: string) => seed.sentinels.some((s) => html.includes(s));
const browser = await chromium.launch();
let current: Page | null = null;
try {
  const open = async (email: string) => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": "203.0.113.10" } });
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await p.addInitScript(watchCsp);
    await signIn(p, email);
    return { c, p };
  };
  // platform owner
  const po = await open(seed.vendor.po);
  flow.push(["the sidebar lists Kesehatan Platform for the platform owner", (await po.p.getByRole("link", { name: "Kesehatan Platform" }).count()) === 1]);
  await po.p.getByRole("link", { name: "Kesehatan Platform" }).click();
  await po.p.getByRole("heading", { name: "Kesehatan Platform" }).waitFor();
  const main = await po.p.locator("main:visible").innerText();
  flow.push(["four sources read Belum terpantau with their reason", (main.match(/Belum terpantau/g) ?? []).length >= 4 && /Proses worker belum berjalan/.test(main)]);
  flow.push(["the seeded clinic shows counts, an age over 15 minutes as Lewat ambang, and lainnya for a free-text code",
    main.includes(seed.tenantName) && /Lewat ambang/.test(main) && /lainnya/.test(main)]);
  flow.push(["no sentinel (patient name, message body, payload, error body) in the page", !leak(await po.p.content())]);
  // r2 (review 1d2a370d #2): the quiet clinic's outbox row names its current dead letter and says its 24-hour failures are not measured,
  // in the wide table and in the narrow card (both rendered; one is hidden by CSS per width)
  const deadRow = await po.p.locator('main:visible tr[data-provider="outbox"]', { hasText: "PT Klinik Tenang Sintetis" }).innerText();
  const deadCard = await po.p.locator("main:visible li", { hasText: "PT Klinik Tenang Sintetis · Antrean event" }).evaluate((e: Element) => e.textContent ?? "");
  flow.push(["outbox dead letter: '1 habis percobaan (surat mati)' and 'Tidak diukur' for 24-hour failures, in the table and the card",
    /1 habis percobaan \(surat mati\)/.test(deadRow) && /Tidak diukur/.test(deadRow) && /habis percobaan/.test(deadCard) && /Gagal 24 jamTidak diukur/.test(deadCard)]);
  await po.p.getByRole("link", { name: "SATUSEHAT" }).first().click();
  await po.p.waitForURL(/penyedia=satusehat/);
  flow.push(["the provider filter keeps SATUSEHAT rows only", !/WhatsApp keluar/.test(await po.p.locator("main:visible table:visible").innerText())]);
  await po.p.getByRole("link", { name: "Hanya yang perlu dicek" }).click();
  await po.p.waitForURL(/perlu=1/);
  flow.push(["the attention filter keeps the alerted clinic", (await po.p.locator("main:visible").innerText()).includes(seed.tenantName)]);
  await layouts(po.p, "/vendor/kesehatan", "Kesehatan Platform", "kesehatan-po");
  await po.c.close();
  // support
  const sup = await open(seed.vendor.sup);
  flow.push(["support sees the page", (await sup.p.getByRole("link", { name: "Kesehatan Platform" }).count()) === 1]);
  await sup.p.goto(`${VENDOR}/vendor/kesehatan`);
  await sup.p.getByRole("heading", { name: "Kesehatan Platform" }).waitFor();
  flow.push(["support: no sentinel", !leak(await sup.p.content())]);
  await sup.c.close();
  // vendor finance: absent from the nav, the URL shows the permission state
  const fin = await open(seed.vendor.fin);
  flow.push(["vendor finance has no Kesehatan Platform link (NAV-1: absent)", (await fin.p.getByRole("link", { name: "Kesehatan Platform" }).count()) === 0]);
  await fin.p.goto(`${VENDOR}/vendor/kesehatan`);
  const denied = await fin.p.getByText("Anda tidak memiliki akses ke Kesehatan Platform.").first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const finHtml = await fin.p.content();
  flow.push(["vendor finance by URL: the permission state", denied]);
  flow.push(["vendor finance by URL: no clinic data", !finHtml.includes(seed.tenantName)]);
  if (!denied || finHtml.includes(seed.tenantName)) {
    report.finance = { url: await fin.p.evaluate(() => location.href), main: (await fin.p.locator("main:visible").innerText().catch((e: unknown) => String(e))).slice(0, 400),
      tenantAt: finHtml.includes(seed.tenantName) ? finHtml.slice(Math.max(0, finHtml.indexOf(seed.tenantName) - 200), finHtml.indexOf(seed.tenantName) + 60) : null };
  }
  await fin.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
