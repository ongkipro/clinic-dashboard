// T-008 browser evidence for Log Audit (UX-31) at 390/820/1180/1440 and 200% text: an
// owner signs in, enrols TOTP (the owner role requires it), opens /audit and sees the
// doctor's break-glass entry with reason and time; filters work; no session redirects to
// /masuk. Since T-030 the clinic and role come from the active context (Saya), not the
// URL: switching to a role that is not a log reader shows the permission message, URL
// selectors are ignored, and a forged context cookie for another clinic falls back to
// the account's own clinic. The seed gives the owner a second role (manager, branch B1).
// Runs only on request (it needs a running server and a seed):
//   RUN_UI=1 BASE_URL=... AUDIT_SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/audit.spec.ts out-dir
// Vitest collects *.spec.ts too; without RUN_UI it registers one skipped test and stops.
// (T-011 adds the Playwright runner; this script needs only playwright-core.)
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
const OUT = process.argv[2] ?? "/tmp/t008ui";
const seed = JSON.parse(readFileSync(process.env.AUDIT_SEED ?? `${OUT}/seed.json`, "utf8")) as { tenant: string; ownerEmail: string };
const PASSWORD = "kuda-laut berenang 2026"; // synthetic
mkdirSync(OUT, { recursive: true });

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

const report: Record<string, unknown> = { layout: {}, flow: [] };
const flow = report.flow as unknown[];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/audit`);
  await page.waitForURL(`${BASE}/masuk`);
  flow.push(["no session redirects", page.url()]);

  await page.getByLabel("Email").fill(seed.ownerEmail);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/audit`);
  await page.waitForURL(`${BASE}/aktifkan-2fa`);
  flow.push(["owner without TOTP is sent to enrol", page.url()]);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Lanjut" }).click();
  const secret = (await page.getByLabel("Kunci autentikator").textContent())!.trim();
  await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
  await page.getByRole("button", { name: "Aktifkan" }).click();
  await page.waitForURL(`${BASE}/`);

  const url = `${BASE}/audit`;
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url);
      await page.getByText("Rantai log utuh.").waitFor();
      if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      report.layout = {
        ...(report.layout as object),
        [`${w}${zoom === 2 ? "@200%" : ""}`]: await page.evaluate(() => {
          const ctl = [...document.querySelectorAll("main input:not([type=hidden]), main select, main button")];
          return {
            overflowX: document.documentElement.scrollWidth - innerWidth,
            minTarget: Math.min(...ctl.map((e) => Math.round(e.getBoundingClientRect().height))),
            unnamed: ctl.filter((e) => !(e as HTMLInputElement).labels?.length && !e.textContent?.trim()).length,
            lang: document.documentElement.lang,
            entries: document.querySelectorAll("main li").length,
          };
        }),
      };
      if (zoom === 1 || w === 390) await page.screenshot({ path: `${OUT}/audit-${w}${zoom === 2 ? "-200" : ""}.png`, fullPage: true });
    }
  }
  const text = await page.locator("main").innerText();
  flow.push(["break-glass with reason shown", text.includes("Akses darurat (break-glass)") && text.includes("Alasan: Pasien gawat, riwayat alergi diperlukan segera")]);
  flow.push(["time shown", (await page.locator("main time").count()) >= 2]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.getByText("Rantai log utuh.").waitFor();
  await page.getByRole("combobox", { name: "Aksi" }).selectOption("break_glass");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await page.waitForURL(/aksi=break_glass/);
  flow.push(["after filter url", page.url().replace(BASE, "")]);
  await page.getByText("Rantai log utuh.").waitFor();
  flow.push(["filter by action", await page.locator("main li").count()]);
  await page.getByLabel("Dari tanggal").fill("2099-01-01");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await page.waitForURL(/dari=2099-01-01/);
  await page.getByText("Tidak ada entri log untuk filter ini.").waitFor();
  flow.push(["filtered empty state", true]);
  await page.screenshot({ path: `${OUT}/audit-empty-390.png`, fullPage: true });

  // URL selectors are ignored: the active context (owner) still decides.
  await page.goto(`${BASE}/audit?klinik=00000000-0000-7000-8000-000000000000&peran=manager`);
  await page.getByText("Rantai log utuh.").waitFor();
  flow.push(["URL selectors ignored", true]);
  // A forged context cookie for another clinic falls back to the owner's own clinic.
  await ctx.addCookies([{ name: "clinic_context", value: JSON.stringify({ t: "00000000-0000-7000-8000-000000000000", r: "owner", b: null }), url: BASE }]);
  await page.goto(url);
  await page.getByText("Rantai log utuh.").waitFor();
  const fellBack = (await page.locator("main").innerText()).includes("Akses darurat (break-glass)");
  if (!fellBack) throw new Error("forged clinic cookie did not fall back to the owner's clinic");
  flow.push(["forged clinic cookie falls back", fellBack]);
  // Ganti Peran → Manajer (not a log reader): the permission message.
  await page.goto(`${BASE}/saya/peran`);
  await page.getByRole("button", { name: /^Manajer/ }).click();
  await page.waitForURL(`${BASE}/saya`);
  await page.goto(url);
  await page.getByText("Anda tidak memiliki akses ke log audit.").waitFor();
  flow.push(["role not a log reader (via Ganti Peran)", "permission message"]);
  await ctx.close();
} catch (e) {
  report.error = String(e).split("\n")[0];
  process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
}
