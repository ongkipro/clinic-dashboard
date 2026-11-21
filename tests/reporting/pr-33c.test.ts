// PR-33c (T-111) — FO shift summary on Hari Ini (UX-6), presentational slice.
// Synthetic props only: no database and no T-107 reader yet (page.tsx wiring and the reader-backed scenario run land after
// T-107 integrates). These assertions pin what the view owns: totals per tender (scenario PR-33c), balance shown but never
// counted as money in, unavailable ≠ Rp0, "Belum dibayar" first and hidden when empty, one state per screen, drill-down
// links from caller props, compact and regular layouts, and no clinical text.
import type pg from "pg";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VIEWS } from "../../src/app/(app)/hari-ini/labels";
import { BOARD_DOWN, CALENDAR_DOWN, PATH, READERS, REPEATED_METHOD, type Summary, summaryIn, TENDERS_DOWN, tendersOf, UNKNOWN_METHOD, UUID } from "../../src/app/(app)/hari-ini/ringkasan/load";
import { type Amount, BAD_VALUE, moneyIn, net, NOT_RECONCILED, reconcileMoneyIn, type ShiftSummaryData, type ShiftSummaryProps, sortTenders, type TenderBlock, type TenderRow } from "../../src/app/(app)/hari-ini/ringkasan/model";
import { ShiftSummary } from "../../src/app/(app)/hari-ini/ringkasan/view";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { payRefund, requestRefund } from "../../src/modules/cashier/receivables/receivables";
import { openShift, submitShiftCount } from "../../src/modules/cashier/shifts/shifts";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { topUpBalance } from "../../src/modules/packages/packages";
import { SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import { createCharge, enableMockPort, receiveMockWebhook, simulate } from "../../src/modules/payments/payments";
import { closeVisit } from "../../src/modules/visits/visits";
import { createHarness, type Harness, testPool } from "../rls/harness";

const v = (rp: number): Amount => ({ state: "value", rp });
const na = (reason = "Pembacaan belum tersedia"): Amount => ({ state: "unavailable", reason });
const html = (p: ShiftSummaryProps) => renderToStaticMarkup(h(ShiftSummary, p));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const tender = (method: TenderRow["method"], received: Amount, paidOut: Amount = v(0), payments = 1): TenderRow =>
  ({ method, payments, received, paidOut, href: "/kasir/tutup/s1#tender" });
const block = (...rows: TenderRow[]) => ({ state: "value" as const, rows }) satisfies TenderBlock;
const cnt = (n: number) => ({ state: "value" as const, n });

function data(over: Partial<ShiftSummaryData> = {}): ShiftSummaryData {
  return {
    shift: { label: "Shift pagi", cashier: "Kasir Satu", state: "open", openedAt: "08.00 WIB", href: "/kasir/tutup/s1" },
    tenders: block(tender("qris", v(750_000), v(0), 3), tender("cash", v(1_200_000), v(200_000), 4)),
    moneyIn: { state: "value", rp: 1_750_000, href: "/kasir/tutup/s1#tender" },
    sales: { state: "value", rp: 2_100_000, href: "/kasir/tutup/s1#ringkasan" },
    arrivals: { count: cnt(12), href: "/hari-ini?cabang=b1&tampilan=semua" },
    noShows: { count: cnt(0), href: "/jadwal?cabang=b1&tampilan=hari&tanggal=2026-11-19" },
    openVisits: { count: cnt(3), href: "/hari-ini?cabang=b1&tampilan=menunggu" },
    unpaid: { count: cnt(2), total: v(450_000), href: "/kasir/terbuka" },
    others: [],
    ...over,
  };
}
const ready = (d: ShiftSummaryData = data()): ShiftSummaryProps => ({ branch: "Cabang A", day: "Kamis, 19 November", zone: "WIB", state: { kind: "ready", data: d } });
const rowOf = (out: string, m: string) => text(out.slice(out.indexOf(`data-tender="${m}"`), out.indexOf("</tr>", out.indexOf(`data-tender="${m}"`))));

describe("Scenario PR-33c shift summary: payments by cash and QRIS → totals per tender", () => {
  const out = html(ready());
  it("shows one row per tender with its own total, cash first", () => {
    expect(rowOf(out, "cash")).toMatch(/Tunai 4 Rp1\.200\.000 Rp200\.000 Rp1\.000\.000/);
    expect(rowOf(out, "qris")).toMatch(/QRIS 3 Rp750\.000 Rp0 Rp750\.000/);
    expect(out.indexOf('data-tender="cash"')).toBeLessThan(out.indexOf('data-tender="qris"'));
  });
  it("money in = net of real tenders (1.000.000 + 750.000)", () => {
    const card = text(out.slice(out.indexOf('id="kpi-uang"'), out.indexOf("</section>", out.indexOf('id="kpi-uang"'))));
    expect(card).toContain("Rp1.750.000");
    expect(moneyIn(block(tender("qris", v(750_000), v(0), 3), tender("cash", v(1_200_000), v(200_000), 4)).rows)).toEqual(v(1_750_000));
  });
  it("sales sit beside money in (K23), unchanged", () => {
    expect(text(out)).toMatch(/Penjualan shift ini Rp2\.100\.000/);
  });
});

describe("patient balance is shown but is not money in", () => {
  it("excludes balance from money in and labels it", () => {
    const b = block(tender("balance", v(500_000)), tender("cash", v(100_000)));
    expect(moneyIn(b.rows)).toEqual(v(100_000));
    const out = html(ready(data({ tenders: b, moneyIn: { state: "value", rp: 100_000, href: "/x" } })));
    expect(rowOf(out, "balance")).toContain("Bukan uang masuk");
    expect(sortTenders(b.rows).at(-1)?.method).toBe("balance");
  });
});

describe("unavailable is distinct from Rp0", () => {
  it("an unavailable tender makes money in unavailable with the reason, never a partial sum", () => {
    const b = block(tender("cash", v(100_000)), tender("qris", na("Data QRIS belum masuk")));
    expect(moneyIn(b.rows)).toEqual({ state: "unavailable", reason: "QRIS: Data QRIS belum masuk" });
    const d = data({ tenders: b, moneyIn: { ...reconcileMoneyIn(b, 100_000), href: "/x" } });
    const out = html(ready(d));
    const card = text(out.slice(out.indexOf('id="kpi-uang"'), out.indexOf("</section>", out.indexOf('id="kpi-uang"'))));
    expect(card).toContain("Belum tersedia");
    expect(card).toContain("QRIS: Data QRIS belum masuk");
    expect(card).not.toMatch(/Rp\d/);
  });
  it("net is unavailable if paid-out is unknown; a real 0 count shows 0", () => {
    expect(net(tender("cash", v(10), na("x")))).toEqual(na("x"));
    const out = html(ready(data({ arrivals: { count: { state: "unavailable", reason: "Menunggu pembacaan" }, href: "/h" } })));
    const arrivals = text(out.slice(out.indexOf('id="kpi-datang"'), out.indexOf("</section>", out.indexOf('id="kpi-datang"'))));
    expect(arrivals).toContain("Belum tersedia");
    expect(arrivals).toContain("Menunggu pembacaan");
    const noShow = text(out.slice(out.indexOf('id="kpi-tidak-datang"'), out.indexOf("</section>", out.indexOf('id="kpi-tidak-datang"'))));
    expect(noShow).toMatch(/Tidak datang 0 /);
  });
  it("no payments yet → an empty tender section, money in Rp0", () => {
    const out = text(html(ready(data({ tenders: block(), moneyIn: { ...reconcileMoneyIn(block(), 0), href: "/x" } }))));
    expect(out).toContain("Belum ada pembayaran pada shift ini.");
    expect(out).toMatch(/Uang masuk shift ini Rp0/);
  });
});

describe("UX-6 order, drill-down and layout", () => {
  it("'Belum dibayar' comes first when non-empty and is hidden when empty", () => {
    const out = html(ready());
    expect(out.indexOf("Belum dibayar")).toBeGreaterThan(-1);
    expect(out.indexOf("Belum dibayar")).toBeLessThan(out.indexOf('id="shift"'));
    expect(text(out)).toContain("2 tagihan terbuka");
    expect(html(ready(data({ unpaid: { count: cnt(0), total: v(0), href: "/x" } })))).not.toContain("Belum dibayar");
  });
  it("every figure links to the caller's drill-down target", () => {
    const out = html(ready());
    for (const href of ["/kasir/terbuka", "/kasir/tutup/s1", "/kasir/tutup/s1#tender", "/kasir/tutup/s1#ringkasan",
      "/hari-ini?cabang=b1&amp;tampilan=semua", "/jadwal?cabang=b1&amp;tampilan=hari&amp;tanggal=2026-11-19", "/hari-ini?cabang=b1&amp;tampilan=menunggu"]) {
      expect(out).toContain(`href="${href}"`);
    }
  });
  it("compact list and regular table are both rendered, toggled by the container's text size and never by the viewport (WCAG 1.4.10: no sideways scroll at 200 % text)", () => {
    const out = html(ready());
    expect(out).toContain("@container");
    expect(out).toContain("@min-[44em]:block");
    expect(out).toContain("@min-[44em]:hidden");
    expect(out).toContain("grid-cols-[minmax(0,1fr)] gap-3 @min-[44em]:grid-cols-3");
    expect(out).not.toContain("min-[700px]"); // a viewport breakpoint cannot follow the text size
    expect(out).not.toContain("overflow-x-auto"); // and nothing scrolls sideways
  });
  it("a money figure is one word: it never breaks inside its digits (\"Rp1.650.00 / 0\" at 390 px and 200 % text) and shrinks with the container instead", () => {
    const out = html(ready());
    for (const id of ["kpi-uang", "kpi-jual"]) {
      const card = out.slice(out.indexOf(`id="${id}"`), out.indexOf("</section>", out.indexOf(`id="${id}"`)));
      const fig = /<span data-kpi="value" class="([^"]*)">/.exec(card)?.[1] ?? "";
      expect(fig).toContain("whitespace-nowrap");
      expect(fig).not.toContain("overflow-wrap:anywhere");
      expect(fig).toMatch(/@max-\[22em\]:text-/);
    }
  });
  it("every tender link is a 44 px target in the table as well as in the list", () => {
    const out = html(ready());
    const links = [...out.matchAll(/<a [^>]*data-?[^>]*>|<a [^>]*>/g)].map((m) => m[0]).filter((a) => a.includes("kasir/tutup"));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links.filter((x) => !x.includes("min-h-[var(--target)]"))) expect(a).toMatch(/kasir\/tutup\/s1"/); // only the shift header link may be sized by its section
    const rowLinks = [...out.matchAll(/<th scope="row"[^>]*>(<a [^>]*>)/g)].map((m) => m[1]);
    expect(rowLinks).toHaveLength(2);
    for (const a of rowLinks) expect(a).toContain("min-h-[var(--target)]");
  });
  it("shows the shift state as a word, not colour alone", () => {
    expect(text(html(ready(data({ shift: { ...data().shift, state: "pending_approval" } }))))).toContain("Menunggu persetujuan");
  });
});

describe("one state per screen (10 State Copy Patterns)", () => {
  const cases = [
    [{ kind: "loading" }, 'aria-busy="true"'],
    [{ kind: "empty", message: "Belum ada shift hari ini." }, "Belum ada shift hari ini."],
    [{ kind: "filtered-empty", message: "Tidak ada shift untuk filter ini.", clearHref: "/hari-ini/ringkasan" }, "Hapus Filter"],
    [{ kind: "error", message: "Koneksi terputus.", retryHref: "/hari-ini/ringkasan" }, "Coba Lagi"],
    [{ kind: "blocked", reason: "Shift belum dibuka", unblock: "Kasir dapat membuka shift" }, "Shift belum dibuka."],
    [{ kind: "permission", object: "ringkasan shift" }, "Anda tidak memiliki akses ke ringkasan shift."],
  ] as const;
  it.each(cases)("%o renders its copy and no figure", (state, copy) => {
    const out = html({ branch: "Cabang A", day: "Kamis", zone: "WIB", state });
    expect(out).toContain(copy);
    expect(out).not.toContain("data-kpi=");
    expect(out).not.toContain("data-tender=");
  });
});

describe("no clinical content and safe text", () => {
  it("escapes cashier and branch names and renders no clinical vocabulary", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const out = renderToStaticMarkup(h(ShiftSummary, { ...ready(data({ shift: { ...data().shift, cashier: hostile } })), branch: hostile }));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(text(out)).not.toMatch(/diagnos|alergi|resep|anamnesis|rekam medis|keluhan/i);
  });
  it("the props carry no patient fields (type-level guard)", () => {
    // @ts-expect-error — a tender row has no patient field
    const bad: TenderRow = { ...tender("cash", v(1)), patient: "x" };
    expect(bad).toBeTruthy();
  });
});

// ── The loader core (load.ts) over a fake connection that answers each reader with the shape the real one returns ─────────────────────────────────────
// Facts here are what the readers answer (cash_shift_get, cash_shift_mine, cash_shift_list, visits_today, appointments_window); the PostgreSQL block below runs the same core on the
// real readers. A reader that is not asked for is simply absent from `calls`, so the call log also proves which reader a role is allowed to reach.
type Row = Record<string, unknown>;
const A1 = { id: "11111111-1111-4111-8111-111111111111", name: "Cabang A", tz: "Asia/Jakarta" };
const A2 = { id: "22222222-2222-4222-8222-222222222222", name: "Cabang B", tz: "Asia/Makassar" };
const S1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-19T05:00:00Z"); // 12:00 WIB, Thursday
const cashLine = { method: "cash", payments: 4, received: 1_200_000, paid_out: 200_000, expected: 1_000_000 };
const qrisLine = { method: "qris", payments: 3, received: 750_000, paid_out: 0, expected: 750_000 };
const detail = (o: { id?: string; branch?: string; cashier?: string; opened?: string; expected?: unknown; k23?: unknown; tagihan?: unknown } = {}): Row => ({
  role: "owner", staff_id: "s", can_count: false, manager_decides: true, threshold: 0,
  shift: { id: o.id ?? S1, branch: { id: o.branch ?? A1.id, name: "x" }, cashier: { id: "c1", name: o.cashier ?? "Kasir Satu" }, state: "open", auto_opened: false, opening_float: 0,
    opened_at: o.opened ?? "2026-11-19T01:00:00Z", closed_at: null, settled_at: null },
  expected: "expected" in o ? o.expected : [cashLine, qrisLine], counts: [], payments: [],
  k23: "k23" in o ? o.k23 : { received: 1_750_000, sales: 2_100_000 },
  open_tagihan: "tagihan" in o ? o.tagihan : { count: 2, total: 450_000 },
});
const visit = (id: string, checkedIn: string, closed: string | null = null): Row => ({
  id, kind: "walk_in", checked_in_at: checkedIn, appointment_id: null, starts_at: null, patient_id: "p", patient_name: "Pasien", patient_mrn: "RM-1", blocker: null, closed_at: closed,
});
const board = (visits: Row[] = [], today = "2026-11-19", timezone = "Asia/Jakarta"): Row => ({ now: "2026-11-19T05:00:00Z", timezone, today, visits, arrivals: [] });
const appt = (state: string): Row => ({ id: `a-${state}`, state, starts_at: "2026-11-19T02:00:00Z", ends_at: "2026-11-19T02:30:00Z" });
type Ans = { branches?: (typeof A1)[]; get?: Record<string, Row | Error>; mine?: string | null; open?: Row[]; listError?: Error; board?: Row | Error; window?: Row[] | Error };
const openRow = (id: string, cashier: string, opened = "2026-11-19T01:00:00Z"): Row => ({ id, branch: { id: A1.id, name: "x" }, cashier: { id: "c", name: cashier }, state: "open", opened_at: opened });
function fake(a: Ans) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (/^(savepoint|release savepoint|rollback to savepoint)/.test(sql)) return { rows: [] };
      if (sql.startsWith("select * from branches")) return { rows: (a.branches ?? [A1, A2]).map((b) => ({ id: b.id, code: b.name.slice(-1), name: b.name, timezone: b.tz })) };
      if (sql.includes("cash_shift_list")) { if (a.listError) throw a.listError; return { rows: [{ r: { rows: a.open ?? [] } }] }; }
      if (sql.includes("cash_shift_mine")) return { rows: [{ r: a.mine ? { id: a.mine, state: "open" } : null }] };
      if (sql.includes("cash_shift_get")) { const x = a.get?.[String(args[0])]; if (!x) throw new CommandError("ERR_NOT_FOUND"); if (x instanceof Error) throw x; return { rows: [{ r: x }] }; }
      if (sql.includes("visits_today")) { if (a.board instanceof Error) throw a.board; return { rows: [{ r: a.board ?? board() }] }; }
      if (sql.includes("appointments_window")) { if (a.window instanceof Error) throw a.window; return { rows: [{ w: { appointments: a.window ?? [], performers: [] } }] }; }
      throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
    },
  };
}
const run = (db: ReturnType<typeof fake>, role: string, branch: string | null, q: { cabang?: string; shift?: string } = {}) => summaryIn(db as never, role, branch, q, NOW);
const okOf = (r: Summary) => {
  if (r.kind !== "ok" || r.props.state.kind !== "ready") throw new Error(`not a ready summary: ${r.kind}`);
  return { data: r.props.state.data, props: r.props, r };
};
const reads = (db: ReturnType<typeof fake>, name: string) => db.calls.filter((c) => c.sql.includes(name));
const FO_OWN = { get: { [S1]: detail() }, mine: S1 };
const byMethod = (d: ShiftSummaryData) => (d.tenders.state === "value" ? Object.fromEntries(d.tenders.rows.map((r) => [r.method, r])) : {}) as Record<string, TenderRow | undefined>;

describe("loader: Scenario PR-33c on the reader's answers — cash and QRIS totals per tender; money in is the K23 received", () => {
  it("shows each tender as the reader counted it; money in = cash net of paid-out + QRIS = K23 received; sales is K23 sales", async () => {
    const { data, props } = okOf(await run(fake(FO_OWN), "fo_cashier", A1.id));
    expect(data.tenders).toEqual({ state: "value", rows: [
      { method: "cash", payments: 4, received: v(1_200_000), paidOut: v(200_000), href: `/kasir/tutup/${S1}#tender` },
      { method: "qris", payments: 3, received: v(750_000), paidOut: v(0), href: `/kasir/tutup/${S1}#tender` },
    ] });
    expect(data.moneyIn).toEqual({ state: "value", rp: 1_750_000, href: `/kasir/tutup/${S1}#tender` });
    expect(data.sales).toEqual({ state: "value", rp: 2_100_000, href: `/kasir/tutup/${S1}#ringkasan` });
    const out = html(props);
    expect(rowOf(out, "cash")).toMatch(/Tunai 4 Rp1\.200\.000 Rp200\.000 Rp1\.000\.000/);
    expect(rowOf(out, "qris")).toMatch(/QRIS 3 Rp750\.000 Rp0 Rp750\.000/);
    expect(text(out)).toMatch(/Uang masuk shift ini Rp1\.750\.000/);
  });
  it("patient balance is listed but is never money in: the tenders may carry it while K23 received does not", async () => {
    const { data } = okOf(await run(fake({ get: { [S1]: detail({ expected: [cashLine, { method: "balance", payments: 1, received: 500_000, paid_out: 0, expected: 500_000 }], k23: { received: 1_000_000, sales: 1 } }) }, mine: S1 }), "fo_cashier", A1.id));
    expect(data.tenders.state === "value" && data.tenders.rows.map((r) => r.method)).toEqual(["cash", "balance"]);
    expect(data.moneyIn).toMatchObject({ state: "value", rp: 1_000_000 });
  });
  it("money in that disagrees with the same reader's K23 received is unavailable with its reason, never the sum (one shift source, PANEL2-DECISION)", async () => {
    const { data, props } = okOf(await run(fake({ get: { [S1]: detail({ k23: { received: 1_700_000, sales: 2_100_000 } }) }, mine: S1 }), "fo_cashier", A1.id));
    expect(data.moneyIn).toMatchObject({ state: "unavailable", reason: NOT_RECONCILED });
    expect(data.tenders.state).toBe("value"); // the per-tender rows stay: only the combined figure is withheld
    const out = html(props);
    const card = text(out.slice(out.indexOf('id="kpi-uang"'), out.indexOf("</section>", out.indexOf('id="kpi-uang"'))));
    expect(card).toContain("Belum tersedia");
    expect(card).toContain(NOT_RECONCILED);
    expect(card).not.toMatch(/Rp\d/);
  });
  it.each([[null], [undefined], [1_750_000.5], ["1750000"], [Number.NaN]])("a K23 received of %s is not a figure: money in is unavailable (%s)", async (bad) => {
    const { data } = okOf(await run(fake({ get: { [S1]: detail({ k23: { received: bad, sales: 1 } }) }, mine: S1 }), "fo_cashier", A1.id));
    expect(data.moneyIn).toMatchObject({ state: "unavailable", reason: BAD_VALUE });
  });
  it("an amount the view cannot trust (negative, fractional, text) makes that cell and money in unavailable — never Rp0 and never a partial sum", async () => {
    for (const received of [-5, 1.5, "12"]) {
      const { data } = okOf(await run(fake({ get: { [S1]: detail({ expected: [{ ...cashLine, received }, qrisLine] }) }, mine: S1 }), "fo_cashier", A1.id));
      expect(data.tenders.state === "value" && data.tenders.rows[0].received).toEqual({ state: "unavailable", reason: BAD_VALUE });
      expect(data.moneyIn.state).toBe("unavailable");
    }
  });
  it("a tender block the view cannot type is unavailable as a whole: unknown method, repeated method, not a list", async () => {
    const block = async (expected: unknown) => okOf(await run(fake({ get: { [S1]: detail({ expected }) }, mine: S1 }), "fo_cashier", A1.id));
    expect((await block([cashLine, { ...qrisLine, method: "crypto" }])).data.tenders).toEqual({ state: "unavailable", reason: UNKNOWN_METHOD });
    expect((await block([cashLine, cashLine])).data.tenders).toEqual({ state: "unavailable", reason: REPEATED_METHOD });
    const none = await block(null);
    expect(none.data.tenders).toEqual({ state: "unavailable", reason: TENDERS_DOWN });
    expect(none.data.moneyIn).toMatchObject({ state: "unavailable", reason: TENDERS_DOWN });
    const out = html(none.props);
    expect(text(out)).toContain(`Belum tersedia. ${TENDERS_DOWN}`);
    expect(out).not.toContain("data-tender=");
    expect(tendersOf([], "/x")).toEqual({ state: "value", rows: [] }); // no row at all is a real "no payments" — not a fault
  });
  it("the K23 sales figure is the reader's, and an unreadable one is unavailable", async () => {
    expect(okOf(await run(fake({ get: { [S1]: detail({ k23: { received: 1_750_000, sales: null } }) }, mine: S1 }), "fo_cashier", A1.id)).data.sales).toMatchObject({ state: "unavailable" });
  });
});

describe("loader: 'Belum dibayar' is the shift reader's open tagihan; a missing answer is not an empty queue", () => {
  it("count and total come from open_tagihan", async () => {
    const { data } = okOf(await run(fake(FO_OWN), "fo_cashier", A1.id));
    expect(data.unpaid).toEqual({ count: { state: "value", n: 2 }, total: v(450_000), href: "/kasir/terbuka" });
  });
  it("an owner's link names the branch it is looking at; a manager/FO link does not (the cashier reads its own branch)", async () => {
    expect(okOf(await run(fake(FO_OWN), "owner", A1.id)).data.unpaid.href).toBe(`/kasir/terbuka?cabang=${A1.id}`);
    expect(okOf(await run(fake(FO_OWN), "manager", A1.id)).data.unpaid.href).toBe("/kasir/terbuka");
  });
  it.each([[undefined], [{ count: "2", total: 1 }], [{ count: 1, total: -1 }], [{ count: 1.5, total: 1 }]])("open_tagihan %j is unavailable and still shown — never hidden as zero", async (tagihan) => {
    const { data, props } = okOf(await run(fake({ get: { [S1]: detail({ tagihan }) }, mine: S1 }), "fo_cashier", A1.id));
    expect(data.unpaid.count).toMatchObject({ state: "unavailable" });
    const out = html(props);
    expect(out).toContain("Belum dibayar");
    expect(out).toContain('data-unpaid="unavailable"');
    expect(text(out)).toContain("Belum tersedia");
  });
  it("a real zero is hidden (nothing owed), a real non-zero is the first section", async () => {
    const zero = okOf(await run(fake({ get: { [S1]: detail({ tagihan: { count: 0, total: 0 } }) }, mine: S1 }), "fo_cashier", A1.id));
    expect(zero.data.unpaid.count).toEqual({ state: "value", n: 0 });
    expect(html(zero.props)).not.toContain("Belum dibayar");
  });
});

describe("loader: the day counters come from the branch's own day (visits_today, appointments_window)", () => {
  const visits = [visit("v1", "2026-11-19T01:00:00Z"), visit("v2", "2026-11-18T16:30:00Z"), visit("v3", "2026-11-19T02:00:00Z", "2026-11-19T04:00:00Z")]; // today open / yesterday 23:30 WIB still open / today closed
  it("arrivals = visits checked in today; open visits = not closed (a visit still open from yesterday is open but is not today's arrival); no-shows = the no_show appointments of the day", async () => {
    const db = fake({ ...FO_OWN, board: board(visits), window: [appt("no_show"), appt("booked"), appt("no_show"), appt("cancelled")] });
    const { data } = okOf(await run(db, "fo_cashier", A1.id));
    expect(data.arrivals.count).toEqual({ state: "value", n: 2 });
    expect(data.openVisits.count).toEqual({ state: "value", n: 2 });
    expect(data.noShows.count).toEqual({ state: "value", n: 2 });
    expect(reads(db, "appointments_window")[0].args).toEqual([A1.id, "2026-11-19", "2026-11-19"]); // the branch's own date, one day
  });
  it("'today' is the branch's: 00:30 on the 19th in Makassar (UTC+8) is today's arrival there, but 23:30 on the 18th in Jakarta is not", async () => {
    const at = "2026-11-18T16:30:00Z";
    const makassar = okOf(await run(fake({ get: { [S1]: detail({ branch: A2.id }) }, mine: S1, board: board([visit("m", at)], "2026-11-19", "Asia/Makassar") }), "owner", A1.id, { cabang: A2.id }));
    expect(makassar.data.arrivals.count).toEqual({ state: "value", n: 1 });
    expect(makassar.props.zone).toBe("WITA");
    const jakarta = okOf(await run(fake({ ...FO_OWN, board: board([visit("j", at)]) }), "fo_cashier", A1.id));
    expect(jakarta.data.arrivals.count).toEqual({ state: "value", n: 0 });
    expect(jakarta.data.openVisits.count).toEqual({ state: "value", n: 1 });
  });
  it("a day with nothing is a real 0 — and an unavailable counter is never shown as 0", async () => {
    const { data, props } = okOf(await run(fake({ ...FO_OWN, board: board(), window: [] }), "fo_cashier", A1.id));
    expect([data.arrivals.count, data.noShows.count, data.openVisits.count]).toEqual([cnt(0), cnt(0), cnt(0)]);
    expect(text(html(props))).toMatch(/Tidak datang 0 /);
  });
});

describe("loader: one reader that fails leaves only its own figures unavailable, and the transaction stays usable (savepoint per reader)", () => {
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
  it("visits_today fails → arrivals and open visits unavailable with the reason; no-shows, tenders, money in, sales and unpaid are intact; the next reader still ran", async () => {
    const spy = quiet();
    const db = fake({ ...FO_OWN, board: new Error("connection reset: patient Rahasia"), window: [appt("no_show")] });
    const { data, props } = okOf(await run(db, "fo_cashier", A1.id));
    spy.mockRestore();
    expect(data.arrivals.count).toEqual({ state: "unavailable", reason: BOARD_DOWN });
    expect(data.openVisits.count).toEqual({ state: "unavailable", reason: BOARD_DOWN });
    expect(data.noShows.count).toEqual({ state: "value", n: 1 });
    expect(data.moneyIn).toMatchObject({ state: "value", rp: 1_750_000 });
    expect(data.unpaid.count).toEqual({ state: "value", n: 2 });
    const rollback = db.calls.findIndex((c) => c.sql.startsWith("rollback to savepoint"));
    expect(rollback).toBeGreaterThan(-1);
    expect(db.calls.findIndex((c) => c.sql.includes("appointments_window"))).toBeGreaterThan(rollback); // the failed reader was rolled back BEFORE the next one ran
    const out = text(html(props));
    expect(out).toMatch(/Pasien datang Belum tersedia/);
    expect(out).toContain(BOARD_DOWN);
    expect(out).toMatch(/Tidak datang 1 /);
  });
  it("appointments_window fails → only no-shows are unavailable", async () => {
    const spy = quiet();
    const { data } = okOf(await run(fake({ ...FO_OWN, board: board([visit("v1", "2026-11-19T01:00:00Z")]), window: new Error("timeout") }), "fo_cashier", A1.id));
    spy.mockRestore();
    expect(data.noShows.count).toEqual({ state: "unavailable", reason: CALENDAR_DOWN });
    expect(data.arrivals.count).toEqual({ state: "value", n: 1 });
  });
  it("the failure is logged by reader name only — no message, no payload (no clinical or patient content in logs)", async () => {
    const spy = quiet();
    await run(fake({ ...FO_OWN, board: new Error("patient Rahasia Sekali") }), "fo_cashier", A1.id);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain("visits_today");
    expect(logged).not.toContain("Rahasia");
  });
  it("the list of the branch's other open shifts failing is a navigation loss only, never a figure", async () => {
    const spy = quiet();
    const { data } = okOf(await run(fake({ ...FO_OWN, listError: new Error("boom") }), "manager", A1.id));
    spy.mockRestore();
    expect(data.others).toEqual([]);
    expect(data.moneyIn).toMatchObject({ state: "value" });
  });
  it("a refusal (the reader says not found / forbidden / invalid) is a refusal, not a logged fault", async () => {
    const spy = quiet();
    const { data } = okOf(await run(fake({ ...FO_OWN, board: new CommandError("ERR_FORBIDDEN") }), "fo_cashier", A1.id));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(data.arrivals.count).toMatchObject({ state: "unavailable" });
  });
});

describe("loader: which shift, which branch, which reader — by role", () => {
  it("an FO/cashier reads its own current shift only: cash_shift_mine, never the branch's list", async () => {
    const db = fake(FO_OWN);
    await run(db, "fo_cashier", A1.id, { cabang: A2.id });
    expect(reads(db, "cash_shift_list")).toHaveLength(0);
    expect(reads(db, "cash_shift_mine")[0].args).toEqual([null]);
    expect(reads(db, "cash_shift_get").map((c) => c.args)).toEqual([[S1]]);
  });
  it("an FO/cashier with no open shift gets the empty state with 'Buka Kasir' — not a screen of Rp0", async () => {
    const db = fake({ mine: null });
    const r = await run(db, "fo_cashier", A1.id);
    if (r.kind !== "ok") throw new Error("not ok");
    expect(r.props.state).toEqual({ kind: "empty", message: "Belum ada shift yang terbuka di cabang ini.", action: "Buka Kasir", actionHref: "/kasir/tutup" });
    expect(reads(db, "cash_shift_get")).toHaveLength(0);
    const out = html(r.props);
    expect(out).toContain("Buka Kasir");
    expect(out).not.toContain("data-kpi=");
    expect(out).not.toContain("Rp0");
  });
  it("a manager with no shift of its own reads the latest open shift of its branch and lists the others; ?shift= wins over both", async () => {
    const db = fake({ get: { [S1]: detail(), [S2]: detail({ id: S2, cashier: "Kasir Dua" }) }, mine: null, open: [openRow(S2, "Kasir Dua", "2026-11-19T03:00:00Z"), openRow(S1, "Kasir Satu")] });
    const latest = okOf(await run(db, "manager", A1.id));
    expect(latest.data.shift.cashier).toBe("Kasir Dua");
    expect(latest.data.others).toEqual([{ label: "Kasir Satu · dibuka 08.00 WIB", href: `${PATH}?shift=${S1}` }]);
    expect(reads(db, "cash_shift_list")[0].args).toEqual([null, "open"]); // the manager's branch comes from the context, never from the URL
    const asked = okOf(await run(fake({ get: { [S1]: detail() }, mine: S2, open: [openRow(S2, "x")] }), "manager", A1.id, { shift: S1 }));
    expect(asked.data.shift.cashier).toBe("Kasir Satu");
  });
  it("a shift opened on an earlier day shows its date; one opened today shows the clock only", async () => {
    const old = okOf(await run(fake({ get: { [S1]: detail({ opened: "2026-11-17T01:00:00Z" }) }, mine: S1 }), "fo_cashier", A1.id));
    expect(old.data.shift.openedAt).toBe("17 Nov, 08.00 WIB");
    expect(okOf(await run(fake(FO_OWN), "fo_cashier", A1.id)).data.shift.openedAt).toBe("08.00 WIB");
  });
  it("an owner picks a branch; a foreign or unknown id is never asked of a reader (it falls back to the active branch)", async () => {
    const db = fake({ get: { [S1]: detail({ branch: A2.id }) }, mine: S1, branches: [A1, A2] });
    expect(okOf(await run(db, "owner", A1.id, { cabang: A2.id })).r.branchId).toBe(A2.id);
    expect(reads(db, "cash_shift_mine")[0].args).toEqual([A2.id]);
    const foreign = fake({ get: { [S1]: detail() }, mine: S1 });
    const r = okOf(await run(foreign, "owner", A1.id, { cabang: "99999999-9999-4999-8999-999999999999" }));
    expect(r.r.branchId).toBe(A1.id);
    expect(JSON.stringify(foreign.calls)).not.toContain("99999999");
  });
  it("a manager or FO cannot pick another branch through the URL: every reader is asked about its own branch", async () => {
    for (const role of ["manager", "fo_cashier"]) {
      const db = fake({ ...FO_OWN, board: board() });
      const r = okOf(await run(db, role, A1.id, { cabang: A2.id }));
      expect(r.r.branchId).toBe(A1.id);
      expect(r.r.branches).toEqual([{ id: A1.id, name: A1.name }]); // no branch chips for the caller
      expect(JSON.stringify(db.calls.map((c) => c.args))).not.toContain(A2.id);
    }
  });
  it("a manager or FO who names another branch and has no open shift gets the empty state of its OWN branch: never the other branch's name, even if the database listed it", async () => {
    for (const role of ["manager", "fo_cashier"]) {
      const r = await run(fake({ mine: null, open: [], branches: [A1, A2] }), role, A1.id, { cabang: A2.id });
      if (r.kind !== "ok") throw new Error("not ok");
      expect([r.branchId, r.props.branch, r.props.state.kind]).toEqual([A1.id, A1.name, "empty"]);
      expect(JSON.stringify(r)).not.toContain(A2.name);
    }
  });
  it("a caller with no branch is told so; a malformed shift id is not-found before any query", async () => {
    expect((await run(fake({}), "manager", null)).kind).toBe("no-branch");
    const db = fake(FO_OWN);
    expect((await run(db, "owner", A1.id, { shift: "not-a-uuid" })).kind).toBe("not-found");
    expect(db.calls).toHaveLength(0);
    expect(UUID.test(S1)).toBe(true);
  });
  it("the reader's refusal decides: not found → not-found, forbidden → forbidden; any other failure is an error (thrown), never a figure", async () => {
    const quietly = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await run(fake({ get: { [S1]: new CommandError("ERR_NOT_FOUND") } }), "manager", A1.id, { shift: S1 })).kind).toBe("not-found");
    expect((await run(fake({ get: { [S1]: new CommandError("ERR_FORBIDDEN") } }), "manager", A1.id, { shift: S1 })).kind).toBe("forbidden");
    await expect(run(fake({ get: { [S1]: new Error("down") } }), "manager", A1.id, { shift: S1 })).rejects.toThrow("down");
    quietly.mockRestore();
  });
  it("a shift that sits at a branch the caller does not have is not-found even if a reader answered it; a malformed header is an error, not garbage on screen", async () => {
    expect((await run(fake({ get: { [S1]: detail({ branch: A2.id }) } }), "manager", A1.id, { shift: S1 })).kind).toBe("not-found");
    const quietly = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = detail();
    (bad.shift as Row).cashier = {};
    await expect(run(fake({ get: { [S1]: bad } }), "manager", A1.id, { shift: S1 })).rejects.toThrow(/unexpected shape/);
    quietly.mockRestore();
  });
  it("the pages serve exactly the roles both readers admit: owner, manager and FO/cashier (kasir_reader ∩ visits_today)", () => {
    expect([...READERS]).toEqual(["owner", "manager", "fo_cashier"]);
  });
});

describe("loader: every link leads to a page that exists and reads what the link carries", () => {
  it("only built pages, only the parameters they read (no #method anchors, no ?shift= on Kasir, no ?status= on Jadwal)", async () => {
    const db = fake({ get: { [S1]: detail() }, mine: S1, board: board([visit("v", "2026-11-19T01:00:00Z")]), window: [appt("no_show")], open: [openRow(S1, "Kasir Satu"), openRow(S2, "Kasir Dua")] });
    const { props } = okOf(await run(db, "owner", A1.id));
    const hrefs = [...html(props).matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    expect(hrefs.length).toBeGreaterThan(6);
    for (const href of hrefs) {
      const u = new URL(href, "https://x.test");
      if (u.pathname === "/hari-ini") expect(Object.keys(VIEWS)).toContain(u.searchParams.get("tampilan"));
      if (u.pathname === "/jadwal") { expect(u.searchParams.get("tampilan")).toBe("hari"); expect(u.searchParams.get("tanggal")).toBe("2026-11-19"); }
      if (u.pathname === "/kasir/terbuka") expect([...u.searchParams.keys()].filter((k) => k !== "cabang")).toEqual([]);
      expect(u.pathname).toMatch(/^\/(hari-ini|hari-ini\/ringkasan|jadwal|kasir\/terbuka|kasir\/tutup(\/[0-9a-f-]{36})?)$/);
      expect(u.hash === "" || u.hash === "#tender" || u.hash === "#ringkasan").toBe(true);
      expect(u.searchParams.has("status")).toBe(false);
    }
    expect(hrefs).toContain(`/kasir/tutup/${S1}#tender`);
    expect(hrefs).toContain(`/kasir/tutup/${S1}#ringkasan`);
    expect(hrefs).toContain(`${PATH}?shift=${S2}`);
  });
});

// ── Real-fixture evidence: the loader core over the REAL readers on PostgreSQL ──────────────────────────────────────────────────────────────────
// Cash goes through the real cashier writers (the database stamps the shift), patient balance through the real top-up, a cash refund through the real refund path, a simulated QRIS payment
// through the real mock port, a visit is closed through the real writer. One fact has no writer: a QRIS payment that is NOT simulated (the only provider is the mock, and a mock charge is
// simulated by CHECK), so the QRIS the shift counts is inserted the way a port settlement would persist it: a receipt, the payment with the payments guard off for that one insert (the practice
// of tests/cashier/shifts.test.ts; the shift is still stamped by the real trigger), its allocation through the allocation guard. Synthetic data only (MIG-2).
// Heavy: run under heavy-run --lock clinic-dashboard-env.
describe("T-111 shift summary on the real readers (PostgreSQL)", () => {
  let hn: Harness;
  let appP: pg.Pool;
  let ownP: pg.Pool;
  let seq = 0;
  const key = () => crypto.randomUUID();
  const LONG = 120_000;
  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local"; // synthetic data only (MIG-2): the cashier writers' production go-live gate stays closed otherwise
    setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) }); // the mock payment port needs a key to be switched on
    hn = await createHarness();
    appP = await openAppPool({ connectionString: hn.urlAs(await hn.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    ownP = testPool({ connectionString: hn.ownerUrl(), max: 2 });
  }, 300_000);
  afterAll(async () => { setKekRingForTests(undefined); await appP?.end(); await ownP?.end(); await hn?.close(); });

  type Who = { acc: string; staffId: string; role: Role; branch?: string; name: string };
  async function world() {
    const t = (await hn.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await hn.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Ringkasan Shift Sintetis', 'emkm')`, [t]);
    const br = async (c: string) => (await hn.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`, [t, c, `Cabang ${c}`])).rows[0].id as string;
    const b1 = await br("A");
    const b2 = await br("B");
    const person = async (role: Role, branch?: string): Promise<Who> => {
      const n = ++seq;
      const name = `Staf Ringkasan Shift ${n}`;
      const acc = (await hn.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rsh${n}@klinik-sintetis.test`])).rows[0].id as string;
      const { staffId } = await createMembership(ownP, { tenantId: t, accountId: acc, displayName: name });
      const rid = await assignRole(hn.admin, { tenantId: t, staffId, role });
      if (branch) await assignBranch(hn.admin, { tenantId: t, staffRoleId: rid, branchId: branch });
      return { acc, staffId, role, branch, name };
    };
    const owner = await person("owner");
    const as = async <R>(w: Who, fn: (db: pg.PoolClient) => Promise<R>) =>
      withTenantContext(appP, await resolveContext(appP, w.acc, { tenantId: t, actingRole: w.role, activeBranchId: w.branch }), fn);
    const pharm = await person("pharmacist", b1);
    const product = (await as(owner, (db) => publish(db, { kind: "product", code: `RS-${++seq}` }, { name: "Serum Ringkasan Shift", tax_category: "non_object", tax_basis: "Barang", normal_price: 100_000 } as never, "Produk"))).itemId;
    await as(pharm, (db) => saveItem(db, key(), null, { catalogItemId: product, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    return { t, b1, b2, owner, person, as, product };
  }
  type World = Awaited<ReturnType<typeof world>>;
  const patient = async (w: World, b: string, by: string) => (await hn.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Ringkasan Shift', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`,
    [w.t, b, by])).rows[0].id as string;
  // A sale of `qty` serums (100.000 each) paid in full by `fo` with `tender`: a counter sale, or a patient's invoice when a patient is named.
  async function sell(w: World, fo: Who, qty: number, tender: "cash" | "edc" | "balance", patientId?: string) {
    const { invoiceId } = await w.as(fo, (db) => openKasirInvoice(db, key(), patientId ? { patientId } : { counter: true }));
    await w.as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: w.product, quantity: qty }]));
    const amount = qty * 100_000;
    const t = tender === "cash" ? { method: "cash" as const, amount, cashTendered: amount }
      : tender === "edc" ? { method: "edc" as const, amount, details: { card_type: "debit", bank: "BCA", trace: `T${++seq}`, approval_code: "A1B2C3" } } : { method: "balance" as const, amount };
    await w.as(fo, (db) => receivePayment(db, key(), invoiceId, [t]));
    return { invoiceId, amount };
  }
  // An issued, unpaid invoice (open tagihan) of `qty` serums.
  async function bill(w: World, fo: Who, qty: number) {
    const { invoiceId } = await w.as(fo, (db) => openKasirInvoice(db, key(), { counter: true }));
    await w.as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: w.product, quantity: qty }]));
    return invoiceId;
  }
  // A QRIS payment received in full by `fo`, as a port settlement would persist it (see the block comment): receipt, payment, allocation.
  async function qris(w: World, fo: Who, qty: number) {
    const invoiceId = await bill(w, fo, qty);
    const amount = qty * 100_000;
    const b = fo.branch as string;
    const q = (sql: string, args: unknown[]) => hn.admin.query(sql, args);
    const line = (await q(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id as string;
    const rc = (await q(`insert into receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, command_key, issued_by, issued_as)
      values ($1, $2, $3, $4, $5, 'Kuitansi QRIS sintetis', '80mm', $6, $7, 'fo_cashier') returning id`, [w.t, b, invoiceId, `RS-${key().slice(0, 8)}`, amount, `rs-${key()}`, fo.staffId])).rows[0].id as string;
    await q("alter table payments disable trigger payments_guard", []);
    try {
      const pay = (await q(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, method, amount, environment, is_simulated, received_by, received_as)
        values ($1, $2, $3, 1, $4, 'qris', $5, 'local', false, $6, 'fo_cashier') returning id`, [w.t, b, rc, invoiceId, amount, fo.staffId])).rows[0].id as string;
      await q(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated) values ($1, $2, $3, $4, $5, 'qris', 'local', false)`, [w.t, b, pay, line, amount]);
    } finally {
      await q("alter table payments enable always trigger payments_guard", []);
    }
    return invoiceId;
  }
  // An issued invoice paid by a mock QRIS charge through the real port: the payment row is SIMULATED (BILL-29), so no shift is stamped and the invoice still owes.
  async function simulatedQris(w: World, fo: Who, qty: number) {
    const mgr = await w.person("manager", fo.branch);
    await w.as(mgr, (db) => enableMockPort(db));
    const invoiceId = await bill(w, fo, qty);
    const c = await w.as(fo, (db) => createCharge(db, key(), invoiceId, { channel: "qris" }));
    const sg = await w.as(fo, (db) => simulate(db, c.charge_id, "paid", w.t));
    expect(await receiveMockWebhook(appP, sg.rawBody, sg.headers[SIGNATURE_HEADER], "local")).toEqual({ status: 200, outcome: "applied" });
    return invoiceId;
  }
  const open = (w: World, who: Who, q: { cabang?: string; shift?: string } = {}) => w.as(who, (db) => summaryIn(db, who.role, who.branch ?? null, q, new Date()));
  const load = async (w: World, who: Who, q: { cabang?: string; shift?: string } = {}) => {
    const r = await open(w, who, q);
    if (r.kind !== "ok" || r.props.state.kind !== "ready") throw new Error(`not a ready summary: ${r.kind}`);
    return { data: r.props.state.data, props: r.props, r };
  };

  it("Scenario PR-33c on the real readers: cash through the cashier and QRIS received in the shift — totals per tender; money in reconciles with the shift's own K23; the opening float is never money in", async () => {
    const w = await world();
    const fo = await w.person("fo_cashier", w.b1);
    await w.as(fo, (db) => openShift(db, key(), { openingFloat: 200_000 }));
    await sell(w, fo, 1, "cash");
    await sell(w, fo, 3, "cash");
    await qris(w, fo, 7);
    const { data, props } = await load(w, fo);
    const rows = byMethod(data);
    expect(rows.cash).toMatchObject({ payments: 2, received: v(400_000), paidOut: v(0) });
    expect(rows.qris).toMatchObject({ payments: 1, received: v(700_000), paidOut: v(0) });
    expect(data.moneyIn).toMatchObject({ state: "value", rp: 1_100_000 }); // 400.000 + 700.000, not the 200.000 float
    expect(data.sales).toMatchObject({ state: "value", rp: 1_100_000 }); // K23 sales: the three invoices the cashier issued in the shift (no VAT on a non-object product)
    expect(data.unpaid.count).toEqual({ state: "value", n: 0 }); // every invoice is paid in full
    expect(data.shift.state).toBe("open");
    const out = html(props);
    expect(rowOf(out, "cash")).toMatch(/Tunai 2 Rp400\.000 Rp0 Rp400\.000/);
    expect(rowOf(out, "qris")).toMatch(/QRIS 1 Rp700\.000 Rp0 Rp700\.000/);
    expect(text(out)).toMatch(/Uang masuk shift ini Rp1\.100\.000/);
    expect(out).not.toContain("Belum dibayar");
  }, LONG);

  it("a SIMULATED QRIS payment through the real mock port is stored but never counted in the shift, and its invoice still owes; a cash refund paid from the drawer is paid-out: net cash falls and K23 follows", async () => {
    const w = await world();
    const fo = await w.person("fo_cashier", w.b1);
    await w.as(fo, (db) => openShift(db, key(), { openingFloat: 0 }));
    const cash = await sell(w, fo, 3, "cash", await patient(w, w.b1, fo.staffId));
    const sim = await simulatedQris(w, fo, 5);
    const stored = (await hn.admin.query(`select count(*)::int c from payments where invoice_id = $1 and is_simulated and shift_id is null and method = 'qris'`, [sim])).rows[0].c;
    expect(stored).toBe(1); // the simulated payment exists, and the database stamped no shift on it
    const line = (await hn.admin.query(`select id from invoice_lines where invoice_id = $1`, [cash.invoiceId])).rows[0].id as string;
    const r = await w.as(fo, (db) => requestRefund(db, key(), line, { amount: 50_000, destination: "cash", reason: "Barang rusak" }));
    if (r.approval_id) await w.as(w.owner, (db) => decideApproval(db, r.approval_id!, true));
    await w.as(fo, (db) => payRefund(db, key(), r.refund_id, "cash"));
    const { data, props } = await load(w, fo);
    const rows = byMethod(data);
    expect(rows.qris).toBeUndefined(); // no real QRIS in the shift
    expect(rows.cash).toMatchObject({ payments: 1, received: v(300_000), paidOut: v(50_000) });
    expect(net(rows.cash as TenderRow)).toEqual(v(250_000));
    expect(data.moneyIn).toMatchObject({ state: "value", rp: 250_000 }); // = K23 received: 300.000 − 50.000
    expect(data.unpaid.count).toEqual({ state: "value", n: 1 }); // the simulated-only invoice still owes
    expect(data.unpaid.total).toEqual(v(500_000));
    const out = html(props);
    expect(out.indexOf("Belum dibayar")).toBeGreaterThan(-1);
    expect(out.indexOf("Belum dibayar")).toBeLessThan(out.indexOf('id="shift"')); // first, as UX-6 asks
  }, LONG);

  it("patient balance used in the shift is listed apart and is not money in; the reconciliation with K23 still holds", async () => {
    const w = await world();
    const fo = await w.person("fo_cashier", w.b1);
    await w.as(fo, (db) => openShift(db, key(), { openingFloat: 0 }));
    const pid = await patient(w, w.b1, fo.staffId);
    await w.as(fo, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 500_000, cashTendered: 500_000 }));
    await sell(w, fo, 2, "balance", pid);
    const { data, props } = await load(w, fo);
    const rows = byMethod(data);
    expect(rows.balance).toMatchObject({ payments: 1, received: v(200_000) });
    expect(rows.cash).toMatchObject({ payments: 1, received: v(500_000) }); // the top-up is cash received at the counter
    expect(data.moneyIn).toMatchObject({ state: "value", rp: 500_000 }); // not 700.000
    expect(rowOf(html(props), "balance")).toContain("Bukan uang masuk");
  }, LONG);

  it("a shift with no payment is a real Rp0 (a cash row, no other tender); an EDC payment is a tender row and part of money in", async () => {
    const w = await world();
    const fo = await w.person("fo_cashier", w.b1);
    await w.as(fo, (db) => openShift(db, key(), { openingFloat: 150_000 }));
    const empty = await load(w, fo);
    expect(empty.data.tenders).toMatchObject({ state: "value", rows: [{ method: "cash", payments: 0, received: v(0), paidOut: v(0) }] });
    expect(empty.data.moneyIn).toMatchObject({ state: "value", rp: 0 });
    expect(empty.data.sales).toMatchObject({ state: "value", rp: 0 });
    expect(empty.data.unpaid.count).toEqual({ state: "value", n: 0 });
    await sell(w, fo, 1, "edc");
    const paid = await load(w, fo);
    expect(byMethod(paid.data).edc).toMatchObject({ payments: 1, received: v(100_000) });
    expect(paid.data.moneyIn).toMatchObject({ state: "value", rp: 100_000 });
  }, LONG);

  it("an open invoice is the shift reader's open_tagihan: 'Belum dibayar' counts the branch's issued invoices still owing, and not the paid ones", async () => {
    const w = await world();
    const fo = await w.person("fo_cashier", w.b1);
    await w.as(fo, (db) => openShift(db, key(), { openingFloat: 0 }));
    await sell(w, fo, 2, "cash"); // paid
    await bill(w, fo, 1); // owes 100.000
    await bill(w, fo, 3); // owes 300.000
    const { data } = await load(w, fo);
    expect(data.unpaid.count).toEqual({ state: "value", n: 2 });
    expect(data.unpaid.total).toEqual(v(400_000));
  }, LONG);

  it("which shift: an FO/cashier with no open shift sees the empty state; the owner and a manager read the branch's latest open shift and list the others; ?shift= picks one; a manager cannot leave its branch", async () => {
    const w = await world();
    const fo1 = await w.person("fo_cashier", w.b1);
    const fo2 = await w.person("fo_cashier", w.b1);
    const mgr = await w.person("manager", w.b1);
    const none = await open(w, fo1);
    expect(none.kind === "ok" && none.props.state.kind).toBe("empty");
    const { shiftId: s1 } = await w.as(fo1, (db) => openShift(db, key(), { openingFloat: 0 }));
    await w.as(fo2, (db) => openShift(db, key(), { openingFloat: 0 })); // opened later: the branch's latest
    await sell(w, fo1, 1, "cash");
    const latest = await load(w, w.owner, { cabang: w.b1 });
    expect(latest.data.shift.cashier).toBe(fo2.name);
    expect(latest.data.moneyIn).toMatchObject({ state: "value", rp: 0 });
    expect(latest.data.others.map((o) => o.label.split(" · ")[0])).toEqual([fo1.name]);
    expect(latest.data.others[0].href).toBe(`${PATH}?shift=${s1}`);
    const picked = await load(w, w.owner, { shift: s1 });
    expect(picked.data.shift.cashier).toBe(fo1.name);
    expect(picked.data.moneyIn).toMatchObject({ state: "value", rp: 100_000 });
    const m = await load(w, mgr, { cabang: w.b2 }); // another branch through the URL: ignored, the manager's own branch
    expect(m.r.branchId).toBe(w.b1);
    expect(m.r.branches).toEqual([{ id: w.b1, name: "Cabang A" }]);
    const elsewhere = await open(w, w.owner, { cabang: w.b2 }); // the owner may pick a branch; nothing is open there
    expect(elsewhere.kind === "ok" && [elsewhere.props.branch, elsewhere.props.state.kind]).toEqual(["Cabang B", "empty"]);
  }, LONG);

  it("'Tidak datang' counts the no_show appointments of the branch's day, 'Pasien datang' the visits checked in today, 'Kunjungan belum ditutup' the open ones — on the real readers, scoped to the branch", async () => {
    const w = await world();
    const fo = await w.person("fo_cashier", w.b1);
    await w.as(fo, (db) => openShift(db, key(), { openingFloat: 0 }));
    const svc = (await hn.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`, [w.t, `RSV-${++seq}`, w.owner.staffId])).rows[0].id as string;
    const ver = (await hn.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
      values ($1, $2, 1, 'active', 'Layanan Ringkasan Shift', 'exempt_medical', 'Jasa medis', 500000, 'Layanan baru', $3, 'owner') returning id`, [w.t, svc, w.owner.staffId])).rows[0].id as string;
    const p1 = await patient(w, w.b1, fo.staffId);
    const p2 = await patient(w, w.b1, fo.staffId);
    const p3 = await patient(w, w.b2, fo.staffId);
    const ymd = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10); // the branch's calendar date (Asia/Jakarta, UTC+7)
    await hn.admin.query("alter table appointments disable trigger appointments_guard");
    try {
      for (const [p, branch, state] of [[p1, w.b1, "no_show"], [p2, w.b1, "no_show"], [p1, w.b1, "booked"], [p3, w.b2, "no_show"]] as const) {
        await hn.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as, state_changed_at, state_changed_by)
          values ($1, $2, $3, $4, $5, $6, $7, $8, 'phone', $5, 'fo_cashier', case when $8 = 'no_show' then now() end, case when $8 = 'no_show' then $5::uuid end)`,
          [w.t, branch, p, ver, w.owner.staffId, `${ymd} 09:00+07`, `${ymd} 09:30+07`, state]);
      }
    } finally {
      await hn.admin.query("alter table appointments enable always trigger appointments_guard");
    }
    const checkIn = async (patientId: string, branch: string) => (await hn.admin.query(
      `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [w.t, branch, patientId, fo.staffId])).rows[0].id as string;
    await checkIn(p1, w.b1); // open
    const done = await checkIn(p2, w.b1);
    await w.as(fo, (db) => closeVisit(db, key(), done)); // closed through the real writer: still today's arrival, no longer open
    await checkIn(p3, w.b2); // another branch: never counted here
    const { data } = await load(w, fo);
    expect(data.noShows.count).toEqual({ state: "value", n: 2 }); // branch A's two; B's no_show and A's booked one are not counted
    expect(data.arrivals.count).toEqual({ state: "value", n: 2 }); // one open and one closed today, at A
    expect(data.openVisits.count).toEqual({ state: "value", n: 1 });
  }, LONG);

  it("a closed shift is read from its frozen count and still reconciles with K23; another branch's manager gets not-found for this shift by id", async () => {
    const w = await world();
    const fo = await w.person("fo_cashier", w.b1);
    const mgrB = await w.person("manager", w.b2);
    const { shiftId } = await w.as(fo, (db) => openShift(db, key(), { openingFloat: 0 }));
    expect((await open(w, mgrB, { shift: shiftId })).kind).toBe("not-found"); // kasir_reader: a branch manager reads its own branch only
    await sell(w, fo, 1, "cash");
    await w.as(fo, (db) => submitShiftCount(db, key(), shiftId, { countedCash: 100_000 })); // exact count: closes at once
    const closed = await load(w, w.owner, { shift: shiftId });
    expect(closed.data.shift.state).toBe("closed");
    expect(byMethod(closed.data).cash).toMatchObject({ payments: 1, received: v(100_000) });
    expect(closed.data.moneyIn).toMatchObject({ state: "value", rp: 100_000 });
    expect(closed.data.others).toEqual([]);
  }, LONG);

  it("CROSS-TENANT: tenant A's owner and manager cannot read tenant B's shift by id (not-found), cannot reach B's branch through ?cabang=, and nothing of B appears in anything A receives; B's own owner reads it (positive control)", async () => {
    const a = await world();
    const b = await world();
    const foB = await b.person("fo_cashier", b.b1);
    const { shiftId } = await b.as(foB, (db) => openShift(db, key(), { openingFloat: 0 }));
    await sell(b, foB, 7, "cash"); // 700.000, B's own money
    const mgrA = await a.person("manager", a.b1);
    const secrets = [shiftId, b.b1, b.b2, foB.name, b.t];
    for (const who of [a.owner, mgrA]) {
      expect((await open(a, who, { shift: shiftId })).kind).toBe("not-found");
      const viaBranch = await open(a, who, { cabang: b.b1 }); // B's branch is not in A's list: it falls back to A's own branch and asks no reader about B
      const seen = JSON.stringify(viaBranch);
      for (const x of secrets) expect(seen).not.toContain(x);
      expect(viaBranch.kind === "ok" && viaBranch.branchId).toBe(a.b1);
    }
    const own = await load(b, b.owner, { shift: shiftId });
    expect(own.data.moneyIn).toMatchObject({ state: "value", rp: 700_000 });
    expect(own.data.shift.cashier).toBe(foB.name);
  }, LONG);
});
