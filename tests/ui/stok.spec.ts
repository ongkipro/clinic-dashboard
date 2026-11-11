// T-060 browser evidence (Stok, UX-11, 17:50, 17:294–296, 19 §2.9, PR-17, CLIN-019, PR-44) at 390/820/1180/1440 and
// 200 % text. The pharmacist lands on Kartu, sees the item list with the low and near-expiry flags, opens the toxin
// (batches in FEFO order, the next batch marked), receives stock, opens a vial, quarantines the near-expiry batch
// (Batch & Kedaluwarsa lists it and the vial), sets a level; purchasing adds Serum from the catalog; the pharmacist
// runs a blind count that exceeds the threshold, which waits in Persetujuan; the owner approves it there and the
// card shows the adjustment. No console error.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/stok.spec.ts out-dir
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
const seed = JSON.parse(readFileSync(process.env.SEED!, "utf8")) as { password: string; people: Record<string, { email: string; staffId: string }>; branches: Record<string, string>; items: Record<string, string> };
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
  const ok = async (p: Page, text: string | RegExp) => p.getByRole("status").filter({ hasText: text }).first().waitFor();

  // Pharmacist: /stok lands on Kartu; the item list with flags.
  const ph = await open("ph", false, "203.0.113.241");
  await ph.p.goto(`${BASE}/stok`);
  await ph.p.waitForURL(`${BASE}/stok/kartu`);
  await ph.p.getByRole("heading", { name: /^Kartu Stok/, level: 1 }).waitFor();
  flow.push(["pharmacist: /stok lands on Kartu with the receive movements", /Kasa Steril[\s\S]*Terima[\s\S]*Batch KAS-1/.test(await main(ph.p))]);
  await layouts(ph.p, "/stok/kartu", "kartu");
  await ph.p.goto(`${BASE}/stok/item`);
  await ph.p.getByRole("heading", { name: /^Stok · Cabang Kemang/, level: 1 }).waitFor();
  const list = await main(ph.p);
  flow.push(["item list: gauze low, toxin near expiry, fit and total quantities", /Kasa Steril[\s\S]*Rendah[\s\S]*Layak pakai 50 pcs/.test(list) && /Toksin Botulinum 100U[\s\S]*Hampir ED[\s\S]*Layak pakai 400 U/.test(list)]);
  await layouts(ph.p, "/stok/item", "item");

  // Toxin detail: FEFO order, receive, open a vial, quarantine the near-expiry batch.
  await ph.p.goto(`${BASE}/stok/item/${seed.items.toxin}`);
  await ph.p.getByRole("heading", { name: "Toksin Botulinum 100U", level: 1 }).waitFor();
  const det = await main(ph.p);
  flow.push(["detail: batches in FEFO order, the earliest marked next", det.indexOf("Batch TOX-B") < det.indexOf("Batch TOX-A") && /Batch TOX-B[\s\S]*Dipakai berikutnya/.test(det)]);
  await layouts(ph.p, `/stok/item/${seed.items.toxin}`, "rincian");
  await ph.p.getByRole("button", { name: "Terima Stok" }).click();
  const recv = ph.p.getByRole("form", { name: "Terima stok" });
  await recv.getByLabel("Nomor batch").fill("TOX-C");
  await recv.getByLabel("Kedaluwarsa").fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
  await recv.getByLabel("Jumlah (U)").fill("200");
  await recv.getByRole("button", { name: "Terima" }).click();
  await ok(ph.p, "Stok diterima.");
  await ph.p.getByText("Batch TOX-C").first().waitFor();
  flow.push(["receive: the new batch appears; the form keeps the result", (await ph.p.getByRole("status").filter({ hasText: "Stok diterima." }).count()) === 1]);
  await recv.getByLabel("Nomor batch").fill("TOX-X");
  await recv.getByLabel("Kedaluwarsa").fill(new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10));
  await recv.getByLabel("Jumlah (U)").fill("5");
  await recv.getByRole("button", { name: "Terima" }).click();
  await ph.p.getByRole("alert").filter({ hasText: "kedaluwarsa" }).first().waitFor();
  flow.push(["CLIN-019: an expired batch is refused at receipt", true]);
  await ph.p.getByRole("form", { name: "Buka vial TOX-A" }).getByRole("button", { name: "Buka Vial" }).click();
  await ok(ph.p, "Vial dibuka");
  await ph.p.getByText(/Vial terbuka: sisa 100 U/).first().waitFor();
  flow.push(["vial: opened with its use-by", true]);
  const hold = ph.p.getByRole("form", { name: "Status batch TOX-B" });
  await hold.getByRole("button", { name: "Karantina…" }).click();
  await hold.getByLabel("Alasan karantina").fill("Suhu kulkas tidak tercatat");
  await hold.getByRole("button", { name: "Karantina", exact: true }).click();
  await ok(ph.p, "Batch dikarantina.");
  await ph.p.goto(`${BASE}/stok/item/${seed.items.toxin}`);
  await ph.p.getByRole("heading", { name: "Toksin Botulinum 100U", level: 1 }).waitFor();
  const det2 = await main(ph.p);
  flow.push(["CLIN-019: the quarantined batch is not next; the open vial is", /Batch TOX-B[\s\S]*Karantina/.test(det2) && /Batch TOX-A[\s\S]*Dipakai berikutnya/.test(det2)]);
  await ph.p.goto(`${BASE}/stok/batch`);
  await ph.p.getByRole("heading", { name: /^Batch & Kedaluwarsa/, level: 1 }).waitFor();
  const watch = await main(ph.p);
  flow.push(["watch: the open vial and the quarantined batch", /Vial Terbuka[\s\S]*Toksin Botulinum 100U/.test(watch) && /TOX-B[\s\S]*Suhu kulkas tidak tercatat/.test(watch)]);
  await layouts(ph.p, "/stok/batch", "batch");

  // Level for the toxin.
  await ph.p.goto(`${BASE}/stok/item/${seed.items.toxin}`);
  await ph.p.getByRole("heading", { name: "Toksin Botulinum 100U", level: 1 }).waitFor();
  await ph.p.getByRole("button", { name: "Atur Min/Target" }).click();
  const lv = ph.p.getByRole("form", { name: "Atur batas stok" });
  await lv.getByLabel("Minimum (U)").fill("100");
  await lv.getByLabel("Target (U)").fill("500");
  await lv.getByRole("button", { name: "Simpan Batas" }).click();
  await ok(ph.p, "Batas stok disimpan.");
  flow.push(["level: saved", (await main(ph.p)).includes("Minimum 100 U · Target 500 U")]);

  // Blind count of gauze above the threshold → Persetujuan.
  await ph.p.goto(`${BASE}/stok/opname`);
  await ph.p.getByRole("heading", { name: /^Hitung Stok/, level: 1 }).waitFor();
  await layouts(ph.p, "/stok/opname", "hitung");
  await ph.p.getByRole("button", { name: "Hitung Stok" }).click();
  const start = ph.p.getByRole("form", { name: "Mulai hitung stok" });
  await start.getByLabel("Kasa Steril").check();
  await start.getByRole("button", { name: "Mulai Hitung" }).click();
  await ph.p.waitForURL(/\/stok\/opname\/[0-9a-f-]{36}$/);
  await ph.p.getByRole("heading", { name: /^Hitung /, level: 1 }).waitFor();
  const countUrl = ph.p.url().replace(BASE, "");
  const blind = await main(ph.p);
  flow.push(["blind count: the system quantity is hidden", blind.includes("Kasa Steril · Batch KAS-1") && !blind.includes("sistem 50")]);
  await layouts(ph.p, countUrl, "hitungan");
  await ph.p.getByRole("form", { name: "Hitung Kasa Steril batch KAS-1" }).getByLabel("Terhitung (pcs)").fill("40");
  await ph.p.getByRole("form", { name: "Hitung Kasa Steril batch KAS-1" }).getByRole("button", { name: "Catat" }).click();
  await ok(ph.p, "Tercatat.");
  await ph.p.goto(`${BASE}${countUrl}`);
  await ph.p.getByRole("heading", { name: /^Hitung /, level: 1 }).waitFor();
  await ph.p.getByRole("form", { name: "Ajukan hitungan" }).getByLabel("Keterangan").fill("Opname bulanan gudang");
  await ph.p.getByRole("button", { name: "Ajukan Hitungan" }).click();
  await ok(ph.p, "menunggu persetujuan");
  await ph.p.goto(`${BASE}${countUrl}`);
  await ph.p.getByRole("heading", { name: /^Hitung /, level: 1 }).waitFor();
  const sub = await main(ph.p);
  flow.push(["after submit: system quantity and difference shown; waiting for approval", /sistem 50 pcs[\s\S]*terhitung 40 pcs[\s\S]*Selisih -10/.test(sub) && sub.includes("Menunggu persetujuan")]);
  await ph.c.close();

  // Purchasing: adds Serum from the catalog; lands on Kartu; picks the branch.
  const pu = await open("pu", false, "203.0.113.242");
  await pu.p.goto(`${BASE}/stok/item/baru`);
  await pu.p.getByRole("heading", { name: "Tambah Item", level: 1 }).waitFor();
  await layouts(pu.p, "/stok/item/baru", "tambah");
  await pu.p.getByLabel("Item katalog").selectOption({ label: "Serum Vitamin C (SRM-01)" });
  await pu.p.getByLabel("Satuan pakai", { exact: true }).fill("ml");
  await pu.p.getByRole("button", { name: "Tambah Item" }).click();
  await ok(pu.p, "Item ditambahkan ke Master Item.");
  await pu.p.goto(`${BASE}/stok/item?cabang=${seed.branches.b1}`);
  await pu.p.getByRole("heading", { name: /^Stok · Cabang Kemang/, level: 1 }).waitFor();
  flow.push(["purchasing: Serum in Master Item; branch chips shown", (await main(pu.p)).includes("Serum Vitamin C") && (await pu.p.getByRole("group", { name: "Cabang" }).count()) === 1]);
  await pu.c.close();

  // Owner: approves the count in Persetujuan; the card shows the adjustment.
  const own = await open("own", true, "203.0.113.243");
  await own.p.goto(`${BASE}/persetujuan`);
  await own.p.getByRole("heading", { level: 1 }).first().waitFor();
  const inbox = await main(own.p);
  flow.push(["PR-44: Persetujuan lists the stock adjustment with requester and reason", inbox.includes("Penyesuaian stok") && inbox.includes("Sari Apoteker") && inbox.includes("Opname bulanan gudang")]);
  await own.p.getByRole("list", { name: "Permintaan menunggu" }).getByRole("link", { name: /Penyesuaian stok/ }).first().click();
  await own.p.waitForURL(/\/persetujuan\/[0-9a-f-]{36}$/);
  await own.p.getByRole("button", { name: "Setujui" }).click();
  await own.p.getByText(/Disetujui oleh Ibu Pemilik sebagai Owner/).waitFor();
  await own.p.goto(`${BASE}/stok/kartu?item=${seed.items.gauze}&cabang=${seed.branches.b1}`);
  await own.p.getByRole("heading", { name: /^Kartu Stok/, level: 1 }).waitFor();
  flow.push(["after approval: the card shows Penyesuaian -10 → 40", /Penyesuaian[\s\S]*-10 pcs → 40/.test(await main(own.p))]);
  await own.c.close();
} catch (e) {
  report.error = String(e).slice(0, 2500);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
}
