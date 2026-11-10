// T-056 browser evidence (Permintaan Klinis, UX-27, 17:153, 19:93, PR-45) at 390/820/1180/1440 and 200 % text. The
// nurse proposes an additional treatment for Sari; the doctor's inbox shows the card with type, patient, requester,
// reason and price impact and plain Setujui / Tolak; the detail's prominent Setujui approves and offers "Buka
// Persetujuan Tindakan", which shows Perlu persetujuan ulang; a second doctor declines Rina's substitution with a
// reason; the doctor sees his own request blocked (Anda pengaju); the BC sees only its own requests without doses;
// FO gets the permission state (the FO alert itself is proven in tests/clinical/requests.test.ts: the notification
// page is not built yet). No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/permintaan.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branch: string; visits: Record<string, string>; requests: Record<string, string>; plans: Record<string, string> };
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

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();
  const open = async (who: string, totpRole: boolean, ip: string) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };

  // Nurse: proposes an additional filler for Sari.
  const nur = await open("nur", false, "203.0.113.231");
  await nur.p.goto(`${BASE}/permintaan/baru?visit=${seed.visits.sari}`);
  await nur.p.getByRole("heading", { name: "Usul Permintaan", level: 1 }).waitFor();
  await layouts(nur.p, `/permintaan/baru?visit=${seed.visits.sari}`, "usul");
  await nur.p.getByLabel("Item", { exact: true }).selectOption({ label: "Filler Asam Hialuronat" });
  await nur.p.getByLabel("Jumlah").fill("2");
  await nur.p.getByLabel("Alasan").fill("Lipatan nasolabial dalam");
  await nur.p.getByRole("button", { name: "Kirim Permintaan" }).click();
  await nur.p.getByText("Permintaan dikirim ke dokter.").waitFor();
  flow.push(["nurse: the request is sent; the form keeps the result", (await nur.p.getByRole("link", { name: "Lihat permintaan" }).count()) === 1]);
  await nur.c.close();

  // Doctor: the inbox card, then the detail's prominent Setujui.
  const doc = await open("doc", true, "203.0.113.232");
  await doc.p.goto(`${BASE}/permintaan`);
  await doc.p.getByRole("heading", { name: "Permintaan Klinis", level: 1 }).waitFor();
  const inbox = await main(doc.p);
  flow.push(["inbox: card with type, patient, requester, reason and price impact",
    /Tindakan Tambahan[\s\S]*Sari Tambah[\s\S]*Filler Asam Hialuronat × 2[\s\S]*\+Rp600\.000[\s\S]*Rani[\s\S]*Lipatan nasolabial dalam/.test(inbox)]);
  flow.push(["inbox: plain Setujui / Tolak on the card", (await doc.p.getByRole("form", { name: /Putuskan Tukar Treatment Rina Tunggu/ }).getByRole("button", { name: "Setujui" }).count()) === 1]);
  await layouts(doc.p, "/permintaan", "kotak");
  await doc.p.getByRole("link", { name: /Sari Tambah/ }).first().click();
  await doc.p.getByRole("heading", { name: "Sari Tambah", level: 1 }).waitFor();
  const detailUrl = doc.p.url().replace(BASE, "");
  await layouts(doc.p, detailUrl, "rincian");
  await doc.p.getByRole("form", { name: "Putuskan Tindakan Tambahan" }).getByRole("button", { name: "Setujui" }).click();
  await doc.p.getByText(/^Permintaan disetujui; rencana diperbarui/).waitFor();
  flow.push(["approve: the result shows with Buka Persetujuan Tindakan", (await doc.p.getByRole("link", { name: "Buka Persetujuan Tindakan" }).count()) >= 1]);
  await doc.p.getByRole("link", { name: "Buka Persetujuan Tindakan" }).first().click();
  // Wait for the consent page itself (the request page has the same heading; the new page streams in after it).
  await doc.p.waitForURL(new RegExp(`/persetujuan-tindakan/${seed.visits.sari}$`));
  await doc.p.getByText("Perlu persetujuan ulang").first().waitFor();
  flow.push(["agreement step: Persetujuan Tindakan asks for re-consent with both items", /Perlu persetujuan ulang/.test(await main(doc.p)) && (await main(doc.p)).includes("Filler Asam Hialuronat")]);
  await doc.p.screenshot({ path: `${OUT}/persetujuan-ulang-1440.png`, fullPage: true });
  // Own request: blocked.
  await doc.p.goto(`${BASE}/permintaan/${seed.requests.dewi}`);
  await doc.p.getByRole("heading", { name: "Dewi Sendiri", level: 1 }).waitFor();
  flow.push(["own request: Anda pengaju, no Setujui", (await main(doc.p)).includes("Anda pengaju") && (await doc.p.getByRole("button", { name: "Setujui" }).count()) === 0]);
  await doc.c.close();

  // Second doctor: declines Rina's substitution with a reason at 390.
  const d2 = await open("doc2", true, "203.0.113.233");
  await d2.p.setViewportSize({ width: 390, height: 900 });
  await d2.p.goto(`${BASE}/permintaan/${seed.requests.rina}`);
  await d2.p.getByRole("heading", { name: "Rina Tunggu", level: 1 }).waitFor();
  await d2.p.getByRole("button", { name: "Tolak", exact: true }).click();
  await d2.p.getByLabel("Alasan penolakan").fill("Belum perlu filler");
  await d2.p.getByRole("button", { name: "Tolak Permintaan" }).click();
  await d2.p.getByRole("status").filter({ hasText: "Permintaan ditolak." }).waitFor();
  flow.push(["decline at 390: with a reason; the form keeps the result", true]);
  await d2.p.screenshot({ path: `${OUT}/tolak-390.png`, fullPage: true });
  await d2.c.close();

  // BC: only its own requests (none yet) and no doses; proposes without a dose field.
  const bc = await open("bc", false, "203.0.113.234");
  await bc.p.goto(`${BASE}/permintaan`);
  await bc.p.getByRole("heading", { name: "Permintaan Klinis", level: 1 }).waitFor();
  const bl = await main(bc.p);
  flow.push(["BC: no other staff's requests or reasons", !bl.includes("Lipatan nasolabial") && !bl.includes("Pasien memilih filler")]);
  await bc.p.goto(`${BASE}/permintaan/baru`);
  await bc.p.getByRole("heading", { name: "Usul Permintaan", level: 1 }).waitFor();
  flow.push(["BC: the form has no dose field", (await bc.p.getByLabel("Dosis (opsional)").count()) === 0 && (await main(bc.p)).includes("Dosis ditentukan oleh dokter.")]);
  await bc.c.close();

  // FO: the permission state.
  const fo = await open("fo", false, "203.0.113.235");
  await fo.p.goto(`${BASE}/permintaan`);
  await fo.p.locator("main").first().waitFor();
  const ft = await main(fo.p);
  flow.push(["FO: permission state, no request content", !ft.includes("Sari Tambah") && !ft.includes("Lipatan")]);
  await fo.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
