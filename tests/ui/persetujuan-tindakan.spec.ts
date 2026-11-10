// T-054 browser evidence (Persetujuan Tindakan, UX-39, 17:255, 19:89, PR-11, CLIN-022) at 390/820/1180/1440 and
// 200 % text. The doctor's list with consent states and a filter (filtered-empty with reset); a visit page with
// items, the contraindication review, the generated text, the signature pad (≥ 320 × 160, Ulangi) and Tanda
// Tangani; an adult signs, a minor needs a guardian; an outdated consent after a dose change asks for re-consent;
// withdrawal with a reason; the nurse captures too; FO has no page. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/persetujuan-tindakan.spec.ts out-dir
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
  check(): Promise<void>; uncheck(): Promise<void>; isChecked(): Promise<boolean>; isDisabled(): Promise<boolean>; nth(i: number): Locator; inputValue(): Promise<string>; selectOption(v: string | object): Promise<unknown>; evaluateAll<T>(f: (e: Element[]) => T): Promise<T>; allInnerTexts(): Promise<string[]>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
  evaluate<T>(f: (e: Element) => T): Promise<T>;
  focus(): Promise<void>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp, o?: { waitUntil?: "load" | "commit" }): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp): Locator; locator(s: string): Locator; url(): string;
  evaluate<T>(f: () => T): Promise<T>; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; addStyleTag(o: { content: string }): Promise<unknown>;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  keyboard: { press(k: string): Promise<void> };
  mouse: { move(x: number, y: number, o?: { steps?: number }): Promise<void>; down(): Promise<void>; up(): Promise<void> };
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

// Draws a stroke across the signature pad with the mouse. The page is server-rendered first: a stroke before
// hydration draws nothing, so it waits for the pad to report the signature and draws again if needed.
async function draw(page: Page) {
  const pad = page.getByRole("img", { name: "Kotak tanda tangan pasien atau wali" });
  for (let attempt = 0; attempt < 5; attempt++) {
    await pad.scrollIntoViewIfNeeded(); // mouse coordinates are viewport coordinates: the pad must be on screen
    const box = (await pad.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 8 });
    await page.mouse.move(box.x + box.width - 20, box.y + box.height - 30, { steps: 8 });
    await page.mouse.up();
    if ((await page.getByText("Tanda tangan siap disimpan.").count()) > 0) return box;
    await page.waitForTimeout(400);
  }
  throw new Error("the signature pad did not take a stroke");
}

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();

  const dCtx = await ctxOf("203.0.113.201");
  const d = await dCtx.newPage();
  current = d;
  d.on("console", onConsole);
  await signIn(d, seed.people.doc.email, true);
  await d.goto(`${BASE}/persetujuan-tindakan`);
  await d.getByRole("heading", { name: "Persetujuan Tindakan", level: 1 }).waitFor();
  await d.locator("main:visible ul").first().waitFor();
  const list = await main(d);
  flow.push(["list: three patients with their consent state", /Sari Perlu[\s\S]*Belum ada persetujuan/.test(list) && /Rina Berubah[\s\S]*Perlu persetujuan ulang/.test(list) && list.includes("Dewi Remaja")]);
  await layouts(d, "/persetujuan-tindakan", "daftar");
  await d.goto(`${BASE}/persetujuan-tindakan?status=disetujui`);
  await d.getByText("Tidak ada pasien dengan status ini.").waitFor();
  flow.push(["list: filtered-empty with a reset", (await d.locator("main:visible a[href='/persetujuan-tindakan']").count()) > 0]);

  // Sari: review the contraindication, read the text, draw, sign.
  await d.goto(`${BASE}/persetujuan-tindakan/${seed.visits.sari}`);
  await d.getByRole("heading", { name: "Sari Perlu", level: 1 }).waitFor();
  const page1 = await main(d);
  flow.push(["page: items with dose, the contraindication flag and the generated text", page1.includes("Toksin Botulinum × 1 · 20 unit") && page1.includes("Kontraindikasi belum ditinjau")
    && page1.includes("PERSETUJUAN TINDAKAN KEDOKTERAN") && page1.includes("Saya memahami tindakan peeling kimia")]);
  await layouts(d, `/persetujuan-tindakan/${seed.visits.sari}`, "halaman");
  await d.getByRole("form", { name: "Kontraindikasi Peeling Kimia" }).getByRole("button", { name: "Aman Dilakukan" }).click();
  await d.getByText("Kontraindikasi dinyatakan aman.").waitFor();
  flow.push(["review: the examining doctor clears the contraindication", true]);
  await d.goto(`${BASE}/persetujuan-tindakan/${seed.visits.sari}`);
  await d.getByRole("form", { name: "Tanda tangan persetujuan" }).waitFor();
  const box = await draw(d);
  flow.push(["pad: at least 320 × 160 CSS px", box.width >= 320 && box.height >= 160]);
  await d.getByRole("button", { name: "Ulangi" }).click();
  flow.push(["pad: Ulangi clears it", (await main(d)).includes("Belum ada tanda tangan.")]);
  await draw(d);
  await d.getByRole("button", { name: "Tanda Tangani" }).click();
  await d.getByText(/^Persetujuan tercatat/).waitFor();
  await d.goto(`${BASE}/persetujuan-tindakan/${seed.visits.sari}`);
  await d.getByRole("heading", { name: "Sari Perlu", level: 1 }).waitFor();
  const signed = await main(d);
  flow.push(["signed: the plan is approved and version 1 is in the history", signed.includes("Disetujui") && /Versi 1 · Berlaku[\s\S]*Pasien · dicatat Dokter dr\. Ayu/.test(signed)]);
  await d.screenshot({ path: `${OUT}/disetujui-1440.png`, fullPage: true });

  // Rina: the consent is outdated after the dose change; re-consent supersedes it.
  await d.goto(`${BASE}/persetujuan-tindakan/${seed.visits.rina}`);
  await d.getByRole("heading", { name: "Rina Berubah", level: 1 }).waitFor();
  flow.push(["outdated: a raised dose asks for re-consent", (await main(d)).includes("Perlu persetujuan ulang") && (await main(d)).includes("25 unit")]);
  await draw(d);
  await d.getByRole("button", { name: "Tanda Tangani" }).click();
  await d.getByText(/^Persetujuan tercatat/).waitFor();
  await d.goto(`${BASE}/persetujuan-tindakan/${seed.visits.rina}`);
  await d.getByRole("heading", { name: "Rina Berubah", level: 1 }).waitFor();
  const re = await main(d);
  flow.push(["re-consent: version 2 active, version 1 superseded", /Versi 2 · Berlaku[\s\S]*Versi 1 · Digantikan/.test(re)]);
  // Withdraw with a reason.
  await d.getByText("Tarik Persetujuan", { exact: true }).first().click();
  await d.getByLabel("Alasan penarikan").fill("Pasien ingin berpikir dulu");
  await d.getByRole("form", { name: "Tarik persetujuan" }).getByRole("button", { name: "Tarik Persetujuan" }).click();
  await d.getByText("Persetujuan ditarik.").waitFor();
  await d.goto(`${BASE}/persetujuan-tindakan/${seed.visits.rina}`);
  await d.getByRole("heading", { name: "Rina Berubah", level: 1 }).waitFor();
  flow.push(["withdrawal: the version shows withdrawn with its reason", /Versi 2 · Ditarik[\s\S]*Ditarik: Pasien ingin berpikir dulu/.test(await main(d))]);
  await d.screenshot({ path: `${OUT}/riwayat-1440.png`, fullPage: true });
  await dCtx.close();

  // Nurse: Dewi (16) — a guardian signs.
  const nCtx = await ctxOf("203.0.113.202");
  const nn = await nCtx.newPage();
  current = nn;
  nn.on("console", onConsole);
  await signIn(nn, seed.people.nur.email, false);
  await nn.goto(`${BASE}/persetujuan-tindakan/${seed.visits.dewi}`);
  await nn.getByRole("heading", { name: "Dewi Remaja", level: 1 }).waitFor();
  const g = await main(nn);
  flow.push(["minor: only the guardian may sign", g.includes("wali yang menandatangani") && (await nn.getByRole("radio", { name: "Pasien" }).count()) === 0]);
  await nn.setViewportSize({ width: 390, height: 900 });
  await nn.goto(`${BASE}/persetujuan-tindakan/${seed.visits.dewi}`);
  await nn.getByRole("form", { name: "Tanda tangan persetujuan" }).waitFor();
  await nn.getByLabel("Nama wali").fill("Ibu Dewi");
  await nn.getByLabel("Hubungan").selectOption("ibu");
  const b390 = await draw(nn);
  await nn.getByRole("button", { name: "Tanda Tangani" }).click();
  await nn.getByText(/^Persetujuan tercatat/).waitFor();
  flow.push(["nurse at 390: the pad keeps 320 × 160 and the guardian signs", b390.width >= 320 && b390.height >= 160]);
  await nn.screenshot({ path: `${OUT}/wali-390.png`, fullPage: true });
  await nCtx.close();

  // FO: no page.
  const fCtx = await ctxOf("203.0.113.203");
  const f = await fCtx.newPage();
  current = f;
  f.on("console", onConsole);
  await signIn(f, seed.people.fo.email, false);
  await f.goto(`${BASE}/persetujuan-tindakan/${seed.visits.sari}`);
  await f.locator("main").first().waitFor();
  flow.push(["FO: the page answers the permission state", !(await main(f)).includes("PERSETUJUAN TINDAKAN KEDOKTERAN")]);
  await fCtx.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await current.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
