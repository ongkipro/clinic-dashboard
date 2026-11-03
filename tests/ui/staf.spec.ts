// T-031 browser evidence (UX-3, PR-91) at 390/820/1180/1440 and 200% text: the owner sees
// Staf, Undangan and Kredensial segments, a staff detail with sessions, Pengguna & Akses
// with duties, change log and the read-only matrix; creates an invitation, the invited
// person accepts it from the link and signs in; the owner revokes that new session and
// the device is signed out on its next request. Runs only on request (needs a running
// server and a seed):
//   RUN_UI=1 BASE_URL=... STAF_SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/staf.spec.ts out-dir
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
  const BASE = process.env.BASE_URL ?? "http://localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t031ui";
  const seed = JSON.parse(readFileSync(process.env.STAF_SEED ?? `${OUT}/seed.json`, "utf8")) as { ownerEmail: string; newEmail: string };
  const PASSWORD = "kuda-laut berenang 2026"; // synthetic
  const NEW_PASSWORD = "camar putih terbang 2026"; // synthetic
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

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200)));
    await page.goto(`${BASE}/masuk`);
    await page.getByLabel("Email").fill(seed.ownerEmail);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/staf`);
    await page.waitForURL(`${BASE}/aktifkan-2fa`);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    const secret = (await page.getByLabel("Kunci autentikator").textContent())!.trim();
    await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
    await page.getByRole("button", { name: "Aktifkan" }).click();
    await page.waitForURL(`${BASE}/`);

    // Invite a new front-desk staff member (the link is shown once).
    await page.goto(`${BASE}/staf`);
    await page.getByRole("button", { name: "Undang" }).click();
    const sheet = page.getByRole("dialog", { name: "Undang Staf" });
    await sheet.getByLabel("Nama").fill("Dewi FO Baru");
    await sheet.getByLabel("Email").fill(seed.newEmail);
    await sheet.getByLabel("FO/Kasir").check();
    await sheet.getByLabel("Cabang Kemang").check();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/undang-390.png` });
    await sheet.getByRole("button", { name: "Buat Undangan" }).click();
    const linkBox = sheet.getByLabel("Tautan undangan");
    await linkBox.waitFor();
    const link = await linkBox.inputValue();
    flow.push(["invitation link created", /\/undangan\/[A-Za-z0-9_-]{30,}$/.test(link)]);
    await page.keyboard.press("Escape");

    // Layouts of every page (owner).
    const pages = ["/staf", "/staf?segmen=undangan", "/staf?segmen=kredensial", "/pengguna-akses"];
    for (const path of pages) {
      for (const w of [390, 820, 1180, 1440]) {
        for (const zoom of [1, 2]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(`${BASE}${path}`);
          await page.locator("main h1, main h2").first().waitFor();
          if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          (report.layout as Record<string, unknown>)[`${path}-${w}${zoom === 2 ? "@200%" : ""}`] = await page.evaluate(() => {
            const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const ctl = [...document.querySelectorAll("main a, main button, main summary")].filter(vis);
            // The permission matrix scrolls inside its own region; the page itself must not.
            return {
              overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
              minTarget: Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))),
              unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim())).length,
            };
          });
          if ((zoom === 1 && (w === 390 || w === 1180)) || (zoom === 2 && w === 390)) {
            const name = path.replace("/", "").replace("?segmen=", "-") || "root";
            await page.screenshot({ path: `${OUT}/${name}-${w}${zoom === 2 ? "-200" : ""}.png`, fullPage: true });
          }
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/staf`);
    flow.push(["staff list", (await page.getByRole("list", { name: "Daftar staf" }).innerText()).replace(/\s+/g, " ").slice(0, 200)]);
    await page.goto(`${BASE}/staf?segmen=undangan`);
    await page.getByRole("list", { name: "Undangan" }).waitFor();
    flow.push(["invitation pending", (await page.locator("main").innerText()).includes("Dewi FO Baru") && (await page.locator("main").innerText()).includes("Menunggu")]);
    await page.goto(`${BASE}/staf?segmen=kredensial`);
    await page.getByRole("list", { name: "Status kredensial" }).waitFor();
    flow.push(["credential segment", (await page.locator("main").innerText()).includes("Belum diverifikasi")]);
    await page.goto(`${BASE}/pengguna-akses`);
    await page.getByRole("heading", { name: "Matriks hak akses" }).waitFor();
    const access = await page.locator("main").innerText();
    flow.push(["access page sections", ["Sesi per staf", "Tugas", "Log perubahan akses", "Matriks hak akses", "Undangan dibuat"].every((t) => access.includes(t))]);

    // The invited person accepts the link in another browser and signs in.
    const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await other.newPage();
    await p2.goto(link);
    await p2.getByRole("heading", { name: "Undangan Staf" }).waitFor();
    await p2.getByText(/Dewi FO Baru/).first().waitFor(); // streamed after the heading (Suspense)
    flow.push(["invite page shows clinic and person", (await p2.locator("main").innerText()).includes("PT Klinik Aurelia Sintetis") && (await p2.locator("main").innerText()).includes("Dewi FO Baru")]);
    await p2.screenshot({ path: `${OUT}/terima-390.png`, fullPage: true });
    await p2.getByLabel("Kata sandi baru").fill(NEW_PASSWORD);
    await p2.getByLabel("Ulangi kata sandi").fill(NEW_PASSWORD);
    await p2.getByRole("button", { name: "Terima Undangan" }).click();
    await p2.waitForURL(/\/masuk\?undangan=diterima/);
    await p2.getByText(/Undangan diterima\./).waitFor();
    flow.push(["accepted → Masuk with confirmation", true]);
    await p2.getByLabel("Email").fill(seed.newEmail);
    await p2.getByLabel("Kata sandi").fill(NEW_PASSWORD);
    await p2.getByRole("button", { name: "Masuk" }).click();
    await p2.waitForURL(`${BASE}/`);
    await p2.goto(`${BASE}/saya/cabang`);
    flow.push(["new staff signed in with the invited role", (await p2.locator("main [data-slot=active-context]").innerText()).includes("Sebagai FO/Kasir")]);
    await p2.goto(link);
    await p2.getByText(/Undangan sudah tidak berlaku\./).waitFor();
    flow.push(["link used once", true]);

    // PR-91: the owner revokes the new staff member's session; the device is signed out.
    await page.goto(`${BASE}/staf`);
    await page.getByRole("link", { name: /Dewi FO Baru/ }).click();
    await page.getByRole("heading", { name: "Sesi Aktif" }).waitFor();
    await page.screenshot({ path: `${OUT}/detail-390.png`, fullPage: true });
    const started = Date.now();
    await page.getByRole("button", { name: "Cabut Sesi" }).first().click();
    // The page re-renders with the session marked "dicabut" (the button goes away).
    await page.getByText(/· dicabut/).waitFor();
    await p2.goto(`${BASE}/saya/cabang`);
    await p2.waitForURL(`${BASE}/masuk`);
    flow.push(["revoked device signed out", true]);
    flow.push(["seconds from revoke to signed out", Math.round((Date.now() - started) / 1000)]);
    await other.close();
    await ctx.storageState({ path: `${OUT}/state.json` });
    await ctx.close();
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
