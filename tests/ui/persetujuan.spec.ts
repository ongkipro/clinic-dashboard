// T-015 browser evidence (UX-26, PR-44) at 390/820/1180/1440 and 200% text: the owner's
// inbox lists waiting requests with requester and reason, filters by type (filtered-empty),
// the detail offers Setujui only there and the decision leaves the inbox; a clinic with
// nothing waiting shows the empty state; the manager's own request shows the blocked
// state ("Anda pengaju — tidak dapat menyetujui") and a cash refund is not theirs to
// decide. Runs only on request (needs a running server and a seed):
//   RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/persetujuan.spec.ts out-dir
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
  // Minimal page surface used here (playwright-core is not a project dependency yet).
  type Locator = { first(): Locator; waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; textContent(): Promise<string | null>; innerText(): Promise<string>; count(): Promise<number>; getByRole(r: string, o?: object): Locator };
  type Page = {
    goto(u: string): Promise<unknown>; waitForURL(u: string): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
    getByLabel(t: string): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp): Locator; locator(s: string): Locator;
    addStyleTag(o: { content: string }): Promise<unknown>; evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
    on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  };
  const BASE = process.env.BASE_URL ?? "http://localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t015ui";
  const seed = JSON.parse(readFileSync(process.env.SEED ?? `${OUT}/seed.json`, "utf8")) as {
    ownerEmail: string; managerEmail: string; emptyOwnerEmail: string; stock: string; refund: string; mine: string;
  };
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

  // Sign in and enrol TOTP (owner and manager need it, IAM-1).
  async function signIn(page: Page, email: string) {
    await page.goto(`${BASE}/masuk`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/persetujuan`);
    await page.waitForURL(`${BASE}/aktifkan-2fa`);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    const secret = (await page.getByLabel("Kunci autentikator").textContent())!.trim();
    await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
    await page.getByRole("button", { name: "Aktifkan" }).click();
    await page.waitForURL(`${BASE}/`);
  }

  async function measure(page: Page, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const ctl = [...document.querySelectorAll("main a, main button, main summary, main textarea")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))),
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim())).length,
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
          await page.getByText(wait).first().waitFor();
          if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          const shoot = (zoom === 1 && (w === 390 || w === 1180)) || (zoom === 2 && w === 390);
          await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  // While the error hook breaks the inbox on purpose, React logs the server render error
  // (#441, the message hidden in production); that one is expected, nothing else is.
  let expectingRenderError = false;
  const onConsole = (m: { type(): string; text(): string }) =>
    m.type() === "error" && !m.text().includes("status of 404") && !(expectingRenderError && m.text().includes("React error #441")) &&
    (report.console as string[]).push(m.text().slice(0, 200));
  const browser = await chromium.launch();
  try {
    // Owner: list, filter, detail, decide.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("console", onConsole);
    await signIn(page, seed.ownerEmail);
    await layouts(page, [
      ["/persetujuan", "Selisih opname 3 botol", "list"],
      ["/persetujuan?jenis=disposal", "Tidak ada permintaan jenis ini", "filtered-empty"],
      [`/persetujuan/${seed.stock}`, "Selisih opname 3 botol", "detail"],
    ]);
    await page.goto(`${BASE}/persetujuan`);
    const list = await page.getByRole("list", { name: "Permintaan menunggu" }).innerText();
    flow.push(["owner inbox lists requester and reason", list.includes("Penyesuaian stok") && list.includes("Sari Apoteker") && list.includes("Selisih opname 3 botol") && list.includes("Refund tunai") && list.includes("Rp1.250.000")]);
    await page.getByRole("link", { name: "Refund tunai" }).first().waitFor();
    await page.goto(`${BASE}/persetujuan?jenis=refund_exception`);
    const filtered = await page.getByRole("list", { name: "Permintaan menunggu" }).innerText();
    flow.push(["type filter", filtered.includes("Refund tunai") && !filtered.includes("Penyesuaian stok")]);
    flow.push(["rows have no decision buttons", (await page.locator("main").getByRole("button", { name: /Setujui|Tolak/ }).count()) === 0]);
    await page.goto(`${BASE}/persetujuan/${seed.stock}`);
    await page.getByRole("button", { name: "Setujui" }).click();
    // The detail re-renders as decided (revalidated), naming who decided.
    await page.getByText(/Disetujui oleh Ibu Ratna sebagai Owner/).waitFor();
    await page.goto(`${BASE}/persetujuan`);
    flow.push(["approved request leaves the inbox", !(await page.getByRole("list", { name: "Permintaan menunggu" }).innerText()).includes("Penyesuaian stok")]);
    // Tolak needs a reason.
    await page.goto(`${BASE}/persetujuan/${seed.refund}`);
    await page.getByRole("button", { name: "Tolak" }).click();
    await page.getByLabel("Alasan penolakan").fill("Bukti pembatalan belum ada");
    await page.screenshot({ path: `${OUT}/tolak-390.png`, fullPage: true });
    await page.getByRole("button", { name: "Tolak" }).click();
    await page.getByText(/Ditolak oleh Ibu Ratna sebagai Owner · .* · Bukti pembatalan belum ada/).waitFor();
    flow.push(["rejected with a reason", true]);
    // Error state: the inbox query fails (the test revokes the app's read on approvals via
    // ERROR_HOOK), then "Coba Lagi" recovers once the hook restores it.
    if (process.env.ERROR_HOOK) {
      const { execSync } = await import("node:child_process");
      execSync(`${process.env.ERROR_HOOK} break`);
      expectingRenderError = true;
      try {
        for (const w of [390, 1440]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${BASE}/persetujuan`);
          await page.getByText("Persetujuan belum dapat ditampilkan").waitFor();
          await measure(page, `error-${w}`, `error-${w}`);
        }
      } finally {
        execSync(`${process.env.ERROR_HOOK} fix`);
      }
      await page.getByRole("button", { name: "Coba Lagi" }).click();
      await page.getByRole("list", { name: "Permintaan menunggu" }).waitFor();
      expectingRenderError = false;
      flow.push(["error state recovers with Coba Lagi", true]);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await ctx.close();

    // A clinic with nothing waiting: empty state.
    const ctxE = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pe = await ctxE.newPage();
    pe.on("console", onConsole);
    await signIn(pe, seed.emptyOwnerEmail);
    await layouts(pe, [["/persetujuan", "Tidak ada permintaan yang menunggu persetujuan", "empty"]]);
    flow.push(["empty state", true]);
    await ctxE.close();

    // Manager: own request blocked; cash refund not theirs (decided already) / stock visible.
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pm = await ctxM.newPage();
    pm.on("console", onConsole);
    await signIn(pm, seed.managerEmail);
    await layouts(pm, [[`/persetujuan/${seed.mine}`, "Anda pengaju", "blocked-own"]]);
    flow.push(["own request blocked, no Setujui", (await pm.getByRole("button", { name: "Setujui" }).count()) === 0]);
    // The manager's inbox lists only types it decides: no cash refund.
    await pm.goto(`${BASE}/persetujuan`);
    await pm.locator("main h1").first().waitFor();
    flow.push(["manager inbox without cash refunds", !(await pm.locator("main").innerText()).includes("Refund tunai")]);
    await ctxM.close();
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
