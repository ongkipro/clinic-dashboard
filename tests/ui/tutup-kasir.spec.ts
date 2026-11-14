// T-085 browser evidence (Tutup Kasir, UX-15, PR-19) at 390/820/1180/1440 and 200 % text: the FO sees its open shift with the
// expectation per tender and counts the drawer (a difference asks for the reason; a zero difference closes at once); the next payment
// would open a new shift; Buka Kasir with a float from the empty state; a short count waits for a manager, who approves it in
// Persetujuan; an escalated count shows "Di atas batas Anda" to the manager and the owner approves it; a rejected count goes to Hitung
// Ulang; the FO cannot open another cashier's shift; the auditor reads masked without forms; admin pusat has no access. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/tutup-kasir.spec.ts out-dir
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
  password: string; people: Record<string, { email: string; staffId: string }>; branches: Record<string, string>;
  shifts: { old: string; open: string; waiting: string; esc: string }; approvals: { waiting: string; esc: string };
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
type Locator = {
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator; uncheck(): Promise<void>; inputValue(): Promise<string>; setInputFiles(f: { name: string; mimeType: string; buffer: Buffer }): Promise<void>;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; getAttribute(n: string): Promise<string | null>; selectOption(v: string | object): Promise<unknown>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; url(): string; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>; reload(): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
};
async function signIn(page: Page, email: string, totpRole: boolean) {
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
async function measure(page: Page, key: string, shot?: string) {
  (report.layout as Record<string, unknown>)[key] = await page.evaluate(() => {
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const ctl = [...document.querySelectorAll("main a, main button, main input:not([type=hidden]), main textarea, main select, main summary")].filter(vis);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round((["checkbox", "radio"].includes((e as HTMLInputElement).type) && (e.closest("label") ?? e.closest("li")) ? (e.closest("label") ?? e.closest("li"))! : e).getBoundingClientRect().height))) : null,
      smallest: ctl.map((e) => { const t = (["checkbox", "radio"].includes((e as HTMLInputElement).type) && (e.closest("label") ?? e.closest("li")) ? (e.closest("label") ?? e.closest("li"))! : e); return [Math.round(t.getBoundingClientRect().height), `${t.tagName}.${(t.getAttribute("type") ?? "")}:${(t.textContent ?? "").trim().slice(0, 30)}`] as const; })
        .filter(([hgt]) => hgt < 44).slice(0, 4).map(([hgt, d]) => `${hgt}:${d}`),
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      // Text squeezed to a sliver: a block narrower than four characters of its own font that breaks onto more than
      // three lines (one letter per line at 200 %); visually hidden text (sr-only) is not laid out for reading.
      squeezed: [...document.querySelectorAll("main dd, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight) || em * 1.2;
        return !e.classList.contains("sr-only") && cs.display !== "inline" && r.width > 0 && r.width < 4 * em && r.height > 3 * lh && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}:${(e.textContent || "").trim().slice(0, 30)}`),
      // when the page scrolls sideways, name what sticks out anywhere in the document (no tolerance)
      overflowBy: document.documentElement.scrollWidth > innerWidth
        ? [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth).slice(0, 4).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 50)}@${e.getBoundingClientRect().right.toFixed(1)}`)
        : [],
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}@${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}/${innerWidth}`),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, name: string, prep?: () => Promise<void>) {
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE}${path}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      if (prep) await prep();
      if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForTimeout(150);
      const shoot = (zoom === 1 && (w === 390 || w === 1440)) || (zoom === 2 && w === 390);
      await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${path}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
}
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();
  const open = async (who: string, ip: string, totpRole = false) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const L = "/kasir/tutup";
  const S = (id: string) => `${L}/${id}`;
  const approve = async (p: Page, id: string, yes: boolean, reason?: string) => {
    await p.goto(`${BASE}/persetujuan/${id}`);
    await p.getByRole("heading", { level: 1 }).waitFor();
    if (yes) {
      await p.getByRole("button", { name: "Setujui" }).first().click();
    } else {
      await p.getByRole("button", { name: "Tolak", exact: true }).click();
      await p.getByLabel("Alasan penolakan").fill(reason ?? "Hitung ulang");
      await p.getByRole("button", { name: "Tolak", exact: true }).click(); // the submit (the first Tolak turned into the reason field)
    }
    await p.waitForTimeout(1500);
  };

  // FO Rina: her open shift on the page; the expectation per tender; a short count asks for the reason.
  const fo = await open("fo", "203.0.113.251");
  await fo.p.goto(`${BASE}${L}`);
  await fo.p.getByRole("region", { name: "Shift saya" }).waitFor();
  const l0 = await main(fo.p);
  flow.push(["FO sees her open shift (float Rp200.000) and only her own shifts", /Modal awal Rp200\.000/.test(l0) && !/Doni Kasir|Sari Kasir/.test(l0) && /Selesai/.test(l0)]);
  await layouts(fo.p, L, "tutup");
  await fo.p.goto(`${BASE}${S(seed.shifts.open)}`);
  await fo.p.getByRole("form", { name: "Tutup kasir" }).waitFor();
  const d0 = await main(fo.p);
  flow.push(["the expectation per tender: Tunai Rp500.000 (float + Rp300.000), EDC Rp100.000 to match with the slip",
    /Tunai · Rp500\.000/.test(d0) && /EDC · Rp100\.000/.test(d0) && /Cocokkan dengan slip EDC/.test(d0)]);
  await layouts(fo.p, S(seed.shifts.open), "shift-open", async () => { await fo.p.getByRole("form", { name: "Tutup kasir" }).waitFor(); });
  const f = fo.p.getByRole("form", { name: "Tutup kasir" });
  await f.getByLabel("Uang tunai di laci (Rp)").fill("480000");
  await f.getByLabel("Alasan selisih").waitFor();
  const live = await f.innerText();
  await f.getByRole("button", { name: "Tutup Kasir" }).click();
  await fo.p.getByRole("alert").filter({ hasText: "alasan selisih" }).first().waitFor();
  flow.push(["a difference shows live (Selisih −Rp20.000, to a manager) and the reason is required", /Selisih −Rp20\.000/.test(live) && /persetujuan manajer/.test(live)]);
  await measure(fo.p, "shift-count-error-1440", "shift-count-error-1440");
  // the exact count closes at once
  const g = fo.p.getByRole("form", { name: "Tutup kasir" });
  await g.getByLabel("Uang tunai di laci (Rp)").fill("500.000");
  await g.getByRole("button", { name: "Tutup Kasir" }).click();
  await fo.p.getByRole("status").filter({ hasText: "Hitungan dikirim" }).first().waitFor();
  // (a server redirect to ?dikirim=1)
  await fo.p.reload();
  await fo.p.getByRole("heading", { level: 1 }).waitFor();
  const d1 = await main(fo.p);
  flow.push(["no difference: the shift is closed at once (Selesai, no form, payments locked copy)", /Selesai/.test(d1) && /Pembayaran baru masuk ke shift berikutnya/.test(d1)
    && (await fo.p.getByRole("form", { name: "Tutup kasir" }).count()) === 0]);
  await layouts(fo.p, S(seed.shifts.open), "shift-closed");
  // the empty "shift saya": Buka Kasir with a float
  await fo.p.goto(`${BASE}${L}`);
  await fo.p.getByRole("form", { name: "Buka kasir" }).waitFor();
  await layouts(fo.p, L, "tutup-buka", async () => { await fo.p.getByRole("form", { name: "Buka kasir" }).waitFor(); });
  await fo.p.getByRole("form", { name: "Buka kasir" }).getByLabel("Modal awal (Rp)").fill("150.000");
  await fo.p.getByRole("button", { name: "Buka Kasir" }).click();
  await fo.p.waitForURL(/\/kasir\/tutup\/[0-9a-f-]{36}$/);
  await fo.p.getByRole("form", { name: "Tutup kasir" }).waitFor();
  flow.push(["Buka Kasir opens a shift with Modal awal Rp150.000", /Modal awal Rp150\.000/.test(await main(fo.p))]);
  // another cashier's shift: not found
  await fo.p.goto(`${BASE}${S(seed.shifts.waiting)}`);
  await fo.p.getByText("Shift tidak ditemukan.").waitFor();
  flow.push(["the FO cannot open another cashier's shift (not found)", !/Doni Kasir/.test(await main(fo.p))]);
  // the segment filter: filtered-empty
  await fo.p.goto(`${BASE}${L}?status=recount`);
  await fo.p.getByText("Tidak ada shift untuk filter ini.").waitFor();
  await layouts(fo.p, `${L}?status=recount`, "tutup-filtered-empty");
  await fo.c.close();

  // Manager Budi: the branch's shifts; approves Doni's short count; the escalated one is the owner's.
  const mgr = await open("mgr", "203.0.113.252", true);
  await mgr.p.goto(`${BASE}${L}?status=pending_approval`);
  await mgr.p.getByText(/Doni Kasir/).first().waitFor();
  const m0 = await main(mgr.p);
  flow.push(["the manager lists the branch's waiting shifts (Doni, Sari with Ke Owner)", /Doni Kasir/.test(m0) && /Sari Kasir/.test(m0) && /Ke Owner/.test(m0)]);
  await layouts(mgr.p, `${L}?status=pending_approval`, "tutup-manager");
  await mgr.p.goto(`${BASE}${S(seed.shifts.esc)}`);
  await mgr.p.getByRole("heading", { name: "Persetujuan" }).waitFor();
  const m1 = await main(mgr.p);
  flow.push(["an escalated count: Menunggu persetujuan Owner and Di atas batas Anda for the manager, no link to decide",
    /Menunggu persetujuan Owner/.test(m1) && /Di atas batas Anda — diteruskan ke Owner/.test(m1) && (await mgr.p.getByRole("link", { name: "Buka di Persetujuan" }).count()) === 0]);
  await layouts(mgr.p, S(seed.shifts.esc), "shift-escalated");
  // review r1 P2-2: the Persetujuan detail of the escalated count blocks the manager (the role rule of the type)
  await mgr.p.goto(`${BASE}/persetujuan/${seed.approvals.esc}`);
  await mgr.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the manager's Persetujuan detail of the escalated count: Jenis ini diputuskan peran lain, no Setujui",
    /Jenis ini diputuskan peran lain/.test(await main(mgr.p)) && (await mgr.p.getByRole("button", { name: "Setujui" }).count()) === 0]);
  await approve(mgr.p, seed.approvals.waiting, true);
  await mgr.p.goto(`${BASE}${S(seed.shifts.waiting)}`);
  await mgr.p.getByRole("heading", { level: 1 }).waitFor();
  const m2 = await main(mgr.p);
  flow.push(["the manager approves Doni's short count: Selesai, Disetujui oleh Budi Manajer sebagai Manajer", /Selesai/.test(m2) && /Disetujui oleh Budi Manajer sebagai Manajer/.test(m2)]);
  await mgr.c.close();

  // Owner: rejects Sari's escalated count → Hitung Ulang; Sari re-counts.
  const own = await open("own", "203.0.113.253", true);
  await approve(own.p, seed.approvals.esc, false, "Hitung ulang laci, uang lebih belum jelas");
  await own.p.goto(`${BASE}${S(seed.shifts.esc)}`);
  await own.p.getByRole("heading", { level: 1 }).waitFor();
  const o1 = await main(own.p);
  flow.push(["the owner rejects the escalated count: Hitung ulang with the reason shown in the history", /Hitung ulang/.test(o1) && /Ditolak oleh Ibu Pemilik sebagai Owner/.test(o1)]);
  await own.c.close();
  const fo3 = await open("fo3", "203.0.113.254");
  await fo3.p.goto(`${BASE}${S(seed.shifts.esc)}`);
  await fo3.p.getByRole("form", { name: "Hitung ulang" }).waitFor();
  await layouts(fo3.p, S(seed.shifts.esc), "shift-recount", async () => { await fo3.p.getByRole("form", { name: "Hitung ulang" }).waitFor(); });
  const h = fo3.p.getByRole("form", { name: "Hitung ulang" });
  await h.getByLabel("Uang tunai di laci (Rp)").fill("100000");
  await h.getByRole("button", { name: "Hitung Ulang" }).click();
  await fo3.p.getByRole("status").filter({ hasText: "Hitungan dikirim" }).first().waitFor();
  // (a server redirect to ?dikirim=1)
  await fo3.p.reload();
  await fo3.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["Sari re-counts exactly: closed with two counts in the history", /Selesai/.test(await main(fo3.p)) && /Hitungan 2/.test(await main(fo3.p))]);
  await fo3.c.close();

  // Auditor: reads masked, no forms; admin pusat: no access.
  const au = await open("au", "203.0.113.255", true);
  await au.p.goto(`${BASE}${S(seed.shifts.waiting)}`);
  await au.p.getByRole("heading", { level: 1 }).waitFor();
  const a1 = await main(au.p);
  flow.push(["the auditor reads the shift without the reason and without forms", !/Kembalian salah hitung/.test(a1) && (await au.p.getByRole("form").count()) === 0]);
  await au.c.close();
  const ap = await open("ap", "203.0.113.250", true);
  await ap.p.goto(`${BASE}${L}`);
  await ap.p.getByText("Anda tidak memiliki akses ke tutup kasir.").waitFor();
  await layouts(ap.p, L, "tutup-blocked-role");
  flow.push(["admin pusat has no access to Tutup Kasir", !/Rina Kasir/.test(await main(ap.p))]);
  await ap.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
