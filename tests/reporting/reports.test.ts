// T-116 (PR-95, UX-38, UX-59) slice 1 — no database. Synthetic facts (one tenant, branches A and B, period 2026-10, Asia/Jakarta
// local days); every expected value below is worked by hand from the Appendix A text, never produced by the calculator under test.
// Proves: the dictionary has K1–K27 and each entry's `spec` equals the 02-PRD.md Appendix A row; K20–K27 equal their fixtures;
// unavailable is never 0 / Rp0; Scenario PR-95 (Laporan Pasien → definition of churn → the dictionary entry); the views render every
// state without patient names or clinical text. The SQL readers (next slice) must return these numbers on the same facts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KamusKpiView, parseReport } from "../../src/app/(app)/laporan/kamus-kpi/view";
import { type ReportKpi, type ReportProps, ReportView, reportState } from "../../src/app/(app)/laporan/_components/report-view";
import {
  addMonths, type DispensingFact, type ExamFact, type Invoice, k20, k21, k22, k23, k24, k25, k26, k27, type PaymentFact,
  type PromoUsageFact, type RequestFact, type SaleReduction, type SurveyFact, type VisitFact,
} from "../../src/modules/reporting/reports/calculators";
import { anchor, BY_ID, DICTIONARY, definitionHref, REPORTS, reportsOf } from "../../src/modules/reporting/reports/dictionary";
import { median, type Metric, money, pending, show } from "../../src/modules/reporting/reports/metrics";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { ROLES, type Role } from "../../src/auth/policy";
import { LEVEL3_ROLES } from "../../src/modules/org/schema";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { setStaffTarget } from "../../src/modules/commission/targets/targets";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { kpi, type KpiResult } from "../../src/modules/reporting/dashboards/dashboards";
import { fromKpi, fromTargets, loadReport, wholeMonth } from "../../src/modules/reporting/reports/live";
import { decode, read, ReaderShapeError } from "../../src/modules/reporting/reports/readers";
import { openShift } from "../../src/modules/cashier/shifts/shifts";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { createHarness, type Harness, testPool } from "../rls/harness";

const P = { from: "2026-10-01", to: "2026-10-31" };
const M = (rupiah: number): Metric => ({ kind: "money", rupiah });
const C = (value: number): Metric => ({ kind: "count", value });
const R = (num: number, den: number): Metric => ({ kind: "ratio", num, den });
const D = (seconds: number): Metric => ({ kind: "duration", seconds });
const NONE: Metric = { kind: "unavailable", reason: "no_data" };

// ── dictionary ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("KPI dictionary K1–K27 (UX-59)", () => {
  const prd = readFileSync(join(__dirname, "../../docs/spec/02-PRD.md"), "utf8");
  const appendix = prd.split("## Appendix A — KPI Dictionary (K1–K27)")[1].split("\n## ")[0];
  const rows = new Map(appendix.split("\n").filter((l) => /^\| K\d+ \|/.test(l)).map((l) => {
    const c = l.split(" | ").map((x) => x.replace(/^\| /, "").replace(/ \|$/, ""));
    return [c[0], { kpi: c[1], definition: c[2], attribution: c[3], sources: c[4] }] as const;
  }));

  it("has exactly K1–K27, in order, each equal to its Appendix A row", () => {
    expect(DICTIONARY.map((k) => k.id)).toEqual(Array.from({ length: 27 }, (_, i) => `K${i + 1}`));
    expect(rows.size).toBe(27);
    for (const k of DICTIONARY) expect(k.spec, k.id).toEqual(rows.get(k.id));
  });

  it("every entry has Indonesian label, definition, attribution, sources and a version", () => {
    for (const k of DICTIONARY) {
      expect(k.label, k.id).toBe(k.spec.kpi); // Appendix A labels are already Bahasa Indonesia
      for (const f of [k.definition, k.attribution, k.sources]) expect(f.length, k.id).toBeGreaterThan(3);
      expect(k.definition, k.id).not.toBe(k.spec.definition);
      expect(k.version).toBe(1);
    }
    expect(BY_ID.get("K7")!.markers.map((m) => m.kind)).toContain("estimasi");
    expect(BY_ID.get("K11")!.versionedBy).toBe("SET-22");
    expect(BY_ID.get("K21")!.versionedBy).toBe("SET-22");
    // store words never appear (P-13 glossary)
    const all = JSON.stringify(DICTIONARY.map((k) => ({ ...k, spec: undefined })));
    for (const w of ["Keranjang", "Checkout", "Pesanan", "Pembeli", "Pengiriman"]) expect(all).not.toContain(w);
  });

  it("every K20–K27 is used by a report and every report links into the dictionary", () => {
    for (const id of ["K20", "K21", "K22", "K23", "K24", "K25", "K26", "K27"] as const) expect(reportsOf(id).length, id).toBeGreaterThan(0);
    expect(REPORTS.pasien.kpis).toContain("K21");
    expect(definitionHref("K21")).toBe("/laporan/kamus-kpi#k21");
  });
});

// ── K20 / K22 / K23 facts ──────────────────────────────────────────────────────────────────────────────────────────────────
// I1 A P1  2026-10-02 shift SH1: product 333,000 + product 222,000                       → sale 555,000
// I2 A P2  2026-10-03 shift SH1: service 1,500,000                                         → 1,500,000
// I3 A P2  2026-10-04 shift SH2: package 3,000,000 (sold once)                             → 3,000,000
// I4 A P3  2026-10-05 shift SH2: redemption 600,000 only                                   → 0 (not counted in K20)
// I5 A P1  2026-10-06 shift SH2: top_up 1,000,000 only                                     → 0
// I6 A P4  2026-10-07 shift SH2: service 400,000, VOID                                     → excluded
// I7 B P5  2026-10-10 shift SH3: service 750,000 + consultation 150,000                     → 900,000
// I8 A P3  2026-09-20 (before the period, no shift): service 2,000,000                      → K22 only
// I9 A P6  2026-10-12 no shift: product 100,000                                             → K23 "tanpa shift"
// Reductions: R1 refund of I1's serum 333,000 on 2026-10-09 (A, P1); R2 cancelled unpaid remainder of I8-style package? no —
//             R2 cancelled unpaid package remainder 1,000,000 of I3 on 2026-10-20 (A, P2); R3 refund 50,000 on 2026-11-02 (outside).
const invoices: Invoice[] = [
  { id: "I1", branch: "A", patient: "P1", day: "2026-10-02", state: "issued", shift: "SH1", lines: [{ kind: "product", value: 333_000 }, { kind: "product", value: 222_000 }] },
  { id: "I2", branch: "A", patient: "P2", day: "2026-10-03", state: "issued", shift: "SH1", lines: [{ kind: "service", value: 1_500_000 }] },
  { id: "I3", branch: "A", patient: "P2", day: "2026-10-04", state: "issued", shift: "SH2", lines: [{ kind: "package", value: 3_000_000 }] },
  { id: "I4", branch: "A", patient: "P3", day: "2026-10-05", state: "issued", shift: "SH2", lines: [{ kind: "redemption", value: 600_000 }] },
  { id: "I5", branch: "A", patient: "P1", day: "2026-10-06", state: "issued", shift: "SH2", lines: [{ kind: "top_up", value: 1_000_000 }] },
  { id: "I6", branch: "A", patient: "P4", day: "2026-10-07", state: "void", shift: "SH2", lines: [{ kind: "service", value: 400_000 }] },
  { id: "I7", branch: "B", patient: "P5", day: "2026-10-10", state: "issued", shift: "SH3", lines: [{ kind: "service", value: 750_000 }, { kind: "consultation", value: 150_000 }] },
  { id: "I8", branch: "A", patient: "P3", day: "2026-09-20", state: "issued", shift: null, lines: [{ kind: "service", value: 2_000_000 }] },
  { id: "I9", branch: "A", patient: "P6", day: "2026-10-12", state: "issued", shift: null, lines: [{ kind: "product", value: 100_000 }] },
];
const reductions: SaleReduction[] = [
  { invoice: "I1", branch: "A", patient: "P1", day: "2026-10-09", amount: 333_000, why: "refund" },
  { invoice: "I3", branch: "A", patient: "P2", day: "2026-10-20", amount: 1_000_000, why: "cancelled_unpaid_package" },
  { invoice: "I7", branch: "B", patient: "P5", day: "2026-11-02", amount: 50_000, why: "refund" },
];

describe("K20 Rata-rata transaksi", () => {
  it("equals its fixture", () => {
    // K3 all: 555,000 + 1,500,000 + 3,000,000 + 900,000 + 100,000 = 6,055,000 − 333,000 − 1,000,000 = 4,722,000
    // counted invoices (sale > 0, issued, in period): I1 I2 I3 I7 I9 = 5 → 4,722,000 / 5 = 944,400
    expect(k20(invoices, reductions, P)).toEqual({ k3: M(4_722_000), invoices: C(5), average: M(944_400) });
    // A: 555,000 + 1,500,000 + 3,000,000 + 100,000 − 1,333,000 = 3,822,000 over 4 = 955,500; B: 900,000 / 1
    expect(k20(invoices, reductions, P, "A").average).toEqual(M(955_500));
    expect(k20(invoices, reductions, P, "B")).toEqual({ k3: M(900_000), invoices: C(1), average: M(900_000) });
  });
  it("rounds half away from zero; no invoice is no data, not Rp0", () => {
    const three: Invoice[] = ["a", "b", "c"].map((id, i) => ({ id, branch: "A", patient: "P", day: "2026-10-01", state: "issued", shift: null,
      lines: [{ kind: "service", value: [100_000, 100_000, 100_001][i] }] }));
    expect(k20(three, [], P).average).toEqual(M(100_000)); // 300,001 / 3 = 100,000.33
    const two: Invoice[] = three.slice(0, 2).map((x, i) => ({ ...x, lines: [{ kind: "service", value: [1, 2][i] }] }));
    expect(k20(two, [], P).average).toEqual(M(2)); // 1.5 → 2
    expect(k20([], [], P).average).toEqual(NONE);
    expect(show(k20([], [], P).average)).toBe("Belum ada data");
  });
});

describe("K21 Churn", () => {
  // asOf 2026-10-31; 12-month window (2025-10-31, 2026-10-31]; dormant 90 days → dormant window (2026-08-02, 2026-10-31].
  const visits: VisitFact[] = [
    { patient: "P1", branch: "A", day: "2026-10-02" }, // active, recent
    { patient: "P2", branch: "A", day: "2026-03-10" }, { patient: "P2", branch: "B", day: "2026-06-01" }, // churned, last at B
    { patient: "P3", branch: "A", day: "2026-08-02" }, // exactly 90 days before: no visit in the last 90 days → churned
    { patient: "P4", branch: "B", day: "2026-08-03" }, // 89 days: active
    { patient: "P5", branch: "A", day: "2025-10-31" }, // exactly 12 months before: outside the window
    { patient: "P6", branch: "A", day: "2025-11-01" }, // inside the window, churned
    { patient: "P7", branch: "B", day: "2026-11-05" }, // after asOf: ignored
  ];
  it("equals its fixture with SET-22 = 90 days", () => {
    // active: P1 P2 P3 P4 P6 = 5; churned: P2 P3 P6 = 3 → 3 / 5 = 60.0%; last-visit branch: A {P1,P3,P6} 2/3, B {P2,P4} 1/2
    const r = k21(visits, "2026-10-31");
    expect(r.churn).toEqual(R(3, 5));
    expect(show(r.churn)).toBe("60,0%");
    expect(r.byBranch).toEqual([{ branch: "A", churn: R(2, 3) }, { branch: "B", churn: R(1, 2) }]);
  });
  it("a SET-22 change versions the result; out-of-bounds is refused", () => {
    // dormant 60: window (2026-09-01, …]: P3 (08-02) and P4 (08-03) now churned → P2 P3 P4 P6 = 4 / 5
    expect(k21(visits, "2026-10-31", 60).churn).toEqual(R(4, 5));
    expect(() => k21(visits, "2026-10-31", 13)).toThrow(RangeError);
    expect(() => k21(visits, "2026-10-31", 366)).toThrow(RangeError);
    expect(k21([], "2026-10-31").churn).toEqual(NONE);
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
});

describe("K22 Pasien teratas / LTV", () => {
  it("equals its fixture", () => {
    // to 2026-10-31: P2 1,500,000 + 3,000,000 − 1,000,000 = 3,500,000; P3 2,000,000 (I8; I4 redemption excluded);
    // P5 900,000 (R3 after asOf); P1 555,000 − 333,000 = 222,000 (I5 top-up excluded); P6 100,000; P4 voided → absent
    const r = k22(invoices, reductions, "2026-10-31");
    expect(r.rows.map((x) => [x.patient, x.ltv])).toEqual([
      ["P2", M(3_500_000)], ["P3", M(2_000_000)], ["P5", M(900_000)], ["P1", M(222_000)], ["P6", M(100_000)],
    ]);
    expect(k22(invoices, reductions, "2026-11-30").rows.find((x) => x.patient === "P5")!.ltv).toEqual(M(850_000));
    expect(k22(invoices, reductions, "2026-10-31", 2).rows).toHaveLength(2);
  });
  it("a family member's redemption never moves value from the package owner", () => {
    const fam: Invoice[] = [
      { id: "PK", branch: "A", patient: "OWNER", day: "2026-10-01", state: "issued", shift: null, lines: [{ kind: "package", value: 2_000_000 }] },
      { id: "RD", branch: "A", patient: "CHILD", day: "2026-10-05", state: "issued", shift: null, lines: [{ kind: "redemption", value: 500_000 }] },
    ];
    expect(k22(fam, [], "2026-10-31").rows.map((x) => [x.patient, x.ltv])).toEqual([["OWNER", M(2_000_000)]]);
  });
});

describe("K23 Penjualan dan uang masuk per shift", () => {
  const payments: PaymentFact[] = [
    { branch: "A", day: "2026-10-02", shift: "SH1", amount: 555_000, method: "cash", simulated: false },
    { branch: "A", day: "2026-10-03", shift: "SH1", amount: 1_500_000, method: "qris", simulated: false },
    { branch: "A", day: "2026-10-03", shift: "SH1", amount: 9_999, method: "qris", simulated: true }, // never K1
    { branch: "A", day: "2026-10-04", shift: "SH2", amount: 3_000_000, method: "edc", simulated: false },
    { branch: "A", day: "2026-10-05", shift: "SH2", amount: 600_000, method: "balance", simulated: false }, // balance use: not new cash
    { branch: "B", day: "2026-10-10", shift: "SH3", amount: 900_000, method: "transfer", simulated: false },
  ];
  const refunds = [{ branch: "A", day: "2026-10-09", shift: "SH2", amount: 333_000 }];
  const shifts = [{ id: "SH1", branch: "A", day: "2026-10-02" }, { id: "SH2", branch: "A", day: "2026-10-04" }, { id: "SH3", branch: "B", day: "2026-10-10" }];
  it("equals its fixture", () => {
    // SH1: K3 555,000 + 1,500,000 = 2,055,000; K1 2,055,000. SH2: K3 3,000,000 (I4, I5 not sales; I6 void); K1 3,000,000 − 333,000.
    // SH3 (B): 900,000 / 900,000. Tanpa shift (A): I9 100,000; no payment.
    expect(k23(shifts, invoices, payments, refunds, P).rows).toEqual([
      { shift: "SH1", branch: "A", k3: M(2_055_000), k1: M(2_055_000) },
      { shift: "SH2", branch: "A", k3: M(3_000_000), k1: M(2_667_000) },
      { shift: "SH3", branch: "B", k3: M(900_000), k1: M(900_000) },
      { shift: null, branch: "A", k3: M(100_000), k1: M(0) },
    ]);
  });
  it("R3 161ff9b9 F1 (pure): an overnight shift opened before the period is a row when it carries in-period facts, once; not otherwise", () => {
    const night = [{ id: "SHN", branch: "A", day: "2026-09-30" }];
    const inv: Invoice[] = [{ id: "IN", branch: "A", patient: "P", day: "2026-10-01", state: "issued", shift: "SHN", lines: [{ kind: "product", value: 250_000 }] }];
    const pay: PaymentFact[] = [{ branch: "A", day: "2026-10-01", shift: "SHN", amount: 250_000, method: "cash", simulated: false },
      { branch: "A", day: "2026-10-01", shift: "SHN", amount: 50_000, method: "cash", simulated: false }];
    expect(k23(night, inv, pay, [{ branch: "A", day: "2026-10-01", shift: "SHN", amount: 50_000 }], P).rows).toEqual([{ shift: "SHN", branch: "A", k3: M(250_000), k1: M(250_000) }]);
    expect(k23([...night, ...night], inv, pay, [], P).rows).toHaveLength(1); // listed once even if the reader repeats it
    expect(k23(night, [], [], [], P).rows).toEqual([]); // no in-period fact: not a row of this period
    expect(k23(night, [{ ...inv[0], day: "2026-09-30" }], [], [], P).rows).toEqual([]); // its only fact before the period
  });
  it("Panel 2 rule (Sol 2026-11-21: kept): an invoice issued before its cashier's shift opens is Tanpa shift; its payment counts in the shift that opened; totals reconcile", () => {
    const pre: Invoice[] = [{ id: "IP", branch: "A", patient: "P9", day: "2026-10-15", state: "issued", shift: null, lines: [{ kind: "product", value: 200_000 }] }];
    const auto = [{ id: "SHX", branch: "A", day: "2026-10-15" }];
    const paid: PaymentFact[] = [{ branch: "A", day: "2026-10-15", shift: "SHX", amount: 200_000, method: "cash", simulated: false }];
    const r = k23(auto, pre, paid, [], P).rows;
    expect(r).toEqual([{ shift: "SHX", branch: "A", k3: M(0), k1: M(200_000) }, { shift: null, branch: "A", k3: M(200_000), k1: M(0) }]);
    expect(r.reduce((x, y) => x + (y.k3 as { rupiah: number }).rupiah, 0)).toBe(r.reduce((x, y) => x + (y.k1 as { rupiah: number }).rupiah, 0));
  });
});

describe("K24 Waktu tunggu apotek", () => {
  const d = (branch: string, state: DispensingFact["state"], q: string, h: string | null): DispensingFact =>
    ({ branch, state, queuedAt: q, handedAt: h, handedDay: h ? h.slice(0, 10) : null });
  const ds = [
    d("A", "handed", "2026-10-02T09:00:00+07:00", "2026-10-02T09:12:00+07:00"), // 720 s
    d("A", "handed", "2026-10-02T10:00:00+07:00", "2026-10-02T10:05:30+07:00"), // 330 s
    d("A", "handed", "2026-10-03T11:00:00+07:00", "2026-10-03T11:40:00+07:00"), // 2,400 s
    d("A", "handed", "2026-10-04T11:00:00+07:00", "2026-10-04T11:07:00+07:00"), // 420 s
    d("A", "cancelled", "2026-10-04T12:00:00+07:00", null),
    d("A", "queued", "2026-10-05T12:00:00+07:00", null),
    d("B", "handed", "2026-10-05T08:00:00+07:00", "2026-10-05T08:03:00+07:00"), // 180 s
    d("A", "handed", "2026-09-30T08:00:00+07:00", "2026-09-30T09:00:00+07:00"), // outside
  ];
  it("equals its fixture", () => {
    // A: 330, 420, 720, 2,400 → (420 + 720) / 2 = 570 s = 9 menit 30 detik; all: 180, 330, 420, 720, 2,400 → 420 s
    expect(k24(ds, P, "A")).toEqual(D(570));
    expect(show(k24(ds, P, "A"))).toBe("9 menit 30 detik");
    expect(k24(ds, P)).toEqual(D(420));
    expect(k24(ds, { from: "2026-12-01", to: "2026-12-31" })).toEqual(NONE);
    expect(median([1, 2])).toBe(2);
  });
});

describe("K25 Performa kode promo", () => {
  const u = (promo: string, version: string, state: PromoUsageFact["state"], day: string | null, discount: number, lineValue: number, refundedInPeriod = 0): PromoUsageFact =>
    ({ promo, version, branch: "A", state, day, discount, lineValue, refundedInPeriod });
  const us = [
    u("HEMAT", "v1", "consumed", "2026-10-02", 50_000, 450_000),
    u("HEMAT", "v1", "consumed", "2026-10-03", 50_000, 950_000, 950_000), // refunded in the period
    u("HEMAT", "v2", "consumed", "2026-10-20", 75_000, 425_000),
    u("HEMAT", "v2", "reserved", null, 75_000, 425_000), // not used
    u("HEMAT", "v2", "reserved", "2026-10-21", 75_000, 425_000), // reserved on an open bill in the period: still not a use
    u("HEMAT", "v2", "released", null, 75_000, 425_000), // not used
    u("BARU", "v1", "consumed", "2026-09-30", 10_000, 90_000), // outside
  ];
  it("equals its fixture per code version", () => {
    expect(k25(us, P)).toEqual([
      { promo: "HEMAT", version: "v1", uses: C(2), discount: M(100_000), k3: M(450_000) },
      { promo: "HEMAT", version: "v2", uses: C(1), discount: M(75_000), k3: M(425_000) },
    ]);
  });
});

describe("K26 Kepuasan", () => {
  const s = (branch: string, day: string, score: number): SurveyFact => ({ branch, day, score });
  const ss = [s("A", "2026-10-01", 5), s("A", "2026-10-02", 4), s("A", "2026-10-03", 2), s("A", "2026-10-04", 1), s("B", "2026-10-05", 5), s("A", "2026-09-30", 1)];
  it("equals its fixture", () => {
    // all in period: 5, 4, 2, 1, 5 → 17 / 5 = 3.40; ≤ 2: 2 of 5 = 40.0%. A: 12 / 4 = 3.00, 2 / 4.
    expect(k26(ss, P)).toEqual({ average: { kind: "score", hundredths: 340 }, low: R(2, 5), responses: C(5) });
    expect(show(k26(ss, P).average)).toBe("3,40");
    expect(k26(ss, P, "A")).toEqual({ average: { kind: "score", hundredths: 300 }, low: R(2, 4), responses: C(4) });
    // 4, 5, 5 → 14 / 3 = 4.666… → 4.67
    expect(k26([s("A", "2026-10-01", 4), s("A", "2026-10-01", 5), s("A", "2026-10-01", 5)], P).average).toEqual({ kind: "score", hundredths: 467 });
    expect(k26([], P)).toEqual({ average: NONE, low: NONE, responses: C(0) });
    expect(() => k26([s("A", "2026-10-01", 6)], P)).toThrow(RangeError);
  });
});

describe("K27 Aktivitas dokter", () => {
  const ex = (doctor: string, state: ExamFact["state"], createdAt: string, checkedInAt: string, signedAt: string | null): ExamFact =>
    ({ doctor, branch: "A", state, createdAt, checkedInAt, signedAt, signedDay: signedAt ? signedAt.slice(0, 10) : null });
  const exams = [
    ex("D1", "signed", "2026-10-02T09:10:00+07:00", "2026-10-02T09:00:00+07:00", "2026-10-02T09:45:00+07:00"), // 45 min
    ex("D1", "signed", "2026-10-03T10:05:00+07:00", "2026-10-03T10:00:00+07:00", "2026-10-03T10:20:00+07:00"), // 20 min
    ex("D1", "signed", "2026-10-04T13:00:00+07:00", "2026-10-04T12:55:00+07:00", "2026-10-04T14:55:00+07:00"), // 120 min
    ex("D1", "draft", "2026-10-30T08:00:00+07:00", "2026-10-30T07:50:00+07:00", null), // 40 h before asOf: unsigned > 24 h
    ex("D1", "draft", "2026-10-31T10:00:00+07:00", "2026-10-31T09:50:00+07:00", null), // 14 h: not yet
    ex("D2", "signed", "2026-09-30T10:00:00+07:00", "2026-09-30T09:00:00+07:00", "2026-09-30T11:00:00+07:00"), // outside
  ];
  const rq = (doctor: string | null, state: RequestFact["state"], decidedDay: string | null): RequestFact => ({ doctor, branch: "A", state, decidedDay });
  const requests = [rq("D1", "approved", "2026-10-02"), rq("D1", "declined", "2026-10-03"), rq("D1", "pending", null), rq("D1", "cancelled", "2026-10-04"),
    rq("D2", "approved", "2026-10-05"), rq(null, "approved", "2026-10-06")];
  it("equals its fixture", () => {
    // D1: signed 3; unsigned > 24 h at 2026-11-01T00:00+07 = 1; decided 2; median(20, 45, 120) = 45 min = 2,700 s.
    // D2: nothing signed in the period, 1 decided, median no data.
    expect(k27(exams, requests, P, "2026-11-01T00:00:00+07:00")).toEqual([
      { doctor: "D1", signed: C(3), unsignedOver24h: C(1), requestsDecided: C(2), checkInToSignature: D(2_700) },
      { doctor: "D2", signed: C(0), unsignedOver24h: C(0), requestsDecided: C(1), checkInToSignature: NONE },
    ]);
  });
});

// ── K20–K27 reader payloads (slice 4): the JSON each report_kNN returns, decoded at the boundary, gives the SAME fixture numbers
// through the same calculator (the SQL migration is pending a slot; its DB proof runs on a throwaway database, see the handoff).
describe("K20–K27 reader boundary (decode → calculator = fixture)", () => {
  const inv = invoices.map((i) => ({ id: i.id, branch_id: i.branch, day: i.day, state: i.state, shift_id: i.shift,
    sale_value: i.state === "issued" ? i.lines.filter((l) => !["redemption", "top_up"].includes(l.kind)).reduce((x, l) => x + l.value, 0) : 0 }));
  const red = reductions.map((r) => ({ invoice_id: r.invoice, branch_id: r.branch, day: r.day, amount: String(r.amount), why: r.why }));
  it("K20: the reader's invoices (sale value at issue) and reductions in the period", () => {
    const inP = (d: string) => d >= P.from && d <= P.to;
    const d = decode.k20({ from: P.from, to: P.to, invoices: inv.filter((x) => inP(x.day)), reductions: red.filter((x) => inP(x.day)) });
    expect(k20(d.invoices, d.reductions, d.period)).toEqual({ k3: M(4_722_000), invoices: C(5), average: M(944_400) });
  });
  it("K21: last visit per patient in the window + SET-22 days", () => {
    const d = decode.k21({ as_of: "2026-10-31", dormant_days: 90, visits: [
      { patient: "P1", branch_id: "A", day: "2026-10-02" }, { patient: "P2", branch_id: "B", day: "2026-06-01" }, { patient: "P3", branch_id: "A", day: "2026-08-02" },
      { patient: "P4", branch_id: "B", day: "2026-08-03" }, { patient: "P6", branch_id: "A", day: "2025-11-01" }] });
    expect(k21(d.visits, d.asOf, d.dormantDays).churn).toEqual(R(3, 5));
    // the reader's SET-22 value is used, not the default: 60 days churns P4 (2026-08-03) too
    const d60 = decode.k21({ as_of: "2026-10-31", dormant_days: "60", visits: [{ patient: "P4", branch_id: "B", day: "2026-08-03" }] });
    expect(d60.dormantDays).toBe(60);
    expect(k21(d60.visits, d60.asOf, d60.dormantDays).churn).toEqual(R(1, 1));
  });
  it("K22: rows decoded (MRN always, name only when the reader sends it)", () => {
    const rows = decode.k22({ rows: [{ patient: "P2", mrn: "RM-2", name: null, ltv: "3500000", by_branch: [{ branch_id: "A", value: 3_500_000 }] }] });
    expect(rows).toEqual([{ patient: "P2", mrn: "RM-2", name: null, ltv: 3_500_000, byBranch: [{ branch: "A", value: 3_500_000 }] }]);
  });
  it("K23: shifts, invoices with the derived shift, payments and cash refunds", () => {
    const d = decode.k23({ from: P.from, to: P.to,
      shifts: [{ id: "SH1", branch_id: "A", day: "2026-10-02" }, { id: "SH2", branch_id: "A", day: "2026-10-04" }, { id: "SH3", branch_id: "B", day: "2026-10-10" }],
      invoices: inv.filter((x) => x.day >= P.from),
      payments: [{ branch_id: "A", day: "2026-10-02", shift_id: "SH1", amount: 555_000, method: "cash", simulated: false },
        { branch_id: "A", day: "2026-10-03", shift_id: "SH1", amount: 1_500_000, method: "qris", simulated: false },
        { branch_id: "A", day: "2026-10-03", shift_id: "SH1", amount: 9_999, method: "qris", simulated: true },
        { branch_id: "A", day: "2026-10-04", shift_id: "SH2", amount: 3_000_000, method: "edc", simulated: false },
        { branch_id: "A", day: "2026-10-05", shift_id: "SH2", amount: 600_000, method: "balance", simulated: false },
        { branch_id: "B", day: "2026-10-10", shift_id: "SH3", amount: 900_000, method: "transfer", simulated: false }],
      cash_refunds: [{ branch_id: "A", day: "2026-10-09", shift_id: "SH2", amount: 333_000 }] });
    expect(k23(d.shifts, d.invoices, d.payments, d.refunds, d.period).rows).toEqual([
      { shift: "SH1", branch: "A", k3: M(2_055_000), k1: M(2_055_000) }, { shift: "SH2", branch: "A", k3: M(3_000_000), k1: M(2_667_000) },
      { shift: "SH3", branch: "B", k3: M(900_000), k1: M(900_000) }, { shift: null, branch: "A", k3: M(100_000), k1: M(0) }]);
  });
  it("K24 / K25 / K26 / K27 decode to the calculator inputs", () => {
    const d24 = decode.k24({ from: P.from, to: P.to, dispensings: [
      { branch_id: "A", state: "handed", queued_at: "2026-10-02T09:00:00+07:00", handed_at: "2026-10-02T09:12:00+07:00", handed_day: "2026-10-02" },
      { branch_id: "A", state: "handed", queued_at: "2026-10-02T10:00:00+07:00", handed_at: "2026-10-02T10:05:30+07:00", handed_day: "2026-10-02" }] });
    expect(k24(d24.ds, d24.period)).toEqual(D(525)); // (330 + 720) / 2
    const d25 = decode.k25({ from: P.from, to: P.to, usages: [
      { promo: "HEMAT", code: "HEMAT", version: "v1", version_no: 1, branch_id: "A", state: "consumed", day: "2026-10-02", discount: 50_000, line_value: 450_000, refunded_in_period: 0 },
      { promo: "HEMAT", code: "HEMAT", version: "v1", version_no: 1, branch_id: "A", state: "consumed", day: "2026-10-03", discount: 50_000, line_value: 950_000, refunded_in_period: "950000" }] });
    expect(k25(d25.us, d25.period)).toEqual([{ promo: "HEMAT", version: "v1", uses: C(2), discount: M(100_000), k3: M(450_000) }]);
    expect(d25.labels.get("v1")).toBe("HEMAT v1");
    const d26 = decode.k26({ from: P.from, to: P.to, surveys: [5, 4, 2, 1, 5].map((score, i) => ({ branch_id: "A", day: `2026-10-0${i + 1}`, score })) });
    expect(k26(d26.ss, d26.period).average).toEqual({ kind: "score", hundredths: 340 });
    const d27 = decode.k27({ from: P.from, to: P.to, as_of: "2026-11-01T00:00:00+07:00", doctors: { D1: "Dr. Sintetis" },
      examinations: [{ doctor: "D1", branch_id: "A", state: "signed", created_at: "2026-10-02T09:10:00+07:00", signed_at: "2026-10-02T09:45:00+07:00", signed_day: "2026-10-02", checked_in_at: "2026-10-02T09:00:00+07:00" },
        { doctor: "D1", branch_id: "A", state: "draft", created_at: "2026-10-30T08:00:00+07:00", signed_at: null, signed_day: null, checked_in_at: "2026-10-30T07:50:00+07:00" }],
      requests: [{ doctor: "D1", branch_id: "A", state: "approved", decided_day: "2026-10-02" }] });
    expect(k27(d27.exams, d27.requests, d27.period, d27.asOf)).toEqual([{ doctor: "D1", signed: C(1), unsignedOver24h: C(1), requestsDecided: C(1), checkInToSignature: D(2_700) }]);
    expect(d27.names.get("D1")).toBe("Dr. Sintetis");
  });
  it.each([
    ["a missing part", () => decode.k20({ from: P.from, to: P.to, invoices: [] })],
    ["a fractional rupiah", () => decode.k20({ from: P.from, to: P.to, invoices: [{ ...inv[0], sale_value: "1.5" }], reductions: [] })],
    ["an unsafe rupiah", () => decode.k26({ from: P.from, to: P.to, surveys: [{ branch_id: "A", day: "2026-10-01", score: "9007199254740993" }] })],
    ["an impossible day", () => decode.k21({ as_of: "2026-02-30", dormant_days: 90, visits: [] })],
    ["an unknown state", () => decode.k24({ from: P.from, to: P.to, dispensings: [{ branch_id: "A", state: "lost", queued_at: "2026-10-01T00:00:00Z", handed_at: null, handed_day: null }] })],
    ["a bad instant", () => decode.k27({ from: P.from, to: P.to, as_of: "kemarin", doctors: {}, examinations: [], requests: [] })],
  ])("refuses %s (an error, never a value)", (_, f) => {
    expect(f).toThrow(ReaderShapeError);
  });
});

// ── views ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SENTINEL = ["Pasien Sentinel", "081299990000", "Diagnosis Sentinel L70.0", "Catatan klinis sentinel"];
const props = (kpis: ReportKpi[], rows: Record<string, string | Metric>[] = []): ReportProps => ({
  title: "Laporan Pasien",
  period: { label: "Oktober 2026", chips: [{ label: "Bulan ini", href: "/laporan/pasien?periode=bulan", active: true }, { label: "Bulan lalu", href: "/laporan/pasien?periode=bulan-lalu" }] },
  branches: [{ label: "Semua Cabang", href: "/laporan/pasien", active: true }, { label: "Cabang A", href: "/laporan/pasien?cabang=a" }],
  generatedAt: "2026-10-31T17:00:00Z",
  exportHref: "/laporan/pasien/ekspor",
  kpis,
  table: { caption: "Pasien teratas", columns: [{ id: "kode", label: "Kode pasien" }, { id: "ltv", label: "LTV (K22)", numeric: true }], rows },
  clearHref: "/laporan/pasien",
});
const html = (p: ReportProps, s: Parameters<typeof ReportView>[0]["state"]) => renderToStaticMarkup(ReportView({ props: p, state: s }));

describe("Scenario PR-95: report definition", () => {
  it("Laporan Pasien → definition of churn → the Kamus KPI entry", () => {
    const k21v = k21([{ patient: "P1", branch: "A", day: "2026-06-01" }, { patient: "P2", branch: "A", day: "2026-10-20" }], "2026-10-31");
    const h = html(props([{ id: "K21", metric: k21v.churn, basis: "12 bulan terakhir, batas 90 hari (SET-22)" }]), { kind: "ok" });
    const href = h.match(/href="([^"]+)"[^>]*aria-label="Definisi Churn \(K21\)"|aria-label="Definisi Churn \(K21\)"[^>]*href="([^"]+)"/);
    const target = href?.[1] ?? href?.[2];
    expect(target).toBe("/laporan/kamus-kpi#k21");
    const kamus = renderToStaticMarkup(KamusKpiView({ state: { kind: "ok" } }));
    const entry = kamus.split(`id="${anchor("K21")}"`)[1].split("</article>")[0];
    expect(entry).toContain("Churn");
    expect(entry).toContain(BY_ID.get("K21")!.definition.replaceAll('"', "&quot;"));
    expect(entry).toContain("Cabang kunjungan terakhir");
    expect(entry).toContain("SET-22");
    expect(entry).toContain('href="/laporan/pasien"');
  });
});

describe("Kamus KPI view (UX-59)", () => {
  const h = renderToStaticMarkup(KamusKpiView({ state: { kind: "ok" } }));
  it("lists K1–K27 with formula, attribution, source, version and markers", () => {
    expect(h.match(/<article /g)).toHaveLength(27);
    for (const k of DICTIONARY) expect(h).toContain(`id="${anchor(k.id)}"`);
    expect(h.match(/Versi 1/g)).toHaveLength(27);
    expect(h).toContain("Draf definisi");
    expect(h).toContain("Estimasi");
    expect(h.match(/<main/g)).toHaveLength(1);
    expect(h).toContain("min-[1180px]:grid-cols-2");
  });
  it("filters by report; loading and permission states", () => {
    const f = renderToStaticMarkup(KamusKpiView({ state: { kind: "ok", report: parseReport("operasional") } }));
    expect([...f.matchAll(/data-kpi="(K\d+)"/g)].map((m) => m[1])).toEqual(["K12", "K20", "K23", "K24"]);
    expect(parseReport("tidak-ada")).toBeUndefined();
    expect(parseReport("__proto__")).toBeUndefined();
    const l = renderToStaticMarkup(KamusKpiView({ state: { kind: "loading" } }));
    expect(l).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(KamusKpiView({ state: { kind: "permission" } }))).toContain("Anda tidak memiliki akses ke Kamus KPI.");
  });
});

describe("Report view (UX-38): states, unavailable ≠ 0, no clinical content", () => {
  const kpis: ReportKpi[] = [
    { id: "K20", metric: money(944_400), basis: "Oktober 2026" },
    { id: "K22", label: "LTV rata-rata", metric: pending, basis: "Sejak kunjungan pertama" },
    { id: "K26", metric: { kind: "score", hundredths: 340 }, basis: "5 survei" },
  ];
  it("renders values, unavailable distinct from Rp0, export, period, last generated, definitions", () => {
    const h = html(props(kpis, [{ kode: "PSN-0001", ltv: M(3_500_000) }, { kode: "PSN-0002", ltv: pending }]), { kind: "ok" });
    expect(h).toContain("Rp944.400");
    expect(h).toMatch(/data-kpi="K22" data-state="unavailable".*?Belum tersedia/);
    expect(h.split('data-kpi="K22"')[1].split("</li>")[0]).not.toContain("Rp0");
    expect(h).toMatch(/data-state="unavailable"[^>]*>Belum tersedia<\/td>/);
    expect(h).toContain("3,40");
    expect(h).toContain('href="/laporan/pasien/ekspor"');
    expect(h).toContain("Unduh");
    expect(h).toContain("Periode Oktober 2026");
    expect(h).toContain('dateTime="2026-10-31T17:00:00Z"');
    for (const id of ["k20", "k22", "k26"]) expect(h).toContain(`href="/laporan/kamus-kpi#${id}"`);
    expect(h).toContain("min-[700px]:block");
    expect(h).toContain("min-[700px]:hidden");
  });
  it("omits Unduh when the role may not export", () => {
    expect(html({ ...props(kpis), exportHref: undefined }, { kind: "ok" })).not.toContain("Unduh");
  });
  it("every state, exactly one at a time", () => {
    const p = props(kpis);
    expect(html(p, { kind: "loading" })).toContain('aria-busy="true"');
    const perm = html(p, reportState({ allowed: false, ok: true, filtered: false, kpis, rows: 1, retryHref: "/x", object: "Laporan Pasien" }));
    expect(perm).toContain("Anda tidak memiliki akses ke Laporan Pasien.");
    expect(perm).not.toContain("Periode");
    const err = reportState({ allowed: true, ok: false, filtered: false, kpis, rows: 0, retryHref: "/laporan/pasien", object: "x" });
    expect(html(p, err)).toMatch(/role="alert".*Laporan belum bisa dimuat\..*href="\/laporan\/pasien"[^>]*>Coba Lagi/);
    expect(html(p, { kind: "blocked", reason: "Periode terkunci", unblock: "Owner dapat membuka periode" })).toContain("Periode terkunci.");
    const zeros: ReportKpi[] = [{ id: "K20", metric: NONE, basis: "x" }, { id: "K23", metric: M(0), basis: "x" }];
    expect(reportState({ allowed: true, ok: true, filtered: false, kpis: zeros, rows: 0, retryHref: "/x", object: "x" })).toEqual({ kind: "empty" });
    expect(html(p, { kind: "empty" })).toContain("Belum ada data untuk periode ini.");
    expect(reportState({ allowed: true, ok: true, filtered: true, kpis: zeros, rows: 0, retryHref: "/x", object: "x" })).toEqual({ kind: "filtered-empty" });
    expect(html(p, { kind: "filtered-empty" })).toMatch(/Tidak ada data untuk filter ini\..*href="\/laporan\/pasien"[^>]*>Hapus Filter/);
    // unknown is not nothing: a pending KPI keeps the report in "ok"
    expect(reportState({ allowed: true, ok: true, filtered: false, kpis: [{ id: "K20", metric: pending, basis: "x" }], rows: 0, retryHref: "/x", object: "x" })).toEqual({ kind: "ok" });
    for (const s of ["loading", "empty", "filtered-empty", "ok"] as const) expect(html(p, { kind: s }).match(/<main/g), s).toHaveLength(1);
    expect(html(p, { kind: "empty" })).not.toContain("Unduh");
  });
  it("renders text as text, and the model carries no patient name or clinical field", () => {
    const h = html(props(kpis, [{ kode: `<img src=x onerror="alert(1)">`, ltv: M(1) }]), { kind: "ok" });
    expect(h).not.toContain("<img");
    const facts = JSON.stringify({ invoices, reductions });
    for (const s of SENTINEL) expect(facts).not.toContain(s);
    // the calculator outputs keep only ids, codes, counts and money
    const out = JSON.stringify([k20(invoices, reductions, P), k22(invoices, reductions, "2026-10-31"), k27([], [], P, "2026-11-01T00:00:00Z")]);
    expect(Object.keys(JSON.parse(out)[1].rows[0]).sort()).toEqual(["byBranch", "ltv", "patient"]);
  });
});

// ── slice 2 (P1, on main f0bd3c44): the K1–K19 consumer on the real T-107 readers (dashboard_kpi 0126, target_list 0103). ──
const kr = (over: Partial<KpiResult>): KpiResult => ({ kpi: "k1", from: "2026-10-01", to: "2026-10-31", branch_id: null, as_of: "2026-11-20T00:00:00Z",
  total: null, by_dim: {}, by_branch: {}, by_grp1: {}, by_grp2: {}, extra: null, rows: null, ...over });
describe("fromKpi: units, ratios and unavailable semantics (crafted reader payloads)", () => {
  it("money KPIs keep integer rupiah; a period with no money rows is a real Rp0 flow, not 'unavailable'", () => {
    expect(fromKpi("K1", kr({ total: 3_500_000 }))[0].metric).toEqual(M(3_500_000));
    expect(fromKpi("K3", kr({ total: null }))[0].metric).toEqual(M(0));
    expect(fromKpi("K17", kr({ total: -150_000 }))[0].metric).toEqual(M(-150_000)); // a negative owed (paid ahead) stays signed
    // slice 3: a branch-scoped K17 payload (explicit branch or a manager's applied scope) is never a value — the paid net has no branch
    for (const total of [200_000, 0, -150_000, null]) expect(fromKpi("K17", kr({ total, branch_id: "b-1" }))[0].metric).toEqual({ kind: "unavailable", reason: "branch_unattributed" });
  });
  it("K4 with an undated cancellation is incomplete — never a partial total; complete K4 shows its total", () => {
    expect(fromKpi("K4", kr({ total: null, extra: { undated_cancellations: 2, complete: false } }))[0]).toMatchObject({ metric: { kind: "unavailable", reason: "incomplete" }, basis: expect.stringContaining("2 pembatalan tanpa tanggal") });
    expect(fromKpi("K4", kr({ total: 622_000, extra: { undated_cancellations: 0, complete: true } }))[0].metric).toEqual(M(622_000));
    expect(fromKpi("K4", kr({ total: 10, extra: null }))[0].metric).toEqual({ kind: "unavailable", reason: "incomplete" });
  });
  it("K5 with pre-cutover residue and K7 with an uncosted movement are incomplete; K7 estimasi is marked, not hidden", () => {
    expect(fromKpi("K5", kr({ total: 3_900_000, by_dim: { incomplete: 1 } }))[0].metric).toEqual({ kind: "unavailable", reason: "incomplete" });
    expect(fromKpi("K5", kr({ total: 3_900_000, by_dim: { packages_expiring_30: 300_000 } }))[0].metric).toEqual(M(3_900_000));
    expect(fromKpi("K7", kr({ total: 2_145_000, by_dim: { uncosted: 1 } }))[0].metric).toEqual({ kind: "unavailable", reason: "incomplete" });
    expect(fromKpi("K7", kr({ total: 2_145_000, by_dim: { estimasi: 3 } }))[0]).toMatchObject({ metric: M(2_145_000), basis: expect.stringContaining("estimasi") });
  });
  it("ratios keep numerator and denominator; an empty denominator is no data, never 0 %", () => {
    expect(fromKpi("K8", kr({ by_dim: { consultation: 2, purchase: 1 } }))[0].metric).toEqual(R(1, 2));
    expect(fromKpi("K8", kr({ by_dim: {} }))[0].metric).toEqual(NONE);
    expect(fromKpi("K12", kr({ extra: { booked: 6, failed: 2 } }))[0].metric).toEqual(R(2, 6));
    expect(fromKpi("K15", kr({ extra: { covered_minutes: 60, rostered_minutes: 960 } }))[0].metric).toEqual(R(60, 960));
    expect(fromKpi("K11", kr({ by_dim: { new: 4, second_visit: 1 } }))[0].metric).toEqual(R(1, 4));
    expect(fromKpi("K9", kr({ by_dim: { recommended_count: 3, recommended_value: 2_566_000, selected_30_count: 1, selected_30_value: 1_500_000 } })).map((k) => k.metric))
      .toEqual([R(1, 3), R(1_500_000, 2_566_000)]);
    expect(fromKpi("K10", kr({ by_dim: { new: 4, returning: 2 } })).map((k) => k.metric)).toEqual([C(4), C(2)]);
  });
  it("K14: minutes → exact seconds; the SLA share is labelled by sla_mix (thresholds at entry), never today's sla_minutes; no leads = no data", () => {
    const k = fromKpi("K14", kr({ extra: { leads: 4, answered: 3, median_minutes: 10.5, within_15m: 1, within_sla: 2, sla_minutes: 30,
      sla_mix: [{ minutes: 15, leads: 2, within: 1 }, { minutes: 30, leads: 2, within: 1 }] } }));
    expect(k.map((x) => x.metric)).toEqual([D(630), R(1, 4), R(2, 4)]);
    expect(k[2].basis).toContain("SLA 15 menit: 1 dari 2 · SLA 30 menit: 1 dari 2");
    expect(k.map((x) => `${x.label} ${x.basis}`).join(" ")).not.toMatch(/≤ 30 menit/);
    expect(fromKpi("K14", kr({ extra: { leads: 0, answered: 0, median_minutes: null, within_15m: 0, within_sla: 0, sla_minutes: 15, sla_mix: [] } }))[0].metric).toEqual(NONE);
  });
  it("K18 is three counts; reader bigints that arrive as strings stay exact", () => {
    expect(fromKpi("K18", kr({ by_dim: { below_min: 1, expiring: 1, variance: 1 } })).map((k) => k.metric)).toEqual([C(1), C(1), C(1)]);
    expect(fromKpi("K1", kr({ total: "5272000" as unknown as number }))[0].metric).toEqual(M(5_272_000));
  });
  it("K19 from target_list: BCs with a target only; money ÷ money; none = no data", () => {
    const row = (is_bc: boolean, target: number | null, actual: number) => ({ staff_id: "s", staff: "x", is_bc, target: target === null ? null : { id: "t", closing_value_target: target, plans_target: null, set_at: "" },
      closing_value_actual: actual, branch_closing_value: null, plans_actual: 0, attainment_bps: null,
      scorecard: { completed_services: 0, executed_minutes: 0, rostered_minutes: 0, utilization_bps: null, commission_gross: 0, commission_adjustments: 0, commission_net: 0 } });
    const t = fromTargets({ role: "owner", period: "2026-10", period_kind: "bulanan", branch_id: null, can_set: true,
      rows: [row(true, 6_000_000, 5_272_000), row(true, 2_000_000, 0), row(true, null, 900_000), row(false, 1_000_000, 1)] });
    expect(t.map((k) => k.metric)).toEqual([R(5_272_000, 8_000_000), M(5_272_000)]);
    expect(fromTargets({ role: "owner", period: "2026-10", period_kind: "bulanan", branch_id: null, can_set: true, rows: [] })[0].metric).toEqual(NONE);
  });
  it("wholeMonth: only a full calendar month maps to a target period", () => {
    expect([wholeMonth("2026-10-01", "2026-10-31"), wholeMonth("2026-02-01", "2026-02-28"), wholeMonth("2026-10-01", "2026-10-30"), wholeMonth("2026-10-02", "2026-10-31")])
      .toEqual(["2026-10", "2026-02", null, null]);
  });
});

describe("loadReport on the real readers (PostgreSQL; role scoping, branch scope, unavailable semantics)", () => {
  let h: Harness; let app: pg.Pool; let owner: pg.Pool; let n = 0;
  type T = { tenantId: string; b1: string; b2: string };
  type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
  const WIDE: string[] = ROLES.filter((r) => !(LEVEL3_ROLES as readonly string[]).includes(r));
  const key = () => crypto.randomUUID();
  const tenant = async (name: string): Promise<T> => {
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
    const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
    return { tenantId, b1: await br("LP-A"), b2: await br("LP-B") };
  };
  const person = async (t: T, role: Role, ...branches: string[]): Promise<P> => {
    const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`lap${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Laporan ${n}` });
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
    return { acc, staffId, tenantId: t.tenantId, role, branch: WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
  };
  const as = async <X>(p: P, fn: (db: pg.PoolClient) => Promise<X>) =>
    withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
  const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : String(e)));
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  let A: T; let B: T; let OWN: P; let FIN: P; let MGR: P; let MGRB: P; let MK: P; let FO: P; let FOB: P; let BC: P; let BOWN: P;
  const pay = async (fo: P, item: string, amount: number) => {
    const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
    await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount, cashTendered: amount }]));
  };

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local"; // the target writer's production go-live gate (as tests/commission/targets.test.ts)
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
    A = await tenant("PT Laporan Sintetis"); B = await tenant("PT Laporan Lain");
    OWN = await person(A, "owner"); FIN = await person(A, "finance"); MGR = await person(A, "manager", A.b1); MGRB = await person(A, "manager", A.b2);
    MK = await person(A, "marketing"); FO = await person(A, "fo_cashier", A.b1); FOB = await person(A, "fo_cashier", A.b2); BC = await person(A, "bc", A.b1);
    BOWN = await person(B, "owner");
    const serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "LP-SRM" }, { name: "Serum Laporan", tax_category: "non_object", tax_basis: "Barang", normal_price: 333_000 } as never, "Produk"))).itemId;
    const PH = await person(A, "pharmacist", A.b1);
    await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    // K1 facts: 333,000 cash at A, 333,000 cash at B (counter sales; product not handed → K2 stays 0)
    await pay(FO, serum, 333_000);
    await pay(FOB, serum, 333_000);
    await as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, today().slice(0, 7), { closingValueTarget: 6_000_000 }));
  }, 300_000);
  afterAll(async () => { await app?.end(); await owner?.end(); await h?.close(); });
  const month = () => {
    const t = today(), [y, m] = t.split("-").map(Number);
    return { from: `${t.slice(0, 7)}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  };

  it("Laporan Penjualan for the owner: K1 = the cash of both branches from dashboard_kpi; K3 the sales; K2 a real Rp0 (nothing performed)", async () => {
    const r = await as(OWN, (db) => loadReport(db, "penjualan", month()));
    expect(r.kpis.map((k) => [k.id, k.metric])).toEqual([["K1", M(666_000)], ["K2", M(0)], ["K3", M(666_000)]]);
    expect(r.allForbidden).toBe(false);
  });
  it("branch scope: the owner filtered to B sees only B; a manager sees its own branch; a manager naming another branch is refused (not a value)", async () => {
    expect((await as(OWN, (db) => loadReport(db, "penjualan", { ...month(), branchId: A.b2 }))).kpis[0].metric).toEqual(M(333_000));
    expect((await as(MGR, (db) => loadReport(db, "penjualan", month()))).kpis[0].metric).toEqual(M(333_000));
    expect((await as(MGRB, (db) => loadReport(db, "penjualan", month()))).kpis[0].metric).toEqual(M(333_000));
    expect(await code(as(MGRB, (db) => loadReport(db, "penjualan", { ...month(), branchId: A.b1 })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR, (db) => loadReport(db, "penjualan", { ...month(), branchId: A.b2 })))).toBe("ERR_NOT_FOUND");
  });
  it("role scoping per KPI (07 Dashboards): marketing reads K13/K14 in Laporan Marketing, K20–K27 stay 'Belum tersedia'; Laporan Penjualan is all forbidden", async () => {
    const m = await as(MK, (db) => loadReport(db, "marketing", month()));
    expect(m.kpis.filter((k) => k.id === "K13" || k.id === "K14").every((k) => k.metric.kind !== "unavailable" || k.metric.reason === "no_data")).toBe(true);
    expect(m.kpis.filter((k) => k.id === "K25" || k.id === "K26").map((k) => k.metric)).toEqual([pending, pending]);
    const p = await as(MK, (db) => loadReport(db, "penjualan", month()));
    expect(p.kpis.map((k) => k.metric)).toEqual([0, 1, 2].map(() => ({ kind: "unavailable", reason: "forbidden" })));
    expect(p.allForbidden).toBe(true);
    expect(p.kpis.some((k) => k.metric.kind === "money")).toBe(false); // never Rp0 for a forbidden KPI
  });
  it("one forbidden KPI does not abort the others in the same transaction (savepoint): finance reads Laporan Staf — K15/K17 read, K19 forbidden", async () => {
    const r = await as(FIN, (db) => loadReport(db, "staf", month()));
    const by = Object.fromEntries(r.kpis.map((k) => [`${k.id}${k.label ? `:${k.label}` : ""}`, k.metric]));
    expect(by.K19).toEqual({ kind: "unavailable", reason: "forbidden" });
    expect(by.K17).toEqual(M(0));
    expect(by.K27).toEqual(pending);
    expect(r.allForbidden).toBe(false);
  });
  it("K19 from target_list for the owner (whole month); another period shape is 'Hanya per bulan penuh', not 0", async () => {
    const r = await as(OWN, (db) => loadReport(db, "staf", month()));
    expect(r.kpis.filter((k) => k.id === "K19").map((k) => k.metric)).toEqual([R(0, 6_000_000), M(0)]);
    const half = await as(OWN, (db) => loadReport(db, "staf", { from: month().from, to: `${month().from.slice(0, 8)}15` }));
    expect(half.kpis.find((k) => k.id === "K19")!.metric).toEqual({ kind: "unavailable", reason: "period_unsupported" });
    expect(show(half.kpis.find((k) => k.id === "K19")!.metric)).toBe("Hanya per bulan penuh");
  });
  it("cross-tenant: tenant B's owner reads none of A's money; a branch of A named by B is refused", async () => {
    expect((await as(BOWN, (db) => loadReport(db, "penjualan", month()))).kpis[0].metric).toEqual(M(0));
    expect(await code(as(BOWN, (db) => loadReport(db, "penjualan", { ...month(), branchId: A.b1 })))).toBe("ERR_NOT_FOUND");
  });
  // ── slice 3 (Sol 2026-11-20, K17 preflight): a branch-scoped K17 must never present accrued + adjusted as owed. dashboard_kpi drops
  // branch-less rows when a branch is applied (0126:434), and the net actually paid sits on the payout line with no branch — so a branch
  // view of K17 cannot prove the payments. Seeded after every other K17 read in this block (it changes the tenant's K17). ──
  it("K17 with a paid branch-less payout: consolidated owed is signed accrued − paid; a branch view (explicit branch or a manager's own scope) is unavailable, never the gross accrual and never Rp0", async () => {
    const c = await owner.connect();
    try {
      await c.query("begin"); await c.query("set local session_replication_role = replica");
      const TABLES = ["commission_contributions", "commission_entitlements", "approvals", "payout_batches", "payout_batch_lines"];
      const always = (await c.query(`select tgrelid::regclass::text t, tgname from pg_trigger where tgrelid = any($1::regclass[]) and not tgisinternal and tgenabled = 'A'`, [TABLES])).rows as { t: string; tgname: string }[];
      for (const x of always) await c.query(`alter table ${x.t} disable trigger ${x.tgname}`);
      const q = (sql: string, args: unknown[]) => c.query(sql, args);
      const nurse = await person(A, "nurse", A.b1);
      const now = new Date().toISOString();
      const cc = (await q(`insert into commission_contributions (tenant_id, branch_id, staff_id, contribution_type, source_kind, source_id, invoice_line_id, rule_version_id, sale_at)
        values ($1, $2, $3, 'performer', 'treatment_execution', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), $4) returning id`, [A.tenantId, A.b1, nurse.staffId, now])).rows[0].id;
      await q(`insert into commission_entitlements (tenant_id, branch_id, contribution_id, staff_id, amount, basis, fact_kind, fact_id, accrued_at)
        values ($1, $2, $3, $4, 120000, 120000, 'execution', gen_random_uuid(), $5), ($1, $2, $3, $4, 80000, 80000, 'execution', gen_random_uuid(), $5)`, [A.tenantId, A.b1, cc, nurse.staffId, now]);
      const ap = (await q(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, amount_rupiah, state, requested_by, requested_as, decided_by, decided_as, decided_at)
        values ($1, 'commission_batch', 'payout_batch', gen_random_uuid(), 'Uji', 1, 'approved', $2, 'finance', $3, 'owner', $4) returning id`, [A.tenantId, FIN.staffId, OWN.staffId, now])).rows[0].id;
      const pb = (await q(`insert into payout_batches (tenant_id, period_key, period_start, period_end, closing_day, state, approval_id, submitted_by, submitted_at, paid_by, paid_at, paid_method, created_by, command_key)
        values ($1, $2, $3, $4, 'month_end', 'paid', $5, $6, $7, $6, $7, 'transfer', $6, $8) returning id`,
        [A.tenantId, today().slice(0, 7), `${month().from} 00:00+07`, `${month().to} 23:59+07`, ap, FIN.staffId, now, `pb-${key()}`])).rows[0].id;
      // the batch paid 120,000 of the nurse's commission (one 120,000 entitlement of the two is in it; the other 80,000 is still owed)
      await q(`insert into payout_batch_lines (tenant_id, batch_id, staff_id, gross, adjustments, carry_forward_in, net_payable, carry_forward_out) values ($1, $2, $3, 120000, 0, 0, 120000, 0)`,
        [A.tenantId, pb, nurse.staffId]);
      for (const x of always) await c.query(`alter table ${x.t} enable always trigger ${x.tgname}`);
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    const k17 = (r: { kpis: { id: string; metric: Metric }[] }) => r.kpis.find((k) => k.id === "K17")!.metric;
    // the reader itself, branch-filtered: the gross accrual (the hazard this slice guards against)
    const raw = await as(OWN, (db) => db.query(`select dashboard_kpi('k17', $1, $2, $3, false) r`, [month().from, month().to, A.b1]));
    expect(Number(raw.rows[0].r.total)).toBe(200_000);
    // consolidated: owed = 200,000 accrued − 120,000 paid, signed, from the reader's own total
    expect(k17(await as(OWN, (db) => loadReport(db, "staf", month())))).toEqual(M(80_000));
    // explicit branch (owner, A): unavailable with the reason — not Rp200.000 (gross) and not Rp0
    const a = await as(OWN, (db) => loadReport(db, "staf", { ...month(), branchId: A.b1 }));
    expect(k17(a)).toEqual({ kind: "unavailable", reason: "branch_unattributed" });
    expect(show(k17(a))).toBe("Belum dapat dihitung per cabang");
    expect(a.kpis.find((k) => k.id === "K17")!.basis).toContain("Komisi yang sudah dibayar tidak tercatat per cabang");
    // implicit scope: a manager is bound to its branch by the reader even without a branch filter
    expect(k17(await as(MGR, (db) => loadReport(db, "staf", month())))).toEqual({ kind: "unavailable", reason: "branch_unattributed" });
    // a branch with no commission at all is still not provably Rp0 owed (a payment may be unattributed there too): unavailable, not Rp0
    expect(k17(await as(OWN, (db) => loadReport(db, "staf", { ...month(), branchId: A.b2 })))).toEqual({ kind: "unavailable", reason: "branch_unattributed" });
    // the rendered report: never Rp200.000 / Rp0 for a branch K17
    const out = html({ ...props([{ id: "K17", metric: k17(a), basis: "x" }]) }, { kind: "ok" });
    expect(out.split('data-kpi="K17"')[1].split("</li>")[0]).not.toMatch(/Rp/);
  });

  it("the report view renders a forbidden KPI as text, never Rp0, with its definition link", () => {
    const k: ReportKpi[] = [{ id: "K1", metric: { kind: "unavailable", reason: "forbidden" }, basis: "Cabang tempat pembayaran" }];
    const out = html(props(k), { kind: "ok" });
    expect(out).toMatch(/data-kpi="K1" data-state="unavailable"/);
    expect(out).toContain("Tidak tersedia untuk peran ini");
    expect(out.split('data-kpi="K1"')[1].split("</li>")[0]).not.toContain("Rp0");
  });
});

// ── K20–K27 readers on PostgreSQL (migration 0130; slice 4): real writers, synthetic data (MIG-2). Each reader's facts → calculator equal
// hand-worked values; roles per K, a manager's own branch, a foreign branch and another tenant are refused; K22 identity by role; K27 reads
// no SOAP column; nothing is executable by PUBLIC.
describe("report_k20 … report_k27 on PostgreSQL (0130)", () => {
  let h: Harness; let app: pg.Pool; let own: pg.Pool; let n = 0;
  type T = { tenantId: string; b1: string; b2: string };
  type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
  const WIDE = ["owner", "admin_pusat", "finance", "auditor", "marketing", "central_cs", "purchasing"];
  const key = () => crypto.randomUUID();
  const as = async <X>(p: P, fn: (db: pg.PoolClient) => Promise<X>) =>
    withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
  const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : String(e)));
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  let A: T; let B: T; let OWN: P; let FIN: P; let MGR: P; let MK: P; let FO: P; let FOB: P; let BOWN: P; let DOC: P; let PH: P;
  async function tenant(name: string): Promise<T> {
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
    const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
    return { tenantId, b1: await br("RP-A"), b2: await br("RP-B") };
  }
  async function person(t: T, role: Role, branch?: string): Promise<P> {
    const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rp${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(own, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Laporan ${n}` });
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch ?? t.b1 });
    return { acc, staffId, tenantId: t.tenantId, role, branch: WIDE.includes(role) ? undefined : branch ?? t.b1 };
  }
  async function patient(t: T, b: string): Promise<string> {
    return (await h.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Laporan Rahasia', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam',
               'Karyawan', 's1', 'kawin', $2, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, b])).rows[0].id as string;
  }
  // a counter sale of qty × 100,000 (product, non-object: no VAT) paid in cash by fo, for a patient
  async function sale(fo: P, item: string, qty: number, pid: string | null) {
    const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, counter: true }));
    await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: qty }]));
    await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: qty * 100_000, cashTendered: qty * 100_000 }]));
    return invoiceId;
  }
  let P1: string; let P2: string; let item: string; let shiftA: string;

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local";
    setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    own = testPool({ connectionString: h.ownerUrl(), max: 2 });
    A = await tenant("PT Laporan K Sintetis"); B = await tenant("PT Laporan K Lain");
    OWN = await person(A, "owner"); FIN = await person(A, "finance"); MGR = await person(A, "manager", A.b1); MK = await person(A, "marketing");
    FO = await person(A, "fo_cashier", A.b1); FOB = await person(A, "fo_cashier", A.b2); DOC = await person(A, "doctor", A.b1); PH = await person(A, "pharmacist", A.b1);
    BOWN = await person(B, "owner");
    item = (await as(OWN, (db) => publish(db, { kind: "product", code: "RP-SRM" }, { name: "Serum Laporan K", tax_category: "non_object", tax_basis: "Barang", normal_price: 100_000 } as never, "Produk"))).itemId;
    await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: item, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    P1 = await patient(A, A.b1); P2 = await patient(A, A.b2);
    shiftA = (await as(FO, (db) => openShift(db, key(), { openingFloat: 0 }))).shiftId;
    // A: 300,000 (P1) + 500,000 (P1) in FO's shift; B branch: 200,000 (P2) by FOB (auto-opened shift)
    await sale(FO, item, 3, P1); await sale(FO, item, 5, P1); await sale(FOB, item, 2, P2);
    // a voided invoice (issued 900,000 for P1, unpaid, void approved by the manager): never a sale in K20, K22 or K23
    const { invoiceId: v } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: P1, counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), v, [{ itemId: item, quantity: 9 }]));
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), v, "Salah input item"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    if ((await h.admin.query(`select state from invoices where id = $1`, [v])).rows[0].state !== "void") throw new Error("fixture: void not applied");
  }, 300_000);
  afterAll(async () => { setKekRingForTests(undefined); await app?.end(); await own?.end(); await h?.close(); });

  it("K20 / K23 / K22 equal hand-worked values from the real writers (no VAT on non-object products)", async () => {
    const d = today();
    // K20 all: K3 = 300,000 + 500,000 + 200,000 = 1,000,000 over 3 invoices = 333,333 (half away)
    expect(await as(OWN, (db) => read.k20(db, { from: d, to: d }))).toEqual({ k3: M(1_000_000), invoices: C(3), average: M(333_333) });
    // the manager is bound to A.b1: 800,000 / 2
    expect(await as(MGR, (db) => read.k20(db, { from: d, to: d }))).toEqual({ k3: M(800_000), invoices: C(2), average: M(400_000) });
    // K23 (Panel 2 rule: same branch + cashier, issued within [opened_at, closed_at]): FO's explicitly opened shift carries both A invoices
    // and 800,000 cash. FOB had no open shift: cash_shift_for auto-opens it AT THE PAYMENT, after the invoice was issued, so B's invoice is
    // "tanpa shift" (K3 200,000, K1 0) while its 200,000 cash sits in the auto-opened shift (K3 0). Nothing disappears: K3 and K1 both total.
    const k23 = await as(OWN, (db) => read.k23(db, { from: d, to: d }));
    expect(k23.rows.find((r) => r.shift === shiftA)).toEqual({ shift: shiftA, branch: A.b1, k3: M(800_000), k1: M(800_000) });
    expect(k23.rows.filter((r) => r.shift === null)).toEqual([{ shift: null, branch: A.b2, k3: M(200_000), k1: M(0) }]);
    expect(k23.rows.find((r) => r.branch === A.b2 && r.shift !== null)).toMatchObject({ k3: M(0), k1: M(200_000) });
    expect(k23.rows.reduce((s, r) => s + (r.k3 as { rupiah: number }).rupiah, 0)).toBe(1_000_000);
    expect(k23.rows.reduce((s, r) => s + (r.k1 as { rupiah: number }).rupiah, 0)).toBe(1_000_000);
    // K22: P1 800,000 then P2 200,000; owner sees the name, marketing only the MRN
    const o = await as(OWN, (db) => read.k22(db, { asOf: d }));
    expect(o.map((r) => [r.patient, r.ltv])).toEqual([[P1, 800_000], [P2, 200_000]]);
    expect(o[0].name).toBe("Pasien Laporan Rahasia");
    const m = await as(MK, (db) => read.k22(db, { asOf: d }));
    expect(m.map((r) => [r.patient, r.ltv, r.name])).toEqual([[P1, 800_000, null], [P2, 200_000, null]]);
    expect(m.every((r) => /^RM-/.test(r.mrn))).toBe(true);
  });

  it("K21 / K24 / K25 / K26 / K27: real empty or simple facts give no data or zero rows, never Rp0; K21 reads SET-22's default", async () => {
    const d = today();
    // no visit rows in this fixture (counter sales): K21 has no active patient → no data
    expect((await as(OWN, (db) => read.k21(db, { asOf: d }))).churn).toEqual({ kind: "unavailable", reason: "no_data" });
    expect((await as(OWN, (db) => read.k21(db, { asOf: d }))).dormantDays).toBe(90);
    expect(await as(OWN, (db) => read.k24(db, { from: d, to: d }))).toEqual({ kind: "unavailable", reason: "no_data" });
    expect((await as(MK, (db) => read.k25(db, { from: d, to: d }))).rows).toEqual([]);
    expect(await as(MK, (db) => read.k26(db, { from: d, to: d }))).toEqual({ average: { kind: "unavailable", reason: "no_data" }, low: { kind: "unavailable", reason: "no_data" }, responses: C(0) });
    expect((await as(FIN, (db) => read.k27(db, { from: d, to: d }))).rows).toEqual([]);
  });

  // ── R3 161ff9b9 regressions (synthetic, a separate tenant with fixed historical days; raw rows with the named triggers paused, the
  // dashboards.test.ts seedRaw pattern, because the writers cannot backdate) ──
  async function seedRaw(tables: string[], fn: () => Promise<void>) {
    const off: [string, string][] = [];
    for (const tb of tables) for (const r of (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
    for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} disable trigger ${tg}`);
    try { await fn(); } finally { for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} enable always trigger ${tg}`); }
  }
  const at = (local: string) => `${local}+07`; // Asia/Jakarta
  type W = { t: T; own: P; fo: P; pid: string; svcV: string };
  let W1: W;
  async function world(): Promise<W> {
    if (W1) return W1;
    const t = await tenant("PT Laporan Shift Sintetis");
    const own = await person(t, "owner"); const fo = await person(t, "fo_cashier", t.b1);
    const pid = await patient(t, t.b1);
    const svc = (await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', 'RP-SVC', $2) returning id`, [t.tenantId, own.staffId])).rows[0].id as string;
    const svcV = (await h.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
      values ($1, $2, 1, 'active', 'Layanan Laporan', 'exempt_medical', 'Jasa medis', 500000, 'Layanan baru', $3, 'owner') returning id`, [t.tenantId, svc, own.staffId])).rows[0].id as string;
    W1 = { t, own, fo, pid, svcV };
    return W1;
  }
  // an issued invoice of one exempt line (no VAT) by the cashier at `issued`, optionally paid in cash at `paid` in `shift`
  async function soldAt(w: W, amount: number, issued: string, paid: string | null, shift: string | null) {
    let inv = "";
    await seedRaw(["invoices", "invoice_lines", "receipts", "payments", "payment_allocations"], async () => {
      inv = (await h.admin.query(`insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, number, state, counter, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
        values ($1, $2, $2, $3, $4, 'issued', true, false, $5, $6, 'fo_cashier', $7, $6, 'fo_cashier') returning id`,
        [w.t.tenantId, w.t.b1, w.pid, `RS-${key().slice(0, 8)}`, at(issued), w.fo.staffId, `rs-${key()}`])).rows[0].id;
      const line = (await h.admin.query(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
        select $1, $2, $3, v.item_id, v.id, 1, $5, $5, 'exempt_medical', 'Jasa medis', $5, 0 from catalog_versions v where v.id = $4 returning id`, [w.t.tenantId, w.t.b1, inv, w.svcV, amount])).rows[0].id;
      if (paid) {
        const rc = (await h.admin.query(`insert into receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, command_key, issued_by, issued_as, issued_at)
          values ($1, $2, $3, $4, $5, 'Kuitansi sintetis', '80mm', $6, $7, 'fo_cashier', $8) returning id`, [w.t.tenantId, w.t.b1, inv, `RK-${key().slice(0, 8)}`, amount, `rk-${key()}`, w.fo.staffId, at(paid)])).rows[0].id;
        const pay = (await h.admin.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, method, amount, cash_tendered, change_given, environment, received_by, received_as, received_at, shift_id)
          values ($1, $2, $3, 1, $4, 'cash', $5, $5, 0, 'local', $6, 'fo_cashier', $7, $8) returning id`, [w.t.tenantId, w.t.b1, rc, inv, amount, w.fo.staffId, at(paid), shift])).rows[0].id;
        await h.admin.query(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated, created_at)
          values ($1, $2, $3, $4, $5, 'cash', 'local', false, $6)`, [w.t.tenantId, w.t.b1, pay, line, amount, at(paid)]);
      }
    });
    return inv;
  }
  async function shiftAt(w: W, opened: string, closed: string | null) {
    let id = "";
    await seedRaw(["cash_shifts"], async () => {
      id = (await h.admin.query(`insert into cash_shifts (tenant_id, branch_id, cashier_id, cashier_role, state, opening_float, auto_opened, open_key, opened_by, opened_as, opened_at, closed_at, settled_at)
        values ($1, $2, $3, 'fo_cashier', $4, 0, false, $5, $3, 'fo_cashier', $6, $7, $7) returning id`,
        [w.t.tenantId, w.t.b1, w.fo.staffId, closed ? "closed" : "open", `sh-${key()}`, at(opened), closed ? at(closed) : null])).rows[0].id;
    });
    return id;
  }

  it("R3 161ff9b9 F1: K23 keeps an earlier-opened (overnight) shift's in-period activity exactly once; a genuine pre-shift invoice stays Tanpa shift", async () => {
    const w = await world();
    // shift opened 2026-09-30 22:00, closed 2026-10-01 06:00; the cashier sells at 2026-10-01 01:00 (paid at once in that shift)
    const night = await shiftAt(w, "2026-09-30 22:00", "2026-10-01 06:00");
    await soldAt(w, 250_000, "2026-10-01 01:00", "2026-10-01 01:05", night);
    // a sale issued 2026-10-01 07:00 before the next shift opened (08:00); its payment at 08:10 lands in that shift
    const day = await shiftAt(w, "2026-10-01 08:00", "2026-10-01 16:00");
    await soldAt(w, 120_000, "2026-10-01 07:00", "2026-10-01 08:10", day);
    const r = await as(w.own, (db) => read.k23(db, { from: "2026-10-01", to: "2026-10-01" }));
    expect(r.rows).toEqual([
      { shift: night, branch: w.t.b1, k3: M(250_000), k1: M(250_000) }, // opened the day before, active in the period: kept once
      { shift: day, branch: w.t.b1, k3: M(0), k1: M(120_000) },
      { shift: null, branch: w.t.b1, k3: M(120_000), k1: M(0) },          // the kept rule: pre-shift invoice is Tanpa shift
    ]);
    // the previous day sees the overnight shift with nothing in it (its activity is on 2026-10-01), never the October sale
    const prev = await as(w.own, (db) => read.k23(db, { from: "2026-09-30", to: "2026-09-30" }));
    expect(prev.rows).toEqual([{ shift: night, branch: w.t.b1, k3: M(0), k1: M(0) }]);
    // a two-day period lists each shift once
    const both = await as(w.own, (db) => read.k23(db, { from: "2026-09-30", to: "2026-10-01" }));
    expect(both.rows.filter((x) => x.shift === night)).toHaveLength(1);
  });

  it("R3 161ff9b9 F2: a booking-DP cash refund paid in a shift reduces that shift's K1, and K23's K1 total equals dashboard_kpi K1", async () => {
    const w = await world();
    const sh = await shiftAt(w, "2026-10-02 08:00", "2026-10-02 16:00");
    await soldAt(w, 400_000, "2026-10-02 09:00", "2026-10-02 09:05", sh);
    // a DP of 150,000 taken earlier (no shift: received before), refunded in cash in this shift at 10:00 (stamped shift, as booking_deposits_shift)
    await seedRaw(["appointments", "receipts", "payments", "booking_deposits"], async () => {
      const ap = (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, state_reason, state_changed_at, state_changed_by, channel, created_by, created_as)
        values ($1, $2, $3, $4, $5, $6, $7, 'cancelled', 'Dibatalkan klinik', $8, $5, 'phone', $5, 'fo_cashier') returning id`,
        [w.t.tenantId, w.t.b1, w.pid, w.svcV, w.fo.staffId, at("2026-10-05 10:00"), at("2026-10-05 10:30"), at("2026-10-02 10:00")])).rows[0].id;
      const rc = (await h.admin.query(`insert into receipts (tenant_id, branch_id, invoice_id, number, total, body, paper, command_key, issued_by, issued_as, issued_at)
        values ($1, $2, null, $3, 150000, 'Kuitansi DP', '80mm', $4, $5, 'fo_cashier', $6) returning id`, [w.t.tenantId, w.t.b1, `RD-${key().slice(0, 8)}`, `rd-${key()}`, w.fo.staffId, at("2026-09-25 10:00")])).rows[0].id;
      await h.admin.query(`insert into booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category, is_pkp_at_receipt,
               vat_base, vat_amount, cutoff_hours, state, decision_code, refund_method, decided_by, decided_as, decided_at, command_key, received_by, received_as, received_at, shift_id)
        values ($1, $2, $3, $4, $5, $6, 'cash', 150000, 'exempt_medical', false, 150000, 0, 24, 'refunded', 'refund_clinic', 'cash', $7, 'fo_cashier', $8, $9, $7, 'fo_cashier', $10, $11)`,
        [w.t.tenantId, w.t.b1, ap, w.pid, w.svcV, rc, w.fo.staffId, at("2026-10-02 10:00"), `dp-${key()}`, at("2026-09-25 10:00"), sh]);
    });
    const r = await as(w.own, (db) => read.k23(db, { from: "2026-10-02", to: "2026-10-02" }));
    expect(r.rows).toEqual([{ shift: sh, branch: w.t.b1, k3: M(400_000), k1: M(250_000) }]); // 400,000 − 150,000 DP refunded in cash
    const k1 = await as(w.own, (db) => kpi(db, { kpi: "k1", from: "2026-10-02", to: "2026-10-02" }));
    expect(r.rows.reduce((x, y) => x + (y.k1 as { rupiah: number }).rupiah, 0)).toBe(Number(k1.total));
  });

  it("R3 161ff9b9 F3: K21 resolves SET-22 at the end of the as-of LOCAL day — a version effective at the next local midnight is excluded — whatever the session timezone", async () => {
    const w = await world();
    // tidak_datang = 30 effective exactly at 2026-10-02 00:00 WIB (the start of the next local day); one visit 2026-08-31 (31 days before 10-01)
    await seedRaw(["setting_versions", "visits"], async () => {
      await h.admin.query(`insert into setting_versions (tenant_id, branch_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
        values ($1, null, 'SET-22', '{"kunjungan_kedua": 30, "tidak_datang": 30}'::jsonb, $2, 'active', $3, 'owner', 'Pemilik', 'Uji batas hari')`, [w.t.tenantId, at("2026-10-02 00:00"), w.own.staffId]);
      await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, $5)`,
        [w.t.tenantId, w.t.b1, w.pid, w.fo.staffId, at("2026-08-31 10:00")]);
    });
    for (const tz of ["UTC", "Pacific/Kiritimati", "America/Los_Angeles", "Asia/Jakarta"]) {
      const r = await as(w.own, async (db) => { await db.query(`select set_config('timezone', $1, true)`, [tz]); return read.k21(db, { asOf: "2026-10-01" }); });
      expect([r.dormantDays, r.churn], tz).toEqual([90, R(0, 1)]); // 2026-10-01: the 30-day version is not yet in force → 90 days, active
      const n = await as(w.own, async (db) => { await db.query(`select set_config('timezone', $1, true)`, [tz]); return read.k21(db, { asOf: "2026-10-02" }); });
      expect([n.dormantDays, n.churn], tz).toEqual([30, R(1, 1)]); // 2026-10-02: in force → 30 days, the 2026-08-31 visit is dormant
    }
  });

  it("authority: roles per K; a manager's other branch and a foreign branch are not found; another tenant sees none of A", async () => {
    const d = today();
    for (const [p, k] of [[MK, "k20"], [MK, "k21"], [FO, "k23"], [DOC, "k27"], [FIN, "k22"], [PH, "k26"], [FO, "k24"]] as const) {
      const call = (db: pg.PoolClient): Promise<unknown> => (k === "k21" || k === "k22" ? read[k](db, { asOf: d }) : read[k](db, { from: d, to: d }));
      expect(await code(as(p, call)), `${p.role} ${k}`).toBe("ERR_FORBIDDEN");
    }
    expect(await code(as(PH, (db) => read.k24(db, { from: d, to: d })))).toBe("ok"); // the pharmacist reads K24 (own branch)
    expect(await code(as(MGR, (db) => read.k20(db, { from: d, to: d, branchId: A.b2 })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => read.k20(db, { from: d, to: d, branchId: A.b1 })))).toBe("ERR_NOT_FOUND");
    expect(await as(BOWN, (db) => read.k20(db, { from: d, to: d }))).toEqual({ k3: M(0), invoices: C(0), average: { kind: "unavailable", reason: "no_data" } });
    expect(await as(BOWN, (db) => read.k22(db, { asOf: d }))).toEqual([]);
    expect(await code(as(OWN, (db) => read.k20(db, { from: d, to: "2020-01-01" })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => read.k22(db, { asOf: d, limit: 101 })))).toBe("ERR_INVALID_INPUT");
  });

  it("report_k27 reads no SOAP / clinical column and no report function is executable by PUBLIC", async () => {
    const src = (await h.admin.query(`select prosrc from pg_proc where proname = 'report_k27'`)).rows[0].prosrc as string;
    for (const c of ["subjective", "objective", "assessment", "plan_note", "icd10_codes", "vitals", "template_values", "reason"]) expect(src, c).not.toMatch(new RegExp(`\\.${c}\\b`));
    const pub = (await h.admin.query(`select count(*)::int c from pg_proc p where p.proname like 'report\\_%' and has_function_privilege('public', p.oid, 'execute')`)).rows[0].c;
    expect(pub).toBe(0);
  });
});
