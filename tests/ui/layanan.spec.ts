// T-034 browser evidence (UX-25, PR-88) at 390/820/1180/1440 and 200 % text. Done when: Master
// Layanan saved and versioned with resources and staff eligibility, in the browser: the Manager opens
// the service (durations, room and laser device, the doctor allowed to perform it), changes the
// durations and resources (Simpan: active at once, a new version), then adds the nurse with written
// delegation and a BHP recipe (Minta Review Klinis & BHP: both reviews); the floor offers no
// "Melakukan" for the nurse on a laser treatment; the pharmacist sees only the recipe in Persetujuan and
// approves it; the facility head approves the clinical part; the version is active. No console error.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/layanan.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string }>; laser: string };
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
  check(): Promise<void>; selectOption(v: string): Promise<unknown>; allInnerTexts(): Promise<string[]>;
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
  const main = (p: Page) => p.locator("main").innerText();
  const section = (p: Page, h: string) => p.locator("main section").filter({ has: p.getByRole("heading", { name: h, exact: true }) }).innerText();

  // The Manager: list, detail, an operational change, then a clinical + recipe change.
  const mCtx = await ctxOf("203.0.113.51");
  const m = await mCtx.newPage();
  m.on("console", onConsole);
  await signIn(m, seed.people.mgr.email);
  await m.goto(`${BASE}/layanan`);
  await m.getByRole("heading", { name: "Master Layanan" }).waitFor();
  const list = await main(m);
  flow.push(["list shows the service by category with duration, online booking and the add action", list.includes("Laser Toning Wajah") && list.includes("Laser non-ablatif · LSR-01 · 75 menit · booking online") && list.includes("Rp1.200.000") && list.includes("Tambah Layanan")]);
  await layouts(m, "/layanan", "list");
  await layouts(m, `/layanan/${seed.laser}`, "detail");
  await m.goto(`${BASE}/layanan/${seed.laser}`);
  await m.getByRole("heading", { name: "Durasi & Sumber Daya" }).waitFor();
  const dur = await section(m, "Durasi & Sumber Daya");
  const staf = await section(m, "Staf & Delegasi");
  const soon = await section(m, "Harga Cabang");
  flow.push(["the detail shows the 19 tabs: durations, room and device, eligible staff; Harga Cabang says not yet available", dur.includes("15 menit") && dur.includes("45 menit") && dur.includes("Ruang tindakan") && dur.includes("Laser non-ablatif") && staf.includes("Dokter: Melakukan") && soon.includes("belum tersedia")]);

  // Operational change: durations and the device removed; Simpan; a new version active at once.
  await m.goto(`${BASE}/layanan/${seed.laser}/ubah`);
  await m.getByLabel("Tindakan (menit)").waitFor();
  for (const w of [390, 820, 1180, 1440]) {
    await m.setViewportSize({ width: w, height: 900 });
    await measure(m, `form-${w}`, w === 390 || w === 1440 ? `form-${w}` : undefined);
  }
  await m.setViewportSize({ width: 390, height: 900 });
  await m.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await measure(m, "form-390@200%", "form-390-200");
  await m.setViewportSize({ width: 1440, height: 900 });
  await m.goto(`${BASE}/layanan/${seed.laser}/ubah`);
  await m.getByLabel("Tindakan (menit)").waitFor();
  await m.getByLabel("Tindakan (menit)").fill("60");
  await m.getByLabel("Ruang konsultasi").check();
  await m.getByLabel("Alasan perubahan").fill("Durasi disesuaikan");
  const simpan = await m.getByRole("button", { name: "Simpan", exact: true }).count();
  await m.getByRole("button", { name: "Simpan", exact: true }).click();
  await m.waitForURL(`${BASE}/layanan/${seed.laser}`);
  await m.getByRole("heading", { name: "Riwayat versi" }).waitFor();
  const v3 = await main(m);
  const dur3 = await section(m, "Durasi & Sumber Daya");
  flow.push(["an operational change saves with Simpan and is active at once as a new version", simpan === 1 && dur3.includes("60 menit") && dur3.includes("Ruang konsultasi") && v3.includes("Versi 2") && v3.includes("Versi lama") && !v3.includes("Menunggu review")]);

  // Clinical + recipe: the nurse with written delegation and a BHP recipe.
  await m.goto(`${BASE}/layanan/${seed.laser}/ubah`);
  await m.getByLabel("Perawat", { exact: true }).waitFor();
  const nurseOpts = await m.getByLabel("Perawat", { exact: true }).locator("option").allInnerTexts();
  const therOpts = await m.getByLabel("Terapis", { exact: true }).locator("option").allInnerTexts();
  flow.push(["the floor: on a non-ablative laser the nurse may be supervised or assist, never perform; the therapist not at all", !nurseOpts.includes("Melakukan") && nurseOpts.includes("Melakukan dengan pelimpahan tertulis") && nurseOpts.includes("Membantu saja") && therOpts.length === 1 && therOpts[0].includes("Tidak boleh")]);
  await m.getByLabel("Perawat", { exact: true }).selectOption("supervised");
  // Review round 1 (Argon): the button follows what will be posted. A narrower category (filler: the
  // nurse may only assist) drops the nurse row, so nothing clinical changes and the button is Simpan;
  // back on the laser category the selection returns and it asks for review again.
  const btn = async () => (await m.locator("main form").getByRole("button").last().innerText()).trim();
  const before = await btn();
  await m.getByLabel("Kategori", { exact: true }).selectOption("filler");
  const narrowed = await btn();
  await m.getByLabel("Kategori", { exact: true }).selectOption("laser_non_ablative");
  const restored = await btn();
  flow.push(["the button follows the posted eligibility: a narrower category drops the nurse row (Simpan), restoring it asks for review", before === "Minta Review Klinis" && narrowed === "Simpan" && restored === "Minta Review Klinis"]);
  await m.getByLabel("Bahan 1").fill("Gel pendingin");
  await m.getByLabel("Jumlah").first().fill("5");
  await m.getByLabel("Satuan").first().fill("ml");
  await m.getByLabel("Alasan perubahan").fill("Perubahan staf dan resep");
  const both = await m.getByRole("button", { name: "Minta Review Klinis & BHP" }).count();
  await m.getByRole("button", { name: "Minta Review Klinis & BHP" }).click();
  await m.waitForURL(`${BASE}/layanan/${seed.laser}`);
  await m.getByRole("heading", { name: "Perubahan menunggu review" }).waitFor();
  const waiting = await section(m, "Perubahan menunggu review");
  const activeStaf = await section(m, "Staf & Delegasi");
  flow.push(["the change waits for both reviews; the active version still lists only the doctor", both === 1 && waiting.includes("Penanggung Jawab Klinik dan Apoteker") && waiting.includes("Perawat: Melakukan dengan pelimpahan tertulis") && waiting.includes("Gel pendingin — 5 ml") && !activeStaf.includes("Perawat") && (await m.locator("main").getByRole("link", { name: "Ubah", exact: true }).count()) === 0]);
  await m.screenshot({ path: `${OUT}/waiting-1440.png`, fullPage: true });
  await measure(m, "waiting-1440");
  await m.setViewportSize({ width: 390, height: 900 });
  await m.screenshot({ path: `${OUT}/waiting-390.png`, fullPage: true });
  await measure(m, "waiting-390");
  await mCtx.close();

  // The pharmacist: Persetujuan lists the materials review; it shows the recipe and no clinical text.
  const pCtx = await ctxOf("203.0.113.52");
  const ph = await pCtx.newPage();
  ph.on("console", onConsole);
  await signIn(ph, seed.people.ph.email, false);
  await ph.goto(`${BASE}/layanan/${seed.laser}`);
  await ph.getByRole("heading", { name: "Laser Toning Wajah" }).waitFor();
  const phDetail = await main(ph);
  flow.push(["the pharmacist's service page never shows the pending clinical change", !phDetail.includes("Perawat: Melakukan dengan pelimpahan") && !phDetail.includes("Gel pendingin")]);
  await ph.goto(`${BASE}/persetujuan`);
  await ph.getByRole("heading", { name: "Persetujuan" }).waitFor();
  const pRow = ph.getByRole("list", { name: "Permintaan menunggu" }).getByRole("link", { name: /Review bahan \(BHP\) katalog/ }).first();
  const pHref = await pRow.getAttribute("href");
  await ph.goto(`${BASE}${pHref}`);
  await ph.getByRole("heading", { name: "Perubahan resep BHP" }).waitFor();
  const pPage = await ph.getByRole("main").innerText();
  flow.push(["the pharmacist's review shows the proposed recipe against the active one, and no clinical text", pPage.includes("Laser Toning Wajah · LSR-01 · versi 3") && pPage.includes("Resep BHP (berubah)") && pPage.includes("Gel pendingin 5 ml — sekarang: —") && !pPage.includes("Hiperpigmentasi") && !pPage.includes("Kulit terbakar") && !pPage.includes("pelimpahan tertulis") && !pPage.includes("Staf yang boleh")]);
  await ph.screenshot({ path: `${OUT}/persetujuan-bhp-1440.png`, fullPage: true });
  await ph.setViewportSize({ width: 390, height: 900 });
  await measure(ph, "persetujuan-bhp-390", "persetujuan-bhp-390");
  await ph.setViewportSize({ width: 1440, height: 900 });
  await ph.getByRole("button", { name: "Setujui" }).first().click();
  await ph.getByText(/Disetujui oleh Apoteker Sintetis/).waitFor();
  await pCtx.close();

  // The facility head approves the clinical part; the version becomes active.
  const hCtx = await ctxOf("203.0.113.53");
  const fh = await hCtx.newPage();
  fh.on("console", onConsole);
  await signIn(fh, seed.people.fh.email);
  await fh.goto(`${BASE}/persetujuan`);
  await fh.getByRole("heading", { name: "Persetujuan" }).waitFor();
  const hRows = await fh.getByRole("list", { name: "Permintaan menunggu" }).innerText();
  const hRow = fh.getByRole("list", { name: "Permintaan menunggu" }).getByRole("link", { name: /Review klinis katalog/ }).first();
  const hHref = await hRow.getAttribute("href");
  flow.push(["the facility head's inbox lists the clinical review, not the materials review (a pharmacist decides it)", typeof hHref === "string" && !hRows.includes("Review bahan")]);
  await fh.goto(`${BASE}${hHref}`);
  await fh.getByRole("heading", { name: "Perubahan klinis katalog" }).waitFor();
  const hPage = await fh.getByRole("main").innerText();
  flow.push(["the clinical review shows the staff change and no recipe", hPage.includes("Staf yang boleh (berubah)") && hPage.includes("Perawat: Melakukan dengan pelimpahan tertulis") && !hPage.includes("Gel pendingin")]);
  await fh.screenshot({ path: `${OUT}/persetujuan-klinis-1440.png`, fullPage: true });
  await fh.getByRole("button", { name: "Setujui" }).first().click();
  await fh.getByText(/Disetujui oleh PJ Klinik Sintetis/).waitFor();
  await fh.goto(`${BASE}/layanan/${seed.laser}`);
  await fh.getByRole("heading", { name: "Staf & Delegasi" }).waitFor();
  const done = await main(fh);
  const staf4 = await section(fh, "Staf & Delegasi");
  const bhp4 = await section(fh, "Resep BHP");
  flow.push(["after both approvals version 3 is active with the nurse and the recipe", staf4.includes("Perawat: Melakukan dengan pelimpahan tertulis") && bhp4.includes("Gel pendingin — 5 ml") && done.includes("Versi 3") && !done.includes("Menunggu review")]);
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
