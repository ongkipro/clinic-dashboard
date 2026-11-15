// T-087 browser evidence (Komisi, UX-16, PR-23) at 390/820/1180/1440 and 200 % text: finance sees the month batches by state (a paid
// batch of four recipients, Rp210.000; a batch waiting for the owner) and the per-recipient lines with contribution types; the CSV export
// carries staff and amounts only; the owner approves the batch in Persetujuan (finance cannot) and finance marks it paid; the owner puts a
// draft rule version in force; finance prepares a rule (validation first) and runs the simulator (read-only); the manager reads the rules
// without forms and has no Rekap; a BC sees only their own commission in Komisi Saya (no patient names); the auditor reads without forms;
// admin pusat has no access. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/komisi.spec.ts out-dir
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
  password: string; people: Record<string, { email: string; staffId: string }>; batches: { paid: string; waiting: string };
  approvals: { waiting: string }; periods: { paid: string; waiting: string };
};
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = { layout: {}, flow: [], console: [] };
const flow = report.flow as [string, unknown][];
const monthName = (k: string) => new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));
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
  selectOption(v: string | object): Promise<unknown>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
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
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip }, acceptDownloads: true });
  const main = (p: Page) => p.locator("main:visible").innerText();
  const open = async (who: string, ip: string, totpRole = false) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const B = (id: string) => `/komisi/batch/${id}`;
  const paidName = monthName(seed.periods.paid);
  const waitName = monthName(seed.periods.waiting);

  // Finance: Rekap by state; the paid batch's recipients; the export; the waiting batch.
  const fin = await open("fin", "203.0.113.241", true);
  await fin.p.goto(`${BASE}/komisi`);
  await fin.p.getByRole("list", { name: "Batch komisi" }).waitFor();
  const r0 = await main(fin.p);
  flow.push(["finance sees the month batches by state: the paid one (Rp210.000) and the one waiting for the owner",
    r0.includes(`${paidName} · Rp210.000`) && r0.includes(`${waitName} · Rp210.000`) && /Dibayar/.test(r0) && /Menunggu persetujuan/.test(r0) && /4 penerima/.test(r0)]);
  await layouts(fin.p, "/komisi", "rekap");
  await fin.p.goto(`${BASE}/komisi?status=draft`);
  await fin.p.getByText("Tidak ada batch dengan status ini.").waitFor();
  flow.push(["the state filter: no draft batch → filtered-empty with Hapus Filter", (await fin.p.getByRole("link", { name: "Hapus Filter" }).count()) === 1]);
  await fin.p.goto(`${BASE}${B(seed.batches.paid)}`);
  await fin.p.getByRole("heading", { name: "Penerima" }).waitFor();
  const d0 = await main(fin.p);
  flow.push(["the paid batch: per-recipient lines with the contribution type (Ayu 100.000 closing, Rani 40.000 pendamping, Rina 20.000, dr. Sekar 50.000)",
    /Ayu BC[\s\S]*Rp100\.000[\s\S]*BC closing/.test(d0) && /Rani BC[\s\S]*Rp40\.000[\s\S]*BC pendamping/.test(d0) && /Rina Kasir[\s\S]*Rp20\.000[\s\S]*Pasien baru/.test(d0)
      && /dr\. Sekar[\s\S]*Rp50\.000[\s\S]*Pelaksana/.test(d0) && /Dibayar .* Transfer/.test(d0) && !/Pasien Sintetis/.test(d0)]);
  await layouts(fin.p, B(seed.batches.paid), "batch-paid");
  const csv = await fin.p.evaluate(async (u: string) => { const r = await fetch(u); return `${r.status}|${r.headers.get("content-type")}|${await r.text()}`; }, `${B(seed.batches.paid)}/ekspor`);
  flow.push(["Ekspor per penerima: a CSV of staff and amounts only (no patient data)",
    csv.startsWith("200|text/csv") && csv.includes("Penerima,Kotor,Penyesuaian,Bawaan Masuk,Dibayar,Bawaan Keluar") && csv.includes("Ayu BC,100000,0,0,100000,0") && !/Pasien/.test(csv)]);
  await fin.p.goto(`${BASE}${B(seed.batches.waiting)}`);
  await fin.p.getByRole("heading", { name: "Tindakan" }).waitFor();
  flow.push(["the waiting batch for finance: Menunggu persetujuan Owner, no Tandai Dibayar", /Menunggu persetujuan Owner/.test(await main(fin.p))
    && (await fin.p.getByRole("form", { name: "Tandai dibayar" }).count()) === 0]);
  await layouts(fin.p, B(seed.batches.waiting), "batch-waiting");
  // finance cannot approve its own submission in Persetujuan
  await fin.p.goto(`${BASE}/persetujuan/${seed.approvals.waiting}`);
  await fin.p.getByText("Anda tidak memiliki akses ke persetujuan.").waitFor();
  flow.push(["finance (the requester) cannot approve the batch in Persetujuan", (await fin.p.getByRole("button", { name: "Setujui" }).count()) === 0]);

  // Owner: approves the batch; puts the draft version in force.
  const own = await open("own", "203.0.113.242", true);
  await own.p.goto(`${BASE}/persetujuan/${seed.approvals.waiting}`);
  await own.p.getByRole("heading", { level: 1 }).waitFor();
  await own.p.getByRole("button", { name: "Setujui" }).first().click();
  await own.p.waitForTimeout(1500);
  await own.p.goto(`${BASE}${B(seed.batches.waiting)}`);
  await own.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the owner approves in Persetujuan: the batch is Disetujui", /Disetujui/.test(await main(own.p))]);
  await own.p.goto(`${BASE}/komisi/aturan`);
  await own.p.getByRole("list", { name: "Aturan komisi" }).waitFor();
  const a0 = await main(own.p);
  await layouts(own.p, "/komisi/aturan", "aturan");
  await own.p.getByRole("form", { name: "Putuskan draf Closing BC standar versi 2" }).getByRole("button", { name: "Berlakukan" }).click();
  await own.p.getByText("Versi diberlakukan.", { exact: false }).first().waitFor();
  const a1 = await main(own.p);
  // version 2 starts next month: today version 1 (5 %) is still in force; version 2 is scheduled
  flow.push(["the owner sees 1 draft waiting and puts it in force from next month: 5 % in force until then, Versi 2 (6 %) Terjadwal", /1 draf menunggu Anda berlakukan/.test(a0)
    && /Closing BC standar · BC closing\s*5%/.test(a1) && /Versi 2 · 6% [\s\S]*Terjadwal/.test(a1) && /Versi 1 · 5% [\s\S]*Berlaku[\s\S]*berlaku sampai/.test(a1)]);
  await own.c.close();

  // Finance: marks the batch paid; prepares a rule (validation first); the simulator.
  await fin.p.goto(`${BASE}${B(seed.batches.waiting)}`);
  await fin.p.getByRole("form", { name: "Tandai dibayar" }).getByRole("button", { name: "Tandai Dibayar Rp210.000" }).click();
  await fin.p.getByText("Batch ditandai dibayar.").first().waitFor();
  flow.push(["finance marks the approved batch paid (Rp210.000): Dibayar", /Dibayar .* Transfer/.test(await main(fin.p))]);
  await fin.p.goto(`${BASE}/komisi/aturan`);
  await fin.p.getByRole("button", { name: "Siapkan Aturan" }).click();
  const cf = fin.p.getByRole("form", { name: "Siapkan aturan komisi" });
  await cf.getByLabel("Nama aturan").fill("Closing khusus Ayu");
  await cf.getByLabel("Khusus staf (opsional)").selectOption({ label: "Ayu BC" });
  await cf.getByLabel("Persen", { exact: true }).fill("0,001");
  await cf.getByRole("button", { name: "Simpan Draf" }).click();
  await fin.p.getByRole("alert").filter({ hasText: "Isi persen 0,01–100" }).first().waitFor();
  const cf2 = fin.p.getByRole("form", { name: "Siapkan aturan komisi" });
  await cf2.getByLabel("Persen", { exact: true }).fill("7,5");
  await cf2.getByRole("button", { name: "Simpan Draf" }).click();
  await fin.p.getByRole("status").filter({ hasText: "Draf aturan disimpan" }).first().waitFor();
  await fin.p.reload();
  await fin.p.getByRole("list", { name: "Aturan komisi" }).waitFor();
  const a2 = await main(fin.p);
  flow.push(["finance prepares a rule (a bad percent refused first): Closing khusus Ayu 7,5 % as a draft waiting for the owner",
    /Closing khusus Ayu · BC closing/.test(a2) && /Khusus Ayu BC/.test(a2) && /Versi 1 · 7,5% [\s\S]*Draf/.test(a2) && /Menunggu Owner memberlakukan/.test(a2)]);
  await fin.p.getByRole("button", { name: "Simulasi" }).click();
  const sf = fin.p.getByRole("form", { name: "Simulasi komisi" });
  await sf.getByLabel("Harga (Rp)").fill("2.000.000");
  await sf.getByLabel("BC closing", { exact: true }).selectOption({ label: "Ayu BC" });
  await sf.getByLabel("Pelaksana", { exact: true }).selectOption({ label: "dr. Sekar" });
  await sf.getByRole("button", { name: "Hitung" }).click();
  await fin.p.getByText("Dasar tanpa PPN Rp2.000.000").waitFor();
  const s0 = await main(fin.p);
  flow.push(["the simulator (nothing saved): Rp2.000.000 → BC closing Rp100.000 (5 % today), Pelaksana Rp50.000", /BC closing: Rp100\.000/.test(s0) && /Pelaksana: Rp50\.000/.test(s0)]);
  await fin.c.close();

  // Manager: the rules read-only; no Rekap.
  const mgr = await open("mgr", "203.0.113.243", true);
  await mgr.p.goto(`${BASE}/komisi/aturan`);
  await mgr.p.getByRole("list", { name: "Aturan komisi" }).waitFor();
  flow.push(["the manager reads the rules without forms (Mode baca)", /Mode baca/.test(await main(mgr.p)) && (await mgr.p.getByRole("button", { name: "Siapkan Aturan" }).count()) === 0
    && (await mgr.p.getByRole("button", { name: "Berlakukan" }).count()) === 0]);
  await mgr.p.goto(`${BASE}/komisi`);
  await mgr.p.getByText("Anda tidak memiliki akses ke rekap komisi.").waitFor();
  flow.push(["the manager has no Rekap Komisi & Batch", true]);
  await mgr.c.close();

  // BC Ayu: Komisi Saya — her own rows only, no patient names.
  const bc = await open("bc", "203.0.113.244");
  await bc.p.goto(`${BASE}/saya/komisi`);
  await bc.p.getByText(/Belum ada komisi di/).waitFor();
  await layouts(bc.p, "/saya/komisi", "saya-empty");
  await bc.p.goto(`${BASE}/saya/komisi?bulan=${seed.periods.waiting}`);
  await bc.p.getByRole("list", { name: "Rincian komisi" }).waitFor();
  const m0 = await main(bc.p);
  flow.push(["Komisi Saya: Ayu's own closing commission Rp100.000 of the month and her paid batches; nobody else's rows; no patient names",
    /BC closing · Facial Brightening/.test(m0) && /Rp100\.000/.test(m0) && !/BC pendamping|Pelaksana|Pasien baru ·/.test(m0) && !/Pasien Sintetis|Rani BC|dr\. Sekar/.test(m0)
      && m0.includes(`${paidName} · Rp100.000`)]);
  await layouts(bc.p, `/saya/komisi?bulan=${seed.periods.waiting}`, "saya");
  await bc.p.goto(`${BASE}/komisi`);
  await bc.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["a BC has no Rekap Komisi & Batch", /Anda tidak memiliki akses ke rekap komisi/.test(await main(bc.p))]);
  await bc.c.close();

  // Auditor: reads without forms; admin pusat: no access.
  const au = await open("au", "203.0.113.245", true);
  await au.p.goto(`${BASE}${B(seed.batches.paid)}`);
  await au.p.getByRole("heading", { name: "Penerima" }).waitFor();
  flow.push(["the auditor reads the batch without forms (Mode baca)", /Mode baca/.test(await main(au.p)) && (await au.p.getByRole("form").count()) === 0]);
  await au.p.goto(`${BASE}/komisi`);
  await au.p.getByRole("list", { name: "Batch komisi" }).waitFor();
  flow.push(["the auditor's Rekap has no Buka Batch", (await au.p.getByRole("button", { name: "Buka Batch" }).count()) === 0]);
  await au.c.close();
  const ap = await open("ap", "203.0.113.246", true);
  await ap.p.goto(`${BASE}/komisi`);
  await ap.p.getByText("Anda tidak memiliki akses ke rekap komisi.").waitFor();
  await layouts(ap.p, "/komisi", "rekap-blocked-role");
  await ap.p.goto(`${BASE}/saya/komisi`);
  await ap.p.getByText("Anda tidak memiliki akses ke komisi.").waitFor();
  flow.push(["admin pusat has no access to Rekap or Komisi Saya", true]);
  await ap.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
