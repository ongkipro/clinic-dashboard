// T-013 (PR-86): role-filtered navigation and the clinic shell.
// - Without RUN_UI (Vitest): the menu tree per role against 19 §2 / §2.18 and the 07
//   matrix, and the shell's server data (gates + context) on a real database.
// - With RUN_UI=1 (node, needs a running server and a seed): browser evidence at
//   390/820/1180/1440 and 200% text for a pharmacist and an owner, keyboard paths.
//   BASE_URL=... SHELL_SEED=seed.json PLAYWRIGHT_CORE=... pnpm test:ui out-dir
//   (Playwright becomes a project dependency with T-011; until then PLAYWRIGHT_CORE
//   points at an installed playwright-core.)
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (process.env.RUN_UI) {
  await browserRun();
} else {
  await unitTests();
}

async function unitTests() {
  const { afterAll, beforeAll, describe, expect, it } = await import("vitest");
  const { ROLES } = await import("../../src/auth/policy");
  const nav = await import("../../src/components/shell/nav");
  const { RESERVED_SEGMENTS } = await import("../../src/lib/hosts");
  const labels = (role: (typeof ROLES)[number]) => nav.menuFor(role).flatMap((g) => [g.label, ...g.pages.map((p) => p.label)]);

  describe("scenario PR-86 role-filtered menu", () => {
    it("a pharmacist sees Apotek & Inventaris pages, and neither Keuangan nor Aturan Komisi", () => {
      const groups = nav.menuFor("pharmacist");
      const apotek = groups.find((g) => g.id === "apotek")!;
      expect(apotek.pages.map((p) => p.label)).toEqual(
        expect.arrayContaining(["Siapkan", "Serahkan", "Master Item", "Kartu Stok", "Batch & Kedaluwarsa"]),
      );
      expect(groups.map((g) => g.label)).not.toContain("Keuangan");
      expect(labels("pharmacist")).not.toContain("Aturan Komisi");
      expect(labels("pharmacist")).not.toContain("Rekap Komisi & Batch");
    });

    it("an owner sees Keuangan, Aturan Komisi and Log Audit, and no pharmacy work queues", () => {
      const l = labels("owner");
      expect(l).toEqual(expect.arrayContaining(["Keuangan", "Aturan Komisi", "Log Audit", "Ringkasan Owner"]));
      expect(l).not.toContain("Siapkan");
      expect(l).not.toContain("Serahkan");
    });

    it("pages a role cannot use are absent (not disabled): every listed page names the role", () => {
      for (const role of ROLES) {
        for (const g of nav.menuFor(role)) {
          expect(g.pages.length).toBeGreaterThan(0);
          for (const p of g.pages) expect(p.roles, `${role} ${p.id}`).toContain(role);
        }
      }
    });

    it("finance pages stay away from clinical roles; clinical queues away from finance (07)", () => {
      for (const role of ["doctor", "nurse", "therapist", "pharmacist", "bc"] as const) {
        expect(nav.menuFor(role).map((g) => g.id), role).not.toContain("keuangan");
      }
      expect(labels("finance")).not.toContain("Antrean Dokter");
      expect(labels("marketing")).not.toContain("Log Audit");
    });
  });

  describe("tab bar and landing (19 §2.18, UI-11)", () => {
    for (const role of ROLES) {
      it(`${role}: 4 tabs + Menu, short labels, every tab and the landing page are in its menu`, () => {
        const tabs = nav.tabsFor(role);
        expect(tabs).toHaveLength(4);
        const reachable = new Set([...nav.menuFor(role).flatMap((g) => g.pages), ...nav.sayaFor(role)].map((p) => p.id));
        for (const t of tabs) {
          expect(t.label.length, t.label).toBeLessThanOrEqual(13);
          expect(t.label.split(" ").length, t.label).toBeLessThanOrEqual(2);
          expect(reachable.has(t.id), `${role} tab ${t.id}`).toBe(true);
        }
        expect(reachable.has(nav.landingFor(role).id)).toBe(true);
      });
    }
  });

  describe("tree integrity", () => {
    const pages = [...nav.NAV.flatMap((g) => g.pages), ...nav.SAYA];
    it("page ids are unique; every route segment is reserved on the booking host", () => {
      expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
      for (const p of pages) {
        const seg = p.href.split("?")[0].split("/")[1];
        expect(RESERVED_SEGMENTS.has(seg), p.href).toBe(true);
      }
    });
    it("Saya is available to every role; commission/target only to roles with own commission in 07", () => {
      for (const role of ROLES) expect(nav.sayaFor(role).map((p) => p.id)).toContain("keamanan");
      expect(nav.sayaFor("owner").map((p) => p.id)).not.toContain("komisi-saya");
      expect(nav.sayaFor("bc").map((p) => p.id)).toContain("komisi-saya");
    });
    it("exactly one current page: the longest matching route wins", () => {
      const pagesOf = (role: (typeof ROLES)[number]) => [...nav.menuFor(role).flatMap((g) => g.pages), ...nav.sayaFor(role)];
      expect(nav.currentPageId("/audit/internal", pagesOf("auditor"))).toBe("audit-internal");
      expect(nav.currentPageId("/audit", pagesOf("auditor"))).toBe("log-audit");
      expect(nav.currentPageId("/pasien/baru", pagesOf("fo_cashier"))).toBe("pendaftaran");
      expect(nav.currentPageId("/pasien/123", pagesOf("fo_cashier"))).toBe("daftar-pasien");
      expect(nav.currentPageId("/kasir/tutup", pagesOf("fo_cashier"))).toBe("tutup-kasir");
      expect(nav.currentPageId("/kasirx", pagesOf("fo_cashier"))).toBeUndefined();
      for (const role of ROLES) {
        const hrefs = pagesOf(role).map((p) => p.href);
        expect(new Set(hrefs).size, `${role} has a route listed twice`).toBe(hrefs.length);
      }
    });

    it("quick actions by role (NAV-3)", () => {
      expect(nav.quickActionsFor("fo_cashier").map((a) => a.label)).toEqual(["Pasien Datang", "Buat Janji", "Jual Cepat", "Pasien Baru"]);
      expect(nav.quickActionsFor("pharmacist")).toEqual([]);
      expect(nav.hasInbox("pharmacist")).toBe(false);
      expect(nav.hasInbox("central_cs")).toBe(true);
    });
  });

  describe("shell context on a real database", async () => {
    const pg = (await import("pg")).default;
    const { APP_GROUP_ROLE } = await import("../../src/db/rls/context");
    const { openAppPool } = await import("../../src/db/rls/pool");
    const { assignBranch, assignRole, createMembership } = await import("../../src/modules/org/identity");
    const { shellFor } = await import("../../src/components/shell/context");
    const { createHarness } = await import("../rls/harness");
    let h: Awaited<ReturnType<typeof createHarness>>;
    let app: InstanceType<typeof pg.Pool>;
    let owner: InstanceType<typeof pg.Pool>;
    let tenant: string;
    const br: string[] = [];
    let n = 0;
    const account = async () =>
      (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`s${++n}@klinik-sintetis.test`])).rows[0].id as string;

    beforeAll(async () => {
      h = await createHarness();
      app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
      owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
      tenant = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id;
      await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Sintetis', 'emkm')`, [tenant]);
      for (const [code, name] of [["A", "Cabang Kemang"], ["B", "Cabang Senopati"]]) {
        br.push((await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`, [tenant, code, name])).rows[0].id);
      }
    });
    afterAll(async () => {
      await owner?.end();
      await app?.end();
      await h?.close();
    });

    it("an owner gets the tenant-wide context with every branch", async () => {
      const acc = await account();
      const { staffId } = await createMembership(owner, { tenantId: tenant, accountId: acc, displayName: "Ibu Owner" });
      await assignRole(h.admin, { tenantId: tenant, staffId, role: "owner" });
      const r = await shellFor(app, acc);
      expect(r).toEqual({
        kind: "ok",
        context: {
          staffId,
          role: "owner", roleLabel: "Owner", name: "Ibu Owner", clinic: "PT Klinik Sintetis",
          branches: [{ id: br[0], name: "Cabang Kemang" }, { id: br[1], name: "Cabang Senopati" }],
          activeBranchId: null, tenantWide: true, canSwitchRole: false, canSwitchClinic: false,
        },
      });
    });

    it("a pharmacist sees only their branch, active by default", async () => {
      const acc = await account();
      const { staffId } = await createMembership(owner, { tenantId: tenant, accountId: acc, displayName: "Apt. Sari" });
      const rid = await assignRole(h.admin, { tenantId: tenant, staffId, role: "pharmacist" });
      await assignBranch(h.admin, { tenantId: tenant, staffRoleId: rid, branchId: br[1] });
      const r = await shellFor(app, acc);
      expect(r).toMatchObject({ kind: "ok", context: { role: "pharmacist", branches: [{ id: br[1] }], activeBranchId: br[1], tenantWide: false } });
    });

    it("an infrastructure error is not reported as a missing role", async () => {
      const broken = new pg.Pool({ connectionString: h.urlAs("no_such_login_xyz"), max: 1 });
      await expect(shellFor(broken, await account())).rejects.toThrow();
      await broken.end();
    });

    it("no membership, or a branch role without a branch, is blocked (no clinic data)", async () => {
      expect(await shellFor(app, await account())).toEqual({ kind: "blocked" });
      const acc = await account();
      const { staffId } = await createMembership(owner, { tenantId: tenant, accountId: acc, displayName: "Tanpa Cabang" });
      await assignRole(h.admin, { tenantId: tenant, staffId, role: "nurse" });
      expect(await shellFor(app, acc)).toEqual({ kind: "blocked" });
    });
  });
}

async function browserRun() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
  const BASE = process.env.BASE_URL ?? "http://localhost:3911";
  const OUT = process.argv[2] ?? "/tmp/t013ui";
  const seed = JSON.parse(readFileSync(process.env.SHELL_SEED ?? `${OUT}/seed.json`, "utf8")) as { ownerEmail: string; pharmacistEmail: string };
  const PASSWORD = "kuda-laut berenang 2026"; // synthetic
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, flow: [], console: [] };
  const flow = report.flow as unknown[];

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
  type Page = Awaited<ReturnType<Awaited<ReturnType<typeof browser.newContext>>["newPage"]>>;
  async function signIn(page: Page, email: string) {
    await page.goto(`${BASE}/masuk`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(`${BASE}/`);
  }
  async function measure(page: Page) {
    return page.evaluate(() => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden";
      };
      const ctl = [...document.querySelectorAll("header a, header button, nav a, nav button")].filter(vis);
      const tabbar = document.querySelector('nav[aria-label="Tab"]')!;
      const sidebar = document.querySelector('nav[aria-label="Menu utama"]')!;
      return {
        overflowX: document.documentElement.scrollWidth - innerWidth,
        minTarget: Math.min(...ctl.map((e) => Math.round(Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width)))),
        unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim())).length,
        tabbar: vis(tabbar),
        sidebar: vis(sidebar),
        tabs: [...tabbar.querySelectorAll("a, button")].map((e) => e.textContent?.trim()),
        tabLabelPx: parseFloat(getComputedStyle(tabbar.querySelector("span")!).fontSize),
        // A label that breaks inside a word renders taller than one line.
        tabLabelLines: Math.max(...[...tabbar.querySelectorAll("span")].map((e) => Math.round(e.getBoundingClientRect().height / 13))),
        groups: [...sidebar.querySelectorAll("section > button")].map((e) => e.textContent?.trim()),
        blur: getComputedStyle(tabbar).backdropFilter,
        lang: document.documentElement.lang,
      };
    });
  }

  try {
    for (const who of ["pharmacist", "owner"] as const) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      // Tabs prefetch their pages; pages other tasks build still answer 404 (expected).
      // The deliberately refused sign-out below answers 500 (expected).
      let mocked500 = false;
      page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && !m.text().includes("caret-color") && !m.text().includes("status of 404") && !(mocked500 && m.text().includes("status of 500")) && (report.console as string[]).push(`${who}: ${m.text().slice(0, 200)}`));
      await page.goto(`${BASE}/audit`);
      await page.waitForURL(`${BASE}/masuk`);
      flow.push([`${who}: no session redirects to /masuk`, true]);
      await signIn(page, who === "owner" ? seed.ownerEmail : seed.pharmacistEmail);
      if (who === "owner") {
        await page.goto(`${BASE}/audit`);
        await page.waitForURL(`${BASE}/aktifkan-2fa`);
        flow.push(["owner: shell refuses until TOTP is enrolled", true]);
        await page.getByLabel("Kata sandi").fill(PASSWORD);
        await page.getByRole("button", { name: "Lanjut" }).click();
        const secret = (await page.getByLabel("Kunci autentikator").textContent())!.trim();
        await page.getByLabel("3. Masukkan kode 6 digit").fill(totp(secret));
        await page.getByRole("button", { name: "Aktifkan" }).click();
        await page.waitForURL(`${BASE}/`);
      }
      // /audit is the one clinic page built so far: the owner reads the log, the
      // pharmacist gets the permission state, both inside the shell.
      const url = `${BASE}/audit`;
      for (const w of [390, 820, 1180, 1440]) {
        for (const zoom of [1, 2]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(url);
          // The shell streams in behind Suspense: wait until the bar for this width shows.
          await page.locator(w < 700 ? 'nav[aria-label="Tab"]' : 'nav[aria-label="Menu utama"]').waitFor({ state: "visible" });
          flow.push([`${who}: rendered ${w}${zoom === 2 ? "@200%" : ""}`, true]);
          if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          (report.layout as Record<string, unknown>)[`${who}-${w}${zoom === 2 ? "@200%" : ""}`] = await measure(page);
          if (zoom === 1 || w === 390) await page.screenshot({ path: `${OUT}/${who}-${w}${zoom === 2 ? "-200" : ""}.png`, fullPage: false });
        }
      }
      // Compact: Menu sheet by keyboard, search, pin, close with Escape.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url);
      await page.locator('nav[aria-label="Tab"]').waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Menu" }).focus();
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", { name: "Menu" });
      await sheet.waitFor();
      const sheetText = await sheet.innerText();
      flow.push([`${who}: menu sheet lists Saya first`, sheetText.trim().split("\n").slice(0, 8).join(" | ")]);
      flow.push([`${who}: menu has Keuangan`, sheetText.includes("Keuangan")]);
      flow.push([`${who}: menu has Aturan Komisi`, sheetText.includes("Aturan Komisi")]);
      flow.push([`${who}: menu has Apotek & Inventaris`, sheetText.includes("Apotek & Inventaris")]);
      await page.waitForTimeout(350); // past the 300 ms sheet slide
      await page.screenshot({ path: `${OUT}/${who}-menu-390.png` });
      await sheet.getByLabel("Cari halaman").fill("stok");
      flow.push([`${who}: menu search "stok"`, (await sheet.getByRole("link").allInnerTexts()).join(", ")]);
      await sheet.getByLabel("Cari halaman").fill("zzz");
      flow.push([`${who}: empty search state`, await sheet.getByText("Tidak ada halaman untuk pencarian ini.").isVisible()]);
      await sheet.getByLabel("Cari halaman").fill(who === "owner" ? "log" : "kartu");
      await sheet.getByRole("button", { name: /^Sematkan/ }).first().click();
      await sheet.getByLabel("Cari halaman").fill("");
      flow.push([`${who}: pinned section after pin`, await sheet.getByRole("heading", { name: "Disematkan" }).isVisible()]);
      await page.screenshot({ path: `${OUT}/${who}-menu-pinned-390.png` });
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached" });
      // Radix returns focus in a task after unmount; wait for it to land (≤ 1 s).
      await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 1000 }).catch(() => undefined);
      flow.push([`${who}: Escape closes the menu, focus back on Menu`, await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40))]);

      // Regular: command palette with Ctrl+K, type, Enter follows the first link.
      await page.setViewportSize({ width: 1180, height: 900 });
      await page.goto(url);
      await page.getByRole("navigation", { name: "Menu utama" }).waitFor();
      await page.getByRole("button", { name: "Cari halaman, pasien atau aksi" }).focus();
      await page.keyboard.press("Control+k");
      const pal = page.getByRole("dialog", { name: "Cari" });
      await pal.waitFor();
      await page.keyboard.type(who === "owner" ? "log audit" : "kartu stok");
      await page.keyboard.press("Escape");
      await pal.waitFor({ state: "detached" });
      await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 1000 }).catch(() => undefined);
      flow.push([`${who}: Escape closes the palette, focus returns to the search slot`, await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))]);
      await page.keyboard.press("Control+k");
      await pal.waitFor();
      await page.keyboard.type(who === "owner" ? "log audit" : "kartu stok");
      await page.waitForTimeout(300); // past the 200 ms fade-in
      await page.screenshot({ path: `${OUT}/${who}-palette-1180.png` });
      await pal.getByRole("link").first().focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(who === "owner" ? /\/audit$/ : /\/stok\/kartu$/); // unbuilt pages answer 404 for now
      flow.push([`${who}: palette navigates`, page.url().replace(BASE, "")]);
      if (who === "pharmacist") flow.push(["pharmacist: unbuilt page answers not-found", (await page.locator("body").innerText()).slice(0, 80)]);
      await page.goto(url);
      await page.getByRole("navigation", { name: "Menu utama" }).waitFor();
      const current = await page.locator('nav[aria-label="Menu utama"] [aria-current="page"]').allInnerTexts();
      flow.push([`${who}: sidebar highlights current page on /audit (empty when not in the role's menu)`, current]);
      // Collapsing a group hides its pages.
      const head = page.locator('nav[aria-label="Menu utama"] section > button').nth(1);
      await head.focus();
      await page.keyboard.press("Enter");
      flow.push([`${who}: group collapses by keyboard (aria-expanded)`, await head.getAttribute("aria-expanded")]);
      // Keluar (§2.16): ends the session; clinic pages then ask to sign in again.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url);
      await page.locator('nav[aria-label="Tab"]').waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Menu" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await menu.getByRole("button", { name: "Saya" }).click();
      // A refused sign-out keeps the user on the page with an error (shared devices).
      mocked500 = true;
      await page.route("**/api/auth/sign-out", (r: { fulfill(o: object): Promise<void> }) => r.fulfill({ status: 500, body: "{}" }));
      await menu.getByRole("button", { name: "Keluar" }).click();
      await menu.getByRole("alert").waitFor();
      flow.push([`${who}: failed Keluar stays with an error`, [page.url() === url, await menu.getByRole("alert").innerText()]]);
      await page.unroute("**/api/auth/sign-out");
      mocked500 = false;
      await menu.getByRole("button", { name: "Keluar" }).click();
      await page.waitForURL(`${BASE}/masuk`);
      await page.goto(url);
      await page.waitForURL(`${BASE}/masuk`);
      flow.push([`${who}: Keluar ends the session`, true]);
      flow.push([`${who}: device lists cleared on Keluar`, await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("shell.")).length)]);
      await ctx.close();
    }
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
