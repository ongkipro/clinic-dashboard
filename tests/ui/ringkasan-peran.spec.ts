// T-107 browser evidence (Ringkasan per peran, UX-60, 19 §2.1, PR-33) at 390/820/1180/1440 and 200 % text. One route, /ringkasan/peran,
// dispatched by acting role: the facility head (Ringkasan Klinis), marketing, the pharmacist (Apotek), purchasing (Pembelian), the auditor
// (Audit), the nurse and the therapist (Ruang Saya). Each home shows its seeded widgets with the drill-down links to pages that exist; the
// manager (no UX-60 home) gets the permission state. Ruang Saya: the room schedule grouped by room, the next arriving patient, the own
// commission this month (the therapist has none: Rp0 with its basis, never "belum tersedia"). Keyboard: Tab reaches a home link and Enter
// opens it. Every page: no horizontal overflow, targets ≥ 44 px, named controls, no console error, and the clinical sentinel never appears.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/ringkasan-peran.spec.ts out-dir
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
  password: string; sentinel: string; people: Record<string, { email: string; staffId: string }>; patients: { treated: string; waiting: string; next: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  getAttribute(n: string): Promise<string | null>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; url(): string; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; content(): Promise<string>;
  addStyleTag(o: { content: string }): Promise<unknown>; keyboard: { press(k: string): Promise<void> }; on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  on(e: "response", f: (r: { status(): number; url(): string }) => void): void;
};
const TOTP = new Set(["own", "fh", "au", "mgr"]); // policy TOTP_ROLES among the seeded people (owner, facility head, auditor, manager)
async function signIn(page: Page, who: string) {
  await page.goto(`${BASE}/masuk`);
  await page.getByLabel("Email").fill(seed.people[who].email);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);
  if (!TOTP.has(who)) return;
  await page.goto(`${BASE}/ringkasan/peran`);
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
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
      smallest: ctl.map((e) => [Math.round(e.getBoundingClientRect().height), `${e.tagName}:${(e.textContent ?? "").trim().slice(0, 30)}`] as const)
        .filter(([hgt]) => hgt < 44).slice(0, 4).map(([hgt, d]) => `${hgt}:${d}`),
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      squeezed: [...document.querySelectorAll("main dd, main dt, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight) || em * 1.2;
        return !e.classList.contains("sr-only") && cs.display !== "inline" && r.width > 0 && r.width < 4 * em && r.height > 3 * lh && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}:${(e.textContent || "").trim().slice(0, 30)}`),
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3)
        .map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}@${e.getBoundingClientRect().right.toFixed(1)}`),
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
  await page.goto(`${BASE}${path}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
}
// A 404 is the shell navigation prefetching a page not built yet (as the other specs); each one's URL is recorded and none may be a link
// a home renders (checked in the flows below).
const notFound = new Set<string>();
report.notFound = notFound;
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));
const onResponse = (r: { status(): number; url(): string }) => { if (r.status() === 404) notFound.add(new URL(r.url()).pathname); };
const leaked = (html: string) => html.includes(seed.sentinel);

const browser = await chromium.launch();
let current: Page | null = null;
try {
  let ip = 40;
  const open = async (who: string) => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": `203.0.113.${++ip}` } });
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    p.on("response", onResponse);
    await signIn(p, who);
    await p.goto(`${BASE}/ringkasan/peran`);
    await p.getByRole("heading", { level: 1 }).waitFor();
    return { c, p };
  };
  const main = (p: Page) => p.locator("main:visible").innerText();
  const h1 = (p: Page) => p.getByRole("heading", { level: 1 }).innerText();
  const linkTo = (p: Page, href: string) => p.locator(`main a[href="${href}"]`).count();

  // Klinis (facility head)
  const fh = await open("fh");
  const k0 = await main(fh.p);
  flow.push(["facility head: Ringkasan Klinis with complaint 1, incident 1, SATUSEHAT rejected 1, the pending correction by dr. Maya, the nurse's SIPP expiring",
    (await h1(fh.p)) === "Ringkasan Klinis" && /Keluhan klinis terbuka\s*1/.test(k0) && /Insiden terbuka\s*1/.test(k0) && /SATUSEHAT ditolak\s*1/.test(k0)
      && /dr\. Maya/.test(k0) && /Ners Dita[\s\S]*SIPP · habis/.test(k0)]);
  flow.push(["facility head: the SATUSEHAT link keeps the acronym (Lihat SATUSEHAT ditolak)", /Lihat SATUSEHAT ditolak/.test(k0) && /Lihat keluhan klinis terbuka/.test(k0)]);
  flow.push(["facility head: drill-down links to /keluhan, /keluhan/insiden, /satusehat, /persetujuan, /staf; no clinical sentinel",
    (await linkTo(fh.p, "/keluhan")) >= 1 && (await linkTo(fh.p, "/keluhan/insiden")) >= 1 && (await linkTo(fh.p, "/satusehat")) >= 1
      && (await linkTo(fh.p, "/persetujuan")) >= 1 && (await linkTo(fh.p, "/staf")) >= 1 && !leaked(await fh.p.content())]);
  // keyboard: Tab from the top of the page reaches a home link; Enter opens its page
  await fh.p.locator("main a[href='/keluhan']").first().waitFor();
  let reached = "";
  for (let i = 0; i < 60 && !reached; i++) {
    await fh.p.keyboard.press("Tab");
    const href = await fh.p.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.closest("main") ? (document.activeElement as HTMLAnchorElement).getAttribute("href") ?? "" : "");
    if (href === "/keluhan") reached = href;
  }
  await fh.p.keyboard.press("Enter");
  await fh.p.waitForURL(`${BASE}/keluhan`);
  flow.push(["keyboard: Tab reaches the Keluhan link on the home and Enter opens /keluhan", reached === "/keluhan"]);
  await layouts(fh.p, "/ringkasan/peran", "klinis");
  await fh.c.close();

  // Marketing
  const mk = await open("mk");
  const m0 = await main(mk.p);
  flow.push(["marketing: Ringkasan Marketing with lead stages (Baru 1, Dihubungi 4), the survey (1, average 3, low 0), Lihat lead → /lead; no sentinel",
    (await h1(mk.p)) === "Ringkasan Marketing" && /Baru\s*1/.test(m0) && /Dihubungi\s*4/.test(m0) && /Survei bulan ini\s*1/.test(m0) && /Rata-rata 3/.test(m0) && /skor ≤ 2: 0/.test(m0)
      && (await linkTo(mk.p, "/lead")) === 1 && !leaked(await mk.p.content())]);
  flow.push(["marketing: empty promo state is written (no fabricated rows)", /Belum ada kode promo terpakai bulan ini/.test(m0)]);
  // r3 (review 3ba1bf52 F5; 19 :40): source (K13) with the stated window, and response (K14). r4 (re-review 3dcdb005 #3): populated with
  // mixed effective SLAs (seed: SET-20 15 → 30 two hours ago) — the SLA count is labelled by the thresholds in effect at entry, never
  // today's 30; the fixed 15-minute count stays. K14's empty state is asserted by the render test in tests/reporting/dashboards.test.ts.
  const src = await mk.p.getByRole("list", { name: "Sumber lead" }).innerText();
  flow.push(["marketing: Sumber lead (K13) for the stated window — Instagram 3 lead, Iklan 2 lead",
    /Sumber lead \(K13\)/.test(m0) && /Instagram[\s\S]*3 lead · 0 buat janji · 0 datang · 0 bayar/.test(src) && /Iklan[\s\S]*2 lead · 0 buat janji/.test(src)
      && /lead dibuat pada periode ini/.test(m0)]);
  flow.push(["marketing: Respons lead (K14) — SLA count labelled by the SLA in effect at entry (SLA 15: 0 of 1 · SLA 30: 3 of 4), no '≤ 30 menit' label; ≤ 15 menit 2 of 5",
    /Respons lead \(K14\)/.test(m0) && /Dijawab sesuai SLA saat lead masuk\s*3\s*SLA 15 menit: 0 dari 1 · SLA 30 menit: 3 dari 4/.test(m0)
      && !/≤ 30 menit/.test(m0) && /Dijawab ≤ 15 menit\s*2\s*dari 5 lead/.test(m0)]);
  await layouts(mk.p, "/ringkasan/peran", "marketing");
  await mk.c.close();

  // Apotek (pharmacist)
  const ph = await open("ph");
  const a0 = await main(ph.p);
  flow.push(["pharmacist: Ringkasan Apotek with Siapkan 1, Hampir kedaluwarsa 1, Karantina 1, Penerimaan hari ini 1; links to /apotek/siapkan and /pembelian/po",
    (await h1(ph.p)) === "Ringkasan Apotek" && /Siapkan\s*1/.test(a0) && /Hampir kedaluwarsa\s*1/.test(a0) && /Karantina\s*1/.test(a0) && /Penerimaan hari ini\s*1/.test(a0)
      && (await linkTo(ph.p, "/apotek/siapkan")) === 1 && (await linkTo(ph.p, "/pembelian/po")) === 1 && !leaked(await ph.p.content())]);
  await layouts(ph.p, "/ringkasan/peran", "apotek");
  await ph.c.close();

  // Pembelian (purchasing)
  const pu = await open("pu");
  const p0 = await main(pu.p);
  flow.push(["purchasing: Ringkasan Pembelian with Di bawah minimum 1, PO terbuka 1, Utang jatuh tempo Rp1.250.000 (1 faktur); links to /stok, /pembelian/po, /pembelian/utang",
    (await h1(pu.p)) === "Ringkasan Pembelian" && /Di bawah minimum\s*1/.test(p0) && /PO terbuka\s*1/.test(p0) && /Rp1\.250\.000/.test(p0) && /1 faktur/.test(p0)
      && (await linkTo(pu.p, "/stok")) === 1 && (await linkTo(pu.p, "/pembelian/utang")) === 1 && !leaked(await pu.p.content())]);
  await layouts(pu.p, "/ringkasan/peran", "pembelian");
  await pu.c.close();

  // Audit (auditor)
  const au = await open("au");
  const d0 = await main(au.p);
  flow.push(["auditor: Ringkasan Audit with Diskon manual Rp15.000 (1 baris), Void 1, Hapus buku Rp0; no sentinel",
    (await h1(au.p)) === "Ringkasan Audit" && /Diskon manual\s*Rp15\.000/.test(d0) && /1 baris tagihan/.test(d0) && /Void\s*1/.test(d0) && /Hapus buku\s*Rp0/.test(d0)
      && !leaked(await au.p.content())]);
  await layouts(au.p, "/ringkasan/peran", "audit");
  await au.c.close();

  // Ruang Saya (nurse)
  const nur = await open("nur");
  const r0 = await main(nur.p);
  flow.push(["nurse: Ruang Saya — Ruang Tindakan 1 groups both visits (Siti Rahma, Dewi Lestari), each linking to /ruang/<visit>",
    (await h1(nur.p)) === "Ruang Saya" && /Ruang Tindakan 1/.test(r0) && r0.includes(seed.patients.treated) && r0.includes(seed.patients.waiting)
      && (await nur.p.locator("main a[href^='/ruang/']").count()) === 2]);
  flow.push(["nurse: the next arriving patient (Ani Wijaya) links to the Jadwal day", r0.includes(seed.patients.next) && (await nur.p.locator("main a[href^='/jadwal?cabang=']").count()) === 1]);
  flow.push(["nurse: own commission this month Rp75.000 (the performer rule on the counted treatment) with its basis, never 'belum tersedia'",
    /Komisi saya bulan ini[\s\S]*Rp75\.000/.test(r0) && !/belum tersedia/.test(r0) && !leaked(await nur.p.content())]);
  await layouts(nur.p, "/ringkasan/peran", "ruang-saya");
  await nur.c.close();

  // Ruang Saya (therapist): zero is a real answer, not unavailable
  const thr = await open("thr");
  const t0 = await main(thr.p);
  flow.push(["therapist: Ruang Saya with own commission Rp0 (an answer of zero, not 'belum tersedia')",
    (await h1(thr.p)) === "Ruang Saya" && /Komisi saya bulan ini[\s\S]*Rp0/.test(t0) && !/belum tersedia/.test(t0) && !leaked(await thr.p.content())]);
  await thr.c.close();

  // Manager: no UX-60 home → the permission state (NAV-1)
  const mgr = await open("mgr");
  const g0 = await main(mgr.p);
  flow.push(["manager: no UX-60 home → title and 'Anda tidak memiliki akses ke ringkasan ini.' only", /Anda tidak memiliki akses ke ringkasan ini/.test(g0) && (await mgr.p.locator("main a").count()) === 0]);
  await layouts(mgr.p, "/ringkasan/peran", "tanpa-akses");
  await mgr.c.close();
  // every link a home renders resolves (no 404 among them)
  const homeLinks = ["/keluhan", "/keluhan/insiden", "/satusehat", "/persetujuan", "/staf", "/lead", "/apotek/siapkan", "/apotek/serahkan", "/stok", "/pembelian/po", "/pembelian/utang"];
  flow.push(["no home link is a 404 (the 404s are shell prefetches only)", homeLinks.every((l) => !notFound.has(l)) && ![...notFound].some((u) => u.startsWith("/ruang/") || u.startsWith("/jadwal") || u === "/ringkasan/peran")]);
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  report.notFound = [...notFound].sort();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
