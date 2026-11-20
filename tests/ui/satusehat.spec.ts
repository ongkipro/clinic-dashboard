// T-102 increment 3 browser evidence (SATUSEHAT, UX-23, 17:62 / :174, 07:63) at 390/820/1180/1440 and 200 % text. States: success (?ok
// notices after each action), error (a credential whose organization does not match the branch is refused), blocked ("Kredensial cabang
// belum aktif" on the branch without credentials), empty (no exceptions after Kirim Ulang), permission (the nurse). Roles: the records
// officer (monitor codes only, identity queue with Tinjau, no record link, no practitioner / code lists); the facility head (the record link
// and the provider answer, identity resolve, reporting room, practitioner IHS by hand, ICD-9 CM map, Kirim Ulang by keyboard); the owner
// (branch picker, credentials without the secret, the blocked branch, the error); the manager (codes read-only); Admin Pusat (counts and
// credentials only); a doctor (own visits only); the nurse (no access). No secret and no NIK on any page.
// Runs on request: RUN_UI=1 BASE_URL=... SEED=seed.json PLAYWRIGHT_CORE=... node tests/ui/satusehat.spec.ts out-dir
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
  password: string; people: Record<string, { email: string; staffId: string }>; branches: { b1: string; b2: string };
  visits: { rejected: string; review: string; noRoom: string; confirmed: string };
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
  first(): Locator; filter(o: object): Locator; locator(s: string): Locator; getByRole(r: string, o?: object): Locator; getByLabel(t: string | RegExp, o?: { exact?: boolean }): Locator;
  waitFor(o?: object): Promise<void>; click(): Promise<void>; fill(v: string): Promise<void>; innerText(): Promise<string>; textContent(): Promise<string | null>; count(): Promise<number>;
  selectOption(v: string | object): Promise<unknown>; focus(): Promise<void>; getAttribute(n: string): Promise<string | null>; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator;
  inputValue(): Promise<string>; evaluate<A>(f: (e: HTMLInputElement, a: A) => void, a: A): Promise<void>;
  check(): Promise<void>;
};
type Page = {
  goto(u: string): Promise<unknown>; waitForURL(u: string | RegExp): Promise<void>; waitForTimeout(ms: number): Promise<void>; setViewportSize(s: { width: number; height: number }): Promise<void>;
  getByLabel(t: string, o?: { exact?: boolean }): Locator; getByRole(r: string, o?: object): Locator; getByText(t: string | RegExp, o?: { exact?: boolean }): Locator; locator(s: string): Locator;
  evaluate<T>(f: () => T): Promise<T>; url(): string; screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>; content(): Promise<string>;
  addStyleTag(o: { content: string }): Promise<unknown>; keyboard: { press(k: string): Promise<void> }; on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
};
async function signIn(page: Page, email: string, totpRole: boolean) {
  await page.goto(`${BASE}/masuk`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(seed.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);
  if (!totpRole) return;
  await page.goto(`${BASE}/satusehat`);
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
    const box = (e: Element) => (["checkbox", "radio"].includes((e as HTMLInputElement).type) && (e.closest("label") ?? e.closest("li")) ? (e.closest("label") ?? e.closest("li"))! : e);
    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      minTarget: ctl.length ? Math.min(...ctl.map((e) => Math.round(box(e).getBoundingClientRect().height))) : null,
      smallest: ctl.map((e) => [Math.round(box(e).getBoundingClientRect().height), `${box(e).tagName}.${(box(e).getAttribute("type") ?? "")}:${(box(e).textContent ?? "").trim().slice(0, 30)}`] as const)
        .filter(([hgt]) => hgt < 44).slice(0, 4).map(([hgt, d]) => `${hgt}:${d}`),
      unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
      squeezed: [...document.querySelectorAll("main dd, main dt, main p, main span")].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const em = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight) || em * 1.2;
        return !e.classList.contains("sr-only") && cs.display !== "inline" && r.width > 0 && r.width < 4 * em && r.height > 3 * lh && (e.textContent ?? "").trim().length > 4;
      }).map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 30)}:${(e.textContent || "").trim().slice(0, 30)}`),
      wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3)
        .map((e) => `${e.tagName}.${(e.className || "").toString().slice(0, 40)}:${(e.textContent || "").slice(0, 30)}@${e.getBoundingClientRect().right.toFixed(1)}`),
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
// nothing secret or identifying beyond the page's purpose: the client secret, any NIK, the provider body outside its page
const leak = (html: string) => /rahasia-sintetis|3174\d{12}|OperationOutcome/.test(html);

const browser = await chromium.launch();
let current: Page | null = null;
try {
  const ctxOf = (ip: string) => browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const main = (p: Page) => p.locator("main:visible").innerText();
  const open = async (who: string, ip: string, totpRole = true) => {
    const c = await ctxOf(ip);
    const p = await c.newPage();
    current = p;
    p.on("console", onConsole);
    await signIn(p, seed.people[who].email, totpRole);
    return { c, p };
  };
  const list = (p: Page, name: string) => p.getByRole("list", { name });
  const short = (id: string) => `…${id.slice(-8)}`;

  // Records officer: codes only, identity queue with Tinjau, no record link, no practitioner / code lists.
  const ro = await open("ro", "203.0.113.231");
  await ro.p.goto(`${BASE}/satusehat`);
  await list(ro.p, "Data yang perlu ditangani").waitFor();
  const r0 = await main(ro.p);
  flow.push(["records officer: the rejected Encounter with code and path, no record link and no provider answer",
    new RegExp(`Kunjungan ${short(seed.visits.rejected)}[\\s\\S]*Ditolak[\\s\\S]*kode invalid · bagian Encounter.period`).test(r0)
      && (await ro.p.getByRole("link", { name: "Buka Rekam Medis" }).count()) === 0 && (await ro.p.getByRole("link", { name: "Lihat Jawaban SATUSEHAT" }).count()) === 0]);
  flow.push(["records officer: the identity queue (Bayi Sintetis, pasien tanpa NIK) with Tinjau; no practitioner or ICD-9 CM section; nothing secret",
    /Bayi Sintetis[\s\S]*Perlu ditinjau[\s\S]*pasien tanpa NIK/.test(r0) && (await ro.p.getByText("Tinjau", { exact: true }).count()) === 1
      && !/Nomor IHS Tenaga Kesehatan|Kode Tindakan ICD-9 CM|Kredensial Cabang/.test(r0) && !leak(await ro.p.content())]);
  const held = list(ro.p, "Kunjungan ditahan");
  flow.push(["held for no room / identity: no Kirim Ulang, the way to the fix named instead",
    (await held.getByRole("button", { name: "Kirim Ulang" }).count()) === 0 && /Pilih ruang periksa di bagian/.test(await held.innerText()) && /Tinjau identitas pasien di bagian/.test(await held.innerText())]);
  await layouts(ro.p, "/satusehat", "records-officer");
  await ro.c.close();

  // A doctor: own visits only — before the facility head re-sends the rejected visit, so its rejected code is still shown.
  const doc = await open("doc", "203.0.113.236");
  await doc.p.goto(`${BASE}/satusehat`);
  await list(doc.p, "Kunjungan saya").waitFor();
  const d0 = await main(doc.p);
  const mine = await list(doc.p, "Kunjungan saya").locator(":scope > li").count();
  flow.push(["doctor: his two visits named by patient, with per-type states and the rejected code (Kunjungan: Dikonfirmasi on the confirmed one), no counts, no exceptions, no other doctor's visits",
    mine === 2 && /Kunjungan: Dikonfirmasi/.test(d0) && /Kunjungan: Ditolak \(kode invalid\)/.test(d0) && /Siti Rahma ·/.test(d0) && /Dewi Lestari ·/.test(d0) && !/Ringkasan|Perlu Ditangani/.test(d0) && !leak(await doc.p.content())]);
  await layouts(doc.p, "/satusehat", "dokter");
  await doc.c.close();

  // Facility head: the record link and the provider answer; identity, room, practitioner, code map; Kirim Ulang by keyboard.
  const fh = await open("fh", "203.0.113.232");
  await fh.p.goto(`${BASE}/satusehat`);
  await list(fh.p, "Data yang perlu ditangani").waitFor();
  const rej = list(fh.p, "Data yang perlu ditangani").locator("li").filter({ hasText: short(seed.visits.rejected) });
  flow.push(["facility head: the rejected item opens the record", ((await rej.getByRole("link", { name: "Buka Rekam Medis" }).getAttribute("href")) ?? "").startsWith("/pasien/")]);
  await rej.getByRole("link", { name: "Lihat Jawaban SATUSEHAT" }).click();
  await fh.p.waitForURL(/\/satusehat\/galat\//);
  await fh.p.getByRole("heading", { name: "Jawaban SATUSEHAT" }).waitFor();
  flow.push(["facility head: the provider answer page shows the OperationOutcome as text", /OperationOutcome/.test(await main(fh.p))]);
  await layouts(fh.p, fh.p.url().replace(BASE, ""), "jawaban");
  await fh.p.goto(`${BASE}/satusehat`);
  await list(fh.p, "Identitas perlu ditinjau").waitFor();
  await fh.p.getByText("Tinjau", { exact: true }).click();
  const idf = fh.p.getByRole("form", { name: "Tinjau identitas Bayi Sintetis" });
  await idf.getByLabel("Nomor IHS pasien").fill("P10000002");
  await idf.getByLabel("Dasar keputusan").fill("Dicek di portal SATUSEHAT");
  await idf.getByRole("button", { name: "Simpan Keputusan" }).click();
  await fh.p.waitForURL(/\/satusehat\?ok=identitas/);
  await fh.p.getByText("Identitas pasien disimpan.").first().waitFor();
  flow.push(["success: identity resolved by hand; the queue is empty", /Tidak ada identitas yang perlu ditinjau/.test(await main(fh.p))]);
  const rf = fh.p.getByRole("form", { name: "Pilih ruang periksa" });
  await rf.getByLabel("Ruang periksa").selectOption({ label: "Ruang Periksa 1" });
  await rf.getByRole("button", { name: "Simpan Ruang" }).click();
  await fh.p.waitForURL(/\/satusehat\?ok=ruang/);
  await fh.p.getByText("Ruang periksa disimpan.").first().waitFor();
  flow.push(["success: the reporting room set; the no-room section is gone", !/Ruang Periksa Belum Dipilih/.test(await main(fh.p))]);
  const nur = list(fh.p, "Tenaga kesehatan").locator("li").filter({ hasText: "Ners Dita" });
  flow.push(["the nurse without an IHS number shows Belum diisi; the section offers manual entry or a one-off NIK lookup (NIK deleted after use)",
    /Belum diisi/.test(await nur.innerText()) && /atau cari sekali lewat NIK tenaga kesehatan/.test(await main(fh.p)) && /lalu dihapus/.test(await main(fh.p))]);
  // T-102 increment 4 (TD-31): the NIK lookup for the nurse — a malformed NIK refused with fixed copy (never echoed), then a valid one sent;
  // the field is a password input, empty again after the answer; the status shows the outcome words only (the worker is not run here)
  await nur.getByText("Cari lewat NIK").click();
  const nikField = nur.getByLabel("NIK tenaga kesehatan");
  flow.push(["TD-31 lookup form: the NIK field is a password input with autocomplete off and empty",
    (await nikField.getAttribute("type")) === "password" && (await nikField.getAttribute("autocomplete")) === "off" && (await nikField.inputValue()) === ""]);
  await layouts(fh.p, "/satusehat", "nik-lookup", async () => { await list(fh.p, "Tenaga kesehatan").locator("li").filter({ hasText: "Ners Dita" }).getByText("Cari lewat NIK").click(); });
  await fh.p.goto(`${BASE}/satusehat`);
  const nur2 = list(fh.p, "Tenaga kesehatan").locator("li").filter({ hasText: "Ners Dita" });
  await nur2.getByText("Cari lewat NIK").click();
  const BAD = "3171-0112-0389-00X1";
  await nur2.getByLabel("NIK tenaga kesehatan").evaluate((e: HTMLInputElement, v: string) => { e.removeAttribute("pattern"); e.value = v; }, BAD);
  await nur2.getByRole("button", { name: "Cari Nomor IHS" }).click();
  await nur2.getByRole("alert").waitFor();
  const err = await nur2.innerText();
  flow.push(["TD-31 lookup: a malformed NIK is refused with fixed copy (NIK harus 16 angka.) and never echoed", /NIK harus 16 angka\./.test(err) && !err.includes("00X1")
    && (await nur2.getByLabel("NIK tenaga kesehatan").inputValue()) === ""]);
  const GOOD = "3171011203890077"; // synthetic
  await nur2.getByLabel("NIK tenaga kesehatan").fill(GOOD);
  await nur2.getByRole("button", { name: "Cari Nomor IHS" }).click();
  await fh.p.waitForURL(/\/satusehat\?ok=cari-nakes/);
  await fh.p.getByText("Pencarian nomor IHS lewat NIK dikirim.").first().waitFor();
  const sent = list(fh.p, "Tenaga kesehatan").locator("li").filter({ hasText: "Ners Dita" });
  const html = await fh.p.content();
  flow.push(["TD-31 lookup sent: Pencarian dikirim on the nurse's card; the NIK appears nowhere in the page (text or markup)",
    /Pencarian dikirim/.test(await sent.innerText()) && !html.includes(GOOD) && !html.includes(GOOD.slice(0, 10))]);
  // the recorded outcome of an earlier lookup (seeded through the worker with the mock port): not found → the words, no IHS
  const rina = list(fh.p, "Tenaga kesehatan").locator("li").filter({ hasText: "Terapis Rina" });
  flow.push(["TD-31 status: a finished lookup shows its outcome words (NIK tidak ditemukan di SATUSEHAT) and the card stays Belum diisi",
    /NIK tidak ditemukan di SATUSEHAT/.test(await rina.innerText()) && /Belum diisi/.test(await rina.innerText())]);
  await nur.getByLabel("Nomor IHS tenaga kesehatan").fill("N10000009");
  await nur.getByRole("button", { name: "Simpan Nomor" }).click();
  await fh.p.waitForURL(/\/satusehat\?ok=nakes/);
  await fh.p.getByText("Nomor IHS tenaga kesehatan disimpan.").first().waitFor();
  flow.push(["success: practitioner IHS entered by hand", /IHS N10000009/.test(await list(fh.p, "Tenaga kesehatan").locator("li").filter({ hasText: "Ners Dita" }).innerText())]);
  const svc = list(fh.p, "Layanan").locator("li").filter({ hasText: "LSR-01" });
  await svc.getByText("Isi kode").click();
  await svc.getByLabel("Kode ICD-9 CM", { exact: true }).fill("99.29");
  await svc.getByLabel("Nama tindakan ICD-9 CM", { exact: true }).fill("Injeksi terapi lain");
  await svc.getByRole("button", { name: "Simpan Kode" }).click();
  await fh.p.waitForURL(/\/satusehat\?ok=peta/);
  await fh.p.getByText("Kode ICD-9 CM disimpan.").first().waitFor();
  flow.push(["success: ICD-9 CM map saved, shown unvalidated", /99\.29 · belum divalidasi/.test(await list(fh.p, "Layanan").innerText())]);
  await layouts(fh.p, "/satusehat", "facility-head");
  // keyboard: choose the reason with the arrow keys, Tab to Kirim Ulang, Enter submits
  const rs = list(fh.p, "Data yang perlu ditangani").locator("li").filter({ hasText: short(seed.visits.rejected) });
  await rs.getByLabel("Alasan kirim ulang").focus();
  await fh.p.keyboard.press("ArrowDown");
  await fh.p.keyboard.press("ArrowDown");
  await fh.p.keyboard.press("ArrowDown");
  await fh.p.keyboard.press("Tab");
  const focused = await fh.p.evaluate(() => (document.activeElement?.textContent ?? "").trim());
  await fh.p.keyboard.press("Enter");
  await fh.p.waitForURL(/\/satusehat\?ok=dikirim-ulang/);
  await fh.p.getByText("Item dimasukkan lagi ke antrean.").first().waitFor();
  const after = list(fh.p, "Data yang perlu ditangani");
  flow.push(["keyboard: reason by arrow keys, Tab reaches Kirim Ulang, Enter re-queues; the rejected card leaves the list",
    focused === "Kirim Ulang" && (await after.locator("li").filter({ hasText: short(seed.visits.rejected) }).count()) === 0]);
  // review r1 (Sol 13649c04): exceptions the command cannot repair carry guidance, never Kirim Ulang
  const dup = after.locator("li").filter({ hasText: "ditemukan ganda di SATUSEHAT" });
  const org = after.locator("li").filter({ hasText: "ID organisasi cabang berubah" });
  flow.push(["duplicate_remote and organization_changed: no Kirim Ulang, the manual-handling guidance instead",
    (await dup.count()) === 1 && (await org.count()) === 1 && (await after.getByRole("button", { name: "Kirim Ulang" }).count()) === 0
      && /Tidak bisa dikirim ulang dari sini/.test(await dup.innerText()) && /Tidak bisa dikirim ulang dari sini/.test(await org.innerText())]);
  await fh.c.close();

  // Owner: credentials without the secret; the blocked branch; the error on a mismatched organization.
  const own = await open("own", "203.0.113.233");
  await own.p.goto(`${BASE}/satusehat?cabang=${seed.branches.b1}`);
  await own.p.getByRole("heading", { name: "Kredensial Cabang" }).waitFor();
  const o0 = await main(own.p);
  flow.push(["owner: the active credential (organization, client id, Client secret tidak ditampilkan), never the secret; no identity form, no record link",
    /Organisasi 10000123[\s\S]*Aktif · versi 1[\s\S]*Client ID client-kemang[\s\S]*Client secret tidak ditampilkan/.test(o0) && !leak(await own.p.content())
      && (await own.p.getByText("Tinjau", { exact: true }).count()) === 0 && (await own.p.getByRole("link", { name: "Buka Rekam Medis" }).count()) === 0]);
  await own.p.getByRole("navigation", { name: "Pilih cabang" }).getByRole("link", { name: "Cabang Bintaro" }).click();
  await own.p.waitForURL(new RegExp(`cabang=${seed.branches.b2}`));
  await own.p.getByText("Kredensial cabang belum aktif.").waitFor();
  flow.push(["blocked: Bintaro shows Kredensial cabang belum aktif with the way out (isi kredensial, then Kirim Ulang)", /Isi kredensial di bawah[\s\S]*pilih Kirim Ulang/.test(await main(own.p))]);
  flow.push(["empty: Bintaro has nothing rejected or held", /Tidak ada data yang ditolak atau ditahan/.test(await main(own.p))]);
  const cf = own.p.getByRole("form", { name: "Kredensial cabang" });
  await cf.getByLabel("ID organisasi").fill("99999999");
  await cf.getByLabel("Client ID").fill("client-bintaro");
  await cf.getByLabel("Client secret").fill("rahasia-sintetis-bintaro");
  await cf.getByRole("button", { name: "Simpan Kredensial" }).click();
  await cf.getByRole("alert").filter({ hasText: "Periksa kembali isian." }).waitFor();
  flow.push(["error: a credential whose organization does not match the branch is refused; still blocked; the secret field is not echoed",
    /Kredensial cabang belum aktif/.test(await main(own.p)) && (await own.p.getByRole("form", { name: "Kredensial cabang" }).getByLabel("Client secret").getAttribute("value")) === null]);
  await layouts(own.p, `/satusehat?cabang=${seed.branches.b2}`, "owner-blocked");
  await own.c.close();

  // Manager: codes read-only, Kirim Ulang offered on held items.
  const mgr = await open("mgr", "203.0.113.234");
  await mgr.p.goto(`${BASE}/satusehat`);
  await list(mgr.p, "Layanan").waitFor();
  const m0 = await main(mgr.p);
  flow.push(["manager: the ICD-9 CM list read-only (no Isi / Ubah kode); no practitioner list, no credentials",
    /LSR-01/.test(m0) && (await mgr.p.getByText(/^(Isi|Ubah) kode$/).count()) === 0 && /Kode diisi Owner atau penanggung jawab klinik/.test(m0)
      && !/Nomor IHS Tenaga Kesehatan|Kredensial Cabang/.test(m0)]);
  await mgr.c.close();

  // Admin Pusat: counts and credentials only.
  const ap = await open("ap", "203.0.113.235");
  await ap.p.goto(`${BASE}/satusehat`);
  await ap.p.getByRole("heading", { name: "Ringkasan" }).waitFor();
  const a0 = await main(ap.p);
  flow.push(["Admin Pusat: counts and the credentials section only (no exceptions, identity, practitioners, codes)",
    /Kredensial Cabang/.test(a0) && !/Perlu Ditangani|Identitas Perlu Ditinjau|Nomor IHS Tenaga Kesehatan|Kode Tindakan/.test(a0) && !leak(await ap.p.content())]);
  await layouts(ap.p, "/satusehat", "admin-pusat");
  await ap.c.close();

  // The nurse: no access.
  const n = await open("nur", "203.0.113.237", false);
  await n.p.goto(`${BASE}/satusehat`);
  await n.p.getByRole("heading", { level: 1 }).waitFor();
  flow.push(["the nurse has no access: the title and the message only", /Anda tidak memiliki akses ke SATUSEHAT/.test(await main(n.p)) && (await n.p.getByRole("form").count()) === 0]);
  await layouts(n.p, "/satusehat", "tanpa-akses");
  await n.c.close();
} catch (e) {
  report.error = String(e).slice(0, 400);
  if (current) await (current as Page).screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
}
}
