// T-103 browser evidence — Saya › Tagihan Server (UX-49, 17 :88, 19 :185, 07 :67) at 390 / 820 / 1180 / 1440 and 200 % text. PHASE A (fee bearer
// decided as a test fixture; local mock port): the owner sees the invoices (the prorated first month, the current month), the unknown earlier
// attempt blocks a new Bayar on that invoice with its copy, Bayar on the current invoice by keyboard (channel select, Tab, Enter) creates a VA
// instruction (success notice, total incl. the channel fee); finance pays too; Admin Pusat and the auditor read without Bayar; a manager has no
// access (permission); a clinic without invoices sees the empty state. PHASE B (fee bearer undecided): the owner sees "Pembayaran belum
// tersedia" and no Bayar (blocked). No finish token, token hash or provider body on any page. QRIS (review r1 P1): the owner pays an invoice by
// QRIS; the rendered code is decoded by an independent decoder (jsQR from QR_DECODER_DIR, outside the app) and equals the provider payload.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... PHASE=A|B node tests/ui/tagihan-server.spec.ts out-dir
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
const BASE = process.env.BASE_URL!;
const OUT = process.argv[2];
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
  password: string; people: Record<string, { email: string; acc: string; role: string }>; invoices: { id: string; number: string }[]; paid: { id: string; number: string }; qris: { id: string; number: string };
};
const PHASE = process.env.PHASE ?? "A";
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
type Locator = {
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  selectOption(v: string | object): Promise<unknown>; focus(): Promise<void>; getAttribute(n: string): Promise<string | null>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
  check(): Promise<void>; screenshot(o?: object): Promise<Buffer>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; url(): string; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; content(): Promise<string>;
  addStyleTag(o: { content: string }): Promise<unknown>; keyboard: { press(k: string): Promise<void> }; on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
};
async function signIn(page: Page, email: string, totpRole: boolean) {
  await page.goto(`${BASE}/masuk`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);
  if (!totpRole) return;
  await page.goto(`${BASE}/saya/tagihan-server`);
  await page.waitForURL(`${BASE}/aktifkan-2fa`);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Lanjut" }).click();
  const secret = (await page.getByLabel("Kunci autentikator").textContent())!.trim();
  await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await page.waitForURL(`${BASE}/`);
}
async function measure(page: Page, key: string, shot?: string) {
  (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea, main select, main summary")].filter(vis);
    const box = (e: Element) => (["checkbox", "radio"].includes((e as HTMLInputElement).type) && (e.closest("label") ?? e.closest("li")) ? (e.closest("label") ?? e.closest("li"))! : e);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(box(e).getBoundingClientRect().height))) : null,
      smallest: ctl.map((e) => [Math.round(box(e).getBoundingClientRect().height), `${box(e).tagName}.${(box(e).getAttribute("type") ?? "")}:${(box(e).textContent ?? "").trim().slice(0, 30)}`] as const)
        .filter(([hgt]) => hgt < 44).slice(0, 4).map(([hgt, d]) => `${hgt}:${d}`),
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      squeezed: [...document.querySelectorAll("main dd, main dt, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight) || em * 1.2;
        return !e.classList.contains("sr-only") && cs.display !== "inline" && r.width > 0 && r.width < 4 * em && r.height > 3 * lh && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}:${(e.textContent || "").trim().slice(0, 30)}`),
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3)
        .map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}@${e.getBoundingClientRect().right.toFixed(1)}`),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, name: string) {
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE}${path}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForTimeout(150);
      const shoot = (zoom === 1 && (w === 390 || w === 1440)) || (zoom === 2 && w === 390);
      await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${path}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
}
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));
// nothing secret or identifying beyond the page's purpose: the client secret, any NIK, the provider body outside its page
// the finish capability, a token hash or a provider body never reach the page (addendum a2-1)
const leak = (html: string) => /finish_token|finish-token|[0-9a-f]{64}|"ket"|OperationOutcome/.test(html);

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();
  const open = async (who: string, ip: string, totpRole = true) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const list = (p: Page) => p.getByRole("list", { name: "Daftar tagihan server" });
  const [first, cur] = seed.invoices;
  if (PHASE === "A") {
    const own = await open("own", "203.0.113.31");
    await own.p.goto(`${BASE}/saya/tagihan-server`);
    await list(own.p).waitFor();
    const m0 = await main(own.p);
    flow.push(["owner: both invoices with numbers, the first prorated (\"dari … hari\"), outstanding shown; nothing secret", m0.includes(first.number) && m0.includes(cur.number)
      && /Prorata bulan pertama[\s\S]*dari \d+ hari/.test(m0) && /Sisa tagihan/.test(m0) && !leak(await own.p.content())]);
    const firstItem = list(own.p).locator(":scope > li").filter({ hasText: first.number });
    flow.push(["the unknown earlier attempt blocks a new Bayar on that invoice and says why", (await firstItem.getByRole("button", { name: "Bayar" }).count()) === 0
      && /menunggu kepastian dari AutoLaris/.test(await firstItem.innerText())]);
    const paidItem = list(own.p).locator(":scope > li").filter({ hasText: seed.paid.number });
    const pt = await paidItem.innerText();
    flow.push(["the paid invoice shows its receipt (Bukti Pembayaran: amount, channel, reff; not a tax invoice) and no Bayar", /Lunas/.test(pt)
      && /Bukti Pembayaran/.test(pt) && /Rp/.test(pt) && /SF\d+A1/.test(pt) && /bukan faktur pajak/.test(pt)
      && (await paidItem.getByRole("button", { name: "Bayar" }).count()) === 0]);
    await layouts(own.p, "/saya/tagihan-server", "owner");
    // keyboard: choose the channel by arrow keys, Tab to Bayar, Enter
    const curItem = list(own.p).locator(":scope > li").filter({ hasText: cur.number });
    await curItem.getByLabel("Metode bayar").focus();
    await own.p.keyboard.press("ArrowDown");
    await own.p.keyboard.press("ArrowDown");
    await own.p.keyboard.press("Tab");
    const focused = await own.p.evaluate(() => (document.activeElement?.textContent ?? "").trim());
    await own.p.keyboard.press("Enter");
    await own.p.waitForURL(/\/saya\/tagihan-server\?ok=dibuat/);
    await own.p.getByText("Instruksi pembayaran dibuat").first().waitFor();
    const after = await list(own.p).locator(":scope > li").filter({ hasText: cur.number }).innerText();
    flow.push(["keyboard Bayar (arrow keys, Tab, Enter): success notice; the VA instruction and the total incl. the channel fee; no second Bayar",
      focused === "Bayar" && /Nomor VA:/.test(after) && /Total dibayar[\s\S]*biaya channel/.test(after)
        && (await list(own.p).locator(":scope > li").filter({ hasText: cur.number }).getByRole("button", { name: "Bayar" }).count()) === 0 && !leak(await own.p.content())]);
    await layouts(own.p, "/saya/tagihan-server", "owner-paying");
    // review r1 P1: QRIS — the instruction is a scannable code. An independent decoder (jsQR, outside the app; QR_DECODER_DIR) reads the
    // rendered image and must return the provider's payload; the amount, the channel fee and the expiry stay visible.
    const qItem = () => list(own.p).locator(":scope > li").filter({ hasText: seed.qris.number });
    await qItem().getByLabel("Metode bayar").selectOption("QRIS");
    await qItem().getByRole("button", { name: "Bayar" }).click();
    await own.p.waitForURL(/\/saya\/tagihan-server\?ok=dibuat/);
    const code = qItem().getByRole("img", { name: `Kode QRIS untuk ${seed.qris.number}` });
    await code.waitFor();
    const png = await code.screenshot();
    const dir = process.env.QR_DECODER_DIR!;
    const { PNG } = (await import(`${dir}/node_modules/pngjs/lib/png.js`)).default as { PNG: { sync: { read(b: Buffer): { width: number; height: number; data: Buffer } } } };
    const jsQR = (await import(`${dir}/node_modules/jsqr/dist/jsQR.js`)).default as (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
    const img = PNG.sync.read(png);
    const decoded = jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? "";
    const qText = await qItem().innerText();
    flow.push(["QRIS: the code renders and decodes (independent decoder) to the provider payload; amount, channel fee and expiry visible", /^000201/.test(decoded)
      && decoded === (await qItem().locator("pre").textContent())?.trim() && /Total dibayar[\s\S]*biaya channel[\s\S]*bayar sebelum/.test(qText) && !leak(await own.p.content())]);
    await own.p.setViewportSize({ width: 390, height: 900 });
    await own.p.screenshot({ path: `${OUT}/owner-qris-390.png`, fullPage: true });
    await own.p.setViewportSize({ width: 1440, height: 900 });
    await own.c.close();
    for (const [who, ip] of [["ap", "203.0.113.32"], ["au", "203.0.113.33"]] as const) {
      const r = await open(who, ip);
      await r.p.goto(`${BASE}/saya/tagihan-server`);
      await list(r.p).waitFor();
      flow.push([`${who === "ap" ? "Admin Pusat" : "the auditor"} reads the invoices without Bayar`, (await r.p.getByRole("button", { name: "Bayar" }).count()) === 0
        && (await main(r.p)).includes(cur.number)]);
      if (who === "au") await layouts(r.p, "/saya/tagihan-server", "auditor");
      await r.c.close();
    }
    const mgr = await open("mgr", "203.0.113.34");
    await mgr.p.goto(`${BASE}/saya/tagihan-server`);
    await mgr.p.getByRole("heading", { level: 1 }).waitFor();
    flow.push(["a manager has no access (permission state)", /Anda tidak memiliki akses ke tagihan server/.test(await main(mgr.p)) && (await mgr.p.getByRole("form").count()) === 0]);
    await layouts(mgr.p, "/saya/tagihan-server", "tanpa-akses");
    await mgr.c.close();
    const ob = await open("ownb", "203.0.113.35");
    await ob.p.goto(`${BASE}/saya/tagihan-server`);
    await ob.p.getByRole("heading", { level: 1 }).waitFor();
    flow.push(["a clinic without invoices sees the empty state", /Belum ada tagihan server/.test(await main(ob.p))]);
    await ob.c.close();
  } else {
    const fin = await open("fin", "203.0.113.36");
    await fin.p.goto(`${BASE}/saya/tagihan-server`);
    await list(fin.p).waitFor();
    flow.push(["blocked: the fee bearer undecided → \"Pembayaran belum tersedia\" and no Bayar anywhere", /Pembayaran belum tersedia/.test(await main(fin.p))
      && (await fin.p.getByRole("button", { name: "Bayar" }).count()) === 0]);
    await layouts(fin.p, "/saya/tagihan-server", "finance-blocked");
    flow.push(["nothing secret on the blocked page", !leak(await fin.p.content())]);
    await fin.c.close();
  }
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
