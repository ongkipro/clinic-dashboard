// T-121 browser evidence (UX-30 ▸ Permintaan, PR-50) at 390/820/1180/1440 and 200% text:
// - Owner opens /privasi and navigates via the Permintaan segment to /privasi/permintaan (empty state)
// - Logs a patient-bound access request -> verifies identity -> proves request-only copy refusal through UI
//   -> confirms real copy artifact & handoff via ConfirmCopyHandoffForm -> links confirmed copy -> closes as fulfilled!
// - Logs an unbound request -> closes with attested withdrawal -> checks filtered-empty state
// - Non-officer (Admin Pusat without data_protection duty) sees PermissionState on /privasi/permintaan
// - Verifies zero patient full name or clinical sentinel leakage, zero horizontal overflow,
//   targets >= 44px, zero unnamed controls, zero console/hydration errors.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/privasi-permintaan.spec.ts out-dir
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!process.env.RUN_UI) {
  const { it } = await import("vitest");
  it.skip("browser evidence (RUN_UI=1)", () => {});
} else {
  await run();
}

function nowWibSeconds(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

async function run() {
  const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE}/index.mjs`);
  const BASE = process.env.BASE_URL!;
  const OUT = process.argv[2];
  const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as {
    password: string;
    people: { owner: { email: string }; apPlain: { email: string } };
    patient: { id: string; mrn: string; name: string };
    unconfirmedCopyId: string;
    receivedWib: string;
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
    getByLabel(text: string | RegExp): { fill(v: string): Promise<unknown>; check(): Promise<unknown>; selectOption(v: string): Promise<unknown>; textContent(): Promise<string | null> };
    getByRole(role: string, opts: { name: string; exact?: boolean }): { click(): Promise<unknown>; waitFor(): Promise<unknown> };
    getByText(text: string | RegExp): { waitFor(): Promise<unknown> };
    evaluate<T>(fn: () => T): Promise<T>;
    screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
    content(): Promise<string>;
  };

  async function signIn(page: BrowserPage, email: string, totpRole: boolean) {
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

  async function measure(page: BrowserPage, key: string, shot?: string) {
    (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea, main select, main summary")].filter(vis);
      return {
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        minTarget: ctl.length
          ? Math.min(
              ...ctl.map((e) =>
                Math.round(
                  (["checkbox", "radio"].includes((e as HTMLInputElement).type) && e.closest("label") ? e.closest("label")! : e).getBoundingClientRect().height,
                ),
              ),
            )
          : null,
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      };
    });
    if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
  }

  const browser = await chromium.launch();
  try {
    // 1. Owner full UX-30 flow including operator handoff confirmation -> link -> fulfilled closure
    const ctx1 = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.21" } });
    const page = await ctx1.newPage();
    page.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error") (report.console as string[]).push(m.text());
    });
    await page.setViewportSize({ width: 1180, height: 900 });
    await signIn(page, seed.people.owner.email, true);

    await page.goto(`${BASE}/privasi`);
    await page.getByRole("link", { name: "Permintaan", exact: true }).click();
    await page.waitForURL(`${BASE}/privasi/permintaan`);
    await page.getByText("Belum ada permintaan data pasien.").waitFor();
    flow.push(["empty_list", true]);

    for (const w of [390, 820, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await measure(page, `list_${w}`, w === 390 || w === 1440 ? `list-${w}.png` : undefined);
    }

    // Log a patient-bound access request
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.getByLabel("Waktu pertama diterima (WIB)").fill(seed.receivedWib);
    await page.getByLabel(/ID Pasien/).fill(seed.patient.id);
    await page.getByLabel(/Saya mengonfirmasi waktu pertama/).check();
    await page.getByRole("button", { name: "Catat Permintaan" }).click();
    await page.getByRole("link", { name: "Buka detail permintaan" }).waitFor();
    flow.push(["logged_access_request", true]);

    // Open detail page -> verify blocked unverified state + MRN-only projection (no patient name / clinical text)
    await page.getByRole("link", { name: "Buka detail permintaan" }).click();
    await page.waitForURL(/\/privasi\/permintaan\/[0-9a-f-]+$/);
    await page.getByText("Identitas pemohon belum diverifikasi.").waitFor();
    const htmlBefore = await page.content();
    if (htmlBefore.includes(seed.patient.name) || htmlBefore.includes("SENTINEL_KLINIS_UI")) {
      throw new Error("Privacy leak: patient full name or clinical sentinel rendered on detail page");
    }
    flow.push(["blocked_unverified", true]);

    for (const w of [390, 820, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await measure(page, `detail_unverified_${w}`, w === 390 || w === 1440 ? `detail-${w}.png` : undefined);
    }

    // 200% text scaling check at 1180
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await measure(page, "detail_200pct", "detail-200pct.png");
    await page.reload();

    // Verify identity -> confirm unconfirmed copy is REFUSED when attempting direct link through UI
    await page.getByRole("button", { name: "Verifikasi Identitas" }).click();
    await page.getByRole("heading", { name: "Konfirmasi Serah Terima Salinan RME" }).waitFor();
    flow.push(["verified_identity", true]);

    await page.getByLabel(/Catatan bukti/).fill(seed.unconfirmedCopyId);
    await page.getByLabel(/Referensi serah terima salinan/).fill("SR-BELUM-01");
    await page.getByRole("button", { name: "Tautkan Bukti" }).click();
    await page.getByText(/Salinan RME belum memiliki konfirmasi artefak/).waitFor();
    flow.push(["unconfirmed_copy_refused", true]);

    // Wait 1.1s so WIB second-precision handoff timestamp is strictly >= identity_verified_at
    await new Promise((r) => setTimeout(r, 1100));
    const handoffTime = nowWibSeconds();
    await page.getByLabel(/SHA-256 artefak salinan PDF/).fill("a".repeat(64));
    await page.getByLabel(/Waktu serah terima salinan/).fill(handoffTime);
    await page.getByLabel(/Referensi tanda terima salinan/).fill("SR-UI-2026-01");
    await page.getByRole("button", { name: "Konfirmasi Serah Terima Salinan" }).click();
    await page.getByText(/Konfirmasi artefak & serah terima salinan RME tercatat/).waitFor();
    flow.push(["confirmed_copy_handoff", true]);

    // Now confirmed copy is selected in LinkEvidenceForm -> link with matching ref
    await page.getByLabel(/Referensi serah terima salinan/).fill("SR-UI-2026-01");
    await page.getByRole("button", { name: "Tautkan Bukti" }).click();
    await page.getByText("Klaster sah").waitFor();
    flow.push(["linked_confirmed_copy", true]);

    // Close as fulfilled with confirmed delivery
    await page.getByLabel("Hasil").selectOption("fulfilled");
    await page.getByLabel(/Waktu konfirmasi serah terima/).fill(nowWibSeconds());
    await page.getByLabel(/Referensi \/ bukti serah terima/).fill("TT-UI-2026-01");
    await page.getByRole("button", { name: "Tutup Permintaan" }).click();
    await page.getByText("Salinan data telah diserahkan kepada pemohon terverifikasi").waitFor();
    flow.push(["closed_fulfilled", true]);

    // Measure verified/closed detail layout at 1180
    await measure(page, "detail_closed_1180");

    // Check filtered-empty state on list (?status=open now has 0 open while 1 closed exists)
    await page.goto(`${BASE}/privasi/permintaan?status=open`);
    await page.getByText("Tidak ada permintaan untuk filter ini.").waitFor();
    flow.push(["filtered_empty", true]);
    await ctx1.close();

    // 2. Non-officer sees PermissionState
    const ctx2 = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "203.0.113.22" } });
    const p2 = await ctx2.newPage();
    await p2.setViewportSize({ width: 1180, height: 900 });
    await signIn(p2, seed.people.apPlain.email, true);
    await p2.goto(`${BASE}/privasi/permintaan`);
    await p2.getByText("Anda tidak memiliki akses ke permintaan data pasien.").waitFor();
    await measure(p2, "permission_1180");
    flow.push(["permission_state", true]);
    await ctx2.close();

    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

    const bad: string[] = [];
    if ((report.console as string[]).length > 0) bad.push(`console errors: ${(report.console as string[]).join("; ")}`);
    for (const [k, v] of Object.entries(report.layout as Record<string, { overflowX: number; minTarget: number | null; unnamed: number }>)) {
      if (v.overflowX > 0) bad.push(`${k}: overflowX=${v.overflowX}`);
      if (v.minTarget !== null && v.minTarget < 44) bad.push(`${k}: minTarget=${v.minTarget}`);
      if (v.unnamed > 0) bad.push(`${k}: unnamed=${v.unnamed}`);
    }
    if (bad.length > 0) {
      throw new Error(`UI validation failed: ${bad.join(" | ")}`);
    }
    console.log(`UI VALIDATION PASSED: ${flow.length} flows, ${Object.keys(report.layout as object).length} layouts, 0 errors`);
  } finally {
    await browser.close();
  }
}
