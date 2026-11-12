// T-073 browser evidence (Simulasi Pembayaran UX-56 and the Kasir's Bayar Lewat Port, PR-68) at 390/820/1180/1440 and
// 200 % text: the manager enables the mock port on Simulasi (SIMULASI banner); the cashier issues a tagihan, creates a
// QRIS charge (SIMULASI), Cek Status changes nothing while the gateway waits; on Simulasi, Lunas sends a signed webhook
// that applies, Kirim Ulang Webhook is a duplicate and ignored; the tagihan shows one SIMULASI receipt and the
// remaining amount unchanged (simulated money never counts, BILL-29). No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/simulasi.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branches: Record<string, string>; visit: string; dewi: string; ayu: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator; uncheck(): Promise<void>;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; getAttribute(n: string): Promise<string | null>; selectOption(v: string | object): Promise<unknown>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>; reload(): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
};
async function signIn(page: Page, email: string, totpRole: boolean) {
  await page.goto(`${BASE}/masuk`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);
  if (!totpRole) return;
  await page.goto(`${BASE}/staf`);
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
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round((["checkbox", "radio"].includes((e as HTMLInputElement).type) && (e.closest("label") ?? e.closest("li")) ? (e.closest("label") ?? e.closest("li"))! : e).getBoundingClientRect().height))) : null,
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      // Text squeezed to a sliver: a block narrower than four characters of its own font that breaks onto more than
      // three lines (one letter per line at 200 %); visually hidden text (sr-only) is not laid out for reading.
      squeezed: [...document.querySelectorAll("main dd, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight) || em * 1.2;
        return !e.classList.contains("sr-only") && cs.display !== "inline" && r.width > 0 && r.width < 4 * em && r.height > 3 * lh && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}:${(e.textContent || "").trim().slice(0, 30)}`),
      // when the page scrolls sideways, name what sticks out anywhere in the document (no tolerance)
      overflowBy: document.documentElement.scrollWidth > innerWidth
        ? [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth).slice(0, 4).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 50)}@${e.getBoundingClientRect().right.toFixed(1)}`)
        : [],
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}@${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}/${innerWidth}`),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, name: string, prep?: () => Promise<void>) {
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE}${path}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      if (prep) await prep();
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

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();
  const open = async (who: string, ip: string, totpRole = false) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const ok = async (p: Page, text: string | RegExp) => p.getByRole("status").filter({ hasText: text }).first().waitFor();

  // Manager: Simulasi before the port exists → Aktifkan Port Simulasi (UX-56; non-production).
  const mgr = await open("mgr", "203.0.113.211", true);
  await mgr.p.goto(`${BASE}/simulasi`);
  await mgr.p.getByRole("heading", { name: "Simulasi Pembayaran", level: 1 }).waitFor();
  const s0 = await main(mgr.p);
  flow.push(["Simulasi: the SIMULASI banner and 'port belum aktif'", /SIMULASI — gateway tiruan/.test(s0) && /Port simulasi belum aktif/.test(s0)]);
  await mgr.p.getByRole("button", { name: "Aktifkan Port Simulasi" }).click();
  await mgr.p.getByText(/Belum ada tagihan QRIS, VA, atau Link/).first().waitFor();
  flow.push(["the manager enables the mock port", (await mgr.p.getByRole("button", { name: "Aktifkan Port Simulasi" }).count()) === 0]);
  // The manager's session stays open (2FA enrolled once) for the last step.

  // FO: a tagihan for the visit; Bayar Lewat Port → QRIS charge (SIMULASI), pending.
  const fo = await open("fo", "203.0.113.212");
  await fo.p.goto(`${BASE}/kasir/kunjungan/${seed.visit}`);
  await fo.p.getByRole("heading", { name: "Buat Tagihan", level: 1 }).waitFor();
  await fo.p.getByRole("button", { name: "Terbitkan Tagihan" }).click();
  await fo.p.getByRole("link", { name: "Lanjut ke Pembayaran" }).click();
  await fo.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  const inv = fo.p.url().replace(BASE, "");
  const t0 = await main(fo.p);
  flow.push(["the tagihan offers Bayar Lewat Port with SIMULASI; the tender sheet points QRIS/VA/Link there",
    /Bayar Lewat Port/.test(t0) && /SIMULASI — tidak ada uang sungguhan/.test(t0) && /QRIS, VA, dan Link: gunakan Bayar Lewat Port/.test(t0)]);
  await layouts(fo.p, inv, "tagihan-port");
  const pf = fo.p.getByRole("form", { name: "Buat tagihan port" });
  await pf.getByRole("button", { name: "Buat QRIS Rp333.000" }).click();
  await fo.p.getByText(/QRIS Rp333\.000 · menunggu pembayaran/).first().waitFor();
  flow.push(["a pending QRIS charge with its order number and Cek Status; no cash sheet while it waits", (await fo.p.getByRole("button", { name: "Cek Status" }).count()) === 1
    && /Nomor pesanan [A-Z0-9]{8}-[0-9a-f]{32}/.test(await main(fo.p)) && (await fo.p.getByRole("form", { name: "Terima pembayaran" }).count()) === 0]);
  await layouts(fo.p, inv, "tagihan-qris-pending");
  // Cek Status before the gateway pays: nothing changes.
  await fo.p.getByRole("button", { name: "Cek Status" }).click();
  await ok(fo.p, "Belum ada perubahan dari port.");

  // Simulasi: the charge listed; Lunas sends a signed webhook → applied; Kirim Ulang Webhook → duplicate, ignored.
  await fo.p.goto(`${BASE}/simulasi`);
  await fo.p.getByRole("heading", { name: "Simulasi Pembayaran", level: 1 }).waitFor();
  flow.push(["Simulasi lists the pending QRIS charge with the gateway state and its tagihan", /QRIS Rp333\.000[\s\S]*Menunggu[\s\S]*gateway: pending[\s\S]*Buka INV-KMG-/.test(await main(fo.p))]);
  await layouts(fo.p, "/simulasi", "simulasi");
  await fo.p.getByRole("group", { name: /^Simulasi QRIS/ }).getByRole("button", { name: "Lunas" }).click();
  await ok(fo.p, "Webhook diterima dan diterapkan.");
  await fo.p.goto(`${BASE}/simulasi`);
  await fo.p.getByRole("group", { name: /^Simulasi QRIS/ }).getByRole("button", { name: "Kirim Ulang Webhook" }).click();
  await ok(fo.p, "Webhook ganda diabaikan (tidak ada pembayaran kedua).");

  // The tagihan: one SIMULASI receipt; the line still unpaid in real money (BILL-29).
  await fo.p.goto(`${BASE}${inv}`);
  await fo.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  const t1 = await main(fo.p);
  flow.push(["one receipt marked SIMULASI; the remaining amount unchanged (simulated money never counts)",
    (t1.match(/SIMULASI · QRIS Rp333\.000/g) ?? []).length === 1 && /Sisa Rp333\.000/.test(t1)]);
  await fo.p.getByRole("link", { name: /^KW-KMG-/ }).first().click();
  await fo.p.getByRole("heading", { name: /^Struk KW-KMG-/, level: 1 }).waitFor();
  flow.push(["the struk begins with SIMULASI and names QRIS", /^SIMULASI[\s\S]*QRIS Rp333\.000/.test((await fo.p.locator("main pre").innerText()).trim())]);
  await layouts(fo.p, fo.p.url().replace(BASE, ""), "struk-simulasi");

  // A second charge (the line still owes real money): Kedaluwarsa closes it; a third is cancelled from the Kasir.
  await fo.p.goto(`${BASE}${inv}`);
  await fo.p.getByRole("form", { name: "Buat tagihan port" }).getByRole("button", { name: "Buat QRIS Rp333.000" }).click();
  await fo.p.getByText(/QRIS Rp333\.000 · menunggu pembayaran/).first().waitFor();
  await fo.p.goto(`${BASE}/simulasi`);
  await fo.p.getByRole("group", { name: /^Simulasi QRIS/ }).first().getByRole("button", { name: "Kedaluwarsa" }).click();
  await ok(fo.p, "Webhook diterima dan diterapkan.");
  await fo.p.goto(`${BASE}/simulasi`);
  flow.push(["Kedaluwarsa closes the charge (gateway and clinic)", /Kedaluwarsa[\s\S]*gateway: expired/.test(await main(fo.p))]);
  await fo.p.goto(`${BASE}${inv}`);
  await fo.p.getByRole("form", { name: "Buat tagihan port" }).getByRole("button", { name: "Buat QRIS Rp333.000" }).click();
  await fo.p.getByRole("button", { name: "Batalkan" }).click();
  await fo.p.getByRole("form", { name: "Buat tagihan port" }).waitFor();
  flow.push(["Batalkan a pending charge: the cash sheet is back", (await fo.p.getByRole("form", { name: "Terima pembayaran" }).count()) === 1]);
  await fo.c.close();

  // The manager reads Simulasi with every charge of the branch.
  current = mgr.p;
  await mgr.p.goto(`${BASE}/simulasi`);
  await mgr.p.getByRole("heading", { name: "Simulasi Pembayaran", level: 1 }).waitFor();
  const sm = await main(mgr.p);
  flow.push(["the manager sees the paid, expired and cancelled charges", /Lunas/.test(sm) && /Kedaluwarsa/.test(sm) && /Dibatalkan/.test(sm)]);
  await layouts(mgr.p, "/simulasi", "simulasi-manajer");
  await mgr.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
