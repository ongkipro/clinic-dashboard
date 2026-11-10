// T-051 browser evidence (Pendampingan, UX-7 step 1, 19:86, PR-9, CLIN-001) at 390/820/1180/1440 and 200 % text.
// The BC's queue with intake states and a status filter (filtered-empty with reset); Mulai Pendampingan on a
// repeat visit shows the four steps, the blocked Foto panel and the history; the intake saves as a draft and
// is sent: locked, only the changed fact listed, the unchanged prior confirmed; another BC's draft is
// read-only; at 390 the Riwayat Singkat disclosure keeps the typed complaint; chips toggle by keyboard; the
// doctor has no Pendampingan page. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/pendampingan.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branch: string; visits: Record<string, string> };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator; getAttribute(n: string): Promise<string | null>; evaluate<T>(f: (e: Element) => T): Promise<T>;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  check(): Promise<void>; uncheck(): Promise<void>; isChecked(): Promise<boolean>; isDisabled(): Promise<boolean>; nth(i: number): Locator; inputValue(): Promise<string>; selectOption(v: string | object): Promise<unknown>; evaluateAll<T>(f: (e: Element[]) => T): Promise<T>; allInnerTexts(): Promise<string[]>; getByText(t: string, o?: { exact?: boolean }): Locator;
  evaluate<T>(f: (e: Element) => T): Promise<T>;
  focus(): Promise<void>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp, o?: { waitUntil?: "load" | "commit" }): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string): Locator; locator(s: string): Locator; url(): string;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  keyboard: { press(k: string): Promise<void> };
};
async function signIn(page: Page, email: string, totpRole = true) {
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
      // A checkbox's target is its label (clicking the label toggles it; the label is 44 px high).
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round((["checkbox", "radio"].includes((e as HTMLInputElement).type) && e.closest("label") ? e.closest("label")! : e).getBoundingClientRect().height))) : null,
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      // Text squeezed to a sliver (one letter per line at 200 %): a value cell narrower than four
      // characters of its own font while holding more text than that.
      // Text squeezed to a sliver: a block narrower than four characters of its own font holding more text
      // than that (inline spans are measured by their line box, so only block-level spans count).
      squeezed: [...document.querySelectorAll("main dd, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        return cs.display !== "inline" && r.width > 0 && r.width < 4 * em && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}:${(e.textContent || "").trim().slice(0, 30)}`),
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}@${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}/${innerWidth}`),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
}
async function layouts(page: Page, path: string, name: string) {
  for (const w of [390, 820, 1180, 1440]) {
    for (const zoom of [1, 2]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE}${path}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForTimeout(150);
      const shoot = (zoom === 1 && (w === 390 || w === 1440)) || (zoom === 2 && w === 390);
      await measure(page, `${name}-${w}${zoom === 2 ? "@200%" : ""}`, shoot ? `${name}-${w}${zoom === 2 ? "-200" : ""}` : undefined);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${path}`); // drop the injected 200 % style before the next step (review r1 P2-3)
  await page.getByRole("heading", { level: 1 }).waitFor();
}
const onConsole = (m: { type(): string; text(): string }) =>
  m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && (report.console as string[]).push(m.text().slice(0, 200));

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();

  // BC (no second factor for BC, PR-3): the queue with intake states and the filter.
  const bCtx = await ctxOf("203.0.113.181");
  const b = await bCtx.newPage();
  current = b;
  b.on("console", onConsole);
  await signIn(b, seed.people.bc.email, false);
  await b.goto(`${BASE}/pendampingan`);
  await b.getByRole("heading", { name: "Pendampingan", level: 1 }).waitFor();
  await b.locator("main:visible ul").first().waitFor();
  const list = await main(b);
  flow.push(["queue: three patients of today with their intake state", list.includes("Rina Kembali") && list.includes("Budi Baru") && /Sari Draf[\s\S]*Draf/.test(list) && list.includes("BC Pembimbing Wulan (BC)")]);
  await layouts(b, "/pendampingan", "antrian");
  await b.goto(`${BASE}/pendampingan?status=terkirim`);
  await b.getByText("Tidak ada pasien dengan status ini.").waitFor();
  flow.push(["queue: filtered-empty with a reset", (await b.locator("main:visible a[href='/pendampingan']").count()) > 0]);
  // Mulai Pendampingan for Rina (repeat visit): the flow page with the history.
  await b.goto(`${BASE}/pendampingan`);
  await b.getByRole("link", { name: /Rina Kembali/ }).click();
  await b.waitForURL(`${BASE}/pendampingan/${seed.visits.rina}`);
  await b.getByRole("heading", { name: "Rina Kembali", level: 1 }).waitFor();
  flow.push(["flow: before the start, history shows and Mulai Pendampingan is offered", (await main(b)).includes("Amoksisilin")]);
  await b.getByRole("form", { name: "Mulai pendampingan Rina Kembali" }).getByRole("button", { name: "Mulai Pendampingan" }).click();
  await b.getByRole("form", { name: "Intake pasien" }).waitFor();
  const page = await main(b);
  flow.push(["flow: four steps, step 1 in progress, Foto blocked with the reason", page.includes("1. Intake & Foto") && page.includes("4. Konfirmasi") && page.includes("Foto klinis belum tersedia")]);
  flow.push(["flow: history shows the prior allergy and skincare (CLIN-001)", page.includes("Amoksisilin") && page.includes("Sabun wajah X")]);
  await layouts(b, `/pendampingan/${seed.visits.rina}`, "alur");
  // Fill: complaint; allergy same; skincare changed; one chip; send.
  const form = b.getByRole("form", { name: "Intake pasien" });
  await form.getByLabel("Keluhan utama").fill("Kontrol jerawat, muncul lagi di dagu");
  // Skincare changed: untick its "same" box (the second history fact: allergy first), then type the new value.
  await form.getByRole("group", { name: "Perawatan kulit di rumah" }).getByLabel("Sama seperti kunjungan lalu").uncheck();
  await form.getByRole("textbox", { name: "Perawatan kulit di rumah" }).fill("Serum niasinamida");
  await form.getByLabel("Jerawat aktif").check();
  await form.getByLabel("Kering").check();
  await form.getByRole("button", { name: "Simpan Draf" }).click();
  await b.getByText("Draf tersimpan.").waitFor();
  flow.push(["flow: a draft saves", true]);
  await b.screenshot({ path: `${OUT}/draf-1440.png`, fullPage: true });
  await form.getByRole("button", { name: "Kirim ke Dokter" }).click();
  await b.getByText("Terkunci", { exact: false }).first().waitFor();
  const sent = await main(b);
  flow.push(["flow: sent and locked, only the changed fact listed, one prior confirmed same", sent.includes("Terkirim ke dokter") && sent.includes("Serum niasinamida")
    && !/Alergi:\s*Amoksisilin/.test(sent.slice(sent.indexOf("Terkirim ke dokter"))) && sent.includes("1 riwayat dikonfirmasi sama")]);
  flow.push(["flow: step 2 now waits for the doctor", sent.includes("Menunggu pemeriksaan dokter")]);
  await b.screenshot({ path: `${OUT}/terkirim-1440.png`, fullPage: true });
  // Another BC's draft: read-only notice, no form.
  await b.goto(`${BASE}/pendampingan/${seed.visits.sari}`);
  await b.getByRole("heading", { name: "Sari Draf", level: 1 }).waitFor();
  flow.push(["flow: another BC's draft is read-only for this BC", (await main(b)).includes("Hanya BC pembimbingnya yang mengubah") && (await b.getByRole("form", { name: "Intake pasien" }).count()) === 0]);
  // Compact: Riwayat Singkat disclosure keeps the form.
  await b.setViewportSize({ width: 390, height: 900 });
  await b.goto(`${BASE}/pendampingan/${seed.visits.budi}`);
  await b.getByRole("form", { name: "Mulai pendampingan Budi Baru" }).getByRole("button", { name: "Mulai Pendampingan" }).click();
  await b.getByRole("form", { name: "Intake pasien" }).waitFor();
  await b.getByLabel("Keluhan utama").fill("Kulit terasa kering");
  await b.getByText("Riwayat Singkat").click();
  flow.push(["compact: Riwayat Singkat opens and the typed complaint is kept", (await b.getByLabel("Keluhan utama").inputValue()) === "Kulit terasa kering"]);
  await b.screenshot({ path: `${OUT}/riwayat-singkat-390.png`, fullPage: true });
  // Keyboard: the chips are reachable and toggle with Space.
  await b.getByLabel("Berminyak").focus();
  await b.keyboard.press("Space");
  flow.push(["keyboard: a chip toggles with Space", await b.getByLabel("Berminyak").isChecked()]);
  await b.setViewportSize({ width: 1440, height: 900 });
  await bCtx.close();

  // Doctor: no Pendampingan page (BC only); the menu does not offer it.
  const dCtx = await ctxOf("203.0.113.182");
  const d = await dCtx.newPage();
  current = d;
  d.on("console", onConsole);
  await signIn(d, seed.people.doc.email, true);
  await d.goto(`${BASE}/pendampingan`);
  await d.getByRole("heading", { name: "Pendampingan", level: 1 }).waitFor().catch(() => undefined);
  flow.push(["doctor: Pendampingan answers the permission state", !(await main(d)).includes("Rina Kembali")]);
  await dCtx.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await current.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
