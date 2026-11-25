// T-129 (PR-87, 19 §3) — vendor console tree, vendor UI subset. No database: the console gate and the vendor pool are replaced, the
// pages and the shell are the real ones.
//  1. scenario PR-87 as PRD §8 states it (read from the PRD): each vendor role sees exactly its pages and no other; the tree is 19 §3
//     (same pages, same order) and every page is mounted;
//  2. a page refuses a role that is not in its row before any reader runs, and a malformed ?tenant= is not found;
//  3. Sesi Dukungan never renders the session's free-text purpose, the operator or a table name;
//  4. the pages without a reader say so and render no control.
// Not here (needs a running server): browser evidence at 390/820/1180/1440 and the CSP nonce (tests/platform/hosts.spec.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Role = "platform_owner" | "onboarding" | "support" | "vendor_finance" | "vendor_auditor";
type Gate = { kind: "signed-out" } | { kind: "enrol-totp" } | { kind: "refused"; reason: string }
  | { kind: "ok"; caller: { token: string; ip: string }; user: { staffId: string; name: string; roles: Role[] } };

const h = vi.hoisted(() => ({
  gate: { kind: "signed-out" } as unknown,
  tenants: { ok: true, data: { rows: [] as unknown[] } } as unknown,
  sessions: { ok: true, rows: [] as unknown[] } as unknown,
  queries: [] as { sql: string; args: unknown[] }[],
  tenantCalls: 0,
}));
vi.mock("../../src/app/vendor/_lib/server", () => ({
  consoleGate: async () => h.gate,
  call: async () => { h.tenantCalls += 1; return h.tenants; },
  vendorPool: async () => ({ query: async (sql: string, args: unknown[]) => { h.queries.push({ sql, args }); return { rows: [{ r: h.sessions }] }; } }),
}));
// The sign-out button needs the app router; the tree does not.
vi.mock("../../src/app/vendor/_lib/sign-out", () => ({ VendorSignOut: () => null }));

import AuditPage from "../../src/app/vendor/audit/page";
import FlagPage from "../../src/app/vendor/flag/page";
import IntegrasiPage from "../../src/app/vendor/integrasi/page";
import ProfilPage from "../../src/app/vendor/profil/page";
import SesiPage from "../../src/app/vendor/sesi/page";
import TemplatPage from "../../src/app/vendor/templat/page";
import { ConsoleShell, mayOpen, navFor, tenantParam, VENDOR_NAV, VENDOR_ROLES } from "../../src/app/vendor/_lib/shell";

const ROOT = join(import.meta.dirname, "../..");
const VENDOR = join(ROOT, "src/app/vendor");
const pageFile = (href: string) => join(VENDOR, href.replace(/^\/vendor\/?/, ""), "page.tsx");

const T1 = "0193a000-0000-7000-8000-000000000001";
const T2 = "0193a000-0000-7000-8000-000000000002";
const signedIn = (...roles: Role[]): Gate => ({ kind: "ok", caller: { token: "t", ip: "203.0.113.7" }, user: { staffId: "s", name: "Staf Vendor", roles } });
type Query = Record<string, string | string[] | undefined>;
type Page = (p: { searchParams: Promise<Query> }) => Promise<React.ReactNode>;
const open = async (page: Page, q: Query = {}) => renderToStaticMarkup(await page({ searchParams: Promise.resolve(q) }));
const main = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? "";
const sidebar = (html: string) => [.../<nav[^>]*aria-label="Konsol Vendor"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

// The exact sidebar of each role (19 §3 order) — matches BOTH PRD §8 scenario "PR-87 vendor console tree"
// AND the reconciled 19 §3 Roles column (Onboarding: onboarding + platform_owner per D1; Tagihan Server:
// vendor_finance + platform_owner + vendor_auditor per T-103). Both sources are parsed and asserted below.
const MENU: Record<Role, string[]> = {
  platform_owner: ["Tenant", "Onboarding", "Tagihan Server", "Kesehatan Platform", "Tim Vendor", "Audit Vendor", "Profil Vendor", "Feature Flag Platform", "Templat Global"],
  onboarding: ["Tenant", "Onboarding", "Sesi Dukungan"],
  support: ["Tenant", "Integrasi", "Sesi Dukungan", "Kesehatan Platform"],
  vendor_finance: ["Tenant", "Tagihan Server"],
  vendor_auditor: ["Tenant", "Tagihan Server", "Audit Vendor"],
};
// The six pages of this subset and the roles that may open them.
const PAGES: { href: string; title: string; page: Page; roles: Role[]; tenantParam: boolean }[] = [
  { href: "/vendor/sesi", title: "Sesi Dukungan", page: SesiPage, roles: ["onboarding", "support"], tenantParam: true },
  { href: "/vendor/integrasi", title: "Integrasi", page: IntegrasiPage, roles: ["support"], tenantParam: true },
  { href: "/vendor/audit", title: "Audit Vendor", page: AuditPage, roles: ["platform_owner", "vendor_auditor"], tenantParam: true },
  { href: "/vendor/templat", title: "Templat Global", page: TemplatPage, roles: ["platform_owner"], tenantParam: true },
  { href: "/vendor/profil", title: "Profil Vendor", page: ProfilPage, roles: ["platform_owner"], tenantParam: true },
  { href: "/vendor/flag", title: "Feature Flag Platform", page: FlagPage, roles: ["platform_owner"], tenantParam: true },
];

beforeEach(() => {
  h.gate = { kind: "signed-out" };
  h.tenants = { ok: true, data: { rows: [{ id: T1, state: "live", name: "PT Sintetis Satu", branches: 2 }, { id: T2, state: "onboarding", name: null, branches: 1 }] } };
  h.sessions = { ok: true, rows: [] };
  h.queries.length = 0;
  h.tenantCalls = 0;
});

describe("scenario PR-87 vendor console tree", () => {
  // The scenario's own words → the role (PR-57, IAM-10 names).
  const ACTOR: Record<string, Role> = {
    "a platform owner": "platform_owner", "an onboarding specialist": "onboarding", "a support operator": "support", "vendor finance": "vendor_finance", "a vendor auditor": "vendor_auditor",
  };
  // The role lists as PRD §8 states them (amended 2026-11-25: one list per vendor role instead of one all-pages list for the platform owner).
  function scenario(): { lists: Record<Role, string[]>; rest: string } {
    const prd = readFileSync(join(ROOT, "docs/spec/02-PRD.md"), "utf8");
    const blocks = [...prd.matchAll(/^Scenario: PR-87 vendor console tree\n((?:  .+\n)+)/gm)];
    expect(blocks).toHaveLength(1);
    const lines = blocks[0][1].trimEnd().split("\n").map((l) => l.trim());
    expect(lines[0]).toBe("Given one vendor staff member for each vendor role");
    expect(lines[1]).toBe("When the vendor console opens");
    const lists = {} as Record<Role, string[]>;
    for (const l of lines.slice(2, -1)) {
      const m = /^(?:Then|And) (.+?) sees (.+)$/.exec(l);
      expect(m, l).not.toBeNull();
      expect(ACTOR[m![1]], m![1]).toBeDefined();
      expect(lists[ACTOR[m![1]]], `${m![1]} listed twice`).toBeUndefined();
      lists[ACTOR[m![1]]] = m![2].split(/, | and /);
    }
    return { lists, rest: lines.at(-1)! };
  }

  it("each vendor role sees exactly the pages the scenario lists for it, and no other", () => {
    const { lists, rest } = scenario();
    expect(Object.keys(lists).sort()).toEqual([...VENDOR_ROLES].sort());
    // The scenario and this file's table say the same thing …
    expect(lists).toEqual(MENU);
    for (const role of VENDOR_ROLES) {
      // … the navigation gives the role exactly that list, in 19 §3 order …
      expect(navFor([role]).map((p) => p.label), role).toEqual(lists[role]);
      // … and the rendered console shows those links and no link of any other page.
      const html = renderToStaticMarkup(ConsoleShell({ user: { staffId: "s", name: "Staf", roles: [role] }, current: "/vendor/tenant", children: null }));
      expect(sidebar(html), role).toEqual([...lists[role].map((l) => VENDOR_NAV.find((p) => p.label === l)!.href), "/vendor/keamanan"]);
      for (const p of VENDOR_NAV.filter((x) => x.menu !== false && !lists[role].includes(x.label))) {
        expect(html, `${role} must not see ${p.label}`).not.toContain(`href="${p.href}"`);
        expect(mayOpen([role], p.href), `${role} must not open ${p.label}`).toBe(false);
      }
    }
    expect(rest).toBe("And no role sees a page outside its list, and every sidebar page of the console tree is listed for at least one role");
  });

  it("every page of the console tree is listed for at least one role, and every listed page is a tree page", () => {
    const { lists } = scenario();
    const tree = VENDOR_NAV.filter((p) => p.menu !== false).map((p) => p.label);
    expect(tree).toEqual(["Tenant", "Onboarding", "Integrasi", "Tagihan Server", "Sesi Dukungan", "Kesehatan Platform", "Tim Vendor", "Audit Vendor", "Profil Vendor", "Feature Flag Platform", "Templat Global"]);
    const listed = new Set(Object.values(lists).flat());
    expect(tree.filter((l) => !listed.has(l))).toEqual([]);
    expect([...listed].filter((l) => !tree.includes(l))).toEqual([]);
    // Who each page is for, read back from the scenario (the role matrix in one place).
    const who = Object.fromEntries(tree.map((l) => [l, VENDOR_ROLES.filter((r) => lists[r].includes(l))]));
    expect(who).toEqual({
      Tenant: ["platform_owner", "onboarding", "support", "vendor_finance", "vendor_auditor"],
      Onboarding: ["platform_owner", "onboarding"],
      Integrasi: ["support"],
      "Tagihan Server": ["platform_owner", "vendor_finance", "vendor_auditor"],
      "Sesi Dukungan": ["onboarding", "support"],
      "Kesehatan Platform": ["platform_owner", "support"],
      "Tim Vendor": ["platform_owner"],
      "Audit Vendor": ["platform_owner", "vendor_auditor"],
      "Profil Vendor": ["platform_owner"],
      "Feature Flag Platform": ["platform_owner"],
      "Templat Global": ["platform_owner"],
    });
  });

  it("the tree is 19 §3: the same pages in the same order, matching the 19 §3 Roles column, each mounted", () => {
    const spec = readFileSync(join(ROOT, "docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md"), "utf8");
    const section = /^## 3\. [\s\S]*?(?=^## 4\. )/m.exec(spec)![0];
    const parsed = [...section.matchAll(/^\| ([^|]+?) \| [^|]*\| ([^|]+?) \| [^|]*\| [^|]*\|$/gm)]
      .map((m) => ({ page: m[1].trim(), rolesCell: m[2].trim() }))
      .filter((r) => r.page !== "Page" && !/^-+$/.test(r.page));
    expect(parsed).toHaveLength(12);
    expect(VENDOR_NAV.map((p) => p.label)).toEqual(parsed.map((r) => r.page));
    expect(new Set(VENDOR_NAV.map((p) => p.href)).size).toBe(VENDOR_NAV.length);
    expect(VENDOR_NAV.filter((p) => !existsSync(pageFile(p.href))).map((p) => p.href)).toEqual([]);
    // Detail Tenant is reached from a tenant row, never from the sidebar.
    expect(VENDOR_NAV.filter((p) => p.menu === false).map((p) => p.label)).toEqual(["Detail Tenant"]);
    // Reconciled 19 §3 Roles column MUST match VENDOR_NAV roles for every row!
    const parseSpecRoles = (cell: string): Role[] => {
      if (/all vendor roles|vendor roles per iam-10/i.test(cell)) return [...VENDOR_ROLES];
      const rules: [RegExp, Role][] = [
        [/platform owner/i, "platform_owner"],
        [/onboarding/i, "onboarding"],
        [/support/i, "support"],
        [/vendor finance/i, "vendor_finance"],
        [/vendor auditor/i, "vendor_auditor"],
      ];
      return rules.filter(([re]) => re.test(cell)).map(([, role]) => role);
    };
    for (const r of parsed) {
      const nav = VENDOR_NAV.find((p) => p.label === r.page)!;
      expect([...nav.roles].sort(), `19 §3 Roles mismatch on ${r.page}: "${r.rolesCell}"`).toEqual(parseSpecRoles(r.rolesCell).sort());
    }
  });
});

describe("role-filtered sidebar (NAV-1: absent, never disabled)", () => {
  for (const role of VENDOR_ROLES) {
    it(`${role}: exactly its pages, every link mounted, plus Keamanan Akun`, () => {
      expect(navFor([role]).map((p) => p.label)).toEqual(MENU[role]);
      const html = renderToStaticMarkup(ConsoleShell({ user: { staffId: "s", name: "Staf", roles: [role] }, current: "/vendor/tenant", children: null }));
      const links = sidebar(html);
      expect(links).toEqual([...navFor([role]).map((p) => p.href), "/vendor/keamanan"]);
      expect(links.filter((x) => !existsSync(pageFile(x)))).toEqual([]);
      for (const p of VENDOR_NAV) if (!MENU[role].includes(p.label) && p.menu !== false) expect(html, p.label).not.toContain(`>${p.label}<`);
      expect(html).not.toMatch(/aria-disabled|disabled=/);
    });
  }

  it("Onboarding is listed for onboarding and the platform owner only", () => {
    expect(VENDOR_ROLES.filter((r) => navFor([r]).some((p) => p.href === "/vendor/onboarding"))).toEqual(["platform_owner", "onboarding"]);
  });

  it("several roles see the union once; no role, nothing", () => {
    expect(navFor(["vendor_finance", "support"]).map((p) => p.label)).toEqual(["Tenant", "Integrasi", "Tagihan Server", "Sesi Dukungan", "Kesehatan Platform"]);
    // A platform owner who also holds support sees the whole tree.
    expect(navFor(["platform_owner", "support"]).map((p) => p.label)).toHaveLength(11);
    expect(navFor([])).toEqual([]);
  });

  it("mayOpen is exactly the sidebar: a page is open to the roles that have its link, and nothing outside the tree is open", () => {
    for (const p of PAGES) expect(VENDOR_ROLES.filter((r) => mayOpen([r], p.href)), p.href).toEqual(VENDOR_ROLES.filter((r) => p.roles.includes(r)));
    for (const r of VENDOR_ROLES) for (const p of VENDOR_NAV.filter((x) => x.menu !== false)) expect(mayOpen([r], p.href), `${r} ${p.href}`).toBe(navFor([r]).some((x) => x.href === p.href));
    // 19 §3: the platform owner is not on Integrasi or Sesi Dukungan; the auditor is not on Profil Vendor.
    expect(mayOpen(["platform_owner"], "/vendor/sesi")).toBe(false);
    expect(mayOpen(["platform_owner"], "/vendor/integrasi")).toBe(false);
    expect(mayOpen(["vendor_auditor"], "/vendor/profil")).toBe(false);
    for (const x of ["/vendor/keamanan", "/vendor/unknown", "/vendor/sesi/", "/VENDOR/SESI", ""]) expect(mayOpen(["platform_owner"], x), x).toBe(false);
    expect(mayOpen([], "/vendor/tenant")).toBe(false);
  });
});

describe("?tenant= is one well-formed tenant id or absent", () => {
  it("tenantParam", () => {
    expect(tenantParam(undefined)).toEqual({ kind: "none" });
    expect(tenantParam(T1)).toEqual({ kind: "tenant", id: T1 });
    for (const bad of ["", " ", "1", "null", T1.toUpperCase(), `${T1} `, `${T1}'--`, T1.slice(0, 35), [T1], [T1, T2], []]) expect(tenantParam(bad), JSON.stringify(bad)).toEqual({ kind: "invalid" });
  });
});

describe("the six pages: gate first, role next, then the request", () => {
  for (const p of PAGES) {
    it(`${p.href}: no session → sign-in; no TOTP → enrolment; a refused account sees no page`, async () => {
      await expect(open(p.page)).rejects.toMatchObject({ digest: expect.stringContaining("/vendor/masuk") });
      h.gate = { kind: "enrol-totp" };
      await expect(open(p.page)).rejects.toMatchObject({ digest: expect.stringContaining("/vendor/aktifkan-2fa") });
      h.gate = { kind: "refused", reason: "ip_not_allowed" };
      const html = await open(p.page);
      expect(html).toContain("Akses ditolak");
      expect(html).not.toContain('aria-label="Konsol Vendor"');
      expect(h.tenantCalls + h.queries.length).toBe(0);
    });

    it(`${p.href}: a role outside ${p.roles.join(", ")} gets the permission state and no reader runs`, async () => {
      for (const role of VENDOR_ROLES.filter((r) => !p.roles.includes(r))) {
        h.gate = signedIn(role);
        // Even with a malformed ?tenant=: the role is judged before the request is read.
        const html = main(await open(p.page, { tenant: "x" }));
        expect(html, role).toContain(`Anda tidak memiliki akses ke ${p.title}.`);
        expect(html.replace(/<[^>]+>/g, "").trim(), role).toBe(`${p.title}Anda tidak memiliki akses ke ${p.title}.`);
      }
      expect(h.tenantCalls + h.queries.length).toBe(0);
    });

    it(`${p.href}: each allowed role opens it; no form, button, input or inline style`, async () => {
      for (const role of p.roles) {
        h.gate = signedIn(role);
        const html = await open(p.page);
        expect(main(html), role).toContain(`<h1`);
        expect(main(html), role).toContain(p.title);
        expect(html, role).not.toMatch(/<form|<button|<input|<select|<textarea|\sstyle=|\saction=/);
        // The sidebar marks this page as current: every role that may open a page has its link.
        expect(/<a\b[^>]*aria-current="page"[^>]*>/.exec(html)?.[0] ?? "", role).toContain(`href="${p.href}"`);
      }
    });

    if (p.tenantParam) {
      it(`${p.href}: a malformed or repeated ?tenant= is not found`, async () => {
        h.gate = signedIn(p.roles[0]);
        for (const bad of ["x", "", T1.toUpperCase(), `${T1}0`, [T1, T2]]) {
          await expect(open(p.page, { tenant: bad }), JSON.stringify(bad)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
        }
        expect(h.queries).toEqual([]);
      });
    }

    it(`${p.href}: a server component, no Server Action, no client code`, () => {
      const src = readFileSync(pageFile(p.href), "utf8");
      expect(src).not.toMatch(/["']use (server|client)["']/);
      expect(src).toContain("consoleGate()");
      expect(src).toContain("mayOpen(gate.user.roles, HREF)");
    });
  }
});

describe("Sesi Dukungan (existing reader, safe fields only)", () => {
  const PURPOSE = "SENTINEL-TUJUAN pasien Budi alergi penisilin";
  const rows = [
    { id: "0193b000-0000-7000-8000-00000000000a", tenant_id: T1, operator: "SENTINEL-OPERATOR", purpose: PURPOSE, scope: ["public.patients", "public.branches"], state: "active", requested_at: "2026-11-25T02:00:00Z", ends_at: "2026-11-25T03:30:00Z", extended: true, end_reason: null },
    { id: "0193b000-0000-7000-8000-00000000000b", tenant_id: T2, operator: "SENTINEL-OPERATOR", purpose: PURPOSE, scope: ["public.branches"], state: "pending_approval", requested_at: "2026-11-24T10:00:00Z", ends_at: null, extended: false, end_reason: null },
    { id: "0193b000-0000-7000-8000-00000000000c", tenant_id: T1, operator: "SENTINEL-OPERATOR", purpose: PURPOSE, scope: ["public.branches"], state: "ended", requested_at: "2026-11-20T10:00:00Z", ends_at: "2026-11-20T11:00:00Z", extended: false, end_reason: "SENTINEL-REASON" },
  ];

  it("lists clinic, state, scope size and times; never the purpose, the operator, an end reason or a table name", async () => {
    h.gate = signedIn("support");
    h.sessions = { ok: true, rows };
    const html = main(await open(SesiPage));
    for (const bad of ["SENTINEL", "Budi", "penisilin", "public.", "patients"]) expect(html, bad).not.toContain(bad);
    for (const good of ["PT Sintetis Satu", "Belum ada nama badan usaha", "Aktif", "Menunggu Owner", "Selesai", "2 jenis objek", "1 jenis objek", "Setelah disetujui", "25 Nov 2026, 09.00 WIB", rows[0].id]) {
      expect(html, good).toContain(good);
    }
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0].sql).toContain("vendor_console_support_list(");
    expect(h.queries[0].args).toEqual(["t", "203.0.113.7", null]);
  });

  it("?tenant= asks the reader for that clinic only; an id that names no clinic is not found", async () => {
    h.gate = signedIn("onboarding");
    h.sessions = { ok: true, rows: [rows[0]] };
    const html = main(await open(SesiPage, { tenant: T1 }));
    expect(h.queries[0].args).toEqual(["t", "203.0.113.7", T1]);
    expect(html).toContain("Klinik: PT Sintetis Satu");
    expect(html).toContain("Semua klinik");
    h.queries.length = 0;
    await expect(open(SesiPage, { tenant: "0193a000-0000-7000-8000-0000000000ff" })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(h.queries).toEqual([]);
  });

  it("empty, filtered-empty, a role refused by the database, and a failed or malformed read", async () => {
    h.gate = signedIn("support");
    expect(main(await open(SesiPage))).toContain("Belum ada sesi dukungan.");
    expect(main(await open(SesiPage, { tenant: T2 }))).toContain("Tidak ada sesi dukungan untuk klinik ini.");
    h.sessions = { ok: false, code: "ERR_FORBIDDEN", reason: "role_not_held" };
    expect(main(await open(SesiPage))).toContain("Anda tidak memiliki akses ke Sesi Dukungan.");
    h.tenants = { ok: false, code: "ERR_FORBIDDEN", reason: "role_not_held" };
    expect(main(await open(SesiPage))).toContain("Anda tidak memiliki akses ke Sesi Dukungan.");
    h.tenants = { ok: true, data: { rows: [] } };
    for (const bad of [
      { ok: false, code: "ERR_FORBIDDEN", reason: "totp_not_verified" },
      { ok: true, rows: [{ ...rows[0], state: "unknown" }] },
      { ok: true, rows: [{ ...rows[0], requested_at: "not-a-date" }] },
      { ok: true, rows: [{ ...rows[0], requested_at: "2026-02-30T02:00:00Z" }] },
      { ok: true, rows: [{ ...rows[0], ends_at: "not-a-date" }] },
      { ok: true, rows: [{ ...rows[0], ends_at: "2026-02-30T02:00:00Z" }] },
      { ok: true, rows: "x" },
    ]) {
      h.sessions = bad;
      const html = main(await open(SesiPage));
      expect(html, JSON.stringify(bad).slice(0, 40)).toContain("Daftar sesi dukungan belum dapat dimuat.");
      expect(html).toContain("Coba Lagi");
      expect(html).not.toContain("SENTINEL");
    }
  });
});

describe("pages without a reader say so", () => {
  it("Integrasi, Audit Vendor, Templat Global and Profil Vendor read 'Belum tersedia' with the reason and show no figure", async () => {
    for (const p of PAGES.filter((x) => ["Integrasi", "Audit Vendor", "Templat Global", "Profil Vendor"].includes(x.title))) {
      h.gate = signedIn(p.roles[0]);
      const html = main(await open(p.page, p.tenantParam ? { tenant: T1 } : {}));
      expect(html, p.title).toContain('data-state="not_available"');
      expect(html, p.title).toContain("Belum tersedia");
      expect(html, p.title).toContain("Konsol Vendor belum punya pembaca");
      expect(html.replace(/<[^>]+>/g, " "), p.title).not.toMatch(/\d/);
      expect(html, p.title).not.toContain("<table");
    }
    expect(h.tenantCalls + h.queries.length).toBe(0);
  });

  it("Profil Vendor points at Onboarding, which its only role (the platform owner) has", async () => {
    h.gate = signedIn("platform_owner");
    const html = main(await open(ProfilPage as Page));
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/vendor/onboarding"]);
    expect(mayOpen(["platform_owner"], "/vendor/onboarding")).toBe(true);
  });

  // DEL-2 (tests/isolation/surfaces.ts cites this): the five pages without a reader hold no data access at all. Their only imports
  // are the console gate, the shell and the router; the two database entry points the gate module exports are never referenced.
  it("the five pages without a reader import no reader and reference no database entry point", () => {
    for (const p of PAGES.filter((x) => x.title !== "Sesi Dukungan")) {
      const src = readFileSync(pageFile(p.href), "utf8");
      const from = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
      const allowed = ["../_lib/console.module.css", "../_lib/server", "../_lib/shell", "next/link", "next/navigation"];
      expect(from.filter((f) => !allowed.includes(f)), p.href).toEqual([]);
      expect(/import \{([^}]*)\} from "\.\.\/_lib\/server"/.exec(src)![1].trim(), p.href).toBe("consoleGate");
      expect(src, p.href).not.toMatch(/vendorPool|\bcall\b|\.query\(|modules\/|select |fetch\(/);
    }
  });

  it("every allowed role opens each of the five pages without one database call", async () => {
    for (const p of PAGES.filter((x) => x.title !== "Sesi Dukungan")) {
      for (const role of p.roles) {
        h.gate = signedIn(role);
        await open(p.page, p.tenantParam ? { tenant: T1 } : {});
      }
    }
    expect(h.tenantCalls + h.queries.length).toBe(0);
  });

  it("Feature Flag Platform shows the empty Release 1 catalogue and nothing to switch", async () => {
    h.gate = signedIn("platform_owner");
    const html = main(await open(FlagPage as Page));
    expect(html).toContain("Belum ada fitur khusus tender.");
    expect(html).toContain('data-state="empty"');
    expect(html).not.toMatch(/href=|<input|role="switch"|checkbox/);
  });
});
