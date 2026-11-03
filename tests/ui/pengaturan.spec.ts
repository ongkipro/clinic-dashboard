// T-017 browser evidence (19 §2.17, PR-38) at 390/820/1180/1440 and 200% text: the owner's
// Pengaturan index and the Uang & Kasir group; an out-of-bounds package validity (1500 days)
// is refused naming the bound and the old value stays; a valid change shows in the value
// and the history; the reminder time changed by Admin Pusat returns to H-1 10:00 through
// Kembalikan ke default; Admin Pusat's proposal for a money setting waits "Menunggu
// persetujuan Owner" and the owner approves it in Persetujuan; a manager sees only its
// branch rows; the error state recovers. Runs only on request (needs a server and a seed):
//   RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/pengaturan.spec.ts out-dir
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
  type Locator = {
    first(): Locator; nth(i: number): Locator; filter(o: object): Locator; waitFor(): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; check(): Promise<void>;
    textContent(): Promise<string | null>; innerText(): Promise<string>; getAttribute(n: string): Promise<string | null>; count(): Promise<number>; isVisible(): Promise<boolean>;
    getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: object): Locator; getByText(t: string | RegExp): Locator; locator(s: string): Locator;
  };
  type Page = {
    goto(u: string): Promise<unknown>; waitForURL(u: string): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
    getByLabel(t: string | RegExp, o?: object): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp): Locator; locator(s: string): Locator;
    addStyleTag(o: { content: string }): Promise<unknown>; evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
    on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  };
  const BASE = process.env.BASE_URL ?? "http://localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t017ui";
  const seed = JSON.parse(readFileSync(process.env.SEED ?? `${OUT}/seed.json`, "utf8")) as { ownerEmail: string; admin_pusatEmail: string; managerEmail: string };
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
    await page.goto(`${BASE}/pengaturan`);
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
      const ctl = [...document.querySelectorAll("main a, main button, main summary, main input:not([type=hidden]), main select")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))) : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  }

  async function layouts(page: Page, paths: [string, string, string, (() => Promise<void>)?][]) {
    for (const [path, wait, name, prepare] of paths) {
      for (const w of [390, 820, 1180, 1440]) {
        for (const zoom of [1, 2]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${BASE}${path}`);
          await page.locator("main").getByText(wait).first().waitFor();
          if (prepare) await prepare();
          if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          const shoot = (zoom === 1 && (w === 390 || w === 1180)) || (zoom === 2 && w === 390);
          await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  // Within the card of one setting (its heading names it).
  const card = (page: Page, label: string | RegExp) => page.locator("main section").filter({ has: page.getByRole("heading", { name: label }) }).first();

  let expectingRenderError = false;
  const onConsole = (m: { type(): string; text(): string }) =>
    m.type() === "error" && !m.text().includes("status of 404") && !(expectingRenderError && m.text().includes("React error #441")) &&
    (report.console as string[]).push(m.text().slice(0, 200));
  const browser = await chromium.launch();
  try {
    // Owner: index, Uang & Kasir, out of bounds, valid change.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = (await ctx.newPage()) as Page;
    page.on("console", onConsole);
    await signIn(page, seed.ownerEmail);
    await layouts(page, [
      ["/pengaturan", "Uang & Kasir", "index"],
      ["/pengaturan/uang", "Masa berlaku paket default", "uang"],
      ["/pengaturan/uang", "Masa berlaku paket default", "uang-edit", async () => {
        await card(page, "Masa berlaku paket default").getByRole("button", { name: "Ubah" }).click();
        await card(page, "Masa berlaku paket default").getByLabel("Alasan").waitFor();
      }],
    ]);
    await page.goto(`${BASE}/pengaturan/uang`);
    const pkg = card(page, "Masa berlaku paket default");
    await pkg.getByRole("button", { name: "Ubah" }).click();
    await pkg.getByLabel("Masa berlaku paket default").fill("1500");
    await pkg.getByLabel("Alasan").fill("Coba di luar batas");
    await pkg.getByRole("button", { name: "Simpan" }).click();
    await pkg.getByText("Masa berlaku paket default harus 30–1095 hari.").waitFor();
    await page.screenshot({ path: `${OUT}/out-of-bounds-390.png`, fullPage: true });
    flow.push(["out of bounds named, value kept", (await pkg.innerText()).includes("365 hari")]);
    await pkg.getByLabel("Masa berlaku paket default").fill("730");
    await pkg.getByLabel("Alasan").fill("Paket dua tahun");
    await pkg.getByRole("button", { name: "Simpan" }).click();
    // The card re-renders with the new value (the editor remounts closed).
    await pkg.getByText("Riwayat (1)").waitFor();
    await page.goto(`${BASE}/pengaturan/uang`);
    const after = await card(page, "Masa berlaku paket default").innerText();
    flow.push(["valid change in value and history", after.includes("730 hari") && after.includes("Riwayat (1)")]);
    await card(page, "Masa berlaku paket default").getByText("Riwayat (1)").click();
    flow.push(["history shows old → new, who and reason", (await card(page, "Masa berlaku paket default").innerText()).includes("365 hari → 730 hari")]);

    // Admin Pusat: reminder time to 08:00, then Kembalikan ke default; propose a money setting.
    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pa = (await ctxA.newPage()) as Page;
    pa.on("console", onConsole);
    await signIn(pa, seed.admin_pusatEmail);
    await pa.goto(`${BASE}/pengaturan/komunikasi`);
    const rem = card(pa, "Jam kirim pengingat janji");
    await rem.getByRole("button", { name: "Ubah" }).click();
    await rem.getByLabel("H-1 pukul").fill("08:00");
    await rem.getByLabel("Alasan").fill("Pasien pagi");
    await rem.getByRole("button", { name: "Simpan" }).click();
    await rem.getByText("Riwayat (1)").waitFor();
    await pa.goto(`${BASE}/pengaturan/komunikasi`);
    const remText = await card(pa, "Jam kirim pengingat janji").innerText();
    report.reminderCard = remText.slice(0, 600);
    flow.push(["reminder changed to 08:00", remText.includes("H-1 pukul: 08:00")]);
    await card(pa, "Jam kirim pengingat janji").getByRole("button", { name: "Kembalikan ke default" }).click();
    await card(pa, "Jam kirim pengingat janji").getByLabel("Alasan").fill("Kembali ke jam riset");
    await pa.screenshot({ path: `${OUT}/restore-confirm-390.png`, fullPage: true });
    await card(pa, "Jam kirim pengingat janji").getByRole("button", { name: "Kembalikan ke default" }).click();
    await card(pa, "Jam kirim pengingat janji").getByText("Riwayat (2)").waitFor();
    await pa.goto(`${BASE}/pengaturan/komunikasi`);
    const restored = await card(pa, "Jam kirim pengingat janji").innerText();
    report.restoredCard = restored.slice(0, 600);
    flow.push(["restore default → H-1 10:00, audited version", restored.includes("H-1 pukul: 10:00") && restored.includes("Nilai sekarang · default") && restored.includes("Riwayat (2)")]);
    await pa.goto(`${BASE}/pengaturan/uang`);
    const fee = card(pa, "Kontrol gratis per item");
    await fee.getByRole("button", { name: "Usulkan Perubahan" }).click();
    await fee.getByLabel("Jumlah kontrol").fill("2");
    await fee.getByLabel("Alasan").fill("Dua kontrol gratis");
    await fee.getByRole("button", { name: "Kirim Usulan" }).click();
    // The card re-renders as waiting (revalidated); the editor gives way to the status.
    await fee.getByText("Menunggu persetujuan Owner").waitFor();
    await pa.goto(`${BASE}/pengaturan/uang`);
    report.draftCard = (await card(pa, "Kontrol gratis per item").innerText()).slice(0, 600);
    await card(pa, "Kontrol gratis per item").getByText("Menunggu persetujuan Owner").waitFor();
    await pa.screenshot({ path: `${OUT}/draft-390.png`, fullPage: true });
    flow.push(["draft waits for the owner", true]);
    await ctxA.close();

    // The owner (still signed in) approves the draft in Persetujuan; it takes effect.
    await page.goto(`${BASE}/persetujuan?jenis=setting_change_owner`);
    const href = await page.getByRole("list", { name: "Permintaan menunggu" }).getByRole("link", { name: /Perubahan pengaturan/ }).first().getAttribute("href");
    await page.goto(`${BASE}${href}`);
    await page.getByRole("heading", { name: "Keputusan" }).waitFor();
    report.detail = (await page.locator("main").innerText()).slice(0, 800);
    await page.getByRole("button", { name: "Setujui" }).click();
    await page.getByText(/Disetujui oleh Ibu Ratna/).waitFor();
    await page.goto(`${BASE}/pengaturan/uang`);
    const applied = await card(page, "Kontrol gratis per item").innerText();
    flow.push(["owner approval applies the draft", applied.includes("Jumlah kontrol: 2 kali") && !applied.includes("Menunggu persetujuan")]);
    await ctx.close();

    // Manager: only branch rows of its branch.
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pm = (await ctxM.newPage()) as Page;
    pm.on("console", onConsole);
    await signIn(pm, seed.managerEmail);
    await layouts(pm, [["/pengaturan/jadwal", "Peringatan pasien menunggu", "manager-jadwal"]]);
    const mj = await pm.locator("main").innerText();
    flow.push(["manager sees its branch rows only", mj.includes("Cabang Kemang") && mj.includes("Lepas slot bila terlambat") && !mj.includes("Booking online")]);
    await pm.goto(`${BASE}/pengaturan/uang`);
    await pm.getByText("Anda tidak memiliki akses ke pengaturan ini.").waitFor();
    flow.push(["manager has no money settings", true]);

    // Error state: setting_versions unreadable (ERROR_HOOK), then Coba Lagi recovers.
    if (process.env.ERROR_HOOK) {
      const { execSync } = await import("node:child_process");
      execSync(`${process.env.ERROR_HOOK} break`);
      expectingRenderError = true;
      try {
        for (const w of [390, 1440]) {
          await pm.setViewportSize({ width: w, height: 900 });
          await pm.goto(`${BASE}/pengaturan/jadwal`);
          await pm.getByText("Pengaturan belum dapat ditampilkan").waitFor();
          await measure(pm, `error-${w}`, `error-${w}`);
        }
      } finally {
        execSync(`${process.env.ERROR_HOOK} fix`);
      }
      await pm.getByRole("button", { name: "Coba Lagi" }).click();
      await pm.getByText("Peringatan pasien menunggu").first().waitFor();
      expectingRenderError = false;
      flow.push(["error state recovers with Coba Lagi", true]);
    }
    await ctxM.close();
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
