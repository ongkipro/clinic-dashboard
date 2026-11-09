// T-041 browser evidence (Daftar Pasien, 19:75, PR-76) at 390/820/1180/1440 and 200 % text. FO searches by
// phone: the row shows name, masked phone, MRN and visit status, never a diagnosis, and the query never
// appears in the URL; filters (visiting now, last visit) narrow the list; a segment is saved, survives a
// reload and is applied; "Muat lagi" loads the next page; marketing sees only consented contacts with a
// masked phone and no profile link; purchasing gets the permission state. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/pasien-list.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branch: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator; getAttribute(n: string): Promise<string | null>; evaluate<T>(f: (e: Element) => T): Promise<T>;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; uncheck(): Promise<void>; isChecked(): Promise<boolean>; isDisabled(): Promise<boolean>; nth(i: number): Locator; inputValue(): Promise<string>; selectOption(v: string | object): Promise<unknown>; evaluateAll<T>(f: (e: Element[]) => T): Promise<T>; allInnerTexts(): Promise<string[]>; getByText(t: string, o?: { exact?: boolean }): Locator;
  evaluate<T>(f: (e: Element) => T): Promise<T>;
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
  const main = (p: Page) => p.locator("main:visible").innerText();
  const form = (p: Page, label: string) => p.locator(`main:visible form[aria-label^="${label}"]`);
  const ready = async (p: Page) => { await p.getByRole("heading", { name: "Daftar Pasien", level: 1 }).waitFor(); await p.locator("main:visible form, main:visible ul, main:visible p").first().waitFor(); };

  const fCtx = await ctxOf("203.0.113.161");
  const f = await fCtx.newPage();
  current = f;
  f.on("console", onConsole);
  await signIn(f, seed.people.fo.email, false);
  await f.goto(`${BASE}/pasien`);
  await ready(f);
  await layouts(f, "/pasien", "daftar");
  await f.goto(`${BASE}/pasien`);
  await ready(f);
  const sf = form(f, "Cari pasien");
  await sf.getByLabel("Cari nama, No. RM atau nomor HP").fill("0812-7700-1122");
  await sf.getByRole("button", { name: "Cari", exact: true }).click();
  await f.locator("main:visible li").filter({ hasText: "Rina Telepon" }).waitFor();
  const row = await f.locator("main:visible li").filter({ hasText: "Rina Telepon" }).innerText();
  flow.push(["scenario PR-76: search by phone shows name, masked phone, MRN and visit status; no diagnosis", row.includes("RM-") && row.includes("+62•••••••1122") && row.includes("Sedang berkunjung") && !/diagnos/i.test(await main(f))]);
  flow.push(["the query never appears in the URL", !f.url().includes("0812") && !f.url().includes("7700")]);
  await measure(f, "hasil-1440", "hasil-1440");
  // Filters: visiting now only (no text).
  await f.goto(`${BASE}/pasien`);
  await ready(f);
  await form(f, "Cari pasien").getByLabel("Sedang berkunjung").check();
  await form(f, "Cari pasien").getByRole("button", { name: "Cari", exact: true }).click();
  await f.locator("main:visible h2").filter({ hasText: "Hasil" }).waitFor();
  const visiting = await main(f);
  flow.push(["the visiting-now filter lists only patients with an open visit", visiting.includes("Rina Telepon") && !visiting.includes("Halaman Pasien")]);
  // Save the filter as a segment; it survives a reload.
  await form(f, "Simpan segmen").getByLabel("Simpan filter ini sebagai segmen").fill("Sedang di klinik");
  await form(f, "Simpan segmen").getByRole("button", { name: "Simpan Segmen" }).click();
  await f.getByText("Segmen disimpan.").waitFor();
  await f.goto(`${BASE}/pasien`);
  await ready(f);
  const seg = f.locator("main:visible section").filter({ hasText: "Segmen tersimpan" });
  flow.push(["the saved segment persists after a reload", (await seg.innerText()).includes("Sedang di klinik")]);
  await seg.getByRole("button", { name: "Sedang di klinik", exact: true }).click();
  await form(f, "Cari pasien").getByRole("button", { name: "Cari", exact: true }).click();
  await f.locator("main:visible h2").filter({ hasText: "Hasil" }).waitFor();
  flow.push(["applying the segment restores its filters", (await form(f, "Cari pasien").getByLabel("Sedang berkunjung").isChecked()) && (await main(f)).includes("Rina Telepon")]);
  // After a search, a segment and Hapus Filter still set the form (review r1 P2).
  await form(f, "Cari pasien").getByLabel("Cari nama, No. RM atau nomor HP").fill("Tidak Ada Yang Bernama Ini");
  await form(f, "Cari pasien").getByLabel("Sedang berkunjung").uncheck();
  await form(f, "Cari pasien").getByRole("button", { name: "Cari", exact: true }).click();
  await f.getByText("Tidak ada pasien untuk pencarian atau filter ini.").waitFor();
  await f.getByRole("button", { name: "Hapus Filter" }).click();
  const cleared = (await form(f, "Cari pasien").getByLabel("Cari nama, No. RM atau nomor HP").inputValue()) === ""
    && !(await form(f, "Cari pasien").getByLabel("Sedang berkunjung").isChecked());
  await f.locator("main:visible section").filter({ hasText: "Segmen tersimpan" }).getByRole("button", { name: "Sedang di klinik", exact: true }).click();
  const reapplied = await form(f, "Cari pasien").getByLabel("Sedang berkunjung").isChecked();
  flow.push(["after a search, Hapus Filter clears the form and a segment sets its filters", cleared && reapplied]);
  // Pagination.
  await f.goto(`${BASE}/pasien`);
  await ready(f);
  await form(f, "Cari pasien").getByLabel("Cari nama, No. RM atau nomor HP").fill("Halaman Pasien");
  await form(f, "Cari pasien").getByRole("button", { name: "Cari", exact: true }).click();
  await f.locator("main:visible h2").filter({ hasText: "Hasil (50+)" }).waitFor();
  await f.getByRole("button", { name: "Muat lagi" }).click();
  await f.locator("main:visible h2").filter({ hasText: "Hasil (55)" }).waitFor();
  flow.push(["Muat lagi loads the next page", true]);
  // Filtered empty.
  await f.goto(`${BASE}/pasien`);
  await ready(f);
  await form(f, "Cari pasien").getByLabel("Cari nama, No. RM atau nomor HP").fill("Tidak Ada Yang Bernama Ini");
  await form(f, "Cari pasien").getByRole("button", { name: "Cari", exact: true }).click();
  await f.getByText("Tidak ada pasien untuk pencarian atau filter ini.").waitFor();
  flow.push(["no match shows the filtered-empty state", true]);
  await f.setViewportSize({ width: 390, height: 900 });
  await measure(f, "kosong-390", "kosong-390");
  await fCtx.close();

  const mCtx = await ctxOf("203.0.113.162");
  const m = await mCtx.newPage();
  current = m;
  m.on("console", onConsole);
  await signIn(m, seed.people.mk.email, false);
  await m.goto(`${BASE}/pasien`);
  await m.getByRole("heading", { name: "Daftar Pasien", level: 1 }).waitFor();
  const mt = await main(m);
  flow.push(["marketing sees only consented contacts, masked, without profile links or search", mt.includes("Sinta Promo") && mt.includes("•") && !mt.includes("Rina Telepon")
    && (await m.locator('main:visible a[href^="/pasien/"]').count()) === 0 && (await m.getByLabel("Cari nama, No. RM atau nomor HP").count()) === 0]);
  await measure(m, "marketing-390", "marketing-390");
  await mCtx.close();

  const pCtx = await ctxOf("203.0.113.163");
  const pu = await pCtx.newPage();
  current = pu;
  pu.on("console", onConsole);
  await signIn(pu, seed.people.pu.email, false);
  await pu.goto(`${BASE}/pasien`);
  await pu.getByRole("heading", { name: "Daftar Pasien", level: 1 }).waitFor();
  flow.push(["purchasing gets the permission state", !(await main(pu)).includes("Rina")]);
  await pCtx.close();
} catch (e) {
  report.error = String(e).slice(0, 500);
  if (current) await current.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
