// T-097 browser evidence (Otomasi, Pengingat & Aftercare, UX-55, PR-94) at 390/820/1180/1440 and 200 % text: the owner sees the four
// sections — the SET-19 scenarios, Kemang's and Bintaro's reminder rules, each service's aftercare state (Facial Glow active, Peeling Ringan
// waiting for clinical review) and the delivery log written by the real scan: Sari's third message of the day moved to tomorrow, shown as
// "Batas pesan per pasien tercapai" (Scenario PR-94), Tono skipped for a missing phone; the log filters (capped; an empty scenario:
// filtered-empty with Hapus Filter); marketing proposes a SET-19 change (blocked: one pending, its own Tarik Usulan) and reads the log
// masked; Admin Pusat's Tolak without a reason is refused (error), then Setujui applies it; Admin Pusat saves Kemang's H-1 time; the
// Kemang facility head reads without forms; the Bintaro manager sees none of Kemang's log; the FO has no access.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/otomasi.spec.ts out-dir
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
  services: { facial: string; peel: string };
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
  selectOption(v: string | object): Promise<unknown>; getAttribute(n: string): Promise<string | null>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; inputValue(): Promise<string>;
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
  const scen = (p: Page) => p.getByRole("form", { name: "Skenario otomasi" });
  const logList = (p: Page) => p.getByRole("list", { name: "Pengiriman" });

  // Owner: the four sections, the aftercare states, the log (Scenario PR-94), the filters.
  const own = await open("own", "203.0.113.251", true);
  await own.p.goto(`${BASE}/otomasi`);
  await logList(own.p).waitFor();
  const o0 = await main(own.p);
  flow.push(["the owner sees the four sections: scenarios, branch reminder rules, aftercare texts, the delivery log",
    /Skenario Otomasi/.test(o0) && /Aturan Pengingat Cabang/.test(o0) && /Teks Aftercare Layanan/.test(o0) && /Log Pengiriman/.test(o0)
      && /Cabang Kemang/.test(o0) && /Cabang Bintaro/.test(o0)]);
  flow.push(["SET-19 defaults: kepuasan H+7, a daily cap of 2, the birthday greeting off",
    (await scen(own.p).locator("input[name=kepuasan]").inputValue()) === "7" && (await scen(own.p).locator("input[name=batas_harian]").inputValue()) === "2"
      && !(await own.p.evaluate(() => (document.querySelector("input[name=ulang_tahun]") as HTMLInputElement).checked))]);
  const ac = own.p.getByRole("list", { name: "Layanan" });
  flow.push(["aftercare: Facial Glow active, Peeling Ringan waiting for clinical review; each links to its service",
    /Facial Glow\s*Teks aftercare aktif/.test(await ac.innerText()) && /Peeling Ringan\s*Teks aftercare belum direview klinis/.test(await ac.innerText())
      && (await ac.getByRole("link", { name: "Facial Glow" }).getAttribute("href")) === `/layanan/${seed.services.facial}`]);
  const lg = await logList(own.p).innerText();
  flow.push(["Scenario PR-94: Sari's third message of the day moves to tomorrow, shown as Batas pesan per pasien tercapai; Tono skipped (no phone)",
    /Tindak lanjut kepuasan · Sari Pasien Sintetis[\s\S]*Antre[\s\S]*→[\s\S]*Batas pesan per pasien tercapai/.test(lg)
      && /Tindak lanjut kepuasan · Tono Pasien Sintetis[\s\S]*Dilewati[\s\S]*Nomor telepon pasien belum ada/.test(lg)]);
  await layouts(own.p, "/otomasi", "owner");
  await own.p.goto(`${BASE}/otomasi?status=capped`);
  await logList(own.p).waitFor();
  const c0 = await logList(own.p).innerText();
  flow.push(["the Batas tercapai filter shows Sari only", /Sari Pasien Sintetis/.test(c0) && !/Tono/.test(c0)
    && (await own.p.getByRole("navigation", { name: "Saring status" }).getByRole("link", { name: "Batas tercapai" }).getAttribute("aria-current")) === "page"]);
  await own.p.goto(`${BASE}/otomasi?skenario=isi_ulang`);
  await own.p.getByText("Tidak ada pengiriman untuk saringan ini.").first().waitFor();
  flow.push(["an empty scenario filter: filtered-empty with Hapus Filter; the filter bars stay", (await own.p.getByRole("link", { name: "Hapus Filter" }).count()) === 1
    && (await own.p.getByRole("navigation", { name: "Saring skenario" }).count()) === 1]);
  await layouts(own.p, "/otomasi?skenario=isi_ulang", "filter-kosong");
  await own.c.close();

  // Marketing: proposes a SET-19 change (one pending: the form becomes read-only, Tarik Usulan is its own); the log is masked.
  const mk = await open("mk", "203.0.113.252");
  await mk.p.goto(`${BASE}/otomasi`);
  await scen(mk.p).waitFor();
  const m0 = await main(mk.p);
  flow.push(["marketing reads the log masked (no marketing consent) and cannot change the reminder rules",
    /Kontak tersembunyi/.test(m0) && !/Sari Pasien|Tono Pasien/.test(m0) && (await mk.p.getByRole("button", { name: "Simpan" }).count()) === 0
      && (await scen(mk.p).getByRole("button", { name: "Ajukan" }).count()) === 1]);
  await scen(mk.p).locator("input[name=batas_harian]").fill("3");
  await scen(mk.p).getByLabel("Alasan usulan").fill("Naikkan batas harian untuk promo akhir tahun");
  await scen(mk.p).getByRole("button", { name: "Ajukan" }).click();
  await mk.p.getByText("menunggu keputusan Admin Pusat").first().waitFor();
  await mk.p.reload();
  await mk.p.getByText("menunggu keputusan Admin Pusat").first().waitFor();
  const m1 = await main(mk.p);
  flow.push(["blocked: one pending proposal — the banner, Tarik Usulan for its proposer, the scenario form read-only",
    /Usulan dari Dewi Marketing menunggu keputusan Admin Pusat/.test(m1) && /Naikkan batas harian/.test(m1)
      && (await mk.p.getByRole("button", { name: "Tarik Usulan" }).count()) === 1 && (await mk.p.getByRole("button", { name: "Ajukan" }).count()) === 0]);
  await layouts(mk.p, "/otomasi", "usulan");
  await mk.c.close();

  // Admin Pusat: Tolak without a reason is refused (error), Setujui applies the value; saves Kemang's H-1 time (success).
  const ap = await open("ap", "203.0.113.253", true);
  await ap.p.goto(`${BASE}/otomasi`);
  const dec = ap.p.getByRole("form", { name: "Keputusan usulan" });
  await dec.waitFor();
  await dec.getByRole("button", { name: "Tolak" }).click();
  await dec.getByRole("alert").filter({ hasText: "Tulis alasan penolakan" }).waitFor();
  flow.push(["error: Tolak without a reason is refused; the proposal stays", (await ap.p.getByText("menunggu keputusan Admin Pusat").count()) >= 1]);
  await dec.getByRole("button", { name: "Setujui" }).click();
  await ap.p.getByText("Usulan disetujui.").first().waitFor();
  await ap.p.reload();
  await scen(ap.p).waitFor();
  flow.push(["Setujui applies the proposal through the settings writer: the daily cap is now 3; no pending banner",
    (await scen(ap.p).locator("input[name=batas_harian]").inputValue()) === "3" && (await ap.p.getByText("menunggu keputusan Admin Pusat").count()) === 0]);
  const km = ap.p.getByRole("form", { name: "Pengingat Cabang Kemang" });
  await km.locator("input[name=h1]").fill("09:30");
  await km.getByLabel("Alasan perubahan").fill("Pasien lebih responsif pagi hari");
  await km.getByRole("button", { name: "Simpan" }).click();
  await km.getByText("Aturan pengingat cabang disimpan.").waitFor();
  await ap.p.reload();
  await ap.p.getByRole("form", { name: "Pengingat Cabang Kemang" }).waitFor();
  flow.push(["success: Kemang's H-1 time saved (09:30); Bintaro keeps 10:00",
    (await ap.p.getByRole("form", { name: "Pengingat Cabang Kemang" }).locator("input[name=h1]").inputValue()) === "09:30"
      && (await ap.p.getByRole("form", { name: "Pengingat Cabang Bintaro" }).locator("input[name=h1]").inputValue()) === "10:00"]);
  await layouts(ap.p, "/otomasi", "admin-pusat");
  await ap.c.close();

  // Kemang facility head: reads, no write buttons; Bintaro manager: none of Kemang's log; the FO: no access.
  const fh = await open("fh", "203.0.113.254", true);
  await fh.p.goto(`${BASE}/otomasi`);
  await logList(fh.p).waitFor();
  const f0 = await main(fh.p);
  flow.push(["the Kemang facility head reads the page and Kemang's log, with no write buttons", /Sari Pasien Sintetis/.test(f0)
    && (await fh.p.getByRole("button", { name: /Simpan|Ajukan|Setujui|Kembalikan/ }).count()) === 0]);
  await layouts(fh.p, "/otomasi", "kepala-fasilitas");
  await fh.c.close();
  const mg = await open("mgr2", "203.0.113.249", true);
  await mg.p.goto(`${BASE}/otomasi`);
  await mg.p.getByRole("heading", { name: "Log Pengiriman" }).waitFor();
  const g0 = await main(mg.p);
  flow.push(["the Bintaro manager sees none of Kemang's log (empty state)", !/Sari|Tono/.test(g0) && /Belum ada pesan otomatis/.test(g0)]);
  await mg.c.close();
  const fo = await open("fo", "203.0.113.248");
  await fo.p.goto(`${BASE}/otomasi`);
  await fo.p.getByRole("heading", { level: 1 }).waitFor();
  const x0 = await main(fo.p);
  flow.push(["the FO has no access: the title and the message only", /Anda tidak memiliki akses ke otomasi/.test(x0) && (await fo.p.getByRole("form").count()) === 0]);
  await layouts(fo.p, "/otomasi", "tanpa-akses");
  await fo.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
