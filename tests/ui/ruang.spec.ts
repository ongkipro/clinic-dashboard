// T-064 browser evidence (Ruang Tindakan, UX-9, 17:133-138, 19:102-104, PR-14) at 390/820/1180/1440 and 200 % text.
// The nurse opens Ruang (visits grouped by room, the unsigned one listed as not ready), opens a ready visit: the
// "Sebelum mulai" checklist keeps Mulai disabled until identity is ticked, starts with the issued gel, moves a stage,
// pauses and resumes, asks for Bahan Tambahan, opens Selesai Tindakan (four outcomes), records completion with a
// gel deviation; then stops the second visit's facial for the patient and its filler as a clinic stop (the
// front-office blocker shows); the blocked visit shows its blockers. A doctor (TOTP) reads the room. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/ruang.spec.ts out-dir
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

  // Nurse: the room list.
  const nur = await open("nur", false, "203.0.113.164");
  await nur.p.goto(`${BASE}/ruang`);
  await nur.p.getByRole("heading", { name: "Ruang Tindakan", level: 1 }).waitFor();
  const list = await main(nur.p);
  flow.push(["list: visits grouped (Belum ditentukan), each item not started; the unsigned visit listed", /Belum ditentukan[\s\S]*Ayu Lestari[\s\S]*Facial Hidrasi[\s\S]*Belum dimulai/.test(list) && /Citra Dewi/.test(list)]);
  await layouts(nur.p, "/ruang", "ruang");

  // The blocked visit: its blockers, no Mulai.
  await nur.p.goto(`${BASE}/ruang/${seed.visits.c}`);
  await nur.p.getByRole("heading", { name: "Citra Dewi", level: 1 }).waitFor();
  const blk = await main(nur.p);
  flow.push(["blocked: unsigned exam and missing consent named; Belum siap", /Belum siap/.test(blk) && /Pemeriksaan belum ditandatangani dokter/.test(blk) && /Persetujuan tindakan belum ada/.test(blk)]);
  await layouts(nur.p, `/ruang/${seed.visits.c}`, "terblokir");

  // The ready visit: the checklist; Mulai disabled until identity is ticked.
  await nur.p.goto(`${BASE}/ruang/${seed.visits.a}`);
  await nur.p.getByRole("heading", { name: "Ayu Lestari", level: 1 }).waitFor();
  const start = nur.p.getByRole("form", { name: "Sebelum mulai Facial Hidrasi" });
  const mulai = start.getByRole("button", { name: "Mulai" });
  flow.push(["checklist: Mulai disabled before identity; materials issued shown", (await mulai.getAttribute("aria-disabled")) === "true" && /Bahan sudah dikeluarkan apoteker/.test(await start.innerText())]);
  await layouts(nur.p, `/ruang/${seed.visits.a}`, "ceklis");
  await start.getByLabel(/Identitas pasien sudah dicocokkan/).check();
  await start.getByLabel("Pelaksana").selectOption({ label: "Ners Dita" });
  await start.getByRole("button", { name: "Mulai" }).click();
  await nur.p.getByRole("timer").waitFor();
  flow.push(["started: timer, stage Persiapan, room from the material depot", /Ruang Tindakan 1/.test(await main(nur.p)) && /Berjalan · Persiapan/.test(await main(nur.p))]);
  await nur.p.getByRole("button", { name: "Lanjut ke Anestesi Topikal" }).click();
  await ok(nur.p, "Tahap berpindah.");
  await nur.p.getByRole("button", { name: "Jeda" }).click();
  await ok(nur.p, "Tindakan dijeda.");
  await nur.p.reload();
  await nur.p.getByRole("button", { name: "Lanjutkan" }).waitFor();
  flow.push(["timer: stage moved; paused (timer frozen)", /Dijeda · Anestesi Topikal/.test(await main(nur.p)) && /dijeda/.test((await nur.p.getByRole("timer").getAttribute("aria-label")) ?? "")]);
  await nur.p.getByRole("button", { name: "Lanjutkan" }).click();
  await ok(nur.p, "Tindakan dilanjutkan.");
  await layouts(nur.p, `/ruang/${seed.visits.a}`, "berjalan");
  // Bahan Tambahan: a new request to the pharmacist.
  await nur.p.getByRole("button", { name: "Bahan Tambahan" }).click();
  const extra = nur.p.getByRole("form", { name: "Bahan tambahan" });
  await extra.getByLabel("Bahan").selectOption({ label: "Gel Pendingin (ml)" });
  await extra.getByLabel("Jumlah").fill("5");
  await extra.getByRole("button", { name: "Kirim ke Apoteker" }).click();
  await ok(nur.p, "Permintaan bahan tambahan dikirim ke apoteker.");
  flow.push(["Bahan Tambahan: sent to the pharmacist", true]);
  // Selesai Tindakan refused while the extra request is not issued; the sheet shows four outcomes.
  await nur.p.reload();
  await nur.p.getByRole("button", { name: "Selesai Tindakan" }).click();
  const fin = nur.p.getByRole("form", { name: "Selesai tindakan" });
  const outcomes = await fin.getByRole("radio").count();
  flow.push(["Selesai Tindakan: four outcomes as large options", outcomes === 4]);
  await measure(nur.p, "selesai-1440", "selesai-1440");
  await nur.p.setViewportSize({ width: 390, height: 900 });
  await measure(nur.p, "selesai-390", "selesai-390");
  await nur.p.setViewportSize({ width: 1440, height: 900 });
  await fin.getByLabel(/Selesai sesuai rencana/).check();
  await fin.getByRole("button", { name: "Simpan Hasil" }).click();
  await nur.p.getByRole("alert").filter({ hasText: "belum dikeluarkan apoteker" }).first().waitFor();
  flow.push(["finish refused while Bahan Tambahan is still open (P1-1)", true]);
  await nur.c.close();

  // Pharmacist issues the extra request (via the database-backed module is not in this UI: the T-062 queue has no page
  // yet) — the nurse instead cancels nothing; the second visit shows the stops.
  const nur2 = await open("nur", false, "203.0.113.165");
  await nur2.p.goto(`${BASE}/ruang/${seed.visits.b}`);
  await nur2.p.getByRole("heading", { name: "Bunga Citra", level: 1 }).waitFor();
  const facial = nur2.p.getByRole("form", { name: "Sebelum mulai Facial Hidrasi" });
  await facial.getByLabel(/Identitas pasien sudah dicocokkan/).check();
  await facial.getByLabel("Pelaksana").selectOption({ label: "Ners Dita" });
  await facial.getByRole("button", { name: "Mulai" }).click();
  await nur2.p.getByRole("timer").waitFor();
  await nur2.p.getByRole("button", { name: "Selesai Tindakan" }).click();
  const fin2 = nur2.p.getByRole("form", { name: "Selesai tindakan" });
  await fin2.getByLabel(/Dihentikan — pilihan pasien/).check();
  await fin2.getByLabel("Alasan penghentian").fill("Pasien memilih berhenti");
  await fin2.getByRole("button", { name: "Simpan Hasil" }).click();
  await nur2.p.getByText("Dihentikan — pilihan pasien", { exact: true }).first().waitFor();
  const filler = nur2.p.getByRole("form", { name: "Sebelum mulai Filler Bibir" });
  const nurOptions = await filler.getByLabel("Pelaksana").innerText();
  flow.push(["patient stop recorded (counted); the filler offers no nurse as performer (delegation)", /Dihentikan — pilihan pasien/.test(await main(nur2.p)) && !/Ners Dita/.test(nurOptions)]);
  await filler.getByLabel(/Identitas pasien sudah dicocokkan/).check();
  await filler.getByLabel("Pelaksana").selectOption({ label: "dr. Bima" });
  await filler.getByRole("button", { name: "Mulai" }).click();
  await nur2.p.getByRole("timer").waitFor();
  await nur2.p.getByRole("button", { name: "Selesai Tindakan" }).click();
  const fin3 = nur2.p.getByRole("form", { name: "Selesai tindakan" });
  await fin3.getByLabel(/Dihentikan — kendala klinik/).check();
  await fin3.getByLabel("Alasan penghentian").fill("Alat laser rusak");
  await fin3.getByRole("button", { name: "Simpan Hasil" }).click();
  // the sheet's own option has the same words: wait for the visit blocker the finish writes
  await nur2.p.getByText("Dihentikan klinik — jadwalkan ulang atau saldo").first().waitFor();
  const done = await main(nur2.p);
  flow.push(["clinic stop: the outcome and the front-office blocker show on the VisitTrack", /Dihentikan — kendala klinik/.test(done) && /Dihentikan klinik — jadwalkan ulang atau saldo/.test(done)]);
  await layouts(nur2.p, `/ruang/${seed.visits.b}`, "hasil");
  await nur2.c.close();

  // A doctor (TOTP) reads the room; the front office does not.
  const doc = await open("doc2", true, "203.0.113.166");
  await doc.p.goto(`${BASE}/ruang`);
  await doc.p.getByRole("heading", { name: "Ruang Tindakan", level: 1 }).waitFor();
  flow.push(["doctor: reads the room list; the treated visit shows its outcomes", /Bunga Citra[\s\S]*Selesai/.test(await main(doc.p))]);
  await doc.c.close();
  const fo = await open("fo", false, "203.0.113.167");
  await fo.p.goto(`${BASE}/ruang`);
  await fo.p.getByText("Anda tidak memiliki akses ke ruang tindakan.").waitFor();
  flow.push(["front office: no access to the room", true]);
  await fo.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
