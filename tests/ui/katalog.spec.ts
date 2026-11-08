// T-033 browser evidence (UX-25, PR-41) at 390/820/1180/1440 and 200 % text. Done when: scenario
// PR-41 in the browser: the Manager changes a treatment's contraindications and saves ("Minta
// Review"); the item shows the change waiting for clinical review while the previous version stays
// active; the facility head approves it in Persetujuan; the new version is active. Plus: a price-only
// change is active at once ("Simpan"); the item lock while a review waits; the cashier sees prices
// but no clinical content and no edit; no console error.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/katalog.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string }>; product: string; facial: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string): Locator; getAttribute(n: string): Promise<string | null>;
  waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp, o?: { waitUntil?: "load" | "commit" }): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string): Locator; locator(s: string): Locator; url(): string;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
};
async function signIn(page: Page, email: string, totpRole = true) {
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
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea")].filter(vis);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      // A checkbox's target is its label (clicking the label toggles it; the label is 44 px high).
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(((e as HTMLInputElement).type === "checkbox" && e.closest("label") ? e.closest("label")! : e).getBoundingClientRect().height))) : null,
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
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
}
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));

const browser = await chromium.launch();
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  // The Manager: list, detail, a price-only change, then the PR-41 clinical change.
  const mCtx = await ctxOf("203.0.113.41");
  const m = await mCtx.newPage();
  m.on("console", onConsole);
  await signIn(m, seed.people.mgr.email);
  await m.goto(`${BASE}/katalog`);
  await m.getByRole("heading", { name: "Katalog & Harga" }).waitFor();
  const list = await m.locator("main").innerText();
  flow.push(["list shows the active items with prices and the add action for the Manager", list.includes("Facial Brightening") && list.includes("Rp500.000") && list.includes("Serum Vitamin C") && list.includes("Tambah Item")]);
  await layouts(m, "/katalog", "list");
  await layouts(m, `/katalog/${seed.facial}`, "detail");
  // Price-only change: the button says Simpan; the new version is active at once.
  await m.goto(`${BASE}/katalog/${seed.product}/ubah`);
  await m.getByLabel("Harga normal (Rp)").waitFor();
  await m.getByLabel("Harga normal (Rp)").fill("275000");
  await m.getByLabel("Alasan perubahan").fill("Harga naik");
  const simpan = await m.getByRole("button", { name: "Simpan" }).count();
  await m.getByRole("button", { name: "Simpan" }).click();
  await m.waitForURL(`${BASE}/katalog/${seed.product}`);
  await m.getByRole("heading", { name: "Serum Vitamin C" }).waitFor();
  const prod = await m.locator("main").innerText();
  flow.push(["a price-only change saves with Simpan and is active at once", simpan === 1 && prod.includes("Rp275.000") && prod.includes("Versi 2") && !prod.includes("Menunggu review klinis")]);
  // PR-41: change the contraindications; the button turns into Minta Review.
  await m.goto(`${BASE}/katalog/${seed.facial}/ubah`);
  await m.getByLabel("Kontraindikasi").waitFor();
  await m.getByLabel("Kontraindikasi").fill("Kulit luka terbuka; hamil trimester pertama");
  await m.getByLabel("Alasan perubahan").fill("Tambah kontraindikasi");
  for (const w of [390, 820, 1180, 1440]) {
    await m.setViewportSize({ width: w, height: 900 });
    await measure(m, `form-${w}`, w === 390 || w === 1440 ? `form-review-${w}` : undefined);
  }
  await m.setViewportSize({ width: 390, height: 900 });
  await m.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await measure(m, "form-390@200%", "form-review-390-200");
  await m.goto(`${BASE}/katalog/${seed.facial}/ubah`);
  await m.getByLabel("Kontraindikasi").waitFor();
  await m.getByLabel("Kontraindikasi").fill("Kulit luka terbuka; hamil trimester pertama");
  await m.getByLabel("Alasan perubahan").fill("Tambah kontraindikasi");
  await m.setViewportSize({ width: 1440, height: 900 });
  const reviewBtn = await m.getByRole("button", { name: "Minta Review" }).count();
  await m.getByRole("button", { name: "Minta Review" }).click();
  await m.waitForURL(`${BASE}/katalog/${seed.facial}`);
  await m.getByRole("heading", { name: "Perubahan menunggu review klinis" }).waitFor();
  const waiting = await m.locator("main").innerText();
  const klinis = await m.locator("main section").filter({ has: m.getByRole("heading", { name: "Data klinis" }) }).innerText();
  flow.push(["PR-41: the change waits for clinical review; the previous version stays active", reviewBtn === 1 && waiting.includes("Menunggu review klinis") && klinis.includes("Kulit luka terbuka") && !klinis.includes("hamil trimester pertama") && waiting.includes("hamil trimester pertama")]);
  flow.push(["while the review waits there is no Ubah action (item lock)", (await m.locator("main").getByRole("link", { name: "Ubah", exact: true }).count()) === 0]);
  await m.screenshot({ path: `${OUT}/waiting-1440.png`, fullPage: true });
  await measure(m, "waiting-1440");
  await m.setViewportSize({ width: 390, height: 900 });
  await m.screenshot({ path: `${OUT}/waiting-390.png`, fullPage: true });
  await measure(m, "waiting-390");
  await mCtx.close();

  // The cashier: prices, no clinical content, no edit.
  const fCtx = await ctxOf("203.0.113.42");
  const f = await fCtx.newPage();
  f.on("console", onConsole);
  await signIn(f, seed.people.fo.email, false);
  await f.setViewportSize({ width: 390, height: 900 });
  await f.goto(`${BASE}/katalog/${seed.facial}`);
  await f.getByRole("heading", { name: "Facial Brightening" }).waitFor();
  const fo = await f.locator("main").innerText();
  flow.push(["the cashier sees price and that a change waits, but no clinical content and no Ubah", fo.includes("Rp500.000") && fo.includes("menunggu review klinis") && !fo.includes("Kulit luka terbuka") && !fo.includes("Kontraindikasi") && (await f.locator("main").getByRole("link", { name: "Ubah", exact: true }).count()) === 0]);
  await f.screenshot({ path: `${OUT}/cashier-390.png`, fullPage: true });
  await fCtx.close();

  // The facility head approves it in Persetujuan.
  const hCtx = await ctxOf("203.0.113.43");
  const fh = await hCtx.newPage();
  fh.on("console", onConsole);
  await signIn(fh, seed.people.fh.email);
  // From the inbox (review round 1): the decision page names the item and shows the proposed change.
  await fh.goto(`${BASE}/persetujuan`);
  await fh.getByRole("heading", { name: "Persetujuan" }).waitFor();
  await fh.screenshot({ path: `${OUT}/inbox-1440.png`, fullPage: true });
  // The row in the waiting list (the filter chip of the same name is a link too).
  // The row in the waiting list (the filter chip of the same name is a link too); the detail is opened
  // by the row's own URL so the decision page is one full document (no hidden previous page).
  const rowLink = fh.getByRole("list", { name: "Permintaan menunggu" }).getByRole("link", { name: /Review klinis katalog/ }).first();
  const href = await rowLink.getAttribute("href");
  flow.push(["the inbox lists the review as a request row", typeof href === "string" && /^\/persetujuan\/[0-9a-f-]{36}$/.test(href)]);
  await fh.goto(`${BASE}${href}`);
  await fh.getByRole("heading", { name: "Perubahan klinis katalog" }).waitFor();
  const decisionPage = await fh.getByRole("main").innerText();
  flow.push(["from the inbox, the review names the item and shows proposed vs active contraindications", decisionPage.includes("Facial Brightening · FAC-01 · versi 2") && decisionPage.includes("Kontraindikasi (berubah)") && decisionPage.includes("hamil trimester pertama — sekarang: Kulit luka terbuka")]);
  await fh.screenshot({ path: `${OUT}/persetujuan-1440.png`, fullPage: true });
  await fh.getByRole("button", { name: "Setujui" }).first().click();
  // The detail re-renders as decided (revalidated), naming who decided (as tests/ui/persetujuan.spec.ts).
  await fh.getByText(/Disetujui oleh PJ Klinik Sintetis/).waitFor();
  await fh.goto(`${BASE}/katalog/${seed.facial}`);
  await fh.getByRole("heading", { name: "Data klinis" }).waitFor();
  const approved = await fh.locator("main").innerText();
  const klinis2 = await fh.locator("main section").filter({ has: fh.getByRole("heading", { name: "Data klinis" }) }).innerText();
  flow.push(["the facility head approves in Persetujuan; the new version is active, the old one superseded", klinis2.includes("hamil trimester pertama") && approved.includes("Versi 2") && approved.includes("Versi lama") && !approved.includes("Perubahan menunggu review klinis")]);
  await fh.screenshot({ path: `${OUT}/approved-1440.png`, fullPage: true });
  await hCtx.close();
} catch (e) {
  report.error = String(e).split("\n").slice(0, 3).join(" ");
  process.exitCode = 1;
} finally {
  await browser.close();
  const bad = Object.entries(report.layout as Record<string, { overflowX: number; minTarget: number | null; unnamed: number }>)
    .filter(([, v]) => v.overflowX || (v.minTarget !== null && v.minTarget < 44) || v.unnamed).map(([k]) => k);
  report.failed = { flows: flow.filter(([, ok]) => ok !== true).map(([k]) => k), layouts: bad, console: (report.console as string[]).length };
  if (flow.some(([, ok]) => ok !== true) || bad.length || (report.console as string[]).length) process.exitCode = 1;
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
