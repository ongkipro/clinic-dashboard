// T-092 browser evidence (Lead & Pipeline, UX-18, PR-29) at 390/820/1180/1440 and 200 % text: the Kemang BC sees Kemang's open leads,
// takes Rina (Ambil), marks her contacted, then cannot mark her booked without an appointment ("Belum ada janji temu"); Citra arrived with an
// unpaid invoice: "Belum ada pembayaran untuk konversi" and Tandai Bayar refused (Scenario PR-29); Dewi paid: converts (Bayar); Eka lost with
// a reason, then reopened; Tambah Lead; the Hilang filter empty (filtered-empty, the segment bar stays); Tindak Lanjut is an honest blocked
// state (T-093); the Bintaro manager does not see Kemang's leads; marketing reads masked and adds a campaign (Kampanye); the auditor reads
// masked without forms; the owner reads names without forms.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/lead.spec.ts out-dir
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
  leads: { rina: string; budi: string; citra: string; dewi: string; eka: string };
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
  const L = seed.leads;
  const stageForm = (p: Page) => p.getByRole("form", { name: "Tahap berikutnya" });

  // Kemang BC: the list, Ambil, the next steps and their facts (Scenario PR-29), lost and reopen, Tambah Lead, filters.
  const bc = await open("bc", "203.0.113.241");
  await bc.p.goto(`${BASE}/lead`);
  await bc.p.getByRole("list", { name: "Lead" }).waitFor();
  const l0 = await main(bc.p);
  flow.push(["the Kemang BC sees Kemang's open leads with stage, source, campaign and the response SLA",
    /Rina Sintetis/.test(l0) && /Budi Sintetis/.test(l0) && /Citra Pasien Sintetis/.test(l0) && /Dewi Pasien Sintetis/.test(l0) && /Eka Sintetis/.test(l0)
      && /Promo Glow November/.test(l0) && /Instagram/.test(l0) && /Belum ditugaskan/.test(l0) && /Baru/.test(l0) && /Datang/.test(l0)]);
  await layouts(bc.p, "/lead", "list");
  await bc.p.goto(`${BASE}/lead/${L.rina}`);
  await bc.p.getByRole("form", { name: "Penanganan lead" }).getByRole("button", { name: "Ambil" }).click();
  await bc.p.getByText("Lead diambil.").first().waitFor();
  flow.push(["Ambil assigns the lead to the BC", /Ditangani Anda/.test(await main(bc.p))]);
  await stageForm(bc.p).getByRole("button", { name: "Tandai Dihubungi" }).click();
  await bc.p.getByText("Lead ditandai dihubungi.").first().waitFor();
  const r1 = await main(bc.p);
  flow.push(["contacted without a patient: the banner asks to match one first", /Dihubungi/.test(r1) && /Cocokkan lead dengan pasien lebih dulu/.test(r1)]);
  await bc.p.getByLabel("Cari nama, No. RM atau telepon").fill("Rina Pasien");
  await bc.p.getByRole("button", { name: "Cari", exact: true }).click();
  await bc.p.getByRole("list", { name: "Hasil pencarian pasien" }).waitFor();
  await layouts(bc.p, bc.p.url().slice(BASE.length), "detail-match");
  await bc.p.getByRole("form", { name: "Cocokkan dengan Rina Pasien Sintetis" }).getByRole("button", { name: "Pilih" }).click();
  await bc.p.getByText("Lead dicocokkan dengan pasien.").first().waitFor();
  const r2 = await main(bc.p);
  flow.push(["Cocokkan Pasien matches the lead; booking now waits for an appointment", /Rina Pasien Sintetis/.test(r2) && /Belum ada janji temu untuk pasien ini/.test(r2)
    && (await bc.p.getByRole("region", { name: "Cocokkan Pasien" }).count()) === 0]);
  await stageForm(bc.p).getByRole("button", { name: "Tandai Booking" }).click();
  await bc.p.getByRole("alert").filter({ hasText: "Belum ada janji temu" }).first().waitFor();
  flow.push(["Tandai Booking without an appointment is refused", (await bc.p.getByRole("alert").filter({ hasText: "Belum ada janji temu" }).count()) >= 1]);
  await bc.p.goto(`${BASE}/lead/${L.citra}`);
  await stageForm(bc.p).waitFor();
  const c0 = await main(bc.p);
  flow.push(["Scenario PR-29: arrived with an unpaid invoice shows Belum ada pembayaran untuk konversi", /Datang/.test(c0) && /Belum ada pembayaran untuk konversi/.test(c0)
    && /Citra Pasien Sintetis/.test(c0) && /No\. RM RM-/.test(c0)]);
  await layouts(bc.p, `/lead/${L.citra}`, "detail-unpaid");
  await stageForm(bc.p).getByRole("button", { name: "Tandai Bayar" }).click();
  await bc.p.getByRole("alert").filter({ hasText: "Belum ada pembayaran untuk konversi" }).first().waitFor();
  await bc.p.reload();
  await stageForm(bc.p).waitFor();
  flow.push(["Scenario PR-29: Tandai Bayar refused; the lead stays Datang", /Datang/.test(await main(bc.p)) && (await stageForm(bc.p).count()) === 1]);
  await bc.p.goto(`${BASE}/lead/${L.dewi}`);
  await stageForm(bc.p).getByRole("button", { name: "Tandai Bayar" }).click();
  await bc.p.getByText("Lead ditandai bayar.").first().waitFor();
  const d1 = await main(bc.p);
  flow.push(["a paid invoice converts the lead (Bayar, final: no stage forms)", /Bayar/.test(d1) && (await stageForm(bc.p).count()) === 0 && (await bc.p.getByRole("form", { name: "Tandai hilang" }).count()) === 0]);
  await layouts(bc.p, `/lead/${L.dewi}`, "detail-converted");
  await bc.p.goto(`${BASE}/lead/${L.eka}`);
  const lf = bc.p.getByRole("form", { name: "Tandai hilang" });
  await lf.getByLabel("Alasan hilang").selectOption("lainnya");
  flow.push(["Lainnya asks for a note", (await lf.getByLabel("Catatan").count()) === 1]);
  await lf.getByLabel("Alasan hilang").selectOption("harga");
  await lf.getByRole("button", { name: "Tandai Hilang" }).click();
  await bc.p.getByText("Lead ditandai hilang.").first().waitFor();
  flow.push(["lost with a reason (Hilang: Harga)", /Hilang: Harga/.test(await main(bc.p))]);
  await layouts(bc.p, `/lead/${L.eka}`, "detail-lost");
  await bc.p.getByRole("form", { name: "Buka kembali lead" }).getByRole("button", { name: "Buka Kembali" }).click();
  await bc.p.getByText("Lead dibuka kembali.").first().waitFor();
  flow.push(["Buka Kembali returns the lead to Baru", /Baru/.test(await main(bc.p)) && (await stageForm(bc.p).count()) === 1]);
  await bc.p.goto(`${BASE}/lead?tahap=lost`);
  await bc.p.getByText("Tidak ada lead untuk filter ini.").first().waitFor();
  flow.push(["Hilang with none: filtered-empty with a clear link; the segment bar stays", (await bc.p.getByRole("link", { name: "Hapus Filter" }).count()) >= 1
    && (await bc.p.getByRole("navigation", { name: "Bagian Lead" }).count()) === 1]);
  await bc.p.goto(`${BASE}/lead`);
  await bc.p.getByRole("button", { name: "Tambah Lead" }).click();
  const nf = bc.p.getByRole("form", { name: "Tambah lead" });
  await nf.getByLabel("Nama kontak").fill("Fajar Sintetis");
  await nf.getByLabel("Telepon (opsional)").fill("+6281300000199");
  await nf.getByLabel("Sumber").selectOption("tiktok");
  await nf.getByRole("button", { name: "Simpan Lead" }).click();
  await bc.p.getByText("Lead disimpan.").first().waitFor();
  const f1 = await main(bc.p);
  flow.push(["Tambah Lead: the new lead opens, assigned to the BC who added it", /Fajar Sintetis/.test(f1) && /TikTok/.test(f1) && /Ditangani Anda/.test(f1) && /\+6281300000199/.test(f1)]);
  await layouts(bc.p, "/lead?segmen=tindak-lanjut", "tindak-lanjut");
  flow.push(["Tindak Lanjut: an honest blocked state until T-093", /Tugas tindak lanjut otomatis belum tersedia/.test(await main(bc.p))]);
  await bc.c.close();

  // Bintaro manager: none of Kemang's leads.
  const mg = await open("mgr2", "203.0.113.242", true);
  await mg.p.goto(`${BASE}/lead?tahap=all`);
  await mg.p.getByRole("heading", { level: 1 }).waitFor();
  const m0 = await main(mg.p);
  flow.push(["the Bintaro manager sees none of Kemang's leads", !/Rina Sintetis|Citra|Dewi|Fajar/.test(m0) && /Tidak ada lead untuk filter ini/.test(m0)]);
  await mg.c.close();

  // Marketing: masked leads; Kampanye.
  const mk = await open("mk", "203.0.113.243");
  await mk.p.goto(`${BASE}/lead`);
  await mk.p.getByRole("list", { name: "Lead" }).waitFor();
  const k0 = await main(mk.p);
  flow.push(["marketing reads masked (no names without marketing consent), no forms", /Kontak tersembunyi/.test(k0) && !/Rina Sintetis|Citra Pasien|Fajar/.test(k0)
    && /Mode baca/.test(k0) && (await mk.p.getByRole("form").count()) === 0]);
  await mk.p.goto(`${BASE}/lead?segmen=kampanye`);
  await mk.p.getByRole("list", { name: "Kampanye" }).waitFor();
  await mk.p.getByRole("button", { name: "Tambah Kampanye" }).click();
  const cf = mk.p.getByRole("form", { name: "Tambah kampanye" });
  await cf.getByLabel("Nama").fill("Promo Desember");
  await cf.getByLabel("Kode").fill("promo-des");
  await cf.getByLabel("Kanal").selectOption("tiktok");
  await cf.getByRole("button", { name: "Simpan" }).click();
  await mk.p.getByText("Kampanye disimpan.").first().waitFor();
  await mk.p.reload();
  await mk.p.getByRole("list", { name: "Kampanye" }).waitFor();
  const k1 = await main(mk.p);
  flow.push(["marketing adds a campaign; Kampanye lists both with their lead counts", /Promo Desember/.test(k1) && /promo-des · TikTok · 0 lead/.test(k1) && /glow-nov · Instagram · 2 lead/.test(k1)]);
  await layouts(mk.p, "/lead?segmen=kampanye", "kampanye");
  await mk.c.close();

  // Auditor: masked, no forms; owner: names, no forms.
  const au = await open("au", "203.0.113.244", true);
  await au.p.goto(`${BASE}/lead/${L.citra}`);
  await au.p.getByRole("heading", { level: 1 }).waitFor();
  const a0 = await main(au.p);
  flow.push(["the auditor reads masked: no name, the MRN tail only, no forms", /Kontak tersembunyi/.test(a0) && !/Citra/.test(a0) && /No\. RM \*\*\*/.test(a0) && (await au.p.getByRole("form").count()) === 0]);
  await au.c.close();
  const own = await open("own", "203.0.113.245", true);
  await own.p.goto(`${BASE}/lead`);
  await own.p.getByRole("list", { name: "Lead" }).waitFor();
  const o0 = await main(own.p);
  // the observed page text and screen are kept as evidence (run 2's cause was inferred only)
  writeFileSync(`${OUT}/owner-list.txt`, o0);
  await own.p.screenshot({ path: `${OUT}/owner-list-1440.png`, fullPage: true });
  // Rina's lead was matched in flow 4: her row now carries the patient's name; Budi's manual lead keeps its sealed contact name
  flow.push(["the owner reads the pipeline with names and no forms", /Rina Pasien Sintetis/.test(o0) && /Budi Sintetis/.test(o0) && /Mode baca/.test(o0)
    && (await own.p.getByRole("form").count()) === 0]);
  await own.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
