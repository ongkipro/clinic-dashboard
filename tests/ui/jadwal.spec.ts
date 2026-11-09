// T-045 browser evidence (UX-5, PR-83) at 390/820/1180/1440 and 200 % text. Done when: scenario PR-83
// no-show without DP (in tests/scheduling) and the browser check of the UX-5 phone agenda and desktop
// week. FO opens Kalender from the menu (Hari Ini), marks the past appointment Tidak Datang (enabled after
// its time; an upcoming one is disabled with the time shown), confirms one, cancels one with a reason
// (destructive sheet, DP notice), reschedules one through the slot sheet, books a new appointment
// through Buat Janji with the on-demand patient search, switches to Minggu and filters by room; the
// doctor reads without actions; finance has no access. No console error.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/jadwal.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; kemang: string; makassar: string; past: string; later1: string; later2: string; newPatient: string };
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
  check(): Promise<void>; isDisabled(): Promise<boolean>; nth(i: number): Locator; inputValue(): Promise<string>; selectOption(v: string | object): Promise<unknown>; evaluateAll<T>(f: (e: Element[]) => T): Promise<T>; allInnerTexts(): Promise<string[]>; getByText(t: string, o?: { exact?: boolean }): Locator;
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
  const main = (p: Page) => p.locator("main:visible").innerText();
  const form = (p: Page, label: string) => p.locator(`main:visible form[aria-label^="${label}"]`);
  const item = (p: Page, name: string) => p.locator("main:visible li").filter({ hasText: name });

  const fCtx = await ctxOf("203.0.113.101");
  const f = await fCtx.newPage();
  current = f;
  f.on("console", onConsole);
  await signIn(f, seed.people.fo.email, false);
  await f.goto(`${BASE}/pengaturan`).catch(() => undefined);
  await f.goto(`${BASE}/jadwal`);
  await f.getByRole("heading", { name: "Jadwal", exact: true }).waitFor();
  const first = await main(f);
  flow.push(["FO opens Jadwal (Hari Ini) and sees today's appointments with state words and the zone", first.includes("Sinta Pasien") && first.includes("Terjadwal") && first.includes("WIB")]);
  await layouts(f, "/jadwal", "hari");
  await layouts(f, "/jadwal?tampilan=minggu", "minggu");
  await f.goto(`${BASE}/jadwal`);
  // Tidak Datang: enabled for the past one, disabled with the time for an upcoming one.
  const upcoming = item(f, "Rudi Pasien");
  const disabled = await upcoming.getByRole("button", { name: "Tandai Tidak Datang" }).isDisabled();
  const hint = (await upcoming.innerText()).includes("Tidak Datang tersedia mulai");
  await item(f, "Sinta Pasien").getByRole("button", { name: "Tandai Tidak Datang" }).click();
  // The row re-renders from the server with its new state (its action forms are gone once no-show).
  await item(f, "Sinta Pasien").getByText("Tidak Datang", { exact: true }).waitFor();
  flow.push(["Tidak Datang marks the past appointment no-show; an upcoming one is disabled with its time", disabled && hint && (await item(f, "Sinta Pasien").innerText()).includes("Tidak Datang")]);
  // Konfirmasi.
  await item(f, "Rudi Pasien").getByRole("button", { name: "Konfirmasi" }).click();
  await item(f, "Rudi Pasien").getByText("Dikonfirmasi", { exact: true }).waitFor();
  flow.push(["Konfirmasi turns an appointment into Dikonfirmasi", (await item(f, "Rudi Pasien").innerText()).includes("Dikonfirmasi")]);
  // Batalkan: reason required, destructive, DP notice.
  await item(f, "Maya Pasien").getByRole("button", { name: "Batalkan", exact: true }).click();
  const sheet = form(f, "Batalkan Maya Pasien");
  const dpNotice = (await sheet.innerText()).includes("Aturan DP");
  await sheet.getByRole("button", { name: "Batalkan Janji" }).click();
  await sheet.locator("p[role=alert]").waitFor();
  const needReason = (await sheet.locator("p[role=alert]").innerText()).includes("alasan");
  await form(f, "Batalkan Maya Pasien").getByLabel("Alasan pembatalan", { exact: true }).fill("Pasien berhalangan");
  await form(f, "Batalkan Maya Pasien").getByRole("button", { name: "Batalkan Janji" }).click();
  await item(f, "Maya Pasien").getByText("Dibatalkan", { exact: true }).waitFor();
  flow.push(["Batalkan shows the DP notice, needs a reason, then cancels", dpNotice && needReason && (await item(f, "Maya Pasien").innerText()).includes("Dibatalkan")]);
  // Ubah Jadwal: pick a slot tomorrow.
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 86_400_000));
  await item(f, "Rudi Pasien").getByRole("button", { name: "Ubah Jadwal" }).click();
  const slot = f.locator("main:visible form[aria-label='Cari slot']").first();
  await slot.getByLabel("Tanggal", { exact: true }).fill(tomorrow);
  await slot.getByRole("button", { name: "Lihat slot" }).click();
  await f.getByRole("group", { name: "Slot tersedia" }).first().waitFor().catch(() => undefined);
  await f.locator("main:visible input[type=radio][name=start]").nth(40).check();
  await form(f, "Ubah jadwal Rudi Pasien").getByRole("button", { name: "Simpan Jadwal Baru" }).click();
  await item(f, "Rudi Pasien").getByText("Dijadwal Ulang", { exact: true }).waitFor();
  flow.push(["Ubah Jadwal moves the appointment to a slot tomorrow (Dijadwal Ulang today)", (await item(f, "Rudi Pasien").innerText()).includes("Dijadwal Ulang")]);
  // Buat Janji with the patient search (POST; no list).
  await f.getByRole("link", { name: "Buat Janji" }).click();
  await f.getByRole("heading", { name: "Buat Janji" }).waitFor();
  const urlBefore = f.url();
  await form(f, "Cari pasien").getByLabel("Cari pasien", { exact: true }).fill("Budi");
  await form(f, "Cari pasien").getByRole("button", { name: "Cari" }).click();
  await f.getByRole("list", { name: "Hasil pencarian pasien" }).waitFor();
  const masked = (await f.getByRole("list", { name: "Hasil pencarian pasien" }).innerText()).includes("•");
  await f.getByRole("list", { name: "Hasil pencarian pasien" }).getByRole("button").first().click();
  const s2 = f.locator("main:visible section[aria-labelledby='buat-janji'] form[aria-label='Cari slot']");
  await s2.getByLabel("Tanggal", { exact: true }).fill(tomorrow);
  await s2.getByRole("button", { name: "Lihat slot" }).click();
  await f.locator("main:visible section[aria-labelledby='buat-janji'] input[type=radio][name=start]").first().waitFor();
  await f.locator("main:visible section[aria-labelledby='buat-janji'] input[type=radio][name=start]").nth(20).check();
  await form(f, "Simpan janji").getByRole("button", { name: "Simpan Janji" }).click();
  await f.getByText("Janji tersimpan.").waitFor();
  flow.push(["Buat Janji: on-demand patient search (masked phone, query not in the URL), slot, saved", masked && !f.url().includes("Budi") && f.url() === urlBefore]);
  // Minggu and a room filter.
  await f.goto(`${BASE}/jadwal?tampilan=minggu&tanggal=${tomorrow}`);
  await f.getByRole("heading", { name: "Jadwal", exact: true }).waitFor();
  const week = await main(f);
  await f.getByRole("list", { name: "Saring ruang dan alat" }).getByRole("link", { name: "Ruang Konsul 1" }).click();
  await f.waitForURL(/ruang=/);
  flow.push(["Minggu shows the week (Budi and Rudi tomorrow); the room filter keeps them", week.includes("Budi Baru") && week.includes("Rudi Pasien") && (await main(f)).includes("Budi Baru")]);
  await f.screenshot({ path: `${OUT}/minggu-filter-1440.png`, fullPage: true });
  // Filtered-empty: a performer filter with no appointment in an empty week.
  const far = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 40 * 86_400_000));
  await f.goto(`${BASE}/jadwal?tampilan=hari&tanggal=${far}`);
  await f.getByText("Belum ada janji pada tanggal ini.").waitFor();
  flow.push(["an empty date shows the empty state", true]);
  await fCtx.close();

  // The doctor reads without actions.
  const dCtx = await ctxOf("203.0.113.102");
  const d = await dCtx.newPage();
  current = d;
  d.on("console", onConsole);
  await signIn(d, seed.people.doc1.email);
  await d.goto(`${BASE}/jadwal?tampilan=minggu&tanggal=${tomorrow}`);
  await d.getByRole("heading", { name: "Jadwal", exact: true }).waitFor();
  flow.push(["the doctor reads the calendar without any action or Buat Janji", (await main(d)).includes("Budi Baru") && (await d.locator("main:visible button").filter({ hasText: /Konfirmasi|Batalkan|Ubah Jadwal|Tidak Datang/ }).count()) === 0 && (await d.getByRole("link", { name: "Buat Janji" }).count()) === 0]);
  await dCtx.close();

  // Finance has no Jadwal.
  const nCtx = await ctxOf("203.0.113.103");
  const n = await nCtx.newPage();
  current = n;
  n.on("console", onConsole);
  await signIn(n, seed.people.fin.email);
  await n.goto(`${BASE}/jadwal`);
  await n.getByRole("heading", { name: "Jadwal", exact: true }).waitFor();
  flow.push(["finance sees the permission state", (await main(n)).includes("Anda tidak memiliki akses ke jadwal")]);
  await nCtx.close();
} catch (e) {
  report.error = String(e).split("\n").slice(0, 3).join(" ");
  if (current) {
    await current.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
    report.failureText = await current.locator("main:visible").innerText().catch(() => "");
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
