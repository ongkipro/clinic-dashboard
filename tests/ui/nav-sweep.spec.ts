// T-130 (PR-86) — navigation sweep: every `19` §2 page renders for its allowed roles and is absent for the others.
// Two modes, like tests/ui/shell.spec.ts:
// - Without RUN_UI_SWEEP (Vitest, no database, no server): the structural sweep —
//   1. 19 §2.1–§2.15 menu rows ↔ nav.ts pages (both directions; record-reached pages excluded with a reason), §2.17 Pengaturan
//      pages ↔ the settings registry groups, §2.18 tabs and landing page per role;
//   2. role filtering: each role's menu holds exactly the pages that list it (absent, never disabled), every role 19 names is
//      in nav.ts, and every nav role is allowed by the 07 capability behind the page (07 column not "–");
//   3. route audit: every nav href is built on disk, owned by a pending task (Allowed Paths of T-105 and later), or listed in
//      ORPHANS below — an unbuilt route nobody owns fails the gate, and a stale ORPHANS entry fails too (punch-list for Panel 2).
// - With RUN_UI_SWEEP=1 (node, needs a running server and per-role sessions): the browser sweep at 390 and 1440 —
//   RUN_UI_SWEEP=1 BASE_URL=http://localhost:3911 SWEEP_STATES=dir-with-<role>.json PLAYWRIGHT_CORE=... node tests/ui/nav-sweep.spec.ts out-dir
//   T-130 Done-when ("`pnpm test:ui -- nav-sweep` passes for every role at 390 and 1440") is this mode, after T-121/T-122/T-126/T-129.
// Verification only: a missing page is a defect in its builder task, never built here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const APP = join(ROOT, "src/app/(app)");

// Tasks whose Allowed Paths still count as "owned, not built yet": T-131 and later (T-128 /pasien/impor is now built).
const FIRST_PENDING_TASK = 131;

// Unbuilt nav routes that no pending task owns (HYG-NAV-1/2/3 + T-128 closed 26 of the original 27).
// Keep in sync: the gate fails on any stale entry or unexplained unbuilt route.
export const ORPHANS: Record<string, string> = {
  "/pengaturan/cabang/integrasi": "Email & Google Business (UX-2 ▸ Integrasi): pending owner decision H vs S (t130/P1-INTEGRASI-DECISION-PACKET-20261120.md)",
};

// 19 §2 rows that are not menu entries: reached from a record, a sheet, an action or a device (nav.ts header comment, 19 §2).
const NOT_MENU: Record<string, string> = {
  "Layar Antrean (TV)": "paired display device (/layar-antrean/[token])",
  "Reservasi Baru (sheet)": "sheet inside Kalender (quick action Buat Janji)",
  "Profil Pasien (360°)": "record page /pasien/[id]",
  "Lembar Pemeriksaan": "record page /pemeriksaan/[visitId]",
  "Foto & Bandingkan": "tab of the examination / patient profile",
  "Rencana Perawatan": "tab of the examination; projection in Pendampingan / Kasir",
  "Resep": "tab of the examination (UX-8 ▸ Resep)",
  "Surat": "action from the examination or patient profile",
  "Ceklis Tindakan": "record page /ruang/[visitId]",
  "Konfirmasi Bahan (BHP)": "sheet inside the treatment checklist",
  "Struk & Invoice": "after payment (/kasir/struk/[receiptId])",
  "Void & Koreksi": "action on an invoice",
  "Simulasi Pembayaran": "demo tenants only (/simulasi), not a menu entry",
  "Simulasi Paket (BC)": "segment of Pendampingan (UX-7 ▸ Diskusi Pilihan)",
  "Jadwal Staf": "'Lihat 2.3': same page as Jadwal Praktik",
};
// 19 row label → nav id where the menu label is shorter than the catalogue row.
const ALIAS: Record<string, string> = {
  "Ringkasan BC (Pasienku)": "pasienku", "Ringkasan Klinis (UX-60)": "ringkasan-klinis", "Papan Klinik (live)": "papan-klinik",
  "Ruang Saya (perawat/terapis)": "ruang-saya", "Pendampingan (BC)": "pendampingan", "Ruang (daftar hari ini)": "ruang",
  "Pesan (Inbox WA)": "pesan", "Pembayaran (port)": "pembayaran",
};
// Nav pages not rows of 19 §2.1–§2.15 tables (stated in prose there).
const NAV_FROM_PROSE: Record<string, string> = { "kamus-kpi": "19 §2.13 prose: Kamus KPI is its own page (UX-59)" };

// Nav page → the 07 capability that grants it. Every role on the page must have that capability (column not "–").
const CAPABILITY: Record<string, string | string[]> = {
  "jadwal-praktik": "Staff schedules", "kalender": "Booking & schedule", "daftar-reservasi": "Booking & schedule", "booking-online": "Booking & schedule",
  "daftar-tunggu": "Booking & schedule", "daftar-pasien": "Patient identity", "pendaftaran": "Patient identity", "gabung-data": "Patient identity",
  "keluarga": "Patient identity", "impor-pasien": "Patient identity", "antrean-dokter": "Examination, plan, sign", "pendampingan": "Intake / observasi kulit",
  "permintaan-klinis": ["Clinical requests decide", "Treatment checklist"], // decide (doctor, delegated nurse) or propose from the room (therapist; PROPOSERS) "koreksi-rm": "Late record correction approval", "ruang": "Treatment checklist",
  "kasir": "Cashier & receipts", "jual-cepat": "Cashier & receipts", "tagihan-terbuka": "Cashier & receipts", "paket-saldo": "Cashier & receipts",
  "tutup-kasir": "Cashier & receipts", "master-layanan": "Catalog & branch prices", "templat-paket": "Catalog & branch prices",
  "kode-promo": "Public site & promos", "situs": "Public site & promos", "siapkan": "Prescribe / dispense", "serahkan": "Prescribe / dispense",
  "master-item": "Stock & purchasing", "kartu-stok": "Stock & purchasing", "batch": "Stock & purchasing", "opname": "Stock & purchasing",
  "depot": "Stock & purchasing", "pemasok": "Stock & purchasing", "utang-pemasok": "Stock & purchasing", "po": "Stock & purchasing",
  "transfer": "Stock & purchasing", "retur": "Stock & purchasing", "pemusnahan": "Stock & purchasing", "data-staf": "Staff & invitations",
  "undangan": "Staff & invitations", "aturan-komisi": "Commission rules & batches", "rekap-komisi": "Commission rules & batches",
  "pesan": "WhatsApp inbox", "buku-besar": "Ledger, periods, exports", "ekspor-keuangan": "Ledger, periods, exports",
  "tagihan-server": "Server-fee invoices", "log-audit": "Audit log, data requests", "permintaan-data": "Audit log, data requests",
  "ekspor-data": "Tenant data export", "kepatuhan": "Compliance register", "satusehat": "SATUSEHAT monitor", "akses-vendor": "Vendor access",
  "komisi-saya": "Own commission & target", "target-saya": "Own commission & target", "pengguna-akses": "Staff & invitations",
  "templat-wa": "Templates & reminder rules", "otomasi": "Templates & reminder rules",
};

// Roles nav.ts grants beyond the roles the 19 row names, each traced to 07 (CAPABILITY above checks it). A new extra fails the
// gate until it is reasoned here. Rows whose Roles cell uses a group word ("clinical", "every role", "same") are not compared
// here (Kalender, Master Layanan, Keluhan, Daftar Pasien); the 07 capability check below still covers every role on them.
const EXTRA_ROLES: Record<string, { roles: string[]; why: string }> = {
  "ringkasan-cabang": { roles: ["owner", "admin_pusat"], why: "19 §2.18 tab 'Cabang' for Owner and Admin Pusat (UX-37); 07 Dashboards ●" },
  "ringkasan-keuangan": { roles: ["owner"], why: "19 §2.12 'Finance, owner'; 19 §2.18 Owner tab Keuangan" },
  "antrean": { roles: ["owner", "admin_pusat", "manager"], why: "queue board for branch-level roles (T-048 decision)" },
  "jadwal-praktik": { roles: ["owner"], why: "07 Staff schedules: Owner ●" },
  "jam-operasional": { roles: ["owner", "manager"], why: "SET-2 changers admin_pusat, manager (registry); Owner full settings" },
  "ruang-alat": { roles: ["owner"], why: "07 Tenant/branch settings: Owner ●" },
  "permintaan-klinis": { roles: ["nurse", "therapist"], why: "19 'delegated clinician'; 07 Clinical requests decide: Nurse ◐ (delegated)" },
  "persetujuan": { roles: ["pharmacist"], why: "catalog_materials_review approver (APPROVAL_TYPES, DEC-047)" },
  "satusehat": { roles: ["admin_pusat", "doctor"], why: "07 SATUSEHAT monitor: Admin Pusat ◐, Doctor ◐" },
};

// The 16 tenant roles in 07 column order.
const ROLES16 = ["owner", "admin_pusat", "manager", "facility_head", "records_officer", "fo_cashier", "central_cs", "bc", "doctor", "nurse",
  "therapist", "pharmacist", "finance", "marketing", "purchasing", "auditor"] as const;

// Role words in a 19 "Roles" cell. Group words ("Clinical", "Every role …") name no single role and are not parsed.
const ROLE_WORDS: [RegExp, string][] = [
  [/\bowner\b/i, "owner"], [/admin pusat/i, "admin_pusat"], [/\bmanager\b/i, "manager"], [/facility head|\bPJ\b/i, "facility_head"],
  [/records officer/i, "records_officer"], [/\bFO\b/, "fo_cashier"], [/\bCS\b|central cs/i, "central_cs"], [/\bBC\b/, "bc"], [/\bdoctor\b/i, "doctor"],
  [/\bnurse\b/i, "nurse"], [/\btherapist\b/i, "therapist"], [/pharmacist/i, "pharmacist"], [/\bfinance\b/i, "finance"], [/\bmarketing\b/i, "marketing"],
  [/\bpurchasing\b/i, "purchasing"], [/\bauditor\b/i, "auditor"],
];
export const rolesIn = (cell: string) => new Set(ROLE_WORDS.filter(([re]) => re.test(cell)).map(([, r]) => r));

type CatalogRow = { page: string; roles: string; section: string };
export function catalogRows(doc: string): CatalogRow[] {
  const out: CatalogRow[] = [];
  const body = doc.slice(doc.indexOf("### 2.1 Dashboard"), doc.indexOf("### 2.16"));
  for (const part of body.split(/^### /m).filter(Boolean)) {
    const section = part.split("\n")[0].trim();
    for (const m of part.matchAll(/^\| ([^|]+?) \| [^|]*\| ([^|]+?) \| (?:UX[^|]*|—) \| [^|]*\|$/gm)) if (m[1].trim() !== "Page") out.push({ page: m[1].trim(), roles: m[2].trim(), section });
  }
  return out;
}
export function matrix07(doc: string): Record<string, Record<string, string>> {
  const t = doc.slice(doc.indexOf("| Capability |"), doc.indexOf("Vendor (Level 1) is not"));
  const out: Record<string, Record<string, string>> = {};
  for (const line of t.split("\n").slice(2)) {
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length === ROLES16.length + 1) out[c[0].split(" (")[0]] = Object.fromEntries(ROLES16.map((r, i) => [r, c[i + 1]]));
  }
  return out;
}

type Owner = { task: string; n: number; path: string };
export function pendingOwners(tasks: string): Owner[] {
  const out: Owner[] = [];
  let cur = "";
  for (const line of tasks.split("\n")) {
    const m = /^#### (T-(\d+))/.exec(line);
    if (m) cur = m[1];
    if (cur && line.includes("**Allowed Paths:**")) {
      for (const a of line.matchAll(/`src\/app\/\(app\)\/([^`*]+?)\/?\*\*`/g)) {
        const n = Number(cur.slice(2));
        if (n >= FIRST_PENDING_TASK) out.push({ task: cur, n, path: a[1] });
      }
    }
  }
  return out;
}
// A nav href is built when its page.tsx exists, following [grup] for the Pengaturan groups.
export function isBuilt(href: string, groupSlugs: readonly string[]): boolean {
  let dir = APP;
  for (const seg of href.split("?")[0].split("/").filter(Boolean)) {
    if (existsSync(join(dir, seg))) { dir = join(dir, seg); continue; }
    if (existsSync(join(dir, "[grup]")) && groupSlugs.includes(seg)) { dir = join(dir, "[grup]"); continue; }
    return false;
  }
  return existsSync(join(dir, "page.tsx"));
}
export function ownerOf(href: string, owners: Owner[]): Owner | undefined {
  const seg = href.split("?")[0].replace(/^\//, "");
  return owners.filter((o) => seg === o.path || seg.startsWith(`${o.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
}

if (process.env.RUN_UI_SWEEP === "1" && !process.env.VITEST) {
  await browserSweep();
} else {
  await structural();
}

async function structural() {
  const { describe, expect, it } = await import("vitest");
  const nav = await import("../../src/components/shell/nav");
  const { GROUPS } = await import("../../src/modules/settings/registry");
  const doc19 = readFileSync(join(ROOT, "docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md"), "utf8");
  const m07 = matrix07(readFileSync(join(ROOT, "docs/spec/07-IAM-RBAC-ABAC.md"), "utf8"));
  const rows = catalogRows(doc19);
  const menuPages = nav.NAV.filter((g) => g.id !== "pengaturan").flatMap((g) => g.pages);
  const allPages = [...nav.NAV.flatMap((g) => g.pages), ...nav.SAYA];
  const byLabel = new Map(menuPages.map((p) => [p.label, p]));
  const byId = new Map(allPages.map((p) => [p.id, p]));
  const navFor = (r: CatalogRow) => (ALIAS[r.page] ? byId.get(ALIAS[r.page]) : byLabel.get(r.page));
  const slugs = GROUPS.map((g) => g.slug as string);

  describe("19 §2 ↔ nav.ts (every catalogue page has its menu entry, and back)", () => {
    it("the catalogue parses: 19 §2.1–§2.15 hold the expected rows", () => {
      expect(rows.length).toBeGreaterThan(100);
      expect(new Set(rows.map((r) => r.section.split(" ")[0])).size).toBe(15);
    });
    it("every 19 §2.1–§2.15 row is a nav page, or a record-reached page with a reason", () => {
      const missing = rows.filter((r) => !navFor(r) && !NOT_MENU[r.page]).map((r) => `${r.section}: ${r.page}`);
      expect(missing).toEqual([]);
      const stale = Object.keys(NOT_MENU).filter((p) => !rows.some((r) => r.page === p));
      expect(stale, "NOT_MENU entries no longer in 19").toEqual([]);
    });
    it("every nav menu page (outside Pengaturan) is a 19 row or named in 19 prose", () => {
      const listed = new Set(rows.map((r) => navFor(r)?.id).filter(Boolean));
      expect(menuPages.filter((p) => !listed.has(p.id) && !NAV_FROM_PROSE[p.id]).map((p) => p.id)).toEqual([]);
    });
    it("§2.17 Pengaturan: one page per settings group, same order and labels, href /pengaturan/<slug>", () => {
      const p = nav.NAV.find((g) => g.id === "pengaturan")!.pages;
      expect(p.map((x) => x.href)).toEqual(GROUPS.map((g) => `/pengaturan/${g.slug}`));
      expect(p.map((x) => x.label)).toEqual(GROUPS.map((g) => g.label));
    });
  });

  describe("role filtering (PR-86: pages a role cannot use are absent, never disabled)", () => {
    it("Scenario PR-86 role-filtered menu: a pharmacist sees Apotek & Inventaris pages, not Keuangan or Aturan Komisi", () => {
      const groups = nav.menuFor("pharmacist");
      expect(groups.find((g) => g.id === "apotek")!.pages.map((p) => p.label)).toEqual(expect.arrayContaining(["Siapkan", "Serahkan", "Kartu Stok"]));
      expect(groups.some((g) => g.id === "keuangan")).toBe(false);
      expect(groups.flatMap((g) => g.pages).some((p) => p.id === "aturan-komisi")).toBe(false);
    });
    for (const role of ROLES16) {
      it(`${role}: the menu holds exactly the pages that list the role; empty groups are absent; no disabled flag exists`, () => {
        const menu = nav.menuFor(role);
        const want = nav.NAV.flatMap((g) => g.pages).filter((p) => p.roles.includes(role)).map((p) => p.id);
        expect(menu.flatMap((g) => g.pages).map((p) => p.id)).toEqual(want);
        for (const g of menu) expect(g.pages.length).toBeGreaterThan(0);
        for (const p of [...menu.flatMap((g) => g.pages), ...nav.sayaFor(role)]) expect(Object.keys(p).sort()).toEqual(["href", "id", "label", "roles"]);
        const absent = nav.NAV.flatMap((g) => g.pages).filter((p) => !p.roles.includes(role));
        for (const p of absent) expect(menu.flatMap((g) => g.pages).some((x) => x.id === p.id), `${role} must not see ${p.id}`).toBe(false);
      });
    }
    it("every role a 19 row names is on the nav page", () => {
      const lacking = rows.flatMap((r) => {
        const p = navFor(r);
        return p ? [...rolesIn(r.roles)].filter((x) => !p.roles.includes(x as never)).map((x) => `${p.id}: ${x}`) : [];
      });
      expect(lacking).toEqual([]);
    });
    it("roles beyond the 19 row are exactly the reasoned EXTRA_ROLES", () => {
      const extra: Record<string, string[]> = {};
      for (const r of rows) {
        const p = navFor(r);
        const named = rolesIn(r.roles);
        if (!p || named.size === 0 || /every role|clinical|same/i.test(r.roles)) continue;
        const x = p.roles.filter((role) => !named.has(role));
        if (x.length) extra[p.id] = [...x];
      }
      expect(extra).toEqual(Object.fromEntries(Object.entries(EXTRA_ROLES).map(([k, v]) => [k, v.roles])));
    });
    it("every nav role holds the 07 capability behind the page (column not '–')", () => {
      expect(Object.keys(m07)).toContain("Own commission & target");
      const bad: string[] = [];
      for (const [id, c] of Object.entries(CAPABILITY)) {
        const caps = Array.isArray(c) ? c : [c];
        const p = byId.get(id);
        expect(p, id).toBeDefined();
        for (const cap of caps) expect(m07[cap], cap).toBeDefined();
        for (const role of p!.roles) if (caps.every((cap) => m07[cap][role] === "–")) bad.push(`${id} → ${role} (07 "${caps.join(" / ")}" is –)`);
      }
      expect(bad).toEqual([]);
    });
    it("Komisi Saya and Target Saya follow the 07 'Own commission & target' column exactly", () => {
      const own = ROLES16.filter((r) => m07["Own commission & target"][r] !== "–");
      expect([...byId.get("komisi-saya")!.roles].sort()).toEqual([...own].sort());
      expect([...byId.get("target-saya")!.roles].sort()).toEqual([...own].sort());
    });
    it("finance pages never reach clinical roles; clinical queues never reach finance (07)", () => {
      const clinical = ["doctor", "nurse", "therapist", "pharmacist"] as const;
      for (const p of nav.NAV.find((g) => g.id === "keuangan")!.pages) for (const c of clinical) expect(p.roles.includes(c), `${p.id}/${c}`).toBe(false);
      for (const id of ["antrean-dokter", "pendampingan", "ruang", "siapkan", "serahkan"]) expect(byId.get(id)!.roles.includes("finance")).toBe(false);
    });
  });

  describe("tab bar and landing (19 §2.18)", () => {
    const table = doc19.slice(doc19.indexOf("### 2.18"), doc19.indexOf("## 3."));
    const landing19 = new Map([...table.matchAll(/^\| ([^|]+?) \| [^|]+ \| ([^|]+?) \|$/gm)].map((m) => [m[1].trim(), m[2].trim()]));
    const ROW: Record<string, string> = {
      owner: "Owner", admin_pusat: "Admin Pusat", manager: "Manager", facility_head: "Facility head", records_officer: "Records officer",
      fo_cashier: "FO/cashier", central_cs: "Central CS", bc: "BC", doctor: "Doctor", nurse: "Nurse / Therapist", therapist: "Nurse / Therapist",
      pharmacist: "Pharmacist", finance: "Finance", marketing: "Marketing", purchasing: "Purchasing", auditor: "Internal auditor",
    };
    for (const role of ROLES16) {
      it(`${role}: ≤ 5 bottom items at 390 (4 tabs + Menu); tabs and landing are pages the role may open; landing is 19's`, () => {
        const tabs = nav.tabsFor(role);
        expect(tabs.length + 1).toBeLessThanOrEqual(5);
        const reachable = new Set([...nav.menuFor(role).flatMap((g) => g.pages), ...nav.sayaFor(role)].map((p) => p.id));
        for (const t of tabs) expect(reachable.has(t.id), `${role} tab ${t.id}`).toBe(true);
        const land = nav.landingFor(role);
        expect(reachable.has(land.id)).toBe(true);
        const want = landing19.get(ROW[role])!;
        expect(want, `19 §2.18 row ${ROW[role]}`).toBeDefined();
        const wantId = ALIAS[want] ?? [...byLabel.values()].find((p) => p.label === want)?.id ?? rows.map(navFor).find((p) => p?.label === want)?.id;
        // "Ringkasan BC (Pasienku)" / "Ruang Saya" style rows: compare by alias or label prefix.
        expect(land.id === wantId || want.startsWith(land.label) || land.label.startsWith(want.split(" (")[0]), `${role}: nav ${land.label} vs 19 ${want}`).toBe(true);
      });
    }
  });

  describe("route audit: built / owned by a pending task / orphan (base 5cfa0f52)", () => {
    const owners = pendingOwners(readFileSync(join(ROOT, "TASKS.md"), "utf8"));
    const hrefs = [...new Set(allPages.map((p) => p.href.split("?")[0]))];
    const unbuilt = hrefs.filter((h) => !isBuilt(h, slugs));
    it("every unbuilt nav route is owned by a pending task or listed in ORPHANS", () => {
      const unexplained = unbuilt.filter((h) => !ownerOf(h, owners) && !ORPHANS[h]);
      expect(unexplained).toEqual([]);
    });
    it("ORPHANS holds no stale entry (built, owned, or not in nav)", () => {
      const stale = Object.keys(ORPHANS).filter((h) => !hrefs.includes(h) || isBuilt(h, slugs) || ownerOf(h, owners));
      expect(stale).toEqual([]);
    });
    it("every route segment is reserved on the booking host (a tenant slug can never shadow a clinic page)", async () => {
      const { RESERVED_SEGMENTS } = await import("../../src/lib/hosts");
      for (const h of hrefs) expect(RESERVED_SEGMENTS.has(h.split("/")[1]), h).toBe(true);
    });
    it("audit table (printed for MISSING-ROUTES-AUDIT.md)", () => {
      const table = unbuilt.map((h) => `${h}\t${ownerOf(h, owners)?.task ?? "ORPHAN"}\t${allPages.filter((p) => p.href.split("?")[0] === h).map((p) => p.id).join(",")}`);
      if (process.env.NAV_SWEEP_PRINT) console.log(table.join("\n"));
      expect(table.length).toBe(unbuilt.length);
      expect(hrefs.length - unbuilt.length).toBeGreaterThan(0);
    });
  });

  describe("browser sweep (RUN_UI_SWEEP=1, 16 roles at 390 and 1440)", () => {
    it.skipIf(process.env.RUN_UI_SWEEP !== "1")(
      "every role at 390 and 1440: built menu pages render inside shell, foreign pages absent from menu & refused directly, <= 5 bottom tabs at 390",
      async () => {
        await browserSweep();
      },
      600_000,
    );
  });
}

// ── browser sweep ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Needs a running server (BASE_URL) and one Playwright storage state per role in SWEEP_STATES (<role>.json, signed in with TOTP
// done, synthetic tenant). Writes report.json + screenshots to SWEEP_OUT (or argv[2]); throws/exits 1 on any failure.
async function browserSweep() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
  const nav = await import("../../src/components/shell/nav");
  const { GROUPS } = await import("../../src/modules/settings/registry");
  const slugs = GROUPS.map((g) => g.slug as string);
  const BASE = process.env.SWEEP_BASE_URL ?? (process.env.BASE_URL?.startsWith("http") ? process.env.BASE_URL : "http://localhost:3911");
  const STATES = process.env.SWEEP_STATES ?? "";
  const OUT = process.env.SWEEP_OUT ?? process.argv[2] ?? "/tmp/t130-sweep";
  mkdirSync(OUT, { recursive: true });
  // Run fo_cashier first so its DEC-010 120 s server-side idle lock never expires while earlier roles run.
  const roles = ROLES16.filter((r) => existsSync(join(STATES, `${r}.json`))).sort((a, b) =>
    a === "fo_cashier" ? -1 : b === "fo_cashier" ? 1 : 0,
  );
  const report: { role: string; width: number; href: string; ok: boolean; note: string }[] = [];
  const browser = await chromium.launch();
  try {
    for (const role of roles) {
      for (const width of [390, 1440]) {
        const ctx = await browser.newContext({ storageState: join(STATES, `${role}.json`), viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        const allowed = [...nav.menuFor(role).flatMap((g) => g.pages), ...nav.sayaFor(role)];
        const seenHref = new Set<string>();
        for (const p of allowed) {
          const baseHref = p.href.split("?")[0];
          if (seenHref.has(p.href)) continue;
          seenHref.add(p.href);
          if (ORPHANS[baseHref] && !isBuilt(baseHref, slugs)) {
            report.push({ role, width, href: p.href, ok: true, note: "tracked_orphan_unbuilt" });
            continue;
          }
          const res = await page.goto(`${BASE}${p.href}`, { waitUntil: "load" });
          await page.locator("main h1, main h2").first().waitFor({ timeout: 10_000 }).catch(() => {});
          const status = res?.status() ?? 0;
          const body = await page.locator("main").first().innerText().catch(() => "");
          const ok = status > 0 && status < 400 && body.trim().length > 0 && !/tidak ditemukan|404\b|this page could not be found/i.test(body);
          report.push({ role, width, href: p.href, ok, note: `status ${status}` });
          if (!ok) await page.screenshot({ path: join(OUT, `${role}-${width}-${p.id}.png`) });
        }
        // Absent, never disabled: the menu shows no page outside the role's set.
        const landing = nav.landingFor(role);
        await page.goto(`${BASE}${landing.href}`, { waitUntil: "load" });
        await page.locator("main h1, main h2").first().waitFor({ timeout: 10_000 }).catch(() => {});
        const menuContainer = width < 700
          ? await (async () => { await page.getByRole("button", { name: "Menu" }).click(); return page.getByRole("dialog", { name: "Menu" }); })()
          : page.getByRole("navigation", { name: "Menu utama" });
        const menuHrefs = new Set<string>(
          await menuContainer.locator("a[href]").evaluateAll((els: Element[]) => els.map((el: Element) => el.getAttribute("href") ?? "")),
        );
        const allowedHrefs = new Set(allowed.map((a) => a.href));
        const leaked = nav.NAV.flatMap((g) => g.pages).filter((p) => !p.roles.includes(role) && !allowedHrefs.has(p.href) && menuHrefs.has(p.href));
        report.push({ role, width, href: "(menu)", ok: menuHrefs.size > 0 && leaked.length === 0, note: leaked.map((p) => p.id).join(",") || (menuHrefs.size ? "no foreign page" : "empty menu") });
        if (width < 700) {
          const tabs = await page.getByRole("navigation", { name: "Tab" }).getByRole("link").count();
          report.push({ role, width, href: "(tabs)", ok: tabs + 1 <= 5, note: `${tabs} tabs + Menu` });
        }
        // Direct navigation to a foreign page outside this role's menu must not render foreign operational data.
        const foreign = nav.NAV.flatMap((g) => g.pages).find(
          (p) => !p.roles.includes(role) && !ORPHANS[p.href.split("?")[0]] && isBuilt(p.href.split("?")[0], slugs),
        );
        if (foreign) {
          const fRes = await page.goto(`${BASE}${foreign.href}`, { waitUntil: "load" });
          await page.locator("main h1, main h2, main p").first().waitFor({ timeout: 10_000 }).catch(() => {});
          const fStatus = fRes?.status() ?? 0;
          const fBody = await page.locator("main").first().innerText().catch(() => "");
          const refused = fStatus === 403 || fStatus === 404 || /tidak memiliki akses|akses ditolak|hanya untuk|tidak diizinkan|izin|bukan peran/i.test(fBody);
          report.push({ role, width, href: `(foreign:${foreign.href})`, ok: refused, note: `status ${fStatus}` });
          if (!refused) await page.screenshot({ path: join(OUT, `${role}-${width}-foreign-${foreign.id}.png`) });
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ roles, missingStates: ROLES16.filter((r) => !roles.includes(r)), report }, null, 2));
  const failed = report.filter((r) => !r.ok);
  console.log(`nav-sweep: ${report.length - failed.length}/${report.length} ok; states for ${roles.length}/16 roles; report ${OUT}/report.json`);
  if (failed.length || roles.length < ROLES16.length) {
    throw new Error(`nav-sweep failed: ${failed.length} failed checks, ${roles.length}/16 roles (${JSON.stringify(failed.slice(0, 10))})`);
  }
}

