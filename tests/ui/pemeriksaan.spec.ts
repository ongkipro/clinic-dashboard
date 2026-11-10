// T-052 browser evidence (Lembar Pemeriksaan, UX-8, 19:85–90, PR-10, CLIN-004, CLIN-012) at 390/820/1180/1440 and
// 200 % text. The doctor's queue with states and a filter (filtered-empty with reset); the repeat patient's sheet
// shows two earlier visits, the photos state and the active plan in one screen (PR-10); Mulai Pemeriksaan; a BC
// fact confirmed and one corrected (CLIN-004); SOAP with a template saves; a face-map point placed by tap and
// one by the keyboard form with a dose; a second plan with an item and live prices (CLIN-012); Tanda Tangani
// disabled with its reason; another doctor's examination is read-only; the nurse has no sheet. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/pemeriksaan.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branch: string; visits: Record<string, string> };
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
  focus(): Promise<void>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp, o?: { waitUntil?: "load" | "commit" }): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string): Locator; locator(s: string): Locator; url(): string;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  keyboard: { press(k: string): Promise<void> };
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
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}@${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}/${innerWidth}`),
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

  // Doctor (second factor required): the queue with states and the filter.
  const dCtx = await ctxOf("203.0.113.191");
  const d = await dCtx.newPage();
  current = d;
  d.on("console", onConsole);
  await signIn(d, seed.people.doc.email, true);
  await d.goto(`${BASE}/pemeriksaan`);
  await d.getByRole("heading", { name: "Antrean Dokter", level: 1 }).waitFor();
  await d.locator("main:visible ul").first().waitFor();
  const list = await main(d);
  flow.push(["queue: three patients with their state; allergy count; the examining doctor", /Sari Berulang[\s\S]*1 alergi[\s\S]*Siap diperiksa/.test(list)
    && /Budi Menunggu[\s\S]*Menunggu intake/.test(list) && /Dewi Diperiksa[\s\S]*Dokter dr\. Bima[\s\S]*Sedang diperiksa/.test(list)]);
  await layouts(d, "/pemeriksaan", "antrean");
  await d.goto(`${BASE}/pemeriksaan?status=diperiksa`);
  await d.getByRole("link", { name: /Dewi Diperiksa/ }).waitFor();
  flow.push(["queue: the filter shows only the matching state", !(await main(d)).includes("Sari Berulang")]);
  await d.goto(`${BASE}/pemeriksaan?status=menunggu`);
  await d.getByRole("link", { name: /Budi Menunggu/ }).waitFor();
  await d.goto(`${BASE}/pemeriksaan`);

  // PR-10: the repeat patient's sheet, before the examination: earlier visits, photos state, active plan.
  await d.getByRole("link", { name: /Sari Berulang/ }).click();
  await d.waitForURL(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  await d.getByRole("heading", { name: "Sari Berulang", level: 1 }).waitFor();
  const sheet = await main(d);
  flow.push(["PR-10: two earlier visits, photos state and the active plan on one screen", sheet.includes("Akne vulgaris ringan") && sheet.includes("Kontrol jerawat")
    && sheet.includes("Foto klinis belum tersedia") && sheet.includes("Rencana aktif: Program Jerawat") && sheet.includes("Serum Cerah × 2")]);
  flow.push(["header: the unverified allergy caution", sheet.includes("Alergi: Amoksisilin (belum diverifikasi)")]);
  await d.getByRole("form", { name: "Mulai pemeriksaan Sari Berulang" }).getByRole("button", { name: "Mulai Pemeriksaan" }).click();
  await d.getByRole("form", { name: "Pemeriksaan SOAP" }).waitFor();
  await layouts(d, `/pemeriksaan/${seed.visits.sari}`, "lembar");

  // CLIN-004: confirm the medication, correct the allergy.
  await d.getByRole("form", { name: "Verifikasi Obat yang sedang dipakai" }).getByRole("button", { name: "Benar" }).click();
  await d.getByText("Ditandai benar.").waitFor();
  const af = d.getByRole("form", { name: "Verifikasi Alergi" });
  await af.getByRole("button", { name: "Koreksi" }).click();
  await af.getByLabel("Koreksi alergi").fill("Amoksisilin dan penisilin");
  await af.getByRole("button", { name: "Simpan Koreksi" }).click();
  await d.getByText("Koreksi tersimpan.").waitFor();
  await d.goto(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  await d.getByRole("form", { name: "Pemeriksaan SOAP" }).waitFor();
  const verified = await main(d);
  flow.push(["CLIN-004: the BC value stays, the verification shows beside it; the caution is verified", verified.includes("Alergi: Amoksisilin")
    && verified.includes("Dikoreksi: Amoksisilin dan penisilin") && verified.includes("(diverifikasi)") && /Obat yang sedang dipakai:[^\n]*Tidak ada[\s\S]*Benar/.test(verified)]);

  // SOAP with a template.
  const soap = d.getByRole("form", { name: "Pemeriksaan SOAP" });
  await soap.getByLabel("Templat pemeriksaan").selectOption("jerawat");
  await soap.getByLabel("Fitzpatrick").selectOption("IV");
  await soap.getByLabel("Derajat").selectOption("sedang");
  await soap.getByLabel("Asesmen", { exact: true }).fill("Akne vulgaris sedang, kambuh");
  await soap.getByLabel("Nadi").fill("82");
  await soap.getByLabel(/L70\.0/).check();
  await soap.getByRole("button", { name: "Simpan Pemeriksaan" }).click();
  await d.getByText("Pemeriksaan tersimpan.").waitFor();
  await d.goto(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  await d.getByRole("form", { name: "Pemeriksaan SOAP" }).waitFor();
  const s2 = d.getByRole("form", { name: "Pemeriksaan SOAP" });
  flow.push(["SOAP: template value, assessment, vital and code are kept", (await s2.getByLabel("Fitzpatrick").inputValue()) === "IV"
    && (await s2.getByLabel("Asesmen", { exact: true }).inputValue()) === "Akne vulgaris sedang, kambuh" && (await s2.getByLabel(/L70\.0/).isChecked())]);

  // Face map: a tap places a point; the keyboard form adds a tindakan point with a dose.
  const map = d.getByRole("img", { name: /Peta Wajah depan/ });
  await map.click();
  const mf = d.getByRole("form", { name: "Tambah titik" });
  const tapped = (await mf.getByLabel("Posisi X").inputValue()) !== "";
  await mf.getByLabel("Keterangan titik").fill("Papul pipi kanan");
  await mf.getByRole("button", { name: "Tambah Titik" }).click();
  await d.getByText("Titik tersimpan.").waitFor();
  const mf2 = d.getByRole("form", { name: "Tambah titik" });
  await mf2.getByLabel("Posisi X").fill("500");
  await mf2.getByLabel("Posisi Y").fill("300");
  await mf2.getByLabel("Lapisan").selectOption("tindakan");
  await mf2.getByLabel("Keterangan titik").fill("Dahi");
  await mf2.getByLabel("Dosis titik").fill("0,5");
  await mf2.getByLabel("Satuan").selectOption("ml");
  await mf2.getByRole("button", { name: "Tambah Titik" }).click();
  await d.getByText("Titik tersimpan.").waitFor();
  await d.goto(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  await d.getByRole("img", { name: /Peta Wajah depan: 2 titik/ }).waitFor();
  const marks = await d.locator("main:visible table").first().innerText();
  flow.push(["face map: a tapped point and a keyboard point with a dose per point", tapped && marks.includes("Papul pipi kanan") && /Dahi[\s\S]*0,5 ml/.test(marks)]);
  await d.screenshot({ path: `${OUT}/peta-1440.png`, fullPage: true });

  // CLIN-012: a second plan in parallel with an item; live prices; Tanda Tangani disabled with its reason.
  const np = d.getByRole("form", { name: "Rencana baru" });
  await np.getByLabel("Nama rencana").fill("Program Flek");
  await np.getByLabel("Kondisi").fill("Melasma ringan");
  await np.getByRole("button", { name: "Buat Rencana" }).click();
  await d.getByText("Rencana dibuat.").waitFor();
  await d.goto(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  const flek = d.getByRole("region", { name: "Program Flek" });
  await flek.waitFor();
  await flek.getByText("Tambah item").click();
  const add = flek.getByRole("form", { name: "Tambah item rencana" });
  await add.getByLabel("Item katalog").selectOption({ label: "Toner Lembut" });
  await add.getByLabel("Jumlah").fill("3");
  await add.getByRole("button", { name: "Tambah ke Rencana" }).click();
  await d.getByText("Item ditambahkan.").waitFor();
  await d.goto(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  await d.getByRole("region", { name: "Program Flek" }).waitFor();
  const plans = await d.getByRole("complementary", { name: "Rencana Perawatan" }).innerText();
  flow.push(["CLIN-012: two plans side by side with their own items and live totals", plans.includes("Program Jerawat") && plans.includes("Program Flek")
    && /Toner Lembut × 3\s*Rp\s?300\.000/.test(plans) && /Rp\s?600\.000/.test(plans)]);
  const sign = d.getByRole("button", { name: "Tanda Tangani" });
  flow.push(["Tanda Tangani is disabled with the reason (signing in T-053)", (await sign.getAttribute("aria-disabled")) === "true" && (await main(d)).includes("Penandatanganan rekam medis (PIN/OTP) belum aktif")]);
  await d.screenshot({ path: `${OUT}/rencana-1440.png`, fullPage: true });
  // Compact: the Riwayat disclosure keeps a typed SOAP edit.
  await d.setViewportSize({ width: 390, height: 900 });
  await d.goto(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  await d.getByRole("form", { name: "Pemeriksaan SOAP" }).waitFor();
  await d.getByLabel("Subjektif").fill("Gatal ringan");
  await d.getByText(/Riwayat \(2 kunjungan\)/).click();
  flow.push(["compact: the Riwayat disclosure opens and the typed text is kept", (await d.getByLabel("Subjektif").inputValue()) === "Gatal ringan" && (await main(d)).includes("Akne vulgaris ringan")]);
  await d.screenshot({ path: `${OUT}/riwayat-390.png`, fullPage: true });
  await d.setViewportSize({ width: 1440, height: 900 });
  // Another doctor's examination: read-only.
  await d.goto(`${BASE}/pemeriksaan/${seed.visits.dewi}`);
  await d.getByRole("heading", { name: "Dewi Diperiksa", level: 1 }).waitFor();
  flow.push(["another doctor's examination is read-only", (await main(d)).includes("Diperiksa dr. Bima") && (await d.getByRole("form", { name: "Pemeriksaan SOAP" }).count()) === 0]);
  await dCtx.close();

  // Nurse: no sheet (clinical readers only); the plan projection is not a page here.
  const nCtx = await ctxOf("203.0.113.192");
  const n = await nCtx.newPage();
  current = n;
  n.on("console", onConsole);
  await signIn(n, seed.people.nur.email, false); // a nurse has no second factor (PR-3)
  await n.goto(`${BASE}/pemeriksaan/${seed.visits.sari}`);
  await n.locator("main").first().waitFor();
  flow.push(["nurse: the sheet answers the permission state", !(await main(n)).includes("Amoksisilin")]);
  await nCtx.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await current.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
