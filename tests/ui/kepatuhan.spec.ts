// T-019 browser evidence (UX-58, PR-97) at 390/820/1180/1440 and 200% text: the owner's
// register (empty items, vendor status only), a detail showing "Fitur … terkunci"; finance
// uploads the tax advice (the uploader sees it blocked for their own approval); the owner
// approves it and the item shows Disetujui with the gates it unlocks; the file downloads
// with its checksum; a filter with no rows; the error state recovers. Runs on request:
//   RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/kepatuhan.spec.ts out-dir
import { createHash, createHmac } from "node:crypto";
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
    first(): Locator; filter(o: object): Locator; waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>;
    setInputFiles(f: { name: string; mimeType: string; buffer: Buffer }): Promise<void>; getAttribute(n: string): Promise<string | null>;
    innerText(): Promise<string>; count(): Promise<number>; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp): Locator; getByText(t: string | RegExp): Locator;
  };
  type Page = {
    goto(u: string): Promise<unknown>; waitForURL(u: string): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
    getByLabel(t: string | RegExp): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp): Locator; locator(s: string): Locator;
    addStyleTag(o: { content: string }): Promise<unknown>; evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
    on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
    request: { get(u: string, o?: object): Promise<{ status(): number; headers(): Record<string, string>; body(): Promise<Buffer> }> };
  };
  const BASE = process.env.BASE_URL ?? "http://localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t019ui";
  const seed = JSON.parse(readFileSync(process.env.SEED ?? `${OUT}/seed.json`, "utf8")) as { ownerEmail: string; financeEmail: string };
  const PASSWORD = "kuda-laut berenang 2026"; // synthetic
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
  async function signIn(page: Page, email: string) {
    await page.goto(`${BASE}/masuk`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/kepatuhan`);
    await page.waitForURL(`${BASE}/aktifkan-2fa`);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    const secret = (await page.getByLabel("Kunci autentikator").innerText()).trim();
    await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
    await page.getByRole("button", { name: "Aktifkan" }).click();
    await page.waitForURL(`${BASE}/`);
  }
  async function measure(page: Page, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ctl = [...document.querySelectorAll("main a, main button, main summary, main input:not([type=hidden]), main select, main textarea")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  }
  async function layouts(page: Page, paths: [string, string, string][]) {
    for (const [path, wait, name] of paths) {
      for (const w of [390, 820, 1180, 1440]) {
        for (const zoom of [1, 2]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${BASE}${path}`);
          await page.locator("main").getByText(wait).first().waitFor();
          if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          const shoot = (zoom === 1 && (w === 390 || w === 1180)) || (zoom === 2 && w === 390);
          await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  let expectingRenderError = false;
  const onConsole = (m: { type(): string; text(): string }) =>
    m.type() === "error" && !m.text().includes("status of 404") && !(expectingRenderError && m.text().includes("React error #441")) &&
    (report.console as string[]).push(m.text().slice(0, 200));
  const pdf = Buffer.from(`%PDF-1.7\nSaran pajak sintetis untuk uji UI\n%%EOF\n`);
  const browser = await chromium.launch();
  try {
    // Owner: register before any evidence.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = (await ctx.newPage()) as Page;
    page.on("console", onConsole);
    await signIn(page, seed.ownerEmail);
    await layouts(page, [
      ["/kepatuhan", "Saran pajak", "register"],
      ["/kepatuhan/tax_advice", "terkunci", "detail-locked"],
      ["/kepatuhan?status=approved", "Tidak ada kewajiban dengan status ini", "filtered-empty"],
      ["/kepatuhan/vendor_pse", "kewajiban vendor", "vendor-status"],
    ]);
    await page.goto(`${BASE}/kepatuhan`);
    await page.locator("main").getByText("Kewajiban vendor (status saja)").waitFor();
    const reg = await page.locator("main").innerText();
    flow.push(["register lists tenant and vendor obligations", reg.includes("Kewajiban klinik") && reg.includes("Kewajiban vendor (status saja)") && reg.includes("Pendaftaran PSE")]);
    await page.goto(`${BASE}/kepatuhan/vendor_pse`);
    await page.locator("main").getByText("kewajiban vendor").waitFor();
    const vendor = await page.locator("main").innerText();
    flow.push(["vendor item: status only (no files, no upload)", vendor.includes("Menunggu persetujuan") && !vendor.includes("Berkas") && (await page.getByRole("button", { name: "Unggah Bukti" }).count()) === 0]);
    await page.goto(`${BASE}/kepatuhan/tax_advice`);
    await page.locator("main").getByText("terkunci").waitFor();
    flow.push(["locked copy names the feature", (await page.locator("main").innerText()).includes("Fitur PPN pada invoice terkunci sampai bukti ini disetujui")]);

    // Finance uploads; its own approval is blocked.
    const ctxF = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pf = (await ctxF.newPage()) as Page;
    pf.on("console", onConsole);
    await signIn(pf, seed.financeEmail);
    await pf.goto(`${BASE}/kepatuhan/tax_advice`);
    await pf.getByRole("button", { name: "Unggah Bukti" }).click();
    await pf.getByLabel(/Berkas \(PDF/).setInputFiles({ name: 'saran "pajak"\r\nX-Evil: 1.pdf', mimeType: "application/pdf", buffer: pdf });
    await pf.getByLabel("Disusun oleh").fill("Konsultan Pajak Sintetis");
    await pf.getByLabel("Tanggal dokumen").fill("2026-10-01");
    await pf.screenshot({ path: `${OUT}/upload-390.png`, fullPage: true });
    await pf.getByRole("button", { name: "Unggah", exact: true }).click();
    await pf.locator("main").getByText(/Versi 1: saran/).waitFor();
    flow.push(["uploader blocked from approving own file", (await pf.locator("main").innerText()).includes("Anda pengunggah berkas terbaru")]);
    // Finance (tax/accounting) uploads to the posting-map item: a 4.9 MB PDF goes through the Server Action (body limit 6 MB); 5.1 MB is refused with the size message.
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(Math.floor(4.9 * 1024 * 1024), 0x20)]);
    for (const [name, buf, expect] of [["posting-map-besar.pdf", big, "Versi 1: posting-map-besar.pdf"], ["posting-map-terlalu-besar.pdf", Buffer.alloc(Math.floor(5.1 * 1024 * 1024), 0x25), "Berkas lebih dari 5 MB."]] as const) {
      await pf.goto(`${BASE}/kepatuhan/posting_map_signoff`);
      await pf.getByRole("button", { name: "Unggah Bukti" }).click();
      await pf.getByLabel(/Berkas \(PDF/).setInputFiles({ name, mimeType: "application/pdf", buffer: buf });
      await pf.getByLabel("Disusun oleh").fill("Akuntan Sintetis");
      await pf.getByLabel("Tanggal dokumen").fill("2026-10-01");
      await pf.getByRole("button", { name: "Unggah", exact: true }).click();
      await pf.locator("main").getByText(expect).first().waitFor();
    }
    flow.push(["4.9 MB accepted, 5.1 MB refused with the size message", true]);
    await ctxF.close();

    // Owner approves; the item shows Disetujui and what it unlocks; download matches the checksum.
    await page.goto(`${BASE}/kepatuhan/tax_advice`);
    await layouts(page, [["/kepatuhan/tax_advice", "Versi 1", "detail-submitted"]]);
    await page.goto(`${BASE}/kepatuhan/tax_advice`);
    await page.getByRole("button", { name: "Tandai Disetujui" }).click();
    await page.locator("main").getByText(/Disetujui · versi 1/).waitFor();
    const approved = await page.locator("main").innerText();
    flow.push(["approved shows the unlocked features and validity", approved.includes("Ikut membuka: PPN pada invoice") && approved.includes("Berlaku sampai")]);
    const href = await page.getByRole("link", { name: /Versi 1: saran/ }).getAttribute("href");
    const res = await page.request.get(`${BASE}${href}`);
    const body = await res.body();
    const h = res.headers();
    report.downloadHeaders = { cd: h["content-disposition"], ct: h["content-type"], nosniff: h["x-content-type-options"], cache: h["cache-control"] };
    flow.push(["download matches the stored checksum", res.status() === 200 && body.equals(pdf) && h["x-checksum-sha256"] === createHash("sha256").update(pdf).digest("hex")]);
    // Attachment with a sanitised name (quotes and CRLF from the uploaded name never reach the header), nosniff, no-store.
    flow.push(["download headers safe", /^attachment; filename="[\w.-]+"$/.test(h["content-disposition"] ?? "") && h["x-content-type-options"] === "nosniff" && (h["cache-control"] ?? "").includes("no-store") && !("x-evil" in h)]);
    // Unknown or malformed ids, and a signed-out caller, get the same 404.
    const anon = await browser.newContext();
    const r404 = [
      (await page.request.get(`${BASE}/kepatuhan/berkas/00000000-0000-7000-8000-000000000000`)).status(),
      (await page.request.get(`${BASE}/kepatuhan/berkas/bukan-id`)).status(),
      (await anon.request.get(`${BASE}${href}`, { maxRedirects: 0 })).status(),
    ];
    await anon.close();
    report.download404 = r404;
    flow.push(["download refused without a readable file", r404[0] === 404 && r404[1] === 404 && r404[2] === 404]);
    await page.screenshot({ path: `${OUT}/approved-390.png`, fullPage: true });

    // Error state.
    if (process.env.ERROR_HOOK) {
      const { execSync } = await import("node:child_process");
      execSync(`${process.env.ERROR_HOOK} break`);
      expectingRenderError = true;
      try {
        for (const w of [390, 1440]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${BASE}/kepatuhan`);
          await page.getByText("Register kepatuhan belum dapat ditampilkan").waitFor();
          await measure(page, `error-${w}`, `error-${w}`);
        }
      } finally {
        execSync(`${process.env.ERROR_HOOK} fix`);
      }
      await page.getByRole("button", { name: "Coba Lagi" }).click();
      await page.locator("main").getByText("Saran pajak").first().waitFor();
      expectingRenderError = false;
      flow.push(["error state recovers with Coba Lagi", true]);
    }
    await ctx.close();
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
    process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
