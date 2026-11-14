// T-084 browser evidence (Biaya Operasional & Kas Kecil, UX-22 ▸ Biaya, PR-79) at 390/820/1180/1440 and 200 % text: finance reads the
// period's expenses with totals per branch, filters by funding (rows, filtered-empty) and branch; records a petty-cash expense with a
// receipt (a missing receipt refused first) and an unpaid expense (one payable, visible in Pembelian › Utang); reverses the unpaid one
// (its payable with it); a paid one cannot be reversed; the manager records at the active branch and reads only it; the receipt preview
// renders; the auditor reads without forms; admin pusat has no access; a clinic without categories shows the blocked state and its
// owner adds the first category. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/biaya.spec.ts out-dir
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

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
  password: string; people: Record<string, { email: string; staffId: string }>; branches: Record<string, string>; categories: Record<string, string>;
  expenses: { bsd: string; petty: string; paid: string }; early: string; today: string;
};
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator; uncheck(): Promise<void>; inputValue(): Promise<string>; setInputFiles(f: { name: string; mimeType: string; buffer: Buffer }): Promise<void>;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; getAttribute(n: string): Promise<string | null>; selectOption(v: string | object): Promise<unknown>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; url(): string; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>; reload(): Promise<unknown>;
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
      smallest: ctl.map((e) => { const t = (["checkbox", "radio"].includes((e as HTMLInputElement).type) && (e.closest("label") ?? e.closest("li")) ? (e.closest("label") ?? e.closest("li"))! : e); return [Math.round(t.getBoundingClientRect().height), `${t.tagName}.${(t.getAttribute("type") ?? "")}:${(t.textContent ?? "").trim().slice(0, 30)}`] as const; })
        .filter(([hgt]) => hgt < 44).slice(0, 4).map(([hgt, d]) => `${hgt}:${d}`),
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

function png(): Buffer {
  const w = 48, h = 32;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill(y % 8 < 2 ? 140 : 240, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t), d]))); return Buffer.concat([l, Buffer.from(t), d, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

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
  const L = "/keuangan/biaya";
  const openSheet = async (p: Page) => {
    if ((await p.getByRole("form", { name: "Catat biaya" }).count()) === 0) await p.getByRole("button", { name: "Catat Biaya" }).click();
    await p.getByRole("form", { name: "Catat biaya" }).waitFor();
    return p.getByRole("form", { name: "Catat biaya" });
  };

  // Finance: the period's expenses (both branches), the totals, funding and branch filters.
  const fin = await open("fin", "203.0.113.241", true);
  await fin.p.goto(`${BASE}${L}`);
  await fin.p.getByRole("region", { name: "Total biaya periode" }).waitFor();
  const l0 = await main(fin.p);
  flow.push(["finance reads the period: three expenses of both branches, total Rp980.000 with per-branch totals",
    /Rp980\.000/.test(l0) && /Cabang Kemang Rp735\.000/.test(l0) && /Cabang BSD Rp245\.000/.test(l0) && /Ongkos kurir/.test(l0) && /Kertas dan tinta/.test(l0) && /Utang lunas/.test(l0)]);
  await layouts(fin.p, L, "biaya");
  await fin.p.goto(`${BASE}${L}?dana=petty_cash`);
  await fin.p.getByRole("region", { name: "Total biaya periode" }).waitFor();
  const l1 = await main(fin.p);
  await fin.p.goto(`${BASE}${L}?dana=cash`);
  await fin.p.getByText("Tidak ada biaya yang cocok dengan filter.").waitFor();
  await layouts(fin.p, `${L}?dana=cash`, "biaya-filtered-empty");
  await fin.p.goto(`${BASE}${L}?cabang=${seed.branches.b2}`);
  await fin.p.getByRole("region", { name: "Total biaya periode" }).waitFor();
  const l2 = await main(fin.p);
  flow.push(["funding and branch filters: Kas Kecil only the courier fare; Tunai filtered-empty with Hapus Filter; BSD only its paper",
    /Ongkos kurir/.test(l1) && !/Kertas dan tinta/.test(l1) && (await fin.p.getByRole("link", { name: "Hapus Filter" }).count()) === 0
    && /Kertas dan tinta/.test(l2) && !/Ongkos kurir/.test(l2)]);

  // Catat Biaya: petty cash without a receipt refused; then with the receipt.
  await fin.p.goto(`${BASE}${L}`);
  let f = await openSheet(fin.p);
  await layouts(fin.p, L, "biaya-form", async () => { await openSheet(fin.p); });
  f = await openSheet(fin.p);
  await f.getByLabel("Cabang").selectOption(seed.branches.b1);
  await f.getByLabel("Kategori").selectOption(seed.categories.transport);
  await f.getByLabel("Jumlah (Rp)").fill("120.000");
  await f.getByLabel("Keterangan").fill("Parkir dan tol antar sampel lab");
  // The browser's own required check would stop the submit: drop it to prove the server refuses too.
  await fin.p.evaluate(() => document.querySelectorAll("input[name=receipt]").forEach((e) => e.removeAttribute("required")));
  await f.getByRole("button", { name: "Simpan Biaya" }).click();
  await fin.p.getByRole("alert").filter({ hasText: "wajib dilampiri bukti" }).first().waitFor();
  await measure(fin.p, "biaya-form-error-1440", "biaya-form-error-1440");
  flow.push(["a petty-cash expense without a receipt is refused; the sheet stays open with the description kept",
    (await fin.p.getByRole("form", { name: "Catat biaya" }).getByLabel("Keterangan").inputValue()) === "Parkir dan tol antar sampel lab"]);
  f = await openSheet(fin.p);
  await f.getByLabel("Cabang").selectOption(seed.branches.b1);
  await f.getByLabel("Kategori").selectOption(seed.categories.transport);
  await f.getByLabel("Jumlah (Rp)").fill("120.000");
  await f.getByLabel("Keterangan").fill("Parkir dan tol antar sampel lab");
  await f.getByLabel("Bukti (wajib)").setInputFiles({ name: "parkir.png", mimeType: "image/png", buffer: png() });
  await f.getByRole("button", { name: "Simpan Biaya" }).click();
  await fin.p.waitForURL(/\/keuangan\/biaya\/[0-9a-f-]{36}\?tanggal=.*&baru=1/);
  await fin.p.getByRole("img", { name: /Bukti biaya Transportasi/ }).waitFor();
  const d1 = await main(fin.p);
  const ok1 = await fin.p.evaluate(() => { const i = document.querySelector("main img") as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth === 48; });
  flow.push(["recorded with its receipt: the detail shows Biaya dicatat, Kas Kecil, the receipt preview rendered", /Biaya dicatat/.test(d1) && /Kas Kecil/.test(d1) && ok1]);
  await layouts(fin.p, fin.p.url().replace(BASE, "").replace("&baru=1", ""), "biaya-detail");

  // Belum Dibayar: one payable, visible in Pembelian › Utang; then reversed with it.
  await fin.p.goto(`${BASE}${L}`);
  f = await openSheet(fin.p);
  await f.getByLabel("Cabang").selectOption(seed.branches.b1);
  await f.getByLabel("Kategori").selectOption(seed.categories.ac);
  await f.getByLabel("Jumlah (Rp)").fill("430000");
  await f.getByLabel("Belum Dibayar").check();
  await f.getByLabel("Pemasok", { exact: true }).waitFor();
  await f.getByLabel("No. faktur pemasok (opsional)").fill("SAS/2026/131");
  await f.getByLabel("Keterangan").fill("Ganti freon AC ruang tunggu");
  await layouts(fin.p, L, "biaya-form-unpaid", async () => { const g = await openSheet(fin.p); await g.getByLabel("Belum Dibayar").check(); await g.getByLabel("Pemasok", { exact: true }).waitFor(); });
  f = await openSheet(fin.p);
  await f.getByLabel("Cabang").selectOption(seed.branches.b1);
  await f.getByLabel("Kategori").selectOption(seed.categories.ac);
  await f.getByLabel("Jumlah (Rp)").fill("430000");
  await f.getByLabel("Belum Dibayar").check();
  await f.getByLabel("No. faktur pemasok (opsional)").fill("SAS/2026/131");
  await f.getByLabel("Keterangan").fill("Ganti freon AC ruang tunggu");
  await f.getByRole("button", { name: "Simpan Biaya" }).click();
  await fin.p.waitForURL(/\/keuangan\/biaya\/[0-9a-f-]{36}\?tanggal=.*&baru=1/);
  await fin.p.getByRole("heading", { name: "Utang pemasok" }).waitFor();
  const d2 = await main(fin.p);
  const unpaidUrl = fin.p.url().replace("&baru=1", "");
  await fin.p.goto(`${BASE}/pembelian/utang?cabang=${seed.branches.b1}`);
  await fin.p.getByText(/SAS\/2026\/131/).first().waitFor();
  const u1 = await main(fin.p);
  flow.push(["an unpaid expense creates exactly one payable (Faktur SAS/2026/131, Utang terbuka) listed once in Pembelian › Utang",
    /Faktur SAS\/2026\/131/.test(d2) && /Utang terbuka/.test(d2) && (u1.match(/SAS\/2026\/131/g) ?? []).length === 1]);
  await fin.p.goto(unpaidUrl);
  await fin.p.getByRole("form", { name: "Batalkan biaya" }).waitFor();
  await fin.p.getByRole("form", { name: "Batalkan biaya" }).getByLabel("Alasan").fill("Salah pemasok, dicatat ulang");
  await fin.p.getByRole("button", { name: "Batalkan Biaya Rp430.000" }).click();
  await fin.p.getByRole("form", { name: "Batalkan biaya" }).waitFor({ state: "detached" });
  await fin.p.goto(unpaidUrl);
  await fin.p.getByRole("heading", { level: 1 }).waitFor();
  const d3 = await main(fin.p);
  await fin.p.goto(`${BASE}/pembelian/utang?cabang=${seed.branches.b1}`);
  await fin.p.getByRole("heading", { level: 1 }).waitFor();
  await fin.p.waitForTimeout(300);
  const u2 = await main(fin.p);
  flow.push(["reversing the unpaid expense reverses its payable: Dibatalkan, no Batalkan form, no longer open in Pembelian › Utang",
    /Dibatalkan/.test(d3) && (await fin.p.getByRole("form", { name: "Batalkan biaya" }).count()) === 0 && !/SAS\/2026\/131[^\n]*\n?[^\n]*sisa/.test(u2)]);
  // A paid expense: no reverse form, the reason shown.
  await fin.p.goto(`${BASE}${L}/${seed.expenses.paid}?tanggal=${seed.early}`);
  await fin.p.getByRole("heading", { name: "Utang pemasok" }).waitFor();
  const d4 = await main(fin.p);
  flow.push(["a paid expense cannot be reversed: Utang lunas and the reason, no form", /Utang lunas/.test(d4) && /tidak dapat dibatalkan/.test(d4) && (await fin.p.getByRole("form", { name: "Batalkan biaya" }).count()) === 0]);
  await fin.c.close();

  // Manager: the active branch only; records there (no branch picker).
  const mgr = await open("mgr", "203.0.113.242", true);
  await mgr.p.goto(`${BASE}${L}`);
  await mgr.p.getByRole("region", { name: "Total biaya periode" }).waitFor();
  const m1 = await main(mgr.p);
  f = await openSheet(mgr.p);
  const pickers = await f.getByLabel("Cabang").count();
  await f.getByLabel("Kategori").selectOption(seed.categories.atk);
  await f.getByLabel("Jumlah (Rp)").fill("35000");
  await f.getByLabel("Tunai").check();
  await f.getByLabel("Keterangan").fill("Map dan klip berkas");
  await f.getByLabel("Bukti (wajib)").setInputFiles({ name: "atk.png", mimeType: "image/png", buffer: png() });
  await f.getByRole("button", { name: "Simpan Biaya" }).click();
  await mgr.p.waitForURL(/baru=1/);
  await mgr.p.getByRole("heading", { level: 1 }).waitFor();
  const m2 = await main(mgr.p);
  flow.push(["the manager reads only Kemang (not BSD's paper), records cash at the active branch without a branch picker",
    !/Kertas dan tinta/.test(m1) && /Ongkos kurir/.test(m1) && pickers === 0 && /Cabang Kemang/.test(m2) && /Tunai/.test(m2)]);
  await layouts(mgr.p, L, "biaya-manager");
  await mgr.c.close();

  // Auditor: reads both branches, no form, no category sheet.
  const au = await open("au", "203.0.113.243", true);
  await au.p.goto(`${BASE}${L}`);
  await au.p.getByRole("region", { name: "Total biaya periode" }).waitFor();
  const a1 = await main(au.p);
  flow.push(["the auditor reads both branches read-only (no Catat Biaya, no Kategori Biaya)", /Kertas dan tinta/.test(a1) && /Mode baca/.test(a1)
    && (await au.p.getByRole("button", { name: "Catat Biaya" }).count()) === 0 && (await au.p.getByRole("button", { name: "Kategori Biaya" }).count()) === 0]);
  await au.p.goto(`${BASE}${L}/${seed.expenses.petty}?tanggal=${seed.early}`);
  await au.p.getByRole("img", { name: /Bukti biaya/ }).waitFor();
  flow.push(["the auditor sees the receipt preview, no reverse form", (await au.p.getByRole("form").count()) === 0]);
  await au.c.close();

  // Admin pusat: no access (DEC-097).
  const ap = await open("ap", "203.0.113.244", true);
  await ap.p.goto(`${BASE}${L}`);
  await ap.p.getByText("Anda tidak memiliki akses ke biaya operasional.").waitFor();
  await layouts(ap.p, L, "biaya-blocked-role");
  await ap.p.evaluate(new Function(`document.documentElement.dataset.probe = "${seed.expenses.petty}"`) as () => void);
  const r = await ap.p.evaluate(async () => (await fetch(location.origin + "/keuangan/biaya/bukti/" + document.documentElement.dataset.probe)).status).catch(() => -1);
  flow.push(["admin pusat: no access to the list, the receipt route answers 404", !/Ongkos kurir/.test(await main(ap.p)) && r === 404]);
  await ap.c.close();

  // A clinic without categories: the blocked state; its owner adds the first category, then may record.
  const o2 = await open("own2", "203.0.113.245", true);
  await o2.p.goto(`${BASE}${L}`);
  await o2.p.getByText("Belum ada kategori biaya.").waitFor();
  await layouts(o2.p, L, "biaya-no-category");
  const c = o2.p.getByRole("form", { name: "Tambah kategori biaya" });
  await c.getByLabel("Kategori baru").fill("Listrik & Air");
  await c.getByRole("button", { name: "Tambah Kategori" }).click();
  await o2.p.getByRole("button", { name: "Catat Biaya" }).waitFor();
  const n1 = await main(o2.p);
  flow.push(["no category: blocked state, the owner adds Listrik & Air, Catat Biaya appears, the empty state reads Belum ada biaya di periode ini",
    /Belum ada biaya di periode ini/.test(n1) && /Listrik & Air/.test(n1)]);
  await o2.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
