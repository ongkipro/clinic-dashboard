// PR-33e (T-113) — Ringkasan CS (UX-36). Waiting semantics (current, documented): a lead waits when it ENTERED while its branch was open
// (branch_is_open at created_at, the K14 basis), its wait is WALL-CLOCK minutes since entry, overdue = lead_list's verdict vs today's SET-20;
// proven against PostgreSQL below. The pure part pins what the view owns:
// a lead whose wait exceeds the SET-20 target is counted overdue (Scenario PR-33e), Perlu ditangani order and
// hiding, K14 and K13 figures, unavailable ≠ 0, one state per screen, drill-down links from caller props, compact and
// regular layouts, and no clinical text.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// The page gate (ringkasan/cs/data.ts) reads the request context; here a controllable stand-in (as other route tests do).
const gate = vi.hoisted(() => ({ rc: null as unknown, pool: null as unknown }));
vi.mock("server-only", () => ({}));
// redirect() / notFound() throw Next's control-flow errors in a request; here they throw a plain, recognisable error (as the T-116 route tests do).
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("../../src/modules/org/context/store", () => ({ requestContext: async () => gate.rc, appPool: async () => gate.pool }));
import { type Count, type CsSummaryData, type CsSummaryProps, type FunnelRow, inbox, isOverdue, minutes, rate, sortFunnel, type WaitingLead } from "../../src/app/(app)/ringkasan/cs/model";
import { CsSummary } from "../../src/app/(app)/ringkasan/cs/view";
import { csIn, csWindow, PATH as CS_PATH, READ_FAILED, readers as csReaders } from "../../src/app/(app)/ringkasan/cs/load";
import { loadCsPage } from "../../src/app/(app)/ringkasan/cs/data";
import { csBody, ScopeChips } from "../../src/app/(app)/ringkasan/cs/body";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { ROLES, type Role } from "../../src/auth/policy";
import { LEVEL3_ROLES } from "../../src/modules/org/schema";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { FORBIDDEN, k13From, k14From, readCsSummary, SEAMS } from "../../src/app/(app)/ringkasan/cs/reader";
import { createHarness, type Harness, testPool } from "../rls/harness";

const n = (x: number): Count => ({ state: "value", n: x });
const html = (p: CsSummaryProps) => renderToStaticMarkup(h(CsSummary, p));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const section = (out: string, id: string) => text(out.slice(out.indexOf(`id="${id}"`), out.indexOf("</section>", out.indexOf(`id="${id}"`))));
const lead = (id: string, waitingMinutes: number, over: Partial<WaitingLead> = {}): WaitingLead =>
  ({ id, contact: `Kontak ${id}`, source: "whatsapp", branch: "Cabang A", assigned: true, waitingMinutes, href: `/pesan/${id}`, ...over });
const funnel = (source: FunnelRow["source"], lead: number, paid: number): FunnelRow =>
  ({ source, lead, booked: Math.max(paid, Math.floor(lead / 2)), arrived: paid, paid, href: `/lead?sumber=${source}` });

function data(over: Partial<CsSummaryData> = {}): CsSummaryData {
  return {
    slaMinutes: 15,
    waiting: [lead("a", 20), lead("b", 5, { assigned: false }), lead("c", 95, { assigned: false, branch: null })],
    newToday: n(9),
    inboxHref: { unassigned: "/pesan?tampilan=belum-ditugaskan", overdue: "/pesan?tampilan=lewat-sla" },
    unconfirmed: { count: n(4), href: "/jadwal?status=belum-konfirmasi" },
    complaints: { count: n(0), href: "/keluhan?jenis=layanan" },
    lowSurveys: { count: n(2), href: "/lead/survei?nilai=rendah" },
    k14: { median: 12, within: { state: "value", num: 18, den: 20 }, within15: { state: "value", num: 16, den: 20 }, slaMix: [{ minutes: 15, leads: 20, within: 18 }], href: "/lead",
      trend: [{ label: "M1", within: { state: "value", num: 9, den: 10 } }, { label: "M2", within: { state: "value", num: 7, den: 10 } }] },
    k13: { period: "November 2026", rows: [funnel("instagram", 10, 2), funnel("whatsapp", 20, 8), funnel("tiktok", 0, 0)] },
    ...over,
  };
}
const ready = (d: CsSummaryData = data()): CsSummaryProps => ({ scope: "Semua Cabang", state: { kind: "ready", data: d } });

describe("Scenario PR-33e overdue leads: 20 opening-hours minutes unanswered vs the 15-minute target", () => {
  it("is overdue; exactly at the target is not", () => {
    expect(isOverdue(lead("x", 20), 15)).toBe(true);
    expect(isOverdue(lead("x", 15), 15)).toBe(false);
    expect(isOverdue(lead("x", 14), 15)).toBe(false);
  });
  it("is counted on the dashboard against the 15-minute target", () => {
    const out = html(ready(data({ waiting: [lead("x", 20)] })));
    expect(text(out)).toContain("1 lead lewat 15 menit");
    expect(text(out)).toContain("Menunggu 20 menit");
  });
  it("follows the tenant's SET-20 target, not a fixed 15", () => {
    expect(text(html(ready(data({ slaMinutes: 30, waiting: [lead("x", 20)] }))))).not.toContain("lewat");
  });
});

describe("Perlu ditangani", () => {
  const out = html(ready());
  it("overdue longest wait first; unassigned counted across all waiting leads", () => {
    const { overdue, unassigned } = inbox(data());
    expect(overdue.map((l) => l.id)).toEqual(["c", "a"]);
    expect(unassigned).toEqual({ state: "value", n: 2 });
    expect(out.indexOf("Kontak c")).toBeLessThan(out.indexOf("Kontak a"));
    expect(out).not.toContain("Kontak b"); // within target: not listed as overdue
    expect(text(out)).toContain("2 lead belum ditugaskan");
    expect(text(out)).toContain("Menunggu 1 jam 35 menit");
    expect(text(out)).toContain("Belum diarahkan ke cabang");
  });
  it("hides zero items; shows unavailable items as 'Belum tersedia', never 0", () => {
    expect(text(out)).not.toContain("keluhan layanan terbuka");
    expect(text(out)).toContain("4 janji belum dikonfirmasi");
    const u = text(html(ready(data({ complaints: { count: { state: "unavailable", reason: "r" }, href: "/keluhan" } }))));
    expect(u).toContain("Belum tersedia keluhan layanan terbuka");
  });
  it("disappears when nothing needs attention", () => {
    const calm = html(ready(data({ waiting: [lead("x", 3)], unconfirmed: { count: n(0), href: "/j" }, lowSurveys: { count: n(0), href: "/s" } })));
    expect(calm).not.toContain("Perlu ditangani");
  });
});

describe("K14 and K13", () => {
  const out = html(ready());
  it("K14 shows % within target, median and a finding-titled trend with a data table", () => {
    const k = section(out, "kpi-k14");
    expect(k).toContain("90%");
    expect(k).toContain("dibalas sesuai SLA yang berlaku saat lead masuk, pada jam buka");
    expect(k).toContain("SLA 15 menit: 18 dari 20");
    expect(k).toContain("Dibalas ≤ 15 menit: 80%");
    expect(k).toContain("Median respons: 12 menit");
    expect(k).toContain("Target 90% tercapai di 1 dari 2 minggu");
    expect(out).toContain("Tabel data");
  });
  it("K14 with no leads has no rate and no median", () => {
    const k = section(html(ready(data({ k14: { median: null, within: { state: "value", num: 0, den: 0 }, within15: { state: "value", num: 0, den: 0 }, slaMix: [], trend: [], href: "/lead" } }))), "kpi-k14");
    expect(k).toContain("Belum tersedia");
    expect(k).toContain("Median respons: Belum tersedia");
    expect(k).not.toMatch(/\b0%/);
    expect(rate({ state: "value", num: 0, den: 4 })).toBe("0%");
  });
  it("K13 by source, best paid conversion first, sources with no leads last", () => {
    expect(sortFunnel([funnel("instagram", 10, 2), funnel("whatsapp", 20, 8), funnel("tiktok", 0, 0)]).map((r) => r.source)).toEqual(["whatsapp", "instagram", "tiktok"]);
    const k = section(out, "kpi-k13");
    expect(k).toMatch(/WhatsApp 20 10 8 8 40%/);
    expect(k).toMatch(/Instagram 10 5 2 2 20%/);
    expect(k).toMatch(/TikTok 0 0 0 0 Belum tersedia/);
  });
  it("unavailable K13 / K14 read 'Belum tersedia' with the reason", () => {
    const o = html(ready(data({ k13: { state: "unavailable", reason: "Menunggu pembacaan lead" }, k14: { state: "unavailable", reason: "Jam buka cabang belum diisi", href: "/lead" } })));
    expect(section(o, "kpi-k13")).toContain("Menunggu pembacaan lead");
    expect(section(o, "kpi-k14")).toContain("Jam buka cabang belum diisi");
  });
  it("minutes read naturally", () => {
    expect(minutes(5)).toBe("5 menit");
    expect(minutes(60)).toBe("1 jam 0 menit");
  });
});

describe("drill-down and layout", () => {
  const out = html(ready());
  it("every item links to the caller's target (UX-17 Pesan, Lead, Jadwal)", () => {
    for (const href of ["/pesan?tampilan=lewat-sla", "/pesan?tampilan=belum-ditugaskan", "/pesan/c", "/pesan/a", "/jadwal?status=belum-konfirmasi",
      "/lead/survei?nilai=rendah", "/lead", "/lead?sumber=whatsapp", "/lead?sumber=instagram"]) {
      expect(out).toContain(`href="${href}"`);
    }
  });
  it("compact list and regular table, toggled by the CONTAINER's text size and never by the viewport (WCAG 1.4.10: no sideways scroll at 200 % text); two columns from a wide container", () => {
    expect(out).toContain("@container");
    expect(out).toContain("@min-[48em]:block");
    expect(out).toContain("@min-[48em]:hidden");
    expect(out).toContain("grid-cols-[minmax(0,1fr)] gap-3 @min-[64em]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
    expect(out).not.toMatch(/min-\[(700|900)px\]/); // a viewport breakpoint cannot follow the text size
  });
  it("no file of the page carries a viewport breakpoint (sm: md: lg: xl: 2xl: min-[..]: max-[..]:): the layout follows the container", () => {
    const dir = join(__dirname, "../../src/app/(app)/ringkasan/cs");
    const files = readdirSync(dir).filter((f) => /\.(tsx|ts|css)$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(8);
    const VIEWPORT = /(^|[\s"'`])((sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl):|min-\[[0-9.]+(px|rem|em)\]:|max-\[[0-9.]+(px|rem|em)\]:)/;
    for (const f of files) expect(readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("//") && VIEWPORT.test(l)), f).toEqual([]);
    // the guard bites: the lines P1 shipped would have matched it
    expect(VIEWPORT.test('className="hidden min-w-0 overflow-x-auto min-[700px]:block"')).toBe(true);
    expect(VIEWPORT.test('className="grid min-w-0 gap-3 @min-[48em]:grid-cols-2"')).toBe(false);
  });
  it("an overdue lead's row keeps its 'Menunggu …' badge under the text, never in a trailing slot that squeezes the contact name at 390 px and 200 % text", () => {
    const row = out.slice(out.indexOf("Kontak c"), out.indexOf("</li>", out.indexOf("Kontak c")));
    expect(row).toContain("Menunggu 1 jam 35 menit");
    expect(row.indexOf("Kontak c")).toBeLessThan(row.indexOf("Menunggu 1 jam 35 menit"));
    expect(row).toContain('data-slot="status-badge"');
    const closeLink = row.indexOf("</a>");
    expect(closeLink).toBeGreaterThan(-1);
    expect(row.slice(0, closeLink)).not.toContain('data-slot="status-badge"'); // not part of the link's flex line, where it squeezed the contact name: Row's children sit OUTSIDE the link (templates.tsx)
    expect(row.slice(closeLink)).toContain("Menunggu 1 jam 35 menit");
  });
  it("no destination = plain text (T-113 nav fix): a low-survey item and K13 rows without href keep their values, render no link and no chevron", () => {
    const d = data({ lowSurveys: { count: n(2) }, k13: { period: "Oktober 2026", rows: [{ source: "instagram", lead: 4, booked: 2, arrived: 1, paid: 1 }] } });
    const o = html(ready(d));
    const perlu = o.slice(o.indexOf('aria-label="Perlu ditangani"'), o.indexOf("</ul>", o.indexOf('aria-label="Perlu ditangani"')));
    const survey = perlu.slice(perlu.lastIndexOf("<li", perlu.indexOf("2 survei bernilai rendah")), perlu.indexOf("</li>", perlu.indexOf("2 survei bernilai rendah")));
    expect(survey).toContain("data-plain");
    expect(survey).not.toMatch(/<a |<svg/);
    const k13 = o.slice(o.indexOf('id="kpi-k13"'), o.indexOf("</section>", o.indexOf('id="kpi-k13"')));
    expect(text(k13)).toContain("Instagram");
    expect(text(k13)).toMatch(/4 lead · 2 booking · 1 datang · 1 bayar/);
    expect(text(k13)).toContain("25%");
    expect(k13).not.toContain("<a ");
    expect(k13).toMatch(/<th scope="row" class="py-1"><span class="inline-flex min-h-\[var\(--target\)\][^"]*">Instagram<\/span><\/th>/);
    expect(o).not.toMatch(/href="\/lead\/tindak-lanjut|href="\/lead\?sumber=/);
  });
  it("the K13 source link is a 44 px target in the regular table too, not only in the compact list", () => {
    expect(out).toMatch(/<th scope="row" class="py-1"><a [^>]*inline-flex min-h-\[var\(--target\)\][^>]*>/);
  });
});

describe("one state per screen (10 State Copy Patterns)", () => {
  const cases = [
    [{ kind: "loading" }, 'aria-busy="true"'],
    [{ kind: "empty", message: "Belum ada lead." }, "Belum ada lead."],
    [{ kind: "filtered-empty", message: "Tidak ada lead untuk filter ini.", clearHref: "/ringkasan/cs" }, "Hapus Filter"],
    [{ kind: "error", message: "Koneksi terputus.", retryHref: "/ringkasan/cs" }, "Coba Lagi"],
    [{ kind: "blocked", reason: "Nomor WhatsApp belum terhubung", unblock: "Owner dapat menghubungkan nomor di Pengaturan" }, "Nomor WhatsApp belum terhubung."],
    [{ kind: "permission", object: "ringkasan CS" }, "Anda tidak memiliki akses ke ringkasan CS."],
  ] as const;
  it.each(cases)("%o renders its copy and no figure", (state, copy) => {
    const out = html({ scope: "Semua Cabang", state });
    expect(out).toContain(copy);
    expect(out).not.toContain("data-kpi=");
    expect(out).not.toContain("Perlu ditangani");
  });
});

describe("no clinical content and safe text", () => {
  it("escapes contact names and renders no clinical vocabulary", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const out = html(ready(data({ waiting: [lead("x", 40, { contact: hostile })] })));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(text(out)).not.toMatch(/diagnos|alergi|resep|anamnesis|rekam medis|klinis/i);
  });
  it("waiting leads carry no message body (type-level guard)", () => {
    // @ts-expect-error — no message text on the summary
    const bad: WaitingLead = { ...lead("x", 1), lastMessage: "x" };
    expect(bad).toBeTruthy();
  });
});

// ── slice 2 (P1, on main f0bd3c44): K13 / K14 from the real dashboard_kpi, the inbox from lead_list, surveys from survey_summary. ──
describe("K14 / K13 mapping (pure)", () => {
  const x = { leads: 4, answered: 3, median_minutes: 10.5, within_15m: 1, within_sla: 2, sla_minutes: 30,
    sla_mix: [{ minutes: 15, leads: 2, within: 1 }, { minutes: 30, leads: 2, within: 1 }] };
  it("the SLA share keeps its at-entry thresholds (sla_mix); today's SET-20 never labels it; the 15-minute literal stays separate", () => {
    const k = k14From(x, "/lead");
    expect(k).toMatchObject({ median: 11, within: { state: "value", num: 2, den: 4 }, within15: { state: "value", num: 1, den: 4 }, slaMix: x.sla_mix });
    const out = text(html(ready(data({ slaMinutes: 30, k14: k }))));
    const sec = section(html(ready(data({ slaMinutes: 30, k14: k }))), "kpi-k14");
    expect(sec).toContain("SLA 15 menit: 1 dari 2 · SLA 30 menit: 1 dari 2");
    expect(sec).toContain("Dibalas ≤ 15 menit: 25%");
    expect(sec).not.toMatch(/dalam 30 menit/);
    expect(out).toContain("50%");
  });
  it("a refused K14 is 'Tidak tersedia untuk peran ini'; no leads is no rate, not 0 %", () => {
    expect(section(html(ready(data({ k14: k14From(null, "/lead") }))), "kpi-k14")).toContain(FORBIDDEN);
    const none = section(html(ready(data({ k14: k14From({ ...x, leads: 0, answered: 0, median_minutes: null, within_15m: 0, within_sla: 0, sla_mix: [] }, "/lead") }))), "kpi-k14");
    expect(none).toContain("Median respons: Belum tersedia");
    expect(none).not.toMatch(/\b0%/);
  });
  it("K13 rows from by_grp1; an unknown source is dropped, never relabelled", () => {
    expect(k13From({ ads: { lead: 2, booked: 1 }, bogus: { lead: 9 } }, (s) => `/lead?sumber=${s}`))
      .toEqual([{ source: "ads", lead: 2, booked: 1, arrived: 0, paid: 0, href: "/lead?sumber=ads" }]);
  });
  it("overdue follows the lead reader's own verdict (exact instant vs SET-20), not the floored minutes", () => {
    const w = (id: string, waitingMinutes: number, overdue?: boolean): WaitingLead =>
      ({ id, contact: id, source: "whatsapp", branch: "Cabang A", assigned: true, waitingMinutes, href: `/lead/${id}`, ...(overdue === undefined ? {} : { overdue }) });
    // 15 min 30 s: floor 15 is not > 15, but the reader says overdue → overdue; a reader "not overdue" at 20 floored minutes wins too
    const d = data({ slaMinutes: 15, waiting: [w("edge", 15, true), w("kept", 20, false), w("legacy", 16)] });
    expect(inbox(d).overdue.map((l) => l.id)).toEqual(["legacy", "edge"]);
  });
  it("an unreadable wait is shown as unavailable with its reason — never '0 lewat'", () => {
    const o = text(html(ready(data({ waiting: [], waitingUnavailable: FORBIDDEN, unassigned: { state: "value", n: 3 } }))));
    expect(o).toContain(`Lead lewat 15 menit: Belum tersedia — ${FORBIDDEN}`);
    expect(o).toContain("3 lead belum ditugaskan");
    expect(o).not.toMatch(/\b0 lead lewat/);
  });
});

describe("Ringkasan CS page window and authority (load.ts)", () => {
  const now = new Date("2026-11-21T03:00:00Z"); // 10:00 WIB
  it("this month to today (Asia/Jakarta); a malformed ?cabang is ignored; the page is central CS only (nav row)", () => {
    expect(csWindow({}, now)).toEqual({ from: "2026-11-01", to: "2026-11-21", today: "2026-11-21", label: "November 2026", branchId: null });
    expect(csWindow({ cabang: "0190a3f2-0000-7000-8000-000000000001" }, now).branchId).toBe("0190a3f2-0000-7000-8000-000000000001");
    expect(csWindow({ cabang: "x' or 1=1" }, now).branchId).toBeNull();
    expect(csWindow({}, new Date("2026-11-30T17:30:00Z")).today).toBe("2026-12-01"); // 00:30 WIB is the next local day
    expect([...csReaders()]).toEqual(["central_cs"]);
    expect(CS_PATH).toBe("/ringkasan/cs");
  });
});

describe("T-113 route mount: page, error boundary and page body (no database)", () => {
  const ctxOf = (role: Role) => ({ kind: "ok", active: { context: { actingRole: role } } });
  it("the route exports only a default page and metadata (a Next page file may export nothing else); the title names the page", async () => {
    const m = await import("../../src/app/(app)/ringkasan/cs/page");
    expect(Object.keys(m).sort()).toEqual(["default", "metadata"]);
    expect((m.metadata as { title: string }).title).toBe("Ringkasan CS — Clinic Dashboard");
  });
  it("loading: while the body streams the page shows the title with a busy skeleton (Suspense fallback), never a figure", async () => {
    const m = await import("../../src/app/(app)/ringkasan/cs/page");
    const main = m.default({ searchParams: Promise.resolve({}) }) as { props: { children: { props: { fallback: unknown } } } };
    const out = renderToStaticMarkup(main.props.children.props.fallback as never);
    expect(out).toContain('aria-busy="true"');
    expect(text(out)).toContain("Ringkasan CS");
    expect(out).not.toMatch(/data-kpi|Lead baru|lewat \d+ menit/);
  });
  it("error boundary: the title, 'Coba Lagi' wired to retry, and never the error's own text", async () => {
    const e = await import("../../src/app/(app)/ringkasan/cs/error");
    const retry = vi.fn();
    const el = e.default({ error: new Error("rahasia: koneksi basis data putus"), retry }) as { props: { children: { props: { onRetry: unknown } }[] } };
    const out = renderToStaticMarkup(el as never);
    expect(out).toContain("Ringkasan CS belum bisa dimuat. Tidak ada yang berubah.");
    expect(out).toContain('role="alert"');
    expect(out).toContain("Coba Lagi");
    expect(out).not.toContain("rahasia");
    expect(el.props.children[1].props.onRetry).toBe(retry);
  });
  it("csBody gate: every role outside the nav row (central CS only) gets the permission state BEFORE any read; there is no pool to read from", async () => {
    gate.pool = null;
    for (const role of ROLES.filter((r) => r !== "central_cs")) {
      gate.rc = ctxOf(role);
      const out = renderToStaticMarkup((await csBody(Promise.resolve({}))) as never);
      expect(text(out), role).toContain("Anda tidak memiliki akses ke ringkasan CS.");
      expect(out, role).not.toMatch(/data-kpi|Lead baru|Perlu ditangani|href="\/lead/);
    }
  });
  it("csBody: a signed-out request is redirected; a blocked account gets the permission state", async () => {
    gate.pool = null;
    gate.rc = { kind: "redirect", to: "/masuk" };
    await expect(csBody(Promise.resolve({}))).rejects.toThrow("NEXT_REDIRECT /masuk");
    gate.rc = { kind: "blocked", accountId: "x" };
    expect(text(renderToStaticMarkup((await csBody(Promise.resolve({}))) as never))).toContain("Anda tidak memiliki akses ke ringkasan CS.");
  });
  it("branch scope chips: 'Semua Cabang' first and current without ?cabang=, then each branch; the current one is aria-current; one branch shows none", () => {
    const branches = [{ id: "b1", name: "Kemang" }, { id: "b2", name: "BSD" }];
    const all = renderToStaticMarkup(h(ScopeChips, { branches, active: null }));
    expect([...all.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[2], m[1]])).toEqual([["Semua Cabang", "/ringkasan/cs"], ["Kemang", "/ringkasan/cs?cabang=b1"], ["BSD", "/ringkasan/cs?cabang=b2"]]);
    expect(all.match(/aria-current="true"/g)).toHaveLength(1);
    expect(all).toMatch(/aria-current="true"[^>]*>Semua Cabang</);
    const one = renderToStaticMarkup(h(ScopeChips, { branches, active: "b2" }));
    expect(one).toMatch(/href="\/ringkasan\/cs\?cabang=b2"[^>]*aria-current="true"|aria-current="true"[^>]*href="\/ringkasan\/cs\?cabang=b2"/);
    expect(one.match(/aria-current="true"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(h(ScopeChips, { branches: [branches[0]], active: null }))).toBe("");
  });
});

describe("readCsSummary on the real readers (PostgreSQL, synthetic; role and branch scope)", () => {
  let h: Harness; let app: pg.Pool; let owner: pg.Pool; let nn = 0;
  type T = { tenantId: string; b1: string; b2: string };
  type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
  const WIDE: string[] = ROLES.filter((r) => !(LEVEL3_ROLES as readonly string[]).includes(r));
  const tenant = async (name: string): Promise<T> => {
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
    const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
    return { tenantId, b1: await br("CS-A"), b2: await br("CS-B") };
  };
  const person = async (t: T, role: Role, ...branches: string[]): Promise<P> => {
    const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`cs${++nn}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf CS ${nn}` });
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
    return { acc, staffId, tenantId: t.tenantId, role, branch: WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
  };
  const as = async <X>(p: P, fn: (db: pg.PoolClient) => Promise<X>) =>
    withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
  const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : String(e)));
  async function seedRaw(tables: string[], fn: () => Promise<void>) {
    const off: [string, string][] = [];
    for (const tb of tables) for (const r of (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
    for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} disable trigger ${tg}`);
    try { await fn(); } finally { for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} enable always trigger ${tg}`); }
  }
  const P10 = { from: "2026-10-01", to: "2026-10-31", today: "2026-10-31", label: "Oktober 2026", href: (s: string) => `/lead?sumber=${s}` };
  const at = (local: string) => `${local}+07`;
  let A: T; let CS: P; let MK: P; let MGR: P; let FO: P; let BCS: P;

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local";
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
    A = await tenant("PT CS Sintetis"); const B = await tenant("PT CS Lain");
    CS = await person(A, "central_cs"); MK = await person(A, "marketing"); MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1);
    BCS = await person(B, "central_cs");
    await seedRaw(["branch_hours", "setting_versions", "leads", "surveys"], async () => {
      const c = await owner.connect();
      await c.query("begin"); await c.query("set local session_replication_role = replica");
      const q = (sql: string, args: unknown[]) => c.query(sql, args);
      try {
      for (const b of [A.b1, A.b2]) for (const wd of [0, 1, 2, 3, 4, 5, 6]) await q(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, $3, '09:00', '17:00')`, [A.tenantId, b, wd]);
      // SET-20 15 until 2026-10-10, then 30 (the at-entry threshold matters)
      for (const [v, from] of [["15", "2026-01-01"], ["30", "2026-10-10"]]) await q(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
        values ($1, 'SET-20', $2::jsonb, $3, 'active', $4, 'owner', 'Pemilik', 'SLA uji')`, [A.tenantId, v, at(`${from} 00:00`), CS.staffId]);
      const lead = (branch: string, src: string, created: string, resp: string | null, stage = resp ? "contacted" : "new") => q(
        `insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key, created_at)
         values ($1, $2, $3, $4, $5, $5, $6, 'central_cs', $7, $8)`, [A.tenantId, branch, src, stage, resp ? at(resp) : null, CS.staffId, `ld-${crypto.randomUUID()}`, at(created)]);
      await lead(A.b1, "instagram", "2026-10-05 10:00", "2026-10-05 10:20"); // 20 min under SLA 15 → late
      await lead(A.b1, "instagram", "2026-10-06 10:00", "2026-10-06 10:10"); // 10 min under SLA 15 → on time
      await lead(A.b1, "ads", "2026-10-12 10:00", "2026-10-12 10:20");       // 20 min under SLA 30 → on time
      await lead(A.b2, "ads", "2026-10-13 10:00", null);                      // unanswered under SLA 30, branch B
      // a low score needs its follow-up (surveys_check); the follow-up row itself is not read (FK triggers off for the seed)
      await q(`insert into surveys (tenant_id, branch_id, visit_id, patient_id, score, review_eligible, command_key, recorded_by, recorded_as, recorded_at, followup_id)
        values ($1, $2, gen_random_uuid(), gen_random_uuid(), 1, false, $3, $4, 'manager', $5, gen_random_uuid())`, [A.tenantId, A.b1, `sv-${crypto.randomUUID()}`, MGR.staffId, at("2026-10-20 10:00")]);
        await c.query("commit");
      } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    });
  }, 300_000);
  afterAll(async () => { await app?.end(); await owner?.end(); await h?.close(); });

  it("central CS (tenant-wide): K14 = 2 of 4 by the SLA at entry (15 → 30), labelled by sla_mix; K13 by source; low surveys 1; seams unavailable", async () => {
    const d = await as(CS, (db) => readCsSummary(db, P10));
    expect(d.k14).toMatchObject({ within: { state: "value", num: 2, den: 4 }, within15: { state: "value", num: 1, den: 4 },
      slaMix: [{ minutes: 15, leads: 2, within: 1 }, { minutes: 30, leads: 2, within: 1 }] });
    expect(d.slaMinutes).toBe(30); // today's target, for the live inbox only
    expect("rows" in d.k13 && d.k13.rows.map((r) => [r.source, r.lead, r.paid]).sort()).toEqual([["ads", 2, 0], ["instagram", 2, 0]]);
    expect(d.lowSurveys.count).toEqual({ state: "value", n: 1 });
    expect([d.unconfirmed.count, d.complaints.count]).toEqual([{ state: "unavailable", reason: SEAMS.unconfirmed }, { state: "unavailable", reason: SEAMS.complaints }]);
    // Scenario PR-33e on PostgreSQL: the B lead entered at 10:00 (open hours) on 2026-10-13 and is still unanswered → overdue now vs SET-20 30
    expect(d.waitingUnavailable).toBeUndefined();
    expect(d.waiting.map((l) => [l.branch, l.overdue, l.assigned])).toEqual([["CS-B", true, false]]);
    expect(d.waiting[0].waitingMinutes).toBeGreaterThan(30);
    expect(d.unassigned).toEqual({ state: "value", n: 1 }); // the open B lead has no assignee
    const sec = section(html({ scope: "Semua Cabang", state: { kind: "ready", data: d } }), "kpi-k14");
    expect(sec).toContain("SLA 15 menit: 1 dari 2 · SLA 30 menit: 1 dari 2");
    expect(sec).not.toMatch(/dalam 30 menit/);
  });
  it("Scenario PR-33e on PostgreSQL: a lead unanswered for 20 minutes during opening hours is overdue against a 15-minute target; controls are not", async () => {
    // a third tenant open around the clock today (Asia/Jakarta), SET-20 = 15; leads seeded relative to NOW (lead_list reads clock_timestamp)
    const C = await tenant("PT CS Skenario");
    const cs = await person(C, "central_cs");
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const ids: Record<string, string> = {};
    await seedRaw(["branch_hours", "branch_closures", "setting_versions", "leads"], async () => {
      for (const wd of [0, 1, 2, 3, 4, 5, 6]) await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, $3, '00:00', '23:59:59.999999')`, [C.tenantId, C.b1, wd]);
      // branch b2 is closed all of today: a lead entering there is outside the opening-hours population
      await h.admin.query(`insert into branch_closures (tenant_id, branch_id, closed_on, reason, created_by) values ($1, $2, (now() at time zone 'Asia/Jakarta')::date, 'Tutup uji', $3)`, [C.tenantId, C.b2, cs.staffId]);
      await h.admin.query(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
        values ($1, 'SET-20', '15'::jsonb, now() - interval '30 days', 'active', $2, 'owner', 'Pemilik', 'SLA uji')`, [C.tenantId, cs.staffId]);
      const lead = async (k: string, branch: string, created: string, resp: string | null) => {
        ids[k] = (await h.admin.query(`insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key, created_at)
          values ($1, $2, 'whatsapp', $3, $4, $4, $5, 'central_cs', $6, $7) returning id`, [C.tenantId, branch, resp ? "contacted" : "new", resp, cs.staffId, `ld-${crypto.randomUUID()}`, created])).rows[0].id;
      };
      await lead("late", C.b1, ago(20), null);       // the scenario: 20 minutes, open hours, unanswered → overdue
      await lead("fresh", C.b1, ago(10), null);      // 10 minutes → waiting, not overdue
      await lead("closed", C.b2, ago(40), null);     // entered while its branch was closed → not in the population
      await lead("answered", C.b1, ago(60), ago(55)); // answered → not waiting
    });
    const d = await as(cs, (db) => readCsSummary(db, { ...P10, today: ago(0).slice(0, 10) }));
    expect(d.slaMinutes).toBe(15);
    expect(d.waitingUnavailable).toBeUndefined();
    expect(d.waiting.map((l) => l.id).sort()).toEqual([ids.late, ids.fresh].sort());
    const { overdue } = inbox(d);
    expect(overdue.map((l) => l.id)).toEqual([ids.late]);
    expect(overdue[0].waitingMinutes).toBeGreaterThanOrEqual(20);
    const o = text(html({ scope: "Semua Cabang", state: { kind: "ready", data: d } }));
    expect(o).toContain("1 lead lewat 15 menit");
    // the closed-branch lead is never called overdue, even though it is the oldest
    expect(overdue.some((l) => l.id === ids.closed)).toBe(false);
  });
  it("branch scope: CS filtered to A sees A's leads only (3); a branch of another tenant is refused (not a value)", async () => {
    const d = await as(CS, (db) => readCsSummary(db, { ...P10, branchId: A.b1 }));
    expect(d.k14).toMatchObject({ within: { state: "value", num: 2, den: 3 } });
    expect(d.unassigned).toEqual({ state: "value", n: 0 });
    const B2 = await tenant("PT CS Ketiga");
    expect(await code(as(CS, (db) => readCsSummary(db, { ...P10, branchId: B2.b1 })))).toBe("ERR_NOT_FOUND");
  });
  it("manager-own-branch: the manager reads its branch; naming another branch is refused by the readers", async () => {
    const d = await as(MGR, (db) => readCsSummary(db, P10));
    expect(d.k14).toMatchObject({ within: { state: "value", num: 2, den: 3 } });
    expect(await code(as(MGR, (db) => readCsSummary(db, { ...P10, branchId: A.b2 })))).toBe("ERR_NOT_FOUND");
  });
  it("role authority as it exists: FO is refused by every reader → each part 'Tidak tersedia untuk peran ini', never 0", async () => {
    const d = await as(FO, (db) => readCsSummary(db, P10));
    expect(d.k14).toMatchObject({ state: "unavailable", reason: FORBIDDEN });
    expect(d.k13).toEqual({ state: "unavailable", reason: FORBIDDEN });
    expect([d.newToday, d.unassigned, d.lowSurveys.count]).toEqual([0, 1, 2].map(() => ({ state: "unavailable", reason: FORBIDDEN })));
    // the waiting list is unavailable with the reason (never an empty "nothing overdue")
    expect([d.waiting, d.waitingUnavailable]).toEqual([[], FORBIDDEN]);
    // marketing (K13 / K14 allowed, leads allowed) reads the same K14 as central CS
    expect((await as(MK, (db) => readCsSummary(db, P10))).k14).toMatchObject({ within: { state: "value", num: 2, den: 4 } });
  });
  it("page core: central CS gets the ready summary with branches and scope; a branch of another tenant is not found (TEN-1); the gaps stay unavailable", async () => {
    const all = await as(CS, (db) => csIn(db, {}, new Date()));
    if (all.kind !== "ok" || all.props.state.kind !== "ready") throw new Error("unexpected");
    expect(all.props.scope).toBe("Semua Cabang");
    expect(all.branches.map((b) => b.name)).toEqual(["CS-A", "CS-B"]);
    expect([all.props.state.data.unconfirmed.count, all.props.state.data.complaints.count]).toEqual([
      { state: "unavailable", reason: SEAMS.unconfirmed }, { state: "unavailable", reason: SEAMS.complaints }]);
    const one = await as(CS, (db) => csIn(db, { cabang: A.b1 }, new Date()));
    expect(one).toMatchObject({ kind: "ok", branchId: A.b1, props: { scope: "CS-A" } });
    // T-113 nav fix: the real loader links nothing to an unbuilt page (/lead/tindak-lanjut) or one that ignores the filters (/lead?sumber=&cabang=)
    const oct = await as(CS, (db) => csIn(db, {}, new Date("2026-10-31T09:00:00Z"))); // the fixture's month: its low survey and its K13 sources
    if (oct.kind !== "ok" || oct.props.state.kind !== "ready") throw new Error("unexpected");
    const d1 = oct.props.state.data;
    expect(d1.lowSurveys).not.toHaveProperty("href");
    expect(d1.lowSurveys.count).toEqual({ state: "value", n: 1 }); // the value stays
    if ("state" in d1.k13) throw new Error("k13 unavailable");
    expect(d1.k13.rows.length).toBeGreaterThan(0);
    for (const row of d1.k13.rows) expect(row).not.toHaveProperty("href");
    if (one.kind === "ok" && one.props.state.kind === "ready" && !("state" in one.props.state.data.k13)) for (const row of one.props.state.data.k13.rows) expect(row).not.toHaveProperty("href");
    const B2 = await tenant("PT CS Keempat");
    expect(await as(CS, (db) => csIn(db, { cabang: B2.b1 }, new Date()))).toEqual({ kind: "not-found" });
  });
  it("page core: a reader fault is the error state with a branch-keeping retry (never an empty summary); a DB fault rolls back; the transaction stays usable", async () => {
    await as(CS, async (db) => {
      const err = console.error; const logged: unknown[] = []; console.error = (...a: unknown[]) => { logged.push(a); };
      try {
        const broken = { query: (sql: string, args?: unknown[]) => db.query(/order by created_at, id$/.test(sql) ? "select 1 / 0 as r" : sql, /order by created_at, id$/.test(sql) ? [] : args) } as unknown as typeof db;
        expect(await csIn(broken, { cabang: A.b1 }, new Date())).toMatchObject({ kind: "ok", props: { state: { kind: "error", message: READ_FAILED, retryHref: `/ringkasan/cs?cabang=${A.b1}` } } });
        const lead = { query: (sql: string, args?: unknown[]) => db.query(/lead_list/.test(sql) ? "select 1 / 0 as r" : sql, /lead_list/.test(sql) ? [] : args) } as unknown as typeof db;
        expect(await csIn(lead, {}, new Date())).toMatchObject({ kind: "ok", props: { state: { kind: "error", retryHref: "/ringkasan/cs" } } });
      } finally { console.error = err; }
      expect(JSON.stringify(logged)).not.toMatch(/division|CS-A|[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect((await db.query(`select 1 as ok`)).rows[0].ok).toBe(1);
    });
  });
  it("page gate (data.ts): only central CS passes; manager / marketing / FO are refused before any read; redirect and blocked kept", async () => {
    const ctx = async (p: P) => resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch });
    gate.pool = app;
    gate.rc = { kind: "ok", active: { context: await ctx(CS) } };
    expect(await loadCsPage({})).toMatchObject({ kind: "ok", props: { scope: "Semua Cabang" } });
    for (const p of [MGR, MK, FO]) {
      gate.rc = { kind: "ok", active: { context: await ctx(p) } };
      expect(await loadCsPage({}), p.role).toEqual({ kind: "forbidden" });
    }
    gate.rc = { kind: "redirect", to: "/masuk" };
    expect(await loadCsPage({})).toEqual({ kind: "redirect", to: "/masuk" });
    gate.rc = { kind: "blocked", accountId: "x" };
    expect(await loadCsPage({})).toEqual({ kind: "forbidden" });
  });
  it("page body (csBody) on the real readers: central CS gets the summary with the scope chips; ?cabang= narrows it; the P1 gaps stay 'Belum tersedia'; a branch of another tenant is Next's not-found", async () => {
    const ctx = async (p: P) => ({ kind: "ok", active: { context: await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }) } });
    gate.pool = app;
    gate.rc = await ctx(CS);
    const all = renderToStaticMarkup((await csBody(Promise.resolve({}))) as never);
    expect(text(all)).toContain("Ringkasan CS");
    expect(text(all)).toContain("Semua Cabang");
    expect([...all.matchAll(/aria-label="Cabang"/g)]).toHaveLength(1);
    expect(all).toMatch(/aria-current="true"[^>]*>Semua Cabang</);
    for (const c of ["CS-A", "CS-B"]) expect(all).toContain(`>${c}<`);
    expect(text(all)).toContain("Belum tersedia"); // the unconfirmed-appointments and complaints seams: never 0
    expect(text(all)).not.toMatch(/\b0 janji belum dikonfirmasi|\b0 keluhan layanan/);
    expect(all).not.toMatch(/href="\/lead\/tindak-lanjut|href="\/lead\?sumber=/); // T-113 nav fix: no dead or filter-ignored link on the rendered page
    const one = renderToStaticMarkup((await csBody(Promise.resolve({ cabang: A.b1 }))) as never);
    expect(text(one)).toContain("CS-A ·");
    expect(one).toMatch(new RegExp(`href="/ringkasan/cs\\?cabang=${A.b1}"[^>]*aria-current="true"|aria-current="true"[^>]*href="/ringkasan/cs\\?cabang=${A.b1}"`));
    const B3 = await tenant("PT CS Kelima");
    await expect(csBody(Promise.resolve({ cabang: B3.b1 }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(text(renderToStaticMarkup((await csBody(Promise.resolve({ cabang: "x' or 1=1" }))) as never))).toContain("Semua Cabang"); // a malformed ?cabang= is ignored
  });
  it("page body (csBody): marketing, a manager and an FO get the permission state with the reader pool present: the role gate runs before any tenant transaction", async () => {
    const ctx = async (p: P) => ({ kind: "ok", active: { context: await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }) } });
    gate.pool = app;
    for (const p of [MK, MGR, FO]) {
      gate.rc = await ctx(p);
      const out = renderToStaticMarkup((await csBody(Promise.resolve({}))) as never);
      expect(text(out), p.role).toContain("Anda tidak memiliki akses ke ringkasan CS.");
      expect(out, p.role).not.toMatch(/data-kpi|Perlu ditangani|aria-label="Cabang"/);
    }
  });
  it("cross-tenant: tenant B's central CS sees none of A's leads (no data, not A's figures)", async () => {
    const d = await as(BCS, (db) => readCsSummary(db, P10));
    expect(d.k14).toMatchObject({ within: { state: "value", num: 0, den: 0 } });
    expect("rows" in d.k13 && d.k13.rows).toEqual([]);
    expect(d.lowSurveys.count).toEqual({ state: "value", n: 0 });
  });
});
