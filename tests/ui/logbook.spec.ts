// T-068 browser evidence (Logbook UX-9 ▸ Logbook 17:189, Insiden UX-28 ▸ Insiden 17:188, PR-82) at 390/820/1180/1440 and
// 200 % text. The manager sees the laser past its calibration due date (scenario PR-82), records the calibration and
// the device is no longer overdue; the nurse records sterilization and a B3 waste handover and reports an incident with
// a patient, then sees her own reports only; the facility head opens the register from Keluhan › Insiden, takes the
// KNC, is shown "Investigasi belum selesai", investigates, decides no external report and closes it; the owner reads
// the logbook only. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/logbook.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branches: Record<string, string>; laser: string; scheduleId: string; incidentId: string };
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
  const open = async (who: string, ip: string, totpRole = false) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const ok = async (p: Page, text: string | RegExp) => p.getByRole("status").filter({ hasText: text }).first().waitFor();

  // Manager (scenario PR-82): the laser is past its calibration due date — the alert in Notifikasi data and the
  // overdue block on the Kalibrasi tab; Jadwal for each device; a calibration entry clears it.
  const mgr = await open("mgr", "203.0.113.191", true);
  await mgr.p.goto(`${BASE}/logbook?tab=calibration`);
  await mgr.p.getByRole("heading", { name: /^Logbook Alat, Sterilisasi & Limbah/, level: 1 }).waitFor();
  const cal = await main(mgr.p);
  flow.push(["PR-82: the manager sees the laser past its calibration due date", /Alat lewat jatuh tempo kalibrasi[\s\S]*Laser Pico Kemang · kalibrasi jatuh tempo/.test(cal)]);
  flow.push(["devices list with schedules and Jadwal for the manager", /Kalibrasi tiap 180 hari/.test(cal) && (await mgr.p.getByRole("button", { name: "Jadwal Perawatan" }).count()) >= 2]);
  await layouts(mgr.p, "/logbook?tab=calibration", "kalibrasi");
  await mgr.p.getByRole("button", { name: "Catat Kalibrasi atau Perawatan" }).click();
  const dv = mgr.p.getByRole("form", { name: "Catat kalibrasi atau perawatan" });
  await dv.getByLabel("Alat").selectOption({ label: "Laser Pico Kemang" });
  await dv.getByLabel("Hasil").selectOption({ label: "Baik" });
  await dv.getByLabel("Teknisi atau vendor").fill("PT Kalibrasi Medika");
  await dv.getByLabel("Nomor sertifikat (opsional)").fill("CAL-2026-11");
  await dv.getByRole("button", { name: "Simpan" }).click();
  await ok(mgr.p, "Catatan disimpan.");
  await mgr.p.goto(`${BASE}/logbook?tab=calibration`);
  await mgr.p.getByText(/sertifikat CAL-2026-11/).first().waitFor();
  const after = await main(mgr.p);
  flow.push(["the calibration entry clears the overdue device and moves its due date", !/Alat lewat jatuh tempo kalibrasi/.test(after) && /Kalibrasi · [\s\S]*PT Kalibrasi Medika/.test(after)]);
  // Review e891e890 P1-3: unticking "Jadwal aktif" deactivates the schedule (an unchecked box is absent from the form).
  await mgr.p.locator("main li").filter({ hasText: "Laser Pico Kemang" }).getByRole("button", { name: "Jadwal Kalibrasi" }).click();
  const sc = mgr.p.getByRole("form", { name: "Jadwal kalibrasi Laser Pico Kemang" });
  await sc.getByLabel("Jadwal aktif").uncheck();
  await sc.getByRole("button", { name: "Simpan Jadwal" }).click();
  await ok(mgr.p, "Jadwal disimpan.");
  await mgr.p.goto(`${BASE}/logbook?tab=calibration`);
  await mgr.p.getByText(/berikutnya [^·]*\(nonaktif\)/).first().waitFor();
  flow.push(["unticking Jadwal aktif deactivates the schedule", /Kalibrasi tiap 180 hari, berikutnya [^·]*\(nonaktif\)/.test(await main(mgr.p))]);
  await mgr.c.close();

  // Nurse: sterilization (a missing field refused, then saved), B3 waste; reports an incident with a patient.
  const nur = await open("nur", "203.0.113.192");
  await nur.p.goto(`${BASE}/logbook`);
  await nur.p.getByRole("heading", { name: /^Logbook Alat, Sterilisasi & Limbah/, level: 1 }).waitFor();
  flow.push(["nurse: Sterilisasi lists the seeded cycle", /Autoklaf · siklus AC-101/.test(await main(nur.p))]);
  await layouts(nur.p, "/logbook", "sterilisasi");
  await nur.p.getByRole("button", { name: "Catat Sterilisasi" }).click();
  const st = nur.p.getByRole("form", { name: "Catat sterilisasi" });
  await st.getByLabel("Metode").selectOption({ label: "Sinar UV" });
  await st.getByLabel("Hasil indikator").selectOption({ label: "Gagal" });
  await st.getByLabel("Ruang (opsional)").selectOption({ label: "Ruang Tindakan 1" });
  await st.getByLabel("Alat atau set yang disterilkan").fill("Pinset dan gunting");
  await st.getByRole("button", { name: "Simpan" }).click();
  await ok(nur.p, "Catatan disimpan.");
  await nur.p.goto(`${BASE}/logbook`);
  await nur.p.getByText(/Sinar UV · Pinset dan gunting · Ruang Tindakan 1/).first().waitFor();
  flow.push(["a failed sterilization cycle is recorded and shown as Gagal", /Gagal[\s\S]*Sinar UV · Pinset dan gunting/.test(await main(nur.p))]);
  await nur.p.goto(`${BASE}/logbook?tab=b3_waste`);
  await nur.p.getByRole("button", { name: "Catat Serah Limbah B3" }).click();
  const w = nur.p.getByRole("form", { name: "Catat serah limbah B3" });
  await w.getByLabel("Kategori").selectOption({ label: "Benda tajam" });
  await w.getByLabel("Jumlah (gram)").fill("1250");
  await w.getByLabel("Pengangkut berizin").fill("PT Olah Limbah Berizin");
  await w.getByLabel("Nomor bukti serah (manifes)").fill("MNF-0042");
  await w.getByRole("button", { name: "Simpan" }).click();
  await ok(nur.p, "Catatan disimpan.");
  await nur.p.goto(`${BASE}/logbook?tab=b3_waste`);
  await nur.p.getByText(/manifes MNF-0042/).first().waitFor();
  flow.push(["B3 waste handover recorded (category, quantity, handler, manifest)", /Benda tajam · 1,25 kg · PT Olah Limbah Berizin · manifes MNF-0042/.test(await main(nur.p))]);
  await layouts(nur.p, "/logbook?tab=b3_waste", "limbah");
  await nur.p.goto(`${BASE}/keluhan/insiden`);
  await nur.p.getByRole("heading", { name: /^Insiden Keselamatan Pasien/, level: 1 }).waitFor();
  await nur.p.getByRole("button", { name: "Catat Insiden" }).click();
  const rf = nur.p.getByRole("form", { name: "Catat insiden" });
  await rf.getByLabel("Jenis insiden").selectOption({ value: "ktd" });
  await rf.getByLabel("Pasien (opsional)").selectOption({ index: 1 });
  await rf.getByLabel("Ringkasan kejadian").fill("Kemerahan pasca laser melebihi perkiraan");
  await rf.getByLabel("Tindakan segera").fill("Kompres dingin dan observasi 30 menit");
  await rf.getByRole("button", { name: "Simpan Laporan" }).click();
  await ok(nur.p, "Insiden dicatat.");
  await nur.p.goto(`${BASE}/keluhan/insiden`);
  await nur.p.getByText(/Kemerahan pasca laser/).first().waitFor();
  const mine = await main(nur.p);
  // Review e891e890 P2-5: the incident with a patient: its detail (the patient link) measured too.
  await nur.p.getByRole("link", { name: /^KTD ·/ }).first().click();
  await nur.p.getByRole("heading", { name: "Kejadian Tidak Diharapkan", level: 1 }).waitFor();
  const ktd = nur.p.url().replace(BASE, "");
  await layouts(nur.p, ktd, "insiden-pasien");
  await nur.p.goto(`${BASE}/keluhan/insiden`);
  await nur.p.getByText(/Kemerahan pasca laser/).first().waitFor();
  flow.push(["the nurse sees her reports and their state only", /Insiden yang Anda laporkan dan statusnya/.test(mine) && /KTD ·[\s\S]*Dewi Lestari/.test(mine) && /Dilaporkan/.test(mine)]);
  await nur.c.close();

  // Facility head: the register; takes the KNC, investigates, decides no external report, closes.
  const fh = await open("fh", "203.0.113.193", true);
  await fh.p.goto(`${BASE}/keluhan?tab=insiden`);
  await fh.p.getByRole("link", { name: "Buka Register Insiden" }).click();
  await fh.p.getByRole("heading", { name: /^Insiden Keselamatan Pasien/, level: 1 }).waitFor();
  const reg = await main(fh.p);
  flow.push(["facility head: the register lists both incidents with the reporter", !/Insiden yang Anda laporkan/.test(reg) && /KNC ·/.test(reg) && /KTD ·/.test(reg) && /dilaporkan Sinta Perawat/.test(reg)]);
  await layouts(fh.p, "/keluhan/insiden", "insiden");
  await fh.p.goto(`${BASE}/keluhan/insiden/${seed.incidentId}`);
  await fh.p.getByRole("heading", { name: "Kejadian Nyaris Cedera", level: 1 }).waitFor();
  await fh.p.getByRole("button", { name: "Tangani" }).click();
  await fh.p.getByText("Investigasi belum selesai").first().waitFor();
  flow.push(["taken: 'Investigasi belum selesai' until the investigation is recorded; no close yet",
    (await fh.p.getByRole("button", { name: "Tutup Insiden" }).count()) === 0]);
  await fh.p.getByRole("button", { name: "Catat Investigasi" }).click();
  const inv = fh.p.getByRole("form", { name: "Catat Investigasi" });
  await inv.getByLabel("Hasil investigasi").fill("Dua serum dengan kemasan mirip disimpan berdampingan");
  await inv.getByLabel("Akar masalah").fill("Penataan rak tanpa pemisah");
  await inv.getByRole("button", { name: "Simpan" }).click();
  await fh.p.getByText("Penataan rak tanpa pemisah").first().waitFor();
  await fh.p.getByRole("button", { name: "Keputusan Pelaporan" }).click();
  const det = fh.p.getByRole("form", { name: "Keputusan Pelaporan" });
  await det.getByLabel("Perlu dilaporkan ke pihak luar?").selectOption({ value: "no" });
  await det.getByRole("button", { name: "Simpan" }).click();
  await fh.p.getByText("Tidak perlu dilaporkan ke pihak luar").first().waitFor();
  await layouts(fh.p, `/keluhan/insiden/${seed.incidentId}`, "insiden-detail");
  await fh.p.getByRole("button", { name: "Tutup Insiden" }).click();
  const cl = fh.p.getByRole("form", { name: "Tutup Insiden" });
  await cl.getByLabel("Tindakan korektif").fill("Rak diberi pemisah dan label warna");
  await cl.getByRole("button", { name: "Simpan" }).click();
  await fh.p.getByText("Rak diberi pemisah dan label warna").first().waitFor();
  const closed = await main(fh.p);
  flow.push(["closed with the corrective action and the full history", /Ditutup/.test(closed) && /Dilaporkan ·[\s\S]*Mulai ditangani ·[\s\S]*Investigasi selesai ·[\s\S]*Keputusan pelaporan ·[\s\S]*Ditutup ·/.test(closed)]);
  await fh.c.close();

  // Owner reads the logbook of a chosen branch (no Catat).
  const own = await open("own", "203.0.113.194", true);
  await own.p.goto(`${BASE}/logbook?tab=sterilization&cabang=${seed.branches.b1}`);
  await own.p.getByRole("heading", { name: "Logbook Alat, Sterilisasi & Limbah · Cabang Kemang", level: 1 }).waitFor();
  flow.push(["owner reads only: no Catat, the read-only note", (await own.p.getByRole("button", { name: "Catat Sterilisasi" }).count()) === 0 && /hanya dapat dibaca/.test(await main(own.p))]);
  await own.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
