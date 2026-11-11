// T-065 browser evidence (Siapkan & Serahkan, UX-10, 17:168, 19:134-135, PR-18) at 390/820/1180/1440 and 200 % text.
// The pharmacist opens Apotek (lands on Siapkan): the confirmed selection's treatment materials (one recipe row
// unmapped) and serum with its FEFO batch, the unsigned prescription and the unpaid visit as blocked rows; maps the
// row and prepares the materials (issued into the room depot); prepares the serum and the external-use cream; on
// Serahkan the cream's handover is refused until the etiket biru is printed, then needs an exception note for an
// unchecked check; the recorded handover shows; Tandai Keluhan Klinis opens the complaint report. The front office has
// no access. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/apotek.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; visits: Record<string, string> };
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
  const open = async (who: string, totpRole: boolean, ip: string) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const ok = async (p: Page, text: string | RegExp) => p.getByRole("status").filter({ hasText: text }).first().waitFor();

  // Pharmacist: /apotek lands on Siapkan; rows by patient.
  const ph = await open("ph", false, "203.0.113.171");
  await ph.p.goto(`${BASE}/apotek`);
  await ph.p.waitForURL(`${BASE}/apotek/siapkan`);
  await ph.p.getByRole("heading", { name: "Siapkan", level: 1 }).waitFor();
  const list = await main(ph.p);
  flow.push(["PR-18: the confirmed selection's treatment materials and product listed with no manual entry; FEFO batch suggested",
    /Ayu Lestari[\s\S]*Laser Peremajaan[\s\S]*Gel Pendingin: 5 ml[\s\S]*Kasa steril \(2 lembar\) — belum dipetakan/.test(list) && /Serum Vitamin C · 2 btl[\s\S]*Batch disarankan: SRM-A/.test(list)]);
  flow.push(["blocked rows stay listed: unsigned prescription, unpaid visit", /Bunga Citra[\s\S]*Resep belum ditandatangani/.test(list) && /Citra Dewi[\s\S]*Belum dibayar/.test(list)]);
  await layouts(ph.p, "/apotek/siapkan", "siapkan");
  // Map the unmapped recipe row, then Siapkan Bahan (request + issue into the room depot).
  await ph.p.getByRole("button", { name: "Petakan Kasa steril…" }).click();
  const map = ph.p.getByRole("form", { name: "Petakan Kasa steril" });
  await map.getByLabel("Item stok").selectOption({ label: "Kasa Steril (lembar)" });
  await map.getByLabel("Per tindakan").fill("2");
  await map.getByRole("button", { name: "Simpan Peta" }).click();
  // the mapped row leaves the unmapped state: its form is replaced by Siapkan Bahan (wait for the new view)
  const mats = ph.p.getByRole("form", { name: "Siapkan bahan Laser Peremajaan" });
  await mats.waitFor();
  flow.push(["recipe row mapped: Kasa Steril per treatment", /Kasa Steril: 2 lembar/.test(await main(ph.p))]);
  await mats.getByRole("button", { name: "Siapkan Bahan" }).click();
  await ph.p.getByRole("region", { name: "Bahan Laser Peremajaan" }).waitFor({ state: "detached" });
  flow.push(["treatment materials prepared and issued: the row leaves the list", !/Laser Peremajaan/.test(await main(ph.p))]);
  // Siapkan the serum (no stock moves) and the cream: each row moves to Serahkan.
  await ph.p.getByRole("form", { name: "Siapkan Serum Vitamin C" }).first().getByRole("button", { name: "Siapkan" }).click();
  await ph.p.getByRole("region", { name: "Produk Serum Vitamin C" }).filter({ hasText: "2 btl" }).waitFor({ state: "detached" });
  await ph.p.getByRole("form", { name: "Siapkan Krim Hidrokortison" }).getByRole("button", { name: "Siapkan" }).click();
  await ph.p.getByRole("region", { name: "Produk Krim Hidrokortison" }).waitFor({ state: "detached" });
  // Serahkan list.
  await ph.p.goto(`${BASE}/apotek/serahkan`);
  await ph.p.getByRole("heading", { name: "Serahkan", level: 1 }).waitFor();
  const ser = await main(ph.p);
  flow.push(["Serahkan lists the prepared items", /Ayu Lestari[\s\S]*Serum Vitamin C/.test(ser) && /Bunga Citra[\s\S]*Krim Hidrokortison/.test(ser)]);
  await layouts(ph.p, "/apotek/serahkan", "serahkan");
  // The cream: external use — the etiket biru must be printed first.
  await ph.p.getByRole("link", { name: /Bunga Citra/ }).click();
  await ph.p.getByRole("heading", { name: "Bunga Citra", level: 1 }).waitFor();
  const det = await main(ph.p);
  flow.push(["detail: prescription (prescriber, valid until, signa, KFA) and etiket biru notice",
    /Etiket biru — obat luar/.test(det) && /Penulis resep: dr\. Maya/.test(det) && /berlaku sampai/.test(det) && /Kode KFA 93012345/.test(det)]);
  const cream = ph.p.url().split("/").pop()!;
  await layouts(ph.p, `/apotek/serahkan/${cream}`, "rincian");
  const hand = ph.p.getByRole("form", { name: "Serahkan" });
  for (const l of ["Identitas pasien dan penulis resep", "Keabsahan resep", "Dosis, rute, dan frekuensi", "Alergi dan interaksi", "Hasil klarifikasi", "Etiket", "Konseling"])
    await hand.getByLabel(l).check();
  await hand.getByRole("button", { name: "Serahkan" }).click();
  await ph.p.getByRole("alert").filter({ hasText: "Cetak etiket biru" }).first().waitFor();
  flow.push(["external use: handover refused until the etiket biru is printed", true]);
  await ph.p.getByRole("button", { name: "Cetak Etiket Biru" }).click();
  await ok(ph.p, "Etiket dicetak.");
  await ph.p.reload();
  await ph.p.getByRole("heading", { name: "Bunga Citra", level: 1 }).waitFor();
  const hand2 = ph.p.getByRole("form", { name: "Serahkan" });
  for (const l of ["Identitas pasien dan penulis resep", "Keabsahan resep", "Dosis, rute, dan frekuensi", "Alergi dan interaksi", "Etiket", "Konseling"])
    await hand2.getByLabel(l).check();
  await hand2.getByRole("button", { name: "Serahkan" }).click();
  await ph.p.getByRole("alert").filter({ hasText: "catatan pengecualian" }).first().waitFor();
  await hand2.getByLabel("Catatan pengecualian").fill("Dokter tidak dapat dihubungi; dosis standar sesuai label");
  await hand2.getByRole("button", { name: "Serahkan" }).click();
  // the handover replaces the form with the recorded handover (wait for the new view, not the form's status)
  await ph.p.getByRole("region", { name: "Penyerahan tercatat" }).waitFor();
  const rec = await main(ph.p);
  flow.push(["seven checks recorded with the exception note and the batch", /✗ Hasil klarifikasi/.test(rec) && /Pengecualian: Dokter tidak dapat dihubungi/.test(rec) && /Batch: CRM-1/.test(rec)]);
  await measure(ph.p, "tercatat-1440", "tercatat-1440");
  await ph.p.setViewportSize({ width: 390, height: 900 });
  await measure(ph.p, "tercatat-390", "tercatat-390");
  await ph.p.setViewportSize({ width: 1440, height: 900 });
  // CLIN-024: "Tandai Keluhan Klinis" opens the complaint report preset to this visit (pharmacist source).
  await ph.p.getByRole("link", { name: "Tandai Keluhan Klinis" }).click();
  await ph.p.getByRole("heading", { name: "Laporkan Keluhan", level: 1 }).waitFor();
  flow.push(["CLIN-024: the pharmacist's flag opens the clinical complaint report for the visit", /Bunga Citra/.test(await main(ph.p))]);
  await ph.c.close();

  // The front office has no Apotek screens (it sees the dispensing step on VisitTrack only).
  const fo = await open("fo", false, "203.0.113.172");
  await fo.p.goto(`${BASE}/apotek/siapkan`);
  await fo.p.getByText("Anda tidak memiliki akses ke apotek.").waitFor();
  flow.push(["front office: no access to the pharmacy screens", true]);
  await fo.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
