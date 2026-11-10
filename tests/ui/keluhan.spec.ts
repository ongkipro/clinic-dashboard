// T-057 browser evidence (Keluhan, UX-28, 19:93, PR-43, CLIN-016) at 390/820/1180/1440 and 200 % text. The FO
// flags a klinis complaint from today's visit and sees its status only ("Laporan Saya"); the doctor's Klinis
// list (urgent first, an overdue task escalated on read), the detail with Tangani, Ubah Triase, a note, Selesaikan
// with a free control, and Buka Kembali; the manager's Layanan segment and resolution; the facility head's
// segments with Insiden blocked; the therapist gets the permission state. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/keluhan.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branch: string; visits: Record<string, string>; tasks: Record<string, string> };
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

  // FO: flags a klinis complaint for Sari from today's visits; sees "Laporan Saya" with status only.
  const fo = await open("fo", false, "203.0.113.211");
  await fo.p.goto(`${BASE}/keluhan/baru?visit=${seed.visits.sari}`);
  await fo.p.getByRole("heading", { name: "Laporkan Keluhan", level: 1 }).waitFor();
  flow.push(["flag: the visit preselects the patient", (await fo.p.getByLabel("Pasien", { exact: true }).inputValue()).endsWith(seed.visits.sari)]);
  await layouts(fo.p, `/keluhan/baru?visit=${seed.visits.sari}`, "lapor");
  await fo.p.getByRole("radio", { name: /Merah/ }).check();
  await fo.p.getByLabel("Ringkasan keluhan").fill("Bengkak rahasia di bibir setelah filler");
  await fo.p.getByRole("button", { name: "Laporkan Keluhan" }).click();
  await fo.p.getByText("Keluhan dilaporkan.").waitFor();
  flow.push(["flag: the form stays with the result and a link to the status", (await fo.p.getByRole("link", { name: "Lihat status keluhan" }).count()) === 1]);
  await fo.p.goto(`${BASE}/keluhan`);
  await fo.p.getByRole("heading", { name: "Keluhan", level: 1 }).waitFor();
  const foList = await main(fo.p);
  flow.push(["FO: Laporan Saya lists its reports by status, no clinical content", /Sari Bengkak[\s\S]*Baru/.test(foList) && foList.includes("Rina Gatal") && !/rahasia|Gatal dan kemerahan/i.test(foList)]);
  await layouts(fo.p, "/keluhan", "saya");
  await fo.c.close();

  // Doctor: the Klinis list, urgent first; Tari escalated on read; take, triage, note, resolve, reopen.
  const doc = await open("doc", true, "203.0.113.212");
  await doc.p.goto(`${BASE}/keluhan`);
  await doc.p.getByRole("heading", { name: "Keluhan", level: 1 }).waitFor();
  const dl = await main(doc.p);
  flow.push(["doctor: Klinis list with summaries, the overdue task flagged, no layanan", dl.includes("Bengkak rahasia di bibir") && /Tari Lama[\s\S]*Lewat target/.test(dl) && !dl.includes("Dewi Tunggu")]);
  flow.push(["doctor: segments Klinis and Insiden only", (await doc.p.getByRole("link", { name: "Insiden" }).count()) === 1 && (await doc.p.getByRole("link", { name: "Layanan", exact: true }).count()) === 0]);
  await layouts(doc.p, "/keluhan", "klinis");
  await doc.p.goto(`${BASE}/keluhan/${seed.tasks.rina}`);
  await doc.p.getByRole("heading", { name: "Rina Gatal", level: 1 }).waitFor();
  await layouts(doc.p, `/keluhan/${seed.tasks.rina}`, "detail");
  await doc.p.getByRole("button", { name: "Tangani" }).click();
  await doc.p.getByText("Keluhan Anda tangani.").waitFor();
  flow.push(["take: Tangani assigns the doctor and shows the result", true]);
  await doc.p.goto(`${BASE}/keluhan/${seed.tasks.rina}`);
  await doc.p.getByRole("heading", { name: "Rina Gatal", level: 1 }).waitFor();
  await doc.p.getByLabel("Triase", { exact: true }).selectOption("kuning");
  await doc.p.getByRole("button", { name: "Ubah Triase" }).click();
  await doc.p.getByText(/^Triase diperbarui/).waitFor();
  await doc.p.getByLabel("Catatan penanganan").fill("Kompres dingin dan antihistamin");
  await doc.p.getByRole("button", { name: "Simpan Catatan" }).click();
  await doc.p.getByText("Catatan tersimpan.").waitFor();
  await doc.p.getByLabel("Hasil penanganan").selectOption("kontrol_gratis");
  await doc.p.getByLabel("Catatan penyelesaian").fill("Kontrol gratis besok pagi");
  await doc.p.getByRole("button", { name: "Selesaikan" }).click();
  await doc.p.getByText("Keluhan diselesaikan.").waitFor();
  flow.push(["resolve: the result shows on the same page", true]);
  await doc.p.goto(`${BASE}/keluhan/${seed.tasks.rina}`);
  await doc.p.getByRole("heading", { name: "Rina Gatal", level: 1 }).waitFor();
  const done = await main(doc.p);
  flow.push(["detail: resolved with the free control, history in order", done.includes("Kontrol gratis: Kontrol gratis besok pagi")
    && /Dilaporkan[\s\S]*Mulai ditangani[\s\S]*Triase diubah[\s\S]*Catatan[\s\S]*Diselesaikan/.test(done)]);
  await doc.p.screenshot({ path: `${OUT}/selesai-1440.png`, fullPage: true });
  await doc.p.getByText("Buka Kembali", { exact: true }).first().click();
  await doc.p.getByLabel("Alasan membuka kembali").fill("Gatal kembali muncul");
  await doc.p.getByRole("form", { name: "Buka kembali keluhan" }).getByRole("button", { name: "Buka Kembali" }).click();
  await doc.p.getByText("Keluhan dibuka kembali.").waitFor();
  flow.push(["reopen: with a reason; the form keeps the result", true]);
  await doc.p.goto(`${BASE}/keluhan/${seed.tasks.tari}`);
  await doc.p.getByRole("heading", { name: "Tari Lama", level: 1 }).waitFor();
  flow.push(["escalation: the overdue task shows the system escalation", /Melewati target, diteruskan[\s\S]*sistem/.test(await main(doc.p))]);
  await doc.c.close();

  // Manager: Layanan only; resolves Dewi's waiting-time complaint at 390.
  const mgr = await open("mgr", true, "203.0.113.213");
  await mgr.p.goto(`${BASE}/keluhan`);
  await mgr.p.getByRole("heading", { name: "Keluhan", level: 1 }).waitFor();
  const ml = await main(mgr.p);
  flow.push(["manager: layanan with content, no klinis", ml.includes("Menunggu 90 menit") && !ml.includes("Rina Gatal") && !ml.includes("Sari Bengkak")]);
  await mgr.p.setViewportSize({ width: 390, height: 900 });
  await mgr.p.goto(`${BASE}/keluhan/${seed.tasks.dewi}`);
  await mgr.p.getByRole("heading", { name: "Dewi Tunggu", level: 1 }).waitFor();
  await mgr.p.getByLabel("Hasil penanganan").selectOption("penjelasan");
  await mgr.p.getByLabel("Catatan penyelesaian").fill("Penjelasan antrean dan permintaan maaf");
  await mgr.p.getByRole("button", { name: "Selesaikan" }).click();
  await mgr.p.getByText("Keluhan diselesaikan.").waitFor();
  flow.push(["manager at 390: resolves a layanan complaint", true]);
  await mgr.p.screenshot({ path: `${OUT}/layanan-390.png`, fullPage: true });
  await mgr.c.close();

  // Facility head: Klinis · Layanan · Insiden; Insiden is blocked until its module.
  const fh = await open("fh", true, "203.0.113.214");
  await fh.p.goto(`${BASE}/keluhan?tab=insiden`);
  await fh.p.getByRole("heading", { name: "Keluhan", level: 1 }).waitFor();
  const fi = await main(fh.p);
  flow.push(["facility head: three segments; Insiden blocked", fi.includes("Register insiden keselamatan pasien belum tersedia") && (await fh.p.getByRole("link", { name: "Layanan", exact: true }).count()) === 1]);
  await fh.p.screenshot({ path: `${OUT}/insiden-1440.png`, fullPage: true });
  await fh.c.close();

  // Therapist: the permission state; no content.
  const th = await open("th", false, "203.0.113.215");
  await th.p.goto(`${BASE}/keluhan/${seed.tasks.rina}`);
  await th.p.locator("main").first().waitFor();
  const tt = await main(th.p);
  flow.push(["therapist: permission state, no content", !tt.includes("Rina Gatal") && !tt.includes("Gatal dan kemerahan")]);
  await th.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
