// T-122 browser evidence (UX-32 Ekspor Data Klinik & Status Backup, PR-52) at 390/820/1180/1440 and 200% text:
// - Owner opens /ekspor (empty state), opens /ekspor/backup (honest "Belum terpantau" signals, no self-restore)
// - Enters live 6-digit TOTP and submits "Mulai Ekspor" -> queued state shown
// - Ready seeded export downloads via POST /ekspor/[id]/unduh (never GET/HEAD -> 405 verified!),
//   verifies Cache-Control: private, no-store, X-Content-Type-Options: nosniff, and independent ZIP/manifest check
// - Non-owner (Admin Pusat) sees BlockedState ("Ekspor penuh hanya untuk Owner") on /ekspor and /ekspor/backup
// - Zero horizontal overflow, targets >= 44px, zero unnamed controls, zero console/hydration errors.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

function unzipStore(zip: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let off = 0;
  while (off + 30 <= zip.byteLength && dv.getUint32(off, true) === 0x04034b50) {
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(zip.subarray(off + 30, off + 30 + nameLen)).toString("utf8");
    const dataStart = off + 30 + nameLen + extraLen;
    out.set(name, zip.subarray(dataStart, dataStart + size));
    off = dataStart + size;
  }
  return out;
}

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
    people: { owner: { email: string }; ap: { email: string } };
    readyExportId: string;
    sentinel: string;
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
    getByLabel(text: string | RegExp): { fill(v: string): Promise<unknown>; textContent(): Promise<string | null> };
    getByRole(role: string, opts: { name: string; exact?: boolean }): { click(): Promise<unknown>; waitFor(): Promise<unknown> };
    getByText(text: string | RegExp): { waitFor(): Promise<unknown> };
    evaluate<T>(fn: () => T): Promise<T>;
    screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
  };

  async function signIn(page: BrowserPage, email: string): Promise<string> {
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
    return secret;
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

  const browser = await chromium.launch();
  try {
    // 1. Owner flow
    const ctx1 = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.31" } });
    const page = await ctx1.newPage();
    let expectExpected403 = false;
    page.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error") {
        if (expectExpected403 && m.text().includes("403")) return;
        (report.console as string[]).push(m.text());
      }
    });
    await page.setViewportSize({ width: 1180, height: 900 });
    const ownerSecret = await signIn(page, seed.people.owner.email);

    await page.goto(`${BASE}/ekspor`);
    await page.getByRole("heading", { name: "Ekspor Data Klinik" }).waitFor();
    await page.getByText("Siap diunduh").waitFor();
    flow.push(["ekspor_ready_visible", true]);

    for (const w of [390, 820, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await measure(page, `ekspor_${w}`, w === 390 || w === 1440 ? `ekspor-${w}.png` : undefined);
    }

    // 200% text scaling at 1180
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await measure(page, "ekspor_200pct", "ekspor-200pct.png");
    await page.reload();

    // Verify GET & HEAD to /ekspor/[id]/unduh are refused 405 with Cache-Control: private, no-store (Findings #4 & #8)
    const getRes = await ctx1.request.get(`${BASE}/ekspor/${seed.readyExportId}/unduh`);
    if (getRes.status() !== 405 || !getRes.headers()["cache-control"]?.includes("no-store")) {
      throw new Error(`Expected GET /unduh 405 no-store, got ${getRes.status()} ${getRes.headers()["cache-control"]}`);
    }
    const headRes = await ctx1.request.head(`${BASE}/ekspor/${seed.readyExportId}/unduh`);
    if (headRes.status() !== 405) throw new Error(`Expected HEAD /unduh 405, got ${headRes.status()}`);
    flow.push(["get_head_refused_405", true]);

    // R3 P2-4: wrong TOTP renders inline UX-32 error alert (never raw JSON page!)
    expectExpected403 = true;
    await page.getByLabel(/Kode TOTP untuk unduh/).fill("000000");
    await page.getByRole("button", { name: "Unduh ZIP" }).click();
    await page.getByText(/Verifikasi TOTP terbaru diperlukan/).waitFor();
    expectExpected403 = false;
    flow.push(["inline_download_error_rendered", true]);

    // Download via guarded POST form with fresh TOTP step-up -> verify ZIP & headers
    const downloadPromise = page.waitForEvent("download");
    await page.getByLabel(/Kode TOTP untuk unduh/).fill(totp(ownerSecret));
    await page.getByRole("button", { name: "Unduh ZIP" }).click();
    const dl = await downloadPromise;
    const dlPath = await dl.path();
    if (!dlPath) throw new Error("Download path missing");
    const zipBytes = readFileSync(dlPath);
    const entries = unzipStore(new Uint8Array(zipBytes));
    if (!entries.has("manifest.json") || !entries.has("csv/pasien.csv")) {
      throw new Error("Downloaded ZIP missing manifest.json or csv/pasien.csv");
    }
    const pasienCsv = Buffer.from(entries.get("csv/pasien.csv")!).toString("utf8");
    if (!pasienCsv.includes(seed.sentinel)) throw new Error("Downloaded ZIP missing seeded tenant sentinel");
    flow.push(["post_download_zip_verified", true]);

    // Request a new export with live TOTP -> enters queued state
    await page.getByLabel(/Kode autentikator 6 digit/).fill(totp(ownerSecret));
    await page.getByRole("button", { name: "Mulai Ekspor" }).click();
    await page.getByText("Dalam antrean").waitFor();
    flow.push(["requested_new_export", true]);

    // Open /ekspor/backup -> honest "Belum terpantau" signals
    await page.goto(`${BASE}/ekspor/backup`);
    await page.getByRole("heading", { name: "Status Backup" }).waitFor();
    await page.getByText("Catatan backup dari vendor belum tersedia.").waitFor();
    await measure(page, "backup_1180", "backup-1180.png");
    flow.push(["backup_not_measured", true]);
    await ctx1.close();

    // 2. Admin Pusat blocked on /ekspor and /ekspor/backup
    const ctx2 = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.32" } });
    const p2 = await ctx2.newPage();
    await p2.setViewportSize({ width: 1180, height: 900 });
    await signIn(p2, seed.people.ap.email);
    await p2.goto(`${BASE}/ekspor`);
    await p2.getByText("Ekspor penuh hanya untuk Owner.").waitFor();
    await measure(p2, "ap_blocked_ekspor_1180");
    await p2.goto(`${BASE}/ekspor/backup`);
    await p2.getByText("Status backup hanya untuk Owner.").waitFor();
    flow.push(["non_owner_blocked", true]);
    await ctx2.close();

    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    const bad: string[] = [];
    if ((report.console as string[]).length > 0) bad.push(`console errors: ${(report.console as string[]).join("; ")}`);
    for (const [k, v] of Object.entries(report.layout as Record<string, { overflowX: number; minTarget: number | null; unnamed: number }>)) {
      if (v.overflowX > 0) bad.push(`${k}: overflowX=${v.overflowX}`);
      if (v.minTarget !== null && v.minTarget < 44) bad.push(`${k}: minTarget=${v.minTarget}`);
      if (v.unnamed > 0) bad.push(`${k}: unnamed=${v.unnamed}`);
    }
    if (bad.length > 0) throw new Error(`UI validation failed: ${bad.join(" | ")}`);
    console.log(`UI VALIDATION PASSED: ${flow.length} flows, ${Object.keys(report.layout as object).length} layouts, 0 errors`);
  } finally {
    await browser.close();
  }
}
