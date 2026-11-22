// PR-33f (T-114) — Ringkasan Keuangan (UX-22 ▸ Ringkasan), presentational slice.
// Synthetic props only: no database and no T-107 reader yet. The sub-ledger roll-forward facts are proven against PostgreSQL
// by T-104 / the wiring; here we pin what the view owns: every roll-forward it shows is checked opening + movements =
// closing (Scenario PR-33f), a mismatch or an unknown side is never shown as balanced, K1 per method minus cash refunds,
// K5 = the four prepaid ledgers, unavailable ≠ Rp0 (no partial sums), cues, branch / consolidated filter, one state per
// screen, drill-down links from caller props, compact and regular layouts, and no clinical text.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
// The page gate (keuangan/ringkasan/data.ts) reads the request context; here a controllable stand-in (as other route tests do).
const gate = vi.hoisted(() => ({ rc: null as unknown, pool: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/modules/org/context/store", () => ({ requestContext: async () => gate.rc, appPool: async () => gate.pool }));
// redirect() / notFound() throw Next's control-flow errors in a request; here they throw a plain, recognisable error (as the T-113 and T-116 route tests do).
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
import { type Amount, type FinanceSummaryData, type FinanceSummaryProps, k1Total, k5Total, type Roll, rollCheck, type Scope, scopeHref, sum } from "../../src/app/(app)/keuangan/ringkasan/model";
import { FinanceSummary } from "../../src/app/(app)/keuangan/ringkasan/view";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { ROLES, type Role } from "../../src/auth/policy";
import { LEVEL3_ROLES } from "../../src/modules/org/schema";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { FORBIDDEN, HREF, k1From, k4From, readFinanceSummary, REASON, rollFrom } from "../../src/app/(app)/keuangan/ringkasan/reader";
import { filters as financeFilters, financeIn, periodLabel as financePeriod, READ_FAILED as FINANCE_READ_FAILED, readers as financeReaders } from "../../src/app/(app)/keuangan/ringkasan/load";
import { loadFinancePage } from "../../src/app/(app)/keuangan/ringkasan/data";
import { financeBody } from "../../src/app/(app)/keuangan/ringkasan/body";
import { rollforward } from "../../src/modules/accounting/subledgers/subledgers";
import { createHarness, type Harness, testPool } from "../rls/harness";

const v = (rp: number): Amount => ({ state: "value", rp });
const na = (reason = "Pembacaan belum tersedia"): Amount => ({ state: "unavailable", reason });
const html = (p: FinanceSummaryProps) => renderToStaticMarkup(h(FinanceSummary, p));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const section = (out: string, id: string) => text(out.slice(out.indexOf(`id="${id}"`), out.indexOf("</section>", out.indexOf(`id="${id}"`))));
const roll = (ledger: Roll["ledger"], opening: Amount, movements: [string, number][], closing: Amount): Roll =>
  ({ ledger, opening, movements: movements.map(([term, rp]) => ({ term, rp })), closing, href: `/keuangan/kewajiban#${ledger}` });

// Package and balance movements in a month (Scenario PR-33f).
const pkg = roll("package_liability", v(10_000_000), [["settlement", 3_000_000], ["redemption", -2_000_000], ["close", -500_000]], v(10_500_000));
const bal = roll("patient_balance", v(1_000_000), [["top_up", 400_000], ["from_expiry", 500_000], ["use", -300_000]], v(1_600_000));

function data(over: Partial<FinanceSummaryData> = {}): FinanceSummaryData {
  return {
    k1: { methods: [{ method: "cash", amount: v(5_000_000), href: "/keuangan/mutasi?metode=cash" }, { method: "qris", amount: v(3_000_000), href: "/keuangan/mutasi?metode=qris" }],
      refundsCash: v(200_000), href: "/keuangan/mutasi" },
    gatewayPending: { amount: v(750_000), count: 3, href: "/keuangan/mutasi?status=tertunda" },
    k2: { amount: v(6_500_000), href: "/laporan?kpi=k2" },
    k3: { amount: v(9_000_000), href: "/laporan?kpi=k3" },
    k4: { aging: { d0_30: v(1_000_000), d31_60: v(500_000), d61_90: v(0), d90: v(250_000) }, href: "/piutang" },
    k5: { packageExpiry30: v(600_000), href: "/keuangan/kewajiban" },
    k6: { amount: v(500_000), href: "/keuangan/kewajiban#patient_balance" },
    rolls: [pkg, bal, roll("paid_not_delivered", v(0), [], v(0)), roll("booking_dp", v(200_000), [["received", 100_000]], v(300_000))],
    refundsWriteOffs: { refunds: v(200_000), writeOffs: v(0), href: "/piutang/refund" },
    commission: { owed: v(2_400_000), batches: [{ state: "pending_approval", count: 1, amount: v(1_400_000) }, { state: "paid", count: 2, amount: v(3_000_000) }], href: "/komisi" },
    payables: { due7: v(4_000_000), overdue: v(0), href: "/pembelian/utang" },
    cues: { openShifts: 1, shiftVariance: 0, reconDiffs: 2, shiftHref: "/kasir/tutup", reconHref: "/keuangan/rekon" },
    ...over,
  };
}
const scope: Scope = { branches: [{ id: "b1", name: "Cabang A" }, { id: "b2", name: "Cabang B" }], branch: null, from: "2026-11-01", to: "2026-11-19",
  action: "/keuangan/ringkasan", period: "1–19 November 2026" };
const ready = (d: FinanceSummaryData = data(), s: Scope = scope): FinanceSummaryProps => ({ scope: s, ledgerHref: "/keuangan/buku-besar", state: { kind: "ready", data: d } });

describe("Scenario PR-33f roll-forward: opening plus movements equals closing", () => {
  it("package and balance roll-forwards balance and are marked so", () => {
    expect(rollCheck(pkg)).toEqual({ state: "balanced" });
    expect(rollCheck(bal)).toEqual({ state: "balanced" });
    const out = html(ready());
    expect(out).toMatch(/data-roll="package_liability" data-check="balanced"/);
    expect(out).toMatch(/data-roll="patient_balance" data-check="balanced"/);
    const p = text(out.slice(out.indexOf('data-roll="package_liability"'), out.indexOf("</section>", out.indexOf('data-roll="package_liability"'))));
    expect(p).toContain("Saldo awal Rp10.000.000");
    expect(p).toMatch(/Pembayaran masuk Rp3\.000\.000 Sesi ditebus -Rp2\.000\.000 Paket ditutup ke saldo -Rp500\.000/);
    expect(p).toContain("Saldo akhir Rp10.500.000");
    expect(p).toContain("Cocok");
  });
  it("a closing that does not equal opening + movements is flagged with the difference", () => {
    const bad = roll("patient_balance", v(1_000_000), [["top_up", 400_000]], v(1_500_000));
    expect(rollCheck(bad)).toEqual({ state: "mismatch", diff: 100_000 });
    const out = html(ready(data({ rolls: [bad] })));
    expect(out).toMatch(/data-check="mismatch"/);
    expect(text(out)).toContain("Tidak cocok +Rp100.000");
  });
  it("an unknown opening or closing is 'Belum dapat dicocokkan', never 'Cocok'", () => {
    const u = roll("package_liability", na("Riwayat sebelum cutover belum lengkap"), [["settlement", 1]], v(1));
    expect(rollCheck(u)).toEqual({ state: "unchecked", reason: "Riwayat sebelum cutover belum lengkap" });
    const out = text(html(ready(data({ rolls: [u] }))));
    expect(out).toContain("Belum dapat dicocokkan");
    expect(out).toContain("Riwayat sebelum cutover belum lengkap");
    expect(out).not.toMatch(/\bCocok\b/);
  });
});

describe("K1, K4, K5 totals and unavailable ≠ Rp0", () => {
  it("K1 = Σ methods − cash refunds; per-method rows link to Mutasi", () => {
    expect(k1Total(data().k1)).toEqual(v(7_800_000));
    const out = html(ready());
    expect(section(out, "kpi-k1")).toMatch(/Uang masuk \(K1\) Rp7\.800\.000 Tunai Rp5\.000\.000 QRIS Rp3\.000\.000 Refund tunai −Rp200\.000/);
    expect(out).toContain('href="/keuangan/mutasi?metode=qris"');
  });
  it("an unavailable method makes K1 unavailable, never a partial sum", () => {
    const k1 = { ...data().k1, methods: [...data().k1.methods, { method: "edc" as const, amount: na("EDC belum direkonsiliasi"), href: "/m" }] };
    expect(k1Total(k1)).toEqual(na("EDC belum direkonsiliasi"));
    const card = section(html(ready(data({ k1 }))), "kpi-k1");
    expect(card).toMatch(/Uang masuk \(K1\) Belum tersedia EDC belum direkonsiliasi/);
  });
  it("K5 = closing of the four prepaid ledgers only (receivables and commission excluded)", () => {
    const rolls = [...data().rolls, roll("receivables", v(9), [], v(99_999_999))];
    expect(k5Total(rolls)).toEqual(v(10_500_000 + 1_600_000 + 0 + 300_000));
    expect(k5Total([pkg])).toEqual(na("Kewajiban layanan (dibayar belum diberikan) belum tersedia"));
    expect(section(html(ready()), "kpi-k5")).toContain("Rp12.400.000");
    expect(section(html(ready()), "kpi-k5")).toContain("Paket kedaluwarsa ≤ 30 hari: Rp600.000");
  });
  it("K4 total from aging; a real 0 bucket reads Rp0; sum is unavailable when any part is", () => {
    expect(section(html(ready()), "kpi-k4")).toMatch(/Rp1\.750\.000 .*61–90 hari Rp0/);
    expect(sum([v(1), na("x"), v(2)])).toEqual(na("x"));
  });
});

describe("cues, filter, drill-down and layout", () => {
  const out = html(ready());
  it("cues list only non-zero items, gateway pending included", () => {
    const t = text(out);
    expect(t).toContain("1 shift kasir belum ditutup");
    expect(t).not.toContain("selisih kas menunggu persetujuan");
    expect(t).toContain("2 selisih rekonsiliasi");
    expect(t).toContain("Settlement gateway tertunda Rp750.000");
    const calm = html(ready(data({ cues: { openShifts: 0, shiftVariance: 0, reconDiffs: 0, shiftHref: "/k", reconHref: "/r" }, gatewayPending: { amount: v(0), count: 0, href: "/g" } })));
    expect(calm).not.toContain("Perlu ditangani");
  });
  it("branch / consolidated segments keep the period; the active one is marked", () => {
    expect(scopeHref(scope, null)).toBe("/keuangan/ringkasan?dari=2026-11-01&sampai=2026-11-19");
    expect(scopeHref(scope, "b2")).toBe("/keuangan/ringkasan?dari=2026-11-01&sampai=2026-11-19&cabang=b2");
    expect(out).toMatch(/aria-current="true"[^>]*>Semua Cabang/);
    const b = html(ready(data(), { ...scope, branch: "b1" }));
    expect(b).toMatch(/aria-current="true"[^>]*>Cabang A/);
    expect(text(b)).toContain("Cabang A · 1–19 November 2026");
  });
  it("links to Kewajiban, Buku Besar, Piutang, Komisi and Utang Pemasok", () => {
    for (const href of ["/keuangan/kewajiban", "/keuangan/buku-besar", "/piutang", "/komisi", "/pembelian/utang", "/keuangan/rekon", "/kasir/tutup",
      "/keuangan/kewajiban#package_liability", "/piutang/refund"]) {
      expect(out).toContain(`href="${href}"`);
    }
  });
  it("commission batches by state with counts; K17 owed shown", () => {
    const k = section(out, "kpi-k17");
    expect(k).toContain("Rp2.400.000");
    expect(k).toContain("Menunggu persetujuan (1) Rp1.400.000");
    expect(k).toContain("Dibayar (2) Rp3.000.000");
  });
  it("compact one column; two columns from a wide CONTAINER (48 em), never by the viewport: the shell sidebar and the text size take width from it (WCAG 1.4.10)", () => {
    expect(out.match(/@container/g)).toHaveLength(2); // the cards grid and the roll-forward grid, each in its own size container
    expect(out.match(/grid-cols-\[minmax\(0,1fr\)\] gap-3 @min-\[48em\]:grid-cols-2/g)).toHaveLength(2);
    expect(out).not.toMatch(/min-\[(700|900)px\]/);
  });
  it("no file of the page carries a viewport breakpoint (sm: md: lg: xl: 2xl: min-[..]: max-[..]:): found by the browser at 900-960 px and 200 % text, where the K1 figure 'Rp550.000' broke into 'Rp550.0' and '00'", () => {
    const dir = join(__dirname, "../../src/app/(app)/keuangan/ringkasan");
    const files = readdirSync(dir).filter((f) => /\.(tsx|ts|css)$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(8);
    const VIEWPORT = /(^|[\s"'`])((sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl):|min-\[[0-9.]+(px|rem|em)\]:|max-\[[0-9.]+(px|rem|em)\]:)/;
    for (const f of files) expect(readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("//") && VIEWPORT.test(l)), f).toEqual([]);
    // the guard bites: the line P1 shipped would have matched it
    expect(VIEWPORT.test('className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2"')).toBe(true);
    expect(VIEWPORT.test('className="grid min-w-0 gap-3 @min-[48em]:grid-cols-2"')).toBe(false);
  });
});

describe("one state per screen (10 State Copy Patterns)", () => {
  const cases = [
    [{ kind: "loading" }, 'aria-busy="true"'],
    [{ kind: "empty", message: "Belum ada transaksi pada periode ini." }, "Belum ada transaksi pada periode ini."],
    [{ kind: "filtered-empty", message: "Tidak ada transaksi untuk filter ini.", clearHref: "/keuangan/ringkasan" }, "Hapus Filter"],
    [{ kind: "error", message: "Koneksi terputus.", retryHref: "/keuangan/ringkasan" }, "Coba Lagi"],
    [{ kind: "blocked", reason: "Periode terkunci", unblock: "Finance dapat membuka kunci periode" }, "Periode terkunci."],
    [{ kind: "permission", object: "ringkasan keuangan" }, "Anda tidak memiliki akses ke ringkasan keuangan."],
  ] as const;
  it.each(cases)("%o renders its copy and no figure", (state, copy) => {
    const out = html({ scope, ledgerHref: "/keuangan/buku-besar", state });
    expect(out).toContain(copy);
    expect(out).not.toContain("data-kpi=");
    expect(out).not.toContain("data-roll=");
  });
  it("permission state shows no branch filter", () => {
    expect(html({ scope, ledgerHref: "/b", state: { kind: "permission", object: "x" } })).not.toContain("Semua Cabang");
  });
});

describe("no clinical content and safe text", () => {
  it("escapes branch names and renders no clinical vocabulary", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const out = html(ready(data(), { ...scope, branches: [{ id: "h", name: hostile }], branch: "h" }));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(text(out)).not.toMatch(/diagnos|alergi|resep|anamnesis|rekam medis|klinis/i);
  });
  it("method rows carry no patient field (type-level guard)", () => {
    // @ts-expect-error — no patient on a method row
    const bad: FinanceSummaryData["k1"]["methods"][number] = { method: "cash", amount: v(1), href: "/m", patient: "x" };
    expect(bad).toBeTruthy();
  });
});

// ── slice 2 (P1, on main f0bd3c44): the finance summary from the existing readers (subledger_rollforward, dashboard_kpi, commission
// batches, payables, cash shifts) with the authority they already have; synthetic facts. ──
describe("hidden links to unbuilt destinations (Panel 2)", () => {
  it("no href renders no link: K1 methods, K2/K3 cards and the gateway cue have no Mutasi / Laporan / Rekon link", () => {
    const d = data({ k1: { methods: [{ method: "cash", amount: v(1) }], refundsCash: v(0) }, k2: { amount: v(1) }, k3: { amount: v(1) },
      gatewayPending: { amount: v(9), count: null }, cues: { openShifts: null, shiftVariance: null, reconDiffs: 3, shiftHref: "/kasir/tutup" } });
    const out = html(ready(d));
    for (const x of ["/keuangan/mutasi", "/keuangan/rekon", "/laporan"]) expect(out).not.toContain(`href="${x}`);
    expect(text(out)).toContain("Kliring gateway belum diselesaikan: Rp9");   // shown in the K1 card, not as a cue without a page
    expect(text(out)).not.toContain("selisih rekonsiliasi");
    expect(text(out)).not.toContain("shift kasir belum ditutup");               // unreadable (null) is hidden, not "0"
  });
  it("K4 from the reader: complete → buckets (a real 0 stays Rp0); incomplete → every bucket unavailable with the count; refused → forbidden", () => {
    expect(k4From({ by_dim: { "0-30": 222_000, ">90": "400000" }, extra: { undated_cancellations: 0, complete: true } }))
      .toEqual({ d0_30: v(222_000), d31_60: v(0), d61_90: v(0), d90: v(400_000) });
    const inc = k4From({ by_dim: {}, extra: { undated_cancellations: 2, complete: false } });
    expect(inc.d0_30).toEqual(na(REASON.k4Incomplete(2)));
    expect(section(html(ready(data({ k4: { aging: inc, href: "/piutang" } }))), "kpi-k4")).toContain("Belum tersedia");
    expect(section(html(ready(data({ k4: { aging: inc, href: "/piutang" } }))), "kpi-k4")).not.toMatch(/Rp0/);
    expect(k4From("forbidden").d90).toEqual(na(FORBIDDEN));
  });
  it("K1 from the reader keeps the sign: cash refunds and refunded DPs (negative in the reader) are subtracted once; Σ − refunds = the reader total", () => {
    const k1 = k1From({ by_dim: { cash: 3_900_000, qris: 600_000, cash_refund: -400_000, dp_refund: -100_000, balance: 999 } });
    expect(k1).toEqual({ methods: [{ method: "cash", amount: v(3_900_000) }, { method: "qris", amount: v(600_000) }], refundsCash: v(500_000) });
    expect(k1Total(k1)).toEqual(v(4_000_000));
    expect(k1From("forbidden").refundsCash).toEqual(na(FORBIDDEN));
  });
  it("a roll-forward side the reader does not vouch complete is unavailable, so the card says 'Belum dapat dicocokkan'", () => {
    const rf = { ledgers: { package_liability: { opening: 0, closing: 700_000, opening_complete: false, closing_complete: true, known_before_cutover: 300_000,
      terms: { settlement: 700_000 }, by_dim: {}, by_branch: {} } } } as unknown as Parameters<typeof rollFrom>[1];
    const r = rollFrom("package_liability", rf);
    expect(r.opening).toEqual(na(REASON.openingIncomplete));
    expect(rollCheck(r)).toEqual({ state: "unchecked", reason: REASON.openingIncomplete });
  });
  it("commission batches for a branch are unavailable with the reason, never 'Belum ada batch'", () => {
    const k = section(html(ready(data({ commission: { owed: na(REASON.k17Branch), batches: [], batchesUnavailable: REASON.batchesBranch, href: "/komisi" } }))), "kpi-k17");
    expect(k).toContain(REASON.k17Branch);
    expect(k).toContain(`Batch komisi: Belum tersedia — ${REASON.batchesBranch}`);
    expect(k).not.toContain("Belum ada batch komisi");
  });
});

describe("Ringkasan Keuangan page filters and roles (load.ts)", () => {
  const now = new Date("2026-11-21T03:00:00Z"); // 10:00 WIB
  it("this month by default; a valid range; anything else falls back; a malformed ?cabang is ignored; roles = the nav row (F O)", () => {
    expect(financeFilters({}, now)).toEqual({ from: "2026-11-01", to: "2026-11-21", branch: null });
    expect(financeFilters({ dari: "2026-10-01", sampai: "2026-10-31", cabang: "0190a3f2-0000-7000-8000-000000000001" }, now))
      .toEqual({ from: "2026-10-01", to: "2026-10-31", branch: "0190a3f2-0000-7000-8000-000000000001" });
    for (const q of [{ dari: "2026-10-31", sampai: "2026-10-01" }, { dari: "2025-01-01", sampai: "2026-10-01" }, { dari: "2026-02-30", sampai: "2026-03-01" }, { dari: "2026-10-01" }]) {
      expect(financeFilters(q, now), JSON.stringify(q)).toMatchObject({ from: "2026-11-01", to: "2026-11-21" });
    }
    expect(financeFilters({ cabang: "x' or 1=1" }, now).branch).toBeNull();
    expect(financeFilters({}, new Date("2026-11-30T17:30:00Z"))).toMatchObject({ from: "2026-12-01", to: "2026-12-01" }); // 00:30 WIB
    expect(financePeriod({ from: "2026-10-01", to: "2026-10-31" })).toBe("1 Oktober 2026 – 31 Oktober 2026");
    expect([...financeReaders()]).toEqual(["finance", "owner"]);
  });
});

// ── T-114 slice 5 (P2): the route mount. page.tsx / body.tsx / error.tsx over P1's loader, gate and view; the DEL-2 case is P1's approved file. ──
describe("T-114 route mount: page, error boundary and page body (no database)", () => {
  const ctxOf = (role: Role) => ({ kind: "ok", active: { context: { actingRole: role } } });
  it("the route exports only a default page and metadata (a Next page file may export nothing else); the title names the page", async () => {
    const m = await import("../../src/app/(app)/keuangan/ringkasan/page");
    expect(Object.keys(m).sort()).toEqual(["default", "metadata"]);
    expect((m.metadata as { title: string }).title).toBe("Ringkasan Keuangan — Clinic Dashboard");
  });
  it("loading: while the body streams the page shows the title with a busy skeleton (Suspense fallback), never a figure", async () => {
    const m = await import("../../src/app/(app)/keuangan/ringkasan/page");
    const main = m.default({ searchParams: Promise.resolve({}) }) as { props: { children: { props: { fallback: unknown } } } };
    const out = renderToStaticMarkup(main.props.children.props.fallback as never);
    expect(out).toContain('aria-busy="true"');
    expect(text(out)).toContain("Ringkasan Keuangan");
    expect(out).not.toMatch(/data-kpi|data-roll|Rp\d/);
  });
  it("error boundary: the title, 'Coba Lagi' wired to retry, and never the error's own text", async () => {
    const e = await import("../../src/app/(app)/keuangan/ringkasan/error");
    const retry = vi.fn();
    const el = e.default({ error: new Error("rahasia: koneksi basis data putus"), retry }) as { props: { children: { props: { onRetry: unknown } }[] } };
    const out = renderToStaticMarkup(el as never);
    expect(text(out)).toContain("Ringkasan Keuangan");
    expect(out).toContain("Ringkasan keuangan belum bisa dimuat. Tidak ada yang berubah.");
    expect(out).toContain('role="alert"');
    expect(out).toContain("Coba Lagi");
    expect(out).not.toContain("rahasia");
    expect(el.props.children[1].props.onRetry).toBe(retry);
  });
  it("financeBody gate: every role outside the nav row (finance and owner) gets the permission state BEFORE any read; there is no pool to read from", async () => {
    gate.pool = null;
    for (const role of ROLES.filter((r) => r !== "finance" && r !== "owner")) {
      gate.rc = ctxOf(role);
      const out = renderToStaticMarkup((await financeBody(Promise.resolve({}))) as never);
      expect(text(out), role).toContain("Anda tidak memiliki akses ke ringkasan keuangan.");
      expect(out, role).not.toMatch(/data-kpi|data-roll|Rp\d|Semua Cabang|href="\/(keuangan|piutang|komisi|pembelian)/);
    }
    // control: the two page roles are NOT refused; with no pool they fail at the read, which shows the refusal above is the gate and not a general failure
    for (const role of ["finance", "owner"] as const) {
      gate.rc = ctxOf(role);
      await expect(financeBody(Promise.resolve({})), role).rejects.toThrow();
    }
  });
  it("financeBody: a signed-out request is redirected; a blocked account gets the permission state", async () => {
    gate.pool = null;
    gate.rc = { kind: "redirect", to: "/masuk" };
    await expect(financeBody(Promise.resolve({}))).rejects.toThrow("NEXT_REDIRECT /masuk");
    gate.rc = { kind: "blocked", accountId: "x" };
    expect(text(renderToStaticMarkup((await financeBody(Promise.resolve({}))) as never))).toContain("Anda tidak memiliki akses ke ringkasan keuangan.");
  });
});

// ── T-114 slice 5 (P2): a defect the browser run found in P1's view; the test is built on the reader's own value, not on a hand-made zero. ──
describe("T-114 mount defect in the K1 card: a zero refund (found by the browser run)", () => {
  it("a K1 with no refund prints 'Refund tunai Rp0': the reader's own value is a signed zero, and it must never print '−-Rp0' or '−Rp0'", () => {
    const k1 = k1From({ by_dim: { cash: 500_000 } }); // no cash_refund and no dp_refund dim: the reader computes -(0 + 0)
    const rp0 = k1.refundsCash.state === "value" ? k1.refundsCash.rp : Number.NaN;
    expect(Object.is(rp0, -0)).toBe(true); // the hazard is present in the data the page really gets (Intl prints -0 as "-Rp0")
    const card = section(html(ready(data({ k1 }))), "kpi-k1");
    expect(card).toContain("Refund tunai Rp0");
    expect(card).not.toMatch(/Refund tunai [−-]/);
    expect(k1Total(k1)).toEqual(v(500_000)); // the total is unaffected
  });
  it("a positive zero reads the same, and a real refund keeps its minus sign", () => {
    expect(section(html(ready(data({ k1: { methods: [{ method: "cash", amount: v(1) }], refundsCash: v(0) } }))), "kpi-k1")).toContain("Refund tunai Rp0");
    const real = k1From({ by_dim: { cash: 3_900_000, cash_refund: -400_000, dp_refund: -100_000 } });
    expect(section(html(ready(data({ k1: real }))), "kpi-k1")).toContain("Refund tunai −Rp500.000");
  });
  it("a refund the reader refused for the role is 'Belum tersedia', never Rp0", () => {
    expect(section(html(ready(data({ k1: k1From("forbidden") }))), "kpi-k1")).toMatch(/Refund tunai Belum tersedia/);
  });
});

describe("readFinanceSummary on the real readers (PostgreSQL, synthetic)", () => {
  let h: Harness; let app: pg.Pool; let owner: pg.Pool; let nn = 0;
  type T = { tenantId: string; b1: string; b2: string };
  type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
  const WIDE: string[] = ROLES.filter((r) => !(LEVEL3_ROLES as readonly string[]).includes(r));
  const tenant = async (name: string): Promise<T> => {
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
    const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
    return { tenantId, b1: await br("KU-A"), b2: await br("KU-B") };
  };
  const person = async (t: T, role: Role, ...branches: string[]): Promise<P> => {
    const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ku${++nn}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Keuangan ${nn}` });
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
    return { acc, staffId, tenantId: t.tenantId, role, branch: WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
  };
  const as = async <X>(p: P, fn: (db: pg.PoolClient) => Promise<X>) =>
    withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
  const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : String(e)));
  const at = (local: string) => `${local}+07`;
  const P10 = { from: "2026-10-01", to: "2026-10-31" };
  let A: T; let OWN: P; let FIN: P; let AU: P; let MGR: P; let FO: P; let BFIN: P; let NUR: P; let NURB: P;
  let line400 = "";

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local";
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
    A = await tenant("PT Keuangan Sintetis"); const B = await tenant("PT Keuangan Lain");
    OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor"); MGR = await person(A, "manager", A.b1);
    FO = await person(A, "fo_cashier", A.b1); NUR = await person(A, "nurse", A.b1); NURB = await person(A, "nurse", A.b2); BFIN = await person(B, "finance");
    const c = await owner.connect();
    try {
      await c.query("begin"); await c.query("set local session_replication_role = replica");
      // the tables' guards are ENABLE ALWAYS (they run under replica too): paused by name for the seed, re-enabled before commit
      const TABLES = ["invoices", "invoice_lines", "receipts", "payments", "visits", "receivables", "receivable_collections", "write_offs", "commission_contributions", "commission_entitlements",
        "approvals", "payout_batches", "payout_batch_lines", "catalog_versions", "suppliers", "supplier_invoices"];
      const always = (await c.query(`select tgrelid::regclass::text t, tgname from pg_trigger where tgrelid = any($1::regclass[]) and not tgisinternal and tgenabled = 'A'`, [TABLES])).rows as { t: string; tgname: string }[];
      for (const x of always) await c.query(`alter table ${x.t} disable trigger ${x.tgname}`);
      const q = (sql: string, args: unknown[]) => c.query(sql, args);
      const pid = (await q(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
        values ($1, 'RM-1000000000001', 'Pasien Sentinel Keuangan', '1990-01-01', 'female', 'nik', 'v1.1.a.b.c', $3, 'islam', 'Karyawan', 's1', 'kawin', $2, $4, 'fo_cashier') returning id`,
        [A.tenantId, A.b1, "x".repeat(43), FO.staffId])).rows[0].id as string;
      const svc = (await q(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', 'KU-SVC', $2) returning id`, [A.tenantId, OWN.staffId])).rows[0].id as string;
      const svcV = (await q(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
        values ($1, $2, 1, 'active', 'Layanan Keuangan', 'exempt_medical', 'Jasa medis', 500000, 'Baru', $3, 'owner') returning id`, [A.tenantId, svc, OWN.staffId])).rows[0].id as string;
      // money in (K1): cash 500,000 at A and QRIS 300,000 at B on 2026-10-05; a balance-paid 100,000 (not money in)
      const pay = async (branch: string, method: string, amount: number, day: string) => {
        const inv = (await q(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
          values ($1, $2, $2, $3, $4, 'issued', false, $5, $6, 'fo_cashier', $7, $6, 'fo_cashier') returning id`,
          [A.tenantId, branch, pid, `KU-${crypto.randomUUID().slice(0, 6)}`, at(day), FO.staffId, `ku-${crypto.randomUUID()}`])).rows[0].id;
        const rec = crypto.randomUUID(); // the receipt row is not read by these readers (replica: no FK check)
        await q(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, cash_tendered, change_given, environment, received_by, received_as, received_at)
          values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, 'local', $10, 'fo_cashier', $11)`,
          [A.tenantId, branch, rec, inv, pid, method, amount, method === "cash" ? amount : null, method === "cash" ? 0 : null, FO.staffId, at(day)]);
        return inv as string;
      };
      await pay(A.b1, "cash", 500_000, "2026-10-05 10:00");
      await pay(A.b2, "qris", 300_000, "2026-10-05 11:00");
      await pay(A.b1, "balance", 100_000, "2026-10-06 10:00");
      // K4 / receivables: a closed-visit line of 400,000 unpaid at A (complete), a receivable 250,000 written off 50,000 (signed −)
      const v = (await q(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, closed_at, closed_by)
        values ($1, $2, $3, 'walk_in', $4, $5, $6, $4) returning id`, [A.tenantId, A.b1, pid, FO.staffId, at("2026-10-10 09:00"), at("2026-10-10 12:00")])).rows[0].id;
      const inv = (await q(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, $4, 'KU-K4', 'issued', false, $5, $6, 'fo_cashier', $7, $6, 'fo_cashier') returning id`, [A.tenantId, A.b1, pid, v, at("2026-10-10 09:30"), FO.staffId, `ku-${crypto.randomUUID()}`])).rows[0].id;
      line400 = (await q(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        values ($1, $2, $3, $4, $5, 1, 400000, 400000, 'exempt_medical', 'Jasa medis', 400000, 0) returning id`, [A.tenantId, A.b1, inv, svc, svcV])).rows[0].id;
      // a receivable of 250,000: 200,000 collected (cash at A on 2026-10-15), the rest 50,000 written off (closes it)
      const rv = (await q(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, collected_amount, written_off_amount, state, command_key, created_by, created_as, created_at)
        values ($1, $2, $3, $4, 250000, 200000, 50000, 'written_off', $5, $6, 'manager', $7) returning id`, [A.tenantId, A.b1, pid, v, `rv-${crypto.randomUUID()}`, MGR.staffId, at("2026-10-12 10:00")])).rows[0].id;
      await q(`insert into receivable_collections (tenant_id, branch_id, receivable_id, receipt_id, method, amount, command_key, received_by, received_as, received_at)
        values ($1, $2, $3, gen_random_uuid(), 'transfer', 200000, $4, $5, 'fo_cashier', $6)`, [A.tenantId, A.b1, rv, `rc-${crypto.randomUUID()}`, FO.staffId, at("2026-10-15 10:00")]);
      await q(`insert into write_offs (tenant_id, branch_id, receivable_id, amount, reason, approval_id, owner_self, requested_by, approved_by, command_key, created_at)
        values ($1, $2, $3, 50000, 'Tidak tertagih', gen_random_uuid(), true, $4, $4, $5, $6)`, [A.tenantId, A.b1, rv, OWN.staffId, `wo-${crypto.randomUUID()}`, at("2026-10-20 10:00")]);
      // commission: accrued 200,000 at A (nurse) and 100,000 at B (nurse B); a batch PAID 2026-10-25 nets 120,000 for nurse A (branch NULL)
      const rule = (await q(`insert into commission_rules (tenant_id, contribution_type, name, created_by, created_as, command_key) values ($1, 'performer', 'Aturan KU', $2, 'owner', $3) returning id`,
        [A.tenantId, OWN.staffId, `cr-${crypto.randomUUID()}`])).rows[0].id;
      const rvv = (await q(`insert into commission_rule_versions (tenant_id, rule_id, version, kind, fixed_amount, effective_from, prepared_by, prepared_as, command_key)
        values ($1, $2, 1, 'fixed', 1, '2026-01-01', $3, 'owner', $4) returning id`, [A.tenantId, rule, OWN.staffId, `crv-${crypto.randomUUID()}`])).rows[0].id;
      const ent = async (branch: string, staff: string, amount: number) => {
        const cc = (await q(`insert into commission_contributions (tenant_id, branch_id, staff_id, contribution_type, source_kind, source_id, invoice_line_id, rule_version_id, sale_at)
          values ($1, $2, $3, 'performer', 'treatment_execution', gen_random_uuid(), $4, $5, $6) returning id`, [A.tenantId, branch, staff, line400, rvv, at("2026-10-15 10:00")])).rows[0].id;
        await q(`insert into commission_entitlements (tenant_id, branch_id, contribution_id, staff_id, amount, basis, fact_kind, fact_id, accrued_at)
          values ($1, $2, $3, $4, $5, $5, 'execution', gen_random_uuid(), $6)`, [A.tenantId, branch, cc, staff, amount, at("2026-10-15 10:00")]);
      };
      await ent(A.b1, NUR.staffId, 200_000);
      await ent(A.b2, NURB.staffId, 100_000);
      const ap = (await q(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, amount_rupiah, state, requested_by, requested_as, decided_by, decided_as, decided_at)
        values ($1, 'commission_batch', 'payout_batch', gen_random_uuid(), 'Uji', 1, 'approved', $2, 'finance', $3, 'owner', $4) returning id`, [A.tenantId, FIN.staffId, OWN.staffId, at("2026-10-25 10:00")])).rows[0].id;
      const pb = (await q(`insert into payout_batches (tenant_id, period_key, period_start, period_end, closing_day, state, approval_id, submitted_by, submitted_at, paid_by, paid_at, paid_method, created_by, command_key)
        values ($1, '2026-10', $2, $3, 'month_end', 'paid', $4, $5, $6, $5, $6, 'transfer', $5, $7) returning id`,
        [A.tenantId, at("2026-10-01 00:00"), at("2026-10-28 00:00"), ap, FIN.staffId, at("2026-10-25 10:00"), `pb-${crypto.randomUUID()}`])).rows[0].id;
      await q(`insert into payout_batch_lines (tenant_id, batch_id, staff_id, gross, adjustments, carry_forward_in, net_payable, carry_forward_out) values ($1, $2, $3, 120000, 0, 0, 120000, 0)`,
        [A.tenantId, pb, NUR.staffId]);
      // supplier payables: open invoices at A (due in 3 days 700,000) and B (overdue 300,000); a paid one ignored
      const sup = (await q(`insert into suppliers (tenant_id, name, created_by, updated_by) values ($1, 'PT Pemasok Sintetis', $2, $2) returning id`, [A.tenantId, OWN.staffId])).rows[0].id;
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      const day = (k: number) => new Date(Date.parse(`${today}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
      const si = (branch: string, num: string, due: string, total: number, paid: number) => q(
        `insert into supplier_invoices (tenant_id, branch_id, supplier_id, kind, number, invoice_date, due_date, total, paid_amount, state, command_key, recorded_by, recorded_as)
         values ($1, $2, $3, 'purchase', $4, $5, $6, $7, $8, $9, $10, $11, 'finance')`,
        [A.tenantId, branch, sup, num, day(-20), due, total, paid, paid === total ? "paid" : "open", `si-${crypto.randomUUID()}`, FIN.staffId]);
      await si(A.b1, "INV-A1", day(3), 700_000, 0);
      await si(A.b2, "INV-B1", day(-2), 300_000, 0);
      await si(A.b1, "INV-A2", day(1), 500_000, 500_000);
      for (const x of always) await c.query(`alter table ${x.t} enable always trigger ${x.tgname}`);
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  }, 300_000);
  afterAll(async () => { await app?.end(); await owner?.end(); await h?.close(); });

  it("finance, consolidated: K1 per method (balance usage excluded), K4 complete, signed write-off, K17 owed = 300,000 − 120,000 paid, batches", async () => {
    const d = await as(FIN, (db) => readFinanceSummary(db, P10));
    expect(d.k1.methods).toEqual([{ method: "cash", amount: v(500_000) }, { method: "qris", amount: v(300_000) }]);
    expect(k1Total(d.k1)).toEqual(v(800_000));
    expect(d.k4.aging).toEqual({ d0_30: v(400_000), d31_60: v(0), d61_90: v(0), d90: v(0) });
    expect(d.refundsWriteOffs.writeOffs).toEqual(v(-50_000)); // signed: the receivable is reduced
    expect(d.commission.owed).toEqual(v(180_000));
    expect(d.commission.batches).toEqual([{ state: "paid", count: 1, amount: v(120_000) }]);
    const rec = d.rolls.find((r) => r.ledger === "receivables")!;
    expect(rollCheck(rec)).toEqual({ state: "balanced" });
    expect(rec.movements).toEqual(expect.arrayContaining([{ term: "created", rp: 250_000 }, { term: "collected", rp: -200_000 }, { term: "written_off", rp: -50_000 }]));
    const out = html({ scope: { ...scope, from: P10.from, to: P10.to }, ledgerHref: HREF.ledger, state: { kind: "ready", data: d } });
    expect(section(out, "kpi-refund")).toContain("−Rp50.000".replace("−", "-"));
    for (const x of ["/keuangan/mutasi", "/keuangan/rekon", "/laporan"]) expect(out).not.toContain(`href="${x}`);
    expect(out).not.toContain("Pasien Sentinel Keuangan");
  });

  // slice 3 (Sol 2026-11-20): main has no gateway settlement fact (G-SETTLE: ledger_rule_gateway_settlement is never invoked; a
  // payment_charges.settled_at is the charge being paid, not a bank settlement), so the gateway_clearing closing only accumulates every
  // gateway receipt — it is not "settlement pending". The cue must be unavailable with the reason, never that closing and never Rp0.
  it("gateway settlement pending: a non-zero gateway clearing (QRIS 300,000) with no settlement fact is unavailable, not the clearing closing; the clearing figure itself is untouched in the roll-forward", async () => {
    const d = await as(FIN, (db) => readFinanceSummary(db, P10));
    const rf = await as(FIN, (db) => rollforward(db, { from: P10.from, to: P10.to }));
    expect(rf.ledgers.gateway_clearing.closing).toBe(300_000); // the hazard is present: a non-zero clearing balance
    expect(rf.ledgers.gateway_clearing.closing_complete).toBe(true);
    expect(d.gatewayPending).toEqual({ amount: { state: "unavailable", reason: REASON.settlementUnrecorded }, count: null });
    const k1 = section(html({ scope: { ...scope, from: P10.from, to: P10.to }, ledgerHref: HREF.ledger, state: { kind: "ready", data: d } }), "kpi-k1");
    expect(k1).toContain("Settlement gateway tertunda: Belum tersedia — Settlement dari penyedia pembayaran belum dicatat");
    expect(k1).not.toMatch(/(Settlement|Kliring) gateway[^.]*Rp/);   // neither the closing (Rp300.000) nor Rp0
    // branch scope: same rule (B holds the QRIS)
    const b = await as(FIN, (db) => readFinanceSummary(db, { ...P10, branchId: A.b2 }));
    expect(b.gatewayPending.amount).toEqual({ state: "unavailable", reason: REASON.settlementUnrecorded });
  });

  it("supplier payables: consolidated = the exact sum of the branches' own figures (A due ≤ 7 days 700,000; B overdue 300,000); branch A alone", async () => {
    expect((await as(FIN, (db) => readFinanceSummary(db, P10))).payables).toEqual({ due7: v(700_000), overdue: v(300_000), href: HREF.utang });
    expect((await as(FIN, (db) => readFinanceSummary(db, { ...P10, branchId: A.b1 }))).payables).toEqual({ due7: v(700_000), overdue: v(0), href: HREF.utang });
  });

  it("branch A: K1 at A only; K17 owed and batches unavailable with the reason — the paid net has no branch, no allocation is guessed", async () => {
    const d = await as(FIN, (db) => readFinanceSummary(db, { ...P10, branchId: A.b1 }));
    expect(d.k1.methods).toEqual([{ method: "cash", amount: v(500_000) }]);
    expect(d.commission.owed).toEqual(na(REASON.k17Branch));
    expect(d.commission.batchesUnavailable).toBe(REASON.batchesBranch);
    expect(d.commission.batches).toEqual([]); // the tenant-wide batch list is never shown under a branch
    // the dangerous alternative this avoids: dashboard_kpi k17 for A alone = 200,000 accrued with the 120,000 payment left out
    const raw = await as(FIN, (db) => db.query(`select dashboard_kpi('k17', '2026-10-01', '2026-10-31', $1, false) r`, [A.b1]));
    expect(Number(raw.rows[0].r.total)).toBe(200_000);
  });

  it("K4 incomplete: an undated cancellation makes every bucket unavailable with the count (never a partial aging)", async () => {
    const tg = (await owner.query(`select tgname from pg_trigger where tgrelid = 'invoice_lines'::regclass and not tgisinternal and tgenabled <> 'D'`)).rows.map((r) => r.tgname as string);
    const pause = async (f: () => Promise<unknown>) => {
      for (const t of tg) await owner.query(`alter table invoice_lines disable trigger ${t}`);
      try { await f(); } finally { for (const t of tg) await owner.query(`alter table invoice_lines enable always trigger ${t}`); }
    };
    await pause(() => owner.query(`update invoice_lines set cancelled_amount = 100000 where id = $1`, [line400]));
    try {
      const d = await as(FIN, (db) => readFinanceSummary(db, P10));
      expect(d.k4.aging.d0_30).toEqual(na(REASON.k4Incomplete(1)));
      expect(section(html({ scope, ledgerHref: HREF.ledger, state: { kind: "ready", data: d } }), "kpi-k4")).not.toMatch(/Rp/);
    } finally {
      await pause(() => owner.query(`update invoice_lines set cancelled_amount = 0 where id = $1`, [line400]));
    }
  });

  it("authorized scope: owner and auditor read; a branch of another tenant is refused; a manager / FO is refused by every reader they may not use (unavailable, never Rp0)", async () => {
    expect((await as(OWN, (db) => readFinanceSummary(db, P10))).commission.owed).toEqual(v(180_000));
    expect((await as(AU, (db) => readFinanceSummary(db, P10))).k4.aging.d0_30).toEqual(v(400_000));
    const B2 = await tenant("PT Keuangan Ketiga");
    expect(await code(as(FIN, (db) => readFinanceSummary(db, { ...P10, branchId: B2.b1 })))).toBe("ERR_NOT_FOUND");
    const fo = await as(FO, (db) => readFinanceSummary(db, P10));
    expect([fo.k4.aging.d0_30, fo.commission.owed, fo.k2.amount, fo.rolls]).toEqual([na(FORBIDDEN), na(FORBIDDEN), na(FORBIDDEN), []]);
    expect(fo.payables.due7).toEqual(na(FORBIDDEN));
    expect(fo.gatewayPending.amount).toEqual(na(FORBIDDEN)); // slice 3: a refused roll-forward stays "not for this role", not the settlement reason
    const mgr = await as(MGR, (db) => readFinanceSummary(db, P10));
    expect(mgr.rolls).toEqual([]);                 // subledger_rollforward: owner / finance / auditor only
    // dashboard_kpi binds the manager to its branch even without a branch filter: K17 there would be 200,000 accrued with the payment
    // left out, so it is unavailable with the reason (decided on the reader's own scope, not the request)
    expect(mgr.commission.owed).toEqual(na(REASON.k17Branch));
    expect(mgr.k1.methods).toEqual([{ method: "cash", amount: v(500_000) }]); // its own branch's money in
    expect(mgr.payables).toEqual({ due7: v(700_000), overdue: v(0), href: HREF.utang }); // payable_overview binds the manager to its branch
  });

  it("page core: finance gets the ready summary (scope, branches, period); settlement stays unavailable; a foreign branch is not found", async () => {
    const r = await as(FIN, (db) => financeIn(db, { dari: "2026-10-01", sampai: "2026-10-31" }, new Date()));
    if (r.kind !== "ok" || r.props.state.kind !== "ready") throw new Error("unexpected");
    expect(r.props.scope).toMatchObject({ branch: null, from: "2026-10-01", to: "2026-10-31", action: "/keuangan/ringkasan", period: "1 Oktober 2026 – 31 Oktober 2026" });
    expect(r.props.scope.branches.map((b) => b.name)).toEqual(["KU-A", "KU-B"]);
    expect(r.props.ledgerHref).toBe("/keuangan/buku-besar");
    expect(r.props.state.data.gatewayPending.amount).toEqual({ state: "unavailable", reason: REASON.settlementUnrecorded });
    expect(await as(FIN, (db) => financeIn(db, { cabang: A.b1 }, new Date()))).toMatchObject({ kind: "ok", props: { scope: { branch: A.b1 } } });
    const C = await tenant("PT Keuangan Lain C");
    expect(await as(FIN, (db) => financeIn(db, { cabang: C.b1 }, new Date()))).toEqual({ kind: "not-found" });
  });
  it("page core: a reader fault is the error state with a period-keeping retry (never an empty summary); DB faults roll back; transaction usable", async () => {
    await as(FIN, async (db) => {
      const err = console.error; const logged: unknown[] = []; console.error = (...a: unknown[]) => { logged.push(a); };
      try {
        const broken = { query: (sql: string, args?: unknown[]) => db.query(/order by created_at, id$/.test(sql) ? "select 1 / 0 as r" : sql, /order by created_at, id$/.test(sql) ? [] : args) } as unknown as typeof db;
        expect(await financeIn(broken, { dari: "2026-10-01", sampai: "2026-10-31", cabang: A.b1 }, new Date()))
          .toMatchObject({ kind: "ok", props: { state: { kind: "error", message: FINANCE_READ_FAILED, retryHref: `/keuangan/ringkasan?dari=2026-10-01&sampai=2026-10-31&cabang=${A.b1}` } } });
        const roll = { query: (sql: string, args?: unknown[]) => db.query(/subledger_rollforward/.test(sql) ? "select 1 / 0 as r" : sql, /subledger_rollforward/.test(sql) ? [] : args) } as unknown as typeof db;
        expect(await financeIn(roll, { dari: "2026-10-01", sampai: "2026-10-31" }, new Date())).toMatchObject({ kind: "ok", props: { state: { kind: "error" } } });
      } finally { console.error = err; }
      expect(JSON.stringify(logged)).not.toMatch(/division|KU-A|Rp|[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect((await db.query(`select 1 as ok`)).rows[0].ok).toBe(1);
    });
  });
  it("page gate (data.ts): finance and owner pass (the nav row); auditor / manager / FO are refused before any read; redirect and blocked kept", async () => {
    const ctx = async (p: P) => resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch });
    gate.pool = app;
    for (const p of [FIN, OWN]) {
      gate.rc = { kind: "ok", active: { context: await ctx(p) } };
      expect(await loadFinancePage({}), p.role).toMatchObject({ kind: "ok" });
    }
    for (const p of [AU, MGR, FO]) {
      gate.rc = { kind: "ok", active: { context: await ctx(p) } };
      expect(await loadFinancePage({}), p.role).toEqual({ kind: "forbidden" });
    }
    gate.rc = { kind: "redirect", to: "/masuk" };
    expect(await loadFinancePage({})).toEqual({ kind: "redirect", to: "/masuk" });
    gate.rc = { kind: "blocked", accountId: "x" };
    expect(await loadFinancePage({})).toEqual({ kind: "forbidden" });
  });
  it("page body (financeBody) on the real readers: finance gets the summary with the segments; ?dari / ?sampai and ?cabang= narrow it; settlement stays 'Belum tersedia'; a branch of another tenant is Next's not-found", async () => {
    const ctx = async (p: P) => ({ kind: "ok", active: { context: await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }) } });
    const body = async (q: Record<string, string | string[] | undefined>) => renderToStaticMarkup((await financeBody(Promise.resolve(q))) as never);
    gate.pool = app;
    gate.rc = await ctx(FIN);
    const all = await body({ dari: P10.from, sampai: P10.to });
    expect(text(all)).toContain("Ringkasan Keuangan");
    expect(text(all)).toContain("Semua Cabang · 1 Oktober 2026 – 31 Oktober 2026");
    expect([...all.matchAll(/aria-label="Tampilan tersimpan"/g)]).toHaveLength(1);
    expect(all).toMatch(/aria-current="true"[^>]*>Semua Cabang</);
    for (const c of ["KU-A", "KU-B"]) expect(all).toContain(`>${c}<`);
    const k1 = section(all, "kpi-k1");
    for (const x of ["Rp800.000", "Tunai Rp500.000", "QRIS Rp300.000"]) expect(k1).toContain(x);
    expect(k1).toContain("Settlement gateway tertunda: Belum tersedia — Settlement dari penyedia pembayaran belum dicatat");
    expect(k1).not.toMatch(/(Settlement|Kliring) gateway[^.]*Rp/); // neither the clearing closing (QRIS Rp300.000) nor Rp0
    const a1 = await body({ dari: P10.from, sampai: P10.to, cabang: A.b1 });
    expect(text(a1)).toContain("KU-A · 1 Oktober 2026 – 31 Oktober 2026");
    const seg = `/keuangan/ringkasan\\?dari=2026-10-01&amp;sampai=2026-10-31&amp;cabang=${A.b1}`;
    expect(a1).toMatch(new RegExp(`href="${seg}"[^>]*aria-current="true"|aria-current="true"[^>]*href="${seg}"`));
    expect(section(a1, "kpi-k1")).toContain("Tunai Rp500.000");
    expect(section(a1, "kpi-k1")).not.toContain("QRIS");
    expect(section(a1, "kpi-k17")).toContain(REASON.k17Branch); // the paid net has no branch: unavailable with the reason, never Rp0
    const B3 = await tenant("PT Keuangan Kelima");
    await expect(financeBody(Promise.resolve({ cabang: B3.b1 }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(text(await body({ cabang: "x' or 1=1", dari: P10.from, sampai: P10.to }))).toContain("Semua Cabang · "); // a malformed ?cabang= is ignored
  });
  it("page body (financeBody): the owner gets the same summary; the auditor, a manager and an FO get the permission state with the reader pool present: the role gate runs before any tenant transaction", async () => {
    const ctx = async (p: P) => ({ kind: "ok", active: { context: await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }) } });
    const body = async (q: Record<string, string | string[] | undefined>) => renderToStaticMarkup((await financeBody(Promise.resolve(q))) as never);
    gate.pool = app;
    gate.rc = await ctx(OWN);
    expect(section(await body({ dari: P10.from, sampai: P10.to }), "kpi-k1")).toContain("Rp800.000");
    for (const p of [AU, MGR, FO]) {
      gate.rc = await ctx(p);
      const out = await body({ dari: P10.from, sampai: P10.to });
      expect(text(out), p.role).toContain("Anda tidak memiliki akses ke ringkasan keuangan.");
      expect(out, p.role).not.toMatch(/data-kpi|data-roll|Tampilan tersimpan/);
    }
  });
  it("cross-tenant: tenant B's finance sees none of A's money (real zeros in its own tenant)", async () => {
    const d = await as(BFIN, (db) => readFinanceSummary(db, P10));
    expect([d.k1.methods, d.commission.owed, d.k4.aging.d0_30, d.refundsWriteOffs.writeOffs]).toEqual([[], v(0), v(0), v(0)]);
  });
});
