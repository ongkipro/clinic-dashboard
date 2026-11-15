// T-090 browser evidence (Pesan, UX-17, PR-28) at 390/820/1180/1440 and 200 % text: the Kemang FO sees the open conversations of Kemang and
// the brand-wide one (never Bintaro's), opens a thread whose 24 h window is open and replies (the mock port; Terkirim), opens one whose window
// closed 26 h ago and gets "Jendela 24 jam habis — pilih template" with only approved templates and sends one; the filters Belum Ditugaskan /
// Milikku / Selesai (filtered-empty with its clear link); Ambil assigns to oneself; central CS routes the brand-wide conversation to Bintaro;
// the owner reads without a composer; marketing manages templates (a clinical draft refused, a neutral one saved) and has no thread; the
// auditor reads Templat and Nomor only; Nomor shows the WABA, the verification, the budget and the numbers without any token or PIN.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/pesan.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
  password: string; people: Record<string, { email: string; staffId: string }>;
  conversations: { open: string; closedWindow: string; brand: string; done: string };
};
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
  selectOption(v: string | object): Promise<unknown>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; inputValue(): Promise<string>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; evaluate<T, A>(f: (a: A) => T, a: A): Promise<T>; url(): string; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  addStyleTag(o: { content: string }): Promise<unknown>; reload(): Promise<unknown>; on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
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
    const box = (e: Element) => (["checkbox", "radio"].includes((e as HTMLInputElement).type) && (e.closest("label") ?? e.closest("li")) ? (e.closest("label") ?? e.closest("li"))! : e);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(box(e).getBoundingClientRect().height))) : null,
      smallest: ctl.map((e) => [Math.round(box(e).getBoundingClientRect().height), `${box(e).tagName}.${(box(e).getAttribute("type") ?? "")}:${(box(e).textContent ?? "").trim().slice(0, 30)}`] as const)
        .filter(([hgt]) => hgt < 44).slice(0, 4).map(([hgt, d]) => `${hgt}:${d}`),
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      squeezed: [...document.querySelectorAll("main dd, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight) || em * 1.2;
        return !e.classList.contains("sr-only") && cs.display !== "inline" && r.width > 0 && r.width < 4 * em && r.height > 3 * lh && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}:${(e.textContent || "").trim().slice(0, 30)}`),
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
  const open = async (who: string, ip: string, totpRole = false) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const C = seed.conversations;

  // Kemang FO: the list, the open thread (reply), the closed window (template only), filters, Ambil.
  const fo = await open("fo", "203.0.113.251");
  await fo.p.goto(`${BASE}/pesan`);
  await fo.p.getByRole("list", { name: "Percakapan" }).waitFor();
  const l0 = await main(fo.p);
  flow.push(["the Kemang FO sees Kemang's open conversations and the unrouted brand-wide one, not the closed one",
    /Sari Sintetis/.test(l0) && /Mega Sintetis/.test(l0) && /Lia Sintetis/.test(l0) && /Belum diarahkan ke cabang/.test(l0) && !/Ika Sintetis/.test(l0)
      && /Menunggu balasan/.test(l0) && /Hanya template/.test(l0) && /Jendela 24 jam terbuka/.test(l0) && !/slot facial/.test(l0)]);
  await layouts(fo.p, "/pesan", "list");
  await fo.p.goto(`${BASE}/pesan?filter=closed`);
  await fo.p.getByRole("list", { name: "Percakapan" }).waitFor();
  flow.push(["Selesai lists the closed conversation", /Ika Sintetis/.test(await main(fo.p))]);
  await fo.p.goto(`${BASE}/pesan?filter=mine`);
  await fo.p.getByText("Tidak ada percakapan untuk filter ini.").waitFor();
  flow.push(["Milikku with nothing assigned: filtered-empty with a clear link; the segment bar stays", (await fo.p.getByRole("link", { name: /Hapus Filter|Tampilkan Semua/ }).count()) >= 1
    && (await fo.p.getByRole("navigation", { name: "Bagian Pesan" }).count()) === 1]);
  await fo.p.goto(`${BASE}/pesan/${C.open}`);
  await fo.p.getByRole("form", { name: "Balas pesan" }).waitFor();
  const t0 = await main(fo.p);
  flow.push(["the open thread shows the message, the window time left and the composer", /slot facial jam 10/.test(t0) && /Jendela layanan 24 jam: sisa/.test(t0)]);
  await layouts(fo.p, `/pesan/${C.open}`, "thread-open");
  // a quick-reply shortcut fills the reply (DEC-102 (6))
  await fo.p.getByRole("group", { name: "Balasan cepat" }).getByRole("button", { name: "Sapaan" }).click();
  flow.push(["a quick-reply shortcut fills the reply box", /terima kasih telah menghubungi kami/.test(await fo.p.getByLabel("Balasan", { exact: true }).inputValue())]);
  await fo.p.getByRole("form", { name: "Ambil percakapan" }).getByRole("button", { name: "Ambil" }).click();
  await fo.p.getByText("Percakapan ditugaskan.").first().waitFor();
  await fo.p.getByLabel("Balasan", { exact: true }).fill("Ada, Kak. Besok jam 10.00 masih tersedia.");
  await fo.p.getByRole("form", { name: "Balas pesan" }).getByRole("button", { name: "Kirim" }).click();
  await fo.p.getByText("Pesan terkirim.").first().waitFor();
  await fo.p.reload();
  await fo.p.getByRole("form", { name: "Balas pesan" }).waitFor();
  const t1 = await main(fo.p);
  flow.push(["Ambil then a reply inside the window: Ditangani Anda, the reply Terkirim", /Ditangani Anda/.test(t1) && /Besok jam 10\.00 masih tersedia[\s\S]*Terkirim/.test(t1)]);
  await fo.p.goto(`${BASE}/pesan?filter=mine`);
  await fo.p.getByRole("list", { name: "Percakapan" }).waitFor();
  flow.push(["Milikku now lists the taken conversation", /Sari Sintetis/.test(await main(fo.p))]);
  await fo.p.goto(`${BASE}/pesan/${C.closedWindow}`);
  await fo.p.getByText("Jendela 24 jam habis — pilih template.").waitFor();
  flow.push(["26 h after the last patient message: no free-form reply, only approved templates (PR-28)",
    (await fo.p.getByRole("form", { name: "Balas pesan" }).count()) === 0 && (await fo.p.getByLabel("Pilih Template").locator("option").count()) === 4
      && !/sapaan_baru/.test(await fo.p.getByLabel("Pilih Template").innerText())]);
  await layouts(fo.p, `/pesan/${C.closedWindow}`, "thread-closed");
  await fo.p.getByLabel("Pilih Template").selectOption({ label: "konfirmasi_booking · Utilitas" });
  await fo.p.getByLabel("Isian {{1}}").fill("Senin 10.00");
  await fo.p.getByRole("form", { name: "Kirim template" }).getByRole("button", { name: "Kirim Template" }).click();
  await fo.p.getByText("Template terkirim.").first().waitFor();
  flow.push(["an approved template goes out after the window closed", true]);
  await fo.c.close();

  // Central CS routes the brand-wide conversation to Bintaro; the Bintaro FO then sees it.
  const cs = await open("cs", "203.0.113.252", true);
  await cs.p.goto(`${BASE}/pesan/${C.brand}`);
  await cs.p.getByRole("form", { name: "Kelola percakapan" }).waitFor();
  await cs.p.getByLabel("Arahkan ke cabang").selectOption({ label: "Cabang Bintaro" });
  await cs.p.getByRole("form", { name: "Kelola percakapan" }).getByRole("button", { name: "Arahkan" }).click();
  await cs.p.getByText("Percakapan diarahkan ke cabang.").first().waitFor();
  await cs.c.close();
  const fo2 = await open("fo2", "203.0.113.253");
  await fo2.p.goto(`${BASE}/pesan`);
  await fo2.p.getByRole("list", { name: "Percakapan" }).waitFor();
  const l2 = await main(fo2.p);
  flow.push(["central CS routes the brand-wide conversation to Bintaro: the Bintaro FO sees it, not Kemang's", /Lia Sintetis/.test(l2) && /Cabang Bintaro/.test(l2) && !/Sari Sintetis/.test(l2)]);
  await fo2.c.close();

  // Owner reads without a composer.
  const own = await open("own", "203.0.113.254", true);
  await own.p.goto(`${BASE}/pesan/${C.open}`);
  await own.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the owner reads the thread without a composer (Mode baca)", /Mode baca/.test(await main(own.p)) && (await own.p.getByRole("form").count()) === 0]);
  await layouts(own.p, "/pesan/nomor", "nomor");
  const n0 = await main(own.p);
  flow.push(["Nomor: the WABA, verification, the budget and both numbers, no token or PIN",
    /Terverifikasi/.test(n0) && /Batas kirim harian klinik 800/.test(n0) && /PT Klinik Pesan Sintetis – Cabang Kemang/.test(n0) && /Nomor brand/.test(n0) && !/EAAFIXTURE|v1\.1\./.test(n0)]);
  await own.c.close();

  // Marketing: templates; no threads.
  const mk = await open("mk", "203.0.113.255");
  await mk.p.goto(`${BASE}/pesan/templat`);
  await mk.p.getByRole("form", { name: "Draf template" }).waitFor();
  await layouts(mk.p, "/pesan/templat", "templat");
  const df = mk.p.getByRole("form", { name: "Draf template" });
  await df.getByLabel("Nama").fill("hasil_klinis");
  await df.getByLabel("Isi").fill("Hasil diagnosis Anda sudah siap.");
  await df.getByRole("button", { name: "Simpan Draf" }).click();
  await mk.p.getByRole("alert").filter({ hasText: "Template tidak boleh berisi diagnosis" }).first().waitFor();
  const df2 = mk.p.getByRole("form", { name: "Draf template" });
  await df2.getByLabel("Nama").fill("salam_pagi");
  await df2.getByLabel("Isi").fill("Selamat pagi dari klinik kami.");
  await df2.getByRole("button", { name: "Simpan Draf" }).click();
  await mk.p.getByText("Draf template disimpan.").first().waitFor();
  await mk.p.reload();
  await mk.p.getByRole("list", { name: "Templat" }).waitFor();
  flow.push(["marketing: a clinical draft is refused (W-05), a neutral one saved as Draf", /salam_pagi · id[\s\S]*Draf/.test(await main(mk.p))]);
  await mk.p.goto(`${BASE}/pesan/${C.open}`);
  await mk.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["marketing has no thread access", /Anda tidak memiliki akses ke percakapan WhatsApp/.test(await main(mk.p))]);
  await mk.c.close();

  // Auditor: Templat read-only; no threads.
  const au = await open("au", "203.0.113.250", true);
  await au.p.goto(`${BASE}/pesan/templat`);
  await au.p.getByRole("list", { name: "Templat" }).waitFor();
  flow.push(["the auditor reads Templat without forms", /Mode baca/.test(await main(au.p)) && (await au.p.getByRole("form").count()) === 0]);
  await au.p.goto(`${BASE}/pesan/${C.open}`);
  await au.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the auditor has no thread access (W-10)", /Anda tidak memiliki akses ke percakapan WhatsApp/.test(await main(au.p))]);
  await au.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
