// T-037 browser evidence (UX-4, PR-5) at 390/820/1180/1440 and 200 % text. Done when: scenario PR-5 in the
// browser and the NIK never shown back. FO searches first (nothing), registers an adult with a NIK (MRN
// shown); registers a minor without a guardian (refused with its copy), then with a guardian; registers
// another person with the same phone (UX-4 copy "Nomor HP dipakai pasien lain — pilih atau buat baru",
// both listed with masked phones; the NIK field shows only a mask and is never refilled; Buat Baru
// registers); a duplicate NIK is refused with the existing record offered and no Buat Baru; the search by
// phone lists both; the doctor gets no registration page; central CS on Semua Cabang picks a branch.
// No page or response contains a NIK. No console error.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/pasien-baru.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string }>; kemang: string; makassar: string };
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
const NIK_1 = "3171010101900001";
const NIK_2 = "3171010101850002";
const NIK_CHILD = "3171010101150003";
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main").innerText();
  const html = (p: Page) => p.evaluate(() => document.documentElement.outerHTML);
  const noNik = async (p: Page) => { const h = await html(p); return ![NIK_1, NIK_2, NIK_CHILD].some((n) => h.includes(n)); };
  const reg = (p: Page) => p.locator("main form[aria-label='Pasien baru']");
  async function fill(p: Page, f: Record<string, string>) {
    const form = reg(p);
    for (const [label, value] of Object.entries(f)) {
      const el = form.getByLabel(label, { exact: true });
      const tag = await el.evaluate((e: Element) => e.tagName);
      if (tag === "SELECT") await el.selectOption(value);
      else await el.fill(value);
    }
  }
  const adult = { "Nama lengkap": "Sinta Dewi", "Tanggal lahir": "1990-01-01", "Jenis kelamin": "female", "Nomor HP (WhatsApp)": "0812-1111-2222", "NIK (16 digit)": NIK_1,
    "Agama": "islam", "Pekerjaan": "Karyawan", "Pendidikan": "s1", "Status perkawinan": "kawin" };

  const fCtx = await ctxOf("203.0.113.71");
  const f = await fCtx.newPage();
  current = f;
  f.on("console", onConsole);
  await signIn(f, seed.people.fo.email, false);
  await layouts(f, "/pasien/baru", "baru");
  await f.goto(`${BASE}/pasien/baru`);
  await f.getByRole("heading", { name: "Pendaftaran Pasien" }).waitFor();
  // Cari dulu: nothing yet.
  await f.locator("main form[aria-label='Cari pasien dulu']").getByLabel("Kata pencarian").fill("081211112222");
  await f.getByRole("button", { name: "Cari Dulu" }).click();
  await f.getByText("Belum ada pasien yang cocok").waitFor();
  flow.push(["Cari dulu by phone finds nothing on an empty clinic", true]);
  // An adult with a NIK.
  await fill(f, adult);
  await reg(f).getByRole("button", { name: "Daftarkan" }).click();
  await f.getByText("Pasien terdaftar").waitFor();
  const done1 = await main(f);
  flow.push(["an adult with a NIK registers and the MRN is shown, never the NIK", /RM-0{5}1/.test(done1) && (await noNik(f))]);
  await f.screenshot({ path: `${OUT}/registered-1440.png`, fullPage: true });
  // A minor without a guardian is refused, then registered with one.
  await f.goto(`${BASE}/pasien/baru`);
  await reg(f).getByLabel("Nama lengkap", { exact: true }).waitFor();
  const minorBirth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() - 10 * 365 * 86_400_000));
  await fill(f, { ...adult, "Nama lengkap": "Adik Kecil", "Tanggal lahir": minorBirth, "Nomor HP (WhatsApp)": "0812-3333-4444", "NIK (16 digit)": NIK_CHILD, "Pendidikan": "sd", "Status perkawinan": "belum_kawin", "Pekerjaan": "Pelajar" });
  flow.push(["the guardian section appears for a minor", (await reg(f).getByLabel("Nama wali").count()) === 1]);
  await reg(f).getByRole("button", { name: "Daftarkan" }).click();
  await reg(f).locator("p[role=alert]").waitFor();
  const minorErr = await reg(f).locator("p[role=alert]").innerText();
  const kept = await reg(f).getByLabel("Nama lengkap", { exact: true }).evaluate((e: Element) => (e as HTMLInputElement).value);
  const nikAfter = await reg(f).getByLabel("NIK (16 digit)", { exact: true }).evaluate((e: Element) => (e as HTMLInputElement).value);
  flow.push(["a minor without a guardian is refused with its copy; fields are kept but the NIK is not refilled", minorErr.includes("wajib punya wali") && kept === "Adik Kecil" && nikAfter === "" && (await noNik(f))]);
  await fill(f, { "NIK (16 digit)": NIK_CHILD, "Nama wali": "Ibu Adik" });
  await reg(f).getByRole("button", { name: "Daftarkan" }).click();
  await f.getByText("Pasien terdaftar").waitFor();
  flow.push(["with a guardian the minor registers", (await main(f)).includes("Adik Kecil")]);
  // The same phone as Sinta, a different person: the explicit decision (PR-5, UX-4).
  await f.goto(`${BASE}/pasien/baru`);
  await reg(f).getByLabel("Nama lengkap", { exact: true }).waitFor();
  await fill(f, { ...adult, "Nama lengkap": "Rudi Suami", "Tanggal lahir": "1985-01-01", "Jenis kelamin": "male", "NIK (16 digit)": NIK_2 });
  await reg(f).getByRole("button", { name: "Daftarkan" }).click();
  await f.getByText("Nomor HP dipakai pasien lain — pilih atau buat baru").waitFor();
  const pauseText = await main(f);
  const masked = await reg(f).getByLabel("Nomor identitas", { exact: true }).evaluate((e: Element) => (e as HTMLInputElement).value);
  flow.push(["the same phone pauses with the UX-4 copy, lists Sinta with a masked phone, shows the NIK masked and never in the page", pauseText.includes("Sinta Dewi") && /\+62•+2222/.test(pauseText) && masked.endsWith("0002") && masked.startsWith("•") && (await noNik(f))]);
  await f.screenshot({ path: `${OUT}/duplicate-1440.png`, fullPage: true });
  await f.setViewportSize({ width: 390, height: 900 });
  await measure(f, "duplicate-390", "duplicate-390");
  await f.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await measure(f, "duplicate-390@200%", "duplicate-390-200");
  await f.setViewportSize({ width: 1440, height: 900 });
  await reg(f).getByRole("button", { name: "Buat Baru" }).click();
  await f.getByText("Pasien terdaftar").waitFor();
  flow.push(["Buat Baru registers the second person with the sealed NIK", (await main(f)).includes("Rudi Suami")]);
  // A duplicate NIK: refused, the existing record offered, no Buat Baru.
  await f.goto(`${BASE}/pasien/baru`);
  await reg(f).getByLabel("Nama lengkap", { exact: true }).waitFor();
  await fill(f, { ...adult, "Nama lengkap": "Orang Lain", "Nomor HP (WhatsApp)": "0812-5555-6666" });
  await reg(f).getByRole("button", { name: "Daftarkan" }).click();
  await f.getByText("Nomor identitas ini sudah terdaftar").waitFor();
  flow.push(["a duplicate NIK is refused with the existing record and no Buat Baru", (await main(f)).includes("Sinta Dewi") && (await reg(f).getByRole("button", { name: "Buat Baru" }).count()) === 0 && (await noNik(f))]);
  // Scenario PR-5: the search by that phone lists both.
  await f.goto(`${BASE}/pasien/baru`);
  await f.locator("main form[aria-label='Cari pasien dulu']").getByLabel("Kata pencarian").fill("0812 1111 2222");
  await f.getByRole("button", { name: "Cari Dulu" }).click();
  await f.getByRole("list", { name: "Hasil pencarian" }).waitFor();
  const results = await f.getByRole("list", { name: "Hasil pencarian" }).innerText();
  flow.push(["scenario PR-5: the search by the shared phone lists both people for a choice", results.includes("Sinta Dewi") && results.includes("Rudi Suami") && !results.includes("Jakarta") && (await noNik(f))]);
  await f.screenshot({ path: `${OUT}/search-1440.png`, fullPage: true });
  await fCtx.close();

  // The doctor reads patients elsewhere but does not register.
  const dCtx = await ctxOf("203.0.113.72");
  const d = await dCtx.newPage();
  current = d;
  d.on("console", onConsole);
  await signIn(d, seed.people.doc.email);
  await d.goto(`${BASE}/pasien/baru`);
  await d.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the doctor gets the permission state on Pendaftaran Pasien (title, no form)", (await reg(d).count()) === 0 && (await main(d)).includes("tidak memiliki akses")]);
  await dCtx.close();

  // Central CS on Semua Cabang chooses the branch.
  const cCtx = await ctxOf("203.0.113.73");
  const c = await cCtx.newPage();
  current = c;
  c.on("console", onConsole);
  await signIn(c, seed.people.cs.email);
  await c.goto(`${BASE}/pasien/baru`);
  await reg(c).getByLabel("Cabang pendaftaran", { exact: true }).waitFor();
  await fill(c, { ...adult, "Cabang pendaftaran": seed.makassar, "Nama lengkap": "Pasien Makassar", "Nomor HP (WhatsApp)": "0813-7777-8888", "NIK (16 digit)": "3171010101800004" });
  await reg(c).getByRole("button", { name: "Daftarkan" }).click();
  await c.getByText("Pasien terdaftar").waitFor();
  flow.push(["central CS on Semua Cabang picks a branch and registers", (await main(c)).includes("Pasien Makassar")]);
  await c.screenshot({ path: `${OUT}/cs-1440.png`, fullPage: true });
  await cCtx.close();
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
