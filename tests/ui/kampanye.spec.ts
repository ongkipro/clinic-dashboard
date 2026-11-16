// T-100 browser evidence (Kampanye & Segmen, UX-19, PR-94) at 390/820/1180/1440 and 200 % text. The Q-15 counsel evidence is not approved:
// Scenario PR-94 — marketing sees "Pengiriman kampanye terkunci sampai bukti hukum disetujui" with "Minta Owner …" and no Kepatuhan link
// (blocked), Kirim disabled; keyboard: Tab to Jadwalkan, Enter submits, the disabled Kirim is skipped; the segment stays editable (success: saved, the consented count shown — 2 of the 3 Kemang women; no names);
// marketing schedules the draft campaign (success, ?ok notice); a segment without criteria is refused (error); the owner sees the missing
// evidence and the Kepatuhan link and the send notice's three outcomes; Admin Pusat cancels a campaign; the auditor reads without forms; the FO has no access.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/kampanye.spec.ts out-dir
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
  password: string; people: Record<string, { email: string; staffId: string }>; segment: string; campaigns: { scheduled: string; draft: string }; day: string;
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
  selectOption(v: string | object): Promise<unknown>; focus(): Promise<void>; getAttribute(n: string): Promise<string | null>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; inputValue(): Promise<string>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; evaluate<T, A>(f: (a: A) => T, a: A): Promise<T>; url(): string; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  addStyleTag(o: { content: string }): Promise<unknown>; keyboard: { press(k: string): Promise<void> }; reload(): Promise<unknown>; on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
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
  const segs = (p: Page) => p.getByRole("list", { name: "Daftar segmen" });
  const camps = (p: Page) => p.getByRole("list", { name: "Daftar kampanye" });
  const LOCK = "Pengiriman kampanye terkunci sampai bukti hukum disetujui";

  // Marketing: Scenario PR-94 (blocked, no Kepatuhan link, Kirim disabled), the segment count (consented only, no names), editing a segment.
  const mk = await open("mk", "203.0.113.241");
  await mk.p.goto(`${BASE}/kampanye`);
  await segs(mk.p).waitFor();
  const m0 = await main(mk.p);
  flow.push(["Scenario PR-94: the blocked banner with the copy; marketing is told to ask the Owner; no Kepatuhan link",
    m0.includes(LOCK) && /Minta Owner menyetujui bukti di menu Kepatuhan/.test(m0) && (await mk.p.getByRole("link", { name: "Buka Kepatuhan" }).count()) === 0]);
  const send = camps(mk.p).getByRole("button", { name: "Kirim" });
  flow.push(["Kirim is disabled while locked and points to the banner", (await send.count()) === 1 && (await send.getAttribute("disabled")) !== null
    && (await send.getAttribute("aria-describedby")) === "terkunci"]);
  const s0 = await segs(mk.p).innerText();
  flow.push(["the segment shows the consented count (2: Sari, Maya — not Lina without consent, not Budi) and its rules, never a patient name",
    /Perempuan Kemang[\s\S]*2 pasien/.test(s0) && /terdaftar di Cabang Kemang · perempuan/.test(s0) && !/Sari|Maya|Lina|Budi/.test(m0)]);
  await layouts(mk.p, "/kampanye", "marketing");
  // the segment remains editable while sending is locked: widen it to every branch (still 2 consented women)
  await mk.p.getByText("Ubah segmen").first().click();
  const edit = mk.p.getByRole("form", { name: "Ubah segmen Perempuan Kemang" });
  await edit.getByLabel("Nama segmen").fill("Perempuan Semua Cabang");
  await edit.getByLabel("Cabang terdaftar").selectOption("");
  await edit.getByRole("button", { name: "Simpan Segmen" }).click();
  // the form's name follows the segment name, so after the rename the notice is found on the page (browser run 1 diagnosis)
  await mk.p.getByText("Segmen disimpan.").first().waitFor();
  await mk.p.reload();
  await segs(mk.p).waitFor();
  flow.push(["success: the segment is edited while sending is locked (renamed, every branch)", /Perempuan Semua Cabang[\s\S]*2 pasien/.test(await segs(mk.p).innerText())]);
  // error: a new segment without any criterion is refused
  const fresh = mk.p.getByRole("form", { name: "Segmen baru" });
  await mk.p.getByText("Segmen baru").first().click();
  await fresh.getByLabel("Nama segmen").fill("Tanpa Kriteria");
  await fresh.getByRole("button", { name: "Simpan Segmen" }).click();
  await fresh.getByRole("alert").filter({ hasText: "Pilih minimal satu kriteria segmen." }).waitFor();
  flow.push(["error: a segment without criteria is refused; nothing saved", !/Tanpa Kriteria/.test(await segs(mk.p).innerText())]);
  // marketing schedules the draft campaign to the segment
  const draftItem = camps(mk.p).locator("li").filter({ hasText: "Sapaan Pelanggan Lama" });
  const sch = draftItem.getByRole("form", { name: "Jadwalkan kampanye" });
  await sch.getByLabel("Segmen").selectOption({ label: "Perempuan Semua Cabang" });
  await sch.getByLabel("Templat promosi").selectOption({ label: "promo_kampanye" });
  await sch.getByLabel("Tanggal kirim").fill(seed.day);
  await sch.getByRole("button", { name: "Jadwalkan" }).click();
  await mk.p.waitForURL(/\/kampanye\?ok=dijadwalkan/);
  await mk.p.getByText("Kampanye dijadwalkan.").first().waitFor();
  flow.push(["success: the draft campaign is scheduled (?ok notice, state Terjadwal)", /Sapaan Pelanggan Lama\s*Terjadwal/.test(await camps(mk.p).innerText())]);
  await mk.p.goto(`${BASE}/kampanye`);
  await camps(mk.p).waitFor();
  const kbItem = camps(mk.p).locator("li").filter({ hasText: "Sapaan Pelanggan Lama" });
  await kbItem.getByLabel("Tanggal kirim").focus();
  const kbFocus = () => mk.p.evaluate(() => (document.activeElement?.textContent ?? "").trim() || document.activeElement?.getAttribute("name") || "");
  // the native date input is three keyboard segments (month / day / year), each a Tab stop (diagnostic trace, failure-probe3): Tab until
  // Jadwalkan, bounded
  let presses = 0;
  while ((await kbFocus()) !== "Jadwalkan" && presses < 6) { await mk.p.keyboard.press("Tab"); presses++; }
  const reachedSchedule = (await kbFocus()) === "Jadwalkan";
  await mk.p.keyboard.press("Enter");
  await mk.p.waitForURL(/\/kampanye\?ok=dijadwalkan/);
  await mk.p.getByText("Kampanye dijadwalkan.").first().waitFor();
  // Kirim is disabled while locked: Tab from the scheduled campaign's Jadwalkan skips it (lands on Kembalikan ke Draf)
  const promoItem = camps(mk.p).locator("li").filter({ hasText: "Sapaan Pelanggan Lama" });
  await promoItem.getByRole("button", { name: "Jadwalkan" }).focus();
  await mk.p.keyboard.press("Tab");
  flow.push(["keyboard: Tab reaches Jadwalkan from the date field and Enter submits (success notice); the disabled Kirim is skipped by Tab",
    reachedSchedule && (await kbFocus()) === "Kembalikan ke Draf"]);
  await mk.c.close();

  // Owner: the missing evidence and the Kepatuhan link (who can unblock).
  const own = await open("own", "203.0.113.242", true);
  await own.p.goto(`${BASE}/kampanye`);
  await camps(own.p).waitFor();
  const o0 = await main(own.p);
  flow.push(["the owner sees the missing evidence and the Kepatuhan link", o0.includes(LOCK) && /Bukti yang ditunggu: Pendapat hukum situs klinik/.test(o0)
    && (await own.p.getByRole("link", { name: "Buka Kepatuhan" }).getAttribute("href")) === "/kepatuhan"]);
  await layouts(own.p, "/kampanye", "owner");
  // the send notice (Sol 75a1a20a P2) as the page renders it from the redirect's counts: none queued, partial, and a tampered query
  const notice = async (qs: string) => {
    await own.p.goto(`${BASE}/kampanye?${qs}`);
    await camps(own.p).waitFor();
    return (await own.p.getByRole("status").filter({ hasText: /antrean|diproses/ }).first().innerText()).trim();
  };
  const n0 = await notice("ok=terkirim&q=0&x=1");
  const n1 = await notice("ok=terkirim&q=3&x=2");
  const n2 = await notice("ok=terkirim&q=%3Cb%3E&x=1");
  flow.push(["the send notice is truthful and count-only: none queued, partial exclusion, a tampered query shows the neutral notice",
    n0 === "Tidak ada pesan yang masuk antrean: 1 pasien dikecualikan saat pengiriman." && n1 === "3 pesan masuk antrean pengiriman; 2 pasien dikecualikan saat pengiriman."
      && n2 === "Kampanye diproses. Lihat jumlah antrean di daftar kampanye." && !(await main(own.p)).includes("<b>")]);
  await own.c.close();

  // Admin Pusat: cancels a scheduled campaign (success; it leaves the actionable states).
  const ap = await open("ap", "203.0.113.243", true);
  await ap.p.goto(`${BASE}/kampanye`);
  const promo = camps(ap.p).locator("li").filter({ hasText: "Promo Akhir Tahun" });
  await promo.getByRole("button", { name: "Batalkan" }).click();
  await ap.p.waitForURL(/\/kampanye\?ok=dibatalkan/);
  await ap.p.getByText("Kampanye dibatalkan.").first().waitFor();
  flow.push(["Admin Pusat cancels a scheduled campaign: Dibatalkan, no forms on it", /Promo Akhir Tahun\s*Dibatalkan/.test(await camps(ap.p).innerText())
    && (await camps(ap.p).locator("li").filter({ hasText: "Promo Akhir Tahun" }).getByRole("form").count()) === 0]);
  await layouts(ap.p, "/kampanye", "admin-pusat");
  await ap.c.close();

  // Auditor: reads without forms; the FO: no access.
  const au = await open("au", "203.0.113.244", true);
  await au.p.goto(`${BASE}/kampanye`);
  await segs(au.p).waitFor();
  const a0 = await main(au.p);
  flow.push(["the auditor reads segments and campaigns with no forms; the blocked banner does not tell it to prepare anything",
    (await au.p.getByRole("form").count()) === 0 && /Perempuan Semua Cabang/.test(a0) && /Minta Owner/.test(a0) && !/tetap bisa disiapkan/.test(a0)]);
  await layouts(au.p, "/kampanye", "auditor");
  await au.c.close();
  const fo = await open("fo", "203.0.113.245");
  await fo.p.goto(`${BASE}/kampanye`);
  await fo.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the FO has no access: the title and the message only", /Anda tidak memiliki akses ke kampanye/.test(await main(fo.p)) && (await fo.p.getByRole("form").count()) === 0]);
  await layouts(fo.p, "/kampanye", "tanpa-akses");
  await fo.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
