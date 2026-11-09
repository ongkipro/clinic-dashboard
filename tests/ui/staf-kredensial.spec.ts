// T-050 browser evidence (Staf & Undangan › Kredensial, UX-3, PR-73, IAM-4) at 390/820/1180/1440 and 200 %
// text. The Owner sees each clinical staff member's real status (expiring, waiting, none), filters it, and
// records an SIPP for one branch; the facility head of that branch scope sees only their branch's staff,
// verifies a pending STR and suspends a SIP (the badge and the blocked notice follow at once); a manager sees
// their branch's staff only, without record or decide actions. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/staf-kredensial.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; b1: string; b2: string };
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
      // Text squeezed to a sliver: a block narrower than four characters of its own font holding more text
      // than that (inline spans are measured by their line box, so only block-level spans count).
      squeezed: [...document.querySelectorAll("main dd, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        return cs.display !== "inline" && r.width > 0 && r.width < 4 * em && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}:${(e.textContent || "").trim().slice(0, 30)}`),
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
  await page.goto(`${BASE}${path}`); // drop the injected 200 % style before the next step (review r1 P2-3)
  await page.getByRole("heading", { level: 1 }).waitFor();
}
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();
  const seg = "/staf?segmen=kredensial";
  const ready = async (p: Page, h1: string) => { await p.getByRole("heading", { name: h1, level: 1 }).waitFor(); await p.locator("main:visible ul, main:visible p").first().waitFor(); };

  // Owner: the Kredensial segment shows each clinical staff member's real status.
  const oCtx = await ctxOf("203.0.113.171");
  const o = await oCtx.newPage();
  current = o;
  o.on("console", onConsole);
  await signIn(o, seed.people.owner.email);
  await o.goto(`${BASE}${seg}`);
  await ready(o, "Kredensial");
  const list = await main(o);
  flow.push(["owner: dr. Ayu expiring in 20 days", /dr\. Ayu[\s\S]*?Habis dalam 20 hari/.test(list)]);
  flow.push(["owner: dr. Budi waiting for verification", /dr\. Budi[\s\S]*?Menunggu verifikasi/.test(list)]);
  flow.push(["owner: Ners Citra without a credential", /Ners Citra[\s\S]*?Belum ada kredensial/.test(list)]);
  await layouts(o, seg, "kredensial");
  // Status filter: Menunggu Verifikasi narrows to dr. Budi; Terverifikasi is filtered-empty with a reset.
  await o.goto(`${BASE}${seg}&status=menunggu`);
  await ready(o, "Kredensial");
  const waiting = await main(o);
  flow.push(["owner: filter Menunggu shows only dr. Budi", waiting.includes("dr. Budi") && !waiting.includes("dr. Ayu") && !waiting.includes("Ners Citra")]);
  await o.goto(`${BASE}${seg}&status=aktif`);
  await o.getByRole("heading", { name: "Kredensial", level: 1 }).waitFor();
  await o.getByText("Tidak ada staf klinis dengan status ini.").waitFor();
  flow.push(["owner: filtered-empty offers a reset", (await o.locator("main:visible a[href='/staf?segmen=kredensial']").count()) > 0]);
  await o.screenshot({ path: `${OUT}/filtered-empty-1440.png`, fullPage: true });

  // Owner records an SIPP for Ners Citra on Senopati (Tambah Kredensial sheet).
  await o.goto(`${BASE}/staf/${seed.people.citra.staffId}`);
  await o.getByRole("heading", { name: "Ners Citra", level: 1 }).waitFor();
  flow.push(["detail: blocked notice for a clinical staff member without credentials", (await main(o)).includes("Kredensial belum diverifikasi")]);
  await o.getByRole("button", { name: "Tambah Kredensial" }).click();
  const sheet = o.getByRole("dialog");
  // Where the sheet sits after each step (a sheet pushed off-screen by an input would hide its button).
  const box = async (step: string) => (report.sheet as unknown[]).push([step, await sheet.evaluate((e: Element) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight, getComputedStyle(e).transform]; })]);
  report.sheet = [];
  await sheet.getByRole("button", { name: "Simpan Kredensial" }).waitFor();
  await o.waitForTimeout(600);
  await box("open");
  flow.push(["sheet: Simpan Kredensial fully inside the viewport", await sheet.getByRole("button", { name: "Simpan Kredensial" }).evaluate((e: Element) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })]);
  // Profession options follow the kind (review r1 P1-2): SIPP offers Perawat only.
  await sheet.getByLabel("Jenis").selectOption("sipp");
  flow.push(["sheet: SIPP offers only Perawat", (await sheet.getByLabel("Profesi").locator("option").allInnerTexts()).join("|") === "Perawat"]);
  await sheet.getByLabel("Profesi").selectOption("perawat");
  await sheet.getByLabel("Nomor").fill("SIPP-CITRA-SNP");
  await sheet.getByLabel("Penerbit").fill("Dinas Kesehatan Jakarta Selatan");
  await sheet.getByLabel("Cabang").selectOption({ label: "Cabang Senopati" });
  await sheet.getByLabel("Berlaku sejak").fill("2025-01-01");
  await sheet.getByLabel(/^Berlaku sampai/).fill("2030-01-01");
  await box("filled");
  await o.screenshot({ path: `${OUT}/tambah-1440.png`, fullPage: true });
  await sheet.getByRole("button", { name: "Simpan Kredensial" }).click();
  await sheet.getByText("Kredensial dicatat. Menunggu verifikasi Penanggung Jawab Klinik.").waitFor();
  flow.push(["owner: an SIPP recorded pending", true]);
  // A second credential from the same open sheet, without a reload (review r1 P1-2: a fresh key per attempt).
  await sheet.getByLabel("Jenis").selectOption("str");
  await sheet.getByLabel("Profesi").selectOption("perawat");
  await sheet.getByLabel("Nomor").fill("STR-CITRA-0003");
  await sheet.getByLabel("Penerbit").fill("Konsil Kesehatan Indonesia");
  await sheet.getByLabel("Berlaku sejak").fill("2024-01-01");
  await sheet.getByLabel(/^Berlaku sampai/).fill("");
  await sheet.getByRole("button", { name: "Simpan Kredensial" }).click();
  await o.waitForTimeout(1500);
  const second = await sheet.innerText();
  flow.push(["owner: a second record in the same sheet succeeds", second.includes("Kredensial dicatat") && !second.includes("isi berbeda")]);
  await o.goto(`${BASE}/staf/${seed.people.citra.staffId}`);
  await o.getByRole("heading", { name: "Ners Citra", level: 1 }).waitFor();
  const citra = await main(o);
  flow.push(["detail: the new SIPP shows Senopati and waits", citra.includes("SIPP · SIPP-CITRA-SNP") && citra.includes("Cabang Senopati") && citra.includes("Menunggu verifikasi")]);
  flow.push(["detail: the STR recorded second is listed too", citra.includes("STR · STR-CITRA-0003")]);
  // The Owner may not verify dr. Budi while Kemang has a facility head: the reason in words, no buttons (review r1 P2-1).
  await o.goto(`${BASE}/staf/${seed.people.budi.staffId}`);
  await o.getByRole("heading", { name: "dr. Budi", level: 1 }).waitFor();
  flow.push(["owner: no Verifikasi for dr. Budi, the reason in words", (await main(o)).includes("Penanggung Jawab Klinik cabang ini yang memverifikasi.")
    && (await o.getByRole("button", { name: "Verifikasi", exact: true }).count()) === 0]);
  await oCtx.close();

  // Facility head of Kemang: verifies dr. Budi's STR; cannot see Senopati's nurse (branch scope).
  const fCtx = await ctxOf("203.0.113.172");
  const f = await fCtx.newPage();
  current = f;
  f.on("console", onConsole);
  await signIn(f, seed.people.fh.email);
  await f.goto(`${BASE}${seg}`);
  await ready(f, "Kredensial");
  const fl = await main(f);
  flow.push(["facility head: sees Kemang staff only", fl.includes("dr. Budi") && fl.includes("dr. Ayu") && !fl.includes("Ners Citra")]);
  await f.goto(`${BASE}/staf/${seed.people.budi.staffId}`);
  await f.getByRole("heading", { name: "dr. Budi", level: 1 }).waitFor();
  await layouts(f, `/staf/${seed.people.budi.staffId}`, "detail");
  await f.getByRole("button", { name: "Tolak", exact: true }).click();
  await f.getByLabel("Alasan penolakan").waitFor();
  await f.screenshot({ path: `${OUT}/tolak-390.png`, fullPage: true }).catch(() => undefined);
  await f.getByRole("button", { name: "Batal" }).click();
  // The decision re-renders the page (revalidatePath): the buttons disappear with the pending state.
  await f.getByRole("button", { name: "Verifikasi", exact: true }).click();
  await f.getByRole("button", { name: "Verifikasi", exact: true }).waitFor({ state: "detached" });
  await f.goto(`${BASE}/staf/${seed.people.budi.staffId}`);
  await f.getByRole("heading", { name: "dr. Budi", level: 1 }).waitFor();
  const budi = await main(f);
  flow.push(["facility head: dr. Budi's STR verified", budi.includes("Terverifikasi")]);
  flow.push(["detail: an STR alone is not a complete set (blocked notice stays)", budi.includes("Kredensial belum diverifikasi")]);
  // Suspends dr. Ayu's SIP: the badge and the blocked notice follow at once.
  await f.goto(`${BASE}/staf/${seed.people.ayu.staffId}`);
  await f.getByRole("heading", { name: "dr. Ayu", level: 1 }).waitFor();
  flow.push(["detail: the SIP shows its end date and the 60/30/7 reminder note", (await main(f)).includes("Pengingat masa berlaku dikirim 60, 30 dan 7 hari")]);
  await f.getByRole("button", { name: "Tangguhkan" }).first().click();
  await f.getByLabel("Alasan").fill("Sedang diperiksa dinas");
  await f.getByRole("button", { name: "Tangguhkan Kredensial" }).click();
  // The form remounts closed once the credential is suspended (keyed by state): no stale open form.
  await f.getByRole("button", { name: "Tangguhkan Kredensial" }).waitFor({ state: "detached" });
  await f.goto(`${BASE}/staf/${seed.people.ayu.staffId}`);
  await f.getByRole("heading", { name: "dr. Ayu", level: 1 }).waitFor();
  const ayu = await main(f);
  flow.push(["facility head: suspended at once, blocked notice shown", ayu.includes("Ditangguhkan") && ayu.includes("Kredensial belum diverifikasi")]);
  await f.screenshot({ path: `${OUT}/ditangguhkan-1440.png`, fullPage: true });
  await fCtx.close();

  // Manager of Senopati: views Ners Citra, never dr. Ayu or dr. Budi, and has no record or decide action.
  const mCtx = await ctxOf("203.0.113.173");
  const m = await mCtx.newPage();
  current = m;
  m.on("console", onConsole);
  await signIn(m, seed.people.mgr2.email);
  await m.goto(`${BASE}${seg}`);
  await ready(m, "Kredensial");
  const ml = await main(m);
  flow.push(["manager: own branch only, view only", ml.includes("Ners Citra") && !ml.includes("dr. Ayu") && !ml.includes("dr. Budi")]);
  await m.goto(`${BASE}/staf/${seed.people.citra.staffId}`);
  await m.getByRole("heading", { name: "Ners Citra", level: 1 }).waitFor();
  flow.push(["manager: no Tambah, Verifikasi or Tangguhkan", (await m.getByRole("button", { name: /Tambah Kredensial|Verifikasi|Tangguhkan/ }).count()) === 0]);
  await mCtx.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await current.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
