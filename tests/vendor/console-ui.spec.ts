// T-129 + HYG-024 real-browser DOM & form-submission evidence (PR-87, 19 §3, RATE-5, ADR-7).
// Runs against a live built Next.js server on VENDOR_HOST with a real migrated PostgreSQL database:
//   RUN_UI=1 VENDOR_URL=... SEED=... PLAYWRIGHT_CORE=... pnpm exec vitest run tests/vendor/console-ui.spec.ts
// Proves in real headless Chromium DOM (zero mocked React hooks or stubbed helpers):
//   1. /vendor/audit: AuditExportForm reversed-date refusal (0 HTTP calls, [role="alert"]),
//      real CSV download event + [role="status"], HTTP 403 totp_not_verified [role="alert"],
//      and aborted connection [role="alert"];
//   2. /vendor/templat: TemplateSaveForm real POST to /vendor/api/console/template-save,
//      [role="status"] + router.refresh() showing persisted v1 Aktif in the table, and HTTP 403
//      totp_not_verified [role="alert"] via real post.ts;
//   3. /vendor/profil (incl. Lokasi Penyimpanan Data), /vendor/flag, and /vendor/integrasi
//      render cleanly at 390 / 820 / 1180 / 1440 with 0 overflow, 0 CSP violations, 0 console errors.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUN_UI = process.env.RUN_UI === "1";

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

describe("T-129 + HYG-024 real Chromium DOM & form submission evidence", () => {
  it.skipIf(!RUN_UI)(
    "mounts AuditExportForm, TemplateSaveForm, and all 5 wired vendor console pages in Chromium at 390/820/1180/1440",
    async () => {
      const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
      const VENDOR = process.env.VENDOR_URL!;
      const OUT = process.env.UI_OUT_DIR ?? "/tmp/t129-ui";
      const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
        password: string;
        vendor: { po: string; sup: string };
      };
      mkdirSync(OUT, { recursive: true });

      const consoleErrors: string[] = [];
      const cspViolations: string[] = [];
      const watchCsp = `document.addEventListener("securitypolicyviolation", (e) => { (window.__csp ??= []).push(e.violatedDirective + " " + (e.blockedURI || "inline")); });`;

      const browser = await chromium.launch();
      try {
        const signIn = async (email: string) => {
          const ctx = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            acceptDownloads: true,
            extraHTTPHeaders: { "x-real-ip": "203.0.113.10" },
          });
          const page = await ctx.newPage();
          page.on("console", (m: { type(): string; text(): string }) => {
            if (m.type() === "error" && !/status of 40[134]|Failed to load resource: net::ERR_FAILED/.test(m.text())) {
              consoleErrors.push(m.text().slice(0, 200));
            }
          });
          await page.addInitScript(watchCsp);
          await page.goto(`${VENDOR}/vendor/masuk`);
          await page.getByLabel("Email").fill(email);
          await page.getByLabel("Kata sandi").fill(seed.password);
          await page.getByRole("button", { name: "Masuk" }).click();
          await page.waitForURL(/\/vendor\/(aktifkan-2fa|verifikasi)$/);
          await page.getByLabel("Kata sandi").fill(seed.password);
          await page.getByRole("button", { name: "Lanjut" }).click();
          const secret = (await page.getByLabel("Kunci autentikator").innerText()).trim();
          await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
          await page.getByRole("button", { name: "Aktifkan" }).click();
          await page.waitForURL(`${VENDOR}/vendor/tenant`);
          return { ctx, page };
        };

        // 1. Platform owner: /vendor/audit, /vendor/templat, /vendor/profil, /vendor/flag
        const po = await signIn(seed.vendor.po);
        try {
          // 1a. /vendor/audit: reversed range -> 0 HTTP requests, real DOM alert
          await po.page.goto(`${VENDOR}/vendor/audit`);
          await po.page.getByRole("heading", { name: "Audit Vendor" }).waitFor();
          let exportPosts = 0;
          po.page.on("request", (req: { url(): string; method(): string }) => {
            if (req.url().includes("/vendor/api/console/audit-export") && req.method() === "POST") exportPosts += 1;
          });
          await po.page.locator("#audit-from").fill("2026-11-27");
          await po.page.locator("#audit-to").fill("2026-11-26");
          await po.page.getByRole("button", { name: "Unduh CSV Audit" }).click();
          await po.page.locator('main [role="alert"]').waitFor();
          expect(await po.page.locator('main [role="alert"]').innerText()).toBe(
            "Tanggal mulai tidak boleh lebih akhir dari tanggal selesai.",
          );
          expect(exportPosts).toBe(0);

          // 1b. /vendor/audit: valid full-day range -> real POST to DB, real CSV download + DOM status notice
          await po.page.locator("#audit-from").fill("2026-11-25");
          await po.page.locator("#audit-to").fill("2026-11-26");
          const [download] = await Promise.all([
            po.page.waitForEvent("download"),
            po.page.getByRole("button", { name: "Unduh CSV Audit" }).click(),
          ]);
          expect(download.suggestedFilename()).toBe("audit-vendor.csv");
          const dlPath = await download.path();
          expect(dlPath).toBeTruthy();
          const csvText = readFileSync(dlPath!, "utf8");
          expect(csvText.startsWith("id,at,actor_role,action,tenant_id,tenant_name,outcome,reason_code,client_ip\r\n")).toBe(true);
          await po.page.locator('main form [role="status"]').waitFor();
          expect(await po.page.locator('main form [role="status"]').innerText()).toBe("File audit-vendor.csv berhasil diunduh.");
          expect(exportPosts).toBe(1);

          // 1c. /vendor/audit: HTTP 403 totp_not_verified -> real DOM alert
          await po.page.route("**/vendor/api/console/audit-export", (route: { fulfill(o: object): Promise<void> }) =>
            route.fulfill({
              status: 403,
              contentType: "application/json",
              body: JSON.stringify({ ok: false, code: "ERR_FORBIDDEN", reason: "totp_not_verified" }),
            }),
          );
          await po.page.getByRole("button", { name: "Unduh CSV Audit" }).click();
          await po.page.locator('main [role="alert"]').waitFor();
          expect(await po.page.locator('main [role="alert"]').innerText()).toBe(
            "Verifikasi dua langkah Anda sudah lebih dari 10 menit. Keluar lalu masuk kembali untuk melanjutkan.",
          );
          await po.page.unroute("**/vendor/api/console/audit-export");

          // 1d. /vendor/audit: network drop -> real DOM connection-error alert
          await po.page.route("**/vendor/api/console/audit-export", (route: { abort(r: string): Promise<void> }) =>
            route.abort("failed"),
          );
          await po.page.getByRole("button", { name: "Unduh CSV Audit" }).click();
          await po.page.locator('main [role="alert"]').waitFor();
          expect(await po.page.locator('main [role="alert"]').innerText()).toBe("Koneksi terputus. Coba Lagi.");
          await po.page.unroute("**/vendor/api/console/audit-export");

          // 2a. /vendor/templat: real POST save + activate -> real DOM status + router.refresh() shows v1 Aktif
          await po.page.goto(`${VENDOR}/vendor/templat`);
          await po.page.getByRole("heading", { name: "Templat Global" }).waitFor();
          await po.page.locator("#tpl-kind").selectOption("syarat-ketentuan");
          await po.page.locator("#tpl-body").fill("Syarat dan ketentuan resmi {{klinik.nama}} untuk publik.");
          await po.page.getByRole("button", { name: "Simpan Versi Templat" }).click();
          await po.page.locator('main form [role="status"]').getByText("Templat v1 berhasil disimpan dan diaktifkan.").waitFor();
          await po.page.getByRole("cell", { name: "v1" }).waitFor();
          expect(await po.page.locator("main").innerText()).toContain("Aktif");

          // 2b. /vendor/templat: HTTP 403 totp_not_verified -> real post.ts translates & renders DOM alert
          await po.page.route("**/vendor/api/console/template-save", (route: { fulfill(o: object): Promise<void> }) =>
            route.fulfill({
              status: 403,
              contentType: "application/json",
              body: JSON.stringify({ ok: false, code: "ERR_FORBIDDEN", reason: "totp_not_verified" }),
            }),
          );
          await po.page.locator("#tpl-body").fill("Syarat dan ketentuan versi dua {{klinik.nama}} untuk publik.");
          await po.page.getByRole("button", { name: "Simpan Versi Templat" }).click();
          await po.page.locator('main [role="alert"]').waitFor();
          expect(await po.page.locator('main [role="alert"]').innerText()).toBe(
            "Verifikasi dua langkah Anda sudah lebih dari 10 menit. Keluar lalu masuk kembali untuk melanjutkan.",
          );
          await po.page.unroute("**/vendor/api/console/template-save");

          // 3. /vendor/profil (storageLocations) & /vendor/flag + responsive 390/820/1180/1440 checks
          const layoutReport: Record<string, number> = {};
          for (const [path, heading] of [
            ["/vendor/profil", "Profil Vendor"],
            ["/vendor/flag", "Feature Flag Platform"],
            ["/vendor/audit", "Audit Vendor"],
            ["/vendor/templat", "Templat Global"],
          ] as const) {
            for (const width of [390, 820, 1180, 1440]) {
              await po.page.setViewportSize({ width, height: 900 });
              await po.page.goto(`${VENDOR}${path}`);
              await po.page.getByRole("heading", { name: heading }).waitFor();
              if (path === "/vendor/profil" && width === 1440) {
                expect(await po.page.locator("main").innerText()).toContain("Lokasi Penyimpanan Data");
              }
              const overflow = await po.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
              layoutReport[`${path}@${width}`] = overflow;
              expect(overflow, `${path}@${width} overflowX`).toBe(0);
              const csp = await po.page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
              cspViolations.push(...csp);
            }
          }

          // 4. Support role: /vendor/integrasi at 390/820/1180/1440
          const sup = await signIn(seed.vendor.sup);
          try {
            for (const width of [390, 820, 1180, 1440]) {
              await sup.page.setViewportSize({ width, height: 900 });
              await sup.page.goto(`${VENDOR}/vendor/integrasi`);
              await sup.page.getByRole("heading", { name: "Integrasi" }).waitFor();
              const overflow = await sup.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
              layoutReport[`/vendor/integrasi@${width}`] = overflow;
              expect(overflow, `/vendor/integrasi@${width} overflowX`).toBe(0);
              const csp = await sup.page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
              cspViolations.push(...csp);
            }
          } finally {
            await sup.ctx.close();
          }

          expect(cspViolations).toEqual([]);
          expect(consoleErrors).toEqual([]);
          writeFileSync(`${OUT}/report.json`, JSON.stringify({ layoutReport, cspViolations, consoleErrors }, null, 2));
        } finally {
          await po.ctx.close();
        }
      } finally {
        await browser.close();
      }
    },
    120_000,
  );
});
