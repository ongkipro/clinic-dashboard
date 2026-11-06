// T-023 browser evidence (PR-1, TEN-12, DEC-033) at 390/820/1180/1440 and 200% text:
// onboarding staff create a tenant; the maker cannot approve the first-owner invitation, a
// second platform owner can and sees the one-time link; the invited Owner accepts it,
// creates a password and enrols TOTP; Profil & Keamanan works (password change, sessions);
// Mulai Onboarding stays disabled until the Owner approves the processor agreement; the
// vendor Keamanan Akun page; no CSP violation on any vendor page. Runs on request:
//   RUN_UI=1 APP_URL=... VENDOR_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/tenant-provisioning.spec.ts out-dir
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
  type Locator = {
    first(): Locator; nth(i: number): Locator; getByText(t: string | RegExp): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: object): Locator;
    waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; count(): Promise<number>;
    isDisabled(): Promise<boolean>; setInputFiles(f: { name: string; mimeType: string; buffer: Buffer }): Promise<void>; selectOption(v: string): Promise<unknown>;
  };
  type Page = {
    goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; url(): string; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
    getByLabel(t: string | RegExp, o?: object): Locator; getByRole(r: string, o?: object): Locator; locator(s: string): Locator; getByText(t: string | RegExp, o?: object): Locator;
    evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
    on(e: string, f: (m: { type(): string; text(): string }) => void): void;
  };
  type Context = { newPage(): Promise<Page>; close(): Promise<void>; addInitScript(s: string): Promise<void> };
  const APP = process.env.APP_URL ?? "http://localhost:3911";
  const VENDOR = process.env.VENDOR_URL ?? "http://vendor.localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t023ui";
  const seed = JSON.parse(readFileSync(process.env.SEED ?? `${OUT}/seed.json`, "utf8")) as { po: string; po2: string; onb: string; ownerEmail: string };
  const PASSWORD = "kuda-laut berenang 2026"; // synthetic
  const OWNER_PASSWORD = "mawar merah di taman kota 2026";
  const NEW_PASSWORD = "perahu layar menepi pelan 2027";
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [], csp: [] };
  const flow = report.flow as [string, unknown][];
  const csp = report.csp as string[];

  function totp(secret: string, at = Date.now()): string {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase()].map((c) => a.indexOf(c).toString(2).padStart(5, "0")).join("");
    const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    const ctr = Buffer.alloc(8);
    ctr.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
    const m = createHmac("sha1", key).update(ctr).digest();
    const o = m[m.length - 1] & 15;
    return String((((m[o] & 0x7f) << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) % 1e6).padStart(6, "0");
  }
  const watchCsp = `document.addEventListener("securitypolicyviolation", (e) => { (window.__csp ??= []).push(e.violatedDirective + " " + (e.blockedURI || "inline")); });`;
  async function cspOf(page: Page, where: string) {
    const v = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    for (const x of v) csp.push(`${where}: ${x}`);
  }
  async function zoom200(page: Page) {
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  }
  async function measure(page: Page, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0; }; // skip links sit off-screen until focused
      const ctl = [...document.querySelectorAll("a, button, input:not([type=hidden]), select, textarea")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
        smallest: ctl.map((e) => [Math.round(e.getBoundingClientRect().height), `${e.tagName}.${e.className}:${(e.textContent ?? "").slice(0, 30)}`] as const).sort((x, y) => x[0] - y[0])[0]?.[1],
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  }
  async function layouts(page: Page, base: string, paths: [string, string, string][]) {
    for (const [path, wait, name] of paths) {
      for (const w of [390, 820, 1180, 1440]) {
        for (const zoom of [1, 2]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${base}${path}`);
          await page.getByRole("heading", { name: wait }).first().waitFor();
          if (zoom === 2) await zoom200(page);
          const shoot = (zoom === 1 && (w === 390 || w === 1180 || w === 1440)) || (zoom === 2 && w === 390);
          await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
          if (base === VENDOR) await cspOf(page, `${name}-${w}`);
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  let expected = /status of (401|403|404|409)/; // 404: report.notFound lists them (menu prefetch of pages not built yet)
  const onConsole = (m: { type(): string; text(): string }) =>
    m.type() === "error" && !expected.test(m.text()) && (report.console as string[]).push(m.text().slice(0, 200));

  // Vendor sign-in; enrols TOTP on first use (the seed accounts have none) and returns the secret.
  const secrets = new Map<string, string>();
  async function vendorSignIn(page: Page, email: string) {
    await page.goto(`${VENDOR}/vendor/masuk`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(/\/vendor\/(aktifkan-2fa|verifikasi)$/);
    if (page.url().endsWith("/aktifkan-2fa")) {
      await page.getByLabel("Kata sandi").fill(PASSWORD);
      await page.getByRole("button", { name: "Lanjut" }).click();
      const secret = (await page.getByLabel("Kunci autentikator").innerText()).trim();
      secrets.set(email, secret);
      await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
      await page.getByRole("button", { name: "Aktifkan" }).click();
    } else {
      await page.getByLabel(/kode/i).first().fill(totp(secrets.get(email)!));
      await page.getByRole("button", { name: /Verifikasi|Lanjut/ }).first().click();
    }
    await page.waitForURL(`${VENDOR}/vendor/tenant`);
  }

  const browser = await chromium.launch();
  const open: Page[] = [];
  // Each person on their own address (Better Auth limits sign-ins per address: 3 per 10 s).
  let ipN = 10;
  const newCtx = async (w = 1440) => {
    const c = (await browser.newContext({ viewport: { width: w, height: 900 }, extraHTTPHeaders: { "x-real-ip": `203.0.113.${ipN++}` } })) as Context;
    await c.addInitScript(watchCsp);
    const p = await c.newPage();
    open.push(p);
    (p as unknown as { on(e: "response", f: (r: { status(): number; url(): string }) => void): void }).on("response", (r) => {
      if (r.status() === 404) ((report.notFound ??= []) as string[]).push(new URL(r.url()).pathname);
    });
    p.on("console", onConsole);
    p.on("pageerror", (e) => (report.console as string[]).push(`pageerror: ${String(e).slice(0, 300)}`));
    return { c, p };
  };
  try {
    // 1. Onboarding creates the tenant (field errors first).
    const onb = await newCtx();
    await vendorSignIn(onb.p, seed.onb);
    await layouts(onb.p, VENDOR, [["/vendor/tenant/baru", "Buat Tenant", "buat"]]);
    await onb.p.goto(`${VENDOR}/vendor/tenant/baru`);
    await onb.p.getByRole("button", { name: "Buat Tenant" }).click();
    await onb.p.getByText("Isi nama badan usaha, 3–160 karakter.").waitFor();
    await onb.p.setViewportSize({ width: 390, height: 900 });
    await measure(onb.p, "buat-errors-390", "buat-errors-390");
    flow.push(["empty form shows field errors and focuses the first", await onb.p.evaluate(() => document.activeElement?.id === "legalName")]);
    await onb.p.setViewportSize({ width: 1440, height: 900 });
    await onb.p.getByLabel("Nama badan usaha").fill("PT Klinik Aurelia Sintetis");
    await onb.p.getByLabel("Kode cabang").fill("KMG");
    await onb.p.getByLabel("Nama cabang").fill("Cabang Kemang");
    await onb.p.getByLabel("Nama lengkap").fill("Ibu Laras Pemilik");
    await onb.p.getByLabel("Email", { exact: true }).fill(seed.ownerEmail);
    await onb.p.getByRole("button", { name: "Buat Tenant" }).click();
    await onb.p.waitForURL(/\/vendor\/tenant\/[0-9a-f-]{36}$/);
    const tenantPath = new URL(onb.p.url()).pathname;
    await onb.p.getByText("Menunggu persetujuan Pemilik Platform lain").waitFor();
    flow.push(["tenant created in Penyiapan with a pending owner invitation", (await onb.p.locator("main:visible").innerText()).includes("Penyiapan")]);
    flow.push(["the maker sees no approve button", (await onb.p.getByRole("button", { name: "Setujui Undangan" }).count()) === 0]);
    await layouts(onb.p, VENDOR, [[tenantPath, "PT Klinik Aurelia Sintetis", "detail-pending"]]);

    // 2. A second platform owner approves and sees the link once.
    const po2 = await newCtx();
    await vendorSignIn(po2.p, seed.po2);
    await po2.p.goto(`${VENDOR}${tenantPath}`);
    await po2.p.getByRole("button", { name: "Setujui Undangan" }).click();
    const linkText = (await po2.p.getByLabel("Tautan undangan Owner").innerText()).trim();
    flow.push(["the approver sees the one-time link", /^http:\/\/localhost:3911\/undangan\/[A-Za-z0-9_-]{40,}$/.test(linkText)]);
    await po2.p.setViewportSize({ width: 390, height: 900 });
    await measure(po2.p, "link-390", "link-390");
    await zoom200(po2.p);
    await measure(po2.p, "link-390@200%", "link-390-200");
    await po2.p.goto(`${VENDOR}${tenantPath}`);
    await po2.p.getByText("Tautan sudah dikirim").waitFor();
    flow.push(["the link is not shown again", (await po2.p.getByLabel("Tautan undangan Owner").count()) === 0]);
    await cspOf(po2.p, "approve");

    // 3. The Owner accepts, creates a password, enrols TOTP.
    const own = await newCtx(390);
    own.p.on("console", onConsole);
    await own.p.goto(linkText);
    await own.p.getByText("Anda didaftarkan sebagai Owner PT Klinik Aurelia Sintetis").waitFor();
    await measure(own.p, "accept-390", "accept-390");
    await own.p.getByLabel("Kata sandi baru").fill(OWNER_PASSWORD);
    await own.p.getByLabel(/Ulangi/).fill(OWNER_PASSWORD);
    await own.p.getByRole("button", { name: /Terima|Buat Akun|Simpan/ }).first().click();
    await own.p.waitForURL(/\/masuk\?undangan=diterima$/);
    await own.p.getByLabel("Email").fill(seed.ownerEmail);
    await own.p.getByLabel("Kata sandi").fill(OWNER_PASSWORD);
    await own.p.getByRole("button", { name: "Masuk" }).click();
    await own.p.waitForURL(`${APP}/`);
    await own.p.goto(`${APP}/saya/keamanan`);
    await own.p.waitForURL(/\/aktifkan-2fa$/);
    flow.push(["the Owner must enrol TOTP before any clinic page", true]);
    await own.p.getByLabel("Kata sandi").fill(OWNER_PASSWORD);
    await own.p.getByRole("button", { name: "Lanjut" }).click();
    let ownerSecret = (await own.p.getByLabel("Kunci autentikator").innerText()).trim();
    await own.p.getByLabel("3. Masukkan kode 6 digit").fill(totp(ownerSecret));
    await own.p.getByRole("button", { name: "Aktifkan" }).click();
    await own.p.waitForURL(`${APP}/`);
    await own.p.goto(linkText);
    await own.p.getByText("Undangan sudah tidak berlaku").waitFor();
    flow.push(["the link works once", true]);

    // 4. Profil & Keamanan for the Owner.
    await layouts(own.p, APP, [["/saya/keamanan", "Profil & Keamanan", "keamanan"]]);
    await own.p.goto(`${APP}/saya/keamanan`);
    const sec = await own.p.locator("main:visible").innerText();
    flow.push(["Owner cannot turn TOTP off, only replace it", sec.includes("Ganti Autentikator") && !sec.includes("Matikan Autentikator")]);
    // A second session on another device, then end it from here.
    const other = await newCtx(1440);
    await other.p.goto(`${APP}/masuk`);
    await other.p.getByLabel("Email").fill(seed.ownerEmail);
    await other.p.getByLabel("Kata sandi").fill(OWNER_PASSWORD);
    await other.p.getByRole("button", { name: "Masuk" }).click();
    await other.p.waitForURL(/\/verifikasi$/);
    await other.p.getByLabel(/kode/i).first().fill(totp(ownerSecret, Date.now() + 30_000));
    await other.p.getByRole("button", { name: /Verifikasi|Lanjut/ }).first().click();
    await other.p.waitForURL(`${APP}/`);
    await own.p.goto(`${APP}/saya/keamanan`);
    await own.p.getByRole("button", { name: "Keluarkan" }).first().click();
    await own.p.getByText("Sesi dikeluarkan.").waitFor();
    await other.p.goto(`${APP}/saya/keamanan`);
    await other.p.waitForURL(/\/masuk$/);
    flow.push(["ending another session signs that device out", true]);
    await other.c.close();
    // Wrong current password, weak new password, then a real change.
    await own.p.goto(`${APP}/saya/keamanan`);
    expected = /status of (400|401|403|404|409)/;
    await own.p.getByLabel("Kata sandi sekarang").fill("bukan kata sandi yang benar");
    await own.p.getByLabel("Kata sandi baru", { exact: true }).fill(NEW_PASSWORD);
    await own.p.getByLabel("Ulangi kata sandi baru").fill(NEW_PASSWORD);
    await own.p.getByRole("button", { name: "Ubah Kata Sandi" }).click();
    await own.p.getByText("Kata sandi salah.").waitFor();
    await measure(own.p, "keamanan-error-390", "keamanan-error-390");
    await own.p.getByLabel("Kata sandi sekarang").fill(OWNER_PASSWORD);
    await own.p.getByLabel("Kata sandi baru", { exact: true }).fill("pendek");
    await own.p.getByLabel("Ulangi kata sandi baru").fill("pendek");
    await own.p.getByRole("button", { name: "Ubah Kata Sandi" }).click();
    await own.p.getByText(/minimal 15 karakter/i).first().waitFor();
    // Better Auth allows 3 password changes per 10 s per address (anti-guessing); wait it out.
    await new Promise((r) => setTimeout(r, 10_500));
    await own.p.getByLabel("Kata sandi baru", { exact: true }).fill(NEW_PASSWORD);
    await own.p.getByLabel("Ulangi kata sandi baru").fill(NEW_PASSWORD);
    await own.p.getByRole("button", { name: "Ubah Kata Sandi" }).click();
    await own.p.getByText("Kata sandi diubah.", { exact: false }).waitFor();
    flow.push(["password change: wrong current refused, weak refused, then changed", true]);
    // Replace the authenticator (new phone): password + current code → enrol a new one.
    await own.p.locator("#offPassword").fill(NEW_PASSWORD);
    await own.p.locator("#offCode").fill(totp(ownerSecret));
    await own.p.getByRole("button", { name: "Ganti Autentikator" }).click();
    await own.p.waitForURL(/\/aktifkan-2fa$/);
    await own.p.getByLabel("Kata sandi").fill(NEW_PASSWORD);
    await own.p.getByRole("button", { name: "Lanjut" }).click();
    ownerSecret = (await own.p.getByLabel("Kunci autentikator").innerText()).trim();
    await own.p.getByLabel("3. Masukkan kode 6 digit").fill(totp(ownerSecret));
    await own.p.getByRole("button", { name: "Aktifkan" }).click();
    await own.p.waitForURL(`${APP}/`);
    flow.push(["authenticator replaced through re-enrolment", true]);
    expected = /status of (401|403|404|409)/;

    // 5. Mulai Onboarding is disabled until the agreement is approved.
    await onb.p.goto(`${VENDOR}${tenantPath}`);
    await onb.p.getByText("Menunggu Owner mengunggah dan menyetujui").waitFor();
    flow.push(["Mulai Onboarding disabled before the agreement", await onb.p.getByRole("button", { name: "Mulai Onboarding" }).isDisabled()]);
    await layouts(onb.p, VENDOR, [[tenantPath, "PT Klinik Aurelia Sintetis", "detail-owner"]]);
    const pdf = Buffer.from("%PDF-1.7\nPerjanjian pengolahan data sintetis\n%%EOF\n");
    await own.p.setViewportSize({ width: 1440, height: 900 });
    await own.p.goto(`${APP}/kepatuhan/processor_agreement_signed`);
    await own.p.getByRole("button", { name: "Unggah Bukti" }).click();
    await own.p.getByLabel(/Berkas \(PDF/).setInputFiles({ name: "dpa.pdf", mimeType: "application/pdf", buffer: pdf });
    await own.p.getByLabel("Disusun oleh").fill("Konsultan Hukum Sintetis");
    await own.p.getByLabel("Tanggal dokumen").fill("2026-10-01");
    await own.p.getByRole("button", { name: "Unggah", exact: true }).click();
    await own.p.locator("main:visible").getByText(/Versi 1: dpa/).waitFor();
    await own.p.getByRole("button", { name: "Tandai Disetujui" }).click();
    await own.p.locator("main:visible").getByText(/Disetujui · versi 1/).waitFor();
    await onb.p.goto(`${VENDOR}${tenantPath}`);
    await onb.p.getByText("Onboarding bisa dimulai").waitFor();
    await onb.p.getByRole("button", { name: "Mulai Onboarding" }).click();
    await onb.p.locator("main:visible").getByText("Riwayat Status").waitFor();
    const after = await onb.p.locator("main:visible").innerText();
    flow.push(["onboarding starts after the agreement; history recorded", after.includes("Onboarding") && after.includes("Penyiapan → Onboarding")]);
    flow.push(["detail shows no patient or staff data", !/pasien|nomor hp|telepon|Ibu Laras/i.test(after)]);
    await cspOf(onb.p, "after-onboarding");

    // 6. Vendor Keamanan Akun.
    await layouts(onb.p, VENDOR, [["/vendor/keamanan", "Keamanan Akun", "vendor-keamanan"]]);
    const vk = await onb.p.locator("main:visible").innerText();
    flow.push(["vendor account can replace but not turn off TOTP", vk.includes("Ganti Autentikator") && !vk.includes("Matikan Autentikator")]);
    // Unknown tenant id: vendor not-found.
    await onb.p.goto(`${VENDOR}/vendor/tenant/00000000-0000-7000-8000-000000000000`);
    await onb.p.getByRole("heading", { name: "Halaman tidak ditemukan" }).waitFor();
    flow.push(["unknown tenant id shows not-found", true]);
    await onb.c.close();
    await po2.c.close();
    await own.c.close();
  } catch (e) {
    for (const [i, p] of open.entries()) await p.screenshot({ path: `${OUT}/fail-${i}.png` }).catch(() => {});
    report.error = `${(report.flow as unknown[]).length} flows done: ` + String(e).split("\n").slice(0, 4).join(" ");
    process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
  } finally {
    await browser.close();
    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  }
}
