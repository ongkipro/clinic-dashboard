// T-036 browser evidence (UX-2, PR-2) at 390/820/1180/1440 and 200 % text. Done when: the branch master
// is saved and audited, and this browser check passes. The Owner sees the branch list with the SET-46
// badge, opens Kemang, saves Identitas, Jam Buka (with a midday break), a closure for today, a room and
// a device, Layanan Tersedia and Izin; the SATUSEHAT banner clears once the licence data is complete; a
// bad WhatsApp number is refused with its copy and the field keeps the value; the Owner adds a branch;
// the Manager reaches Jam through the menu link, edits hours and rooms at Kemang, reads the rest and
// does not find Makassar; the Pengaturan links (SET-2, SET-3, SET-46) lead to the branch pages.
// No console error.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/cabang.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string }>; kemang: string; makassar: string; facial: string };
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
  waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; selectOption(v: string | object): Promise<unknown>; evaluateAll<T>(f: (e: Element[]) => T): Promise<T>; allInnerTexts(): Promise<string[]>; getByText(t: string, o?: { exact?: boolean }): Locator;
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
  const main = (p: Page) => p.locator("main").innerText();
  const sec = (p: Page, h: string) => p.locator("main section").filter({ has: p.getByRole("heading", { name: h, exact: true }) });
  const form = (p: Page, label: string) => p.locator(`main form[aria-label="${label}"]`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

  const oCtx = await ctxOf("203.0.113.81");
  const o = await oCtx.newPage();
  current = o;
  o.on("console", onConsole);
  await signIn(o, seed.people.owner.email);
  await o.goto(`${BASE}/pengaturan/cabang`);
  await o.getByRole("heading", { name: "Cabang", exact: true }).waitFor();
  const list = await main(o);
  flow.push(["the Owner's branch list shows both branches with the missing-licence badge and Tambah Cabang", list.includes("Cabang Kemang") && list.includes("Cabang Makassar") && list.includes("Data izin belum lengkap") && list.includes("Tambah cabang") && list.includes("WIB (Jakarta)") && list.includes("WITA (Makassar)") && !list.includes("undefined")]);
  await layouts(o, "/pengaturan/cabang", "list");
  await layouts(o, `/pengaturan/cabang/${seed.kemang}`, "detail");
  await o.goto(`${BASE}/pengaturan/cabang/${seed.kemang}`);
  await o.getByText("Cabang belum punya kredensial SATUSEHAT").waitFor();
  flow.push(["the UX-2 banner shows while the licence data is incomplete", true]);
  // Identitas.
  await form(o, "Identitas cabang").getByLabel("Alamat", { exact: true }).fill("Jl. Kemang Raya 10");
  await form(o, "Identitas cabang").getByRole("button", { name: "Simpan" }).click();
  await form(o, "Identitas cabang").getByText("Tersimpan.").waitFor();
  // WhatsApp: a bad number is refused with its copy, the field keeps the value.
  await form(o, "Nomor WhatsApp").getByLabel("Nomor WhatsApp cabang", { exact: true }).fill("08123");
  await form(o, "Nomor WhatsApp").getByRole("button", { name: "Simpan" }).click();
  await form(o, "Nomor WhatsApp").locator("p[role=alert]").waitFor();
  const waErr = await form(o, "Nomor WhatsApp").locator("p[role=alert]").innerText();
  const waKept = await form(o, "Nomor WhatsApp").getByLabel("Nomor WhatsApp cabang", { exact: true }).evaluate((e: Element) => (e as HTMLInputElement).value);
  flow.push(["a bad WhatsApp number is refused with its copy and the field keeps it", waErr.includes("+62") && waKept === "08123"]);
  await form(o, "Nomor WhatsApp").getByLabel("Nomor WhatsApp cabang", { exact: true }).fill("+6281211112222");
  await form(o, "Nomor WhatsApp").getByRole("button", { name: "Simpan" }).click();
  await form(o, "Nomor WhatsApp").getByText("Tersimpan.").waitFor();
  // Jam Buka: Senin 09:00-12:00 and 13:00-20:00.
  const hrs = form(o, "Jam buka");
  const senin = hrs.locator("fieldset").filter({ hasText: "Senin" });
  await senin.getByLabel("Buka 1", { exact: true }).fill("09:00");
  await senin.getByLabel("Tutup 1", { exact: true }).fill("12:00");
  await senin.getByLabel("Buka 2", { exact: true }).fill("13:00");
  await senin.getByLabel("Tutup 2", { exact: true }).fill("20:00");
  await hrs.getByRole("button", { name: "Simpan" }).click();
  await hrs.getByText("Jam buka tersimpan.").waitFor();
  // A closure for today (branch time).
  const cl = form(o, "Tambah libur");
  await cl.getByLabel("Tanggal libur", { exact: true }).fill(today);
  await cl.getByLabel("Alasan", { exact: true }).fill("Rapat darurat");
  await cl.getByRole("button", { name: "Tambah Libur" }).click();
  await o.locator("main").getByRole("list", { name: "Libur terjadwal" }).waitFor();
  flow.push(["a closure for today is added and listed", (await o.locator("main").getByRole("list", { name: "Libur terjadwal" }).innerText()).includes("Rapat darurat")]);
  // A room and a device.
  await form(o, "Tambah ruang").getByLabel("Nama ruang", { exact: true }).fill("Ruang Tindakan 1");
  await form(o, "Tambah ruang").getByRole("button", { name: "Tambah Ruang" }).click();
  await form(o, "Tambah ruang").getByText("Ruang ditambahkan.").waitFor();
  await form(o, "Tambah alat").getByLabel("Nama alat", { exact: true }).fill("Laser A");
  await form(o, "Tambah alat").getByLabel("Jenis alat", { exact: true }).selectOption("laser_non_ablative");
  await form(o, "Tambah alat").getByRole("button", { name: "Tambah Alat" }).click();
  await form(o, "Tambah alat").getByText("Alat ditambahkan.").waitFor();
  // Layanan Tersedia.
  await form(o, "Layanan tersedia").getByLabel(/Facial Brightening/).check();
  await form(o, "Layanan tersedia").getByRole("button", { name: "Simpan" }).click();
  await form(o, "Layanan tersedia").getByText("Layanan tersedia tersimpan.").waitFor();
  // Izin: complete the SET-46 data, the banner clears.
  const izin = form(o, "Data izin");
  await izin.getByLabel("Nomor izin klinik", { exact: true }).fill("503/123/KLINIK");
  await izin.getByLabel("NIB", { exact: true }).fill("1234567890123");
  await izin.getByLabel("ID organisasi SATUSEHAT", { exact: true }).fill("org-uji-1");
  await izin.getByLabel("Penanggung jawab klinik", { exact: true }).selectOption({ label: "dr. Penanggung Jawab" } as never);
  await izin.getByRole("button", { name: "Simpan" }).click();
  await izin.getByText("Tersimpan.").waitFor();
  await o.goto(`${BASE}/pengaturan/cabang/${seed.kemang}`);
  await o.getByRole("heading", { name: "Jam Buka", exact: true }).waitFor();
  const after = await main(o);
  const seninAfter = await sec(o, "Jam Buka").locator("fieldset").filter({ hasText: "Senin" }).getByLabel("Tutup 2", { exact: true }).evaluate((e: Element) => (e as HTMLInputElement).value);
  flow.push(["after a reload everything is kept and the banner is gone", !after.includes("Cabang belum punya kredensial SATUSEHAT") && after.includes("Data izin lengkap") && after.includes("Ruang Tindakan 1") && after.includes("Laser A") && seninAfter === "20:00" && after.includes("Cabang · KMG · WIB (Jakarta)") && !after.includes("undefined")]);
  await o.screenshot({ path: `${OUT}/owner-detail-1440.png`, fullPage: true });
  await o.setViewportSize({ width: 390, height: 900 });
  await measure(o, "owner-detail-390", "owner-detail-390");
  await o.setViewportSize({ width: 1440, height: 900 });
  // Add a branch.
  await o.goto(`${BASE}/pengaturan/cabang`);
  await form(o, "Tambah cabang").getByLabel("Kode", { exact: true }).fill("BSD-1");
  await form(o, "Tambah cabang").getByLabel("Nama cabang", { exact: true }).fill("Cabang BSD");
  await form(o, "Tambah cabang").getByRole("button", { name: "Tambah Cabang" }).click();
  await o.getByRole("heading", { name: "Cabang BSD" }).waitFor();
  flow.push(["the Owner adds a branch and lands on its page", (await main(o)).includes("BSD-1")]);
  // The Pengaturan links lead to the branch pages (SET-2, SET-3, SET-46).
  await o.goto(`${BASE}/pengaturan/klinik`);
  await o.getByRole("heading", { level: 1 }).waitFor();
  const hrefs = await o.locator("main a").evaluateAll((els: Element[]) => els.map((e) => e.getAttribute("href") ?? ""));
  flow.push(["Pengaturan Klinik & Cabang links to the branch pages, none to /cabang", hrefs.includes("/pengaturan/cabang/jam") && hrefs.includes("/pengaturan/cabang") && !hrefs.includes("/cabang")]);
  await oCtx.close();

  // The Manager of Kemang.
  const mCtx = await ctxOf("203.0.113.82");
  const m = await mCtx.newPage();
  current = m;
  m.on("console", onConsole);
  await signIn(m, seed.people.mgr.email);
  await m.goto(`${BASE}/pengaturan/cabang/jam`);
  await m.waitForURL(new RegExp(`/pengaturan/cabang/${seed.kemang}`));
  await m.getByRole("heading", { name: "Jam Buka", exact: true }).waitFor();
  const mText = await main(m);
  flow.push(["the Manager reaches Jam through the menu link; the profile and licence are read-only for them", m.url().includes(seed.kemang) && (await form(m, "Identitas cabang").count()) === 0 && (await form(m, "Data izin").count()) === 0 && (await form(m, "Jam buka").count()) === 1 && mText.includes("503/123/KLINIK")]);
  const mHrs = form(m, "Jam buka");
  await mHrs.locator("fieldset").filter({ hasText: "Sabtu" }).getByLabel("Buka 1", { exact: true }).fill("10:00");
  await mHrs.locator("fieldset").filter({ hasText: "Sabtu" }).getByLabel("Tutup 1", { exact: true }).fill("16:00");
  await mHrs.getByRole("button", { name: "Simpan" }).click();
  await mHrs.getByText("Jam buka tersimpan.").waitFor();
  flow.push(["the Manager saves hours at their own branch", true]);
  // Next's not-found page (no <main>): a branch outside the manager's set is answered 404.
  await m.goto(`${BASE}/pengaturan/cabang/${seed.makassar}`);
  await m.getByText("This page could not be found.").waitFor();
  flow.push(["the Manager does not find another branch (404)", (await m.locator("body").innerText()).includes("404") && !(await m.locator("body").innerText()).includes("Cabang Makassar ·")]);
  await m.screenshot({ path: `${OUT}/manager-other-1440.png`, fullPage: true });
  await mCtx.close();
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
