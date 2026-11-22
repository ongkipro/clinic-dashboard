// PR-33a (T-109) — Ringkasan Owner (UX-20) and Cabang league / detail (UX-37), presentational slice.
// Synthetic props only: no database, no T-107 reader yet (live wiring and the reader-backed scenario run land after
// T-107 integrates). These assertions pin what the view owns: per-branch figures shown exactly as attributed by the
// reader (K3 at the selling branch, K2 at the executing branch), unavailable ≠ Rp0, deltas against the tenant's own
// previous period only, league ordering, one state per screen, drill-down links from caller props, and no clinical text.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createLead } from "../../src/modules/crm/leads/leads";
import { publish } from "../../src/modules/catalog/catalog";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { topUpBalance } from "../../src/modules/packages/packages";
import { walkIn } from "../../src/modules/visits/queue/queue";
import { closeVisit, today as visitsToday } from "../../src/modules/visits/visits";
import { kpi } from "../../src/modules/reporting/dashboards/dashboards";
import { createHarness, type Harness, testPool } from "../rls/harness";
import {
  type Amount, delta, K9_WINDOWS, LEAGUE_KEYS, LEAGUE_LABEL, type LeagueKey, type LeagueRow, openAttention, type OwnerSummaryData, type Period, rate, rp, sortLeague, TREND_H, trendDomain, trendFinding, trendY,
} from "../../src/app/(app)/ringkasan/owner/model";
import { BranchDetail, BranchLeague, OwnerSummary } from "../../src/app/(app)/ringkasan/owner/view";
import { type Dims, k17ForBranch, k17Owed, k4Card, type KpiPayload, sumK17, UNBRANCHED } from "../../src/app/(app)/ringkasan/owner/consume";
import * as C from "../../src/app/(app)/ringkasan/owner/compose";
import { UUID as UUID_RE, READS, detailIn, leagueIn, summaryIn } from "../../src/app/(app)/ringkasan/owner/load";
import { reportIn, readersOf } from "../../src/app/(app)/laporan/_components/load";
import { REPORTS } from "../../src/modules/reporting/reports/dictionary";
import { existsSync } from "node:fs";
import { CommandError } from "../../src/lib/command";
import { addDays, daysBetween, monday, periods, weekLabel, WEEKS } from "../../src/app/(app)/ringkasan/owner/period";

const v = (rp: number): Amount => ({ state: "value", rp });
const na = (reason = "Pembacaan belum tersedia"): Amount => ({ state: "unavailable", reason });
const period: Period = { label: "Minggu ini", basis: "Tanggal bayar, WIB", previousLabel: "minggu lalu" };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function summary(over: Partial<OwnerSummaryData> = {}): OwnerSummaryData {
  return {
    attention: [{ key: "persetujuan", count: 3, href: "/persetujuan" }, { key: "satusehat", count: 0, href: "/satusehat" }],
    k1: { amount: v(18_400_000), previous: v(16_000_000), href: "/keuangan?kpi=k1" },
    k2: { amount: v(15_100_000), previous: v(15_100_000), href: "/keuangan?kpi=k2" },
    k3: { amount: v(20_000_000), previous: v(0), href: "/keuangan?kpi=k3" },
    k4: { amount: v(2_000_000), href: "/keuangan/kewajiban#piutang", aging: { d0_30: v(1_000_000), d31_60: v(500_000), d61_90: v(0), d90: v(500_000) } },
    k5: { amount: v(92_000_000), href: "/keuangan/kewajiban", packageExpiry30: v(6_000_000) },
    k6: { amount: v(0), href: "/keuangan?kpi=k6" },
    k17: { amount: v(4_200_000), href: "/komisi" },
    k18: { belowMin: 2, expiring30: 1, countVariance: 0, href: "/stok?filter=risiko" },
    trend: [{ label: "M1", k1: v(10), k2: v(8) }, { label: "M2", k1: v(5), k2: v(9) }, { label: "M3", k1: v(12), k2: v(7) }],
    mix: { state: "rows", rows: [{ category: "Facial", k2: v(9_000_000), k7: { amount: v(4_000_000), note: "estimasi" }, href: "/laporan?kategori=facial" }] },
    funnel: { state: "value", lead: 40, booked: 20, arrived: 15, paid: 12, sources: { state: "rows", rows: [{ source: "instagram", label: "Instagram", lead: 25, booked: 12, arrived: 9, paid: 8 }, { source: "ads", label: "Iklan", lead: 15, booked: 8, arrived: 6, paid: 4 }] }, href: "/lead" },
    ...over,
  };
}

function row(id: string, name: string, over: Partial<LeagueRow> = {}): LeagueRow {
  const r = { state: "value" as const, num: 1, den: 2 };
  return {
    branchId: id, name, href: `/ringkasan/owner/cabang/${id}`, k1: v(0), k2: v(0), k7: { amount: v(0) }, k8: r, k9: r, k9Detail: { state: "value", windows: { 30: { count: r, value: r }, 60: { count: r, value: r }, 90: { count: r, value: r } } },
    k10: { state: "value", newPatients: 1, returning: 1 }, k11: r, k12: r, k16: r, k17: v(0), ...over,
  };
}

describe("Scenario PR-33a K2 at executing branch (view shows reader attribution per branch)", () => {
  // Package sold at A (K3 at the selling branch); its session counted at B (K2 at the executing branch).
  const a = summary({ k3: { amount: v(5_000_000), previous: v(0), href: "/a/k3" }, k2: { amount: v(0), previous: v(0), href: "/a/k2" } });
  const b = summary({ k3: { amount: v(0), previous: v(0), href: "/b/k3" }, k2: { amount: v(500_000), previous: v(0), href: "/b/k2" } });
  const card = (out: string, id: string) => text(out.slice(out.indexOf(`id="kpi-${id}"`), out.indexOf("</section>", out.indexOf(`id="kpi-${id}"`))));

  it("branch A detail shows sales (K3) and no completed service; branch B the reverse", () => {
    const outA = html(h(BranchDetail, { branch: "Cabang A", backHref: "/ringkasan/owner/cabang", period, state: { kind: "ready", data: a } }));
    const outB = html(h(BranchDetail, { branch: "Cabang B", backHref: "/ringkasan/owner/cabang", period, state: { kind: "ready", data: b } }));
    expect(card(outA, "k3")).toContain("Rp5.000.000");
    expect(card(outA, "k2")).toContain("Rp0");
    expect(card(outB, "k2")).toContain("Rp500.000");
    expect(card(outB, "k3")).toContain("Rp0");
    expect(card(outA, "k3")).toContain("Cabang penjual");
    expect(card(outB, "k2")).toContain("Cabang pelaksana");
  });

  it("the league ranks B above A by K2 and A above B by K1 exactly as supplied", () => {
    const rows = [row("a", "Cabang A", { k1: v(5_000_000), k2: v(0) }), row("b", "Cabang B", { k1: v(0), k2: v(500_000) })];
    expect(sortLeague(rows, "k2").map((r) => r.name)).toEqual(["Cabang B", "Cabang A"]);
    expect(sortLeague(rows, "k1").map((r) => r.name)).toEqual(["Cabang A", "Cabang B"]);
  });
});

describe("unavailable is distinct from Rp0", () => {
  it("an unavailable K1 reads 'Belum tersedia' with its reason; a real 0 reads Rp0", () => {
    const out = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/ringkasan/owner/cabang",
      state: { kind: "ready", data: summary({ k1: { amount: na("Riwayat sebelum cutover belum lengkap"), previous: v(1), href: "/k1" } }) } }));
    const k1 = text(out.slice(out.indexOf('id="kpi-k1"'), out.indexOf("</section>", out.indexOf('id="kpi-k1"'))));
    expect(k1).toContain("Belum tersedia");
    expect(k1).toContain("Riwayat sebelum cutover belum lengkap");
    expect(k1).not.toContain("Rp0");
    expect(k1).toContain("Pembanding minggu lalu belum tersedia"); // no delta against an unknown value
    const k6 = text(out.slice(out.indexOf('id="kpi-k6"'), out.indexOf("</section>", out.indexOf('id="kpi-k6"'))));
    expect(k6).toContain("Rp0");
    expect(k6).not.toContain("Belum tersedia");
  });

  it("a ratio with a zero denominator is unavailable, not 0%", () => {
    expect(rate({ state: "value", num: 0, den: 0 })).toBe("Belum tersedia");
    expect(rate({ state: "value", num: 0, den: 4 })).toBe("0%");
    expect(rate({ state: "value", num: 1, den: 3 })).toBe("33,3%");
  });

  it("unavailable league values sort last whatever the direction", () => {
    const rows = [row("x", "X", { k1: na() }), row("y", "Y", { k1: v(1) }), row("z", "Z", { k12: { state: "unavailable", reason: "r" } })];
    expect(sortLeague(rows, "k1").at(-1)?.name).toBe("X");
    expect(sortLeague(rows, "k12").at(-1)?.name).toBe("Z");
  });
});

describe("deltas compare with the tenant's own previous period only (D-11)", () => {
  it("states direction in words and percent; no percent against Rp0; none when unknown", () => {
    expect(delta(v(18_400_000), v(16_000_000), "minggu lalu")).toEqual({ direction: "naik", text: "Naik 15% dibanding minggu lalu" });
    expect(delta(v(5), v(10), "minggu lalu")).toEqual({ direction: "turun", text: "Turun 50% dibanding minggu lalu" });
    expect(delta(v(7), v(7), "minggu lalu")).toEqual({ direction: "tetap", text: "Tetap dibanding minggu lalu" });
    expect(delta(v(7), v(0), "minggu lalu")).toEqual({ direction: "naik", text: "Naik dari Rp0 minggu lalu" });
    expect(delta(na(), v(1), "minggu lalu")).toBeNull();
    expect(delta(v(1), na(), "minggu lalu")).toBeNull();
  });
  it("the rendered summary never mentions an external benchmark", () => {
    const out = text(html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c", state: { kind: "ready", data: summary() } })));
    expect(out).toMatch(/Naik 15% dibanding minggu lalu/);
    expect(out).not.toMatch(/industri|benchmark|rata-rata klinik/i);
  });
});

describe("UX-20 sections and drill-down", () => {
  const out = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/ringkasan/owner/cabang",
    league: [row("a", "Cabang A", { k1: v(1) }), row("b", "Cabang B", { k1: v(2) })], state: { kind: "ready", data: summary() } }));

  it("Perlu ditangani lists only non-zero items and is hidden when all are zero", () => {
    expect(openAttention(summary().attention).map((a) => a.key)).toEqual(["persetujuan"]);
    expect(text(out)).toContain("3 persetujuan menunggu");
    expect(text(out)).not.toContain("SATUSEHAT gagal");
    const none = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c",
      state: { kind: "ready", data: summary({ attention: [{ key: "persetujuan", count: 0, href: "/p" }] }) } }));
    expect(none).not.toContain("Perlu ditangani");
  });

  it("every KPI links to the caller's drill-down target", () => {
    for (const href of ["/persetujuan", "/keuangan?kpi=k1", "/keuangan?kpi=k2", "/keuangan?kpi=k3", "/keuangan/kewajiban#piutang", "/keuangan/kewajiban",
      "/keuangan?kpi=k6", "/komisi", "/stok?filter=risiko", "/laporan?kategori=facial", "/lead", "/ringkasan/owner/cabang", "/ringkasan/owner/cabang/a"]) {
      expect(out).toContain(`href="${href.replace(/&/g, "&amp;")}"`);
    }
  });

  it("shows K5 package-expiry slice, K4 aging, K7 provenance, K13 funnel and a finding-titled trend with a data table", () => {
    const t = text(out);
    expect(t).toContain("Paket kedaluwarsa ≤ 30 hari: Rp6.000.000");
    expect(t).toContain("Lebih dari 90 hari");
    expect(t).toContain("Kontribusi (K7): Rp4.000.000 · Estimasi");
    expect(t).toMatch(/Lead 40 Booking 20 Datang 15 Bayar 12/);
    expect(t).toContain("Uang masuk melebihi layanan selesai di 2 dari 3 minggu");
    expect(out).toContain("Tabel data");
    // the data table of the trend reflows by container width: the table from 24 em, one block per week below it (never a two-dimensional scroll)
    expect(out).toContain("@min-[24em]:table");
    expect(out).toContain("@min-[24em]:hidden");
    expect(out).toContain('stroke-dasharray="6 4"'); // series differ by stroke, not colour alone
  });

  it("the trend finding counts only weeks where both series are known", () => {
    expect(trendFinding([{ label: "a", k1: na(), k2: v(1) }])).toBe("Uang masuk dan layanan selesai belum tersedia");
    expect(trendFinding([{ label: "a", k1: v(2), k2: v(1) }, { label: "b", k1: na(), k2: v(1) }])).toBe("Uang masuk melebihi layanan selesai di semua 1 minggu");
  });

  it("compact layout stacks one column; regular adds columns at 700 and 1180 px", () => {
    expect(out).toContain("grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2 min-[1180px]:grid-cols-3");
  });
});

describe("UX-37 Cabang league and detail", () => {
  const rows = [row("a", "Cabang A", { k12: { state: "value", num: 1, den: 10 } }), row("b", "Cabang B", { k12: { state: "value", num: 3, den: 10 } })];
  const sortHrefs = Object.fromEntries(LEAGUE_KEYS.map((k) => [k, `/ringkasan/owner/cabang?urut=${k}`])) as Record<LeagueKey, string>;

  it("offers a sort for every PR-33a branch KPI and marks the active one", () => {
    const out = html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort: "k12", sortHrefs, state: { kind: "ready", data: rows } }));
    expect(LEAGUE_KEYS).toEqual(["k1", "k2", "k7", "k8", "k9", "k10", "k11", "k12", "k16", "k17"]);
    for (const k of LEAGUE_KEYS) expect(out).toContain(`href="/ringkasan/owner/cabang?urut=${k}"`);
    expect(out).toMatch(/aria-current="true"[^>]*>Tidak datang \/ batal &lt; 24 jam \(K12\)/);
    // one card per branch at every width: ten KPI columns never fit a row (WCAG 1.4.10), so no table, no scroll region, and the columns follow the container's text size
    expect(out).not.toContain("<table");
    expect(out).not.toContain("overflow-x-auto");
    expect(out).toContain("@min-[40em]:grid-cols-2");
    expect(out).toContain('aria-label="Liga cabang, urut menurut Tidak datang / batal &lt; 24 jam (K12)"');
    // lower no-show rate ranks first
    expect(out.indexOf("Cabang A")).toBeLessThan(out.indexOf("Cabang B"));
  });

  it("branch detail reuses the UX-20 cards without the league", () => {
    const out = html(h(BranchDetail, { branch: "Cabang A", backHref: "/ringkasan/owner/cabang", period, state: { kind: "ready", data: summary() } }));
    expect(out).toContain('id="kpi-k1"');
    expect(out).toContain('id="kpi-k18"');
    expect(out).not.toContain('id="liga"');
    expect(out).toContain('href="/ringkasan/owner/cabang"');
  });

  it("no branches → first-run empty copy", () => {
    const out = text(html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort: "k1", sortHrefs, state: { kind: "ready", data: [] } })));
    expect(out).toContain("Belum ada cabang aktif.");
  });
});

describe("one state per screen (10 State Copy Patterns)", () => {
  const scope = { label: "Semua Cabang", filtered: true };
  const cases = [
    [{ kind: "loading" }, 'aria-busy="true"'],
    [{ kind: "empty", message: "Belum ada transaksi pada periode ini." }, "Belum ada transaksi pada periode ini."],
    [{ kind: "filtered-empty", message: "Tidak ada data untuk filter ini.", clearHref: "/ringkasan/owner" }, "Hapus Filter"],
    [{ kind: "error", message: "Koneksi terputus.", retryHref: "/ringkasan/owner" }, "Coba Lagi"],
    [{ kind: "blocked", reason: "Periode belum ditutup", unblock: "Finance dapat menutup periode" }, "Periode belum ditutup."],
    [{ kind: "permission", object: "ringkasan owner" }, "Anda tidak memiliki akses ke ringkasan owner."],
  ] as const;
  it.each(cases)("%o renders its copy and no KPI", (state, copy) => {
    for (const out of [
      html(h(OwnerSummary, { scope, period, leagueHref: "/c", state })),
      html(h(BranchLeague, { scope, period, sort: "k1", sortHrefs: {} as Record<LeagueKey, string>, state })),
      html(h(BranchDetail, { branch: "Cabang A", backHref: "/c", period, state })),
    ]) {
      expect(out).toContain(copy);
      expect(out).not.toContain('data-kpi="');
    }
  });
  it("loading is a skeleton with no text", () => {
    const out = html(h(OwnerSummary, { scope, period, leagueHref: "/c", state: { kind: "loading" } }));
    const body = out.slice(out.indexOf("</h1>"));
    expect(text(body).trim()).toBe("");
  });
});

describe("no clinical content and safe text", () => {
  it("renders no clinical vocabulary and escapes branch and category names", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const data = summary({ mix: { state: "rows", rows: [{ category: hostile, k2: v(1), k7: { amount: v(1) }, href: "/m" }] } });
    const out = html(h(OwnerSummary, { scope: { label: hostile, filtered: false }, period, leagueHref: "/c", league: [row("h", hostile, { k1: v(1) })], state: { kind: "ready", data } }));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(text(out)).not.toMatch(/diagnos|keluhan pasien|alergi|resep|anamnesis|rekam medis|tindakan pasien/i);
  });

  it("the props carry no patient fields (type-level guard)", () => {
    // @ts-expect-error — a league row has no patient field
    const bad: LeagueRow = { ...row("a", "A"), patientName: "x" };
    expect(bad).toBeTruthy();
  });
});

// ── The T-107 read contract, consumed (r3 notice t107/R3-CONTRACT-CHANGE.md + Sol's refinement) ──────────────────────────────────────
// Pure fixtures shaped like `dashboard_kpi` answers; no reader, no database. The numbers are the notice's own worked example.
describe("K17 Komisi terutang = accrued + adjusted + signed paid_net, each part once", () => {
  // Three nurse entitlements: Aug 100.000 in a batch paid 2026-08-30 (net 100.000); Sep 80.000 in an approved batch; Oct 50.000 with a −10.000
  // adjustment. Owed at the end of October = 100.000 + 80.000 + 50.000 − 10.000 − 100.000 = 120.000.
  const october: KpiPayload = { total: 120_000, by_dim: { accrued: 230_000, adjusted: -10_000, paid_net: -100_000 }, by_branch: { b1: { accrued: 230_000, adjusted: -10_000 }, [UNBRANCHED]: { paid_net: -100_000 } } };

  it("the parts sum to the reader's total; the negative paid_net is neither dropped nor subtracted twice", () => {
    expect(sumK17(october.by_dim)).toBe(120_000);
    expect(k17Owed(october)).toEqual({ state: "value", rp: 120_000 });
    expect(sumK17({ accrued: 230_000, adjusted: -10_000 })).toBe(220_000); // a dropped paid_net would overstate owed by exactly the payment
    expect(sumK17({ accrued: 230_000, adjusted: -10_000, paid_net: -100_000 })).not.toBe(20_000); // abs()/double subtraction would understate it
  });

  it("the reader's total wins when supplied (the parts are not added on top of it); the parts are used only when it is absent", () => {
    expect(k17Owed({ total: 120_000, by_dim: { accrued: 230_000, adjusted: -10_000, paid_net: -100_000 } })).toEqual({ state: "value", rp: 120_000 });
    expect(k17Owed({ total: 7, by_dim: { accrued: 230_000, adjusted: -10_000, paid_net: -100_000 } })).toEqual({ state: "value", rp: 7 });
    expect(k17Owed({ total: null, by_dim: { accrued: 230_000, adjusted: -10_000, paid_net: -100_000 } })).toEqual({ state: "value", rp: 120_000 });
  });

  it("if the August batch is paid on 2026-11-02 the October report shows 220.000 (no paid_net yet): history does not change retroactively", () => {
    const later: KpiPayload = { total: 220_000, by_dim: { accrued: 230_000, adjusted: -10_000 } };
    expect(k17Owed(later)).toEqual({ state: "value", rp: 220_000 });
    expect(sumK17(later.by_dim)).toBe(220_000);
  });

  it("no rows is a real Rp0 (reader answered), not a missing figure", () => {
    expect(k17Owed({ total: null, by_dim: {} })).toEqual({ state: "value", rp: 0 });
  });

  it("gross 'paid' and the workflow states are another contract: refused, never summed (that would count the payment twice)", () => {
    const foreign: Dims[] = [{ accrued: 1, paid: 100_000, paid_net: -100_000 }, { accrued: 1, approved: 80_000 }, { accrued: 1, pending_approval: 5 }];
    for (const d of foreign) {
      expect(sumK17(d)).toBeNull();
      expect(k17Owed({ total: null, by_dim: d })).toMatchObject({ state: "unavailable" });
    }
    expect(sumK17({ accrued: 1, paid_net: 100_000 })).toBeNull(); // a positive 'payment' would be extra debt
    expect(sumK17({ accrued: 1.5 })).toBeNull(); // rupiah are integers
  });

  it("extra.current_workflow is the batches' state NOW, never history: it changes nothing", () => {
    const withWorkflow: KpiPayload = { ...october, extra: { current_workflow: { as_of: "2026-11-20T00:00:00Z", accrued: 999, pending_approval: 999, approved: 999, paid: 999 } } };
    expect(k17Owed(withWorkflow)).toEqual(k17Owed(october));
    expect(k17ForBranch(withWorkflow, "b1")).toEqual(k17ForBranch(october, "b1"));
  });

  it("per branch: a payment is per staff, not per branch — while one sits outside every branch the branch's owed is unavailable, never spread or omitted", () => {
    // b1 alone shows 220.000 gross-of-payment; presenting it as owed would overstate by the payment, subtracting it from b1 would assume it was b1's
    expect(k17ForBranch(october, "b1")).toMatchObject({ state: "unavailable" });
    expect(k17ForBranch(october, "b2")).toMatchObject({ state: "unavailable" });
    expect(k17ForBranch({ total: 220_000, by_dim: { accrued: 230_000, adjusted: -10_000 }, by_branch: { b1: { accrued: 230_000, adjusted: -10_000 } } }, "b1")).toEqual({ state: "value", rp: 220_000 });
    expect(k17ForBranch({ total: 0, by_dim: {}, by_branch: {} }, "b1")).toEqual({ state: "value", rp: 0 }); // a branch with no rows owes nothing
    expect(k17ForBranch({ total: 1, by_dim: {} }, "b1")).toMatchObject({ state: "unavailable" }); // no by_branch = cannot attribute
  });

  it("the league cell and the Ringkasan card read the owed Amount: unavailable shows 'Belum tersedia' with its reason, never Rp0", () => {
    const sortHrefs = Object.fromEntries(LEAGUE_KEYS.map((k) => [k, `/ringkasan/owner/cabang?urut=${k}`])) as Record<LeagueKey, string>;
    const out = html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort: "k17", sortHrefs,
      state: { kind: "ready", data: [row("b1", "Cabang 1", { k17: k17ForBranch(october, "b1") })] } }));
    // the sorted KPI (K17) is the card's one big value, right after its label: "Belum tersedia", never Rp; the K1/K2/K7 zeros listed below it come from the fixture row and are real figures
    const k17Cell = text(out.match(/<p class="tabular m-0 text-\[1\.3rem\][^"]*">(.*?)<\/p>/)?.[1] ?? "").trim();
    expect(k17Cell).toBe("Belum tersedia");
    const card = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c",
      state: { kind: "ready", data: summary({ k17: { amount: k17Owed(october), href: "/komisi" } }) } }));
    expect(card.slice(card.indexOf('id="kpi-k17"'))).toContain("Rp120.000");
  });
});

describe("K4 Piutang: incomplete when a cancellation cannot be dated (extra.undated_cancellations)", () => {
  const aging = { "0-30": 1_000_000, "31-60": 500_000, ">90": 500_000 };
  const complete: KpiPayload = { total: 2_000_000, by_dim: aging, extra: { undated_cancellations: 0, complete: true } };

  it("a complete answer shows the balance and every bucket; a bucket without rows is a real Rp0", () => {
    const c = k4Card(complete);
    expect(c.amount).toEqual({ state: "value", rp: 2_000_000 });
    expect(c.aging).toEqual({ d0_30: { state: "value", rp: 1_000_000 }, d31_60: { state: "value", rp: 500_000 }, d61_90: { state: "value", rp: 0 }, d90: { state: "value", rp: 500_000 } });
  });

  it("undated_cancellations > 0: the balance AND all four buckets are unavailable together (no partial figure), with the reason", () => {
    for (const p of [{ total: null, by_dim: {}, extra: { undated_cancellations: 2, complete: false } }, { ...complete, extra: { undated_cancellations: 1 } }, { ...complete, extra: { undated_cancellations: 0, complete: false } }] as KpiPayload[]) {
      const c = k4Card(p);
      for (const a of [c.amount, c.aging.d0_30, c.aging.d31_60, c.aging.d61_90, c.aging.d90]) {
        expect(a).toMatchObject({ state: "unavailable" });
        expect((a as { reason: string }).reason).toMatch(/belum (lengkap|dapat dipastikan)/);
      }
    }
  });

  it("missing or malformed evidence proves nothing: unavailable (the r2 reader has no count, so K4 reads 'Belum tersedia' until r3 lands)", () => {
    for (const extra of [undefined, null, {}, { undated_cancellations: "0" }, { undated_cancellations: -1 }, { undated_cancellations: 0.5 }, { undated_cancellations: null }]) {
      expect(k4Card({ total: 2_000_000, by_dim: aging, extra: extra as never }).amount).toMatchObject({ state: "unavailable" });
    }
  });

  it("an unknown aging bucket or a non-integer amount is unavailable, never summed", () => {
    expect(k4Card({ total: 1, by_dim: { "0-30": 1, late: 5 }, extra: { undated_cancellations: 0 } }).amount).toMatchObject({ state: "unavailable" });
    expect(k4Card({ total: 1, by_dim: { "0-30": 0.5 }, extra: { undated_cancellations: 0 } }).aging.d0_30).toMatchObject({ state: "unavailable" });
  });

  it("the unavailable state is what the owner sees on the card: 'Belum tersedia' + reason, aging all 'Belum tersedia', never Rp0", () => {
    const c = k4Card({ total: null, by_dim: {}, extra: { undated_cancellations: 3, complete: false } });
    const out = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c",
      state: { kind: "ready", data: summary({ k4: { ...c, href: "/keuangan/kewajiban#piutang" } }) } }));
    const card = out.slice(out.indexOf('id="kpi-k4"'), out.indexOf("</section>", out.indexOf('id="kpi-k4"')));
    expect((card.match(/Belum tersedia/g) ?? []).length).toBe(5); // balance + 4 buckets
    expect(text(card)).toContain("belum lengkap");
    expect(card).not.toContain("Rp0");
  });
});

// ── Wiring: composition of the reader answers (compose.ts) and the report periods (period.ts) ─────────────────────────────────────────────
const kp = (total: number | null, by_dim: Dims = {}, by_branch: Record<string, Dims> = {}, extra: Record<string, unknown> | null = null): KpiPayload => ({ total, by_dim, by_branch, extra });

describe("periods: own previous period over the same elapsed days (D-11), calendar-date arithmetic only", () => {
  it("week to date vs last week to the same weekday; month to date vs last month to the same day, capped at its last day", () => {
    const w = periods("minggu", "2026-11-19"); // a Thursday
    expect([w.cur, w.prev]).toEqual([{ from: "2026-11-16", to: "2026-11-19" }, { from: "2026-11-09", to: "2026-11-12" }]);
    const m = periods("bulan", "2026-03-31");
    expect(m.cur).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(m.prev).toEqual({ from: "2026-02-01", to: "2026-02-28" }); // 31 March against a 28-day February is capped, not rolled into March
    expect(periods("bulan", "2026-01-15").prev).toEqual({ from: "2025-12-01", to: "2025-12-15" });
  });
  it("the trend is the 8 calendar weeks ending today, oldest first, the last one cut at today", () => {
    const p = periods("minggu", "2026-11-19");
    expect(p.weeks).toHaveLength(WEEKS);
    expect(p.weeks[0].from).toBe("2026-09-28");
    expect(p.weeks[WEEKS - 1]).toEqual({ from: "2026-11-16", to: "2026-11-19" });
    for (const x of p.weeks.slice(0, -1)) expect(daysBetween(x.from, x.to)).toBe(6);
    for (let i = 1; i < WEEKS; i++) expect(p.weeks[i].from).toBe(addDays(p.weeks[i - 1].from, 7));
    expect(monday("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the week that started on Monday
    expect(weekLabel({ from: "2026-11-16", to: "2026-11-19" })).toMatch(/16 Nov.*19 Nov/);
  });
});

describe("compose: a figure no reader can prove is 'Belum tersedia' with a reason, never Rp0 (Sol decisions 1–5)", () => {
  const A = "branch-a", B = "branch-b";

  it("flow KPIs: no row is a real Rp0; a failed reader (null) is unavailable; the branch view reads that branch only", () => {
    expect(C.flow(kp(null))).toEqual({ state: "value", rp: 0 });
    expect(C.flow(null)).toMatchObject({ state: "unavailable" });
    expect(C.flow(kp(5_272_000, { cash: 5_272_000 }, { [A]: { cash: 5_272_000 } }))).toEqual({ state: "value", rp: 5_272_000 });
    expect(C.flowAt(kp(3_205_000, {}, { [A]: { cash: 3_705_000, cash_refund: -500_000 }, [B]: { qris: 0 } }), A)).toEqual({ state: "value", rp: 3_205_000 });
    expect(C.flowAt(kp(1, {}, { [A]: { x: 1 } }), B)).toEqual({ state: "value", rp: 0 }); // no row at B in the period
    expect(C.flowAt(null, A)).toMatchObject({ state: "unavailable" });
  });

  it("K9: selected ÷ recommended, count AND value, with explicit 30 / 60 / 90 windows; zero denominator is unavailable as a ratio", () => {
    const p = kp(null, {}, { [A]: { recommended_count: 3, recommended_value: 2_566_000, selected_30_count: 1, selected_30_value: 1_500_000, selected_60_count: 2, selected_60_value: 2_166_000, selected_90_count: 2, selected_90_value: 2_166_000 } });
    const w = C.k9(p, A)!.windows;
    expect(w[30]).toEqual({ count: { state: "value", num: 1, den: 3 }, value: { state: "value", num: 1_500_000, den: 2_566_000 } });
    expect(w[60].count).toEqual({ state: "value", num: 2, den: 3 });
    expect(w[90].value).toEqual({ state: "value", num: 2_166_000, den: 2_566_000 });
    expect(C.k9League(p, A)).toEqual({ state: "value", num: 1, den: 3 }); // the league cell is the 30-day count, never an unlabeled mix of windows
    expect(rate(C.k9League(kp(null, {}, { [B]: {} }), B))).toBe("Belum tersedia"); // 0 recommended → no rate
    expect(C.k9(null, A)).toBeNull();
  });

  it("K10: first-in-tenant and repeat visits stay two labelled counts at the visit branch; K8 / K11 / K12 / K16 are ratios of the reader's own dims", () => {
    expect(C.k10(kp(null, {}, { [A]: { new: 4, returning: 2 } }), A)).toEqual({ state: "value", newPatients: 4, returning: 2 });
    expect(C.k10(null, A)).toMatchObject({ state: "unavailable" });
    expect(C.k8(kp(null, {}, { [A]: { consultation: 2, purchase: 1 } }), A)).toEqual({ state: "value", num: 1, den: 2 });
    expect(C.k11(kp(null, {}, { [A]: { new: 4, second_visit: 1 } }), A)).toEqual({ state: "value", num: 1, den: 4 });
    expect(C.k12(kp(null, {}, { [A]: { booked: 6, no_show: 1, late_cancel: 1 } }), A)).toEqual({ state: "value", num: 2, den: 6 });
    expect(C.k16(kp(null, {}, { [A]: { treatment_visit: 4, with_product: 2 } }), A)).toEqual({ state: "value", num: 2, den: 4 });
    expect(rate(C.k12(kp(null, {}, {}), A))).toBe("Belum tersedia");
  });

  it("K7: money parts sum; estimasi / uncosted are flags (counts), never money; no 'bahan belum dicatat' (the reader has no such flag)", () => {
    const d = { treatment: 1_000_000, material_cost: -30_000, performer_commission: -100_000, estimasi: 1, uncosted: 0 };
    expect(C.k7(kp(null, {}, { [A]: d }), A)).toEqual({ amount: { state: "value", rp: 870_000 }, note: "estimasi" });
    expect(C.k7(kp(null, {}, { [A]: { ...d, uncosted: 2 } }), A).note).toBe("biaya_belum_lengkap");
    expect(C.k7(kp(null, {}, { [A]: { treatment: 5, material_cost: 0.5 } }), A).amount).toMatchObject({ state: "unavailable" });
    expect(C.k7(null, A).amount).toMatchObject({ state: "unavailable" });
  });

  it("K5: the four prepaid ledgers; a movement inside an unmatched pre-cutover residue makes it incomplete (no total), the expiry slice follows", () => {
    const ok = kp(3_900_000, { package_liability: 2_700_000, patient_balance: 1_000_000, booking_dp: 200_000, packages_expiring_30: 300_000 });
    expect(owner({ k5: ok }).k5).toMatchObject({ amount: { state: "value", rp: 3_900_000 }, packageExpiry30: { state: "value", rp: 300_000 } });
    expect(owner({ k5: kp(null, { package_liability: 1, incomplete: 2 }) }).k5.amount).toMatchObject({ state: "unavailable" });
    expect(owner({ k5: null }).k5.amount).toMatchObject({ state: "unavailable" });
  });

  it("the league row: K17 is unavailable for a branch while a payment is unallocated (never Rp0, never prorated); consolidated owed stays valid", () => {
    const k17 = kp(0, { accrued: 300_000, adjusted: -150_000, paid_net: -150_000 }, { [A]: { accrued: 300_000, adjusted: -150_000 }, [UNBRANCHED]: { paid_net: -150_000 } });
    const row = C.leagueRow({ id: A, name: "Cabang A" }, { k1: null, k2: null, k7: null, k8: null, k9: null, k10: null, k11: null, k12: null, k16: null, k17 }, "/x");
    expect(row.k17).toMatchObject({ state: "unavailable" });
    expect(k17Owed(k17)).toEqual({ state: "value", rp: 0 });
    // unknown sorts after known (Sol decision 1)
    const known = { ...row, branchId: "z", name: "Cabang Z", k17: { state: "value" as const, rp: 5 } };
    expect(sortLeague([row, known], "k17").map((r) => r.branchId)).toEqual(["z", A]);
    expect(row.k1).toMatchObject({ state: "unavailable" }); // a failed reader: unavailable, not 0
  });

  it("mix perawatan is unavailable with its reason: treatment / product / consultation / session is not a category mix (no invented mapping)", () => {
    const d = owner({});
    expect(d.mix).toMatchObject({ state: "unavailable" });
    const out = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c", state: { kind: "ready", data: d } }));
    const mix = out.slice(out.indexOf('id="mix"'), out.indexOf("</section>", out.indexOf('id="mix"')));
    expect(text(mix)).toContain("Belum tersedia");
    expect(text(mix)).toContain("kategori");
    expect(text(mix)).not.toContain("Rp0");
  });

  it("trend: a failed week is a gap in the line (unavailable), never 0; the title still states the finding over the weeks that are known", () => {
    const wk = (a: number | null, b: number | null) => ({ k1: a === null ? null : kp(a), k2: b === null ? null : kp(b) });
    const d = owner({ weeks: [wk(10, 8), wk(null, 9), ...Array.from({ length: 6 }, () => wk(12, 7))] });
    expect(d.trend[1].k1).toMatchObject({ state: "unavailable" });
    expect(d.trend[0].k1).toEqual({ state: "value", rp: 10 });
    expect(trendFinding(d.trend)).toContain("7 minggu".replace("7", "7")); // only the 7 weeks where both are known count
  });

  it("links: only the built, owner-navigable pages that explain the value; every other figure has none", () => {
    const d = owner({ hrefs: hrefsFor(null, { from: "2026-11-16", to: "2026-11-19" }) });
    // K1/K2/K3 → Laporan Penjualan & Uang for the SAME window (this week to date); K4, K6, K18 and the funnel stay plain (no matching page)
    const sales = "/laporan/penjualan?dari=2026-11-16&sampai=2026-11-19";
    expect([d.k1.href, d.k2.href, d.k3.href]).toEqual([sales, sales, sales]);
    expect([d.k4.href, d.k6.href, d.k18.href, d.funnel.href]).toEqual([undefined, undefined, undefined, undefined]);
    expect([d.k5.href, d.k17.href]).toEqual(["/keuangan/kewajiban", "/komisi"]);
    // a branch: K1–K3 keep the branch (the report reads ?cabang=); K5 keeps it too; no K17 link (/komisi is clinic-wide)
    expect(hrefsFor("b1", { from: "2026-11-01", to: "2026-11-19" })).toEqual({ k5: "/keuangan/kewajiban?cabang=b1",
      k1: "/laporan/penjualan?dari=2026-11-01&sampai=2026-11-19&cabang=b1", k2: "/laporan/penjualan?dari=2026-11-01&sampai=2026-11-19&cabang=b1", k3: "/laporan/penjualan?dari=2026-11-01&sampai=2026-11-19&cabang=b1" });
    const out = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/ringkasan/owner/cabang", state: { kind: "ready", data: d } }));
    for (const dead of ["/keuangan?kpi", "/laporan/perawatan", "/laporan/stok", "/laporan/marketing", "/stok?filter", "/lead\"", "/keuangan/kewajiban#piutang"]) expect(out).not.toContain(`href="${dead.replace('\\"', "")}`);
    expect(out).toContain('href="/keuangan/kewajiban"');
    expect(out).toContain(`href="${sales.replace(/&/g, "&amp;")}"`);
    expect((out.match(/Lihat rincian/g) ?? []).length).toBe(5); // exactly K1, K2, K3, K5 and K17
  });
  it("drill-down contract (T-116 built): /laporan/penjualan exists, admits the owner (nav row), holds exactly K1, K2, K3; the K4/K6/K13/K18 report pages do not match the owner", () => {
    expect(existsSync("src/app/(app)/laporan/penjualan/page.tsx")).toBe(true);
    expect(REPORTS.penjualan).toMatchObject({ href: "/laporan/penjualan", kpis: ["K1", "K2", "K3"] });
    expect(readersOf("penjualan")).toContain("owner");
    // the other candidates fail the role or the KPI: K18 → Laporan Stok (PH PU AU), K13 → Laporan Marketing (MK CS); no report holds K4 or K6
    expect(readersOf("stok")).not.toContain("owner");
    expect(readersOf("marketing")).not.toContain("owner");
    for (const id of ["K4", "K6"] as const) expect(Object.values(REPORTS).some((r) => (r.kpis as string[]).includes(id))).toBe(false);
  });
});

const { hrefsFor } = C;
function owner(over: Partial<Parameters<typeof C.ownerSummary>[0]>): OwnerSummaryData {
  const none = { k1: null, k2: null };
  return C.ownerSummary({ periods: periods("minggu", "2026-11-19"), k1: null, k1Prev: null, k2: null, k2Prev: null, k3: null, k3Prev: null, k4: null, k5: null, k6: null,
    k17: null, k18: null, k13: null, weeks: Array.from({ length: WEEKS }, () => none), hrefs: {}, attention: [], branchId: null, ...over });
}

// ── The loader core (load.ts) over a fake connection that answers each reader with the shape the T-107 reader returns ───────────────────────────────
type Call = { sql: string; args: unknown[] };
// What `visits_today(branch)` answers: the branch's own date and zone plus its visits (open ones, and the ones closed today) with the payment step, as the real reader returns them.
type VisitFact = { checkedIn: string; payment?: string; closed?: string | null };
type BoardAnswer = { today: string; timezone?: string; visits: VisitFact[] } | Error;
const boardOf = (b: Exclude<BoardAnswer, Error>) => ({ now: "2026-11-19T05:00:00Z", timezone: b.timezone ?? "Asia/Jakarta", today: b.today, arrivals: [],
  visits: b.visits.map((x, i) => ({ id: `v${i}`, kind: "walk_in", checked_in_at: x.checkedIn, appointment_id: null, starts_at: null, patient_id: `p${i}`, patient_name: "Pasien Sintetis", patient_mrn: `RM-${1000000 + i}`,
    intake: "done", doctor: "done", selection: "done", consent: "done", payment: x.payment ?? "in_progress", preparation: "done", treatment: "done", dispensing: "done", blocker: null, closed_at: x.closed ?? null })) });
function fakeDb(answers: { kpi?: (k: string, from: string, to: string) => KpiPayload | Error; inbox?: number; leads?: { sla_overdue: boolean }[]; monitor?: (b: string) => Record<string, number> | Error; register?: { status: string }[]; board?: (b: string) => BoardAnswer }) {
  const calls: Call[] = [];
  const db = {
    calls,
    async query(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (/^(savepoint|release savepoint|rollback to savepoint)/.test(sql)) return { rows: [] };
      if (sql.includes("dashboard_kpi")) {
        const a = answers.kpi?.(String(args[0]), String(args[1]), String(args[2])) ?? { total: null, by_dim: {}, by_branch: {}, by_grp1: {}, by_grp2: {}, extra: null };
        if (a instanceof Error) throw a;
        return { rows: [{ r: { kpi: args[0], from: args[1], to: args[2], branch_id: args[3] ?? null, as_of: "x", rows: null, by_grp1: {}, by_grp2: {}, by_branch: {}, ...a } }] };
      }
      if (sql.includes("from approvals")) return { rows: Array.from({ length: answers.inbox ?? 0 }, (_, i) => ({ id: `a${i}`, type: "write_off", state: "pending", requested_at: new Date(), requester_name: null, requested_as: "finance", reason: null, amount_rupiah: null, branch_name: null, subject_kind: "x" })) };
      if (sql.includes("lead_list")) return { rows: [{ r: { role: "owner", can_write: false, now: "x", sla_minutes: 15, counts: {}, leads: (answers.leads ?? []).map((l, i) => ({ id: `l${i}`, ...l })) } }] };
      if (sql.includes("satusehat_monitor")) {
        const m = answers.monitor?.(String(args[0])) ?? {};
        if (m instanceof Error) throw m;
        return { rows: [{ r: { outbox: {}, links: m } }] };
      }
      if (sql.includes("compliance_register")) return { rows: (answers.register ?? []).map((x, i) => ({ obligation_key: `o${i}`, scope: "tenant", label: "x", area: "x", item_id: null, status: x.status, valid_until: null, gates: [], latest_version: null, may_act: false, may_read: true, may_decide: false, latest_file: null })) };
      if (sql.includes("visits_today")) {
        const a = answers.board?.(String(args[0])) ?? { today: "2026-11-19", visits: [] };
        if (a instanceof Error) throw a;
        return { rows: [{ r: boardOf(a) }] };
      }
      if (sql.includes("select set_config")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
    },
  };
  return db;
}
const BR = [{ id: "11111111-1111-4111-8111-111111111111", name: "Cabang A" }, { id: "22222222-2222-4222-8222-222222222222", name: "Cabang B" }];
const NOW = new Date("2026-11-19T05:00:00Z"); // 12:00 WIB, Thursday

describe("loader core: reader calls, savepoints, scope", () => {
  it("summary reads exactly READS.summary KPIs; each under its own savepoint; the periods are the report's (cur / prev / 8 weeks)", async () => {
    const db = fakeDb({});
    const r = await summaryIn(db as never, "owner", BR, {}, NOW);
    expect(r.kind).toBe("ok");
    const kpis = db.calls.filter((c) => c.sql.includes("dashboard_kpi"));
    expect(kpis).toHaveLength(READS.summary);
    expect(db.calls.filter((c) => c.sql.startsWith("savepoint")).length).toBeGreaterThanOrEqual(READS.summary); // + the attention readers
    expect(db.calls.filter((c) => c.sql.startsWith("release")).length).toBe(db.calls.filter((c) => c.sql.startsWith("savepoint")).length);
    const k1 = kpis.filter((c) => c.args[0] === "k1").map((c) => `${c.args[1]}..${c.args[2]}`);
    expect(k1[0]).toBe("2026-11-16..2026-11-19"); // this week to date
    expect(k1[1]).toBe("2026-11-09..2026-11-12"); // last week to the same weekday (D-11)
    expect(k1).toHaveLength(2 + 8);
    expect(k1[2]).toBe("2026-09-28..2026-10-04"); // trend week 1
    expect(k1.at(-1)).toBe("2026-11-16..2026-11-19");
    // K4 / K5 / K17 / K18 are read to the end of the period, not for a sub-window
    for (const k of ["k4", "k5", "k17", "k18"]) expect(kpis.filter((c) => c.args[0] === k).map((c) => c.args[2])).toEqual(["2026-11-19"]);
  });

  it("the league page reads exactly READS.league KPIs once for the whole clinic; branch detail reads the summary's KPIs once and picks the branch", async () => {
    const lg = fakeDb({});
    await leagueIn(lg as never, BR, {}, NOW);
    expect(lg.calls.filter((c) => c.sql.includes("dashboard_kpi"))).toHaveLength(READS.league);
    const dt = fakeDb({});
    const d = await detailIn(dt as never, "owner", BR, BR[0].id, {}, NOW);
    expect(d.kind).toBe("ok");
    expect(dt.calls.filter((c) => c.sql.includes("dashboard_kpi"))).toHaveLength(READS.summary); // not per branch
    expect(dt.calls.filter((c) => c.sql.includes("from approvals"))).toHaveLength(0); // "Perlu ditangani" is clinic-level: not on a branch page
  });

  it("a branch that is not the clinic's (another tenant's id, a malformed id) is not-found BEFORE any reader runs — never forbidden, never data", async () => {
    for (const cabang of ["99999999-9999-4999-8999-999999999999", "x", "../etc"]) {
      const db = fakeDb({});
      expect(await summaryIn(db as never, "owner", BR, { cabang }, NOW)).toEqual({ kind: "not-found" });
      expect(await detailIn(db as never, "owner", BR, cabang, {}, NOW)).toEqual({ kind: "not-found" });
      expect(db.calls).toEqual([]);
    }
    expect(UUID_RE.test(BR[0].id)).toBe(true);
  });

  it("a reader that fails makes ONLY its figure unavailable (rolled back to its savepoint, the others still answer); never Rp0", async () => {
    const db = fakeDb({ kpi: (k) => (k === "k3" ? new CommandError("ERR_FORBIDDEN") : k === "k1" ? { total: 5_000_000, by_dim: { cash: 5_000_000 }, by_branch: {}, extra: null } as never : ({ total: null, by_dim: {}, by_branch: {}, extra: null } as never)) });
    const r = await summaryIn(db as never, "owner", BR, {}, NOW);
    if (r.kind !== "ok") throw new Error("not ok");
    expect(r.data.k3.amount).toMatchObject({ state: "unavailable" });
    expect(r.data.k1.amount).toEqual({ state: "value", rp: 5_000_000 }); // the others are unaffected
    expect(db.calls.some((c) => c.sql.startsWith("rollback to savepoint"))).toBe(true);
    expect(db.calls.filter((c) => c.sql.startsWith("rollback")).length).toBe(2); // K3 is read twice (this period and the previous): each rolled back on its own
  });

  it("an unexpected reader error (not a refusal) is also isolated to its figure — the screen still answers", async () => {
    const db = fakeDb({ kpi: (k) => (k === "k6" ? new Error("boom") : ({ total: null, by_dim: {}, by_branch: {}, extra: null } as never)) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await summaryIn(db as never, "owner", BR, {}, NOW);
    spy.mockRestore();
    expect(r.kind === "ok" && r.data.k6.amount).toMatchObject({ state: "unavailable" });
  });
});

describe("Perlu ditangani: the six UX-20 items, each measured by an authorized reader or unavailable with its reason — a missing answer is never an empty queue (Sol 2)", () => {
  const att = async (a: Parameters<typeof fakeDb>[0]) => {
    const r = await summaryIn(fakeDb(a) as never, "owner", BR, {}, NOW);
    if (r.kind !== "ok") throw new Error("not ok");
    return Object.fromEntries(r.data.attention.map((x) => [x.key, x]));
  };
  it("measured items show their count; the order is fixed; belum_bayar is measured from the Hari Ini board (no visit before today: a measured zero)", async () => {
    const a = await att({ inbox: 3, leads: [{ sla_overdue: true }, { sla_overdue: false }, { sla_overdue: true }], monitor: (b): Record<string, number> => (b === BR[0].id ? { "failed:schema": 2, confirmed: 9 } : { exception: 1 }),
      register: [{ status: "expired" }, { status: "approved" }, { status: "expired" }], kpi: (k) => (k === "k18" ? { total: null, by_dim: { below_min: 4, expiring: 1 }, by_branch: {}, extra: null } as never : { total: null, by_dim: {}, by_branch: {}, extra: null } as never) });
    expect(a.persetujuan).toMatchObject({ count: 3, href: "/persetujuan" });
    expect(a.lead_sla).toMatchObject({ count: 2 });
    expect((a.lead_sla as { href?: string }).href).toBeUndefined(); // /lead is not in the owner's menu
    expect(a.satusehat).toMatchObject({ count: 3 }); // failed + exception over both branches
    expect((a.satusehat as { href?: string }).href).toBeUndefined(); // /satusehat shows one branch
    expect(a.stok_klinis).toMatchObject({ count: 4 });
    expect(a.kepatuhan).toMatchObject({ count: 2, href: "/kepatuhan?status=expired" });
    expect(a.belum_bayar).toEqual({ key: "belum_bayar", count: 0 }); // a measured zero (hidden by the view), not unavailable; no link: /hari-ini shows one branch and is not in the owner's menu
  });
  it("a truncated list is not shown as a count: ≥ the cap is unavailable (200 approvals, 200 leads)", async () => {
    const a = await att({ inbox: 201, leads: Array.from({ length: 200 }, () => ({ sla_overdue: true })) });
    expect(a.persetujuan).toMatchObject({ state: "unavailable" });
    expect(a.lead_sla).toMatchObject({ state: "unavailable" });
  });
  it("one unreadable SATUSEHAT branch makes the tenant total unavailable (never the partial sum)", async () => {
    const a = await att({ monitor: (b) => (b === BR[1].id ? new CommandError("ERR_FORBIDDEN") : { failed: 5 }) });
    expect(a.satusehat).toMatchObject({ state: "unavailable" });
  });
  it("the Ringkasan renders unavailable items as 'Belum tersedia' + reason (never dropped, never 0) and measured zeros are hidden", async () => {
    const r = await summaryIn(fakeDb({ inbox: 0, board: (): BoardAnswer => new CommandError("ERR_FORBIDDEN") }) as never, "owner", BR, {}, NOW);
    if (r.kind !== "ok") throw new Error("not ok");
    const out = html(h(OwnerSummary, { scope: r.scope, period, leagueHref: "/c", league: r.league, state: { kind: "ready", data: r.data } }));
    const block = out.slice(out.indexOf('id="perlu"'), out.indexOf("</ul>", out.indexOf('id="perlu"')));
    expect(text(block)).toContain("kunjungan belum bayar sebelum hari ini: Belum tersedia");
    expect(text(block)).toContain("Papan kunjungan belum dapat dibaca untuk semua cabang"); // the reason is text, not a tooltip
    expect(text(block)).not.toContain("persetujuan menunggu"); // measured zero → not listed
    expect(block).toContain('data-attention="unavailable"');
  });
  it("belum_bayar renders as 'n kunjungan belum bayar sebelum hari ini' with no link when visits qualify, and is hidden at a measured zero", async () => {
    const page = async (a: Parameters<typeof fakeDb>[0]) => {
      const r = await summaryIn(fakeDb(a) as never, "owner", BR, {}, NOW);
      if (r.kind !== "ok") throw new Error("not ok");
      return html(h(OwnerSummary, { scope: r.scope, period, leagueHref: "/c", league: r.league, state: { kind: "ready", data: r.data } }));
    };
    const out = await page({ board: (b): BoardAnswer => ({ today: "2026-11-19", visits: b === BR[0].id ? [{ checkedIn: "2026-11-18T03:00:00Z" }, { checkedIn: "2026-11-17T03:00:00Z" }] : [] }) });
    const block = out.slice(out.indexOf('id="perlu"'), out.indexOf("</ul>", out.indexOf('id="perlu"')));
    expect(text(block)).toContain("2 kunjungan belum bayar sebelum hari ini");
    expect(block).not.toContain("/hari-ini"); // no drill-down: /hari-ini shows one branch's board and is not in the owner's menu
    expect(block).not.toContain('data-attention="unavailable"');
    expect(await page({})).not.toContain("kunjungan belum bayar"); // a measured zero is hidden, like the other five
  });
  describe("kunjungan belum bayar sebelum hari ini — the board's own predicate, the branch's own date", () => {
    const unpaidOf = async (a: Parameters<typeof fakeDb>[0], branches = BR) => {
      const db = fakeDb(a);
      const r = await summaryIn(db as never, "owner", branches, {}, NOW);
      if (r.kind !== "ok") throw new Error("not ok");
      return { item: r.data.attention.find((x) => x.key === "belum_bayar"), db };
    };
    const Y = "2026-11-18T03:00:00Z"; // yesterday 10:00 WIB (the branch's today is 2026-11-19)
    it("counts OPEN visits whose payment step is in progress or blocked and that were checked in before the branch's today; today's, paid, not-yet-billed and closed ones are not counted", async () => {
      const { item } = await unpaidOf({ board: (b): BoardAnswer => (b === BR[0].id
        ? { today: "2026-11-19", visits: [
          { checkedIn: Y }, // counted: yesterday, in progress
          { checkedIn: Y, payment: "blocked" }, // counted: blocked is unpaid too (visits.unpaid)
          { checkedIn: "2026-11-19T01:00:00Z" }, // today (08:00 WIB): not before today
          { checkedIn: Y, payment: "done" }, // yesterday but paid
          { checkedIn: Y, payment: "not_started" }, // yesterday, no bill yet: the board reads the payment column only
          { checkedIn: Y, payment: "not_needed" },
          { checkedIn: Y, closed: "2026-11-19T02:00:00Z" }, // closed: never counted, whatever the payment column says (the close guard makes in_progress + closed impossible; the predicate still excludes it)
        ] }
        : { today: "2026-11-19", visits: [{ checkedIn: "2026-11-17T03:00:00Z" }] }) }); // B: one more, two days old
      expect(item).toEqual({ key: "belum_bayar", count: 3 });
    });
    it("asks the reader exactly once per branch the context lists (no more, no fewer), each call inside its own savepoint", async () => {
      const { db } = await unpaidOf({});
      const asked = db.calls.filter((c) => c.sql.includes("visits_today")).map((c) => c.args[0]);
      expect(asked).toEqual([BR[0].id, BR[1].id]);
      const sp = db.calls.map((c) => c.sql);
      const at = sp.findIndex((s) => s.includes("visits_today"));
      expect(sp[at - 1]).toMatch(/^savepoint /); // the reader call sits inside a savepoint
      expect(sp[at + 1]).toMatch(/^release savepoint /);
    });
    it("the date is the BRANCH's: 23:30 WIB yesterday is before today in WIB but the SAME day as a WITA branch's today — never the server clock, never WIB for every branch", async () => {
      // 2026-11-18T16:30Z = 23:30 on the 18th in WIB, 00:30 on the 19th in WITA
      const a = await unpaidOf({ board: (b): BoardAnswer => (b === BR[0].id
        ? { today: "2026-11-19", timezone: "Asia/Jakarta", visits: [{ checkedIn: "2026-11-18T16:30:00Z" }] }
        : { today: "2026-11-19", timezone: "Asia/Makassar", visits: [{ checkedIn: "2026-11-18T16:30:00Z" }] }) });
      expect(a.item).toEqual({ key: "belum_bayar", count: 1 }); // only the WIB branch: for the WITA branch the visit is today's
    });
    it("one unreadable branch makes the item unavailable with its reason — never the partial sum and never 0; the next reader (stock, leads, SATUSEHAT, compliance) still answers", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const forbidden = await unpaidOf({ board: (b): BoardAnswer => (b === BR[1].id ? new CommandError("ERR_FORBIDDEN") : { today: "2026-11-19", visits: [{ checkedIn: Y }, { checkedIn: Y }] }) });
      const boom = await unpaidOf({ board: (b): BoardAnswer => (b === BR[0].id ? new Error("connection reset") : { today: "2026-11-19", visits: [{ checkedIn: Y }] }) });
      spy.mockRestore();
      for (const a of [forbidden, boom]) {
        expect(a.item).toEqual({ key: "belum_bayar", state: "unavailable", reason: "Papan kunjungan belum dapat dibaca untuk semua cabang" });
        expect(a.db.calls.some((c) => c.sql.startsWith("rollback to savepoint"))).toBe(true);
      }
      // the readers after the failed board read still ran (each has its own savepoint): leads, SATUSEHAT, compliance
      for (const a of [forbidden, boom]) for (const reader of ["lead_list", "satusehat_monitor", "compliance_register"]) expect(a.db.calls.some((c) => c.sql.includes(reader)), reader).toBe(true);
    });
    it("a malformed answer (a `today` that is not a date, an unknown zone) is unavailable — never a number", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const badDay = await unpaidOf({ board: (): BoardAnswer => ({ today: "hari ini", visits: [{ checkedIn: Y }] }) });
      const badZone = await unpaidOf({ board: (): BoardAnswer => ({ today: "2026-11-19", timezone: "Mars/Olympus", visits: [{ checkedIn: Y }] }) });
      spy.mockRestore();
      expect(badDay.item).toMatchObject({ state: "unavailable" });
      expect(badZone.item).toMatchObject({ state: "unavailable" });
    });
    it("a clinic with no branch to read is unavailable, not an empty queue", async () => {
      const { item } = await unpaidOf({}, []);
      expect(item).toMatchObject({ key: "belum_bayar", state: "unavailable" });
    });
    it("a branch page shows no clinic-level queue (the board is not read there)", async () => {
      const db = fakeDb({});
      const r = await summaryIn(db as never, "owner", BR, { cabang: BR[0].id }, NOW);
      expect(r.kind === "ok" && r.data.attention).toEqual([]);
      expect(db.calls.filter((c) => c.sql.includes("visits_today"))).toHaveLength(0);
    });
  });
});

// ── Real-fixture evidence: the loader core over the REAL T-107 reader on PostgreSQL ────────────────────────────────────────────────────────
// Facts come from the real writers (cash top-ups through the cashier module) and, for commission, from the reader's own raw-seeding pattern (tests/reporting/dashboards.test.ts
// F3: the writers of a paid payout batch are a later task). Synthetic data only (MIG-2). Heavy: run under heavy-run --lock clinic-dashboard-env.
describe("T-109 wiring on the real T-107 reader (PostgreSQL)", () => {
  let hn: Harness;
  let appP: pg.Pool;
  let ownP: pg.Pool;
  let seq = 0;
  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local"; // synthetic data only (MIG-2): the cashier writers' production go-live gate stays closed otherwise
    hn = await createHarness();
    appP = await openAppPool({ connectionString: hn.urlAs(await hn.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    ownP = testPool({ connectionString: hn.ownerUrl(), max: 2 });
  }, 300_000);
  afterAll(async () => { await appP?.end(); await ownP?.end(); await hn?.close(); });

  type Who = { acc: string; staffId: string; role: Role; branch?: string };
  async function world() {
    const t = (await hn.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await hn.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Ringkasan Owner Sintetis', 'emkm')`, [t]);
    const br = async (c: string) => (await hn.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`, [t, c, `Cabang ${c}`])).rows[0].id as string;
    const b1 = await br("A");
    const b2 = await br("B");
    const person = async (role: Role, branch?: string): Promise<Who> => {
      const acc = (await hn.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rgo${++seq}@klinik-sintetis.test`])).rows[0].id as string;
      const { staffId } = await createMembership(ownP, { tenantId: t, accountId: acc, displayName: `Staf Ringkasan ${seq}` });
      const rid = await assignRole(hn.admin, { tenantId: t, staffId, role });
      if (branch) await assignBranch(hn.admin, { tenantId: t, staffRoleId: rid, branchId: branch });
      return { acc, staffId, role, branch };
    };
    const owner = await person("owner");
    const as = async <R>(w: Who, fn: (db: pg.PoolClient) => Promise<R>) =>
      withTenantContext(appP, await resolveContext(appP, w.acc, { tenantId: t, actingRole: w.role, activeBranchId: w.branch }), fn);
    const branches = (await hn.admin.query(`select id, name from branches where tenant_id = $1 order by name, id`, [t])).rows as { id: string; name: string }[];
    return { t, b1, b2, owner, person, as, branches };
  }
  const patient = async (t: string, b: string, by: string) => (await hn.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Ringkasan Owner', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`,
    [t, b, by])).rows[0].id as string;
  const v = (rp: number) => ({ state: "value" as const, rp });

  it("K1 by the real writers: a cash top-up at each branch counts at the branch where it was paid; consolidated = their sum; a KPI with no rows is a real Rp0, never unavailable", async () => {
    const w = await world();
    const fo1 = await w.person("fo_cashier", w.b1);
    const fo2 = await w.person("fo_cashier", w.b2);
    for (const [fo, b, amount] of [[fo1, w.b1, 300_001], [fo2, w.b2, 500_002]] as const) {
      const pid = await patient(w.t, b, fo.staffId);
      await w.as(fo, (db) => topUpBalance(db, crypto.randomUUID(), pid, null, { method: "cash", amount, cashTendered: amount }));
    }
    const s = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
    if (s.kind !== "ok") throw new Error("summary not ok");
    expect(s.data.k1.amount).toEqual(v(800_003));
    expect(s.data.k1.previous).toEqual(v(0)); // last period: no rows = a real Rp0
    expect(s.data.k2.amount).toEqual(v(0));
    expect(s.data.k3.amount).toEqual(v(0));
    expect(s.league.map((r) => [r.name, r.k1])).toEqual([["Cabang A", v(300_001)], ["Cabang B", v(500_002)]]); // the summary's league: K1 / K2 only
    expect(s.data.trend).toHaveLength(8);
    expect(s.data.trend.at(-1)?.k1).toEqual(v(800_003)); // the current (partial) week
    expect(s.data.trend[0].k1).toEqual(v(0));
    const lg = await w.as(w.owner, (db) => leagueIn(db, w.branches, {}, new Date()));
    expect(lg.rows.map((r) => [r.name, r.k1, r.k2])).toEqual([["Cabang A", v(300_001), v(0)], ["Cabang B", v(500_002), v(0)]]);
    expect(lg.rows[0].k8).toMatchObject({ state: "value", den: 0 }); // no consultation visits: a 0-denominator ratio (rendered as Belum tersedia, not 0 %)
    expect(rate(lg.rows[0].k8)).toBe("Belum tersedia");
    const d = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b2, {}, new Date()));
    expect(d.kind === "ok" && d.data.k1.amount).toEqual(v(500_002));
    expect(d.kind === "ok" && d.branch.name).toBe("Cabang B");
    // the real "Perlu ditangani" readers answer for the owner: nothing waiting is a measured zero (hidden) — now including the Hari Ini board's unpaid visits
    const att = Object.fromEntries(s.data.attention.map((x) => [x.key, x]));
    expect(att.persetujuan).toMatchObject({ count: 0 });
    expect(att.lead_sla).toMatchObject({ count: 0 });
    expect(att.satusehat).toMatchObject({ count: 0 });
    expect(att.stok_klinis).toMatchObject({ count: 0 });
    expect(att.kepatuhan).toMatchObject({ count: 0 });
    expect(att.belum_bayar).toEqual({ key: "belum_bayar", count: 0 }); // the real visits_today answered for both branches: no visit at all is a measured zero
  });

  it("a branch with no payment while another has one: its K1 is a real Rp0 — it never inherits the clinic total (the discriminating case for 'no row at this branch')", async () => {
    const w = await world();
    const fo1 = await w.person("fo_cashier", w.b1);
    const pid = await patient(w.t, w.b1, fo1.staffId);
    await w.as(fo1, (db) => topUpBalance(db, crypto.randomUUID(), pid, null, { method: "cash", amount: 420_007, cashTendered: 420_007 }));
    const lg = await w.as(w.owner, (db) => leagueIn(db, w.branches, {}, new Date()));
    expect(lg.rows.map((r) => [r.name, r.k1])).toEqual([["Cabang A", v(420_007)], ["Cabang B", v(0)]]);
    const d = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b2, {}, new Date()));
    expect(d.kind === "ok" && d.data.k1.amount).toEqual(v(0)); // not 420.007
    expect(d.kind === "ok" && d.data.trend.at(-1)?.k1).toEqual(v(0)); // the trend of the branch is the branch's, not the clinic's
    const c = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
    expect(c.kind === "ok" && c.data.k1.amount).toEqual(v(420_007)); // consolidated is the sum
  });

  it("Scenario PR-33a S11 through the loader on the real reader: a package sold at A and its session counted at B — sales (K3) at A, completed service (K2) at B, never swapped", async () => {
    // Raw facts of exactly the shape the writers persist (T-107's own S11 test drives the real writers and asserts these rows); the visit-to-execution chain behind a redeemed
    // session is not this loader's concern, so the guards of the three tables are off for the seed only.
    const w = await world();
    const q = (sql: string, args: unknown[]) => hn.admin.query(sql, args);
    await seedFkFree(["invoices", "invoice_lines", "packages", "package_sessions"], async () => {
      const svc = (await q(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`, [w.t, `S11-${++seq}`, w.owner.staffId])).rows[0].id as string;
      const svcV = (await q(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
        values ($1, $2, 1, 'active', 'Paket Ringkasan', 'exempt_medical', 'Jasa medis', 3000000, 'Paket baru', $3, 'owner') returning id`, [w.t, svc, w.owner.staffId])).rows[0].id as string;
      const pid = await patient(w.t, w.b1, w.owner.staffId);
      const inv = (await q(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, $4, 'issued', false, now(), $5, 'fo_cashier', $6, $5, 'fo_cashier') returning id`, [w.t, w.b1, pid, `S11-${seq}`, w.owner.staffId, `s11-${crypto.randomUUID()}`])).rows[0].id as string;
      const ln = (await q(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        values ($1, $2, $3, $4, $5, 1, 3000000, 3000000, 'exempt_medical', 'Jasa medis', 3000000, 0) returning id`, [w.t, w.b1, inv, svc, svcV])).rows[0].id as string;
      const pkg = (await q(`insert into packages (tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id, catalog_version_id, price, min_dp, validity_end, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $7, 3000000, 1000000, now() + interval '180 days', $8, 'fo_cashier') returning id`, [w.t, w.b1, pid, inv, ln, svc, svcV, w.owner.staffId])).rows[0].id as string;
      // a redeemed session names the treated patient (0098 beneficiary check): here the package's own patient
      await q(`insert into package_sessions (tenant_id, package_id, seq, service_item_id, allocated_value, tax_category, tax_basis, vat_base, vat_amount, state, reserved_execution_id, redeemed_branch_id, redeemed_at, beneficiary_patient_id)
        values ($1, $2, 1, $3, 600000, 'exempt_medical', 'Jasa medis', 600000, 0, 'redeemed', gen_random_uuid(), $4, now(), $5)`, [w.t, pkg, svc, w.b2, pid]);
    });
    const at = async (id: string) => { const d = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, id, {}, new Date())); if (d.kind !== "ok") throw new Error("detail not ok"); return d.data; };
    const [dA, dB] = [await at(w.b1), await at(w.b2)];
    expect([dA.k3.amount, dA.k2.amount]).toEqual([v(3_000_000), v(0)]); // sold at A: K3 at A; no session counted at A: a real Rp0
    expect([dB.k3.amount, dB.k2.amount]).toEqual([v(0), v(600_000)]); // counted at B: K2 at B; nothing sold at B
    const lg = await w.as(w.owner, (db) => leagueIn(db, w.branches, {}, new Date()));
    expect(lg.rows.map((r) => [r.name, r.k2])).toEqual([["Cabang A", v(0)], ["Cabang B", v(600_000)]]);
    const s = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
    if (s.kind !== "ok") throw new Error("summary not ok");
    expect([s.data.k3.amount, s.data.k2.amount]).toEqual([v(3_000_000), v(600_000)]); // consolidated: each counted once
    // the drill-down lands on the same figures: Laporan Penjualan & Uang for the link's own window (and branch), read as the owner on the same readers
    const follow = async (href: string | undefined) => {
      expect(href, "the card links to the sales report").toMatch(/^\/laporan\/penjualan\?/);
      const q = Object.fromEntries(new URL(href!, "http://x").searchParams);
      const r = await w.as(w.owner, (db) => reportIn(db, "penjualan", "owner", q, new Date()));
      if (r.kind !== "ok") throw new Error(`report ${r.kind}`);
      return Object.fromEntries(r.props.kpis.map((k) => [k.id, k.metric]));
    };
    const money = (a: { state: string; rp?: number }) => (a.state === "value" ? { kind: "money", rupiah: a.rp } : a);
    for (const [card, id] of [[s.data.k1, "K1"], [s.data.k2, "K2"], [s.data.k3, "K3"]] as const) expect((await follow(card.href))[id], `${id} consolidated`).toEqual(money(card.amount));
    for (const [d, b] of [[dA, w.b1], [dB, w.b2]] as const) {
      expect(d.k2.href).toContain(`&cabang=${b}`);
      for (const [card, id] of [[d.k1, "K1"], [d.k2, "K2"], [d.k3, "K3"]] as const) expect((await follow(card.href))[id], `${id} at ${b}`).toEqual(money(card.amount));
    }
  });

  it("K13 by source on the real reader (the lead writer): distinct channels at each branch — the clinic shows every channel, a branch ONLY its own through the reader's branch selector, never the clinic's groups cut down", async () => {
    const w = await world();
    const cs = await w.person("central_cs");
    const lead = async (source: string, b: string) => {
      const pid = await patient(w.t, b, w.owner.staffId);
      await w.as(cs, (db) => createLead(db, crypto.randomUUID(), { source, patientId: pid, branchId: b } as never));
    };
    for (const [src, b] of [["instagram", w.b1], ["instagram", w.b1], ["phone", w.b1], ["ads", w.b2], ["ads", w.b2], ["ads", w.b2], ["website", w.b2]] as const) await lead(src, b);
    const sources = (f: Extract<OwnerSummaryData["funnel"], { state: "value" }>) => (f.sources.state === "rows" ? Object.fromEntries(f.sources.rows.map((r) => [r.source, r.lead])) : null);
    const s = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
    if (s.kind !== "ok" || s.data.funnel.state !== "value") throw new Error("summary funnel");
    expect([s.data.funnel.lead, sources(s.data.funnel)]).toEqual([7, { ads: 3, instagram: 2, phone: 1, website: 1 }]); // the clinic: every channel, once
    const dA = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b1, {}, new Date()));
    const dB = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b2, {}, new Date()));
    if (dA.kind !== "ok" || dA.data.funnel.state !== "value" || dB.kind !== "ok" || dB.data.funnel.state !== "value") throw new Error("detail funnel");
    expect([dA.data.funnel.lead, sources(dA.data.funnel)]).toEqual([3, { instagram: 2, phone: 1 }]); // A: not the clinic's ads / website
    expect([dB.data.funnel.lead, sources(dB.data.funnel)]).toEqual([4, { ads: 3, website: 1 }]); // B: not A's instagram / phone
  });

  it("a refund-heavy week on the real reader: K1 is NEGATIVE (a refunded booking deposit with no payment) — the card shows it, the trend keeps every point inside the plot, Rp0 is the top edge", async () => {
    const w = await world();
    await refundedDeposit(w, w.b1, 250_003);
    const s = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
    if (s.kind !== "ok") throw new Error("summary not ok");
    expect(s.data.k1.amount).toEqual(v(-250_003)); // the reader's total, signed: not clamped at zero, not unavailable
    expect(s.data.trend.at(-1)?.k1).toEqual(v(-250_003));
    const known = s.data.trend.flatMap((x) => [x.k1, x.k2]).filter((a): a is { state: "value"; rp: number } => a.state === "value").map((a) => a.rp);
    expect(Math.min(...known)).toBe(-250_003);
    const out = html(h(OwnerSummary, { scope: s.scope, period, leagueHref: "/c", state: { kind: "ready", data: s.data } }));
    const all = [...ys(pathOf(out, "chart-1")), ...ys(pathOf(out, "chart-2"))];
    expect(all.length).toBeGreaterThan(0);
    for (const y of all) { expect(y).toBeGreaterThanOrEqual(8); expect(y).toBeLessThanOrEqual(112); }
    expect(baselineY(out)).toBe(8); // every known week is ≤ 0: Rp0 is the top edge and the refund week the bottom edge
    expect(Math.max(...ys(pathOf(out, "chart-1")))).toBe(112);
    expect(out).toContain('data-trend-note="negative"');
    const b2 = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b2, {}, new Date()));
    expect(b2.kind === "ok" && b2.data.k1.amount).toEqual(v(0)); // the other branch refunded nothing: a real Rp0, not the clinic's negative
  });

  it("K9 on the real reader: three plan items recommended at A, selected 0 / 40 / 75 days later — the 30 / 60 / 90-day windows differ (count and value); B recommended nothing: a zero denominator that never reads 0 %", async () => {
    const w = await world();
    // Three plan items recommended TODAY at A (600.000, 400.000, 300.000) and selected 0, 40 and 75 days LATER (confirmed_at is dated forward from the recommendation day, so the window
    // that contains the recommendation sees each selection only when it falls inside 30 / 60 / 90 days of it): the three windows must differ, which is what makes a swapped window visible.
    const pid = await patient(w.t, w.b1, w.owner.staffId);
    const cvs = [await catalogVersion(w.t, w.owner.staffId, 600_000, `K9A-${++seq}`), await catalogVersion(w.t, w.owner.staffId, 400_000, `K9B-${++seq}`), await catalogVersion(w.t, w.owner.staffId, 300_000, `K9C-${++seq}`)];
    const selectedAfter = [0, 40, 75]; // days after the recommendation
    await seedFkFree(["care_plans", "plan_items", "selections", "selection_items"], async (q) => {
      const plan = (await q(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by) values ($1, $2, $3, 'Program Ringkasan', 'Kondisi sintetis', gen_random_uuid(), $4) returning id`,
        [w.t, w.b1, pid, w.owner.staffId])).rows[0].id as string;
      for (const [i, cv] of cvs.entries()) {
        const item = (await q(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty) values ($1, $2, $3, gen_random_uuid(), 1, $4, 1) returning id`, [w.t, w.b1, plan, cv])).rows[0].id as string;
        const visit = crypto.randomUUID();
        const sel = (await q(`insert into selections (tenant_id, branch_id, visit_id, patient_id, command_key, confirmed_at, confirmed_by, confirmed_as) values ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval, $7, 'bc') returning id`,
          [w.t, w.b1, visit, pid, `sel-${crypto.randomUUID()}`, String(selectedAfter[i]), w.owner.staffId])).rows[0].id as string;
        await q(`insert into selection_items (tenant_id, branch_id, visit_id, selection_id, kind, plan_item_id, catalog_version_id, quantity) values ($1, $2, $3, $4, 'service', $5, $6, 1)`, [w.t, w.b1, visit, sel, item, cv]);
      }
    });
    const lg = await w.as(w.owner, (db) => leagueIn(db, w.branches, {}, new Date()));
    const rowA = lg.rows.find((r) => r.branchId === w.b1)!;
    const rowB = lg.rows.find((r) => r.branchId === w.b2)!;
    const rt = (num: number, den: number) => ({ state: "value", num, den });
    expect(rowA.k9).toEqual(rt(1, 3)); // the league cell: the 30-day COUNT (only the same-day selection)
    expect(rowA.k9Detail).toEqual({ state: "value", windows: {
      30: { count: rt(1, 3), value: rt(600_000, 1_300_000) },
      60: { count: rt(2, 3), value: rt(1_000_000, 1_300_000) }, // + the item selected 40 days later
      90: { count: rt(3, 3), value: rt(1_300_000, 1_300_000) }, // + the item selected 75 days later
    } });
    expect(rowB.k9).toEqual(rt(0, 0)); // nothing recommended at B: a zero denominator
    const out = html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort: "k1", sortHrefs: C.sortHrefs("minggu"), state: { kind: "ready", data: lg.rows } }));
    const t = text(out);
    expect(t).toContain("Rencana dipilih, jumlah 30 hari (K9) 33,3%"); // A: 1 of 3, labelled as the 30-day count
    expect(t).toContain("30 hari Jumlah: 1 dari 3 (33,3%) Nilai: Rp600.000 dari Rp1.300.000 (46,2%)");
    expect(t).toContain("60 hari Jumlah: 2 dari 3 (66,7%) Nilai: Rp1.000.000 dari Rp1.300.000 (76,9%)");
    expect(t).toContain("90 hari Jumlah: 3 dari 3 (100%) Nilai: Rp1.300.000 dari Rp1.300.000 (100%)");
    expect(t).toContain("Rencana dipilih, jumlah 30 hari (K9) Belum tersedia Belum ada rencana yang disarankan pada periode ini"); // B
    expect(t).not.toMatch(/Rencana dipilih, jumlah 30 hari \(K9\) 0%/);
  });

  // The facts below come from the real writers: a walk-in check-in (visit_walk_in), an invoice opened on the visit and issued (the cashier's own kasir_visit_payment sets the payment step to
  // in_progress), a payment (done) and a close (visit_close, refused while unpaid). Only the CHECK-IN INSTANT is moved back by raw SQL, with visits_guard off for that one statement and back ON
  // (enable always) in `finally`: the guard forbids editing a check-in and no writer backdates one. A visit invoice dispenses nothing (only a counter sale does), so the product needs no stock item.
  const unpaidWorld = async () => {
    const w = await world();
    const key = () => crypto.randomUUID();
    const serum = (await w.as(w.owner, (db) => publish(db, { kind: "product", code: `UB-${++seq}` }, { name: "Serum Belum Bayar", tax_category: "non_object", tax_basis: "Barang", normal_price: 100_000 } as never, "Produk"))).itemId;
    // `bill`: an invoice of one serum is issued (the step goes in progress); `pay`: and paid in full (done); `close`: and the visit closed; `daysAgo`: the check-in moved back.
    const visit = async (fo: Who, o: { bill?: boolean; pay?: boolean; close?: boolean; daysAgo?: number } = {}) => {
      const patientId = await patient(w.t, fo.branch as string, fo.staffId);
      const { visitId } = await w.as(fo, (db) => walkIn(db, key(), patientId, null));
      let invoiceId: string | null = null;
      if (o.bill || o.pay || o.close) {
        invoiceId = (await w.as(fo, (db) => openKasirInvoice(db, key(), { patientId, visitId }))).invoiceId;
        await w.as(fo, (db) => issueKasirInvoice(db, key(), invoiceId as string, [{ itemId: serum, quantity: 1 }]));
        if (o.pay || o.close) await w.as(fo, (db) => receivePayment(db, key(), invoiceId as string, [{ method: "cash", amount: 100_000, cashTendered: 100_000 }]));
      }
      if (o.close) await w.as(fo, (db) => closeVisit(db, key(), visitId));
      if (o.daysAgo) await backdate(visitId, o.daysAgo);
      return { visitId, invoiceId, patientId };
    };
    const backdate = async (visitId: string, days: number) => {
      await hn.admin.query("alter table visits disable trigger visits_guard");
      try { await hn.admin.query(`update visits set checked_in_at = checked_in_at - ($2 || ' days')::interval where id = $1`, [visitId, String(days)]); }
      finally { await hn.admin.query("alter table visits enable always trigger visits_guard"); }
    };
    const item = async () => {
      const s = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
      if (s.kind !== "ok") throw new Error("summary not ok");
      return { item: s.data.attention.find((x) => x.key === "belum_bayar"), all: s.data.attention };
    };
    return { w, key, serum, visit, backdate, item };
  };

  it("Kunjungan belum bayar sebelum hari ini on the real visits_today and the real cashier writers: yesterday's unpaid visit counts, today's does not, a paid, closed or not-yet-billed one does not, and the count is the clinic's across both branches", async () => {
    const { w, visit, item } = await unpaidWorld();
    const fo1 = await w.person("fo_cashier", w.b1);
    const fo2 = await w.person("fo_cashier", w.b2);
    await visit(fo1, { bill: true, daysAgo: 1 }); // A, yesterday, unpaid                    -> counted
    await visit(fo1, { bill: true }); // A, today, unpaid                                    -> not before today
    await visit(fo1, { pay: true, daysAgo: 1 }); // A, yesterday, paid (still open)          -> paid
    await visit(fo1, { close: true, daysAgo: 2 }); // A, two days ago, paid and closed        -> closed
    await visit(fo1, { daysAgo: 1 }); // A, yesterday, nothing billed yet                     -> payment step not started
    await visit(fo2, { bill: true, daysAgo: 3 }); // B, three days ago, unpaid                -> counted
    const steps = (await hn.admin.query(`select payment, closed_at is not null as closed, count(*)::int n from visits where tenant_id = $1 group by 1, 2 order by 1, 2`, [w.t])).rows;
    expect(steps.map((r) => `${r.payment}${r.closed ? "+closed" : ""}:${r.n}`)).toEqual(["done:1", "done+closed:1", "in_progress:3", "not_started:1"]); // the writers produced exactly the states the six visits were built to have: paid-open, paid-closed, three unpaid, one unbilled
    expect((await item()).item).toEqual({ key: "belum_bayar", count: 2 }); // A yesterday + B three days ago
    // the loader sums exactly what the board's own reader answers branch by branch (A: yesterday + today open and unpaid, B: one)
    const perBranch = await Promise.all(w.branches.map((b) => w.as(w.owner, (db) => visitsToday(db, b.id))));
    expect(perBranch.map((t) => t.visits.filter((x) => x.payment === "in_progress" && x.closedAt === null).length)).toEqual([2, 1]);
    // a branch page carries no clinic-level queue
    const d = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b1, {}, new Date()));
    expect(d.kind === "ok" && d.data.attention).toEqual([]);
  }, 120_000);

  it("Kunjungan belum bayar: today's unpaid visit is a measured zero, the same visit checked in yesterday counts, a blocked payment step counts, and settling it stops the count", async () => {
    const { w, key, visit, backdate, item } = await unpaidWorld();
    const fo = await w.person("fo_cashier", w.b1);
    await visit(fo); // checked in today, nothing billed
    expect((await item()).item).toEqual({ key: "belum_bayar", count: 0 }); // a measured zero: not unavailable
    const { visitId, invoiceId } = await visit(fo, { bill: true });
    expect((await item()).item).toEqual({ key: "belum_bayar", count: 0 }); // billed and unpaid, but checked in today
    await backdate(visitId, 1);
    expect((await item()).item).toEqual({ key: "belum_bayar", count: 1 }); // the same visit, checked in yesterday
    await hn.admin.query(`update visits set payment = 'blocked' where id = $1`, [visitId]); // a plain update, as tests/visits does: visits_guard only protects identity and closure
    expect((await item()).item).toEqual({ key: "belum_bayar", count: 1 }); // blocked is unpaid too: the predicate the visit-close guard refuses on
    await w.as(fo, (db) => receivePayment(db, key(), invoiceId as string, [{ method: "cash", amount: 100_000, cashTendered: 100_000 }]));
    expect((await item()).item).toEqual({ key: "belum_bayar", count: 0 }); // settled: the cashier's own writer moves the step to done
  }, 120_000);

  it("Kunjungan belum bayar, CROSS-TENANT: tenant A's owner never counts tenant B's unpaid visit (A has none: a measured zero), even when handed B's branch ids the reader refuses them; B's own owner counts it (positive control)", async () => {
    const a = await unpaidWorld();
    const b = await unpaidWorld();
    const foB = await b.w.person("fo_cashier", b.w.b1);
    await b.visit(foB, { bill: true, daysAgo: 2 }); // B: one unpaid visit from two days ago
    expect((await b.item()).item).toEqual({ key: "belum_bayar", count: 1 }); // positive control: as B the surface really reads B's visit
    expect((await a.item()).item).toEqual({ key: "belum_bayar", count: 0 }); // as A: B's visit never reaches the count
    // the reader's own tenant boundary, not only the loader's branch list: A's owner handed B's branch ids is refused by visits_today (ERR_NOT_FOUND) -> unavailable, never B's count
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const crossed = await a.w.as(a.w.owner, (db) => summaryIn(db, "owner", b.w.branches, {}, new Date()));
    spy.mockRestore();
    if (crossed.kind !== "ok") throw new Error("summary not ok");
    expect(crossed.data.attention.find((x) => x.key === "belum_bayar")).toMatchObject({ key: "belum_bayar", state: "unavailable" });
    expect(JSON.stringify(crossed.data.attention)).not.toContain(b.w.b1);
  }, 120_000);

  it("Kunjungan belum bayar, the branch's OWN timezone on the real reader: at a WIT branch (UTC+9) a visit checked in at 00:30 WIT today is TODAY's — it is 22:30 WIB of the day before, which a WIB-for-every-branch reading would count — while a WIT visit from two days ago counts", async () => {
    const { w, visit, item } = await unpaidWorld();
    // A branch may carry one of three zones (branches_timezone_check); branches_guard freezes only id, tenant, code and creation time, so a plain update gives branch B the WIT zone.
    await hn.admin.query(`update branches set timezone = 'Asia/Jayapura' where id = $1`, [w.b2]);
    const fo = await w.person("fo_cashier", w.b2);
    const early = await visit(fo, { bill: true }); // checked in now; moved to 00:30 on the WIT calendar day it belongs to, just below
    await visit(fo, { bill: true, daysAgo: 2 }); // two days old at the same branch: counted
    await hn.admin.query("alter table visits disable trigger visits_guard");
    try {
      await hn.admin.query(`update visits set checked_in_at = (date_trunc('day', clock_timestamp() at time zone 'Asia/Jayapura') + interval '30 minutes') at time zone 'Asia/Jayapura' where id = $1`, [early.visitId]);
    } finally { await hn.admin.query("alter table visits enable always trigger visits_guard"); }
    // The fixture really straddles the zones (else this test would pass for the wrong reason): the reader's own `today` is the WIT date, the early visit is today there, and its WIB date is the day before.
    const board = await w.as(w.owner, (db) => visitsToday(db, w.b2));
    const e = board.visits.find((x) => x.id === early.visitId);
    if (!e) throw new Error("the early visit is not on the board");
    const on = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(e.checkedInAt);
    expect(board.timezone).toBe("Asia/Jayapura");
    expect(on("Asia/Jayapura")).toBe(board.today); // today at the branch
    expect(on("Asia/Jakarta") < board.today).toBe(true); // yesterday on a WIB calendar
    expect((await item()).item).toEqual({ key: "belum_bayar", count: 1 }); // the two-day-old visit only: the early one is today's where it was checked in
  }, 120_000);

  // K17 on the real reader: the contract Sol asked to verify before wiring — an unallocated payout sits under by_branch["-"].paid_net
  // Raw seeding only where a writer of the fact is a later task or its chain is not this loader's concern (T-107's tests/reporting/dashboards.test.ts seeds the same way): the guards and
  // FKs of the listed tables are switched off for the seed and switched back ON (always) in `finally`.
  async function seedRaw(tables: string[], fn: () => Promise<void>) {
    const off: [string, string][] = [];
    for (const tb of tables) for (const r of (await hn.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
    for (const [tb, tg] of off) await hn.admin.query(`alter table ${tb} disable trigger ${tg}`);
    try { await fn(); } finally { for (const [tb, tg] of off) await hn.admin.query(`alter table ${tb} enable always trigger ${tg}`); }
  }

  // Same, and the foreign keys skipped for the one transaction (replica mode, as treatment / pharmacy / materials tests do) — for facts whose parents (an appointment, a receipt, a plan)
  // are not the concern of the reader under test. Guards are switched back ON in `finally` (seedRaw).
  async function seedFkFree(tables: string[], fn: (q: (sql: string, args?: unknown[]) => Promise<pg.QueryResult>) => Promise<void>) {
    await seedRaw(tables, async () => {
      const q = (sql: string, args: unknown[] = []) => hn.admin.query(sql, args);
      await q("begin");
      await q("set local session_replication_role = replica");
      try { await fn(q); await q("commit"); } catch (e) { await q("rollback"); throw e; }
    });
  }
  const catalogVersion = async (t: string, by: string, price: number, code: string) => {
    const svc = (await hn.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`, [t, code, by])).rows[0].id as string;
    return (await hn.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
      values ($1, $2, 1, 'active', $4, 'exempt_medical', 'Jasa medis', $3, 'Layanan baru', $5, 'owner') returning id`, [t, svc, price, `Layanan ${code}`, by])).rows[0].id as string;
  };
  // A booking deposit refunded today: the reader's K1 subtracts it (dp_refund) on the refund date. With no payment in the same week the week's net is NEGATIVE — a valid figure.
  const refundedDeposit = async (w: Awaited<ReturnType<typeof world>>, branch: string, amount: number) => {
    const pid = await patient(w.t, branch, w.owner.staffId);
    const cv = await catalogVersion(w.t, w.owner.staffId, 100_000, `DP-${++seq}`);
    await seedFkFree(["booking_deposits"], async (q) => {
      await q(`insert into booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category, is_pkp_at_receipt, vat_base, vat_amount,
                 cutoff_hours, state, decision_code, refund_method, decided_by, decided_as, decided_at, command_key, received_by, received_as, received_at)
               values ($1, $2, gen_random_uuid(), $3, $4, gen_random_uuid(), 'cash', $5, 'exempt_medical', false, $5, 0, 0, 'refunded', 'batal_pasien', 'cash', $6, 'owner', now(), $7, $6, 'owner', now() - interval '20 days')`,
        [w.t, branch, pid, cv, amount, w.owner.staffId, `dp-${crypto.randomUUID()}`]);
    });
  };

  async function commission(paidNet: number | null) {
    const w = await world();
    const nurse = await w.person("nurse", w.b1);
    const days = (n: number) => `${new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })} 10:00:00+07`;
    await seedRaw(["invoices", "invoice_lines", "commission_contributions", "commission_entitlements", "approvals", "payout_batches", "payout_batch_items", "payout_batch_lines"], async () => {
      const q = (sql: string, args: unknown[]) => hn.admin.query(sql, args);
      const svc = (await q(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`, [w.t, `RGO-${seq}`, w.owner.staffId])).rows[0].id as string;
      const svcV = (await q(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
        values ($1, $2, 1, 'active', 'Layanan RGO', 'exempt_medical', 'Jasa medis', 500000, 'Layanan baru', $3, 'owner') returning id`, [w.t, svc, w.owner.staffId])).rows[0].id as string;
      const pid = await patient(w.t, w.b1, w.owner.staffId);
      const inv = (await q(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, $4, 'issued', false, $5, $6, 'fo_cashier', $7, $6, 'fo_cashier') returning id`, [w.t, w.b1, pid, `RGO${seq}`, days(30), w.owner.staffId, `rgo-${crypto.randomUUID()}`])).rows[0].id as string;
      const ln = (await q(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        values ($1, $2, $3, $4, $5, 1, 500000, 500000, 'exempt_medical', 'Jasa medis', 500000, 0) returning id`, [w.t, w.b1, inv, svc, svcV])).rows[0].id as string;
      const rule = (await q(`insert into commission_rules (tenant_id, contribution_type, name, created_by, created_as, command_key) values ($1, 'performer', 'Aturan RGO', $2, 'owner', $3) returning id`, [w.t, w.owner.staffId, `cr-${crypto.randomUUID()}`])).rows[0].id as string;
      const rv = (await q(`insert into commission_rule_versions (tenant_id, rule_id, version, kind, fixed_amount, effective_from, prepared_by, prepared_as, command_key)
        values ($1, $2, 1, 'fixed', 1, '2026-01-01', $3, 'owner', $4) returning id`, [w.t, rule, w.owner.staffId, `crv-${crypto.randomUUID()}`])).rows[0].id as string;
      const ent = async (amount: number, accrued: string) => {
        const c = (await q(`insert into commission_contributions (tenant_id, branch_id, staff_id, contribution_type, source_kind, source_id, invoice_line_id, rule_version_id, sale_at)
          values ($1, $2, $3, 'performer', 'treatment_execution', gen_random_uuid(), $4, $5, $6) returning id`, [w.t, w.b1, nurse.staffId, ln, rv, accrued])).rows[0].id;
        return (await q(`insert into commission_entitlements (tenant_id, branch_id, contribution_id, staff_id, amount, basis, fact_kind, fact_id, accrued_at)
          values ($1, $2, $3, $4, $5, $5, 'execution', gen_random_uuid(), $6) returning id`, [w.t, w.b1, c, nurse.staffId, amount, accrued])).rows[0].id as string;
      };
      const open = await ent(70_000, days(10)); // accrued, in no batch
      void open;
      if (paidNet !== null) {
        const paidE = await ent(paidNet, days(12));
        const ap = (await q(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, amount_rupiah, state, requested_by, requested_as, decided_by, decided_as, decided_at)
          values ($1, 'commission_batch', 'payout_batch', gen_random_uuid(), 'Uji', 1, 'approved', $2, 'finance', $3, 'owner', $4) returning id`, [w.t, nurse.staffId, w.owner.staffId, days(5)])).rows[0].id as string;
        const batch = (await q(`insert into payout_batches (tenant_id, period_key, period_start, period_end, closing_day, state, approval_id, submitted_by, submitted_at, paid_by, paid_at, paid_method, created_by, command_key)
          values ($1, '2025-01', '2025-01-01 00:00:00+07', '2025-01-28 00:00:00+07', 'month_end', 'paid', $2, $3, $4, $3, $4, 'transfer', $3, $5) returning id`, [w.t, ap, w.owner.staffId, days(5), `pb-${crypto.randomUUID()}`])).rows[0].id as string;
        await q(`insert into payout_batch_items (tenant_id, batch_id, staff_id, entitlement_id, amount) values ($1, $2, $3, $4, $5)`, [w.t, batch, nurse.staffId, paidE, paidNet]);
        await q(`insert into payout_batch_lines (tenant_id, batch_id, staff_id, gross, adjustments, carry_forward_in, net_payable, carry_forward_out) values ($1, $2, $3, $4, 0, 0, $4, 0)`, [w.t, batch, nurse.staffId, paidNet]);
      }
    });
    return w;
  }

  it("K17 on the real reader: an unallocated payout is by_branch['-'].paid_net — consolidated owed stays valid, the branch's owed is unavailable (never gross, never prorated, never Rp0)", async () => {
    const w = await commission(200_000); // 270.000 accrued at A, 200.000 paid net (a batch line is per staff, not per branch) → owed 70.000
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    // the contract, read from the reader itself
    const raw = await w.as(w.owner, (db) => kpi(db, { kpi: "k17", from: `${today.slice(0, 8)}01`, to: today }));
    expect(raw.total).toBe(70_000);
    expect(raw.by_dim).toEqual({ accrued: 270_000, paid_net: -200_000 });
    expect(raw.by_branch).toEqual({ [w.b1]: { accrued: 270_000 }, "-": { paid_net: -200_000 } });
    // the loader: consolidated owed is the reader's total; a branch is unavailable while the payment is unallocated
    const s = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
    if (s.kind !== "ok") throw new Error("summary not ok");
    expect(s.data.k17.amount).toEqual(v(70_000));
    const lg = await w.as(w.owner, (db) => leagueIn(db, w.branches, {}, new Date()));
    expect(lg.rows.find((r) => r.branchId === w.b1)?.k17).toMatchObject({ state: "unavailable" });
    expect(lg.rows.find((r) => r.branchId === w.b2)?.k17).toMatchObject({ state: "unavailable" }); // an unallocated payment makes EVERY branch unprovable
    const d = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b1, {}, new Date()));
    expect(d.kind === "ok" && d.data.k17.amount).toMatchObject({ state: "unavailable" });
    // unknown sorts after known: nothing else is known here, so the order falls back to the branch name
    expect(sortLeague(lg.rows, "k17").map((r) => r.name)).toEqual(["Cabang A", "Cabang B"]);
  });

  it("K17 with no payout at all: the branch shows its own owed (accrued 70.000), the consolidated figure agrees", async () => {
    const w = await commission(null);
    const s = await w.as(w.owner, (db) => summaryIn(db, "owner", w.branches, {}, new Date()));
    if (s.kind !== "ok") throw new Error("summary not ok");
    expect(s.data.k17.amount).toEqual(v(70_000));
    const lg = await w.as(w.owner, (db) => leagueIn(db, w.branches, {}, new Date()));
    expect(lg.rows.find((r) => r.branchId === w.b1)?.k17).toEqual(v(70_000));
    expect(lg.rows.find((r) => r.branchId === w.b2)?.k17).toEqual(v(0)); // no rows at B: a real Rp0 (nothing is allocated anywhere)
    const d = await w.as(w.owner, (db) => detailIn(db, "owner", w.branches, w.b1, {}, new Date()));
    expect(d.kind === "ok" && d.data.k17.amount).toEqual(v(70_000));
  });
});

// ── T-109 r1 repairs (independent review 4baeaa88, Sol decision SOL-WIRING-R1-DECISION): rendered / behavioural regressions, synthetic fixtures only ────────────────
const kpA = "11111111-1111-4111-8111-111111111111";
const kpB = "22222222-2222-4222-8222-222222222222";
const plot = (out: string) => (out.match(/<svg viewBox="0 0 320 120" role="img"[\s\S]*?<\/svg>/) ?? [""])[0];
const ys = (path: string) => [...path.matchAll(/[ML]([\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
const pathOf = (out: string, stroke: "chart-1" | "chart-2") => (plot(out).match(new RegExp(`<path d="([^"]*)"[^>]*stroke="var\\(--${stroke}\\)"`)) ?? ["", ""])[1];
const baselineY = (out: string) => Number((plot(out).match(/data-baseline="rp0" x1="0" x2="320" y1="([\d.]+)"/) ?? [])[1]);
const wk = (...v: (number | null)[][]) => v.map(([a, b], i) => ({ label: `M${i + 1}`, k1: a === null ? na() : v_(a), k2: b === null ? na() : v_(b) }));
const v_ = (n: number): Amount => ({ state: "value", rp: n });
const trendHtml = (trend: OwnerSummaryData["trend"]) => html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c", state: { kind: "ready", data: summary({ trend }) } }));

describe("finding 3 — the trend scale holds signed values (a refund-heavy week is negative)", () => {
  it("the domain always contains Rp0 and every known value; zero sits at the bottom edge for non-negative data, the top edge for all-negative data, in between for mixed data", () => {
    expect(trendDomain([])).toEqual({ lo: 0, hi: 1 }); // nothing known: a flat Rp0 line, no division by zero
    expect(trendDomain([5, 9])).toEqual({ lo: 0, hi: 9 });
    expect(trendDomain([-200_000, -900_000])).toEqual({ lo: -900_000, hi: 0 });
    expect(trendDomain([500_000, -300_000])).toEqual({ lo: -300_000, hi: 500_000 });
    expect(trendY(0, trendDomain([5, 9]))).toBe(112); // bottom edge (H - 8)
    expect(trendY(9, trendDomain([5, 9]))).toBe(8); // top edge
    expect(trendY(0, trendDomain([-200_000, -900_000]))).toBe(8); // all-negative: Rp0 is the TOP edge
    expect(trendY(-900_000, trendDomain([-200_000, -900_000]))).toBe(112);
  });

  it("rendered, mixed signs: every point of both series stays inside the plot, Rp0 is a baseline between them, and the negative week is below it", () => {
    const out = trendHtml(wk([500_000, 100_000], [-300_000, 0], [200_000, -100_000]));
    const all = [...ys(pathOf(out, "chart-1")), ...ys(pathOf(out, "chart-2"))];
    expect(all).toHaveLength(6);
    for (const y of all) { expect(y).toBeGreaterThanOrEqual(8); expect(y).toBeLessThanOrEqual(TREND_H - 8); }
    const base = baselineY(out);
    expect(base).toBeGreaterThan(8); expect(base).toBeLessThan(112); // zero is between the extremes
    const k1 = ys(pathOf(out, "chart-1"));
    expect(k1[1]).toBeGreaterThan(base); // −300.000 is BELOW the baseline (a larger y is lower on screen)
    expect(k1[0]).toBeLessThan(base); // +500.000 is above it
    expect(out).toContain('data-trend-note="negative"');
    expect(out).toContain("Minggu di bawah garis dasar");
    expect(text(out)).toContain(rp(-300_000)); // the data table still reports the actual (negative) value
  });

  it("rendered, all negative: Rp0 is the top edge and the deepest week the bottom edge — none of them leaves the viewBox", () => {
    const out = trendHtml(wk([-200_000, -900_000], [-900_000, -100_000], [-50_000, -400_000]));
    const all = [...ys(pathOf(out, "chart-1")), ...ys(pathOf(out, "chart-2"))];
    for (const y of all) { expect(y).toBeGreaterThanOrEqual(8); expect(y).toBeLessThanOrEqual(112); }
    expect(baselineY(out)).toBe(8);
    expect(Math.max(...all)).toBe(112); // −900.000 is the deepest
    expect(out).toContain('data-trend-note="negative"');
  });

  it("non-negative data keeps Rp0 on the bottom edge and shows no negative note; unavailable weeks are gaps in the line, never points at Rp0", () => {
    const out = trendHtml(wk([100, 40], [null, 60], [300, null], [200, 80]));
    expect(baselineY(out)).toBe(112);
    expect(out).not.toContain('data-trend-note="negative"');
    const k1 = pathOf(out, "chart-1");
    expect(k1.match(/M/g)).toHaveLength(2); // week 2 unavailable → the line breaks: M..., then M again for weeks 3–4
    expect(ys(k1)).toHaveLength(3); // three KNOWN K1 weeks, no point at zero for the gap
    expect(Math.min(...ys(k1))).toBe(8);
  });

  it("an all-zero series is a flat line on the bottom edge, not NaN", () => {
    const out = trendHtml(wk([0, 0], [0, 0]));
    expect(out).not.toContain("NaN");
    for (const y of [...ys(pathOf(out, "chart-1")), ...ys(pathOf(out, "chart-2"))]) expect(y).toBe(112);
  });
});

describe("finding 4 — the selected period travels on every link between summary, league, branch and back", () => {
  const kinds = ["minggu", "bulan"] as const;

  it("the builders carry the period (and the sort keeps it)", () => {
    for (const k of kinds) {
      expect(C.leagueHref(k)).toBe(`/ringkasan/owner/cabang?periode=${k}`);
      expect(C.branchHref(kpA, k)).toBe(`/ringkasan/owner/cabang/${kpA}?periode=${k}`);
      for (const key of LEAGUE_KEYS) expect(C.sortHrefs(k)[key]).toBe(`/ringkasan/owner/cabang?urut=${key}&periode=${k}`);
    }
  });

  it.each(kinds)("summary → league → branch → back stays on %s: the loaders hand the views period-carrying hrefs, and the views render them", async (k) => {
    const q = { periode: k };
    const s = await summaryIn(fakeDb({}) as never, "owner", BR, q, NOW);
    if (s.kind !== "ok") throw new Error("summary");
    expect(s.league.map((r) => r.href)).toEqual(BR.map((b) => `/ringkasan/owner/cabang/${b.id}?periode=${k}`)); // summary league rows → detail
    const sumOut = html(h(OwnerSummary, { scope: s.scope, period: { label: s.periods.label, basis: s.periods.basis, previousLabel: s.periods.previousLabel }, leagueHref: C.leagueHref(s.periods.kind), league: s.league, state: { kind: "ready", data: s.data } }));
    expect(sumOut).toContain(`href="/ringkasan/owner/cabang?periode=${k}"`); // "Buka Cabang"
    for (const b of BR) expect(sumOut).toContain(`href="/ringkasan/owner/cabang/${b.id}?periode=${k}"`);
    const lg = await leagueIn(fakeDb({}) as never, BR, q, NOW);
    expect(lg.rows.map((r) => r.href)).toEqual(BR.map((b) => `/ringkasan/owner/cabang/${b.id}?periode=${k}`)); // league rows → detail
    const lgOut = html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort: "k1", sortHrefs: C.sortHrefs(lg.periods.kind), state: { kind: "ready", data: lg.rows } }));
    for (const b of BR) expect(lgOut).toContain(`href="/ringkasan/owner/cabang/${b.id}?periode=${k}"`);
    const d = await detailIn(fakeDb({}) as never, "owner", BR, BR[0].id, q, NOW);
    if (d.kind !== "ok") throw new Error("detail");
    const dtOut = html(h(BranchDetail, { branch: d.branch.name, backHref: C.leagueHref(d.periods.kind), period, state: { kind: "ready", data: d.data } }));
    expect(dtOut).toContain(`href="/ringkasan/owner/cabang?periode=${k}"`); // back to the league, same period
  });

  it("no link anywhere on the three screens points at the league or a branch WITHOUT a period", async () => {
    for (const k of kinds) {
      const s = await summaryIn(fakeDb({}) as never, "owner", BR, { periode: k }, NOW);
      const lg = await leagueIn(fakeDb({}) as never, BR, { periode: k }, NOW);
      if (s.kind !== "ok") throw new Error("summary");
      const outs = [
        html(h(OwnerSummary, { scope: s.scope, period, leagueHref: C.leagueHref(s.periods.kind), league: s.league, state: { kind: "ready", data: s.data } })),
        html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort: "k1", sortHrefs: C.sortHrefs(lg.periods.kind), state: { kind: "ready", data: lg.rows } })),
        html(h(BranchDetail, { branch: "Cabang A", backHref: C.leagueHref(s.periods.kind), period, state: { kind: "ready", data: s.data } })),
      ];
      for (const out of outs) for (const m of out.matchAll(/href="(\/ringkasan\/owner\/cabang[^"]*)"/g)) expect(m[1], `link without period: ${m[1]}`).toContain(`periode=${k}`);
    }
  });
});

describe("finding 5 — a league figure that is not a number says why, as text a keyboard / touch / zoom user reads", () => {
  const sortHrefs = C.sortHrefs("minggu");
  const lgHtml = (r: LeagueRow, sort: LeagueKey = "k1") => html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort, sortHrefs, state: { kind: "ready", data: [r] } }));
  const K17_REASON = "Pembayaran komisi dicatat per batch, bukan per cabang, jadi komisi terutang per cabang belum dapat dipastikan";

  it("an unallocated-payout K17 shows 'Belum tersedia' AND the reason in the card's own text — in the list and as the sorted figure — not only in a tooltip", () => {
    const r = row("b1", "Cabang 1", { k17: k17ForBranch({ total: 120_000, by_dim: { accrued: 230_000, adjusted: -10_000, paid_net: -100_000 }, by_branch: { b1: { accrued: 230_000, adjusted: -10_000 }, [UNBRANCHED]: { paid_net: -100_000 } } }, "b1") });
    for (const sort of ["k1", "k17"] as const) {
      const out = lgHtml(r, sort);
      expect(text(out)).toContain(K17_REASON);
      expect(out).not.toContain("title="); // the reason is never only a tooltip
      expect(out).toContain('data-reason=""');
    }
    expect(text(lgHtml(r))).toContain(`${LEAGUE_LABEL.k17} Belum tersedia ${K17_REASON}`); // beside its own label
  });

  it("every unavailable kind carries its reason: amount, K7, K10, ratio, a zero denominator and a failed reader", () => {
    const r = row("b1", "Cabang 1", {
      k1: na("alasan-k1"), k7: { amount: na("alasan-k7") }, k10: { state: "unavailable", reason: "alasan-k10" }, k8: { state: "unavailable", reason: "alasan-k8" },
      k11: { state: "value", num: 0, den: 0 }, k12: { state: "unavailable", reason: "Pembacaan belum tersedia" },
    });
    const t = text(lgHtml(r, "k2"));
    for (const reason of ["alasan-k1", "alasan-k7", "alasan-k10", "alasan-k8", "Pembacaan belum tersedia"]) expect(t, reason).toContain(reason);
    expect(t).toContain(`${LEAGUE_LABEL.k11} Belum tersedia Belum ada data pada periode ini`); // 0 / 0 is not a failure, but it has no rate and says so
    expect(t).not.toMatch(/(^|[^\d,.])0%/); // no bare 0 % (the 50 % of the other cells is a different figure)
  });

  it("the summary's league rows say why too (no mouse-only 'Belum tersedia')", () => {
    const out = html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c", league: [row("b1", "Cabang 1", { k1: na("alasan-ringkasan") })], state: { kind: "ready", data: summary() } }));
    expect(text(out)).toContain("Uang masuk Belum tersedia (alasan-ringkasan)");
  });
});

describe("finding 1 — K9 renders the whole result: count and value at 30 / 60 / 90 days, the league cell labelled as the 30-day count", () => {
  const A = "branch-a";
  const kp9 = kp(null, {}, { [A]: { recommended_count: 4, recommended_value: 4_000_000, selected_30_count: 1, selected_30_value: 1_000_000, selected_60_count: 2, selected_60_value: 2_500_000, selected_90_count: 3, selected_90_value: 3_250_000 } });
  const lg9 = (p: KpiPayload | null, b = A) => ({ ...row(b, "Cabang A"), k9: C.k9League(p, b), k9Detail: C.k9Detail(p, b) });
  const lgOut = (r: LeagueRow, sort: LeagueKey = "k1") => html(h(BranchLeague, { scope: { label: "Semua Cabang", filtered: false }, period, sort, sortHrefs: C.sortHrefs("minggu"), state: { kind: "ready", data: [r] } }));

  it("the league label says '30 hari' and 'jumlah' (the count basis); the sort control carries the same label", () => {
    expect(LEAGUE_LABEL.k9).toBe("Rencana dipilih, jumlah 30 hari (K9)");
    const out = lgOut(lg9(kp9));
    expect(text(out)).toContain("Rencana dipilih, jumlah 30 hari (K9) 25%");
    expect(out).toContain(`>${LEAGUE_LABEL.k9}</a>`); // the sort chip
  });

  it("an expansion shows every window as count AND value with its percentage — 30, 60, 90 — keyboard-reachable (<details>/<summary>)", () => {
    const out = lgOut(lg9(kp9));
    expect(out).toMatch(/<details data-k9=""[^>]*><summary[^>]*>Rencana dipilih: 30, 60, 90 hari<span class="sr-only"> Cabang A<\/span><\/summary>/); // the branch is named for a screen reader
    const t = text(out);
    expect(t).toContain("30 hari Jumlah: 1 dari 4 (25%) Nilai: Rp1.000.000 dari Rp4.000.000 (25%)");
    expect(t).toContain("60 hari Jumlah: 2 dari 4 (50%) Nilai: Rp2.500.000 dari Rp4.000.000 (62,5%)");
    expect(t).toContain("90 hari Jumlah: 3 dari 4 (75%) Nilai: Rp3.250.000 dari Rp4.000.000 (81,3%)");
    for (const n of K9_WINDOWS) expect(out).toContain(`data-k9-window="${n}"`);
  });

  it("a zero denominator is preserved as 'Belum tersedia' with its reason — never 0 % and never a share of nothing", () => {
    const empty = kp(null, {}, { [A]: {} });
    const out = lgOut(lg9(empty));
    const t = text(out);
    expect(t).toContain("Rencana dipilih, jumlah 30 hari (K9) Belum tersedia Belum ada rencana yang disarankan pada periode ini");
    expect(t).toContain("30 hari Jumlah: Belum tersedia. Belum ada rencana yang disarankan pada periode ini Nilai: Belum tersedia. Belum ada nilai rencana yang disarankan pada periode ini");
    expect(t).not.toMatch(/(^|[^\d,.])0%/);
  });

  it("a branch with a count denominator but no value denominator keeps the two apart; a failed reader says so", () => {
    const mixed = kp(null, {}, { [A]: { recommended_count: 2, selected_30_count: 1 } }); // value denominator absent = 0
    const t = text(lgOut(lg9(mixed)));
    expect(t).toContain("30 hari Jumlah: 1 dari 2 (50%) Nilai: Belum tersedia. Belum ada nilai rencana yang disarankan pada periode ini"); // plans exist (2) but carry no value: not "no plan"
    const failed = text(lgOut({ ...row(A, "Cabang A"), k9: { state: "unavailable", reason: "Pembacaan belum tersedia" }, k9Detail: C.k9Detail(null, A) }));
    expect(failed).toContain("Belum tersedia. Pembacaan belum tersedia");
  });

  it("the summary's league section does not pretend to carry K9: it points to the Cabang page", () => {
    const t = text(html(h(OwnerSummary, { scope: { label: "Semua Cabang", filtered: false }, period, leagueHref: "/c", league: [C.summaryLeagueRow({ id: A, name: "Cabang A" }, null, null, "/x")], state: { kind: "ready", data: summary() } })));
    expect(t).not.toContain("K9");
  });
});

describe("finding 2 — K13 by source: separate channels stay visible; a branch is the reader's own branch answer, never the clinic's groups cut down", () => {
  const funnelOnly = (out: string) => (out.match(/<section aria-labelledby="funnel"[\s\S]*?<\/section><\/div>/) ?? [out])[0];
  const clinic = {
    total: null as number | null, branch_id: null,
    by_dim: { lead: 5, booked: 2, arrived: 1, paid: 1 },
    by_grp1: { instagram: { lead: 2, booked: 2, arrived: 1, paid: 1 }, phone: { lead: 1 }, ads: { lead: 2 } },
  };
  const forBranchA = { total: null as number | null, branch_id: kpA, by_dim: { lead: 3, booked: 2, arrived: 1, paid: 1 }, by_grp1: { instagram: { lead: 2, booked: 2, arrived: 1, paid: 1 }, phone: { lead: 1 } } };
  const sum = (k13: C.K13Payload | null, branchId: string | null, over: Partial<Parameters<typeof owner>[0]> = {}) =>
    html(h(OwnerSummary, { scope: { label: "x", filtered: branchId !== null }, period, leagueHref: "/c", state: { kind: "ready", data: owner({ k13, branchId, ...over }) } }));

  it("renders one block per source with its own four counts (Indonesian labels), largest first; the totals above stay the clinic's", () => {
    const out = funnelOnly(sum(clinic, null));
    const t = text(out);
    expect(t).toContain("Lead 5 Booking 2 Datang 1 Bayar 1"); // the totals
    expect(t).toContain("Per sumber");
    expect(out).toContain('data-source="instagram"'); expect(out).toContain('data-source="phone"'); expect(out).toContain('data-source="ads"');
    expect(t).toContain("Instagram Lead 2 · Booking 2 · Datang 1 · Bayar 1");
    expect(t).toContain("Telepon Lead 1 · Booking 0 · Datang 0 · Bayar 0");
    expect(t).toContain("Iklan Lead 2 · Booking 0 · Datang 0 · Bayar 0");
    // most leads first; a tie is ordered by label ("Iklan" before "Instagram"); the 1-lead source last
    expect(t.indexOf("Iklan Lead")).toBeLessThan(t.indexOf("Instagram Lead"));
    expect(t.indexOf("Instagram Lead")).toBeLessThan(t.indexOf("Telepon Lead"));
  });

  it("a branch view takes the reader's OWN branch answer: its sources are that branch's, with the branch's totals", () => {
    const out = funnelOnly(sum(forBranchA as never, kpA));
    const t = text(out);
    expect(t).toContain("Lead 3 Booking 2 Datang 1 Bayar 1");
    expect(out).toContain('data-source="instagram"'); expect(out).toContain('data-source="phone"');
    expect(out).not.toContain('data-source="ads"'); // the clinic's ads leads belong to another branch
  });

  it("a branch view REFUSES the clinic-wide answer: it never reuses tenant-wide source groups for one branch (and a clinic view refuses a branch answer)", () => {
    const t1 = text(funnelOnly(sum(clinic, kpA)));
    expect(t1).toContain("Belum tersedia"); expect(t1).toContain("Funnel belum dibaca untuk cakupan ini");
    expect(t1).not.toContain("Instagram");
    const t2 = text(funnelOnly(sum(forBranchA as never, null)));
    expect(t2).toContain("Funnel belum dibaca untuk cakupan ini");
    const t3 = text(funnelOnly(sum(forBranchA as never, kpB)));
    expect(t3).toContain("Funnel belum dibaca untuk cakupan ini"); // another branch's answer
  });

  it("a breakdown that does not add up to its own funnel is unavailable (the totals stay), never shown", () => {
    const bad = { ...clinic, by_grp1: { instagram: { lead: 2, booked: 2, arrived: 1, paid: 1 }, phone: { lead: 1 } } }; // 3 leads against a funnel of 5
    const t = text(funnelOnly(sum(bad, null)));
    expect(t).toContain("Lead 5 Booking 2 Datang 1 Bayar 1");
    expect(t).toContain("Per sumber: Belum tersedia. Rincian per sumber tidak cocok dengan total funnel");
    expect(t).not.toContain("Instagram Lead");
    const unknown = { ...clinic, by_grp1: { instagram: { lead: 5, booked: 2, arrived: 1, paid: 1, spam: 9 } } };
    expect(text(funnelOnly(sum(unknown as never, null)))).toContain("Rincian per sumber belum dikenali");
    const nan = { ...clinic, by_grp1: { instagram: { lead: 5.5, booked: 2, arrived: 1, paid: 1 } } };
    expect(text(funnelOnly(sum(nan as never, null)))).toContain("Nilai tidak valid");
    const none: C.K13Payload = { total: null, branch_id: null, by_dim: clinic.by_dim };
    expect(text(funnelOnly(sum(none, null)))).toContain("Rincian per sumber belum tersedia");
  });

  it("no leads at all is a real empty state, not an error; an unknown source keeps its raw key as the label", () => {
    const empty: C.K13Payload = { total: null, branch_id: null, by_dim: {}, by_grp1: {} };
    expect(text(funnelOnly(sum(empty, null)))).toContain("Belum ada lead pada periode ini");
    const odd: C.K13Payload = { total: null, branch_id: null, by_dim: { lead: 1 }, by_grp1: { podcast: { lead: 1 } } };
    expect(text(funnelOnly(sum(odd, null)))).toContain("podcast Lead 1");
  });

  it("the loader asks the reader for the branch itself: summary = clinic-wide K13, a branch page = K13 with p_branch = that branch (same number of calls)", async () => {
    const seen: unknown[][] = [];
    const wrap = (db: ReturnType<typeof fakeDb>) => { const q = db.query.bind(db); db.query = async (sql: string, args: unknown[] = []) => { if (sql.includes("dashboard_kpi") && args[0] === "k13") seen.push(args); return q(sql, args); }; return db; };
    const a = wrap(fakeDb({ kpi: (k) => (k === "k13" ? { total: null, by_dim: { lead: 1 }, by_branch: {}, by_grp1: { phone: { lead: 1 } }, extra: null } as never : { total: null, by_dim: {}, by_branch: {}, extra: null } as never) }));
    await summaryIn(a as never, "owner", BR, {}, NOW);
    expect(seen).toHaveLength(1); expect(seen[0][3]).toBeNull();
    seen.length = 0;
    const b = wrap(fakeDb({ kpi: (k) => (k === "k13" ? { total: null, by_dim: { lead: 1 }, by_branch: {}, by_grp1: { phone: { lead: 1 } }, extra: null } as never : { total: null, by_dim: {}, by_branch: {}, extra: null } as never) }));
    const d = await detailIn(b as never, "owner", BR, BR[1].id, {}, NOW);
    expect(seen).toHaveLength(1); expect(seen[0][3]).toBe(BR[1].id);
    expect(b.calls.filter((c) => c.sql.includes("dashboard_kpi"))).toHaveLength(READS.summary); // the branch call REPLACES the clinic one: the count does not grow
    if (d.kind !== "ok") throw new Error("detail");
    expect(d.data.funnel).toMatchObject({ state: "value", sources: { state: "rows" } });
  });

  it("a foreign / malformed branch is not-found BEFORE any K13 (or other) read — the branch selector is never given an unvalidated id", async () => {
    const db = fakeDb({});
    expect(await detailIn(db as never, "owner", BR, "99999999-9999-4999-8999-999999999999", {}, NOW)).toEqual({ kind: "not-found" });
    expect(db.calls).toEqual([]);
  });
});
