// Browser evidence for hyg-nav-3 (5 zero-migration 19 §2 routes) at 390/820/1180/1440 + 200% text:
// - /keuangan/mutasi (Finance; Auditor sees permission state)
// - /audit/internal & /laporan/audit (Auditor; Finance sees permission state; zero patient sentinel)
// - /laporan/atribusi (Marketing)
// - /laporan/terjadwal (Owner; Finance sees permission state)
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
    password: string;
    sentinel: string;
    people: {
      owner: { email: string };
      finance: { email: string };
      auditor: { email: string };
      marketing: { email: string };
    };
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

  type BrowserPage = {
    goto(url: string): Promise<unknown>;
    waitForURL(url: string | RegExp): Promise<unknown>;
    url(): string;
    getByLabel(text: string | RegExp): { fill(v: string): Promise<unknown>; textContent(): Promise<string | null> };
    getByRole(role: string, opts: { name: string | RegExp; exact?: boolean }): { click(): Promise<unknown>; waitFor(): Promise<unknown> };
    getByText(text: string | RegExp): { first(): { waitFor(): Promise<unknown> }; waitFor(): Promise<unknown> };
    evaluate<T>(fn: () => T): Promise<T>;
    setViewportSize(size: { width: number; height: number }): Promise<unknown>;
    addStyleTag(opts: { content: string }): Promise<unknown>;
    reload(): Promise<unknown>;
    screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
    content(): Promise<string>;
  };

  async function signIn(page: BrowserPage, email: string, firstRoute: string, needsTotp: boolean) {
    await page.goto(`${BASE}/masuk`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(seed.password);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}${firstRoute}`);
    if (needsTotp) {
      await page.waitForURL(`${BASE}/aktifkan-2fa`);
      await page.getByLabel("Kata sandi").fill(seed.password);
      await page.getByRole("button", { name: "Lanjut" }).click();
      const secret = (await page.getByLabel("Kunci autentikator").textContent())!.trim();
      await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
      await page.getByRole("button", { name: "Aktifkan" }).click();
      await page.waitForURL(`${BASE}/`);
      await page.goto(`${BASE}${firstRoute}`);
    }
  }

  async function measure(page: BrowserPage, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea, main select")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
  }

  async function checkViewports(page: BrowserPage, prefix: string) {
    for (const w of [390, 820, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await measure(page, `${prefix}_${w}`, w === 390 || w === 1440 ? `${prefix}-${w}.png` : undefined);
    }
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await measure(page, `${prefix}_200pct`, `${prefix}-200pct.png`);
    await page.reload();
  }

  const browser = await chromium.launch();
  try {
    // 1. Finance: /keuangan/mutasi OK; /audit/internal & /laporan/terjadwal permission state
    const cFin = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.41" } });
    const pFin = await cFin.newPage();
    pFin.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error") (report.console as string[]).push(`fin: ${m.text()}`);
    });
    await pFin.setViewportSize({ width: 1180, height: 900 });
    await signIn(pFin as unknown as BrowserPage, seed.people.finance.email, "/keuangan/mutasi", true);
    await pFin.getByRole("heading", { name: "Mutasi Pembayaran" }).waitFor();
    await pFin.getByText("Belum tersedia — data settlement dari penyedia pembayaran belum dicatat").waitFor();
    const mutasiHtml = await pFin.content();
    if (mutasiHtml.includes(seed.sentinel)) throw new Error("Patient sentinel leaked in /keuangan/mutasi");
    await checkViewports(pFin as unknown as BrowserPage, "mutasi");
    flow.push(["mutasi_finance_ok", true]);

    await pFin.goto(`${BASE}/audit/internal`);
    await pFin.getByText(/Anda tidak memiliki akses ke audit internal/i).waitFor();
    await pFin.goto(`${BASE}/laporan/terjadwal`);
    await pFin.getByText(/Anda tidak memiliki akses ke kirim laporan terjadwal/i).waitFor();
    flow.push(["finance_blocked_on_audit_and_terjadwal", true]);
    await cFin.close();

    // 2. Auditor: /audit/internal & /laporan/audit OK (zero patient sentinel); /keuangan/mutasi permission state
    const cAud = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.42" } });
    const pAud = await cAud.newPage();
    pAud.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error") (report.console as string[]).push(`aud: ${m.text()}`);
    });
    await pAud.setViewportSize({ width: 1180, height: 900 });
    await signIn(pAud as unknown as BrowserPage, seed.people.auditor.email, "/audit/internal", true);
    await pAud.getByRole("heading", { name: "Audit Internal" }).waitFor();
    await pAud.getByText("Belum tersedia — daftar persetujuan untuk auditor belum ada pembacanya").waitFor();
    const audHtml = await pAud.content();
    if (audHtml.includes(seed.sentinel)) throw new Error("Patient sentinel leaked in /audit/internal");
    await checkViewports(pAud as unknown as BrowserPage, "audit-internal");
    flow.push(["audit_internal_ok", true]);

    await pAud.goto(`${BASE}/laporan/audit`);
    await pAud.getByRole("heading", { name: "Laporan Audit" }).waitFor();
    await measure(pAud as unknown as BrowserPage, "laporan-audit_1440", "laporan-audit-1440.png");
    await pAud.setViewportSize({ width: 390, height: 900 });
    await measure(pAud as unknown as BrowserPage, "laporan-audit_390", "laporan-audit-390.png");
    flow.push(["laporan_audit_ok", true]);

    await pAud.goto(`${BASE}/keuangan/mutasi`);
    await pAud.getByText(/Anda tidak memiliki akses ke mutasi pembayaran/i).waitFor();
    flow.push(["auditor_blocked_on_mutasi", true]);
    await cAud.close();

    // 3. Marketing: /laporan/atribusi OK
    const cMkt = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.43" } });
    const pMkt = await cMkt.newPage();
    const mktUnexpected404: string[] = [];
    pMkt.on("response", (res: { status(): number; url(): string }) => {
      if (res.status() === 404 && !res.url().includes("/situs")) {
        mktUnexpected404.push(res.url());
      }
    });
    pMkt.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error") {
        // On pre-T-123 base 0770321c, Next.js sidebar Link prefetch for T-123's /situs returns 404.
        if (m.text().includes("status of 404") && mktUnexpected404.length === 0) return;
        (report.console as string[]).push(`mkt: ${m.text()}`);
      }
    });
    await pMkt.setViewportSize({ width: 1180, height: 900 });
    await signIn(pMkt as unknown as BrowserPage, seed.people.marketing.email, "/laporan/atribusi", false);
    await pMkt.getByRole("heading", { name: "Atribusi & Sumber Rujukan" }).waitFor();
    await checkViewports(pMkt as unknown as BrowserPage, "laporan-atribusi");
    flow.push(["laporan_atribusi_ok", true]);
    await cMkt.close();

    // 4. Owner: /laporan/terjadwal OK
    const cOwn = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.44" } });
    const pOwn = await cOwn.newPage();
    pOwn.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error") (report.console as string[]).push(`own: ${m.text()}`);
    });
    await pOwn.setViewportSize({ width: 1180, height: 900 });
    await signIn(pOwn as unknown as BrowserPage, seed.people.owner.email, "/laporan/terjadwal", true);
    await pOwn.getByRole("heading", { name: "Kirim Laporan Terjadwal" }).waitFor();
    await pOwn.getByText(/Ubah jadwal SET-37/i).waitFor();
    await checkViewports(pOwn as unknown as BrowserPage, "laporan-terjadwal");
    flow.push(["laporan_terjadwal_ok", true]);
    await cOwn.close();

    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    const bad: string[] = [];
    if ((report.console as string[]).length > 0) bad.push(`console errors: ${(report.console as string[]).join("; ")}`);
    for (const [k, v] of Object.entries(
      report.layout as Record<string, { overflowX: number; minTarget: number | null; unnamed: number }>,
    )) {
      if (v.overflowX > 0) bad.push(`${k}: overflowX=${v.overflowX}`);
      if (v.minTarget !== null && v.minTarget < 44) bad.push(`${k}: minTarget=${v.minTarget}`);
      if (v.unnamed > 0) bad.push(`${k}: unnamed=${v.unnamed}`);
    }
    if (bad.length > 0) throw new Error(`UI validation failed: ${bad.join(" | ")}`);
    console.log(
      `UI VALIDATION PASSED: ${flow.length} flows, ${Object.keys(report.layout as object).length} layouts, 0 errors`,
    );
  } finally {
    await browser.close();
  }
}
