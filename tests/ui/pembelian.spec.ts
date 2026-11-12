// T-067 browser evidence (Pembelian, UX-52, 17:180/186, 19:141–145, PR-90) at 390/820/1180/1440 and 200 % text.
// Purchasing lands on PO (the sent PO with its total) and saves a new draft; the pharmacist reads the PO without money,
// is refused a batch without expiry (UX-52 blocked copy), receives part of the PO, has no access to Utang and opens
// Transfer; finance lands on Utang, records the invoice from the uninvoiced receipt (Rp5,000,000), pays Rp2,000,000 and
// sees Rp3,000,000 outstanding (scenario PR-90); the owner reads Pemasok and Retur. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/pembelian.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; po: string; branches: Record<string, string> };
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
  const q = `?cabang=${seed.branches.b1}`;

  // Purchasing: /pembelian lands on PO; the sent PO and its detail; a new PO draft.
  const pur = await open("pur", "203.0.113.181");
  await pur.p.goto(`${BASE}/pembelian`);
  await pur.p.waitForURL(`${BASE}/pembelian/po`);
  await pur.p.getByRole("heading", { name: /^Purchase Order/, level: 1 }).waitFor();
  // a tenant-wide role picks the branch: the seeded PO is at Cabang Kemang
  await pur.p.goto(`${BASE}/pembelian/po${q}`);
  await pur.p.getByRole("heading", { name: "Purchase Order · Cabang Kemang", level: 1 }).waitFor();
  flow.push(["purchasing lands on PO; the sent PO listed with its total", /PO-\d{6}-\d{4}[\s\S]*Terkirim[\s\S]*PT Farma Nusantara[\s\S]*Rp/.test(await main(pur.p))]);
  await layouts(pur.p, `/pembelian/po${q}`, "po");
  await pur.p.getByRole("button", { name: "Buat PO" }).click();
  const poForm = pur.p.getByRole("form", { name: "Buat PO" });
  await poForm.getByLabel("Pemasok").selectOption({ label: "CV Medika Jaya" });
  await poForm.getByLabel("Item 1").selectOption({ label: "Kasa Steril (lembar)" });
  await poForm.getByLabel("Jumlah").fill("50");
  await poForm.getByLabel("Harga satuan (Rp)").fill("1500");
  await poForm.getByRole("button", { name: "Simpan Draf" }).click();
  await ok(pur.p, "PO dibuat sebagai draf.");
  await pur.p.reload();
  flow.push(["a new PO saved as a draft", /Draf[\s\S]*CV Medika Jaya/.test(await main(pur.p))]);
  await pur.c.close();

  // Pharmacist: receive the sent PO with batch, expiry, quantity (no price shown), then a missing expiry is refused.
  const ph = await open("ph", "203.0.113.182");
  await ph.p.goto(`${BASE}/pembelian/po/${seed.po}`);
  await ph.p.getByRole("heading", { level: 1 }).waitFor();
  const det = await main(ph.p);
  flow.push(["pharmacist reads the PO without money", /Serum Hialuronat: dipesan 10/.test(det) && !/Rp/.test(det)]);
  await layouts(ph.p, `/pembelian/po/${seed.po}`, "po-rinci");
  await ph.p.getByRole("button", { name: "Terima Barang" }).click();
  const rf = ph.p.getByRole("form", { name: "Terima barang" });
  await rf.getByLabel("Nomor batch").first().fill("SRM-25B");
  await rf.getByLabel("Jumlah diterima").first().fill("4");
  await rf.getByRole("button", { name: "Simpan Penerimaan" }).click();
  await ph.p.getByRole("alert").filter({ hasText: "Batch tanpa tanggal kedaluwarsa tidak dapat diterima" }).first().waitFor();
  flow.push(["UX-52 blocked copy: a batch without expiry is refused", true]);
  // the form remounts after every answer (a fresh key): fill it again
  await rf.getByLabel("Nomor batch").first().fill("SRM-25B");
  await rf.getByLabel("Kedaluwarsa").first().fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
  await rf.getByLabel("Jumlah diterima").first().fill("4");
  await rf.getByRole("button", { name: "Simpan Penerimaan" }).click();
  await ph.p.getByText("Diterima sebagian").first().waitFor();
  flow.push(["partial receipt against the PO: partially received", /diterima 4/.test(await main(ph.p))]);
  await ph.p.goto(`${BASE}/pembelian/utang`);
  await ph.p.getByText("Anda tidak memiliki akses ke pembelian.").waitFor();
  flow.push(["pharmacist: no access to Utang", true]);
  await ph.p.goto(`${BASE}/pembelian/transfer`);
  await ph.p.getByRole("heading", { name: /^Transfer/, level: 1 }).waitFor();
  await layouts(ph.p, "/pembelian/transfer", "transfer");
  await ph.c.close();

  // Finance: Utang lands; record the invoice from the uninvoiced receipt (Rp5,000,000), pay Rp2,000,000 → Rp3,000,000.
  const fin = await open("fin", "203.0.113.183", true); // finance enrols a second factor first
  await fin.p.goto(`${BASE}/pembelian`);
  await fin.p.waitForURL(`${BASE}/pembelian/utang`);
  await fin.p.getByRole("heading", { name: /^Utang Pemasok/, level: 1 }).waitFor();
  await fin.p.goto(`${BASE}/pembelian/utang${q}`); // a tenant-wide role picks the branch
  await fin.p.getByRole("heading", { name: "Utang Pemasok · Cabang Kemang", level: 1 }).waitFor();
  flow.push(["finance lands on Utang; the uninvoiced receipt and the expected credit shown", /Belum difakturkan[\s\S]*Serum Hialuronat[\s\S]*Rp\s?5\.000\.000/.test(await main(fin.p)) && /Nota kredit ditunggu/.test(await main(fin.p))]);
  await fin.p.getByRole("button", { name: "Catat Faktur" }).click();
  const inv = fin.p.getByRole("form", { name: "Catat faktur" });
  await inv.getByLabel("Pemasok").selectOption({ label: "PT Farma Nusantara" });
  await inv.getByLabel("Nomor faktur").fill("INV/FN/0091");
  // the scenario's receipt only (Rp5,000,000): leave the pharmacist's partial kasa receipt for another invoice
  await inv.getByLabel(/Kasa Steril/).uncheck();
  await inv.getByRole("button", { name: "Simpan Faktur" }).click();
  // the form is replaced by the invoice row (wait for the new view, not the form's status)
  await fin.p.getByText("INV/FN/0091").first().waitFor();
  flow.push(["the invoice recorded from the receipt at its GRNI", /INV\/FN\/0091[\s\S]*total Rp\s?5\.000\.000/.test(await main(fin.p))]);
  await fin.p.getByRole("heading", { name: /^Utang Pemasok/, level: 1 }).waitFor();
  await fin.p.getByRole("button", { name: "Bayar" }).first().click();
  const pay = fin.p.getByRole("form", { name: "Bayar faktur" });
  await pay.getByLabel("Jumlah (Rp)").fill("2000000");
  await pay.getByRole("button", { name: "Simpan Pembayaran" }).click();
  // the invoice row re-renders with the new outstanding (the Bayar sheet goes with it)
  await fin.p.getByText(/sisa Rp\s?3\.000\.000/).first().waitFor();
  const ut = await main(fin.p);
  flow.push(["PR-90: the payable shows Rp3,000,000 outstanding", /INV\/FN\/0091[\s\S]*sisa Rp\s?3\.000\.000/.test(ut)]);
  await layouts(fin.p, `/pembelian/utang${q}`, "utang");
  await fin.c.close();

  // Owner reads Pemasok and Retur.
  const own = await open("own", "203.0.113.184", true);
  await own.p.goto(`${BASE}/pembelian/pemasok${q}`);
  await own.p.getByRole("heading", { name: "Pemasok", level: 1 }).waitFor();
  flow.push(["owner: the supplier master with terms", /PT Farma Nusantara[\s\S]*Syarat bayar 30 hari/.test(await main(own.p))]);
  await layouts(own.p, `/pembelian/pemasok${q}`, "pemasok");
  await own.p.goto(`${BASE}/pembelian/retur${q}`);
  await own.p.getByRole("heading", { name: /^Retur/, level: 1 }).waitFor();
  flow.push(["retur listed with its reason and the credit note awaited", /Rusak[\s\S]*Nota kredit ditunggu/.test(await main(own.p))]);
  await own.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
