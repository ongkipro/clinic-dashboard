// T-028 browser evidence (UX-48, PR-60) at 390/820/1180/1440 and 200 % text. Done when: the Owner sees a
// seeded session with reads and can end it; an approval request appears for a clinical-scope session
// (here a personal-data scope; the database treats personal and clinical alike, TEN-14) and the Owner
// approves it. Plus: Admin Pusat sees the same sessions read-only, without the grant section or buttons;
// the session log lists every record read, flagging one that no longer exists. No console error.
// HYG-013 (DEC-044): the Owner revokes an effective dual identity ("Cabut", with a confirmation);
// Admin Pusat sees it without Cabut.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/akses-vendor.spec.ts out-dir

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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string }>; active: string; pending: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator;
  waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
};
async function signIn(page: Page, email: string) {
  await page.goto(`${BASE}/masuk`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);
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
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea")].filter(vis);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, name: string) {
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE}${path}`);
      await page.getByRole("heading", { name: "Sesi dukungan" }).waitFor();
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
try {
  // Admin Pusat first (read-only view of the same data, before the Owner changes anything).
  const apCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": "203.0.113.31" } });
  const ap = await apCtx.newPage();
  ap.on("console", onConsole);
  await signIn(ap, seed.people.ap.email);
  await ap.goto(`${BASE}/saya/akses-vendor`);
  await ap.getByRole("heading", { name: "Sesi dukungan" }).waitFor();
  const apText = await ap.locator("main").innerText();
  flow.push(["Admin Pusat sees sessions read-only (no decision buttons, no onboarding section)",
    apText.includes("Hanya baca") && apText.includes("Memeriksa pengaturan cabang") && !apText.includes("Setujui Akses Klinis") && !apText.includes("Akhiri Sesi") && !apText.includes("Akses onboarding")]);
  // HYG-013: Admin Pusat sees the effective dual identity but cannot revoke it.
  const apDual = await ap.locator("main li").filter({ hasText: "Dimas Ganda" }).first().innerText();
  flow.push(["Admin Pusat sees the effective dual identity without Cabut", apDual.includes("Berlaku") && !apDual.includes("Cabut")]);
  await layouts(ap, "/saya/akses-vendor", "ap");
  await apCtx.close();

  const oCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": "203.0.113.32" } });
  const o = await oCtx.newPage();
  o.on("console", onConsole);
  await signIn(o, seed.people.owner.email);
  await o.goto(`${BASE}/saya/akses-vendor`);
  await o.getByRole("heading", { name: "Persetujuan akses" }).waitFor();
  const text = await o.locator("main").innerText();
  // The pending session shows its own counts and log link (review round 1: refused binds before approval).
  flow.push(["the pending session shows its counts and log link", (await o.locator("main section").filter({ has: o.getByRole("heading", { name: "Persetujuan akses" }) }).innerText()).includes("Lihat catatan")]);
  flow.push(["approval request appears for the personal/clinical-scope session (once, under Persetujuan akses)", text.includes("Memeriksa data staf yang tidak bisa masuk") && text.includes("data pribadi") && text.includes("Setujui Akses Klinis") && text.split("Memeriksa data staf yang tidak bisa masuk").length === 2]);
  flow.push(["active session shows its counts", text.includes("2 jendela akses") && text.includes("3 data dibaca")]);
  await layouts(o, "/saya/akses-vendor", "owner");
  // The session log: every record read; the one whose row no longer exists is flagged.
  await o.goto(`${BASE}/saya/akses-vendor?sesi=${seed.active}`);
  await o.locator(`#catatan-${seed.active}`).waitFor();
  const log = await o.locator(`#catatan-${seed.active}`).innerText();
  const reads = (log.match(/Membaca/g) ?? []).length;
  const card = await o.locator("main li").filter({ hasText: "Memeriksa pengaturan cabang yang tidak tersimpan" }).first().innerText();
  flow.push(["session log lists every record read (3), flags a missing row, counts shown once", reads === 3 && log.includes("data tidak ada lagi di klinik ini") && log.includes("Jendela akses dibuka") && card.split("3 data dibaca").length === 2]);
  await o.screenshot({ path: `${OUT}/log-1440.png`, fullPage: true });
  await measure(o, "log-1440");
  // End the active session.
  const activeCard = o.locator("main li").filter({ hasText: "Memeriksa pengaturan cabang yang tidak tersimpan" }).first();
  await activeCard.getByRole("button", { name: "Akhiri Sesi" }).click();
  // The confirm step replaces the first button with Batal + Akhiri Sesi.
  await activeCard.getByRole("button", { name: "Batal" }).waitFor();
  await activeCard.getByRole("button", { name: "Akhiri Sesi" }).click();
  await o.waitForURL(`${BASE}/saya/akses-vendor`);
  await o.getByText("Sesi diakhiri. Vendor tidak bisa membaca data lagi lewat sesi ini.").waitFor();
  flow.push(["Owner ends the active session and sees the result", true]);
  await o.screenshot({ path: `${OUT}/ended-1440.png`, fullPage: true });
  await o.goto(`${BASE}/saya/akses-vendor`);
  await o.getByRole("heading", { name: "Sesi dukungan" }).waitFor();
  const afterEnd = await o.locator("main li").filter({ hasText: "Memeriksa pengaturan cabang yang tidak tersimpan" }).first().innerText();
  flow.push(["ended session shows as ended by the Owner", afterEnd.includes("Berakhir") && afterEnd.includes("diakhiri Owner")]);
  // Approve the pending session.
  const pendingCard = o.locator("main section").filter({ has: o.getByRole("heading", { name: "Persetujuan akses" }) }).locator("li").first();
  await pendingCard.getByRole("button", { name: "Setujui Akses Klinis" }).click();
  await o.waitForURL(`${BASE}/saya/akses-vendor`);
  await o.getByText("Akses disetujui. Sesi aktif mulai sekarang.").waitFor();
  flow.push(["Owner approves the scope; the session becomes active", true]);
  await o.goto(`${BASE}/saya/akses-vendor`);
  await o.getByRole("heading", { name: "Sesi dukungan" }).waitFor();
  const after = await o.locator("main").innerText();
  // A URL cannot claim a result (review round 1): a forged code shows no notice.
  await o.goto(`${BASE}/saya/akses-vendor?hasil=sesi-diakhiri`);
  await o.getByRole("heading", { name: "Sesi dukungan" }).waitFor();
  flow.push(["a result claimed in the URL shows nothing", !(await o.locator("main").innerText()).includes("Sesi diakhiri. Vendor tidak bisa")]);
  await o.goto(`${BASE}/saya/akses-vendor`);
  await o.getByRole("heading", { name: "Sesi dukungan" }).waitFor();
  flow.push(["no request waits after the approval; the session is listed active", after.includes("Tidak ada permintaan yang menunggu") && (await o.locator("main li").filter({ hasText: "Memeriksa data staf yang tidak bisa masuk" }).first().innerText()).includes("Aktif")]);
  await o.screenshot({ path: `${OUT}/approved-1440.png`, fullPage: true });
  // HYG-013 (DEC-044): the Owner revokes the effective dual identity; the confirmation names the
  // consequence; the result notice; the identity is listed as revoked, without Cabut.
  await o.setViewportSize({ width: 390, height: 900 });
  const dualCard = o.locator("main li").filter({ hasText: "Dimas Ganda" }).first();
  await dualCard.getByRole("button", { name: "Cabut" }).click();
  await dualCard.getByRole("button", { name: "Batal" }).waitFor();
  const confirmText = await dualCard.innerText();
  await o.screenshot({ path: `${OUT}/cabut-confirm-390.png`, fullPage: true });
  await measure(o, "cabut-confirm-390");
  await dualCard.getByRole("button", { name: "Cabut" }).click();
  await o.waitForURL(`${BASE}/saya/akses-vendor`);
  await o.getByText("Identitas ganda dicabut. Akun itu tidak lagi menjadi staf klinik ini.").waitFor();
  flow.push(["Owner revokes the dual identity after a confirmation naming the consequence", confirmText.includes("langsung berhenti menjadi staf klinik ini") && confirmText.includes("Akun vendornya tidak berubah")]);
  await o.screenshot({ path: `${OUT}/cabut-done-390.png`, fullPage: true });
  await o.goto(`${BASE}/saya/akses-vendor`);
  await o.getByRole("heading", { name: "Identitas ganda" }).waitFor();
  const revoked = await o.locator("main li").filter({ hasText: "Dimas Ganda" }).first().innerText();
  flow.push(["the revoked identity is listed as Dicabut with its date, without Cabut", revoked.includes("Dicabut") && revoked.includes("dicabut Owner") && !/\bCabut\b/.test(revoked.replace("Dicabut", "").replace("dicabut", ""))]);
  await o.setViewportSize({ width: 1440, height: 900 });
  await oCtx.close();
} catch (e) {
  report.error = String(e).split("\n").slice(0, 3).join(" ");
  process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
} finally {
  await browser.close();
  // Review round 1: a false flow, a bad layout or a console error fails the runner too (report kept).
  const bad = Object.entries(report.layout as Record<string, { overflowX: number; minTarget: number | null; unnamed: number }>)
    .filter(([, v]) => v.overflowX || (v.minTarget !== null && v.minTarget < 44) || v.unnamed).map(([k]) => k);
  report.failed = { flows: flow.filter(([, ok]) => ok !== true).map(([k]) => k), layouts: bad, console: (report.console as string[]).length };
  if (flow.some(([, ok]) => ok !== true) || bad.length || (report.console as string[]).length) process.exitCode = 1;
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
