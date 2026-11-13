// T-076 browser evidence (Paket & Saldo UX-13, PR-20/21) at 390/820/1180/1440 and 200 % text: the cashier searches a
// patient (empty, filtered-empty, rows); the patient's page shows the packages (paid, Terpakai, Dipesan, expiry) and the
// balance with its entries; Pesan Sesi reserves on today's visit, then the next session is blocked with "Perlu bayar
// RpX lagi"; Batal Pesan returns it; Isi Saldo issues a KW receipt and the balance grows; Bayar Cicilan opens the
// package tagihan; the manager cancels a package (paid-unused to balance); admin pusat edits Isi Paket of an unsold
// version and reads a sold one; the auditor sees the page masked with no actions. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/paket-saldo.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branches: Record<string, string>; visit: string; dewi: string; ayu: string; draft: string; p5: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator; uncheck(): Promise<void>;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; getAttribute(n: string): Promise<string | null>; selectOption(v: string | object): Promise<unknown>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
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
  const open = async (who: string, ip: string, totpRole = false) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const ok = async (p: Page, text: string | RegExp) => p.getByRole("status").filter({ hasText: text }).first().waitFor();
  const page = `/kasir/paket-saldo/${seed.dewi}`;

  // FO: the search — empty, filtered-empty, a hit with the balance and active packages.
  const fo = await open("fo", "203.0.113.221");
  await fo.p.goto(`${BASE}/kasir/paket-saldo`);
  await fo.p.getByRole("heading", { name: "Paket & Saldo", level: 1 }).waitFor();
  flow.push(["the search asks for a name or MRN first", /Cari pasien dengan nama atau No\. RM/.test(await main(fo.p))]);
  await layouts(fo.p, "/kasir/paket-saldo", "cari");
  await fo.p.goto(`${BASE}/kasir/paket-saldo?cari=Tidak%20Ada%20Pasien`);
  await fo.p.getByText(/Tidak ada pasien yang cocok/).waitFor(); // the list streams in after the heading
  flow.push(["no match: filtered-empty with Hapus Filter", /Tidak ada pasien yang cocok/.test(await main(fo.p)) && (await fo.p.getByRole("link", { name: "Hapus Filter" }).count()) === 1]);
  await fo.p.goto(`${BASE}/kasir/paket-saldo?cari=Dewi`);
  await fo.p.getByRole("link", { name: /Dewi Lestari/ }).first().waitFor();
  const hits = await main(fo.p);
  flow.push(["Dewi is found with her balance and 2 active packages", /Dewi Lestari · RM-0000000076001/.test(hits) && /Saldo Rp250\.000 · 2 paket aktif/.test(hits)]);
  await layouts(fo.p, "/kasir/paket-saldo?cari=Dewi", "cari-hasil");

  // The patient's page: packages and balance.
  await fo.p.getByRole("link", { name: /Dewi Lestari/ }).first().click();
  await fo.p.getByRole("heading", { name: /Dewi Lestari/, level: 1 }).waitFor();
  const d0 = await main(fo.p);
  flow.push(["the 5x package: Dibayar Rp1.200.000 / Rp3.000.000, Terpakai 0, Dipesan 0; the balance Rp250.000 with its top-up entry",
    /Paket 5x Facial Brightening[\s\S]*Rp1\.200\.000 \/ Rp3\.000\.000/.test(d0) && /Rp250\.000/.test(d0) && /Isi saldo/.test(d0)]);
  await layouts(fo.p, page, "pasien");
  // Pesan Sesi twice on today's visit (Rp1.200.000 unlocks two sessions of Rp600.000), then the third is blocked.
  const card5 = fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" });
  await card5.getByRole("button", { name: "Pesan Sesi" }).click();
  await ok(fo.p, "Sesi dipesan untuk kunjungan ini.");
  await fo.p.goto(`${BASE}${page}`);
  // The second reservation uses the last unlocked value: the form is replaced by the blocked copy on revalidation.
  await fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" }).getByRole("button", { name: "Pesan Sesi" }).click();
  await fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" }).getByText(/Perlu bayar Rp600\.000 lagi/).waitFor();
  await fo.p.goto(`${BASE}${page}`);
  const c2 = await fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" }).innerText();
  flow.push(["after two reservations the next session says Perlu bayar Rp600.000 lagi and offers no Pesan Sesi",
    /Perlu bayar Rp600\.000 lagi/.test(c2) && (await fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" }).getByRole("button", { name: "Pesan Sesi" }).count()) === 0
    && (c2.match(/Dipesan/g) ?? []).length >= 2]);
  await layouts(fo.p, page, "pasien-dipesan");
  // Batal Pesan returns a session.
  // The released row's form unmounts on revalidation (the session is Tersedia again): wait for the Pesan Sesi it brings back.
  await fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" }).getByRole("button", { name: "Batal Pesan" }).first().click();
  await fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" }).getByRole("button", { name: "Pesan Sesi" }).waitFor();
  await fo.p.goto(`${BASE}${page}`);
  await fo.p.getByRole("heading", { name: /Dewi Lestari/, level: 1 }).waitFor(); // count() does not wait for the page
  flow.push(["Batal Pesan returns a session (Pesan Sesi offered again)",
    (await fo.p.locator("article").filter({ hasText: "Paket 5x Facial Brightening" }).getByRole("button", { name: "Pesan Sesi" }).count()) === 1]);
  // Isi Saldo in cash: a KW receipt; the balance grows.
  const tf = fo.p.getByRole("form", { name: "Isi saldo" });
  await tf.getByLabel("Jumlah").fill("100000");
  await tf.getByLabel("Uang diterima").fill("150000");
  await tf.getByRole("button", { name: "Isi Saldo" }).click();
  await ok(fo.p, /Saldo diisi\. Struk KW-KMG-.*Kembalian Rp50\.000/);
  // The Isi Saldo receipt opens (no tagihan link: a top-up has none).
  await fo.p.getByRole("link", { name: "Lihat Struk" }).click();
  await fo.p.getByRole("heading", { name: /^Struk KW-KMG-/, level: 1 }).waitFor();
  flow.push(["the Isi Saldo struk names the top-up and has no Ke tagihan link", /Isi Saldo pasien RM-0000000076001/.test(await main(fo.p))
    && (await fo.p.getByRole("link", { name: "Ke tagihan" }).count()) === 0]);
  await fo.p.goto(`${BASE}${page}`);
  await fo.p.getByText("Rp350.000", { exact: true }).first().waitFor();
  flow.push(["Isi Saldo: the balance is Rp350.000", /Rp350\.000/.test(await main(fo.p))]);
  // Bayar Cicilan opens the package tagihan with its outstanding.
  await fo.p.getByRole("link", { name: /Bayar Cicilan · sisa Rp1\.800\.000/ }).click();
  await fo.p.getByRole("heading", { name: /^INV-KMG-/, level: 1 }).waitFor();
  flow.push(["Bayar Cicilan opens the package tagihan (Sisa Rp1.800.000; Saldo pasien shown)", /Sisa Rp1\.800\.000/.test(await main(fo.p)) && /Saldo pasien Rp350\.000/.test(await main(fo.p))]);
  await fo.c.close();

  // Manager: Batalkan Paket on the mixed package (paid in full, nothing used): Rp2.400.000 to the balance.
  const mgr = await open("mgr", "203.0.113.222", true);
  await mgr.p.goto(`${BASE}${page}`);
  await mgr.p.getByRole("heading", { name: /Dewi Lestari/, level: 1 }).waitFor();
  const mix = mgr.p.locator("article").filter({ hasText: "Paket Glow Campuran" });
  await mix.getByRole("button", { name: "Batalkan Paket" }).click();
  await mix.getByLabel("Alasan").fill("Pasien pindah kota");
  // The cancelled package leaves the active list on revalidation (its form unmounts): wait for Paket selesai.
  await mix.getByRole("form", { name: "Batalkan paket" }).getByRole("button", { name: "Batalkan Paket" }).click();
  await mgr.p.getByRole("region", { name: "Paket selesai" }).waitFor();
  await mgr.p.goto(`${BASE}${page}`);
  await mgr.p.getByRole("region", { name: "Paket selesai" }).waitFor();
  const m1 = await main(mgr.p);
  flow.push(["the cancelled package moves to Paket selesai; the balance is Rp2.750.000", /Paket selesai[\s\S]*Paket Glow Campuran[\s\S]*Dibatalkan/.test(m1) && /Rp2\.750\.000/.test(m1)]);
  await layouts(mgr.p, page, "pasien-manajer");
  await mgr.c.close();

  // Admin pusat: Paket & Saldo offers only Isi Paket; edits the unsold version; a sold one is read only.
  const ap = await open("ap", "203.0.113.223", true);
  await ap.p.goto(`${BASE}/kasir/paket-saldo/isi-paket?versi=${seed.draft}`);
  await ap.p.getByRole("heading", { name: "Isi Paket", level: 1 }).waitFor();
  const cf = ap.p.getByRole("form", { name: "Isi paket" });
  await cf.getByLabel("Sesi").first().fill("4");
  await cf.getByRole("button", { name: "Simpan Isi Paket" }).click();
  await ok(ap.p, "Isi paket disimpan.");
  await layouts(ap.p, `/kasir/paket-saldo/isi-paket?versi=${seed.draft}`, "isi-paket");
  await ap.p.goto(`${BASE}/kasir/paket-saldo/isi-paket?versi=${seed.p5}`);
  await ap.p.getByText(/sudah terjual/).waitFor();
  flow.push(["a sold package's contents are read only", /sudah terjual/.test(await main(ap.p)) && (await ap.p.getByRole("form", { name: "Isi paket" }).count()) === 0]);
  await ap.p.goto(`${BASE}/kasir/paket-saldo/${seed.dewi}`);
  await ap.p.getByText("Anda tidak memiliki akses ke kasir.").waitFor(); // the permission state has no title (NAV-1)
  flow.push(["admin pusat cannot open a patient's packages", !/Dewi Lestari/.test(await main(ap.p))]);
  await ap.c.close();

  // Auditor: masked, no actions.
  const au = await open("au", "203.0.113.224", true);
  await au.p.goto(`${BASE}${page}`);
  await au.p.getByRole("heading", { level: 1 }).waitFor();
  await au.p.getByText("Rp2.750.000", { exact: true }).first().waitFor();
  const a1 = await main(au.p);
  flow.push(["the auditor reads amounts with the patient masked and no action", !/Dewi Lestari/.test(a1) && /\*\*\*001/.test(a1) && /Rp2\.750\.000/.test(a1)
    && (await au.p.getByRole("button", { name: /Pesan Sesi|Isi Saldo|Batalkan Paket/ }).count()) === 0]);
  await layouts(au.p, page, "pasien-auditor");
  await au.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
