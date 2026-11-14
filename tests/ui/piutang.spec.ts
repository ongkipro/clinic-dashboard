// T-078 browser evidence (Piutang & Refund UX-14, PR-21/37/15/63) at 390/820/1180/1440 and 200 % text: the FO reads the
// receivables with aging filters (rows, filtered-empty), the refunds (a cash refund Diajukan) and Siap Dijadikan Piutang;
// refunds a paid facial to the balance (paid at once); converts a visit's delivered unpaid remainder; collects part of a
// receivable in cash with change; asks for a write-off; the owner approves the cash refund and the write-off, and writes off a
// remainder (a short reason refused); the FO pays the approved cash refund; admin pusat has no access; the auditor reads
// masked with no actions. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/piutang.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branches: Record<string, string>; dewi: string; ayu: string; sari: string; nina: string; invFacial: string; invSerum: string; cashRefund: string; cashApproval: string; rcv: string; rcv2: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator; uncheck(): Promise<void>;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; getAttribute(n: string): Promise<string | null>; selectOption(v: string | object): Promise<unknown>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
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
  const approve = async (p: Page, id: string) => {
    await p.goto(`${BASE}/persetujuan/${id}`);
    await p.getByRole("button", { name: "Setujui" }).first().waitFor();
    await p.getByRole("button", { name: "Setujui" }).first().click();
    await p.waitForTimeout(1500);
  };

  // FO: the receivables, aging filters, the refunds and Siap.
  const fo = await open("fo", "203.0.113.231");
  await fo.p.goto(`${BASE}/piutang`);
  await fo.p.getByText(/Total piutang terbuka/).waitFor();
  const l0 = await main(fo.p);
  flow.push(["Piutang lists Sari's two open receivables, total Rp550.000", /Total piutang terbuka Rp550\.000/.test(l0) && (l0.match(/Sari Wulandari/g) ?? []).length === 2 && /45 hari/.test(l0)]);
  await layouts(fo.p, "/piutang", "piutang");
  await fo.p.goto(`${BASE}/piutang?umur=31-60`);
  await fo.p.getByText(/45 hari/).waitFor();
  const l1 = await main(fo.p);
  await fo.p.goto(`${BASE}/piutang?umur=%3E90`);
  await fo.p.getByText("Tidak ada piutang yang cocok dengan filter.").waitFor();
  flow.push(["aging 31-60 shows the 45-day receivable only; >90 is filtered-empty with Hapus Filter",
    (l1.match(/Sari Wulandari/g) ?? []).length === 1 && /Rp150\.000 sisa/.test(l1) && (await fo.p.getByRole("link", { name: "Hapus Filter" }).count()) === 1]);
  await layouts(fo.p, "/piutang?umur=%3E90", "piutang-kosong");
  await fo.p.goto(`${BASE}/piutang?lihat=refund`);
  await fo.p.getByText(/Ayu Pratiwi/).first().waitFor();
  const r0 = await main(fo.p);
  flow.push(["Refund lists Ayu's cash refund Diajukan", /Ayu Pratiwi[\s\S]*Rp333\.000[\s\S]*Tunai \(perlu persetujuan\)[\s\S]*Diajukan/.test(r0)]);
  await layouts(fo.p, "/piutang?lihat=refund", "refund");

  // Ajukan Refund: the picker, then Dewi's facial to the balance (paid at once).
  await fo.p.getByRole("link", { name: "Ajukan Refund" }).first().click();
  await fo.p.getByRole("heading", { name: "Ajukan Refund", level: 1 }).waitFor();
  await fo.p.getByRole("link", { name: /Dewi Lestari/ }).first().waitFor();
  flow.push(["the picker lists the paid tagihan of the branch", /Dewi Lestari/.test(await main(fo.p)) && /Rp600\.000/.test(await main(fo.p))]);
  await layouts(fo.p, "/piutang/refund/baru", "refund-pilih");
  await fo.p.goto(`${BASE}/piutang/refund/baru?tagihan=${seed.invFacial}`);
  await fo.p.getByRole("form", { name: "Ajukan refund" }).waitFor();
  await layouts(fo.p, `/piutang/refund/baru?tagihan=${seed.invFacial}`, "refund-form", async () => { await fo.p.getByRole("form", { name: "Ajukan refund" }).waitFor(); });
  const rf = fo.p.getByRole("form", { name: "Ajukan refund" });
  flow.push(["Tujuan defaults to Saldo pasien; Tunai names who approves", (await rf.getByRole("button", { name: "Refund ke Saldo" }).count()) === 1
    && await (async () => { await rf.getByLabel("Tunai").check(); const t = await rf.innerText(); await rf.getByLabel("Saldo pasien").check(); return /Refund tunai perlu persetujuan Owner\./.test(t); })()]);
  await rf.getByLabel("Alasan").fill("Pasien batal perawatan");
  await rf.getByRole("button", { name: "Refund ke Saldo" }).click();
  await fo.p.getByRole("heading", { name: "Refund Rp600.000", level: 1 }).waitFor();
  const rd = await main(fo.p);
  flow.push(["the balance refund is Dibayar at once (Ke saldo pasien)", /Dibayar/.test(rd) && /Ke saldo pasien/.test(rd) && /Alasan: Pasien batal perawatan/.test(rd)]);

  // Siap Dijadikan Piutang: Nina's visit converts.
  await fo.p.goto(`${BASE}/piutang?lihat=siap`);
  await fo.p.getByText(/Nina Kartika/).waitFor();
  await layouts(fo.p, "/piutang?lihat=siap", "siap");
  await fo.p.getByRole("button", { name: "Jadikan Piutang Rp333.000" }).click();
  await fo.p.getByRole("heading", { name: /^Piutang Nina Kartika/, level: 1 }).waitFor();
  const cv = await main(fo.p);
  report.convertText = cv.slice(0, 600);
  flow.push(["Jadikan Piutang opens the new receivable (Terbuka, Rp333.000, its tagihan line)", /Terbuka/.test(cv) && /Serum Vitamin C[\s\S]*Rp333\.000/.test(cv)]);

  // Collect Rp100.000 of Sari's Rp400.000 in cash with change.
  await fo.p.goto(`${BASE}/piutang/${seed.rcv}`);
  await fo.p.getByRole("form", { name: "Terima pembayaran piutang" }).waitFor();
  await layouts(fo.p, `/piutang/${seed.rcv}`, "piutang-detail", async () => { await fo.p.getByRole("form", { name: "Terima pembayaran piutang" }).waitFor(); });
  const cf = fo.p.getByRole("form", { name: "Terima pembayaran piutang" });
  await cf.getByLabel(/Jumlah/).fill("100000");
  await cf.getByLabel("Uang diterima").fill("150000");
  await cf.getByRole("button", { name: "Terima Pembayaran" }).click();
  await ok(fo.p, /Pembayaran piutang diterima\. Struk KW-KMG-.*Kembalian Rp50\.000/);
  await fo.p.goto(`${BASE}/piutang/${seed.rcv}`);
  await fo.p.getByRole("region", { name: "Riwayat pembayaran" }).waitFor();
  flow.push(["the collection: Sisa Rp300.000, a KW receipt in Riwayat pembayaran", /Sisa\s*Rp300\.000/.test(await main(fo.p)) && /KW-KMG-[^\n]*Tunai/.test(await main(fo.p))]);
  // Ajukan Hapus Buku on the 45-day receivable.
  await fo.p.goto(`${BASE}/piutang/${seed.rcv2}`);
  const wf = fo.p.getByRole("form", { name: "Ajukan hapus buku" });
  await wf.getByLabel("Alasan").fill("Pasien pindah ke luar negeri");
  await wf.getByRole("button", { name: "Ajukan Hapus Buku" }).click();
  await fo.p.getByText(/Hapus buku sudah diajukan/).waitFor();
  flow.push(["the FO's write-off request waits for the owner", /Hapus buku sudah diajukan\. Owner memutuskannya di Persetujuan/.test(await main(fo.p))]);
  await fo.c.close();

  // Owner: approves the cash refund and the write-off; writes off Sari's remainder (a short reason refused).
  const own = await open("own", "203.0.113.232", true);
  await approve(own.p, seed.cashApproval);
  await own.p.goto(`${BASE}/persetujuan`);
  await own.p.getByRole("heading", { level: 1 }).waitFor();
  await own.p.getByRole("list", { name: "Permintaan menunggu" }).locator("li").filter({ hasText: "Hapus piutang" }).first().locator("a").click();
  await own.p.getByRole("button", { name: "Setujui" }).first().waitFor();
  await own.p.getByRole("button", { name: "Setujui" }).first().click();
  await own.p.waitForTimeout(1500);
  await own.p.goto(`${BASE}/piutang/${seed.rcv2}`);
  await own.p.getByRole("heading", { name: /^Piutang Sari Wulandari/, level: 1 }).waitFor();
  flow.push(["the approved write-off: Dihapus buku Rp150.000, no action left", /Dihapus buku/.test(await main(own.p)) && (await own.p.getByRole("form").count()) === 0]);
  await own.p.goto(`${BASE}/piutang/${seed.rcv}`);
  const of = own.p.getByRole("form", { name: "Hapus buku piutang" });
  await of.getByLabel(/Alasan/).fill("Hilang");
  await of.getByRole("button", { name: "Hapus Buku Rp300.000" }).click();
  await own.p.getByRole("alert").filter({ hasText: "Tulis alasan minimal 10 karakter." }).waitFor();
  const refused = true;
  await own.p.getByRole("form", { name: "Hapus buku piutang" }).getByLabel(/Alasan/).fill("Pasien tidak dapat dihubungi tiga bulan");
  await own.p.getByRole("form", { name: "Hapus buku piutang" }).getByRole("button", { name: "Hapus Buku Rp300.000" }).click();
  await own.p.getByRole("region", { name: "Terima pembayaran" }).waitFor({ state: "detached" });
  await own.p.goto(`${BASE}/piutang/${seed.rcv}`);
  await own.p.getByRole("heading", { name: /^Piutang Sari Wulandari/, level: 1 }).waitFor();
  const w1 = await main(own.p);
  flow.push(["the owner's write-off: a short reason refused, then Dihapus buku with Rp100.000 collected and Rp300.000 written off",
    refused && /Dihapus buku/.test(w1) && /Terbayar\s*Rp100\.000/.test(w1) && /Dihapus buku\s*Rp300\.000/.test(w1)]);
  await own.c.close();

  // FO pays the approved cash refund.
  const fo2 = await open("fo", "203.0.113.233");
  await fo2.p.goto(`${BASE}/piutang/refund/${seed.cashRefund}`);
  await fo2.p.getByRole("form", { name: "Bayar refund" }).waitFor();
  await layouts(fo2.p, `/piutang/refund/${seed.cashRefund}`, "refund-detail", async () => { await fo2.p.getByRole("form", { name: "Bayar refund" }).waitFor(); });
  await fo2.p.getByRole("form", { name: "Bayar refund" }).getByRole("button", { name: "Bayar Refund" }).click();
  // Paid: the form's section leaves on revalidation (the Dibayar badge is the answer).
  await fo2.p.getByRole("form", { name: "Bayar refund" }).waitFor({ state: "detached" });
  await fo2.p.goto(`${BASE}/piutang/refund/${seed.cashRefund}`);
  await fo2.p.getByRole("heading", { name: "Refund Rp333.000", level: 1 }).waitFor();
  flow.push(["the approved cash refund is paid: Dibayar", /Dibayar/.test(await main(fo2.p)) && (await fo2.p.getByRole("form", { name: "Bayar refund" }).count()) === 0]);
  await fo2.c.close();

  // Admin pusat: no access (PR-63).
  const ap = await open("ap", "203.0.113.234", true);
  await ap.p.goto(`${BASE}/piutang`);
  await ap.p.getByText("Anda tidak memiliki akses ke piutang dan refund.").waitFor();
  await ap.p.goto(`${BASE}/piutang/${seed.rcv}`);
  await ap.p.getByText("Anda tidak memiliki akses ke piutang dan refund.").waitFor();
  flow.push(["admin pusat has no access to Piutang & Refund (list and detail)", !/Sari Wulandari/.test(await main(ap.p))]);
  await ap.c.close();

  // Auditor: masked, no actions.
  const au = await open("au", "203.0.113.235", true);
  await au.p.goto(`${BASE}/piutang`);
  await au.p.getByText(/Total piutang terbuka/).waitFor();
  const a1 = await main(au.p);
  flow.push(["the auditor reads the receivables masked with no action", !/Sari Wulandari|Nina Kartika/.test(a1) && /Rp333\.000/.test(a1)
    && (await au.p.getByRole("link", { name: "Ajukan Refund" }).count()) === 0]);
  await layouts(au.p, "/piutang", "piutang-auditor");
  await au.p.goto(`${BASE}/piutang/${seed.rcv}`);
  await au.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the auditor's receivable detail has no form", (await au.p.getByRole("form").count()) === 0]);
  await au.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
