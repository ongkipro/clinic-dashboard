// T-035 browser evidence (UX-25 branch price tab, PR-42) at 390/820/1180/1440 and 200 % text. Done when:
// a branch price override is stored owner-only and effective-dated; Admin Pusat cannot override. In the
// browser: the Owner sets Rp450,000 at Cabang Makassar from today (in effect at once) and schedules a
// return to the normal price from a later date, then cancels the schedule; the list and the Master
// Layanan tab show the branch price; Admin Pusat and the cashier see the prices with no form; a price of
// 0 is refused with its message. No console error.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/harga-cabang.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string }>; kemang: string; makassar: string; facial: string; serum: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string, o?: { exact?: boolean }): Locator; getAttribute(n: string): Promise<string | null>; evaluate<T>(f: (e: Element) => T): Promise<T>;
  waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; selectOption(v: string): Promise<unknown>; allInnerTexts(): Promise<string[]>; getByText(t: string, o?: { exact?: boolean }): Locator;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp, o?: { waitUntil?: "load" | "commit" }): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string): Locator; locator(s: string): Locator; url(): string;
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
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea, main select, main summary")].filter(vis);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      // A checkbox's target is its label (clicking the label toggles it; the label is 44 px high).
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round((["checkbox", "radio"].includes((e as HTMLInputElement).type) && e.closest("label") ? e.closest("label")! : e).getBoundingClientRect().height))) : null,
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      // Text squeezed to a sliver (one letter per line at 200 %): a value cell narrower than four
      // characters of its own font while holding more text than that.
      squeezed: [...document.querySelectorAll("main dd, main p")].filter((e) => {
        const r = e.getBoundingClientRect();
        const em = parseFloat(getComputedStyle(e).fontSize);
        return r.width > 0 && r.width < 4 * em && (e.textContent ?? "").trim().length > 4;
      }).length,
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}`),
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
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main").innerText();
  const section = (p: Page, h: string) => p.locator("main section").filter({ has: p.getByRole("heading", { name: h, exact: true }) }).innerText();
  const later = (days: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + days * 86_400_000));

  // The Owner.
  const oCtx = await ctxOf("203.0.113.61");
  const o = await oCtx.newPage();
  current = o;
  o.on("console", onConsole);
  await signIn(o, seed.people.owner.email);
  await o.goto(`${BASE}/katalog`);
  await o.getByRole("heading", { name: "Katalog & Harga" }).waitFor();
  flow.push(["Katalog links to Harga Cabang", (await o.locator("main").getByRole("link", { name: "Harga Cabang", exact: true }).count()) === 1]);
  await layouts(o, "/katalog/harga-cabang", "list");
  await layouts(o, `/katalog/harga-cabang/${seed.facial}`, "item");
  await o.goto(`${BASE}/katalog/harga-cabang/${seed.facial}`);
  await o.getByRole("heading", { name: "Atur harga cabang" }).waitFor();
  // A price of 0 is refused with its message (free only through discounts or waivers).
  await o.getByLabel("Cabang", { exact: true }).selectOption(seed.makassar);
  await o.getByLabel("Harga cabang (Rp)").fill("0");
  await o.getByLabel("Alasan").fill("Coba gratis");
  await o.getByRole("button", { name: "Simpan Harga" }).click();
  // The form's own alert (Next's route announcer is a role=alert too).
  const formAlert = o.locator("main form p[role=alert]");
  await formAlert.first().waitFor();
  flow.push(["a price of 0 is refused with its message", (await formAlert.first().innerText()).includes("minimal Rp1")]);
  // Rp450,000 at Makassar from today: in effect at once. After the refusal the form still shows and
  // posts Makassar (browser run 2: React's form reset had put the select back on Kemang).
  const keptBranch = await o.getByLabel("Cabang", { exact: true }).evaluate((e: Element) => (e as HTMLSelectElement).value);
  flow.push(["after a refused submit the chosen branch is still selected", keptBranch === seed.makassar]);
  await o.getByLabel("Harga cabang (Rp)").fill("450.000");
  await o.getByLabel("Alasan").fill("Harga khusus Makassar");
  await o.getByRole("button", { name: "Simpan Harga" }).click();
  await o.getByText("Harga cabang tersimpan.").waitFor();
  await o.goto(`${BASE}/katalog/harga-cabang/${seed.facial}`);
  await o.getByRole("heading", { name: "Cabang Makassar" }).waitFor();
  const mks = await section(o, "Cabang Makassar");
  const kmg = await section(o, "Cabang Kemang");
  flow.push(["the Owner's price from today is in effect at Makassar at once; Kemang keeps the normal price", mks.includes("Rp450.000 (harga khusus)") && mks.includes("Berlaku") && kmg.includes("Rp500.000 (harga normal)")]);
  // A scheduled return to the normal price from a later date (00:00 in WITA), then cancelled.
  const future = later(10, "Asia/Makassar");
  await o.getByLabel("Cabang", { exact: true }).selectOption(seed.makassar);
  await o.getByLabel("Kembali ke harga normal").check();
  await o.getByLabel("Berlaku mulai").fill(future);
  await o.getByLabel("Alasan").fill("Promo selesai");
  await o.getByRole("button", { name: "Simpan Harga" }).click();
  await o.getByText("Harga cabang dijadwalkan kembali ke harga normal.").waitFor();
  await o.goto(`${BASE}/katalog/harga-cabang/${seed.facial}`);
  await o.getByRole("heading", { name: "Cabang Makassar" }).waitFor();
  const sched = await section(o, "Cabang Makassar");
  const [y, mo, d] = future.split("-").map(Number);
  const futureLabel = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, d)));
  flow.push(["the scheduled change shows at 00:00 WITA on the chosen date as the next change", sched.includes(`Mulai ${futureLabel}, 00.00 Makassar: kembali ke harga normal`) && sched.includes("Terjadwal")]);
  await o.screenshot({ path: `${OUT}/scheduled-1440.png`, fullPage: true });
  await o.setViewportSize({ width: 390, height: 900 });
  await measure(o, "scheduled-390", "scheduled-390");
  await o.setViewportSize({ width: 1440, height: 900 });
  await o.locator("main").getByRole("button", { name: /^Batalkan jadwal/ }).first().click();
  // The cancelled row is no longer scheduled, so its form (and message) leaves with the revalidation.
  await o.locator("main section").filter({ has: o.getByRole("heading", { name: "Cabang Makassar", exact: true }) }).getByText("Dibatalkan", { exact: true }).waitFor();
  await o.goto(`${BASE}/katalog/harga-cabang/${seed.facial}`);
  await o.getByRole("heading", { name: "Cabang Makassar" }).waitFor();
  const after = await section(o, "Cabang Makassar");
  flow.push(["the Owner cancels the schedule; the price in effect stays", after.includes("Dibatalkan") && after.includes("Tidak ada perubahan terjadwal") && after.includes("Rp450.000 (harga khusus)")]);
  // The list and the Master Layanan tab.
  await o.goto(`${BASE}/katalog/harga-cabang?cabang=${seed.makassar}`);
  await o.getByRole("heading", { name: "Harga Cabang" }).waitFor();
  const list = await main(o);
  await o.goto(`${BASE}/layanan/${seed.facial}`);
  await o.getByRole("heading", { name: "Harga Cabang", exact: true }).waitFor();
  const tab = await section(o, "Harga Cabang");
  flow.push(["the branch list and the Master Layanan tab show Makassar's price; the Owner gets Atur harga cabang", list.includes("Cabang Makassar: Rp450.000") && tab.includes("Cabang Makassar") && tab.includes("Rp450.000 (harga khusus)") && tab.includes("Atur harga cabang")]);
  await o.screenshot({ path: `${OUT}/layanan-tab-1440.png`, fullPage: true });
  await oCtx.close();

  // Admin Pusat: reads, no form, no Batalkan (IAM-11).
  const aCtx = await ctxOf("203.0.113.62");
  const ap = await aCtx.newPage();
  ap.on("console", onConsole);
  await signIn(ap, seed.people.ap.email);
  await ap.goto(`${BASE}/katalog/harga-cabang/${seed.facial}`);
  await ap.getByRole("heading", { name: "Cabang Makassar" }).waitFor();
  const apPage = await main(ap);
  flow.push(["Admin Pusat sees the prices but no form or cancel (owner only)", apPage.includes("Rp450.000") && apPage.includes("hanya dapat diubah oleh Owner") && (await ap.getByRole("button", { name: "Simpan Harga" }).count()) === 0 && (await ap.getByRole("button", { name: /Batalkan/ }).count()) === 0]);
  await ap.screenshot({ path: `${OUT}/admin-pusat-1440.png`, fullPage: true });
  await aCtx.close();

  // The cashier: reads the list and the Katalog item tab.
  const fCtx = await ctxOf("203.0.113.63");
  const f = await fCtx.newPage();
  f.on("console", onConsole);
  await signIn(f, seed.people.fo.email, false);
  await f.setViewportSize({ width: 390, height: 900 });
  await f.goto(`${BASE}/katalog/${seed.facial}`);
  await f.getByRole("heading", { name: "Harga Cabang", exact: true }).waitFor();
  const foTab = await section(f, "Harga Cabang");
  flow.push(["the cashier reads the branch price on the item and gets Lihat harga cabang", foTab.includes("Rp450.000 (harga khusus)") && foTab.includes("Lihat harga cabang")]);
  // Review r1 (Argon, P3): the cashier cannot open Master Layanan, so the item page links to Katalog.
  await f.goto(`${BASE}/katalog/harga-cabang/${seed.facial}`);
  await f.getByRole("heading", { name: "Cabang Makassar" }).waitFor();
  flow.push(["the cashier's price page links to Katalog, not to Master Layanan", (await f.locator("main").getByRole("link", { name: "Buka item di Katalog" }).count()) === 1 && (await f.locator("main").getByRole("link", { name: "Buka di Master Layanan" }).count()) === 0]);
  await f.screenshot({ path: `${OUT}/cashier-390.png`, fullPage: true });
  await fCtx.close();
} catch (e) {
  report.error = String(e).split("\n").slice(0, 3).join(" ");
  if (current) {
    await current.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
    report.failureText = await current.locator("main").innerText().catch(() => "");
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  const bad = Object.entries(report.layout as Record<string, { overflowX: number; minTarget: number | null; unnamed: number }>)
    .filter(([, v]) => v.overflowX || (v.minTarget !== null && v.minTarget < 44) || v.unnamed || (v as { squeezed?: number }).squeezed).map(([k]) => k);
  report.failed = { flows: flow.filter(([, ok]) => ok !== true).map(([k]) => k), layouts: bad, console: (report.console as string[]).length };
  if (flow.some(([, ok]) => ok !== true) || bad.length || (report.console as string[]).length) process.exitCode = 1;
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
