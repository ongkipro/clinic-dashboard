// T-072 browser evidence (Kasir UX-12, 19:111–117, PR-19) at 390/820/1180/1440 and 200 % text. The cashier sees the
// visit with a confirmed selection in Siap Ditagih, issues its tagihan (frozen price, tax badge), takes part in cash with
// change and the rest by EDC (split tender, "Terima Rp…", the remaining amount), opens the struk; sells a product in
// Jual Cepat (paid, then listed for the pharmacist as "Penjualan langsung"); a second cashier requests a void with a
// reason, the manager approves it in Persetujuan (requester ≠ approver); QRIS, link and Saldo are shown unavailable with
// their reason; the owner reads a chosen branch; the auditor sees the tagihan masked. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/kasir.spec.ts out-dir
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

  // FO/cashier: Siap Ditagih → Buat Tagihan → Terbitkan → Terima (split: cash with change + EDC) → Struk.
  const fo = await open("fo", "203.0.113.201");
  await fo.p.goto(`${BASE}/kasir`);
  await fo.p.getByRole("heading", { name: /^Kasir · Cabang Kemang/, level: 1 }).waitFor();
  flow.push(["Siap Ditagih lists the visit with a confirmed selection", /Dewi Lestari · RM-0000000072001/.test(await main(fo.p))]);
  await layouts(fo.p, "/kasir", "kasir");
  await fo.p.getByRole("link", { name: /Dewi Lestari/ }).first().click();
  await fo.p.getByRole("heading", { name: "Buat Tagihan", level: 1 }).waitFor();
  flow.push(["Buat Tagihan prefills the selection at the branch price", /Serum Vitamin C[\s\S]*Rp333\.000 × 1/.test(await main(fo.p))]);
  await layouts(fo.p, `/kasir/kunjungan/${seed.visit}`, "buat-tagihan");
  await fo.p.getByRole("button", { name: "Terbitkan Tagihan" }).click();
  await ok(fo.p, /Tagihan INV-KMG-\d{6}-0001 diterbitkan/);
  await fo.p.getByRole("link", { name: "Lanjut ke Pembayaran" }).click();
  await fo.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  const inv = fo.p.url().replace(BASE, "");
  const t0 = await main(fo.p);
  flow.push(["the tagihan: frozen price, tax badge, remaining amount, unavailable tenders named",
    /Serum Vitamin C[\s\S]*Rp333\.000/.test(t0) && /PPN/.test(t0) && /Sisa Rp333\.000/.test(t0) && /QRIS: Belum tersedia — menunggu port pembayaran/.test(t0) && /Saldo: Saldo pasien belum aktif/.test(t0)]);
  flow.push(["QRIS, Link and Saldo chips are disabled",
    (await fo.p.getByRole("button", { name: "QRIS" }).getAttribute("disabled")) !== null && (await fo.p.getByRole("button", { name: "Saldo" }).getAttribute("disabled")) !== null]);
  await layouts(fo.p, inv, "tagihan");
  const tf = fo.p.getByRole("form", { name: "Terima pembayaran" });
  await tf.getByLabel("Jumlah Tunai").fill("200000");
  await tf.getByLabel("Uang diterima").fill("250000");
  await tf.getByRole("button", { name: "Bagi Pembayaran" }).click();
  await tf.getByRole("group", { name: "Metode bayar 2" }).getByRole("button", { name: "EDC" }).click();
  await tf.getByLabel("Jumlah EDC").fill("133000");
  await tf.getByLabel("Bank").first().fill("BCA");
  flow.push(["the prominent button names the amount", (await tf.getByRole("button", { name: "Terima Rp333.000" }).count()) === 1]);
  await tf.getByRole("button", { name: "Terima Rp333.000" }).click();
  await ok(fo.p, /Pembayaran diterima\. Struk KW-KMG-\d{6}-0001/);
  flow.push(["cash change shown after the Terima", /Kembalian Rp50\.000/.test(await main(fo.p))]);
  await fo.p.getByRole("link", { name: "Lihat Struk" }).click();
  await fo.p.getByRole("heading", { name: /^Struk KW-KMG-/, level: 1 }).waitFor();
  const struk = await main(fo.p);
  flow.push(["the struk: commercial facts only (items, total, methods)", /Serum Vitamin C × 1/.test(struk) && /Total dibayar Rp333\.000/.test(struk) && /Tunai Rp200\.000. EDC Rp133\.000/.test(struk)]);
  await layouts(fo.p, fo.p.url().replace(BASE, ""), "struk");
  await fo.p.goto(`${BASE}${inv}`);
  await fo.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  flow.push(["paid in full: Lunas, no tender sheet, no void", /Lunas/.test(await main(fo.p)) && (await fo.p.getByRole("form", { name: "Terima pembayaran" }).count()) === 0
    && (await fo.p.getByRole("button", { name: "Ajukan Void" }).count()) === 0]);

  // Jual Cepat: a tabir surya; pay; the pharmacist sees it in Siapkan.
  await fo.p.goto(`${BASE}/kasir/jual-cepat`);
  await fo.p.getByRole("heading", { name: /^Jual Cepat · Cabang Kemang/, level: 1 }).waitFor();
  await layouts(fo.p, "/kasir/jual-cepat", "jual-cepat");
  const jf = fo.p.getByRole("form", { name: "Jual cepat" });
  await jf.getByLabel("Tambah produk").selectOption({ label: "Tabir Surya SPF 50 · Rp222.000" });
  await jf.getByRole("button", { name: "Tambah", exact: true }).click();
  await jf.getByRole("button", { name: "Terbitkan Tagihan" }).click();
  await ok(fo.p, /Tagihan INV-KMG-\d{6}-0002 diterbitkan/);
  await fo.p.getByRole("link", { name: "Lanjut ke Pembayaran" }).click();
  await fo.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  flow.push(["the counter tagihan waits for the pharmacist", /Menunggu penyerahan apoteker/.test(await main(fo.p))]);
  await fo.p.getByRole("form", { name: "Terima pembayaran" }).getByRole("button", { name: "Terima Rp222.000" }).click();
  await ok(fo.p, /Pembayaran diterima/);
  await fo.c.close();

  const ph = await open("ph", "203.0.113.202");
  await ph.p.goto(`${BASE}/apotek/siapkan`);
  await ph.p.getByRole("heading", { level: 1 }).waitFor();
  const prep = await main(ph.p);
  flow.push(["Siapkan lists the counter sale as Penjualan langsung", /Penjualan langsung/.test(prep) && /Tabir Surya SPF 50/.test(prep)]);
  await layouts(ph.p, "/apotek/siapkan", "apotek-siapkan");
  await ph.c.close();

  // Void: a second cashier requests on an unpaid tagihan; the manager approves in Persetujuan.
  const fo2 = await open("fo2", "203.0.113.203");
  await fo2.p.goto(`${BASE}/kasir/jual-cepat`);
  await fo2.p.getByRole("heading", { name: /^Jual Cepat/, level: 1 }).waitFor();
  const jf2 = fo2.p.getByRole("form", { name: "Jual cepat" });
  await jf2.getByLabel("Tambah produk").selectOption({ label: "Serum Vitamin C · Rp333.000" });
  await jf2.getByRole("button", { name: "Tambah", exact: true }).click();
  await jf2.getByRole("button", { name: "Terbitkan Tagihan" }).click();
  await ok(fo2.p, /diterbitkan/);
  await fo2.p.getByRole("link", { name: "Lanjut ke Pembayaran" }).click();
  await fo2.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  const vinv = fo2.p.url().replace(BASE, "");
  await layouts(fo2.p, vinv, "void-form", async () => { await fo2.p.getByRole("button", { name: "Ajukan Void" }).click(); await fo2.p.getByLabel("Alasan void").waitFor(); });
  await fo2.p.getByRole("button", { name: "Ajukan Void" }).click();
  await fo2.p.getByLabel("Alasan void").fill("Pasien batal membeli");
  await fo2.p.getByRole("button", { name: "Kirim Pengajuan Void" }).click();
  // the page revalidates into the pending view (the form is replaced): wait for the new view
  await fo2.p.getByText("Void sedang diajukan").first().waitFor();
  await fo2.p.goto(`${BASE}${vinv}`);
  await fo2.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  flow.push(["while the void is pending, no payment", /Void sedang diajukan/.test(await main(fo2.p)) && (await fo2.p.getByRole("form", { name: "Terima pembayaran" }).count()) === 0]);
  await fo2.p.goto(`${BASE}/kasir/terbuka`);
  await fo2.p.getByRole("heading", { name: /^Tagihan Terbuka/, level: 1 }).waitFor();
  flow.push(["Tagihan Terbuka shows the pending void", /void diajukan/.test(await main(fo2.p))]);
  await layouts(fo2.p, "/kasir/terbuka", "terbuka");
  await fo2.c.close();

  const mgr = await open("mgr", "203.0.113.204", true);
  await mgr.p.goto(`${BASE}/persetujuan`);
  await mgr.p.getByRole("heading", { level: 1 }).waitFor();
  // the row of the list (the filter chip of the same name is a link too)
  await mgr.p.getByRole("list", { name: "Permintaan menunggu" }).locator("li").filter({ hasText: "Pasien batal membeli" }).first().locator("a").click();
  await mgr.p.getByRole("button", { name: "Setujui" }).first().waitFor();
  await mgr.p.getByRole("button", { name: "Setujui" }).first().click();
  await mgr.p.waitForTimeout(1500);
  await mgr.p.goto(`${BASE}${vinv}`);
  await mgr.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  const vt = await main(mgr.p);
  flow.push(["the manager approves on the issue day: the tagihan is Dibatalkan", /Dibatalkan/.test(vt) && /Tagihan dibatalkan/.test(vt)]);
  await mgr.c.close();

  // Owner reads a chosen branch; the auditor sees the patient masked.
  const own = await open("own", "203.0.113.205", true);
  await own.p.goto(`${BASE}/kasir?cabang=${seed.branches.b1}`);
  await own.p.getByRole("heading", { name: "Kasir · Cabang Kemang", level: 1 }).waitFor();
  flow.push(["owner: branch chips and the Kemang queue", (await own.p.getByRole("group", { name: "Cabang" }).count()) === 1 && /INV-KMG-/.test(await main(own.p))]);
  await own.c.close();
  const au = await open("au", "203.0.113.206", true);
  await au.p.goto(`${BASE}${inv}`);
  await au.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  const masked = await main(au.p);
  flow.push(["auditor: the patient masked, no tender sheet", !/Dewi Lestari/.test(masked) && /\*\*\*001/.test(masked) && (await au.p.getByRole("form", { name: "Terima pembayaran" }).count()) === 0]);
  await au.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
