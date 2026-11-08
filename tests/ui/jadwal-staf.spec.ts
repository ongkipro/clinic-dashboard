// T-043 browser evidence (UX-33, PR-48) at 390/820/1180/1440 and 200 % text. Done when: shifts and leave
// persist per branch (the module-level availability is proven in tests/scheduling). The Manager opens
// Jadwal Praktik from the menu, sees the branch hours, saves next week (a shift with a break for two
// doctors), gets the overlap refusal with the posted values kept, records and cancels a leave, filters by
// role (filtered-empty for therapists); the Owner switches branch; the FO has no access. No console error.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/jadwal-staf.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; kemang: string; makassar: string };
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
  check(): Promise<void>; inputValue(): Promise<string>; selectOption(v: string | object): Promise<unknown>; evaluateAll<T>(f: (e: Element[]) => T): Promise<T>; allInnerTexts(): Promise<string[]>; getByText(t: string, o?: { exact?: boolean }): Locator;
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
  // Next 16 keeps the previous page in the DOM, hidden (Activity, display:none): use the visible main only.
  const main = (p: Page) => p.locator("main:visible").innerText();
  const form = (p: Page, label: string) => p.locator(`main:visible form[aria-label="${label}"]`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const monday = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
  const next = monday(addDays(today, 7));
  const label = (d: string) => new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const doc1 = "dr. Ayu Lestari", doc2 = "dr. Bima Pratama";

  const mCtx = await ctxOf("203.0.113.91");
  const m = await mCtx.newPage();
  current = m;
  m.on("console", onConsole);
  await signIn(m, seed.people.mgr.email);
  // "/" is a placeholder outside the app shell: start from a page inside it, then use the menu.
  await m.goto(`${BASE}/pengaturan`);
  await m.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: "Jadwal Praktik" }).click();
  await m.waitForURL(/\/jadwal-staf/);
  await m.getByRole("heading", { name: "Jadwal Staf", exact: true }).waitFor();
  const first = await main(m);
  flow.push(["the Manager opens Jadwal Praktik from the menu and sees the branch hours and the roster", first.includes("Jam buka & libur Cabang Kemang") && first.includes("07:00–22:00") && first.includes(doc1) && first.includes("Ners Citra")]);
  await layouts(m, `/jadwal-staf?minggu=${next}`, "week");
  await m.goto(`${BASE}/jadwal-staf?minggu=${next}`);
  const wk = form(m, "Jadwal minggu ini");
  const who = (n: string, d: string) => `${n}, ${label(d)}`;
  const tue = addDays(next, 1);
  await wk.getByLabel(`Mulai kerja ${who(doc1, next)}`, { exact: true }).fill("09:00");
  await wk.getByLabel(`Selesai kerja ${who(doc1, next)}`, { exact: true }).fill("17:00");
  await wk.getByLabel(`Mulai istirahat ${who(doc1, next)}`, { exact: true }).fill("12:00");
  await wk.getByLabel(`Selesai istirahat ${who(doc1, next)}`, { exact: true }).fill("13:00");
  await wk.getByLabel(`Mulai kerja ${who("Ners Citra", tue)}`, { exact: true }).fill("08:00");
  await wk.getByLabel(`Selesai kerja ${who("Ners Citra", tue)}`, { exact: true }).fill("12:00");
  await wk.getByLabel(`Mulai kerja ${who(doc2, tue)}`, { exact: true }).fill("13:00");
  await wk.getByLabel(`Selesai kerja ${who(doc2, tue)}`, { exact: true }).fill("24:00");
  await wk.getByRole("button", { name: "Simpan Jadwal" }).click();
  await wk.getByText("Jadwal minggu ini tersimpan.").waitFor();
  await m.reload();
  const kept = await form(m, "Jadwal minggu ini").getByLabel(`Selesai kerja ${who(doc2, tue)}`, { exact: true }).inputValue();
  const brk = await form(m, "Jadwal minggu ini").getByLabel(`Mulai istirahat ${who(doc1, next)}`, { exact: true }).inputValue();
  flow.push(["a week with a break and a shift to 24:00 is saved and shown after a reload", kept === "24:00" && brk === "12:00"]);
  // A break outside the shift: refused with its copy; the posted values stay in the fields.
  const wk2 = form(m, "Jadwal minggu ini");
  await wk2.getByLabel(`Mulai istirahat ${who(doc2, tue)}`, { exact: true }).fill("10:00");
  await wk2.getByLabel(`Selesai istirahat ${who(doc2, tue)}`, { exact: true }).fill("11:00");
  await wk2.getByRole("button", { name: "Simpan Jadwal" }).click();
  await form(m, "Jadwal minggu ini").locator("p[role=alert]").waitFor();
  const err = await form(m, "Jadwal minggu ini").locator("p[role=alert]").innerText();
  const still = await form(m, "Jadwal minggu ini").getByLabel(`Mulai istirahat ${who(doc2, tue)}`, { exact: true }).inputValue();
  flow.push(["a break outside the shift is refused with its copy and the posted values stay", err.includes("Istirahat harus berada di dalam jam kerja") && still === "10:00"]);
  await m.screenshot({ path: `${OUT}/week-refused-1440.png`, fullPage: true });
  // Leave: record and cancel.
  const lf = form(m, "Catat ketidakhadiran");
  await lf.getByLabel("Staf", { exact: true }).selectOption({ label: doc1 } as never);
  await lf.getByLabel("Jenis", { exact: true }).selectOption("leave");
  await lf.getByLabel("Dari tanggal", { exact: true }).fill(addDays(next, 3));
  await lf.getByLabel("Sampai tanggal", { exact: true }).fill(addDays(next, 4));
  await lf.getByLabel("Alasan", { exact: true }).fill("Cuti tahunan");
  await lf.getByRole("button", { name: "Catat" }).click();
  await m.locator("main:visible").getByRole("list", { name: "Cuti dan izin minggu ini" }).waitFor();
  const leaveText = await m.locator("main:visible").getByRole("list", { name: "Cuti dan izin minggu ini" }).innerText();
  const marked = (await main(m)).includes("Tidak hadir");
  flow.push(["a leave is recorded, listed and marked in the grid", leaveText.includes(`Cuti ${doc1}`) && leaveText.includes("Cuti tahunan") && marked]);
  await measure(m, "week-leave-1440", "week-leave-1440");
  const cancel = m.locator(`main:visible form[aria-label^="Batalkan Cuti ${doc1}"]`);
  await cancel.getByLabel("Alasan pembatalan", { exact: true }).fill("Jadwal berubah");
  await cancel.getByRole("button", { name: "Batalkan" }).click();
  await m.getByText("Tidak ada staf yang cuti atau izin minggu ini.").waitFor();
  flow.push(["a leave is cancelled and leaves the list", true]);
  // Role filter: Terapis → filtered-empty; Dokter → only doctors.
  await m.getByRole("link", { name: "Terapis", exact: true }).click();
  await m.getByText("Tidak ada staf dengan peran Terapis di cabang ini.").waitFor();
  await m.getByRole("link", { name: "Dokter", exact: true }).click();
  await m.waitForURL(/peran=doctor/);
  // The grid only (the leave form's staff list names everyone on purpose).
  const docs = await form(m, "Jadwal minggu ini").innerText();
  // Saving under the Dokter filter keeps the nurse's shift (impl review r1 P1).
  await form(m, "Jadwal minggu ini").getByLabel(`Mulai kerja ${who(doc1, tue)}`, { exact: true }).fill("10:00");
  await form(m, "Jadwal minggu ini").getByLabel(`Selesai kerja ${who(doc1, tue)}`, { exact: true }).fill("12:00");
  await form(m, "Jadwal minggu ini").getByRole("button", { name: "Simpan Jadwal" }).click();
  await form(m, "Jadwal minggu ini").getByText("Jadwal minggu ini tersimpan.").waitFor();
  await m.goto(`${BASE}/jadwal-staf?minggu=${next}&peran=nurse`);
  const nurse = await form(m, "Jadwal minggu ini").getByLabel(`Mulai kerja ${who("Ners Citra", tue)}`, { exact: true }).inputValue();
  flow.push(["the role filter shows filtered-empty for therapists and only doctors; a save there keeps the nurse's shift",
    docs.includes(doc1) && docs.includes(doc2) && !docs.includes("Ners Citra") && !docs.includes("FO Sintetis") && nurse === "08:00"]);
  await m.setViewportSize({ width: 390, height: 900 });
  await m.screenshot({ path: `${OUT}/week-doctors-390.png`, fullPage: true });
  await m.setViewportSize({ width: 1440, height: 900 });
  await mCtx.close();

  // The Owner switches branch; Makassar shows its own (empty) week.
  const oCtx = await ctxOf("203.0.113.92");
  const o = await oCtx.newPage();
  current = o;
  o.on("console", onConsole);
  await signIn(o, seed.people.owner.email);
  await o.goto(`${BASE}/jadwal-staf?cabang=${seed.kemang}&minggu=${next}`);
  await o.getByRole("link", { name: "Cabang Makassar", exact: true }).click();
  await o.waitForURL(new RegExp(`cabang=${seed.makassar}`));
  await o.getByText("Belum ada staf yang ditugaskan di cabang ini.").waitFor();
  flow.push(["the Owner switches to another branch, which shows its own week (no staff assigned there)", (await main(o)).includes("Jam buka & libur Cabang Makassar")]);
  await o.goto(`${BASE}/jadwal-staf?cabang=${seed.kemang}&minggu=${next}`);
  const ownerSees = await form(o, "Jadwal minggu ini").getByLabel(`Selesai kerja ${who(doc2, tue)}`, { exact: true }).inputValue();
  flow.push(["the Owner sees the week the Manager saved", ownerSees === "24:00"]);
  await oCtx.close();

  // The FO has no Jadwal Staf.
  const fCtx = await ctxOf("203.0.113.93");
  const f = await fCtx.newPage();
  current = f;
  f.on("console", onConsole);
  await signIn(f, seed.people.fo.email, false); // FO/cashier is not a TOTP role (policy TOTP_ROLES)
  await f.goto(`${BASE}/jadwal-staf`);
  await f.getByRole("heading", { name: "Jadwal Staf", exact: true }).waitFor();
  flow.push(["the FO sees the permission state and no week form", (await main(f)).includes("Anda tidak memiliki akses ke jadwal staf") && (await form(f, "Jadwal minggu ini").count()) === 0]);
  await fCtx.close();
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
