// T-103 browser evidence — Konsol Vendor › Tagihan Server (UX-43, 17 :82 / :271, 19 :266; IAM-10) on the vendor host at 390 / 820 / 1180 /
// 1440 and 200 % text. The list shows the owner-decision gates (Q-13 unconfirmed, Q-16 undecided at this phase, BILL-33 set by fixture), the
// billed clinic with its counts; the detail shows invoices (proration, outstanding), the unknown attempt (rc / state only — no provider text,
// no payment instruction), the review item and the note form. Vendor finance records a support reference (the attempt stays unknown), files
// a fee change by keyboard; the same person sees no Setujui; another platform owner approves (it is not applied: "menunggu diterapkan
// sistem"); finance files and then cancels a waiver; the auditor reads with no forms. No CSP violation, no console error, nothing secret.
// Runs on request: RUN_UI=1 VENDOR_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/vendor-tagihan.spec.ts out-dir
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
const VENDOR = process.env.VENDOR_URL!;
const OUT = process.argv[2];
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
  password: string; vendor: { po: string; po2: string; fin: string; aud: string }; tenantId: string; invoices: { id: string; number: string }[];
};
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = { layout: {}, flow: [], console: [], csp: [] };
const flow = report.flow as [string, unknown][];
const csp = report.csp as string[];
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
const watchCsp = `document.addEventListener("securitypolicyviolation", (e) => { (window.__csp ??= []).push(e.violatedDirective + " " + (e.blockedURI || "inline")); });`;
type Locator = {
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp): Locator;
  getByText(t: string | RegExp): Locator; waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; focus(): Promise<void>;
  innerText(): Promise<string>; count(): Promise<number>; selectOption(v: string | object): Promise<unknown>; getAttribute(n: string): Promise<string | null>;
};
type Page = Locator & {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; content(): Promise<string>;
  keyboard: { press(k: string): Promise<void>; type(t: string): Promise<void> }; on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  addInitScript(s: string): Promise<void>;
};
async function cspOf(page: Page, where: string) {
  const v = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  for (const x of v) csp.push(`${where}: ${x}`);
}
async function measure(page: Page, key: string, shot?: string) {
  (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main select, main textarea")].filter(vis);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest("[role=region]")).slice(0, 3)
        .map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}`),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, heading: string | RegExp, name: string) {
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${VENDOR}${path}`);
      await page.getByRole("heading", { name: heading }).first().waitFor();
      if (zoom === 2) await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      const shoot = (zoom === 1 && (w === 390 || w === 1440)) || (zoom === 2 && w === 390);
      await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
      await cspOf(page, `${name}-${w}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
const secrets = new Map<string, string>();
async function signIn(page: Page, email: string) {
  await page.goto(`${VENDOR}/vendor/masuk`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(/\/vendor\/(aktifkan-2fa|verifikasi)$/);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Lanjut" }).click();
  const secret = (await page.getByLabel("Kunci autentikator").innerText()).trim();
  secrets.set(email, secret);
  await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await page.waitForURL(`${VENDOR}/vendor/tenant`);
}
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("status of 401") && !m.text().includes("status of 403") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));
const leak = (html: string) => /finish_token|[0-9a-f]{64}|8779611150001393|virtual_account|"ket"|OperationOutcome/.test(html);
const browser = await chromium.launch();
let current: Page | null = null;
try {
  const open = async (email: string) => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": "203.0.113.10" } });
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await p.addInitScript(watchCsp);
    await signIn(p, email);
    return { c, p };
  };
  const detail = `/vendor/tagihan/${seed.tenantId}`;
  const [first] = seed.invoices;
  // vendor finance
  const fin = await open(seed.vendor.fin);
  await fin.p.goto(`${VENDOR}/vendor/tagihan`);
  await fin.p.getByRole("heading", { name: "Tagihan Server" }).waitFor();
  const l0 = await fin.p.locator("main").innerText();
  flow.push(["the list names the owner gates (Q-13 unconfirmed; BILL-33 treatment and vendor tax status set by fixture) and the billed clinic", /belum dikonfirmasi \(Q-13\)/.test(l0)
    && /Status pajak vendor sudah dikonfirmasi/.test(l0)
    && /PT Klinik Tagihan Sintetis/.test(l0) && !leak(await fin.p.content())]);
  await layouts(fin.p, "/vendor/tagihan", "Tagihan Server", "list");
  await fin.p.goto(`${VENDOR}${detail}`);
  await fin.p.getByRole("heading", { name: "PT Klinik Tagihan Sintetis" }).waitFor();
  const d0 = await fin.p.locator("main").innerText();
  flow.push(["the detail: invoices with proration and outstanding, the unknown attempt (state, no provider text / instruction), the review item",
    d0.includes(first.number) && /Prorata/.test(d0) && /Hasil belum pasti/.test(d0) && /Hasil pembuatan pembayaran belum pasti/.test(d0) && !leak(await fin.p.content())]);
  flow.push(["the reminders sent are listed (Pengingat terkirim) and the paid invoice reads Lunas", /Pengingat terkirim: /.test(d0) && /Lunas/.test(d0)]);
  await layouts(fin.p, detail, "PT Klinik Tagihan Sintetis", "detail");
  // Terbitkan Tagihan: everything due is already issued → the notice says so truthfully (no false "diterbitkan"); invoice count unchanged
  const before = await fin.p.locator("main").innerText();
  const count = (t: string) => (t.match(/VND-\d{6}-\d{4,}/g) ?? []).length;
  await fin.p.getByRole("button", { name: "Terbitkan Tagihan" }).click();
  await fin.p.getByText("Tidak ada tagihan yang jatuh waktu terbit.").first().waitFor();
  const afterIssue = await fin.p.locator("main").innerText();
  flow.push(["Terbitkan Tagihan with nothing due says so (no false issued); the invoice count is unchanged", !/tagihan diterbitkan/.test(afterIssue)
    && count(afterIssue) === count(before)]);
  const note = fin.p.getByRole("form", { name: "Catat referensi dukungan" });
  await note.getByLabel("Nomor tiket dukungan AutoLaris").fill("CS-AL-2026-0042");
  await note.getByLabel("Ringkasan jawaban").fill("Dukungan AutoLaris sedang memeriksa transaksi ini");
  await note.getByRole("button", { name: "Catat Referensi" }).click();
  await fin.p.getByText("Referensi dukungan dicatat.").first().waitFor();
  const d1 = await fin.p.locator("main").innerText();
  flow.push(["the support note is recorded and the attempt stays unknown (no status change)", /Referensi dukungan CS-AL-2026-0042/.test(d1) && /Hasil belum pasti/.test(d1)]);
  // keyboard: fee change (amount, month, reason, Enter)
  const fee = fin.p.getByRole("form", { name: "Ajukan perubahan biaya" });
  await fee.getByLabel("Biaya baru (Rp, tanpa PPN)").focus();
  await fin.p.keyboard.type("1250000");
  await fin.p.keyboard.press("Tab");
  const min = await fee.getByLabel("Berlaku mulai bulan").getAttribute("min");
  await fee.getByLabel("Berlaku mulai bulan").fill(min!);
  await fee.getByLabel("Alasan").focus();
  await fin.p.keyboard.type("Penyesuaian biaya server sesuai kontrak");
  await fin.p.keyboard.press("Enter");
  await fin.p.getByText("Pengajuan perubahan biaya dikirim.").first().waitFor();
  const pend = fin.p.locator("main li").filter({ hasText: "Perubahan biaya server" }).first();
  flow.push(["keyboard: the fee change is filed (Menunggu persetujuan); its requester sees no Setujui", /Menunggu persetujuan/.test(await pend.innerText())
    && (await pend.getByRole("button", { name: "Setujui" }).count()) === 0]);
  // a waiver filed and cancelled by the requester
  const wv = fin.p.getByRole("form", { name: "Ajukan pembebasan atau kredit" });
  await wv.getByLabel("Tagihan").selectOption({ index: 1 });
  await wv.getByLabel("Nominal (Rp)").fill("50000");
  await wv.getByLabel("Alasan").fill("Kompensasi gangguan layanan uji");
  await wv.getByRole("button", { name: "Ajukan Pembebasan" }).click();
  await fin.p.getByText("Pengajuan pembebasan dikirim.").first().waitFor();
  const w = fin.p.locator("main li").filter({ hasText: "Pembebasan / kredit tagihan" }).first();
  await w.getByRole("button", { name: "Batalkan Pengajuan" }).click();
  await fin.p.getByText("Pengajuan dibatalkan.").first().waitFor();
  flow.push(["the requester cancels own waiver request (Dibatalkan)", /Dibatalkan/.test(await fin.p.locator("main li").filter({ hasText: "Pembebasan / kredit tagihan" }).first().innerText())]);
  await fin.c.close();
  // another platform owner approves; not applied
  const po2 = await open(seed.vendor.po2);
  await po2.p.goto(`${VENDOR}${detail}`);
  const q = po2.p.locator("main li").filter({ hasText: "Perubahan biaya server" }).first();
  await q.getByRole("button", { name: "Setujui" }).click();
  await po2.p.getByText("Pengajuan disetujui.").first().waitFor();
  flow.push(["another platform owner approves; it is not applied by the console (menunggu diterapkan sistem)",
    /menunggu diterapkan sistem/.test(await po2.p.locator("main li").filter({ hasText: "Perubahan biaya server" }).first().innerText())]);
  await po2.c.close();
  // the auditor reads with no forms
  const aud = await open(seed.vendor.aud);
  await aud.p.goto(`${VENDOR}${detail}`);
  await aud.p.getByRole("heading", { name: "PT Klinik Tagihan Sintetis" }).waitFor();
  flow.push(["the vendor auditor reads the detail with no forms or action buttons", (await aud.p.locator("main form").count()) === 0
    && (await aud.p.getByRole("button", { name: /Setujui|Tolak|Batalkan|Ajukan|Catat|Terbitkan/ }).count()) === 0 && !leak(await aud.p.content())]);
  await layouts(aud.p, detail, "PT Klinik Tagihan Sintetis", "detail-auditor");
  await aud.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
