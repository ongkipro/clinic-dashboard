// T-058 browser evidence (Templat Dokumen UX-54, Surat 19:92, PR-74) at 390/820/1180/1440 and 200 % text. The admin
// pusat's template list by kind, a template page with preview, placeholder list and history; Simpan Versi on a used
// version publishes a new one; a template that names patient data is refused; the facility head sees the clinical
// kinds only; the doctor creates a letter from today's visit, edits the draft, sees "Tanda Tangani" blocked (step-up
// producer pending), opens a signed letter (locked, versions), corrects it as a new version and downloads the PDF;
// the FO gets the permission state. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/templat.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branch: string; visits: Record<string, string>; letters: Record<string, string>; templates: Record<string, string> };
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
  check(): Promise<void>; uncheck(): Promise<void>; isChecked(): Promise<boolean>; isDisabled(): Promise<boolean>; nth(i: number): Locator; inputValue(): Promise<string>; selectOption(v: string | object): Promise<unknown>; evaluateAll<T>(f: (e: Element[]) => T): Promise<T>; allInnerTexts(): Promise<string[]>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
  evaluate<T>(f: (e: Element) => T): Promise<T>;
  focus(): Promise<void>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp, o?: { waitUntil?: "load" | "commit" }): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp): Locator; locator(s: string): Locator; url(): string;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  keyboard: { press(k: string): Promise<void> };
  mouse: { move(x: number, y: number, o?: { steps?: number }): Promise<void>; down(): Promise<void>; up(): Promise<void> };
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
  const open = async (who: string, totpRole: boolean, ip: string) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };

  // Admin pusat: Templat Dokumen by kind; a template page; Simpan Versi on a used version; patient data refused.
  const ap = await open("ap", true, "203.0.113.221");
  await ap.p.goto(`${BASE}/templat`);
  await ap.p.waitForURL(`${BASE}/templat/dokumen`);
  await ap.p.getByRole("heading", { name: "Templat Dokumen", level: 1 }).waitFor();
  flow.push(["index: /templat sends the admin pusat to Templat Dokumen", true]);
  const segs = ap.p.getByRole("group", { name: "Tampilan tersimpan" });
  flow.push(["list: four kinds as segments", (await segs.getByRole("link").allInnerTexts()).join("|") === "Struk|Persetujuan Tindakan|Surat|Halaman Legal"]);
  await layouts(ap.p, "/templat/dokumen?jenis=letter", "daftar");
  await ap.p.goto(`${BASE}/templat/dokumen/${seed.templates.letter}`);
  await ap.p.getByRole("heading", { name: "Surat Keterangan Istirahat", level: 1 }).waitFor();
  const tp = await main(ap.p);
  flow.push(["template: preview from samples, used notice, history", tp.includes("Pasien Contoh (RM-CONTOH)") && tp.includes("Versi sudah dipakai — buat versi baru") && tp.includes("Versi 1")]);
  await layouts(ap.p, `/templat/dokumen/${seed.templates.letter}`, "templat");
  const body = ap.p.getByLabel("Isi templat");
  await body.fill(`${await body.inputValue()}\nBerlaku sejak {{tanggal}}.`);
  await ap.p.getByRole("button", { name: "Simpan Versi" }).click();
  await ap.p.getByText("Versi baru tersimpan dan kini dipakai.").waitFor();
  await ap.p.goto(`${BASE}/templat/dokumen/${seed.templates.letter}`);
  await ap.p.getByRole("heading", { name: "Surat Keterangan Istirahat", level: 1 }).waitFor();
  flow.push(["Simpan Versi: version 2 active, version 1 kept", /Versi 2 · dipakai sekarang[\s\S]*Versi 1 · lama · sudah dipakai/.test(await main(ap.p))]);
  const b2 = ap.p.getByLabel("Isi templat");
  await b2.fill(`${await b2.inputValue()} Pasien RM-000777`);
  await ap.p.getByRole("button", { name: "Simpan Versi" }).click();
  await ap.p.getByText(/Templat tidak boleh memuat data pasien/).waitFor();
  flow.push(["patient data in a template is refused with the reason", true]);
  await ap.p.goto(`${BASE}/templat/dokumen/baru?jenis=legal`);
  await ap.p.getByRole("heading", { name: "Buat Templat", level: 1 }).waitFor();
  await layouts(ap.p, "/templat/dokumen/baru?jenis=legal", "baru");
  await ap.c.close();

  // Facility head: the clinical kinds only.
  const fh = await open("fh", true, "203.0.113.222");
  await fh.p.goto(`${BASE}/templat/dokumen`);
  await fh.p.getByRole("heading", { name: "Templat Dokumen", level: 1 }).waitFor();
  flow.push(["facility head: Persetujuan and Surat only",
    (await fh.p.getByRole("group", { name: "Tampilan tersimpan" }).getByRole("link").allInnerTexts()).join("|") === "Persetujuan Tindakan|Surat"]);
  await fh.c.close();

  // Doctor: Buat Surat from today's visit; draft; signing blocked; a signed letter; correction; PDF.
  const doc = await open("doc", true, "203.0.113.223");
  await doc.p.goto(`${BASE}/templat/surat/baru?visit=${seed.visits.sari}`);
  await doc.p.getByRole("heading", { name: "Buat Surat", level: 1 }).waitFor();
  await layouts(doc.p, `/templat/surat/baru?visit=${seed.visits.sari}`, "buat");
  await doc.p.getByLabel("Templat", { exact: true }).selectOption({ index: 1 });
  await doc.p.getByRole("button", { name: "Buat Surat" }).click();
  await doc.p.getByText("Draf surat dibuat.").waitFor();
  await doc.p.getByRole("link", { name: "Buka draf surat" }).click();
  await doc.p.getByRole("heading", { name: "Sari Surat", level: 1 }).waitFor();
  const draft = await main(doc.p);
  flow.push(["draft: filled from the patient and the doctor's SIP; signing blocked", (await doc.p.getByLabel("Isi surat", { exact: true }).inputValue()).includes("SIP SIP-AYU-2026")
    && draft.includes("Tanda tangan surat memerlukan verifikasi kode autentikator")]);
  const lb = doc.p.getByLabel("Isi surat", { exact: true });
  await lb.fill(`${await lb.inputValue()}\nIstirahat dua hari.`);
  await doc.p.getByRole("button", { name: "Simpan Draf" }).click();
  await doc.p.getByText("Draf tersimpan.").waitFor();
  flow.push(["draft: saved; the form keeps the result", true]);
  await layouts(doc.p, `/templat/surat/${seed.letters.draft}`, "draf");
  await doc.p.goto(`${BASE}/templat/surat/${seed.letters.signed}`);
  await doc.p.getByRole("heading", { name: "Dewi Tertanda", level: 1 }).waitFor();
  const sg = await main(doc.p);
  flow.push(["signed: locked badge, version 1, PDF link", sg.includes("Ditandatangani · versi 1") && sg.includes("Versi 1 · asli") && (await doc.p.getByRole("link", { name: "Unduh PDF" }).count()) === 1]);
  await layouts(doc.p, `/templat/surat/${seed.letters.signed}`, "tertanda");
  const cb = doc.p.getByLabel("Isi surat yang dikoreksi");
  await cb.fill((await cb.inputValue()).replace("memerlukan istirahat", "memerlukan istirahat tiga hari"));
  await doc.p.getByLabel("Alasan koreksi").fill("Lama istirahat belum ditulis");
  await doc.p.getByRole("button", { name: "Simpan Koreksi" }).click();
  await doc.p.getByText("Koreksi tersimpan sebagai versi baru.").waitFor();
  await doc.p.goto(`${BASE}/templat/surat/${seed.letters.signed}`);
  await doc.p.getByRole("heading", { name: "Dewi Tertanda", level: 1 }).waitFor();
  flow.push(["correction: version 2 with its reason, version 1 kept", /Versi 2 · koreksi[\s\S]*Alasan: Lama istirahat belum ditulis[\s\S]*Versi 1 · asli/.test(await main(doc.p))]);
  await doc.p.screenshot({ path: `${OUT}/koreksi-1440.png`, fullPage: true });
  const pdf = await doc.p.evaluate(async () => {
    const r = await fetch(location.pathname + "/pdf");
    return { status: r.status, type: r.headers.get("content-type"), head: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5)) };
  });
  flow.push(["PDF: an attachment that is a PDF", pdf.status === 200 && pdf.type === "application/pdf" && pdf.head === "%PDF-"]);
  await doc.p.goto(`${BASE}/templat/surat`);
  await doc.p.getByRole("heading", { name: "Surat", level: 1 }).waitFor();
  flow.push(["Surat list: the doctor's letters with their state", /Dewi Tertanda[\s\S]*versi 2[\s\S]*Tertanda/.test(await main(doc.p)) && (await main(doc.p)).includes("Draf")]);
  await layouts(doc.p, "/templat/surat", "surat");
  await doc.c.close();

  // FO: no page.
  const fo = await open("fo", false, "203.0.113.224");
  await fo.p.goto(`${BASE}/templat/surat/${seed.letters.signed}`);
  await fo.p.locator("main").first().waitFor();
  const ft = await main(fo.p);
  flow.push(["FO: permission state, no letter content", !ft.includes("Dewi Tertanda") && !ft.includes("istirahat")]);
  await fo.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
